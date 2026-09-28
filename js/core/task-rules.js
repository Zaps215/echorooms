// Pure rules for the Task Service.
//
// Everything here is DOM-free and deterministic enough to unit test: status
// transitions, panel filtering, and due-date formatting. tasks.js owns the
// Supabase calls and rendering; this module owns the decisions.

export const TASK_STATUSES = ["open", "in_progress", "done"];

export const TASK_STATUS_LABELS = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
};

// The checkbox is the fast path, so it has to decide a direction from the
// current status alone: open -> in_progress -> done -> open.
const STATUS_CYCLE = { open: "in_progress", in_progress: "done", done: "open" };

/** Next status for the one-tap cycle. Unknown statuses fall back to "open". */
export function nextStatus(status) {
  return STATUS_CYCLE[status] || "open";
}

/** True when the status is one the database accepts. */
export function isValidStatus(status) {
  return TASK_STATUSES.includes(status);
}

/** A task counts as "open work" until it is done. */
export function isOutstanding(task) {
  return task?.status !== "done";
}

/** Applies a panel filter. "all" passes everything through. */
export function filterTasks(tasks, filter) {
  const list = Array.isArray(tasks) ? tasks : [];
  if (filter === "all") return list;
  if (!isValidStatus(filter)) return list.filter((t) => t.status === "open");
  return list.filter((t) => t.status === filter);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * Human label for a task's due date, relative to today.
 * Returns null when there is no due date, and flags anything past due.
 */
export function dueLabel(dueAt, now = new Date()) {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;

  const days = Math.round((startOfDay(due) - startOfDay(now)) / 86400000);
  const label = due.toLocaleDateString(undefined, { month: "short", day: "numeric" });

  if (days < 0) return { text: `Overdue · ${label}`, overdue: true };
  if (days === 0) return { text: "Due today", overdue: false };
  if (days === 1) return { text: "Due tomorrow", overdue: false };
  if (days <= 7) return { text: `Due ${label}`, overdue: false };
  return { text: label, overdue: false };
}

/**
 * <input type="date"> only speaks YYYY-MM-DD, and it renders in the viewer's
 * local timezone. Formatting from the local parts (rather than slicing the ISO
 * string) keeps a task due "today" from landing on yesterday in a negative
 * UTC offset.
 */
export function toDateInputValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Inverse of toDateInputValue. Anchored at local noon so a round trip through
 * the date input cannot shift the calendar day across a DST boundary.
 * Returns null for empty/invalid input so the column stores SQL NULL.
 */
export function toDueTimestamp(dateInput) {
  if (!dateInput) return null;
  const parsed = new Date(`${dateInput}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/** Trims a title down to the column's 200-char limit. */
export function normalizeTitle(title) {
  return (title || "").replace(/\s+/g, " ").trim().slice(0, 200);
}

/** Validates a title the same way the database's check constraint does. */
export function isValidTitle(title) {
  const value = normalizeTitle(title);
  return value.length >= 1 && value.length <= 200;
}
