// Email OTP verification flow.
//
// Handles the 6-box code entry used by both sign-up and password-reset flows:
// auto-advance, backspace navigation, paste support, a resend countdown, and
// the actual Supabase verifyOtp call. The module owns the OTP UI state and
// exposes startOtp() for the auth module to trigger.

import * as dom from "../core/dom.js";
import { otpState, state } from "../core/state.js";
import { supabase } from "../core/supabase.js";
import { showError, hideError, showAuthError } from "../core/utils.js";
import { switchAuthForm, showAppShell } from "../core/navigation.js";

const OTP_RESEND_SECONDS = 30;

function resetOtpBoxes() {
  dom.otpBoxes.querySelectorAll("input").forEach((box, i) => {
    box.value = "";
    box.disabled = false;
    box.tabIndex = i === 0 ? 0 : -1;
  });
}

function startOtpCountdown(seconds) {
  clearInterval(otpState.countdownTimer);
  let remaining = seconds;
  dom.otpResend.hidden = true;
  dom.otpResendLabel.hidden = false;
  dom.otpCountdown.textContent = remaining;

  otpState.countdownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      dom.otpCountdown.textContent = remaining;
    } else {
      clearInterval(otpState.countdownTimer);
      dom.otpResendLabel.hidden = true;
      dom.otpResend.hidden = false;
    }
  }, 1000);
}

function focusFirstBox() {
  const first = dom.otpBoxes.querySelector("input");
  if (first) first.focus();
}

/** Opens the OTP view and starts the countdown for the given purpose. */
export function startOtp(purpose) {
  otpState.purpose = purpose;
  dom.otpEmail.textContent = otpState.email;
  resetOtpBoxes();
  clearInterval(otpState.countdownTimer);
  hideError(dom.otpError);
  switchAuthForm("otp");
  startOtpCountdown(OTP_RESEND_SECONDS);
  focusFirstBox();
}

/** Begins the sign-up OTP flow, storing the credentials pending verification. */
export function startSignupOtp(email, name, password) {
  otpState.purpose = "signup";
  otpState.email = email;
  otpState.pendingName = name;
  otpState.pendingPassword = password;
  dom.otpTitle.textContent = "Verify your email";
  startOtp("signup");
}

/** Begins the password-reset OTP flow for the given address. */
export function startResetOtp(email) {
  otpState.purpose = "reset";
  otpState.email = email;
  dom.otpTitle.textContent = "Reset your password";
  startOtp("reset");
}

async function verifyOtp(token) {
  hideError(dom.otpError);
  dom.otpBoxes.querySelectorAll("input").forEach((b) => (b.disabled = true));

  try {
    const result = await supabase.auth.verifyOtp({
      email: otpState.email,
      token,
      type: "email",
    });

    if (result.error) {
      showError(dom.otpError, "That code isn't right. Check it and try again.");
      resetOtpBoxes();
      return;
    }

    if (otpState.purpose === "signup") {
      const upd = await supabase.auth.updateUser({
        password: otpState.pendingPassword,
        data: { display_name: otpState.pendingName },
      });
      state.currentUser = result.data.user;
      dom.authFormSignup.reset();
      showAppShell();
    } else {
      switchAuthForm("recovery");
      dom.recoveryPassword.focus();
    }
  } catch (error) {
    showError(dom.otpError, "Something went wrong verifying that code.");
    resetOtpBoxes();
  }
}

function handleOtpInput() {
  const boxes = Array.from(dom.otpBoxes.querySelectorAll("input"));
  const value = boxes.map((b) => b.value).join("");
  if (value.length === boxes.length) {
    verifyOtp(value);
  }
}

function initOtpBoxes() {
  const boxes = Array.from(dom.otpBoxes.querySelectorAll("input"));

  boxes.forEach((box, index, arr) => {
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
      arr.forEach((b, i) => {
        b.value = paste[i] || "";
      });
      const last = arr[Math.min(paste.length, arr.length) - 1];
      if (last) {
        last.focus();
        last.select();
      }
      handleOtpInput();
    });
  });
}

function initOtpEvents() {
  initOtpBoxes();

  dom.otpResend.addEventListener("click", async () => {
    hideError(dom.otpError);
    try {
      const result = await supabase.auth.signInWithOtp({
        email: otpState.email,
        options: { shouldCreateUser: otpState.purpose === "reset" ? false : undefined },
      });
      if (result.error) {
        showError(dom.otpError, showAuthError(result.error));
        return;
      }
      resetOtpBoxes();
      startOtpCountdown(OTP_RESEND_SECONDS);
      focusFirstBox();
    } catch (error) {
      showError(dom.otpError, showAuthError(error));
    }
  });

  dom.otpBack.addEventListener("click", (e) => {
    e.preventDefault();
    clearInterval(otpState.countdownTimer);
    if (otpState.purpose === "reset") {
      switchAuthForm("forgot");
    } else {
      switchAuthForm("register");
    }
  });
}

export function initOtp() {
  initOtpEvents();
}
