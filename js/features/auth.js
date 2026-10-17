// Email/password and Google OAuth authentication flow.
//
// Handles the sign-in, sign-up, forgot-password, and recovery forms, plus the
// auth navigation buttons and password strength meter. Sign-up and forgot use
// the email OTP flow (see otp.js) to verify the address before continuing.

import * as dom from "../core/dom.js";
import { supabase, isSupabaseConfigured } from "../core/supabase.js";
import {
  showError,
  hideError,
  showAuthError,
  setButtonLoading,
  getRequestErrorMessage,
  updatePasswordStrength,
  logAppError,
} from "../core/utils.js";
import { switchAuthForm, initPasswordToggle } from "../core/navigation.js";
import { startSignupOtp, startResetOtp } from "./otp.js";
import { setPendingPassword, rekeyIdentity } from "../core/keyring.js";
import {
  markPendingGooglePolicyConsent,
  clearPendingGooglePolicyConsent,
} from "../core/policy-consent.js";

function bindSubmit(form, errorEl, handler) {
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await handler(form, errorEl);
  });
}

async function submitSignin(form, errorEl) {
  if (!form.reportValidity()) return;
  if (!isSupabaseConfigured) {
    showError(errorEl, "Can't connect to sign-in right now. Please try again later.");
    return;
  }
  const submitBtn = dom.findPrimaryButton(form);
  hideError(errorEl);
  setButtonLoading(submitBtn, true, "Signing in…");
  try {
    // The password must reach the keyring so the identity can be unwrapped.
    setPendingPassword(dom.signinPassword.value);
    const result = await supabase.auth.signInWithPassword({
      email: dom.signinEmail.value.trim(),
      password: dom.signinPassword.value,
    });
    if (result.error) {
      showError(errorEl, showAuthError(result.error));
      return;
    }
    // The app shell opens via enterApp (which also gates 2FA); keep the form
    // state tidy in case an MFA code prompt interrupts the flow.
    form.reset();
  } catch (error) {
    logAppError("auth-signin", error);
    showError(errorEl, showAuthError(error));
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

async function submitSignup(form, errorEl) {
  if (!form.reportValidity()) {
    showError(errorEl, "Complete each required field and check the form details.");
    return;
  }
  if (!isSupabaseConfigured) {
    showError(errorEl, "Can't connect to sign-up right now. Check your connection and try again later.");
    return;
  }
  if (dom.signupPassword.value !== dom.signupConfirm.value) {
    showError(errorEl, "Passwords do not match.");
    return;
  }

  const submitBtn = dom.findPrimaryButton(form);
  hideError(errorEl);
  setButtonLoading(submitBtn, true, "Creating account…");

  try {
    const email = dom.signupEmail.value.trim();
    const displayName = dom.signupName.value.trim();
    const username = dom.signupUsername.value.trim();
    const result = await supabase.auth.signInWithOtp({
      email,
      options: { data: { display_name: displayName, username } },
    });
    if (result.error) {
      showError(errorEl, showAuthError(result.error));
      return;
    }

    startSignupOtp(email, displayName, username, dom.signupPassword.value);
  } catch (error) {
    logAppError("auth-signup", error);
    showError(errorEl, showAuthError(error));
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

async function submitForgot(form, errorEl) {
  if (!isSupabaseConfigured) {
    showError(errorEl, "Can't connect to password reset right now. Please try again later.");
    return;
  }
  const submitBtn = dom.findPrimaryButton(form);
  hideError(errorEl);
  setButtonLoading(submitBtn, true, "Sending code…");

  try {
    const email = dom.forgotEmail.value.trim();
    const result = await supabase.auth.resetPasswordForEmail(email);

    if (result.error) {
      if (result.error.message.toLowerCase().includes("not found") || result.error.code === "user_not_found") {
        showError(errorEl, "No account exists for that email.");
      } else {
        showError(errorEl, showAuthError(result.error));
      }
      return;
    }

    startResetOtp(email);
  } catch (error) {
    logAppError("auth-password-reset", error);
    showError(errorEl, showAuthError(error));
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

async function submitRecovery(form, errorEl) {
  if (!isSupabaseConfigured) {
    showError(errorEl, "Can't connect to password update right now. Please try again later.");
    return;
  }
  if (dom.recoveryPassword.value !== dom.recoveryConfirm.value) {
    showError(errorEl, "Passwords do not match.");
    return;
  }

  const submitBtn = dom.findPrimaryButton(form);
  hideError(errorEl);
  setButtonLoading(submitBtn, true, "Updating password…");

  try {
    setPendingPassword(dom.recoveryPassword.value);
    const result = await supabase.auth.updateUser({ password: dom.recoveryPassword.value });
    if (result.error) {
      showError(
        errorEl,
        getRequestErrorMessage(result.error, "Could not update password. Please request a new reset link.")
      );
      return;
    }
    // Re-wrap the identity key under the new password.
    await rekeyIdentity(dom.recoveryPassword.value);
    form.reset();
  } catch (error) {
    logAppError("auth-password-update", error);
    showError(errorEl, getRequestErrorMessage(error, "Could not update password."));
  } finally {
    setButtonLoading(submitBtn, false);
  }
}

function handleGoogleOAuth(btn, errorEl, requiresPolicyConsent = false) {
  if (!isSupabaseConfigured) {
    showError(errorEl, "Can't connect to Google sign-in right now. Please try again later.");
    return;
  }
  if (!btn) return;
  if (requiresPolicyConsent && !dom.signupTerms?.checked) {
    showError(errorEl, "Please agree to the Terms and Privacy Policy before creating an account.");
    dom.signupTerms?.focus();
    return;
  }
  if (requiresPolicyConsent) {
    try {
      markPendingGooglePolicyConsent();
    } catch (error) {
      showError(errorEl, getRequestErrorMessage(error, "Could not save your consent. Please try again."));
      return;
    }
  }
  setButtonLoading(btn, true, "Connecting…");

  supabase.auth
    .signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    })
    .then((result) => {
      if (result.error) {
        if (requiresPolicyConsent) clearPendingGooglePolicyConsent();
        showError(errorEl, showAuthError(result.error));
        setButtonLoading(btn, false);
      }
    })
    .catch((error) => {
      logAppError("auth-google-oauth", error);
      if (requiresPolicyConsent) clearPendingGooglePolicyConsent();
      showError(errorEl, showAuthError(error));
      setButtonLoading(btn, false);
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
      handleGoogleOAuth(e.target.closest("button") || dom.googleSignupBtn, dom.signupError, true);
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
