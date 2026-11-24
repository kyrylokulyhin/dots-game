import { Game, SIZES, TARGETS, MOVE_TIMES, PASS } from './game.js';
import { BoardView } from './board.js';
import { botMove } from './bot.js';
import { STRINGS, randomName, detectLang } from './i18n.js';

const $ = (id) => document.getElementById(id);
const PALETTE = ['#f2c200', '#2d7ff9', '#e5484d', '#2ead5b', '#8e4ec6', '#f76b15', '#e93d82', '#12a594', '#3a3a3a'];
const REACTIONS = ['👍', '😮', '😂', '😤', '🔥', '🤝'];

// ---------------------------------------------------------------- storage (best effort)
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

const lang0 = store.get('dots.lang', detectLang());
const profile = Object.assign(
  {
    name1: randomName(lang0),
    color1: '#f2c200',
    name2: randomName(lang0),
    color2: '#2d7ff9',
    size: 2,
    target: 0,
    moveTime: 0,
    start: 'cross',
    tapConfirm: matchMedia('(pointer: coarse)').matches,
    theme: 'system',
    lang: lang0,
  },
  store.get('dots.profile', {})
);

// Signed-in account (optional): { token, username }
let auth = store.get('dots.auth', null);

let syncTimer;
function saveProfile() {
  store.set('dots.profile', profile);
  store.set('dots.lang', profile.lang);
  if (!auth) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => api('PUT', '/settings', { settings: profile }).catch(() => {}), 800);
}

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = 'Bearer ' + auth.token;
  let r;
  try {
    r = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw Object.assign(new Error('network'), { code: 'network' });
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'error'), { code: j.error || 'network', status: r.status });
  return j;
}

// ---------------------------------------------------------------- themes
const THEMES = {
  system: null,
  light: { p: '#fbfaf5', g: '#cddcf0' },
  dark: { p: '#1e2530', g: '#2f3b4d' },
  notebook: { p: '#fffdf5', g: '#a9c4ea' },
  chalk: { p: '#223a2e', g: 'rgba(255,255,255,.18)' },
  ocean: { p: '#162d44', g: '#24435f' },
};
const darkMq = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  let th = THEMES[profile.theme] !== undefined ? profile.theme : 'system';
  if (th === 'system') th = darkMq.matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = th;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  board?.draw();
}
darkMq.addEventListener?.('change', applyTheme);

function buildThemes() {
  const el = $('themeSeg');
  el.innerHTML = '';
  for (const [k, v] of Object.entries(THEMES)) {
    const b = document.createElement('button');
    b.className = 'theme-btn' + (profile.theme === k ? ' on' : '');
    const prev = document.createElement('span');
    prev.className = 'theme-prev';
    const look = v || (darkMq.matches ? THEMES.dark : THEMES.light);
    prev.style.setProperty('--p', look.p);
    prev.style.setProperty('--g', look.g);
    if (!v) prev.style.backgroundImage = `linear-gradient(135deg, ${THEMES.light.p} 50%, ${THEMES.dark.p} 50%)`;
    const label = document.createElement('span');
    label.textContent = t('themes')[k];
    b.append(prev, label);
    b.onclick = () => {
      profile.theme = k;
      saveProfile();
      applyTheme();
      buildThemes();
    };
    el.append(b);
  }
}

// ---------------------------------------------------------------- i18n
let lang = STRINGS[profile.lang] ? profile.lang : 'en';
const t = (k, vars = {}) => {
  let s = STRINGS[lang][k] ?? STRINGS.en[k] ?? k;
  if (typeof s === 'string') for (const [a, b] of Object.entries(vars)) s = s.replace(`{${a}}`, b);
  return s;
};

function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
  document.querySelectorAll('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle)));
  document.querySelectorAll('[data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
  $('rulesList').innerHTML = '';
  for (const r of t('rules')) {
    const li = document.createElement('li');
    li.textContent = r;
    $('rulesList').append(li);
  }
  buildSettings();
  buildThemes();
  renderAccount();
  if (!$('history').hidden) renderHistory();
  if (S.mode) render();
}

// ---------------------------------------------------------------- toast
let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// ---------------------------------------------------------------- home screen
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function clash(a, b) {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2) < 90;
}

function buildSwatches(el, key, otherKey) {
  el.innerHTML = '';
  const current = profile[key];
  const colors = PALETTE.includes(current) ? PALETTE : [...PALETTE, current];
  for (const c of colors) {
    const b = document.createElement('button');
    b.className = 'sw' + (c === current ? ' on' : '');
    b.style.setProperty('--c', c);
    b.setAttribute('aria-label', c);
    b.disabled = otherKey && clash(c, profile[otherKey]);
    b.onclick = () => setColor(key, c);
    el.append(b);
  }
  const lab = document.createElement('label');
  lab.className = 'sw custom';
  lab.title = t('customColor');
  const inp = document.createElement('input');
  inp.type = 'color';
  inp.value = current;
  inp.oninput = () => setColor(key, inp.value);
  lab.append(inp);
  el.append(lab);
}

