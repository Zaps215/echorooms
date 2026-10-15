// Central registry of all DOM element references used across the app.
//
// Keeping every querySelector in one file gives us a single, auditable source
// of truth for the markup contract with index.html. Feature modules import from
// here instead of querying the DOM themselves, so renames in the templates only
// ever touch this file.

function query(id) {
  const el = document.getElementById(id);
  if (!el) {
    if (import.meta.env.DEV) {
      console.warn(`[dom] Missing element #${id}`);
    }
    return null;
  }
  return el;
}

function queryAll(selector) {
  return Array.from(document.querySelectorAll(selector));
}

export const authWrapper = query("auth-wrapper");
export const appWrapper = query("app-wrapper");

export const authFormSignin = query("auth-form-signin");
export const authFormSignup = query("auth-form-signup");
export const authFormForgot = query("auth-form-forgot");
export const authFormRecovery = query("auth-form-recovery");

export const signinEmail = query("signin-email");
export const signinPassword = query("signin-password");
export const signupName = query("signup-name");
export const signupUsername = query("signup-username");
export const signupEmail = query("signup-email");
export const signupPassword = query("signup-password");
export const signupConfirm = query("signup-confirm");
export const forgotEmail = query("forgot-email");
export const recoveryPassword = query("recovery-password");
export const recoveryConfirm = query("recovery-confirm");

export const signinError = query("signin-error");
export const signupError = query("signup-error");
export const forgotError = query("forgot-error");
export const recoveryError = query("recovery-error");

export const btnToSignup = query("btn-to-signup");
export const btnToSignin = query("btn-to-signin");
export const btnForgot = query("btn-forgot");
export const btnBackSignin = query("btn-back-signin");
export const btnGoogleSignin = query("btn-google-signin");

export const otpEmail = query("otp-email");
export const otpTitle = query("otp-title");
export const otpBoxes = query("otp-boxes");
export const otpResendLabel = query("otp-resend-label");
export const otpCountdown = query("otp-countdown");
export const otpResend = query("otp-resend");
export const otpError = query("otp-error");
export const otpBack = query("otp-back");
export const otpResetHint = query("otp-reset-hint");

export const roomList = query("room-list");
export const channelReader = query("channel-reader");
export const channelWelcome = query("channel-welcome");
export const channelFeaturedGrid = query("channel-featured-grid");
export const channelBack = query("channel-back");
export const channelReaderAvatar = query("channel-reader-avatar");
export const channelReaderTitle = query("channel-reader-title");
export const channelReaderDescription = query("channel-reader-description");
export const channelJoinButton = query("channel-join-button");
export const channelMemberCount = query("channel-member-count");
export const channelPostList = query("channel-post-list");
export const feedRoomList = query("feed-room-list");
export const feedPostList = query("feed-post-list");
export const storyStrip = query("story-strip");
export const storyCreateDialog = query("story-create-dialog");
export const storyCreateClose = query("story-create-close");
export const storyCreateForm = query("story-create-form");
export const storyCaption = query("story-caption");
export const storyPhoto = query("story-photo");
export const storyAudience = query("story-audience");
export const storyRecipientList = query("story-recipient-list");
export const storyCreateError = query("story-create-error");
export const storyPublish = query("story-publish");
export const storyViewer = query("story-viewer");
export const storyViewerClose = query("story-viewer-close");
export const storyViewerPrev = query("story-viewer-prev");
export const storyViewerNext = query("story-viewer-next");
export const storyViewerAvatar = query("story-viewer-avatar");
export const storyViewerAuthor = query("story-viewer-author");
export const storyViewerTime = query("story-viewer-time");
export const storyViewerMedia = query("story-viewer-media");
export const storyViewerCaption = query("story-viewer-caption");
export const storyProgress = query("story-progress");
export const storyDelete = query("story-delete");
export const storyViewerError = query("story-viewer-error");
export const feedComposeAvatar = query("feed-compose-avatar");
export const feedCreateButtons = queryAll("#btn-feed-create, #btn-feed-create-prompt, #btn-feed-create-inline");
export const feedRefresh = query("btn-feed-refresh");
export const feedPostDialog = query("feed-post-dialog");
export const feedPostClose = query("feed-post-close");
export const feedPostForm = query("feed-post-form");
export const feedPostText = query("feed-post-text");
export const feedPostAvatar = query("feed-post-avatar");
export const feedPostAuthorName = query("feed-post-author-name");
export const feedPostError = query("feed-post-error");
export const feedPublish = query("feed-publish");
export const feedChoosePhoto = query("feed-choose-photo");
export const feedOpenCamera = query("feed-open-camera");
export const feedRecordVoice = query("feed-record-voice");
export const feedPhotoInput = query("feed-photo-input");
export const feedMediaPreview = query("feed-media-preview");
export const feedPreviewImage = query("feed-preview-image");
export const feedPreviewAudio = query("feed-preview-audio");
export const feedRemoveMedia = query("feed-remove-media");
export const feedCharCount = query("feed-char-count");
export const feedCameraDialog = query("feed-camera-dialog");
export const feedCameraVideo = query("feed-camera-video");
export const feedCameraCapture = query("feed-camera-capture");
export const feedCameraClose = query("feed-camera-close");
export const feedCameraCancel = query("feed-camera-cancel");
export const feedCameraError = query("feed-camera-error");
export const roomSearch = query("room-search");
export const meAvatar = query("me-avatar");
export const navAvatar = query("nav-avatar");
export const meName = query("me-name");
export const btnNewRoom = query("btn-new-room");
export const btnNewDm = query("btn-new-dm");
export const btnLogout = query("btn-logout");
export const btnOpenProfile = query("btn-open-profile");
export const btnNavProfile = query("btn-nav-profile");
export const appViewButtons = queryAll("[data-app-view]");

