// Dots server: serves the web app, runs online rooms and matchmaking over WebSocket,
// and provides a small JSON API for accounts, settings and game history.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game, TARGETS, MOVE_TIMES } from './public/game.js';
import * as db from './db.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || undefined; // e.g. 127.0.0.1 behind a reverse proxy
// Behind Cloudflare + nginx, trust the visitor IP that Cloudflare reports
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const clientIp = (req) =>
  (TRUST_PROXY && (req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim())) ||
  req.socket.remoteAddress ||
  '';
const PUB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------- helpers

const cleanName = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 20) || 'Player';
const cleanColor = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null);
const clampInt = (v, lo, hi, d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

function cleanOpts(m) {
  return {
    w: clampInt(m.w, 10, 50, 30),
    h: clampInt(m.h, 10, 50, 30),
    start: m.start === 'empty' ? 'empty' : 'cross',
    target: TARGETS.includes(Number(m.target)) ? Number(m.target) : 0,
    moveTime: MOVE_TIMES.includes(Number(m.moveTime)) ? Number(m.moveTime) : 0,
  };
}

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function colorsClash(a, b) {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2) < 90;
}
const FALLBACKS = ['#2d7ff9', '#f2c200', '#e5484d', '#2ead5b', '#8e4ec6'];

// ---------------------------------------------------------------- HTTP API

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('tooLarge'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('badJson'));
      }
    });
    req.on('error', reject);
  });
}

const bearer = (req) => {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
};

// Simple per-IP limiter for login/register attempts
const attempts = new Map();
function limited(ip) {
  const now = Date.now();
  const a = attempts.get(ip) || { n: 0, since: now };
  if (now - a.since > 10 * 60 * 1000) {
    a.n = 0;
    a.since = now;
  }
  a.n++;
  attempts.set(ip, a);
  return a.n > 20;
}

const SETTING_KEYS = {
  name1: 'string', name2: 'string', color1: 'string', color2: 'string', lang: 'string', theme: 'string',
  size: 'number', target: 'number', moveTime: 'number', start: 'string', tapConfirm: 'boolean',
};
function cleanSettings(s) {
  const out = {};
  if (!s || typeof s !== 'object') return out;
  for (const [k, type] of Object.entries(SETTING_KEYS)) {
    if (typeof s[k] === type) out[k] = type === 'string' ? s[k].slice(0, 40) : s[k];
  }
  return out;
}

function cleanGame(g) {
  if (!g || typeof g !== 'object') return null;
  const names = Array.isArray(g.names) ? g.names.slice(0, 2).map(cleanName) : null;
  const colors = Array.isArray(g.colors) ? g.colors.slice(0, 2).map((c) => cleanColor(c) || '#888888') : null;
  const scores = Array.isArray(g.scores) ? g.scores.slice(0, 2).map((n) => clampInt(n, 0, 5000, 0)) : null;
  if (!names || names.length !== 2 || !colors || colors.length !== 2 || !scores || scores.length !== 2) return null;
  return {
    at: clampInt(g.at, 0, Date.now() + 60000, Date.now()),
    mode: ['local', 'bot', 'online'].includes(g.mode) ? g.mode : 'local',
    w: clampInt(g.w, 10, 50, 30),
    h: clampInt(g.h, 10, 50, 30),
    names,
    colors,
    scores,
    winner: clampInt(g.winner, -1, 1, -1),
    reason: ['score', 'resign', 'agreed', 'timeout'].includes(g.reason) ? g.reason : 'score',
    me: clampInt(g.me, -1, 1, -1),
    moves: clampInt(g.moves, 0, 5000, 0),
  };
}

