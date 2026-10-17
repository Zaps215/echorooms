// Messaging feature: history, realtime delivery, and the composer.
//
// This module owns the conversation pane. It loads a bounded page of history,
// subscribes to Postgres changes for the active room, and renders the message
// stream grouped by day. Room selection is delegated here from rooms.js so all
// conversation state lives in one place.

import * as dom from "../core/dom.js";
import { state } from "../core/state.js";
import { supabase } from "../core/supabase.js";
import { escapeHtml, getRequestErrorMessage, setButtonLoading } from "../core/utils.js";
import { showChatList } from "../core/navigation.js";
import { showConfirm } from "../core/confirm.js";
import { latestMessageCursor, mergeMessageRows } from "../core/message-sync.js";
import { getRoomKey, ensureRoomKey, canManageRoom, shareMissingKeys } from "../core/keyring.js";
import * as crypto from "../core/crypto.js";
import { markCurrentRoomRead } from "./unread.js";
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
  "id, room_id, sender_id, body, iv, ciphertext, reply_to_id, edited_at, deleted_at, created_at, profiles!messages_sender_id_fkey(display_name, username)";

const ATTACHMENT_COLUMNS =
  "id, room_id, message_id, sender_id, name, mime_type, size_bytes, storage_path, iv, created_at";
const REACTION_OPTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👏", "🙏", "💯"];

// Per-room cache of userId -> profile, used to label realtime messages.
const memberCache = new Map();

let channel = null;
let editingId = null;
let activeRoomKey = null;

let latestSyncedCursor = null;
let historyLoadedRoomId = null;
let catchUpTask = null;
let roomLoadError = "";

// --- Media (attachment) state ----------------------------------------------

// messageId -> array of attachment rows for messages in the current window.
let attachmentCache = new Map();
let reactionsByMessage = new Map();
// attachmentId -> decrypted object URL, kept across re-renders so we decrypt
// each file once and just swap the URL back in.
const remoteUrlCache = new Map();
// Files the user has picked in the composer but not sent yet.
let pendingMedia = [];
let voiceRecorder = null;
let voiceMicrophoneStream = null;
let voiceRecordingChunks = [];
let voiceRecordingRoomId = null;
let voiceRecordingTimeout = null;
let voiceRecordingDiscarded = false;
let voiceRecordingStarting = false;

