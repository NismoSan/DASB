<p align="center">
  <h1 align="center">DASB</h1>
  <p align="center">
    A Dark Ages proxy, bot framework, and protocol toolkit for Node.js
    <br />
    <a href="https://github.com/NismoSan/DASB/issues"><strong>Issues</strong></a>
  </p>
</p>

<br />

## Overview

DASB is a man-in-the-middle proxy and bot automation framework for [Dark Ages](https://www.darkagesworld.com/). It sits between the game client and server, intercepting, decrypting, inspecting, and modifying packets in both directions. On top of that foundation it layers new gameplay systems that run entirely in the proxy — virtual NPCs, map editing, monster catching, fishing, combat automation, and more.

No server modifications. No client patches. TypeScript from front to back.

## Features

| Category | What it does |
|---|---|
| **Proxy Server** | Full MITM proxy with per-session encryption state, packet inspection, and live modification in both directions |
| **Web Panel** | Browser-based dashboard for managing bots, configuration, chat, and proxy sessions |
| **Multi-Bot** | Run multiple bot accounts simultaneously with role-based configuration (primary, tracker, lottery, etc.) |
| **Map Editor** | Swap map terrain in real time, place virtual objects, create custom doors and portals |
| **Virtual NPCs** | Inject interactive NPCs only visible to proxy clients — dialogs, menus, proximity triggers |
| **Automation** | A* pathfinding, cross-map navigation, combat automation, spell casting, auto-looting, follow mode |
| **Monster Capture** | Pokemon-style catching, leveling, battling, and companion NPCs |
| **Fishing** | Full minigame with species, rarity tiers, hotspot rotation, leaderboards |
| **AFK Dimension** | Parallel shadow world with its own monsters, loot, merchants, and progression |
| **Chat Games** | Trivia, riddle, scramble, blackjack, hangman, and more — powered by OpenAI |
| **Discord Integration** | Forward world shouts, whispers, and filtered messages to Discord via webhooks |
| **Packet Capture** | Persistent packet storage in SQLite with MCP-based analysis tools |
| **Custom Legends** | Rewrite legend marks, disguise profiles, and name tag styles per player |
| **Lottery & Slots** | In-game lottery and slot machine systems |
| **Player Tracking** | Track player appearances, sessions, legends, and stats in PostgreSQL |
| **Scheduled Messages** | Timed and interval-based automated chat messages |

## Requirements

- [Node.js](https://nodejs.org/) 18 or later
- [PostgreSQL](https://www.postgresql.org/) (for player tracking and persistence)
- A Dark Ages game client

## Quick Start

```bash
# Clone the repository
git clone https://github.com/NismoSan/DASB.git
cd DASB

# Install dependencies
npm install

# Build from source
npm run build
npm run build:panel

# Configure
cp .env.example .env              # Edit with your credentials
cp bot-config.example.json bot-config.json    # Add your bot accounts
cp discord-hooks.example.json discord-hooks.json  # Add your webhooks (optional)

# Start
npm start
```

Open `http://localhost:4000` to access the web panel.

## Configuration

All configuration is managed through three files:

| File | Purpose |
|---|---|
| `.env` | Database credentials, API keys, panel auth |
| `bot-config.json` | Bot accounts, server address, feature toggles, chat games, scheduled messages |
| `discord-hooks.json` | Discord webhook rules and message filtering |

Copy the `.example` versions and fill in your values.

### Environment Variables

| Variable | Description |
|---|---|
| `DA_SERVER_ADDRESS` | Dark Ages server IP address |
| `OPENAI_API_KEY` | OpenAI API key (for chat games) |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | PostgreSQL connection |
| `PANEL_USERNAME` / `PANEL_PASSWORD` | Web panel login credentials |
| `AE_BACKEND_URL` / `AE_INGEST_KEY` | Aisling Exchange API (optional) |
| `LOTTERY_SECRET` | Lottery draw verification secret |

## Development

```bash
# Watch mode — recompiles TypeScript on change and restarts the server
npm run dev:restart

# Type-check without emitting
npm run typecheck

# Build everything (server + panel)
npm run build:all
```

## Project Structure

```
src/
  core/           # Protocol layer — Client, Packet, Crypto, Server
  features/       # Bot features — database, config, discord, AI chat, fishing, etc.
  proxy/          # Proxy server, sessions, automation, commands, triggers
  games/          # Chat game implementations
  panel/          # Web panel frontend (TypeScript, bundled with esbuild)
  types/          # Shared TypeScript interfaces
panel/            # Built frontend assets (HTML, CSS, JS)
data/             # Game data — collision maps, opcodes, monster definitions
WorldLogs/        # Map metadata exports
```

## Acknowledgments

Built on [da.js](https://github.com/ericvaladas/da.js) by Eric Valadas.

## License

[ISC](LICENSE)
