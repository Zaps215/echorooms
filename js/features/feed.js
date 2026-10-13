// Social feed posts and their explicitly requested browser media access.
// Social posts are stored independently from end-to-end-encrypted room chats.

import * as dom from "../core/dom.js";
import { state } from "../core/state.js";
import { supabase } from "../core/supabase.js";
import { escapeHtml, showError, hideError, setButtonLoading, getRequestErrorMessage } from "../core/utils.js";
import { showConfirm } from "../core/confirm.js";

const MEDIA_BUCKET = "social-post-media";
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const MAX_POSTS = 24;
const COMMENT_LIMIT = 3;

let selectedMedia = null;
let previewUrl = null;
let cameraStream = null;
let microphoneStream = null;
let mediaRecorder = null;
let recordingChunks = [];
let discardRecording = false;
let feedChannel = null;

function currentName() {
  return state.currentUser?.user_metadata?.display_name || "You";
}

function notifyProfile() {
  window.dispatchEvent(new CustomEvent("echorooms:feed-profile-updated"));
}

function formatPostTime(value) {
  const date = new Date(value);
  const age = Date.now() - date.getTime();
  if (age < 60_000) return "Just now";
  if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function avatarMarkup(profile = {}) {
  const name = profile.display_name || profile.username || "Member";
  const initial = escapeHtml(name.trim().charAt(0).toUpperCase() || "?");
  return `<span class="feed-post-avatar" style="--avatar-color:#7653df">${initial}</span>`;
}

function postCard(post, likes, comments, currentUserId) {
  const profile = post.profiles || {};
  const name = profile.display_name || profile.username || "EchoRooms member";
  const handle = profile.username ? `@${profile.username}` : "";
  const own = post.author_id === currentUserId;
  const liked = likes.some((like) => like.user_id === currentUserId);
  const media = post.media_url
    ? post.media_type === "audio"
      ? `<div class="feed-post-audio"><span aria-hidden="true">♫</span><audio controls preload="none" src="${escapeHtml(post.media_url)}"></audio></div>`
      : `<img class="feed-post-image" src="${escapeHtml(post.media_url)}" alt="Photo shared by ${escapeHtml(name)}" loading="lazy" />`
    : post.media_path
      ? '<p class="feed-media-missing">This attachment is temporarily unavailable.</p>'
      : "";
  const body = post.body
    ? `<p class="feed-post-body">${escapeHtml(post.body).replace(/\n/g, "<br>")}</p>`
    : "";
  const visibleComments = comments
    .slice(0, COMMENT_LIMIT)
    .map((comment) => {
      const author = comment.profiles || {};
      const commentName = author.username ? `@${author.username}` : author.display_name || "Member";
      return `<p class="feed-post-comment"><strong>${escapeHtml(commentName)}</strong> ${escapeHtml(comment.body)}</p>`;
    })
    .join("");
  return `
    <article class="feed-post" data-post-id="${post.id}">
      <header class="feed-post-header">
        ${avatarMarkup(profile)}
        <div class="feed-post-author"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(handle)}${handle ? " · " : ""}${formatPostTime(post.created_at)}</span></div>
        ${own ? `<button class="feed-post-more" type="button" data-delete-post="${post.id}" aria-label="Delete your post" title="Delete post">•••</button>` : ""}
      </header>
      ${media}
      <div class="feed-post-content">
        <div class="feed-post-actions">
          <button class="feed-like-button ${liked ? "liked" : ""}" type="button" data-like-post="${post.id}" aria-pressed="${liked}" aria-label="${liked ? "Unlike" : "Like"} post">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="${liked ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8z"/></svg>
          </button>
          <button class="feed-comment-jump" type="button" data-focus-comment="${post.id}" aria-label="Write a comment">
            <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/></svg>
          </button>
          <button class="feed-share-button" type="button" data-share-post="${post.id}" aria-label="Share post" title="Share post">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.7 10.7 6.6-4.4m-6.6 7 6.6 4.4"/></svg>
          </button>
        </div>
        <p class="feed-post-likes"><strong>${likes.length}</strong> ${likes.length === 1 ? "like" : "likes"}</p>
        ${body}
        <div class="feed-post-comments">${visibleComments}</div>
        <form class="feed-comment-form" data-comment-post="${post.id}">
          <label class="sr-only" for="comment-${post.id}">Add a comment</label>
          <input id="comment-${post.id}" name="comment" maxlength="1000" placeholder="Add a comment…" autocomplete="off" required />
          <button type="submit">Post</button>
        </form>
      </div>
    </article>`;
}

async function makeSignedUrl(path, bucket = MEDIA_BUCKET) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

export async function loadFeedPosts() {
  if (!supabase || !state.currentUser || !dom.feedPostList) return;
  dom.feedPostList.innerHTML = '<p class="feed-loading">Loading your community feed…</p>';

  const { data: posts, error } = await supabase
    .from("social_posts")
    .select("id, author_id, body, media_path, media_type, media_mime_type, created_at, profiles!social_posts_author_id_fkey(display_name, username, avatar_path)")
    .order("created_at", { ascending: false })
    .limit(MAX_POSTS);

  if (error) {
    dom.feedPostList.innerHTML = `<p class="feed-state-error">${escapeHtml(getRequestErrorMessage(error, "Couldn't load the feed. Please try again."))}</p>`;
    return;
  }
  const requestedPostId = new URLSearchParams(window.location.hash.slice(1)).get("post");
  if (requestedPostId && /^[0-9a-f-]{36}$/i.test(requestedPostId) && !(posts || []).some((post) => post.id === requestedPostId)) {
    const targetResult = await supabase
      .from("social_posts")
      .select("id, author_id, body, media_path, media_type, media_mime_type, created_at, profiles!social_posts_author_id_fkey(display_name, username, avatar_path)")
      .eq("id", requestedPostId)
      .maybeSingle();
    if (targetResult.error) {
      dom.feedPostList.innerHTML = `<p class="feed-state-error">${escapeHtml(getRequestErrorMessage(targetResult.error, "Couldn't open the shared post. Please try again."))}</p>`;
      return;
    }
    if (targetResult.data) posts?.unshift(targetResult.data);
  }

  if (!posts?.length) {
    dom.feedPostList.innerHTML = `
      <section class="feed-empty">
        <span class="feed-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg></span>
        <h3>Your feed starts here</h3>
        <p>Share a photo or a thought with the EchoRooms community.</p>
        <button class="feed-primary" type="button" data-open-composer>Write your first post</button>
      </section>`;
    bindRenderedPostInputs();
    if (requestedPostId) {
      dom.feedPostList.querySelector(`[data-post-id="${requestedPostId}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    notifyProfile();
    return;
  }

  const postIds = posts.map((post) => post.id);
  const [likesResult, commentsResult] = await Promise.all([
    supabase.from("social_post_likes").select("post_id, user_id").in("post_id", postIds),
    supabase
      .from("social_post_comments")
      .select("id, post_id, author_id, body, created_at, profiles!social_post_comments_author_id_fkey(display_name, username)")
      .in("post_id", postIds)
      .order("created_at", { ascending: false })
      .limit(MAX_POSTS * COMMENT_LIMIT),
  ]);
  if (likesResult.error) {
    dom.feedPostList.innerHTML = `<p class="feed-state-error">${escapeHtml(getRequestErrorMessage(likesResult.error, "Couldn't load post likes. Please refresh and try again."))}</p>`;
    return;
  }
  if (commentsResult.error) {
    dom.feedPostList.innerHTML = `<p class="feed-state-error">${escapeHtml(getRequestErrorMessage(commentsResult.error, "Couldn't load post comments. Please refresh and try again."))}</p>`;
    return;
  }

  const preparedPosts = await Promise.all(posts.map(async (post) => {
    if (post.media_path) {
      try {
        post.media_url = await makeSignedUrl(post.media_path);
      } catch (error) {
        if (import.meta.env.DEV) console.warn("[feed] Could not load post media:", error);
        post.media_url = "";
      }
    }
    return post;
  }));
  const likesByPost = new Map();
  for (const like of likesResult.data || []) {
    if (!likesByPost.has(like.post_id)) likesByPost.set(like.post_id, []);
    likesByPost.get(like.post_id).push(like);
  }
  const commentsByPost = new Map();
  for (const comment of commentsResult.data || []) {
    const comments = commentsByPost.get(comment.post_id) || [];
    if (comments.length < COMMENT_LIMIT) comments.push(comment);
    commentsByPost.set(comment.post_id, comments);
  }
  dom.feedPostList.innerHTML = preparedPosts
    .map((post) => postCard(
      post,
      likesByPost.get(post.id) || [],
      commentsByPost.get(post.id) || [],
      state.currentUser.id
    ))
    .join("");
  bindRenderedPostInputs();
  notifyProfile();
}

async function loadProfilePosts() {
  if (!supabase || !state.currentUser || !dom.profilePostGrid) return;
  const [countResult, postsResult] = await Promise.all([
    supabase.from("social_posts").select("id", { count: "exact", head: true }).eq("author_id", state.currentUser.id),
    supabase
      .from("social_posts")
      .select("id, body, media_path, media_type, created_at")
      .eq("author_id", state.currentUser.id)
      .order("created_at", { ascending: false })
      .limit(24),
  ]);
  if (countResult.error || postsResult.error) {
    if (import.meta.env.DEV) console.warn("[feed] Could not load profile posts.", countResult.error || postsResult.error);
    return;
  }
  if (dom.profilePostCount) dom.profilePostCount.textContent = String(countResult.count || 0);
  if (dom.profileCommentCount) {
    const { count, error } = await supabase
      .from("social_post_comments")
      .select("id", { count: "exact", head: true })
      .eq("author_id", state.currentUser.id);
    if (!error) dom.profileCommentCount.textContent = String(count || 0);
  }
  const tiles = await Promise.all((postsResult.data || []).map(async (post) => {
    if (!post.media_path) {
      return `<div class="profile-post-tile profile-post-text" title="${escapeHtml(post.body || "Post")}"><span>✎</span><p>${escapeHtml((post.body || "").slice(0, 90))}</p></div>`;
    }
    try {
      const url = await makeSignedUrl(post.media_path);
      return post.media_type === "audio"
        ? `<div class="profile-post-tile profile-post-voice"><span>♫</span><small>Voice note</small></div>`
        : `<img class="profile-post-tile" src="${escapeHtml(url)}" alt="Your post" loading="lazy" />`;
    } catch (error) {
      if (import.meta.env.DEV) console.warn("[feed] Could not load a profile post image:", error);
      return '<div class="profile-post-tile profile-post-broken" aria-label="Post image unavailable">Image unavailable</div>';
    }
  }));
  dom.profilePostGrid.innerHTML = tiles.length
    ? tiles.join("")
    : '<p class="profile-post-empty">Your shared photos and thoughts will appear here.</p>';
}

function openComposer() {
  if (!dom.feedPostDialog || !state.currentUser) return;
  hideError(dom.feedPostError);
  dom.feedPostForm.reset();
  resetSelectedMedia();
  if (dom.feedPostAuthorName) dom.feedPostAuthorName.textContent = currentName();
  if (dom.feedPostAvatar) {
    dom.feedPostAvatar.textContent = currentName().trim().charAt(0).toUpperCase() || "?";
  }
  updateCharCount();
  dom.feedPostDialog.showModal();
  dom.feedPostText.focus();
}

function updateCharCount() {
  if (!dom.feedCharCount || !dom.feedPostText) return;
  dom.feedCharCount.textContent = `${dom.feedPostText.value.length.toLocaleString()} / 2,200`;
}

function resetSelectedMedia() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  selectedMedia = null;
  dom.feedMediaPreview?.classList.add("is-hidden");
  if (dom.feedPreviewImage) {
    dom.feedPreviewImage.src = "";
    dom.feedPreviewImage.classList.add("is-hidden");
  }
  if (dom.feedPreviewAudio) {
    dom.feedPreviewAudio.pause();
    dom.feedPreviewAudio.removeAttribute("src");
    dom.feedPreviewAudio.classList.add("is-hidden");
  }
  if (dom.feedPhotoInput) dom.feedPhotoInput.value = "";
}

function setSelectedMedia(file) {
  if (!file) return;
  hideError(dom.feedPostError);
  if (file.size > MAX_MEDIA_BYTES) {
    showError(dom.feedPostError, "Choose a photo or voice recording smaller than 10 MB.");
    return;
  }
  const isImage = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
  const isAudio = ["audio/webm", "audio/mp4", "audio/mpeg", "audio/wav", "audio/ogg"].includes(file.type);
  if (!isImage && !isAudio) {
    showError(dom.feedPostError, "Choose a JPEG, PNG, or WebP photo, or record a voice note.");
    return;
  }
  resetSelectedMedia();
  selectedMedia = { file, type: isImage ? "image" : "audio" };
  previewUrl = URL.createObjectURL(file);
  dom.feedMediaPreview?.classList.remove("is-hidden");
  if (isImage && dom.feedPreviewImage) {
    dom.feedPreviewImage.src = previewUrl;
    dom.feedPreviewImage.classList.remove("is-hidden");
  } else if (dom.feedPreviewAudio) {
    dom.feedPreviewAudio.src = previewUrl;
    dom.feedPreviewAudio.classList.remove("is-hidden");
  }
}

async function publishPost(event) {
  event.preventDefault();
  if (!supabase || !state.currentUser) return;
  const body = dom.feedPostText.value.trim();
  if (!body && !selectedMedia) {
    showError(dom.feedPostError, "Write something or add a photo/voice note before sharing.");
    return;
  }
  hideError(dom.feedPostError);
  setButtonLoading(dom.feedPublish, true, "Sharing…");

  let mediaPath = null;
  try {
    if (selectedMedia) {
      const extension = selectedMedia.file.name.split(".").pop()?.toLowerCase() ||
        (selectedMedia.type === "audio" ? "webm" : "jpg");
      mediaPath = `${state.currentUser.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(mediaPath, selectedMedia.file, {
          contentType: selectedMedia.file.type,
          upsert: false,
        });
      if (uploadError) throw uploadError;
    }

    const { error } = await supabase.from("social_posts").insert({
      author_id: state.currentUser.id,
      body: body || null,
      media_path: mediaPath,
      media_type: selectedMedia?.type || null,
      media_mime_type: selectedMedia?.file.type || null,
    });
    if (error) {
      if (mediaPath) await supabase.storage.from(MEDIA_BUCKET).remove([mediaPath]);
      throw error;
    }

    dom.feedPostDialog.close();
    resetSelectedMedia();
    await loadFeedPosts();
    await loadProfilePosts();
  } catch (error) {
    showError(dom.feedPostError, getRequestErrorMessage(error, "Couldn't share your post. Please try again."));
  } finally {
    setButtonLoading(dom.feedPublish, false);
  }
}

async function toggleLike(button) {
  const postId = button.dataset.likePost;
  if (!postId || !state.currentUser) return;
  button.disabled = true;
  try {
    const alreadyLiked = button.getAttribute("aria-pressed") === "true";
    const result = alreadyLiked
      ? await supabase.from("social_post_likes").delete().eq("post_id", postId).eq("user_id", state.currentUser.id)
      : await supabase.from("social_post_likes").insert({ post_id: postId, user_id: state.currentUser.id });
    if (result.error) throw result.error;
    await loadFeedPosts();
  } catch (error) {
    const message = getRequestErrorMessage(error, "Couldn't update your like. Please try again.");
    showFeedNotice(message);
  } finally {
    button.disabled = false;
  }
}

function showFeedNotice(message) {
  if (!dom.feedPostList) return;
  const notice = document.createElement("p");
  notice.className = "feed-inline-error";
  notice.setAttribute("role", "alert");
  notice.textContent = message;
  dom.feedPostList.prepend(notice);
  window.setTimeout(() => notice.remove(), 5000);
}

async function submitComment(form) {
  const postId = form.dataset.commentPost;
  const input = form.elements.comment;
  const body = input.value.trim();
  if (!body || !state.currentUser) return;
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const { error } = await supabase.from("social_post_comments").insert({
      post_id: postId,
      author_id: state.currentUser.id,
      body,
    });
    if (error) throw error;
    await loadFeedPosts();
  } catch (error) {
    showFeedNotice(getRequestErrorMessage(error, "Couldn't add your comment. Please try again."));
  } finally {
    button.disabled = false;
  }

  async function sharePost(button) {
    const article = button.closest("[data-post-id]");
    if (!article) return;
    const caption = article.querySelector(".feed-post-body")?.textContent?.trim();
    const text = caption || "A post shared with the EchoRooms community.";
    const postId = article.dataset.postId;
    const url = `${window.location.origin}${window.location.pathname}#post=${encodeURIComponent(postId)}`;
    const shareData = { title: "EchoRooms post", text, url };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
      if (!navigator.clipboard?.writeText) throw new Error("Link sharing is not supported in this browser.");
      await navigator.clipboard.writeText(`${text}\n${shareData.url}`);
      showFeedNotice("Post text and the EchoRooms link were copied.");
    } catch (error) {
      if (error?.name === "AbortError") return;
      showFeedNotice(getRequestErrorMessage(error, "Couldn't share this post. Please try again."));
    }
  }
}

function bindRenderedPostInputs() {
  dom.feedPostList?.querySelectorAll("[data-like-post]").forEach((button) => {
    button.addEventListener("click", () => toggleLike(button));
  });
  dom.feedPostList?.querySelectorAll("[data-focus-comment]").forEach((button) => {
    button.addEventListener("click", () => {
      document.getElementById(`comment-${button.dataset.focusComment}`)?.focus();
    });
    dom.feedPostList?.querySelectorAll("[data-share-post]").forEach((button) => {
      button.addEventListener("click", () => sharePost(button));
    });
  });
  dom.feedPostList?.querySelectorAll("[data-comment-post]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitComment(form);
    });
  });
  dom.feedPostList?.querySelectorAll("[data-delete-post]").forEach((button) => {
    button.addEventListener("click", async () => {
      const confirmed = await showConfirm({
        danger: true,
        title: "Delete this post?",
        message: "This removes the post and its attached media from the community feed.",
        confirmLabel: "Delete post",
      });
      if (!confirmed) return;
      button.disabled = true;
      const { error } = await supabase.from("social_posts").delete().eq("id", button.dataset.deletePost);
      if (error) {
        showFeedNotice(getRequestErrorMessage(error, "Couldn't delete your post. Please try again."));
        button.disabled = false;
        return;
      }
      await loadFeedPosts();
      await loadProfilePosts();
    });
  });
  dom.feedPostList?.querySelectorAll("[data-open-composer]").forEach((button) => {
    button.addEventListener("click", openComposer);
  });
}

