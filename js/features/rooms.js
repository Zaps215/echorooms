// Room listing, selection, and creation backed by Supabase.
//
// Loads the user's rooms (via the room_members join), renders them in the left
// sidebar, handles room selection and the info panel's member list, and drives
// the create-room dialog through the create_room RPC.

import * as dom from "../core/dom.js";
import { state } from "../core/state.js";
import { supabase } from "../core/supabase.js";
import {
  showError,
  hideError,
  escapeHtml,
  avatarColor,
  getRequestErrorMessage,
  logAppError,
} from "../core/utils.js";
import { showRoomChat, closeInfo, showChatList, showChannelList } from "../core/navigation.js";
import { showConfirm } from "../core/confirm.js";
import { openRoom, closeRoom, getRoomMembers, setComposerNotice, clearLocalMessages } from "./chat.js";
import { chatHeaderView } from "../core/chat-header.js";
import { isUserOnline, subscribeToPresence } from "../core/presence.js";
import { decryptAttachment, isImageMime } from "./media.js";
import { getIdentity, createRoomKey, getRoomKey, shareRoomKey, canManageRoom } from "../core/keyring.js";
import * as crypto from "../core/crypto.js";
import { needsUsername, openUsernameDialog } from "./profile.js";
import { renderChannelList } from "./channels.js";
import { unreadCount } from "./unread.js";

const ROOM_PALETTE = [
  "#2563eb",
  "#7c3aed",
  "#0d9488",
  "#ea580c",
  "#db2777",
  "#4f46e5",
  "#059669",
  "#b45309",
];

const ROOM_PREVIEW_COLUMNS = "id, room_id, sender_id, body, iv, ciphertext, deleted_at, created_at";

// Cached member rows + admin flag so member events re-render without a fresh
// room_members query on every realtime update.
let membersCache = [];
let membersCacheRoomId = null;
let membersCacheIsAdmin = false;
let roomsLoadError = "";

let otherContact = null; // counterparty profile in a direct chat
let mediaGridUrls = [];

function resetInfoState() {
  otherContact = null;
  revokeMediaGridUrls();
}

function revokeMediaGridUrls() {
  mediaGridUrls.forEach((u) => URL.revokeObjectURL(u));
  mediaGridUrls = [];
}

function renderMembersList() {
  if (!dom.memberList) return;
  if (!membersCache.length) {
    dom.memberList.innerHTML =
      '<li style="color:var(--muted-2);font-size:13px">No members yet.</li>';
    return;
  }
  if (dom.memberCount) dom.memberCount.textContent = String(membersCache.length);
  const currentUserId = state.currentUser?.id;

  dom.memberList.innerHTML = membersCache
    .map((m) => {
      const p = m.profiles || {};
      const name = p.display_name || p.username || "Member";
      const isMe = m.user_id === currentUserId;
      return `
        <li>
          <span class="member-avatar" style="background:${avatarColor(name)}">${escapeHtml(name.charAt(0).toUpperCase())}</span>
          <span class="member-name">${escapeHtml(name)}${isMe ? " (you)" : ""}</span>
        </li>`;
    })
    .join("");
}

