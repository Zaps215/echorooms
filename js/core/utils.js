// Pure, side-effect-free helpers shared across feature modules.

const AVATAR_PALETTE = [
  "#2563eb",
  "#7c3aed",
  "#0d9488",
  "#ea580c",
  "#db2777",
  "#4f46e5",
  "#059669",
  "#b45309",
];

/** Writes `message` into an error element and makes it visible. */
export function showError(errorEl, message) {
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.hidden = false;
}

/** Clears and hides an error element. */
export function hideError(errorEl) {
  if (!errorEl) return;
  errorEl.hidden = true;
  errorEl.textContent = "";
}

/**
 * Maps Supabase auth error messages to a human-friendly, non-technical string.
 * We intentionally keep raw backend details out of user-facing UI; only the
 * most actionable cases get their own messages.
 */
export function showAuthError(error) {
  const msg = error?.message?.toLowerCase() || "";
  if (msg.includes("invalid login credentials")) {
    return "That email or password is incorrect.";
  }
  if (msg.includes("email not confirmed")) {
    return "Confirm your email address before signing in.";
  }
  if (msg.includes("user already registered")) {
    return "An account already exists for that email. Try signing in.";
  }
  if (msg.includes("error sending confirmation email")) {
    return "Supabase could not send the confirmation email. Configure an email provider in Supabase.";
  }
  return "We couldn't complete that request. Check your details and try again.";
}

/** Escapes user-controlled strings before they are injected into innerHTML. */
export function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[c]);
}

/** Renders the avatar gradient + initial for a given name onto an element. */
export function setUserAvatar(name, element) {
  if (!name || !element) return;
  element.textContent = name.charAt(0).toUpperCase();
  element.style.background = avatarColor(name);
}

/** Deterministically picks a background color for a name's avatar. */
export function avatarColor(name) {
  return AVATAR_PALETTE[name.charCodeAt(0) % AVATAR_PALETTE.length];
}

/** Scores a password 0-4 for the strength meter on the sign-up form. */
export function passwordScore(password) {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return score;
}

/** Updates the password strength meter UI for the sign-up form. */
export function updatePasswordStrength(input, strengthEl) {
  if (!input || !strengthEl) return;

  const labels = ["", "Too weak", "Weak", "Fair", "Strong"];
  const bars = strengthEl.querySelector(".strength-bars");
  const label = strengthEl.querySelector(".strength-label");

  const score = passwordScore(input.value);
  strengthEl.className = `strength s${score}`;
  if (bars) {
    bars.innerHTML = "<i></i><i></i><i></i><i></i>";
  }
  if (label) {
    label.textContent = input.value ? labels[score] : "";
  }
}
