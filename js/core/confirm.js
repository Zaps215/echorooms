// Reusable confirmation dialog.
//
// Replaces window.confirm with a Promise-based modal that supports a danger
// variant and an optional "type <text> to confirm" gate for destructive
// actions (e.g. deleting an account). The dialog is shared across features so
// destructive flows look and behave identically everywhere.

import * as dom from "./dom.js";

let pending = { resolve: null, required: null };

function syncOkEnabled() {
  if (!pending.required) {
    dom.confirmOk.disabled = false;
    return;
  }
  dom.confirmOk.disabled = dom.confirmTextInput.value.trim() !== pending.required;
}

function settle(result) {
  if (!pending.resolve) return;
  const { resolve } = pending;
  pending = { resolve: null, required: null };
  dom.confirmDialog.close();
  dom.confirmOk.classList.remove("btn-danger");
  dom.confirmOk.disabled = false;
  dom.confirmTextWrap.hidden = true;
  dom.confirmTextInput.value = "";
  resolve(result);
}

/**
 * Opens the confirm dialog.
 *
 * @param {Object} options
 * @param {string} [options.title="Are you sure?"]
 * @param {string} [options.message]
 * @param {string} [options.confirmLabel="Confirm"]
 * @param {string} [options.cancelLabel="Cancel"]
 * @param {boolean} [options.danger=false] Styles the confirm button as dangerous.
 * @param {string} [options.requiredText] If set, the confirm button stays disabled
 *   until the user types this exact text. Intended for the user's own email.
 * @returns {Promise<boolean>} Resolves true only on an explicit confirm.
 */
export function showConfirm(options = {}) {
  if (dom.confirmDialog.open) settle(false);

  return new Promise((resolve) => {
    pending = {
      resolve,
      required: options.requiredText || null,
    };

    dom.confirmTitle.textContent = options.title || "Are you sure?";
    dom.confirmMessage.textContent = options.message || "";
    dom.confirmOk.textContent = options.confirmLabel || "Confirm";
    dom.confirmCancel.textContent = options.cancelLabel || "Cancel";
    dom.confirmOk.classList.toggle("btn-danger", !!options.danger);

    if (pending.required) {
      dom.confirmTextLabel.textContent = `Type ${pending.required} to continue:`;
      dom.confirmTextWrap.hidden = false;
      syncOkEnabled();
    }

    dom.confirmDialog.showModal();
    if (pending.required) {
      dom.confirmTextInput.focus();
    } else {
      dom.confirmOk.focus();
    }
  });
}

export function initConfirm() {
  dom.confirmOk.addEventListener("click", () => settle(true));
  dom.confirmCancel.addEventListener("click", () => settle(false));
  dom.confirmClose.addEventListener("click", () => settle(false));
  dom.confirmTextInput.addEventListener("input", syncOkEnabled);

  // Escape closes the dialog without confirming.
  dom.confirmDialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    settle(false);
  });

  // Clicking the backdrop is a cancel.
  dom.confirmDialog.addEventListener("click", (e) => {
    const rect = dom.confirmDialog.getBoundingClientRect();
    const inside =
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom;
    if (!inside) settle(false);
  });
}