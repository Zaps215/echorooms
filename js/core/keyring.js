// Keyring: handles the user's identity keypair and per-room AES keys.
//
// Identity (RSA-OAEP) is stored as a public key on the profile and a private
// key that never leaves the client unencrypted. Email/password accounts wrap
// it with a PBKDF2-derived key; social logins rely on a device-bound copy in
// IndexedDB, protected by a per-device AES secret in localStorage. The same
// device copy is what allows a password reset to re-wrap the key.
//
// Room keys are AES-GCM-256. The client downloads only its own wrapped copy
// from room_keys and unwraps it in memory; room keys are cached by room id.

import { supabase } from "./supabase.js";
import { state } from "./state.js";
import * as crypto from "./crypto.js";

const IDB_NAME = "echorooms-keys";
const IDB_STORE = "devices";
const DEVICE_SECRET_KEY = "echorooms.device-key";

let identity = null; // { userId, publicKeyB64, privateKeyB64, keyPair }
let pendingPassword = null;
const roomKeys = new Map(); // roomId -> CryptoKey
const pendingRoomKeyOps = new Map(); // roomId -> Promise<CryptoKey>

export function setPendingPassword(password) {
  pendingPassword = password;
}

// --- IndexedDB -------------------------------------------------------------

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: "userId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(record) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(record);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function idbGet(userId) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(userId);
    req.onsuccess = () => { db.close(); resolve(req.result || null); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

function getDeviceSecret() {
  let secret = localStorage.getItem(DEVICE_SECRET_KEY);
  if (!secret) {
    secret = crypto.bytesToB64(crypto.randomBytes(32));
    localStorage.setItem(DEVICE_SECRET_KEY, secret);
  }
  return secret;
}

async function saveDeviceCopy(userId, publicKeyB64, privateKeyB64) {
  try {
    const protectedB64 = await crypto.encryptWithDeviceSecret(getDeviceSecret(), privateKeyB64);
    await idbPut({ userId, publicKeyB64, protectedB64 });
    return true;
  } catch (error) {
    return false;
  }
}

// --- Identity --------------------------------------------------------------

async function fetchProfile() {
  const user = state.currentUser;
  if (!user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("username, display_name, public_key, key_salt, encrypted_private_key")
    .eq("id", user.id)
    .maybeSingle();
  return error ? null : data;
}

async function persistKeys(profile) {
  const user = state.currentUser;
  if (!user) return;
  await supabase
    .from("profiles")
    .update(profile)
    .eq("id", user.id);
}

function takePendingPassword() {
  const password = pendingPassword;
  pendingPassword = null;
  return password;
}

async function unwrapFromPassword(profile, password) {
  if (!password || !profile.key_salt || !profile.encrypted_private_key) return null;
  try {
    const pkcs8 = await crypto.unwrapPrivateWithPassword(
      profile.key_salt,
      profile.encrypted_private_key,
      password
    );
    return crypto.bytesToB64(pkcs8);
  } catch (error) {
    return null;
  }
}

async function unwrapFromDevice(profile) {
  try {
    const device = await idbGet(state.currentUser.id);
    if (!device || device.publicKeyB64 !== profile.public_key) return null;
    const pkcs8 = await crypto.decryptWithDeviceSecret(getDeviceSecret(), device.protectedB64);
    return crypto.bytesToB64(pkcs8);
  } catch (error) {
    return null;
  }
}

/**
 * Loads (or creates) the current user's identity keypair.
 *
 * Priority: device copy, then password-wrapped DB copy, then fresh generation
 * (only when no usable key exists, e.g. first login after a new deployment).
 */
export async function ensureIdentity() {
  const user = state.currentUser;
  if (!user || !supabase) return null;
  if (identity && identity.userId === user.id) return identity;

  let profile = await fetchProfile();
  if (!profile) return null;

  let privateKeyB64 = null;

  if (profile.public_key && profile.encrypted_private_key) {
    privateKeyB64 = await unwrapFromDevice(profile);
    if (!privateKeyB64) {
      privateKeyB64 = await unwrapFromPassword(profile, takePendingPassword());
    }
    if (privateKeyB64) {
      // Keep a device copy so later password resets on this browser can re-wrap.
      await saveDeviceCopy(user.id, profile.public_key, privateKeyB64);
    }
  }

  if (!privateKeyB64) {
    const fresh = await crypto.generateIdentityKeyPair();
    privateKeyB64 = fresh.privateKeyB64;
    const password = takePendingPassword();
    profile.public_key = fresh.publicKeyB64;

    if (password) {
      const wrapped = await crypto.wrapPrivateWithPassword(privateKeyB64, password);
      profile.key_salt = wrapped.saltB64;
      profile.encrypted_private_key = wrapped.wrappedB64;
    } else {
      profile.encrypted_private_key = await crypto.encryptWithDeviceSecret(getDeviceSecret(), privateKeyB64);
      profile.key_salt = null;
    }

    await persistKeys(profile);
    await saveDeviceCopy(user.id, profile.public_key, privateKeyB64);
  }

  const keyPair = await crypto.importPrivateKey(crypto.b64ToBytes(privateKeyB64));
  identity = {
    userId: user.id,
    publicKeyB64: profile.public_key,
    privateKeyB64,
    keyPair,
  };
  return identity;
}

/** Re-wraps the identity key with a new password (after reset/recovery). */
export async function rekeyIdentity(newPassword) {
  const ident = identity || (await ensureIdentity());
  if (!ident || !newPassword) return;
  const wrapped = await crypto.wrapPrivateWithPassword(ident.privateKeyB64, newPassword);
  await supabase
    .from("profiles")
    .update({ key_salt: wrapped.saltB64, encrypted_private_key: wrapped.wrappedB64 })
    .eq("id", state.currentUser.id);
  await saveDeviceCopy(state.currentUser.id, ident.publicKeyB64, ident.privateKeyB64);
}

export function getIdentity() {
  return identity;
}

export function resetKeyring() {
  identity = null;
  pendingPassword = null;
  roomKeys.clear();
  pendingRoomKeyOps.clear();
}

// --- Room keys -------------------------------------------------------------

async function loadRoomKey(roomId) {
  if (!identity || !supabase) return null;
  const { data, error } = await supabase
    .from("room_keys")
    .select("wrapped_key")
    .eq("room_id", roomId)
    .eq("user_id", identity.userId)
    .maybeSingle();
  if (error || !data || !data.wrapped_key) return null;
  const roomKey = await crypto.decryptRoomKeyForMember(data.wrapped_key, identity.keyPair);
  roomKeys.set(roomId, roomKey);
  return roomKey;
}

export function getRoomKey(roomId) {
  if (roomKeys.has(roomId)) return Promise.resolve(roomKeys.get(roomId));
  if (pendingRoomKeyOps.has(roomId)) return pendingRoomKeyOps.get(roomId);
  const op = loadRoomKey(roomId);
  pendingRoomKeyOps.set(roomId, op);
  return op.finally(() => pendingRoomKeyOps.delete(roomId));
}

/** Ensures the current user has a usable room key, creating one for admins. */
export async function ensureRoomKey(roomId) {
  let roomKey = await getRoomKey(roomId);
  if (roomKey) return roomKey;
  if (!identity) return null;
  if (!(await canManageRoom(roomId))) return null;

  roomKey = await crypto.generateRoomKey();
  roomKeys.set(roomId, roomKey);
  const wrapped = await crypto.encryptRoomKeyForMember(roomKey, identity.publicKeyB64);
  const { error } = await supabase
    .from("room_keys")
    .insert({ room_id: roomId, user_id: identity.userId, wrapped_key: wrapped });
  return error ? null : roomKey;
}

/** Wraps the room key for a member and stores their copy. */
export async function shareRoomKey(roomId, targetUserId, targetPublicKey) {
  const roomKey = await getRoomKey(roomId);
  if (!roomKey || !targetPublicKey) return false;
  const wrapped = await crypto.encryptRoomKeyForMember(roomKey, targetPublicKey);
  const { error } = await supabase
    .from("room_keys")
    .insert({ room_id: roomId, user_id: targetUserId, wrapped_key: wrapped });
  return !error;
}

/** Generates a room key and stores wrapped copies for the given members. */
export async function createRoomKey(roomId, members) {
  const roomKey = await crypto.generateRoomKey();
  roomKeys.set(roomId, roomKey);
  let shared = 0;
  for (const member of members || []) {
    if (!member.public_key) continue;
    const wrapped = await crypto.encryptRoomKeyForMember(roomKey, member.public_key);
    const { error } = await supabase
      .from("room_keys")
      .insert({ room_id: roomId, user_id: member.id, wrapped_key: wrapped });
    if (!error) shared += 1;
  }
  return shared;
}

/** True if the current user manages the room (owner/admin). */
export async function canManageRoom(roomId) {
  if (!supabase || !state.currentUser) return false;
  const { data, error } = await supabase
    .rpc("is_room_admin", { target_room_id: roomId });
  return !error && data === true;
}

/**
 * Distributes the room key to members who lack a copy yet. Runs on admin
 * open so legacy members get a key as soon as they have a public identity.
 */
export async function shareMissingKeys(roomId) {
  const roomKey = await getRoomKey(roomId);
  if (!roomKey || !identity || !supabase) return;

  const [members, existing] = await Promise.all([
    supabase
      .from("room_members")
      .select("user_id, profiles(public_key)")
      .eq("room_id", roomId),
    supabase
      .from("room_keys")
      .select("user_id")
      .eq("room_id", roomId),
  ]);

  const existingIds = new Set((existing.data || []).map((k) => k.user_id));
  for (const m of members.data || []) {
    const pub = m.profiles && m.profiles.public_key;
    if (!pub || existingIds.has(m.user_id)) continue;
    const wrapped = await crypto.encryptRoomKeyForMember(roomKey, pub);
    await supabase
      .from("room_keys")
      .insert({ room_id: roomId, user_id: m.user_id, wrapped_key: wrapped });
  }
}