import { state } from "../core/state.js";
import { supabase } from "../core/supabase.js";
import { logAppError } from "../core/utils.js";

const unreadCounts = new Map();
let subscription = null;
let subscribedUserId = null;
let toastTimer = null;

export function unreadCount(roomId) {
  return unreadCounts.get(roomId) || 0;
}

function totalUnread() {
  let total = 0;
  for (const count of unreadCounts.values()) total += count;
  return total;
}

function updateNavUnread() {
  const badge = document.querySelector(".app-nav-link[data-app-view='chats'] .app-nav-unread");
  if (!badge) return;
  const total = totalUnread();
  if (total > 0) {
    badge.textContent = total > 99 ? "99+" : String(total);
    badge.hidden = false;
  } else {
    badge.textContent = "";
    badge.hidden = true;
  }
  const button = badge.closest(".app-nav-link");
  if (button) {
    button.setAttribute(
      "aria-label",
      total > 0 ? `Chats, ${total} unread message${total === 1 ? "" : "s"}` : "Chats"
    );
  }
}

function publishCounts() {
  updateNavUnread();
  window.dispatchEvent(new CustomEvent("echorooms:unread-counts-updated"));
}

export async function refreshUnreadCounts() {
  if (!supabase || !state.currentUser) return false;
  const userId = state.currentUser.id;
  try {
    const { data, error } = await supabase.rpc("get_unread_message_counts");
    if (error) throw error;
    if (state.currentUser?.id !== userId) return false;

    unreadCounts.clear();
    for (const row of data || []) {
      const count = Number(row.unread_count);
      if (Number.isSafeInteger(count) && count > 0) unreadCounts.set(row.room_id, count);
    }
    publishCounts();
    return true;
  } catch (error) {
    logAppError("unread-counts", error);
    return false;
  }
}

function isRoomVisible(roomId) {
  const app = document.getElementById("app-wrapper");
  return (
    document.visibilityState === "visible" &&
    !app?.classList.contains("is-hidden") &&
    app?.classList.contains("chat-section-active") &&
    app?.classList.contains("chat-open") &&
    state.currentRoomId === roomId
  );
}

async function markRoomRead(roomId, readThrough) {
  if (!supabase || !state.currentUser || !roomId || !readThrough) return false;
  const userId = state.currentUser.id;
  try {
    const { error } = await supabase.rpc("mark_room_read", {
      p_room_id: roomId,
      p_read_through: readThrough,
    });
    if (error) throw error;
    if (state.currentUser?.id === userId) await refreshUnreadCounts();
    return true;
  } catch (error) {
    logAppError("mark-room-read", error);
    return false;
  }
}

export function markCurrentRoomRead(roomId, readThrough) {
  if (!isRoomVisible(roomId)) return;
  markRoomRead(roomId, readThrough);
}

function showMessageToast(roomId) {
  if (document.visibilityState !== "visible") return;
  const room = state.rooms.find((candidate) => candidate.id === roomId);
  const host = document.getElementById("message-notice");
  const button = document.getElementById("message-notice-open");
  const title = document.getElementById("message-notice-title");
  if (!room || !host || !button || !title) return;

  title.textContent = `New message in ${room.name}`;
  button.dataset.roomId = roomId;
  host.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    host.hidden = true;
    button.dataset.roomId = "";
  }, 5000);
}

function handleIncomingMessage(message, userId) {
  if (!message?.room_id || message.sender_id === userId) return;
  if (isRoomVisible(message.room_id)) {
    markRoomRead(message.room_id, message.created_at);
    return;
  }

  unreadCounts.set(message.room_id, unreadCount(message.room_id) + 1);
  publishCounts();
  showMessageToast(message.room_id);
}

export function startUnreadTracking(userId) {
  if (!supabase || !userId) return;
  if (subscribedUserId === userId && subscription) return;
  stopUnreadTracking();
  subscribedUserId = userId;

  refreshUnreadCounts();
  subscription = supabase
    .channel(`unread-messages:${userId}`)
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "messages",
    }, ({ new: message }) => handleIncomingMessage(message, userId))
    .subscribe((status) => {
      if (subscribedUserId !== userId) return;
      if (status === "SUBSCRIBED") refreshUnreadCounts();
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        logAppError("unread-realtime", new Error(`Realtime subscription status: ${status}`));
      }
    });
}

export function stopUnreadTracking() {
  if (subscription && supabase) supabase.removeChannel(subscription);
  subscription = null;
  subscribedUserId = null;
  unreadCounts.clear();
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
  const host = document.getElementById("message-notice");
  if (host) host.hidden = true;
  publishCounts();
}

export function initUnreadNotifications() {
  document.getElementById("message-notice-open")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    const roomId = button.dataset.roomId;
    if (!roomId) return;
    const host = document.getElementById("message-notice");
    if (host) host.hidden = true;
    window.dispatchEvent(new CustomEvent("echorooms:open-room", { detail: { roomId } }));
  });

  document.getElementById("message-notice-dismiss")?.addEventListener("click", () => {
    const host = document.getElementById("message-notice");
    if (host) host.hidden = true;
  });
}
