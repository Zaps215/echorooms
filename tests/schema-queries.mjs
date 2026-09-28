// Checks that every column the client orders/filters by actually exists in the
// database schema.
//
// This exists because of a real bug: the task assignee picker ordered
// `room_members` by `created_at`, but that table's only timestamp is
// `joined_at`. Postgres rejected the query, the row came back null, and the
// dropdown silently rendered "Nobody" as the sole option — no error surfaced
// anywhere, and the unit tests had no database to notice.
//
// The schema is read from supabase/setup.sql rather than a live connection so
// the check runs offline and in CI.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- Schema inventory -------------------------------------------------------

const sql = readFileSync(join(root, "supabase/setup.sql"), "utf8");

const columns = new Map();

for (const m of sql.matchAll(
  /create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\);/g
)) {
  const [, table, body] = m;
  const set = new Set();
  for (const line of body.split("\n")) {
    const col = line.trim().split(/\s+/)[0];
    if (!col) continue;
    // Table-level constraint keywords start lines too, but are not columns.
    if (["primary", "unique", "check", "foreign", "constraint"].includes(col)) continue;
    set.add(col);
  }
  columns.set(table, set);
}

// Columns added after the table was created.
for (const m of sql.matchAll(
  /alter table public\.(\w+)\s*\n?\s*add column if not exists (\w+)/g
)) {
  columns.get(m[1])?.add(m[2]);
}

// --- Client queries ---------------------------------------------------------

function jsFiles(dir) {
  return readdirSync(join(root, dir))
    .filter((f) => f.endsWith(".js"))
    .map((f) => `${dir}/${f}`);
}

const sources = [
  ...jsFiles("js/features"),
  ...jsFiles("js/core"),
].map((f) => ({ f, s: readFileSync(join(root, f), "utf8") }));

// Split each module on `.from("table")` so every `.order(...)`/`.eq(...)` is
// attributed to the table it actually queries.
const OPERATORS = /\.(?:order|eq|neq|gt|gte|lt|lte|is|not|or|filter)\(\s*["']([\w.]+)["']/g;

const problems = [];

for (const { f, s } of sources) {
  const segments = s.split(/\.from\(\s*["'](\w+)["']\)/);

  for (let i = 1; i < segments.length; i += 2) {
    const table = segments[i];
    const have = columns.get(table);
    if (!have) continue; // auth/storage/edge tables are not declared here

    // Bound the scan: a query builder chain ends at the next `.from(` (already
    // a split boundary) or where the statement is clearly over.
    const chain = segments[i + 1].slice(0, 600);

    for (const m of chain.matchAll(OPERATORS)) {
      const col = m[1];
      // Storage policies filter on `name`/`bucket_id`, which live in
      // storage.objects rather than any public table.
      if (col === "name" || col === "bucket_id") continue;
      if (!have.has(col)) {
        const line = s.slice(0, s.indexOf(segments[i - 1])).split("\n").length;
        problems.push(
          `${f} ~line ${line}: .${m[0].slice(1, m[0].indexOf("("))}("${col}") on ${table} — no such column (has: ${[...have].sort().join(", ")})`
        );
      }
    }
  }
}

assert.ok(
  columns.size >= 10,
  `only parsed ${columns.size} tables from setup.sql — the regex probably stopped matching`
);

if (problems.length) {
  console.error(`\n${problems.length} client query/ies reference a column that does not exist:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(
  `schema/queries: ${columns.size} tables checked, every ordered and filtered column exists`
);
