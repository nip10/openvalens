export const reverseHexBytes = (hex: string) => hex.match(/../g)?.reverse().join("") ?? "";

export function publicPointToWire(hex: string): string {
  if (!hex.startsWith("04") || hex.length !== 86 || !/^[\da-f]+$/i.test(hex)) throw new Error("INVALID_POINT_FORMAT");
  return reverseHexBytes(hex.slice(2, 44)).padEnd(48, "0") + reverseHexBytes(hex.slice(44)).padEnd(48, "0");
}

export function sharedXToWire(hex: string): string {
  if (hex.length !== 42 || !/^[\da-f]+$/i.test(hex)) throw new Error("INVALID_SHARED_X_FORMAT");
  return reverseHexBytes(hex).padEnd(48, "0");
}
