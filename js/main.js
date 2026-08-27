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

let isSignInMode = false;

function setAuthMessage(message, isError = false) {
  authMessage.textContent = message;
  authMessage.classList.toggle("is-error", isError);
}

function showAuthError() {
  setAuthMessage("We couldn't complete that request. Check your details and try again.", true);
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
    if (session) showApp();
    else showAuth();
  });
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) showApp();
  });
} else {
  setAuthMessage("");
}