function stopCamera() {
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  if (dom.feedCameraVideo) dom.feedCameraVideo.srcObject = null;
}

async function openCamera() {
  hideError(dom.feedCameraError);
  if (!navigator.mediaDevices?.getUserMedia) {
    showError(dom.feedCameraError, "Camera access isn't available in this browser. Choose a photo from your device instead.");
    dom.feedCameraDialog.showModal();
    return;
  }
  dom.feedCameraDialog.showModal();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    if (!dom.feedCameraDialog.open) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    cameraStream = stream;
    dom.feedCameraVideo.srcObject = cameraStream;
    await dom.feedCameraVideo.play();
  } catch (error) {
    const denied = error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError";
    showError(
      dom.feedCameraError,
      denied
        ? "Camera permission was not granted. Allow camera access in your browser settings, or choose a photo instead."
        : "Couldn't open the camera. Check that another app isn't using it, or choose a photo instead."
    );
  }
}

async function captureCameraPhoto() {
  const video = dom.feedCameraVideo;
  if (!cameraStream || !video?.videoWidth) {
    showError(dom.feedCameraError, "Wait for the camera preview to appear, then try again.");
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) {
    showError(dom.feedCameraError, "Couldn't capture that photo. Please try again.");
    return;
  }
  stopCamera();
  dom.feedCameraDialog.close();
  setSelectedMedia(new File([blob], `echorooms-${Date.now()}.jpg`, { type: "image/jpeg" }));
}

