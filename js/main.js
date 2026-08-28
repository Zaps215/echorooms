import "../css/styles.css";
import { isSupabaseConfigured, supabase } from "./supabase-client.js";

const signal = document.querySelector(".signal-line");
const copy = document.querySelector(".panel-copy");
const authShell = document.querySelector("#auth-shell");
const appShell = document.querySelector("#app-shell");
const authForm = document.querySelector("#auth-form");
const authMessage = document.querySelector("#auth-message");
const authToggle = document.querySelector("#auth-toggle");
const authReset = document.querySelector("#auth-reset");
const authModeLabel = document.querySelector("#auth-mode-label");
const authHeading = document.querySelector("#auth-heading");
const displayName = document.querySelector("#display-name");
const displayNameLabel = document.querySelector("#display-name-label");
const passwordLabel = document.querySelector('label[for="password"]');
const passwordInput = document.querySelector("#password");
const passwordField = passwordInput.closest(".password-field");
const authSubmit = document.querySelector(".auth-submit");
const signOutButton = document.querySelector("#sign-out-button");
const deleteAccountButton = document.querySelector("#delete-account-button");
const googleButton = document.querySelector("#google-button");
const newRoomButton = document.querySelector("#new-room-button");
const roomDialog = document.querySelector("#room-dialog");
const roomForm = document.querySelector("#room-form");
const roomName = document.querySelector("#room-name");
const roomMessage = document.querySelector("#room-message");
const dialogClose = document.querySelector("#dialog-close");
const roomList = document.querySelector("#room-list");
const roomCount = document.querySelector(".room-count");
const roomTitle = document.querySelector("#room-title");
const conversationEmpty = document.querySelector("#conversation-empty");
const profileButton = document.querySelector("#profile-button");
const profileDialog = document.querySelector("#profile-dialog");
const profileForm = document.querySelector("#profile-form");
const profileDisplayName = document.querySelector("#profile-display-name");
const profileUsername = document.querySelector("#profile-username");
const profileStatus = document.querySelector("#profile-status");
const profileAvatar = document.querySelector("#profile-avatar");
const profileMessage = document.querySelector("#profile-message");
const profileDialogClose = document.querySelector("#profile-dialog-close");
const recoveryDialog = document.querySelector("#recovery-dialog");
const recoveryForm = document.querySelector("#recovery-form");
const recoveryMessage = document.querySelector("#recovery-message");
const passwordToggles = document.querySelectorAll(".password-toggle");

let rooms = [];

let isSignInMode = false;
let isResetMode = false;

function setAuthMessage(message, isError = false) {
  authMessage.textContent = message;
  authMessage.classList.toggle("is-error", isError);
}

function showAuthError(error) {
  const errorMessage = error?.message?.toLowerCase() || "";
  if (errorMessage.includes("invalid login credentials")) {
    setAuthMessage("That email or password is incorrect.", true);
    return;
  }
  if (errorMessage.includes("email not confirmed")) {
    setAuthMessage("Confirm your email address before signing in.", true);
    return;
  }
  if (errorMessage.includes("user already registered")) {
    setAuthMessage("An account already exists for that email. Try signing in.", true);
    return;
  }
  if (errorMessage.includes("error sending confirmation email")) {
    setAuthMessage("Supabase could not send the confirmation email. Configure an email provider in Supabase, then try again.", true);
    return;
  }
  setAuthMessage("We couldn't complete that request. Check your details and try again.", true);
}

function showRoomError() {
  roomMessage.textContent = "We couldn't save that room. Please try again.";
  roomMessage.classList.add("is-error");
}

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;",
  })[character]);
}

function renderRooms() {
  roomCount.textContent = rooms.length;
  if (!rooms.length) {
    roomList.innerHTML = '<p class="empty-copy">Your rooms will appear here.</p>';
    return;
  }
  roomList.innerHTML = rooms.map((room, index) => `<button class="room-item${index === 0 ? " is-active" : ""}" type="button" data-room-id="${room.id}"><span class="room-item-name">${escapeHtml(room.name)}</span><span class="room-item-type">${room.room_type === "direct" ? "Direct" : "Group"}</span></button>`).join("");
  roomList.querySelectorAll(".room-item").forEach((button) => {
    button.addEventListener("click", () => selectRoom(button.dataset.roomId));
  });
}

function selectRoom(roomId) {
  const room = rooms.find((item) => item.id === roomId);
  if (!room) return;
  roomTitle.textContent = room.name;
  document.querySelectorAll(".room-item").forEach((item) => item.classList.toggle("is-active", item.dataset.roomId === roomId));
  conversationEmpty.querySelector("h3").textContent = `Welcome to ${room.name}.`;
  conversationEmpty.querySelector("p").textContent = "Your conversation will live here. Messaging is the next layer.";
}

