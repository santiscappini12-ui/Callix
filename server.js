const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// Sirve los archivos estáticos (el frontend)
app.use(express.static(path.join(__dirname, 'public')));

// Endpoint de salud, usado por el keep-alive para que Render no duerma el server
app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

// --- Lógica de señalización WebRTC ---
// Guardamos qué usuarios están en qué sala
const rooms = {};

io.on('connection', (socket) => {
  console.log(`Cliente conectado: ${socket.id}`);

  socket.on('join-room', (roomId) => {
    socket.join(roomId);

    if (!rooms[roomId]) rooms[roomId] = new Set();
    rooms[roomId].add(socket.id);

    // Avisa a los demás en la sala que llegó alguien nuevo
    socket.to(roomId).emit('user-connected', socket.id);

    // Le manda al que entra la lista de gente que ya estaba
    const others = [...rooms[roomId]].filter((id) => id !== socket.id);
    socket.emit('existing-users', others);

    socket.on('disconnect', () => {
      rooms[roomId]?.delete(socket.id);
      socket.to(roomId).emit('user-disconnected', socket.id);
      console.log(`Cliente desconectado: ${socket.id}`);
    });
  });

  // Reenvío de mensajes de señalización WebRTC (oferta, respuesta, candidatos ICE)
  socket.on('signal', ({ to, data }) => {
    io.to(to).emit('signal', { from: socket.id, data });
  });
});

server.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
