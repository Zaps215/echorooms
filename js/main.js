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
const otpPanel = document.querySelector("#otp-panel");
const otpToggle = document.querySelector("#otp-toggle");
const otpForm = document.querySelector("#otp-form");
const otpEmail = document.querySelector("#otp-email");
const otpCode = document.querySelector("#otp-code");
const otpSend = document.querySelector("#otp-send");
const otpVerify = document.querySelector("#otp-verify");

let isSignInMode = false;
let isOtpMode = false;

function setAuthMessage(message, isError = false) {
  authMessage.textContent = message;
  authMessage.classList.toggle("is-error", isError);
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

otpToggle.addEventListener("click", () => {
  isOtpMode = !isOtpMode;
  authForm.hidden = isOtpMode;
  otpPanel.hidden = !isOtpMode;
  authToggle.hidden = isOtpMode;
  otpToggle.textContent = isOtpMode ? "Use email and password instead" : "Sign in with a one-time code";
  setAuthMessage("");
});

otpForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isSupabaseConfigured) {
    setAuthMessage("Add Supabase values to .env.local before using authentication.", true);
    return;
  }
  otpSend.disabled = true;
  setAuthMessage("Sending your code...");
  const { error } = await supabase.auth.signInWithOtp({ email: otpEmail.value, options: { shouldCreateUser: false } });
  otpSend.disabled = false;
  if (error) {
    setAuthMessage(error.message, true);
    return;
  }
  setAuthMessage("Code sent. Check your inbox, then enter it below.");
  otpCode.focus();
});

otpVerify.addEventListener("click", async () => {
  if (!otpForm.reportValidity()) return;
  otpVerify.disabled = true;
  setAuthMessage("Verifying your code...");
  const { data, error } = await supabase.auth.verifyOtp({ email: otpEmail.value, token: otpCode.value, type: "email" });
  otpVerify.disabled = false;
  if (error) {
    setAuthMessage(error.message, true);
    return;
  }
  if (data.session) showApp();
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isSupabaseConfigured) {
    setAuthMessage("Add Supabase values to .env.local before using authentication.", true);
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
    setAuthMessage(result.error.message, true);
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
  if (error) setAuthMessage(error.message, true);
});

if (isSupabaseConfigured) {
  signal.innerHTML = '<span class="signal-dot" style="background: var(--cyan)"></span>Supabase connected';
  copy.textContent = "Your identity is connected. Room Service is next.";
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session) showApp();
    else showAuth();
  });
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) showApp();
  });
} else {
  setAuthMessage("Authentication is waiting for Supabase configuration.");
}
