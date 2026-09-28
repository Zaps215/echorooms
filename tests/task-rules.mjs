import assert from "node:assert/strict";
import * as r from "../js/core/task-rules.js";

// The date input round trip is the part most likely to regress silently, so it
// is checked across several timezones rather than just the machine's local one.
const TIMEZONES = ["UTC", "America/Los_Angeles", "Pacific/Kiritimati", "Asia/Kolkata"];

function main() {
  // Status transitions
  assert.equal(r.nextStatus("open"), "in_progress");
  assert.equal(r.nextStatus("in_progress"), "done");
  assert.equal(r.nextStatus("done"), "open");
  assert.equal(r.nextStatus("garbage"), "open");

  // Only the three known statuses reach the database
  assert.equal(r.isValidStatus("open"), true);
  assert.equal(r.isValidStatus("in_progress"), true);
  assert.equal(r.isValidStatus("done"), true);
  assert.equal(r.isValidStatus("closed"), false);
  assert.equal(r.isValidStatus(null), false);
  assert.equal(r.isValidStatus(undefined), false);

  // "Outstanding" means not-yet-done, so the badge counts real open work.
  // A row with an unknown/missing status defaults to outstanding: a malformed
  // row should show up in the count rather than silently vanish from it.
  assert.equal(r.isOutstanding({ status: "open" }), true);
  assert.equal(r.isOutstanding({ status: "in_progress" }), true);
  assert.equal(r.isOutstanding({ status: "done" }), false);
  assert.equal(r.isOutstanding({}), true);
  assert.equal(r.isOutstanding(null), true);

  // Panel filters
  const tasks = [
    { id: "1", status: "open" },
    { id: "2", status: "in_progress" },
    { id: "3", status: "done" },
  ];
  assert.deepEqual(r.filterTasks(tasks, "all").map((t) => t.id), ["1", "2", "3"]);
  assert.deepEqual(r.filterTasks(tasks, "open").map((t) => t.id), ["1"]);
  assert.deepEqual(r.filterTasks(tasks, "in_progress").map((t) => t.id), ["2"]);
  assert.deepEqual(r.filterTasks(tasks, "done").map((t) => t.id), ["3"]);
  // An unknown filter must not blank the panel
  assert.deepEqual(r.filterTasks(tasks, "nonsense").map((t) => t.id), ["1"]);
  assert.deepEqual(r.filterTasks(null, "open"), []);

  // Titles are normalized the way the column's check constraint expects
  assert.equal(r.normalizeTitle("  ship   the\nthing  "), "ship the thing");
  assert.equal(r.normalizeTitle("   "), "");
  assert.equal(r.normalizeTitle(null), "");
  assert.equal(r.isValidTitle("Write the release notes"), true);
  assert.equal(r.isValidTitle("   "), false);
  assert.equal(r.isValidTitle("x".repeat(200)), true);
  // normalizeTitle truncates, so an over-long title is still accepted
  assert.equal(r.isValidTitle("x".repeat(500)), true);
  assert.equal(r.normalizeTitle("x".repeat(500)).length, 200);

  // Due-date labels, relative to a fixed "now"
  const now = new Date(2026, 2, 15, 9, 30); // Mar 15 2026, local
  const at = (y, m, d) => new Date(y, m - 1, d, 12, 0).toISOString();

  assert.equal(r.dueLabel(null, now), null);
  assert.equal(r.dueLabel("not-a-date", now), null);
  assert.deepEqual(r.dueLabel(at(2026, 3, 15), now), { text: "Due today", overdue: false });
  assert.deepEqual(r.dueLabel(at(2026, 3, 16), now), { text: "Due tomorrow", overdue: false });
  assert.equal(r.dueLabel(at(2026, 3, 14), now).overdue, true);
  assert.match(r.dueLabel(at(2026, 3, 14), now).text, /^Overdue · /);
  assert.equal(r.dueLabel(at(2026, 3, 18), now).overdue, false);
  assert.equal(r.dueLabel(at(2026, 3, 22), now).overdue, false);
  // Beyond a week it stops being relative and shows the plain date
  assert.equal(r.dueLabel(at(2026, 4, 30), now).text, "Apr 30");

  // Date-input round trip: a task due "today" must stay on "today" everywhere,
  // including in timezones that sit behind UTC.
  for (const tz of TIMEZONES) {
    const saved = process.env.TZ;
    process.env.TZ = tz;
    for (const iso of ["2026-03-15", "2026-01-01", "2026-12-31"]) {
      assert.equal(r.toDueTimestamp(iso), new Date(`${iso}T12:00:00`).toISOString());
      assert.equal(r.toDateInputValue(r.toDueTimestamp(iso)), iso, `${iso} in ${tz}`);
    }
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }

  // Empty / invalid due dates store SQL NULL rather than "Invalid Date"
  assert.equal(r.toDueTimestamp(""), null);
  assert.equal(r.toDueTimestamp(null), null);
  assert.equal(r.toDueTimestamp("garbage"), null);
  assert.equal(r.toDateInputValue(null), "");
  assert.equal(r.toDateInputValue("garbage"), "");

  console.log("task-rules module: all checks passed");
}

main();
