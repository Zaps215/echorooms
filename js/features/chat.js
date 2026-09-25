// Messaging feature: history, realtime delivery, and the composer.
//
// This module owns the conversation pane. It loads a bounded page of history,
// subscribes to Postgres changes for the active room, and renders the message
// stream grouped by day. Room selection is delegated here from rooms.js so all
// conversation state lives in one place.

import * as dom from "../core/dom.js";
import { state } from "../core/state.js";
import { supabase } from "../core/supabase.js";
import { escapeHtml } from "../core/utils.js";
import { closeInfo, openSidebar, showHome } from "../core/navigation.js";
import { showConfirm } from "../core/confirm.js";
import { getRoomKey, ensureRoomKey, canManageRoom, shareMissingKeys } from "../core/keyring.js";
import * as crypto from "../core/crypto.js";
import {
  isAllowedFile,
  isImageFile,
  isImageMime,
  formatBytes,
  documentIcon,
  uploadRoomFile,
  deleteRoomFiles,
  decryptAttachment,
  MAX_FILE_BYTES,
} from "./media.js";

const PAGE_SIZE = 30;

const MESSAGE_COLUMNS =
  "id, room_id, sender_id, body, iv, ciphertext, reply_to_id, edited_at, deleted_at, created_at, profiles(display_name, username)";

const ATTACHMENT_COLUMNS =
  "id, room_id, message_id, sender_id, name, mime_type, size_bytes, storage_path, iv, created_at";

// Emoji palette used by the reaction picker.
export const REACTION_EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👏", "🙏", "💯"];

// Window events the rooms feature listens to so the info panel stays in sync.
export const EVENTS = {
  pins: "echorooms:pins",
  presence: "echorooms:presence",
};

// Per-room cache of userId -> profile, used to label realtime messages.
const memberCache = new Map();

let channel = null;
let editingId = null;
let activeRoomKey = null;
let isAdminRoom = false;

// Optional per-room "disappearing messages" window (ms). When set, messages
// older than this render as deleted and the server row is expired in the
// background so the ciphertext is removed for everyone.
let disappearAfterMs = 0;
let disappearTimer = 0;

// Ids of messages we just sent; realtime echoes for these are ignored because
// the insert response already rendered them.
const recentSends = new Set();

// --- Media (attachment) state ----------------------------------------------

// messageId -> array of attachment rows for messages in the current window.
let attachmentCache = new Map();
// attachmentId -> decrypted object URL, kept across re-renders so we decrypt
// each file once and just swap the URL back in.
const remoteUrlCache = new Map();
// Files the user has picked in the composer but not sent yet.
let pendingMedia = [];

// --- Reaction Service state ------------------------------------------------

// messageId -> [{ emoji, user_id }]
let reactionCache = new Map();
// [{ message_id, text, sender, created_at }] in most-recent-first order.
let pinsCache = [];
// The message currently being replied to, or null.
let replyTarget = null;
// userId -> whatever the presence sync gave us for that user.
const presenceMap = new Map();
// userIds that are reportedly typing right now.
const typingUsers = new Set();
const typingTimers = new Map();
let pickerOpenId = null;

const LOCKED_TEXT = "Message is encrypted and can't be decrypted on this device.";
const NO_KEY_TEXT = "Waiting for the room owner to share the encryption key.";

// --- Data access -----------------------------------------------------------

function normalize(row) {
  return {
    id: row.id,
    room_id: row.room_id,
    sender_id: row.sender_id,
    body: row.body,
    iv: row.iv,
    ciphertext: row.ciphertext,
    reply_to_id: row.reply_to_id,
    edited_at: row.edited_at,
    deleted_at: row.deleted_at,
    created_at: row.created_at,
    sender: row.profiles || row.sender || null,
  };
}

/** Decrypts a message's body in place using the active room key. */
async function decryptMessageContent(msg) {
  if (msg.deleted_at) return;
  if (!msg.iv || !msg.ciphertext) return; // legacy plaintext message
  if (!activeRoomKey) {
    msg.body = NO_KEY_TEXT;
    return;
  }
  try {
    msg.body = await crypto.decryptMessage(activeRoomKey, msg.iv, msg.ciphertext);
  } catch (error) {
    msg.body = LOCKED_TEXT;
  }
}

export function setComposerNotice(text) {
  if (!dom.composerNotice) return;
  if (text) {
    dom.composerNotice.textContent = text;
    dom.composerNotice.classList.remove("is-hidden");
  } else {
    dom.composerNotice.classList.add("is-hidden");
    dom.composerNotice.textContent = "";
  }
}

// --- Disappearing messages --------------------------------------------------

function resetRoomDisappear() {
  clearInterval(disappearTimer);
  disappearTimer = 0;
  disappearAfterMs = 0;
}

async function runRoomExpire() {
  const roomId = state.currentRoomId;
  if (!roomId || !disappearAfterMs || !supabase) return;
  try {
    await supabase.rpc("expire_room_messages", { target_room_id: roomId });
  } catch (err) {
    // Best-effort: the visual filter below still hides expired messages even
    // if the background cleanup call fails.
  }
  renderMessages();
}

/** Enables/disables disappearing messages for the active room (seconds). */
export function setRoomDisappear(seconds) {
  resetRoomDisappear();
  disappearAfterMs = Number(seconds) > 0 ? Number(seconds) * 1000 : 0;
  if (!disappearAfterMs) {
    renderMessages();
    return;
  }
  runRoomExpire();
  disappearTimer = setInterval(runRoomExpire, 60000);
}

// --- Local "clear chat for me" ----------------------------------------------

function localClearCut(roomId) {
  try {
    return Number(localStorage.getItem(`echorooms:cleared:${roomId}`)) || 0;
  } catch (err) {
    return 0;
  }
}

function isClearedOut(roomId, createdAt) {
  const cut = localClearCut(roomId);
  return cut > 0 && new Date(createdAt).getTime() < cut;
}

/** Hides this room's messages on this device only (persisted per room). */
export function clearLocalMessages(roomId) {
  try {
    localStorage.setItem(`echorooms:cleared:${roomId}`, String(Date.now()));
  } catch (err) {
    /* private mode: fall back to session-only below */
  }
  const cut = localClearCut(roomId);
  state.currentRoomId = roomId;
  state.messages = state.messages.filter((m) => new Date(m.created_at).getTime() >= cut);
  renderMessages();
}

async function listMessages(roomId, before) {
  if (!supabase) return [];

  let query = supabase
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (before) query = query.lt("created_at", before);

  const { data, error } = await query;
  if (error || !data) return [];

  const cache = memberCache.get(roomId);
  const messages = data.map((row) => {
    const msg = normalize(row);
    if (cache && msg.sender) cache.set(msg.sender_id, msg.sender);
    return msg;
  });
  return messages.reverse();
}

async function loadMembers(roomId) {
  if (!supabase) return;
  const { data } = await supabase
    .from("room_members")
    .select("user_id, profiles(display_name, username)")
    .eq("room_id", roomId);

  const map = new Map();
  (data || []).forEach((m) => map.set(m.user_id, m.profiles || {}));
  memberCache.set(roomId, map);
}

// --- Attachments -----------------------------------------------------------

