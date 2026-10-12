// Navigation between the auth shell and the application shell, plus the
// password reveal toggle. These are shared by the auth and OTP flows.
//
// The signed-in shell switches between Feed and Chats. The Chats view keeps
// its room-list/conversation layout, with a single-pane switch on mobile.

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
  if (
    !dom.appWrapper.classList.contains("feed-section-active") &&
    !dom.appWrapper.classList.contains("chat-section-active")
  ) {
    showFeed();
  }
}

export function showAuthShell() {
  dom.appWrapper.classList.add("is-hidden");
  dom.authWrapper.classList.remove("is-hidden");
  if (dom.info) dom.info.classList.add("is-hidden");
  closeInfo();
  dom.appWrapper.classList.remove("chat-open", "chat-section-active", "channels-open", "channels-tab-active");
  dom.appWrapper.classList.add("feed-section-active");
  dom.channelReader?.classList.add("is-hidden");
  dom.channelWelcome?.classList.add("is-hidden");
  dom.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === "all"));
  syncAppNavigation("feed");
  switchAuthForm("signin");
}

// --- Main sections and chat panes -------------------------------------------

function syncAppNavigation(view) {
  dom.appViewButtons.forEach((button) => {
    const isActive = button.dataset.appView === view;
    button.classList.toggle("active", isActive);
    if (isActive) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

export function showFeed() {
  dom.appWrapper.classList.add("feed-section-active");
  dom.appWrapper.classList.remove("chat-section-active", "chat-open", "channels-open", "channels-tab-active");
  dom.channelReader?.classList.add("is-hidden");
  closeInfo();
  syncAppNavigation("feed");
}

export function showChats() {
  dom.appWrapper.classList.add("chat-section-active");
  dom.appWrapper.classList.remove("feed-section-active", "chat-open", "channels-open", "channels-tab-active");
  dom.channelReader?.classList.add("is-hidden");
  dom.channelWelcome?.classList.add("is-hidden");
  dom.channelReader?.classList.add("is-hidden");
  closeInfo();
  syncAppNavigation("chats");
}

export function showChannelList() {
  showChats();
  dom.appWrapper.classList.add("channels-tab-active");
  if (dom.chatEmpty) dom.chatEmpty.classList.remove("is-hidden");
  if (dom.chatActive) dom.chatActive.classList.add("is-hidden");
  dom.channelReader?.classList.add("is-hidden");
  dom.channelWelcome?.classList.remove("is-hidden");
}

export function showChannelReader() {
  dom.appWrapper.classList.add("chat-section-active", "channels-open");
  dom.appWrapper.classList.remove("feed-section-active", "chat-open", "channels-tab-active");
  dom.channelWelcome?.classList.add("is-hidden");
  dom.channelReader?.classList.remove("is-hidden");
  closeInfo();
  syncAppNavigation("chats");
}

/** Shows the chat list alone. On narrow viewports this leaves the conversation. */
export function showChatList() {
  showChats();
  dom.channelWelcome?.classList.add("is-hidden");
  if (dom.chatEmpty) dom.chatEmpty.classList.remove("is-hidden");
  if (dom.chatActive) dom.chatActive.classList.add("is-hidden");
}

/** Shows the open conversation. */
export function showRoomChat() {
  dom.appWrapper.classList.add("chat-section-active", "chat-open");
  dom.appWrapper.classList.remove("feed-section-active", "channels-open", "channels-tab-active");
  dom.channelWelcome?.classList.add("is-hidden");
  dom.channelReader?.classList.add("is-hidden");
  syncAppNavigation("chats");
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
  dom.appWrapper.classList.add("profile-open");
  dom.profileContent?.classList.remove("is-hidden");
  dom.profileSettings?.classList.add("is-hidden");
  if (dom.profileHeadTitle) dom.profileHeadTitle.textContent = "Profile";
}

export function hideProfile() {
  if (dom.profileView) dom.profileView.classList.add("is-hidden");
  dom.appWrapper.classList.remove("profile-open");
}

function syncDrawerBackdrop() {
  if (!dom.drawerBackdrop) return;
  dom.drawerBackdrop.classList.toggle("show", Boolean(dom.info?.classList.contains("open")));
}

/** Wires the shared drawer backdrop and Escape-to-close behavior. */
export function initNavigation() {
  dom.drawerBackdrop?.addEventListener("click", closeInfo);
  dom.appViewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.appView === "feed") showFeed();
      else if (button.dataset.appView === "chats") {
        const channelsSelected = dom.tabs.some((tab) =>
          tab.dataset.tab === "channels" && tab.classList.contains("active")
        );
        if (channelsSelected) showChannelList();
        else showChats();
      }
    });
  });
  dom.btnNavProfile?.addEventListener("click", () => showProfile());

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