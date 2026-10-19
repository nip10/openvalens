import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { IMAGE_SANITIZATION_LIMITS, ImageSanitizationError, sanitizeImage } from "./sanitize-image";

async function jpegWithExif(): Promise<Buffer> {
  const base = await sharp({ create: { width: 3, height: 2, channels: 3, background: "#dc141e" } })
    .jpeg()
    .toBuffer();
  const tiff = Buffer.alloc(8 + 2 + 4 * 12 + 4 + 2 + 4 * 12 + 4 + 28 + 14 + 13);
  tiff.write("II", 0, "ascii");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  const ifd0 = 8;
  tiff.writeUInt16LE(4, ifd0);
  const makeOffset = 8 + 2 + 4 * 12 + 4 + 2 + 4 * 12 + 4 + 28;
  const modelOffset = makeOffset + 14;
  const gpsOffset = 8 + 2 + 4 * 12 + 4;
  const entry = (index: number, tag: number, type: number, count: number, value: number) => {
    const offset = ifd0 + 2 + index * 12;
    tiff.writeUInt16LE(tag, offset);
    tiff.writeUInt16LE(type, offset + 2);
    tiff.writeUInt32LE(count, offset + 4);
    tiff.writeUInt32LE(value, offset + 8);
  };
  entry(0, 0x010f, 2, 14, makeOffset);
  entry(1, 0x0110, 2, 13, modelOffset);
  entry(2, 0x0112, 3, 1, 6);
  entry(3, 0x8825, 4, 1, gpsOffset);
  tiff.writeUInt32LE(0, ifd0 + 2 + 4 * 12);
  tiff.writeUInt16LE(4, gpsOffset);
  const gpsEntry = (index: number, tag: number, type: number, count: number, value: number) => {
    const offset = gpsOffset + 2 + index * 12;
    tiff.writeUInt16LE(tag, offset);
    tiff.writeUInt16LE(type, offset + 2);
    tiff.writeUInt32LE(count, offset + 4);
    tiff.writeUInt32LE(value, offset + 8);
  };
  gpsEntry(0, 1, 2, 2, 0x004e);
  gpsEntry(1, 2, 5, 3, gpsOffset + 2 + 4 * 12 + 4);
  gpsEntry(2, 3, 2, 2, 0x0057);
  gpsEntry(3, 4, 5, 3, gpsOffset + 2 + 4 * 12 + 4 + 24);
  tiff.writeUInt32LE(0, gpsOffset + 2 + 4 * 12);
  const rationals = gpsOffset + 2 + 4 * 12 + 4;
  for (const [index, value] of [40, 1, 0, 8, 0, 0].entries()) {
    tiff.writeUInt32LE(value, rationals + index * 4);
  }
  tiff.write("DEVICE-CANARY\0MODEL-CANARY\0", makeOffset, "ascii");
  const exifPayload = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const exifSegment = Buffer.alloc(4 + exifPayload.length);
  exifSegment.writeUInt16BE(0xffe1, 0);
  exifSegment.writeUInt16BE(exifPayload.length + 2, 2);
  exifPayload.copy(exifSegment, 4);
  const xmp = Buffer.from(
    'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/">XMP-CANARY</x:xmpmeta>',
    "binary",
  );
  const xmpSegment = Buffer.alloc(4 + xmp.length);
  xmpSegment.writeUInt16BE(0xffe1, 0);
  xmpSegment.writeUInt16BE(xmp.length + 2, 2);
  xmp.copy(xmpSegment, 4);
  const iptcData = Buffer.concat([Buffer.from([0x1c, 2, 120, 0, 12]), Buffer.from("IPTC-CANARY")]);
  const iptcResource = Buffer.concat([
    Buffer.from("8BIM", "ascii"),
    Buffer.from([0x04, 0x04, 0, 0]),
    Buffer.from([0, 0, 0, iptcData.length]),
    iptcData,
    iptcData.length % 2 ? Buffer.from([0]) : Buffer.alloc(0),
  ]);
  const photoshop = Buffer.concat([Buffer.from("Photoshop 3.0\0", "ascii"), iptcResource]);
  const iptcSegment = Buffer.alloc(4 + photoshop.length);
  iptcSegment.writeUInt16BE(0xffed, 0);
  iptcSegment.writeUInt16BE(photoshop.length + 2, 2);
  photoshop.copy(iptcSegment, 4);
  return Buffer.concat([
    base.subarray(0, 2),
    exifSegment,
    xmpSegment,
    iptcSegment,
    base.subarray(2),
  ]);
}

async function pngWithMetadata(): Promise<Buffer> {
  return sharp({ create: { width: 2, height: 2, channels: 4, background: "#dc141e" } })
    .png()
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">PNG-XMP-CANARY</x:xmpmeta>')
    .toBuffer();
}

function expectCode(promise: Promise<unknown>, code: string) {
  return expect(promise).rejects.toMatchObject({
    name: "ImageSanitizationError",
    code,
  });
}