async function loadRooms() {
  if (!supabase) return;
  const { data, error } = await supabase
    .from("room_members")
    .select("room_id, rooms(id, name, room_type, last_message_at, created_at)")
    .order("joined_at", { ascending: false });
  if (error) return;
  rooms = data.map((membership) => membership.rooms).filter(Boolean);
  renderRooms();
  if (rooms[0]) selectRoom(rooms[0].id);
}

function setAuthMode(signIn) {
  isSignInMode = signIn;
  isResetMode = false;
  authModeLabel.textContent = signIn ? "Welcome back" : "Start a room";
  authHeading.textContent = signIn ? "Keep the useful parts." : "Make conversations useful.";
  displayName.required = !signIn;
  displayName.hidden = signIn;
  displayNameLabel.hidden = signIn;
  authReset.hidden = false;
  passwordLabel.hidden = false;
  passwordField.hidden = false;
  passwordInput.hidden = false;
  passwordInput.required = true;
  authSubmit.textContent = signIn ? "Sign in" : "Create account";
  authToggle.textContent = signIn
    ? "New to EchoRooms? Create an account"
    : "Already have an account? Sign in";
  setAuthMessage("");
}

function setResetMode() {
  isResetMode = true;
  isSignInMode = false;
  authModeLabel.textContent = "Account recovery";
  authHeading.textContent = "Find your way back.";
  displayName.hidden = true;
  displayName.required = false;
  displayNameLabel.hidden = true;
  passwordLabel.hidden = true;
  passwordField.hidden = true;
  passwordInput.hidden = true;
  passwordInput.required = false;
  authSubmit.textContent = "Send reset link";
  authToggle.textContent = "Back to sign in";
  authReset.hidden = true;
  setAuthMessage("");
}

function showApp() {
  authShell.classList.add("is-hidden");
  appShell.classList.remove("is-hidden");
}

function showAuth() {
  appShell.classList.add("is-hidden");
  authShell.classList.remove("is-hidden");
}

authToggle.addEventListener("click", () => setAuthMode(!isSignInMode));
authReset.addEventListener("click", setResetMode);
passwordToggles.forEach((toggle) => {
  toggle.addEventListener("click", () => {
    const input = document.querySelector(`#${toggle.dataset.passwordTarget}`);
    const isVisible = input.type === "text";
    input.type = isVisible ? "password" : "text";
    toggle.textContent = isVisible ? "Show" : "Hide";
    toggle.setAttribute("aria-label", `${isVisible ? "Show" : "Hide"} ${input.id.replaceAll("-", " ")}`);
  });
});

googleButton.addEventListener("click", async () => {
  if (!isSupabaseConfigured) {
    setAuthMessage("Secure sign-in is unavailable right now. Please try again shortly.", true);
    return;
  }
  googleButton.disabled = true;
  setAuthMessage("Connecting to Google...");
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
  googleButton.disabled = false;
  if (error) showAuthError(error);
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isSupabaseConfigured) {
    setAuthMessage("Secure sign-in is unavailable right now. Please try again shortly.", true);
    return;
  }

  authSubmit.disabled = true;
  setAuthMessage("Connecting...");
  const formData = new FormData(authForm);
  const email = formData.get("email");
  const password = formData.get("password");
  let result;
  try {
    result = isResetMode
      ? await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
      : isSignInMode
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: formData.get("displayName") } },
        });
  } catch (error) {
    authSubmit.disabled = false;
    showAuthError(error);
    return;
  }

  authSubmit.disabled = false;
  if (result.error) {
    showAuthError(result.error);
    return;
  }

  if (isResetMode) {
    authSubmit.disabled = false;
    setAuthMessage("Check your email for a password reset link.");
    authForm.reset();
    return;
  }

  if (!isSignInMode && !result.data.session) {
    setAuthMessage("Check your email to confirm your account, then sign in.");
    return;
  }
  authForm.reset();
  showApp();
});

signOutButton.addEventListener("click", async () => {
  if (!supabase) return;
  signOutButton.disabled = true;
  const { error } = await supabase.auth.signOut();
  signOutButton.disabled = false;
  if (error) showAuthError(error);
});

newRoomButton.addEventListener("click", () => {
  roomMessage.textContent = "";
  roomMessage.classList.remove("is-error");
  roomForm.reset();
  roomDialog.showModal();
  roomName.focus();
});

