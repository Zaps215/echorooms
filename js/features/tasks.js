// Task Service: turn conversation context into small, trackable actions.
//
// Owns the `tasks` table end to end. Tasks are listed in the room info panel
// (filtered by status) and can be spawned from any message's action menu. Task
// rows are plain text by design — unlike message bodies they must be sortable
// and filterable server-side, so they are not end-to-end encrypted.
//
// A task keeps a nullable link back to the message it came from. That link uses
// ON DELETE SET NULL, so deleting or expiring the source message never destroys
// the work it spawned; the panel simply drops the "from a message" affordance.

import * as dom from "../core/dom.js";
import { state } from "../core/state.js";
import { supabase } from "../core/supabase.js";
import { showError, hideError, escapeHtml } from "../core/utils.js";
import { showConfirm } from "../core/confirm.js";
import { EVENTS } from "./chat.js";
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  isValidStatus,
  isOutstanding,
  filterTasks,
  dueLabel,
  toDateInputValue,
  toDueTimestamp,
  normalizeTitle,
  nextStatus,
} from "../core/task-rules.js";

const TASK_COLUMNS =
  "id, room_id, message_id, created_by, assignee_id, title, description, status, due_at, completed_at, created_at, updated_at";

// Rows for the room currently open in the info panel, plus which room they
// belong to so a late reply from a previous room can't overwrite them.
let tasksCache = [];
let tasksRoomId = null;

// Filter shown in the panel. "all" is also a valid filter but the panel never
// opens on it — a room's default view is its outstanding work.
let activeFilter = "open";

// Dialog state: editingId is null for a brand-new task, draftMessageId is the
// optional source message it was spawned from.
let editingId = null;
let draftMessageId = null;

const CHECK_ICON =
  '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

// --- Data access ------------------------------------------------------------

export async function listRoomTasks(roomId, filter = "all") {
  if (!supabase || !roomId) return [];

  let query = supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (TASK_STATUSES.includes(filter)) query = query.eq("status", filter);

  const { data, error } = await query;
  if (error) return [];
  return data || [];
}

async function loadTasks(roomId) {
  const rows = await listRoomTasks(roomId);
  // The room may have changed while the query was in flight.
  if (state.currentRoomId !== roomId) return;
  tasksCache = rows;
  tasksRoomId = roomId;
  renderTaskSection();
}

// Shared insert path. `messageId` is optional: the panel's "New task" button
// creates a task with no source message at all.
async function insertTask(messageId, taskInput) {
  if (!supabase || !state.currentRoomId) return null;

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      room_id: state.currentRoomId,
      message_id: messageId || null,
      created_by: state.currentUser?.id,
      title: taskInput.title,
      description: taskInput.description || null,
      assignee_id: taskInput.assignee_id || null,
      status: isValidStatus(taskInput.status) ? taskInput.status : "open",
      due_at: taskInput.due_at || null,
    })
    .select(TASK_COLUMNS)
    .single();

  if (error) return null;
  if (data) {
    tasksCache = [data, ...tasksCache];
    renderTaskSection();
  }
  return data;
}

/** Converts a specific message into a task, keeping the link back to it. */
export function createTaskFromMessage(messageId, taskInput) {
  if (!messageId) return Promise.resolve(null);
  return insertTask(messageId, taskInput);
}

/** Creates a standalone task from the info panel. */
export function createTask(taskInput) {
  return insertTask(null, taskInput);
}

export async function updateTask(taskId, taskInput) {
  if (!supabase || !taskId) return null;

  const patch = { updated_at: new Date().toISOString() };
  if (taskInput.title !== undefined) patch.title = taskInput.title;
  if (taskInput.description !== undefined) {
    patch.description = taskInput.description || null;
  }
  if (taskInput.assignee_id !== undefined) {
    patch.assignee_id = taskInput.assignee_id || null;
  }
  if (taskInput.status !== undefined && isValidStatus(taskInput.status)) {
    patch.status = taskInput.status;
  }
  if (taskInput.due_at !== undefined) patch.due_at = taskInput.due_at || null;

  const { data, error } = await supabase
    .from("tasks")
    .update(patch)
    .eq("id", taskId)
    .select(TASK_COLUMNS)
    .single();

  if (error) return null;
  if (data) {
    tasksCache = tasksCache.map((t) => (t.id === data.id ? data : t));
    renderTaskSection();
  }
  return data;
}

export async function deleteTask(taskId) {
  if (!supabase || !taskId) return false;

  const { error } = await supabase.from("tasks").delete().eq("id", taskId);
  if (error) return false;
  tasksCache = tasksCache.filter((t) => t.id !== taskId);
  renderTaskSection();
  return true;
}

