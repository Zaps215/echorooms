import * as dom from "../core/dom.js";
import { state } from "../core/state.js";
import { supabase } from "../core/supabase.js";
import { escapeHtml, getRequestErrorMessage, logAppError } from "../core/utils.js";
import { showChannelList, showChannelReader } from "../core/navigation.js";

let channelCatalog = [];
let channelMemberships = [];
let activeChannel = null;

function formatTime(value) {
  const date = new Date(value);
  const age = Date.now() - date.getTime();
  if (age < 60_000) return "Just now";
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function iconColor(value) {
  return /^#[\da-f]{6}$/i.test(value || "") ? value : "#2878e5";
}

function renderChannelDirectory(filterText = "") {
  if (!dom.roomList) return;
  const query = filterText.trim().toLocaleLowerCase();
  const channels = channelCatalog.filter((channel) =>
    `${channel.name} ${channel.description} ${channel.bot_name}`.toLocaleLowerCase().includes(query)
  );
  if (!channels.length) {
    dom.roomList.innerHTML = '<p class="channel-directory-empty">No channels match that search.</p>';
    if (dom.channelFeaturedGrid) {
      dom.channelFeaturedGrid.innerHTML = '<p class="channel-directory-empty">No channels match that search.</p>';
    }
    return;
  }

  const items = channels.map((channel, index) => {
    const members = channelMemberships.filter((membership) => membership.channel_id === channel.id);
    const joined = members.some((membership) => membership.user_id === state.currentUser?.id);
    return `
      <button class="channel-directory-item${index === 0 ? " channel-trending" : ""}" type="button" data-channel-slug="${escapeHtml(channel.id)}">
        <span class="channel-directory-avatar" style="--channel-color:${iconColor(channel.color)}">${escapeHtml(channel.icon)}</span>
        <span class="channel-directory-copy">
          <strong>${escapeHtml(channel.name)}</strong>
          <span>${escapeHtml(channel.latestBody || channel.description)}</span>
          <small>${index === 0 ? '<b class="channel-live-dot"></b> FEATURED · ' : ""}${members.length.toLocaleString()} members · ${joined ? "Joined" : "Open channel"}${channel.latestAt ? ` · ${formatTime(channel.latestAt)}` : ""}</small>
        </span>
        <span class="channel-directory-arrow" aria-hidden="true">›</span>
      </button>`;
  }).join("");
  dom.roomList.innerHTML = items;
  if (dom.channelFeaturedGrid) dom.channelFeaturedGrid.innerHTML = items;

  [dom.roomList, dom.channelFeaturedGrid].filter(Boolean).forEach((list) => {
    list.querySelectorAll("[data-channel-slug]").forEach((button) => {
    button.addEventListener("click", () => openChannel(button.dataset.channelSlug));
    });
  });
}

export async function renderChannelList(filterText = "") {
  if (!dom.roomList) return;
  dom.roomList.innerHTML = `
    <div class="channel-skeleton-list" aria-label="Loading channels" aria-busy="true">
      ${Array.from({ length: 4 }, () => `
        <div class="channel-skeleton">
          <i class="skeleton-block"></i><span><i class="skeleton-block"></i><i class="skeleton-block"></i><i class="skeleton-block"></i></span>
        </div>`).join("")}
    </div>`;
  if (!supabase || !state.currentUser) {
    dom.roomList.innerHTML = '<p class="channel-directory-empty">Sign in to browse channels.</p>';
    return;
  }

  let channelsResult;
  let membershipsResult;
  let postsResult;
  try {
    [channelsResult, membershipsResult, postsResult] = await Promise.all([
      supabase.from("broadcast_channels").select("id, name, description, bot_name, icon, color, sort_order").order("sort_order"),
      supabase.from("broadcast_channel_members").select("channel_id, user_id"),
      supabase.from("broadcast_channel_posts").select("channel_id, body, created_at").order("created_at", { ascending: false }).limit(50),
    ]);
  } catch (error) {
    logAppError("channels", error);
    dom.roomList.innerHTML = '<p class="channel-directory-error" role="alert">Channels couldn’t load. Check your connection and try again.</p>';
    return;
  }
  if (channelsResult.error || membershipsResult.error || postsResult.error) {
    const error = channelsResult.error || membershipsResult.error || postsResult.error;
    logAppError("channels", error);
    dom.roomList.innerHTML = `<p class="channel-directory-error">${escapeHtml(getRequestErrorMessage(error, "Couldn't load channels. Please try again."))}</p>`;
    return;
  }

  const latestByChannel = new Map();
  for (const post of postsResult.data || []) {
    if (!latestByChannel.has(post.channel_id)) latestByChannel.set(post.channel_id, post);
  }
  channelCatalog = (channelsResult.data || []).map((channel) => ({
    ...channel,
    latestBody: latestByChannel.get(channel.id)?.body || "",
    latestAt: latestByChannel.get(channel.id)?.created_at || "",
  }));
  channelMemberships = membershipsResult.data || [];
  renderChannelDirectory(filterText);
}

async function openChannel(channelId) {
  const channel = channelCatalog.find((item) => item.id === channelId);
  if (!channel || !supabase || !state.currentUser) return;
  activeChannel = channel;
  showChannelReader();
  dom.channelReaderAvatar.textContent = channel.icon;
  dom.channelReaderAvatar.style.setProperty("--channel-color", iconColor(channel.color));
  dom.channelReaderTitle.textContent = channel.name;
  dom.channelReaderDescription.textContent = channel.description;
  dom.channelPostList.innerHTML = `
    <div class="channel-post-skeleton-list" aria-label="Loading channel updates" aria-busy="true">
      ${Array.from({ length: 3 }, () => `
        <article class="channel-post-skeleton" aria-hidden="true">
          <i class="skeleton-block"></i><i class="skeleton-block"></i><i class="skeleton-block"></i>
        </article>`).join("")}
    </div>`;
  updateMembershipControls();

  let postsResult;
  let membershipsResult;
  try {
    [postsResult, membershipsResult] = await Promise.all([
      supabase
        .from("broadcast_channel_posts")
        .select("id, channel_id, bot_name, body, created_at")
        .eq("channel_id", channel.id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("broadcast_channel_members").select("channel_id, user_id").eq("channel_id", channel.id),
    ]);
  } catch (error) {
    if (activeChannel?.id !== channel.id) return;
    logAppError("channels", error);
    dom.channelPostList.innerHTML = '<p class="channel-reader-error" role="alert">These updates couldn’t load. Check your connection and try again.</p>';
    return;
  }
  if (activeChannel?.id !== channel.id) return;
  if (postsResult.error || membershipsResult.error) {
    const error = postsResult.error || membershipsResult.error;
    logAppError("channels", error);
    dom.channelPostList.innerHTML = `<p class="channel-reader-error">${escapeHtml(getRequestErrorMessage(error, "Couldn't load this channel. Please try again."))}</p>`;
    return;
  }

  channelMemberships = channelMemberships.filter((membership) => membership.channel_id !== channel.id);
  channelMemberships.push(...(membershipsResult.data || []));
  updateMembershipControls();
  const posts = postsResult.data || [];
  dom.channelPostList.innerHTML = posts.length
    ? posts.map((post) => `
      <article class="channel-post-card">
        <header class="channel-post-header">
          <span class="channel-bot-avatar" style="--channel-color:${iconColor(channel.color)}">${escapeHtml(channel.icon)}</span>
          <div><strong>${escapeHtml(post.bot_name)}</strong><span>BOT · ${escapeHtml(channel.name)}</span></div>
          <time datetime="${escapeHtml(post.created_at)}">${escapeHtml(formatTime(post.created_at))}</time>
        </header>
        <p>${escapeHtml(post.body).replace(/\n/g, "<br>")}</p>
      </article>`).join("")
    : '<p class="channel-reader-state">Nothing new here yet. Check back soon.</p>';
}

function updateMembershipControls() {
  if (!activeChannel) return;
  const members = channelMemberships.filter((membership) => membership.channel_id === activeChannel.id);
  const joined = members.some((membership) => membership.user_id === state.currentUser?.id);
  dom.channelMemberCount.textContent = `${members.length.toLocaleString()} ${members.length === 1 ? "member" : "members"}`;
  dom.channelJoinButton.textContent = joined ? "Leave channel" : "Join channel";
  dom.channelJoinButton.classList.toggle("joined", joined);
  dom.channelJoinButton.setAttribute("aria-pressed", String(joined));
}

async function toggleChannelMembership() {
  if (!activeChannel || !state.currentUser || !supabase) return;
  dom.channelJoinButton.disabled = true;
  try {
    const joined = channelMemberships.some((membership) =>
      membership.channel_id === activeChannel.id && membership.user_id === state.currentUser.id
    );
    const result = joined
      ? await supabase.from("broadcast_channel_members").delete()
        .eq("channel_id", activeChannel.id)
        .eq("user_id", state.currentUser.id)
      : await supabase.from("broadcast_channel_members").insert({
        channel_id: activeChannel.id,
        user_id: state.currentUser.id,
      });
    if (result.error) throw result.error;
    channelMemberships = channelMemberships.filter((membership) =>
      membership.channel_id !== activeChannel.id || membership.user_id !== state.currentUser.id
    );
    if (!joined) {
      channelMemberships.push({ channel_id: activeChannel.id, user_id: state.currentUser.id });
    }
    updateMembershipControls();
    renderChannelDirectory(dom.roomSearch?.value || "");
  } catch (error) {
    logAppError("channels", error);
    dom.channelPostList.insertAdjacentHTML(
      "afterbegin",
      `<p class="channel-reader-error" role="alert">${escapeHtml(getRequestErrorMessage(error, "Couldn't update your channel membership. Please try again."))}</p>`
    );
  } finally {
    dom.channelJoinButton.disabled = false;
  }
}

export function initChannels() {
  dom.channelBack?.addEventListener("click", () => {
    showChannelList();
    renderChannelDirectory(dom.roomSearch?.value || "");
  });
  dom.channelJoinButton?.addEventListener("click", toggleChannelMembership);
  window.addEventListener("echorooms:session-ended", () => {
    channelCatalog = [];
    channelMemberships = [];
    activeChannel = null;
    showChannelList();
  });
}