function renderRooms(filterText = "") {
  renderFeedRooms();
  if (state.activeTab === "channels") {
    renderChannelList(filterText);
    return;
  }
  const filtered = state.rooms.filter((r) =>
    r.name.toLowerCase().includes(filterText.toLowerCase())
  );
  const tabFiltered = filtered.filter((r) => {
    if (state.activeTab === "groups") return r.room_type === "group";
    return true;
  });
  const loadError = roomsLoadError
    ? `<div class="rooms-load-error" role="alert">
         <span>${escapeHtml(roomsLoadError)}</span>
         <button type="button" data-retry-rooms>Retry</button>
       </div>`
    : "";

  if (!tabFiltered.length) {
    dom.roomList.innerHTML = loadError ||
      '<p style="padding: 16px; text-align: center; color: var(--muted); font-size: 13px;">No rooms found.</p>';
    dom.roomList.querySelector("[data-retry-rooms]")?.addEventListener("click", () => loadRooms());
    return;
  }

  function renderFeedRooms() {
    if (!dom.feedRoomList) return;
    if (!state.rooms.length) {
      if (roomsLoadError) {
        dom.feedRoomList.innerHTML = `
          <p class="feed-rooms-empty" role="alert">
            ${escapeHtml(roomsLoadError)}
            <button type="button" data-retry-rooms>Retry</button>
          </p>`;
        dom.feedRoomList.querySelector("[data-retry-rooms]")?.addEventListener("click", () => loadRooms());
      } else {
        dom.feedRoomList.innerHTML =
          '<p class="feed-rooms-empty">Your chats will show up here once you start a conversation.</p>';
      }
      return;
    }

    dom.feedRoomList.innerHTML = state.rooms
      .slice(0, 6)
      .map((room) => {
        const hash = room.name.charCodeAt(0) % ROOM_PALETTE.length;
        const initial = room.name.trim().charAt(0).toUpperCase() || "?";
        const kind = room.room_type === "direct" ? "Direct chat" : "Group";
        return `
          <button class="feed-room" type="button" data-room-id="${room.id}">
            <span class="feed-room-avatar" style="--room-color:${ROOM_PALETTE[hash]}">${escapeHtml(initial)}</span>
            <span class="feed-room-copy">
              <span class="feed-room-name">${escapeHtml(room.name)}</span>
              <span class="feed-room-kind">${kind}</span>
            </span>
            ${unreadBadge(room.id)}
            <span class="feed-room-arrow" aria-hidden="true">↗</span>
          </button>`;
      })
      .join("");

    dom.feedRoomList.querySelectorAll(".feed-room").forEach((button) => {
      button.addEventListener("click", () => selectRoom(button.dataset.roomId));
    });
  }

  dom.roomList.innerHTML = loadError + tabFiltered
    .map((room) => {
      const hash = room.name.charCodeAt(0) % ROOM_PALETTE.length;
      const bg = ROOM_PALETTE[hash];
      const isActive = room.id === state.currentRoomId;
      const initial = room.name.trim().charAt(0).toUpperCase() || "?";
      const activityTime = formatRoomTime(room.last_message_at);
      const preview = room.last_preview || "No messages yet";
      const unread = unreadCount(room.id);

      return `
      <button class="room-item ${isActive ? "active" : ""}" data-room-id="${room.id}" type="button" aria-pressed="${isActive}">
        <span class="room-avatar" style="background: ${bg}">${escapeHtml(initial)}</span>
        <span class="room-main">
          <span class="room-top">
            <span class="room-name">${escapeHtml(room.name)}</span>
            <span class="room-time">${activityTime}</span>
          </span>
          <span class="room-preview">
            <span class="room-last">${escapeHtml(preview)}</span>
            ${unreadBadge(room.id)}
          </span>
        </span>
      </button>
    `;
    })
    .join("");

  dom.roomList.querySelectorAll(".room-item").forEach((btn) => {
    btn.addEventListener("click", () => selectRoom(btn.dataset.roomId));
  });
  dom.roomList.querySelector("[data-retry-rooms]")?.addEventListener("click", () => loadRooms());
}

function unreadBadge(roomId) {
  const count = unreadCount(roomId);
  if (!count) return "";
  const label = count > 99 ? "99+" : String(count);
  return `<span class="unread-badge" aria-label="${count} unread messages">${label}</span>`;
}

function formatRoomTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const elapsed = now.getTime() - date.getTime();
  if (elapsed < 0 || date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (elapsed < 7 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString([], { weekday: "short" });
  }
  return date.toLocaleDateString([], { month: "numeric", day: "numeric" });
}

function roomPreviewText(message) {
  if (message.deleted_at) return "Message deleted";
  const body = message.body || (message.ciphertext ? "" : "Shared an attachment");
  return `${message.sender_id === state.currentUser?.id ? "You: " : ""}${body || "Encrypted message"}`;
}

function isPreviewCleared(roomId, createdAt) {
  try {
    const clearedAt = Number(localStorage.getItem(`echorooms:cleared:${roomId}`)) || 0;
    return clearedAt > 0 && new Date(createdAt).getTime() < clearedAt;
  } catch (error) {
    return false;
  }
}

