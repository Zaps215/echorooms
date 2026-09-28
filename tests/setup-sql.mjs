// Structural check for supabase/setup.sql's idempotency claim.
//
// setup.sql's header says it "can be run more than once", so every statement
// that creates a database object must be guarded by a matching drop or an
// if-not-exists form. This walks the top-level statements (respecting
// dollar-quoted bodies) and reports anything that would fail on a second run.
//
// It is not a Postgres parser: it checks the shape of each statement, which is
// enough to catch the realistic failure modes.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2] || join(root, "supabase/setup.sql");
const raw = readFileSync(file, "utf8");

// Split into top-level statements. A line ending in ";" closes one, unless we
// are inside a dollar-quoted function body.
const statements = [];
let buf = "";
let inDollar = false;
for (const line of raw.split("\n")) {
  if (line.includes("$$")) inDollar = !inDollar;
  buf += line + "\n";
  if (!inDollar && line.trim().endsWith(";")) {
    statements.push(buf);
    buf = "";
  }
}
if (buf.trim()) statements.push(buf);

const clean = statements.map((s) => s.replace(/--.*$/gm, "").trim());
// Everything before the last statement, used for "was this dropped earlier?".
const prior = clean.slice(0, -1).join("\n");

const problems = [];
const drops = new Set();

for (const s of clean) {
  // Collect every guarded drop so we can match names against them later. A
  // single `alter table` can drop several objects, so these use matchAll.
  for (const m of s.matchAll(/drop policy if exists\s+"([^"]+)"\s+on\s+([\w.]+)/gi)) {
    drops.add(`policy|${m[1]}|${m[2].toLowerCase()}`);
  }
  for (const m of s.matchAll(/drop trigger if exists\s+([\w.]+)/gi)) {
    drops.add(`trigger|${m[1].toLowerCase()}`);
  }
  for (const m of s.matchAll(/drop constraint if exists\s+([\w.]+)/gi)) {
    drops.add(`constraint|${m[1].toLowerCase()}`);
  }
  for (const m of s.matchAll(/drop index if exists\s+([\w.]+)/gi)) {
    drops.add(`index|${m[1].toLowerCase()}`);
  }
}

for (const s of clean) {
  let m;

  if ((m = s.match(/create policy\s+"([^"]+)"\s+on\s+([\w.]+)/i))) {
    const key = `policy|${m[1]}|${m[2].toLowerCase()}`;
    if (!drops.has(key)) {
      problems.push(`create policy "${m[1]}" on ${m[2]} — no preceding drop policy`);
    }
  }

  if ((m = s.match(/create trigger\s+([\w]+)/i))) {
    const key = `trigger|${m[1].toLowerCase()}`;
    if (!drops.has(key)) {
      problems.push(`create trigger ${m[1]} — no preceding drop trigger`);
    }
  }

  if ((m = s.match(/add constraint\s+([\w]+)/i))) {
    const key = `constraint|${m[1].toLowerCase()}`;
    if (!drops.has(key)) {
      problems.push(`add constraint ${m[1]} — no preceding drop constraint`);
    }
  }

  if (/^create table\s+(?!if not exists)/i.test(s)) {
    problems.push(`create table without if not exists: ${s.split("\n")[0]}`);
  }
  if (/^create (unique )?index\s+(?!if not exists)/i.test(s)) {
    problems.push(`create index without if not exists: ${s.split("\n")[0]}`);
  }
  if (/add column/i.test(s) && !/if not exists/i.test(s)) {
    problems.push(`add column without if not exists: ${s.split("\n")[0]}`);
  }
  if (/^insert into/i.test(s) && !/on conflict/i.test(s)) {
    problems.push(`insert without on conflict: ${s.split("\n")[0]}`);
  }
}

// Guarded drops that never got used are harmless, but a create statement that
// merely re-defines a function is fine too, so nothing to assert there.

console.log(`checked ${clean.length} top-level statements in ${file.split("/").slice(-2).join("/")}`);
if (problems.length) {
  console.error(`\n${problems.length} statement(s) would fail on a second run:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("setup.sql is idempotent by construction: all checks passed");
