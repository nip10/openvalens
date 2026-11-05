import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

import { runB163CryptoSelfTest } from "./self-test";

test("importing the probe does not load native crypto until invoked", () => {
  expect(runB163CryptoSelfTest).toBeFunction();
});

test("self-test probe passes the B-163, invalid-point, and AES vectors with independent node crypto", async () => {
  // Bun's crypto implementation does not expose sect163r2. Bundle only the
  // actual probe core, then execute that same function in Node's independent
  // OpenSSL-backed crypto runtime.
  const build = await Bun.build({
    entrypoints: [new URL("./self-test.ts", import.meta.url).pathname],
    target: "node",
    external: ["react-native-quick-crypto"],
  });
  expect(build.success).toBe(true);
  const directory = await mkdtemp(join(tmpdir(), "b163-crypto-probe-"));
  const bundle = join(directory, "self-test.mjs");
  try {
    await writeFile(bundle, await build.outputs[0]!.text());
    const result = Bun.spawn([
      "node", "--input-type=module", "-e",
      `import { createCipheriv, createECDH } from "node:crypto";
       import { runB163CryptoSelfTest } from ${JSON.stringify(`file://${bundle}`)};
       let invalidPeer;
       const strictProvider = {
         createECDH(curve) {
           const ecdh = createECDH(curve);
           return {
             setPrivateKey(key, encoding) {
               if (typeof key !== "string" || encoding !== "hex") throw new TypeError("Invalid privateKey type or encoding");
               ecdh.setPrivateKey(key, encoding);
             },
             getPublicKey(encoding) {
               if (encoding !== "hex") throw new TypeError("Invalid publicKey encoding");
               return ecdh.getPublicKey(encoding);
             },
             computeSecret(peer, encoding) {
               if (typeof peer !== "string" || encoding !== "hex") throw new TypeError("Invalid otherPublicKey type or encoding");
               if (peer === "04" + "00".repeat(42)) invalidPeer = { peer, encoding, decodedLength: Buffer.from(peer, encoding).length };
               return ecdh.computeSecret(peer, encoding);
             },
           };
         },
         createCipheriv,
       };
       const result = await runB163CryptoSelfTest(strictProvider);
       console.log(JSON.stringify({ result, invalidPeer }));`,
    ], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(result.stdout).text(),
      new Response(result.stderr).text(),
      result.exited,
    ]);
    expect(exitCode, stderr).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({
      result: true,
      invalidPeer: { peer: `04${"00".repeat(42)}`, encoding: "hex", decodedLength: 43 },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
