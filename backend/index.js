import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

app.get('/', (_req, res) => {
    res.status(200).json({ status: 'ok' });
});

app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

let waitingUser = null;
const connectedUsers = new Map();

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    connectedUsers.set(socket.id, { socket: socket, partnerId: null });

    socket.on('start_chat', (data) => {
        const mode = data?.mode || 'text';
        // In a real app we might have separate queues for video and text
        if (waitingUser && waitingUser !== socket.id && connectedUsers.has(waitingUser)) {
            // Match found!
            const partnerId = waitingUser;
            waitingUser = null;

            connectedUsers.get(socket.id).partnerId = partnerId;
            connectedUsers.get(partnerId).partnerId = socket.id;

            // One user must be the initiator of the WebRTC connection
            socket.emit('chat_started', { initiator: false });
            connectedUsers.get(partnerId).socket.emit('chat_started', { initiator: true });
            
            console.log(`Matched ${socket.id} with ${partnerId} (Mode: ${mode})`);
        } else {
            // Wait for a match
            waitingUser = socket.id;
            socket.emit('waiting');
            console.log(`User ${socket.id} is waiting`);
        }
    });

    socket.on('message', (msg) => {
        const user = connectedUsers.get(socket.id);
        if (user && user.partnerId && connectedUsers.has(user.partnerId)) {
            connectedUsers.get(user.partnerId).socket.emit('message', msg);
        }
    });

    // WebRTC Signaling
    socket.on('webrtc_offer', (offer) => {
        const user = connectedUsers.get(socket.id);
        if (user && user.partnerId && connectedUsers.has(user.partnerId)) {
            connectedUsers.get(user.partnerId).socket.emit('webrtc_offer', offer);
        }
    });

    socket.on('webrtc_answer', (answer) => {
        const user = connectedUsers.get(socket.id);
        if (user && user.partnerId && connectedUsers.has(user.partnerId)) {
            connectedUsers.get(user.partnerId).socket.emit('webrtc_answer', answer);
        }
    });

    socket.on('webrtc_ice_candidate', (candidate) => {
        const user = connectedUsers.get(socket.id);
        if (user && user.partnerId && connectedUsers.has(user.partnerId)) {
            connectedUsers.get(user.partnerId).socket.emit('webrtc_ice_candidate', candidate);
        }
    });

    socket.on('skip', () => {
        disconnectPartner(socket.id);
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        disconnectPartner(socket.id);
        connectedUsers.delete(socket.id);
        if (waitingUser === socket.id) {
            waitingUser = null;
        }
    });

    function disconnectPartner(socketId) {
        const user = connectedUsers.get(socketId);
        if (user && user.partnerId) {
            const partnerId = user.partnerId;
            user.partnerId = null;
            
            if (connectedUsers.has(partnerId)) {
                const partner = connectedUsers.get(partnerId);
                partner.partnerId = null;
                partner.socket.emit('partner_disconnected');
            }
        }
    }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
