/**
 * Photo upload limits shared by the API, the server's body limit and the
 * apps (progress photos #85, meal photos #71). No imports: safe for the app
 * bundle.
 *
 * The procedures accept a JPEG or PNG of up to `PHOTO_UPLOAD_MAX_BYTES`. The
 * apps check the same bound before sending, so a member sees a clear "too
 * large" message instead of a failed request.
 */

/** Largest photo a member may upload, in bytes (10 MiB). */
export const PHOTO_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/** Image types the upload procedures accept. */
export const PHOTO_UPLOAD_TYPES: readonly string[] = ["image/jpeg", "image/png"];

/**
 * Why a chosen file cannot be uploaded, or `null` when it can.
 * Mirrors the server-side checks so the apps can explain the problem before
 * any byte is sent.
 */
export function photoUploadProblem(file: {
  size: number;
  type: string;
}): "empty" | "too_large" | "wrong_type" | null {
  if (!PHOTO_UPLOAD_TYPES.includes(file.type)) return "wrong_type";
  if (file.size <= 0) return "empty";
  if (file.size > PHOTO_UPLOAD_MAX_BYTES) return "too_large";
  return null;
}

/** True when a request failed because its body was over the server's limit (HTTP 413). */
export function isPayloadTooLarge(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("status" in error)) return false;
  return (error as { status: unknown }).status === 413;
}