async function loadAttachments(roomId, messages) {
  if (!supabase) return;
  const ids = (messages || []).map((m) => m.id).filter(Boolean);
  if (!ids.length) return;

  const { data, error } = await supabase
    .from("attachments")
    .select(ATTACHMENT_COLUMNS)
    .eq("room_id", roomId)
    .in("message_id", ids);
  if (error || !data) return;

  // Merge so paginated loads never drop attachments from earlier pages.
  const merged = new Map(attachmentCache);
  for (const att of data) {
    const list = merged.get(att.message_id) || [];
    if (!list.some((a) => a.id === att.id)) list.push(att);
    merged.set(att.message_id, list);
  }
  attachmentCache = merged;
}

function currentAttachmentById(id) {
  for (const list of attachmentCache.values()) {
    const found = list.find((a) => a.id === id);
    if (found) return found;
  }
  return null;
}

function revokeRemoteUrls() {
  remoteUrlCache.forEach((url) => URL.revokeObjectURL(url));
  remoteUrlCache.clear();
}

function onAttachmentInsert(row) {
  if (state.currentRoomId !== row.room_id) return;
  const list = attachmentCache.get(row.message_id) || [];
  if (!list.some((a) => a.id === row.id)) list.push(row);
  attachmentCache.set(row.message_id, list);
  renderMessages();
}

function onAttachmentDelete(row) {
  if (state.currentRoomId !== row.room_id) return;
  const next = (attachmentCache.get(row.message_id) || []).filter((a) => a.id !== row.id);
  if (next.length) attachmentCache.set(row.message_id, next);
  else attachmentCache.delete(row.message_id);
  const url = remoteUrlCache.get(row.id);
  if (url) {
    URL.revokeObjectURL(url);
    remoteUrlCache.delete(row.id);
  }
  renderMessages();
}

async function sendMessage(roomId, body) {
  let key = activeRoomKey;
  if (!key) {
    key = await ensureRoomKey(roomId);
    activeRoomKey = key;
    if (!key) {
      setComposerNotice(
        (await canManageRoom(roomId))
          ? "Your encryption key couldn't be created. Try again."
          : NO_KEY_TEXT
      );
      return;
    }
  }

  const encrypted = await crypto.encryptMessage(key, body);
  const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const pending = {
    id: pendingId,
    room_id: roomId,
    sender_id: state.currentUser?.id,
    body,
    iv: null,
    ciphertext: null,
    reply_to_id: replyTarget ? replyTarget.id : null,
    edited_at: null,
    deleted_at: null,
    created_at: new Date().toISOString(),
    sender: memberCache.get(roomId)?.get(state.currentUser?.id) || null,
    status: "sending",
  };

  state.messages.push(pending);
  renderMessages({ stickToBottom: true });

  if (key) {
    const { data, error } = await supabase
      .from("messages")
      .insert({
        room_id: roomId,
        sender_id: state.currentUser.id,
        iv: encrypted.iv,
        ciphertext: encrypted.ct,
        reply_to_id: pending.reply_to_id,
      })
      .select(MESSAGE_COLUMNS)
      .single();

    if (error || !data) {
      const target = state.messages.find((m) => m.id === pendingId);
      if (target) target.status = "failed";
      renderMessages({ stickToBottom: true });
      return;
    }

    clearReply();
    const index = state.messages.findIndex((m) => m.id === pendingId);
    const row = normalize(data);
    row.body = body; // keep the plaintext we just computed
    recentSends.add(row.id);
    if (index !== -1) state.messages.splice(index, 1, row);
    renderMessages({ stickToBottom: true });
  }
}

// --- Media send flow -------------------------------------------------------

function makePendingMediaMessage(roomId, file, caption) {
  return {
    id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    room_id: roomId,
    sender_id: state.currentUser?.id,
    body: caption,
    iv: null,
    ciphertext: null,
    reply_to_id: replyTarget ? replyTarget.id : null,
    edited_at: null,
    deleted_at: null,
    created_at: new Date().toISOString(),
    sender: memberCache.get(roomId)?.get(state.currentUser?.id) || null,
    status: "sending",
    media: [{ file }],
  };
}

function markMediaFailed(pending) {
  const target = state.messages.find((m) => m.id === pending.id);
  if (target) {
    target.status = "failed";
    target.media = pending.media;
  }
  renderMessages({ stickToBottom: true });
}

/**
 * Sends an attachment message: message row (optionally with the encrypted
 * caption), E2EE file upload, then the attachments row. One message per file.
 */
async function sendMediaMessages(roomId, caption) {
  let key = activeRoomKey;
  if (!key) {
    key = await ensureRoomKey(roomId);
    activeRoomKey = key;
    if (!key) {
      setComposerNotice(
        (await canManageRoom(roomId))
          ? "Your encryption key couldn't be created. Try again."
          : NO_KEY_TEXT
      );
      return;
    }
  }

  const files = pendingMedia.map((item) => item.file);
  if (!files.length) return;

  const pendingRows = files.map((file, i) =>
    makePendingMediaMessage(roomId, file, i === 0 ? caption : null)
  );

  // Release the composer's local preview URLs; the pending messages keep the
  // File references so retries and local previews keep working.
  pendingMedia.forEach((item) => {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  });
  pendingMedia = [];
  renderAttachPreview();

  pendingRows.forEach((p) => state.messages.push(p));
  renderMessages({ stickToBottom: true });
  renderAttachProgress(
    `Uploading ${pendingRows.length} file${pendingRows.length > 1 ? "s" : ""}…`
  );

  for (let i = 0; i < files.length; i += 1) {
    const pending = pendingRows[i];
    const file = files[i];

    if (state.currentRoomId !== roomId) return;

    try {
      let encryptedCaption = null;
      if (pending.body) {
        encryptedCaption = await crypto.encryptMessage(key, pending.body);
      }

      const { data, error } = await supabase
        .from("messages")
        .insert({
          room_id: roomId,
          sender_id: state.currentUser.id,
          iv: encryptedCaption?.iv || null,
          ciphertext: encryptedCaption?.ct || null,
          body: null,
          reply_to_id: pending.reply_to_id,
        })
        .select(MESSAGE_COLUMNS)
        .single();

      if (error || !data) {
        markMediaFailed(pending);
        continue;
      }

      const meta = await uploadRoomFile(roomId, state.currentUser.id, file, key);

      const { data: attRow, error: attError } = await supabase
        .from("attachments")
        .insert({
          room_id: roomId,
          message_id: data.id,
          sender_id: state.currentUser.id,
          name: file.name || "file",
          mime_type: file.type || "application/octet-stream",
          size_bytes: meta.size_bytes,
          storage_path: meta.storage_path,
          iv: meta.iv,
        })
        .select("id")
        .single();

      if (attError || !attRow) {
        await deleteRoomFiles([meta.storage_path]);
        markMediaFailed(pending);
        continue;
      }

      const row = normalize(data);
      row.body = pending.body || null; // plaintext caption we just encrypted
      recentSends.add(row.id);
      const index = state.messages.findIndex((m) => m.id === pending.id);
      if (index !== -1) {
        state.messages.splice(index, 1, row);
        const list = attachmentCache.get(row.id) || [];
        list.push({
          id: attRow.id,
          room_id: roomId,
          message_id: row.id,
          sender_id: state.currentUser.id,
          name: file.name || "file",
          mime_type: file.type || "application/octet-stream",
          size_bytes: meta.size_bytes,
          storage_path: meta.storage_path,
          iv: meta.iv,
        });
        attachmentCache.set(row.id, list);
      }
      renderMessages({ stickToBottom: true });
    } catch (err) {
      markMediaFailed(pending);
    }
  }

  renderAttachProgress("");
  setComposerNotice("");
}

