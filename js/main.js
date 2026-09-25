// Application entry point: imports all styles, wires the auth-session
// lifecycle, and bootstraps every feature module.
//
// This file intentionally contains no feature logic itself. Each area of the
// app lives in its own module (js/core for shared concerns, js/features for
// feature logic) and exposes an `init*` function called here. Keeping the
// entry point declarative makes the app's wiring readable in one place.

import "../css/styles.css";
import { supabase, isSupabaseConfigured } from "./core/supabase.js";
import { state, resetAppState } from "./core/state.js";
import { switchAuthForm, showAppShell, showAuthShell, initNavigation, initBottomNav } from "./core/navigation.js";
import { initConfirm } from "./core/confirm.js";
import { ensureIdentity, resetKeyring } from "./core/keyring.js";
import * as dom from "./core/dom.js";

import { initAuth } from "./features/auth.js";
import { initOtp } from "./features/otp.js";
import { initRooms, loadRooms } from "./features/rooms.js";
import { initProfile, loadProfile, hasUsername } from "./features/profile.js";
import { initChat, closeRoom } from "./features/chat.js";
import { initHome, enterHome } from "./features/home.js";
import { initOnboarding, openOnboarding } from "./features/onboarding.js";
import { initMfa, requireMfaIfNeeded } from "./features/mfa.js";

// --- Feature wiring (listener setup only) ---
initNavigation();
initBottomNav();
initConfirm();
initAuth();
initOtp();
initRooms();
initProfile();
initChat();
initHome();
initOnboarding();
initMfa();

// --- Session lifecycle ---
async function enterApp(user) {
  state.currentUser = user;

  // Accounts with a verified TOTP factor must prove a 6-digit code before the
  // app shell is reachable. requireMfaIfNeeded shows the overlay and leaves the
  // auth view visible until mfa.verify promotes the session (MFA_CHALLENGE_VERIFIED
  // re-runs enterApp below).
  if (await requireMfaIfNeeded()) return;

  showAppShell();
  await ensureIdentity();
  const roomCount = await loadRooms();
  await loadProfile();
  if (!hasUsername()) {
    openOnboarding();
  }
  if (roomCount === 0) {
    enterHome();
  }
}

function exitToAuth() {
  closeRoom();
  resetAppState();
  resetKeyring();
  showAuthShell();
}

// Recovery sessions arrive when the user opens the magic link from a reset
// email (some Supabase "Sign in" templates render a link instead of a code).
// They must set a new password first, so take the auth shell's recovery form
// rather than the app shell. Once updateUser succeeds, the resulting
// USER_UPDATED event re-enters normally (MFA gate applies then too).
function enterRecovery(user) {
  state.currentUser = user;
  closeRoom();
  resetAppState();
  resetKeyring();
  showAuthShell();
  switchAuthForm("recovery");
  dom.recoveryPassword?.focus();
}

if (isSupabaseConfigured) {
  // Realtime auth state changes (sign-in, sign-out, session refresh, MFA verify).
  supabase.auth.onAuthStateChange((event, session) => {
    if (session) {
      if (event === "PASSWORD_RECOVERY") {
        enterRecovery(session.user);
        return;
      }
      enterApp(session.user);
    } else {
      exitToAuth();
    }
  });

  // Restore an existing session on page load.
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      enterApp(session.user);
    } else {
      showAuthShell();
    }
  });
} else {
  showAuthShell();
}