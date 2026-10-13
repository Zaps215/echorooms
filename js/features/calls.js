// One-to-one browser calls use WebRTC media with room-member-only Supabase
// Realtime signaling. Group calls need a media server and are not offered yet.

import * as dom from "../core/dom.js";
import { state } from "../core/state.js";
import { supabase } from "../core/supabase.js";
import { getRequestErrorMessage } from "../core/utils.js";

const RTC_CONFIGURATION = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

let roomId = null;
let peerId = null;
let peerName = "Contact";
let callChannel = null;
let channelReady = null;
let peerConnection = null;
let localStream = null;
let currentCallId = null;
let callMode = "audio";
let pendingOffer = null;
let pendingCandidates = [];
let activeCall = false;

function callError(message) {
  if (dom.callError) {
    dom.callError.textContent = message;
    dom.callError.hidden = false;
  }
}

function clearCallError() {
  if (dom.callError) {
    dom.callError.textContent = "";
    dom.callError.hidden = true;
  }
}

function showCallDialog(title, status) {
  clearCallError();
  dom.callTitle.textContent = title;
  dom.callStatus.textContent = status;
  dom.callIncomingActions.classList.add("is-hidden");
  dom.callHangup.classList.remove("is-hidden");
  dom.callMicToggle.classList.remove("is-hidden");
  dom.callCameraToggle.classList.toggle("is-hidden", callMode !== "video");
  dom.callAudioOnly.classList.toggle("is-hidden", callMode === "video");
  dom.callLocalVideo.classList.toggle("is-hidden", callMode !== "video");
  dom.callRemoteVideo.classList.toggle("is-hidden", callMode !== "video");
  if (!dom.callDialog.open) dom.callDialog.showModal();
}

function sendSignal(kind, data = {}, target = peerId) {
  if (!callChannel || !currentCallId || !target) {
    return Promise.reject(new Error("The call connection is not ready."));
  }
  return callChannel.send({
    type: "broadcast",
    event: "signal",
    payload: {
      to: target,
      from: state.currentUser.id,
      callId: currentCallId,
      kind,
      data,
    },
  }).then((result) => {
    if (result?.status && result.status !== "ok") {
      throw new Error("The call signal could not reach the other person.");
    }
    return result;
  });
}

async function preparePeerConnection() {
  if (!localStream) throw new Error("Microphone or camera permission is needed to place a call.");
  peerConnection = new RTCPeerConnection(RTC_CONFIGURATION);
  localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));
  peerConnection.ontrack = (event) => {
    if (callMode === "video") dom.callRemoteVideo.srcObject = event.streams[0];
    else dom.callRemoteAudio.srcObject = event.streams[0];
    dom.callStatus.textContent = "Connected";
  };
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && activeCall) {
      sendSignal("candidate", { candidate: event.candidate.toJSON() }).catch((error) => {
        callError(getRequestErrorMessage(error, "Connection details could not be sent."));
      });
    }
  };
  peerConnection.onconnectionstatechange = () => {
    if (!peerConnection) return;
    if (peerConnection.connectionState === "connected") dom.callStatus.textContent = "Connected";
    if (peerConnection.connectionState === "failed") {
      callError("Couldn't establish a call. Check your connection and try again.");
      dom.callStatus.textContent = "Connection failed";
    }
    if (peerConnection.connectionState === "disconnected") dom.callStatus.textContent = "Reconnecting…";
  };
}

async function captureMedia(mode) {
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    throw new Error("Calls aren't supported in this browser. Try a current browser on HTTPS.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: mode === "video" ? { facingMode: "user" } : false,
  });
  localStream = stream;
  dom.callLocalVideo.srcObject = stream;
}

async function emitOffer() {
  await preparePeerConnection();
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  await sendSignal("offer", { description: peerConnection.localDescription.toJSON() });
  dom.callStatus.textContent = "Ringing…";
}

async function processOffer(offer) {
  if (!peerConnection) await preparePeerConnection();
  await peerConnection.setRemoteDescription(offer);
  for (const candidate of pendingCandidates.splice(0)) {
    await peerConnection.addIceCandidate(candidate);
  }
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  await sendSignal("answer", { description: peerConnection.localDescription.toJSON() });
  dom.callStatus.textContent = "Connecting…";
}

