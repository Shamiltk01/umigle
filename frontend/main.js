import './style.css';
import { io } from "socket.io-client";

document.querySelector('#app').innerHTML = `
  <div class="app-shell">
    <div class="app-container">
      <header class="header">
        <div class="brand-block">
          <h1>Umfigle</h1>
          <p class="tagline">Talk to strangers!</p>
        </div>
        <div class="header-actions">
          <button id="theme-toggle" class="theme-toggle" type="button" aria-label="Toggle theme">🌙</button>
          <div class="online-count">
            <span id="online-users">10,432</span>+ online now
          </div>
        </div>
      </header>

      <main class="main-content">
        <section class="intro-card" id="intro-box">
          <div class="intro-eyebrow">Anonymous • Instant • Random</div>
          <h2>Meet New People</h2>
          <p>Umfigle is a great place to meet new friends. When you use Umfigle, we pick someone else at random and let you talk one-on-one. Chats are completely anonymous.</p>
          <div class="start-controls">
            <p class="start-label">Choose your mode</p>
            <div class="start-actions">
              <button id="video-chat-btn" class="start-btn video-btn">Video Chat</button>
              <button id="text-chat-btn" class="start-btn text-btn">Text Chat</button>
            </div>
          </div>
        </section>

        <section class="chat-interface hidden" id="chat-interface">
          <div class="video-container hidden" id="video-container">
              <div class="video-wrapper">
                  <video id="stranger-video" autoplay playsinline></video>
                  <div class="video-loading hidden" id="stranger-loading">
                      <div class="video-spinner"></div>
                      <span>Looking for stranger...</span>
                  </div>
                  <div class="video-label stranger-label">Stranger</div>
              </div>
              <div class="video-wrapper">
                  <video id="local-video" autoplay playsinline muted></video>
                  <div class="video-label you-label">You</div>
              </div>
          </div>
          <div class="chat-messages" id="chat-messages"></div>
          <div class="chat-controls">
            <button id="stop-btn" class="control-btn stop-btn">Stop</button>
            <button id="next-btn" class="control-btn next-btn">Next</button>
            <input type="text" id="message-input" placeholder="Type your message..." autocomplete="off">
            <button id="send-btn" class="control-btn send-btn">Send</button>
          </div>
        </section>
      </main>
    </div>
  </div>
`;

// Setup Socket.IO dynamically based on the current hostname or environment variable
// VITE_BACKEND_URL is used when hosting on Vercel pointing to a separate backend
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'https://umigle-production.up.railway.app';
const socket = io(BACKEND_URL);

// UI Elements
const introBox = document.getElementById('intro-box');
const chatInterface = document.getElementById('chat-interface');
const textChatBtn = document.getElementById('text-chat-btn');
const videoChatBtn = document.getElementById('video-chat-btn');
const stopBtn = document.getElementById('stop-btn');
const nextBtn = document.getElementById('next-btn');
const messageInput = document.getElementById('message-input');
const themeToggle = document.getElementById('theme-toggle');
const sendBtn = document.getElementById('send-btn');
const chatMessages = document.getElementById('chat-messages');

const videoContainer = document.getElementById('video-container');
const localVideo = document.getElementById('local-video');
const strangerVideo = document.getElementById('stranger-video');
const strangerLoading = document.getElementById('stranger-loading');

let isChatting = false;
let currentMode = 'text';

// WebRTC variables
let localStream = null;
let peerConnection = null;
let mediaStateMessage = null;

const turnUrls = import.meta.env.VITE_TURN_URLS
    ? import.meta.env.VITE_TURN_URLS.split(',').map((url) => url.trim()).filter(Boolean)
    : [];

const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
];

if (turnUrls.length > 0) {
    iceServers.push({
        urls: turnUrls,
        username: import.meta.env.VITE_TURN_USERNAME,
        credential: import.meta.env.VITE_TURN_CREDENTIAL
    });
}

const configuration = {
    iceServers,
    iceTransportPolicy: 'all'
};