// The message currently being replied to, or null.
let replyTarget = null;

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
async function decryptMessageContent(msg, roomKey = activeRoomKey) {
  if (msg.deleted_at) return;
  if (!msg.iv || !msg.ciphertext) return; // legacy plaintext message
  if (!roomKey) {
    msg.body = NO_KEY_TEXT;
    return;
  }
  try {
    msg.body = await crypto.decryptMessage(roomKey, msg.iv, msg.ciphertext);
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

function restoreComposerDraft(roomId, body) {
  if (
    state.currentRoomId === roomId &&
    dom.composerInput &&
    !dom.composerInput.value.trim()
  ) {
    dom.composerInput.value = body;
    autoGrow(dom.composerInput);
  }
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
  window.dispatchEvent(new CustomEvent("echorooms:room-preview-cleared", {
    detail: { roomId },
  }));
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
    .order("id", { ascending: false })
    .limit(PAGE_SIZE);

  if (before) {
    query = query.or(
      `created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`
    );
  }

  const { data, error } = await query;
  if (error) throw error;
  if (!data) return [];

  const cache = memberCache.get(roomId);
  const messages = data.map((row) => {
    const msg = normalize(row);
    if (cache && msg.sender) cache.set(msg.sender_id, msg.sender);
    return msg;
  });
  return messages.reverse();
}

async function listMessagesAfter(roomId, cursor) {
  if (!supabase || !cursor) return [];
  const { data, error } = await supabase
    .from("messages")
    .select(MESSAGE_COLUMNS)
    .eq("room_id", roomId)
    .or(
      `created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})`
    )
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(PAGE_SIZE);
  if (error) throw error;
  if (!data) return [];

  const cache = memberCache.get(roomId);
  return data.map((row) => {
    const msg = normalize(row);
    if (cache && msg.sender) cache.set(msg.sender_id, msg.sender);
    return msg;
  });
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

/**
 * The cached profile rows for a room's members, keyed by user id, or undefined
 * if the membership has not loaded yet.
 */
export function getRoomMembers(roomId) {
  return memberCache.get(roomId);
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
  if (error) throw error;
  if (!data || state.currentRoomId !== roomId) return;

  // Merge so paginated loads never drop attachments from earlier pages.
  const merged = new Map(attachmentCache);
  for (const att of data) {
    const list = merged.get(att.message_id) || [];
    if (!list.some((a) => a.id === att.id)) list.push(att);
    merged.set(att.message_id, list);
  }
  attachmentCache = merged;
}

async function loadMessageReactions(roomId, messages) {
  if (!supabase) return;
  const ids = (messages || []).map((message) => message.id).filter(Boolean);
  if (!ids.length) return;

  const { data, error } = await supabase
    .from("message_reactions")
    .select("message_id, user_id, emoji")
    .eq("room_id", roomId)
    .in("message_id", ids);
  if (error) throw error;
  if (!data || state.currentRoomId !== roomId) return;

  const merged = new Map(reactionsByMessage);
  for (const id of ids) merged.delete(id);
  for (const reaction of data) {
    const list = merged.get(reaction.message_id) || [];
    list.push(reaction);
    merged.set(reaction.message_id, list);
  }
  reactionsByMessage = merged;
  renderMessages();
}

function showReactionLoadError(error) {
  setComposerNotice(
    getRequestErrorMessage(
      error,
      "Message reactions couldn't load. Apply the latest Supabase migration and retry."
    )
  );
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

function onReactionChange(event, row) {
  if (!row || state.currentRoomId !== row.room_id) return;

  const reactions = reactionsByMessage.get(row.message_id) || [];
  const next = reactions.filter(
    (reaction) => !(reaction.user_id === row.user_id && reaction.emoji === row.emoji)
  );
  if (event !== "DELETE") next.push(row);
  if (next.length) reactionsByMessage.set(row.message_id, next);
  else reactionsByMessage.delete(row.message_id);
  renderMessages();
}

function setVoiceRecordButton(recording, disabled = false) {
  if (!dom.btnRecordVoice) return;
  dom.btnRecordVoice.disabled = disabled;
  dom.btnRecordVoice.classList.toggle("recording", recording);
  dom.btnRecordVoice.title = recording ? "Stop recording" : "Record a voice note";
  dom.btnRecordVoice.setAttribute("aria-label", dom.btnRecordVoice.title);
}

function stopVoiceRecording(discard = false) {
  if (discard) voiceRecordingDiscarded = true;
  if (voiceRecordingTimeout) {
    clearTimeout(voiceRecordingTimeout);
    voiceRecordingTimeout = null;
  }
  if (voiceRecorder && voiceRecorder.state !== "inactive") {
    setVoiceRecordButton(true, true);
    voiceRecorder.stop();
  } else if (discard) {
    voiceMicrophoneStream?.getTracks().forEach((track) => track.stop());
    voiceMicrophoneStream = null;
    voiceRecordingRoomId = null;
    voiceRecordingChunks = [];
    voiceRecorder = null;
    setVoiceRecordButton(false);
  }
}

function voiceFileExtension(mimeType) {
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

async function startVoiceRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setComposerNotice("Voice recording isn't supported in this browser. You can attach an audio file instead.");
    return;
  }
  const roomId = state.currentRoomId;
  if (!roomId || voiceRecordingStarting || voiceRecorder) return;

  voiceRecordingStarting = true;
  setVoiceRecordButton(false, true);
  setComposerNotice("");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (state.currentRoomId !== roomId) {
      stream.getTracks().forEach((track) => track.stop());
      setVoiceRecordButton(false);
      return;
    }

    voiceMicrophoneStream = stream;
    voiceRecordingRoomId = roomId;
    voiceRecordingChunks = [];
    voiceRecordingDiscarded = false;
    const mimeType = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/ogg",
      "audio/mp4",
    ].find((type) => MediaRecorder.isTypeSupported(type)) || "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    voiceRecorder = recorder;
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) voiceRecordingChunks.push(event.data);
    });
    recorder.addEventListener("stop", () => {
      stream.getTracks().forEach((track) => track.stop());
      voiceMicrophoneStream = null;
      voiceRecorder = null;
      const recordedRoomId = voiceRecordingRoomId;
      voiceRecordingRoomId = null;
      setVoiceRecordButton(false);

      if (
        voiceRecordingDiscarded ||
        recordedRoomId !== state.currentRoomId ||
        !voiceRecordingChunks.length
      ) {
        voiceRecordingChunks = [];
        voiceRecordingDiscarded = false;
        return;
      }

      const type = (recorder.mimeType || "audio/webm").split(";")[0];
      const file = new File(
        voiceRecordingChunks,
        `voice-note-${Date.now()}.${voiceFileExtension(type)}`,
        { type }
      );
      voiceRecordingChunks = [];
      addPendingFiles([file]);
    }, { once: true });
    recorder.start();
    setVoiceRecordButton(true);
    voiceRecordingTimeout = window.setTimeout(() => stopVoiceRecording(), 60_000);
  } catch (error) {
    voiceMicrophoneStream?.getTracks().forEach((track) => track.stop());
    voiceMicrophoneStream = null;
    voiceRecorder = null;
    voiceRecordingRoomId = null;
    setVoiceRecordButton(false);
    const denied = error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError";
    setComposerNotice(
      denied
        ? "Microphone access was denied. Allow microphone access in your browser settings, or attach an audio file."
        : "Couldn't start voice recording. Check your microphone and try again."
    );
  } finally {
    voiceRecordingStarting = false;
  }
}

