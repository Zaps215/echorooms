import "../css/styles.css";
import { isSupabaseConfigured, supabase } from "./supabase-client.js";

// Auth wrapper
const authWrapper = document.querySelector("#auth-wrapper");
const appWrapper = document.querySelector("#app-wrapper");

// Auth forms
const authFormSignin = document.querySelector("#auth-form-signin");
const authFormSignup = document.querySelector("#auth-form-signup");
const authFormForgot = document.querySelector("#auth-form-forgot");
const authFormRecovery = document.querySelector("#auth-form-recovery");

// Auth form elements
const signinEmail = document.querySelector("#signin-email");
const signinPassword = document.querySelector("#signin-password");
const signupName = document.querySelector("#signup-name");
const signupEmail = document.querySelector("#signup-email");
const signupPassword = document.querySelector("#signup-password");
const signupConfirm = document.querySelector("#signup-confirm");
const forgotEmail = document.querySelector("#forgot-email");
const recoveryPassword = document.querySelector("#recovery-password");
const recoveryConfirm = document.querySelector("#recovery-confirm");

// Error messages
const signinError = document.querySelector("#signin-error");
const signupError = document.querySelector("#signup-error");
const forgotError = document.querySelector("#forgot-error");
const recoveryError = document.querySelector("#recovery-error");

// Auth buttons
const btnToSignup = document.querySelector("#btn-to-signup");
const btnToSignin = document.querySelector("#btn-to-signin");
const btnForgot = document.querySelector("#btn-forgot");
const btnBackSignin = document.querySelector("#btn-back-signin");
const btnGoogleSignin = document.querySelector("#btn-google-signin");

// App shell elements
const railRooms = document.querySelector("#rail-rooms");
const railProfile = document.querySelector("#rail-profile");
const roomList = document.querySelector("#room-list");
const roomSearch = document.querySelector("#room-search");
const meAvatar = document.querySelector("#me-avatar");
const meName = document.querySelector("#me-name");
const btnNewRoom = document.querySelector("#btn-new-room");
const btnLogout = document.querySelector("#btn-logout");

// Chat elements
const chatEmpty = document.querySelector("#chat-empty");
const chatActive = document.querySelector("#chat-active");
const chatTitle = document.querySelector("#chat-title");
const chatSubtitle = document.querySelector("#chat-subtitle");
const composerInput = document.querySelector("#composer-input");
const btnSend = document.querySelector("#btn-send");
const btnInfo = document.querySelector("#btn-info");
const btnBack = document.querySelector("#btn-back");

// Info panel
const info = document.querySelector("#info");
const btnCloseInfo = document.querySelector("#btn-close-info");
const infoHeadSub = document.querySelector("#info-head-sub");
const memberList = document.querySelector("#member-list");
const memberCount = document.querySelector("#member-count");
const btnInvite = document.querySelector("#btn-invite");
const btnEditProfile = document.querySelector("#btn-edit-profile");
const btnDeleteAccount = document.querySelector("#btn-delete-account");

// Dialogs
const roomDialog = document.querySelector("#room-dialog");
const roomForm = document.querySelector("#room-form");
const roomName = document.querySelector("#room-name");
const roomError = document.querySelector("#room-error");
const roomDialogClose = document.querySelector("#room-dialog-close");
const roomCancel = document.querySelector("#room-cancel");

const profileDialog = document.querySelector("#profile-dialog");
const profileForm = document.querySelector("#profile-form");
const profileName = document.querySelector("#profile-name");
const profileUsername = document.querySelector("#profile-username");
const profileStatus = document.querySelector("#profile-status");
const profileAvatar = document.querySelector("#profile-avatar");
const profileError = document.querySelector("#profile-error");
const profileDialogClose = document.querySelector("#profile-dialog-close");
const profileCancel = document.querySelector("#profile-cancel");

// State
let rooms = [];
let currentRoomId = null;
let currentUser = null;

// ============ Helper Functions ============

function showError(errorEl, message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function hideError(errorEl) {
  errorEl.hidden = true;
  errorEl.textContent = "";
}

function showAuthError(error) {
  const msg = error?.message?.toLowerCase() || "";
  if (msg.includes("invalid login credentials")) {
    return "That email or password is incorrect.";
  }
  if (msg.includes("email not confirmed")) {
    return "Confirm your email address before signing in.";
  }
  if (msg.includes("user already registered")) {
    return "An account already exists for that email. Try signing in.";
  }
  if (msg.includes("error sending confirmation email")) {
    return "Supabase could not send the confirmation email. Configure an email provider in Supabase.";
  }
  return "We couldn't complete that request. Check your details and try again.";
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;",
  })[c]);
}

