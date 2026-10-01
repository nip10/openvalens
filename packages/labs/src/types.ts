/**
 * Labs — public type surface.
 *
 * Labs come from `metric_sample` rows whose canonical code starts with
 * ``blood_marker_`` (e.g. `blood_marker_glucose`, `blood_marker_hba1c`).
 * Each tenant defines its own marker rows in `metric_definition` with the
 * display name and unit; the canonical wildcard `blood_marker` carries
 * "varies" as the unit so each marker is responsible for its own.
 */

export type LabMarkerLatest = {
  code: string;
  displayName: string;
  unit: string | null;
  latestValue: number | null;
  latestSampledAt: string | null;
  sampleCount: number;
  /** Small series for a sparkline, oldest first. */
  recentValues: { sampledAt: string; value: number }[];
};