// --- Composer attachment preview -------------------------------------------

function renderAttachPreview() {
  if (!dom.attachPreviewList) return;
  if (!pendingMedia.length) {
    dom.attachPreview?.classList.add("is-hidden");
    dom.attachPreviewList.innerHTML = "";
    return;
  }
  dom.attachPreview.classList.remove("is-hidden");
  dom.attachPreviewList.innerHTML = pendingMedia
    .map((item, i) => {
      const file = item.file;
      const icon = isImageFile(file)
        ? `<img class="attach-chip-img" data-chip-img="${i}" alt="">`
        : `<span class="attach-chip-icon">${documentIcon(file.type)}</span>`;
      return `
        <li class="attach-chip">
          ${icon}
          <span class="attach-chip-main">
            <span class="attach-chip-name">${escapeHtml(file.name)}</span>
            <span class="attach-chip-meta">${formatBytes(file.size)}</span>
          </span>
          <button type="button" class="attach-chip-remove" data-remove-attach="${i}" aria-label="Remove file" title="Remove">✕</button>
        </li>`;
    })
    .join("");

  document.querySelectorAll("[data-chip-img]").forEach((img) => {
    const item = pendingMedia[Number(img.dataset.chipImg)];
    if (item?.previewUrl) img.src = item.previewUrl;
  });
}

function renderAttachProgress(text) {
  if (!dom.attachProgress) return;
  if (text) {
    dom.attachProgress.textContent = text;
    dom.attachProgress.classList.remove("is-hidden");
  } else {
    dom.attachProgress.classList.add("is-hidden");
    dom.attachProgress.textContent = "";
  }
}

function addPendingFiles(files) {
  let added = 0;
  for (const file of files || []) {
    if (!isAllowedFile(file)) {
      setComposerNotice(`"${file.name}" isn't a supported file type.`);
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      setComposerNotice(`"${file.name}" is larger than ${formatBytes(MAX_FILE_BYTES)}.`);
      continue;
    }
    pendingMedia.push({ file, previewUrl: URL.createObjectURL(file) });
    added += 1;
  }
  if (added) setComposerNotice("");
  renderAttachPreview();
}

function removePendingFile(index) {
  const item = pendingMedia[index];
  if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
  pendingMedia.splice(index, 1);
  renderAttachPreview();
}

function clearPendingMedia() {
  pendingMedia.forEach((item) => {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  });
  pendingMedia = [];
  renderAttachPreview();
  renderAttachProgress("");
}

async function downloadAttachment(att) {
  if (!att) return;
  try {
    const blob = await decryptAttachment(att, activeRoomKey);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = att.name || "download";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (error) {
    setComposerNotice("Couldn't download that file. Try again.");
  }
}

// --- Camera capture --------------------------------------------------------

let cameraStream = null;

async function startCameraCapture() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setComposerNotice("Camera isn't supported by this browser.");
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (err) {
    setComposerNotice(
      err?.name === "NotAllowedError"
        ? "Camera permission was denied. Allow it in your browser settings."
        : "Couldn't start the camera. Try again."
    );
    return;
  }
  dom.cameraOverlay?.classList.remove("is-hidden");
  if (dom.cameraPreview) {
    dom.cameraPreview.srcObject = cameraStream;
    dom.cameraPreview.play().catch(() => {});
  }
  if (dom.cameraHint) dom.cameraHint.textContent = "";
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  if (dom.cameraPreview) dom.cameraPreview.srcObject = null;
  dom.cameraOverlay?.classList.add("is-hidden");
}

async function capturePhoto() {
  const video = dom.cameraPreview;
  if (!video || !video.videoWidth) return;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  stopCamera();
  if (!blob) return;
  const stamp = new Date().toLocaleTimeString().replace(/[:]/g, "").replace(/\s/g, "");
  addPendingFiles([new File([blob], `Photo ${stamp}.jpg`, { type: "image/jpeg" })]);
}

// --- Voice message recording ------------------------------------------------

let mediaRecorder = null;
let mediaChunks = [];
let voiceStream = null;
let voiceTimerId = 0;
let voiceStart = 0;

function formatVoiceTime(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function updateVoiceTimer() {
  if (dom.voiceTimer) dom.voiceTimer.textContent = formatVoiceTime(Date.now() - voiceStart);
}

async function startVoiceRecording() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    setComposerNotice("Voice messages aren't supported by this browser.");
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    setComposerNotice(
      err?.name === "NotAllowedError"
        ? "Microphone permission was denied. Allow it in your browser settings."
        : "Couldn't access the microphone. Try again."
    );
    return;
  }

  mediaChunks = [];
  voiceStream = stream;
  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size) mediaChunks.push(e.data);
  };
  mediaRecorder.onstop = () => {
    voiceStream?.getTracks().forEach((t) => t.stop());
    voiceStream = null;
    const mime = (mediaRecorder?.mimeType || "audio/webm").split(";")[0].trim();
    const blob = new Blob(mediaChunks, { type: mime });
    mediaRecorder = null;
    mediaChunks = [];
    stopVoiceUi();
    if (blob.size) {
      const ext = mime.includes("mp4") ? "m4a" : mime.includes("mpeg") ? "mp3" : "webm";
      const stamp = new Date().toLocaleTimeString().replace(/[:]/g, "").replace(/\s/g, "");
      addPendingFiles([new File([blob], `Voice ${stamp}.${ext}`, { type: mime })]);
    }
  };

  mediaRecorder.start();
  voiceStart = Date.now();
  updateVoiceTimer();
  voiceTimerId = setInterval(updateVoiceTimer, 1000);
  dom.voiceBar?.classList.remove("is-hidden");
  dom.btnMic?.classList.add("recording");
}

function stopVoiceRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
}

function stopVoiceUi() {
  clearInterval(voiceTimerId);
  voiceTimerId = 0;
  dom.voiceBar?.classList.add("is-hidden");
  dom.btnMic?.classList.remove("recording");
}

// Voice messages are discarded entirely (nothing recorded at all).
function cancelVoiceRecording() {
  if (!mediaRecorder) return;
  mediaRecorder.onstop = () => {
    voiceStream?.getTracks().forEach((t) => t.stop());
    voiceStream = null;
    mediaRecorder = null;
    mediaChunks = [];
    stopVoiceUi();
  };
  try {
    mediaRecorder.ondataavailable = () => {};
    mediaRecorder.stop();
  } catch (err) {
    stopVoiceUi();
  }
}

async function editMessage(messageId, body) {
  if (!activeRoomKey) {
    return { error: { message: "no key" } };
  }
  const encrypted = await crypto.encryptMessage(activeRoomKey, body);
  return supabase
    .from("messages")
    .update({ body: null, iv: encrypted.iv, ciphertext: encrypted.ct, edited_at: new Date().toISOString() })
    .eq("id", messageId);
}

async function deleteMessage(messageId) {
  return supabase
    .from("messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", messageId);
}

// --- Realtime --------------------------------------------------------------

