// Pure view-model for the conversation header.
//
// Kept free of DOM, Supabase, and module state so the direct-vs-group and
// online-vs-offline decisions can be exercised directly in tests, the same way
// task-rules.js isolates the task state machine from the tasks feature.

/**
 * The other participant of a direct room, given that room's member map
 * (user_id -> profile). Returns undefined while membership is still loading or
 * when the room has no counterpart. Groups are not resolved here: callers
 * decide based on `room.room_type`.
 *
 * @param {Map<string, object>|undefined} members
 * @param {string|undefined} currentUserId
 */
export function findPeer(members, currentUserId) {
  if (!members) return undefined;
  for (const [userId, profile] of members) {
    if (userId !== currentUserId) return { userId, ...profile };
  }
  return undefined;
}

/**
 * Builds the header's display fields for the currently open room.
 *
 * @param {object} input
 * @param {object|undefined} input.room      the open room row
 * @param {Map<string, object>|undefined} input.members  user_id -> profile
 * @param {string|undefined} input.currentUserId
 * @param {Set<string>|undefined} input.onlineUserIds    users with live presence
 * @returns {{kind: string, label: string, presence: boolean, subtitle: string}|null}
 */
export function chatHeaderView({ room, members, currentUserId, onlineUserIds }) {
  if (!room) return null;

  if (room.room_type !== "direct") {
    return {
      kind: "group",
      label: room.name || "?",
      presence: false,
      subtitle: "Group room",
    };
  }

  const peer = findPeer(members, currentUserId);
  const name = peer ? peer.display_name || peer.username || "" : "";
  const online = !!(peer && onlineUserIds && onlineUserIds.has(peer.userId));

  let subtitle;
  if (!peer) subtitle = "Direct conversation";
  else if (online) subtitle = "Active now";
  else if (peer.username) subtitle = `@${peer.username}`;
  else subtitle = "Offline";

  return {
    kind: "direct",
    label: name || "?",
    presence: online,
    subtitle,
  };
}
