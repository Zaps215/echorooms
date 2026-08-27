import "../css/styles.css";
import { isSupabaseConfigured, supabase } from "./supabase-client.js";

const signal = document.querySelector(".signal-line");
const copy = document.querySelector(".panel-copy");
const authShell = document.querySelector("#auth-shell");
const appShell = document.querySelector("#app-shell");
const authForm = document.querySelector("#auth-form");
const authMessage = document.querySelector("#auth-message");
const authToggle = document.querySelector("#auth-toggle");
const authModeLabel = document.querySelector("#auth-mode-label");
const authHeading = document.querySelector("#auth-heading");
const displayName = document.querySelector("#display-name");
const displayNameLabel = document.querySelector("#display-name-label");
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

let rooms = [];

let isSignInMode = false;

function setAuthMessage(message, isError = false) {
  authMessage.textContent = message;
  authMessage.classList.toggle("is-error", isError);
}

function showAuthError() {
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
  authModeLabel.textContent = signIn ? "Welcome back" : "Start a room";
  authHeading.textContent = signIn ? "Keep the useful parts." : "Make conversations useful.";
  displayName.required = !signIn;
  displayName.hidden = signIn;
  displayNameLabel.hidden = signIn;
  authSubmit.textContent = signIn ? "Sign in" : "Create account";
  authToggle.textContent = signIn
    ? "New to EchoRooms? Create an account"
    : "Already have an account? Sign in";
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
  if (error) showAuthError();
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
  const result = isSignInMode
    ? await supabase.auth.signInWithPassword({ email, password })
    : await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: formData.get("displayName") } },
      });

  authSubmit.disabled = false;
  if (result.error) {
    showAuthError();
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
  if (error) showAuthError();
});

newRoomButton.addEventListener("click", () => {
  roomMessage.textContent = "";
  roomMessage.classList.remove("is-error");
  roomForm.reset();
  roomDialog.showModal();
  roomName.focus();
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
  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .insert({ name, room_type: "group", created_by: user.id })
    .select("id, name, room_type, last_message_at, created_at")
    .single();
  if (roomError) {
    showRoomError();
    return;
  }
  const { error: membershipError } = await supabase.from("room_members").insert({ room_id: room.id, user_id: user.id, role: "owner" });
  if (membershipError) {
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
    showAuthError();
    return;
  }
  await supabase.auth.signOut();
  showAuth();
});

if (isSupabaseConfigured) {
  signal.innerHTML = '<span class="signal-dot" style="background: var(--cyan)"></span>Secure connection ready';
  copy.textContent = "Your identity is connected. Room Service is next.";
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session) {
      showApp();
      loadRooms();
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
    }
  });
} else {
  setAuthMessage("");
}
