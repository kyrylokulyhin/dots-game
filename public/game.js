// Shared game rules for "Dots" (capture variant). Used by both the browser and the server.
//
// Board: w × h intersections. Players take turns placing a dot on a free intersection.
// A closed chain of your dots (connected orthogonally or diagonally) that surrounds at least one
// active enemy dot captures everything inside. Points inside a captured area are dead: nobody can
// play there. A dot placed inside an enemy's empty enclosure is captured immediately.

export const SIZES = [
  { w: 15, h: 15 },
  { w: 20, h: 20 },
  { w: 30, h: 30 },
  { w: 39, h: 32 },
];
export const TARGETS = [0, 5, 10, 15, 20, 30]; // 0 = no limit (play until the board is full)
export const MOVE_TIMES = [0, 5, 10, 20, 30]; // seconds per move, 0 = no timer
export const PASS = -1; // a skipped turn (ran out of time)
export const MAX_TIMEOUTS = 3; // this many timeouts in a row loses the game

export class Game {
  constructor({ w = 30, h = 30, start = 'cross', first = 0, target = 0 } = {}) {
    this.w = w;
    this.h = h;
    this.start = start;
    this.first = first;
    this.target = target;
    const n = w * h;
    this.owner = new Uint8Array(n); // 0 empty, 1 player one, 2 player two
    this.terr = new Uint8Array(n); // 0 none, otherwise player whose territory covers the point
    this._vis = new Int32Array(n);
    this._stamp = 0;
    this.turn = first; // 0 or 1 — seat to move
    this.moves = [];
    this.score = [0, 0];
    this.last = -1;
    this.over = false;
    this.timeouts = [0, 0]; // consecutive timeouts per seat
    this.forfeit = -1; // seat that lost on timeouts
    if (start === 'cross') this._cross();
  }

  static fromMoves(opts, moves) {
    const g = new Game(opts);
    for (const m of moves) if (!(m === PASS ? g.pass() : g.place(m))) break;
    return g;
  }

  // Skip the current player's turn (time ran out).
  pass() {
    if (this.over) return false;
    this.moves.push(PASS);
    if (++this.timeouts[this.turn] >= MAX_TIMEOUTS) {
      this.over = true;
      this.forfeit = this.turn;
    }
    this.turn = 1 - this.turn;
    return true;
  }

  clone() {
    const g = Object.create(Game.prototype);
    Object.assign(g, this);
    g.owner = this.owner.slice();
    g.terr = this.terr.slice();
    g._vis = new Int32Array(this.w * this.h);
    g._stamp = 0;
    g.moves = this.moves.slice();
    g.score = this.score.slice();
    g.timeouts = this.timeouts.slice();
    return g;
  }

  _cross() {
    const cx = (this.w >> 1) - 1;
    const cy = (this.h >> 1) - 1;
    this.owner[this.idx(cx, cy)] = 1;
    this.owner[this.idx(cx + 1, cy + 1)] = 1;
    this.owner[this.idx(cx + 1, cy)] = 2;
    this.owner[this.idx(cx, cy + 1)] = 2;
  }

  idx(x, y) {
    return y * this.w + x;
  }

  canPlace(i) {
    return !this.over && i >= 0 && i < this.owner.length && this.owner[i] === 0 && this.terr[i] === 0;
  }

  // A dot is "active" for p if it belongs to p and has not been captured by the opponent.
  active(i, p) {
    const t = this.terr[i];
    return this.owner[i] === p && (t === 0 || t === p);
  }

  isCaptured(i) {
    return this.owner[i] !== 0 && this.terr[i] !== 0 && this.terr[i] !== this.owner[i];
  }

  // Place a dot for the player to move. Returns true when the move was legal.
  place(i) {
    if (!this.canPlace(i)) return false;
    const P = this.turn + 1;
    const O = 3 - P;
    this.owner[i] = P;
    this.moves.push(i);
    this.last = i;
    this.timeouts[this.turn] = 0;

    if (!this._captureAround(i, P)) {
      // Placed inside an enemy enclosure? Then the enemy captures it.
      const r = this._region(i, O);
      if (r) this._apply(r, O);
    }

    this._recount();
    this.turn = 1 - this.turn;
    if (this.target > 0 && Math.max(this.score[0], this.score[1]) >= this.target) this.over = true;
    else if (!this._hasFree()) this.over = true;
    return true;
  }

  // Flood fill (4-connected) from s through points that are not walls of W.
  // Returns the region if it does not reach the board edge, otherwise null.
  _region(s, W) {
    const { w, h } = this;
    const st = ++this._stamp;
    const vis = this._vis;
    const stack = [s];
    const out = [];
    vis[s] = st;
    while (stack.length) {
      const q = stack.pop();
      out.push(q);
      const x = q % w;
      const y = (q / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return null;
      const nb = [q - 1, q + 1, q - w, q + w];
      for (let k = 0; k < 4; k++) {
        const v = nb[k];
        if (vis[v] !== st && !this.active(v, W)) {
          vis[v] = st;
          stack.push(v);
        }
      }
    }
    return out;
  }

  _captureAround(i, P) {
    const { w, h } = this;
    const O = 3 - P;
    const x = i % w;
    const y = (i / w) | 0;
    const nbs = [];
    if (x > 0) nbs.push(i - 1);
    if (x < w - 1) nbs.push(i + 1);
    if (y > 0) nbs.push(i - w);
    if (y < h - 1) nbs.push(i + w);
    let any = false;
    for (const n of nbs) {
      if (this.active(n, P)) continue;
      const r = this._region(n, P);
      if (r && r.some((q) => this.active(q, O))) {
        this._apply(r, P);
        any = true;
      }
    }
    return any;
  }

  _apply(region, P) {
    const { w, h } = this;
    for (const q of region) this.terr[q] = P;
    // Mark the surrounding wall dots so the territory renders as a closed shape.
    for (const q of region) {
      const x = q % w;
      const y = (q / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const v = ny * w + nx;
          if (this.active(v, P)) this.terr[v] = P;
        }
      }
    }
  }

  _recount() {
    let a = 0;
    let b = 0;
    const { owner, terr } = this;
    for (let i = 0; i < owner.length; i++) {
      if (owner[i] === 2 && terr[i] === 1) a++;
      else if (owner[i] === 1 && terr[i] === 2) b++;
    }
    this.score[0] = a;
    this.score[1] = b;
  }

  _hasFree() {
    const { owner, terr } = this;
    for (let i = 0; i < owner.length; i++) if (owner[i] === 0 && terr[i] === 0) return true;
    return false;
  }

  // -1 draw, otherwise the winning seat
  leader() {
    if (this.score[0] === this.score[1]) return -1;
    return this.score[0] > this.score[1] ? 0 : 1;
  }
}
