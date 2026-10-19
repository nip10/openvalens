import sharp from "sharp";

/** Resource limits for the server-side photo pipeline (not clinical/product rules). */
export const IMAGE_SANITIZATION_LIMITS = Object.freeze({
  maxInputBytes: 10 * 1024 * 1024,
  maxInputPixels: 16_000_000,
  maxOutputEdge: 2048,
  maxOutputBytes: 8 * 1024 * 1024,
});

export type ImageSanitizationLimits = {
  maxInputBytes: number;
  maxInputPixels: number;
  maxOutputEdge: number;
  maxOutputBytes: number;
};
export type SanitizedImage = {
  bytes: Buffer;
  contentType: "image/jpeg" | "image/png";
  width: number;
  height: number;
};

export type ImageSanitizationErrorCode =
  | "invalid_limits"
  | "input_too_large"
  | "unsupported_format"
  | "invalid_image"
  | "image_too_large"
  | "output_too_large";

export class ImageSanitizationError extends Error {
  constructor(readonly code: ImageSanitizationErrorCode) {
    super(code);
    this.name = "ImageSanitizationError";
  }
}

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function hasMagic(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function validateLimits(limits: ImageSanitizationLimits): void {
  const valid =
    limits !== null &&
    typeof limits === "object" &&
    Number.isSafeInteger(limits.maxInputBytes) &&
    limits.maxInputBytes > 0 &&
    limits.maxInputBytes <= IMAGE_SANITIZATION_LIMITS.maxInputBytes &&
    Number.isSafeInteger(limits.maxInputPixels) &&
    limits.maxInputPixels > 0 &&
    limits.maxInputPixels <= IMAGE_SANITIZATION_LIMITS.maxInputPixels &&
    Number.isSafeInteger(limits.maxOutputEdge) &&
    limits.maxOutputEdge > 0 &&
    limits.maxOutputEdge <= IMAGE_SANITIZATION_LIMITS.maxOutputEdge &&
    Number.isSafeInteger(limits.maxOutputBytes) &&
    limits.maxOutputBytes > 0 &&
    limits.maxOutputBytes <= IMAGE_SANITIZATION_LIMITS.maxOutputBytes;
  if (!valid) throw new ImageSanitizationError("invalid_limits");
}

/** Decode and re-encode an untrusted photo before handing its bytes to storage. */
export async function sanitizeImage(
  input: Uint8Array,
  limits: ImageSanitizationLimits = IMAGE_SANITIZATION_LIMITS,
): Promise<SanitizedImage> {
  validateLimits(limits);
  if (!(input instanceof Uint8Array) || input.byteLength === 0) {
    throw new ImageSanitizationError("invalid_image");
  }
  if (input.byteLength > limits.maxInputBytes) {
    throw new ImageSanitizationError("input_too_large");
  }

  const isJpeg = hasMagic(input, JPEG_MAGIC);
  const isPng = hasMagic(input, PNG_MAGIC);
  if (!isJpeg && !isPng) throw new ImageSanitizationError("unsupported_format");

  try {
    const image = sharp(Buffer.from(input), {
      // Read headers under the hard global cap, then enforce any smaller caller cap below.
      limitInputPixels: IMAGE_SANITIZATION_LIMITS.maxInputPixels,
      failOn: "error",
      animated: false,
    });
    const source = await image.metadata();
    if (
      source.format !== (isJpeg ? "jpeg" : "png") ||
      (source.pages ?? 1) !== 1 ||
      !source.width ||
      !source.height
    ) {
      throw new ImageSanitizationError("invalid_image");
    }
    if (source.width * source.height > limits.maxInputPixels) {
      throw new ImageSanitizationError("image_too_large");
    }

    const output = await sharp(Buffer.from(input), {
      limitInputPixels: limits.maxInputPixels,
      failOn: "error",
      animated: false,
    })
      .autoOrient()
      .resize({
        width: limits.maxOutputEdge,
        height: limits.maxOutputEdge,
        fit: "inside",
        withoutEnlargement: true,
      })
      .toFormat(isJpeg ? "jpeg" : "png")
      .toBuffer({ resolveWithObject: true });

    if (output.data.byteLength > limits.maxOutputBytes) {
      throw new ImageSanitizationError("output_too_large");
    }
    return {
      bytes: output.data,
      contentType: isJpeg ? "image/jpeg" : "image/png",
      width: output.info.width,
      height: output.info.height,
    };
  } catch (error) {
    if (error instanceof ImageSanitizationError) throw error;
    // Decoder diagnostics may contain source details; expose only a stable code.
    throw new ImageSanitizationError("invalid_image");
  }
}
