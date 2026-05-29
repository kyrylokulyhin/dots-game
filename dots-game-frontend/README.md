# Dots Game — Frontend

A single-file, dependency-free browser client for the Dots capture game.
It renders the board on an HTML5 Canvas and supports both a **local hot-seat**
game (fully client-side, no server required) and **online multiplayer** over
WebSockets against the [`dots-game-server`](../dots-game-server).

## Running

No build step, no dependencies. Either:

```bash
# from this directory
python -m http.server 8080      # then open http://localhost:8080
```

or open `index.html` directly in a browser (`file://`). For online play the
server must be running (see the server README); the WS URL is derived from
`window.location` so it works without any config when served from the same host.

## How it works

Everything lives in [`index.html`](index.html) — markup, CSS, and JS.

A tiny hash router (`#/`, `#/game/local`, `#/game/online/:code`) switches
between the menu and game screens.

### `DotsGame` — local hot-seat

Fully client-side; no server needed.

- All game logic is implemented in JS: placement, 4-way flood-fill capture
  (`_isSurrounded`), loop-boundary detection, game-over check.
- Mirrors the server's rules in `game.rs` exactly so both modes behave the same.
- `reset()` restarts the board without a page reload.

### `DotsGameOnline` — multiplayer

Opens a WebSocket to `/ws/{gameCode}` on the current server host.

- The server is the sole source of truth; the client only sends `PlaceDot` /
  `PlayAgainRequest` and renders whatever `GameState` it receives.
- Turn ownership is enforced both client-side (UI ignores off-turn clicks) and
  server-side.
- Rematch flow: pressing Reset after game over sends `PlayAgainRequest`; the
  server broadcasts `RematchStatus` to both players and restarts once both vote.

### Online flow

1. **Host Online Game** generates a random 8-character code, navigates to
   `#/game/online/{code}`, and shows a shareable join link.
2. The opponent opens the link (or pastes the code via **Join Online Game**).
3. When both sockets connect, the server sends `GameStarted` + `GameState`.
4. From then on the server drives all state; clients only send moves.

## Known issues & TODO

- No automated tests.
- No build pipeline by design (single file), but worth noting if the project grows.
- No license file is present yet — add one before publishing.
