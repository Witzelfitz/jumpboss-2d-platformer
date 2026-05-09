const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const scoreInfo = document.getElementById('scoreInfo');
const leaderboardEl = document.getElementById('leaderboard');
const nameEl = document.getElementById('name');
const submitBtn = document.getElementById('submitScore');

const room = new URLSearchParams(location.search).get('room') || 'global';
const socket = io({ query: { room } });
const remotePlayers = {};
let mySocketId = null;
const myColor = `hsl(${Math.floor(Math.random() * 360)} 80% 60%)`;
const particles = [];
const keys = {};
const gravity = 0.6;

const world = { width: 3200, floorY: 470, cameraX: 0, score: 0, gameOver: false, win: false, started: false };
const player = { x: 60, y: 300, w: 32, h: 46, vx: 0, vy: 0, speed: 4.2, jump: -13, grounded: false, hp: 3, hitCooldown: 0, jumps: 0, dashCd: 0, dashTime: 0, dashDir: 1 };
const stars = Array.from({ length: 80 }, () => ({ x: Math.random() * world.width, y: Math.random() * 220, r: Math.random() * 2 + 0.5 }));

const platforms = [
  { x: 0, y: 500, w: 760, h: 40 }, { x: 820, y: 430, w: 220, h: 20 }, { x: 1100, y: 370, w: 220, h: 20 },
  { x: 1380, y: 320, w: 260, h: 20 }, { x: 1730, y: 390, w: 220, h: 20 }, { x: 1990, y: 450, w: 300, h: 20 },
  { x: 2370, y: 420, w: 240, h: 20 }, { x: 2670, y: 370, w: 260, h: 20 }, { x: 2980, y: 320, w: 170, h: 20 }
];

const coins = [820, 1080, 1410, 1770, 2040, 2400, 2720, 3020].map((x, i) => ({ x, y: [390, 330, 280, 350, 410, 380, 330, 280][i], taken: false }));
const enemies = [
  { x: 1220, y: 340, w: 30, h: 30, dir: 1, min: 1100, max: 1320 },
  { x: 2120, y: 420, w: 30, h: 30, dir: -1, min: 1990, max: 2250 },
  { x: 2860, y: 340, w: 30, h: 30, dir: 1, min: 2690, max: 2930 }
];

const boss = { x: 3070, y: 230, w: 110, h: 120, hp: 12, alive: true, dir: -1, cooldown: 0, shots: [] };

