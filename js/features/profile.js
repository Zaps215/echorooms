// Profile management, the profile page, and account lifecycle.
//
// Identity is presented on a dedicated profile page (opened from the sidebar
// footer) that mirrors the pattern of messaging apps: a large avatar, name,
// handle, and status, with account actions grouped below. Editing happens in
// the Edit-profile dialog. Signing out and deleting the account both go
// through the shared confirm dialog — deletion additionally requires the
// user's own email to be typed. Account deletion runs the server-side
// delete_my_account RPC so cascading cleanup happens on the backend.

import * as dom from "../core/dom.js";
import { state, resetAppState } from "../core/state.js";
import { supabase } from "../core/supabase.js";
import {
  showError,
  hideError,
  setUserAvatar,
  setButtonLoading,
  getRequestErrorMessage,
  logAppError,
} from "../core/utils.js";
import {
  showAuthShell,
  showProfile,
  hideProfile,
  openInfo,
  closeInfo,
} from "../core/navigation.js";
import { showConfirm } from "../core/confirm.js";

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

let currentProfile = null;

async function updateAvatarElement(element, name, avatarPath) {
  if (!element) return;
  setUserAvatar(name, element);
  element.classList.remove("has-img");
  element.style.backgroundImage = "";
  if (!avatarPath || !supabase) return;
  const { data, error } = await supabase.storage.from("avatars").createSignedUrl(avatarPath, 3600);
  if (error) {
    if (import.meta.env.DEV) console.warn("[profile] Could not load profile photo.", error);
    return;
  }
  element.style.backgroundImage = `url("${data.signedUrl}")`;
  element.classList.add("has-img");
}

/** True when the signed-in user still needs to claim a @username. */
export function needsUsername() {
  return !getCurrentUsername();
}

function getCurrentUsername() {
  return (currentProfile && currentProfile.username) || "";
}

/** Claims a unique @username for the current user. */
export async function claimUsername(username) {
  if (!supabase || !state.currentUser) return { error: { message: "Not signed in." } };
  return supabase.from("profiles").update({ username }).eq("id", state.currentUser.id);
}

/** Opens the dialog that asks the user to claim a @username. */
export function openUsernameDialog() {
  if (!dom.usernameDialog || dom.usernameDialog.open) return;
  hideError(dom.usernameError);
  dom.usernameForm.reset();
  dom.usernameDialog.showModal();
  dom.usernameInput.focus();
}

/** Loads the signed-in user's profile into the footer, profile page, and edit form. */
export async function loadProfile() {
  if (!supabase) return;
  let user;
  try {
    const result = await supabase.auth.getUser();
    if (result.error) throw result.error;
    user = result.data.user;
  } catch (error) {
    logAppError("profile", error);
    showError(dom.profilePageError, "Your profile couldn't load. Check your connection and try again.");
    return;
  }
  if (!user) return;

  state.currentUser = user;

  const { data, error } = await supabase
    .from("profiles")
    .select("display_name, username, status_text, avatar_path")
    .eq("id", user.id)
    .single();
  if (error) {
    logAppError("profile", error);
    showError(dom.profilePageError, "Your profile couldn't load. Check your connection and try again.");
    return;
  }

  currentProfile = data || currentProfile;

  const displayName = data?.display_name || user.user_metadata?.display_name || "User";

  // Sidebar footer.
  dom.meName.textContent = displayName;
  await Promise.all([
    updateAvatarElement(dom.meAvatar, displayName, data?.avatar_path),
    updateAvatarElement(dom.navAvatar, displayName, data?.avatar_path),
    updateAvatarElement(dom.profileAvatarEl, displayName, data?.avatar_path),
    updateAvatarElement(dom.feedComposeAvatar, displayName, data?.avatar_path),
    updateAvatarElement(dom.feedPostAvatar, displayName, data?.avatar_path),
  ]);

  // Profile page header + hero (Telegram-style: name doubles as the title).
  if (dom.profileHeadTitle) dom.profileHeadTitle.textContent = displayName;
  if (dom.profileDisplayName) dom.profileDisplayName.textContent = displayName;
  if (dom.profileHandleEl) {
    dom.profileHandleEl.textContent = data?.username ? `@${data.username}` : "";
  }
  if (dom.profileStatusText) dom.profileStatusText.textContent = data?.status_text || "";
  // Prefill the edit dialog and lock the username once it has been claimed.
  if (data) {
    dom.profileName.value = data.display_name || "";
    dom.profileUsername.value = data.username || "";
    dom.profileUsername.placeholder = data.username ? "Already set — cannot change" : "optional";
    dom.profileUsername.disabled = !!data.username;
    dom.profileStatus.value = data.status_text || "";
  }
}

