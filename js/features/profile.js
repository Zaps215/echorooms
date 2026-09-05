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
import { showError, hideError, setUserAvatar } from "../core/utils.js";
import {
  showAuthShell,
  showProfile,
  hideProfile,
  openInfo,
  closeInfo,
} from "../core/navigation.js";
import { showConfirm } from "../core/confirm.js";

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/** Loads the signed-in user's profile into the footer, profile page, and edit form. */
export async function loadProfile() {
  if (!supabase) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  state.currentUser = user;

  const { data } = await supabase
    .from("profiles")
    .select("display_name, username, status_text")
    .eq("id", user.id)
    .single();

  const displayName = data?.display_name || user.user_metadata?.display_name || "User";

  // Sidebar footer.
  dom.meName.textContent = displayName;
  setUserAvatar(displayName, dom.meAvatar);

  // Profile page header + hero (Telegram-style: name doubles as the title).
  if (dom.profileHeadTitle) dom.profileHeadTitle.textContent = displayName;
  if (dom.profileDisplayName) dom.profileDisplayName.textContent = displayName;
  if (dom.profileHandleEl) {
    dom.profileHandleEl.textContent = data?.username ? `@${data.username}` : "";
  }
  if (dom.profileStatusText) dom.profileStatusText.textContent = data?.status_text || "";
  if (dom.profileAvatarEl) {
    setUserAvatar(displayName, dom.profileAvatarEl);
  }

  // Prefill the edit dialog.
  if (data) {
    dom.profileName.value = data.display_name || "";
    dom.profileUsername.value = data.username || "";
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
    submitBtn.disabled = true;
    hideError(dom.profileError);

    try {
      let avatarPath;
      if (avatar) {
        const ext = avatar.name.split(".").pop().toLowerCase();
        avatarPath = `${state.currentUser.id}/${crypto.randomUUID()}.${ext}`;
        const uploadResult = await supabase.storage
          .from("avatars")
          .upload(avatarPath, avatar, { contentType: avatar.type, upsert: false });

        if (uploadResult.error) {
          showError(dom.profileError, "Could not upload avatar. Please try again.");
          submitBtn.disabled = false;
          return;
        }
      }

      const updates = {
        display_name: dom.profileName.value.trim(),
        username: dom.profileUsername.value.trim() || null,
        status_text: dom.profileStatus.value.trim() || null,
      };
      if (avatarPath) updates.avatar_path = avatarPath;

      const updateResult = await supabase.from("profiles").update(updates).eq("id", state.currentUser.id);
      if (updateResult.error) {
        showError(dom.profileError, "Could not save profile. Check that your username is available.");
        submitBtn.disabled = false;
        return;
      }

      await loadProfile();
      dom.profileDialog.close();
      dom.profileForm.reset();
    } catch (error) {
      showError(dom.profileError, "Could not save profile. Please try again.");
      submitBtn.disabled = false;
    }
  });
}

function initProfilePage() {
  dom.btnOpenProfile?.addEventListener("click", () => showProfile());
  dom.btnProfileBack?.addEventListener("click", () => hideProfile());

  // The info panel's "Edit profile" lands on the full profile page.
  dom.btnEditProfile?.addEventListener("click", () => showProfile());
}

function initSignOut() {
  const signOut = async () => {
    if (!supabase) return;
    const confirmed = await requestSignOut();
    if (!confirmed) return;
    const result = await supabase.auth.signOut();
    // Errors are surfaced by the auth state handler, which returns us to login.
    void result;
  };

  dom.btnLogout?.addEventListener("click", signOut);
  dom.btnProfileLogout?.addEventListener("click", signOut);
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

  dom.btnInvite?.addEventListener("click", () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.origin).catch(() => {});
    }
    dom.btnInvite.textContent = "Invite link copied!";
    setTimeout(() => {
      dom.btnInvite.textContent = "Invite members";
    }, 2500);
  });
}

export function initProfile() {
  initDialogControls();
  initProfilePage();
  initSignOut();
  initAccountDeletion();
  initInfoPanel();
}