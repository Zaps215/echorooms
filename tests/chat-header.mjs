import assert from "node:assert/strict";
import { findPeer, chatHeaderView } from "../js/core/chat-header.js";

// The header decides three things that are easy to get subtly wrong: which
// member of a direct room is "the other person", whether that person is online,
// and what the subtitle should say. Each is checked in isolation.

const ME = "user-me";
const PEER = "user-peer";

function members(entries) {
  return new Map(entries);
}

// --- findPeer ---------------------------------------------------------------

assert.equal(
  findPeer(members([[ME, { display_name: "Me" }], [PEER, { display_name: "Maya" }]]), ME)
    .display_name,
  "Maya",
  "the peer is the member who is not the current user"
);

// A direct room whose membership has not loaded yet must not be mistaken for a
// group; it resolves to undefined and the caller falls back to neutral copy.
assert.equal(findPeer(undefined, ME), undefined);
assert.equal(findPeer(members([]), ME), undefined);

// A room containing only the current user has no counterpart.
assert.equal(findPeer(members([[ME, { display_name: "Me" }]]), ME), undefined);

// --- groups -----------------------------------------------------------------

const group = chatHeaderView({
  room: { name: "Trail crew", room_type: "group" },
  members: members([[ME, {}], [PEER, {}]]),
  currentUserId: ME,
  onlineUserIds: new Set([PEER]),
});

assert.equal(group.kind, "group");
assert.equal(group.label, "Trail crew");
assert.equal(group.subtitle, "Group room");
// A group is never "online" even when every member is present: the dot would
// misrepresent many people as one.
assert.equal(group.presence, false);

// --- direct rooms -----------------------------------------------------------

function direct(online, profile = { display_name: "Maya Chen", username: "maya" }) {
  return chatHeaderView({
    room: { name: "Maya Chen", room_type: "direct" },
    members: members([[ME, {}], [PEER, profile]]),
    currentUserId: ME,
    onlineUserIds: new Set(online ? [PEER] : []),
  });
}

const online = direct(true);
assert.equal(online.kind, "direct");
assert.equal(online.label, "Maya Chen");
assert.equal(online.subtitle, "Active now");
assert.equal(online.presence, true);

const offline = direct(false);
assert.equal(offline.subtitle, "@maya");
assert.equal(offline.presence, false);

// With no display name the handle still identifies the person, and the avatar
// initial falls back to it rather than rendering an empty circle.
const handleOnly = direct(false, { username: "maya" });
assert.equal(handleOnly.label, "maya");
assert.equal(handleOnly.subtitle, "@maya");

// A peer with neither a display name nor a handle is not given a fabricated
// label, but the subtitle still reads as offline rather than blank.
const anonymous = direct(false, {});
assert.equal(anonymous.label, "?");
assert.equal(anonymous.subtitle, "Offline");

// Peer resolution failing (membership still loading) must not claim the person
// is offline; it uses a neutral description instead.
const unresolved = chatHeaderView({
  room: { name: "Maya Chen", room_type: "direct" },
  members: undefined,
  currentUserId: ME,
  onlineUserIds: new Set(),
});
assert.equal(unresolved.subtitle, "Direct conversation");
assert.equal(unresolved.presence, false);

// No open room means no header at all.
assert.equal(chatHeaderView({ room: undefined }), null);
assert.equal(chatHeaderView({ room: null, members: undefined, currentUserId: ME }), null);

console.log("chat header module: all checks passed");
