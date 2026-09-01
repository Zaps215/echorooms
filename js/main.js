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

// OTP elements
const authFormOtp = document.querySelector("#auth-form-otp");
const otpEmail = document.querySelector("#otp-email");
const otpTitle = document.querySelector("#otp-title");
const otpBoxes = document.querySelector("#otp-boxes");
const otpResendLabel = document.querySelector("#otp-resend-label");
const otpCountdown = document.querySelector("#otp-countdown");
const otpResend = document.querySelector("#otp-resend");
const otpError = document.querySelector("#otp-error");
const otpBack = document.querySelector("#otp-back");

// App shell elements
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
const messagesEl = document.querySelector("#messages");
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
let activeTab = "all";
let currentUser = null;

// OTP state
let otpPurpose = "signup"; // "signup" | "reset"
let otpEmailValue = "";
let otpPendingName = "";
let otpPendingPassword = "";
let otpCountdownTimer = null;

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

function updatePasswordStrength(input, strengthEl) {
  if (!input || !strengthEl) return;

  const score = (pw) => {
    let s = 0;
    if (pw.length >= 8) s++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
    if (/\d/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    return s;
  };

  const labels = ["", "Too weak", "Weak", "Fair", "Strong"];
  const bars = strengthEl.querySelector(".strength-bars");
  const label = strengthEl.querySelector(".strength-label");

  const s = score(input.value);
  strengthEl.className = `strength s${s}`;
  if (bars) {
    bars.innerHTML = "<i></i><i></i><i></i><i></i>";
  }
  if (label) {
    label.textContent = input.value ? labels[s] : "";
  }
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
    "linear-gradient(135deg, #2563eb, #4f46e5)",
    "linear-gradient(135deg, #059669, #0d9488)",
    "linear-gradient(135deg, #db2777, #9333ea)",
    "linear-gradient(135deg, #ea580c, #f59e0b)",
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

if (signupPassword) {
  const signupStrength = signupPassword.closest(".field")?.querySelector(".strength");
  signupPassword.addEventListener("input", () => updatePasswordStrength(signupPassword, signupStrength));
}

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
    const email = signupEmail.value.trim();
    const result = await supabase.auth.signInWithOtp({ email });

    if (result.error) {
      showError(signupError, showAuthError(result.error));
      submitBtn.disabled = false;
      return;
    }

    otpPurpose = "signup";
    otpEmailValue = email;
    otpPendingName = signupName.value.trim();
    otpPendingPassword = signupPassword.value;
    otpTitle.textContent = "Verify your email";
    startOtp("signup");
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
    const email = forgotEmail.value.trim();
    const result = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });

    if (result.error) {
      if (result.error.message.toLowerCase().includes("not found") || result.error.code === "user_not_found") {
        showError(forgotError, "No account exists for that email.");
      } else {
        showError(forgotError, showAuthError(result.error));
      }
      submitBtn.disabled = false;
      return;
    }

    otpPurpose = "reset";
    otpEmailValue = email;
    otpTitle.textContent = "Reset your password";
    startOtp("reset");
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

otpBack.addEventListener("click", (e) => {
  e.preventDefault();
  clearInterval(otpCountdownTimer);
  if (otpPurpose === "reset") {
    switchAuthForm("forgot");
  } else {
    switchAuthForm("register");
  }
});

// ============ OTP handling ============

function startOtp(purpose) {
  otpPurpose = purpose;
  otpEmail.textContent = otpEmailValue;
  resetOtpBoxes();
  clearInterval(otpCountdownTimer);
  hideError(otpError);
  switchAuthForm("otp");
  startOtpCountdown(30);
  otpBoxes.querySelector("input").focus();
}

function resetOtpBoxes() {
  otpBoxes.querySelectorAll("input").forEach((box, i) => {
    box.value = "";
    box.disabled = false;
    box.tabIndex = i === 0 ? 0 : -1;
  });
}

