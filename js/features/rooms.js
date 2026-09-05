// Room listing, selection, and creation backed by Supabase.
//
// Loads the user's rooms (via the room_members join), renders them in the left
// sidebar, handles room selection and the info panel's member list, and drives
// the create-room dialog through the create_room RPC.

import * as dom from "../core/dom.js";
import { state } from "../core/state.js";
import { supabase } from "../core/supabase.js";
import { showError, hideError, escapeHtml, avatarColor } from "../core/utils.js";
import { showRoomChat } from "../core/navigation.js";

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

function renderChatEmpty(room) {
  if (!dom.messagesEl) return;
  dom.messagesEl.innerHTML = `
    <div class="chat-welcome">
      <div class="empty-orbit">
        <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </div>
      <h3>${escapeHtml(room.name)}</h3>
      <p>This room is ready for conversations. Messaging is coming soon.</p>
    </div>`;
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

  renderChatEmpty(room);
  renderRoomInfo(room);
  renderRooms();
}

export async function loadRooms() {
  if (!supabase) return 0;
  const { data, error } = await supabase
    .from("room_members")
    .select("rooms(id, name, room_type, created_at)")
    .order("created_at", { ascending: false });

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

      state.rooms.unshift(result.data[0]);
      renderRooms();
      selectRoom(result.data[0].id);
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

export function initRooms() {
  initRoomDialog();
  initSidebar();
}
