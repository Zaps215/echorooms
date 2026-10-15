import { supabase } from "./supabase.js";

const PRESENCE_CHANNEL = "echorooms:presence";

let activeUserId = null;
let presenceChannel = null;
let onlineUserIds = new Set();
const listeners = new Set();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function setOnlineUsers(userIds) {
  onlineUserIds = userIds;
  notifyListeners();
}

export function isUserOnline(userId) {
  return !!userId && onlineUserIds.has(userId);
}

export function subscribeToPresence(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function startPresence(userId) {
  if (!supabase || !userId) return;
  if (activeUserId === userId && presenceChannel) return;

  stopPresence();
  activeUserId = userId;

  const channel = supabase.channel(PRESENCE_CHANNEL, {
    config: { presence: { key: userId } },
  });
  presenceChannel = channel;

  channel
    .on("presence", { event: "sync" }, () => {
      if (presenceChannel !== channel) return;
      setOnlineUsers(new Set(Object.keys(channel.presenceState())));
    })
    .subscribe((status) => {
      if (presenceChannel !== channel) return;

      if (status === "SUBSCRIBED") {
        channel
          .track({ user_id: userId, online_at: new Date().toISOString() })
          .catch((error) => {
            if (import.meta.env.DEV) {
              console.warn("[presence] Could not publish online status:", error);
            }
          });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        setOnlineUsers(new Set());
      }
    });
}

export function stopPresence() {
  const channel = presenceChannel;
  presenceChannel = null;
  activeUserId = null;

  if (onlineUserIds.size) setOnlineUsers(new Set());
  else notifyListeners();

  if (channel && supabase) supabase.removeChannel(channel);
}