async function loadRoomPreviews(rooms) {
  if (!supabase || !rooms.length) return;
  const roomIds = rooms.map((room) => room.id);
  let data;
  let error;
  try {
    ({ data, error } = await supabase
      .from("messages")
      .select(ROOM_PREVIEW_COLUMNS)
      .in("room_id", roomIds)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(Math.min(1000, Math.max(100, rooms.length * 20))));
  } catch (requestError) {
    if (state.rooms !== rooms) return;
    logAppError("room-preview", requestError);
    rooms.forEach((room) => { room.last_preview = "Preview unavailable"; });
    renderRooms(dom.roomSearch?.value || "");
    return;
  }

  if (state.rooms !== rooms) return;
  if (error) {
    logAppError("room-preview", error);
    rooms.forEach((room) => { room.last_preview = "Preview unavailable. Open chat to retry."; });
    renderRooms(dom.roomSearch?.value || "");
    return;
  }

  const latestByRoom = new Map();
  for (const message of data || []) {
    if (!latestByRoom.has(message.room_id)) latestByRoom.set(message.room_id, message);
  }

  await Promise.all(rooms.map(async (room) => {
    const message = latestByRoom.get(room.id);
    if (!message || isPreviewCleared(room.id, message.created_at)) {
      room.last_preview = "No messages yet";
      room.last_message_at = null;
      room.last_message_id = null;
      return;
    }

    if (message.iv && message.ciphertext && !message.deleted_at) {
      try {
        const key = await getRoomKey(room.id);
        if (state.rooms !== rooms) return;
        message.body = key
          ? await crypto.decryptMessage(key, message.iv, message.ciphertext)
          : null;
      } catch (decryptError) {
        message.body = null;
      }
    }

    room.last_message_id = message.id;
    room.last_message_at = message.created_at;
    room.last_preview = roomPreviewText(message);
  }));

  if (state.rooms === rooms) renderRooms(dom.roomSearch?.value || "");
}

function updateRoomPreview(event) {
  const { roomId, message } = event.detail || {};
  const room = state.rooms.find((item) => item.id === roomId);
  if (!room || !message) return;
  if (isPreviewCleared(roomId, message.created_at)) return;
  if (
    room.last_message_at &&
    (message.created_at < room.last_message_at ||
      (message.created_at === room.last_message_at &&
        room.last_message_id &&
        message.id < room.last_message_id))
  ) return;
  room.last_message_id = message.id;
  room.last_message_at = message.created_at;
  room.last_preview = roomPreviewText(message);
  renderRooms(dom.roomSearch?.value || "");
}

function clearRoomPreview(event) {
  const room = state.rooms.find((item) => item.id === event.detail?.roomId);
  if (!room) return;
  room.last_preview = "No messages yet";
  room.last_message_at = null;
  room.last_message_id = null;
  renderRooms(dom.roomSearch?.value || "");
}

async function renderRoomInfo(room) {
  if (!supabase || !room) return;
  if (dom.infoHeadSub) dom.infoHeadSub.textContent =
    room.room_type === "direct" ? "Contact info" : "Room details";
  if (dom.memberList) dom.memberList.innerHTML = "";
  if (dom.memberCount) dom.memberCount.textContent = "0";
  if (dom.infoMediaGrid) dom.infoMediaGrid.innerHTML = "";
  if (dom.infoMediaEmpty) dom.infoMediaEmpty.hidden = false;

  const isAdmin = await canManageRoom(room.id);
  if (dom.btnDissolveRoom) {
    dom.btnDissolveRoom.classList.toggle("is-hidden", !isAdmin);
  }
  membersCacheIsAdmin = isAdmin;

  // Inviting is a group-only affordance; DMs are two people by definition.
  dom.btnInvite?.classList.toggle("is-hidden", room.room_type !== "group");

  resetInfoState();

  const [{ data: roomData }, { data: membersData }] = await Promise.all([
    supabase
      .from("rooms")
      .select("id, name, room_type, created_by, deleted_at")
      .eq("id", room.id)
      .single(),
    supabase
      .from("room_members")
      .select("user_id, role, profiles(display_name, username, status_text)")
      .eq("room_id", room.id),
  ]);

  if (state.currentRoomId !== room.id) return;

  const roomRow = roomData || {};
  membersCache = membersData || [];
  membersCacheRoomId = room.id;

  renderMembersList();
  renderRoomHero(roomRow);
  loadMediaGallery(room.id);

  // Direct chats: identify the counterparty.
  if (room.room_type === "direct") {
    const other = (membersCache || []).find((m) => m.user_id !== state.currentUser?.id);
    otherContact = other?.profiles || null;
    renderContactInfo();
  }
}

function renderRoomHero(room) {
  if (!dom.infoRoomName || !dom.infoRoomAvatar) return;
  dom.infoRoomName.textContent = room.name || "";
  const tag =
    room.room_type === "direct"
      ? "Direct chat"
      : `${room.room_type === "group" ? "Group" : "Room"} · ${membersCache.length} members`;
  if (dom.infoRoomTag) dom.infoRoomTag.textContent = tag;

  dom.infoRoomAvatar.textContent =
    (room.name || "?").trim().charAt(0).toUpperCase() || "?";
  dom.infoRoomAvatar.classList.remove("has-img");
  dom.infoRoomAvatar.style.backgroundImage = "";
  dom.infoRoomAvatar.style.background = avatarColor(room.name);
}

