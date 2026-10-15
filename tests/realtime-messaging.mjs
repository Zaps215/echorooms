import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { latestMessageCursor, mergeMessageRows } from "../js/core/message-sync.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const chat = readFileSync(join(root, "js/features/chat.js"), "utf8");
const rooms = readFileSync(join(root, "js/features/rooms.js"), "utf8");
const keyring = readFileSync(join(root, "js/core/keyring.js"), "utf8");
const supabaseClient = readFileSync(join(root, "js/supabase-client.js"), "utf8");
const appEntry = readFileSync(join(root, "js/main.js"), "utf8");
const index = readFileSync(join(root, "index.html"), "utf8");
const dom = readFileSync(join(root, "js/core/dom.js"), "utf8");
const presence = readFileSync(join(root, "js/core/presence.js"), "utf8");
const setupSql = readFileSync(join(root, "supabase/setup.sql"), "utf8");
const styles = readFileSync(join(root, "css/styles.css"), "utf8");

const first = { id: "a", created_at: "2026-10-14T00:00:00.000Z", body: "first" };
const second = { id: "b", created_at: "2026-10-14T00:00:00.000Z", body: "second" };
const later = { id: "c", created_at: "2026-10-14T00:00:01.000Z", body: "later" };
const editedFirst = {
  ...first,
  body: "edited",
  edited_at: "2026-10-14T00:02:00.000Z",
};

assert.deepEqual(
  mergeMessageRows([later, first, second], [editedFirst, second]),
  [editedFirst, second, later],
  "history and realtime rows merge once in chronological order and keep newer edits"
);
assert.deepEqual(latestMessageCursor([first, second, later]), {
  created_at: later.created_at,
  id: later.id,
});

const openRoomStart = chat.indexOf("export async function openRoom");
const openRoomEnd = chat.indexOf("export function closeRoom", openRoomStart);
const openRoom = chat.slice(openRoomStart, openRoomEnd);
assert.ok(
  openRoom.indexOf("subscribeToRoom(roomId)") < openRoom.indexOf("listMessages(roomId)"),
  "the room subscription starts before history is fetched"
);
assert.match(chat, /created_at\.gt\.\$\{cursor\.created_at\}[\s\S]*id\.gt\.\$\{cursor\.id\}/);
assert.match(chat, /status === "SUBSCRIBED"/);
assert.match(chat, /syncMissedMessages\(roomId\)/);
assert.match(chat, /state\.currentRoomId !== row\.room_id\) return/);
assert.match(chat, /key = await ensureRoomKey\(roomId\);\s*if \(state\.currentRoomId !== roomId\) return;\s*activeRoomKey = key;/);
assert.match(chat, /if \(state\.currentRoomId === pending\.room_id\) renderMessages/);
assert.match(chat, /function messageSendFailureText\(error\)/);
assert.match(chat, /markMessageSendFailed\(pendingId, roomId, result\.error\)/);
assert.match(chat, /class="msg-send-error"/);
assert.match(chat, /function restoreComposerDraft\(roomId, body\)/);
assert.match(chat, /data-retry-room-load/);
assert.doesNotMatch(chat, /Conversation unavailable/);
assert.match(chat, /Say hi to start messaging/);
assert.doesNotMatch(chat, /Say hello and start the conversation/);
assert.match(openRoom, /subscribeToRoom\(roomId\);[\s\S]*let roomKeyError = null;[\s\S]*listMessages\(roomId\)/);
assert.match(openRoom, /if \(!activeRoomKey && visible\.length\)/);
assert.match(rooms, /\.from\("room_members"\)/, "room membership persists server-side for later logins");
assert.match(chat, /async function listMessages\(roomId, before\)[\s\S]*\.from\("messages"\)/, "opening a room reloads its persisted message history");
assert.match(
  chat,
  /profiles!messages_sender_id_fkey\(display_name, username\)/,
  "message queries explicitly select the sender profile relationship"
);
assert.match(supabaseClient, /createClient\(supabaseUrl, supabaseAnonKey\)/, "Supabase default auth persistence is retained");
assert.match(appEntry, /supabase\.auth\.getSession\(\)/, "an existing login session is restored on app startup");
assert.match(appEntry, /await loadRooms\(\)/, "saved conversations reload when a user signs in");
assert.match(rooms, /Your conversations couldn't be loaded/, "room load errors are explained to the user");
assert.match(rooms, /data-retry-rooms/, "room load errors can be retried");
assert.match(index, /id="btn-record-voice"/);
assert.match(dom, /btnRecordVoice = query\("btn-record-voice"\)/);
assert.match(chat, /navigator\.mediaDevices\.getUserMedia\(\{\s*audio: true\s*\}\)/);
assert.match(chat, /new MediaRecorder\(stream/);
assert.match(chat, /setTimeout\(\(\) => stopVoiceRecording\(\), 60_000\)/);
assert.match(chat, /data-attach-audio="\$\{att\.id\}"/);
assert.match(chat, /decryptAttachment\(att, activeRoomKey\)/);
assert.match(chat, /\.from\("message_reactions"\)/, "message reactions persist in Supabase");
assert.match(chat, /table: "message_reactions", filter: `room_id=eq\.\$\{roomId\}`/);
assert.match(chat, /data-reaction-choice/);
assert.match(chat, /data-reaction-toggle/);
assert.match(chat, /data-action="edit">Edit text/);
assert.match(chat, /data-action="delete" class="danger"/);
assert.match(chat, /New conversation/);
assert.match(chat, /class="new-chat-mark"/);
assert.match(chat, /\.select\("message_id, user_id, emoji"\)/);
assert.match(setupSql, /create table if not exists public\.message_reactions/);
assert.match(setupSql, /message_reactions.*enable row level security/s);
assert.match(setupSql, /tablename = 'message_reactions'/);
assert.match(presence, /config: \{ presence: \{ key: userId \} \}/);
assert.match(presence, /channel\.presenceState\(\)/);
assert.match(presence, /\.track\(\{ user_id: userId/);
assert.match(appEntry, /startPresence\(user\.id\)/);
assert.match(appEntry, /stopPresence\(\)/);
assert.match(styles, /\.msg-content-wrap \{[^}]*width: fit-content/s);
assert.match(styles, /\.bubble \{[^}]*white-space: normal/s);
assert.match(styles, /\.bubble-text \{ white-space: pre-wrap;/);
assert.match(styles, /\.msg\.own \.bubble-meta \{ color: #fff; text-shadow:/);
assert.doesNotMatch(styles, /\.bubble-meta \{[^}]*background:/);
assert.doesNotMatch(rooms, /Tap to open/);
assert.match(rooms, /Direct conversation/);
assert.match(rooms, /aria-pressed="\$\{isActive\}"/);
assert.match(rooms, /loadRoomPreviews\(state\.rooms\)/);
assert.match(rooms, /echorooms:message-preview/);
assert.match(rooms, /echorooms:room-preview-cleared/);
assert.match(keyring, /const hasStoredIdentity = !!\(profile\.public_key \|\| profile\.encrypted_private_key\)/);
assert.match(keyring, /if \(!privateKeyB64\) return null;/);

console.log("realtime messaging: cursor, deduplication, reconnect catch-up, and room guards passed");
