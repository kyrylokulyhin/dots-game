// Canvas board: rendering, pan/zoom viewport and touch/mouse input.
//
// The canvas always fills its container. The board is drawn through a viewport
// (zoom + offset), so panning and pinching never scroll or zoom the page.
// "Focus" = zoomed in. On phones with a big board, tapping the overview zooms into
// that spot first; placing dots happens in focus, and exitFocus() returns to the overview.

const FOCUS_CELL = 20; // below this cell size (px) a touch tap zooms in instead of placing
const TARGET_CELL = 38; // cell size when zooming into focus
const MAX_CELL = 64;
const CONFIRM_CELL = 30; // two-tap confirm only applies when cells are smaller than this

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const ease = (t) => 1 - Math.pow(1 - t, 3);

export class BoardView {
  constructor(canvas, wrap, onPick) {
    this.canvas = canvas;
    this.wrap = wrap;
    this.ctx = canvas.getContext('2d');
    this.onPick = onPick;
    this.onBlocked = null;
    this.onFocusChange = null;
    this.game = null;
    this.colors = ['#f2c200', '#2d7ff9'];
    this.interactive = false;
    this.confirmTouch = true;

    this.W = 0;
    this.H = 0;
    this.dpr = 1;
    this.fit = 0; // cell size when the whole board fits
    this.zoom = 1;
    this.cell = 0;
    this.ox = 0; // screen position of board point (-1, -1)
    this.oy = 0;
    this.focused = false;

    this.hover = -1;
    this.ghost = -1;
    this.arrow = null; // off-screen last-move indicator {x, y}
    this.pointers = new Map();
    this.gesture = null;
    this.anim = 0;
    this.minimap = null;

    canvas.addEventListener('pointerdown', (e) => this._down(e));
    canvas.addEventListener('pointermove', (e) => this._move(e));
    canvas.addEventListener('pointerup', (e) => this._up(e, false));
    canvas.addEventListener('pointercancel', (e) => this._up(e, true));
    canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && this.hover !== -1) {
        this.hover = -1;
        this.draw();
      }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025));
        this.zoomAround(e.clientX - r.left, e.clientY - r.top, this.zoom * f);
      },
      { passive: false }
    );
    new ResizeObserver(() => this.layout()).observe(wrap);
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => this.draw());
  }

  // ---------------------------------------------------------------- public API

  set(game, colors, interactive) {
    const resized = !this.game || this.game.w !== game.w || this.game.h !== game.h;
    this.game = game;
    this.colors = colors;
    this.interactive = interactive;
    if (this.ghost >= 0 && (!interactive || !game.canPlace(this.ghost))) this.ghost = -1;
    if (resized) {
      this.zoom = 1;
      this.layout();
      this._focusCheck();
    } else this.draw();
  }

  get maxZoom() {
    return this.fit ? Math.max(1, MAX_CELL / this.fit) : 1;
  }

  zoomBy(f) {
    this._animateZoom(this.zoom * f, this.W / 2, this.H / 2);
  }

  exitFocus() {
    this.ghost = -1;
    this._animateZoom(1, this.W / 2, this.H / 2);
  }

  attachMinimap(el) {
    this.minimap = el;
    const jump = (e) => {
      const r = el.getBoundingClientRect();
      const s = this._miniScale();
      const bx = (e.clientX - r.left) / s; // board units incl. margin
      const by = (e.clientY - r.top) / s;
      this.ox = this.W / 2 - bx * this.cell;
      this.oy = this.H / 2 - by * this.cell;
      this._clamp();
      this.draw();
    };
    el.addEventListener('pointerdown', (e) => {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {}
      cancelAnimationFrame(this.anim);
      jump(e);
    });
    el.addEventListener('pointermove', (e) => e.buttons && jump(e));
  }

  layout() {
    const g = this.game;
    const W = this.wrap.clientWidth;
    const H = this.wrap.clientHeight;
    if (!g || !W || !H) return;
    // Keep the board point at the screen centre where it was
    const cx = this.cell ? (this.W / 2 - this.ox) / this.cell : null;
    const cy = this.cell ? (this.H / 2 - this.oy) / this.cell : null;
    this.W = W;
    this.H = H;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(W * this.dpr);
    this.canvas.height = Math.round(H * this.dpr);
    this.fit = Math.min(W / (g.w + 1), H / (g.h + 1));
    this.zoom = Math.min(this.zoom, this.maxZoom);
    this.cell = this.fit * this.zoom;
    if (cx != null && this.zoom > 1) {
      this.ox = W / 2 - cx * this.cell;
      this.oy = H / 2 - cy * this.cell;
    }
    this._clamp();
    this.draw();
  }

  zoomAround(sx, sy, z) {
    z = Math.min(this.maxZoom, Math.max(1, z));
    const bx = (sx - this.ox) / this.cell;
    const by = (sy - this.oy) / this.cell;
    this.zoom = z;
    this.cell = this.fit * z;
    this.ox = sx - bx * this.cell;
    this.oy = sy - by * this.cell;
    this._clamp();
    this._focusCheck();
    this.draw();
  }

  panTo(i, animate = true) {
    const g = this.game;
    const tx = this.W / 2 - ((i % g.w) + 1) * this.cell;
    const ty = this.H / 2 - (((i / g.w) | 0) + 1) * this.cell;
    if (!animate) {
      this.ox = tx;
      this.oy = ty;
      this._clamp();
      this.draw();
      return;
    }
    const x0 = this.ox;
    const y0 = this.oy;
    this._animate(220, (k) => {
      this.ox = x0 + (tx - x0) * k;
      this.oy = y0 + (ty - y0) * k;
      this._clamp();
    });
  }

  // ---------------------------------------------------------------- geometry

  _clamp() {
    const g = this.game;
    if (!g) return;
    const bw = this.cell * (g.w + 1);
    const bh = this.cell * (g.h + 1);
    this.ox = bw <= this.W ? (this.W - bw) / 2 : Math.min(0, Math.max(this.W - bw, this.ox));
    this.oy = bh <= this.H ? (this.H - bh) / 2 : Math.min(0, Math.max(this.H - bh, this.oy));
  }

  _focusCheck() {
    const f = this.zoom > 1.001;
    if (f !== this.focused) {
      this.focused = f;
      this.canvas.classList.toggle('zoomed', f);
      this.onFocusChange?.(f);
    }
  }

  _local(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  // Nearest intersection to a screen point, or -1 when clearly outside the board
  pickAt(sx, sy) {
    const g = this.game;
    if (!g || !this.cell) return -1;
    const fx = (sx - this.ox) / this.cell - 1;
    const fy = (sy - this.oy) / this.cell - 1;
    if (fx < -0.75 || fy < -0.75 || fx > g.w - 0.25 || fy > g.h - 0.25) return -1;
    const x = Math.min(g.w - 1, Math.max(0, Math.round(fx)));
    const y = Math.min(g.h - 1, Math.max(0, Math.round(fy)));
    return g.idx(x, y);
  }

  // ---------------------------------------------------------------- animation

  _animate(ms, step, done) {
    cancelAnimationFrame(this.anim);
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      step(ease(k));
      this.draw();
      if (k < 1) this.anim = requestAnimationFrame(tick);
      else done?.();
    };
    this.anim = requestAnimationFrame(tick);
  }

  _animateZoom(target, sx, sy) {
    target = Math.min(this.maxZoom, Math.max(1, target));
    const z0 = this.zoom;
    // Keep the board point under (sx, sy) fixed while zooming
    const bx = (sx - this.ox) / this.cell;
    const by = (sy - this.oy) / this.cell;
    this._animate(
      240,
      (k) => {
        this.zoom = z0 + (target - z0) * k;
        this.cell = this.fit * this.zoom;
        this.ox = sx - bx * this.cell;
        this.oy = sy - by * this.cell;
        this._clamp();
      },
      () => this._focusCheck()
    );
    // Report focus at the start of zooming in, so the UI changes right away
    if (target > 1.001) this._focusCheckTo(true);
  }

  _focusCheckTo(f) {
    if (f !== this.focused) {
      this.focused = f;
      this.canvas.classList.toggle('zoomed', f);
      this.onFocusChange?.(f);
    }
  }

  // ---------------------------------------------------------------- input

  _down(e) {
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {}
    cancelAnimationFrame(this.anim);
    const [x, y] = this._local(e);
    this.pointers.set(e.pointerId, { x, y });
    if (this.pointers.size === 1) {
      this.gesture = { kind: 'tap', x0: x, y0: y, ox0: this.ox, oy0: this.oy, type: e.pointerType, id: e.pointerId };
    } else if (this.pointers.size === 2) {
      this._startPinch();
    }
  }

  _startPinch() {
    const [a, b] = [...this.pointers.values()];
    this.gesture = {
      kind: 'pinch',
      d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      z0: this.zoom,
      // board point under the initial midpoint
      bx: ((a.x + b.x) / 2 - this.ox) / this.cell,
      by: ((a.y + b.y) / 2 - this.oy) / this.cell,
    };
  }

  _move(e) {
    const [x, y] = this._local(e);
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      // Mouse hovering without a button pressed
      if (e.pointerType === 'mouse') {
        const i = this.interactive ? this.pickAt(x, y) : -1;
        if (i !== this.hover) {
          this.hover = i;
          this.draw();
        }
      }
      return;
    }
    p.x = x;
    p.y = y;
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'tap') {
      const slop = g.type === 'mouse' ? 4 : 10;
      if (Math.hypot(x - g.x0, y - g.y0) > slop) g.kind = this.zoom > 1.001 ? 'pan' : 'none';
    }
    if (g.kind === 'pan') {
      this.ox = g.ox0 + (x - g.x0);
      this.oy = g.oy0 + (y - g.y0);
      this._clamp();
      this.draw();
    } else if (g.kind === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      this.zoom = Math.min(this.maxZoom, Math.max(1, (g.z0 * d) / g.d0));
      this.cell = this.fit * this.zoom;
      this.ox = mx - g.bx * this.cell;
      this.oy = my - g.by * this.cell;
      this._clamp();
      this._focusCheck();
      this.draw();
    }
  }

  _up(e, cancelled) {
    if (!this.pointers.has(e.pointerId)) return;
    const [x, y] = this._local(e);
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (this.pointers.size === 1 && g?.kind === 'pinch') {
      // One finger left after a pinch: continue as a pan from here
      const [id, p] = [...this.pointers.entries()][0];
      this.gesture = { kind: 'pan', x0: p.x, y0: p.y, ox0: this.ox, oy0: this.oy, type: 'touch', id };
      return;
    }
    if (this.pointers.size > 0) return;
    this.gesture = null;
    if (g?.kind === 'pinch' && this.zoom < 1.08) this._animateZoom(1, this.W / 2, this.H / 2);
    if (!cancelled && g?.kind === 'tap') this._tap(x, y, g.type);
  }

  _tap(sx, sy, type) {
    const g = this.game;
    if (!g) return;
    // Tap on the off-screen arrow: jump to the last move
    if (this.arrow && Math.hypot(sx - this.arrow.x, sy - this.arrow.y) < 26) {
      this.panTo(g.last);
      return;
    }
    const i = this.pickAt(sx, sy);
    if (i < 0) return;
    const touch = type !== 'mouse';
    // Overview of a big board on a phone: zoom into the tapped spot first
    if (touch && this.zoom <= 1.001 && this.fit < FOCUS_CELL) {
      this._animateZoom(TARGET_CELL / this.fit, sx, sy);
      return;
    }
    if (!this.interactive) {
      this.onBlocked?.('turn');
      return;
    }
    if (!g.canPlace(i)) {
      this.onBlocked?.('occupied');
      return;
    }
    if (touch && this.confirmTouch && this.cell < CONFIRM_CELL && this.ghost !== i) {
      this.ghost = i;
      this.draw();
      return;
    }
    this.ghost = -1;
    this.onPick(i);
  }

  // ---------------------------------------------------------------- drawing

  draw() {
    const g = this.game;
    if (!g || !this.cell) return;
    const { ctx, cell, W, H } = this;
    const css = getComputedStyle(document.documentElement);
    const paper = css.getPropertyValue('--paper').trim() || '#fbfaf5';
    const line = css.getPropertyValue('--grid').trim() || '#cfdcef';
    const outline = css.getPropertyValue('--dot-outline').trim() || 'rgba(0,0,0,.35)';
    const { w, h } = g;
    const PX = (x) => this.ox + (x + 1) * cell;
    const PY = (y) => this.oy + (y + 1) * cell;
    const d = this.dpr;

    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, W, H);

    // Only draw what is on screen
    const x0 = Math.max(0, Math.floor(-this.ox / cell) - 2);
    const x1 = Math.min(w - 1, Math.ceil((W - this.ox) / cell));
    const y0 = Math.max(0, Math.floor(-this.oy / cell) - 2);
    const y1 = Math.min(h - 1, Math.ceil((H - this.oy) / cell));

    // Grid, snapped to device pixels so all lines look equally thin
    const snap = (v) => (Math.round(v * d) + 0.5) / d;
    ctx.strokeStyle = line;
    ctx.lineWidth = Math.max(1, Math.round(d)) / d;
    ctx.beginPath();
    for (let x = x0; x <= x1; x++) {
      const px = snap(PX(x));
      ctx.moveTo(px, PY(0));
      ctx.lineTo(px, PY(h - 1));
    }
    for (let y = y0; y <= y1; y++) {
      const py = snap(PY(y));
      ctx.moveTo(PX(0), py);
      ctx.lineTo(PX(w - 1), py);
    }
    ctx.stroke();

    // Territories: fill unit squares / triangles whose corners are in a player's territory
    for (let p = 1; p <= 2; p++) {
      const color = this.colors[p - 1];
      const edges = new Map();
      const addEdge = (a, b) => {
        const k = a < b ? a * 1e5 + b : b * 1e5 + a;
        edges.set(k, (edges.get(k) || 0) + 1);
      };
      ctx.beginPath();
      let any = false;
      for (let y = Math.max(0, y0 - 1); y < Math.min(h - 1, y1 + 1); y++)
        for (let x = Math.max(0, x0 - 1); x < Math.min(w - 1, x1 + 1); x++) {
          const c = [g.idx(x, y), g.idx(x + 1, y), g.idx(x + 1, y + 1), g.idx(x, y + 1)];
          const pts = c.filter((i) => g.terr[i] === p);
          if (pts.length < 3) continue;
          any = true;
          ctx.moveTo(PX(pts[0] % w), PY((pts[0] / w) | 0));
          for (let k = 1; k < pts.length; k++) ctx.lineTo(PX(pts[k] % w), PY((pts[k] / w) | 0));
          ctx.closePath();
          for (let k = 0; k < pts.length; k++) addEdge(pts[k], pts[(k + 1) % pts.length]);
        }
      if (!any) continue;
      ctx.fillStyle = hexA(color, 0.28);
      ctx.fill();
      ctx.beginPath();
      for (const [k, cnt] of edges) {
        if (cnt !== 1) continue;
        const a = Math.floor(k / 1e5);
        const b = k % 1e5;
        ctx.moveTo(PX(a % w), PY((a / w) | 0));
        ctx.lineTo(PX(b % w), PY((b / w) | 0));
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, cell * 0.12);
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Dots
    const r = Math.max(2, cell * 0.27);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x;
        const o = g.owner[i];
        if (!o) continue;
        const cap = g.isCaptured(i);
        ctx.globalAlpha = cap ? 0.45 : 1;
        ctx.beginPath();
        ctx.arc(PX(x), PY(y), cap ? r * 0.75 : r, 0, Math.PI * 2);
        ctx.fillStyle = this.colors[o - 1];
        ctx.fill();
        ctx.lineWidth = Math.max(1, cell * 0.05);
        ctx.strokeStyle = outline;
        ctx.stroke();
      }
    ctx.globalAlpha = 1;

    // Last move marker, or an edge arrow pointing to it when it is off-screen
    this.arrow = null;
    if (g.last >= 0) {
      const lx = PX(g.last % w);
      const ly = PY((g.last / w) | 0);
      const m = 6;
      if (lx >= -m && lx <= W + m && ly >= -m && ly <= H + m) {
        ctx.beginPath();
        ctx.arc(lx, ly, r * 1.6, 0, Math.PI * 2);
        ctx.strokeStyle = outline;
        ctx.lineWidth = Math.max(1, cell * 0.06);
        ctx.stroke();
      } else if (this.focused) {
        this._drawArrow(lx, ly, this.colors[g.owner[g.last] - 1] || outline, outline);
      }
    }

    // Hover / pending touch placement
    const ghost = this.ghost >= 0 ? this.ghost : this.interactive ? this.hover : -1;
    if (ghost >= 0 && g.canPlace(ghost)) {
      const x = PX(ghost % w);
      const y = PY((ghost / w) | 0);
      ctx.globalAlpha = this.ghost >= 0 ? 0.75 : 0.45;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = this.colors[g.turn];
      ctx.fill();
      ctx.globalAlpha = 1;
      if (this.ghost >= 0) {
        ctx.beginPath();
        ctx.arc(x, y, r * 2, 0, Math.PI * 2);
        ctx.strokeStyle = this.colors[g.turn];
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    this._drawMinimap();
  }

  _drawArrow(tx, ty, color, outline) {
    const { ctx, W, H } = this;
    const inset = 22;
    const cx = W / 2;
    const cy = H / 2;
    // Point where the line from the centre to the target leaves the inset rectangle
    const dx = tx - cx;
    const dy = ty - cy;
    const s = Math.min(Math.abs((W / 2 - inset) / (dx || 1e-6)), Math.abs((H / 2 - inset) / (dy || 1e-6)));
    const ax = cx + dx * s;
    const ay = cy + dy * s;
    const ang = Math.atan2(dy, dx);
    this.arrow = { x: ax, y: ay };
    ctx.save();
    ctx.translate(ax, ay);
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fill();
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-5, -7);
    ctx.lineTo(-5, 7);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  _miniScale() {
    const g = this.game;
    return Math.min(120 / (g.w + 1), 96 / (g.h + 1));
  }

  _drawMinimap() {
    const el = this.minimap;
    if (!el) return;
    if (!this.focused) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const g = this.game;
    const s = this._miniScale();
    const cw = Math.round((g.w + 1) * s);
    const ch = Math.round((g.h + 1) * s);
    const d = this.dpr;
    if (el.width !== cw * d || el.height !== ch * d) {
      el.width = cw * d;
      el.height = ch * d;
      el.style.width = cw + 'px';
      el.style.height = ch + 'px';
    }
    const c = el.getContext('2d');
    c.setTransform(d, 0, 0, d, 0, 0);
    c.clearRect(0, 0, cw, ch);
    const ds = Math.max(1.5, s * 0.9);
    for (let i = 0; i < g.owner.length; i++) {
      const o = g.owner[i];
      if (!o) continue;
      c.globalAlpha = g.isCaptured(i) ? 0.35 : 1;
      c.fillStyle = this.colors[o - 1];
      c.fillRect(((i % g.w) + 1) * s - ds / 2, (((i / g.w) | 0) + 1) * s - ds / 2, ds, ds);
    }
    c.globalAlpha = 1;
    // Visible area
    const vx = (-this.ox / this.cell) * s;
    const vy = (-this.oy / this.cell) * s;
    const vw = (this.W / this.cell) * s;
    const vh = (this.H / this.cell) * s;
    c.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2d7ff9';
    c.lineWidth = 1.5;
    c.strokeRect(Math.max(0.75, vx), Math.max(0.75, vy), Math.min(cw - 1.5, vw), Math.min(ch - 1.5, vh));
  }
}
