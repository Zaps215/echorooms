// First-run homepage shown when a signed-in user has no room selected.
//
// This is the app's landing view: a welcoming panel with a call-to-action to
// create the user's first room. The home view is hidden the moment a room is
// opened (see rooms.js) and returns when the user backs out to no room.

import * as dom from "../core/dom.js";
import { state } from "../core/state.js";
import { supabase } from "../core/supabase.js";
import { showHome, toggleSidebar } from "../core/navigation.js";
import { openRoomDialog } from "./rooms.js";

/** Renders the greeting using the signed-in user's display name. */
async function renderGreeting() {
  if (!supabase || !state.currentUser || !dom.homeGreeting) return;

  const { data } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", state.currentUser.id)
    .single();

  const name = data?.display_name || state.currentUser.user_metadata?.display_name || "";
  if (name) {
    dom.homeGreeting.textContent = `Welcome back, ${name}.`;
  } else {
    dom.homeGreeting.textContent = "Welcome back.";
  }
}

function initCta() {
  dom.btnHomeNewRoom?.addEventListener("click", () => openRoomDialog());
  dom.btnMenu?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSidebar();
  });
}

export function initHome() {
  initCta();
}

/** Called whenever the app enters the signed-in shell (login / page load). */
export async function enterHome() {
  await renderGreeting();
  showHome();
}