describe("sanitizeImage", () => {
  test("decodes JPEG, applies EXIF orientation and strips metadata", async () => {
    const source = await jpegWithExif();
    const result = await sanitizeImage(source);
    const sourceMetadata = await sharp(source).metadata();
    expect(sourceMetadata.orientation).toBe(6);
    expect(sourceMetadata.exif).toBeDefined();
    expect(sourceMetadata.exif?.toString("latin1")).toContain("DEVICE-CANARY");
    expect(sourceMetadata.exif?.toString("latin1")).toContain("MODEL-CANARY");
    const exif = sourceMetadata.exif!;
    const ifd0 = 6 + exif.readUInt32LE(10);
    const gpsPointerEntry = ifd0 + 2 + 3 * 12;
    expect(exif.readUInt16LE(gpsPointerEntry)).toBe(0x8825);
    const gpsIfd = 6 + exif.readUInt32LE(gpsPointerEntry + 8);
    const gpsTags = Array.from({ length: exif.readUInt16LE(gpsIfd) }, (_, index) =>
      exif.readUInt16LE(gpsIfd + 2 + index * 12),
    );
    expect(gpsTags).toContain(1);
    expect(gpsTags).toContain(2);
    expect(gpsTags).toContain(3);
    expect(gpsTags).toContain(4);
    expect(sourceMetadata.xmp?.toString()).toContain("XMP-CANARY");
    expect(sourceMetadata.iptc?.toString("latin1")).toContain("IPTC-CANARY");
    const metadata = await sharp(result.bytes).metadata();

    expect(result.contentType).toBe("image/jpeg");
    expect([result.width, result.height]).toEqual([2, 3]);
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
    expect(metadata.iptc).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(result.bytes).not.toEqual(source);
    expect(result.bytes.toString("latin1")).not.toContain("DEVICE-CANARY");
    expect(result.bytes.toString("latin1")).not.toContain("MODEL-CANARY");
    expect(metadata.exif?.toString("latin1") ?? "").not.toContain("DEVICE-CANARY");
    expect(metadata.xmp?.toString() ?? "").not.toContain("XMP-CANARY");
    expect(metadata.iptc).toBeUndefined();
  });

  test("re-encodes PNG as canonical PNG without retaining metadata", async () => {
    const source = await pngWithMetadata();
    const result = await sanitizeImage(source);
    expect((await sharp(source).metadata()).xmp?.toString()).toContain("PNG-XMP-CANARY");
    const metadata = await sharp(result.bytes).metadata();

    expect(result.contentType).toBe("image/png");
    expect([result.width, result.height]).toEqual([2, 2]);
    expect(metadata.xmp).toBeUndefined();
    expect(result.bytes).not.toEqual(source);
  });

  test("does not trust claimed types; SVG and wrong magic bytes are rejected", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
    await expectCode(sanitizeImage(svg), "unsupported_format");
    await expectCode(sanitizeImage(Buffer.from("not an image")), "unsupported_format");
  });

  test("rejects truncated and over-pixel-cap images", async () => {
    const source = await pngWithMetadata();
    await expectCode(
      sanitizeImage(source.subarray(0, Math.floor(source.length / 2))),
      "invalid_image",
    );
    await expectCode(
      sanitizeImage(source, { ...IMAGE_SANITIZATION_LIMITS, maxInputPixels: 1 }),
      "image_too_large",
    );
  });

  test("checks byte caps before decode and rejects oversized output", async () => {
    await expectCode(
      sanitizeImage(Buffer.from([0, 0, 0]), {
        ...IMAGE_SANITIZATION_LIMITS,
        maxInputBytes: 2,
      }),
      "input_too_large",
    );
    await expectCode(
      sanitizeImage(await pngWithMetadata(), {
        ...IMAGE_SANITIZATION_LIMITS,
        maxOutputBytes: 1,
      }),
      "output_too_large",
    );
  });

  test("bounds the longest output edge", async () => {
    const source = await sharp({
      create: { width: 2500, height: 1, channels: 3, background: "#dc141e" },
    })
      .png()
      .toBuffer();
    const result = await sanitizeImage(source);
    expect(result.width).toBe(IMAGE_SANITIZATION_LIMITS.maxOutputEdge);
    expect(result.height).toBe(1);
  });

  test("rejects zero, NaN and non-integer limits", async () => {
    const source = await sharp({
      create: { width: 1, height: 1, channels: 4, background: "#dc141e" },
    })
      .png()
      .toBuffer();
    for (const invalid of [0, Number.NaN, 1.5]) {
      await expectCode(
        sanitizeImage(source, {
          ...IMAGE_SANITIZATION_LIMITS,
          maxInputBytes: invalid,
        } as typeof IMAGE_SANITIZATION_LIMITS),
        "invalid_limits",
      );
    }
  });

  test("does not expose decoder error details", async () => {
    const error = await sanitizeImage(Buffer.from([0xff, 0xd8, 0xff, 1])).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ImageSanitizationError);
    expect((error as Error).message).toBe("invalid_image");
  });
});
