// Two-factor authentication (TOTP / authenticator apps) via Supabase Auth MFA.
//
// This module owns two concerns:
//   1. The profile "Security" card: shows whether 2FA is enabled and runs the
//      enroll wizard (QR + secret, then verify a 6-digit code) or disables it.
//   2. The sign-in gate: if the signed-in account requires a verified TOTP
//      factor, an overlay intercepts the session (AAL 1) and asks for a code
//      before the app shell is shown. `mfa.verify` promotes the session and
//      emits MFA_CHALLENGE_VERIFIED, which main.js uses to enter the app.

import * as dom from "../core/dom.js";
import { supabase } from "../core/supabase.js";
import { showError, hideError, initDigitBoxes } from "../core/utils.js";
import { showConfirm } from "../core/confirm.js";

let readMfaCode = () => "";
let readVerifyCode = () => "";
// Factor returned by `enroll`, kept until the wizard finishes (or is cancelled).
let enrollingFactor = null;
// Factor that the sign-in overlay is currently challenging.
let challengeFactor = null;

/** Returns the user's verified TOTP factor, or null (also on any error). */
export async function getTotpFactor() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error || !data?.all) return null;
    return data.all.find((f) => f.type === "totp" && f.status === "verified") || null;
  } catch (error) {
    return null;
  }
}

/** Refreshes the Security card so it reflects whether 2FA is enabled. */
export async function renderMfaStatus() {
  if (!dom.mfaStatusText || !dom.btnMfaSetup || !dom.btnMfaDisable) return;
  const factor = await getTotpFactor();
  dom.btnMfaSetup.hidden = !!factor;
  dom.btnMfaDisable.hidden = !factor;
  dom.mfaStatusText.textContent = factor
    ? "Enabled. Sign-in asks for a code from your authenticator app."
    : "Not enabled. Add an extra layer of security to your account.";
}

/**
 * Gate used before showing the app shell. When the session needs a verified
 * TOTP code (AAL 1 -> AAL 2) it shows the overlay and returns true.
 */
export async function requireMfaIfNeeded() {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data || data.nextLevel !== "aal2") return false;
    if (data.currentLevel === "aal2") return false;

    const factor = (data.allFactors || []).find(
      (f) => f.type === "totp" && f.status === "verified"
    );
    if (!factor) return false;

    challengeFactor = factor;
    hideError(dom.mfaError);
    dom.mfaBoxes.querySelectorAll("input").forEach((b) => {
      b.value = "";
      b.disabled = false;
    });
    dom.mfaOverlay.classList.remove("is-hidden");
    dom.mfaBoxes.querySelector("input")?.focus();
    return true;
  } catch (error) {
    return false;
  }
}

function hideMfaOverlay() {
  if (dom.mfaOverlay) dom.mfaOverlay.classList.add("is-hidden");
  challengeFactor = null;
}

async function submitMfaCode() {
  if (!challengeFactor) return;
  const code = readMfaCode();
  if (code.length !== 6) {
    showError(dom.mfaError, "Enter the 6-digit code from your authenticator app.");
    return;
  }

  const btn = dom.btnMfaSubmit;
  btndisable(btn);
  hideError(dom.mfaError);

  const challenge = await supabase.auth.mfa.challenge({ factorId: challengeFactor.id });
  if (challenge.error) {
    showError(dom.mfaError, "Could not start verification. Try again.");
    enable(btn);
    return;
  }

  const verify = await supabase.auth.mfa.verify({ challengeId: challenge.data.id, code });
  if (verify.error) {
    showError(dom.mfaError, "That code didn't match. Try again.");
    enable(btn);
    dom.mfaBoxes.querySelectorAll("input").forEach((b) => (b.value = ""));
    dom.mfaBoxes.querySelector("input")?.focus();
    return;
  }

  // verify() saved the AAL 2 session and notified subscribers, so main.js now
  // re-runs enterApp and the shell appears; the overlay can go away.
  hideMfaOverlay();
}

// --- Profile settings: the enroll wizard -----------------------------------