function renderContactInfo() {
  if (!otherContact || !dom.infoRoomName) return;
  const c = otherContact;
  const name = c.display_name || c.username || "Contact";
  dom.infoRoomName.textContent = name;
  if (dom.infoRoomDesc) {
    dom.infoRoomDesc.textContent = c.username ? `@${c.username}` : "";
    dom.infoRoomDesc.hidden = !c.username;
  }
  if (dom.infoRoomTag) {
    dom.infoRoomTag.textContent = `Direct chat · ${c.status_text ? c.status_text : "No status"}`;
  }
  dom.infoRoomAvatar.textContent = name.trim().charAt(0).toUpperCase();
  dom.infoRoomAvatar.style.background = avatarColor(name);
  dom.infoRoomAvatar.classList.remove("has-img");
  dom.infoRoomAvatar.style.backgroundImage = "";
}

async function loadMediaGallery(roomId) {
  const grid = dom.infoMediaGrid;
  const empty = dom.infoMediaEmpty;
  if (!grid) return;
  revokeMediaGridUrls();
  grid.innerHTML = "";
  if (empty) empty.hidden = false;

  const { data: media } = await supabase
    .from("attachments")
    .select("id, mime_type, storage_path, iv, name")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(40);

  const images = (media || []).filter((m) => isImageMime(m.mime_type)).slice(0, 24);
  if (!images.length) return;
  if (empty) empty.hidden = true;

  const key = await getRoomKey(roomId).catch(() => null);
  if (!key) {
    grid.innerHTML = "";
    if (empty) {
      empty.textContent = "No encryption key available to preview media.";
      empty.hidden = false;
    }
    return;
  }

  grid.innerHTML = images
    .map(
      () =>
        `<button type="button" class="media-thumb"><span class="attach-loading"><span class="spinner-ring"></span></span></button>`
    )
    .join("");

  const buttons = [...grid.querySelectorAll(".media-thumb")];
  await Promise.all(
    buttons.map(async (btn, i) => {
      const att = images[i];
      try {
        const blob = await decryptAttachment(att, key);
        const url = URL.createObjectURL(blob);
        mediaGridUrls.push(url);
        btn.innerHTML = `<img src="${url}" alt="">`;
        btn.dataset.mediaUrl = url;
      } catch (err) {
        btn.innerHTML = '<span class="media-thumb-broken">×</span>';
      }
    })
  );
}

 /**
 * Header avatar + subtitle for the open room. A direct room shows the other
 * participant; a group shows its own initials and a member count, since no
 * single user represents it.
 */
function renderChatHeader() {
  const room = state.rooms.find((r) => r.id === state.currentRoomId);
  if (!room || !dom.chatAvatar) return;

  const view = chatHeaderView({
    room,
    members: getRoomMembers(room.id),
    currentUserId: state.currentUser?.id,
  });
  if (!view) return;

  dom.chatAvatar.textContent = view.label.charAt(0).toUpperCase();
  dom.chatAvatar.style.background = avatarColor(view.label);
  if (dom.chatSubtitle) dom.chatSubtitle.textContent = view.subtitle;
  if (dom.peerPresence) {
    const showPresence = view.kind === "direct" && !!view.peerId;
    const online = showPresence && isUserOnline(view.peerId);
    dom.peerPresence.classList.toggle("is-hidden", !showPresence);
    dom.peerPresence.dataset.state = online ? "online" : "offline";
    dom.peerPresence.setAttribute("aria-label", online ? "Online" : "Offline");
    const label = dom.peerPresence.querySelector(".peer-presence-label");
    if (label) label.textContent = online ? "Online" : "Offline";
  }
}

export function selectRoom(roomId) {
  state.currentRoomId = roomId;
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return;

  if (state.activeTab === "channels" || (state.activeTab === "groups" && room.room_type !== "group")) {
    state.activeTab = "all";
  }
  dom.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === state.activeTab));
  dom.chatTitle.textContent = room.name;
  dom.chatSubtitle.textContent =
    room.room_type === "direct" ? "Direct conversation" : "Group room";
  renderChatHeader();
  showRoomChat();
  window.dispatchEvent(new CustomEvent("echorooms:room-selected", {
    detail: { roomId, roomType: room.room_type },
  }));

  if (dom.info) dom.info.classList.remove("is-hidden");

  openRoom(roomId).then(() => {
    // Member rows and the room key arrive after selectRoom returns, so the
    // peer avatar can only be resolved once the room has opened.
    if (state.currentRoomId === roomId) renderChatHeader();
  });
  renderRoomInfo(room);
  renderRooms();
}

