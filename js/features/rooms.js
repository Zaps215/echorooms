// Room listing, selection, and creation backed by Supabase.
//
// Loads the user's rooms (via the room_members join), renders them in the left
// sidebar, handles room selection and the info panel's member list, and drives
// the create-room dialog through the create_room RPC.

import * as dom from "../core/dom.js";
import { state } from "../core/state.js";
import { supabase } from "../core/supabase.js";
import { showError, hideError, escapeHtml, avatarColor } from "../core/utils.js";
import { showRoomChat, closeSidebar, closeInfo, showHome } from "../core/navigation.js";
import { showConfirm } from "../core/confirm.js";
import { openRoom, closeRoom, getPins, getPresence, EVENTS, unpinMessage } from "./chat.js";
import { getIdentity, createRoomKey, getRoomKey, shareRoomKey, canManageRoom } from "../core/keyring.js";

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

// Cached member rows + admin flag so presence/pin events re-render without a
// fresh room_members query on every realtime heartbeat.
let membersCache = [];
let membersCacheRoomId = null;
let membersCacheIsAdmin = false;

function renderMembersList() {
  if (!dom.memberList) return;
  if (!membersCache.length) {
    dom.memberList.innerHTML =
      '<li style="color:var(--muted-2);font-size:13px">No members yet.</li>';
    return;
  }
  if (dom.memberCount) dom.memberCount.textContent = String(membersCache.length);
  const presence = getPresence();
  const currentUserId = state.currentUser?.id;

  dom.memberList.innerHTML = membersCache
    .map((m) => {
      const p = m.profiles || {};
      const name = p.display_name || p.username || "Member";
      const online = presence.has(m.user_id);
      const isMe = m.user_id === currentUserId;
      return `
        <li>
          <span class="member-avatar" style="background:${avatarColor(name)}">${escapeHtml(name.charAt(0).toUpperCase())}</span>
          <span class="member-name">${escapeHtml(name)}${isMe ? " (you)" : ""}</span>
          <span class="member-presence ${online ? "online" : "offline"}">${online ? "online" : "offline"}</span>
        </li>`;
    })
    .join("");
}

function renderPinnedSection(roomId) {
  if (!dom.pinList) return;
  const pins = getPins();
  if (dom.pinCount) dom.pinCount.textContent = String(pins.length);

  if (!pins.length) {
    dom.pinList.innerHTML = "";
    if (dom.pinEmpty) dom.pinEmpty.hidden = false;
    return;
  }
  if (dom.pinEmpty) dom.pinEmpty.hidden = true;
  dom.pinList.innerHTML = pins
    .map((pin) => {
      const name =
        (pin.sender && (pin.sender.display_name || pin.sender.username)) || "Member";
      return `
        <li class="pin-item">
          <div class="pin-main">
            <span class="pin-text">${escapeHtml(pin.text || "")}</span>
            <span class="pin-meta">${escapeHtml(name)}</span>
          </div>
          ${membersCacheIsAdmin ? `<button type="button" class="pin-unpin" data-unpin="${pin.message_id}" title="Unpin">✕</button>` : ""}
        </li>`;
    })
    .join("");
}

function renderRooms(filterText = "") {
  const filtered = state.rooms.filter((r) =>
    r.name.toLowerCase().includes(filterText.toLowerCase())
  );
  const tabFiltered = filtered.filter((r) => {
    if (state.activeTab === "groups") return r.room_type === "group";
    return true;
  });

  if (!tabFiltered.length) {
    dom.roomList.innerHTML =
      '<p style="padding: 16px; text-align: center; color: var(--muted); font-size: 13px;">No rooms found.</p>';
    return;
  }

  dom.roomList.innerHTML = tabFiltered
    .map((room) => {
      const hash = room.name.charCodeAt(0) % ROOM_PALETTE.length;
      const bg = ROOM_PALETTE[hash];
      const isActive = room.id === state.currentRoomId;
      const initial = room.name.charAt(0).toUpperCase();

      return `
      <button class="room-item ${isActive ? "active" : ""}" data-room-id="${room.id}" type="button">
        <span class="room-avatar" style="background: ${bg}">${initial}</span>
        <span class="room-main">
          <span class="room-top">
            <span class="room-name">${escapeHtml(room.name)}</span>
          </span>
          <span class="room-preview">
            <span class="room-last">Tap to open</span>
          </span>
        </span>
      </button>
    `;
    })
    .join("");

  dom.roomList.querySelectorAll(".room-item").forEach((btn) => {
    btn.addEventListener("click", () => selectRoom(btn.dataset.roomId));
  });
}