async function handleSignal({ payload }) {
  if (!payload || payload.to !== state.currentUser?.id || payload.from !== peerId) return;
  if (payload.kind === "invite" && !activeCall) {
    currentCallId = payload.callId;
    callMode = payload.data?.mode === "video" ? "video" : "audio";
    pendingOffer = null;
    showCallDialog(`${peerName} is calling`, callMode === "video" ? "Incoming video call" : "Incoming voice call");
    dom.callIncomingActions.classList.remove("is-hidden");
    dom.callHangup.classList.add("is-hidden");
    dom.callMicToggle.classList.add("is-hidden");
    dom.callCameraToggle.classList.add("is-hidden");
    return;
  }
  if ((!activeCall && payload.kind !== "hangup") || payload.callId !== currentCallId) return;
  if (payload.kind === "accept") {
    dom.callStatus.textContent = "Connecting…";
    try {
      await emitOffer();
    } catch (error) {
      callError(getRequestErrorMessage(error, "Couldn't start the call. Please try again."));
      await sendSignal("hangup").catch(() => {});
    }
  } else if (payload.kind === "reject") {
    dom.callStatus.textContent = "Call declined";
    endCall(false);
  } else if (payload.kind === "offer") {
    pendingOffer = payload.data?.description;
    if (peerConnection) {
      try {
        await processOffer(pendingOffer);
      } catch (error) {
        callError(getRequestErrorMessage(error, "Couldn't answer this call."));
      }
    }
  } else if (payload.kind === "answer" && peerConnection) {
    await peerConnection.setRemoteDescription(payload.data.description);
    for (const candidate of pendingCandidates.splice(0)) {
      await peerConnection.addIceCandidate(candidate);
    }
  } else if (payload.kind === "candidate" && payload.data?.candidate) {
    const candidate = new RTCIceCandidate(payload.data.candidate);
    if (peerConnection?.remoteDescription) await peerConnection.addIceCandidate(candidate);
    else pendingCandidates.push(candidate);
  } else if (payload.kind === "hangup") {
    dom.callStatus.textContent = "Call ended";
    endCall(false);
  }
}

async function subscribeToRoom(nextRoomId, type) {
  if (callChannel && supabase) supabase.removeChannel(callChannel);
  callChannel = null;
  channelReady = null;
  roomId = type === "direct" ? nextRoomId : null;
  peerId = null;
  peerName = "Contact";
  endCall(false);
  dom.btnVoiceCall.classList.toggle("is-hidden", !roomId);
  dom.btnVideoCall.classList.toggle("is-hidden", !roomId);
  if (!roomId || !supabase || !state.currentUser) return;

  const { data, error } = await supabase
    .from("room_members")
    .select("user_id, profiles(display_name, username)")
    .eq("room_id", roomId);
  if (error || state.currentRoomId !== roomId) return;
  const other = (data || []).find((member) => member.user_id !== state.currentUser.id);
  if (!other) return;
  peerId = other.user_id;
  peerName = other.profiles?.display_name || other.profiles?.username || "Contact";

  const channel = supabase.channel(`calls:${roomId}`, {
    config: { private: true, broadcast: { self: false } },
  });
  channel.on("broadcast", { event: "signal" }, handleSignal);
  callChannel = channel;
  channelReady = new Promise((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Call signaling timed out. Check your connection and try again."));
    }, 12_000);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED" && !settled) {
        settled = true;
        window.clearTimeout(timeout);
        resolve();
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status) && !settled) {
        settled = true;
        window.clearTimeout(timeout);
        reject(new Error("Call signaling could not connect. Check the network and confirm migration 0018 is applied."));
      }
    });
  });
  channelReady.catch(() => {});
}

