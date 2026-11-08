/**
 * Sleep-session layer: sanitizing vendor stage lists, grouping stages into
 * sessions, segmenting sleep/wake samples, and the overlap-replace identity
 * pattern.
 *
 * Ported from Gadgetbridge at revision
 * 8976702fc3d00e6008c91fe994668cb4027f7bc2. AGPL-3.0-or-later, same as
 * upstream. Pure TypeScript with no runtime dependencies.
 */

export * from "./types";
export * from "./sanitize";
export * from "./segmenter";
export * from "./identity";
