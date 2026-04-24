import './style.css';
import { io } from "socket.io-client";

document.querySelector('#app').innerHTML = `
  <div class="app-container">
    <header class="header">
      <div class="logo-container">
        <h1>Umfigle</h1>
        <p class="tagline">Talk to strangers!</p>
      </div>
      <div class="online-count">
        <span id="online-users">10,432</span>+ online now
      </div>
    </header>

    <main class="main-content">
      <div class="intro-box" id="intro-box">
        <h2>Meet New People</h2>
        <p>Umfigle is a great place to meet new friends. When you use Umfigle, we pick someone else at random and let you talk one-on-one. Chats are completely anonymous.</p>
        <div class="start-controls">
          <p>Start chatting:</p>
          <button id="video-chat-btn" class="start-btn video-btn">Video</button>
          <button id="text-chat-btn" class="start-btn text-btn">Text</button>
        </div>
      </div>

      <div class="chat-interface hidden" id="chat-interface">
        <div class="video-container hidden" id="video-container">
            <div class="video-wrapper">
                <video id="stranger-video" autoplay playsinline></video>
                <div class="video-label stranger-label">Stranger</div>
            </div>
            <div class="video-wrapper">
                <video id="local-video" autoplay playsinline muted></video>
                <div class="video-label you-label">You</div>
            </div>
        </div>
        <div class="chat-messages" id="chat-messages">
          <!-- Messages will go here -->
        </div>
        <div class="chat-controls">
          <button id="stop-btn" class="control-btn stop-btn">Stop</button>
          <button id="next-btn" class="control-btn next-btn">Next</button>
          <input type="text" id="message-input" placeholder="Type your message..." autocomplete="off">
          <button id="send-btn" class="control-btn send-btn">Send</button>
        </div>
      </div>
    </main>
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
const sendBtn = document.getElementById('send-btn');
const chatMessages = document.getElementById('chat-messages');

const videoContainer = document.getElementById('video-container');
const localVideo = document.getElementById('local-video');
const strangerVideo = document.getElementById('stranger-video');

let isChatting = false;
let currentMode = 'text';

// WebRTC variables
let localStream = null;
let peerConnection = null;
const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
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

function addMessage(text, type) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${type}-message`;
    const contentP = document.createElement('p');
    contentP.textContent = text;
    if (type === 'you') {
        contentP.innerHTML = `<strong>You:</strong> ${text}`;
    } else if (type === 'stranger') {
        contentP.innerHTML = `<strong>Stranger:</strong> ${text}`;
    }
    msgDiv.appendChild(contentP);
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight; // Auto-scroll
}

function addSystemMessage(text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message system-message`;
    msgDiv.textContent = text;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Actions
async function startChat(mode) {
    currentMode = mode;
    introBox.classList.add('hidden');
    chatInterface.classList.remove('hidden');
    chatMessages.innerHTML = ''; // Clear previous chats
    addSystemMessage('Connecting to server...');

    if (mode === 'video') {
        videoContainer.classList.remove('hidden');
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localVideo.srcObject = localStream;
        } catch (err) {
            console.error('Error accessing media devices.', err);
            
            let errorMessage = 'Could not access camera/microphone.';
            if (err.name === 'NotAllowedError') {
                errorMessage = 'Camera access denied. Please click the camera icon in your browser URL bar and allow access.';
            } else if (err.name === 'NotFoundError') {
                errorMessage = 'No camera or microphone found on your system.';
            } else if (err.name === 'NotReadableError') {
                errorMessage = 'Your camera is already in use by another application (like Zoom or Skype).';
            } else if (err === undefined || !navigator.mediaDevices) {
                errorMessage = 'Media devices not supported. Ensure you are on HTTPS or localhost.';
            } else {
                errorMessage = `Media error: ${err.name} - ${err.message}`;
            }

            addSystemMessage(`${errorMessage} Switching to text chat.`);
            currentMode = 'text';
            videoContainer.classList.add('hidden');
        }
    } else {
        videoContainer.classList.add('hidden');
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
}

function stopChat() {
    stopVideo();
    if (isChatting) {
        socket.emit('skip');
        isChatting = false;
        addSystemMessage("You disconnected.");
    }
}

function nextChat() {
    stopChat(); // Disconnect current if any
    
    // Start searching immediately
    chatMessages.innerHTML = '';
    socket.emit('start_chat', { mode: currentMode });
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

    peerConnection.ontrack = event => {
        strangerVideo.srcObject = event.streams[0];
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
    addSystemMessage('Looking for someone you can chat with...');
});

socket.on('chat_started', async (data) => {
    isChatting = true;
    addSystemMessage('You\'re now chatting with a random stranger. Say hi!');
    messageInput.focus();

    if (currentMode === 'video') {
        createPeerConnection();
        // If this client is the initiator, create the offer
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
    isChatting = false;
    stopVideo();
    addSystemMessage('Stranger has disconnected.');
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