async function startCall(mode) {
  if (!roomId || !supabase) return;
  if (!peerId) {
    callMode = mode;
    showCallDialog("Call unavailable", "Couldn't load this room's other member.");
    callError("Refresh the conversation and try again.");
    return;
  }
  if (activeCall) return;
  callMode = mode;
  currentCallId = crypto.randomUUID();
  activeCall = true;
  pendingOffer = null;
  pendingCandidates = [];
  showCallDialog(mode === "video" ? `Calling ${peerName}` : `Calling ${peerName}`, "Preparing your call…");
  try {
    if (!window.isSecureContext) throw new Error("Calls require HTTPS or localhost so your browser can safely use the microphone.");
    if (!channelReady) throw new Error("Call signaling is unavailable. Confirm migration 0018 is applied, then try again.");
    await channelReady;
    await captureMedia(mode);
    await sendSignal("invite", { mode });
    dom.callStatus.textContent = "Ringing…";
  } catch (error) {
    callError(getRequestErrorMessage(error, "Couldn't start the call. Check your microphone, camera, or connection."));
    dom.callStatus.textContent = "Call couldn't start";
    activeCall = false;
    releaseMedia();
  }
}

async function acceptCall() {
  if (!currentCallId || !callChannel) return;
  dom.callAccept.disabled = true;
  clearCallError();
  try {
    if (!window.isSecureContext) throw new Error("Calls require HTTPS or localhost.");
    await channelReady;
    await captureMedia(callMode);
    activeCall = true;
    await preparePeerConnection();
    dom.callIncomingActions.classList.add("is-hidden");
    dom.callHangup.classList.remove("is-hidden");
    dom.callMicToggle.classList.remove("is-hidden");
    dom.callCameraToggle.classList.toggle("is-hidden", callMode !== "video");
    await sendSignal("accept");
    dom.callStatus.textContent = "Connecting…";
    if (pendingOffer) await processOffer(pendingOffer);
  } catch (error) {
    callError(getRequestErrorMessage(error, "Couldn't answer the call. Check your microphone or camera."));
    activeCall = false;
    releaseMedia();
  } finally {
    dom.callAccept.disabled = false;
  }
}

function releaseMedia() {
  peerConnection?.close();
  peerConnection = null;
  localStream?.getTracks().forEach((track) => track.stop());
  localStream = null;
  dom.callLocalVideo.srcObject = null;
  dom.callRemoteVideo.srcObject = null;
  dom.callRemoteAudio.srcObject = null;
  pendingCandidates = [];
}

function endCall(notifyPeer = true) {
  const wasActive = activeCall;
  if (notifyPeer && currentCallId && callChannel && peerId) {
    sendSignal("hangup").catch((error) => {
      if (import.meta.env.DEV) console.warn("[calls] Could not send hangup signal.", error);
    });
  }
  activeCall = false;
  releaseMedia();
  currentCallId = null;
  pendingOffer = null;
  if (dom.callDialog?.open) dom.callDialog.close();
  if (!wasActive) return;
}

function toggleTrack(kind, button, offLabel, onLabel) {
  const track = localStream?.getTracks().find((item) => item.kind === kind);
  if (!track) return;
  track.enabled = !track.enabled;
  button.textContent = track.enabled ? offLabel : onLabel;
  button.setAttribute("aria-pressed", String(!track.enabled));
}

export function initCalls() {
  dom.btnVoiceCall?.addEventListener("click", () => startCall("audio"));
  dom.btnVideoCall?.addEventListener("click", () => startCall("video"));
  dom.callAccept?.addEventListener("click", acceptCall);
  dom.callDecline?.addEventListener("click", () => {
    sendSignal("reject").catch(() => {});
    endCall(false);
  });
  dom.callHangup?.addEventListener("click", () => endCall());
  dom.callClose?.addEventListener("click", () => endCall());
  dom.callDialog?.addEventListener("cancel", (event) => {
    event.preventDefault();
    endCall();
  });
  dom.callMicToggle?.addEventListener("click", () => toggleTrack("audio", dom.callMicToggle, "Mute", "Unmute"));
  dom.callCameraToggle?.addEventListener("click", () => toggleTrack("video", dom.callCameraToggle, "Camera off", "Camera on"));
  window.addEventListener("echorooms:room-selected", (event) => {
    subscribeToRoom(event.detail?.roomId, event.detail?.roomType);
  });
  window.addEventListener("echorooms:session-ended", () => {
    endCall(false);
    if (callChannel) supabase?.removeChannel(callChannel);
    callChannel = null;
    channelReady = null;
    roomId = null;
    peerId = null;
    dom.btnVoiceCall?.classList.add("is-hidden");
    dom.btnVideoCall?.classList.add("is-hidden");
  });
}