function startOtpCountdown(seconds) {
  clearInterval(otpCountdownTimer);
  let remaining = seconds;
  otpResend.hidden = true;
  otpResendLabel.hidden = false;
  otpCountdown.textContent = remaining;

  otpCountdownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      otpCountdown.textContent = remaining;
    } else {
      clearInterval(otpCountdownTimer);
      otpResendLabel.hidden = true;
      otpResend.hidden = false;
    }
  }, 1000);
}

otpResend.addEventListener("click", async () => {
  hideError(otpError);
  try {
    const result = await supabase.auth.signInWithOtp({
      email: otpEmailValue,
      options: { shouldCreateUser: otpPurpose === "reset" ? false : undefined },
    });
    if (result.error) {
      showError(otpError, showAuthError(result.error));
      return;
    }
    resetOtpBoxes();
    startOtpCountdown(30);
    otpBoxes.querySelector("input").focus();
  } catch (error) {
    showError(otpError, showAuthError(error));
  }
});

function handleOtpInput() {
  const boxes = [...otpBoxes.querySelectorAll("input")];
  const value = boxes.map((b) => b.value).join("");
  if (value.length === boxes.length) {
    verifyOtp(value);
  }
}

otpBoxes.querySelectorAll("input").forEach((box, index, arr) => {
  box.addEventListener("input", (e) => {
    const digit = e.target.value.replace(/\D/g, "");
    box.value = digit.slice(0, 1);
    if (box.value && index < arr.length - 1) {
      arr[index + 1].focus();
      arr[index + 1].select();
    }
    handleOtpInput();
  });

  box.addEventListener("keydown", (e) => {
    if (e.key === "Backspace" && !box.value && index > 0) {
      arr[index - 1].focus();
      arr[index - 1].value = "";
    }
  });

  box.addEventListener("paste", (e) => {
    e.preventDefault();
    const paste = (e.clipboardData || window.clipboardData).getData("text").replace(/\D/g, "");
    arr.forEach((b, i) => { b.value = paste[i] || ""; });
    const last = arr[Math.min(paste.length, arr.length) - 1];
    if (last) { last.focus(); last.select(); }
    handleOtpInput();
  });
});

async function verifyOtp(token) {
  hideError(otpError);
  otpBoxes.querySelectorAll("input").forEach((b) => (b.disabled = true));

  try {
    const result = await supabase.auth.verifyOtp({
      email: otpEmailValue,
      token,
      type: "email",
    });

    if (result.error) {
      showError(otpError, "That code isn't right. Check it and try again.");
      resetOtpBoxes();
      return;
    }

    if (otpPurpose === "signup") {
      const upd = await supabase.auth.updateUser({
        password: otpPendingPassword,
        data: { display_name: otpPendingName },
      });
      if (upd.error) {
        currentUser = result.data.user;
        showAppShell();
        return;
      }
      authFormSignup.reset();
      currentUser = result.data.user;
      showAppShell();
    } else {
      switchAuthForm("recovery");
      recoveryPassword.focus();
    }
  } catch (error) {
    showError(otpError, "Something went wrong verifying that code.");
    resetOtpBoxes();
  }
}

function handleGoogleOAuth(btn, errorEl) {
  if (!isSupabaseConfigured) {
    showError(errorEl, "Google sign-in is unavailable right now.");
    return;
  }

  btn.disabled = true;

  supabase.auth
    .signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    })
    .then((result) => {
      if (result.error) {
        showError(errorEl, "Google sign-in failed. Please try again.");
        btn.disabled = false;
      }
    })
    .catch(() => {
      showError(errorEl, "Google sign-in failed. Please try again.");
      btn.disabled = false;
    });
}

btnGoogleSignin.addEventListener("click", (e) => {
  e.preventDefault();
  handleGoogleOAuth(e.target.closest("button"), signinError);
});