function subscribeToRoom(roomId) {
  if (!supabase) return;
  unsubscribe();

  channel = supabase
    .channel(`messages:${roomId}`, {
      config: { presence: { key: state.currentUser?.id || `guest-${roomId}` } },
    })
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` },
      (payload) => handleInsert(payload.new)
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` },
      (payload) => handleUpdate(payload.new)
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "messages", filter: `room_id=eq.${roomId}` },
      (payload) => handleDelete(payload.old)
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "message_reactions", filter: `room_id=eq.${roomId}` },
      (payload) => onReactionInsert(payload.new)
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "message_reactions", filter: `room_id=eq.${roomId}` },
      (payload) => onReactionDelete(payload.old)
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "attachments", filter: `room_id=eq.${roomId}` },
      (payload) => onAttachmentInsert(payload.new)
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "attachments", filter: `room_id=eq.${roomId}` },
      (payload) => onAttachmentDelete(payload.old)
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "pins", filter: `room_id=eq.${roomId}` },
      () => onPinsChanged()
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "pins", filter: `room_id=eq.${roomId}` },
      () => onPinsChanged()
    )
    .on("broadcast", { event: "typing" }, (e) => handleTypingEvent(e.payload))
    .on("presence", { event: "sync" }, () => {
      presenceMap.clear();
      const presence = channel.presenceState();
      Object.values(presence).forEach((entries) => {
        for (const entry of entries) {
          if (entry.user_id) presenceMap.set(entry.user_id, entry);
        }
      });
      window.dispatchEvent(new CustomEvent(EVENTS.presence));
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        const me = memberCache.get(roomId)?.get(state.currentUser?.id) || {};
        channel.track({
          user_id: state.currentUser?.id,
          name: me.username ? `@${me.username}` : me.display_name || "Member",
        });
      }
    });
}

function unsubscribe() {
  if (channel && supabase) supabase.removeChannel(channel);
  channel = null;
}

async function handleInsert(row) {
  if (state.currentRoomId !== row.room_id) return;
  if (recentSends.has(row.id)) {
    recentSends.delete(row.id);
    return;
  }

  const msg = normalize(row);
  await decryptMessageContent(msg);
  const pendingIndex = state.messages.findIndex(
    (m) => m.status === "sending" && m.sender_id === row.sender_id && !m.ciphertext
  );

  if (pendingIndex !== -1) {
    msg.body = msg.body || state.messages[pendingIndex].body;
    state.messages.splice(pendingIndex, 1, msg);
  } else {
    state.messages.push(msg);
  }

  ensureSenderName(msg, row.room_id);
  renderMessages({ stickToBottom: true });
}

async function handleUpdate(row) {
  const index = state.messages.findIndex((m) => m.id === row.id);
  if (index === -1) return;
  const plain = state.messages[index].body;
  const updated = normalize(row);
  if (updated.iv && updated.ciphertext) {
    await decryptMessageContent(updated);
    if (updated.body === NO_KEY_TEXT && plain) updated.body = plain;
  }
  state.messages[index] = updated;
  renderMessages();
}

function handleDelete(row) {
  const before = state.messages.length;
  state.messages = state.messages.filter((m) => m.id !== row.id);
  if (state.messages.length !== before) renderMessages();
}

// --- Reactions -------------------------------------------------------------

function setCachedReactions(messageId, reactions) {
  const cleaned = (reactions || []).filter((r) => r && r.emoji && r.user_id);
  reactionCache.set(messageId, cleaned);
}

function onReactionInsert(row) {
  if (state.currentRoomId !== row.room_id) return;
  const list = reactionCache.get(row.message_id) || [];
  if (list.some((r) => r.user_id === row.user_id && r.emoji === row.emoji)) return;
  list.push({ emoji: row.emoji, user_id: row.user_id });
  reactionCache.set(row.message_id, list);
  renderMessages();
}

function onReactionDelete(row) {
  if (state.currentRoomId !== row.room_id) return;
  const list = reactionCache.get(row.message_id);
  if (!list) return;
  setCachedReactions(
    row.message_id,
    list.filter((r) => !(r.user_id === row.user_id && r.emoji === row.emoji))
  );
  renderMessages();
}

/** Loads reactions for the given messages into the reaction cache. */
async function loadReactions(roomId, messages) {
  const ids = messages
    .filter((m) => m.id && m.status !== "sending" && m.status !== "failed")
    .map((m) => m.id);
  if (!ids.length) return;
  const { data, error } = await supabase
    .from("message_reactions")
    .select("message_id, emoji, user_id")
    .in("message_id", ids);
  if (error || !data) return;
  data.forEach((r) => {
    const list = reactionCache.get(r.message_id) || [];
    list.push({ emoji: r.emoji, user_id: r.user_id });
    reactionCache.set(r.message_id, list);
  });
}

/**
 * Toggles the current user's reaction on a message. The cache is updated
 * optimistically; realtime echoes are ignored because they now match the cache.
 */
async function toggleReaction(messageId, emoji) {
  const userId = state.currentUser?.id;
  const roomId = state.currentRoomId;
  if (!userId || !messageId || !emoji || !roomId) return;

  const list = reactionCache.get(messageId) || [];
  const exists = list.some((r) => r.user_id === userId && r.emoji === emoji);

  if (exists) {
    setCachedReactions(
      messageId,
      list.filter((r) => !(r.user_id === userId && r.emoji === emoji))
    );
    renderMessages();
    await supabase
      .from("message_reactions")
      .delete()
      .eq("message_id", messageId)
      .eq("user_id", userId)
      .eq("emoji", emoji);
  } else {
    setCachedReactions(messageId, [...list, { emoji, user_id: userId }]);
    renderMessages();
    await supabase
      .from("message_reactions")
      .insert({ message_id: messageId, room_id: roomId, user_id: userId, emoji });
  }
}

// --- Pins ------------------------------------------------------------------

async function onPinsChanged() {
  await loadPins(state.currentRoomId);
  renderMessages();
}

async function loadPins(roomId) {
  if (!supabase || !roomId) return;
  const { data, error } = await supabase
    .from("pins")
    .select("message_id, created_at, messages(id, room_id, sender_id, body, iv, ciphertext, created_at, profiles(display_name, username))")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false });
  pinsCache = [];
  if (error || !data) {
    window.dispatchEvent(new CustomEvent(EVENTS.pins));
    return;
  }
  for (const pin of data) {
    const m = pin.messages;
    if (!m) continue;
    const msg = normalize(m);
    await decryptMessageContent(msg);
    pinsCache.push({
      message_id: m.id,
      text: msg.body || "",
      sender: m.profiles || {},
      created_at: pin.created_at,
    });
  }
  window.dispatchEvent(new CustomEvent(EVENTS.pins));
}

export function getPins() {
  return pinsCache;
}

async function pinMessage(roomId, messageId) {
  if (!supabase || !state.currentUser) return;
  await supabase
    .from("pins")
    .insert({ room_id: roomId, message_id: messageId, pinned_by: state.currentUser.id });
  await onPinsChanged();
}

export async function unpinMessage(roomId, messageId) {
  if (!supabase) return;
  await supabase
    .from("pins")
    .delete()
    .eq("room_id", roomId)
    .eq("message_id", messageId);
  await onPinsChanged();
}

// --- Replies ---------------------------------------------------------------

function startReply(message) {
  replyTarget = {
    id: message.id,
    sender: senderName(message),
    text: message.body || "",
  };
  renderReplyBar();
  dom.composerInput?.focus();
}

function clearReply() {
  replyTarget = null;
  renderReplyBar();
}

function renderReplyBar() {
  if (!dom.replyBar) return;
  if (replyTarget) {
    dom.replyBar.classList.remove("is-hidden");
    if (dom.replySender) dom.replySender.textContent = replyTarget.sender;
    if (dom.replyText) dom.replyText.textContent = replyTarget.text;
  } else {
    dom.replyBar.classList.add("is-hidden");
  }
}

