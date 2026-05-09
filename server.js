const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const roomPlayers = new Map();

function cleanRoom(value) {
  const room = String(value || 'global').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
  return room || 'global';
}

function getRoomMap(room) {
  if (!roomPlayers.has(room)) roomPlayers.set(room, new Map());
  return roomPlayers.get(room);
}

const db = new sqlite3.Database(path.join(__dirname, 'leaderboard.db'));
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    score INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function topScores(limit = 10) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT name, MAX(score) as score
       FROM scores
       GROUP BY name
       ORDER BY score DESC
       LIMIT ?`,
      [limit],
      (err, rows) => (err ? reject(err) : resolve(rows))
    );
  });
}

app.get('/api/leaderboard', async (_req, res) => {
  try {
    res.json(await topScores(10));
  } catch (e) {
    res.status(500).json({ error: 'failed_to_load_leaderboard' });
  }
});

io.on('connection', async (socket) => {
  const room = cleanRoom(socket.handshake.query?.room);
  socket.data.room = room;
  socket.join(room);

  const players = getRoomMap(room);
  socket.emit('room:joined', room);
  socket.emit('leaderboard:update', await topScores(10));
  socket.emit('players:update', Object.fromEntries(players));

  socket.on('player:update', (payload = {}) => {
    const safe = {
      x: Number(payload.x) || 0,
      y: Number(payload.y) || 0,
      dir: payload.dir === -1 ? -1 : 1,
      name: String(payload.name || 'Anonymous').slice(0, 24).replace(/[^a-zA-Z0-9 _-]/g, '') || 'Anonymous',
      color: String(payload.color || '#60a5fa').slice(0, 16),
      hp: Math.max(0, Number(payload.hp) || 0)
    };
    players.set(socket.id, safe);
    socket.to(room).emit('player:state', { id: socket.id, ...safe });
  });

  socket.on('score:submit', async ({ name, score }) => {
    const cleanName = String(name || 'Anonymous').slice(0, 24).replace(/[^a-zA-Z0-9 _-]/g, '') || 'Anonymous';
    const cleanScore = Math.max(0, Math.floor(Number(score) || 0));

    db.run('INSERT INTO scores (name, score) VALUES (?, ?)', [cleanName, cleanScore], async (err) => {
      if (err) return;
      io.to(room).emit('leaderboard:update', await topScores(10));
    });
  });

  socket.on('disconnect', () => {
    players.delete(socket.id);
    socket.to(room).emit('player:left', socket.id);
    if (players.size === 0) roomPlayers.delete(room);
  });
});

server.listen(PORT, () => {
  console.log(`JumpBoss listening on http://localhost:${PORT}`);
});
