# Copilot Instructions for Dots Game

## Project Overview

A real-time multiplayer dots-capture game. Two pieces:

- **`dots-game-frontend/`** — single-file HTML5 Canvas client (no build step)
- **`dots-game-server/`** — Rust/Axum WebSocket backend with SQLite persistence

## Architecture

### Frontend (`dots-game-frontend/index.html`)

All code in one file. A hash router switches between menu and game screens.

Two game classes:

- **`DotsGame`** — local hot-seat, fully client-side. All game logic in JS.
- **`DotsGameOnline`** — multiplayer. Opens WS to `/ws/{gameCode}` and renders
  server-pushed `GameState` messages.

The WS URL is derived from `window.location` so it works on any host without
hardcoding.

#### Coordinate system
```javascript
this.grid[y][x] = { color: '#hex', captured: bool } | null
// y-first indexing; (0,0) = top-left
```

#### Color constants
```javascript
const COLORS = { BLUE: '#3B82F6', YELLOW: '#FCD34D', PINK: '#EC4899', GRID: '#333', EMPTY: '#1a1a2e' }
```

#### Rendering pipeline
`clearRect` → `drawGrid` → `drawLoopLines` → `drawHoverPreview` → dots

#### Client → server messages
```json
{ "type": "PlaceDot",         "x": 3, "y": 5 }
{ "type": "PlayAgainRequest"                  }
```

#### Server → client messages
`PlayerJoined`, `GameStarted`, `GameState`, `MoveResult`, `GameOver`,
`RematchStatus`, `GameRestarted`, `Error`

### Backend (`dots-game-server/src/`)

| File           | Responsibility                                            |
|----------------|-----------------------------------------------------------|
| `main.rs`      | Router, app state, env-var config, tracing init           |
| `handlers.rs`  | WS upgrade + session loop; hello health endpoint          |
| `session.rs`   | `GameSession`: two-player room, rematch voting            |
| `game.rs`      | Pure rules: `place_dot`, flood-fill capture, game-over    |
| `types.rs`     | `Color`, `Cell`, `ClientMessage`, `ServerMessage`, etc.   |
| `db.rs`        | SQLite pool (via `SqliteConnectOptions::filename`), schema |

Config env vars: `BIND_ADDR`, `PORT`, `DATABASE_URL`, `RUST_LOG`.

### Game rules (identical in JS and Rust)

- 15×10 grid, Blue (P1) vs Yellow (P2).
- On each turn: place a dot, run 4-way flood-fill on every opponent dot.
  If its connected region cannot reach the board edge through non-wall cells,
  it is captured (marked with an X) and scored.
- Game ends when the board is full; higher score wins (tie = draw).

## Development workflow

- Open `dots-game-frontend/index.html` directly in a browser, or
  `python -m http.server 8080 --directory dots-game-frontend` for served mode.
- `cd dots-game-server && cargo run` for the backend (port 3000 by default).
- No build process for the frontend.

## When adding features

- Maintain single-file structure for the frontend.
- Keep JS capture logic (`_isSurrounded`, `_checkCaptures`) in sync with
  Rust `game.rs` — both implement the same 4-directional flood fill.
- Add new WebSocket message types to `ServerMessage` (Rust enum, serde tagged)
  and handle them in `DotsGameOnline.handleServerMessage`.
- Use `tracing::info!/warn!/error!` in Rust, not `println!`.
