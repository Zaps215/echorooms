// Centralized, mutable application state.
//
// Rather than scattering module-level `let` bindings across feature files, all
// cross-cutting UI state lives here. Feature modules read/write through this
// object so that state transitions (login -> logout, room switching) are easy
// to reason about and reset in one place.

export const state = {
  rooms: [],
  currentRoomId: null,
  activeTab: "all",
  currentUser: null,
};

export const otpState = {
  purpose: "signup", // "signup" | "reset"
  email: "",
  pendingName: "",
  pendingPassword: "",
  countdownTimer: null,
};

export function resetAppState() {
  state.rooms = [];
  state.currentRoomId = null;
  state.currentUser = null;
}