export const chatEmpty = query("chat-empty");
export const chatActive = query("chat-active");
export const chatTitle = query("chat-title");
export const chatSubtitle = query("chat-subtitle");
export const realtimeStatus = query("realtime-status");
export const peerPresence = query("peer-presence");
export const chatAvatar = query("chat-avatar");
export const composerInput = query("composer-input");
export const composerNotice = query("composer-notice");
export const btnAttach = query("btn-attach");
export const btnRecordVoice = query("btn-record-voice");
export const attachInput = query("attach-input");
export const attachPreview = query("attach-preview");
export const attachPreviewList = query("attach-preview-list");
export const attachProgress = query("attach-progress");
export const replyBar = query("reply-bar");
export const replySender = query("reply-sender");
export const replyText = query("reply-text");
export const replyCancel = query("reply-cancel");
export const mentionMenu = query("mention-menu");
export const messagesEl = query("messages");
export const btnSend = query("btn-send");
export const btnInfo = query("btn-info");
export const btnBack = query("btn-back");
export const btnCloseChat = query("btn-close-chat");
export const btnVoiceCall = query("btn-voice-call");
export const btnVideoCall = query("btn-video-call");
export const callDialog = query("call-dialog");
export const callTitle = query("call-title");
export const callStatus = query("call-status");
export const callLocalVideo = query("call-local-video");
export const callRemoteVideo = query("call-remote-video");
export const callRemoteAudio = query("call-remote-audio");
export const callAudioOnly = query("call-audio-only");
export const callClose = query("call-close");
export const callMicToggle = query("call-mic-toggle");
export const callCameraToggle = query("call-camera-toggle");
export const callHangup = query("call-hangup");
export const callIncomingActions = query("call-incoming-actions");
export const callDecline = query("call-decline");
export const callAccept = query("call-accept");
export const callError = query("call-error");

export const drawerBackdrop = query("drawer-backdrop");

export const info = query("info");
export const btnCloseInfo = query("btn-close-info");
export const infoHeadSub = query("info-head-sub");
export const memberList = query("member-list");
export const memberCount = query("member-count");
export const btnInvite = query("btn-invite");
export const btnRestore = query("btn-restore");
export const btnDeleteChat = query("btn-delete-chat");
export const btnDissolveRoom = query("btn-dissolve-room");

