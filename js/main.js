// Application entry point: imports all styles, wires the auth-session
// lifecycle, and bootstraps every feature module.
//
// This file intentionally contains no feature logic itself. Each area of the
// app lives in its own module (js/core for shared concerns, js/features for
// feature logic) and exposes an `init*` function called here. Keeping the
// entry point declarative makes the app's wiring readable in one place.

import "../css/styles.css";
import { supabase, isSupabaseConfigured } from "./core/supabase.js";
import * as dom from "./core/dom.js";
import { state, resetAppState } from "./core/state.js";
import { switchAuthForm, showAppShell, showAuthShell } from "./core/navigation.js";

import { initAuth } from "./features/auth.js";
import { initOtp } from "./features/otp.js";
import { initRooms, loadRooms } from "./features/rooms.js";
import { initProfile, loadProfile } from "./features/profile.js";
import { initChat } from "./features/chat.js";

// --- Feature wiring (listener setup only) ---
initAuth();
initOtp();
initRooms();
initProfile();
initChat();

// --- Session lifecycle ---
function enterApp(user) {
  state.currentUser = user;
  showAppShell();
  loadRooms();
  loadProfile();
}

function exitToAuth() {
  resetAppState();
  showAuthShell();
}

if (isSupabaseConfigured) {
  // Realtime auth state changes (sign-in, sign-out, session refresh).
  supabase.auth.onAuthStateChange((event, session) => {
    if (session) {
      enterApp(session.user);
      if (event === "PASSWORD_RECOVERY") {
        switchAuthForm("recovery");
      }
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