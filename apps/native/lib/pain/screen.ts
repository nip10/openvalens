import { isPainRegion } from "@openvalens/pain/model";

/**
 * The pain log on mobile (#442): cache keys and the body map's route params.
 * Pure, so `bun test` checks it.
 */

export type PainSubject = { userId: string; organizationId: string };

/**
 * Query keys for the member's own pain log, scoped to the signed-in member and
 * workspace so a cached pain log never shows under another account. They all
 * start with `"pain"`, so invalidating `["pain"]` refreshes every one.
 */
export function painKeys(subject: PainSubject) {
  const scope = [subject.organizationId, subject.userId] as const;
  return {
    all: ["pain", ...scope] as const,
    preference: ["pain", ...scope, "preference"] as const,
    map: (days: number) => ["pain", ...scope, "map", days] as const,
    history: (region: string) => ["pain", ...scope, "history", region] as const,
  };
}

export type BodyMapParams = { layer?: "pain"; region?: string };

/** The first value of an expo-router search param. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * `/body-map?layer=pain&region=joint.knee_left` opens the pain layer with that
 * region selected; quick logging (#440) links here. Anything else opens the
 * default layer, and an unknown region is dropped.
 */
export function bodyMapParams(params: {
  layer?: string | string[];
  region?: string | string[];
}): BodyMapParams {
  if (first(params.layer) !== "pain") return {};
  const region = first(params.region);
  return { layer: "pain", ...(region && isPainRegion(region) ? { region } : {}) };
}

/** A back region (`back.lower_back_left`) opens the back view; everything else the front. */
export function initialView(region: string | undefined): "front" | "back" {
  return region?.startsWith("back.") ? "back" : "front";
}
