const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');
const scoreInfo = document.getElementById('scoreInfo');
const leaderboardEl = document.getElementById('leaderboard');
const nameEl = document.getElementById('name');
const submitBtn = document.getElementById('submitScore');
const socket = io();

const bgImage = new Image();
bgImage.src = '/assets/background.jpg';

const keys = {};
const gravity = 0.6;

const world = {
  width: 2800,
  floorY: 470,
  cameraX: 0,
  score: 0,
  gameOver: false,
  win: false
};

const player = {
  x: 60, y: 300, w: 32, h: 46,
  vx: 0, vy: 0,
  speed: 4, jump: -13,
  grounded: false,
  hp: 3,
  hitCooldown: 0
};

const platforms = [
  {x:0,y:500,w:700,h:40},{x:760,y:430,w:220,h:20},{x:1030,y:370,w:220,h:20},
  {x:1300,y:320,w:260,h:20},{x:1640,y:390,w:200,h:20},{x:1880,y:450,w:300,h:20},
  {x:2240,y:420,w:240,h:20},{x:2520,y:370,w:260,h:20}
];

const coins = [
  {x:820,y:390,taken:false},{x:1080,y:330,taken:false},{x:1360,y:280,taken:false},
  {x:1690,y:350,taken:false},{x:1940,y:410,taken:false},{x:2280,y:380,taken:false},
  {x:2580,y:330,taken:false}
];

const enemies = [
  {x:1150,y:340,w:30,h:30,dir:1,min:1030,max:1220},
  {x:2000,y:420,w:30,h:30,dir:-1,min:1880,max:2150}
];

const boss = { x: 2680, y: 300, w: 90, h: 100, hp: 8, alive: true, dir: -1, cooldown: 0 };

function rects(a,b){return a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;}

function reset() {
  Object.assign(player,{x:60,y:300,vx:0,vy:0,hp:3});
  world.score = 0; world.gameOver = false; world.win = false;
  coins.forEach(c=>c.taken=false); boss.hp = 8; boss.alive = true;
  statusEl.textContent = 'Sammle Münzen, besiege den Endboss!';
}

function update() {
  if (world.gameOver || world.win) return;
  if (player.hitCooldown > 0) player.hitCooldown--;

  player.vx = 0;
  if (keys['ArrowLeft'] || keys['a']) player.vx = -player.speed;
  if (keys['ArrowRight'] || keys['d']) player.vx = player.speed;
  if ((keys[' '] || keys['ArrowUp'] || keys['w']) && player.grounded) {
    player.vy = player.jump;
    player.grounded = false;
  }

  player.vy += gravity;
  player.x += player.vx;
  player.y += player.vy;
  player.grounded = false;

  for (const p of platforms) {
    if (rects(player, p)) {
      if (player.vy >= 0 && player.y + player.h - player.vy <= p.y + 8) {
        player.y = p.y - player.h;
        player.vy = 0;
        player.grounded = true;
      }
    }
  }

  if (player.y + player.h >= world.floorY) {
    player.y = world.floorY - player.h;
    player.vy = 0;
    player.grounded = true;
  }

  for (const c of coins) {
    if (!c.taken && rects(player, {x:c.x,y:c.y,w:18,h:18})) {
      c.taken = true;
      world.score += 100;
    }
  }

  for (const e of enemies) {
    e.x += e.dir * 1.4;
    if (e.x < e.min || e.x > e.max) e.dir *= -1;
    if (rects(player, e) && player.hitCooldown === 0) {
      player.hp--; player.hitCooldown = 60;
      if (player.hp <= 0) { world.gameOver = true; statusEl.textContent = 'Game Over – R zum Neustart'; }
    }
  }

  if (boss.alive) {
    boss.cooldown++;
    if (boss.cooldown % 100 === 0) boss.dir *= -1;
    boss.x += boss.dir * 1.2;
    if (boss.x < 2550 || boss.x > 2730) boss.dir *= -1;

    if (rects(player, boss)) {
      if (player.vy > 2 && player.y + player.h - player.vy <= boss.y + 20) {
        boss.hp--; player.vy = -9; world.score += 250;
        if (boss.hp <= 0) {
          boss.alive = false; world.win = true; world.score += 2000;
          statusEl.textContent = 'Boss besiegt! Du hast gewonnen 🎉';
        }
      } else if (player.hitCooldown === 0) {
        player.hp--; player.hitCooldown = 60;
        if (player.hp <= 0) { world.gameOver = true; statusEl.textContent = 'Game Over – R zum Neustart'; }
      }
    }
  }

  world.cameraX = Math.max(0, Math.min(world.width - canvas.width, player.x - 200));
  scoreInfo.textContent = `Score: ${world.score} | HP: ${player.hp} | Boss HP: ${boss.alive ? boss.hp : 0}`;
}

function drawRect(obj, color) {
  ctx.fillStyle = color;
  ctx.fillRect(obj.x - world.cameraX, obj.y, obj.w, obj.h);
}

function render() {
  ctx.clearRect(0,0,canvas.width,canvas.height);

  if (bgImage.complete) {
    const bgX = -(world.cameraX * 0.2);
    ctx.drawImage(bgImage, bgX, 0, canvas.width + 220, canvas.height);
  }

  ctx.fillStyle = 'rgba(63,98,18,0.85)';
  ctx.fillRect(-world.cameraX, world.floorY, world.width, 100);

  platforms.forEach(p => drawRect(p, '#92400e'));

  for (const c of coins) {
    if (c.taken) continue;
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(c.x - world.cameraX + 9, c.y + 9, 9, 0, Math.PI * 2);
    ctx.fill();
  }

  enemies.forEach(e => drawRect(e, '#7f1d1d'));
  if (boss.alive) drawRect(boss, '#111827');
  drawRect(player, player.hitCooldown % 10 < 5 ? '#2563eb' : '#93c5fd');

  if (world.gameOver || world.win) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 44px Arial';
    ctx.fillText(world.win ? 'YOU WIN' : 'GAME OVER', 360, 240);
    ctx.font = '24px Arial';
    ctx.fillText('Druecke R fuer Neustart', 350, 290);
  }
}

function loop() { update(); render(); requestAnimationFrame(loop); }

socket.on('leaderboard:update', (scores) => {
  leaderboardEl.innerHTML = '';
  scores.forEach((s, i) => {
    const li = document.createElement('li');
    li.textContent = `${i+1}. ${s.name} — ${s.score}`;
    leaderboardEl.appendChild(li);
  });
});

submitBtn.addEventListener('click', () => {
  socket.emit('score:submit', { name: nameEl.value || 'Anonymous', score: world.score });
  statusEl.textContent = 'Score gesendet!';
});

window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'r') reset();
  keys[e.key] = true;
  keys[e.key.toLowerCase()] = true;
});
window.addEventListener('keyup', (e) => {
  keys[e.key] = false;
  keys[e.key.toLowerCase()] = false;
});

loop();