function chooseAudioMimeType() {
  if (!window.MediaRecorder) return "";
  return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]
    .find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

async function stopVoiceRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    dom.feedRecordVoice.disabled = true;
    mediaRecorder.stop();
  }
}

async function startVoiceRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showError(dom.feedPostError, "Voice recording isn't supported in this browser. You can still share photos or text.");
    return;
  }
  const accepted = window.confirm("EchoRooms will ask your browser for microphone access to record a voice note. Your mic is used only while recording. Continue?");
  if (!accepted) return;
  hideError(dom.feedPostError);
  dom.feedRecordVoice.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!dom.feedPostDialog.open) {
      stream.getTracks().forEach((track) => track.stop());
      dom.feedRecordVoice.disabled = false;
      return;
    }
    microphoneStream = stream;
    discardRecording = false;
    const mimeType = chooseAudioMimeType();
    const recorder = new MediaRecorder(microphoneStream, mimeType ? { mimeType } : undefined);
    mediaRecorder = recorder;
    recordingChunks = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) recordingChunks.push(event.data);
    });
    recorder.addEventListener("stop", () => {
      microphoneStream?.getTracks().forEach((track) => track.stop());
      microphoneStream = null;
      dom.feedRecordVoice.disabled = false;
      dom.feedRecordVoice.innerHTML = '<span aria-hidden="true">◉</span> Record voice';
      if (!recordingChunks.length) return;
      const type = (recorder.mimeType || "audio/webm").split(";")[0];
      if (!discardRecording) {
        const audio = new File(recordingChunks, `voice-note-${Date.now()}.${type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : "webm"}`, { type });
        setSelectedMedia(audio);
      }
    }, { once: true });
    recorder.start();
    dom.feedRecordVoice.textContent = "Stop recording";
    dom.feedRecordVoice.disabled = false;
    window.setTimeout(() => {
      if (mediaRecorder?.state === "recording") stopVoiceRecording();
    }, 60_000);
  } catch (error) {
    microphoneStream?.getTracks().forEach((track) => track.stop());
    microphoneStream = null;
    dom.feedRecordVoice.disabled = false;
    const denied = error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError";
    showError(
      dom.feedPostError,
      denied
        ? "Microphone permission was not granted. Allow it in your browser settings, or share a photo or text instead."
        : "Couldn't start voice recording. Check your microphone and try again."
    );
  }
}