export async function loadRooms() {
  const userId = state.currentUser?.id;
  if (!supabase || !userId) return 0;
  let data;
  let error;
  if (!state.rooms.length && dom.roomList) {
    dom.roomList.innerHTML = `
      <div class="room-skeleton-list" aria-label="Loading conversations" aria-busy="true">
        ${Array.from({ length: 5 }, () => `
          <div class="room-skeleton">
            <span class="skeleton-block room-skeleton-avatar"></span>
            <span class="room-skeleton-copy"><i class="skeleton-block"></i><i class="skeleton-block"></i></span>
          </div>`).join("")}
      </div>`;
  }
  try {
    ({ data, error } = await supabase
      .from("room_members")
      .select("joined_at, deleted_at, rooms(id, name, room_type, created_at, last_message_at, deleted_at)")
      .eq("user_id", userId)
      .order("joined_at", { ascending: false }));
  } catch (requestError) {
    error = requestError;
  }
  if (state.currentUser?.id !== userId) return 0;

  if (error) {
    logAppError("rooms", error);
    roomsLoadError = getRequestErrorMessage(
      error,
      "Your conversations couldn't be loaded. Check your connection and try again."
    );
    renderRooms(dom.roomSearch?.value || "");
    return 0;
  }

  roomsLoadError = "";
  state.rooms = (data || [])
    .filter((m) => !m.deleted_at && m.rooms && !m.rooms.deleted_at)
    .map((m) => m.rooms);
  renderRooms();
  loadRoomPreviews(state.rooms);

  return state.rooms.length;
}

export function openRoomDialog() {
  hideError(dom.roomError);
  closeInfo();
  dom.roomForm.reset();
  dom.roomDialog.showModal();
  dom.roomName.focus();
}

function initRoomDialog() {
  dom.btnNewRoom?.addEventListener("click", (e) => {
    e.preventDefault();
    openRoomDialog();
  });

  dom.roomDialogClose?.addEventListener("click", () => dom.roomDialog.close());
  dom.roomCancel?.addEventListener("click", () => dom.roomDialog.close());

  dom.roomForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!supabase) return;

    const submitBtn = dom.findPrimaryButton(dom.roomForm);
    submitBtn.disabled = true;
    hideError(dom.roomError);

    try {
      const result = await supabase.rpc("create_room", {
        room_name: dom.roomName.value.trim(),
      });

      if (result.error || !result.data || !result.data[0]) {
        showError(dom.roomError, "Could not create room. Please try again.");
        submitBtn.disabled = false;
        return;
      }

      const room = result.data[0];
      // The creator provisions the room's AES key up front.
      await createRoomKey(room.id, [
        { id: state.currentUser.id, public_key: getIdentity()?.publicKeyB64 },
      ]);

      state.rooms.unshift(room);
      renderRooms();
      selectRoom(room.id);
      dom.roomDialog.close();
      dom.roomForm.reset();
    } catch (error) {
      showError(dom.roomError, "Could not create room. Please try again.");
      submitBtn.disabled = false;
    }
  });
}

function initSidebar() {
  dom.roomSearch?.addEventListener("input", (e) => renderRooms(e.target.value));

  dom.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const previousTab = state.activeTab;
      dom.tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      state.activeTab = tab.dataset.tab;
      if (state.activeTab === "channels") showChannelList();
      else if (previousTab === "channels") showChatList();
      renderRooms(dom.roomSearch ? dom.roomSearch.value : "");
    });
  });
}

// --- Direct messages -------------------------------------------------------

// Cache of the latest DM search results so clicks can hand off full rows.
const dmResultsMap = new Map();

function openDmDialog() {
  // People are found by @username, so claim one first if it's still missing.
  if (needsUsername()) {
    openUsernameDialog();
    return;
  }
  hideError(dom.dmError);
  closeInfo();
  dom.dmForm.reset();
  dom.dmResults.innerHTML = "";
  dmResultsMap.clear();
  dom.dmDialog.showModal();
  dom.dmUsername.focus();
}

function dmResultHtml(user) {
  const name = user.display_name || user.username;
  return `
    <li>
      <button type="button" class="dm-result" data-user-id="${user.id}" data-username="${escapeHtml(
    user.username || ""
  )}" data-name="${escapeHtml(name)}">
        <span class="member-avatar" style="background:${avatarColor(name)}">${escapeHtml(
    name.charAt(0).toUpperCase()
  )}</span>
        <span class="member-name">${escapeHtml(name)}</span>
        <span class="dm-handle">@${escapeHtml(user.username || "")}</span>
      </button>
    </li>`;
}

