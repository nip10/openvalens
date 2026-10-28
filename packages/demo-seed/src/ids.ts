import { createHash } from "node:crypto";

/**
 * A stable, well-formed UUID (version 4 layout) derived from a label, for the
 * client mutation ids and keys the API requires (Issue #301). The same label
 * always gives the same id, so reruns send identical requests.
 */
export function demoUuid(label: string): string {
  const hex = createHash("sha256").update(`openvalens-demo:${label}`).digest("hex");
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
