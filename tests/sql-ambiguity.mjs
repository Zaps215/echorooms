// Guards against the PL/pgSQL "column reference is ambiguous" failure class.
//
// A function declared `returns table (...)` gets every output column turned into
// a PL/pgSQL variable. A bare reference to a name that is both an output column
// and a real table column is then ambiguous, and because the default
// `plpgsql.variable_conflict` is `error`, the whole function aborts at runtime
// (SQLSTATE 42702). For create_direct_room that surfaced as DM search working
// while tapping a result silently failed.
//
// This is not a Postgres parser. It checks one high-signal shape: an output
// column name used bare in a comparison inside its own function body. A
// qualified reference (`p.id`), or a name glued to another identifier
// (`blocker_id`), is fine and is not reported.
//
// Run with: node tests/sql-ambiguity.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2] || join(root, "supabase/setup.sql");
const raw = readFileSync(file, "utf8");

// Per line: strip `--` comments and single-quoted string literals so a column
// name inside a message ("User not found") is never mistaken for a reference.
function sanitize(line) {
  return line.replace(/--.*$/, "").replace(/'[^']*'/g, "''");
}

const problems = [];
let functionsChecked = 0;

// Capture each `returns table (...)` function and its dollar-quoted body.
const fnRe =
  /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\(([^)]*)\)\s*returns\s+table\s*\(([\s\S]*?)\)\s*[\s\S]*?as\s*\$\$([\s\S]*?)\$\$/gi;

let match;
while ((match = fnRe.exec(raw)) !== null) {
  const [, name, , columnList, body] = match;
  functionsChecked += 1;

  const columns = columnList
    .split(",")
    .map((c) => c.trim().split(/\s+/)[0])
    .filter(Boolean);

  const lines = body.split("\n");
  for (const column of columns) {
    // Bare identifier on the left of a comparison, not part of a longer name
    // and not table-qualified. `(?!=)` keeps `<=`/`>=` from being read as `=`.
    const re = new RegExp(`(?<![\\w.])${column}\\s*(?:=|<>|!=|<=|>=|<|>)(?!=)`, "g");
    lines.forEach((line, i) => {
      if (re.test(sanitize(line))) {
        problems.push(
          `${name}(): output column "${column}" is referenced bare on body line ${i + 1} — ` +
            `qualify it (e.g. alias.${column}) or PL/pgSQL will raise 42702`
        );
      }
      re.lastIndex = 0;
    });
  }
}

assert.ok(functionsChecked > 0, `no returns-table functions found in ${file}`);

console.log(
  `sql ambiguity: checked ${functionsChecked} returns-table function(s) in ${file
    .split("/")
    .slice(-2)
    .join("/")}`
);
if (problems.length) {
  console.error(`\n${problems.length} ambiguous reference(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("no unqualified output-column references in returns-table bodies: all checks passed");