async function startDm(user) {
  const result = await supabase.rpc("create_direct_room", {
    other_user_id: user.id,
  });

  if (result.error || !result.data || !result.data[0]) {
    // Supabase returns RPC failures in the response rather than throwing, so
    // without this the database's reason (a missing column, an ambiguous
    // reference, a policy denial) never reaches the console at all.
    if (import.meta.env.DEV && result.error) {
      console.warn("[dm] create_direct_room failed:", result.error.message);
    }
    showError(dom.dmError, "Could not start that conversation. Try again.");
    return;
  }

  const room = result.data[0];

  const existingKey = await getRoomKey(room.id).catch(() => null);
  if (existingKey) {
    // Reused direct room: only top up the other member's copy if missing.
    await shareRoomKey(room.id, user.id, user.public_key);
  } else {
    // Brand-new direct room: provision a key and share it with both members.
    await createRoomKey(room.id, [
      { id: state.currentUser.id, public_key: getIdentity()?.publicKeyB64 },
      { id: user.id, public_key: user.public_key },
    ]);
  }

  if (!state.rooms.some((r) => r.id === room.id)) {
    state.rooms.unshift(room);
  }
  renderRooms();
  selectRoom(room.id);
  dom.dmDialog.close();
}

function initDmDialog() {
  dom.btnNewDm?.addEventListener("click", (e) => {
    e.preventDefault();
    openDmDialog();
  });

  dom.dmDialogClose?.addEventListener("click", () => dom.dmDialog.close());
  dom.dmCancel?.addEventListener("click", () => dom.dmDialog.close());

  // The mobile bottom nav's Contacts tab emits this event (navigation.js can't
  // import this module without creating a circular import).
  window.addEventListener("echorooms:open-dm", () => {
    if (state.currentUser) openDmDialog();
  });

  dom.dmResults?.addEventListener("click", (e) => {
    const item = e.target.closest("[data-user-id]");
    if (!item) return;
    const user = dmResultsMap.get(item.dataset.userId);
    if (!user) return;
    startDm(user).then(() => (dom.dmResults.innerHTML = ""));
  });

  dom.dmForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!supabase || !state.currentUser) return;

    const submitBtn = dom.findPrimaryButton(dom.dmForm);
    submitBtn.disabled = true;
    hideError(dom.dmError);
    dom.dmResults.innerHTML = "";

    try {
      const query = dom.dmUsername.value.trim();
      if (!query) {
        showError(dom.dmError, "Enter a username to search.");
        submitBtn.disabled = false;
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, display_name, public_key")
        .not("username", "is", null)
        .ilike("username", `%${query}%`)
        .order("username")
        .limit(8);

      if (error) {
        showError(dom.dmError, "Could not search right now. Try again.");
        submitBtn.disabled = false;
        return;
      }

      const others = (data || []).filter((p) => p.id !== state.currentUser.id);
      if (!others.length) {
        dom.dmResults.innerHTML =
          '<li class="dm-none">No users found with that username.</li>';
        dom.dmResults.classList.remove("is-hidden");
        submitBtn.disabled = false;
        return;
      }

      dmResultsMap.clear();
      others.forEach((p) => dmResultsMap.set(p.id, p));
      dom.dmResults.innerHTML = others.map(dmResultHtml).join("");
      dom.dmResults.classList.remove("is-hidden");
    } catch (error) {
      showError(dom.dmError, "Could not search right now. Try again.");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// --- Invite members --------------------------------------------------------

const inviteResultsMap = new Map();
const invitedSet = new Set();

function currentRoom() {
  return state.rooms.find((r) => r.id === state.currentRoomId) || null;
}

function openInviteDialog() {
  hideError(dom.inviteError);
  closeInfo();
  dom.inviteForm.reset();
  dom.inviteResults.innerHTML = "";
  inviteResultsMap.clear();
  invitedSet.clear();
  dom.inviteDialog.showModal();
  dom.inviteUsername.focus();
}

function inviteResultHtml(user, alreadyAdded) {
  const name = user.display_name || user.username;
  return `
    <li>
      <button type="button" class="dm-result" data-user-id="${user.id}" ${alreadyAdded ? "disabled" : ""}>
        <span class="member-avatar" style="background:${avatarColor(name)}">${escapeHtml(
    name.charAt(0).toUpperCase()
  )}</span>
        <span class="member-name">${escapeHtml(name)}</span>
        <span class="dm-handle">@${escapeHtml(user.username || "")}</span>
        <span class="dm-added">${alreadyAdded ? "✓ Added" : ""}</span>
      </button>
    </li>`;
}

async function inviteUser(user) {
  const room = currentRoom();
  const roomId = state.currentRoomId;
  if (!roomId || !room) return;

  const { error: addError } = await supabase.rpc("add_room_member", {
    room_id: roomId,
    other_user_id: user.id,
  });

  if (addError) {
    showError(dom.inviteError, "Could not add that member. Only room admins can invite.");
    return;
  }

  await shareRoomKey(roomId, user.id, user.public_key);
  invitedSet.add(user.id);
  renderRoomInfo(room);
  renderInviteResults(dom.inviteUsername.value.trim());
}

function renderInviteResults(query) {
  const others = [...inviteResultsMap.values()].filter(
    (p) => p.id !== state.currentUser.id
  );
  if (!others.length) {
    dom.inviteResults.innerHTML = '<li class="dm-none">No users found with that username.</li>';
    dom.inviteResults.classList.remove("is-hidden");
    return;
  }
  dom.inviteResults.innerHTML = others
    .map((p) => inviteResultHtml(p, invitedSet.has(p.id)))
    .join("");
  dom.inviteResults.classList.remove("is-hidden");
}

function initInviteDialog() {
  dom.btnInvite?.addEventListener("click", (e) => {
    e.preventDefault();
    openInviteDialog();
  });

  dom.inviteDialogClose?.addEventListener("click", () => dom.inviteDialog.close());
  dom.inviteCancel?.addEventListener("click", () => dom.inviteDialog.close());

  dom.inviteResults?.addEventListener("click", (e) => {
    const item = e.target.closest("[data-user-id]");
    if (!item || item.disabled) return;
    const user = inviteResultsMap.get(item.dataset.userId);
    if (user) inviteUser(user);
  });

  dom.inviteForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!supabase || !state.currentUser || !state.currentRoomId) return;

    const query = dom.inviteUsername.value.trim();
    if (!query) {
      showError(dom.inviteError, "Enter a username to search.");
      return;
    }

    const submitBtn = dom.findPrimaryButton(dom.inviteForm);
    submitBtn.disabled = true;
    hideError(dom.inviteError);
    dom.inviteResults.innerHTML = "";

    try {
      const result = await supabase
        .from("profiles")
        .select("id, username, display_name, public_key")
        .not("username", "is", null)
        .ilike("username", `%${query}%`)
        .order("username")
        .limit(8);

      if (result.error) {
        showError(dom.inviteError, "Could not search right now. Try again.");
        return;
      }

      const already = new Set(
        (await supabase.from("room_members").select("user_id").eq("room_id", state.currentRoomId))
          .data?.map((m) => m.user_id) || []
      );

      inviteResultsMap.clear();
      (result.data || [])
        .filter((p) => p.id !== state.currentUser.id && !already.has(p.id))
        .forEach((p) => inviteResultsMap.set(p.id, p));

      renderInviteResults(query);
    } catch (error) {
      showError(dom.inviteError, "Could not search right now. Try again.");
    } finally {
      submitBtn.disabled = false;
    }
  });
}