// The checkbox is the fast path: it walks open -> in_progress -> done, so a
// single tap never has to guess which direction the user wanted.
async function cycleStatus(task) {
  const next = nextStatus(task.status);
  const row = { ...task, status: next };
  tasksCache = tasksCache.map((t) => (t.id === task.id ? row : t));
  renderTaskSection();

  const saved = await updateTask(task.id, { status: next });
  if (!saved) {
    tasksCache = tasksCache.map((t) => (t.id === task.id ? task : t));
    renderTaskSection();
  }
}

// --- Rendering --------------------------------------------------------------

function taskItemHtml(task) {
  const done = task.status === "done";
  const due = dueLabel(task.due_at);
  const statusClass =
    task.status === "in_progress" ? "is-progress" : task.status === "done" ? "is-done" : "";

  const meta = [
    task.status !== "open"
      ? `<span class="task-status ${statusClass}">${escapeHtml(TASK_STATUS_LABELS[task.status] || task.status)}</span>`
      : "",
    due ? `<span class="task-due ${due.overdue ? "is-overdue" : ""}">${escapeHtml(due.text)}</span>` : "",
  ]
    .filter(Boolean)
    .join("");

  return `
    <li class="${done ? "done" : ""}" data-task-row="${task.id}">
      <button type="button" class="task-box" data-task-toggle="${task.id}"
        aria-pressed="${done}" aria-label="${done ? "Reopen" : "Complete"} task: ${escapeHtml(task.title)}">${CHECK_ICON}</button>
      <div class="task-body">
        <button type="button" class="task-text" data-task-edit="${task.id}">${escapeHtml(task.title)}</button>
        ${meta ? `<span class="task-meta">${meta}</span>` : ""}
      </div>
    </li>`;
}

export function renderTaskSection() {
  if (!dom.taskList) return;

  const roomId = state.currentRoomId;
  if (!roomId) {
    dom.taskList.innerHTML = "";
    if (dom.taskCount) dom.taskCount.textContent = "0";
    if (dom.taskEmpty) dom.taskEmpty.hidden = false;
    return;
  }

  const shown = filterTasks(tasksCache, activeFilter);
  const openCount = tasksCache.filter(isOutstanding).length;
  if (dom.taskCount) dom.taskCount.textContent = String(openCount);
  if (dom.taskEmpty) {
    dom.taskEmpty.hidden = shown.length > 0;
    dom.taskEmpty.textContent =
      tasksCache.length === 0 ? "No tasks yet." : "Nothing in this filter.";
  }
  dom.taskList.innerHTML = shown.map(taskItemHtml).join("");
}

// --- Dialog -----------------------------------------------------------------

async function fillAssignees(selectedId) {
  const select = dom.taskAssignee;
  if (!select) return;
  if (!supabase || !state.currentRoomId) {
    select.innerHTML = '<option value="">Nobody</option>';
    return;
  }

  const { data } = await supabase
    .from("room_members")
    .select("user_id, profiles(display_name, username)")
    .eq("room_id", state.currentRoomId)
    .order("joined_at", { ascending: true });

  const currentUserId = state.currentUser?.id;
  const members = (data || [])
    .map((m) => ({ id: m.user_id, name: m.profiles?.display_name || m.profiles?.username || "Member" }))
    .sort((a, b) => {
      if (a.id === currentUserId) return -1;
      if (b.id === currentUserId) return 1;
      return a.name.localeCompare(b.name);
    });

  select.innerHTML =
    '<option value="">Nobody</option>' +
    members
      .map((m) => {
        const suffix = m.id === currentUserId ? " (you)" : "";
        return `<option value="${m.id}">${escapeHtml(m.name + suffix)}</option>`;
      })
      .join("");

  select.value = selectedId || "";
}

function resetDialog() {
  editingId = null;
  draftMessageId = null;
  if (dom.taskForm) dom.taskForm.reset();
  if (dom.taskTitle) dom.taskTitle.value = "";
  if (dom.taskDesc) dom.taskDesc.value = "";
  if (dom.taskStatus) dom.taskStatus.value = "open";
  if (dom.taskDue) dom.taskDue.value = "";
  if (dom.taskAssignee) dom.taskAssignee.value = "";
  if (dom.taskSource) {
    dom.taskSource.hidden = true;
    dom.taskSource.textContent = "";
  }
  if (dom.taskDelete) dom.taskDelete.hidden = true;
  if (dom.taskDialogTitle) dom.taskDialogTitle.textContent = "New task";
  if (dom.taskSave) dom.taskSave.textContent = "Create task";
  hideError(dom.taskError);
}

