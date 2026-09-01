// Profile management, the info panel, and account lifecycle.
//
// Loads and saves the signed-in user's profile (including avatar upload to
// Supabase Storage), exposes the info panel controls (invite copy, delete
// account), and wires logout. Account deletion goes through the server-side
// delete_my_account RPC so cascading cleanup happens on the backend.

import * as dom from "../core/dom.js";
import { state, resetAppState } from "../core/state.js";
import { supabase } from "../core/supabase.js";
import { showError, hideError, setUserAvatar } from "../core/utils.js";
import { showAuthShell } from "../core/navigation.js";

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

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
  dom.meName.textContent = displayName;
  setUserAvatar(displayName, dom.meAvatar);

  if (data) {
    dom.profileName.value = data.display_name || "";
    dom.profileUsername.value = data.username || "";
    dom.profileStatus.value = data.status_text || "";
  }
}

function initDialogControls() {
  dom.profileDialogClose?.addEventListener("click", () => dom.profileDialog.close());
  dom.profileCancel?.addEventListener("click", () => dom.profileDialog.close());

  dom.btnEditProfile?.addEventListener("click", async () => {
    hideError(dom.profileError);
    if (state.currentUser) {
      await loadProfile();
    }
    dom.profileDialog.showModal();
    dom.profileName.focus();
  });

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

function initInfoPanel() {
  dom.btnInfo?.addEventListener("click", () => dom.info.classList.add("open"));
  dom.btnCloseInfo?.addEventListener("click", () => dom.info.classList.remove("open"));

  dom.btnInvite?.addEventListener("click", () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.origin).catch(() => {});
    }
    dom.btnInvite.textContent = "Invite link copied!";
    setTimeout(() => {
      dom.btnInvite.textContent = "Invite members";
    }, 2500);
  });

  dom.btnDeleteAccount?.addEventListener("click", async () => {
    if (!supabase || !window.confirm("Delete your EchoRooms account and all data? This cannot be undone.")) {
      return;
    }

    const btn = dom.btnDeleteAccount;
    btn.disabled = true;

    try {
      const result = await supabase.rpc("delete_my_account");
      if (result.error) {
        showError(dom.profileError, "Could not delete account. Please try again.");
        btn.disabled = false;
        return;
      }

      await supabase.auth.signOut();
      resetAppState();
      showAuthShell();
    } catch (error) {
      showError(dom.profileError, "Could not delete account. Please try again.");
      btn.disabled = false;
    }
  });
}

function initLogout() {
  dom.btnLogout?.addEventListener("click", async () => {
    if (!supabase) return;
    dom.btnLogout.disabled = true;
    const result = await supabase.auth.signOut();
    // Errors are surfaced by the auth state handler, which returns us to login.
    void result;
    dom.btnLogout.disabled = false;
  });
}

export function initProfile() {
  initDialogControls();
  initInfoPanel();
  initLogout();
}