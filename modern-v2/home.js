/* ============================================================
   EchoRooms — Atrium · "Aurora" concept (v2)
   Frontend-only demo. Room switching, messaging, workspace.
   ============================================================ */

(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const tints = ["#f6b14a", "#2fd69a", "#ff9a56", "#9d7bff", "#4fd6c8", "#ffb95e", "#5ee8a8", "#ffce6b"];

  const people = {
    liam: { name: "Liam Carter", c: tints[0] },
    zoe:  { name: "Zoe Park",    c: tints[1] },
    noah: { name: "Noah Reyes",  c: tints[2] },
    mia:  { name: "Mia Chen",    c: tints[3] },
    luca: { name: "Luca Silva",  c: tints[4] },
    ivy:  { name: "Ivy Moore",   c: tints[5] },
  };

  const rooms = [
    {
      id: "r1", name: "Design Guild", type: "group", unread: 2,
      members: ["liam", "zoe", "noah"],
      last: { from: "liam", text: "Merged the new landing page colors 🎨", t: "14:02" },
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
      last: { from: "noah", text: "Docs link: echorooms.dev/git-101", t: "11:20" },
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
      last: { from: "liam", text: "Great, let's catch up later!", t: "Yesterday" },
      messages: [
        { id: "d0", day: "Yesterday" },
        { id: "m1", from: "liam", own: false, text: "Hey, want to review the handoff together?", t: "18:40" },
        { id: "m2", from: "none", own: true, text: "Sure — send me the Figma link and I'll take a look tonight.", t: "18:44" },
        { id: "m3", from: "liam", own: false, text: "Great, let's catch up later!", t: "18:46", react: ["✅"] },
      ],
      pinned: [],
      tasks: [{ id: 1, text: "Review design handoff", done: false }],
    },
    {
      id: "r4", name: "Trip · Lisbon 🍇", type: "group", unread: 5,
      members: ["zoe", "luca", "ivy", "mia"],
      last: { from: "mia", text: "Booked the Airbnb! 🎉", t: "Yesterday" },
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
  let searchTerm = "";

  const roomList = $("#room-list");
  const messagesEl = $("#messages");
  const chatEmpty = $("#chat-empty");
  const chatActive = $("#chat-active");
  const sidebar = $(".sidebar");
  const info = $("#info");

  const initials = (name) => name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const avatarStyle = (c) => `background:linear-gradient(135deg, ${c}, ${c}cc); color:#141118;`;

  function filteredRooms() {
    return rooms.filter(r => r.name.toLowerCase().includes(searchTerm));
  }

  function roomAvatar(r) {
    const c = r.type === "group" ? "#f6b14a" : people[r.members[0]].c;
    return `${avatarStyle(c)}`;
  }

  function renderRoomList() {
    const list = filteredRooms();
    roomList.innerHTML = list.length ? "" : '<div style="padding:14px;color:var(--muted-2);font-size:13px;">No rooms found</div>';
    list.forEach(r => {
      const el = document.createElement("button");
      el.className = "room-item" + (activeRoom && activeRoom.id === r.id ? " active" : "");
      const p = people[r.members[0]] || people.liam;
      el.innerHTML = `
        <span class="room-avatar" style="${roomAvatar(r)}">
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

  const reactSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a5 5 0 0 0-5 5v1.5a5 5 0 0 1 2-4V7a3 3 0 0 1 3-3zm0 0a5 5 0 0 1 5 5v1.5a5 5 0 0 0-2-4V7a3 3 0 0 0-3-3z" opacity=".55"/><path d="M12 3l1.5 3.5L17 6l-3 2 1 3.5-3-2.2-3 2.2 1-3.5-3-2 3.5-.5z"/></svg>';

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
    $("#info-head-sub").textContent = room.name;
    const memberCount = room.type === "group" ? room.members.length + 1 : 2;
    $("#chat-subtitle").textContent = `${room.members.length} online · ${memberCount} members`;
    $("#member-count").textContent = memberCount;

    const memberList = $("#member-list");
    memberList.innerHTML = "";
    if (room.type === "group") {
      memberList.insertAdjacentHTML("beforeend", `
        <li>
          <span class="member-avatar" style="${avatarStyle(tints[6])}">${initials("Zaps")}</span>
          <span class="member-name">Zaps (you)</span>
          <span class="member-presence online">online</span>
        </li>`);
    }
    room.members.forEach((id, idx) => {
      const p = people[id];
      memberList.insertAdjacentHTML("beforeend", `
        <li>
          <span class="member-avatar" style="${avatarStyle(p.c)}">${initials(p.name)}</span>
          <span class="member-name">${p.name}</span>
          <span class="member-presence ${idx === 0 ? "online" : ""}">${idx === 0 ? "online" : "recently"}</span>
        </li>`);
    });

    const pinnedList = $("#pinned-list");
    pinnedList.innerHTML = room.pinned.length ? "" : '<li style="color:var(--muted-2);padding:0">No pinned messages</li>';
    room.pinned.forEach(text => {
      pinnedList.insertAdjacentHTML("beforeend", `
        <li>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3l7 7-9 9H3v-9z"/></svg>
          <span>${text}</span>
        </li>`);
    });

    const taskList = $("#task-list");
    taskList.innerHTML = "";
    room.tasks.forEach(t => {
      const li = document.createElement("li");
      li.className = t.done ? "done" : "";
      li.innerHTML = `
        <span class="task-box"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>
        <span class="task-text">${t.text}</span>`;
      li.addEventListener("click", () => {
        t.done = !t.done;
        li.classList.toggle("done", t.done);
      });
      taskList.appendChild(li);
    });
  }

  function openRoom(room) {
    activeRoom = room;
    chatEmpty.classList.add("hidden");
    chatActive.classList.remove("hidden");
    renderRoomList();
    renderMessages(room);
    renderInfo(room);
    if (room.unread > 0) room.unread = 0;
    if (window.innerWidth <= 760) sidebar.classList.remove("open");
  }

  /* ----- Search ----- */
  $("#room-search").addEventListener("input", (e) => {
    searchTerm = e.target.value.trim().toLowerCase();
    renderRoomList();
  });

  /* ----- Composer ----- */
  const input = $("#composer-input");
  const sendBtn = $("#btn-send");
  const senderId = "none";

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
      id: "m" + Date.now(), from: senderId, own: true, text,
      t: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
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

  /* ----- Rail & info ----- */
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
  $("#btn-info").addEventListener("click", () => info.classList.add("open"));
  $("#btn-back").addEventListener("click", () => sidebar.classList.add("open"));

  $$(".rail-btn").forEach(b => b.addEventListener("click", () => {
    $$(".rail-btn").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
  }));

  $("#btn-logout").addEventListener("click", () => {
    window.location.href = "index.html";
  });

  /* ----- Mock incoming ----- */
  setInterval(() => {
    if (!activeRoom) return;
    const from = activeRoom.members[Math.floor(Math.random() * activeRoom.members.length)];
    const p = people[from];
    const texts = [`Updates look great, ${p.name.split(" ")[0]} ✨`, "Any word on the review?", "Catch you at the next standup 👍", "Pinned a note for the room."];
    activeRoom.messages.push({
      id: "m" + Date.now(), from, own: false,
      text: texts[Math.floor(Math.random() * texts.length)],
      t: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
    });
    renderMessages(activeRoom);
  }, 18000);

  renderRoomList();
  openRoom(rooms[0]);
})();