async function sendMessage(roomId, body) {
  let key = activeRoomKey;
  if (!key) {
    try {
      key = await ensureRoomKey(roomId);
    } catch (error) {
      restoreComposerDraft(roomId, body);
      if (state.currentRoomId === roomId) {
        setComposerNotice(
          getRequestErrorMessage(error, "Your encryption key couldn't be loaded. Try again.")
        );
      }
      return;
    }
    if (state.currentRoomId !== roomId) return;
    activeRoomKey = key;
    if (!key) {
      try {
        const canManage = await canManageRoom(roomId);
        if (state.currentRoomId === roomId) {
          restoreComposerDraft(roomId, body);
          setComposerNotice(
            canManage ? "Your encryption key couldn't be created. Try again." : NO_KEY_TEXT
          );
        }
      } catch (error) {
        restoreComposerDraft(roomId, body);
        if (state.currentRoomId === roomId) {
          setComposerNotice(
            getRequestErrorMessage(error, "Your encryption key couldn't be loaded. Try again.")
          );
        }
      }
      return;
    }
  }

  let encrypted;
  try {
    encrypted = await crypto.encryptMessage(key, body);
  } catch (error) {
    restoreComposerDraft(roomId, body);
    if (state.currentRoomId === roomId) {
      setComposerNotice(
        getRequestErrorMessage(error, "This message couldn't be encrypted. Please try again.")
      );
    }
    return;
  }
  if (state.currentRoomId !== roomId) return;
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

  let result;
  try {
    result = await supabase
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
  } catch (error) {
    markMessageSendFailed(pendingId, roomId, error);
    return;
  }

  if (result.error || !result.data) {
    markMessageSendFailed(pendingId, roomId, result.error);
    return;
  }

  if (state.currentRoomId !== roomId) return;
  clearReply();
  const index = state.messages.findIndex((m) => m.id === pendingId);
  const row = normalize(result.data);
  row.body = body;
  state.messages = mergeMessageRows(
    state.messages,
    index === -1 ? [row] : state.messages.map((message) => message.id === pendingId ? row : message)
  );
  advanceMessageCursor(state.messages);
  publishRoomPreview(row);
  renderMessages({ stickToBottom: true });
}

function messageSendFailureText(error) {
  if (error?.status === 401) {
    return "Your session has expired. Sign in again to send this message.";
  }
  if (error?.status === 403) {
    return "You don't have permission to send messages in this conversation.";
  }
  return getRequestErrorMessage(error, "Message couldn't be sent. Please try again.");
}

function markMessageSendFailed(messageId, roomId, error) {
  const target = state.messages.find((message) => message.id === messageId);
  if (target) {
    target.status = "failed";
    target.failureReason = messageSendFailureText(error);
  }
  if (state.currentRoomId === roomId) {
    renderMessages({ stickToBottom: true });
  }
}

function publishRoomPreview(message) {
  window.dispatchEvent(new CustomEvent("echorooms:message-preview", {
    detail: { roomId: message.room_id, message },
  }));
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
  if (state.currentRoomId === pending.room_id) renderMessages({ stickToBottom: true });
}

/**
 * Sends an attachment message: message row (optionally with the encrypted
 * caption), E2EE file upload, then the attachments row. One message per file.
 */