function setColor(key, c) {
  profile[key] = c.toLowerCase();
  const other = key === 'color1' ? 'color2' : 'color1';
  if (clash(profile[key], profile[other])) {
    profile[other] = PALETTE.find((p) => !clash(p, profile[key]));
  }
  saveProfile();
  buildSwatches($('sw1'), 'color1');
  buildSwatches($('sw2'), 'color2', 'color1');
}

function buildSeg(el, items, current, onPick) {
  el.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.textContent = it.label;
    b.classList.toggle('on', it.v === current);
    b.onclick = () => {
      onPick(it.v);
      buildSettings();
    };
    el.append(b);
  }
}

function buildSettings() {
  buildSeg(
    $('sizeSeg'),
    SIZES.map((s, i) => ({ v: i, label: `${s.w}×${s.h}` })),
    profile.size,
    (v) => ((profile.size = v), saveProfile())
  );
  buildSeg(
    $('targetSeg'),
    TARGETS.map((n) => ({ v: n, label: n ? String(n) : t('noLimit') })),
    profile.target,
    (v) => ((profile.target = v), saveProfile())
  );
  buildSeg(
    $('timeSeg'),
    MOVE_TIMES.map((n) => ({ v: n, label: n ? t('secs', { n }) : t('off') })),
    profile.moveTime,
    (v) => ((profile.moveTime = v), saveProfile())
  );
  $('startSeg')
    .querySelectorAll('button')
    .forEach((b) => {
      b.classList.toggle('on', b.dataset.v === profile.start);
      b.onclick = () => {
        profile.start = b.dataset.v;
        saveProfile();
        buildSettings();
      };
    });
}

function settingsOpts() {
  const s = SIZES[profile.size] || SIZES[2];
  return { w: s.w, h: s.h, start: profile.start, target: profile.target, moveTime: profile.moveTime };
}