function rects(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function burst(x, y, color, n = 12) {
  for (let i = 0; i < n; i++) particles.push({ x, y, vx: (Math.random() - 0.5) * 5, vy: -Math.random() * 3 - 1, life: 28 + Math.random() * 20, color });
}

function reset() {
  Object.assign(player, { x: 60, y: 300, vx: 0, vy: 0, hp: 3, jumps: 0, dashCd: 0 });
  Object.assign(world, { score: 0, gameOver: false, win: false, started: true });
  coins.forEach((c) => (c.taken = false));
  boss.hp = 12; boss.alive = true; boss.shots.length = 0;
  statusEl.textContent = 'Los! Sammle Münzen, weiche dem Boss aus und gewinne den Fight.';
}

function hurtPlayer() {
  if (player.hitCooldown > 0) return;
  player.hp--; player.hitCooldown = 50; burst(player.x + 15, player.y + 18, '#ef4444', 16);
  if (player.hp <= 0) { world.gameOver = true; statusEl.textContent = 'Game Over – R fuer Neustart'; }
}

function update() {
  if (!world.started || world.gameOver || world.win) return;
  if (player.hitCooldown > 0) player.hitCooldown--;
  if (player.dashCd > 0) player.dashCd--;

  player.vx = 0;
  if (keys.ArrowLeft || keys.a) player.vx = -player.speed;
  if (keys.ArrowRight || keys.d) player.vx = player.speed;

  if (player.dashTime > 0) {
    player.dashTime--;
    player.vx = player.dashDir * 10;
    player.vy *= 0.4;
  } else {
    player.vy += gravity;
  }

  player.x += player.vx;
  player.y += player.vy;
  player.grounded = false;

  for (const p of platforms) {
    if (rects(player, p) && player.vy >= 0 && player.y + player.h - player.vy <= p.y + 8) {
      player.y = p.y - player.h; player.vy = 0; player.grounded = true; player.jumps = 0;
    }
  }

  if (player.y + player.h >= world.floorY) {
    player.y = world.floorY - player.h; player.vy = 0; player.grounded = true; player.jumps = 0;
  }

  for (const c of coins) if (!c.taken && rects(player, { x: c.x, y: c.y, w: 18, h: 18 })) { c.taken = true; world.score += 120; burst(c.x + 9, c.y + 9, '#fde047', 10); }

  for (const [id, rp] of Object.entries(remotePlayers)) {
    if (!rp?.alive) continue;
    const rb = { x: rp.x, y: rp.y, w: player.w, h: player.h };
    if (rects(player, rb)) {
      const stomp = player.vy > 1.5 && player.y + player.h - player.vy <= rb.y + 14;
      if (stomp) {
        socket.emit('player:stomp', { targetId: id });
        player.vy = -8.5;
        world.score += 180;
        burst(rb.x + 14, rb.y + 12, '#fca5a5', 10);
      } else {
        hurtPlayer();
      }
    }
  }

  for (const e of enemies) {
    e.x += e.dir * 1.6;
    if (e.x < e.min || e.x > e.max) e.dir *= -1;
    if (rects(player, e)) hurtPlayer();
  }

  if (boss.alive) {
    boss.cooldown++;
    if (boss.cooldown % 90 === 0) boss.dir *= -1;
    boss.x += boss.dir * 1.4;
    if (boss.x < 2960 || boss.x > 3090) boss.dir *= -1;

    if (boss.cooldown % 65 === 0) {
      boss.shots.push({ x: boss.x + boss.w / 2, y: boss.y + 40, vx: (player.x - boss.x) * 0.01, vy: 1.8, w: 10, h: 10 });
    }

    boss.shots.forEach((s) => { s.x += s.vx; s.y += s.vy; s.vy += 0.04; if (rects(player, s)) { s.dead = true; hurtPlayer(); } });
    boss.shots = boss.shots.filter((s) => !s.dead && s.y < 560 && s.x > 0 && s.x < world.width + 100);

    if (rects(player, boss)) {
      if (player.vy > 2 && player.y + player.h - player.vy <= boss.y + 24) {
        boss.hp--; player.vy = -10; world.score += 300; burst(boss.x + boss.w / 2, boss.y + 30, '#fb7185', 14);
        if (boss.hp <= 0) { boss.alive = false; world.win = true; world.score += 3500; statusEl.textContent = 'Boss zerstort! Victory Royale 🎉'; }
      } else hurtPlayer();
    }
  }

  particles.forEach((p) => { p.x += p.vx; p.y += p.vy; p.vy += 0.08; p.life--; });
  while (particles.length && particles[0].life <= 0) particles.shift();

  world.cameraX = clamp(player.x - 220, 0, world.width - canvas.width);
  scoreInfo.textContent = `Room: ${room} | Score: ${world.score} | HP: ${player.hp} | Boss-HP: ${boss.alive ? boss.hp : 0}`;
}

function drawRect(obj, color) { ctx.fillStyle = color; ctx.fillRect(obj.x - world.cameraX, obj.y, obj.w, obj.h); }

function drawHero(x, y, w, h, color, alpha = 1, facing = 1, hp = 3, name = '') {
  ctx.save();
  ctx.globalAlpha = alpha;
  const sx = x - world.cameraX;
  ctx.translate(sx + w / 2, y + h / 2); ctx.scale(facing, 1); ctx.translate(-(sx + w / 2), -(y + h / 2));
  ctx.fillStyle = color; ctx.fillRect(sx + 6, y + 10, w - 12, h - 10);
  ctx.fillStyle = '#fde68a'; ctx.fillRect(sx + 8, y, w - 16, 14);
  ctx.fillStyle = '#111827'; ctx.fillRect(sx + 10, y + 4, 4, 4); ctx.fillRect(sx + 18, y + 4, 4, 4);
  ctx.fillStyle = '#1f2937'; ctx.fillRect(sx + 4, y + 18, 6, h - 18); ctx.fillRect(sx + w - 10, y + 18, 6, h - 18);
  ctx.restore();
  if (name) { ctx.fillStyle = 'rgba(17,24,39,0.75)'; ctx.fillRect(sx - 6, y - 18, Math.max(54, name.length * 7), 14); ctx.fillStyle = '#fff'; ctx.font = '11px Arial'; ctx.fillText(name, sx - 2, y - 8); }
  ctx.fillStyle = '#ef4444'; ctx.fillRect(sx, y - 6, w, 4); ctx.fillStyle = '#22c55e'; ctx.fillRect(sx, y - 6, clamp(hp / 3, 0, 1) * w, 4);
}

function drawEnemy(e) {
  const sx = e.x - world.cameraX;
  ctx.fillStyle = '#7f1d1d'; ctx.fillRect(sx, e.y, e.w, e.h);
  ctx.fillStyle = '#fecaca'; ctx.fillRect(sx + 4, e.y + 4, e.w - 8, 8);
  ctx.fillStyle = '#111827'; ctx.fillRect(sx + 6, e.y + 18, 6, 4); ctx.fillRect(sx + 18, e.y + 18, 6, 4);
}

function drawBossSprite(b) {
  const sx = b.x - world.cameraX;
  ctx.fillStyle = '#020617'; ctx.fillRect(sx, b.y, b.w, b.h);
  ctx.fillStyle = '#334155'; ctx.fillRect(sx + 8, b.y + 10, b.w - 16, b.h - 20);
  ctx.fillStyle = '#f87171'; ctx.fillRect(sx + 18, b.y + 24, 16, 8); ctx.fillRect(sx + b.w - 34, b.y + 24, 16, 8);
  ctx.fillStyle = '#f43f5e'; ctx.fillRect(sx + 18, b.y - 10, (b.hp / 12) * (b.w - 36), 6);

  b.shots.forEach((s) => {
    ctx.fillStyle = '#fb7185';
    ctx.beginPath(); ctx.arc(s.x - world.cameraX, s.y, 6, 0, Math.PI * 2); ctx.fill();
  });
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, '#0ea5e9'); sky.addColorStop(0.5, '#7dd3fc'); sky.addColorStop(0.55, '#bbf7d0'); sky.addColorStop(1, '#14532d');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.globalAlpha = 0.45;
  stars.forEach((s) => { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc((s.x - world.cameraX * 0.2) % (canvas.width + 40), s.y, s.r, 0, Math.PI * 2); ctx.fill(); });
  ctx.globalAlpha = 1;

  ctx.fillStyle = '#3f6212'; ctx.fillRect(-world.cameraX, world.floorY, world.width, 100);
  platforms.forEach((p) => drawRect(p, '#92400e'));

  for (const c of coins) {
    if (c.taken) continue;
    ctx.fillStyle = '#fde047'; ctx.beginPath(); ctx.arc(c.x - world.cameraX + 9, c.y + 9, 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#facc15'; ctx.stroke();
  }

  enemies.forEach(drawEnemy);
  if (boss.alive) drawBossSprite(boss);

  Object.values(remotePlayers).forEach((rp) => drawHero(rp.x, rp.y, player.w, player.h, rp.color || '#60a5fa', 0.5, rp.dir || 1, rp.hp || 1, rp.name || 'Player'));
  drawHero(player.x, player.y, player.w, player.h, player.hitCooldown % 10 < 5 ? myColor : '#bfdbfe', 1, player.vx < 0 ? -1 : 1, player.hp, (nameEl.value || 'You').slice(0, 24));

  particles.forEach((p) => { ctx.globalAlpha = clamp(p.life / 40, 0, 1); ctx.fillStyle = p.color; ctx.fillRect(p.x - world.cameraX, p.y, 3, 3); ctx.globalAlpha = 1; });

  if (!world.started || world.gameOver || world.win) {
    ctx.fillStyle = 'rgba(0,0,0,0.58)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 44px Arial';
    const title = !world.started ? 'JUMPBOSS X' : world.win ? 'YOU WIN' : 'GAME OVER';
    ctx.fillText(title, 335, 220);
    ctx.font = '20px Arial';
    ctx.fillText(!world.started ? 'Enter starten • Space Doppeljump • Shift Dash • R Reset' : 'R für Neustart', 220, 270);
  }
}

function loop() { update(); render(); requestAnimationFrame(loop); }

socket.on('connect', () => {
  mySocketId = socket.id;
});

socket.on('room:joined', (joined) => {
  statusEl.textContent = `Verbunden mit Room: ${joined}`;
});

socket.on('leaderboard:update', (scores) => {
  leaderboardEl.innerHTML = '';
  scores.forEach((s, i) => {
    const li = document.createElement('li');
    li.textContent = `${i + 1}. ${s.name} — ${s.score}`;
    leaderboardEl.appendChild(li);
  });
});

socket.on('players:update', (players) => {
  Object.keys(remotePlayers).forEach((k) => delete remotePlayers[k]);
  Object.entries(players || {}).forEach(([id, p]) => {
    if (!p) return;
    if (id === mySocketId) {
      player.hp = Number(p.hp ?? player.hp);
      if (p.alive === false) {
        player.x = Number(p.x ?? player.x);
        player.y = Number(p.y ?? player.y);
      }
      return;
    }
    remotePlayers[id] = p;
  });
});
socket.on('player:state', (p) => {
  if (!p?.id) return;
  if (p.id === mySocketId) {
    player.hp = Number(p.hp ?? player.hp);
    if (p.alive === false) {
      player.x = Number(p.x ?? player.x);
      player.y = Number(p.y ?? player.y);
      statusEl.textContent = 'Du wurdest ausgeschaltet – Respawn läuft...';
    } else {
      statusEl.textContent = 'Du bist wieder im Spiel!';
    }
    return;
  }
  remotePlayers[p.id] = p;
});
socket.on('player:left', (id) => delete remotePlayers[id]);

submitBtn.addEventListener('click', () => {
  socket.emit('score:submit', { name: nameEl.value || 'Anonymous', score: world.score });
  statusEl.textContent = 'Score gesendet!';
});

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  keys[e.key] = true; keys[k] = true;
  if (k === 'enter' && !world.started) reset();
  if (k === 'r') reset();
  if ((k === 'arrowleft' || k === 'a') && player.vx !== 0) player.dashDir = -1;
  if ((k === 'arrowright' || k === 'd') && player.vx !== 0) player.dashDir = 1;

  if ((k === ' ' || k === 'arrowup' || k === 'w') && world.started && !world.gameOver && !world.win) {
    if (player.grounded) { player.vy = player.jump; player.grounded = false; player.jumps = 1; }
    else if (player.jumps < 2) { player.vy = player.jump * 0.9; player.jumps++; burst(player.x + 15, player.y + 20, '#a5f3fc', 8); }
  }

  if (k === 'shift' && player.dashCd <= 0 && world.started && !world.gameOver && !world.win) {
    const dir = player.vx < 0 ? -1 : player.vx > 0 ? 1 : player.dashDir;
    player.dashDir = dir;
    player.dashTime = 7;
    player.dashCd = 36;
    burst(player.x + 16, player.y + 20, '#93c5fd', 12);
  }
});
window.addEventListener('keyup', (e) => { keys[e.key] = false; keys[e.key.toLowerCase()] = false; });

setInterval(() => {
  socket.emit('player:update', {
    x: player.x, y: player.y, dir: player.vx < 0 ? -1 : 1,
    name: (nameEl.value || 'Player').slice(0, 24), color: myColor, hp: player.hp, alive: player.hp > 0
  });
}, 80);

loop();