async function sendMediaMessages(roomId, caption) {
  let key = activeRoomKey;
  if (!key) {
    key = await ensureRoomKey(roomId);
    if (state.currentRoomId !== roomId) return;
    activeRoomKey = key;
    if (!key) {
      const canManage = await canManageRoom(roomId);
      if (state.currentRoomId !== roomId) return;
      setComposerNotice(canManage ? "Your encryption key couldn't be created. Try again." : NO_KEY_TEXT);
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
      publishRoomPreview(row);
      const index = state.messages.findIndex((m) => m.id === pending.id);
      if (index !== -1) {
        state.messages = mergeMessageRows(
          state.messages.filter((m) => m.id !== pending.id),
          [row]
        );
        advanceMessageCursor(state.messages);
      }
      if (state.currentRoomId !== roomId) continue;
      const list = attachmentCache.get(row.id) || [];
      if (!list.some((attachment) => attachment.id === attRow.id)) list.push({
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
      renderMessages({ stickToBottom: true });
    } catch (err) {
      markMediaFailed(pending);
    }
  }

  if (state.currentRoomId === roomId) {
    renderAttachProgress("");
    setComposerNotice("");
  }
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

async function toggleMessageReaction(message, emoji) {
  const userId = state.currentUser?.id;
  const roomId = state.currentRoomId;
  if (!userId || !roomId || !REACTION_OPTIONS.includes(emoji)) return;

  const reactions = reactionsByMessage.get(message.id) || [];
  const existing = reactions.some(
    (reaction) => reaction.user_id === userId && reaction.emoji === emoji
  );

  try {
    if (existing) {
      const { error } = await supabase
        .from("message_reactions")
        .delete()
        .eq("room_id", roomId)
        .eq("message_id", message.id)
        .eq("user_id", userId)
        .eq("emoji", emoji);
      if (error) throw error;
      onReactionChange("DELETE", {
        room_id: roomId,
        message_id: message.id,
        user_id: userId,
        emoji,
      });
    } else {
      const { data, error } = await supabase
        .from("message_reactions")
        .insert({ room_id: roomId, message_id: message.id, user_id: userId, emoji })
        .select("room_id, message_id, user_id, emoji")
        .single();
      if (error) throw error;
      onReactionChange("INSERT", data);
    }
  } catch (error) {
    setComposerNotice(
      getRequestErrorMessage(error, "Couldn't save your reaction. Try again.")
    );
  }
}

// --- Realtime --------------------------------------------------------------

function setRealtimeStatus(status) {
  if (!dom.realtimeStatus) return;
  const labels = {
    connecting: "Connecting",
    connected: "Live",
    reconnecting: "Reconnecting",
    offline: "Offline",
  };
  dom.realtimeStatus.dataset.state = status;
  const label = dom.realtimeStatus.querySelector(".realtime-status-label");
  if (label) label.textContent = labels[status] || labels.offline;
  dom.realtimeStatus.title = labels[status] || labels.offline;
}

function advanceMessageCursor(messages) {
  const persisted = messages.filter((message) => !String(message.id).startsWith("pending-"));
  const cursor = latestMessageCursor(persisted);
  if (!cursor) return;
  if (!latestSyncedCursor || cursor.created_at > latestSyncedCursor.created_at ||
      (cursor.created_at === latestSyncedCursor.created_at && cursor.id > latestSyncedCursor.id)) {
    latestSyncedCursor = cursor;
  }
}

function isNearMessageBottom() {
  const el = dom.messagesEl;
  return !el || el.scrollHeight - el.clientHeight - el.scrollTop < 80;
}

function subscribeToRoom(roomId) {
  if (!supabase) return;
  unsubscribe();

  const roomChannel = supabase
    .channel(`messages:${roomId}`)
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
      { event: "INSERT", schema: "public", table: "message_reactions", filter: `room_id=eq.${roomId}` },
      (payload) => onReactionChange("INSERT", payload.new)
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "message_reactions", filter: `room_id=eq.${roomId}` },
      (payload) => {
        onReactionChange("DELETE", payload.old);
        onReactionChange("INSERT", payload.new);
      }
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "message_reactions", filter: `room_id=eq.${roomId}` },
      (payload) => onReactionChange("DELETE", payload.old)
    )
    .subscribe((status) => {
      if (state.currentRoomId !== roomId || channel !== roomChannel) return;
      if (status === "SUBSCRIBED") {
        setRealtimeStatus("connected");
        if (historyLoadedRoomId === roomId) {
          syncMissedMessages(roomId).catch((error) => handleRealtimeSyncError(roomId, error));
        }
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setRealtimeStatus("reconnecting");
      } else if (status === "CLOSED") {
        setRealtimeStatus("offline");
      }
    });
  channel = roomChannel;
}

function unsubscribe() {
  if (channel && supabase) supabase.removeChannel(channel);
  channel = null;
}

function handleRealtimeSyncError(roomId, error) {
  if (state.currentRoomId !== roomId) return;
  setRealtimeStatus("offline");
  setComposerNotice(
    getRequestErrorMessage(error, "Couldn't sync new messages. Reopen this conversation to try again.")
  );
}