function initHome() {
  $('name1').value = profile.name1;
  $('name2').value = profile.name2;
  $('name1').oninput = () => ((profile.name1 = $('name1').value), saveProfile());
  $('name2').oninput = () => ((profile.name2 = $('name2').value), saveProfile());
  $('dice1').onclick = () => {
    $('name1').value = profile.name1 = randomName(lang);
    saveProfile();
  };
  $('dice2').onclick = () => {
    $('name2').value = profile.name2 = randomName(lang);
    saveProfile();
  };
  buildSwatches($('sw1'), 'color1');
  buildSwatches($('sw2'), 'color2', 'color1');
  $('tapConfirm').checked = profile.tapConfirm;
  $('tapConfirm').onchange = () => {
    profile.tapConfirm = $('tapConfirm').checked;
    saveProfile();
  };
  document.querySelectorAll('[data-lang]').forEach(
    (b) =>
      (b.onclick = () => {
        lang = profile.lang = b.dataset.lang;
        saveProfile();
        applyLang();
      })
  );

  $('findBtn').onclick = startSearch;
  $('searchCancel').onclick = cancelSearch;
  $('searchDlg').addEventListener('cancel', (e) => {
    e.preventDefault();
    cancelSearch();
  });
  $('settingsOpen').onclick = () => {
    $('authErr').textContent = '';
    $('settingsDlg').showModal();
  };
  $('settingsClose').onclick = () => $('settingsDlg').close();
  $('settingsDlg').addEventListener('click', (e) => e.target === $('settingsDlg') && $('settingsDlg').close());
  $('acctChip').onclick = () => $('settingsOpen').click();
  $('historyOpen').onclick = () => {
    show('history');
    renderHistory();
  };
  $('historyBack').onclick = () => show('home');
  $('authForm').onsubmit = (e) => {
    e.preventDefault();
    doAuth('login');
  };
  $('registerBtn').onclick = () => doAuth('register');
  $('logoutBtn').onclick = logout;

  $('createBtn').onclick = () => startOnline({ t: 'create', ...settingsOpts() });
  $('joinBtn').onclick = () => joinByCode($('joinCode').value);
  $('joinCode').onkeydown = (e) => e.key === 'Enter' && joinByCode($('joinCode').value);
  $('joinCode').oninput = () => ($('joinCode').value = $('joinCode').value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  $('localBtn').onclick = () => startLocal('local');
  $('botBtn').onclick = () => startLocal('bot');
}

function myName() {
  return (profile.name1 || '').trim() || randomName(lang);
}

function joinByCode(code) {
  code = String(code || '').toUpperCase().trim();
  if (code.length < 4) {
    $('joinCode').focus();
    return;
  }
  startOnline({ t: 'join', code });
}

// ---------------------------------------------------------------- game session state
const S = {
  mode: null, // 'online' | 'local' | 'bot'
  game: null,
  opts: null,
  first: 0,
  players: [null, null],
  seat: null, // online: 0/1/-1(spectator); local: null; bot: 0
  status: 'playing',
  result: null,
  endOffer: -1,
  rematch: [false, false],
  spectators: 0,
  code: null,
  connected: false,
  deadline: null, // performance.now() timestamp when the current move's time runs out
};

const board = new BoardView($('board'), $('boardWrap'), onPick);
board.onBlocked = (why) => {
  const g = S.game;
  if (!g) return;
  if (why === 'occupied') return toast(t('badMove'));
  if (S.status === 'ended') return;
  if (S.mode === 'online' && S.status === 'waiting') return toast(t('waiting'));
  if (S.mode === 'online' && !S.connected) return toast(t('reconnecting'));
  if (S.mode === 'online' && S.seat < 0) return toast(t('spectating'));
  if (S.status === 'playing') toast(t('waitMove', { name: S.players[g.turn]?.name || '' }));
};

// ---------------------------------------------------------------- zoomed-in focus mode
let focusEntry = false; // whether we pushed a history entry for focus (so Back exits it)
let hintTimer;
function onFocusChange(focused) {
  $('play').classList.toggle('focus', focused);
  if (focused && !focusEntry && !$('play').hidden) {
    history.pushState({ focus: true }, '', location.href);
    focusEntry = true;
  } else if (!focused && focusEntry) {
    focusEntry = false;
    history.back();
  }
  const hint = $('focusHint');
  clearTimeout(hintTimer);
  hint.hidden = true;
  if (focused && !store.get('dots.focusHintSeen', false)) {
    store.set('dots.focusHintSeen', true);
    hint.textContent = t('focusHint');
    hint.hidden = false;
    hintTimer = setTimeout(() => (hint.hidden = true), 4000);
  }
}

function show(screen) {
  if (screen !== 'play' && board.focused) {
    board.zoom = 1;
    board.focused = false;
    board.canvas.classList.remove('zoomed');
    $('play').classList.remove('focus');
    // Leave the extra history entry in place: going back now would restore an old URL
    focusEntry = false;
  }
  $('home').hidden = screen !== 'home';
  $('play').hidden = screen !== 'play';
  $('history').hidden = screen !== 'history';
  if (screen === 'play') requestAnimationFrame(() => board.layout());
  if (screen === 'home') refreshOnline();
  window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- account
function renderAccount() {
  $('acctOut').hidden = !!auth;
  $('acctIn').hidden = !auth;
  $('acctName').textContent = auth?.username || '';
  $('acctChip').textContent = auth ? '👤 ' + auth.username : '👤 ' + t('guest');
}

function mergeSettings(s) {
  if (!s || typeof s !== 'object') return;
  Object.assign(profile, s);
  store.set('dots.profile', profile);
  if (STRINGS[profile.lang]) lang = profile.lang;
  $('name1').value = profile.name1;
  $('name2').value = profile.name2;
  $('tapConfirm').checked = profile.tapConfirm;
  buildSwatches($('sw1'), 'color1');
  buildSwatches($('sw2'), 'color2', 'color1');
  applyTheme();
  applyLang();
}

async function doAuth(kind) {
  const username = $('authUser').value.trim();
  const password = $('authPass').value;
  $('authErr').textContent = '';
  $('loginBtn').disabled = $('registerBtn').disabled = true;
  try {
    const body = { username, password };
    if (kind === 'register') body.settings = profile;
    const r = await api('POST', '/' + kind, body);
    auth = { token: r.token, username: r.user.username };
    store.set('dots.auth', auth);
    $('authPass').value = '';
    if (kind === 'login') mergeSettings(r.settings);
    await importLocalHistory();
    renderAccount();
    $('settingsDlg').close();
    toast(t('welcome', { name: auth.username }));
    if (!$('history').hidden) renderHistory();
  } catch (e) {
    $('authErr').textContent = t('errors')[e.code] || t('errors').network;
  } finally {
    $('loginBtn').disabled = $('registerBtn').disabled = false;
  }
}

async function logout() {
  api('POST', '/logout').catch(() => {});
  auth = null;
  store.set('dots.auth', null);
  renderAccount();
  if (!$('history').hidden) renderHistory();
}

async function checkAuth() {
  if (!auth) return;
  try {
    const r = await api('GET', '/me');
    auth.username = r.user.username;
    mergeSettings(r.settings);
  } catch (e) {
    if (e.status === 401) {
      auth = null;
      store.set('dots.auth', null);
    }
  }
  renderAccount();
}

// ---------------------------------------------------------------- history
const LOCAL_HIST = 'dots.history';

function recordGame() {
  const g = S.game;
  if (!g || !S.result) return;
  const entry = {
    at: Date.now(),
    mode: S.mode,
    w: g.w,
    h: g.h,
    names: S.players.map((p) => p?.name || ''),
    colors: S.players.map((p) => p?.color || '#888888'),
    scores: g.score.slice(),
    winner: S.result.winner,
    reason: S.result.type,
    me: S.mode === 'online' ? S.seat : S.mode === 'bot' ? 0 : -1,
    moves: g.moves.length,
  };
  if (auth) {
    // Online games of signed-in players are saved by the server
    if (S.mode !== 'online') api('POST', '/history', { game: entry }).catch(() => saveLocal(entry));
  } else saveLocal(entry);
}

function saveLocal(entry) {
  const list = store.get(LOCAL_HIST, []);
  list.unshift(entry);
  store.set(LOCAL_HIST, list.slice(0, 300));
}

async function importLocalHistory() {
  const list = store.get(LOCAL_HIST, []);
  if (!list.length || !auth) return;
  try {
    await api('POST', '/history', { games: list });
    store.set(LOCAL_HIST, []);
  } catch {}
}

async function renderHistory() {
  let games = [];
  const note = $('historyNote');
  note.innerHTML = '';
  if (auth) {
    note.textContent = t('accountHistory', { name: auth.username });
    try {
      games = (await api('GET', '/history')).games;
    } catch {
      games = store.get(LOCAL_HIST, []);
    }
  } else {
    games = store.get(LOCAL_HIST, []);
    const p = document.createElement('div');
    p.textContent = t('localHistory');
    const b = document.createElement('button');
    b.textContent = t('signIn');
    b.onclick = () => $('settingsOpen').click();
    note.append(p, b);
  }

  // Stats only count games with a "me" (online and vs computer)
  const mine = games.filter((g) => g.me >= 0);
  const won = mine.filter((g) => g.winner === g.me).length;
  const lost = mine.filter((g) => g.winner >= 0 && g.winner !== g.me).length;
  const stats = [
    [games.length, t('played')],
    [won, t('wonN')],
    [lost, t('lostN')],
    [mine.length ? Math.round((100 * won) / mine.length) + '%' : '—', t('winRate')],
  ];
  $('stats').innerHTML = '';
  for (const [v, l] of stats) {
    const d = document.createElement('div');
    d.className = 'stat';
    d.innerHTML = '<b></b><span></span>';
    d.querySelector('b').textContent = v;
    d.querySelector('span').textContent = l;
    $('stats').append(d);
  }

  const ul = $('histList');
  ul.innerHTML = '';
  $('histEmpty').hidden = games.length > 0;
  const fmt = new Intl.DateTimeFormat(lang === 'uk' ? 'uk-UA' : 'en', { dateStyle: 'medium', timeStyle: 'short' });
  const icons = { online: '🌐', local: '👥', bot: '🤖' };
  for (const g of games) {
    const li = document.createElement('li');
    const a = g.me >= 0 ? g.me : 0;
    const b = 1 - a;
    let badge;
    if (g.me >= 0) {
      const k = g.winner === -1 ? 'draw' : g.winner === g.me ? 'win' : 'loss';
      badge = `<span class="badge ${k}">${t(k === 'draw' ? 'drawShort' : k)}</span>`;
    } else badge = `<span class="badge na"></span>`;
    li.innerHTML = `<span class="mode"></span><div class="who"><div></div><small></small></div><span class="score"></span>${badge}`;
    li.querySelector('.mode').textContent = icons[g.mode] || '•';
    li.querySelector('.who div').textContent = `${g.names[a]} — ${g.names[b]}`;
    li.querySelector('.who small').textContent = `${fmt.format(new Date(g.at))} · ${g.w}×${g.h}`;
    const sc = li.querySelector('.score');
    const dot = (c) => {
      const i = document.createElement('i');
      i.className = 'dot';
      i.style.background = c;
      return i;
    };
    sc.append(dot(g.colors[a]), `${g.scores[a]} : ${g.scores[b]}`, dot(g.colors[b]));
    if (g.me < 0) li.querySelector('.badge').textContent = g.winner >= 0 ? t('wonBy', { name: g.names[g.winner] }) : t('drawShort');
    ul.append(li);
  }
}

// ---------------------------------------------------------------- online count & matchmaking
let onlineTimer;
async function refreshOnline() {
  clearTimeout(onlineTimer);
  if ($('home').hidden) return;
  try {
    const r = await api('GET', '/online');
    $('onlineCount').textContent = t('onlineNow', { n: r.online });
  } catch {
    $('onlineCount').textContent = '';
  }
  onlineTimer = setTimeout(refreshOnline, 15000);
}

function startSearch() {
  startOnline({ t: 'queue', ...settingsOpts() });
  $('searchInfo').textContent = '';
  $('searchDlg').showModal();
}

function cancelSearch() {
  if ($('searchDlg').open) $('searchDlg').close();
  if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'unqueue' }));
  goHome();
}

