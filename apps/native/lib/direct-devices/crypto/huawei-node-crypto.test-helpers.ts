/**
 * Node-backed Huawei crypto providers for tests (never bundled: only test
 * files import this). Key size follows the key, GCM takes optional AAD, as the
 * production `react-native-quick-crypto` providers do.
 */
import type { HuaweiAesProvider } from "../protocol/huawei";
import type { HuaweiCryptoProvider } from "./huawei-auth";

export function nodeHuaweiCrypto(): HuaweiCryptoProvider {
  const native = require("node:crypto") as typeof import("node:crypto");
  return {
    randomBytes: (size) => Uint8Array.from(native.randomBytes(size)),
    sha256: (data) => Uint8Array.from(native.createHash("sha256").update(data).digest()),
    hmacSha256: (key, data) =>
      Uint8Array.from(native.createHmac("sha256", key).update(data).digest()),
  };
}

export function nodeHuaweiAes(): HuaweiAesProvider {
  const native = require("node:crypto") as typeof import("node:crypto");
  const algorithm = (key: Uint8Array, mode: string) => `aes-${key.length * 8}-${mode}`;
  return {
    encryptCbc(key, data, iv) {
      const cipher = native.createCipheriv(algorithm(key, "cbc"), key, iv);
      return Uint8Array.from(Buffer.concat([cipher.update(data), cipher.final()]));
    },
    decryptCbc(key, data, iv) {
      const decipher = native.createDecipheriv(algorithm(key, "cbc"), key, iv);
      return Uint8Array.from(Buffer.concat([decipher.update(data), decipher.final()]));
    },
    encryptGcm(key, data, iv, aad) {
      const cipher = native.createCipheriv(algorithm(key, "gcm") as "aes-128-gcm", key, iv);
      if (aad) cipher.setAAD(aad);
      const body = Buffer.concat([cipher.update(data), cipher.final()]);
      return Uint8Array.from(Buffer.concat([body, cipher.getAuthTag()]));
    },
    decryptGcm(key, data, iv, aad) {
      const decipher = native.createDecipheriv(algorithm(key, "gcm") as "aes-128-gcm", key, iv);
      if (aad) decipher.setAAD(aad);
      decipher.setAuthTag(data.subarray(data.length - 16));
      return Uint8Array.from(
        Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]),
      );
    },
  };
}