// --- Typing indicators -----------------------------------------------------

function broadcastTyping(isTyping) {
  if (!channel) return;
  channel.send({
    type: "broadcast",
    event: "typing",
    payload: { isTyping, user_id: state.currentUser?.id },
  });
}

function handleTypingEvent(payload) {
  const roomId = state.currentRoomId;
  const userId = payload?.user_id;
  if (!userId || userId === state.currentUser?.id || !roomId) return;

  if (payload.isTyping) {
    typingUsers.add(userId);
    clearTimeout(typingTimers.get(userId));
    typingTimers.set(
      userId,
      setTimeout(() => {
        typingUsers.delete(userId);
        renderTypingIndicator();
      }, 2500)
    );
  } else {
    typingUsers.delete(userId);
    clearTimeout(typingTimers.get(userId));
  }
  renderTypingIndicator();
}

function renderTypingIndicator() {
  if (!dom.typingIndicator) return;
  const names = [...typingUsers]
    .map((id) => {
      const prof = memberCache.get(state.currentRoomId)?.get(id);
      if (!prof) return "";
      return prof.username ? `@${prof.username}` : prof.display_name || "someone";
    })
    .filter(Boolean);

  if (!names.length) {
    dom.typingIndicator.classList.add("is-hidden");
    dom.typingIndicator.textContent = "";
    return;
  }
  dom.typingIndicator.textContent =
    names.length === 1 ? `${names[0]} is typing…` : "Several people are typing…";
  dom.typingIndicator.classList.remove("is-hidden");
}

// --- Presence --------------------------------------------------------------

export function getPresence() {
  return presenceMap;
}

/**
 * Subscribes to presence changes for a room. Returns an unsubscribe function.
 * `handlers.onSync(present: Map<user_id, entry>)` fires on every presence sync.
 */
export function subscribeToPresence(roomId, handlers = {}) {
  const onSync = () => {
    if (state.currentRoomId !== roomId) return;
    handlers.onSync?.(presenceMap);
  };
  window.addEventListener(EVENTS.presence, onSync);
  return () => window.removeEventListener(EVENTS.presence, onSync);
}

async function ensureSenderName(msg, roomId) {
  if (msg.sender && (msg.sender.display_name || msg.sender.username)) return;

  const cached = memberCache.get(roomId)?.get(msg.sender_id);
  if (cached) {
    msg.sender = cached;
    renderMessages();
    return;
  }

  const { data } = await supabase
    .from("profiles")
    .select("display_name, username")
    .eq("id", msg.sender_id)
    .single();

  if (data) {
    msg.sender = data;
    if (!memberCache.has(roomId)) memberCache.set(roomId, new Map());
    memberCache.get(roomId).set(msg.sender_id, data);
    renderMessages();
  }
}

// --- Rendering -------------------------------------------------------------

function senderName(msg) {
  const profile =
    msg.sender || memberCache.get(state.currentRoomId)?.get(msg.sender_id) || {};
  if (profile.username) return `@${profile.username}`;
  return profile.display_name || "Member";
}

