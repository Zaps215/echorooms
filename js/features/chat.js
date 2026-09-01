// Chat composer and mobile back navigation.
//
// Messaging itself is not implemented yet; the composer simply clears input as
// a placeholder. This module will grow into the realtime messaging feature.

import * as dom from "../core/dom.js";
import { state } from "../core/state.js";

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
    dom.chatActive.classList.add("hidden");
    dom.chatEmpty.classList.remove("hidden");
    state.currentRoomId = null;
  });
}

export function initChat() {
  initComposer();
  initMobileBack();
}