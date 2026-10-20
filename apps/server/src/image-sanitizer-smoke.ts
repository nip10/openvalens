// Proof entry for the emitted production server distribution. It is built by
// the same tsdown invocation as src/index.ts, copied into the real server image
// and run there. It is intentionally not imported by src/index.ts.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  IMAGE_SANITIZATION_LIMITS,
  ImageSanitizationError,
  type ImageSanitizationLimits,
  sanitizeImage,
} from "@openvalens/body/sanitize-image";
import {
  IMAGE_SANITIZATION_FIXTURE_CANARIES,
  jpegWithExif,
  pngWithMetadata,
} from "@openvalens/body/sanitize-image.fixtures";

class ProofFailure extends Error {}

let checks = 0;

function check(condition: unknown, detail: string): asserts condition {
  checks += 1;
  if (!condition) throw new ProofFailure(detail);
}

async function expectSanitizationError(promise: Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  check(caught instanceof ImageSanitizationError, `error_type_${code}`);
  const error = caught as ImageSanitizationError;
  check(error.code === code, `error_code_${code}`);
  check(error.message === code, `error_message_${code}`);
  check(
    !/(?:sharp|libvips|\/|DEVICE-CANARY|MODEL-CANARY|XMP-CANARY|IPTC-CANARY)/.test(error.message),
    `error_detail_${code}`,
  );
}

function assertNoNativePayload(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      assertNoNativePayload(path);
      continue;
    }
    const extension = extname(entry.name).toLowerCase();
    check(extension !== ".node" && extension !== ".so" && extension !== ".dylib", "native_payload");
    check(!basename(entry.name).toLowerCase().includes("libvips"), "libvips_payload");
  }
}

function outputPixel(bytes: Buffer, width: number, x: number, y: number): Buffer {
  const offset = (y * width + x) * 3;
  return bytes.subarray(offset, offset + 3);
}

