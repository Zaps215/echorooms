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
import { startPresence, stopPresence } from "./core/presence.js";
import { switchAuthForm, showAppShell, showAuthShell, initNavigation } from "./core/navigation.js";
import { initConfirm } from "./core/confirm.js";
import { ensureIdentity, resetKeyring } from "./core/keyring.js";
import * as dom from "./core/dom.js";

import { initAuth } from "./features/auth.js";
import { initOtp } from "./features/otp.js";
import { initRooms, loadRooms } from "./features/rooms.js";
import { initProfile, loadProfile } from "./features/profile.js";
import { initChat, closeRoom } from "./features/chat.js";
import { initFeed, loadFeedPosts, startFeedSession } from "./features/feed.js";
import { initChannels } from "./features/channels.js";
import { initStories } from "./features/stories.js";
import { initCalls } from "./features/calls.js";
import { recordPendingGooglePolicyConsent } from "./core/policy-consent.js";

// --- Feature wiring (listener setup only) ---
initNavigation();
initConfirm();
initAuth();
initOtp();
initRooms();
initProfile();
initChat();
initFeed();
initChannels();
initStories();
initCalls();

// --- Session lifecycle ---
async function enterApp(user) {
  try {
    await recordPendingGooglePolicyConsent();
  } catch (error) {
    console.error("[policy-consent] Could not record policy acceptance.", error);
    window.dispatchEvent(new CustomEvent("echorooms:profile-save-error", {
      detail: {
        message: "Your account is signed in, but we couldn't record your Terms and Privacy Policy acceptance. Please contact support before continuing.",
      },
    }));
  }
  state.currentUser = user;
  startPresence(user.id);
  startFeedSession();
  window.dispatchEvent(new CustomEvent("echorooms:session-started"));
  showAppShell();
  await ensureIdentity();
  await loadRooms();
  await loadProfile();
  await loadFeedPosts();
}

function exitToAuth() {
  stopPresence();
  window.dispatchEvent(new CustomEvent("echorooms:session-ended"));
  closeRoom();
  resetAppState();
  resetKeyring();
  showAuthShell();
}

// Recovery sessions arrive when the user opens the magic link from a reset
// email (some Supabase "Sign in" templates render a link instead of a code).
// They must set a new password first, so take the auth shell's recovery form
// rather than the app shell. Once updateUser succeeds, the resulting
// USER_UPDATED event re-enters normally.
function enterRecovery(user) {
  stopPresence();
  state.currentUser = user;
  closeRoom();
  resetAppState();
  resetKeyring();
  showAuthShell();
  switchAuthForm("recovery");
  dom.recoveryPassword?.focus();
}

if (isSupabaseConfigured) {
  // Realtime auth state changes (sign-in, sign-out, session refresh).
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