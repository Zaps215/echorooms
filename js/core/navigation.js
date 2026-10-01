// Navigation between the auth shell and the application shell, plus the
// password reveal toggle. These are shared by the auth and OTP flows.
//
// The app shell is two panes: the chat list (sidebar) and the conversation.
// On wide viewports both are visible at once; on narrow ones a single
// `chat-open` class on the app wrapper swaps between them.

import * as dom from "./dom.js";

/** Makes a single auth form (by data-view) active and the rest inactive. */
export function switchAuthForm(view) {
  document.querySelectorAll(".auth-form").forEach((f) => f.classList.remove("active"));
  const form = document.querySelector(`[data-view="${view}"]`);
  if (form) form.classList.add("active");
}

export function showAppShell() {
  dom.authWrapper.classList.add("is-hidden");
  dom.appWrapper.classList.remove("is-hidden");
}

export function showAuthShell() {
  dom.appWrapper.classList.add("is-hidden");
  dom.authWrapper.classList.remove("is-hidden");
  if (dom.info) dom.info.classList.add("is-hidden");
  closeInfo();
  switchAuthForm("signin");
}

// --- Chat list / conversation panes -----------------------------------------

/** Shows the chat list alone. On narrow viewports this leaves the conversation. */
export function showChatList() {
  dom.appWrapper.classList.remove("chat-open");
  closeInfo();
}

/** Shows the open conversation. */
export function showRoomChat() {
  dom.appWrapper.classList.add("chat-open");
  if (dom.chatEmpty) dom.chatEmpty.classList.add("is-hidden");
  if (dom.chatActive) dom.chatActive.classList.remove("is-hidden");
  closeInfo();
}

// --- Info drawer ------------------------------------------------------------
// The chat info panel slides over the conversation on every viewport width.

export function openInfo() {
  if (!dom.info) return;
  dom.info.classList.remove("is-hidden");
  dom.info.classList.add("open");
  syncDrawerBackdrop();
}

export function closeInfo() {
  if (!dom.info) return;
  dom.info.classList.remove("open");
  syncDrawerBackdrop();
}

// --- Profile view ------------------------------------------------------------
// The profile view overlays the app shell. The view beneath it is never
// hidden, so closing the profile simply reveals whatever was open before.

export function showProfile() {
  if (!dom.profileView) return;
  closeInfo();
  dom.profileView.classList.remove("is-hidden");
}

export function hideProfile() {
  if (dom.profileView) dom.profileView.classList.add("is-hidden");
}

function syncDrawerBackdrop() {
  if (!dom.drawerBackdrop) return;
  dom.drawerBackdrop.classList.toggle("show", Boolean(dom.info?.classList.contains("open")));
}

/** Wires the shared drawer backdrop and Escape-to-close behavior. */
export function initNavigation() {
  dom.drawerBackdrop?.addEventListener("click", closeInfo);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // Native dialogs handle Escape themselves (cancel). Leave them alone.
    if (document.querySelector("dialog[open]")) return;
    closeInfo();
    hideProfile();
  });
}

export function initPasswordToggle() {
  dom.passwordToggles.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute("data-target");
      const input = document.getElementById(targetId);
      if (!input) return;
      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";
      btn.classList.toggle("showing", isPassword);
    });
  });
}