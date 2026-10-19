import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { IMAGE_SANITIZATION_LIMITS, ImageSanitizationError, sanitizeImage } from "./sanitize-image";

async function jpegWithExif(): Promise<Buffer> {
  const jpeg = await sharp({ create: { width: 3, height: 2, channels: 4, background: "#dc141e" } })
    .jpeg()
    .withExif({
      IFD0: { Make: "DEVICE-CANARY", Model: "MODEL-CANARY", Orientation: "6" },
    } as Parameters<ReturnType<typeof sharp>["withExif"]>[0])
    .toBuffer();
  // Sharp writes orientation 1 on generated EXIF; patch that TIFF field to make
  // a deterministic synthetic orientation-6 input without a real photo fixture.
  const marker = jpeg.indexOf(Buffer.from("Exif\0\0", "binary"));
  const tiff = marker + 6;
  const littleEndian = jpeg.toString("ascii", tiff, tiff + 2) === "II";
  const read16 = (offset: number) =>
    littleEndian ? jpeg.readUInt16LE(offset) : jpeg.readUInt16BE(offset);
  const read32 = (offset: number) =>
    littleEndian ? jpeg.readUInt32LE(offset) : jpeg.readUInt32BE(offset);
  const write16 = (offset: number, value: number) =>
    littleEndian ? jpeg.writeUInt16LE(value, offset) : jpeg.writeUInt16BE(value, offset);
  const ifd = tiff + read32(tiff + 4);
  const entries = read16(ifd);
  for (let index = 0; index < entries; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (read16(entry) === 0x0112) write16(entry + 8, 6);
  }
  return jpeg;
}

async function pngWithMetadata(): Promise<Buffer> {
  return sharp({ create: { width: 2, height: 2, channels: 4, background: "#dc141e" } })
    .png()
    .withMetadata({ density: 144 })
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
    expect((await sharp(source).metadata()).orientation).toBe(6);
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
    expect(result.bytes.toString("latin1")).not.toContain("GPSLatitude");
  });

  test("re-encodes PNG as canonical PNG without retaining metadata", async () => {
    const source = await pngWithMetadata();
    const result = await sanitizeImage(source);
    const metadata = await sharp(result.bytes).metadata();

    expect(result.contentType).toBe("image/png");
    expect([result.width, result.height]).toEqual([2, 2]);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
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
