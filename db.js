// Accounts, sessions and game history in SQLite (built into Node 22.13+).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(crypto.scrypt);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DIR, { recursive: true });

const db = new DatabaseSync(path.join(DIR, 'dots.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    settings TEXT NOT NULL DEFAULT '{}',
    created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    at INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS games_user ON games (user_id, at DESC);
`);

const q = {
  insertUser: db.prepare('INSERT INTO users (username, hash, salt, created) VALUES (?, ?, ?, ?)'),
  userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
  userById: db.prepare('SELECT id, username, settings FROM users WHERE id = ?'),
  insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created) VALUES (?, ?, ?)'),
  sessionUser: db.prepare('SELECT user_id FROM sessions WHERE token_hash = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  saveSettings: db.prepare('UPDATE users SET settings = ? WHERE id = ?'),
  insertGame: db.prepare('INSERT INTO games (user_id, at, data) VALUES (?, ?, ?)'),
  listGames: db.prepare('SELECT data FROM games WHERE user_id = ? ORDER BY at DESC LIMIT ?'),
  trimGames: db.prepare(
    'DELETE FROM games WHERE user_id = ? AND id NOT IN (SELECT id FROM games WHERE user_id = ? ORDER BY at DESC LIMIT 1000)'
  ),
};

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export const USERNAME_RE = /^[\p{L}\p{N}_.-]{3,20}$/u;

export async function createUser(username, password) {
  if (q.userByName.get(username)) throw new Error('taken');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  try {
    const r = q.insertUser.run(username, hash, salt, Date.now());
    return { id: Number(r.lastInsertRowid), username };
  } catch {
    throw new Error('taken');
  }
}

export async function verifyUser(username, password) {
  const u = q.userByName.get(username);
  // Hash anyway so timing doesn't reveal whether the user exists
  const salt = u ? u.salt : 'x'.repeat(32);
  const hash = await scrypt(password, salt, 64);
  if (!u) return null;
  return crypto.timingSafeEqual(hash, Buffer.from(u.hash, 'hex')) ? { id: u.id, username: u.username } : null;
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  q.insertSession.run(sha(token), userId, Date.now());
  return token;
}

export function userByToken(token) {
  if (!token || typeof token !== 'string' || token.length > 128) return null;
  const s = q.sessionUser.get(sha(token));
  if (!s) return null;
  const u = q.userById.get(s.user_id);
  if (!u) return null;
  let settings = {};
  try {
    settings = JSON.parse(u.settings);
  } catch {}
  return { id: u.id, username: u.username, settings };
}

export function deleteSession(token) {
  if (token) q.deleteSession.run(sha(token));
}

export function saveSettings(userId, settings) {
  q.saveSettings.run(JSON.stringify(settings), userId);
}

export function addGame(userId, data) {
  q.insertGame.run(userId, data.at, JSON.stringify(data));
}

export function addGames(userId, list) {
  db.exec('BEGIN');
  try {
    for (const g of list) q.insertGame.run(userId, g.at, JSON.stringify(g));
    q.trimGames.run(userId, userId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function listGames(userId, limit = 300) {
  return q.listGames.all(userId, limit).map((r) => JSON.parse(r.data));
}