function setDarkMode(enabled) {
  document.body.dataset.theme = enabled ? "dark" : "light";
  try {
    localStorage.setItem("echorooms:dark-mode", enabled ? "true" : "false");
  } catch (error) {
    if (import.meta.env.DEV) console.warn("[settings] Could not store appearance preference.", error);
  }
}

function enableNotifications() {
  if (!("Notification" in window)) {
    dom.notificationSettingStatus.textContent = "Browser notifications aren't supported here.";
    return;
  }
  if (Notification.permission === "granted") {
    dom.notificationSettingStatus.textContent = "Notifications are enabled for this browser.";
    dom.btnEnableNotifications.textContent = "Enabled";
    return;
  }
  if (Notification.permission === "denied") {
    dom.notificationSettingStatus.textContent = "Notifications are blocked. Allow them in your browser's site settings.";
    return;
  }
  Notification.requestPermission().then((permission) => {
    const enabled = permission === "granted";
    dom.notificationSettingStatus.textContent = enabled
      ? "Notifications are enabled for this browser."
      : "Permission wasn't granted. You can change this in your browser's site settings.";
    dom.btnEnableNotifications.textContent = enabled ? "Enabled" : "Enable";
  }).catch((error) => {
    dom.notificationSettingStatus.textContent = "Couldn't request notification permission. Try your browser's site settings.";
    if (import.meta.env.DEV) console.warn("[settings] Notification permission request failed.", error);
  });
}

