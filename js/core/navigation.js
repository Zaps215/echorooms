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
  if (dom.info) dom.info.classList.add("is-hidden");
  closeSidebar();
  closeInfo();
  switchAuthForm("signin");
}

/** Shows the first-run homepage, hiding any room or empty chat state. */
export function showHome() {
  if (dom.homeView) dom.homeView.classList.remove("is-hidden");
  if (dom.chatEmpty) dom.chatEmpty.classList.add("is-hidden");
  if (dom.chatActive) dom.chatActive.classList.add("is-hidden");
  closeInfo();
  if (dom.info) dom.info.classList.add("is-hidden");
}

/** Shows the active room chat, hiding the homepage. */
export function showRoomChat() {
  if (dom.homeView) dom.homeView.classList.add("is-hidden");
  if (dom.chatEmpty) dom.chatEmpty.classList.add("is-hidden");
  if (dom.chatActive) dom.chatActive.classList.remove("is-hidden");
  if (dom.sidebar) dom.sidebar.classList.remove("open");
  closeInfo();
  syncDrawerBackdrop();
}

// --- Mobile drawer navigation ---
// The sidebar and info panel become off-canvas drawers below the desktop
// breakpoints. These helpers centralize opening/closing so feature modules
// never touch the drawer classes directly.

export function openSidebar() {
  if (dom.sidebar) dom.sidebar.classList.add("open");
  closeInfo();
  syncDrawerBackdrop();
}

export function closeSidebar() {
  if (dom.sidebar) dom.sidebar.classList.remove("open");
  syncDrawerBackdrop();
}

export function toggleSidebar() {
  const isOpen = dom.sidebar?.classList.contains("open");
  if (isOpen) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

export function closeInfo() {
  if (dom.info) dom.info.classList.remove("open");
  syncDrawerBackdrop();
}

export function openInfo() {
  if (!dom.info) return;
  closeSidebar();
  dom.info.classList.remove("is-hidden");
  dom.info.classList.add("open");
  syncDrawerBackdrop();
}

// --- Profile page ---
// The profile view overlays the center column. The view beneath it is never
// hidden, so closing the profile simply reveals whatever was open before.

export function showProfile() {
  if (!dom.profileView) return;
  closeSidebar();
  closeInfo();
  dom.profileView.classList.remove("is-hidden");
}

export function hideProfile() {
  if (dom.profileView) dom.profileView.classList.add("is-hidden");
}

function syncDrawerBackdrop() {
  if (!dom.drawerBackdrop) return;
  const drawerOpen =
    dom.sidebar?.classList.contains("open") || dom.info?.classList.contains("open");
  dom.drawerBackdrop.classList.toggle("show", drawerOpen);
}

/** Wires the shared drawer backdrop and Escape-to-close behavior. */
export function initNavigation() {
  dom.drawerBackdrop?.addEventListener("click", () => {
    closeSidebar();
    closeInfo();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // Native dialogs handle Escape themselves (cancel). Leave them alone.
    if (document.querySelector("dialog[open]")) return;
    closeSidebar();
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
