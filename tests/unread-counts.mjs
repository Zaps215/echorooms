import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

const unread = read("js/features/unread.js");
const chat = read("js/features/chat.js");
const rooms = read("js/features/rooms.js");
const appEntry = read("js/main.js");
const index = read("index.html");
const styles = read("css/styles.css");

assert.match(unread, /supabase\.rpc\("get_unread_message_counts"\)/, "unread counts come from the read-cursor RPC");
assert.match(unread, /supabase\.rpc\("mark_room_read"/, "opening a room advances the read cursor through mark_room_read");
assert.match(unread, /table: "messages"[\s\S]*?event: "INSERT"|event: "INSERT"[\s\S]*?table: "messages"/, "unread state follows realtime message inserts");
assert.match(unread, /export function startUnreadTracking/);
assert.match(unread, /export function stopUnreadTracking/);
assert.match(unread, /export function initUnreadNotifications/);
assert.match(unread, /echorooms:open-room/, "the toast opens the conversation via the shared event");
assert.match(unread, /app-nav-unread/, "the Chats nav badge is updated with the total unread count");
assert.match(unread, /total > 99 \? "99\+" : String\(total\)/, "the nav badge caps large totals");

const openRoomStart = chat.indexOf("export async function openRoom");
const openRoomEnd = chat.indexOf("export function closeRoom", openRoomStart);
const openRoom = chat.slice(openRoomStart, openRoomEnd);
assert.match(openRoom, /const newestIncoming = messages[\s\S]*?\.at\(-1\)/, "opening a room marks read through the newest incoming message");
assert.doesNotMatch(openRoom, /\.at\(0\)/, "history is oldest-first, so the newest message must use .at(-1)");
assert.match(chat, /markCurrentRoomRead\(roomId, newestIncoming\.created_at\)/);
assert.match(chat, /import \{ markCurrentRoomRead \} from "\.\/unread\.js"/);

assert.match(rooms, /import \{ unreadCount \} from "\.\/unread\.js"/);
assert.match(rooms, /class="unread-badge"/, "room rows render an unread badge");
assert.match(rooms, /echorooms:unread-counts-updated/, "room list re-renders when counts change");
assert.match(rooms, /echorooms:open-room/, "room list opens a room when the toast is used");

assert.match(appEntry, /startUnreadTracking\(user\.id\)/, "unread tracking starts with the session");
assert.match(appEntry, /stopUnreadTracking\(\)/, "unread tracking stops on sign-out");
assert.match(appEntry, /initUnreadNotifications\(\)/);

assert.match(index, /id="message-notice"/);
assert.match(index, /id="message-notice-open"/);
assert.match(index, /id="message-notice-dismiss"/);
assert.match(index, /class="app-nav-unread"/);

assert.match(styles, /\.unread-badge \{/, "room badges are styled");
assert.match(styles, /\.app-nav-unread \{/, "the nav badge is styled");
assert.match(styles, /\.message-notice \{/, "the notification toast is styled");

console.log("unread counts: read cursors, realtime counts, badges, and notification toast passed");
