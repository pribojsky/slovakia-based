const login = document.querySelector("#login");
const room = document.querySelector("#room");
const nicknameInput = document.querySelector("#nickname");
const usersEl = document.querySelector("#users");
const messagesEl = document.querySelector("#messages");
const messageForm = document.querySelector("#message-form");
const messageInput = document.querySelector("#message");
const sendButton = document.querySelector("#send");
const roomName = document.querySelector("#room-name");
const connectionStatus = document.querySelector("#connection-status");
const peerStatus = document.querySelector("#peer-status");
const leaveButton = document.querySelector("#leave");

const startVideoButton = document.querySelector("#start-video");
const hangupVideoButton = document.querySelector("#hangup-video");
const videoArea = document.querySelector("#video-area");
const localVideo = document.querySelector("#local-video");
const remoteVideo = document.querySelector("#remote-video");
const remoteVideoLabel = document.querySelector("#remote-video-label");

let socket = null;
let selfId = null;
let peerId = null;
let peerNickname = null;
let pc = null;
let dataChannel = null;
let localStream = null;

let pendingCandidates = [];

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.cloudflare.com:3478" }
  ]
};

document.querySelectorAll("[data-category]").forEach(button => {
  button.addEventListener("click", () => {
    const nickname = nicknameInput.value.trim();

    if (!nickname) {
      nicknameInput.focus();
      return;
    }

    joinCategory(button.dataset.category, button.textContent.trim(), nickname);
  });
});

function joinCategory(category, label, nickname) {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl =
    `${protocol}//${location.host}/ws?category=${encodeURIComponent(category)}` +
    `&nickname=${encodeURIComponent(nickname)}`;

  socket = new WebSocket(wsUrl);

  connectionStatus.textContent = "Connecting...";
  roomName.textContent = label;

  socket.addEventListener("open", () => {
    login.hidden = true;
    room.hidden = false;
    connectionStatus.textContent = `Online as ${nickname}`;
  });

  socket.addEventListener("message", async event => {
    const data = JSON.parse(event.data);

    if (data.type === "users") {
      selfId = data.selfId;
      renderUsers(data.users);
      return;
    }

    if (data.type === "offer") {
      await receiveOffer(data);
      return;
    }

    if (data.type === "answer" && pc) {
      await pc.setRemoteDescription(data.answer);
      await flushPendingCandidates();
      return;
    }

    if (data.type === "ice" && data.candidate) {
      if (pc?.remoteDescription) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (error) {
          console.error("ICE candidate error:", error);
        }
      } else {
        pendingCandidates.push(data.candidate);
      }
    }
  });

  socket.addEventListener("close", () => {
    connectionStatus.textContent = "Offline";
  });
}

function renderUsers(users) {
  usersEl.innerHTML = "";

  const peers = users.filter(user => user.id !== selfId);

  if (!peers.length) {
    usersEl.textContent = "Nobody else is here.";
    return;
  }

  for (const user of peers) {
    const button = document.createElement("button");
    button.textContent = user.nickname;

    if (user.id === peerId) {
      button.classList.add("selected");
    }

    button.addEventListener("click", () => startConnection(user));
    usersEl.appendChild(button);
  }
}

function createPeerConnection(targetId) {
  if (pc) {
    pc.close();
  }

  pendingCandidates = [];
  pc = new RTCPeerConnection(rtcConfig);

  pc.onicecandidate = event => {
    if (event.candidate) {
      signal({
        type: "ice",
        to: targetId,
        candidate: event.candidate
      });
    }
  };

  pc.ontrack = event => {
    remoteVideo.srcObject = event.streams[0];
    remoteVideoLabel.textContent = peerNickname || "Peer";
    videoArea.hidden = false;
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      peerStatus.textContent = `P2P connected with ${peerNickname}`;
      startVideoButton.disabled = false;
    }

    if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
      disableChat();
      stopLocalMedia();
    }
  };

  pc.ondatachannel = event => {
    setupDataChannel(event.channel);
  };

  return pc;
}

async function startConnection(user) {
  peerId = user.id;
  peerNickname = user.nickname;

  peerStatus.textContent = `Connecting to ${peerNickname}...`;

  createPeerConnection(peerId);

  dataChannel = pc.createDataChannel("chat");
  setupDataChannel(dataChannel);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  signal({
    type: "offer",
    to: peerId,
    offer: pc.localDescription
  });
}

async function receiveOffer(data) {
  peerId = data.from;
  peerNickname = data.fromNickname;

  peerStatus.textContent = `Incoming connection from ${peerNickname}...`;

  createPeerConnection(peerId);

  await pc.setRemoteDescription(data.offer);
  await flushPendingCandidates();

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  signal({
    type: "answer",
    to: peerId,
    answer: pc.localDescription
  });
}

async function flushPendingCandidates() {
  if (!pc?.remoteDescription) return;

  for (const candidate of pendingCandidates) {
    try {
      await pc.addIceCandidate(candidate);
    } catch (error) {
      console.error("ICE candidate error:", error);
    }
  }

  pendingCandidates = [];
}

function setupDataChannel(channel) {
  dataChannel = channel;

  channel.onopen = () => {
    peerStatus.textContent = `P2P connected with ${peerNickname}`;
    messageInput.disabled = false;
    sendButton.disabled = false;
    startVideoButton.disabled = false;
    messageInput.focus();
  };

  channel.onmessage = event => {
    addMessage(peerNickname || "Peer", event.data);
  };

  channel.onclose = () => {
    disableChat();
  };
}

startVideoButton.addEventListener("click", async () => {
  if (!pc || !peerId) return;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });

    localVideo.srcObject = localStream;
    remoteVideoLabel.textContent = peerNickname || "Peer";
    videoArea.hidden = false;
    startVideoButton.disabled = true;

    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    signal({
      type: "offer",
      to: peerId,
      offer: pc.localDescription
    });

    peerStatus.textContent = `Video call with ${peerNickname}...`;
  } catch (error) {
    console.error("Camera/microphone error:", error);
    peerStatus.textContent = "Camera or microphone permission denied.";
  }
});

hangupVideoButton.addEventListener("click", () => {
  stopLocalMedia();
});

function stopLocalMedia() {
  if (localStream) {
    for (const track of localStream.getTracks()) {
      track.stop();
    }
  }

  localStream = null;
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  videoArea.hidden = true;

  if (dataChannel?.readyState === "open") {
    startVideoButton.disabled = false;
  }
}

function signal(data) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
  }
}

messageForm.addEventListener("submit", event => {
  event.preventDefault();

  const text = messageInput.value.trim();

  if (!text || dataChannel?.readyState !== "open") {
    return;
  }

  dataChannel.send(text);
  addMessage("You", text);
  messageInput.value = "";
});

function addMessage(author, text) {
  const message = document.createElement("div");
  message.className = "message";

  const strong = document.createElement("strong");
  strong.textContent = `${author}: `;

  message.append(strong, document.createTextNode(text));
  messagesEl.appendChild(message);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function disableChat() {
  messageInput.disabled = true;
  sendButton.disabled = true;
  startVideoButton.disabled = true;

  if (peerNickname) {
    peerStatus.textContent = `Disconnected from ${peerNickname}`;
  }
}

leaveButton.addEventListener("click", () => {
  stopLocalMedia();

  dataChannel?.close();
  pc?.close();
  socket?.close();

  socket = null;
  pc = null;
  dataChannel = null;
  peerId = null;
  peerNickname = null;
  selfId = null;
  pendingCandidates = [];

  usersEl.innerHTML = "";
  messagesEl.innerHTML = "";

  room.hidden = true;
  login.hidden = false;
});