export async function openTaskDialog({ taskId = null, messageId = null, sourceText = "" } = {}) {
  resetDialog();
  editingId = taskId;
  draftMessageId = messageId;

  if (taskId) {
    const task = tasksCache.find((t) => t.id === taskId);
    if (task) {
      if (dom.taskDialogTitle) dom.taskDialogTitle.textContent = "Edit task";
      if (dom.taskSave) dom.taskSave.textContent = "Save changes";
      if (dom.taskTitle) dom.taskTitle.value = task.title || "";
      if (dom.taskDesc) dom.taskDesc.value = task.description || "";
      if (dom.taskStatus) dom.taskStatus.value = task.status || "open";
      if (dom.taskDue) dom.taskDue.value = toDateInputValue(task.due_at);
      if (dom.taskDelete) dom.taskDelete.hidden = false;
    }
    await fillAssignees(task?.assignee_id || "");
  } else {
    await fillAssignees(state.currentUser?.id || "");
  }

  if (messageId && sourceText) {
    if (dom.taskSource) {
      dom.taskSource.hidden = false;
      dom.taskSource.textContent = `From a message: “${sourceText}”`;
    }
  }

  dom.taskDialog?.showModal();
  dom.taskTitle?.focus();
}

function closeTaskDialog() {
  dom.taskDialog?.close();
  resetDialog();
}

async function onTaskSubmit(event) {
  event.preventDefault();
  if (!dom.taskTitle || !dom.taskError) return;

  const title = normalizeTitle(dom.taskTitle.value);
  if (!title) {
    showError(dom.taskError, "Give the task a title.");
    dom.taskTitle.focus();
    return;
  }

  const payload = {
    title,
    description: dom.taskDesc ? dom.taskDesc.value.trim() : "",
    assignee_id: dom.taskAssignee ? dom.taskAssignee.value : "",
    status: dom.taskStatus ? dom.taskStatus.value : "open",
    due_at: toDueTimestamp(dom.taskDue ? dom.taskDue.value : ""),
  };

  if (dom.taskSave) dom.taskSave.disabled = true;
  hideError(dom.taskError);

  const result = editingId
    ? await updateTask(editingId, payload)
    : draftMessageId
      ? await createTaskFromMessage(draftMessageId, payload)
      : await createTask(payload);

  if (dom.taskSave) dom.taskSave.disabled = false;

  if (!result) {
    showError(dom.taskError, "Could not save the task. Try again.");
    return;
  }
  closeTaskDialog();
}

async function onTaskDelete() {
  if (!editingId) return;
  const ok = await showConfirm({
    title: "Delete task?",
    message: "This removes it for everyone in the room.",
    confirmLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  if (!(await deleteTask(editingId))) {
    showError(dom.taskError, "Could not delete the task. Try again.");
    return;
  }
  closeTaskDialog();
}

// --- Wiring -----------------------------------------------------------------

function onTaskListClick(event) {
  const toggle = event.target.closest("[data-task-toggle]");
  if (toggle) {
    const task = tasksCache.find((t) => t.id === toggle.dataset.taskToggle);
    if (task) cycleStatus(task);
    return;
  }

  const edit = event.target.closest("[data-task-edit]");
  if (edit) openTaskDialog({ taskId: edit.dataset.taskEdit });
}

function onFilterClick(event) {
  const tab = event.target.closest("[data-task-filter]");
  if (!tab || !dom.taskFilters) return;
  setFilter(tab.dataset.taskFilter);
}

export function setFilter(filter) {
  activeFilter = isValidStatus(filter) || filter === "all" ? filter : "open";
  if (dom.taskFilters) {
    dom.taskFilters.querySelectorAll("[data-task-filter]").forEach((btn) => {
      const isActive = btn.dataset.taskFilter === activeFilter;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", String(isActive));
    });
  }
  renderTaskSection();
}

export function initTasks() {
  if (!dom.taskList) return;

  dom.taskList.addEventListener("click", onTaskListClick);
  dom.taskFilters?.addEventListener("click", onFilterClick);
  dom.btnNewTask?.addEventListener("click", () => openTaskDialog());
  dom.taskForm?.addEventListener("submit", onTaskSubmit);
  dom.taskDelete?.addEventListener("click", onTaskDelete);
  dom.taskDialogClose?.addEventListener("click", closeTaskDialog);
  dom.taskCancel?.addEventListener("click", closeTaskDialog);

  // "Create task" from a message action menu. chat.js dispatches this so the
  // two modules stay decoupled.
  window.addEventListener(EVENTS.createTask, (event) => {
    openTaskDialog({
      messageId: event.detail?.messageId || null,
      sourceText: event.detail?.sourceText || "",
    });
  });

  // Any insert/update/delete on the room's tasks invalidates our copy.
  window.addEventListener(EVENTS.tasks, () => {
    const roomId = state.currentRoomId;
    if (roomId && roomId === tasksRoomId) loadTasks(roomId);
  });

  setFilter(activeFilter);
}

// Called by the rooms feature whenever the info panel switches room.
export function onRoomOpened(roomId) {
  if (roomId !== tasksRoomId) {
    tasksCache = [];
    tasksRoomId = roomId;
  }
  renderTaskSection();
  if (roomId) loadTasks(roomId);
}