async function startMfaSetup() {
  hideError(dom.mfaSetupError);
  const button = dom.btnMfaSetup;
  btndisable(button);
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "EchoRooms",
  });
  enable(button);

  if (error || !data?.totp) {
    showError(dom.mfaStatusText, "Could not start 2FA setup. Try again.");
    return;
  }

  enrollingFactor = data;
  dom.mfaQr.src = data.totp.qr_code;
  dom.mfaQr.alt = "";
  dom.mfaSecret.textContent = data.totp.secret || "";
  dom.mfaStepEnroll.classList.remove("is-hidden");
  dom.mfaStepVerify.classList.add("is-hidden");
  dom.mfaDialog.showModal();
}

function showVerifyStep() {
  hideError(dom.mfaSetupError);
  dom.mfaVerifyBoxes.querySelectorAll("input").forEach((b) => (b.value = ""));
  dom.mfaStepEnroll.classList.add("is-hidden");
  dom.mfaStepVerify.classList.remove("is-hidden");
  dom.mfaVerifyBoxes.querySelector("input")?.focus();
}

async function completeMfaSetup() {
  if (!enrollingFactor) return;
  const code = readVerifyCode();
  if (code.length !== 6) {
    showError(dom.mfaSetupError, "Enter the 6-digit code generated by your app.");
    return;
  }

  const btn = dom.btnMfaVerify;
  btndisable(btn);
  hideError(dom.mfaSetupError);

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: enrollingFactor.id,
    code,
  });
  enable(btn);

  if (error) {
    showError(dom.mfaSetupError, "That code didn't match or expired. Try again.");
    dom.mfaVerifyBoxes.querySelectorAll("input").forEach((b) => (b.value = ""));
    dom.mfaVerifyBoxes.querySelector("input")?.focus();
    return;
  }

  closeMfaDialog();
  await renderMfaStatus();
}

async function disableMfa() {
  const factor = await getTotpFactor();
  if (!factor) {
    await renderMfaStatus();
    return;
  }
  const confirmed = await showConfirm({
    danger: true,
    title: "Disable two-factor authentication?",
    message:
      "Your account will then only be protected by your password. You can re-enable 2FA anytime.",
    confirmLabel: "Disable 2FA",
  });
  if (!confirmed) return;

  const btn = dom.btnMfaDisable;
  btndisable(btn);
  const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
  enable(btn);
  if (error) {
    showError(dom.mfaStatusText, "Could not disable 2FA. Try again.");
    return;
  }
  await renderMfaStatus();
}

function closeMfaDialog() {
  enrollingFactor = null;
  dom.mfaStepEnroll.classList.add("is-hidden");
  dom.mfaStepVerify.classList.add("is-hidden");
  dom.mfaDialog.close();
}

// --- Helpers ---------------------------------------------------------------

function btndisable(btn) {
  if (btn) btn.disabled = true;
}

function enable(btn) {
  if (btn) btn.disabled = false;
}

/** Wires the profile Security card, the enroll wizard, and the sign-in overlay. */
export function initMfa() {
  readMfaCode = initDigitBoxes(dom.mfaBoxes, submitMfaCode);
  readVerifyCode = initDigitBoxes(dom.mfaVerifyBoxes, completeMfaSetup);

  dom.btnMfaSubmit?.addEventListener("click", submitMfaCode);
  dom.btnMfaSetup?.addEventListener("click", startMfaSetup);
  dom.btnMfaDisable?.addEventListener("click", disableMfa);
  dom.mfaScanned?.addEventListener("click", showVerifyStep);
  dom.btnMfaVerify?.addEventListener("click", completeMfaSetup);
  dom.mfaVerifyBack?.addEventListener("click", () => {
    hideError(dom.mfaSetupError);
    dom.mfaStepVerify.classList.add("is-hidden");
    dom.mfaStepEnroll.classList.remove("is-hidden");
  });
  dom.mfaDialogClose?.addEventListener("click", closeMfaDialog);
  dom.mfaCancel?.addEventListener("click", closeMfaDialog);
}