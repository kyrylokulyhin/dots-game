// Integration test: starts the server on a spare port with a temporary database.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dots-test-'));
const BASE = `http://localhost:${PORT}`;

const srv = spawn(process.execPath, ['--no-warnings', 'server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((res) => srv.stdout.on('data', (d) => String(d).includes('running') && res()));

const api = async (method, p, body, token) => {
  const r = await fetch(BASE + '/api' + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
};

function client() {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    const w = waiters.findIndex((x) => x.pred(m));
    if (w >= 0) waiters.splice(w, 1)[0].res(m);
    else inbox.push(m);
  });
  return {
    ws,
    open: () => new Promise((r) => ws.on('open', r)),
    send: (m) => ws.send(JSON.stringify(m)),
    wait: (pred) => {
      const i = inbox.findIndex(pred);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((res, rej) => {
        waiters.push({ pred, res });
        setTimeout(() => rej(new Error('timeout waiting for message')), 3000);
      });
    },
  };
}

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log('ok -', name);
}

const user = 'tester_' + Math.random().toString(36).slice(2, 8);
const pass = 'pw-' + Math.random().toString(36).slice(2, 12);
let token;

try {
  await test('register, duplicate, bad login, login', async () => {
    let r = await api('POST', '/register', { username: user, password: pass, settings: { theme: 'chalk', lang: 'uk' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.settings.theme, 'chalk');
    r = await api('POST', '/register', { username: user.toUpperCase(), password: pass });
    assert.equal(r.status, 409);
    r = await api('POST', '/login', { username: user, password: 'wrong-password' });
    assert.equal(r.status, 401);
    r = await api('POST', '/login', { username: user, password: pass });
    assert.equal(r.status, 200);
    token = r.body.token;
  });

  await test('settings sync', async () => {
    await api('PUT', '/settings', { settings: { name1: 'Alex', theme: 'ocean', evil: 'x' } }, token);
    const r = await api('GET', '/me', null, token);
    assert.equal(r.body.settings.name1, 'Alex');
    assert.equal(r.body.settings.theme, 'ocean');
    assert.equal(r.body.settings.evil, undefined);
  });

  await test('history add and list', async () => {
    const g = { at: Date.now(), mode: 'bot', w: 20, h: 20, names: ['Alex', 'CPU'], colors: ['#f2c200', '#2d7ff9'], scores: [3, 1], winner: 0, reason: 'score', me: 0 };
    await api('POST', '/history', { games: [g, { ...g, at: g.at - 1000, winner: 1 }] }, token);
    const r = await api('GET', '/history', null, token);
    assert.equal(r.body.games.length, 2);
    assert.equal(r.body.games[0].winner, 0);
    assert.equal((await api('GET', '/history')).status, 401);
  });

  await test('matchmaking pairs two players and records the online game', async () => {
    const a = client();
    const b = client();
    await Promise.all([a.open(), b.open()]);
    a.send({ t: 'queue', name: 'A', color: '#f2c200', w: 15, h: 15, moveTime: 0, auth: token });
    await a.wait((m) => m.t === 'queue' && m.waiting === 1);
    b.send({ t: 'queue', name: 'B', color: '#f2c200', w: 30, h: 30 });
    const ja = await a.wait((m) => m.t === 'joined');
    const jb = await b.wait((m) => m.t === 'joined');
    assert.equal(ja.code, jb.code);
    assert.equal(ja.seat, 0);
    const st = await b.wait((m) => m.t === 'state' && m.status === 'playing');
    assert.equal(st.opts.w, 15, 'first in queue decides settings');
    assert.notEqual(st.players[1].color, st.players[0].color, 'clashing color replaced');
    b.send({ t: 'resign' });
    await a.wait((m) => m.t === 'state' && m.status === 'ended');
    const r = await api('GET', '/history', null, token);
    assert.equal(r.body.games[0].mode, 'online');
    assert.equal(r.body.games[0].winner, 0);
    assert.equal(r.body.games[0].me, 0);
    a.ws.close();
    b.ws.close();
  });

  await test('cancelling the search leaves the queue', async () => {
    const a = client();
    await a.open();
    a.send({ t: 'queue', name: 'A' });
    await a.wait((m) => m.t === 'queue' && m.waiting === 1);
    a.send({ t: 'unqueue' });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal((await api('GET', '/online')).body.waiting, 0);
    a.ws.close();
  });

  console.log(`\n${passed} server tests passed`);
} finally {
  srv.kill();
  setTimeout(() => fs.rmSync(DATA, { recursive: true, force: true }), 300);
}
