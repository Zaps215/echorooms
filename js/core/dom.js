// Central registry of all DOM element references used across the app.
//
// Keeping every querySelector in one file gives us a single, auditable source
// of truth for the markup contract with index.html. Feature modules import from
// here instead of querying the DOM themselves, so renames in the templates only
// ever touch this file.

function query(id) {
  const el = document.getElementById(id);
  if (!el) {
    if (import.meta.env.DEV) {
      console.warn(`[dom] Missing element #${id}`);
    }
    return null;
  }
  return el;
}

function queryAll(selector) {
  return Array.from(document.querySelectorAll(selector));
}

export const authWrapper = query("auth-wrapper");
export const appWrapper = query("app-wrapper");

export const authFormSignin = query("auth-form-signin");
export const authFormSignup = query("auth-form-signup");
export const authFormForgot = query("auth-form-forgot");
export const authFormRecovery = query("auth-form-recovery");

export const signinEmail = query("signin-email");
export const signinPassword = query("signin-password");
export const signupName = query("signup-name");
export const signupEmail = query("signup-email");
export const signupPassword = query("signup-password");
export const signupConfirm = query("signup-confirm");
export const forgotEmail = query("forgot-email");
export const recoveryPassword = query("recovery-password");
export const recoveryConfirm = query("recovery-confirm");

export const signinError = query("signin-error");
export const signupError = query("signup-error");
export const forgotError = query("forgot-error");
export const recoveryError = query("recovery-error");

export const btnToSignup = query("btn-to-signup");
export const btnToSignin = query("btn-to-signin");
export const btnForgot = query("btn-forgot");
export const btnBackSignin = query("btn-back-signin");
export const btnGoogleSignin = query("btn-google-signin");

export const authFormOtp = query("auth-form-otp");
export const otpEmail = query("otp-email");
export const otpTitle = query("otp-title");
export const otpBoxes = query("otp-boxes");
export const otpResendLabel = query("otp-resend-label");
export const otpCountdown = query("otp-countdown");
export const otpResend = query("otp-resend");
export const otpError = query("otp-error");
export const otpBack = query("otp-back");

export const roomList = query("room-list");
export const roomSearch = query("room-search");
export const meAvatar = query("me-avatar");
export const meName = query("me-name");
export const btnNewRoom = query("btn-new-room");
export const btnLogout = query("btn-logout");

export const chatEmpty = query("chat-empty");
export const chatActive = query("chat-active");
export const chatTitle = query("chat-title");
export const chatSubtitle = query("chat-subtitle");
export const composerInput = query("composer-input");
export const messagesEl = query("messages");
export const btnSend = query("btn-send");
export const btnInfo = query("btn-info");
export const btnBack = query("btn-back");

export const homeView = query("home-view");
export const homeGreeting = query("home-greeting");
export const homeTitle = query("home-title");
export const homeSubtitle = query("home-subtitle");
export const btnHomeNewRoom = query("btn-home-new-room");

export const info = query("info");
export const btnCloseInfo = query("btn-close-info");
export const infoHeadSub = query("info-head-sub");
export const memberList = query("member-list");
export const memberCount = query("member-count");
export const btnInvite = query("btn-invite");
export const btnEditProfile = query("btn-edit-profile");
export const btnDeleteAccount = query("btn-delete-account");

export const roomDialog = query("room-dialog");
export const roomForm = query("room-form");
export const roomName = query("room-name");
export const roomError = query("room-error");
export const roomDialogClose = query("room-dialog-close");
export const roomCancel = query("room-cancel");

export const profileDialog = query("profile-dialog");
export const profileForm = query("profile-form");
export const profileName = query("profile-name");
export const profileUsername = query("profile-username");
export const profileStatus = query("profile-status");
export const profileAvatar = query("profile-avatar");
export const profileError = query("profile-error");
export const profileDialogClose = query("profile-dialog-close");
export const profileCancel = query("profile-cancel");

export const passwordToggles = queryAll("[data-reveal]");
export const tabs = queryAll(".side-tabs .tab");
export const googleSignupBtn = query("btn-google-signup");

export function findPrimaryButton(form) {
  return form ? form.querySelector(".btn-primary") : null;
}
