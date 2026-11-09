import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { readFile } from "node:fs/promises";

const fixturePath = new URL(
  "../apps/native/lib/direct-devices/__fixtures__/b163-reference.json",
  import.meta.url,
);
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));

assert.equal(fixture.schemaVersion, 1);
assert.equal(fixture.curve, "sect163r2");
assert.equal(fixture.encoding.privateScalar, "little-endian, 24 bytes");
assert.equal(
  fixture.encoding.publicPoint,
  "x || y; each coordinate little-endian in a 24-byte slot",
);
assert.equal(fixture.encoding.sharedX, "little-endian x coordinate in a 24-byte slot");
assert.equal(fixture.vectors.length, 2);

const fromHex = (value) => Buffer.from(value, "hex");
const reverse = (value) => Buffer.from(value).reverse();
const pointToWire = (point) => {
  assert.equal(
    point.length,
    43,
    "sect163r2 uncompressed point must be 0x04 || 21-byte x || 21-byte y",
  );
  assert.equal(point[0], 4);
  const xLe = reverse(point.subarray(1, 22));
  const yLe = reverse(point.subarray(22, 43));
  return Buffer.concat([xLe, Buffer.alloc(3), yLe, Buffer.alloc(3)]);
};

const ecdhs = fixture.vectors.map((vector) => {
  const privateScalarLe = fromHex(vector.privateScalarLe);
  assert.equal(privateScalarLe.length, 24, `${vector.name}: private scalar slot length`);
  assert.equal(
    fromHex(vector.publicPointLe).length,
    48,
    `${vector.name}: public point slot length`,
  );
  assert.equal(fromHex(vector.sharedXLe).length, 24, `${vector.name}: shared x slot length`);

  const ecdh = createECDH(fixture.curve);
  ecdh.setPrivateKey(reverse(privateScalarLe));
  assert.deepEqual(
    pointToWire(ecdh.getPublicKey(null, "uncompressed")),
    fromHex(vector.publicPointLe),
    `${vector.name}: public point`,
  );
  return ecdh;
});

const sharedKeyBytes = fromHex(fixture.syntheticKey);
assert.equal(sharedKeyBytes.length, 16, "synthetic key length");
for (let index = 0; index < fixture.vectors.length; index += 1) {
  const vector = fixture.vectors[index];
  const peer = ecdhs[1 - index].getPublicKey(null, "uncompressed");
  const sharedXBe = ecdhs[index].computeSecret(peer);
  assert.equal(sharedXBe.length, 21, "OpenSSL shared x coordinate length");
  const sharedXLe = Buffer.concat([reverse(sharedXBe), Buffer.alloc(3)]);
  assert.deepEqual(sharedXLe, fromHex(vector.sharedXLe), `${vector.name}: shared x`);

  const sessionKey = Buffer.alloc(16);
  for (let byte = 0; byte < sessionKey.length; byte += 1) {
    sessionKey[byte] = sharedXLe[8 + byte] ^ sharedKeyBytes[byte];
  }
  assert.deepEqual(sessionKey, fromHex(vector.sessionKey), `${vector.name}: session key`);
  assert.equal(sharedXLe.readUInt32LE(0), vector.sequence, `${vector.name}: sequence`);
}

assert.throws(
  () => ecdhs[0].computeSecret(Buffer.concat([Buffer.from([4]), Buffer.alloc(42)])),
  undefined,
  "OpenSSL must reject the all-zero peer point",
);
