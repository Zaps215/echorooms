import assert from "node:assert/strict";
import { findPeer, chatHeaderView } from "../js/core/chat-header.js";

// The header decides two things that are easy to get subtly wrong: which member
// of a direct room is "the other person", and what the subtitle should say. Each
// is checked in isolation.

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
});

assert.equal(group.kind, "group");
assert.equal(group.label, "Trail crew");
assert.equal(group.subtitle, "Group room");

// A nameless group still gets a usable avatar initial rather than an empty one.
assert.equal(
  chatHeaderView({ room: { room_type: "group" }, currentUserId: ME }).label,
  "?"
);

// --- direct rooms -----------------------------------------------------------

function direct(profile = { display_name: "Maya Chen", username: "maya" }) {
  return chatHeaderView({
    room: { name: "Maya Chen", room_type: "direct" },
    members: members([[ME, {}], [PEER, profile]]),
    currentUserId: ME,
  });
}

const peer = direct();
assert.equal(peer.kind, "direct");
assert.equal(peer.peerId, PEER);
assert.equal(peer.label, "Maya Chen");
assert.equal(peer.subtitle, "@maya");

// With no display name the handle still identifies the person, and the avatar
// initial falls back to it rather than rendering an empty circle.
const handleOnly = direct({ username: "maya" });
assert.equal(handleOnly.label, "maya");
assert.equal(handleOnly.subtitle, "@maya");

// A peer with neither a display name nor a handle is not given a fabricated
// label, and the subtitle falls back to neutral copy rather than blank.
const anonymous = direct({});
assert.equal(anonymous.label, "?");
assert.equal(anonymous.subtitle, "Direct conversation");

// Peer resolution failing (membership still loading) uses the same neutral
// description, so the header never claims anything it cannot verify.
const unresolved = chatHeaderView({
  room: { name: "Maya Chen", room_type: "direct" },
  members: undefined,
  currentUserId: ME,
});
assert.equal(unresolved.subtitle, "Direct conversation");

// No open room means no header at all.
assert.equal(chatHeaderView({ room: undefined }), null);
assert.equal(chatHeaderView({ room: null, members: undefined, currentUserId: ME }), null);

console.log("chat header module: all checks passed");