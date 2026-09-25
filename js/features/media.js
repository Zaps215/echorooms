// Media Service (slice 05): file handling, E2EE upload, and download helpers.
//
// Files are encrypted client-side under the room key (AES-GCM-256) before they
// touch Supabase Storage, so the server only ever stores ciphertext. Metadata
// (original name, MIME, byte size, and the AES-GCM IV) travels in the
// `attachments` row; members decrypt with the same room key their messages use.

import { supabase } from "../core/supabase.js";
import * as crypto from "../core/crypto.js";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

// Image types get inline rendered previews; the rest render as file chips.
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

// Audio (voice notes) and documents render as file chips.
const AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
]);

const DOC_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/html",
  "application/json",
  "application/javascript",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip",
]);

export function isImageFile(file) {
  return IMAGE_TYPES.has(file.type);
}

export function isAllowedFile(file) {
  return IMAGE_TYPES.has(file.type) || AUDIO_TYPES.has(file.type) || DOC_TYPES.has(file.type);
}

export function isImageMime(mimeType) {
  return IMAGE_TYPES.has(mimeType);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/** Picks a compact document icon glyph for non-image attachments. */
export function documentIcon(mimeType) {
  if (mimeType.startsWith("audio/")) return "AUD";
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType === "application/zip" || mimeType === "application/x-zip-compressed") return "ZIP";
  if (mimeType.includes("word")) return "DOC";
  if (mimeType.includes("excel") || mimeType === "text/csv") return "XLS";
  if (mimeType.includes("presentation")) return "PPT";
  if (mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "application/javascript") return "TXT";
  return "FILE";
}

/**
 * Encrypts a file under the room key and uploads the ciphertext to `room-files`.
 * Returns the metadata needed for the `attachments` row.
 */
export async function uploadRoomFile(roomId, senderId, file, roomKey) {
  if (!isAllowedFile(file)) {
    const err = new Error("unsupported-file");
    err.code = "unsupported-file";
    throw err;
  }
  if (file.size > MAX_FILE_BYTES) {
    const err = new Error("file-too-large");
    err.code = "file-too-large";
    throw err;
  }

  const storagePath = `${roomId}/${senderId}/${crypto.randomUUID()}.bin`;
  const plaintext = new Uint8Array(await file.arrayBuffer());
  const { iv, ct } = await crypto.encryptBytes(roomKey, plaintext);
  const ciphertext = new Blob([crypto.b64ToBytes(ct)], { type: "application/octet-stream" });

  const { error } = await supabase.storage
    .from("room-files")
    .upload(storagePath, ciphertext, {
      contentType: "application/octet-stream",
      upsert: false,
    });
  if (error) {
    // Mirror storage's error message shape so callers can inspect it.
    const err = new Error(error.message || "Upload failed");
    err.code = error.code || "upload-failed";
    throw err;
  }

  return {
    storage_path: storagePath,
    iv,
    size_bytes: file.size,
  };
}

/** Deletes ciphertext objects for the given storage paths. */
export function deleteRoomFiles(paths) {
  const clean = (paths || []).filter(Boolean);
  if (!clean.length || !supabase) return Promise.resolve();
  return supabase.storage.from("room-files").remove(clean);
}

/**
 * Downloads, decrypts, and returns a Blob for an attachment. The caller passes
 * the room key so no decryption material ever leaves the client module that
 * already owns it.
 */
export async function decryptAttachment(attachment, roomKey) {
  if (!supabase || !attachment) throw new Error("missing-attachment");

  const { data, error } = await supabase.storage
    .from("room-files")
    .createSignedUrl(attachment.storage_path, 300);
  if (error || !data?.signedUrl) throw new Error("no-signed-url");

  const res = await fetch(data.signedUrl);
  if (!res.ok) throw new Error("download-failed");

  const ciphertext = new Uint8Array(await res.arrayBuffer());
  const plaintext = await crypto.decryptBytes(
    roomKey,
    attachment.iv,
    crypto.bytesToB64(ciphertext)
  );
  return new Blob([plaintext], { type: attachment.mime_type || "application/octet-stream" });
}