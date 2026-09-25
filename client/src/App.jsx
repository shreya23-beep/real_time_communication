import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const SERVER_URL = 'http://localhost:5000';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

function RemoteVideo({ stream, name }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="mini-video-card">
      <span className="mini-participant-tag">{name} ✨</span>
      <video ref={videoRef} autoPlay playsInline className="natural-stream" />
    </div>
  );
}

function App() {
  const [roomId, setRoomId] = useState('chill-lounge');
  const [username, setUsername] = useState('');
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState('Ready to connect');

  // Direct Calling & Decline State
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteeName, setInviteeName] = useState('');
  const [incomingCall, setIncomingCall] = useState(null);
  const [feedbackNotice, setFeedbackNotice] = useState('');

  // Chat State
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');

  // Starts with Camera OFF by default
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);

  // Peer & Media State
  const [peers, setPeers] = useState([]);
  const socketRef = useRef(null);
  const peersRef = useRef({});
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const chatBottomRef = useRef(null);

  // Bind local camera preview
  useEffect(() => {
    if (joined && localVideoRef.current && localStreamRef.current && !isScreenSharing) {
      localVideoRef.current.srcObject = localStreamRef.current;
      localVideoRef.current.play().catch((e) => console.warn('Local play error:', e));
    }
  }, [joined, isScreenSharing]);

  useEffect(() => {
    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on('connect', () => {
      setStatus(`Online • ID: ${socket.id.slice(0, 5)}`);
    });

    socket.on('connect_error', (err) => {
      setStatus(`Offline • ${err.message}`);
    });

    socket.on('receive-message', (incomingMsg) => {
      setMessages((prev) => [...prev, incomingMsg]);
    });

    // Incoming Call Invite
    socket.on('incoming-call-invite', ({ callerSocketId, fromUser, roomId: callRoom }) => {
      setIncomingCall({ callerSocketId, fromUser, roomId: callRoom });
    });

    // Call Declined Handler
    socket.on('call-declined', ({ declinerName }) => {
      setFeedbackNotice(`🚫 ${declinerName || 'Friend'} declined the call.`);
      setTimeout(() => setFeedbackNotice(''), 4500);
    });

    socket.on('invite-status', ({ success, message }) => {
      setFeedbackNotice(message);
      setTimeout(() => setFeedbackNotice(''), 4000);
      if (success) setShowInviteModal(false);
    });

    socket.on('all-users', async (users) => {
      for (const user of users) {
        const pc = createPeerConnection(user.socketId, user.username);
        peersRef.current[user.socketId] = { pc, name: user.username };

        const currentStream = screenStreamRef.current || localStreamRef.current;
        if (currentStream) {
          currentStream.getTracks().forEach((track) => {
            pc.addTrack(track, currentStream);
          });
        }

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        socket.emit('signal', {
          targetSocketId: user.socketId,
          signalData: { type: 'offer', sdp: offer },
        });
      }
    });

    socket.on('user-joined', ({ username: peerName }) => {
      setStatus(`${peerName} joined the lounge 🌸`);
    });

    socket.on('signal', async ({ senderSocketId, senderUsername, signalData }) => {
      let peerObj = peersRef.current[senderSocketId];

      if (!peerObj) {
        const pc = createPeerConnection(senderSocketId, senderUsername);
        peerObj = { pc, name: senderUsername };
        peersRef.current[senderSocketId] = peerObj;

        const currentStream = screenStreamRef.current || localStreamRef.current;
        if (currentStream) {
          currentStream.getTracks().forEach((track) => {
            pc.addTrack(track, currentStream);
          });
        }
      }

      const pc = peerObj.pc;

      if (signalData.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signalData.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit('signal', {
          targetSocketId: senderSocketId,
          signalData: { type: 'answer', sdp: answer },
        });
      } else if (signalData.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signalData.sdp));
      } else if (signalData.type === 'candidate') {
        await pc.addIceCandidate(new RTCIceCandidate(signalData.candidate));
      }
    });

    socket.on('user-left', ({ socketId }) => {
      if (peersRef.current[socketId]) {
        peersRef.current[socketId].pc.close();
        delete peersRef.current[socketId];
      }
      setPeers((prev) => prev.filter((p) => p.peerId !== socketId));
      setStatus('A participant left');
    });

    return () => socket.disconnect();
  }, []);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const createPeerConnection = (targetSocketId, targetName) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit('signal', {
          targetSocketId,
          signalData: { type: 'candidate', candidate: event.candidate },
        });
      }
    };

    pc.ontrack = (event) => {
      const incomingStream = event.streams[0];
      setPeers((prev) => {
        const existing = prev.find((p) => p.peerId === targetSocketId);
        if (existing) {
          return prev.map((p) =>
            p.peerId === targetSocketId ? { ...p, stream: incomingStream } : p
          );
        }
        return [...prev, { peerId: targetSocketId, name: targetName, stream: incomingStream }];
      });
    };

    return pc;
  };

  // Initialize media with video track turned off
  const initMediaWithCameraOff = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: true,
      });

      // Disable camera track right away
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = false;
      }

      localStreamRef.current = stream;
      setIsVideoEnabled(false);
    } catch (err) {
      console.warn('Media access error:', err);
    }
  };

  const handleJoin = async () => {
    if (!username.trim() || !roomId.trim()) {
      alert('Please enter your name and a room ID');
      return;
    }

    await initMediaWithCameraOff();
    socketRef.current.emit('register-user', username);
    socketRef.current.emit('join-room', { roomId, username });
    setJoined(true);
  };

  const handleSendDirectInvite = (e) => {
    e.preventDefault();
    if (!inviteeName.trim()) return;

    socketRef.current.emit('direct-invite', {
      targetUsername: inviteeName.trim(),
      fromUser: username,
      roomId,
    });
    setInviteeName('');
  };

  const handleAcceptIncomingCall = async () => {
    const targetRoom = incomingCall.roomId;
    setRoomId(targetRoom);
    setIncomingCall(null);

    if (!localStreamRef.current) {
      await initMediaWithCameraOff();
    }
    socketRef.current.emit('join-room', { roomId: targetRoom, username });
    setJoined(true);
  };

  const handleDeclineIncomingCall = () => {
    if (incomingCall) {
      socketRef.current.emit('decline-call', {
        callerSocketId: incomingCall.callerSocketId,
        declinerName: username || 'Friend',
      });
      setIncomingCall(null);
    }
  };

  // Toggle Camera On/Off
  const handleToggleCamera = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoEnabled(videoTrack.enabled);
      }
    }
  };

  // Toggle Mic On/Off
  const handleToggleMic = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioEnabled(audioTrack.enabled);
      }
    }
  };

  const handleToggleScreenShare = async () => {
    if (!isScreenSharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = screenStream;
        const screenTrack = screenStream.getVideoTracks()[0];

        Object.values(peersRef.current).forEach(({ pc }) => {
          const videoSender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
          if (videoSender) videoSender.replaceTrack(screenTrack);
        });

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
          localVideoRef.current.play().catch((e) => console.warn('Screen play error:', e));
        }

        screenTrack.onended = () => stopScreenShare();
        setIsScreenSharing(true);
      } catch (err) {
        console.error('Screen sharing error:', err);
      }
    } else {
      stopScreenShare();
    }
  };

  const stopScreenShare = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
    }

    const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
    Object.values(peersRef.current).forEach(({ pc }) => {
      const videoSender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (videoSender && cameraTrack) {
        videoSender.replaceTrack(cameraTrack);
      }
    });

    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
      localVideoRef.current.play().catch((e) => console.warn('Camera revert error:', e));
    }

    setIsScreenSharing(false);
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const message = {
      id: Date.now(),
      sender: username,
      type: 'text',
      content: inputText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    socketRef.current.emit('send-message', { roomId, message });
    setMessages((prev) => [...prev, message]);
    setInputText('');
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    if (!isImage && !isVideo) {
      alert('Please upload an image or video file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const message = {
        id: Date.now(),
        sender: username,
        type: isImage ? 'image' : 'video',
        content: reader.result,
        fileName: file.name,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      socketRef.current.emit('send-message', { roomId, message });
      setMessages((prev) => [...prev, message]);
    };
    reader.readAsDataURL(file);
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap');
        
        * { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          font-family: 'Outfit', sans-serif;
          min-height: 100vh;
          overflow: hidden;
          background: #ffffff;
          color: #4a3b5c;
        }

        .floral-backdrop {
          position: fixed;
          inset: 0;
          background: 
            radial-gradient(circle at 10% 20%, rgba(254, 226, 226, 0.7) 0%, transparent 40%),
            radial-gradient(circle at 90% 80%, rgba(252, 231, 243, 0.8) 0%, transparent 50%),
            radial-gradient(circle at 50% 50%, rgba(243, 232, 255, 0.6) 0%, transparent 60%),
            url('https://images.unsplash.com/photo-1522383225653-ed111181a951?auto=format&fit=crop&w=1920&q=80') center/cover no-repeat;
          opacity: 0.35;
          z-index: 0;
          pointer-events: none;
        }

        .aesthetic-container {
          display: flex;
          flex-direction: column;
          height: 100vh;
          position: relative;
          z-index: 1;
        }

        .aesthetic-nav {
          background: rgba(255, 255, 255, 0.88);
          backdrop-filter: blur(20px);
          border-bottom: 1.5px solid rgba(244, 114, 182, 0.2);
          padding: 12px 28px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          box-shadow: 0 4px 20px rgba(244, 114, 182, 0.08);
        }

        .logo-title {
          font-size: 1.35rem;
          font-weight: 700;
          background: linear-gradient(135deg, #ec4899 0%, #a855f7 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .aesthetic-badge {
          background: rgba(236, 72, 153, 0.1);
          border: 1.5px solid rgba(236, 72, 153, 0.35);
          color: #db2777;
          padding: 5px 14px;
          border-radius: 9999px;
          font-size: 0.8rem;
          font-weight: 600;
        }

        .incoming-call-toast {
          position: fixed;
          top: 20px;
          left: 50%;
          transform: translateX(-50%);
          background: #ffffff;
          border: 2px solid #f472b6;
          box-shadow: 0 10px 30px rgba(244, 114, 182, 0.35);
          padding: 14px 24px;
          border-radius: 20px;
          z-index: 999;
          display: flex;
          align-items: center;
          gap: 16px;
          animation: slideDown 0.3s ease;
        }

        @keyframes slideDown {
          from { top: -60px; opacity: 0; }
          to { top: 20px; opacity: 1; }
        }

        .call-toast-text {
          font-size: 0.95rem;
          font-weight: 600;
          color: #4a3b5c;
        }

        .accept-btn {
          background: #10b981;
          color: #fff;
          border: none;
          padding: 8px 16px;
          border-radius: 12px;
          font-weight: 700;
          cursor: pointer;
        }

        .decline-btn {
          background: #ef4444;
          color: #fff;
          border: none;
          padding: 8px 16px;
          border-radius: 12px;
          font-weight: 700;
          cursor: pointer;
        }

        .feedback-banner {
          position: fixed;
          bottom: 24px;
          right: 24px;
          background: #2b1f3d;
          color: #fbcfe8;
          padding: 12px 20px;
          border-radius: 14px;
          font-size: 0.88rem;
          font-weight: 600;
          box-shadow: 0 8px 24px rgba(0,0,0,0.3);
          z-index: 999;
          border: 1px solid rgba(244, 114, 182, 0.3);
        }

        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(43, 31, 61, 0.45);
          backdrop-filter: blur(5px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 998;
        }

        .modal-card {
          background: #ffffff;
          padding: 28px;
          border-radius: 24px;
          width: 340px;
          box-shadow: 0 20px 40px rgba(244, 114, 182, 0.25);
          display: flex;
          flex-direction: column;
          gap: 14px;
          text-align: center;
        }

        .modal-card h4 {
          color: #db2777;
          font-size: 1.25rem;
          font-weight: 700;
        }

        .modal-card input {
          padding: 12px 16px;
          background: #faf5ff;
          border: 1.5px solid #f3e8ff;
          border-radius: 14px;
          outline: none;
          font-size: 0.95rem;
        }

        .modal-actions {
          display: flex;
          gap: 10px;
        }

        .ring-btn {
          flex: 1;
          background: linear-gradient(135deg, #f472b6 0%, #c084fc 100%);
          color: #fff;
          border: none;
          padding: 11px;
          border-radius: 12px;
          font-weight: 700;
          cursor: pointer;
        }

        .cancel-btn {
          background: #e2e8f0;
          color: #475569;
          border: none;
          padding: 11px 16px;
          border-radius: 12px;
          font-weight: 600;
          cursor: pointer;
        }

        .join-wrapper {
          margin: auto;
          background: rgba(255, 255, 255, 0.92);
          backdrop-filter: blur(25px);
          border: 2px solid rgba(255, 255, 255, 0.95);
          padding: 36px 32px;
          border-radius: 28px;
          box-shadow: 0 20px 45px rgba(236, 72, 153, 0.15);
          display: flex;
          flex-direction: column;
          gap: 18px;
          width: 380px;
          text-align: center;
        }

        .friends-header-photo {
          width: 100%;
          height: 130px;
          border-radius: 18px;
          object-fit: cover;
        }

        .aesthetic-input {
          padding: 12px 18px;
          background: #faf5ff;
          border: 1.5px solid #f3e8ff;
          border-radius: 14px;
          color: #4a3b5c;
          font-size: 0.95rem;
          outline: none;
        }

        .aesthetic-btn {
          padding: 12px;
          background: linear-gradient(135deg, #f472b6 0%, #c084fc 100%);
          color: #ffffff;
          border: none;
          border-radius: 14px;
          cursor: pointer;
          font-weight: 700;
          font-size: 0.95rem;
          box-shadow: 0 6px 18px rgba(244, 114, 182, 0.35);
        }

        .workspace-grid {
          display: flex;
          flex: 1;
          height: calc(100vh - 68px);
          padding: 14px 20px;
          gap: 16px;
        }

        .chat-column {
          flex: 1.1;
          background: rgba(255, 255, 255, 0.88);
          backdrop-filter: blur(20px);
          border: 2px solid rgba(255, 255, 255, 0.9);
          border-radius: 24px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: 0 12px 30px rgba(244, 114, 182, 0.1);
        }

        .chat-top-header {
          background: rgba(253, 242, 248, 0.7);
          padding: 12px 20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1.5px solid rgba(244, 114, 182, 0.18);
        }

        .chat-top-header h4 {
          font-size: 1rem;
          color: #db2777;
          font-weight: 700;
        }

        .chat-feed {
          flex: 1;
          overflow-y: auto;
          padding: 18px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .chat-bubble {
          max-width: 72%;
          padding: 10px 16px;
          border-radius: 18px;
          display: flex;
          flex-direction: column;
          font-size: 0.92rem;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
        }

        .mine {
          align-self: flex-end;
          background: linear-gradient(135deg, #f472b6 0%, #ec4899 100%);
          color: #ffffff;
          border-bottom-right-radius: 4px;
        }

        .theirs {
          align-self: flex-start;
          background: #ffffff;
          border: 1.5px solid #fae8ff;
          color: #372844;
          border-bottom-left-radius: 4px;
        }

        .msg-author {
          font-size: 0.72rem;
          font-weight: 700;
          color: #fbcfe8;
          margin-bottom: 3px;
        }
        .theirs .msg-author { color: #a855f7; }

        .msg-time {
          font-size: 0.65rem;
          opacity: 0.75;
          align-self: flex-end;
          margin-top: 4px;
        }

        .media-attachment {
          max-width: 230px;
          border-radius: 12px;
          margin: 6px 0;
        }

        .chat-composer {
          display: flex;
          align-items: center;
          gap: 10px;
          background: #ffffff;
          padding: 12px 18px;
          border-top: 1.5px solid rgba(244, 114, 182, 0.15);
        }

        .chat-composer input[type="text"] {
          flex: 1;
          padding: 11px 16px;
          background: #faf5ff;
          border: 1.5px solid #f3e8ff;
          border-radius: 16px;
          color: #4a3b5c;
          outline: none;
        }

        .attach-btn {
          font-size: 1.3rem;
          cursor: pointer;
        }

        .send-pill-btn {
          background: linear-gradient(135deg, #f472b6 0%, #c084fc 100%);
          color: #fff;
          border: none;
          padding: 10px 20px;
          border-radius: 14px;
          font-weight: 700;
          cursor: pointer;
        }

        .video-column {
          flex: 1.25;
          display: flex;
          flex-direction: column;
          background: rgba(255, 255, 255, 0.88);
          backdrop-filter: blur(20px);
          border: 2px solid rgba(255, 255, 255, 0.9);
          border-radius: 24px;
          padding: 16px;
          box-shadow: 0 12px 30px rgba(244, 114, 182, 0.1);
        }

        .video-action-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
          flex-wrap: wrap;
          gap: 8px;
        }

        .add-user-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          background: #ecfdf5;
          color: #059669;
          border: 1.5px solid #a7f3d0;
          padding: 8px 14px;
          border-radius: 14px;
          font-size: 0.82rem;
          font-weight: 700;
          cursor: pointer;
        }

        .call-controls-group {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .ctrl-btn {
          padding: 8px 14px;
          border: none;
          border-radius: 12px;
          font-weight: 700;
          font-size: 0.82rem;
          cursor: pointer;
          color: #fff;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .cam-btn { background: #ea580c; }
        .cam-btn.on { background: #6366f1; }
        .mic-btn { background: #0ea5e9; }
        .mic-btn.off { background: #dc2626; }
        .screen-btn { background: linear-gradient(135deg, #38bdf8 0%, #818cf8 100%); }
        .screen-btn.active { background: linear-gradient(135deg, #f43f5e 0%, #fb7185 100%); }

        .multi-video-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
          gap: 12px;
          flex: 1;
          align-content: start;
          overflow-y: auto;
        }

        .mini-video-card {
          position: relative;
          background: #2b1f3d;
          border-radius: 16px;
          overflow: hidden;
          height: 180px;
          border: 1.5px solid rgba(244, 114, 182, 0.25);
          box-shadow: 0 4px 14px rgba(244, 114, 182, 0.1);
        }

        .mini-video-card video {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        video.mirror-stream {
          transform: scaleX(-1) !important;
        }

        video.natural-stream {
          transform: none !important;
        }

        .cam-off-overlay {
          position: absolute;
          inset: 0;
          background: #231834;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          color: #fbcfe8;
          z-index: 5;
        }

        .cam-off-avatar {
          width: 54px;
          height: 54px;
          border-radius: 50%;
          background: linear-gradient(135deg, #f472b6 0%, #a855f7 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.4rem;
          font-weight: 700;
          color: #fff;
          box-shadow: 0 4px 14px rgba(244, 114, 182, 0.4);
        }

        .mini-participant-tag {
          position: absolute;
          top: 8px;
          left: 8px;
          background: rgba(255, 255, 255, 0.9);
          backdrop-filter: blur(6px);
          border: 1px solid rgba(244, 114, 182, 0.3);
          padding: 4px 10px;
          border-radius: 10px;
          font-size: 0.75rem;
          font-weight: 700;
          color: #db2777;
          z-index: 10;
        }

        .empty-friends-card {
          grid-column: 1 / -1;
          background: rgba(255, 255, 255, 0.6);
          border: 2px dashed rgba(244, 114, 182, 0.35);
          border-radius: 16px;
          padding: 24px;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          color: #8b7999;
          font-size: 0.88rem;
        }
      `}</style>

      <div className="floral-backdrop" />

      {incomingCall && (
        <div className="incoming-call-toast">
          <span className="call-toast-text">
            📞 <b>{incomingCall.fromUser}</b> is calling you to room <b>"{incomingCall.roomId}"</b>!
          </span>
          <button className="accept-btn" onClick={handleAcceptIncomingCall}>
            Accept 🌺
          </button>
          <button className="decline-btn" onClick={handleDeclineIncomingCall}>
            Decline ❌
          </button>
        </div>
      )}

      {showInviteModal && (
        <div className="modal-overlay" onClick={() => setShowInviteModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h4>📞 Ring a Friend</h4>
            <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
              Enter their username to call them into <b>#{roomId}</b>.
            </p>
            <form onSubmit={handleSendDirectInvite} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <input
                type="text"
                placeholder="Friend's username (e.g. Anya)"
                value={inviteeName}
                onChange={(e) => setInviteeName(e.target.value)}
                autoFocus
              />
              <div className="modal-actions">
                <button type="submit" className="ring-btn">
                  Ring Now 🌸
                </button>
                <button type="button" className="cancel-btn" onClick={() => setShowInviteModal(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {feedbackNotice && <div className="feedback-banner">{feedbackNotice}</div>}

      <div className="aesthetic-container">
        <header className="aesthetic-nav">
          <h2 className="logo-title">🌸 ConnectHub • Friends Space</h2>
          <div className="nav-actions">
            <span className="aesthetic-badge">{status}</span>
          </div>
        </header>

        {!joined ? (
          <div className="join-wrapper">
            <img
              src="https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=800&q=80"
              alt="Friends Moments"
              className="friends-header-photo"
            />
            <h3>Join Friends Lounge</h3>
            <p>🌸 Text chat, share media, multi-user video calling & screen share</p>
            <input
              type="text"
              className="aesthetic-input"
              placeholder="Your Name (e.g. Shreya)"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <input
              type="text"
              className="aesthetic-input"
              placeholder="Room Name (e.g. chill-lounge)"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            />
            <button className="aesthetic-btn" onClick={handleJoin}>
              Enter Space 🌺
            </button>
          </div>
        ) : (
          <div className="workspace-grid">
            {/* Left Chat Column */}
            <div className="chat-column">
              <div className="chat-top-header">
                <h4>💬 #{roomId}</h4>
                <span style={{ fontSize: '0.85rem', color: '#a855f7', fontWeight: 600 }}>
                  Logged in as: <b>{username}</b>
                </span>
              </div>

              <div className="chat-feed">
                {messages.map((m) => {
                  const isMine = m.sender === username;
                  return (
                    <div
                      key={m.id}
                      className={`chat-bubble ${isMine ? 'mine' : 'theirs'}`}
                    >
                      <span className="msg-author">{m.sender}</span>
                      {m.type === 'text' && <p>{m.content}</p>}
                      {m.type === 'image' && (
                        <img src={m.content} alt={m.fileName} className="media-attachment" />
                      )}
                      {m.type === 'video' && (
                        <video src={m.content} controls className="media-attachment" />
                      )}
                      <span className="msg-time">{m.timestamp}</span>
                    </div>
                  );
                })}
                <div ref={chatBottomRef} />
              </div>

              <form onSubmit={handleSendMessage} className="chat-composer">
                <label className="attach-btn" title="Send picture or video">
                  📎
                  <input
                    type="file"
                    accept="image/*,video/*"
                    onChange={handleFileUpload}
                    style={{ display: 'none' }}
                  />
                </label>
                <input
                  type="text"
                  placeholder="Share a thought with the group..."
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                />
                <button type="submit" className="send-pill-btn">
                  Send 🌸
                </button>
              </form>
            </div>

            {/* Right Multi-User Video Column */}
            <div className="video-column">
              <div className="video-action-bar">
                <button className="add-user-btn" onClick={() => setShowInviteModal(true)}>
                  📞 Add to Call
                </button>

                <div className="call-controls-group">
                  {/* Camera Toggle Button */}
                  <button
                    className={`ctrl-btn cam-btn ${isVideoEnabled ? 'on' : ''}`}
                    onClick={handleToggleCamera}
                    title={isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}
                  >
                    {isVideoEnabled ? '📹 Camera On' : '🚫 Cam Off'}
                  </button>

                  <button
                    className={`ctrl-btn mic-btn ${!isAudioEnabled ? 'off' : ''}`}
                    onClick={handleToggleMic}
                    title={isAudioEnabled ? 'Mute microphone' : 'Unmute microphone'}
                  >
                    {isAudioEnabled ? '🎙️ Mic On' : '🔇 Muted'}
                  </button>

                  <button
                    className={`ctrl-btn screen-btn ${isScreenSharing ? 'active' : ''}`}
                    onClick={handleToggleScreenShare}
                  >
                    {isScreenSharing ? '🛑 Stop Share' : '🖥️ Screen Share'}
                  </button>
                </div>
              </div>

              <div className="multi-video-grid">
                <div className="mini-video-card">
                  <span className="mini-participant-tag">
                    {isScreenSharing ? '🖥️ Your Shared Screen' : `You (${username}) 🌸`}
                  </span>

                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className={isScreenSharing ? 'natural-stream' : 'mirror-stream'}
                    style={{ display: isVideoEnabled || isScreenSharing ? 'block' : 'none' }}
                  />

                  {!isVideoEnabled && !isScreenSharing && (
                    <div className="cam-off-overlay">
                      <div className="cam-off-avatar">{username.slice(0, 1).toUpperCase()}</div>
                      <span style={{ fontSize: '0.8rem', opacity: 0.85 }}>Camera Paused</span>
                    </div>
                  )}
                </div>

                {peers.map((peer) => (
                  <RemoteVideo key={peer.peerId} stream={peer.stream} name={peer.name} />
                ))}

                {peers.length === 0 && (
                  <div className="empty-friends-card">
                    <p>✨ <b>No friends here yet!</b></p>
                    <p>Click <b>"Add to Call"</b> to ring any friend by name</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default App;