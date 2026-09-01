/* ============================================================
   EchoRooms — in-app home (frontend-only demo)
   Room switching, messaging, and panel interactions
   ============================================================ */

(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const colors = ["#2563eb", "#7c3aed", "#0d9488", "#ea580c", "#db2777", "#4f46e5", "#059669", "#b45309"];

  const people = {
    liam: { name: "Liam Carter", c: colors[0] },
    zoe:  { name: "Zoe Park",    c: colors[1] },
    noah: { name: "Noah Reyes",  c: colors[2] },
    mia:  { name: "Mia Chen",    c: colors[3] },
    luca: { name: "Luca Silva",  c: colors[4] },
    ivy:  { name: "Ivy Moore",   c: colors[5] },
  };
  Object.values(people).forEach((p, i) => p.id = Object.keys(people)[i]);

  const rooms = [
    {
      id: "r1", name: "Design Guild", type: "group", unread: 2,
      members: ["liam", "zoe", "noah"],
      last: { id: "m1", from: "liam", text: "Merged the new landing page colors 🎨", t: "14:02" },
      messages: [
        { id: "d0", day: "Today" },
        { id: "m1", from: "liam", own: false, text: "Morning everyone! Just pushed the design tokens update.", t: "13:58", react: ["👏", "🎉"] },
        { id: "m2", from: "zoe", own: false, text: "Nice — the new blue is much calmer than the mint.\nCan we add a preview link?", t: "13:59" },
        { id: "m3", from: "noah", own: false, text: "On it. Preview builds are up in #deploy.", t: "14:01", react: ["👍"] },
        { id: "m4", from: "liam", own: false, text: "Merged the new landing page colors 🎨", t: "14:02" },
      ],
      pinned: ["Colors are finalized — no more neon.", "Standup moved to 10:00 AM Friday."],
      tasks: [
        { id: 1, text: "Ship profile avatars", done: true },
        { id: 2, text: "Finalize group invite flow", done: false },
        { id: 3, text: "Write v1.1 changelog", done: false },
      ],
    },
    {
      id: "r2", name: "Capstone · Week 9", type: "group", unread: 0,
      members: ["liam", "zoe", "noah", "mia"],
      last: { id: "m1", from: "michelle", text: "Docs link: echorooms.dev/git-101", t: "11:20" },
      messages: [
        { id: "d0", day: "Today" },
        { id: "m1", from: "zoe", own: false, text: "Reminder: repo review in 30 min.", t: "11:12" },
        { id: "m2", from: "liam", own: false, text: "Got the merge conflicts sorted ✅", t: "11:15" },
        { id: "m3", from: "noah", own: false, text: "Docs link: echorooms.dev/git-101", t: "11:20", react: ["📌"] },
      ],
      pinned: ["Repo review @ 10:00 AM", "Keep main branch green."],
      tasks: [
        { id: 1, text: "Resolve merge conflicts", done: true },
        { id: 2, text: "Add CI checks", done: false },
        { id: 3, text: "Prepare demo video", done: false },
      ],
    },
    {
      id: "r3", name: "Liam Carter", type: "dm", unread: 1,
      members: ["liam"],
      last: { id: "m1", from: "liam", text: "Great, let's catch up later!", t: "Yesterday" },
      messages: [
        { id: "d0", day: "Yesterday" },
        { id: "m1", from: "liam", own: false, text: "Hey, want to review the handoff together?", t: "18:40" },
        { id: "m2", from: "none", own: true, text: "Sure — send me the Figma link and I'll take a look tonight.", t: "18:44" },
        { id: "m3", from: "liam", own: false, text: "Great, let's catch up later!", t: "18:46", react: ["✅"] },
      ],
      pinned: [],
      tasks: [
        { id: 1, text: "Review design handoff", done: false },
      ],
    },
    {
      id: "r4", name: "Trip · Lisbon 🍇", type: "group", unread: 5,
      members: ["zoe", "luca", "ivy", "mia"],
      last: { id: "m1", from: "mia", text: "Booked the Airbnb! 🎉", t: "Yesterday" },
      messages: [
        { id: "d0", day: "Yesterday" },
        { id: "m1", from: "luca", own: false, text: "Found cheap flights — check the pinned message.", t: "20:10" },
        { id: "m2", from: "ivy", own: false, text: "I can print the itinerary for everyone.", t: "20:15" },
        { id: "m3", from: "mia", own: false, text: "Booked the Airbnb! 🎉", t: "21:02", react: ["🎉", "❤️"] },
      ],
      pinned: ["Cheap flights (ends Sunday)", "Packing list → Docs"],
      tasks: [
        { id: 1, text: "Book flights", done: true },
        { id: 2, text: "Split costs", done: false },
        { id: 3, text: "Plan day trips", done: false },
      ],
    },
  ];

  let activeRoom = null;
  let currentFilter = "all";
  let searchTerm = "";

  const roomList = $("#room-list");
  const messagesEl = $("#messages");
  const chatEmpty = $("#chat-empty");
  const chatActive = $("#chat-active");
  const sidebar = $("#sidebar");
  const info = $("#info");

  /* ---------- Render helpers ---------- */
  const initials = (name) => name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();

  function visibleRooms() {
    return rooms.filter(r => {
      const matchSearch = r.name.toLowerCase().includes(searchTerm);
      if (!matchSearch) return false;
      if (currentFilter === "unread") return r.unread > 0;
      if (currentFilter === "groups") return r.type === "group";
      return true;
    });
  }

  function renderRoomList() {
    const list = visibleRooms();
    roomList.innerHTML = list.length ? "" : '<div class="room-empty" style="padding:14px;color:var(--muted-2);font-size:13px;">No rooms found</div>';
    list.forEach(r => {
      const p = people[r.members[0]] || people.liam;
      const el = document.createElement("button");
      el.className = "room-item" + (activeRoom && activeRoom.id === r.id ? " active" : "");
      el.innerHTML = `
        <span class="room-avatar" style="background:${r.type === "group" ? "linear-gradient(135deg,#6d28d9,#4f46e5)" : p.c}">
          ${r.type === "group" ? initials(r.name) : initials(p.name)}
        </span>
        <span class="room-main">
          <span class="room-top">
            <span class="room-name">${r.name}</span>
            <span class="room-time">${r.last.t}</span>
          </span>
          <span class="room-preview">
            <span class="room-last">${r.last.text}</span>
            <span class="room-unread ${r.unread === 0 ? "zero" : ""}">${r.unread}</span>
          </span>
        </span>`;
      el.addEventListener("click", () => openRoom(r));
      roomList.appendChild(el);
    });
  }

  const reactSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2A5 5 0 0 0 7 7c0 1.2.4 2.3 1 3.2Q8 7 12 4zm0 0A5 5 0 0 1 17 7c0 1.2-.4 2.3-1 3.2V7a5 5 0 0 0-4-4.9z" opacity=".6"/><path d="M2 13a10 10 0 1 0 20 0 10 10 0 0 0-20 0zm9-6.5A4.5 4.5 0 0 1 15.5 2 4.5 4.5 0 0 1 20 6.5 4.5 4.5 0 0 1 15.5 11 4.5 4.5 0 0 1 11 6.5z" transform="translate(2 3) scale(.42)"/><path d="M12 2a5 5 0 0 1 5 5v2l-1-.8a5 5 0 0 0-4-3z"/></svg>';

  function renderMessages(room) {
    messagesEl.innerHTML = "";
    room.messages.forEach(m => {
      if (m.day) {
        messagesEl.insertAdjacentHTML("beforeend", `<div class="day-divider"><span>${m.day}</span></div>`);
        return;
      }
      const isOwn = m.own;
      const p = people[m.from === "none" ? "" : m.from] || people.liam;
      const sender = isOwn ? "" : `<span class="sender">${p.name}</span>`;
      const reacts = (m.react || []).map(r => `<span class="reaction">${r}</span>`).join("");
      const bubble = document.createElement("div");
      bubble.className = "msg " + (isOwn ? "own" : "other");
      bubble.innerHTML = `
        <div class="bubble">
          ${sender}
          ${m.text.replace(/\n/g, "<br>")}
          <span class="bubble-meta">${m.t} ${isOwn ? reactSvg : ""}</span>
          ${reacts ? `<div class="reactions">${reacts}</div>` : ""}
        </div>`;
      messagesEl.appendChild(bubble);
    });
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderInfo(room) {
    $("#chat-title").textContent = room.name;
    const memberNames = room.members.map(id => people[id].name);
    const otherCount = room.type === "group" ? ` · ${room.members.length + 2} members` : "";
    $("#chat-subtitle").textContent = `${room.members.length} online${otherCount}`;

    const memberList = $("#member-list");
    memberList.innerHTML = "";
    if (room.type === "group") {
      const me = { name: "Zaps (you)", c: colors[6] };
      memberList.insertAdjacentHTML("beforeend", `
        <li>
          <span class="member-avatar" style="background:${me.c}">${initials("Zaps")}</span>
          <span style="width:8px;display:inline-block"></span>
          <span class="member-name">${me.name}</span>
          <span class="member-presence online">online</span>
        </li>`);
    }
    room.members.forEach((id, idx) => {
      const p = people[id];
      memberList.insertAdjacentHTML("beforeend", `
        <li>
          <span class="member-avatar" style="background:${p.c}"></span>
          <span class="member-name">${p.name}</span>
          <span class="member-presence ${idx === 0 ? "online" : ""}">${idx === 0 ? "online" : "last seen recently"}</span>
        </li>`);
    });

    const pinnedList = $("#pinned-list");
    pinnedList.innerHTML = room.pinned.length ? "" : '<li style="color:var(--muted-2)">No pinned messages</li>';
    room.pinned.forEach(text => {
      pinnedList.insertAdjacentHTML("beforeend", `
        <li>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6M10 4v6l-3 4h8l-3-4V4"/><line x1="10" y1="18" x2="14" y2="18"/></svg>
          <span>${text}</span>
        </li>`);
    });

    const taskList = $("#task-list");
    taskList.innerHTML = "";
    room.tasks.forEach(t => {
      const li = document.createElement("li");
      li.className = t.done ? "done" : "";
      li.innerHTML = `
        <span class="task-box"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>
        <span class="task-text">${t.text}</span>`;
      li.addEventListener("click", () => {
        t.done = !t.done;
        li.classList.toggle("done", t.done);
      });
      taskList.appendChild(li);
    });
  }

  /* ---------- Open room ---------- */
  function openRoom(room) {
    activeRoom = room;
    chatEmpty.classList.add("hidden");
    chatActive.classList.remove("hidden");
    renderRoomList();
    renderMessages(room);
    renderInfo(room);
    if (room.unread > 0) room.unread = 0;
    if (window.innerWidth <= 720) sidebar.classList.remove("open");
  }

  /* ---------- Filters & search ---------- */
  $$(".tab").forEach(tab => tab.addEventListener("click", () => {
    $$(".tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentFilter = tab.dataset.tab;
    renderRoomList();
  }));

  $("#room-search").addEventListener("input", (e) => {
    searchTerm = e.target.value.trim().toLowerCase();
    renderRoomList();
  });

  /* ---------- Composer ---------- */
  const input = $("#composer-input");
  const sendBtn = $("#btn-send");
  const senderId = "none"; // self

  function autoResize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  }
  input.addEventListener("input", () => {
    autoResize();
    sendBtn.disabled = !input.value.trim();
  });

  function sendMessage() {
    const text = input.value.trim();
    if (!text || !activeRoom) return;
    activeRoom.messages.push({
      id: "m" + Date.now(), from: senderId, own: true, text, t: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
    });
    renderMessages(activeRoom);
    input.value = "";
    autoResize();
    sendBtn.disabled = true;
  }

  sendBtn.addEventListener("click", sendMessage);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  /* ---------- Info panel & mobile ---------- */
  if (window.matchMedia("(min-width: 1081px)").matches) {
    // info panel visible on desktop; nothing needed
  }
  $("#btn-new-room").addEventListener("click", () => {
    const name = prompt("Create a new room (demo):");
    if (name && name.trim()) {
      rooms.unshift({
        id: "r" + Date.now(), name: name.trim(), type: "group", unread: 0,
        members: ["liam"],
        last: { from: "none", text: "Room created", t: "now" },
        messages: [{ id: "d0", day: "Today" }],
        pinned: [], tasks: [],
      });
      renderRoomList();
      openRoom(rooms[0]);
    }
  });
  $("#btn-close-info").addEventListener("click", () => info.classList.remove("open"));
  $$(".icon-btn[title='More']").forEach(b => b.addEventListener("click", () => info.classList.add("open")));
  $("#btn-back").addEventListener("click", () => sidebar.classList.add("open"));

  /* ---------- Mock incoming message ---------- */
  setInterval(() => {
    if (!activeRoom) return;
    const from = activeRoom.members[Math.floor(Math.random() * activeRoom.members.length)];
    const p = people[from];
    const texts = [`Just saw that ${p.name.split(" ")[0]} — updates looking great ✨`, "Any news on the review?", "Catch you in the next standup 👍", "Pinned a quick note for the room."];
    const text = texts[Math.floor(Math.random() * texts.length)];
    activeRoom.messages.push({ id: "m" + Date.now(), from, own: false, text, t: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) });
    renderMessages(activeRoom);
  }, 18000);

  /* ---------- Init ---------- */
  renderRoomList();
  openRoom(rooms[0]);
})();
