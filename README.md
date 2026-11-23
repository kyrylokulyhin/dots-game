# Dots

The paper capture game: place dots, connect them into closed chains, and capture your opponent's dots.

- **Matchmaking:** "Find opponent" pairs you with the next player who is searching. The settings of whoever started searching first are used.
- **Accounts (optional):** username and password. Your settings (name, color, language, theme, game settings) and game history are stored on the server and follow you to any device. Without an account, history is kept on the device and merged into your account when you sign in.
- **Themes:** System, Light, Dark, Notebook, Chalkboard, Ocean.
- **Move timer:** off by default, or 5–30 seconds. Running out of time skips your turn, and three timeouts in a row lose the game.
- **Online:** create a room, then share the 5-letter code or the link. A third person who joins watches as a spectator. Reloading the page or a dropped connection rejoins the same seat.
- **On one device:** two players take turns on the same screen.
- **Vs computer:** a simple bot opponent. Works offline once the app is installed.
- **Settings:** field size (15×15 up to 39×32), score to win (or no limit), starting position (cross or empty).
- **Personalization:** name (or 🎲 for a random one) and dot color (yellow and blue by default, plus a palette and a custom color). Clashing colors are adjusted automatically.
- **Interface:** English and Ukrainian, light and dark theme, installable as a PWA on phones and desktop, zoom for big boards, two-tap placement on touch screens, emoji reactions in online games.

## Run

```powershell
npm install
npm start
```

Open http://localhost:3000. To play online with someone on your local network, they open `http://<your-ip>:3000`.

```powershell
npm test
```

## Deploy

Production runs on a Google Cloud e2-micro VM behind Cloudflare. Infrastructure is managed with Terraform, and GitHub Actions deploys every push to `main`. See [DEPLOYMENT.md](DEPLOYMENT.md).

It's a single Node process (HTTP and WebSocket on the same port). Configuration comes from environment variables: `PORT`, `HOST`, `DATA_DIR`, and `TRUST_PROXY=1` when running behind Cloudflare. Rooms are kept in memory. Accounts and history live in SQLite under `DATA_DIR`. Requires Node 22.13 or newer, for the built-in `node:sqlite`.

## Layout

| File | Purpose |
| --- | --- |
| `server.js` | Static files, room management, and authoritative move validation |
| `public/game.js` | Game rules, shared by the server and the browser |
| `public/board.js` | Canvas rendering and input |
| `public/bot.js` | Computer opponent |
| `public/i18n.js` | English and Ukrainian strings |
| `public/app.js` | UI, online client, local modes |