function initClearMessages() {
  dom.btnClearMessages?.addEventListener("click", async () => {
    const room = currentRoom();
    if (!room) return;
    const ok = await showConfirm({
      title: "Clear chat?",
      message: `Messages in "${room.name}" will be removed from this device only. Members keep their copies.`,
      confirmLabel: "Clear chat",
      danger: true,
    });
    if (!ok) return;
    clearLocalMessages(room.id);
  });
}

// --- Delete / dissolve / restore -------------------------------------------

async function leaveCurrentRoom(roomId) {
  state.rooms = state.rooms.filter((r) => r.id !== roomId);
  renderRooms();
  if (state.currentRoomId === roomId) {
    if (state.rooms.length > 0) {
      selectRoom(state.rooms[0].id);
    } else {
      closeRoom();
      showChatList();
    }
  }
}

async function deleteChat() {
  const room = currentRoom();
  const roomId = state.currentRoomId;
  if (!roomId || !room) return;

  const ok = await showConfirm({
    title: "Delete chat?",
    message: `This removes "${room.name}" from your chat list. Members won't lose anything, and you can restore it later.`,
    confirmLabel: "Delete chat",
    cancelLabel: "Keep it",
    danger: true,
  });
  if (!ok) return;

  try {
    const { error } = await supabase.rpc("delete_chat", { target_room_id: roomId });
    if (error) {
      logAppError("rooms", error);
      setComposerNotice(getRequestErrorMessage(error, "Couldn't delete this chat. Try again."));
      return;
    }
  } catch (err) {
    logAppError("rooms", err);
    setComposerNotice(getRequestErrorMessage(err, "Couldn't delete this chat. Try again."));
    return;
  }
  await leaveCurrentRoom(roomId);
}