function onPick(i) {
  if (S.mode === 'online') {
    ws?.send(JSON.stringify({ t: 'move', i }));
    return;
  }
  if (!S.game.place(i)) return;
  afterLocalMove();
}

function armLocalTimer() {
  const secs = S.opts?.moveTime;
  const botTurn = S.mode === 'bot' && S.game.turn === 1;
  S.deadline = secs && S.status === 'playing' && !botTurn ? performance.now() + secs * 1000 : null;
}

function endLocal(result) {
  if (S.status === 'ended') return;
  S.status = 'ended';
  S.result = result;
  recordGame();
}

function afterLocalMove() {
  if (S.game.over) {
    endLocal(
      S.game.forfeit >= 0 ? { type: 'timeout', winner: 1 - S.game.forfeit } : { type: 'score', winner: S.game.leader() }
    );
  }
  armLocalTimer();
  render();
  if (S.mode === 'bot' && S.status === 'playing' && S.game.turn === 1) {
    setTimeout(() => {
      if (S.mode !== 'bot' || S.status !== 'playing' || S.game.turn !== 1) return;
      const m = botMove(S.game);
      if (m >= 0) S.game.place(m);
      afterLocalMove();
    }, 450);
  }
}

function startLocal(mode) {
  closeOnline();
  S.mode = mode;
  S.opts = settingsOpts();
  S.first = 0;
  S.players = [
    { name: myName(), color: profile.color1, online: true },
    mode === 'bot'
      ? { name: t('computer'), color: profile.color2, online: true }
      : { name: (profile.name2 || '').trim() || randomName(lang), color: profile.color2, online: true },
  ];
  S.seat = mode === 'bot' ? 0 : null;
  newLocalGame();
  show('play');
}

