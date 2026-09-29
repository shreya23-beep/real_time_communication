# Real-Time Communication App

A full-stack real-time communication application featuring live chat, room/channel messaging, and presence updates. Built with a React + Vite frontend and a Node.js + Socket.IO backend.

---

## Features

- **Real-Time Messaging**: Instant message delivery using WebSockets via Socket.IO.
- **Rooms & Channels**: Join, leave, and switch between communication rooms.
- **Responsive UI**: Clean interface built with modern React components and standard styling[cite: 2].
- **Fast Build Tooling**: Frontend powered by Vite for rapid development and bundling[cite: 2].

--What it does:

• Live Video & Audio: Multi-user video conferencing with controls for camera, mic, and screen sharing.

• Real-Time Group Chat: Instant messaging with dedicated lounges and member activity updates.

• Built-in Collaboration: Screen sharing and interactive tools for effortless teamwork.

• File & Media Sharing: Direct in-session document and file exchange.-

## Tech Stack

### Frontend (`client/`)
- [React](https://react.dev/)[cite: 2]
- [Vite](https://vitejs.dev/)[cite: 2]
- [Socket.IO Client](https://socket.io/docs/v4/client-api/)[cite: 2]
- CSS3[cite: 2]

### Backend (`server/`)
- [Node.js](https://nodejs.org/)[cite: 2]
- [Express](https://expressjs.com/)[cite: 2]
- [Socket.IO](https://socket.io/)[cite: 2]
- [CORS](https://www.npmjs.com/package/cors)[cite: 2]

---

## Project Structure

```text
real_time_communication-main/
├── client/                     # Frontend client application
│   ├── public/                 # Static assets (favicons, SVG sprites)
│   ├── src/
│   │   ├── assets/             # Images and logos
│   │   ├── App.css             # Main component styles
│   │   ├── App.jsx             # Chat interface and connection logic
│   │   ├── index.css           # Global CSS
│   │   └── main.jsx            # React root mount
│   ├── index.html              # HTML entry template
│   ├── package.json            # Client dependencies and scripts
│   └── vite.config.js          # Vite build configuration
├── server/                     # Backend WebSocket service
│   ├── server.js               # Express & Socket.IO server entry point
│   └── package.json            # Server dependencies and scripts
└── README.md
