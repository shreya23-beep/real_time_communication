import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  maxHttpBufferSize: 1e8,
});

const PORT = process.env.PORT || 5000;

// Track all online users: { [socketId]: { username, currentRoom } }
const onlineUsers = {};

io.on('connection', (socket) => {
  // 1. User registers/connects
  socket.on('register-user', (username) => {
    socket.data.username = username;
    onlineUsers[socket.id] = { username, currentRoom: null };
    io.emit('online-users-list', Object.entries(onlineUsers).map(([id, u]) => ({ socketId: id, username: u.username })));
  });

  // 2. Join a room
  socket.on('join-room', ({ roomId, username }) => {
    socket.join(roomId);
    socket.data.username = username || 'Friend';
    socket.data.roomId = roomId;

    if (onlineUsers[socket.id]) {
      onlineUsers[socket.id].currentRoom = roomId;
    }

    const clients = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
    const existingInRoom = clients
      .filter((id) => id !== socket.id)
      .map((id) => ({
        socketId: id,
        username: onlineUsers[id]?.username || 'Friend',
      }));

    socket.emit('all-users', existingInRoom);

    socket.to(roomId).emit('user-joined', {
      socketId: socket.id,
      username: socket.data.username,
    });
  });

  // 3. Direct Friend Invite / Ring
  socket.on('direct-invite', ({ targetUsername, fromUser, roomId }) => {
    const targetEntry = Object.entries(onlineUsers).find(
      ([id, u]) => u.username.toLowerCase() === targetUsername.toLowerCase().trim() && id !== socket.id
    );

    if (targetEntry) {
      const [targetSocketId] = targetEntry;
      io.to(targetSocketId).emit('incoming-call-invite', {
        callerSocketId: socket.id,
        fromUser,
        roomId,
      });
      socket.emit('invite-status', { success: true, message: `Calling ${targetUsername}... 🌸` });
    } else {
      socket.emit('invite-status', { success: false, message: `User "${targetUsername}" is not online right now.` });
    }
  });

  // 4. Decline Call Relay
  socket.on('decline-call', ({ callerSocketId, declinerName }) => {
    if (callerSocketId) {
      io.to(callerSocketId).emit('call-declined', {
        declinerName,
      });
    }
  });

  // 5. Chat messages
  socket.on('send-message', ({ roomId, message }) => {
    socket.to(roomId).emit('receive-message', message);
  });

  // 6. WebRTC Signaling Handshake
  socket.on('signal', ({ targetSocketId, signalData }) => {
    io.to(targetSocketId).emit('signal', {
      senderSocketId: socket.id,
      senderUsername: socket.data.username,
      signalData,
    });
  });

  // 7. Disconnect
  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId) {
      socket.to(roomId).emit('user-left', { socketId: socket.id });
    }
    delete onlineUsers[socket.id];
    io.emit('online-users-list', Object.entries(onlineUsers).map(([id, u]) => ({ socketId: id, username: u.username })));
  });
});

server.listen(PORT, () => {
  console.log(`ConnectHub Multi-user signaling server running on http://localhost:${PORT}`);
});