/** Opens the Edit-profile dialog, refreshing the latest profile first. */
export async function openProfileDialog() {
  hideError(dom.profileError);
  if (state.currentUser) {
    await loadProfile();
  }
  hideError(dom.profilePageError);
  dom.profileDialog.showModal();
  dom.profileName.focus();
}

/** Destructive account actions require an explicit typed confirmation. */
function requestAccountDeletion() {
  return showConfirm({
    danger: true,
    title: "Delete your account?",
    message:
      "This permanently deletes your account, rooms, messages, and files. This cannot be undone.",
    confirmLabel: "Delete account",
    requiredText: state.currentUser?.email || "DELETE",
  });
}

function requestSignOut() {
  return showConfirm({
    title: "Sign out of EchoRooms?",
    message: "You can sign back in anytime with your email and password.",
    confirmLabel: "Sign out",
  });
}

function initDialogControls() {
  dom.profileDialogClose?.addEventListener("click", () => dom.profileDialog.close());
  dom.profileCancel?.addEventListener("click", () => dom.profileDialog.close());

  dom.btnProfileEdit?.addEventListener("click", openProfileDialog);
  dom.btnProfileAvatar?.addEventListener("click", openProfileDialog);

  dom.profileForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!supabase || !state.currentUser) return;

    const avatar = dom.profileAvatar.files[0];
    if (avatar && (!avatar.type.startsWith("image/") || avatar.size > AVATAR_MAX_BYTES)) {
      showError(dom.profileError, "Choose a PNG, JPEG, or WebP image smaller than 5 MB.");
      return;
    }

    const submitBtn = dom.findPrimaryButton(dom.profileForm);
    hideError(dom.profileError);
    setButtonLoading(submitBtn, true, "Saving profile…");

    try {
      let avatarPath;
      if (avatar) {
        const ext = avatar.name.split(".").pop().toLowerCase();
        avatarPath = `${state.currentUser.id}/${crypto.randomUUID()}.${ext}`;
        const uploadResult = await supabase.storage
          .from("avatars")
          .upload(avatarPath, avatar, { contentType: avatar.type, upsert: false });

        if (uploadResult.error) {
          showError(
            dom.profileError,
            getRequestErrorMessage(uploadResult.error, "Could not upload avatar. Please try again.")
          );
          return;
        }
      }

      const nextUsername = dom.profileUsername.value.trim();

      const updates = {
        display_name: dom.profileName.value.trim(),
        username: nextUsername || getCurrentUsername() || null,
        status_text: dom.profileStatus.value.trim() || null,
      };
      if (avatarPath) updates.avatar_path = avatarPath;

      const updateResult = await supabase.from("profiles").update(updates).eq("id", state.currentUser.id);
      if (updateResult.error) {
        if (updateResult.error.code === "23505") {
          showError(dom.profileError, "That username is already taken. Choose a different username.");
        } else {
          showError(
            dom.profileError,
            getRequestErrorMessage(updateResult.error, "Could not save profile. Check that your username is available.")
          );
        }
        return;
      }

      await loadProfile();
      dom.profileDialog.close();
      dom.profileForm.reset();
      dom.profileUsername.disabled = false;
    } catch (error) {
      showError(dom.profileError, getRequestErrorMessage(error, "Could not save profile. Please try again."));
    } finally {
      setButtonLoading(submitBtn, false);
    }
  });
}

