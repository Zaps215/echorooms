// Stories are short-lived social updates, separate from private room messages.

import * as dom from "../core/dom.js";
import { state } from "../core/state.js";
import { supabase } from "../core/supabase.js";
import { escapeHtml, getRequestErrorMessage, hideError, setButtonLoading, showError } from "../core/utils.js";

const BUCKET = "social-post-media";
const MAX_STORY_BYTES = 10 * 1024 * 1024;
let stories = [];
let viewerIndex = 0;
let timer = null;
let storiesChannel = null;
let expiryTimer = null;

function makeInitial(profile) {
  return escapeHtml((profile?.display_name || profile?.username || "?").trim().charAt(0).toUpperCase());
}

function ageLabel(value) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  return minutes < 60 ? `${Math.max(1, minutes)}m` : `${Math.floor(minutes / 60)}h`;
}

function openStoryComposer() {
  if (!state.currentUser || !dom.storyCreateDialog) return;
  hideError(dom.storyCreateError);
  dom.storyCreateForm.reset();
  dom.storyRecipientList.classList.add("is-hidden");
  dom.storyRecipientList.replaceChildren();
  dom.storyCreateDialog.showModal();
  dom.storyCaption.focus();
}

async function loadRecipients() {
  if (!supabase || !state.currentUser || !dom.storyRecipientList) return;
  dom.storyRecipientList.innerHTML = '<p class="story-people-loading">Loading people…</p>';
  dom.storyRecipientList.classList.remove("is-hidden");
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, username")
    .neq("id", state.currentUser.id)
    .order("display_name")
    .limit(100);
  if (error) {
    showError(dom.storyCreateError, getRequestErrorMessage(error, "Could not load people. Please try again."));
    dom.storyRecipientList.replaceChildren();
    return;
  }
  if (!data?.length) {
    dom.storyRecipientList.innerHTML = '<p class="story-people-loading">No other members to choose yet.</p>';
    return;
  }
  dom.storyRecipientList.innerHTML = data.map((person) => {
    const name = person.display_name || person.username || "Member";
    return `<label class="story-recipient"><input type="checkbox" value="${escapeHtml(person.id)}"><span class="story-recipient-avatar">${makeInitial(person)}</span><span><strong>${escapeHtml(name)}</strong><small>${person.username ? `@${escapeHtml(person.username)}` : "EchoRooms member"}</small></span></label>`;
  }).join("");
}

function renderStoryStrip() {
  if (!dom.storyStrip) return;
  const byAuthor = new Map();
  stories.forEach((story, index) => {
    if (!byAuthor.has(story.author_id)) byAuthor.set(story.author_id, { story, index });
  });
  const add = `<button class="story-chip story-add" type="button" data-add-story aria-label="Add to your story"><span class="story-ring"><span class="story-chip-avatar">+</span></span><span>Add story</span></button>`;
  const items = [...byAuthor.values()].map(({ story, index }) => {
    const profile = story.profiles || {};
    const name = profile.display_name || profile.username || "Member";
    const isMine = story.author_id === state.currentUser?.id;
    const avatarStyle = story.avatar_url ? ` style="background-image:url('${escapeHtml(story.avatar_url)}')"` : "";
    return `<button class="story-chip ${isMine ? "story-chip-own" : ""}" type="button" data-open-story="${index}" aria-label="View ${isMine ? "your" : escapeHtml(name + "'s")} story"><span class="story-ring"><span class="story-chip-avatar"${avatarStyle}>${story.avatar_url ? "" : makeInitial(profile)}</span></span><span>${isMine ? "Your story" : escapeHtml(name.split(" ")[0])}</span></button>`;
  }).join("");
  dom.storyStrip.innerHTML = `${add}${items}`;
  dom.storyStrip.querySelector("[data-add-story]")?.addEventListener("click", openStoryComposer);
  dom.storyStrip.querySelectorAll("[data-open-story]").forEach((button) => {
    button.addEventListener("click", () => openStory(Number(button.dataset.openStory)));
  });
}

