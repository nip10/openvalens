import { describe, expect, test } from "bun:test";
import { ORPCError } from "@orpc/client";

import { FOOD_PHOTO_MAX_BYTES } from "./contracts/nutrition-food-drafts";
import { PHOTO_UPLOAD_MAX_BYTES, isPayloadTooLarge, photoUploadProblem } from "./photo-upload";
import { PROGRESS_PHOTO_MAX_BYTES } from "./routers/private-body";

describe("photo upload limits", () => {
  test("both upload procedures share the client-side limit", () => {
    expect(PHOTO_UPLOAD_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(PROGRESS_PHOTO_MAX_BYTES).toBe(PHOTO_UPLOAD_MAX_BYTES);
    expect(FOOD_PHOTO_MAX_BYTES).toBe(PHOTO_UPLOAD_MAX_BYTES);
  });

  test("photoUploadProblem mirrors the server checks", () => {
    expect(photoUploadProblem({ size: 5_000_000, type: "image/jpeg" })).toBeNull();
    expect(photoUploadProblem({ size: PHOTO_UPLOAD_MAX_BYTES, type: "image/png" })).toBeNull();
    expect(photoUploadProblem({ size: PHOTO_UPLOAD_MAX_BYTES + 1, type: "image/jpeg" })).toBe(
      "too_large",
    );
    expect(photoUploadProblem({ size: 0, type: "image/jpeg" })).toBe("empty");
    expect(photoUploadProblem({ size: 1000, type: "image/heic" })).toBe("wrong_type");
  });

  test("isPayloadTooLarge recognises only a 413", () => {
    expect(isPayloadTooLarge(new ORPCError("PAYLOAD_TOO_LARGE", { status: 413 }))).toBe(true);
    expect(isPayloadTooLarge(new ORPCError("BAD_REQUEST", { status: 400 }))).toBe(false);
    expect(isPayloadTooLarge(new Error("network"))).toBe(false);
    expect(isPayloadTooLarge(null)).toBe(false);
  });
});