async function syncMissedMessages(roomId) {
  if (!supabase || state.currentRoomId !== roomId || historyLoadedRoomId !== roomId) return;
  if (catchUpTask?.roomId === roomId) return catchUpTask.promise;

  const promise = (async () => {
    let cursor = latestSyncedCursor;
    while (state.currentRoomId === roomId) {
      const batch = cursor
        ? await listMessagesAfter(roomId, cursor)
        : await listMessages(roomId);
      if (state.currentRoomId !== roomId || !batch.length) break;

      const roomKey = activeRoomKey;
      for (const message of batch) await decryptMessageContent(message, roomKey);
      if (state.currentRoomId !== roomId) break;

      const cut = localClearCut(roomId);
      const visible = cut
        ? batch.filter((message) => new Date(message.created_at).getTime() >= cut)
        : batch;
      const stickToBottom = isNearMessageBottom();
      state.messages = mergeMessageRows(state.messages, visible);
      cursor = latestMessageCursor(batch);
      advanceMessageCursor(batch);
      const newestIncoming = batch
        .filter((message) => message.sender_id !== state.currentUser?.id)
        .at(-1);
      if (newestIncoming) markCurrentRoomRead(roomId, newestIncoming.created_at);
      await loadAttachments(roomId, batch);
      if (state.currentRoomId !== roomId) break;
      loadMessageReactions(roomId, batch).catch(showReactionLoadError);
      publishRoomPreview(batch[batch.length - 1]);
      renderMessages({ stickToBottom });
      if (batch.length < PAGE_SIZE) break;
    }
  })();
  catchUpTask = { roomId, promise };
  try {
    await promise;
  } finally {
    if (catchUpTask?.promise === promise) catchUpTask = null;
  }
}

async function handleInsert(row) {
  if (state.currentRoomId !== row.room_id) return;
  advanceMessageCursor([row]);
  if (isClearedOut(row.room_id, row.created_at)) return;
  if (state.messages.some((message) => message.id === row.id)) return;

  const msg = normalize(row);
  const roomKey = activeRoomKey;
  const stickToBottom = isNearMessageBottom();
  await decryptMessageContent(msg, roomKey);
  if (state.currentRoomId !== row.room_id) return;
  const pendingIndex = state.messages.findIndex(
    (m) => (m.status === "sending" || m.status === "failed") &&
      m.sender_id === row.sender_id && !m.ciphertext
  );

  if (pendingIndex !== -1) {
    msg.body = msg.body || state.messages[pendingIndex].body;
    state.messages = mergeMessageRows(
      state.messages.filter((_, index) => index !== pendingIndex),
      [msg]
    );
  } else {
    state.messages = mergeMessageRows(state.messages, [msg]);
  }

  ensureSenderName(msg, row.room_id);
  publishRoomPreview(msg);
  renderMessages({ stickToBottom });
  if (row.sender_id !== state.currentUser?.id) {
    markCurrentRoomRead(row.room_id, row.created_at);
  }
}

async function handleUpdate(row) {
  if (state.currentRoomId !== row.room_id) return;
  const existing = state.messages.find((m) => m.id === row.id);
  if (!existing) return;
  const plain = existing.body;
  const updated = normalize(row);
  const roomKey = activeRoomKey;
  if (updated.iv && updated.ciphertext) {
    await decryptMessageContent(updated, roomKey);
    if (updated.body === NO_KEY_TEXT && plain) updated.body = plain;
  }
  if (state.currentRoomId !== row.room_id) return;
  const index = state.messages.findIndex((m) => m.id === row.id);
  if (index === -1) return;
  state.messages[index] = updated;
  publishRoomPreview(updated);
  renderMessages();
}

