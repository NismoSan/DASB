# DA.js Bot — Complete Documentation

A multi-bot management system for Dark Ages, featuring a real-time web panel, Discord integration, chat games, player tracking, trade session management, and Aisling Exchange ingestion.

---

## Table of Contents

- [Overview](#overview)
- [Getting Started](#getting-started)
- [Bot Management](#bot-management)
- [Web Panel](#web-panel)
- [Chat Games](#chat-games)
- [Discord Integration](#discord-integration)
- [Player Tracking & Database](#player-tracking--database)
- [Trade Sessions](#trade-sessions)
- [Aisling Exchange (AE) Ingest](#aisling-exchange-ae-ingest)
- [Scheduled Messages](#scheduled-messages)
- [Dark Ages Protocol](#dark-ages-protocol)
- [Configuration Reference](#configuration-reference)
- [API Endpoints](#api-endpoints)
- [Socket.IO Events](#socketio-events)

---

## Overview

DA.js is a Node.js application that connects multiple bot characters to a Dark Ages server simultaneously. It provides:

- **Multi-bot connectivity** with auto-reconnect
- **Real-time web panel** for monitoring and control (Express + Socket.IO)
- **Chat game system** with 7 games, leaderboards, and OpenAI integration
- **Discord webhook forwarding** for world shouts, whispers, and trade messages
- **Player database** tracking presence, legends, classes, and chat history
- **Trade session management** with automated whisper flows
- **Aisling Exchange integration** for shout ingestion and account verification

### Tech Stack

| Dependency | Purpose |
|---|---|
| `darkages` | Dark Ages protocol client |
| `express` | Web server for the control panel |
| `socket.io` | Real-time WebSocket communication |
| `openai` | GPT-powered chat game content |
| `pg` | PostgreSQL database |
| `md5` | Packet hashing |
| `dotenv` | Environment variable loading |

---

## Getting Started

### Installation

```bash
npm install
```

### Running

```bash
node panel.js
```

The web panel starts on port **4000** by default (configurable via `webPort` in `bot-config.json`).

### Panel Login

Navigate to `http://localhost:4000/login` to access the web panel. Credentials are configured in `panel.js`.

---

## Bot Management

### Multi-Bot Support

The system manages multiple bot characters defined in `bot-config.json`. Each bot has:

| Field | Description |
|---|---|
| `name` | Display name |
| `username` | Dark Ages login username |
| `password` | Dark Ages login password |
| `role` | Bot role (e.g., `primary`, `secondary`) |

### Connection Behavior

- **Auto-reconnect** with exponential backoff: 5s → 10s → 20s → 30s
- **Sequential reconnect orchestration** with a configurable delay between bots (default: 5000ms)
- Per-bot status tracking: `disconnected` → `waiting_reconnect` → `logging_in` → `logged_in`
- Real-time status broadcasting to all connected panel clients

### Server Configuration

| Setting | Default |
|---|---|
| Login Server | `52.88.55.94:2610` |
| Temuair Server | `52.88.55.94:2611` |
| Medenia Server | `52.88.55.94:2612` |

### Bot Actions

Each connected bot can:

- **Say** — Send public chat messages (opcode `0x0E`)
- **Whisper** — Send private messages (opcode `0x19`)
- **Emote** — Perform emotes (opcode `0x1D`)
- **Walk** — Move in a direction (opcode `0x06`)
- **Request user list** — Query online players (opcode `0x18`)

---

## Web Panel

The web panel is a single-page application with real-time updates via Socket.IO.

### Panel Sections

#### 1. Status Dashboard
- Live connection status for all bots
- Position (x, y), map number, map name, server name
- Reconnect attempt counter and connection timestamps

#### 2. Configuration
- Edit bot credentials (username, password, role)
- Server address and port settings
- Reconnect strategy (sequential or parallel)
- Timezone configuration

#### 3. Packet Monitor
- Real-time capture of incoming and outgoing packets
- Displays opcode, body length, and hex dump
- Opcode labels for easy identification (encryption, login, redirect, chat, etc.)
- Per-bot filtering

#### 4. Chat Log
- Live chat feed with channel identification
- Sender extraction and message deduplication
- Whisper separation and mention detection
- Per-bot chat streams

#### 5. AE Ingest Panel
- Enable/disable Aisling Exchange ingestion
- Configure API URL and key
- Test connection
- View world shout logging status

#### 6. Discord Panel
- Create, edit, and delete webhook rules
- Configure pattern matching and message type filters
- Enable/disable individual rules
- Test webhook connectivity
- Set custom bot names and avatars per rule

#### 7. Chat Games Panel
- Enable/disable individual game types
- Configure command prefix and cooldown
- Toggle public/whisper chat access
- Manage custom content (trivia questions, riddles, words, fortunes, 8-ball responses)
- View and clear leaderboard
- Toggle roast mode / rage bait mode
- Host mode controls (start, stop, skip rounds)

#### 8. Players
- Browse tracked players with sorting by last seen
- Player detail view: class, title, session history, chat logs (last 200), sighting frequency, legend marks and history

#### 9. Sightings Log
- Track where and when players are sighted (chat, userlist, etc.)

#### 10. Scheduled Messages
- Create and manage timed messages
- Daily scheduling (fixed time) or interval scheduling (every N minutes)
- Per-bot targeting
- Enable/disable individual schedules

---

## Chat Games

The bot includes **7 interactive games** that players can trigger via in-game chat using a configurable command prefix (default: `+`).

### Game Commands

| Command | Description |
|---|---|
| `+trivia` | Start a trivia question |
| `+riddle` | Start a riddle |
| `+8ball <question>` | Ask the magic 8-ball |
| `+eightball <question>` | Alternative 8-ball command |
| `+scramble` | Unscramble a word |
| `+guess` / `+numberguess` | Guess a number (1-100) |
| `+fortune` | Receive a random fortune |
| `+rps` | Play rock-paper-scissors |

### Gameplay Commands

| Command | Description |
|---|---|
| `+answer <text>` or `+a <text>` | Submit your answer |
| `+hint` or `+h` | Get a hint for the current game |
| `+giveup` or `+quit` | Forfeit the current game |
| `+score` or `+scores` | View your personal stats |
| `+leaderboard` or `+top` | View the top 5 players |
| `+help` | Show available game commands |

### Game Details

#### Trivia
- Custom trivia pool with configurable questions and hints
- 25 built-in Dark Ages trivia questions as fallback
- OpenAI-generated questions as additional fallback
- Auto-timeout after 45 seconds

#### Riddle
- 8 built-in riddles with OpenAI generation fallback
- Hints available
- 45-second timeout

#### Magic 8-Ball
- Custom responses plus 12 Dark Ages-themed fallback responses
- Instant response — no answer phase

#### Word Scramble
- Custom word pool with hints
- 15 built-in Dark Ages words as fallback
- Fisher-Yates shuffle algorithm
- Exact match required, 45-second timeout

#### Number Guess
- Guess a number between 1 and 100
- 10 attempts maximum with higher/lower feedback
- 45-second timeout

#### Fortune
- Custom fortunes plus 8 Dark Ages-themed fallback fortunes
- Instant response

#### Rock-Paper-Scissors
- Best of 3 rounds
- Emote-based input: emote `0x17` = Rock, `0x18` = Scissors, `0x19` = Paper
- Whisper commands as fallback (`rock`, `paper`, `scissors`)
- 800ms delay between rounds for readability

### Host Mode (Multiplayer)

Available via whisper-only commands for multiplayer game hosting:

| Command | Description |
|---|---|
| `+host` / `+hoststart` | Start a multiplayer hosted game |
| `+hoststop` / `+hostend` | Stop the hosted game |
| `+hostskip` | Skip to the next round |

Host mode features:
- Public announcement of questions
- Free-form answer submissions from any player
- Per-round leaderboard
- Configurable number of rounds (default: 10)

### Scoring System

The bot tracks per-player stats:
- Wins, losses, current streak, best streak
- Persistent leaderboard saved to `leaderboard.json`
- Fuzzy answer matching for trivia and riddle games

### Configuration Options

| Setting | Description | Default |
|---|---|---|
| `commandPrefix` | Prefix for all commands | `+` |
| `openAiModel` | OpenAI model for content generation | `gpt-4o-mini` |
| `publicChatEnabled` | Accept commands from public chat | `true` |
| `whisperEnabled` | Accept commands from whispers | `true` |
| `cooldownSeconds` | Cooldown between commands per player | `10` |
| `roastMode` | Enable roast responses | `false` |
| `rageBaitMode` | Enable rage bait responses | `false` |

---

## Discord Integration

### How It Works

The bot forwards in-game messages to Discord channels via webhooks. Each webhook rule defines:

| Field | Description |
|---|---|
| Webhook URL | Discord webhook endpoint |
| Message Types | Which message types to forward |
| Pattern | Optional regex to filter messages |
| Bot Name | Custom name displayed in Discord |
| Avatar URL | Custom avatar for the webhook bot |
| Enabled | Toggle the rule on/off |

### Supported Message Types

| Type | Description |
|---|---|
| `WorldMessage` | World chat messages |
| `WorldShout` | World shouts (!!!) |
| `WhisperReceived` | Incoming whispers |
| `Whisper` | Outgoing whispers |
| `GuildMessage` | Guild chat |
| `PublicMessage` | Local public chat |
| `Say` | Bot-sent messages |

### Default Rules

| Rule | Trigger | Pattern |
|---|---|---|
| World Shouts | All world shouts | — |
| Whispers | All whispers | — |
| Black Market | World shouts | — |
| Buying - AE | World shouts | `B>` |
| Selling - AE | World shouts | `S>` |
| Trading - AE | World shouts | `T>` |

### Rate Limiting & Deduplication

- 600ms minimum between webhook sends
- 3-second deduplication window to prevent duplicate embeds
- Embeds include color coding by message type, sender/recipient extraction, and timestamps

---

## Player Tracking & Database

### Tracked Data

| Data | Description |
|---|---|
| Name | Character name |
| Class | Peasant, Warrior, Rogue, Wizard, Priest, Monk (+ Master variants) |
| Title | In-game title |
| Master Status | Auto-detected from class string |
| First Seen | Timestamp of first sighting |
| Last Seen | Timestamp of most recent sighting |
| User List Sightings | Up to 500 records of online presence |
| Sessions | Up to 200 appearance/disappearance records |
| Legend Marks | Achievement tracking |
| Legend History | Up to 20 snapshots of legend changes |
| Chat History | Last 200 messages per player |

### Online Presence

- Real-time user list tracking via periodic polling
- Appearance and disappearance notifications
- Social status and icon tracking

---

## Trade Sessions

The trade session system automates buyer-seller communication for in-game trades.

### Flow

```
sending → waiting_offline → waiting_response → confirmed / declined / no_reply / offline / error
```

### Features

- Automatic whisper generation to sellers
- 60-second timeout per session
- Offline detection (3-second window for "is nowhere to be found" messages)
- Alt character fallback (automatically tries alternate characters if primary is offline)
- Response parsing: yes, yeah, yep, sure → confirmed; no, nope → declined
- 15-second cooldown between whispers per buyer
- Maximum 20 concurrent active sessions
- Server-Sent Events (SSE) for real-time status updates to the requesting client
- 2-minute session retention after terminal state

### API

| Endpoint | Method | Description |
|---|---|---|
| `/api/trade/send-whisper` | POST | Initiate a trade session |
| `/api/trade/status/:sessionId` | GET | SSE stream for session status updates |

---

## Aisling Exchange (AE) Ingest

Collects and forwards world shouts to the Aisling Exchange platform.

### Features

- **Batch collection** — Aggregates world shouts before sending
- **Deduplication** — 3-second window to prevent duplicate entries
- **File logging** — Saves shouts to `/logs/world-shouts/YYYY-MM-DD.txt`
- **Batch API submission** — Up to 25 shouts per batch with 2-second delays
- **Retry logic** — Up to 3 retries with rate-limit awareness (429 handling)

### Verification

The AE ingest module also handles account verification:
- Detects verification code pattern: `AE-[A-Z0-9]+`
- Automatically forwards verification whispers to AE
- Sends auto-reply: "Thank you for verifying your account for AislingExchange!"

### Data Format

```json
{
  "playerName": "PlayerName",
  "message": "Full shout message text",
  "timestamp": "2026-03-04T12:00:00.000Z"
}
```

---

## Scheduled Messages

Automated timed messages sent by the bots.

### Schedule Types

| Type | Description |
|---|---|
| Daily | Fires at a specific time each day (e.g., 07:30) |
| Interval | Fires every N minutes (e.g., every 120 minutes) |

### Configuration

Each scheduled message has:

| Field | Description |
|---|---|
| Message | Text to send |
| Time / Interval | When or how often to send |
| Bot | Which bot sends the message |
| Type | `say` or `whisper` |
| Enabled | Toggle on/off |

### Default Schedules

| Name | Time/Interval | Type |
|---|---|---|
| "It's getting late" | Daily 22:00 | Daily |
| "Good Morning" | Daily 07:30 | Daily |
| "Lunch Time" | Daily 12:00 | Daily |
| "Goodnight" | Daily 23:00 | Daily |
| "Giveaways" | Every 240 minutes | Interval |
| "Under Glioca's Moon" | Every 120 minutes | Interval |

---

## Dark Ages Protocol

### Packet Structure

```
[0xAA] [Length: 2 bytes] [Opcode: 1 byte] [Body...]
```

- Marker byte: `0xAA`
- Length: 2 bytes (big-endian), total body + opcode size
- Strings: length-prefixed (8-bit or 16-bit), win1252 encoded

### Handled Opcodes (Incoming)

| Opcode | Name | Description |
|---|---|---|
| `0x00` | Encryption | Encryption seed setup |
| `0x02` | Login Message | Login result/message |
| `0x03` | Redirect | Redirect to game server |
| `0x04` | Map Location | Position updates (x, y) |
| `0x05` | User ID | Login success, user ID assigned |
| `0x0A` | Chat | All chat messages (public, whisper, guild, group, shout) |
| `0x15` | Map Data | Map information |
| `0x33` | Show User | Entity mapping on screen |
| `0x34` | Player Profile | Legend marks |
| `0x36` | User List | Online players list |
| `0x3B` | Ping | Keep-alive |
| `0x68` | Ping | Secondary keep-alive |
| `0x4C` | Ending | Disconnection signal |
| `0x7E` | Welcome | Welcome/handshake |

### Chat Channels (Opcode 0x0A)

| Channel | Type |
|---|---|
| 0 | Whisper (incoming) |
| 5 | World Shout |
| 11 | Group Message |
| 12 | Guild Message |
| Other | Public Message |

### Outgoing Opcodes

| Opcode | Action |
|---|---|
| `0x06` | Walk |
| `0x0E` | Say (public chat) |
| `0x19` | Whisper |
| `0x1D` | Emote |
| `0x18` | Request User List |

---

## Configuration Reference

All configuration lives in `bot-config.json`.

### Top-Level Structure

```json
{
  "webPort": 4000,
  "serverAddress": "52.88.55.94",
  "serverPort": 2610,
  "reconnectDelay": 5000,
  "timezone": "America/New_York",
  "bots": [...],
  "chatGames": {...},
  "aeIngest": {...},
  "scheduledMessages": [...],
  "discord": {...}
}
```

### Bot Entry

```json
{
  "name": "BotName",
  "username": "login_username",
  "password": "login_password",
  "role": "primary"
}
```

### Chat Games Section

```json
{
  "commandPrefix": "+",
  "openAiModel": "gpt-4o-mini",
  "publicChatEnabled": true,
  "whisperEnabled": true,
  "cooldownSeconds": 10,
  "enabledGames": {
    "trivia": true,
    "riddle": true,
    "eightBall": true,
    "scramble": true,
    "numberGuess": true,
    "fortune": true,
    "rps": true
  },
  "customContent": {
    "trivia": [...],
    "riddle": [...],
    "scramble": [...],
    "eightBall": [...],
    "fortune": [...]
  },
  "roastMode": false,
  "rageBaitMode": false
}
```

### AE Ingest Section

```json
{
  "enabled": true,
  "apiUrl": "http://your-api-server:3000/api/shouts/ingest",
  "apiKey": "your-api-key"
}
```

### Scheduled Message Entry

```json
{
  "name": "Message Name",
  "message": "Text to send",
  "type": "daily",
  "time": "07:30",
  "botName": "BotName",
  "messageType": "say",
  "enabled": true
}
```

---

## API Endpoints

### Authentication

| Endpoint | Method | Description |
|---|---|---|
| `/login` | GET | Login page |
| `/login` | POST | Authenticate and receive session token |

### Trade Sessions

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/api/trade/send-whisper` | POST | Ingest Key | Create a trade session |
| `/api/trade/status/:sessionId` | GET | Ingest Key | SSE stream for trade status |

### Panel (Socket.IO)

All other panel interactions occur via Socket.IO events (see below).

---

## Socket.IO Events

### Server → Client

| Event | Description |
|---|---|
| `bot:status` | Bot connection/position updates |
| `bot:error` | Login or connection errors |
| `bot:notification` | System notifications |
| `packet:data` | Incoming/outgoing packet data |
| `chat:message` | Chat message received |
| `whisper:received` | Whisper received |
| `mention:detected` | Bot name mentioned in chat |
| `players:list` | Full player list update |
| `players:detail` | Player profile loaded |
| `ae:config` | AE ingest configuration update |
| `discord:rules` | Discord webhook rules list |
| `chatgames:config` | Chat games configuration update |
| `chatgames:stats` | Game statistics update |
| `chatgames:leaderboard` | Leaderboard data |
| `chatgames:hostUpdate` | Host mode status change |
| `scheduled:list` | Scheduled messages list |
| `sightings:list` | Player sighting log |
| `userlist:update` | Online user list refresh |

---

## File Structure

```
da.js-master/
├── panel.js                 # Main app — Express server, bot management, Socket.IO
├── bot-config.json          # All configuration
├── discord-hooks.json       # Discord webhook rules
├── package.json             # Dependencies and scripts
├── index.js                 # Library exports (Client, Packet, Map)
│
├── lib/
│   ├── client.js            # Dark Ages protocol client
│   ├── packet.js            # Packet read/write operations
│   ├── crypto.js            # Encryption/decryption
│   ├── discord.js           # Discord webhook dispatcher
│   ├── chat-games.js        # 7 game implementations + leaderboard
│   ├── ae-ingest.js         # Aisling Exchange batch sender
│   └── trade-sessions.js    # Trade session manager with SSE
│
├── panel/
│   ├── index.html           # Web panel UI
│   ├── panel.js             # Frontend Socket.IO client logic
│   ├── panel.css            # Panel styling (gold theme)
│   └── login.html           # Login page
│
├── src/                     # Source modules (mirrored in lib/)
│   ├── database.js          # PostgreSQL database layer
│   ├── discord.js           # Discord module
│   ├── chat-games.js        # Chat games module
│   ├── ae-ingest.js         # AE ingest module
│   ├── trade-sessions.js    # Trade sessions module
│   └── packet.js            # Packet module
│
└── logs/
    └── world-shouts/        # Daily shout log files (YYYY-MM-DD.txt)
```

---

## Quick Reference — All Chat Commands

| Command | Game | Description |
|---|---|---|
| `+trivia` | Trivia | Start a trivia question |
| `+riddle` | Riddle | Start a riddle |
| `+8ball <q>` | 8-Ball | Ask the magic 8-ball |
| `+eightball <q>` | 8-Ball | Alternative command |
| `+scramble` | Scramble | Unscramble a word |
| `+guess` | Number Guess | Guess a number 1-100 |
| `+numberguess` | Number Guess | Alternative command |
| `+fortune` | Fortune | Get a random fortune |
| `+rps` | RPS | Rock-paper-scissors (best of 3) |
| `+answer <text>` | Any | Submit your answer |
| `+a <text>` | Any | Short answer command |
| `+hint` | Any | Get a hint |
| `+h` | Any | Short hint command |
| `+giveup` | Any | Forfeit current game |
| `+quit` | Any | Alternative forfeit |
| `+score` | — | View your stats |
| `+scores` | — | Alternative stats command |
| `+leaderboard` | — | View top 5 players |
| `+top` | — | Alternative leaderboard |
| `+help` | — | Show help |
| `+host` | Host | Start multiplayer (whisper only) |
| `+hoststart` | Host | Alternative host start |
| `+hoststop` | Host | Stop multiplayer (whisper only) |
| `+hostend` | Host | Alternative host stop |
| `+hostskip` | Host | Skip round (whisper only) |