async function main(): Promise<void> {
  const modulePath = fileURLToPath(import.meta.url);
  const distDirectory = dirname(modulePath);

  check(process.platform === "linux", "platform");
  check(/^1\.4\.\d+/.test(Bun.version), "bun_version");
  check(modulePath.endsWith("/apps/server/dist/image-sanitizer-smoke.mjs"), "module_path");
  check(
    existsSync(join(distDirectory, "index.mjs")) &&
      statSync(join(distDirectory, "index.mjs")).isFile(),
    "index_emitted",
  );

  const require = createRequire(import.meta.url);
  const sharpModulePath = require.resolve("sharp");
  check(sharpModulePath.includes(`${join("/", "node_modules", "")}`), "sharp_module_location");
  check(!sharpModulePath.startsWith(`${distDirectory}/`), "sharp_not_bundled");
  check(sharp.versions.sharp.startsWith("0.34."), "sharp_version");
  check(sharp.versions.vips.length > 0, "sharp_vips_version");

  const encodedJpeg = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#dc141e" },
  })
    .jpeg()
    .toBuffer();
  const decodedJpeg = await sharp(encodedJpeg).metadata();
  check(decodedJpeg.format === "jpeg" && decodedJpeg.width === 2, "jpeg_capability");
  const encodedPng = await sharp({
    create: { width: 2, height: 2, channels: 4, background: "#dc141e" },
  })
    .png()
    .toBuffer();
  const decodedPng = await sharp(encodedPng).metadata();
  check(decodedPng.format === "png" && decodedPng.height === 2, "png_capability");

  const distModules = readdirSync(distDirectory).filter((name) => name.endsWith(".mjs"));
  check(distModules.includes("image-sanitizer-smoke.mjs"), "smoke_emitted");
  check(distModules.includes("index.mjs"), "index_module");
  const bundledSharpPath = ["node_modules", "sharp"].join("/");
  const sharpSpecifier = /(?:from\s*|require\(\s*)["']sharp["']/;
  for (const module of distModules) {
    const source = readFileSync(join(distDirectory, module), "latin1");
    if (source.includes("sharp")) {
      check(sharpSpecifier.test(source), "sharp_bare_specifier");
      check(!source.includes(bundledSharpPath), "sharp_inlined");
    }
  }
  const smokeSource = readFileSync(join(distDirectory, "image-sanitizer-smoke.mjs"), "latin1");
  check(
    smokeSource.includes("ImageSanitizationError") && smokeSource.includes("output_too_large"),
    "sanitizer_sentinel",
  );
  assertNoNativePayload(distDirectory);

  const expectedLimits = {
    maxInputBytes: 10 * 1024 * 1024,
    maxInputPixels: 16_000_000,
    maxOutputEdge: 2048,
    maxOutputBytes: 8 * 1024 * 1024,
  } as const;
  check(Object.isFrozen(IMAGE_SANITIZATION_LIMITS), "limits_frozen");
  check(
    JSON.stringify(IMAGE_SANITIZATION_LIMITS) === JSON.stringify(expectedLimits),
    "limits_exact",
  );

  const jpegSource = await jpegWithExif();
  const jpegSourceMetadata = await sharp(jpegSource).metadata();
  check(jpegSourceMetadata.width === 30 && jpegSourceMetadata.height === 20, "jpeg_source_size");
  check(jpegSourceMetadata.orientation === 6, "jpeg_source_orientation");
  check(Boolean(jpegSourceMetadata.exif), "jpeg_source_exif");
  check(jpegSourceMetadata.xmp?.toString().includes("XMP-CANARY") === true, "jpeg_source_xmp");
  check(Boolean(jpegSourceMetadata.iptc), "jpeg_source_iptc");
  const jpegResult = await sanitizeImage(jpegSource);
  check(jpegResult.contentType === "image/jpeg", "jpeg_content_type");
  check(jpegResult.width === 20 && jpegResult.height === 30, "jpeg_output_size");
  const jpegOutputMetadata = await sharp(jpegResult.bytes).metadata();
  check(jpegOutputMetadata.orientation === undefined, "jpeg_orientation_removed");
  check(jpegOutputMetadata.exif === undefined, "jpeg_exif_removed");
  check(jpegOutputMetadata.xmp === undefined, "jpeg_xmp_removed");
  check(jpegOutputMetadata.iptc === undefined, "jpeg_iptc_removed");
  const oriented = await sharp(jpegResult.bytes).removeAlpha().raw().toBuffer();
  const topRight = outputPixel(oriented, 20, 19, 0);
  const bottomLeft = outputPixel(oriented, 20, 0, 19);
  const [topRed = 0, topGreen = 0] = topRight;
  const [bottomRed = 0, , bottomBlue = 0] = bottomLeft;
  check(topRed > 170 && topGreen < 90, "jpeg_orientation_red");
  check(bottomBlue > 170 && bottomRed < 90, "jpeg_orientation_blue");
  const jpegText = jpegResult.bytes.toString("latin1");
  for (const canary of IMAGE_SANITIZATION_FIXTURE_CANARIES) {
    check(!jpegText.includes(canary), "jpeg_canary_removed");
  }

  const pngSource = await pngWithMetadata();
  const pngSourceMetadata = await sharp(pngSource).metadata();
  check(pngSourceMetadata.xmp?.toString().includes("PNG-XMP-CANARY") === true, "png_source_xmp");
  const pngResult = await sanitizeImage(pngSource);
  check(pngResult.contentType === "image/png", "png_content_type");
  check(pngResult.width === 2 && pngResult.height === 2, "png_dimensions");
  const pngOutputMetadata = await sharp(pngResult.bytes).metadata();
  check(pngOutputMetadata.xmp === undefined, "png_xmp_removed");
  check(!pngResult.bytes.equals(pngSource), "png_reencoded");
  const pngText = pngResult.bytes.toString("latin1");
  check(!pngText.includes("PNG-XMP-CANARY"), "png_canary_removed");

  const pngLimits: ImageSanitizationLimits = IMAGE_SANITIZATION_LIMITS;
  await expectSanitizationError(
    sanitizeImage(Buffer.alloc(pngLimits.maxInputBytes + 1)),
    "input_too_large",
  );
  await expectSanitizationError(
    sanitizeImage(pngSource, { ...pngLimits, maxInputPixels: 1 }),
    "image_too_large",
  );
  const wideSource = await sharp({
    create: { width: 2500, height: 1, channels: 3, background: "#dc141e" },
  })
    .png()
    .toBuffer();
  const wideResult = await sanitizeImage(wideSource);
  check(wideResult.width === 2048 && wideResult.height === 1, "output_edge_bound");
  await expectSanitizationError(
    sanitizeImage(pngSource, { ...pngLimits, maxOutputBytes: 1 }),
    "output_too_large",
  );
  await expectSanitizationError(
    sanitizeImage(pngSource.subarray(0, Math.floor(pngSource.length / 2))),
    "invalid_image",
  );
  await expectSanitizationError(
    sanitizeImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')),
    "unsupported_format",
  );
  await expectSanitizationError(sanitizeImage(Buffer.from("not an image")), "unsupported_format");
  const onePixelPng = await sharp({
    create: { width: 1, height: 1, channels: 4, background: "#dc141e" },
  })
    .png()
    .toBuffer();
  for (const invalid of [0, Number.NaN, 1.5]) {
    await expectSanitizationError(
      sanitizeImage(onePixelPng, { ...pngLimits, maxInputBytes: invalid }),
      "invalid_limits",
    );
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      platform: process.platform,
      bun: Bun.version,
      sharp: sharp.versions.sharp,
      vips: sharp.versions.vips,
      checks,
      jpeg: [jpegResult.width, jpegResult.height],
      png: [pngResult.width, pngResult.height],
      edge: wideResult.width,
    })}\n`,
  );
}

main().catch((error: unknown) => {
  const failure = error instanceof ProofFailure ? error.message : "unexpected_error";
  process.stderr.write(`${JSON.stringify({ ok: false, failure })}\n`);
  process.exitCode = 1;
});
