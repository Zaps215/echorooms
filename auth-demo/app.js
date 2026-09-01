/* ============================================================
   EchoRooms — frontend-only auth demo
   Switching, validation, and UX polish (no backend / no storage)
   ============================================================ */

(() => {
  const app = document.querySelector(".panel-scroll");
  if (!app) return;

  const forms = [...app.querySelectorAll("[data-view]")];
  const byView = Object.fromEntries(forms.map(f => [f.dataset.view, f]));

  /* ---------- View switching ---------- */
  function show(view) {
    forms.forEach(f => f.classList.toggle("active", f.dataset.view === view));
  }

  app.addEventListener("click", (e) => {
    const goto = e.target.closest("[data-goto]");
    if (goto) show(goto.dataset.goto);

    const reveal = e.target.closest("[data-reveal]");
    if (reveal) {
      const input = document.getElementById(reveal.dataset.target);
      if (input) {
        input.type = input.type === "password" ? "text" : "password";
        reveal.classList.toggle("showing", input.type === "text");
      }
    }
  });

  /* ---------- Tiny helpers ---------- */
  const setError = (form, msg) => {
    const box = form.querySelector(".error-box");
    if (!box) return;
    if (msg) {
      box.textContent = msg;
      box.hidden = false;
    } else {
      box.hidden = true;
    }
  };

  const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

  const setLoading = (form, loading) => {
    const btn = form.querySelector(".btn-primary");
    const label = btn.querySelector(".btn-label");
    const spinner = btn.querySelector(".spinner");
    btn.disabled = loading;
    label.hidden = loading;
    spinner.hidden = !loading;
  };

  const fakeDelay = (ms = 900) => new Promise(r => setTimeout(r, ms));

  /* ---------- Password strength ---------- */
  const regPassword = document.getElementById("reg-password");
  if (regPassword) {
    const strength = regPassword.closest(".field").querySelector(".strength");
    if (strength) {
      const bars = strength.querySelector(".strength-bars");
      const label = strength.querySelector(".strength-label");
      const score = (pw) => {
        let s = 0;
        if (pw.length >= 8) s++;
        if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
        if (/\d/.test(pw)) s++;
        if (/[^A-Za-z0-9]/.test(pw)) s++;
        return s;
      };
      const names = ["Too weak", "Weak", "Fair", "Good", "Strong"];
      regPassword.addEventListener("input", () => {
        const s = score(regPassword.value);
        strength.className = "strength s" + s;
        bars.innerHTML = "<i></i><i></i><i></i><i></i>";
        label.textContent = regPassword.value ? names[s] : "";
      });
    }
  }

  /* ---------- Handle submissions (frontend demo only) ---------- */
  app.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const view = form.dataset.view;
    const data = Object.fromEntries(new FormData(form).entries());
    const email = (data.email || "").trim();
    setError(form, "");

    /* Client-side validation */
    if (!email || !validEmail(email)) {
      setError(form, "Please enter a valid email address.");
      return;
    }

    if (view === "signin") {
      if (!data.password) { setError(form, "Please enter your password."); return; }
    }

    if (view === "register") {
      if (!data.name) { setError(form, "Please enter your full name."); return; }
      if (data.password.length < 8) {
        setError(form, "Password must be at least 8 characters.");
        return;
      }
      if (data.confirm_password !== data.password) {
        setError(form, "Passwords do not match. Please re-enter them.");
        return;
      }
      if (!data.terms) { setError(form, "Please accept the Terms and Privacy Policy."); return; }
    }

    if (view === "register" && !(/[A-Z]/.test(data.password) && /\d/.test(data.password))) {
      setError(form, "Use a mix of letters and numbers for a stronger password.");
      return;
    }

    setLoading(form, true);

    /* Simulate a network call — nothing is persisted */
    await fakeDelay();

    setLoading(form, false);

    if (view === "forgot") {
      byView.sent.querySelector(".sent-email").textContent = email;
      show("sent");
    } else {
      /* Frontend-only demo — routeless: go to the in-app home */
      window.location.href = "home.html";
    }
  });
})();
