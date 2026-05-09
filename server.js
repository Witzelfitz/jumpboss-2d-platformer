const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

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
  socket.emit('leaderboard:update', await topScores(10));

  socket.on('score:submit', async ({ name, score }) => {
    const cleanName = String(name || 'Anonymous').slice(0, 24).replace(/[^a-zA-Z0-9 _-]/g, '') || 'Anonymous';
    const cleanScore = Math.max(0, Math.floor(Number(score) || 0));

    db.run('INSERT INTO scores (name, score) VALUES (?, ?)', [cleanName, cleanScore], async (err) => {
      if (err) return;
      io.emit('leaderboard:update', await topScores(10));
    });
  });
});

server.listen(PORT, () => {
  console.log(`JumpBoss listening on http://localhost:${PORT}`);
});
