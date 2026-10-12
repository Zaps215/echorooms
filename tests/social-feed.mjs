import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const migration = read("supabase/migrations/0016_social_feed.sql");
const setup = read("supabase/setup.sql");
const feed = read("js/features/feed.js");
const main = read("js/main.js");
const html = read("index.html");

for (const table of ["social_posts", "social_post_likes", "social_post_comments"]) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(setup, new RegExp(`create table if not exists public\\.${table}`));
}

for (const schema of [migration, setup]) {
  assert.match(schema, /'social-post-media',\s*'social-post-media',\s*false/);
  assert.match(schema, /media_path is null or media_path like auth\.uid\(\)::text \|\| '\/%'/);
  assert.match(schema, /for select to authenticated\s+using \(auth\.uid\(\) is not null\)/);
}

assert.match(feed, /getUserMedia\(\{\s*video:/);
assert.match(feed, /getUserMedia\(\{\s*audio: true\s*\}\)/);
assert.match(feed, /if \(!dom\.feedCameraDialog\.open\)/);
assert.match(feed, /if \(!dom\.feedPostDialog\.open\)/);
assert.match(feed, /split\(";"\)\[0\]/);
assert.match(main, /startFeedSession\(\)/);
assert.match(html, /id="profile-settings"/);
assert.match(html, /id="feed-post-dialog"/);

console.log("social feed: migration, access policy, permissions, and session lifecycle checks passed");