/** Highlights @usernames that match known room members. */
function renderBody(text) {
  const escaped = escapeHtml(text || "");
  const members = memberCache.get(state.currentRoomId);
  if (!members) return escaped;
  return escaped.replace(/@([A-Za-z0-9_.]+)/g, (match, handle) => {
    for (const profile of members.values()) {
      if (profile && profile.username === handle) {
        return `<span class="mention">${match}</span>`;
      }
    }
    return match;
  });
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(iso) {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = (a, b) => a.toDateString() === b.toDateString();

  if (sameDay(date, today)) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, yesterday)) return "Yesterday";

  return date.toLocaleDateString([], {
    month: "long",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function messageHtml(msg) {
  const own = msg.sender_id === state.currentUser?.id;
  const deleted = !!msg.deleted_at;

  const text = deleted
    ? '<em class="msg-deleted">This message was deleted</em>'
    : renderBody(msg.body);

  const sender = !own && !deleted
    ? `<span class="sender">${escapeHtml(senderName(msg))}</span>`
    : "";

  let status = "";
  if (own) {
    if (msg.status === "sending") {
      status = '<span class="msg-state sending">sending…</span>';
    } else if (msg.status === "failed") {
      status =
        '<button type="button" class="msg-retry" data-retry>Retry</button>';
    } else if (!deleted) {
      status =
        '<svg class="msg-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    }
  }

  const edited = msg.edited_at && !deleted ? " · edited" : "";

  let replyQuote = "";
  if (msg.reply_to_id) {
    const target = state.messages.find((m) => m.id === msg.reply_to_id);
    const rtText =
      target && !target.deleted_at && target.body ? target.body : "Original message";
    const rtName = target ? senderName(target) : "";
    replyQuote = `
      <div class="bubble-reply">
        <span class="bubble-reply-sender">${rtName ? escapeHtml(rtName) : ""}</span>
        <span class="bubble-reply-text">${renderBody(rtText)}</span>
      </div>`;
  }

  const pinned = pinsCache.some((p) => p.message_id === msg.id);
  const pinItem = pinned
    ? '<span class="bubble-pin" title="Pinned message">📌</span>'
    : "";

  const attachHtml = deleted ? "" : renderAttachmentsBlock(msg);

  return `
    <div class="msg ${own ? "own" : "other"}" data-id="${msg.id}">
      ${
        own && !deleted
          ? `<div class="msg-menu">
               <button type="button" class="msg-menu-btn" data-menu aria-label="Message actions">⋯</button>
               <div class="msg-menu-list is-hidden">
                 <button type="button" data-action="reply">Reply</button>
                 ${isAdminRoom ? `<button type="button" data-action="${pinned ? "unpin" : "pin"}">${pinned ? "Unpin" : "Pin"}</button>` : ""}
                 <button type="button" data-action="edit">Edit</button>
                 <button type="button" data-action="delete" class="danger">Delete</button>
               </div>
             </div>`
          : ""
      }
      <div class="bubble ${deleted ? "bubble-deleted" : ""}">
        ${sender}
        ${replyQuote}
        <span class="bubble-text ${pinned ? "is-pinned" : ""}">${pinItem}${text}</span>
        ${attachHtml}
        <span class="bubble-meta">${formatTime(msg.created_at)}${edited}${status}</span>
      </div>
      ${deleted || msg.status === "sending" || msg.status === "failed" ? "" : messageActionsHtml(msg)}
    </div>`;
}

function pendingMediaHtml(msg) {
  const media = msg.media || [];
  return media
    .map((item, i) => {
      const file = item.file;
      const name = file?.name || "File";
      const key = `${msg.id}:${i}`;
      if (isImageFile(file)) {
        return `
          <div class="attach-media">
            <img class="attach-img" data-pending-img="${key}" alt="${escapeHtml(name)}">
            <span class="attach-loading"><span class="spinner-ring"></span></span>
          </div>
          <div class="attach-meta-row"><span>${escapeHtml(name)}</span><span>${formatBytes(file.size)}</span></div>`;
      }
      return `
        <div class="attach-file">
          <span class="attach-file-icon">${documentIcon(file.type)}</span>
          <span class="attach-file-main">
            <span class="attach-file-name">${escapeHtml(name)}</span>
            <span class="attach-file-meta">${formatBytes(file.size)}</span>
          </span>
          <span class="attach-pending-mark">uploading…</span>
        </div>`;
    })
    .join("");
}

function renderAttachmentsBlock(msg) {
  // Outgoing messages that haven't reached the server yet render local previews
  // straight from the File objects held on the pending message.
  if (msg.status === "sending" || msg.status === "failed") {
    return pendingMediaHtml(msg);
  }

  const attaches = (attachmentCache.get(msg.id) || []).filter((a) => !msg.deleted_at);
  if (!attaches.length) return "";

  return attaches
    .map((att) => {
      if (isImageMime(att.mime_type)) {
        return `
          <div class="attach-media">
            <button type="button" class="attach-img-btn" data-attach-open="${att.id}" title="Open image">
              <img class="attach-img" data-attach-img="${att.id}" alt="${escapeHtml(att.name)}">
              <span class="attach-loading"><span class="spinner-ring"></span></span>
            </button>
            <div class="attach-meta-row"><span>${escapeHtml(att.name)}</span><span>${formatBytes(att.size_bytes)}</span></div>
          </div>`;
      }
      return `
        <div class="attach-file" data-attach-download="${att.id}" title="Download ${escapeHtml(att.name)}">
          <span class="attach-file-icon">${documentIcon(att.mime_type)}</span>
          <span class="attach-file-main">
            <span class="attach-file-name">${escapeHtml(att.name)}</span>
            <span class="attach-file-meta">${formatBytes(att.size_bytes)} — tap to download</span>
          </span>
        </div>`;
    })
    .join("");
}

/** Decrypts attachments after a render and swaps in real object URLs. */
function hydrateAttachments() {
  // Pending previews come from the File objects still held on the message.
  document.querySelectorAll("[data-pending-img]").forEach((img) => {
    const [msgId, idx] = img.dataset.pendingImg.split(":");
    const msg = state.messages.find((m) => m.id === msgId);
    const file = msg?.media?.[Number(idx)]?.file;
    if (!file) return;
    img.src = URL.createObjectURL(file);
    img.closest(".attach-media")?.querySelector(".attach-loading")?.remove();
  });

  document.querySelectorAll("[data-attach-img]").forEach((img) => {
    const id = img.dataset.attachImg;
    const cached = remoteUrlCache.get(id);
    if (cached) {
      img.src = cached;
      img.closest(".attach-media")?.querySelector(".attach-loading")?.remove();
      return;
    }
    const att = currentAttachmentById(id);
    if (!att) return;
    decryptAttachment(att, activeRoomKey)
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        remoteUrlCache.set(id, url);
        const el = document.querySelector(`[data-attach-img="${id}"]`);
        if (el) {
          el.src = url;
          el.closest(".attach-media")?.querySelector(".attach-loading")?.remove();
        }
      })
      .catch(() => {
        const el = document.querySelector(`[data-attach-img="${id}"]`);
        const loading = el?.closest(".attach-media")?.querySelector(".attach-loading");
        if (loading) loading.textContent = "Can't load";
      });
  });
}

function messageActionsHtml(msg) {
  const mine = state.currentUser?.id;
  const counts = new Map();
  const reacted = new Set();
  (reactionCache.get(msg.id) || []).forEach((r) => {
    counts.set(r.emoji, (counts.get(r.emoji) || 0) + 1);
    if (r.user_id === mine) reacted.add(r.emoji);
  });

  const pills = [...counts.entries()]
    .map(
      ([emoji, count]) =>
        `<button type="button" class="reaction-pill${reacted.has(emoji) ? " active" : ""}" data-react="${emoji}" data-message="${msg.id}" title="Toggle ${emoji}">${emoji}<span class="reaction-count">${count}</span></button>`
    )
    .join("");

  const own = msg.sender_id === state.currentUser?.id;

  return `
    <div class="msg-actions">
      ${pills ? `<div class="reaction-row">${pills}</div>` : ""}
      <button type="button" class="msg-react" data-react-open data-message="${msg.id}" title="Add a reaction">＋</button>
      ${own ? "" : `<button type="button" class="msg-reply-link" data-action="reply" data-message="${msg.id}">Reply</button>`}
    </div>`;
}

function renderMessages({ stickToBottom = false } = {}) {
  const el = dom.messagesEl;
  if (!el) return;

  const prevScroll = el.scrollTop;
  editingId = null;
  pickerOpenId = null;

  if (state.messagesLoading && !state.messages.length) {
    el.innerHTML = '<div class="chat-welcome"><p>Loading messages…</p></div>';
    return;
  }

  if (!state.messages.length) {
    el.innerHTML = `
      <div class="chat-welcome">
        <div class="empty-orbit">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </div>
        <h3>No messages yet</h3>
        <p>Say hello and start the conversation.</p>
      </div>`;
    return;
  }

  let html = "";
  let currentDay = "";
  const renderNow = Date.now();
  const roomId = state.currentRoomId;

  state.messages.forEach((msg) => {
    if (roomId && isClearedOut(roomId, msg.created_at)) return;
    const day = new Date(msg.created_at).toDateString();
    if (day !== currentDay) {
      currentDay = day;
      html += `<div class="day-divider"><span>${dayLabel(msg.created_at)}</span></div>`;
    }
    // Disappearing messages expire visually here; the background RPC removes
    // the server copy (and ciphertext) shortly after.
    const expired =
      disappearAfterMs > 0 &&
      !msg.deleted_at &&
      renderNow - new Date(msg.created_at).getTime() > disappearAfterMs;
    if (expired) {
      html += messageHtml({ ...msg, deleted_at: new Date().toISOString(), body: null });
      return;
    }
    html += messageHtml(msg);
  });

  el.innerHTML = html;
  hydrateAttachments();

  if (stickToBottom) {
    scrollToBottom();
  } else {
    el.scrollTop = prevScroll;
  }
}

function scrollToBottom() {
  const el = dom.messagesEl;
  if (el) el.scrollTop = el.scrollHeight;
}

function showInlineError(form, text) {
  const error = form.querySelector("[data-edit-error]");
  if (!error) return;
  error.textContent = text;
  error.hidden = false;
}

function startEdit(msgEl, message) {
  if (editingId) return;
  editingId = message.id;

  const bubble = msgEl.querySelector(".bubble");
  bubble.classList.add("editing");
  bubble.innerHTML = `
    <form class="bubble-edit" data-edit-form data-id="${message.id}">
      <textarea class="bubble-edit-input" data-edit-input></textarea>
      <span class="bubble-edit-error" data-edit-error hidden></span>
      <div class="bubble-edit-actions">
        <button type="button" class="bubble-edit-cancel" data-edit-cancel>Cancel</button>
        <button type="submit" class="bubble-edit-save">Save</button>
      </div>
    </form>`;

  const input = bubble.querySelector("[data-edit-input]");
  input.value = message.body || "";
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

// --- Interaction -----------------------------------------------------------

function closeMenus(except) {
  document.querySelectorAll(".msg-menu-list").forEach((list) => {
    if (list !== except) list.classList.add("is-hidden");
  });
}

async function onEditSubmit(form) {
  const messageId = form.dataset.id;
  const input = form.querySelector("[data-edit-input]");
  const value = input.value.trim();

  if (!value) {
    showInlineError(form, "Message cannot be empty.");
    return;
  }

  const save = form.querySelector(".bubble-edit-save");
  save.disabled = true;

  const { error } = await editMessage(messageId, value);
  if (error) {
    showInlineError(form, "Could not save. Try again.");
    save.disabled = false;
    return;
  }

  const msg = state.messages.find((m) => m.id === messageId);
  if (msg) {
    msg.body = value;
    msg.edited_at = new Date().toISOString();
  }
  editingId = null;
  renderMessages();
}

async function onDeleteMessage(message) {
  const confirmed = await showConfirm({
    title: "Delete message?",
    message: "This removes the message for everyone in the room.",
    confirmLabel: "Delete",
    danger: true,
  });
  if (!confirmed) return;

  // Remove the ciphertext + metadata for any files attached to this message.
  const attaches = attachmentCache.get(message.id) || [];
  for (const att of attaches) {
    const url = remoteUrlCache.get(att.id);
    if (url) {
      URL.revokeObjectURL(url);
      remoteUrlCache.delete(att.id);
    }
  }
  if (attaches.length) {
    await deleteRoomFiles(attaches.map((a) => a.storage_path));
    await supabase.from("attachments").delete().eq("message_id", message.id);
    attachmentCache.delete(message.id);
  }

  const { error } = await deleteMessage(message.id);
  if (error) return;

  const msg = state.messages.find((m) => m.id === message.id);
  if (msg) {
    msg.deleted_at = new Date().toISOString();
    msg.body = null;
  }
  renderMessages();
}

function onRetry(message) {
  const index = state.messages.findIndex((m) => m.id === message.id);
  if (index !== -1) state.messages.splice(index, 1);

  if (message.media && message.media.length) {
    pendingMedia = message.media.map((item) => ({
      file: item.file,
      previewUrl: item.previewUrl || URL.createObjectURL(item.file),
    }));
    renderAttachPreview();
    sendMediaMessages(message.room_id, message.body);
  } else {
    sendMessage(message.room_id, message.body);
  }
}

function closePicker() {
  document.querySelectorAll(".emoji-picker").forEach((p) => p.remove());
  pickerOpenId = null;
}

function toggleReactionPicker(messageId, anchor) {
  if (pickerOpenId === messageId) {
    closePicker();
    return;
  }
  closePicker();
  const picker = document.createElement("div");
  picker.className = "emoji-picker";
  picker.innerHTML = REACTION_EMOJI.map(
    (emoji) =>
      `<button type="button" class="emoji-picker-btn" data-react="${emoji}" data-message="${messageId}">${emoji}</button>`
  ).join("");
  (anchor.parentElement || anchor).appendChild(picker);
  pickerOpenId = messageId;
}

function handleMessagesClick(event) {
  const pickerBtn = event.target.closest("[data-react-open]");
  if (pickerBtn) {
    closeMenus();
    toggleReactionPicker(pickerBtn.dataset.message, pickerBtn);
    return;
  }

  const reactBtn = event.target.closest("[data-react]");
  if (reactBtn) {
    const emoji = reactBtn.dataset.react;
    const messageId = reactBtn.dataset.message;
    if (!emoji || !messageId) return;
    toggleReaction(messageId, emoji);
    closePicker();
    return;
  }

  const menuBtn = event.target.closest("[data-menu]");
  if (menuBtn) {
    const list = menuBtn.parentElement.querySelector(".msg-menu-list");
    const willOpen = list.classList.contains("is-hidden");
    closeMenus(list);
    closePicker();
    list.classList.toggle("is-hidden", !willOpen);
    return;
  }

  const msgEl = event.target.closest(".msg");
  if (!msgEl) {
    closeMenus();
    closePicker();
    return;
  }
  const message = state.messages.find((m) => m.id === msgEl.dataset.id);
  if (!message) return;

  const attachOpen = event.target.closest("[data-attach-open]");
  if (attachOpen) {
    const url = remoteUrlCache.get(attachOpen.dataset.attachOpen);
    if (url) window.open(url, "_blank", "noopener");
    return;
  }

  const attachDownload = event.target.closest("[data-attach-download]");
  if (attachDownload) {
    downloadAttachment(currentAttachmentById(attachDownload.dataset.attachDownload));
    return;
  }

  if (event.target.closest("[data-edit-cancel]")) {
    editingId = null;
    renderMessages();
    return;
  }

  if (event.target.closest("[data-action='reply']")) {
    closeMenus();
    startReply(message);
  } else if (event.target.closest("[data-action='pin']")) {
    closeMenus();
    pinMessage(state.currentRoomId, message.id);
  } else if (event.target.closest("[data-action='unpin']")) {
    closeMenus();
    unpinMessage(state.currentRoomId, message.id);
  } else if (event.target.closest("[data-action='edit']")) {
    closeMenus();
    startEdit(msgEl, message);
  } else if (event.target.closest("[data-action='delete']")) {
    closeMenus();
    onDeleteMessage(message);
  } else if (event.target.closest("[data-retry]")) {
    onRetry(message);
  } else {
    closeMenus();
    closePicker();
  }
}

// --- Room lifecycle --------------------------------------------------------

async function loadOlderMessages() {
  const roomId = state.currentRoomId;
  const oldest = state.messages[0];
  if (!oldest) return;

  state.messagesLoading = true;
  const el = dom.messagesEl;
  const prevHeight = el ? el.scrollHeight : 0;

  const older = await listMessages(roomId, oldest.created_at);
  if (state.currentRoomId !== roomId) return;

  for (const msg of older) await decryptMessageContent(msg);
  await loadReactions(roomId, older);
  await loadAttachments(roomId, older);
  const cut = localClearCut(roomId);
  const kept = cut
    ? older.filter((m) => new Date(m.created_at).getTime() >= cut)
    : older;
  if (kept.length < PAGE_SIZE) state.hasMoreMessages = false;
  state.messages = kept.concat(state.messages);
  state.messagesLoading = false;

  renderMessages();
  if (el) el.scrollTop = el.scrollHeight - prevHeight;
}

export async function openRoom(roomId) {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room || !supabase) return;

  unsubscribe();
  state.currentRoomId = roomId;
  state.messages = [];
  state.messagesLoading = true;
  state.hasMoreMessages = true;
  reactionCache = new Map();
  pinsCache = [];
  resetRoomDisappear();
  revokeRemoteUrls();
  attachmentCache = new Map();
  clearPendingMedia();
  replyTarget = null;
  renderReplyBar();
  typingUsers.clear();
  typingTimers.forEach((t) => clearTimeout(t));
  typingTimers.clear();
  renderTypingIndicator();
  presenceMap.clear();
  isAdminRoom = false;

  renderMessages();
  setComposerNotice("");

  try {
    await loadMembers(roomId);

    const isAdmin = await canManageRoom(roomId);
    isAdminRoom = isAdmin;
    if (isAdmin) {
      activeRoomKey = await ensureRoomKey(roomId);
      await shareMissingKeys(roomId);
    } else {
      activeRoomKey = await getRoomKey(roomId);
    }

    const messages = await listMessages(roomId);

    // The user may have switched rooms while history was loading.
    if (state.currentRoomId !== roomId) return;

    for (const msg of messages) await decryptMessageContent(msg);

    // Drop messages this user previously cleared locally ("clear chat for me").
    const cut = localClearCut(roomId);
    state.messages = cut
      ? messages.filter((m) => new Date(m.created_at).getTime() >= cut)
      : messages;
    state.hasMoreMessages = messages.length === PAGE_SIZE;
    state.messagesLoading = false;
    await loadReactions(roomId, messages);
    await loadPins(roomId);
    await loadAttachments(roomId, messages);
    renderMessages({ stickToBottom: true });

    if (!activeRoomKey) {
      setComposerNotice(isAdmin ? "No encryption key is available for this room." : NO_KEY_TEXT);
    }

    subscribeToRoom(roomId);
  } catch (error) {
    // A room-key or decryption failure must never hang the chat or surface an
    // unhandled rejection: end the loading state and explain what happened.
    if (state.currentRoomId !== roomId) return;
    state.messages = [];
    state.messagesLoading = false;
    renderMessages();
    setComposerNotice(
      "Messages couldn't be loaded for this chat — this device doesn't hold the room key yet. Ask the room admin to invite you again or re-share the key."
    );
  }
}

export function closeRoom() {
  unsubscribe();
  editingId = null;
  activeRoomKey = null;
  isAdminRoom = false;
  state.messages = [];
  state.currentRoomId = null;
  reactionCache = new Map();
  pinsCache = [];
  resetRoomDisappear();
  revokeRemoteUrls();
  attachmentCache = new Map();
  clearPendingMedia();
  stopCamera();
  cancelVoiceRecording();
  replyTarget = null;
  renderReplyBar();
  typingUsers.clear();
  typingTimers.forEach((t) => clearTimeout(t));
  typingTimers.clear();
  renderTypingIndicator();
  presenceMap.clear();
  closePicker();
  hideMentionMenu();
  setComposerNotice("");
  window.dispatchEvent(new CustomEvent("echorooms:room-closed"));
}

// --- Mention autocomplete --------------------------------------------------

function currentMention() {
  const el = dom.composerInput;
  if (!el) return null;
  const before = el.value.slice(0, el.selectionStart);
  const match = before.match(/(^|\s)@([A-Za-z0-9_.]*)$/);
  if (!match) return null;
  return { query: match[2], start: el.selectionStart - match[2].length - 1 };
}

function hideMentionMenu() {
  if (dom.mentionMenu) {
    dom.mentionMenu.classList.add("is-hidden");
    dom.mentionMenu.innerHTML = "";
  }
}

function refreshMentionMenu() {
  const el = dom.mentionMenu;
  if (!el) {
    return;
  }
  const mention = currentMention();
  if (!mention) {
    hideMentionMenu();
    return;
  }

  const members = memberCache.get(state.currentRoomId);
  const matches = [];
  if (members) {
    for (const profile of members.values()) {
      if (profile && profile.username && profile.username.toLowerCase().includes(mention.query.toLowerCase())) {
        if (state.currentUser && profile.id === state.currentUser.id) continue;
        matches.push(profile);
        if (matches.length >= 6) break;
      }
    }
  }

  if (!matches.length) {
    hideMentionMenu();
    return;
  }

  el.innerHTML = matches
    .map(
      (p) =>
        `<button type="button" class="mention-item" data-username="${escapeHtml(p.username)}">@${escapeHtml(
          p.username
        )} <small>${escapeHtml(p.display_name || "")}</small></button>`
    )
    .join("");
  el.classList.remove("is-hidden");
}

function insertMention(username) {
  const el = dom.composerInput;
  const mention = currentMention();
  if (!mention || !el) return;
  const after = el.value.slice(el.selectionStart);
  el.value = `${el.value.slice(0, mention.start)}@${username} ${after}`;
  const pos = mention.start + 1 + username.length + 1;
  el.setSelectionRange(pos, pos);
  autoGrow(el);
  hideMentionMenu();
  el.focus();
}

function initMentionMenu() {
  dom.mentionMenu?.addEventListener("click", (e) => {
    const item = e.target.closest("[data-username]");
    if (!item) return;
    e.preventDefault();
    insertMention(item.dataset.username);
  });
  dom.composerInput?.addEventListener("input", () => {
    autoGrow(dom.composerInput);
    refreshMentionMenu();
  });
  dom.composerInput?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideMentionMenu();
    if (e.key === "Enter") hideMentionMenu();
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-username], #composer-input")) return;
    hideMentionMenu();
  });
}

