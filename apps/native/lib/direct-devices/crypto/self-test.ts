import fixture from "../__fixtures__/b163-reference.json";
import { publicPointToWire, reverseHexBytes, sharedXToWire } from "./encoding";

type Ecdh = {
  setPrivateKey(key: string, encoding: "hex"): void;
  getPublicKey(encoding: "hex"): string;
  computeSecret(peer: string, encoding: "hex"): Uint8Array;
};
type Cipher = {
  setAutoPadding(value: boolean): void;
  update(input: Uint8Array): Uint8Array;
  final(): Uint8Array;
};
/** Narrow injection point so this exact probe can be exercised with independent crypto. */
export type CryptoProbeProvider = {
  createECDH(curve: string): Ecdh;
  createCipheriv(algorithm: string, key: Uint8Array, iv: Uint8Array): Cipher;
};

function fromHex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function runB163CryptoSelfTest(provider?: CryptoProbeProvider): Promise<boolean> {
  // Keep the platform crypto dependency lazy: the module is loaded only when a
  // caller explicitly runs this self-test.
  const crypto = provider ?? await loadNativeCryptoProvider();
  const ec = fixture.vectors.map((vector) => {
    const ecdh = crypto.createECDH(fixture.curve);
    ecdh.setPrivateKey(reverseHexBytes(vector.privateScalarLe), "hex");
    if (publicPointToWire(ecdh.getPublicKey("hex")) !== vector.publicPointLe)
      throw new Error("PUBLIC_VECTOR_MISMATCH");
    return ecdh;
  });
  const key = fromHex(fixture.syntheticKey);
  for (let i = 0; i < ec.length; i += 1) {
    const peerHex = ec[1 - i]!.getPublicKey("hex");
    const sharedBe = toHex(ec[i]!.computeSecret(peerHex, "hex"));
    if (sharedBe.length !== 42) throw new Error("SHARED_VECTOR_LENGTH");
    const sharedLe = sharedXToWire(sharedBe);
    const expected = fixture.vectors[i]!;
    if (sharedLe !== expected.sharedXLe) throw new Error("SHARED_VECTOR_MISMATCH");
    const sessionKey = [...Array(16)].map((_, n) =>
      (Number.parseInt(sharedLe.slice((8 + n) * 2, (9 + n) * 2), 16) ^ key[n]!)
        .toString(16).padStart(2, "0"),
    ).join("");
    if (
      sessionKey !== expected.sessionKey ||
      Number.parseInt(sharedLe.slice(0, 8).match(/../g)!.reverse().join(""), 16) !== expected.sequence
    ) throw new Error("DERIVATION_VECTOR_MISMATCH");
  }
  try {
    ec[0]!.computeSecret(`04${"00".repeat(42)}`, "hex");
    throw new Error("INVALID_POINT_ACCEPTED");
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_POINT_ACCEPTED") throw error;
  }

  const aes = crypto.createCipheriv("aes-128-ecb", fromHex("000102030405060708090a0b0c0d0e0f"), new Uint8Array(0));
  aes.setAutoPadding(false);
  const encrypted = toHex(aes.update(fromHex("00112233445566778899aabbccddeeff"))) + toHex(aes.final());
  return encrypted === "69c4e0d86a7b0430d8cdb78070b4c55a";
}

async function loadNativeCryptoProvider(): Promise<CryptoProbeProvider> {
  const native = await import("react-native-quick-crypto");
  return {
    createECDH(curve) {
      const ecdh = native.createECDH(curve);
      return {
        setPrivateKey(key, encoding) { ecdh.setPrivateKey(key, encoding); },
        getPublicKey(encoding) {
          const publicKey = ecdh.getPublicKey(encoding);
          return typeof publicKey === "string" ? publicKey : publicKey.toString("hex");
        },
        computeSecret(peer, encoding) { return ecdh.computeSecret(peer, encoding); },
      };
    },
    createCipheriv(algorithm, key, iv) {
      const cipher = native.createCipheriv(algorithm, key, iv);
      return {
        setAutoPadding(value) { cipher.setAutoPadding(value); },
        update(input) { return cipher.update(input); },
        final() { return cipher.final(); },
      };
    },
  };
}