async function renderRoomInfo(room) {
  if (!supabase || !room) return;
  if (dom.infoHeadSub) dom.infoHeadSub.textContent = "Room details";
  if (dom.memberList) dom.memberList.innerHTML = "";
  if (dom.memberCount) dom.memberCount.textContent = "0";

  const isAdmin = await canManageRoom(room.id);
  if (dom.btnDissolveRoom) {
    dom.btnDissolveRoom.classList.toggle("is-hidden", !isAdmin);
  }
  membersCacheIsAdmin = isAdmin;

  const { data, error } = await supabase
    .from("room_members")
    .select("user_id, profiles(display_name, username, status_text)")
    .eq("room_id", room.id);

  if (error || state.currentRoomId !== room.id) return;

  membersCache = data || [];
  membersCacheRoomId = room.id;
  renderMembersList();
  renderPinnedSection(room.id);
}

export function selectRoom(roomId) {
  state.currentRoomId = roomId;
  const room = state.rooms.find((r) => r.id === roomId);
  if (!room) return;

  dom.chatTitle.textContent = room.name;
  dom.chatSubtitle.textContent =
    room.room_type === "direct" ? "Direct conversation" : "Group room";
  showRoomChat();

  if (dom.info) dom.info.classList.remove("is-hidden");

  openRoom(roomId);
  renderRoomInfo(room);
  renderRooms();
}

export async function loadRooms() {
  if (!supabase) return 0;
  const { data, error } = await supabase
    .from("room_members")
    .select("joined_at, deleted_at, rooms(id, name, room_type, created_at, deleted_at)")
    .eq("user_id", state.currentUser.id)
    .order("joined_at", { ascending: false });

  if (error) return 0;

  state.rooms = (data || [])
    .filter((m) => !m.deleted_at && m.rooms && !m.rooms.deleted_at)
    .map((m) => m.rooms);
  renderRooms();

  if (state.rooms.length > 0) {
    selectRoom(state.rooms[0].id);
  }
  return state.rooms.length;
}

export function openRoomDialog() {
  hideError(dom.roomError);
  closeSidebar();
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
      dom.tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      state.activeTab = tab.dataset.tab;
      renderRooms(dom.roomSearch ? dom.roomSearch.value : "");
    });
  });
}

// --- Direct messages -------------------------------------------------------

// Cache of the latest DM search results so clicks can hand off full rows.
const dmResultsMap = new Map();

function openDmDialog() {
  hideError(dom.dmError);
  closeSidebar();
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
  closeSidebar();
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

// --- Delete / dissolve / restore -------------------------------------------

async function leaveCurrentRoom(roomId) {
  state.rooms = state.rooms.filter((r) => r.id !== roomId);
  renderRooms();
  if (state.currentRoomId === roomId) {
    if (state.rooms.length > 0) {
      selectRoom(state.rooms[0].id);
    } else {
      closeRoom();
      showHome();
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

  const { error } = await supabase.rpc("delete_chat", { target_room_id: roomId });
  if (error) return;
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

  const { error } = await supabase.rpc("dissolve_room", { target_room_id: roomId });
  if (error) return;
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

function initInfoActions() {
  dom.pinList?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-unpin]");
    if (!btn) return;
    unpinMessage(state.currentRoomId, btn.dataset.unpin);
  });

  window.addEventListener(EVENTS.pins, () => {
    if (membersCacheRoomId === state.currentRoomId && state.currentRoomId) {
      renderPinnedSection(state.currentRoomId);
    }
  });
  window.addEventListener(EVENTS.presence, () => {
    if (membersCacheRoomId === state.currentRoomId && state.currentRoomId) {
      renderMembersList();
    }
  });
}

export function initRooms() {
  initRoomDialog();
  initDmDialog();
  initInviteDialog();
  initSidebar();
  initRestoreAndDanger();
  initInfoActions();
}