function switchAuthForm(view) {
  document.querySelectorAll(".auth-form").forEach((f) => f.classList.remove("active"));
  const form = document.querySelector(`[data-view="${view}"]`);
  if (form) form.classList.add("active");
}

function showAppShell() {
  authWrapper.classList.add("is-hidden");
  appWrapper.classList.remove("is-hidden");
}

function showAuthShell() {
  appWrapper.classList.add("is-hidden");
  authWrapper.classList.remove("is-hidden");
  switchAuthForm("signin");
}

function setUserAvatar(name, element) {
  if (!name) return;
  element.textContent = name.charAt(0).toUpperCase();
  const colors = [
    "linear-gradient(135deg, var(--amber), var(--sun))",
    "linear-gradient(135deg, var(--accent), var(--accent-strong))",
    "linear-gradient(135deg, var(--amethyst), #bb7bff)",
  ];
  const hash = name.charCodeAt(0) % colors.length;
  element.style.background = colors[hash];
}

// ============ Password Toggle ============

document.querySelectorAll("[data-reveal]").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    const targetId = btn.getAttribute("data-target");
    const input = document.querySelector(`#${targetId}`);
    if (!input) return;
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    btn.classList.toggle("showing", isPassword);
  });
});

// ============ Auth Form Submission ============

authFormSignin.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!isSupabaseConfigured) {
    showError(signinError, "Secure sign-in is unavailable right now.");
    return;
  }

  const submitBtn = authFormSignin.querySelector(".btn-primary");
  submitBtn.disabled = true;
  hideError(signinError);

  try {
    const result = await supabase.auth.signInWithPassword({
      email: signinEmail.value.trim(),
      password: signinPassword.value,
    });

    if (result.error) {
      showError(signinError, showAuthError(result.error));
      submitBtn.disabled = false;
      return;
    }

    authFormSignin.reset();
    showAppShell();
  } catch (error) {
    showError(signinError, showAuthError(error));
    submitBtn.disabled = false;
  }
});

authFormSignup.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!isSupabaseConfigured) {
    showError(signupError, "Secure sign-up is unavailable right now.");
    return;
  }

  if (signupPassword.value !== signupConfirm.value) {
    showError(signupError, "Passwords do not match.");
    return;
  }

  const submitBtn = authFormSignup.querySelector(".btn-primary");
  submitBtn.disabled = true;
  hideError(signupError);

  try {
    const result = await supabase.auth.signUp({
      email: signupEmail.value.trim(),
      password: signupPassword.value,
      options: {
        data: { display_name: signupName.value.trim() },
      },
    });

    if (result.error) {
      showError(signupError, showAuthError(result.error));
      submitBtn.disabled = false;
      return;
    }

    if (result.data.session) {
      authFormSignup.reset();
      showAppShell();
    } else {
      showError(signupError, "Check your email to confirm your account.");
      authFormSignup.reset();
      switchAuthForm("signin");
    }
  } catch (error) {
    showError(signupError, showAuthError(error));
    submitBtn.disabled = false;
  }
});

authFormForgot.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!isSupabaseConfigured) {
    showError(forgotError, "Password reset is unavailable right now.");
    return;
  }

  const submitBtn = authFormForgot.querySelector(".btn-primary");
  submitBtn.disabled = true;
  hideError(forgotError);

  try {
    const result = await supabase.auth.resetPasswordForEmail(forgotEmail.value.trim(), {
      redirectTo: window.location.origin,
    });

    if (result.error) {
      showError(forgotError, showAuthError(result.error));
      submitBtn.disabled = false;
      return;
    }

    showError(forgotError, "Check your email for a password reset link.");
    authFormForgot.reset();
    submitBtn.disabled = false;
  } catch (error) {
    showError(forgotError, showAuthError(error));
    submitBtn.disabled = false;
  }
});

authFormRecovery.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!isSupabaseConfigured) {
    showError(recoveryError, "Password update is unavailable right now.");
    return;
  }

  if (recoveryPassword.value !== recoveryConfirm.value) {
    showError(recoveryError, "Passwords do not match.");
    return;
  }

  const submitBtn = authFormRecovery.querySelector(".btn-primary");
  submitBtn.disabled = true;
  hideError(recoveryError);

  try {
    const result = await supabase.auth.updateUser({ password: recoveryPassword.value });

    if (result.error) {
      showError(recoveryError, "Could not update password. Please request a new reset link.");
      submitBtn.disabled = false;
      return;
    }

    authFormRecovery.reset();
    showAppShell();
  } catch (error) {
    showError(recoveryError, "Could not update password.");
    submitBtn.disabled = false;
  }
});

