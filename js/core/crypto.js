// E2EE crypto primitives built on Web Crypto.
//
// Model:
//   - Identity: an RSA-OAEP-2048/SHA-256 keypair per profile. The public key
//     is stored on the profile; the private key only travels encrypted.
//   - Room key: one AES-GCM-256 key per room. Each member has a copy in
//     room_keys, RSA-wrapped with their public key.
//   - Messages: AES-GCM under the room key; the database only ever sees iv +
//     ciphertext, so the server cannot read them.
//
// All functions are pure and browser/node compatible (no DOM dependencies).

const enc = new TextEncoder();
const dec = new TextDecoder();

export function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** AES-GCM encrypt; returns `iv(12) || ciphertext` packed as base64. */
async function aesGcmPack(key, plaintext) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  const packed = new Uint8Array(iv.byteLength + ct.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ct), iv.byteLength);
  return bytesToB64(packed);
}

/** AES-GCM decrypt of the packed `iv || ciphertext` format. */
async function aesGcmOpen(key, packedB64) {
  const packed = b64ToBytes(packedB64);
  const iv = packed.slice(0, 12);
  const ct = packed.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new Uint8Array(pt);
}

/** PBKDF2-SHA256 -> AES-GCM-256 wrapping key. */
export async function deriveKek(password, saltB64) {
  const base = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64ToBytes(saltB64), iterations: 200000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Generates a profile identity keypair and returns its exported halves. */
export async function generateIdentityKeyPair() {
  const kp = await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"]
  );
  const pub = await crypto.subtle.exportKey("spki", kp.publicKey);
  const priv = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
  return {
    keyPair: kp,
    publicKeyB64: bytesToB64(new Uint8Array(pub)),
    privateKeyB64: bytesToB64(new Uint8Array(priv)),
  };
}

/** Wraps a PKCS8 private key with a password-derived key. */
export async function wrapPrivateWithPassword(privateKeyB64, password) {
  const salt = randomBytes(16);
  const kek = await deriveKek(password, bytesToB64(salt));
  const wrapped = await aesGcmPack(kek, b64ToBytes(privateKeyB64));
  return { saltB64: bytesToB64(salt), wrappedB64: wrapped };
}

/** Recovers a PKCS8 private key (as bytes) using its password. */
export async function unwrapPrivateWithPassword(saltB64, wrappedB64, password) {
  const kek = await deriveKek(password, saltB64);
  return aesGcmOpen(kek, wrappedB64);
}

/** Imports 32 raw bytes as an AES-GCM-256 key. */
export async function importAesKey(rawKeyBytes) {
  return crypto.subtle.importKey("raw", rawKeyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Protects a PKCS8 blob with a device-held AES secret (base64). */
export async function encryptWithDeviceSecret(deviceKeyB64, privateKeyB64) {
  const key = await importAesKey(b64ToBytes(deviceKeyB64));
  return aesGcmPack(key, b64ToBytes(privateKeyB64));
}

/** Recovers a PKCS8 blob protected by a device-held AES secret. */
export async function decryptWithDeviceSecret(deviceKeyB64, protectedB64) {
  const key = await importAesKey(b64ToBytes(deviceKeyB64));
  return aesGcmOpen(key, protectedB64);
}

/** Generates a room AES-GCM-256 key. */
export async function generateRoomKey() {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function importPrivateKey(pkcs8Bytes) {
  return crypto.subtle.importKey(
    "pkcs8",
    pkcs8Bytes,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"]
  );
}

export async function importPublicKey(spkiBytes) {
  return crypto.subtle.importKey(
    "spki",
    spkiBytes,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
}

/** Wraps a room key so `memberPublicKeyB64`'s owner can unwrap it. */
export async function encryptRoomKeyForMember(roomKey, memberPublicKeyB64) {
  const pub = await importPublicKey(b64ToBytes(memberPublicKeyB64));
  const raw = await crypto.subtle.exportKey("raw", roomKey);
  const ct = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, pub, raw);
  return bytesToB64(new Uint8Array(ct));
}

/** Unwraps a room key with this client's private key. */
export async function decryptRoomKeyForMember(wrappedB64, privateKey) {
  const raw = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, b64ToBytes(wrappedB64));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

/** Encrypts a message body with the room key. */
export async function encryptMessage(roomKey, text) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    roomKey,
    enc.encode(text)
  );
  return { iv: bytesToB64(iv), ct: bytesToB64(new Uint8Array(ct)) };
}

/** Decrypts a message body with the room key. */
export async function decryptMessage(roomKey, ivB64, ctB64) {
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64ToBytes(ivB64) },
    roomKey,
    b64ToBytes(ctB64)
  );
  return dec.decode(pt);
}