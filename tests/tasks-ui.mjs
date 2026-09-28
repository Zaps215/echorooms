// Runtime smoke test: loads the real module graph against a minimal DOM stub
// and exercises the Task Service's render/filter paths. Catches the class of
// bug static analysis misses entirely — undeclared identifiers, bad imports,
// typos in dom.* lookups — by actually running the code.
//
// Run with: node tests/tasks-ui.mjs

// Run with: node --import ./tests/register-loader.mjs tests/tasks-ui.mjs
// The loader hook makes `import.meta.env` (Vite-only) work under plain Node.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- Minimal DOM stub -------------------------------------------------------

// Every id that index.html declares becomes a stub element, so dom.js resolves
// exactly the elements the real page would.
const html = readFileSync(join(root, "index.html"), "utf8");
const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);

function makeEl(id) {
  const classes = new Set();
  return {
    id,
    innerHTML: "",
    textContent: "",
    value: "",
    hidden: false,
    disabled: false,
    open: false,
    style: {},
    dataset: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
      contains: (c) => classes.has(c),
    },
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute() {},
    getAttribute: () => null,
    focus() {},
    reset() {},
    showModal() {},
    close() {},
    appendChild() {},
    removeChild() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0 }),
  };
}

const elements = new Map(ids.map((id) => [id, makeEl(id)]));

globalThis.document = {
  getElementById: (id) => elements.get(id) || null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: (tag) => makeEl(`created-${tag}`),
  addEventListener() {},
  body: makeEl("body"),
};

globalThis.window = {
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  location: { href: "" },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  getComputedStyle: () => ({}),
};

globalThis.CustomEvent = class CustomEvent {
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail;
  }
};
globalThis.matchMedia = globalThis.matchMedia || (() => ({ matches: false, addEventListener() {} }));
globalThis.localStorage = globalThis.window.localStorage;
globalThis.sessionStorage = globalThis.window.localStorage;
globalThis.URL = globalThis.URL || { createObjectURL: () => "", revokeObjectURL() {} };
globalThis.File = globalThis.File || class File {};
globalThis.Blob = globalThis.Blob || class Blob {};

// The loader hook rewrites `import.meta.env` to this global. DEV is off so
// dom.js stays quiet about the stub's missing lookups, and no Supabase project
// is configured, which is exactly the "unconfigured" path the app ships with.
globalThis.__ECHOROOMS_VITE_ENV__ = { DEV: false, VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "" };

// --- Load the real modules --------------------------------------------------

const { state } = await import("../js/core/state.js");
const tasks = await import("../js/features/tasks.js");
const dom = await import("../js/core/dom.js");
const rules = await import("../js/core/task-rules.js");

// --- Checks -----------------------------------------------------------------

// dom.js must resolve every task element the feature module depends on.
for (const name of [
  "taskCard",
  "taskList",
  "taskCount",
  "taskEmpty",
  "taskFilters",
  "btnNewTask",
  "taskDialog",
  "taskDialogTitle",
  "taskDialogClose",
  "taskCancel",
  "taskDelete",
  "taskSave",
  "taskForm",
  "taskTitle",
  "taskDesc",
  "taskAssignee",
  "taskDue",
  "taskStatus",
  "taskSource",
  "taskError",
]) {
  assert.ok(dom[name], `dom.${name} is null — is #${name.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())} missing from index.html?`);
}

// Wiring must not throw even with a stubbed Supabase (it is unconfigured here).
tasks.initTasks();

// Rendering with no room selected clears the panel.
state.currentRoomId = null;
tasks.renderTaskSection();
assert.equal(dom.taskList.innerHTML, "");
assert.equal(dom.taskCount.textContent, "0");
assert.equal(dom.taskEmpty.hidden, false);

// The filter tabs are driven by data-task-filter; the panel must not render a
// task whose status the filter excludes.
tasks.setFilter("all");
assert.equal(dom.taskList.innerHTML, "", "no tasks cached yet, so nothing to render");

// setFilter must reject anything that is not a known status or "all".
tasks.setFilter("open");
tasks.setFilter("nonsense");
tasks.setFilter(undefined);
assert.equal(dom.taskCount.textContent, "0");

// onRoomOpened must not throw for a null/absent room.
tasks.onRoomOpened(null);
assert.equal(dom.taskList.innerHTML, "");

// Rules module is the one the service depends on for decisions.
assert.equal(rules.nextStatus("open"), "in_progress");
assert.equal(rules.filterTasks([{ status: "done" }], "open").length, 0);

console.log("tasks UI module: all checks passed");