function newLocalGame() {
  S.game = new Game({ ...S.opts, first: S.first });
  S.status = 'playing';
  S.result = null;
  S.endOffer = -1;
  $('endDlg').open && $('endDlg').close();
  render();
  afterLocalMove();
}

// ---------------------------------------------------------------- online
let ws = null;
let pending = null;
let retry = 0;
let retryTimer = null;

function wsUrl() {
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
}

function startOnline(hello) {
  closeOnline();
  S.mode = 'online';
  S.seat = null;
  S.code = hello.code || null;
  S.game = null;
  pending = hello;
  connect();
}

function connect() {
  clearTimeout(retryTimer);
  try {
    ws = new WebSocket(wsUrl());
  } catch {
    scheduleRetry();
    return;
  }
  const sock = ws;
  sock.onopen = () => {
    retry = 0;
    S.connected = true;
    const base = { name: myName(), color: profile.color1, auth: auth?.token };
    if (pending) {
      const msg = { ...base, ...pending };
      if (msg.t === 'join') msg.token = store.get('dots.tok.' + msg.code, null);
      sock.send(JSON.stringify(msg));
    } else if (S.code) {
      sock.send(JSON.stringify({ ...base, t: 'join', code: S.code, token: store.get('dots.tok.' + S.code, null) }));
    }
    if (S.game) render();
  };
  sock.onmessage = (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    onServer(m);
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    S.connected = false;
    if (S.mode === 'online') {
      if (S.game) render();
      scheduleRetry();
    }
  };
}

function scheduleRetry() {
  if (S.mode !== 'online') return;
  if (!S.game && retry === 0) toast(t('connError'));
  retry++;
  retryTimer = setTimeout(connect, Math.min(8000, 500 * 2 ** retry));
}

function closeOnline() {
  clearTimeout(retryTimer);
  if (ws) {
    const sock = ws;
    ws = null;
    try {
      if (sock.readyState === 1) sock.send(JSON.stringify({ t: 'leave' }));
      sock.close();
    } catch {}
  }
  S.connected = false;
  pending = null;
  if (location.search) history.replaceState(null, '', location.pathname);
}