export const infoRoomAvatar = query("info-room-avatar");
export const infoRoomName = query("info-room-name");
export const infoRoomDesc = query("info-room-desc");
export const infoRoomTag = query("info-room-tag");
export const infoMediaGrid = query("info-media-grid");
export const infoMediaEmpty = query("info-media-empty");
export const btnClearMessages = query("btn-clear-messages");


export const roomDialog = query("room-dialog");
export const roomForm = query("room-form");
export const roomName = query("room-name");
export const roomError = query("room-error");
export const roomDialogClose = query("room-dialog-close");
export const roomCancel = query("room-cancel");

export const profileDialog = query("profile-dialog");
export const profileForm = query("profile-form");
export const profileName = query("profile-name");
export const profileUsername = query("profile-username");
export const profileStatus = query("profile-status");
export const profileAvatar = query("profile-avatar");
export const profileError = query("profile-error");
export const profileDialogClose = query("profile-dialog-close");
export const profileCancel = query("profile-cancel");

export const profileView = query("profile-view");
export const btnProfileBack = query("btn-profile-back");
export const btnProfileAvatar = query("btn-profile-avatar");
export const btnProfileEdit = query("btn-profile-edit");
export const btnProfileDelete = query("btn-profile-delete");
export const profileAvatarEl = query("profile-avatar-lg");
export const profileDisplayName = query("profile-display-name");
export const profileHeadTitle = query("profile-head-title");
export const profileHandleEl = query("profile-handle");
export const profileStatusText = query("profile-status-text");
export const btnProfileShare = query("btn-profile-share");
export const profileShareFeedback = query("profile-share-feedback");
export const profilePageError = query("profile-page-error");
export const profilePostCount = query("profile-post-count");
export const profileCommentCount = query("profile-comment-count");
export const profilePostGrid = query("profile-post-grid");
export const btnProfileSettings = query("btn-profile-settings");
export const profileContent = query("profile-content");
export const profileSettings = query("profile-settings");
export const settingDarkMode = query("setting-dark-mode");
export const btnEnableNotifications = query("btn-enable-notifications");
export const notificationSettingStatus = query("notification-setting-status");
export const btnSettingsEditProfile = query("btn-settings-edit-profile");
export const btnSettingsSignout = query("btn-settings-signout");

export const dmDialog = query("dm-dialog");
export const dmForm = query("dm-form");
export const dmUsername = query("dm-username");
export const dmResults = query("dm-results");
export const dmError = query("dm-error");
export const dmDialogClose = query("dm-dialog-close");
export const dmCancel = query("dm-cancel");

export const usernameDialog = query("username-dialog");
export const usernameForm = query("username-form");
export const usernameInput = query("username-input");
export const usernameError = query("username-error");

export const inviteDialog = query("invite-dialog");
export const inviteForm = query("invite-form");
export const inviteUsername = query("invite-username");
export const inviteResults = query("invite-results");
export const inviteError = query("invite-error");
export const inviteDialogClose = query("invite-dialog-close");
export const inviteCancel = query("invite-cancel");

export const confirmDialog = query("confirm-dialog");
export const confirmTitle = query("confirm-title");
export const confirmMessage = query("confirm-message");
export const confirmTextWrap = query("confirm-text-wrap");
export const confirmTextLabel = query("confirm-text-label");
export const confirmTextInput = query("confirm-text-input");
export const confirmOk = query("confirm-ok");
export const confirmCancel = query("confirm-cancel");
export const confirmClose = query("confirm-close");

export const restoreDialog = query("restore-dialog");
export const restoreList = query("restore-list");
export const restoreEmpty = query("restore-empty");
export const restoreDialogClose = query("restore-dialog-close");

export const passwordToggles = queryAll("[data-reveal]");
export const tabs = queryAll(".side-tabs .tab");
export const googleSignupBtn = query("btn-google-signup");

export function findPrimaryButton(form) {
  return form ? form.querySelector(".btn-primary") : null;
}