export async function loadStories() {
  if (!supabase || !state.currentUser || !dom.storyStrip) return;
  const openStoryId = dom.storyViewer?.open ? stories[viewerIndex]?.id : null;
  const { data, error } = await supabase
    .from("social_stories")
    .select("id, author_id, body, media_path, audience_mode, created_at, expires_at, profiles!social_stories_author_id_fkey(display_name, username, avatar_path)")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) {
    dom.storyStrip.innerHTML = `<p class="story-error">${escapeHtml(getRequestErrorMessage(error, "Stories could not load. Refresh to try again."))}</p>`;
    return;
  }
  stories = await Promise.all((data || []).map(async (story) => {
    if (story.profiles?.avatar_path) {
      try {
        const { data: signed, error: avatarError } = await supabase.storage.from("avatars").createSignedUrl(story.profiles.avatar_path, 3600);
        if (!avatarError) story.avatar_url = signed.signedUrl;
      } catch (avatarError) {
        if (import.meta.env.DEV) console.warn("[stories] Could not load a profile image.", avatarError);
      }
    }
    if (story.media_path) {
      try {
        const remainingSeconds = Math.max(1, Math.floor((new Date(story.expires_at).getTime() - Date.now()) / 1000));
        const ttl = Math.min(3600, remainingSeconds);
        const { data: signed, error: mediaError } = await supabase.storage.from(BUCKET).createSignedUrl(story.media_path, ttl);
        if (!mediaError) story.media_url = signed.signedUrl;
      } catch (mediaError) {
        if (import.meta.env.DEV) console.warn("[stories] Could not load story media.", mediaError);
      }
    }
    return story;
  }));
  renderStoryStrip();
  window.clearTimeout(expiryTimer);
  const nextExpiry = Math.min(...stories.map((story) => new Date(story.expires_at).getTime()));
  if (Number.isFinite(nextExpiry)) {
    expiryTimer = window.setTimeout(loadStories, Math.max(0, nextExpiry - Date.now() + 50));
  }
  if (openStoryId) {
    viewerIndex = stories.findIndex((story) => story.id === openStoryId);
    if (viewerIndex < 0) dom.storyViewer.close();
    else renderStory();
  }
}

function subscribeStories() {
  if (!supabase || !state.currentUser) return;
  if (storiesChannel) supabase.removeChannel(storiesChannel);
  storiesChannel = supabase
    .channel("social-stories-feed")
    .on("postgres_changes", { event: "*", schema: "public", table: "social_stories" }, loadStories)
    .subscribe();
}

function openStory(index) {
  if (!stories.length || !dom.storyViewer) return;
  viewerIndex = Math.max(0, Math.min(index, stories.length - 1));
  renderStory();
  dom.storyViewer.showModal();
}

function renderStory() {
  const story = stories[viewerIndex];
  if (!story) {
    dom.storyViewer.close();
    return;
  }
  if (new Date(story.expires_at).getTime() <= Date.now()) {
    dom.storyViewer.close();
    loadStories();
    return;
  }
  const profile = story.profiles || {};
  const name = profile.display_name || profile.username || "EchoRooms member";
  hideError(dom.storyViewerError);
  dom.storyViewerAvatar.textContent = makeInitial(profile);
  dom.storyViewerAuthor.textContent = name;
  dom.storyViewerTime.textContent = ageLabel(story.created_at);
  dom.storyViewerCaption.textContent = story.body || "";
  dom.storyViewerCaption.classList.toggle("is-hidden", !story.body);
  dom.storyViewerMedia.replaceChildren();
  if (story.media_url) {
    const image = document.createElement("img");
    image.src = story.media_url;
    image.alt = `Story shared by ${name}`;
    dom.storyViewerMedia.append(image);
  }
  dom.storyProgress.style.width = `${((viewerIndex + 1) / stories.length) * 100}%`;
  dom.storyDelete.classList.toggle("is-hidden", story.author_id !== state.currentUser?.id);
  dom.storyViewerPrev.disabled = viewerIndex === 0;
  dom.storyViewerNext.disabled = viewerIndex >= stories.length - 1;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    if (viewerIndex < stories.length - 1) {
      viewerIndex += 1;
      renderStory();
    } else {
      dom.storyViewer.close();
    }
  }, 8000);
}

