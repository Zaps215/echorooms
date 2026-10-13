import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const migration = read("supabase/migrations/0018_stories_and_call_signaling.sql");
const setup = read("supabase/setup.sql");
const stories = read("js/features/stories.js");
const calls = read("js/features/calls.js");
const feed = read("js/features/feed.js");
const html = read("index.html");
const styles = read("css/styles.css");
const dom = read("js/core/dom.js");
const main = read("js/main.js");

for (const schema of [migration, setup]) {
  assert.match(schema, /create table if not exists public\.social_stories/);
  assert.match(schema, /create table if not exists public\.social_story_recipients/);
  assert.match(schema, /audience_mode in \('everyone', 'selected'\)/);
  assert.match(schema, /expires_at > now\(\)/);
  assert.match(schema, /Story audience can view active stories[\s\S]*?audience_mode = 'everyone'[\s\S]*?recipient\.user_id = auth\.uid\(\)/);
  assert.match(schema, /Signed-in members can view social post media[\s\S]*?story\.expires_at > now\(\)[\s\S]*?recipient\.user_id = auth\.uid\(\)/);
  assert.match(schema, /grant select, insert, delete on public\.social_stories to authenticated/);
  assert.match(schema, /Room members can signal calls[\s\S]*?extension = 'broadcast'[\s\S]*?member\.room_id::text = split_part\(realtime\.topic\(\), ':', 2\)/);
  assert.match(schema, /social_stories_purge_media/);
}

assert.match(stories, /social_story_recipients/);
assert.match(stories, /24 \* 60 \* 60 \* 1000/);
assert.match(stories, /expires_at.*Date\.now/);
assert.match(stories, /Choose at least one person/);
assert.match(stories, /data-open-story/);
assert.match(calls, /new RTCPeerConnection/);
assert.match(calls, /getUserMedia/);
assert.match(calls, /calls:\$\{roomId\}/);
assert.match(calls, /room-selected/);
assert.match(calls, /roomType/);
assert.match(feed, /data-share-post/);
assert.match(feed, /#post=/);
assert.match(html, /id="story-strip"/);
assert.match(html, /<div class="feed-scroll">\s*<section class="story-strip-wrap"[\s\S]*?<\/section>\s*<div class="feed-layout">/);
assert.match(html, /id="story-strip"[^>]*tabindex="0"[^>]*aria-label="Story updates\. Scroll horizontally to see more\."/);
assert.match(styles, /\.story-strip \{[^}]*overflow-x: auto;[^}]*scroll-snap-type: x proximity;[^}]*touch-action: pan-x;/);
assert.match(html, /id="story-audience"/);
assert.match(html, /id="call-dialog"/);
assert.match(html, /id="btn-video-call"/);
assert.match(dom, /storyViewer/);
assert.match(main, /initStories\(\)/);
assert.match(main, /initCalls\(\)/);

console.log("social experience: audiences, story expiry, share links, call wiring, and UI checks passed");