// Event Listeners
textChatBtn.addEventListener('click', () => startChat('text'));
videoChatBtn.addEventListener('click', () => startChat('video'));
stopBtn.addEventListener('click', stopChat);
nextBtn.addEventListener('click', nextChat);
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

const savedTheme = localStorage.getItem('umfigle-theme');
const initialDark = savedTheme ? savedTheme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
document.body.setAttribute('data-theme', initialDark ? 'dark' : 'light');
updateThemeToggleIcon(initialDark);

themeToggle.addEventListener('click', () => {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    const nextTheme = isDark ? 'light' : 'dark';
    document.body.setAttribute('data-theme', nextTheme);
    localStorage.setItem('umfigle-theme', nextTheme);
    updateThemeToggleIcon(nextTheme === 'dark');
});

function updateThemeToggleIcon(isDark) {
    themeToggle.textContent = isDark ? 'Light' : 'Dark';
    themeToggle.setAttribute('aria-pressed', String(isDark));
}

function addMessage(text, type) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${type}-message`;

    const label = document.createElement('span');
    label.className = 'message-label';
    label.textContent = type === 'you' ? 'You' : 'Stranger';

    const content = document.createElement('p');
    content.className = 'message-text';
    content.textContent = text;

    msgDiv.appendChild(label);
    msgDiv.appendChild(content);
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addSystemMessage(text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message system-message`;
    msgDiv.textContent = text;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return msgDiv;
}

function showStrangerLoading(show) {
    if (!strangerLoading) return;
    strangerLoading.classList.toggle('hidden', !show);
}

function setMediaState(text) {
    if (mediaStateMessage) {
        mediaStateMessage.remove();
        mediaStateMessage = null;
    }
    if (text) {
        mediaStateMessage = addSystemMessage(text);
    }
}

function prepareForNewMatch({ clearMessages = false } = {}) {
    isChatting = false;
    stopVideo();
    messageInput.value = '';
    if (clearMessages) {
        chatMessages.innerHTML = '';
        mediaStateMessage = null;
    }
    if (currentMode === 'video') {
        videoContainer.classList.remove('hidden');
        showStrangerLoading(true);
        setMediaState('Establishing media connection...');
    }
}

function queueNextMatch(withMessage = true) {
    prepareForNewMatch({ clearMessages: true });
    if (withMessage) {
        addSystemMessage('Finding new stranger...');
    }
    socket.emit('start_chat', { mode: currentMode });
}

// Actions
function getMediaErrorMessage(err) {
    if (err?.name === 'NotAllowedError') {
        return 'Camera or microphone access is blocked in browser/device settings. Allow both permissions and refresh the page.';
    }
    if (err?.name === 'NotFoundError') {
        return 'No usable camera was found on this device.';
    }
    if (err?.name === 'NotReadableError') {
        return 'Your camera is in use by another application (Zoom, Teams, etc.).';
    }
    if (err?.name === 'SecurityError') {
        return 'Video chat requires HTTPS and a regular browser tab (not an in-app browser).';
    }
    return `Media error: ${err?.name || 'UnknownError'} - ${err?.message || 'Unknown error'}`;
}

async function requestMediaStream() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        const error = new Error('Secure context required for camera access.');
        error.name = 'SecurityError';
        throw error;
    }

    try {
        return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (err) {
        if (err?.name !== 'NotAllowedError' && err?.name !== 'NotFoundError') {
            throw err;
        }

        const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        addSystemMessage('Microphone is blocked or unavailable. Continuing with camera only.');
        return fallbackStream;
    }
}

