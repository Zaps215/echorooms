// Room listing, selection, and creation backed by Supabase.
//
// Loads the user's rooms (via the room_members join), renders them in the left
// sidebar, handles room selection and the info panel's member list, and drives
// the create-room dialog through the create_room RPC.

import * as dom from "../core/dom.js";
import { state } from "../core/state.js";
import { supabase } from "../core/supabase.js";
import { showError, hideError, escapeHtml, avatarColor } from "../core/utils.js";
import { showRoomChat, closeSidebar, closeInfo } from "../core/navigation.js";
import { openRoom } from "./chat.js";
import { getIdentity, createRoomKey, getRoomKey, shareRoomKey } from "../core/keyring.js";

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
  if (!supabase) return;
  if (dom.infoHeadSub) dom.infoHeadSub.textContent = "Room details";
  if (dom.memberList) dom.memberList.innerHTML = "";
  if (dom.memberCount) dom.memberCount.textContent = "0";

  const { data, error } = await supabase
    .from("room_members")
    .select("profiles(display_name, username, status_text)")
    .eq("room_id", room.id);

  if (error || !dom.memberList) return;

  if (dom.memberCount) dom.memberCount.textContent = String(data.length);

  if (!data.length) {
    dom.memberList.innerHTML =
      '<li style="color:var(--muted-2);font-size:13px">No members yet.</li>';
    return;
  }

  dom.memberList.innerHTML = data
    .map((m) => {
      const p = m.profiles || {};
      const name = p.display_name || p.username || "Member";
      return `
        <li>
          <span class="member-avatar" style="background:${avatarColor(name)}">${escapeHtml(name.charAt(0).toUpperCase())}</span>
          <span class="member-name">${escapeHtml(name)}</span>
          <span class="member-presence online">online</span>
        </li>`;
    })
    .join("");
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
    .select("joined_at, rooms(id, name, room_type, created_at)")
    .eq("user_id", state.currentUser.id)
    .order("joined_at", { ascending: false });

  if (error) return 0;

  state.rooms = data.map((m) => m.rooms).filter(Boolean);
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

export function initRooms() {
  initRoomDialog();
  initDmDialog();
  initSidebar();
}