async function dissolveRoom() {
  const room = currentRoom();
  const roomId = state.currentRoomId;
  if (!roomId || !room) return;

  const confirmed = await showConfirm({
    title: "Dissolve room?",
    message: `This hides "${room.name}" for every member. Only you (as admin) can restore it.`,
    confirmLabel: "Dissolve room",
    cancelLabel: "Keep it",
    danger: true,
  });
  if (!confirmed) return;

  try {
    const { error } = await supabase.rpc("dissolve_room", { target_room_id: roomId });
    if (error) {
      logAppError("rooms", error);
      setComposerNotice(getRequestErrorMessage(error, "Couldn't close this room. Try again."));
      return;
    }
  } catch (err) {
    logAppError("rooms", err);
    setComposerNotice(getRequestErrorMessage(err, "Couldn't close this room. Try again."));
    return;
  }
  await leaveCurrentRoom(roomId);
}

function restoreItemHtml(room, kind) {
  return `
    <li class="restore-item">
      <span class="room-avatar small" style="background:${avatarColor(room.name)}">${escapeHtml(
    room.name.charAt(0).toUpperCase()
  )}</span>
      <span class="restore-name">${escapeHtml(room.name)}</span>
      <button type="button" class="restore-restore-btn btn-ghost" data-room-id="${room.id}" data-kind="${kind}">Restore</button>
    </li>`;
}

async function openRestoreDialog() {
  if (!supabase || !state.currentUser) return;

  dom.restoreList.innerHTML = "";
  dom.restoreEmpty.hidden = true;

  // Chats deleted by me (out of my list) and rooms dissolved by me.
  const [mineRes, dissolvedRes] = await Promise.all([
    supabase
      .from("room_members")
      .select("rooms(id, name)")
      .eq("user_id", state.currentUser.id)
      .not("deleted_at", "is", null),
    supabase
      .from("rooms")
      .select("id, name, created_by")
      .not("deleted_at", "is", null),
  ]);

  const items = [];
  (mineRes.data || []).forEach((m) => {
    if (m.rooms && !state.rooms.some((r) => r.id === m.rooms.id)) {
      items.push(restoreItemHtml(m.rooms, "chat"));
    }
  });
  (dissolvedRes.data || [])
    .filter((r) => r.created_by === state.currentUser.id)
    .forEach((r) => items.push(restoreItemHtml(r, "room")));

  if (!items.length) {
    dom.restoreList.innerHTML = "";
    dom.restoreEmpty.hidden = false;
  } else {
    dom.restoreEmpty.hidden = true;
    dom.restoreList.innerHTML = items.join("");
  }

  dom.restoreDialog.showModal();
}

async function restoreItem(roomId, kind) {
  const rpc = kind === "chat" ? "restore_chat" : "restore_room";
  const { error } = await supabase.rpc(rpc, { target_room_id: roomId });
  if (error) return;
  await openRestoreDialog();
  await loadRooms();
}

function initRestoreAndDanger() {
  dom.btnDeleteChat?.addEventListener("click", deleteChat);
  dom.btnDissolveRoom?.addEventListener("click", dissolveRoom);
  dom.btnRestore?.addEventListener("click", openRestoreDialog);
  dom.restoreDialogClose?.addEventListener("click", () => dom.restoreDialog.close());
  dom.restoreList?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-room-id]");
    if (!btn) return;
    restoreItem(btn.dataset.roomId, btn.dataset.kind);
  });
}

export function initRooms() {
  subscribeToPresence(renderChatHeader);
  window.addEventListener("echorooms:unread-counts-updated", () => {
    renderRooms(dom.roomSearch?.value || "");
  });
  window.addEventListener("echorooms:open-room", (event) => {
    if (event.detail?.roomId) selectRoom(event.detail.roomId);
  });
  window.addEventListener("echorooms:message-preview", updateRoomPreview);
  window.addEventListener("echorooms:room-preview-cleared", clearRoomPreview);
  initRoomDialog();
  initDmDialog();
  initInviteDialog();
  initSidebar();
  initRestoreAndDanger();
  initClearMessages();
  window.addEventListener("echorooms:username-required", (event) => {
    openUsernameDialog();
    if (event.detail?.usernameTaken) {
      showError(dom.usernameError, "That username is already taken. Choose a different username.");
    }
  });
}
