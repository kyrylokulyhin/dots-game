# Dots Game — Server

Real-time multiplayer backend for the Dots capture game, written in Rust with
[Axum](https://github.com/tokio-rs/axum). It hosts the authoritative game state,
validates moves, and broadcasts updates to both players over WebSockets. Finished
games are recorded in a local SQLite database.

## Tech stack

- **axum 0.7** (with `ws`) — HTTP routing + WebSocket upgrades
- **tokio** — async runtime
- **serde / serde_json** — message (de)serialization
- **sqlx 0.7** (sqlite) — persistence of completed games
- **tracing / tracing-subscriber** — structured logging
- **tower-http** — CORS

## Running

```bash
cd dots-game-server
cargo run
```

The server starts on `http://127.0.0.1:3000` and creates `./data/dots_game.db`
on first run. WebSocket games are available at `ws://127.0.0.1:3000/ws/{game_code}`.

> Requires a recent stable Rust toolchain (`rustup`, edition 2021).

### Configuration

All config is via environment variables:

| Variable       | Default               | Description                  |
|----------------|-----------------------|------------------------------|
| `BIND_ADDR`    | `127.0.0.1`           | Interface to bind             |
| `PORT`         | `3000`                | TCP port                      |
| `DATABASE_URL` | `./data/dots_game.db` | SQLite file path              |
| `RUST_LOG`     | `dots_game_server=info` | Log filter (tracing syntax) |

## Architecture

```
src/
  main.rs       Router setup, app state, server bootstrap
  handlers.rs   WebSocket session loop + hello health endpoint
  session.rs    GameSession: per-room player connections + rematch voting
  game.rs       Pure game rules: placement, capture (flood-fill), game-over
  types.rs      Shared Color/Cell types + client/server message enums
  db.rs         SQLite pool + schema + completed-game persistence
```

`AppState` holds one in-memory session store plus the DB pool:

- `sessions` — the canonical game store, keyed by `game_code` (used by both the
  WebSocket path and any future REST additions)

### Game rules (`game.rs`)

- Grid is fixed at **15 × 10**, two players (Blue = P1, Yellow = P2).
- A player places a dot on an empty cell; turns alternate.
- After each placement, every opponent-occupied cell is tested with a 4-way
  flood fill (`is_surrounded`). If the connected region cannot reach the board
  edge without crossing a wall of the placing player's color, every dot in it is
  captured and scored.
- The game ends when the board is full; the higher score wins (ties = draw).

## API

### HTTP

| Method | Path | Description         |
|--------|------|---------------------|
| GET    | `/`  | Health/hello string |

### WebSocket — `/ws/:game_code`

The first two sockets to connect to a `game_code` become P1 (Blue) and P2
(Yellow); a third connection is rejected with `Error { "Game is full" }`.

**Client → server** (type-tagged JSON):

| Message            | Fields       | Description           |
|--------------------|--------------|-----------------------|
| `PlaceDot`         | `x`, `y`     | Place a dot           |
| `PlayAgainRequest` | —            | Vote for a rematch    |

**Server → client**:

`PlayerJoined`, `GameStarted`, `GameState`, `MoveResult`, `GameOver`,
`RematchStatus`, `GameRestarted`, `Error`.

Turn ownership is validated server-side — clients cannot move out of turn.

## Database

One table is created automatically:

- `completed_games` — one row written when a game ends (winner, scores, reason).

There is no read-back endpoint yet; use the SQLite file directly for history.

## Known issues & TODO

- **No tests.** The capture/flood-fill logic in `game.rs` is non-trivial and
  deserves unit tests.
- **`CorsLayer::permissive()`** is fine for local dev; tighten for any real
  deployment (e.g. set `CORS_ORIGIN` env var).
- **Games are not persisted across restarts.** In-memory sessions are lost when
  the server restarts. `completed_games` survives, but live game state does not.
- No license file is present yet — add one before publishing.