function subscribeToFeed() {
  if (!supabase || !state.currentUser) return;
  if (feedChannel) supabase.removeChannel(feedChannel);
  feedChannel = supabase
    .channel("social-posts-feed")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "social_posts" }, (payload) => {
      if (
        payload.new.author_id !== state.currentUser?.id &&
        document.hidden &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        new Notification("New EchoRooms post", { body: "There's a new post in your community feed." });
      }
      loadFeedPosts();
    })
    .subscribe();
}

export function startFeedSession() {
  subscribeToFeed();
}

export function initFeed() {
  dom.feedCreateButtons.forEach((button) => button.addEventListener("click", openComposer));
  dom.feedRefresh?.addEventListener("click", loadFeedPosts);
  dom.feedPostClose?.addEventListener("click", () => dom.feedPostDialog.close());
  dom.feedPostDialog?.addEventListener("close", () => {
    discardRecording = true;
    stopVoiceRecording();
    microphoneStream?.getTracks().forEach((track) => track.stop());
    microphoneStream = null;
    resetSelectedMedia();
  });
  dom.feedPostForm?.addEventListener("submit", publishPost);
  dom.feedPostText?.addEventListener("input", updateCharCount);
  dom.feedChoosePhoto?.addEventListener("click", () => dom.feedPhotoInput?.click());
  dom.feedPhotoInput?.addEventListener("change", () => setSelectedMedia(dom.feedPhotoInput.files?.[0]));
  dom.feedRemoveMedia?.addEventListener("click", resetSelectedMedia);
  dom.feedOpenCamera?.addEventListener("click", openCamera);
  dom.feedCameraCapture?.addEventListener("click", captureCameraPhoto);
  dom.feedCameraClose?.addEventListener("click", () => dom.feedCameraDialog.close());
  dom.feedCameraCancel?.addEventListener("click", () => dom.feedCameraDialog.close());
  dom.feedCameraDialog?.addEventListener("close", stopCamera);
  dom.feedRecordVoice?.addEventListener("click", () => {
    if (mediaRecorder?.state === "recording") stopVoiceRecording();
    else startVoiceRecording();
  });
  dom.settingDarkMode?.addEventListener("change", () => setDarkMode(dom.settingDarkMode.checked));
  dom.btnEnableNotifications?.addEventListener("click", enableNotifications);
  window.addEventListener("echorooms:feed-profile-updated", loadProfilePosts);
  window.addEventListener("echorooms:session-ended", () => {
    if (feedChannel) supabase?.removeChannel(feedChannel);
    feedChannel = null;
    discardRecording = true;
    stopVoiceRecording();
    microphoneStream?.getTracks().forEach((track) => track.stop());
    microphoneStream = null;
    if (dom.feedPostDialog?.open) dom.feedPostDialog.close();
    if (dom.feedCameraDialog?.open) dom.feedCameraDialog.close();
  });

  let darkMode = false;
  try {
    darkMode = localStorage.getItem("echorooms:dark-mode") === "true";
  } catch (error) {
    if (import.meta.env.DEV) console.warn("[settings] Could not read appearance preference.", error);
  }
  setDarkMode(darkMode);
  if (dom.settingDarkMode) dom.settingDarkMode.checked = darkMode;
  if ("Notification" in window && Notification.permission === "granted") {
    dom.notificationSettingStatus.textContent = "Notifications are enabled for this browser.";
    dom.btnEnableNotifications.textContent = "Enabled";
  }
}