async function startChat(mode) {
    currentMode = mode;
    introBox.classList.add('hidden');
    chatInterface.classList.remove('hidden');
    chatMessages.innerHTML = '';
    mediaStateMessage = null;
    addSystemMessage('Connecting to server...');

    if (mode === 'video') {
        videoContainer.classList.remove('hidden');
        showStrangerLoading(true);
        setMediaState('Preparing camera and microphone...');
        try {
            localStream = await requestMediaStream();
            localVideo.srcObject = localStream;
            setMediaState('Searching for a stable video route...');
        } catch (err) {
            console.error('Error accessing media devices.', err);
            addSystemMessage(`${getMediaErrorMessage(err)} Switching to text chat.`);
            currentMode = 'text';
            videoContainer.classList.add('hidden');
            showStrangerLoading(false);
            setMediaState(null);
        }
    } else {
        videoContainer.classList.add('hidden');
        showStrangerLoading(false);
        setMediaState(null);
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
    }

    socket.emit('start_chat', { mode: currentMode });
}

function stopVideo() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    strangerVideo.srcObject = null;
    setMediaState(null);
}

function stopChat() {
    stopVideo();
    showStrangerLoading(false);
    if (isChatting) {
        socket.emit('skip');
        isChatting = false;
        addSystemMessage("You disconnected.");
    }
}

function nextChat() {
    if (isChatting) {
        socket.emit('skip');
    }
    queueNextMatch();
}

function sendMessage() {
    const text = messageInput.value.trim();
    if (text && isChatting) {
        socket.emit('message', text);
        addMessage(text, 'you');
        messageInput.value = '';
    }
}

function createPeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);

    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            socket.emit('webrtc_ice_candidate', event.candidate);
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        const state = peerConnection?.iceConnectionState;
        if (state === 'checking') {
            setMediaState('Connecting video...');
        } else if (state === 'connected' || state === 'completed') {
            setMediaState(null);
            showStrangerLoading(false);
        } else if (state === 'failed') {
            setMediaState('Network blocked direct video route. TURN relay is required on one or both sides.');
            showStrangerLoading(false);
        } else if (state === 'disconnected') {
            setMediaState('Video connection interrupted. Reconnecting...');
        }
    };

    peerConnection.onconnectionstatechange = () => {
        const state = peerConnection?.connectionState;
        if (state === 'failed') {
            setMediaState('Video peer connection failed. Try Next, or check TURN relay settings.');
            showStrangerLoading(false);
        }
    };

    peerConnection.ontrack = event => {
        strangerVideo.srcObject = event.streams[0];
        strangerVideo.play().catch(() => {});
        showStrangerLoading(false);
        setMediaState(null);
    };

    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }
}

// Socket Events
socket.on('waiting', () => {
    isChatting = false;
    if (currentMode === 'video') {
        showStrangerLoading(true);
        setMediaState('Looking for someone you can chat with...');
    }
    addSystemMessage('Looking for someone you can chat with...');
});

socket.on('chat_started', async (data) => {
    isChatting = true;
    if (currentMode === 'video') {
        showStrangerLoading(true);
        setMediaState('Connecting video...');
    } else {
        showStrangerLoading(false);
    }
    addSystemMessage('You\'re now chatting with a random stranger. Say hi!');
    messageInput.focus();

    if (currentMode === 'video') {
        createPeerConnection();
        if (data.initiator) {
            try {
                const offer = await peerConnection.createOffer();
                await peerConnection.setLocalDescription(offer);
                socket.emit('webrtc_offer', offer);
            } catch (error) {
                console.error("Error creating offer.", error);
            }
        }
    }
});

socket.on('message', (msg) => {
    addMessage(msg, 'stranger');
});

socket.on('partner_disconnected', () => {
    queueNextMatch(true);
});

// WebRTC Signaling Events
socket.on('webrtc_offer', async (offer) => {
    if (!peerConnection) {
        createPeerConnection();
    }
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('webrtc_answer', answer);
    } catch (error) {
        console.error("Error handling offer.", error);
    }
});

socket.on('webrtc_answer', async (answer) => {
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (error) {
        console.error("Error handling answer.", error);
        setMediaState('Failed to finalize video handshake. Try Next.');
    }
});

socket.on('webrtc_ice_candidate', async (candidate) => {
    try {
        if (peerConnection) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
    } catch (error) {
        console.error("Error handling ICE candidate.", error);
    }
});
