import assert from "node:assert/strict";
import * as c from "../js/core/crypto.js";

async function main() {
  // Wrapper round-trips
  const raw = c.b64ToBytes(c.bytesToB64(new TextEncoder().encode("hello")));
  assert.equal(new TextDecoder().decode(raw), "hello");

  // Identity keypair + password wrapping
  const ident = await c.generateIdentityKeyPair();
  const pass = "correct horse battery staple";
  const wrapped = await c.wrapPrivateWithPassword(ident.privateKeyB64, pass);
  const unwrapped = await c.unwrapPrivateWithPassword(wrapped.saltB64, wrapped.wrappedB64, pass);
  assert.equal(c.bytesToB64(unwrapped), ident.privateKeyB64);
  await c.importPrivateKey(unwrapped);

  // Wrong password must fail
  await assert.rejects(() => c.unwrapPrivateWithPassword(wrapped.saltB64, wrapped.wrappedB64, "wrong"));

  // Device secret wrapping
  const secret = c.bytesToB64(c.randomBytes(32));
  const protectedB64 = await c.encryptWithDeviceSecret(secret, ident.privateKeyB64);
  const recovered = await c.decryptWithDeviceSecret(secret, protectedB64);
  assert.equal(c.bytesToB64(recovered), ident.privateKeyB64);

  // Room key share between two identities
  const alice = await c.generateIdentityKeyPair();
  const bob = await c.generateIdentityKeyPair();
  const roomKey = await c.generateRoomKey();

  const aliceWrapped = await c.encryptRoomKeyForMember(roomKey, alice.publicKeyB64);
  const bobWrapped = await c.encryptRoomKeyForMember(roomKey, bob.publicKeyB64);

  const aliceKey = await c.decryptRoomKeyForMember(aliceWrapped, await c.importPrivateKey(c.b64ToBytes(alice.privateKeyB64)));
  const bobKey = await c.decryptRoomKeyForMember(bobWrapped, await c.importPrivateKey(c.b64ToBytes(bob.privateKeyB64)));

  // Parallel encryption -> independent decryption to prove both see the same room key
  const [aEnc, bEnc] = await Promise.all([
    c.encryptMessage(aliceKey, "three of a perfect pair"),
    c.encryptMessage(bobKey, "three of a perfect pair"),
  ]);
  assert.notEqual(aEnc.iv, bEnc.iv);
  assert.notEqual(aEnc.ct, bEnc.ct);

  const aDec = await c.decryptMessage(aliceKey, bEnc.iv, bEnc.ct);
  const bDec = await c.decryptMessage(bobKey, aEnc.iv, aEnc.ct);
  assert.equal(aDec, "three of a perfect pair");
  assert.equal(bDec, "three of a perfect pair");

  // Tampered ciphertext must fail to decrypt
  const tampered = c.b64ToBytes(aEnc.ct);
  tampered[0] ^= 0xff;
  await assert.rejects(() =>
    c.decryptMessage(bobKey, aEnc.iv, c.bytesToB64(tampered))
  );

  console.log("crypto module: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});