// ============ Auth Navigation ============

btnToSignup.addEventListener("click", (e) => {
  e.preventDefault();
  switchAuthForm("register");
});

btnToSignin.addEventListener("click", (e) => {
  e.preventDefault();
  switchAuthForm("signin");
});

btnForgot.addEventListener("click", (e) => {
  e.preventDefault();
  switchAuthForm("forgot");
});

btnBackSignin.addEventListener("click", (e) => {
  e.preventDefault();
  switchAuthForm("signin");
});

btnGoogleSignin.addEventListener("click", async (e) => {
  e.preventDefault();
  if (!isSupabaseConfigured) {
    showError(signinError, "Google sign-in is unavailable right now.");
    return;
  }

  const btn = e.target.closest("button");
  btn.disabled = true;

  try {
    const result = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });

    if (result.error) {
      showError(signinError, "Google sign-in failed. Please try again.");
      btn.disabled = false;
    }
  } catch (error) {
    showError(signinError, "Google sign-in failed. Please try again.");
    btn.disabled = false;
  }
});

// ============ Room Management ============

function renderRooms(filterText = "") {
  const filtered = rooms.filter((r) => r.name.toLowerCase().includes(filterText.toLowerCase()));

  if (!filtered.length) {
    roomList.innerHTML = '<p style="padding: 16px; text-align: center; color: var(--muted); font-size: 13px;">No rooms found.</p>';
    return;
  }

  roomList.innerHTML = filtered.map((room) => {
    const avatarGradients = [
      "linear-gradient(135deg, var(--amber), var(--sun))",
      "linear-gradient(135deg, var(--accent), var(--accent-strong))",
      "linear-gradient(135deg, var(--amethyst), #bb7bff)",
    ];
    const hash = room.name.charCodeAt(0) % avatarGradients.length;
    const isActive = room.id === currentRoomId;

    return `
      <button class="room-item ${isActive ? "active" : ""}" data-room-id="${room.id}" type="button">
        <div class="room-avatar" style="background: ${avatarGradients[hash]}">
          ${room.name.charAt(0).toUpperCase()}
        </div>
        <div class="room-main">
          <div class="room-top">
            <span class="room-name">${escapeHtml(room.name)}</span>
          </div>
        </div>
      </button>
    `;
  }).join("");

  roomList.querySelectorAll(".room-item").forEach((btn) => {
    btn.addEventListener("click", () => selectRoom(btn.dataset.roomId));
  });
}

function selectRoom(roomId) {
  currentRoomId = roomId;
  const room = rooms.find((r) => r.id === roomId);
  if (!room) return;

  chatTitle.textContent = room.name;
  chatSubtitle.textContent = "Room open";
  chatEmpty.classList.add("hidden");
  chatActive.classList.remove("hidden");

  renderRooms();
}

async function loadRooms() {
  if (!supabase) return;
  const { data, error } = await supabase
    .from("room_members")
    .select("rooms(id, name, room_type, created_at)")
    .order("created_at", { ascending: false });

  if (error) return;

  rooms = data.map((m) => m.rooms).filter(Boolean);
  renderRooms();

  if (rooms.length > 0) {
    selectRoom(rooms[0].id);
  }
}

btnNewRoom.addEventListener("click", () => {
  hideError(roomError);
  roomForm.reset();
  roomDialog.showModal();
  roomName.focus();
});

roomDialogClose.addEventListener("click", () => roomDialog.close());
roomCancel.addEventListener("click", () => roomDialog.close());

roomForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!supabase) return;

  const submitBtn = roomForm.querySelector(".btn-primary");
  submitBtn.disabled = true;
  hideError(roomError);

  try {
    const result = await supabase.rpc("create_room", {
      room_name: roomName.value.trim(),
    });

    if (result.error) {
      showError(roomError, "Could not create room. Please try again.");
      submitBtn.disabled = false;
      return;
    }

    if (!result.data || !result.data[0]) {
      showError(roomError, "Could not create room. Please try again.");
      submitBtn.disabled = false;
      return;
    }

    rooms.unshift(result.data[0]);
    renderRooms();
    selectRoom(result.data[0].id);
    roomDialog.close();
    roomForm.reset();
  } catch (error) {
    showError(roomError, "Could not create room. Please try again.");
    submitBtn.disabled = false;
  }
});

// ============ Profile Management ============

