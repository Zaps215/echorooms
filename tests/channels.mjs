import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const migration = read("supabase/migrations/0017_read_only_channels.sql");
const setup = read("supabase/setup.sql");
const feature = read("js/features/channels.js");
const rooms = read("js/features/rooms.js");
const html = read("index.html");
const styles = read("css/styles.css");

for (const table of ["broadcast_channels", "broadcast_channel_posts", "broadcast_channel_members"]) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(setup, new RegExp(`create table if not exists public\\.${table}`));
}

for (const schema of [migration, setup]) {
  assert.match(schema, /revoke insert, update, delete on public\.broadcast_channel_posts from anon, authenticated/);
  assert.match(schema, /grant select, insert, delete on public\.broadcast_channel_members to authenticated/);
  assert.match(schema, /Members can join channels as themselves[\s\S]*?with check \(user_id = auth\.uid\(\)\)/);
  assert.doesNotMatch(schema, /create policy[^;]+on public\.broadcast_channel_posts for (?:insert|update|delete)/i);
  assert.equal((schema.match(/\('(?:world-now|tech-pulse|good-energy|creative-corner)', '(?:Echo Pulse|Byte|Sunny|Muse)'/g) || []).length, 20);
}

assert.match(html, /data-tab="all"/);
assert.match(html, /data-tab="groups"/);
assert.match(html, /data-tab="channels"/);
assert.match(html, /id="channel-reader"/);
assert.match(html, /id="channel-featured-grid"/);
assert.match(html, /class="app-nav-profile-label">Profile<\/span>/);
assert.match(rooms, /state\.activeTab === "channels"/);
assert.match(feature, /broadcast_channel_posts/);
assert.match(feature, /broadcast_channel_members/);
assert.match(feature, /Join channel/);
assert.match(feature, /Leave channel/);
assert.match(styles, /\.app-wrapper\.chat-section-active \{\s*--accent: #2563eb/);
assert.match(styles, /\.app-nav-profile \{ display: flex; flex-direction: column/);
assert.match(html, /id="btn-profile-settings"/);
assert.match(html, /id="profile-settings"/);
assert.match(html, /ECHOROOMS CHANNELS/);

console.log("channels: read-only bot feeds, membership, navigation, and chat branding checks passed");
