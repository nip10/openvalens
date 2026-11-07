import type { CryptoProbeProvider } from "./self-test";

export type HelioCryptoProvider = Omit<CryptoProbeProvider, "createECDH"> & {
  createECDH(curve: string): ReturnType<CryptoProbeProvider["createECDH"]> & { generateKeys(): string };
  randomBytes(size: number): Uint8Array;
  createDecipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array | null): ReturnType<CryptoProbeProvider["createCipheriv"]>;
  createECDH(curve: string): ReturnType<CryptoProbeProvider["createECDH"]> & { generateKeys(encoding: "hex"): string };
};

export async function loadHelioCrypto(): Promise<HelioCryptoProvider> {
  const native = await import("react-native-quick-crypto");
  return {
    randomBytes: (size) => native.randomBytes(size),
    createDecipheriv(algorithm, key, iv) { const cipher = (native as unknown as { createDecipheriv(a: string, k: Uint8Array, i: Uint8Array | null): any }).createDecipheriv(algorithm, key, iv); return { setAutoPadding(value) { cipher.setAutoPadding(value); }, update(input) { return cipher.update(input); }, final() { return cipher.final(); } }; },
    createECDH: (curve) => {
      const ecdh = native.createECDH(curve);
      return {
        setPrivateKey(key, encoding) { ecdh.setPrivateKey(key, encoding); },
        generateKeys() { const value = ecdh.generateKeys(); return typeof value === "string" ? value : value.toString("hex"); },
        getPublicKey(encoding) { const value = ecdh.getPublicKey(encoding); return typeof value === "string" ? value : value.toString("hex"); },
        computeSecret(peer, encoding) { return ecdh.computeSecret(peer, encoding); },
      };
    },
    createCipheriv(algorithm, key, iv) {
      const cipher = (native as unknown as { createCipheriv(a: string, k: Uint8Array, i: Uint8Array | null): any }).createCipheriv(algorithm, key, iv);
      return { setAutoPadding(value) { cipher.setAutoPadding(value); }, update(input) { return cipher.update(input); }, final() { return cipher.final(); } };
    },
  };
}
