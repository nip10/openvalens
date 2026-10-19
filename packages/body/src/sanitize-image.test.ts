import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { IMAGE_SANITIZATION_LIMITS, ImageSanitizationError, sanitizeImage } from "./sanitize-image";

async function jpegWithExif(): Promise<Buffer> {
  const width = 30;
  const height = 20;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = y < height / 2 ? (x < width / 2 ? [255, 0, 0] : [0, 255, 0]) : [0, 0, 255];
      pixels.set(color, (y * width + x) * 3);
    }
  }
  const base = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
    .toBuffer();
  const make = Buffer.from("DEVICE-CANARY\0", "ascii");
  const model = Buffer.from("MODEL-CANARY\0", "ascii");
  const tiff = Buffer.alloc(8 + 2 + 4 * 12 + 4 + 2 + 4 * 12 + 4 + 48 + make.length + model.length);
  tiff.write("II", 0, "ascii");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  const ifd0 = 8;
  tiff.writeUInt16LE(4, ifd0);
  const gpsOffset = 8 + 2 + 4 * 12 + 4;
  const rationals = gpsOffset + 2 + 4 * 12 + 4;
  const makeOffset = rationals + 48;
  const modelOffset = makeOffset + make.length;
  const entry = (index: number, tag: number, type: number, count: number, value: number) => {
    const offset = ifd0 + 2 + index * 12;
    tiff.writeUInt16LE(tag, offset);
    tiff.writeUInt16LE(type, offset + 2);
    tiff.writeUInt32LE(count, offset + 4);
    tiff.writeUInt32LE(value, offset + 8);
  };
  entry(0, 0x010f, 2, make.length, makeOffset);
  entry(1, 0x0110, 2, model.length, modelOffset);
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
  for (const [index, value] of [40, 1, 0, 1, 0, 1, 74, 1, 0, 1, 0, 1].entries()) {
    tiff.writeUInt32LE(value, rationals + index * 4);
  }
  make.copy(tiff, makeOffset);
  model.copy(tiff, modelOffset);
  const exifPayload = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const exifSegment = Buffer.alloc(4 + exifPayload.length);
  exifSegment.writeUInt16BE(0xffe1, 0);
  exifSegment.writeUInt16BE(exifPayload.length + 2, 2);
  exifPayload.copy(exifSegment, 4);
  const xmp = Buffer.from(
    'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><rdf:RDF><rdf:Description><dc:description>XMP-CANARY</dc:description></rdf:Description></rdf:RDF></x:xmpmeta>',
    "binary",
  );
  const xmpSegment = Buffer.alloc(4 + xmp.length);
  xmpSegment.writeUInt16BE(0xffe1, 0);
  xmpSegment.writeUInt16BE(xmp.length + 2, 2);
  xmp.copy(xmpSegment, 4);
  const iptcCanary = Buffer.from("IPTC-CANARY");
  const iptcData = Buffer.concat([
    Buffer.from([0x1c, 2, 120, 0]),
    Buffer.from([iptcCanary.byteLength]),
    iptcCanary,
  ]);
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
    .withXmp(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><rdf:RDF><rdf:Description><dc:description>PNG-XMP-CANARY</dc:description></rdf:Description></rdf:RDF></x:xmpmeta>',
    )
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
    const exif = sourceMetadata.exif!;
    const boundedRead = (offset: number, size: number) => {
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset + size).toBeLessThanOrEqual(exif.length);
      return exif.subarray(offset, offset + size);
    };
    const ifd0 = 6 + exif.readUInt32LE(10);
    boundedRead(ifd0, 2);
    const gpsPointerEntry = ifd0 + 2 + 3 * 12;
    boundedRead(gpsPointerEntry, 12);
    expect(exif.readUInt16LE(gpsPointerEntry)).toBe(0x8825);
    const gpsIfd = 6 + exif.readUInt32LE(gpsPointerEntry + 8);
    const gpsCount = exif.readUInt16LE(gpsIfd);
    boundedRead(gpsIfd + 2, gpsCount * 12 + 4);
    const gpsTags = Array.from({ length: gpsCount }, (_, index) =>
      exif.readUInt16LE(gpsIfd + 2 + index * 12),
    );
    expect(gpsTags).toContain(1);
    expect(gpsTags).toContain(2);
    expect(gpsTags).toContain(3);
    expect(gpsTags).toContain(4);
    const readAsciiTag = (tag: number, expected: string) => {
      const entry = gpsIfd + 2 + gpsTags.indexOf(tag) * 12;
      expect(exif.readUInt16LE(entry + 2)).toBe(2);
      const count = exif.readUInt32LE(entry + 4);
      const value = exif.readUInt32LE(entry + 8);
      const text =
        count <= 4 ? exif.subarray(entry + 8, entry + 8 + count) : boundedRead(6 + value, count);
      expect(text.toString("ascii").replace(/\0+$/, "")).toBe(expected);
    };
    readAsciiTag(1, "N");
    readAsciiTag(3, "W");
    const readCoordinate = (tag: number) => {
      const entry = gpsIfd + 2 + gpsTags.indexOf(tag) * 12;
      expect(exif.readUInt16LE(entry + 2)).toBe(5);
      expect(exif.readUInt32LE(entry + 4)).toBe(3);
      const offset = 6 + exif.readUInt32LE(entry + 8);
      const values = Array.from({ length: 3 }, (_, index) => {
        const pair = boundedRead(offset + index * 8, 8);
        const numerator = pair.readUInt32LE(0);
        const denominator = pair.readUInt32LE(4);
        expect(denominator).toBeGreaterThan(0);
        return [numerator, denominator] as const;
      });
      return values;
    };
    expect(readCoordinate(2)).toEqual([
      [40, 1],
      [0, 1],
      [0, 1],
    ]);
    expect(readCoordinate(4)).toEqual([
      [74, 1],
      [0, 1],
      [0, 1],
    ]);
    const readIfdAscii = (tag: number, expected: string) => {
      const count = exif.readUInt32LE(tag + 4);
      const value = exif.readUInt32LE(tag + 8);
      expect(exif.readUInt16LE(tag + 2)).toBe(2);
      expect(
        boundedRead(6 + value, count)
          .toString("ascii")
          .replace(/\0+$/, ""),
      ).toBe(expected);
    };
    readIfdAscii(ifd0 + 2, "DEVICE-CANARY");
    readIfdAscii(ifd0 + 14, "MODEL-CANARY");
    expect(sourceMetadata.xmp?.toString()).toContain("XMP-CANARY");
    expect(sourceMetadata.iptc).toBeDefined();
    const iptc = sourceMetadata.iptc!;
    const iptcText = iptc.toString("latin1");
    const iptcOffset = iptcText.indexOf("IPTC-CANARY");
    expect(iptcOffset).toBeGreaterThanOrEqual(5);
    expect(iptcOffset).toBeLessThan(iptc.length);
    expect(iptc.readUInt16BE(iptcOffset - 2)).toBe(11);
    expect(iptc.subarray(iptcOffset, iptcOffset + 11).toString("ascii")).toBe("IPTC-CANARY");
    const metadata = await sharp(result.bytes).metadata();

    expect(result.contentType).toBe("image/jpeg");
    expect([result.width, result.height]).toEqual([20, 30]);
    const oriented = await sharp(result.bytes).removeAlpha().raw().toBuffer();
    // EXIF orientation 6 rotates clockwise: input top-left red moves to output top-right.
    const outputPixel = (x: number, y: number) =>
      oriented.subarray((y * 20 + x) * 3, (y * 20 + x) * 3 + 3);
    expect(outputPixel(19, 0)[0]).toBeGreaterThan(170);
    expect(outputPixel(19, 0)[1]).toBeLessThan(90);
    expect(outputPixel(0, 0)[2]).toBeGreaterThan(170);
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