async function loadProfile() {
  if (!supabase) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data, error } = await supabase.from("profiles").select("display_name, username, status_text").eq("id", user.id).single();
  if (error) return;
  profileDisplayName.value = data.display_name || user.user_metadata?.display_name || "";
  profileUsername.value = data.username || "";
  profileStatus.value = data.status_text || "";
}

function setProfileMessage(message, isError = false) {
  profileMessage.textContent = message;
  profileMessage.classList.toggle("is-error", isError);
}

profileButton.addEventListener("click", async () => {
  setProfileMessage("");
  await loadProfile();
  profileDialog.showModal();
  profileDisplayName.focus();
});

profileDialogClose.addEventListener("click", () => profileDialog.close());

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const avatar = profileAvatar.files[0];
  if (avatar && (!avatar.type.startsWith("image/") || avatar.size > 5 * 1024 * 1024)) {
    setProfileMessage("Choose a PNG, JPEG, or WebP image smaller than 5 MB.", true);
    return;
  }
  const saveButton = profileForm.querySelector("button[type=submit]");
  saveButton.disabled = true;
  setProfileMessage("Saving profile...");
  let avatarPath;
  if (avatar) {
    const extension = avatar.name.split(".").pop().toLowerCase();
    avatarPath = `${user.id}/${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from("avatars").upload(avatarPath, avatar, { contentType: avatar.type, upsert: false });
    if (error) {
      saveButton.disabled = false;
      setProfileMessage("We couldn't upload that avatar.", true);
      return;
    }
  }
  const updates = {
    display_name: profileDisplayName.value.trim(),
    username: profileUsername.value.trim() || null,
    status_text: profileStatus.value.trim() || null,
  };
  if (avatarPath) updates.avatar_path = avatarPath;
  const { error } = await supabase.from("profiles").update(updates).eq("id", user.id);
  saveButton.disabled = false;
  if (error) {
    setProfileMessage("We couldn't save your profile. Check that your username is available.", true);
    return;
  }
  setProfileMessage("Profile saved.");
});

recoveryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return;
  const formData = new FormData(recoveryForm);
  const newPassword = formData.get("newPassword");
  if (newPassword !== formData.get("confirmPassword")) {
    recoveryMessage.textContent = "Passwords do not match.";
    recoveryMessage.classList.add("is-error");
    return;
  }
  const submitButton = recoveryForm.querySelector("button[type=submit]");
  submitButton.disabled = true;
  recoveryMessage.textContent = "Updating password...";
  recoveryMessage.classList.remove("is-error");
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  submitButton.disabled = false;
  if (error) {
    recoveryMessage.textContent = "We couldn't update your password. Please request a new link.";
    recoveryMessage.classList.add("is-error");
    return;
  }
  recoveryMessage.textContent = "Password updated. You can continue to your rooms.";
  recoveryForm.reset();
  window.setTimeout(() => recoveryDialog.close(), 900);
});

dialogClose.addEventListener("click", () => roomDialog.close());

roomForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const name = roomName.value.trim();
  roomMessage.textContent = "Creating room...";
  roomMessage.classList.remove("is-error");
  const { data, error: roomError } = await supabase.rpc("create_room", { room_name: name });
  const room = data?.[0];
  if (roomError) {
    showRoomError();
    return;
  }
  if (!room) {
    showRoomError();
    return;
  }
  rooms = [room, ...rooms];
  renderRooms();
  selectRoom(room.id);
  roomDialog.close();
});

deleteAccountButton.addEventListener("click", async () => {
  if (!supabase || !window.confirm("Delete your EchoRooms account and all of its data? This cannot be undone.")) return;
  deleteAccountButton.disabled = true;
  const { error } = await supabase.rpc("delete_my_account");
  if (error) {
    deleteAccountButton.disabled = false;
    showAuthError(error);
    return;
  }
  await supabase.auth.signOut();
  showAuth();
});

if (isSupabaseConfigured) {
  signal.innerHTML = '<span class="signal-dot" style="background: var(--cyan)"></span>Secure connection ready';
  copy.textContent = "Your identity is connected. Room Service is next.";
  supabase.auth.onAuthStateChange((event, session) => {
    if (session) {
      showApp();
      loadRooms();
      loadProfile();
      if (event === "PASSWORD_RECOVERY") recoveryDialog.showModal();
    } else {
      rooms = [];
      renderRooms();
      showAuth();
    }
  });
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      showApp();
      loadRooms();
      loadProfile();
    }
  });
} else {
  setAuthMessage("");
}