async function api(req, res, p) {
  const ip = clientIp(req);
  try {
    if (p === '/api/online' && req.method === 'GET') {
      return json(res, 200, { online: wss.clients.size, waiting: queue.length });
    }
    if ((p === '/api/register' || p === '/api/login') && req.method === 'POST') {
      if (limited(ip)) return json(res, 429, { error: 'tooMany' });
      const b = await readBody(req, 4096);
      const username = String(b.username || '').trim();
      const password = String(b.password || '');
      if (!db.USERNAME_RE.test(username)) return json(res, 400, { error: 'badUsername' });
      if (password.length < 6 || password.length > 200) return json(res, 400, { error: 'badPassword' });
      let user;
      if (p === '/api/register') {
        try {
          user = await db.createUser(username, password);
        } catch {
          return json(res, 409, { error: 'taken' });
        }
        if (b.settings) db.saveSettings(user.id, cleanSettings(b.settings));
      } else {
        user = await db.verifyUser(username, password);
        if (!user) return json(res, 401, { error: 'badLogin' });
      }
      const token = db.createSession(user.id);
      const full = db.userByToken(token);
      return json(res, 200, { token, user: { username: full.username }, settings: full.settings });
    }

    const token = bearer(req);
    const user = db.userByToken(token);
    if (!user) return json(res, 401, { error: 'auth' });

    if (p === '/api/me' && req.method === 'GET') {
      return json(res, 200, { user: { username: user.username }, settings: user.settings });
    }
    if (p === '/api/logout' && req.method === 'POST') {
      db.deleteSession(token);
      return json(res, 200, { ok: true });
    }
    if (p === '/api/settings' && req.method === 'PUT') {
      const b = await readBody(req, 8192);
      db.saveSettings(user.id, { ...user.settings, ...cleanSettings(b.settings) });
      return json(res, 200, { ok: true });
    }
    if (p === '/api/history' && req.method === 'GET') {
      return json(res, 200, { games: db.listGames(user.id) });
    }
    if (p === '/api/history' && req.method === 'POST') {
      const b = await readBody(req);
      const list = (Array.isArray(b.games) ? b.games : [b.game]).slice(0, 500).map(cleanGame).filter(Boolean);
      // Online games are recorded by the server itself, so clients may only add local / computer games
      // (or online games played before signing in, which the server never attributed to this account).
      if (list.length) db.addGames(user.id, list);
      return json(res, 200, { added: list.length });
    }
    return json(res, 404, { error: 'notFound' });
  } catch (e) {
    return json(res, 400, { error: e.message || 'error' });
  }
}

// ---------------------------------------------------------------- static files

