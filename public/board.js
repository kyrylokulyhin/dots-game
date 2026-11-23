// Canvas board renderer and input handling.

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export class BoardView {
  constructor(canvas, wrap, onPick) {
    this.canvas = canvas;
    this.wrap = wrap;
    this.ctx = canvas.getContext('2d');
    this.onPick = onPick;
    this.game = null;
    this.colors = ['#f2c200', '#2d7ff9'];
    this.interactive = false;
    this.zoom = 1;
    this.hover = -1;
    this.ghost = -1;
    this.confirmTouch = true;
    this.pointerType = 'mouse';

    canvas.addEventListener('pointerdown', (e) => (this.pointerType = e.pointerType));
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const i = this.pick(e);
      if (i !== this.hover) {
        this.hover = i;
        this.draw();
      }
    });
    canvas.addEventListener('pointerleave', () => {
      this.hover = -1;
      this.draw();
    });
    canvas.addEventListener('click', (e) => {
      const i = this.pick(e);
      if (i < 0) return;
      if (!this.interactive) {
        this.onBlocked?.('turn');
        return;
      }
      if (!this.game.canPlace(i)) {
        this.onBlocked?.('occupied');
        return;
      }
      if (this.pointerType !== 'mouse' && this.confirmTouch && this.ghost !== i) {
        this.ghost = i;
        this.draw();
        return;
      }
      this.ghost = -1;
      this.onPick(i);
    });
    wrap.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        this.setZoom(this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
      },
      { passive: false }
    );
    new ResizeObserver(() => this.layout()).observe(wrap);
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', () => this.draw());
  }

  set(game, colors, interactive) {
    const resized = !this.game || this.game.w !== game.w || this.game.h !== game.h;
    this.game = game;
    this.colors = colors;
    this.interactive = interactive;
    if (this.ghost >= 0 && !game.canPlace(this.ghost)) this.ghost = -1;
    if (!interactive) this.ghost = -1;
    if (resized) {
      this.zoom = 1;
      this.layout();
    } else this.draw();
  }

  setZoom(z) {
    const wrap = this.wrap;
    const cx = (wrap.scrollLeft + wrap.clientWidth / 2) / (this.canvas.clientWidth || 1);
    const cy = (wrap.scrollTop + wrap.clientHeight / 2) / (this.canvas.clientHeight || 1);
    this.zoom = Math.min(4, Math.max(1, z));
    this.layout();
    wrap.scrollLeft = cx * this.canvas.clientWidth - wrap.clientWidth / 2;
    wrap.scrollTop = cy * this.canvas.clientHeight - wrap.clientHeight / 2;
  }

  layout() {
    const g = this.game;
    if (!g) return;
    const W = this.wrap.clientWidth;
    const H = this.wrap.clientHeight;
    if (!W || !H) return;
    this.wrap.style.overflow = this.zoom > 1 ? 'auto' : 'hidden';
    const base = Math.min((W - 2) / (g.w + 1), (H - 2) / (g.h + 1));
    this.cell = Math.max(4, base * this.zoom);
    const cw = Math.floor(this.cell * (g.w + 1));
    const ch = Math.floor(this.cell * (g.h + 1));
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = cw + 'px';
    this.canvas.style.height = ch + 'px';
    this.canvas.width = Math.round(cw * dpr);
    this.canvas.height = Math.round(ch * dpr);
    this.dpr = dpr;
    this.draw();
  }

  pick(e) {
    const g = this.game;
    if (!g) return -1;
    const r = this.canvas.getBoundingClientRect();
    const fx = (e.clientX - r.left) / this.cell - 1;
    const fy = (e.clientY - r.top) / this.cell - 1;
    const x = Math.round(fx);
    const y = Math.round(fy);
    // Snap to the nearest intersection; ignore clicks well outside the grid
    if (x < 0 || y < 0 || x >= g.w || y >= g.h) {
      if (fx < -0.75 || fy < -0.75 || fx > g.w - 0.25 || fy > g.h - 0.25) return -1;
    }
    return g.idx(Math.min(g.w - 1, Math.max(0, x)), Math.min(g.h - 1, Math.max(0, y)));
  }

  draw() {
    const g = this.game;
    if (!g || !this.cell) return;
    const { ctx, cell } = this;
    const css = getComputedStyle(document.documentElement);
    const paper = css.getPropertyValue('--paper').trim() || '#fbfaf5';
    const line = css.getPropertyValue('--grid').trim() || '#cfdcef';
    const outline = css.getPropertyValue('--dot-outline').trim() || 'rgba(0,0,0,.35)';
    const { w, h } = g;
    const P = (v) => (v + 1) * cell;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Grid
    // Snap grid lines to device pixels so they all look equally thin
    const d = this.dpr;
    const snap = (v) => (Math.round(v * d) + 0.5) / d;
    ctx.strokeStyle = line;
    ctx.lineWidth = Math.max(1, Math.round(d)) / d;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const px = snap(P(x));
      ctx.moveTo(px, P(0));
      ctx.lineTo(px, P(h - 1));
    }
    for (let y = 0; y < h; y++) {
      const py = snap(P(y));
      ctx.moveTo(P(0), py);
      ctx.lineTo(P(w - 1), py);
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
      for (let y = 0; y < h - 1; y++)
        for (let x = 0; x < w - 1; x++) {
          const c = [g.idx(x, y), g.idx(x + 1, y), g.idx(x + 1, y + 1), g.idx(x, y + 1)];
          const inn = c.filter((i) => g.terr[i] === p);
          if (inn.length < 3) continue;
          any = true;
          const pts = inn.length === 4 ? c : c.filter((i) => g.terr[i] === p);
          ctx.moveTo(P(pts[0] % w), P((pts[0] / w) | 0));
          for (let k = 1; k < pts.length; k++) ctx.lineTo(P(pts[k] % w), P((pts[k] / w) | 0));
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
        ctx.moveTo(P(a % w), P((a / w) | 0));
        ctx.lineTo(P(b % w), P((b / w) | 0));
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, cell * 0.12);
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // Dots
    const r = Math.max(2, cell * 0.27);
    for (let i = 0; i < g.owner.length; i++) {
      const o = g.owner[i];
      if (!o) continue;
      const cap = g.isCaptured(i);
      const x = P(i % w);
      const y = P((i / w) | 0);
      ctx.globalAlpha = cap ? 0.45 : 1;
      ctx.beginPath();
      ctx.arc(x, y, cap ? r * 0.75 : r, 0, Math.PI * 2);
      ctx.fillStyle = this.colors[o - 1];
      ctx.fill();
      ctx.lineWidth = Math.max(1, cell * 0.05);
      ctx.strokeStyle = outline;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Last move marker
    if (g.last >= 0) {
      ctx.beginPath();
      ctx.arc(P(g.last % w), P((g.last / w) | 0), r * 1.6, 0, Math.PI * 2);
      ctx.strokeStyle = outline;
      ctx.lineWidth = Math.max(1, cell * 0.06);
      ctx.stroke();
    }

    // Hover / pending touch placement
    const ghost = this.ghost >= 0 ? this.ghost : this.interactive ? this.hover : -1;
    if (ghost >= 0 && g.canPlace(ghost)) {
      const x = P(ghost % w);
      const y = P((ghost / w) | 0);
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
  }
}