function initProfilePage() {
  dom.btnOpenProfile?.addEventListener("click", () => showProfile());
  dom.btnProfileBack?.addEventListener("click", () => {
    if (!dom.profileSettings?.classList.contains("is-hidden")) {
      dom.profileSettings.classList.add("is-hidden");
      dom.profileContent?.classList.remove("is-hidden");
      if (dom.profileHeadTitle) dom.profileHeadTitle.textContent = "Profile";
      return;
    }
    hideProfile();
  });
  dom.btnProfileSettings?.addEventListener("click", () => {
    dom.profileContent?.classList.add("is-hidden");
    dom.profileSettings?.classList.remove("is-hidden");
    if (dom.profileHeadTitle) dom.profileHeadTitle.textContent = "Settings";
  });
  dom.btnProfileShare?.addEventListener("click", async () => {
    const username = getCurrentUsername();
    const text = username ? `Find me on EchoRooms: @${username}` : "Find me on EchoRooms.";
    try {
      if (navigator.share) {
        await navigator.share({ title: "My EchoRooms profile", text });
        dom.profileShareFeedback.textContent = "Profile shared.";
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        dom.profileShareFeedback.textContent = "Your handle was copied.";
      } else {
        throw new Error("Profile sharing is not supported in this browser.");
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        dom.profileShareFeedback.textContent = getRequestErrorMessage(error, "Couldn't share your profile. Please try again.");
      }
    }
  });
  dom.btnSettingsEditProfile?.addEventListener("click", openProfileDialog);
  if ("Notification" in window && dom.notificationSettingStatus) {
    if (Notification.permission === "granted") {
      dom.notificationSettingStatus.textContent = "Notifications are enabled for this browser.";
      if (dom.btnEnableNotifications) dom.btnEnableNotifications.textContent = "Enabled";
    } else if (Notification.permission === "denied") {
      dom.notificationSettingStatus.textContent = "Notifications are blocked. Allow them in your browser's site settings.";
    }
  }
  window.addEventListener("echorooms:profile-save-error", (event) => {
    showProfile();
    showError(dom.profilePageError, event.detail?.message || "Could not save your profile. Please try again.");
  });
}

function initSignOut() {
  const signOut = async () => {
    if (!supabase) return;
    const confirmed = await requestSignOut();
    if (!confirmed) return;
    hideError(dom.profilePageError);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        showProfile();
        showError(
          dom.profilePageError,
          getRequestErrorMessage(error, "Couldn't sign out. Please try again.")
        );
      }
    } catch (error) {
      showProfile();
      showError(
        dom.profilePageError,
        getRequestErrorMessage(error, "Couldn't sign out. Please try again.")
      );
    }
  };

  dom.btnLogout?.addEventListener("click", signOut);
  dom.btnSettingsSignout?.addEventListener("click", signOut);
}

function initAccountDeletion() {
  dom.btnProfileDelete?.addEventListener("click", async () => {
    if (!supabase || !state.currentUser) return;

    const confirmed = await requestAccountDeletion();
    if (!confirmed) return;

    const btn = dom.btnProfileDelete;
    btn.disabled = true;
    hideError(dom.profilePageError);

    try {
      const result = await supabase.rpc("delete_my_account");
      if (result.error) {
        showError(dom.profilePageError, "Could not delete account. Please try again.");
        btn.disabled = false;
        return;
      }

      await supabase.auth.signOut();
      resetAppState();
      showAuthShell();
    } catch (error) {
      showError(dom.profilePageError, "Could not delete account. Please try again.");
      btn.disabled = false;
    }
  });
}

function initInfoPanel() {
  dom.btnInfo?.addEventListener("click", () => openInfo());
  dom.btnCloseInfo?.addEventListener("click", () => closeInfo());
  // The info panel's "Invite members" button opens the invite dialog (rooms.js).
}

function initUsernameDialog() {
  dom.usernameForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!supabase || !state.currentUser) return;

    const value = dom.usernameInput.value.trim().replace(/\s+/g, "");
    if (value.length < 3) {
      showError(dom.usernameError, "Usernames must be at least 3 characters.");
      return;
    }
    if (!/^[A-Za-z0-9_.]+$/.test(value)) {
      showError(dom.usernameError, "Only letters, numbers, dots, and underscores are allowed.");
      return;
    }

    const submitBtn = dom.findPrimaryButton(dom.usernameForm);
    hideError(dom.usernameError);
    setButtonLoading(submitBtn, true, "Checking username…");

    try {
      const { error } = await claimUsername(value);

      if (error) {
        if (error.code === "23505") {
          showError(dom.usernameError, "That username is already taken. Try another username.");
        } else {
          showError(
            dom.usernameError,
            getRequestErrorMessage(error, "Could not save username. Please try again.")
          );
        }
        return;
      }

      await loadProfile();
      dom.usernameDialog.close();
    } catch (error) {
      showError(dom.usernameError, getRequestErrorMessage(error, "Could not save username. Please try again."));
    } finally {
      setButtonLoading(submitBtn, false);
    }
  });
}

export function initProfile() {
  initDialogControls();
  initProfilePage();
  initSignOut();
  initAccountDeletion();
  initInfoPanel();
  initUsernameDialog();
}