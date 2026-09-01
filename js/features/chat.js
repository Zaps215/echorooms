// Chat composer and mobile back navigation.
//
// Messaging itself is not implemented yet; the composer simply clears input as
// a placeholder. This module will grow into the realtime messaging feature.

import * as dom from "../core/dom.js";
import { state } from "../core/state.js";
import { showHome } from "../core/navigation.js";

function initComposer() {
  dom.btnSend?.addEventListener("click", () => {
    if (dom.composerInput.value.trim()) {
      dom.composerInput.value = "";
    }
  });

  dom.composerInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      dom.btnSend.click();
    }
  });
}

function initMobileBack() {
  dom.btnBack?.addEventListener("click", () => {
    state.currentRoomId = null;
    showHome();
  });
}

export function initChat() {
  initComposer();
  initMobileBack();
}