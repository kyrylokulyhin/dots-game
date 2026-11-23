import assert from 'node:assert/strict';
import { Game } from '../public/game.js';
import { botMove } from '../public/bot.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok -', name);
}

// Helper: play a sequence of [x,y] pairs alternately (P1, P2, P1, ...)
function play(g, seq) {
  for (const [x, y] of seq) assert.ok(g.place(g.idx(x, y)), `move ${x},${y} should be legal`);
}

test('diamond captures enemy dot', () => {
  const g = new Game({ w: 10, h: 10, start: 'empty' });
  // P1 surrounds (5,5); P2 plays inside then elsewhere
  play(g, [[5, 4], [5, 5], [4, 5], [0, 0], [6, 5], [9, 9], [5, 6]]);
  assert.equal(g.score[0], 1);
  assert.ok(g.isCaptured(g.idx(5, 5)));
  assert.equal(g.terr[g.idx(5, 5)], 1);
});

test('enclosure touching the edge does not capture', () => {
  const g = new Game({ w: 10, h: 10, start: 'empty' });
  play(g, [[1, 0], [0, 0], [0, 1], [9, 9]]);
  assert.equal(g.score[0], 0);
});

test('playing into an empty enemy enclosure gets captured', () => {
  const g = new Game({ w: 10, h: 10, start: 'empty' });
  play(g, [[5, 4], [0, 0], [4, 5], [9, 9], [6, 5], [0, 9], [5, 6]]);
  assert.equal(g.score[0], 0); // empty house, nothing captured yet
  play(g, [[5, 5]]); // P2 steps inside
  assert.equal(g.score[0], 1);
  assert.ok(g.isCaptured(g.idx(5, 5)));
});

test('dead points cannot be played', () => {
  const g = new Game({ w: 12, h: 12, start: 'empty' });
  // big P1 ring around (5,5)-(6,5); P2 at (5,5)
  play(g, [[5, 4], [5, 5], [6, 4], [0, 0], [7, 5], [0, 1], [6, 6], [0, 2], [5, 6], [0, 3], [4, 5]]);
  assert.equal(g.score[0], 1);
  assert.ok(!g.canPlace(g.idx(6, 5)), 'empty point inside capture is dead');
});

test('target score ends the game', () => {
  const g = new Game({ w: 10, h: 10, start: 'empty', target: 1 });
  play(g, [[5, 4], [5, 5], [4, 5], [0, 0], [6, 5], [9, 9], [5, 6]]);
  assert.ok(g.over);
  assert.equal(g.leader(), 0);
});

test('fromMoves replays identically', () => {
  const g = new Game({ w: 15, h: 15 });
  for (let k = 0; k < 60; k++) {
    const m = botMove(g);
    if (m < 0) break;
    g.place(m);
  }
  const r = Game.fromMoves({ w: 15, h: 15 }, g.moves);
  assert.deepEqual([...r.terr], [...g.terr]);
  assert.deepEqual(r.score, g.score);
});

test('bot plays a full game to the end', () => {
  const g = new Game({ w: 12, h: 12 });
  let n = 0;
  while (!g.over && n < 500) {
    const m = botMove(g);
    if (m < 0) break;
    assert.ok(g.place(m));
    n++;
  }
  assert.ok(g.over || n > 0);
});

test('timeout skips the turn; three in a row forfeits', () => {
  const g = new Game({ w: 10, h: 10, start: 'empty' });
  assert.ok(g.pass()); // P1 times out
  assert.equal(g.turn, 1);
  play(g, [[1, 1]]); // P2 moves
  g.pass(); // P1 #2
  g.place(g.idx(2, 2)); // P2
  g.place(g.idx(3, 3)); // P1 moves: streak resets
  assert.equal(g.timeouts[0], 0);
  g.pass(); // P2 #1
  g.pass(); // P1 #1
  g.pass(); // P2 #2
  g.pass(); // P1 #2
  assert.ok(!g.over);
  g.pass(); // P2 #3
  assert.ok(g.over);
  assert.equal(g.forfeit, 1);
  const r = Game.fromMoves({ w: 10, h: 10, start: 'empty' }, g.moves);
  assert.ok(r.over);
  assert.equal(r.forfeit, 1);
});

console.log(`\n${passed} tests passed`);
