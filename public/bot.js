// Simple computer opponent: grabs captures, blocks threats, and builds near the action.
export function botMove(game) {
  const { w, h } = game;
  const n = w * h;
  const me = game.turn + 1;
  const op = 3 - me;

  // Candidate points: free points within 2 of any dot
  const near = new Uint8Array(n);
  let anyDot = false;
  for (let i = 0; i < n; i++) {
    if (!game.owner[i]) continue;
    anyDot = true;
    const x = i % w;
    const y = (i / w) | 0;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) near[ny * w + nx] = 1;
      }
  }
  const cands = [];
  for (let i = 0; i < n; i++) if (game.canPlace(i) && (near[i] || !anyDot)) cands.push(i);
  if (!cands.length) for (let i = 0; i < n; i++) if (game.canPlace(i)) cands.push(i);
  if (!cands.length) return -1;

  const lastOp = game.last;
  let best = cands[0];
  let bestV = -Infinity;
  for (const c of cands) {
    const x = c % w;
    const y = (c / w) | 0;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) continue;

    const g1 = game.clone();
    g1.place(c);
    const gain = g1.score[me - 1] - game.score[me - 1];
    const loss = g1.score[op - 1] - game.score[op - 1];

    const g2 = game.clone();
    g2.turn = 1 - g2.turn;
    g2.place(c);
    const threat = g2.score[op - 1] - game.score[op - 1];

    let own = 0;
    let enemy = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const v = (y + dy) * w + (x + dx);
        if (game.active(v, me)) own++;
        else if (game.active(v, op)) enemy++;
      }
    let v = gain * 100 - loss * 150 + threat * 80;
    v += Math.min(own, 3) * 2 + enemy * 3;
    if (own > 5) v -= 4; // avoid clumping
    if (lastOp >= 0) {
      const d = Math.max(Math.abs((lastOp % w) - x), Math.abs(((lastOp / w) | 0) - y));
      v += Math.max(0, 3 - d) * 1.5;
    }
    v += Math.random() * 2.5;
    if (v > bestV) {
      bestV = v;
      best = c;
    }
  }
  return best;
}