// --- Composer --------------------------------------------------------------

function initComposer() {
  let lastTypingBroadcast = 0;
  const TYPING_BROADCAST_MS = 2000;

  const send = () => {
    const roomId = state.currentRoomId;
    const body = dom.composerInput.value.trim();
    const hasMedia = pendingMedia.length > 0;
    if (!roomId || (!body && !hasMedia) || !supabase) return;

    const sendCaption = body;
    dom.composerInput.value = "";
    autoGrow(dom.composerInput);
    hideMentionMenu();
    broadcastTyping(false);
    if (hasMedia) {
      sendMediaMessages(roomId, sendCaption);
    } else {
      sendMessage(roomId, body);
    }
  };

  dom.btnSend?.addEventListener("click", send);
  dom.composerInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  dom.composerInput?.addEventListener("input", () => {
    autoGrow(dom.composerInput);
    const now = Date.now();
    if (now - lastTypingBroadcast > TYPING_BROADCAST_MS) {
      lastTypingBroadcast = now;
      broadcastTyping(true);
    }
  });
  dom.composerInput?.addEventListener("blur", () => broadcastTyping(false));

  dom.replyCancel?.addEventListener("click", clearReply);

  dom.btnAttach?.addEventListener("click", () => dom.attachInput?.click());
  dom.attachInput?.addEventListener("change", (e) => {
    if (e.target.files?.length) addPendingFiles([...e.target.files]);
    e.target.value = "";
  });
  dom.attachPreviewList?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove-attach]");
    if (btn) removePendingFile(Number(btn.dataset.removeAttach));
  });

  dom.btnCamera?.addEventListener("click", startCameraCapture);
  dom.btnCameraClose?.addEventListener("click", (e) => {
    e.stopPropagation();
    stopCamera();
  });
  dom.cameraOverlay?.addEventListener("click", (e) => {
    if (e.target === dom.cameraOverlay) stopCamera();
  });
  dom.btnCameraCapture?.addEventListener("click", capturePhoto);

  dom.btnMic?.addEventListener("click", () => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      stopVoiceRecording();
    } else {
      startVoiceRecording();
    }
  });
  dom.btnVoiceCancel?.addEventListener("click", cancelVoiceRecording);

  dom.messagesEl?.addEventListener("scroll", () => {
    if (dom.messagesEl.scrollTop > 60) return;
    if (!state.hasMoreMessages || state.messagesLoading) return;
    loadOlderMessages();
  });

  dom.messagesEl?.addEventListener("click", handleMessagesClick);
  dom.messagesEl?.addEventListener("submit", (e) => {
    const form = e.target.closest("[data-edit-form]");
    if (!form) return;
    e.preventDefault();
    onEditSubmit(form);
  });
}

function autoGrow(input) {
  if (!input) return;
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
}

function initMobileBack() {
  dom.btnBack?.addEventListener("click", () => {
    closeInfo();
    openSidebar();
  });
}

function initCloseChat() {
  dom.btnCloseChat?.addEventListener("click", () => {
    closeRoom();
    showHome();
  });
}

export function initChat() {
  initComposer();
  initMentionMenu();
  initMobileBack();
  initCloseChat();

  // Clicks outside the reaction picker close it.
  document.addEventListener("click", (e) => {
    if (e.target.closest(".msg-actions, .emoji-picker")) return;
    closePicker();
  });
}
