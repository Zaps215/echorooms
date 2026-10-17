import { supabase } from "./supabase.js";

export const TERMS_VERSION = "2026-10-17";
export const PRIVACY_VERSION = "2026-10-17";

const PENDING_GOOGLE_CONSENT_KEY = "echorooms:pending-google-policy-consent";
const PENDING_CONSENT_TTL_MS = 10 * 60 * 1000;

export function markPendingGooglePolicyConsent() {
  sessionStorage.setItem(
    PENDING_GOOGLE_CONSENT_KEY,
    JSON.stringify({ termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, createdAt: Date.now() })
  );
}

export function clearPendingGooglePolicyConsent() {
  sessionStorage.removeItem(PENDING_GOOGLE_CONSENT_KEY);
}

export async function recordPolicyAcceptance() {
  if (!supabase) throw new Error("Policy acceptance storage is unavailable.");
  const { error } = await supabase.rpc("record_policy_acceptance", {
    accepted_terms_version: TERMS_VERSION,
    accepted_privacy_version: PRIVACY_VERSION,
  });
  if (error) throw error;
}

export async function recordPendingGooglePolicyConsent() {
  const pending = sessionStorage.getItem(PENDING_GOOGLE_CONSENT_KEY);
  if (!pending) return false;

  let consent;
  try {
    consent = JSON.parse(pending);
  } catch {
    clearPendingGooglePolicyConsent();
    return false;
  }

  if (
    consent.termsVersion !== TERMS_VERSION ||
    consent.privacyVersion !== PRIVACY_VERSION ||
    !Number.isFinite(consent.createdAt) ||
    Date.now() - consent.createdAt > PENDING_CONSENT_TTL_MS
  ) {
    clearPendingGooglePolicyConsent();
    return false;
  }

  await recordPolicyAcceptance();
  clearPendingGooglePolicyConsent();
  return true;
}
