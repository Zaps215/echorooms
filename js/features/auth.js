// Email/password and Google OAuth authentication flow.
//
// Handles the sign-in, sign-up, forgot-password, and recovery forms, plus the
// auth navigation buttons and password strength meter. Sign-up and forgot use
// the email OTP flow (see otp.js) to verify the address before continuing.

import * as dom from "../core/dom.js";
import { supabase, isSupabaseConfigured } from "../core/supabase.js";
import { showError, hideError, showAuthError, updatePasswordStrength } from "../core/utils.js";
import { switchAuthForm, showAppShell, initPasswordToggle } from "../core/navigation.js";
import { startSignupOtp, startResetOtp } from "./otp.js";

function bindSubmit(form, errorEl, handler) {
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await handler(form, errorEl);
  });
}

async function submitSignin(form, errorEl) {
  if (!isSupabaseConfigured) {
    showError(errorEl, "Secure sign-in is unavailable right now.");
    return;
  }
  const submitBtn = dom.findPrimaryButton(form);
  submitBtn.disabled = true;
  hideError(errorEl);
  try {
    const result = await supabase.auth.signInWithPassword({
      email: dom.signinEmail.value.trim(),
      password: dom.signinPassword.value,
    });
    if (result.error) {
      showError(errorEl, showAuthError(result.error));
      submitBtn.disabled = false;
      return;
    }
    form.reset();
    showAppShell();
  } catch (error) {
    showError(errorEl, showAuthError(error));
    submitBtn.disabled = false;
  }
}

async function submitSignup(form, errorEl) {
  if (!isSupabaseConfigured) {
    showError(errorEl, "Secure sign-up is unavailable right now.");
    return;
  }
  if (dom.signupPassword.value !== dom.signupConfirm.value) {
    showError(errorEl, "Passwords do not match.");
    return;
  }

  const submitBtn = dom.findPrimaryButton(form);
  submitBtn.disabled = true;
  hideError(errorEl);

  try {
    const email = dom.signupEmail.value.trim();
    const result = await supabase.auth.signInWithOtp({ email });
    if (result.error) {
      showError(errorEl, showAuthError(result.error));
      submitBtn.disabled = false;
      return;
    }

    startSignupOtp(email, dom.signupName.value.trim(), dom.signupPassword.value);
  } catch (error) {
    showError(errorEl, showAuthError(error));
    submitBtn.disabled = false;
  }
}

async function submitForgot(form, errorEl) {
  if (!isSupabaseConfigured) {
    showError(errorEl, "Password reset is unavailable right now.");
    return;
  }
  const submitBtn = dom.findPrimaryButton(form);
  submitBtn.disabled = true;
  hideError(errorEl);

  try {
    const email = dom.forgotEmail.value.trim();
    const result = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });

    if (result.error) {
      if (result.error.message.toLowerCase().includes("not found") || result.error.code === "user_not_found") {
        showError(errorEl, "No account exists for that email.");
      } else {
        showError(errorEl, showAuthError(result.error));
      }
      submitBtn.disabled = false;
      return;
    }

    startResetOtp(email);
  } catch (error) {
    showError(errorEl, showAuthError(error));
    submitBtn.disabled = false;
  }
}

async function submitRecovery(form, errorEl) {
  if (!isSupabaseConfigured) {
    showError(errorEl, "Password update is unavailable right now.");
    return;
  }
  if (dom.recoveryPassword.value !== dom.recoveryConfirm.value) {
    showError(errorEl, "Passwords do not match.");
    return;
  }

  const submitBtn = dom.findPrimaryButton(form);
  submitBtn.disabled = true;
  hideError(errorEl);

  try {
    const result = await supabase.auth.updateUser({ password: dom.recoveryPassword.value });
    if (result.error) {
      showError(errorEl, "Could not update password. Please request a new reset link.");
      submitBtn.disabled = false;
      return;
    }
    form.reset();
    showAppShell();
  } catch (error) {
    showError(errorEl, "Could not update password.");
    submitBtn.disabled = false;
  }
}

function handleGoogleOAuth(btn, errorEl) {
  if (!isSupabaseConfigured) {
    showError(errorEl, "Google sign-in is unavailable right now.");
    return;
  }
  if (!btn) return;
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

function bindGoogleButtons() {
  if (dom.btnGoogleSignin) {
    dom.btnGoogleSignin.addEventListener("click", (e) => {
      e.preventDefault();
      handleGoogleOAuth(e.target.closest("button") || dom.btnGoogleSignin, dom.signinError);
    });
  }
  if (dom.googleSignupBtn) {
    dom.googleSignupBtn.addEventListener("click", (e) => {
      e.preventDefault();
      handleGoogleOAuth(e.target.closest("button") || dom.googleSignupBtn, dom.signupError);
    });
  }
}

function bindAuthNavigation() {
  dom.btnToSignup?.addEventListener("click", (e) => {
    e.preventDefault();
    switchAuthForm("register");
  });
  dom.btnToSignin?.addEventListener("click", (e) => {
    e.preventDefault();
    switchAuthForm("signin");
  });
  dom.btnForgot?.addEventListener("click", (e) => {
    e.preventDefault();
    switchAuthForm("forgot");
  });
  dom.btnBackSignin?.addEventListener("click", (e) => {
    e.preventDefault();
    switchAuthForm("signin");
  });
}

export function initAuth() {
  initPasswordToggle();
  bindAuthNavigation();
  bindGoogleButtons();

  bindSubmit(dom.authFormSignin, dom.signinError, submitSignin);
  bindSubmit(dom.authFormSignup, dom.signupError, submitSignup);
  bindSubmit(dom.authFormForgot, dom.forgotError, submitForgot);
  bindSubmit(dom.authFormRecovery, dom.recoveryError, submitRecovery);

  // Password strength meter on the sign-up form.
  const signupField = dom.signupPassword?.closest(".field");
  const signupStrength = signupField ? signupField.querySelector(".strength") : null;
  dom.signupPassword?.addEventListener("input", () =>
    updatePasswordStrength(dom.signupPassword, signupStrength)
  );
}
