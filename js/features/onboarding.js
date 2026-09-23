// First-run profile onboarding.
//
// Shown once after the user claims nothing yet: a full-page overlay inside the
// app shell asking them to pick a @username (required, unchangeable) and, as
// entirely optional extras, a display name, a date of birth, and a profile
// picture. Both buttons require only the username; the optional fields can be
// filled in later from Profile → Edit, which is why "Save username only" is the
// skip affordance.

import * as dom from "../core/dom.js";
import { state } from "../core/state.js";
import { supabase } from "../core/supabase.js";
import { showError, hideError, setUserAvatar } from "../core/utils.js";
import { showOnboarding, hideOnboarding } from "../core/navigation.js";
import { claimUsername, loadProfile } from "./profile.js";

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
let avatarPath = null;
let previewUrl = null;

/** Opens the onboarding overlay and prefills any known details. */
export async function openOnboarding() {
  if (!dom.onboardingView) return;
  hideError(dom.onboardError);
  dom.onboardingForm.reset();
  avatarPath = null;
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
  if (dom.onboardAvatarPreview) {
    setUserAvatar("?", dom.onboardAvatarPreview);
  }

  if (state.currentUser) {
    const meta = state.currentUser.user_metadata || {};
    dom.onboardName.value = meta.display_name || "";
    dom.onboardDob.value = meta.date_of_birth || "";
  }

  showOnboarding();
  dom.onboardUsername.focus();
}

function closeOnboarding() {
  hideOnboarding();
}

function readAvatar() {
  const file = dom.onboardAvatarInput?.files?.[0];
  if (!file || !/^image\//.test(file.type) || file.size > AVATAR_MAX_BYTES) {
    showError(dom.onboardError, "Pick a PNG, JPEG, or WebP image smaller than 5 MB.");
    return null;
  }
  return file;
}

async function uploadAvatar(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  avatarPath = `${state.currentUser.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("avatars")
    .upload(avatarPath, file, { contentType: file.type, upsert: false });
  return error;
}

async function finishOnboarding(saveOptional) {
  if (!supabase || !state.currentUser) return;

  const username = dom.onboardUsername.value.trim().replace(/\s+/g, "");
  if (username.length < 3) {
    showError(dom.onboardError, "Usernames must be at least 3 characters.");
    return;
  }
  if (!/^[A-Za-z0-9_.]+$/.test(username)) {
    showError(dom.onboardError, "Only letters, numbers, dots, and underscores are allowed.");
    return;
  }

  const submitBtn = dom.findPrimaryButton(dom.onboardingForm);
  submitBtn.disabled = true;
  hideError(dom.onboardError);

  try {
    const claim = await claimUsername(username);
    if (claim.error) {
      showError(
        dom.onboardError,
        claim.error.code === "23505"
          ? "That username is already taken. Pick another."
          : "Could not save your username. Please try again."
      );
      submitBtn.disabled = false;
      return;
    }

    if (saveOptional) {
      const avatarFile = readAvatar();
      if (avatarFile === null && dom.onboardAvatarInput?.files?.[0]) {
        submitBtn.disabled = false;
        return;
      }
      if (avatarFile) {
        const uploadError = await uploadAvatar(avatarFile);
        if (uploadError) {
          avatarPath = null;
          showError(dom.onboardError, "Could not upload your photo. Save again to retry.");
          submitBtn.disabled = false;
          return;
        }
      }

      const displayName = dom.onboardName.value.trim();
      const updates = {};
      if (displayName) updates.display_name = displayName;
      if (avatarPath) updates.avatar_path = avatarPath;
      if (Object.keys(updates).length) {
        const save = await supabase.from("profiles").update(updates).eq("id", state.currentUser.id);
        if (save.error) {
          showError(dom.onboardError, "Could not save your profile. Please try again.");
          submitBtn.disabled = false;
          return;
        }
      }

      const dob = dom.onboardDob.value;
      if (dob) {
        await supabase.auth.updateUser({
          data: {
            date_of_birth: dob,
            display_name: displayName || undefined,
          },
        });
      }
    }

    await loadProfile();
    closeOnboarding();
  } catch (error) {
    showError(dom.onboardError, "Something went wrong. Please try again.");
    submitBtn.disabled = false;
  }
}

function initAvatarPicker() {
  dom.btnOnboardAvatar?.addEventListener("click", () => dom.onboardAvatarInput?.click());
  dom.onboardAvatarInput?.addEventListener("change", () => {
    const file = dom.onboardAvatarInput.files[0];
    if (!file || !/^image\//.test(file.type) || file.size > AVATAR_MAX_BYTES) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    if (dom.onboardAvatarPreview) {
      dom.onboardAvatarPreview.textContent = "";
      dom.onboardAvatarPreview.style.backgroundImage = `url(${previewUrl})`;
      dom.onboardAvatarPreview.style.backgroundSize = "cover";
      dom.onboardAvatarPreview.style.backgroundPosition = "center";
    }
  });
}

function initOnboardingForm() {
  dom.onboardingForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    finishOnboarding(true);
  });
  dom.btnOnboardSkip?.addEventListener("click", () => finishOnboarding(false));
}

export function initOnboarding() {
  initAvatarPicker();
  initOnboardingForm();
}