async function publishStory(event) {
  event.preventDefault();
  if (!supabase || !state.currentUser) return;
  hideError(dom.storyCreateError);
  const file = dom.storyPhoto.files?.[0];
  const body = dom.storyCaption.value.trim();
  const audience = dom.storyAudience.value;
  const recipients = [...dom.storyRecipientList.querySelectorAll("input:checked")].map((input) => input.value);
  if (!body && !file) {
    showError(dom.storyCreateError, "Add a photo or a few words before sharing.");
    return;
  }
  if (file && (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > MAX_STORY_BYTES)) {
    showError(dom.storyCreateError, "Choose a JPEG, PNG, or WebP photo smaller than 10 MB.");
    return;
  }
  if (audience === "selected" && !recipients.length) {
    showError(dom.storyCreateError, "Choose at least one person who can view this story.");
    return;
  }
  setButtonLoading(dom.storyPublish, true, "Sharing…");
  let mediaPath = null;
  let storyId = null;
  let storyCreated = false;
  try {
    if (file) {
      const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[file.type];
      mediaPath = `${state.currentUser.id}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage.from(BUCKET).upload(mediaPath, file, { contentType: file.type, upsert: false });
      if (error) throw error;
    }
    storyId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from("social_stories").insert({
      id: storyId,
      author_id: state.currentUser.id,
      body: body || null,
      media_path: mediaPath,
      audience_mode: audience,
      expires_at: expiresAt,
    });
    if (error) throw error;
    storyCreated = true;
    if (audience === "selected") {
      const { error: recipientsError } = await supabase.from("social_story_recipients").insert(
        recipients.map((userId) => ({ story_id: storyId, user_id: userId }))
      );
      if (recipientsError) {
        await supabase.from("social_stories").delete().eq("id", storyId);
        storyCreated = false;
        throw recipientsError;
      }
    }
    dom.storyCreateDialog.close();
    await loadStories();
  } catch (error) {
    if (mediaPath && !storyCreated) await supabase.storage.from(BUCKET).remove([mediaPath]);
    showError(dom.storyCreateError, getRequestErrorMessage(error, "Couldn't share your story. Please try again."));
  } finally {
    setButtonLoading(dom.storyPublish, false);
  }
}

async function deleteCurrentStory() {
  const story = stories[viewerIndex];
  if (!story || story.author_id !== state.currentUser?.id) return;
  dom.storyDelete.disabled = true;
  const { error } = await supabase.from("social_stories").delete().eq("id", story.id);
  dom.storyDelete.disabled = false;
  if (error) {
    showError(dom.storyViewerError, getRequestErrorMessage(error, "Couldn't delete this story. Please try again."));
    return;
  }
  dom.storyViewer.close();
  await loadStories();
}

export function initStories() {
  dom.storyCreateClose?.addEventListener("click", () => dom.storyCreateDialog.close());
  dom.storyCreateForm?.addEventListener("submit", publishStory);
  dom.storyAudience?.addEventListener("change", () => {
    if (dom.storyAudience.value === "selected") loadRecipients();
    else dom.storyRecipientList.classList.add("is-hidden");
  });
  dom.storyViewerClose?.addEventListener("click", () => dom.storyViewer.close());
  dom.storyViewerPrev?.addEventListener("click", () => {
    if (viewerIndex > 0) {
      viewerIndex -= 1;
      renderStory();
    }
  });
  dom.storyViewerNext?.addEventListener("click", () => {
    if (viewerIndex < stories.length - 1) {
      viewerIndex += 1;
      renderStory();
    }
  });
  dom.storyDelete?.addEventListener("click", deleteCurrentStory);
  window.addEventListener("echorooms:session-started", () => {
    subscribeStories();
    loadStories();
  });
  dom.storyViewer?.addEventListener("close", () => window.clearTimeout(timer));
  window.addEventListener("echorooms:session-ended", () => {
    stories = [];
    window.clearTimeout(expiryTimer);
    expiryTimer = null;
    if (storiesChannel) supabase?.removeChannel(storiesChannel);
    storiesChannel = null;
    if (dom.storyViewer?.open) dom.storyViewer.close();
    if (dom.storyCreateDialog?.open) dom.storyCreateDialog.close();
    renderStoryStrip();
  });
}