function onServer(m) {
  if (m.t === 'joined') {
    pending = null;
    S.code = m.code;
    S.seat = m.seat;
    if (m.token) store.set('dots.tok.' + m.code, m.token);
    history.replaceState(null, '', '?room=' + m.code);
    if ($('searchDlg').open) {
      $('searchDlg').close();
      toast(t('matched'));
    }
    show('play');
    return;
  }
  if (m.t === 'queue') {
    $('searchInfo').textContent = t('searchInfo', { online: m.online, waiting: m.waiting });
    return;
  }
  if (m.t === 'error') {
    if (m.code === 'noRoom') {
      toast(t('noRoom'));
      S.mode = null;
      closeOnline();
      show('home');
    } else if (m.code === 'replaced') {
      toast(t('replaced'));
      S.mode = null;
      ws = null;
      show('home');
    } else toast(t(m.code));
    return;
  }
  if (m.t === 'react') {
    floatReaction(m.e, m.seat);
    return;
  }
  if (m.t === 'state') {
    const justEnded = S.status === 'playing' && m.status === 'ended' && S.game;
    S.seat = m.you;
    S.players = m.players;
    S.status = m.status;
    S.result = m.result;
    S.endOffer = m.endOffer;
    S.rematch = m.rematch;
    S.spectators = m.spectators;
    S.deadline = m.timeLeft == null ? null : performance.now() + m.timeLeft;
    // Apply moves incrementally when possible
    const same =
      S.game &&
      S.first === m.first &&
      JSON.stringify(S.opts) === JSON.stringify(m.opts) &&
      S.game.moves.length <= m.moves.length &&
      S.game.moves.every((v, k) => v === m.moves[k]);
    if (!same) {
      S.opts = m.opts;
      S.first = m.first;
      S.game = Game.fromMoves({ ...m.opts, first: m.first }, m.moves);
    } else {
      for (let k = S.game.moves.length; k < m.moves.length; k++) {
        if (m.moves[k] === PASS) {
          toast(t('timedOut', { name: S.players[S.game.turn]?.name || '' }));
          S.game.pass();
        } else S.game.place(m.moves[k]);
      }
    }
    if (justEnded && S.seat >= 0) recordGame();
    render();
  }
}

function inviteLink() {
  return `${location.origin}${location.pathname}?room=${S.code}`;
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(t('copied'));
}

async function share() {
  const data = { title: 'Dots', text: `${t('roomCode')}: ${S.code}`, url: inviteLink() };
  if (navigator.share) {
    try {
      await navigator.share(data);
      return;
    } catch {
      return;
    }
  }
  copy(inviteLink());
}

// ---------------------------------------------------------------- rendering the game screen
function render() {
  const g = S.game;
  if (!g) return;
  const P = S.players;
  const colors = [P[0]?.color || profile.color1, P[1]?.color || profile.color2];

  // Player chips
  for (let s = 0; s < 2; s++) {
    const chip = $('chip' + s);
    const p = P[s];
    chip.querySelector('.dot').style.background = colors[s];
    chip.querySelector('.nm').textContent = p ? p.name : '…';
    chip.querySelector('.sc').textContent = g.score[s];
    chip.classList.toggle('turn', S.status === 'playing' && g.turn === s);
    chip.classList.toggle('me', S.mode === 'online' && S.seat === s);
    chip.classList.toggle('off', S.mode === 'online' && !!p && !p.online);
    chip.title = p && !p.online ? t('offline') : '';
  }

  const waiting = S.mode === 'online' && S.status === 'waiting';
  $('lobby').hidden = !waiting;
  $('lobbyCode').textContent = S.code || '';
  $('inviteBtn').hidden = S.mode !== 'online';

  // Status line
  let status = '';
  const turnName = P[g.turn]?.name || '';
  if (S.mode === 'online' && !S.connected) status = t('reconnecting');
  else if (waiting) status = t('waiting');
  else if (S.status === 'playing') {
    if (S.mode === 'local') status = t('turnOf', { name: turnName });
    else if (S.mode === 'bot') status = g.turn === 0 ? t('yourTurn') : t('thinking', { name: turnName });
    else if (S.seat === -1) status = `${t('spectating')} · ${t('turnOf', { name: turnName })}`;
    else status = g.turn === S.seat ? t('yourTurn') : t('turnOf', { name: turnName });
  }
  const extras = [];
  if (S.opts?.target) extras.push(t('target_short', { n: S.opts.target }));
  if (S.opts?.moveTime) extras.push('⏱ ' + t('secs', { n: S.opts.moveTime }));
  if (S.mode === 'online' && S.spectators) extras.push(t('spectators', { n: S.spectators }));
  $('status').textContent = [status, ...extras].filter(Boolean).join(' · ');
  $('status').style.setProperty('--c', colors[g.turn]);

  // End-game offer
  const offerFromOpp = S.mode === 'online' && S.status === 'playing' && S.endOffer >= 0 && S.seat >= 0 && S.endOffer !== S.seat;
  const offerMine = S.mode === 'online' && S.status === 'playing' && S.endOffer === S.seat && S.seat >= 0;
  $('offerBar').hidden = !(offerFromOpp || offerMine);
  $('offerText').textContent = offerFromOpp ? t('offerFrom', { name: P[S.endOffer]?.name }) : t('offerSent');
  $('offerYes').hidden = $('offerNo').hidden = !offerFromOpp;

  // Toolbar
  const isPlayer = S.mode !== 'online' || S.seat >= 0;
  const playing = S.status === 'playing';
  $('undoBtn').hidden = S.mode === 'online';
  $('undoBtn').disabled = !playing || g.moves.length === 0;
  $('endBtn').textContent = S.mode === 'online' ? t('offerFinish') : t('finish');
  $('endBtn').hidden = !isPlayer;
  $('endBtn').disabled = !playing || offerMine;
  $('resignBtn').hidden = !isPlayer;
  $('resignBtn').disabled = !playing;
  $('reacts').hidden = S.mode !== 'online' || S.seat < 0;

  const interactive =
    playing &&
    (S.mode === 'local' || (S.mode === 'bot' && g.turn === 0) || (S.mode === 'online' && S.connected && S.seat === g.turn));
  board.confirmTouch = profile.tapConfirm;
  board.set(g, colors, interactive);

  renderEnd(colors);
}

