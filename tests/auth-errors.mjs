import assert from "node:assert/strict";
import {
  getRequestErrorMessage,
  setButtonLoading,
  showAuthError,
} from "../js/core/utils.js";

assert.equal(
  showAuthError({ message: "Invalid login credentials", status: 400 }),
  "Your email or password is incorrect. Check both and try again."
);
assert.equal(
  showAuthError({ message: "Email not confirmed", status: 400 }),
  "Confirm your email address before signing in."
);
assert.equal(
  showAuthError({ message: "Failed to fetch", name: "TypeError" }),
  "Connection to EchoRooms failed. Check your internet connection and try again."
);
assert.equal(
  getRequestErrorMessage({ status: 503 }, "Could not save profile."),
  "Connection to EchoRooms failed. Check your internet connection and try again."
);
assert.equal(
  getRequestErrorMessage({ status: 400 }, "Could not save profile."),
  "Could not save profile."
);
assert.equal(
  getRequestErrorMessage({ status: 400 }),
  undefined,
  "ordinary request errors keep the caller's specific feedback"
);

const classes = new Set();
const label = { textContent: "Sign in" };
const spinner = { hidden: true };
const attributes = new Map();
const button = {
  dataset: {},
  disabled: false,
  classList: {
    add: (name) => classes.add(name),
    remove: (name) => classes.delete(name),
  },
  querySelector: (selector) => (selector === ".btn-label" ? label : spinner),
  setAttribute: (name, value) => attributes.set(name, value),
  removeAttribute: (name) => attributes.delete(name),
};

setButtonLoading(button, true, "Signing in…");
assert.equal(button.disabled, true);
assert.equal(label.textContent, "Signing in…");
assert.equal(spinner.hidden, false);
assert.equal(attributes.get("aria-busy"), "true");
assert.equal(classes.has("is-loading"), true);

setButtonLoading(button, false);
assert.equal(button.disabled, false);
assert.equal(label.textContent, "Sign in");
assert.equal(spinner.hidden, true);
assert.equal(attributes.has("aria-busy"), false);
assert.equal(classes.has("is-loading"), false);

console.log("auth feedback: all checks passed");
