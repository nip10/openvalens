// Synthetic JPEG/PNG fixtures for sanitizer tests and the built-server proof.
// They are generated entirely in memory and contain only obvious canaries.
import sharp from "sharp";

export const IMAGE_SANITIZATION_FIXTURE_CANARIES = Object.freeze([
  "DEVICE-CANARY",
  "MODEL-CANARY",
  "XMP-CANARY",
  "IPTC-CANARY",
  "PNG-XMP-CANARY",
]);

/** 30x20 JPEG with EXIF orientation 6, GPS, XMP and IPTC metadata. */
export async function jpegWithExif(): Promise<Buffer> {
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

/** 2x2 PNG carrying an XMP canary. */
export async function pngWithMetadata(): Promise<Buffer> {
  return sharp({ create: { width: 2, height: 2, channels: 4, background: "#dc141e" } })
    .png()
    .withXmp(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><rdf:RDF><rdf:Description><dc:description>PNG-XMP-CANARY</dc:description></rdf:Description></rdf:RDF></x:xmpmeta>',
    )
    .toBuffer();
}