function renderEnd(colors) {
  const dlg = $('endDlg');
  if (S.status !== 'ended' || !S.result) {
    if (dlg.open) dlg.close();
    return;
  }
  const g = S.game;
  const P = S.players;
  const { type, winner } = S.result;
  $('endTitle').textContent = winner >= 0 ? t('wins', { name: P[winner]?.name }) : t('draw');
  $('endTitle').style.color = winner >= 0 ? colors[winner] : '';
  let sub = '';
  if (type === 'resign') sub = t('byResign', { name: P[1 - winner]?.name });
  else if (type === 'timeout') sub = t('byTimeout', { name: P[1 - winner]?.name });
  else if (type === 'agreed') sub = t('byAgree');
  else if (S.opts?.target && Math.max(...g.score) >= S.opts.target) sub = t('byTarget', { n: S.opts.target });
  else if (type === 'score') sub = t('byFull');
  $('endSub').textContent = sub;
  $('endScore').innerHTML = '';
  for (let s = 0; s < 2; s++) {
    const d = document.createElement('div');
    d.className = 'fs';
    d.innerHTML = '<i class="dot"></i><span class="nm"></span><b></b>';
    d.querySelector('.dot').style.background = colors[s];
    d.querySelector('.nm').textContent = P[s]?.name || '';
    d.querySelector('b').textContent = g.score[s];
    $('endScore').append(d);
  }
  let note = '';
  const rb = $('rematchBtn');
  rb.hidden = S.mode === 'online' && S.seat < 0;
  rb.disabled = false;
  if (S.mode === 'online' && S.seat >= 0) {
    if (S.rematch[S.seat]) {
      note = t('rematchWait');
      rb.disabled = true;
    } else if (S.rematch[1 - S.seat]) note = t('rematchAsk', { name: P[1 - S.seat]?.name });
  }
  $('endNote').textContent = note;
  if (!dlg.open) {
    // Let the final move render before the dialog pops
    setTimeout(() => S.status === 'ended' && !dlg.open && dlg.showModal(), 500);
  }
}

// ---------------------------------------------------------------- reactions
function floatReaction(e, seat) {
  const el = document.createElement('div');
  el.className = 'rf';
  el.textContent = e;
  el.style.left = (seat === 0 ? 20 : 70) + Math.random() * 10 + '%';
  $('reactFloat').append(el);
  setTimeout(() => el.remove(), 2200);
}