if (document.querySelector("#btn-google-signup")) {
  document.querySelector("#btn-google-signup").addEventListener("click", (e) => {
    e.preventDefault();
    handleGoogleOAuth(e.target.closest("button"), signupError);
  });
}

// ============ Room Management ============

function renderRooms(filterText = "") {
  const filtered = rooms.filter((r) => r.name.toLowerCase().includes(filterText.toLowerCase()));
  const tabFiltered = filtered.filter((r) => {
    if (activeTab === "groups") return r.room_type === "group";
    return true;
  });

  if (!tabFiltered.length) {
    roomList.innerHTML = '<p style="padding: 16px; text-align: center; color: var(--muted); font-size: 13px;">No rooms found.</p>';
    return;
  }

  const palette = ["#2563eb", "#7c3aed", "#0d9488", "#ea580c", "#db2777", "#4f46e5", "#059669", "#b45309"];

  roomList.innerHTML = tabFiltered.map((room) => {
    const hash = room.name.charCodeAt(0) % palette.length;
    const bg = palette[hash];
    const isActive = room.id === currentRoomId;
    const initial = room.name.charAt(0).toUpperCase();

    return `
      <button class="room-item ${isActive ? "active" : ""}" data-room-id="${room.id}" type="button">
        <span class="room-avatar" style="background: ${bg}">${initial}</span>
        <span class="room-main">
          <span class="room-top">
            <span class="room-name">${escapeHtml(room.name)}</span>
          </span>
          <span class="room-preview">
            <span class="room-last">Tap to open</span>
          </span>
        </span>
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
  chatSubtitle.textContent = room.room_type === "direct" ? "Direct conversation" : "Group room";
  chatEmpty.classList.add("hidden");
  chatActive.classList.remove("hidden");

  renderChatEmpty(room);
  renderRoomInfo(room);
  renderRooms();
}

function renderChatEmpty(room) {
  if (!messagesEl) return;
  messagesEl.innerHTML = `
    <div class="chat-welcome">
      <div class="empty-orbit">
        <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </div>
      <h3>${escapeHtml(room.name)}</h3>
      <p>This room is ready for conversations. Messaging is coming soon.</p>
    </div>`;
}

async function renderRoomInfo(room) {
  if (!supabase) return;
  if (infoHeadSub) infoHeadSub.textContent = "Room details";
  if (memberList) memberList.innerHTML = "";
  if (memberCount) memberCount.textContent = "0";

  const { data, error } = await supabase
    .from("room_members")
    .select("profiles(display_name, username, status_text)")
    .eq("room_id", room.id);

  if (error || !memberList) return;

  if (memberCount) memberCount.textContent = String(data.length);

  if (!data.length) {
    memberList.innerHTML = '<li style="color:var(--muted-2);font-size:13px">No members yet.</li>';
    return;
  }

  memberList.innerHTML = data
    .map((m) => {
      const p = m.profiles || {};
      const name = p.display_name || p.username || "Member";
      return `
        <li>
          <span class="member-avatar" style="background:${avatarColor(name)}">${escapeHtml(name.charAt(0).toUpperCase())}</span>
          <span class="member-name">${escapeHtml(name)}</span>
          <span class="member-presence online">online</span>
        </li>`;
    })
    .join("");
}

function avatarColor(name) {
  const palette = ["#2563eb", "#7c3aed", "#0d9488", "#ea580c", "#db2777", "#4f46e5", "#059669", "#b45309"];
  return palette[name.charCodeAt(0) % palette.length];
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

btnInvite.addEventListener("click", () => {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(window.location.origin).catch(() => {});
  }
  btnInvite.textContent = "Invite link copied!";
  setTimeout(() => { btnInvite.textContent = "Invite members"; }, 2500);
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

// Tab filtering
document.querySelectorAll(".side-tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".side-tabs .tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    activeTab = tab.dataset.tab;
    renderRooms(roomSearch.value);
  });
});