async function loadProfile() {
  if (!supabase) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  currentUser = user;

  const { data } = await supabase
    .from("profiles")
    .select("display_name, username, status_text")
    .eq("id", user.id)
    .single();

  const displayName = data?.display_name || user.user_metadata?.display_name || "User";
  meName.textContent = displayName;
  setUserAvatar(displayName, meAvatar);
  railProfile.textContent = displayName.charAt(0).toUpperCase();

  if (data) {
    profileName.value = data.display_name || "";
    profileUsername.value = data.username || "";
    profileStatus.value = data.status_text || "";
  }
}

btnEditProfile.addEventListener("click", async () => {
  hideError(profileError);
  if (currentUser) {
    await loadProfile();
  }
  profileDialog.showModal();
  profileName.focus();
});

profileDialogClose.addEventListener("click", () => profileDialog.close());
profileCancel.addEventListener("click", () => profileDialog.close());

profileForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!supabase || !currentUser) return;

  const avatar = profileAvatar.files[0];
  if (avatar && (!avatar.type.startsWith("image/") || avatar.size > 5 * 1024 * 1024)) {
    showError(profileError, "Choose a PNG, JPEG, or WebP image smaller than 5 MB.");
    return;
  }

  const submitBtn = profileForm.querySelector(".btn-primary");
  submitBtn.disabled = true;
  hideError(profileError);

  try {
    let avatarPath;
    if (avatar) {
      const ext = avatar.name.split(".").pop().toLowerCase();
      avatarPath = `${currentUser.id}/${crypto.randomUUID()}.${ext}`;
      const uploadResult = await supabase.storage
        .from("avatars")
        .upload(avatarPath, avatar, { contentType: avatar.type, upsert: false });

      if (uploadResult.error) {
        showError(profileError, "Could not upload avatar. Please try again.");
        submitBtn.disabled = false;
        return;
      }
    }

    const updates = {
      display_name: profileName.value.trim(),
      username: profileUsername.value.trim() || null,
      status_text: profileStatus.value.trim() || null,
    };

    if (avatarPath) updates.avatar_path = avatarPath;

    const updateResult = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", currentUser.id);

    if (updateResult.error) {
      showError(profileError, "Could not save profile. Check that your username is available.");
      submitBtn.disabled = false;
      return;
    }

    await loadProfile();
    profileDialog.close();
    profileForm.reset();
  } catch (error) {
    showError(profileError, "Could not save profile. Please try again.");
    submitBtn.disabled = false;
  }
});

// ============ Info Panel ============

btnInfo.addEventListener("click", () => {
  info.classList.add("open");
});

btnCloseInfo.addEventListener("click", () => {
  info.classList.remove("open");
});

btnDeleteAccount.addEventListener("click", async () => {
  if (!supabase || !window.confirm("Delete your EchoRooms account and all data? This cannot be undone.")) return;

  const btn = btnDeleteAccount;
  btn.disabled = true;

  try {
    const result = await supabase.rpc("delete_my_account");
    if (result.error) {
      showError(profileError, "Could not delete account. Please try again.");
      btn.disabled = false;
      return;
    }

    await supabase.auth.signOut();
    showAuthShell();
  } catch (error) {
    showError(profileError, "Could not delete account. Please try again.");
    btn.disabled = false;
  }
});

// ============ Chat Composer ============

btnSend.addEventListener("click", () => {
  // Placeholder for future messaging implementation
  if (composerInput.value.trim()) {
    composerInput.value = "";
  }
});

composerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    btnSend.click();
  }
});

btnBack.addEventListener("click", () => {
  // Mobile back button
  chatActive.classList.add("hidden");
  chatEmpty.classList.remove("hidden");
  currentRoomId = null;
});

// ============ Auth State ============

btnLogout.addEventListener("click", async () => {
  if (!supabase) return;
  btnLogout.disabled = true;
  const result = await supabase.auth.signOut();
  if (result.error) {
    showAuthError(result.error);
  }
  btnLogout.disabled = false;
});

// ============ Setup ============

if (isSupabaseConfigured) {
  supabase.auth.onAuthStateChange((event, session) => {
    if (session) {
      currentUser = session.user;
      showAppShell();
      loadRooms();
      loadProfile();

      if (event === "PASSWORD_RECOVERY") {
        switchAuthForm("recovery");
      }
    } else {
      currentUser = null;
      rooms = [];
      currentRoomId = null;
      showAuthShell();
    }
  });

  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      currentUser = session.user;
      showAppShell();
      loadRooms();
      loadProfile();
    } else {
      showAuthShell();
    }
  });
} else {
  showAuthShell();
}

// Room search
roomSearch.addEventListener("input", (e) => {
  renderRooms(e.target.value);
});