function initPlay() {
  for (const e of REACTIONS) {
    const b = document.createElement('button');
    b.textContent = e;
    b.onclick = () => ws?.readyState === 1 && ws.send(JSON.stringify({ t: 'react', e }));
    $('reacts').append(b);
  }
  $('leaveBtn').onclick = () => {
    if (S.status === 'playing' && S.game?.moves.length && !(S.mode === 'online' && S.seat < 0)) {
      if (!confirm(t('confirmLeave'))) return;
    }
    goHome();
  };
  $('lobbyCancel').onclick = goHome;
  $('copyLink').onclick = () => copy(inviteLink());
  $('copyCode').onclick = () => copy(S.code);
  $('shareBtn').onclick = share;
  $('inviteBtn').onclick = share;
  $('zoomIn').onclick = () => board.zoomBy(1.5);
  $('zoomOut').onclick = () => board.zoomBy(1 / 1.5);
  $('focusClose').onclick = () => board.exitFocus();
  board.attachMinimap($('minimap'));
  board.onFocusChange = onFocusChange;
  window.addEventListener('popstate', () => {
    // Phone "back" while zoomed in: return to the whole board instead of leaving
    if (focusEntry) {
      focusEntry = false;
      board.exitFocus();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && board.focused && !$('play').hidden) board.exitFocus();
  });
  $('undoBtn').onclick = () => {
    const g = S.game;
    if (!g.moves.length) return;
    let moves = g.moves.slice(0, -1);
    // Against the computer, undo back to the human's turn
    if (S.mode === 'bot') {
      let tmp = Game.fromMoves({ ...S.opts, first: S.first }, moves);
      while (tmp.turn !== 0 && moves.length) {
        moves = moves.slice(0, -1);
        tmp = Game.fromMoves({ ...S.opts, first: S.first }, moves);
      }
      S.game = tmp;
    } else S.game = Game.fromMoves({ ...S.opts, first: S.first }, moves);
    armLocalTimer();
    render();
  };
  $('endBtn').onclick = () => {
    if (S.mode === 'online') ws?.send(JSON.stringify({ t: 'offerEnd' }));
    else {
      endLocal({ type: 'agreed', winner: S.game.leader() });
      render();
    }
  };
  $('resignBtn').onclick = () => {
    if (!confirm(t('confirmResign'))) return;
    if (S.mode === 'online') ws?.send(JSON.stringify({ t: 'resign' }));
    else {
      const loser = S.mode === 'bot' ? 0 : S.game.turn;
      endLocal({ type: 'resign', winner: 1 - loser });
      render();
    }
  };
  $('offerYes').onclick = () => ws?.send(JSON.stringify({ t: 'answerEnd', accept: true }));
  $('offerNo').onclick = () => ws?.send(JSON.stringify({ t: 'answerEnd', accept: false }));
  $('rematchBtn').onclick = () => {
    if (S.mode === 'online') ws?.send(JSON.stringify({ t: 'rematch' }));
    else {
      S.first = 1 - S.first;
      newLocalGame();
    }
  };
  $('homeBtn').onclick = goHome;
  $('endDlg').addEventListener('cancel', (e) => e.preventDefault());
}

function goHome() {
  closeOnline();
  S.mode = null;
  S.game = null;
  if ($('endDlg').open) $('endDlg').close();
  $('inviteCard').hidden = true;
  show('home');
}

// ---------------------------------------------------------------- move timer
let lastTimerText = '';
function tick() {
  requestAnimationFrame(tick);
  const g = S.game;
  const active = g && S.deadline != null && S.status === 'playing' && S.opts?.moveTime;
  const bar = $('timer');
  if (!active) {
    if (!bar.hidden) {
      bar.hidden = true;
      $('chip0').querySelector('.tm').textContent = '';
      $('chip1').querySelector('.tm').textContent = '';
      lastTimerText = '';
    }
    return;
  }
  const total = S.opts.moveTime * 1000;
  const left = Math.max(0, S.deadline - performance.now());
  const low = left <= 3000;
  bar.hidden = false;
  bar.classList.toggle('low', low);
  bar.style.setProperty('--c', S.players[g.turn]?.color || '');
  bar.firstElementChild.style.width = (100 * left) / total + '%';
  const text = String(Math.ceil(left / 1000));
  const key = g.turn + ':' + text;
  if (key !== lastTimerText) {
    lastTimerText = key;
    for (let s = 0; s < 2; s++) {
      const tm = $('chip' + s).querySelector('.tm');
      tm.textContent = s === g.turn ? text : '';
      tm.classList.toggle('low', s === g.turn && low);
    }
  }
  // Online, the server decides when time is up; locally we do.
  if (left <= 0 && S.mode !== 'online') {
    toast(t('timedOut', { name: S.players[g.turn]?.name || '' }));
    g.pass();
    afterLocalMove();
  }
}
requestAnimationFrame(tick);

// ---------------------------------------------------------------- boot
initHome();
initPlay();
applyTheme();
applyLang();
checkAuth();
refreshOnline();

const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) {
  const code = roomParam.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  if (store.get('dots.tok.' + code, null)) {
    // We already have a seat in this room: reconnect straight away
    startOnline({ t: 'join', code });
  } else {
    $('inviteCard').hidden = false;
    $('inviteCode').textContent = code;
    $('joinCode').value = code;
    $('inviteJoin').onclick = () => joinByCode(code);
  }
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