function handleDelete(row) {
  if (row.room_id && state.currentRoomId !== row.room_id) return;
  const before = state.messages.length;
  state.messages = state.messages.filter((m) => m.id !== row.id);
  if (state.messages.length !== before) renderMessages();
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
    if (state.currentRoomId !== roomId) return;
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

function messageReactionsHtml(message) {
  const reactions = reactionsByMessage.get(message.id) || [];
  const groups = REACTION_OPTIONS.map((emoji) => {
    const matches = reactions.filter((reaction) => reaction.emoji === emoji);
    if (!matches.length) return "";
    const mine = matches.some((reaction) => reaction.user_id === state.currentUser?.id);
    return `<button type="button" class="reaction-chip ${mine ? "mine" : ""}" data-reaction-toggle="${emoji}" aria-label="${emoji}, ${matches.length} reaction${matches.length === 1 ? "" : "s"}" aria-pressed="${mine}">${emoji}<span>${matches.length}</span></button>`;
  }).join("");
  return groups ? `<div class="reaction-chip-row">${groups}</div>` : "";
}

function reactionPickerHtml() {
  return `
    <div class="msg-reaction-picker is-hidden" role="group" aria-label="Choose a reaction">
      ${REACTION_OPTIONS.map((emoji) =>
        `<button type="button" data-reaction-choice="${emoji}" aria-label="React with ${emoji}">${emoji}</button>`
      ).join("")}
    </div>`;
}

function messageHtml(msg) {
  const own = msg.sender_id === state.currentUser?.id;
  const deleted = !!msg.deleted_at;
  const persisted = !msg.status && !String(msg.id).startsWith("pending-");

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

  const attachHtml = deleted ? "" : renderAttachmentsBlock(msg);
  const failureHtml = own && msg.status === "failed" && msg.failureReason
    ? `<span class="msg-send-error">${escapeHtml(msg.failureReason)}</span>`
    : "";
  const menuHtml = !deleted && persisted
    ? `<div class="msg-menu">
         <button type="button" class="msg-menu-btn" data-menu aria-label="Message actions">⋯</button>
         <div class="msg-menu-list is-hidden">
           <button type="button" data-action="reply">Reply</button>
           <button type="button" data-action="react">React</button>
           ${own && msg.body && msg.body !== LOCKED_TEXT && msg.body !== NO_KEY_TEXT
             ? '<button type="button" data-action="edit">Edit text</button>'
             : ""}
           ${own ? '<button type="button" data-action="delete" class="danger">Delete</button>' : ""}
         </div>
       </div>`
    : "";

  return `
    <div class="msg ${own ? "own" : "other"}" data-id="${msg.id}">
      ${own ? menuHtml : ""}
      <div class="msg-content-wrap">
        <div class="bubble ${deleted ? "bubble-deleted" : ""}">
          ${sender}
          ${replyQuote}
          <span class="bubble-text">${text}</span>
          ${attachHtml}
          ${failureHtml}
          <span class="bubble-meta">${formatTime(msg.created_at)}${edited}${status}</span>
        </div>
        ${persisted && !deleted ? messageReactionsHtml(msg) + reactionPickerHtml() : ""}
      </div>
      ${own ? "" : menuHtml}
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
      if (att.mime_type.startsWith("audio/")) {
        return `
          <div class="attach-audio">
            <span class="attach-audio-label">Voice note</span>
            <audio class="attach-audio-player" data-attach-audio="${att.id}" controls preload="metadata" aria-label="Voice note"></audio>
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
    if (!att || !activeRoomKey) return;
    const roomId = state.currentRoomId;
    decryptAttachment(att, activeRoomKey)
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        if (state.currentRoomId !== roomId) {
          URL.revokeObjectURL(url);
          return;
        }
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

  document.querySelectorAll("[data-attach-audio]").forEach((audio) => {
    const id = audio.dataset.attachAudio;
    const cached = remoteUrlCache.get(id);
    if (cached) {
      audio.src = cached;
      return;
    }
    const att = currentAttachmentById(id);
    if (!att || !activeRoomKey || audio.dataset.loading === "true") return;
    audio.dataset.loading = "true";
    const roomId = state.currentRoomId;
    decryptAttachment(att, activeRoomKey)
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        if (state.currentRoomId !== roomId) {
          URL.revokeObjectURL(url);
          return;
        }
        remoteUrlCache.set(id, url);
        const el = document.querySelector(`[data-attach-audio="${id}"]`);
        if (el) {
          el.src = url;
          el.load();
        }
      })
      .catch(() => {
        const el = document.querySelector(`[data-attach-audio="${id}"]`);
        if (el) {
          el.dataset.loading = "false";
          el.title = "Couldn't load voice note";
        }
      });
  });
}

