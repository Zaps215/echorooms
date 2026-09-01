// Navigation between the auth shell and the application shell, plus the
// password reveal toggle. These are shared by the auth and OTP flows.

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
  switchAuthForm("signin");
}

/** Shows the first-run homepage, hiding any room or empty chat state. */
export function showHome() {
  if (dom.homeView) dom.homeView.classList.remove("is-hidden");
  if (dom.chatEmpty) dom.chatEmpty.classList.add("is-hidden");
  if (dom.chatActive) dom.chatActive.classList.add("is-hidden");
}

/** Shows the active room chat, hiding the homepage. */
export function showRoomChat() {
  if (dom.homeView) dom.homeView.classList.add("is-hidden");
  if (dom.chatEmpty) dom.chatEmpty.classList.add("is-hidden");
  if (dom.chatActive) dom.chatActive.classList.remove("is-hidden");
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
