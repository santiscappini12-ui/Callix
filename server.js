const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const USERS_FILE = path.join(__dirname, 'data', 'users.json');

// --- Almacenamiento simple de usuarios en un archivo JSON ---
// NOTA: en el plan free de Render el disco es efimero (se puede reiniciar
// al re-desplegar). Para cuentas persistentes de verdad a largo plazo,
// lo ideal es agregar una base de datos (ej. Postgres, que Render ofrece
// gratis). Esto funciona bien mientras el servicio esta corriendo.
function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}
function saveUsers(users) {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'cambia-este-secreto-en-produccion',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 7 dias
});
app.use(sessionMiddleware);

// Endpoint de salud, usado por el keep-alive para que Render no duerma el server
app.get('/health', (req, res) => res.status(200).send('ok'));

// --- API de autenticacion ---
app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || username.length < 3 || password.length < 4) {
    return res.status(400).json({ error: 'Usuario (min 3 caracteres) y contraseña (min 4) requeridos' });
  }
  const users = loadUsers();
  const key = username.trim().toLowerCase();
  if (users[key]) {
    return res.status(409).json({ error: 'Ese usuario ya existe' });
  }
  users[key] = {
    username: username.trim(),
    passwordHash: bcrypt.hashSync(password, 10),
    createdAt: new Date().toISOString()
  };
  saveUsers(users);
  req.session.user = { username: users[key].username };
  res.json({ user: req.session.user });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const users = loadUsers();
  const key = (username || '').trim().toLowerCase();
  const record = users[key];
  if (!record || !bcrypt.compareSync(password || '', record.passwordHash)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  req.session.user = { username: record.username };
  res.json({ user: req.session.user });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

// --- Socket.io: comparte la sesion HTTP con las conexiones de socket ---
io.engine.use(sessionMiddleware);

const rooms = {};       // roomId -> Map de socket.id -> username
const roomChat = {};    // roomId -> historial de chat (ultimos 100 mensajes)

io.on('connection', (socket) => {
  const session = socket.request.session;
  const username = session?.user?.username || 'Invitado';

  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.username = username;

    if (!rooms[roomId]) rooms[roomId] = new Map();
    rooms[roomId].set(socket.id, username);

    socket.to(roomId).emit('user-connected', { id: socket.id, username });

    const others = [...rooms[roomId].entries()]
      .filter(([id]) => id !== socket.id)
      .map(([id, name]) => ({ id, username: name }));
    socket.emit('existing-users', others);

    // Enviar historial de chat de la sala al que entra
    socket.emit('chat-history', roomChat[roomId] || []);

    socket.on('disconnect', () => {
      rooms[roomId]?.delete(socket.id);
      socket.to(roomId).emit('user-disconnected', socket.id);
    });
  });

  // Señalización WebRTC (ofertas, respuestas, candidatos ICE)
  socket.on('signal', ({ to, data }) => {
    io.to(to).emit('signal', { from: socket.id, data });
  });

  // Chat de texto
  socket.on('chat-message', (text) => {
    const roomId = socket.data.roomId;
    if (!roomId || !text || typeof text !== 'string') return;
    const msg = {
      id: crypto.randomUUID(),
      username: socket.data.username,
      text: text.slice(0, 1000),
      at: new Date().toISOString()
    };
    if (!roomChat[roomId]) roomChat[roomId] = [];
    roomChat[roomId].push(msg);
    if (roomChat[roomId].length > 100) roomChat[roomId].shift();
    io.to(roomId).emit('chat-message', msg);
  });

  // Pizarra colaborativa: reenvia cada trazo a los demas en la sala
  socket.on('whiteboard-draw', (stroke) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.to(roomId).emit('whiteboard-draw', stroke);
  });

  socket.on('whiteboard-clear', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.to(roomId).emit('whiteboard-clear');
  });
});

server.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
