// ---------- Estado global ----------
let currentUser = null;
let socket = null;
let localStream = null;
let cameraTrack = null;
let screenStream = null;
let roomId = null;
let micOn = true;
let camOn = true;
let sharingScreen = false;
const peers = {}; // socketId -> RTCPeerConnection

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// ---------- Helpers de pantallas ----------
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function renderUserBadge() {
  const el = document.getElementById('user-badge');
  if (!currentUser) { el.innerHTML = ''; return; }
  el.innerHTML = `<span>${escapeHtml(currentUser.username)}</span>`;
  const btn = document.createElement('button');
  btn.className = 'secondary';
  btn.textContent = 'Cerrar sesión';
  btn.onclick = logout;
  el.appendChild(btn);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Auth ----------
let authMode = 'login'; // 'login' | 'register'

function setupAuthSwitch() {
  document.getElementById('auth-switch-text').onclick = (e) => {
    if (e.target.tagName !== 'A') return;
    authMode = authMode === 'login' ? 'register' : 'login';
    document.getElementById('auth-title').textContent = authMode === 'login' ? 'Iniciar sesión' : 'Crear cuenta';
    document.getElementById('auth-submit').textContent = authMode === 'login' ? 'Entrar' : 'Registrarme';
    document.getElementById('auth-switch-text').innerHTML = authMode === 'login'
      ? '¿No tenés cuenta? <a>Registrate</a>'
      : '¿Ya tenés cuenta? <a>Iniciá sesión</a>';
    document.getElementById('auth-error').textContent = '';
  };
}
setupAuthSwitch();

document.getElementById('auth-submit').onclick = async () => {
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  const errorEl = document.getElementById('auth-error');
  errorEl.textContent = '';

  if (!username || !password) {
    errorEl.textContent = 'Completá usuario y contraseña';
    return;
  }

  try {
    const res = await fetch(`/api/${authMode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'Error inesperado';
      return;
    }
    currentUser = data.user;
    onAuthenticated();
  } catch (err) {
    errorEl.textContent = 'No se pudo conectar con el servidor';
  }
};

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  currentUser = null;
  location.href = '/';
}

async function checkSession() {
  try {
    const res = await fetch('/api/me');
    const data = await res.json();
    if (data.user) {
      currentUser = data.user;
      onAuthenticated();
    } else {
      showScreen('auth-screen');
    }
  } catch {
    showScreen('auth-screen');
  }
}

function onAuthenticated() {
  renderUserBadge();
  connectSocket();

  // Si la URL trae ?room=XXXX (link de invitacion), entramos directo
  const params = new URLSearchParams(location.search);
  const invitedRoom = params.get('room');
  if (invitedRoom) {
    joinCall(invitedRoom);
  } else {
    showScreen('home-screen');
  }
}

function connectSocket() {
  if (socket) return;
  socket = io();
  setupSocketHandlers();
}

checkSession();

// ---------- Home: crear / unirse a sala ----------
document.getElementById('create-room-btn').onclick = () => {
  const id = crypto.randomUUID().slice(0, 8);
  const link = `${location.origin}/?room=${id}`;
  document.getElementById('invite-link').value = link;
  document.getElementById('invite-box').style.display = 'flex';
  history.replaceState(null, '', `/?room=${id}`);
  setTimeout(() => joinCall(id), 300);
};

document.getElementById('copy-invite-btn').onclick = () => {
  const input = document.getElementById('invite-link');
  input.select();
  navigator.clipboard.writeText(input.value);
  const btn = document.getElementById('copy-invite-btn');
  btn.textContent = '¡Copiado!';
  setTimeout(() => (btn.textContent = 'Copiar'), 1500);
};

document.getElementById('join-room-btn').onclick = () => {
  const id = document.getElementById('join-room-input').value.trim();
  if (!id) return alert('Poné un código de sala');
  history.replaceState(null, '', `/?room=${id}`);
  joinCall(id);
};

// ---------- Entrar a la llamada ----------
async function joinCall(id) {
  roomId = id;

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (err) {
    alert('No se pudo acceder a la cámara/micrófono: ' + err.message +
      '\n\nRevisá que ninguna otra app la esté usando y que el sitio tenga permiso (icono de candado en la barra de direcciones).');
    return;
  }
  cameraTrack = localStream.getVideoTracks()[0];

  addVideoTile('local', localStream, 'Vos', true);

  showScreen('call-screen');
  document.getElementById('room-badge').textContent = 'Sala: ' + roomId;
  resizeWhiteboardCanvas();

  socket.emit('join-room', roomId);
}

document.getElementById('leave-btn').onclick = () => {
  location.href = '/';
};

// ---------- Video tiles ----------
function addVideoTile(id, stream, label, isLocal) {
  removeVideoTile(id);
  const wrap = document.createElement('div');
  wrap.className = 'video-wrap';
  wrap.id = 'tile-' + id;

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  if (isLocal) video.muted = true;
  video.srcObject = stream;

  const tag = document.createElement('div');
  tag.className = 'video-label';
  tag.textContent = label;

  wrap.appendChild(video);
  wrap.appendChild(tag);
  document.getElementById('videos').appendChild(wrap);
}

function removeVideoTile(id) {
  const el = document.getElementById('tile-' + id);
  if (el) el.remove();
}

// ---------- WebRTC ----------
function createPeerConnection(remoteId, remoteUsername) {
  const pc = new RTCPeerConnection(ICE_SERVERS);

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('signal', { to: remoteId, data: { type: 'ice', candidate: event.candidate } });
    }
  };

  pc.ontrack = (event) => {
    addVideoTile(remoteId, event.streams[0], remoteUsername || 'Participante', false);
  };

  peers[remoteId] = pc;
  return pc;
}

function setupSocketHandlers() {
  socket.on('existing-users', async (users) => {
    for (const { id, username } of users) {
      const pc = createPeerConnection(id, username);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('signal', { to: id, data: { type: 'offer', sdp: offer } });
    }
  });

  socket.on('user-connected', ({ id, username }) => {
    createPeerConnection(id, username);
  });

  socket.on('user-disconnected', (remoteId) => {
    if (peers[remoteId]) {
      peers[remoteId].close();
      delete peers[remoteId];
    }
    removeVideoTile(remoteId);
  });

  socket.on('signal', async ({ from, data }) => {
    let pc = peers[from];
    if (!pc) pc = createPeerConnection(from);

    if (data.type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('signal', { to: from, data: { type: 'answer', sdp: answer } });
    } else if (data.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } else if (data.type === 'ice') {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (e) { console.error('Error agregando ICE candidate', e); }
    }
  });

  // Chat
  socket.on('chat-history', (history) => {
    document.getElementById('chat-messages').innerHTML = '';
    history.forEach(renderChatMessage);
  });
  socket.on('chat-message', renderChatMessage);

  // Pizarra
  socket.on('whiteboard-draw', (stroke) => drawStroke(stroke, false));
  socket.on('whiteboard-clear', () => clearCanvas(false));
}

// ---------- Controles: mic / cámara ----------
document.getElementById('mic-btn').onclick = () => {
  micOn = !micOn;
  localStream.getAudioTracks().forEach(t => t.enabled = micOn);
  document.getElementById('mic-btn').textContent = micOn ? '🎤 Silenciar' : '🔇 Activar mic';
};

document.getElementById('cam-btn').onclick = () => {
  camOn = !camOn;
  localStream.getVideoTracks().forEach(t => t.enabled = camOn);
  document.getElementById('cam-btn').textContent = camOn ? '📷 Apagar cámara' : '📷 Prender cámara';
};

// ---------- Compartir pantalla ----------
document.getElementById('screen-btn').onclick = async () => {
  if (!sharingScreen) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    } catch (err) {
      return; // el usuario cancelo el dialogo de compartir pantalla
    }
    const screenTrack = screenStream.getVideoTracks()[0];

    // Reemplaza el track de video en todas las conexiones activas
    Object.values(peers).forEach(pc => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(screenTrack);
    });

    // Actualiza tambien mi propio tile
    const localVideoEl = document.querySelector('#tile-local video');
    if (localVideoEl) localVideoEl.srcObject = screenStream;

    sharingScreen = true;
    document.getElementById('screen-btn').textContent = '🛑 Dejar de compartir';
    document.getElementById('screen-btn').classList.add('active-toggle');

    // Si el usuario corta desde el propio dialogo del navegador, volvemos a la camara
    screenTrack.onended = () => stopScreenShare();
  } else {
    stopScreenShare();
  }
};

function stopScreenShare() {
  if (screenStream) screenStream.getTracks().forEach(t => t.stop());
  Object.values(peers).forEach(pc => {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender && cameraTrack) sender.replaceTrack(cameraTrack);
  });
  const localVideoEl = document.querySelector('#tile-local video');
  if (localVideoEl) localVideoEl.srcObject = localStream;

  sharingScreen = false;
  document.getElementById('screen-btn').textContent = '🖥️ Compartir pantalla';
  document.getElementById('screen-btn').classList.remove('active-toggle');
}

// ---------- Panel lateral: tabs ----------
document.querySelectorAll('.side-tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.side-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.side-view').forEach(v => v.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'whiteboard') resizeWhiteboardCanvas();
  };
});

document.getElementById('chat-toggle-btn').onclick = () => togglePanel('chat');
document.getElementById('wb-toggle-btn').onclick = () => togglePanel('whiteboard');

function togglePanel(tabName) {
  const panel = document.getElementById('side-panel');
  const isSameTabOpen = panel.classList.contains('open') &&
    document.querySelector(`.side-tab[data-tab="${tabName}"]`).classList.contains('active');

  if (isSameTabOpen) {
    panel.classList.remove('open');
    return;
  }
  panel.classList.add('open');
  document.querySelector(`.side-tab[data-tab="${tabName}"]`).click();
}

// ---------- Chat ----------
function renderChatMessage(msg) {
  const div = document.createElement('div');
  div.className = 'chat-msg';
  const time = new Date(msg.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  div.innerHTML = `<span class="who">${escapeHtml(msg.username)}</span>${escapeHtml(msg.text)}<span class="when">${time}</span>`;
  const container = document.getElementById('chat-messages');
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('chat-message', text);
  input.value = '';
}
document.getElementById('chat-send-btn').onclick = sendChatMessage;
document.getElementById('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChatMessage();
});

// ---------- Pizarra colaborativa ----------
const canvas = document.getElementById('whiteboard-canvas');
const ctx = canvas.getContext('2d');
let drawing = false;
let lastPoint = null;

function resizeWhiteboardCanvas() {
  const wrap = document.getElementById('whiteboard-canvas-wrap');
  if (!wrap) return;
  const prev = canvas.toDataURL();
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
  const img = new Image();
  img.onload = () => ctx.drawImage(img, 0, 0);
  img.src = prev;
}
window.addEventListener('resize', resizeWhiteboardCanvas);

function getCanvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
}

function drawStroke({ x0, y0, x1, y1, color, size }, emit = true) {
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0 * canvas.width, y0 * canvas.height);
  ctx.lineTo(x1 * canvas.width, y1 * canvas.height);
  ctx.stroke();
  if (emit) socket.emit('whiteboard-draw', { x0, y0, x1, y1, color, size });
}

function clearCanvas(emit = true) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (emit) socket.emit('whiteboard-clear');
}

function startDraw(e) {
  drawing = true;
  lastPoint = getCanvasPoint(e);
}
function moveDraw(e) {
  if (!drawing) return;
  const point = getCanvasPoint(e);
  const color = document.getElementById('wb-color').value;
  const size = Number(document.getElementById('wb-size').value);
  drawStroke({ x0: lastPoint.x, y0: lastPoint.y, x1: point.x, y1: point.y, color, size });
  lastPoint = point;
}
function endDraw() { drawing = false; }

canvas.addEventListener('mousedown', startDraw);
canvas.addEventListener('mousemove', moveDraw);
canvas.addEventListener('mouseup', endDraw);
canvas.addEventListener('mouseleave', endDraw);
canvas.addEventListener('touchstart', (e) => { e.preventDefault(); startDraw(e); });
canvas.addEventListener('touchmove', (e) => { e.preventDefault(); moveDraw(e); });
canvas.addEventListener('touchend', endDraw);

document.getElementById('wb-clear-btn').onclick = () => clearCanvas(true);