function renderMessages({ stickToBottom = false } = {}) {
  const el = dom.messagesEl;
  if (!el) return;

  const prevScroll = el.scrollTop;
  editingId = null;

  if (state.messagesLoading && !state.messages.length) {
    el.setAttribute("aria-busy", "true");
    el.innerHTML = `
      <div class="chat-message-skeleton-list" aria-label="Loading messages">
        ${Array.from({ length: 4 }, (_, index) => `
          <div class="chat-message-skeleton ${index % 2 ? "other" : "own"}" aria-hidden="true">
            <i class="skeleton-block"></i><i class="skeleton-block"></i>
          </div>`).join("")}
      </div>`;
    return;
  }
  el.removeAttribute("aria-busy");

  if (!state.messages.length) {
    if (roomLoadError) {
      el.innerHTML = `
        <div class="chat-load-notice" role="alert">
          <span>${escapeHtml(roomLoadError)}</span>
          <button type="button" class="chat-load-retry" data-retry-room-load>Retry</button>
        </div>`;
      el.querySelector("[data-retry-room-load]")?.addEventListener("click", () => {
        if (state.currentRoomId) openRoom(state.currentRoomId);
      });
      return;
    }
    el.innerHTML = `
      <div class="chat-welcome chat-new-conversation">
        <div class="new-chat-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 6h16M4 12h16M4 18h10" />
            <circle cx="19" cy="18" r="2.5" />
          </svg>
        </div>
        <h3>New conversation</h3>
        <p>Say hi to start messaging</p>
      </div>`;
    return;
  }

  let html = "";
  let currentDay = "";
  const roomId = state.currentRoomId;

  state.messages.forEach((msg) => {
    if (roomId && isClearedOut(roomId, msg.created_at)) return;
    const day = new Date(msg.created_at).toDateString();
    if (day !== currentDay) {
      currentDay = day;
      html += `<div class="day-divider"><span>${dayLabel(msg.created_at)}</span></div>`;
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

  msgEl.querySelector(".msg-content-wrap")?.classList.add("editing-wrap");
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
  document.querySelectorAll(".msg-reaction-picker").forEach((picker) => {
    picker.classList.add("is-hidden");
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

function handleMessagesClick(event) {
  const menuBtn = event.target.closest("[data-menu]");
  if (menuBtn) {
    const list = menuBtn.parentElement.querySelector(".msg-menu-list");
    const willOpen = list.classList.contains("is-hidden");
    closeMenus(list);
    list.classList.toggle("is-hidden", !willOpen);
    return;
  }

  const msgEl = event.target.closest(".msg");
  if (!msgEl) {
    closeMenus();
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

  const reactionChoice = event.target.closest("[data-reaction-choice]");
  if (reactionChoice) {
    closeMenus();
    msgEl.querySelector(".msg-reaction-picker")?.classList.add("is-hidden");
    toggleMessageReaction(message, reactionChoice.dataset.reactionChoice);
    return;
  }

  const reactionToggle = event.target.closest("[data-reaction-toggle]");
  if (reactionToggle) {
    toggleMessageReaction(message, reactionToggle.dataset.reactionToggle);
    return;
  }

  if (event.target.closest("[data-edit-cancel]")) {
    editingId = null;
    renderMessages();
    return;
  }

  if (event.target.closest("[data-action='react']")) {
    closeMenus();
    const picker = msgEl.querySelector(".msg-reaction-picker");
    picker?.classList.toggle("is-hidden");
  } else if (event.target.closest("[data-action='reply']")) {
    closeMenus();
    startReply(message);
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

  try {
    const older = await listMessages(roomId, oldest);
    if (state.currentRoomId !== roomId) return;

    const roomKey = activeRoomKey;
    for (const msg of older) await decryptMessageContent(msg, roomKey);
    if (state.currentRoomId !== roomId) return;
    await loadAttachments(roomId, older);
    if (state.currentRoomId !== roomId) return;
    loadMessageReactions(roomId, older).catch(showReactionLoadError);
    const cut = localClearCut(roomId);
    const kept = cut
      ? older.filter((m) => new Date(m.created_at).getTime() >= cut)
      : older;
    if (older.length < PAGE_SIZE) state.hasMoreMessages = false;
    state.messages = mergeMessageRows(state.messages, kept);
    state.messagesLoading = false;

    renderMessages();
    if (el) el.scrollTop = el.scrollHeight - prevHeight;
  } catch (error) {
    if (state.currentRoomId !== roomId) return;
    state.messagesLoading = false;
    setComposerNotice(
      getRequestErrorMessage(error, "Older messages couldn't be loaded. Scroll up to try again.")
    );
  }
}

export async function openRoom(roomId) {
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room || !supabase) return;

  if (state.currentRoomId !== roomId) stopVoiceRecording(true);
  unsubscribe();
  activeRoomKey = null;
  latestSyncedCursor = null;
  historyLoadedRoomId = null;
  catchUpTask = null;
  state.currentRoomId = roomId;
  roomLoadError = "";
  state.messages = [];
  state.messagesLoading = true;
  state.hasMoreMessages = true;
  revokeRemoteUrls();
  attachmentCache = new Map();
  reactionsByMessage = new Map();
  clearPendingMedia();
  replyTarget = null;
  renderReplyBar();

  renderMessages();
  setComposerNotice("");
  setRealtimeStatus("connecting");

  let loadStage = "room members";
  try {
    await loadMembers(roomId);
    if (state.currentRoomId !== roomId) return;

    loadStage = "room access";
    const isAdmin = await canManageRoom(roomId);
    if (state.currentRoomId !== roomId) return;

    subscribeToRoom(roomId);

    let roomKey;
    let roomKeyError = null;
    loadStage = "encryption key";
    try {
      if (isAdmin) {
        roomKey = await ensureRoomKey(roomId);
        if (roomKey) await shareMissingKeys(roomId);
      } else {
        roomKey = await getRoomKey(roomId);
      }
    } catch (error) {
      roomKeyError = error;
    }
    if (state.currentRoomId !== roomId) return;
    activeRoomKey = roomKey || null;

    loadStage = "message history";
    const messages = await listMessages(roomId);

    // The user may have switched rooms while history was loading.
    if (state.currentRoomId !== roomId) return;

    for (const msg of messages) await decryptMessageContent(msg, roomKey);
    if (state.currentRoomId !== roomId) return;

    // Drop messages this user previously cleared locally ("clear chat for me").
    const cut = localClearCut(roomId);
    const visible = cut
      ? messages.filter((m) => new Date(m.created_at).getTime() >= cut)
      : messages;
    state.messages = mergeMessageRows(state.messages, visible);
    advanceMessageCursor(state.messages);
    state.hasMoreMessages = messages.length === PAGE_SIZE;
    state.messagesLoading = false;
    loadStage = "attachments";
    await loadAttachments(roomId, messages);
    if (state.currentRoomId !== roomId) return;
    renderMessages({ stickToBottom: true });
    historyLoadedRoomId = roomId;
    loadMessageReactions(roomId, messages).catch(showReactionLoadError);
    const newestIncoming = messages
      .filter((message) => message.sender_id !== state.currentUser?.id)
      .at(-1);
    if (newestIncoming) markCurrentRoomRead(roomId, newestIncoming.created_at);

    if (!activeRoomKey && visible.length) {
      setComposerNotice(
        roomKeyError
          ? getRequestErrorMessage(
              roomKeyError,
              "This device couldn't unlock the conversation's saved encryption key. Sign in again on a device with the original key."
            )
          : isAdmin
            ? "No encryption key is available for this room."
            : NO_KEY_TEXT
      );
    }

    syncMissedMessages(roomId).catch((error) => handleRealtimeSyncError(roomId, error));
  } catch (error) {
    // A room-key or decryption failure must never hang the chat or surface an
    // unhandled rejection: end the loading state and explain what happened.
    if (state.currentRoomId !== roomId) return;
    if (loadStage !== "attachments") state.messages = [];
    state.messagesLoading = false;
    const fallback = {
      "room members": "Conversation members couldn't be loaded. Try again.",
      "room access": "Conversation access couldn't be checked. Try again.",
      "message history": "Messages couldn't be loaded. Check your connection and try again.",
      attachments: "Message attachments couldn't be loaded. Try again.",
    }[loadStage];
    roomLoadError = getRequestErrorMessage(error, fallback);
    if (state.messages.length) {
      setComposerNotice(roomLoadError);
      roomLoadError = "";
    }
    renderMessages();
    setRealtimeStatus("offline");
  }
}

export function closeRoom() {
  stopVoiceRecording(true);
  unsubscribe();
  latestSyncedCursor = null;
  historyLoadedRoomId = null;
  catchUpTask = null;
  setRealtimeStatus("offline");
  editingId = null;
  activeRoomKey = null;
  state.messages = [];
  state.currentRoomId = null;
  revokeRemoteUrls();
  attachmentCache = new Map();
  reactionsByMessage = new Map();
  clearPendingMedia();
  replyTarget = null;
  renderReplyBar();
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
const send = async () => {
    const roomId = state.currentRoomId;
    const body = dom.composerInput.value.trim();
    const hasMedia = pendingMedia.length > 0;
    if (!roomId || (!body && !hasMedia) || !supabase) return;

    const sendCaption = body;
    dom.composerInput.value = "";
    autoGrow(dom.composerInput);
    hideMentionMenu();

  // Provide immediate feedback on the send button so the user knows work started.
  try {
    setButtonLoading(dom.btnSend, true, hasMedia ? "Uploading…" : "Sending…");
    if (hasMedia) {
      await sendMediaMessages(roomId, sendCaption);
    } else {
      await sendMessage(roomId, body);
    }
  } finally {
    setButtonLoading(dom.btnSend, false);
  }
};

dom.btnSend?.addEventListener("click", (e) => {
  e.preventDefault();
  // Fire-and-forget: the async send handles its own errors and clears loading.
  send().catch(() => {});
});

dom.composerInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send().catch(() => {});
  }
});

  dom.replyCancel?.addEventListener("click", clearReply);

  dom.btnAttach?.addEventListener("click", () => dom.attachInput?.click());
  dom.btnRecordVoice?.addEventListener("click", async (e) => {
    // If already recording, stop immediately without extra loading UI.
    if (voiceRecorder && voiceRecorder.state !== "inactive") {
      stopVoiceRecording();
      return;
    }

    // When starting the microphone prompt, show a short-lived loading state so
    // the user knows the browser is requesting permissions / preparing devices.
    try {
      setButtonLoading(dom.btnRecordVoice, true, "Starting…");
      await startVoiceRecording();
    } catch (err) {
      // startVoiceRecording handles user-visible errors; we still ensure loading clears.
    } finally {
      setButtonLoading(dom.btnRecordVoice, false);
    }
  });
  dom.attachInput?.addEventListener("change", (e) => {
    if (e.target.files?.length) addPendingFiles([...e.target.files]);
    e.target.value = "";
  });
  dom.attachPreviewList?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove-attach]");
    if (btn) removePendingFile(Number(btn.dataset.removeAttach));
  });

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
    showChatList();
  });
}

function initCloseChat() {
  dom.btnCloseChat?.addEventListener("click", () => {
    closeRoom();
    showChatList();
  });
}

export function initChat() {
  initComposer();
  initMentionMenu();
  initMobileBack();
  initCloseChat();
}