const server = http.createServer((req, res) => {
  let p;
  try {
    p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (p.startsWith('/api/')) return api(req, res, p);
  if (p === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUB, p));
  if (!file.startsWith(PUB + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

// ---------------------------------------------------------------- rooms

const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REACTIONS = ['👍', '😮', '😂', '😤', '🔥', '🤝'];

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function stateFor(room, seat) {
  return {
    t: 'state',
    code: room.code,
    you: seat,
    opts: room.opts,
    first: room.first,
    matched: room.matched,
    players: room.players.map((p) => (p ? { name: p.name, color: p.color, online: !!p.ws } : null)),
    spectators: room.spectators.size,
    moves: room.game.moves,
    status: room.status,
    result: room.result,
    endOffer: room.endOffer,
    rematch: room.rematch,
    timeLeft: room.deadline ? Math.max(0, room.deadline - Date.now()) : null,
  };
}

function broadcast(room) {
  room.last = Date.now();
  room.players.forEach((p, s) => p && send(p.ws, stateFor(room, s)));
  for (const ws of room.spectators) send(ws, stateFor(room, -1));
}

function makeRoom(opts, matched = false) {
  const code = newCode();
  const room = {
    code,
    opts,
    matched,
    first: 0,
    players: [null, null],
    spectators: new Set(),
    status: 'waiting',
    result: null,
    endOffer: -1,
    rematch: [false, false],
    last: Date.now(),
    timer: null,
    deadline: null,
  };
  room.game = new Game({ ...opts, first: 0 });
  rooms.set(code, room);
  return room;
}

// Put a connection into a seat. Returns the seat token.
function seatPlayer(room, s, ws, { name, color, userId }) {
  color = cleanColor(color) || (s === 0 ? '#f2c200' : '#2d7ff9');
  const other = room.players[1 - s];
  if (other && colorsClash(color, other.color)) color = FALLBACKS.find((c) => !colorsClash(c, other.color));
  const token = crypto.randomBytes(16).toString('hex');
  room.players[s] = { name: cleanName(name), color, token, ws, userId: userId || null };
  ws.room = room;
  ws.seat = s;
  send(ws, { t: 'joined', code: room.code, seat: s, token });
  return token;
}

// Move timer: when it runs out, the player to move loses their turn.
const GRACE_MS = 300; // allow for network latency after the client's countdown hits zero
function schedule(room) {
  clearTimeout(room.timer);
  room.timer = null;
  room.deadline = null;
  const secs = room.opts.moveTime;
  if (!secs || room.status !== 'playing') return;
  if (!room.players.some((p) => p?.ws)) return; // nobody here: pause
  room.deadline = Date.now() + secs * 1000;
  room.timer = setTimeout(() => onTimeout(room), secs * 1000 + GRACE_MS);
}

function onTimeout(room) {
  if (room.status !== 'playing') return;
  room.game.pass();
  room.endOffer = -1;
  if (room.game.over) {
    if (room.game.forfeit >= 0) finish(room, 'timeout', 1 - room.game.forfeit);
    else finish(room, 'score', room.game.leader());
  }
  schedule(room);
  broadcast(room);
}

function startGame(room) {
  room.game = new Game({ ...room.opts, first: room.first });
  room.status = 'playing';
  room.result = null;
  room.endOffer = -1;
  room.rematch = [false, false];
  schedule(room);
}

function finish(room, type, winner) {
  room.status = 'ended';
  room.result = { type, winner };
  room.endOffer = -1;
  schedule(room); // clears the timer
  recordHistory(room);
}

// Save the finished game to the history of every signed-in player
function recordHistory(room) {
  const g = room.game;
  const base = {
    at: Date.now(),
    mode: 'online',
    w: room.opts.w,
    h: room.opts.h,
    names: room.players.map((p) => p?.name || ''),
    colors: room.players.map((p) => p?.color || '#888888'),
    scores: g.score.slice(),
    winner: room.result.winner,
    reason: room.result.type,
    moves: g.moves.length,
  };
  room.players.forEach((p, s) => {
    if (!p?.userId) return;
    try {
      db.addGame(p.userId, { ...base, me: s });
    } catch (e) {
      console.error('history', e);
    }
  });
}

function detach(ws) {
  unqueue(ws);
  const room = ws.room;
  if (!room) return;
  if (ws.seat >= 0 && room.players[ws.seat]?.ws === ws) room.players[ws.seat].ws = null;
  room.spectators.delete(ws);
  ws.room = null;
  ws.seat = undefined;
  if (room.timer && !room.players.some((p) => p?.ws)) schedule(room); // pause when everyone left
  broadcast(room);
}

// ---------------------------------------------------------------- matchmaking

const queue = []; // { ws, name, color, opts, userId, since }

function unqueue(ws) {
  const i = queue.findIndex((e) => e.ws === ws);
  if (i >= 0) {
    queue.splice(i, 1);
    queueInfo();
  }
}

function queueInfo() {
  const msg = { t: 'queue', waiting: queue.length, online: wss.clients.size };
  for (const e of queue) send(e.ws, msg);
}

function enqueue(ws, m) {
  detach(ws);
  const entry = {
    ws,
    name: m.name,
    color: m.color,
    opts: cleanOpts(m),
    userId: db.userByToken(m.auth)?.id || null,
    since: Date.now(),
  };
  // Pair with whoever has waited longest; their settings are used
  const other = queue.find((e) => e.ws !== ws && e.ws.readyState === 1);
  if (!other) {
    queue.push(entry);
    queueInfo();
    return;
  }
  queue.splice(queue.indexOf(other), 1);
  const room = makeRoom(other.opts, true);
  seatPlayer(room, 0, other.ws, other);
  seatPlayer(room, 1, ws, entry);
  startGame(room);
  broadcast(room);
  queueInfo();
}

// ---------------------------------------------------------------- messages

function handle(ws, m) {
  const room = ws.room;
  switch (m.t) {
    case 'queue':
      return enqueue(ws, m);
    case 'unqueue':
      return unqueue(ws);
    case 'create': {
      detach(ws);
      const r = makeRoom(cleanOpts(m));
      seatPlayer(r, 0, ws, { name: m.name, color: m.color, userId: db.userByToken(m.auth)?.id });
      broadcast(r);
      return;
    }
    case 'join': {
      const r = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!r) return send(ws, { t: 'error', code: 'noRoom' });
      if (ws.room !== r) detach(ws);
      // Reconnect to an existing seat
      const s = r.players.findIndex((p) => p && m.token && p.token === m.token);
      if (s >= 0) {
        const old = r.players[s].ws;
        if (old && old !== ws) {
          old.room = null;
          send(old, { t: 'error', code: 'replaced' });
        }
        r.players[s].ws = ws;
        ws.room = r;
        ws.seat = s;
        if (r.status === 'playing' && !r.timer) schedule(r); // resume a paused timer
        send(ws, { t: 'joined', code: r.code, seat: s, token: m.token });
        broadcast(r);
        return;
      }
      if (!r.players[1]) {
        seatPlayer(r, 1, ws, { name: m.name, color: m.color, userId: db.userByToken(m.auth)?.id });
        startGame(r);
        broadcast(r);
        return;
      }
      // Room full: watch as a spectator
      r.spectators.add(ws);
      ws.room = r;
      ws.seat = -1;
      send(ws, { t: 'joined', code: r.code, seat: -1, token: null });
      broadcast(r);
      return;
    }
    case 'leave': {
      if (room && ws.seat === 0 && room.status === 'waiting') {
        rooms.delete(room.code);
        clearTimeout(room.timer);
      }
      detach(ws);
      return;
    }
  }

  if (!room || !(ws.seat >= 0)) return;
  const seat = ws.seat;

  switch (m.t) {
    case 'move': {
      if (room.status !== 'playing' || room.game.turn !== seat) return;
      if (!room.game.place(Number(m.i))) return send(ws, { t: 'error', code: 'badMove' });
      room.endOffer = -1;
      if (room.game.over) finish(room, 'score', room.game.leader());
      else schedule(room);
      broadcast(room);
      return;
    }
    case 'resign':
      if (room.status !== 'playing') return;
      finish(room, 'resign', 1 - seat);
      broadcast(room);
      return;
    case 'offerEnd':
      if (room.status !== 'playing') return;
      room.endOffer = seat;
      broadcast(room);
      return;
    case 'answerEnd':
      if (room.status !== 'playing' || room.endOffer !== 1 - seat) return;
      if (m.accept) finish(room, 'agreed', room.game.leader());
      else room.endOffer = -1;
      broadcast(room);
      return;
    case 'rematch':
      if (room.status !== 'ended') return;
      room.rematch[seat] = true;
      if (room.rematch[0] && room.rematch[1]) {
        room.first = 1 - room.first;
        startGame(room);
      }
      broadcast(room);
      return;
    case 'react': {
      if (!REACTIONS.includes(m.e)) return;
      const now = Date.now();
      if (now - (ws.lastReact || 0) < 800) return;
      ws.lastReact = now;
      const msg = { t: 'react', seat, e: m.e };
      room.players.forEach((p) => p && send(p.ws, msg));
      for (const s of room.spectators) send(s, msg);
      return;
    }
  }
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('message', (raw) => {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m && typeof m.t === 'string') handle(ws, m);
  });
  ws.on('close', () => detach(ws));
});

// Keep connections alive and drop dead ones
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
  queueInfo();
}, 30000);

// Remove rooms nobody has touched for a while
setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    const online = r.players.some((p) => p?.ws) || r.spectators.size > 0;
    const idle = now - r.last;
    if ((!online && idle > 60 * 60 * 1000) || idle > 24 * 60 * 60 * 1000) {
      clearTimeout(r.timer);
      rooms.delete(code);
    }
  }
}, 5 * 60 * 1000);

server.listen(PORT, HOST, () => console.log(`Dots running at http://${HOST || 'localhost'}:${PORT}`));
