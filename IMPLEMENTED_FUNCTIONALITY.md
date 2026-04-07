# Implemented Functionality Inventory: DASB + Proxy MITM

Last verified against the active runtime wiring on April 4, 2026.

This document inventories the active DASB Node.js runtime and proxy MITM stack so new games and features can be designed against what actually exists today. It intentionally omits secrets, credentials, webhook URLs, ingest keys, and passwords.

## 1. Purpose and Reading Guide

This is an internal design/reference document, not an end-user guide. The goal is to answer:

- What capability already exists?
- Who can use it today?
- How is it surfaced: player chat, proxy command, panel route, Socket.IO, MCP, or internal runtime hook?
- What data/state does it already persist?
- Where are the safest extension points for new games and features?

### Inclusion rule

A capability is included here if it is wired into one or more of these active runtime entrypoints:

- `panel.js`
- `mcp-server.js`
- `src/core/*`
- `src/proxy/*`
- active `src/features/*`
- active `lib/features/*` or `lib/games/*` modules that `panel.js` loads directly

### Deliberate exclusions

- `src/Chaos-Server-master` is intentionally out of scope.
- `lib-backup` is out of scope because no live references were found in the active runtime paths inspected here.
- Existing prose docs such as `DOCUMENTATION.md`, `HOW_IT_WORKS.md`, and `CHAT_GAMES_GUIDE.md` were treated as secondary references only. Live code wiring wins when they disagree.

### Status tags

Capabilities can carry more than one tag when both lifecycle and implementation provenance matter.

| Tag | Meaning |
| --- | --- |
| `Live` | Wired into the active runtime and usable when the app starts normally. |
| `Conditional` | Implemented, but only active when a config flag, feature toggle, bot role, or proxy startup path enables it. |
| `Operator-Only` | Exposed to panel operators/admins rather than in-game players. |
| `Runtime-Only JS` | Live code is loaded from `lib/` with no matching active `src/` source used at runtime. |
| `Internal/Infra` | Foundation capability used by other systems, not usually a direct player feature. |
| `Partial/Experimental` | Implemented enough to be useful, but not fully surfaced, not fully productized, or higher-risk to extend. |

### Source-of-truth notes

- The active runtime is DB-backed. Inference from the inspected startup flow: root JSON files such as `bot-config.json` and `discord-hooks.json` exist in the repo, but the live startup/config paths inspected here load and persist config through the config manager and PostgreSQL-backed feature modules rather than reading those files directly.
- Proxy functionality is optional and only starts when `config.proxy.enabled` is truthy at startup.

## 2. System Overview

### Plain-English architecture

| Layer | Active entrypoints/modules | What it is responsible for |
| --- | --- | --- |
| Dark Ages protocol client/core library | `index.js`, `src/core/*` | TCP connectivity, login/redirect flow, crypto, packet framing, map parsing, opcode metadata, reusable `Client` / `Packet` / `Map` exports |
| Multi-bot orchestration and panel server | `panel.js`, `panel/*`, `src/features/auth.ts`, `src/features/config-manager.ts` | Express web server, Socket.IO control plane, panel auth, bot lifecycle, config management, panel-driven admin features |
| Proxy MITM server | `src/proxy/*`, `createProxySystem()` in `panel.js` | Local login/game listeners, redirect interception, decrypt/inspect/re-encrypt, synthetic packet injection, proxy session lifecycle |
| Proxy augmentation and automation | `src/proxy/augmentation/*`, `src/proxy/automation/*`, `src/proxy/commands/*`, `src/proxy/triggers/*` | Virtual NPCs, custom dialogs, doors, exit markers, slash commands, navigation, combat/heal/loot automation, trigger hooks |
| Gameplay / social / economy systems | `src/features/*`, `src/games/*`, plus active `lib/features/*.js` modules | Chat games, AI chat, lottery, slot machine, item trade, auction house, monster capture, fishing, AFK shadow world, trade sessions |
| Persistence and observability | `src/features/database.ts`, feature-owned schemas, JSON/binary files under `data/`, packet capture DB writes, panel packet streams | Long-lived state for players, games, proxy captures, AFK progression, monster/fishing systems, sprite overrides, map data, operator state |
| MCP tooling | `mcp-server.js`, `data/opcodes.xml`, `src/mcp/*` | Packet decoding, packet analysis, packet capture search/stats, opcode definition management |

### Runtime shape

- DASB can run as a standard multi-bot panel app without the proxy.
- When proxy mode is enabled, `panel.js` boots a second runtime layer that accepts Dark Ages client connections locally, forwards them to the real servers, and augments traffic in both directions.
- Some large feature systems are conditional on proxy mode because they depend on proxy-only hooks:
  - virtual NPCs
  - custom doors
  - exit markers
  - automation/navigation
  - auction house
  - monster capture
  - fishing
  - AFK shadow mode/world
- A few active features are runtime-only JS modules loaded directly from `lib/`:
  - `auction-house`
  - `item-trade`
  - `npc-leak`
  - `slot-machine`
  - `lottery`
  - `afk-mode`

## 3. Capability Inventory by Subsystem

### 3.1 Core Protocol / Client Library

#### Packet encode/decode and framing

- **Status:** `Live`, `Internal/Infra`
- **Who uses it:** All bot clients, the proxy server, packet-injecting features, MCP tooling, and any code building or reading Dark Ages packets.
- **How it is accessed:** `index.js` exports `Packet`; implementation lives in `src/core/packet.ts`.
- **What it does:** Builds and parses `0xAA`-framed Dark Ages packets, supports integer/string read/write helpers, and exposes full packet buffers for socket writes.
- **Key data/state:** `opcode`, `sequence`, `position`, `body`.
- **Important limits/notes:** Packet instances do not validate semantic schemas; callers must know the expected protocol shape.

#### Client connectivity, login, redirect, and reconnect flow

- **Status:** `Live`
- **Who uses it:** Standard DASB bots that connect directly to Dark Ages servers.
- **How it is accessed:** `Client` export from `index.js`; implementation in `src/core/client.ts` and `src/core/packet-handlers.ts`.
- **What it does:** Connects to the login server by default, negotiates encryption/version, follows server redirects, confirms identity, logs in, enters the world, and auto-reconnects with backoff.
- **Key data/state:** `appVersion`, `username`, `password`, `crypto`, `encryptSequence`, reconnect timers/attempt counters, `events`, `server`, `socket`.
- **Important limits/notes:** Auto-reconnect is built into `Client`; panel-level bot management builds on top of it rather than replacing it.

#### Crypto, CRC, and version negotiation

- **Status:** `Live`, `Internal/Infra`
- **Who uses it:** Direct bot connections, proxy session encryption/decryption, login/identity flows.
- **How it is accessed:** `src/core/crypto.ts`, `src/core/crc.ts`, login packet handlers, and proxy crypto wrappers.
- **What it does:** Implements Dark Ages packet encryption, sequence handling, CRC16-based identity checks, and version fallback when the server reports the client version is too high or too low.
- **Key data/state:** per-session seed/key/name, encrypt sequence counters, CRC lookup tables.
- **Important limits/notes:** Proxy mode maintains separate client-side and server-side crypto states and can resequence traffic after injecting packets.

#### Server registry and endpoint labeling

- **Status:** `Live`, `Internal/Infra`
- **Who uses it:** Direct client connections, login/redirect handling, operator-facing status displays.
- **How it is accessed:** `src/core/server.ts`.
- **What it does:** Maps known endpoints to Login, Temuair, and Medenia, and labels server connections consistently.
- **Key data/state:** `LoginServer`, `TemuairServer`, `MedeniaServer`.
- **Important limits/notes:** The active registry only contains the known official endpoints baked into the code.

#### Map file parsing and local map serialization

- **Status:** `Live`, `Internal/Infra`
- **Who uses it:** Core client map helpers, navigator tooling, proxy map substitution/injection code.
- **How it is accessed:** `Map` export from `index.js`; implementation in `src/core/map.ts`.
- **What it does:** Parses map row data from packets or local `.map` buffers, stores per-row tile data, and saves/loads map buffers from disk.
- **Key data/state:** `Width`, `Height`, `mapData_`.
- **Important limits/notes:** Local `.map` handling matters heavily in proxy mode because map substitution injects rows from local files instead of trusting server tile row payloads.

#### Opcode metadata and packet labeling

- **Status:** `Live`, `Internal/Infra`
- **Who uses it:** Packet logging, panel packet monitor, MCP tools, packet capture persistence.
- **How it is accessed:** `src/core/opcodes.ts` plus `data/opcodes.xml`.
- **What it does:** Associates numeric opcodes with human-readable names, directions, and optional field definitions.
- **Key data/state:** XML-backed opcode registry loaded at runtime; MCP can update it.
- **Important limits/notes:** This is the live protocol glossary used by packet capture and packet analysis tooling, not just a static reference file.

### 3.2 Bot Orchestration and Panel Backend

#### Multi-bot lifecycle orchestration

- **Status:** `Live`
- **Who uses it:** Panel operators.
- **How it is accessed:** `panel.js`, Socket.IO bot control events, config-managed bot definitions.
- **What it does:** Tracks multiple bots, starts/stops/reconnects them, assigns roles such as `primary`, `secondary`, `lottery`, and `sense`, and maintains per-bot runtime state.
- **Key data/state:** bot config entries, bot map in memory, connection status, reconnect attempts, serial/position/chat/entity caches per bot.
- **Important limits/notes:** Several features depend on role-based bot selection rather than a global singleton bot.

#### Sequential reconnect and status broadcasting

- **Status:** `Live`
- **Who uses it:** Panel operators and any UI reading bot status.
- **How it is accessed:** `panel.js` reconnect orchestration plus Socket.IO status emissions.
- **What it does:** Coordinates reconnect timing across multiple bots, preserves delay-between-bots settings, and pushes connection/status changes to the panel.
- **Key data/state:** `reconnectStrategy`, per-bot status fields, retry counters.
- **Important limits/notes:** Bot-level `Client` auto-reconnect still exists underneath the panel orchestration.

#### Panel authentication and cookie sessions

- **Status:** `Live`, `Operator-Only`
- **Who uses it:** Web panel operators.
- **How it is accessed:** `src/features/auth.ts`, `/login`, `/api/login`, `/api/logout`, and `authMiddleware` in `panel.js`.
- **What it does:** Validates a single username/password pair from env vars, issues an in-memory `dasb_session` cookie token, and protects most panel routes.
- **Key data/state:** in-memory active session token map, 24-hour session TTL.
- **Important limits/notes:** Sessions are memory-only, so panel logins do not survive process restarts. Several public/external APIs are intentionally exempt from cookie auth.

#### DB-backed config management

- **Status:** `Live`, `Internal/Infra`
- **Who uses it:** Panel operators, feature modules, startup bootstrap.
- **How it is accessed:** `src/features/config-manager.ts`, DB load/save methods in `src/features/database.ts`, `config:save` Socket.IO flow.
- **What it does:** Holds cached config, merges defaults, migrates older single-bot config shapes, saves updated config to PostgreSQL, and fans config changes back out to runtime systems.
- **Key data/state:** cached config object, `bot_config` table.
- **Important limits/notes:** Inference from inspected startup code: DB-backed config is the active source of truth; root `bot-config.json` is not part of the active startup path inspected here.

#### Express panel pages and static assets

- **Status:** `Live`, `Operator-Only`
- **Who uses it:** Panel operators.
- **How it is accessed:** `panel.js` plus files in `panel/`.
- **What it does:** Serves the main panel, login page, and a dedicated chat page, plus bundled JS/CSS assets for dashboard and proxy UI.
- **Key data/state:** `panel/index.html`, `panel/login.html`, `panel/chat.html`, `panel/panel.js`, `panel/proxyserver.js`.
- **Important limits/notes:** Static asset serving sits behind auth middleware except for the specific paths explicitly exempted.

#### Socket.IO real-time control plane

- **Status:** `Live`, `Operator-Only`
- **Who uses it:** Panel operators and panel frontend code.
- **How it is accessed:** Socket.IO server created in `panel.js`.
- **What it does:** Provides the primary admin control surface for proxy management, bot actions, navigation, chat games, AI chat, knowledge base management, scheduling, attendance, monster admin, NPC leak tooling, and hot reload.
- **Key data/state:** 123 `socket.on(...)` handlers plus many emitted update channels.
- **Important limits/notes:** Many major admin functions are Socket.IO-only and have no REST equivalent.

#### Sprite rendering and appearance inspection APIs

- **Status:** `Live`
- **Who uses it:** Panel UI, external callers viewing sprite previews, operators fixing bad appearance data.
- **How it is accessed:** sprite/appearance REST endpoints in `panel.js` and the sprite renderer feature module.
- **What it does:** Renders player sprites from tracked appearance records, allows per-player sprite overrides, exposes head/armor browsing endpoints, and serves raw appearance JSON.
- **Key data/state:** player appearance records, `data/sprite-overrides.json`, renderer caches/stats.
- **Important limits/notes:** Sprite routes are intentionally auth-exempt, so they function as lightweight public preview endpoints.

### 3.3 Proxy MITM Server

#### Local login/game listeners and redirect interception

- **Status:** `Conditional`
- **Who uses it:** Players connecting their Dark Ages client through the local proxy.
- **How it is accessed:** `createProxySystem()` in `panel.js`, `src/proxy/proxy-server.ts`.
- **What it does:** Listens on login and game ports, forwards to the real servers, captures redirect reconnects, and attaches reconnecting clients to their existing proxy session state.
- **Key data/state:** `listenPort`, `gamePort1`, `gamePort2`, `publicAddress`, real server endpoint config, session map.
- **Important limits/notes:** None of this exists unless `config.proxy.enabled` is set at startup.

#### Session phases and dual crypto state

- **Status:** `Conditional`, `Internal/Infra`
- **Who uses it:** Proxy server internals and all proxy-driven gameplay systems.
- **How it is accessed:** `src/proxy/proxy-session.ts`.
- **What it does:** Tracks each proxied connection through `login`, `redirect`, and `game` phases while maintaining separate client-side and server-side crypto state, buffers, player state, AFK state, and substitution state.
- **Key data/state:** `clientCrypto`, `serverCrypto`, encrypt sequences, `pendingRedirect`, `playerState`, AFK shadow state, substituted map data, refresh flags.
- **Important limits/notes:** Many higher-level systems assume session-level player state has already been learned from intercepted packets.

#### Decrypt -> inspect -> resequence -> re-encrypt pipeline

- **Status:** `Conditional`, `Internal/Infra`
- **Who uses it:** Proxy core, packet inspector middleware, augmentation/automation layers.
- **How it is accessed:** `src/proxy/proxy-server.ts`, `src/proxy/packet-inspector.ts`, proxy crypto helpers.
- **What it does:** Decrypts traffic in both directions, routes packets through middleware and block lists, optionally modifies or injects packets, resequences outbound client packets after injected traffic, then re-encrypts and forwards them.
- **Key data/state:** opcode block lists, middleware chain, resequence flag, packet direction metadata.
- **Important limits/notes:** This is one of the highest-risk extension points because mistakes can desync encryption or ordinal handling.

#### Packet blocking, capture, panel streaming, and DB persistence

- **Status:** `Conditional`, `Operator-Only`, `Internal/Infra`
- **Who uses it:** Panel operators and MCP tooling.
- **How it is accessed:** `proxy:block:*`, `proxy:capture:*` Socket.IO events, packet inspector callback in `panel.js`, `persistPacketCapture()` in `src/features/database.ts`.
- **What it does:** Blocks specific opcodes by direction, buffers packet summaries for the panel, optionally stores hex bodies for selected packets, and persists packet captures for later search and analysis.
- **Key data/state:** block lists, `captureEnabled`, `captureOpcodes`, in-memory `capturedPackets`, `packet_captures` table.
- **Important limits/notes:** Capture persistence only stores body hex and metadata, not raw encrypted frames.

#### Synthetic packet injection to client and server

- **Status:** `Conditional`, `Internal/Infra`
- **Who uses it:** Virtual NPCs, automation, exit markers, map substitution, auction/fishing/AFK systems, proxy admin tools.
- **How it is accessed:** `ProxyServer.sendToClient()` and `ProxyServer.sendToServer()`.
- **What it does:** Lets higher-level systems impersonate either side of the connection by sending packets through the correct proxy crypto state.
- **Key data/state:** session-side client/server encrypt sequence counters.
- **Important limits/notes:** Server-bound injection forces future client packets to be re-sequenced to maintain monotonic ordinals.

#### Map substitution and tile row injection

- **Status:** `Conditional`
- **Who uses it:** Proxy operators, custom map workflows, custom doors, AFK/refresh workflows.
- **How it is accessed:** proxy config map substitutions, `/mapswap` command, map injection internals in `src/proxy/proxy-server.ts`.
- **What it does:** Replaces one map with another local `.map` file, computes CRC16 for local map files, injects `0x3C` tile rows and optional `0x58` completion packets, and refreshes sessions so the client rebuilds the map.
- **Key data/state:** `mapSubstitutions`, cached map file info, per-session substituted map state, `mapsDir`.
- **Important limits/notes:** Uses local map files and injected tile rows rather than trusting the live server to provide substitute data.

#### Proxy player/entity registry

- **Status:** `Conditional`, `Internal/Infra`
- **Who uses it:** Augmentation, automation, monster/fishing systems, panel proxy displays.
- **How it is accessed:** `src/proxy/player-registry.ts`.
- **What it does:** Tracks proxied players, nearby entities, ground items, virtual entities, positions, HP bars, and session lifecycle events.
- **Key data/state:** `players`, `entities`, `groundItems`, `virtualEntities`, virtual serial allocator.
- **Important limits/notes:** Some entity parsing is best-effort because protocol shapes vary by packet variant.

#### Disguises, name tags, and custom legend hooks

- **Status:** `Conditional`
- **Who uses it:** Proxy-connected players and panel operators.
- **How it is accessed:** proxy startup wiring in `panel.js`, `/nametag`, `king`, panel disguise/legend Socket.IO events, `getPlayerDisguise`, `getCustomLegendsForPlayer`.
- **What it does:** Overlays custom legends, supports per-player disguises, toggles special king mode for one character, and changes proxy-rendered name-tag style.
- **Key data/state:** `data/custom-legends.json`, `data/disguise-state.json`, `data/proxy-firstlogins.json`, proxy server hooks for legend/disguise lookups.
- **Important limits/notes:** Enhanced Aisling legend issuance is automatic on first proxy login and persists first-login month/year text separately.

### 3.4 Proxy Augmentation

#### Virtual NPC injection and visibility management

- **Status:** `Conditional`
- **Who uses it:** Proxy-connected players, panel operators, gameplay systems built on fake NPCs.
- **How it is accessed:** `src/proxy/augmentation/npc-injector.ts`, panel proxy NPC events, `/npc` commands.
- **What it does:** Places synthetic NPCs into the client world, tracks map/range visibility, supports both live-world and AFK-world scopes, and removes/reinserts NPCs when sessions refresh or move maps.
- **Key data/state:** virtual NPC definitions, serial allocation, per-session visibility state.
- **Important limits/notes:** Many advanced systems reuse this instead of building direct packet injections themselves.

#### Dialog/menu/text-input virtualization

- **Status:** `Conditional`, `Internal/Infra`
- **Who uses it:** Auction house, fishing NPC, monster keeper, custom NPC dialogs, future dialog-driven games.
- **How it is accessed:** `src/proxy/augmentation/dialog-handler.ts` and AugmentationEngine interaction hooks.
- **What it does:** Intercepts dialog/menu packets intended for virtual entities and routes click, menu choice, dialog choice, and text input events to custom handlers.
- **Key data/state:** per-session dialog state, virtual entity IDs, pursuit/step IDs.
- **Important limits/notes:** This is the main reusable interaction layer for building in-world proxy-driven menus and text prompts.

#### Custom teleport doors

- **Status:** `Conditional`
- **Who uses it:** Proxy operators and players walking into injected doors.
- **How it is accessed:** `src/proxy/augmentation/custom-doors.ts`, `/door` command, persisted door data.
- **What it does:** Creates virtual door NPCs at the player’s location that teleport to a target map/coordinate, with separate live-world and AFK-world transport modes.
- **Key data/state:** `data/custom-doors.json`, source/target map IDs and coordinates, transport mode, door NPC definitions.
- **Important limits/notes:** Custom door placement relies on proxy-only virtual NPC visibility and synthetic movement/map transfer flows.

#### Exit markers and AFK exit markers

- **Status:** `Conditional`
- **Who uses it:** Proxy operators and proxy-connected players.
- **How it is accessed:** `src/proxy/augmentation/exit-marker.ts`, `/exitmark`, `/afkexitmark`, panel refresh hooks.
- **What it does:** Renders animated markers on exit tiles, supports adding/removing/listing markers, exposes animation speed/refresh interval controls, and separately tracks AFK shadow-world exits.
- **Key data/state:** `data/door-animations.json`, `data/map-exits.json`, per-session timers/visibility state.
- **Important limits/notes:** Exit markers are visual aids, not the teleport logic itself.

#### Persistent NPC position overrides and proactive reinjection

- **Status:** `Conditional`, `Operator-Only`
- **Who uses it:** Proxy operators adjusting visible positions/sprites of real server NPCs.
- **How it is accessed:** `/npc move`, `/npc sprite`, `/npc reset`, `/npc overrides`, proactive override logic in `src/proxy/index.ts`.
- **What it does:** Saves position/sprite/direction/serial overrides for real NPCs and proactively injects them at override positions when players enter range.
- **Key data/state:** `data/npc-positions.json`.
- **Important limits/notes:** This is not limited to virtual NPCs; it can reposition real entities as seen by proxy clients.

#### Slash command framework and proxy-only chat injection

- **Status:** `Conditional`, `Internal/Infra`
- **Who uses it:** Proxy-connected players and operators issuing in-world slash commands.
- **How it is accessed:** `CommandRegistry`, AugmentationEngine command parsing, `/help` and other registered commands.
- **What it does:** Parses slash commands from proxied player chat, dispatches handlers, injects local chat/system messages, and acts as the main extension point for proxy-side player command UX.
- **Key data/state:** registered command map, help text, chat injector.
- **Important limits/notes:** This is separate from normal bot public/whisper commands used by chat games.

### 3.5 Proxy Automation

#### Map graph and live collision ingestion

- **Status:** `Conditional`, `Internal/Infra`
- **Who uses it:** Navigation, combat movement, AFK world movement, map tools.
- **How it is accessed:** `src/proxy/automation/index.ts`, `ProxyCollision`, `MapGraph`, navigator classes.
- **What it does:** Loads SOTP data from `data/sotp.bin`, learns map names and dimensions from live packets, maintains cross-map exit graph data, and ingests live `0x3C` tile rows for walkability.
- **Key data/state:** `data/sotp.bin`, `data/map-exits.json`, generated `data/map-nodes.json`, per-session tile/collision state.
- **Important limits/notes:** Collision is hybrid: SOTP comes from disk, tile geometry comes from live packets.

#### Single-map walking, follow, and cross-map navigation

- **Status:** `Conditional`
- **Who uses it:** Proxy-connected players using slash commands or panel controls.
- **How it is accessed:** `/goto`, `/walk`, `/follow`, `/nav`, panel `proxy:*` movement events, `bot:*` navigation events.
- **What it does:** Walks to coordinates, steps directional paths, follows another player by movement events, and performs map-to-map navigation using the learned exit graph.
- **Key data/state:** per-session navigator, active paths, follow target name, map graph.
- **Important limits/notes:** Follow mode relies on tracked entity movement; cross-map path quality depends on map-exit data coverage.

#### Spell and skill tracking/casting

- **Status:** `Conditional`
- **Who uses it:** Proxy-connected players using automation commands and systems that cast automatically.
- **How it is accessed:** `/cast`, `/skill`, `/spells`, `/skills`, `SpellCaster`.
- **What it does:** Learns spells/skills from live add/remove packets, lists tracked bars, and sends cast/use actions by human-readable name.
- **Key data/state:** learned spell and skill slots, cast lines/prompts where available.
- **Important limits/notes:** The system only knows spells and skills the proxy has observed for the current session.

#### Combat grind orchestration

- **Status:** `Conditional`
- **Who uses it:** Proxy-connected players and panel operators driving grind automation.
- **How it is accessed:** `/grind ...` commands and `grind:*` Socket.IO events.
- **What it does:** Starts/stops combat loops, selects targets, supports ignore lists and image excludes, configures lure/engagement modes, and coordinates with healing and desync monitoring.
- **Key data/state:** combat config, target selector rules, ignore/image filters, running state.
- **Important limits/notes:** This is a composite system whose usefulness depends on registry quality, spell/skill tracking, and map/collision data.

#### Heal engine

- **Status:** `Conditional`
- **Who uses it:** Automation users and combat loops.
- **How it is accessed:** `/heal ...` commands and combat engine callbacks.
- **What it does:** Monitors HP/MP, uses configured healing spells/items/logic, and can be toggled separately from the main grind loop.
- **Key data/state:** heal config, thresholds, cooldown handling, current HP/MP.
- **Important limits/notes:** The heal engine is explicitly wired as a combat interrupt.

#### Loot engine

- **Status:** `Conditional`
- **Who uses it:** Automation users.
- **How it is accessed:** `/loot ...` commands and grind Socket.IO config helpers.
- **What it does:** Tracks ground items, supports allowlist/denylist filtering, and collects drops while coordinating with combat pressure checks.
- **Key data/state:** filter mode, item filter set, enabled state, nearby ground-item registry.
- **Important limits/notes:** Loot behavior depends on entity/item tracking quality and combat state.

#### Buff tracking and self-status awareness

- **Status:** `Conditional`, `Internal/Infra`
- **Who uses it:** Combat automation, heal logic, `/buffs`.
- **How it is accessed:** `BuffTracker`, spell bar updates, spell animation tracking.
- **What it does:** Tracks active self buffs, recognizes named statuses like Aite/Fas/Dion/Cradh/Hide/poison, and tracks entity spell animations for debuff/target logic.
- **Key data/state:** self buff icon set, tracked entity spell effects.
- **Important limits/notes:** Buff interpretation is only as good as the current icon/effect mapping implemented in the code.

#### Desync monitoring

- **Status:** `Conditional`
- **Who uses it:** Automation users.
- **How it is accessed:** `DesyncMonitor`, `/grind` lifecycle, `/stop`.
- **What it does:** Watches movement/combat behavior for signs that the proxy/client/server state has drifted and supports stop/recovery behavior.
- **Key data/state:** monitor timers and session-local movement state.
- **Important limits/notes:** This is a safety subsystem rather than a user-facing feature.

#### Inventory and equipment tracking

- **Status:** `Conditional`, `Internal/Infra`
- **Who uses it:** `/inventory`, slot machine/item trade logic, automation, AFK systems.
- **How it is accessed:** `ProxySession.playerState.inventory` and `equipment`, packet-derived updates, inventory-related feature modules.
- **What it does:** Maintains tracked inventory/equipment state from observed packets so higher-level systems can reason about items by slot/name.
- **Key data/state:** inventory map, equipped item map, slot-indexed item metadata.
- **Important limits/notes:** Tracking is session-observed state, not an authoritative server query system.

### 3.6 Monster Systems

#### Monster capture schema and species data management

- **Status:** `Conditional`
- **Who uses it:** Players in the proxy monster system and panel operators editing species/moves data.
- **How it is accessed:** `src/features/monster-capture/*`, `monster_captures` table, `monsters:*` Socket.IO admin events.
- **What it does:** Persists captured monsters, stores active/companion state, loads configurable species/evolution/move data, and exposes operator edit/search/leaderboard tooling.
- **Key data/state:** `monster_captures` table, `config.proxy.monsters.speciesData`.
- **Important limits/notes:** Species/move content is operator-editable and stored in config, while captured monsters are stored in DB.

#### Wild encounters and capture flow

- **Status:** `Conditional`
- **Who uses it:** Proxy-connected players on the configured encounter maps.
- **How it is accessed:** automatic step-based encounter hooks and `/capture`.
- **What it does:** Rolls encounters while players move through configured grass regions, spawns wild monsters, and resolves capture attempts.
- **Key data/state:** encounter map number, encounter rate, wild despawn timer, collision-aware player step hooks.
- **Important limits/notes:** Depends on proxy position events and only exists when monster mode is enabled in proxy config.

#### Active monster management

- **Status:** `Conditional`
- **Who uses it:** Players using monster commands.
- **How it is accessed:** `/monsters`, `/active`, `/mstats`, `/nickname`.
- **What it does:** Lists owned monsters, selects the active monster, shows detailed stats, and renames the active monster.
- **Key data/state:** owner-to-monster rows, `is_active`, stats, XP-to-next, move slots, nickname.
- **Important limits/notes:** The system models a small monster roster and treats one monster as active at a time.

#### PvE and PvP battle flow

- **Status:** `Conditional`
- **Who uses it:** Players in the monster system.
- **How it is accessed:** `/fight`, `/battle <player>`, `/accept`, `/decline`, `/forfeit`.
- **What it does:** Starts wild battles, challenges other players, accepts/declines/forfeits, and routes battle UI/state through proxy augmentation.
- **Key data/state:** battle sessions, active monster stats, proxy battle UI/dialog state.
- **Important limits/notes:** Battle state is tied to proxy sessions and cleaned up on map change/teleport/disconnect.

#### Training and leaderboards

- **Status:** `Conditional`
- **Who uses it:** Monster players and panel operators.
- **How it is accessed:** `/train`, Socket.IO `monsters:leaderboard`.
- **What it does:** Grants passive XP training, levels monsters, persists stat updates, and exposes leaderboard queries by wins/level.
- **Key data/state:** XP, level, wins/losses, leaderboard query results.
- **Important limits/notes:** Training is implemented as a lightweight command-driven progression path rather than a deep content system.

#### Companion spawning and keeper NPC

- **Status:** `Conditional`
- **Who uses it:** Monster players interacting in proxy mode.
- **How it is accessed:** companion lifecycle hooks, `/companion`, monster keeper NPC initialization/assignment.
- **What it does:** Auto-spawns the active monster as a companion after login, refreshes companion state on changes, and provides a keeper NPC bound to proxy augmentation dialogs/NPC injection.
- **Key data/state:** `companion_out`, keeper NPC config in `config.proxy.monsters`.
- **Important limits/notes:** Keeper NPC assignment can be re-bound to different virtual NPCs from the panel/proxy commands.

### 3.7 Fishing

#### Fishing NPC and dialog flow

- **Status:** `Conditional`
- **Who uses it:** Proxy-connected players and operators assigning fishing to an NPC.
- **How it is accessed:** `src/features/fishing/index.ts`, panel `proxy:npc:fishing`, fishing NPC interaction handlers.
- **What it does:** Initializes or binds a fishing NPC, attaches custom interaction handlers, and serves as the player-facing entry point for the fishing system.
- **Key data/state:** fishing NPC serial, resolved config, per-session fishing dialog state.
- **Important limits/notes:** Fishing is proxy-only because it depends on injected NPCs and proxy entity/event handling.

#### Zone/species configuration and hotspot rotation

- **Status:** `Conditional`
- **Who uses it:** Fishing players and operators configuring the system.
- **How it is accessed:** `FishingConfig` in `src/features/fishing/index.ts`.
- **What it does:** Defines fish species, zones, spawn weighting, hotspot rotation, rod heuristics, ambient NPC speech, and spawn timing.
- **Key data/state:** species config, zone config, hotspot timer, species map, zone runtime map.
- **Important limits/notes:** The default config is rich enough to support multiple rarity tiers, size classes, and fish behaviors.

#### Fish lifecycle and struggle states

- **Status:** `Conditional`
- **Who uses it:** Players actively fishing.
- **How it is accessed:** runtime encounter state in `src/features/fishing/index.ts`.
- **What it does:** Spawns fish entities, reserves them for players, models fake bites/true bites/hooked/struggle/exhausted/caught/escaped states, and tracks owner session/state transitions.
- **Key data/state:** per-fish encounter objects, timers, owner session IDs, glimmer/perfect catch flags.
- **Important limits/notes:** This is a fairly deep simulation-style minigame, not just a random reward roll.

#### Catch persistence, journals, and leaderboards

- **Status:** `Conditional`
- **Who uses it:** Fishing players and panel-facing fishing summaries.
- **How it is accessed:** `src/features/fishing/db.ts`.
- **What it does:** Stores every catch, computes totals, journals, personal bests, species records, largest catches, and catch-count leaderboards.
- **Key data/state:** `fishing_catches` table and related query helpers.
- **Important limits/notes:** Fishing owns its own schema outside the main 19-table bootstrap in `database.ts`.

### 3.8 AFK Shadow Systems

#### AFK mode wrapper and AFK chat gating

- **Status:** `Conditional`, `Runtime-Only JS`
- **Who uses it:** Proxy-connected players using AFK mode.
- **How it is accessed:** `lib/features/afk-mode.js`, `/afk`, `/afkchat`.
- **What it does:** Toggles players into a separate AFK shadow-world representation, mirrors them back out on exit, and lets them choose whether chat still goes to the real server while AFK.
- **Key data/state:** `session.afkState`, real vs shadow coordinates/map IDs, chat-to-server toggle, spell/skill cooldown state.
- **Important limits/notes:** The command wrapper is runtime-only JS even though much of the underlying AFK engine exists in `src/features/afk/*`.

#### Shadow world simulation

- **Status:** `Conditional`, `Partial/Experimental`
- **Who uses it:** AFK players and future features that want a separate simulated world.
- **How it is accessed:** `src/features/afk/*` plus runtime initialization from `panel.js`.
- **What it does:** Creates a separate shadow world with custom map handling, viewport refresh, warp reactor checks, NPCs, merchants, groups, and AFK-specific show-user/state replication.
- **Key data/state:** shadow world objects, map config, visible player sets, AFK refresh events.
- **Important limits/notes:** This is one of the more ambitious subsystems and one of the riskier ones to extend without careful packet/state review.

#### Shadow combat, spells/skills, loot, and progression

- **Status:** `Conditional`, `Partial/Experimental`
- **Who uses it:** AFK players.
- **How it is accessed:** `AfkEngine` plus submodules in `src/features/afk/combat`, `loot`, `monsters`, `progression`, `inventory`, `effects`.
- **What it does:** Simulates monsters, damage, loot, item inventory, shadow spell/skill books, XP/level progression, and AFK-targeted spell/skill/assail actions.
- **Key data/state:** shadow stats, shadow inventory, spell/skill metadata, monster spawners/templates, loot tables.
- **Important limits/notes:** This is a real subsystem, not just a placeholder, but it still has more moving pieces than the standard bot/runtime features.

#### AFK persistence tables and JSON data

- **Status:** `Conditional`, `Internal/Infra`
- **Who uses it:** AFK systems and any future AFK extensions.
- **How it is accessed:** `afk_shadow_progress`, `afk_shadow_inventory`, `afk_shadow_spells`, plus JSON files under `data/afk/`.
- **What it does:** Persists shadow progression state, inventory state, spell/skill bars, level tables, and loot tables across restarts.
- **Key data/state:** AFK DB tables, `data/afk/level-table.json`, `data/afk/loot-tables.json`.
- **Important limits/notes:** AFK uses both DB-backed persistence and JSON-driven content tables.

### 3.9 Social / Gameplay Systems

#### Chat game framework and command routing

- **Status:** `Conditional`
- **Who uses it:** In-game players talking to bots by public chat or whisper; panel operators configuring games.
- **How it is accessed:** `src/games/index.ts`, `chatgames:*` Socket.IO events, player chat parsing in `panel.js`.
- **What it does:** Routes prefixed commands to individual game modules, tracks active game sessions, checks cooldowns, and supports both public and whisper play.
- **Key data/state:** game config, active game map, cooldown map, leaderboard stats, custom content pools.
- **Important limits/notes:** The live game list is broader than older docs imply: trivia, riddle, eightball, scramble, numberguess, fortune, rps, blackjack, and hangman are all wired.

#### Individual chat games and fallback content

- **Status:** `Conditional`
- **Who uses it:** In-game players.
- **How it is accessed:** `+`/configured-prefix game commands.
- **What it does:** Provides question/answer games, instant-response utilities, RPS, blackjack variants, and hangman, using built-in pools and OpenAI where configured.
- **Key data/state:** custom trivia/riddle/word/8-ball/fortune pools, built-in fallback decks, active per-player session state.
- **Important limits/notes:** Games remain usable with fallback content even if OpenAI is unavailable for some modes.

#### Host mode and group blackjack

- **Status:** `Conditional`
- **Who uses it:** Players in hosted multiplayer sessions and operators reviewing status.
- **How it is accessed:** whisper host commands and `chatgames:host*` / `chatgames:bj*` Socket.IO events.
- **What it does:** Runs multiplayer hosted rounds, controls host lifecycle, exposes hosted-game status, and supports group blackjack start/force-start/stop flows.
- **Key data/state:** host session state, group blackjack session state, round counters.
- **Important limits/notes:** These are multiplayer overlays on top of the base chat-game framework, not separate standalone services.

#### AI chat / Jarvis mode

- **Status:** `Conditional`
- **Who uses it:** In-game players messaging or mentioning the configured bot; operators managing blacklist/knowledge.
- **How it is accessed:** `src/features/ai-chat.ts`, `aichat:*` and `knowledge:*` Socket.IO events.
- **What it does:** Responds in character using OpenAI, persists conversation history, injects recent public chat context, adds live online-player and leaderboard context, and respects a player blacklist.
- **Key data/state:** OpenAI client, per-player conversation cache, player chat log cache, blacklist, knowledge cache, `ai_conversations` table.
- **Important limits/notes:** Requires `OPENAI_API_KEY` for actual model calls; knowledge base and live-context augmentation are separate from the chat-game system.

#### Knowledge base CRUD and cache

- **Status:** `Live`, `Operator-Only`
- **Who uses it:** Operators curating AI knowledge; AI chat at runtime.
- **How it is accessed:** `knowledge:list`, `knowledge:save`, `knowledge:delete`, `knowledge:bulk-import`, `knowledge_base` table.
- **What it does:** Stores structured knowledge entries for AI chat, bulk imports entries, and hot-refreshes the in-memory AI knowledge cache after edits.
- **Key data/state:** `knowledge_base` table, AI knowledge cache.
- **Important limits/notes:** Knowledge is injected into AI prompts as full cached entries, so large expansions should consider token growth.

#### Attendance tracking

- **Status:** `Live`, `Operator-Only`
- **Who uses it:** Panel operators running attendance events.
- **How it is accessed:** `attendance:*` Socket.IO events and DB tables.
- **What it does:** Starts/stops attendance events, captures player sightings during the event window, and stores summarized attendance records.
- **Key data/state:** `attendance_events`, `attendance_records`.
- **Important limits/notes:** This is an operator workflow built on top of existing player/userlist tracking.

### 3.10 Economy / Trade Systems

#### Trade sessions for Aisling Exchange whisper-to-buy flow

- **Status:** `Live`
- **Who uses it:** External AE-style integrations, bot operators, in-game buyers/sellers reached by the bot.
- **How it is accessed:** `/api/trade/send-whisper`, `/api/trade/status/:sessionId`, `src/features/trade-sessions.ts`.
- **What it does:** Starts a seller-contact workflow, sends in-game whispers, handles Yes/No replies, detects offline sellers, tries seller alts, and streams session status over SSE.
- **Key data/state:** in-memory trade session map, pending whisper map, SSE client map, buyer cooldowns.
- **Important limits/notes:** These routes are protected by `x-ingest-key`, not panel cookie auth.

#### Lottery system

- **Status:** `Conditional`, `Runtime-Only JS`
- **Who uses it:** Players trading lottery entries and operators controlling draws/delivery.
- **How it is accessed:** lottery REST endpoints, `lottery:*` Socket.IO events, in-game exchange packets, lottery bot role.
- **What it does:** Accepts gold-bar trades as tickets, persists ticket state, selects a winner, can deliver prizes in game, and can sync lottery history to an AE backend.
- **Key data/state:** `data/lottery.json`, active exchange state, ticket list, payout state, optional AE sync settings.
- **Important limits/notes:** Includes provably-fair style audit data in the draw path and requires the winner to be nearby for in-game delivery.

#### Slot machine core, queueing, cashout, and banking

- **Status:** `Runtime-Only JS`
- **Who uses it:** Players interacting with the slot system and operators using REST/panel controls.
- **How it is accessed:** slot REST endpoints, in-game whispers/exchanges, slot machine module initialization.
- **What it does:** Manages player balances/credits, spins against weighted symbol tables, enforces one-player-at-a-time flow, keeps spin history and daily ledger stats, supports cashout, and manages bot banking watermarks/offload behavior.
- **Key data/state:** `data/slots.json`, player states, spin queue, bank balance/gold-on-hand, daily ledger, banking config.
- **Important limits/notes:** The module expects physical inventory items to represent slot symbols and has explicit banking/offload logic.

#### Daily wheel spin

- **Status:** `Runtime-Only JS`
- **Who uses it:** Players using the wheel endpoints or associated in-game flows.
- **How it is accessed:** `/api/wheel/spin`, `/api/wheel/status/:playerName`, `/api/wheel/history/:playerName`.
- **What it does:** Provides a weighted daily wheel reward system with per-player cooldown enforcement and history.
- **Key data/state:** per-player cooldown/history inside the slot machine module.
- **Important limits/notes:** Implemented inside the slot machine module rather than as a separate feature package.

#### Scratch-off tickets

- **Status:** `Runtime-Only JS`
- **Who uses it:** Players purchasing/looking up tickets and operators exposing the endpoints.
- **How it is accessed:** `/api/tickets/buy`, `/api/tickets/history/:playerName`.
- **What it does:** Sells tiered tickets and stores ticket history/results for players.
- **Key data/state:** `data/tickets.json`.
- **Important limits/notes:** Ticketing is another sub-feature inside the slot machine module.

#### Item trade escrow

- **Status:** `Runtime-Only JS`
- **Who uses it:** Players trading specific item-for-item offers and operators managing offers.
- **How it is accessed:** item-trade REST endpoints, bot exchange packet handlers, item-trade module.
- **What it does:** Lets operators define offers of the form "give me X, I give Y", watches exchange windows, auto-places the matching bot item, confirms trades, and logs outcomes.
- **Key data/state:** `data/trade-offers.json`, `data/trade-log.json`, tracked bot inventory, active exchange state.
- **Important limits/notes:** Files are lazily created and may not exist until the feature is used.

#### Auction house virtual board and purchase flow

- **Status:** `Conditional`, `Runtime-Only JS`
- **Who uses it:** Proxy-connected players using auction NPCs and operators assigning auctioneers.
- **How it is accessed:** auction house initialization in proxy startup, `proxy:npc:auction`, `/npc auction`, virtual board interception.
- **What it does:** Injects an Auction House board into the board list, serves listing pages and post views from DB, supports selling items, buying items, cashing out balances, and parcel-based item intake through a bot escrow character.
- **Key data/state:** auction dialog session state, auctioneer NPC map, bot inventory tracking, pending intakes/purchases/cashouts, and the expected Postgres tables `auction_listings`, `auction_balances`, and `auction_transactions`.
- **Important limits/notes:** Uses proxy-only virtual board and dialog interception, plus parcel and exchange protocol integration. The inspected runtime code queries these auction tables directly but does not create them in the schema bootstrap paths inspected here.

#### Parcel integration for auction house intake

- **Status:** `Conditional`, `Runtime-Only JS`
- **Who uses it:** Auction house sellers and operators.
- **How it is accessed:** proxy `player:sendMail` event wiring in `panel.js`, `auctionHouse.onParcelSent()`.
- **What it does:** Detects parcels sent to the auction bot character and converts those deliveries into auction intake workflow.
- **Key data/state:** parcel subject/intake queues tied to auction session state.
- **Important limits/notes:** This is not a generic parcel framework; it is specialized to auction house intake.

### 3.11 Tracking / Integrations

#### Player tracker and userlist parsing

- **Status:** `Live`
- **Who uses it:** Panel operators, AI chat, proxy/player intel systems, sightings UI.
- **How it is accessed:** `src/features/player-tracker.ts`, `/api/userlist`, `players:*` Socket.IO events.
- **What it does:** Parses userlist packets, tracks current online users, updates player class/title/master info, records sessions, and keeps an in-memory player DB backed by PostgreSQL.
- **Key data/state:** in-memory `playerDB`, online user list, previous online set, `players`, `player_sightings`, `player_sessions`.
- **Important limits/notes:** Userlist-derived online state is pulse-based and depends on refresh cadence.

#### Sightings, legends, appearance, and chat history

- **Status:** `Live`
- **Who uses it:** Panel operators, AI chat, custom legend automation, sprite renderer.
- **How it is accessed:** player tracker DB calls, player detail requests, sprite endpoints, legend update flows.
- **What it does:** Stores sightings, legend snapshots/history, appearance blobs, chat logs, first/last seen data, and per-player detail views.
- **Key data/state:** `player_legends`, `player_legend_history`, `player_appearances`, `chat_logs`.
- **Important limits/notes:** Custom proxy-only legend issuance lives outside the base player legend tables and is layered in by the proxy.

#### Sense bot HP/MP scraping

- **Status:** `Conditional`
- **Who uses it:** Sense-role bots and any feature/operator consuming scraped HP/MP data.
- **How it is accessed:** `src/features/sense.ts`, sense bot packet hooks in `panel.js`.
- **What it does:** Watches for players stepping into a short cone in front of the sense bot, casts the Sense skill, parses HP/MP chat results, and writes results back to the player database.
- **Key data/state:** recent-sense cache, pending target, entity position map, `players.hp`, `players.mp`, `players.last_sense_update`.
- **Important limits/notes:** Requires a bot role dedicated to sense and relies on parsing a specific skill-result chat format.

#### Aisling Exchange shout/whisper ingest

- **Status:** `Conditional`
- **Who uses it:** AE backend integrations and operators configuring ingest.
- **How it is accessed:** `src/features/ae-ingest.ts`, `ae:*` Socket.IO events, in-game shout/whisper forwarding hooks in `panel.js`.
- **What it does:** Deduplicates/batches world shouts, POSTs them to an external ingest API, forwards whispers for auth/verification flows, and supports connection tests from the panel.
- **Key data/state:** AE config, shout batch queue, dedup cache, retry/backoff logic.
- **Important limits/notes:** Requires enabled config plus API URL/key; ingest calls are external-network side effects.

#### Discord webhook routing

- **Status:** `Conditional`
- **Who uses it:** Operators creating webhook rules and anyone consuming Discord feeds.
- **How it is accessed:** `src/features/discord.ts`, `discord:*` Socket.IO events.
- **What it does:** Matches decoded chat messages against per-rule message-type and regex criteria, formats Discord embeds, deduplicates repeated world/public messages, and rate-limits sends per webhook URL.
- **Key data/state:** `discord_rules` table, in-memory webhook queues, dedup cache.
- **Important limits/notes:** Whisper routing is handled specially and is never deduplicated like public/world messages.

#### Scheduled messages

- **Status:** `Conditional`
- **Who uses it:** Operators creating timed bot messages; bots delivering them.
- **How it is accessed:** `src/features/scheduled-messages.ts`, `scheduled:*` Socket.IO events.
- **What it does:** Sends daily, interval, and one-time messages through a selected bot, supports whisper or public say delivery, tracks next-fire times, and updates DB execution state.
- **Key data/state:** `scheduled_messages` table, timer map, timezone-aware scheduling, cached schedules.
- **Important limits/notes:** Delivery only succeeds if the targeted bot is online and logged in when the timer fires.

#### NPC leak scanner

- **Status:** `Operator-Only`, `Runtime-Only JS`, `Partial/Experimental`
- **Who uses it:** Panel operators doing packet/overflow experiments.
- **How it is accessed:** `npcleak:*` Socket.IO events, `lib/features/npc-leak.js`.
- **What it does:** Spams NPC clicks against a target serial, logs all incoming packets during the session, and looks specifically for `0x6A` / `0x33`-style leak signatures that might expose player HP/MP or other memory fragments.
- **Key data/state:** active scan session state, click counter, per-session packet log, leak findings list.
- **Important limits/notes:** This is intentionally experimental/reverse-engineering tooling, not a normal gameplay feature.

### 3.12 Developer / Operator Tooling

#### Hot reloader

- **Status:** `Live`, `Operator-Only`, `Internal/Infra`
- **Who uses it:** Operators and developers changing live feature code.
- **How it is accessed:** `src/features/hot-reloader.ts`, `hotreload:*` Socket.IO events, `/reload` proxy command.
- **What it does:** Watches `lib/` for compiled JS changes, invalidates require cache, re-requires feature modules, re-runs their init functions, and prototype-swaps selected proxy subsystem modules without dropping connections.
- **Key data/state:** watched file set, reload counters, feature registry, debounce timers.
- **Important limits/notes:** Proxy core modules are intentionally excluded from hot reload; only selected feature/proxy subsystem files can be safely reloaded.

#### MCP packet analysis server

- **Status:** `Live`, `Operator-Only`
- **Who uses it:** MCP clients and reverse-engineering workflows.
- **How it is accessed:** `mcp-server.js`.
- **What it does:** Exposes packet listing, decoding, heuristic analysis, DB-backed packet search/stats, packet comparison, and opcode-definition save/update tooling.
- **Key data/state:** separate PG pool, `data/opcodes.xml`, packet decoder/analyzer helpers.
- **Important limits/notes:** This is a dedicated stdio MCP process, not part of the Express/Socket.IO panel runtime.

#### Packet capture persistence and opcode-definition maintenance

- **Status:** `Live`, `Internal/Infra`
- **Who uses it:** Panel packet monitor, MCP tools, reverse-engineering/admin workflows.
- **How it is accessed:** packet inspector callback in `panel.js`, `persistPacketCapture()`, `save_opcode_definition` MCP tool.
- **What it does:** Stores captured packets with opcode labels and hex bodies, supports later statistical analysis, and maintains the live opcode XML used by decoders.
- **Key data/state:** `packet_captures` table, `data/opcodes.xml`.
- **Important limits/notes:** This makes the runtime self-documenting over time, but only if capture is enabled and relevant traffic is observed.

#### Trigger engine

- **Status:** `Conditional`, `Internal/Infra`, `Partial/Experimental`
- **Who uses it:** Proxy developers and future feature builders.
- **How it is accessed:** `src/proxy/triggers/trigger-engine.ts`.
- **What it does:** Supports registering actions keyed to proxy events such as `player:command`, `player:mapChange`, `player:position`, `npc:click`, and `session:game`, with optional conditions and cooldowns.
- **Key data/state:** trigger map, cooldown map.
- **Important limits/notes:** The engine is wired into proxy events, but there is no panel CRUD or persistence layer for triggers in the active runtime.

## 4. Control Surface Appendices

### Appendix A: REST Endpoints in `panel.js`

The active Express app defines 48 explicit routes in `panel.js` before `express.static(...)`.

#### Auth and panel pages

- `GET /login` — Public. Serves the panel login page.
- `POST /api/login` — Public. Validates env-backed panel credentials and issues the `dasb_session` cookie.
- `POST /api/logout` — Public. Clears the active panel session token.
- `GET /chat` — Session-protected. Serves the dedicated chat page.

#### Userlist and sprite / appearance APIs

- `GET /api/userlist` — Public. Returns the latest tracked online user list plus count and timestamp.
- `POST /api/sprite-overrides/:playerName` — Public. Saves per-player appearance override fields.
- `GET /api/sprite-overrides/:playerName` — Public. Returns the saved override for one player.
- `DELETE /api/sprite-overrides/:playerName` — Public. Deletes the saved override for one player.
- `GET /api/sprite-overrides` — Public. Lists all saved sprite overrides.
- `GET /api/sprite/:playerName.png` — Public. Renders a tracked player sprite as PNG.
- `GET /api/appearance/:playerName` — Public. Returns tracked appearance JSON for one player with overrides applied.
- `GET /api/sprite-stats` — Session-protected. Returns sprite renderer cache/runtime stats.
- `POST /api/sprite/render-custom` — Public. Renders an arbitrary supplied appearance JSON as PNG.
- `GET /api/sprite/head-ids/:gender` — Public. Lists browsable head/hair IDs for a gender.
- `GET /api/sprite/head-preview/:headId.png` — Public. Renders a preview PNG for a head ID.
- `GET /api/sprite/armor-ids/:gender` — Public. Lists browsable armor/overcoat IDs for a gender.
- `GET /api/sprite/armor-preview/:armorId.png` — Public. Renders a preview PNG for an armor/overcoat ID.

#### Trade session API

- `POST /api/trade/send-whisper` — Public route, but requires `x-ingest-key`. Creates a trade-session workflow and returns a session ID.
- `GET /api/trade/status/:sessionId` — Public route, but requires `x-ingest-key`. Opens an SSE stream with live trade-session status.

#### Lottery API

- `GET /api/lottery` — Session-protected. Returns current lottery state.
- `POST /api/lottery/start` — Session-protected. Starts a new lottery.
- `POST /api/lottery/draw` — Session-protected. Draws a winner and returns draw/audit details.
- `POST /api/lottery/cancel` — Session-protected. Cancels the active lottery.
- `POST /api/lottery/reset` — Session-protected. Resets lottery state.
- `POST /api/lottery/deliver` — Session-protected. Attempts in-game prize delivery to the winner.
- `POST /api/lottery/sync` — Session-protected. Pushes lottery history/state to the AE backend.
- `GET /api/lottery/tickets/:playerName` — Session-protected. Returns ticket history for one player in the active/last lottery.

#### Slots, wheel, and ticket APIs

- `GET /api/slots` — Public. Returns overall slot machine state.
- `GET /api/slots/player/:name` — Public. Returns per-player slot state.
- `POST /api/slots/config` — Public. Saves slot-machine config updates.
- `POST /api/slots/end-session` — Public. Force-ends the active slot session.
- `POST /api/slots/clear-queue` — Public. Clears the waiting queue.
- `POST /api/slots/spin` — Public. Initiates a web-triggered slot spin for a player.
- `POST /api/slots/bet` — Public. Updates a player's bet size.
- `GET /api/slots/banking` — Public. Returns slot banking config.
- `POST /api/slots/banking` — Public. Saves slot banking config.
- `POST /api/slots/offload` — Public. Starts a gold offload to a named target.
- `POST /api/wheel/spin` — Public. Spins the daily wheel for a player.
- `GET /api/wheel/status/:playerName` — Public. Returns wheel cooldown/status for a player.
- `GET /api/wheel/history/:playerName` — Public. Returns wheel history for a player.
- `POST /api/tickets/buy` — Public. Buys a scratch-off ticket for a player/tier.
- `GET /api/tickets/history/:playerName` — Public. Returns scratch-ticket history for a player.

#### Item trade API

- `GET /api/item-trade/offers` — Session-protected. Returns current item-trade offers plus bot inventory.
- `POST /api/item-trade/offers` — Session-protected. Creates an item-trade offer.
- `DELETE /api/item-trade/offers/:offerId` — Session-protected. Deletes an item-trade offer.
- `POST /api/item-trade/offers/:offerId/toggle` — Session-protected. Enables/disables an offer.
- `GET /api/item-trade/log` — Session-protected. Returns recent item-trade log entries.
- `GET /api/item-trade/inventory` — Session-protected. Returns the bot inventory snapshot used by item-trade.

#### REST surface observations

- There are no explicit REST routes for proxy admin, chat games, Discord rules, AI chat, knowledge base, attendance, or hot reload; those are Socket.IO-driven.
- Auth exemptions are intentionally broad for:
  - userlist
  - sprite and appearance endpoints
  - trade SSE endpoints
  - slots/wheel/ticket endpoints
- That means several gameplay/economy APIs are externally callable without a panel cookie.

### Appendix B: Socket.IO Handlers in `panel.js`

The active Socket.IO server defines 123 `socket.on(...)` handlers in `panel.js`.

#### Proxy NPC and proxy-control events

- `proxy:npc:place` — Place a virtual NPC from panel-provided data.
- `proxy:npc:remove` — Remove a virtual NPC by serial.
- `proxy:npc:move` — Move a virtual NPC.
- `proxy:npc:dialog` — Update a virtual NPC dialog definition.
- `proxy:npc:edit` — Replace/edit a virtual NPC and preserve attached roles where possible.
- `proxy:npc:auction` — Assign auction-house behavior to a selected NPC.
- `proxy:npc:keeper` — Assign monster-keeper behavior to a selected NPC.
- `proxy:npc:fishing` — Assign fishing behavior to a selected NPC or initialize fishing first.
- `proxy:chat:send` — Send injected local/proxy chat to one session or broadcast.
- `proxy:chat:system` — Broadcast a system-style proxy message.
- `proxy:block:add` — Add an opcode block rule in the packet inspector.
- `proxy:block:remove` — Remove an opcode block rule.
- `proxy:capture:start` — Enable packet capture, optionally filtered by opcode.
- `proxy:capture:stop` — Stop packet capture.
- `proxy:capture:get` — Return currently captured packets.
- `proxy:capture:clear` — Clear captured packet buffer.
- `proxy:walk` — Step the selected proxy session in a direction.
- `proxy:walkTo` — Walk the selected proxy session to a coordinate.
- `proxy:navigateTo` — Run cross-map navigation for a proxy session.
- `proxy:stop` — Stop automation for a proxy session.
- `proxy:legends:create` — Create a custom legend definition.
- `proxy:legends:update` — Update a custom legend definition.
- `proxy:legends:delete` — Delete a custom legend definition.
- `proxy:legends:issue` — Issue a custom legend to a player.
- `proxy:legends:revoke` — Revoke a custom legend from a player.
- `proxy:disguises:save` — Save or update a per-player disguise profile.
- `proxy:disguises:delete` — Delete a per-player disguise profile.
- `proxy:disguises:toggle` — Enable/disable a per-player disguise profile.

#### Grind automation events

- `grind:start` — Start grind automation for one proxy session.
- `grind:stop` — Stop grind automation for one proxy session.
- `grind:getStatus` — Return current grind status for one proxy session.
- `grind:applyConfig` — Apply grind config updates for one proxy session.
- `grind:ignoreAdd` — Add an ignored monster/name/image for grind targeting.
- `grind:ignoreRemove` — Remove an ignored monster/name/image.
- `grind:lootFilterAdd` — Add an item to the loot filter.
- `grind:lootFilterRemove` — Remove an item from the loot filter.

#### Monster admin events

- `monsters:search` — Look up captured monsters owned by one player.
- `monsters:leaderboard` — Return monster leaderboard data.
- `monsters:getData` — Return current monster species/evolution/move content.
- `monsters:saveData` — Save monster species/evolution/move content to config and refresh runtime data.
- `monsters:delete` — Delete one captured monster by owner and ID.

#### Bot lifecycle events

- `bot:start` — Start one configured bot.
- `bot:stop` — Stop one configured bot.
- `bot:reconnect` — Force reconnect one bot.
- `bot:forceReset` — Force-reset one bot runtime.
- `bots:startAll` — Start all configured bots.
- `bots:stopAll` — Stop all configured bots.

#### Lottery and config events

- `lottery:start` — Start a lottery and emit state updates.
- `lottery:draw` — Draw a lottery winner and emit state updates.
- `lottery:cancel` — Cancel the active lottery.
- `lottery:status` — Request current lottery state.
- `config:save` — Save merged config changes and propagate dependent runtime updates.

#### Player data maintenance events

- `players:wipeAll` — Clear tracked player records.
- `players:resetAppearances` — Clear tracked appearance data.

#### Direct bot action and navigation events

- `bot:walk` — Make one bot walk a direction.
- `bot:turn` — Turn one bot to a direction.
- `bot:walkTo` — Make one bot walk to a coordinate using navigator logic.
- `bot:navigateTo` — Run cross-map navigation for one bot.
- `bot:navStop` — Stop one bot's navigation.
- `bot:navStatus` — Return navigation status for one bot.
- `nav:getMapList` — Return map-node/map-exit data for the panel navigator UI.
- `nav:getFavorites` — Return saved walk favorites.
- `nav:saveFavorite` — Save a walk favorite.
- `nav:deleteFavorite` — Delete a walk favorite.
- `nav:setLoginWalk` — Save or clear a login-walk target for a bot.
- `nav:getLoginWalkTargets` — Return saved login-walk targets.

#### Direct bot chat events

- `bot:whisper` — Send a whisper from a selected bot.
- `bot:say` — Send a public say from a selected bot.
- `bot:emote` — Send an emote from a selected bot.

#### Player intel events

- `sightings:get` — Return aggregated sightings.
- `userlist:get` — Return current online user list.
- `userlist:refresh` — Force a userlist refresh request from bots.
- `players:getAll` — Return the full tracked-player list.
- `players:getDetail` — Return full detail for one tracked player.

#### AE integration events

- `ae:getConfig` — Return AE ingest config summary.
- `ae:saveConfig` — Save AE ingest config.
- `ae:testConnection` — Run an AE ingest connection test.

#### Discord integration events

- `discord:getRules` — Return webhook rules.
- `discord:saveRule` — Save/create a webhook rule.
- `discord:deleteRule` — Delete a webhook rule.
- `discord:toggleRule` — Enable/disable a webhook rule.
- `discord:testWebhook` — Send a test webhook payload.

#### Chat games events

- `chatgames:getConfig` — Return chat-game config.
- `chatgames:saveConfig` — Save chat-game config.
- `chatgames:getStats` — Return chat-game aggregate stats.
- `chatgames:getActive` — Return active chat-game sessions.
- `chatgames:getLeaderboard` — Return overall chat-game leaderboard.
- `chatgames:getLeaderboardByGame` — Return leaderboard filtered to one game.
- `chatgames:clearLeaderboard` — Clear overall leaderboard.
- `chatgames:clearLeaderboardByGame` — Clear per-game leaderboard.
- `chatgames:getHostStatus` — Return host-mode status.
- `chatgames:hostStart` — Start host mode for a chosen game.
- `chatgames:hostStop` — Stop host mode.
- `chatgames:hostSkip` — Skip the current host-mode round.
- `chatgames:getBjStatus` — Return group-blackjack status.
- `chatgames:bjStart` — Start group blackjack.
- `chatgames:bjForceStart` — Force-start group blackjack.
- `chatgames:bjStop` — Stop group blackjack.

#### AI chat and knowledge events

- `aichat:getBlacklist` — Return the AI chat blacklist.
- `aichat:addBlacklist` — Add a player to the AI blacklist.
- `aichat:removeBlacklist` — Remove a player from the AI blacklist.
- `knowledge:list` — Return knowledge-base entries.
- `knowledge:save` — Save one knowledge entry.
- `knowledge:delete` — Delete one knowledge entry.
- `knowledge:bulk-import` — Bulk-import knowledge entries.

#### Scheduling events

- `scheduled:getList` — Return schedules with computed next-fire times.
- `scheduled:save` — Save a schedule and start/restart its timer.
- `scheduled:delete` — Delete a schedule and clear its timer.
- `scheduled:toggle` — Enable/disable a schedule.
- `scheduled:fireNow` — Fire a schedule immediately.

#### Attendance events

- `attendance:getState` — Return current attendance state.
- `attendance:start` — Start an attendance event.
- `attendance:stop` — Stop the active attendance event.
- `attendance:clear` — Clear attendance state/results.

#### NPC leak events

- `npcleak:start` — Start an NPC leak scan session.
- `npcleak:stop` — Stop the active leak scan.
- `npcleak:status` — Return active leak-scan status.
- `npcleak:getLog` — Return full leak-scan packet log.
- `npcleak:listNpcs` — Return visible NPC candidates for scanning.
- `npcleak:refresh` — Refresh NPC leak UI state.

#### Hot reload and transport lifecycle events

- `hotreload:trigger` — Trigger hot reload for a named module or all modules.
- `hotreload:status` — Return hot-reload status information.
- `disconnect` — Logs panel client disconnect.

### Appendix C: Proxy Slash Commands

This appendix lists the active in-world slash commands registered by the proxy runtime. Commands are only available when proxy mode is active and the relevant subsystem has been initialized.

#### Built-in proxy/admin commands

- `/help` — Show all registered proxy commands.
- `/pos` — Show current real position, and AFK shadow position when applicable.
- `/status` — Show proxy/session/runtime health and player stats.
- `/npcs` — List virtual NPCs.
- `/who` — List proxy-connected players.
- `/say <message>` — Inject a proxy-local say message visible only through proxy chat injection.
- `/mapswap <from> <to>` or `/mapswap clear [from]` — Manage map substitutions and refresh sessions.
- `/npc <subcommand>` — Manage virtual NPCs and some real-NPC override workflows. Notable subcommands: `help`, `list`, `place`, `remove`, `move`, `sprite`, `edit`, `auction`, `reset`, `overrides`.
- `/nametag <style>` or `/nametag on|off` — Change proxy-rendered name-tag behavior.
- `/king` — Toggle the special Lancelot king disguise mode.
- `/broadcast <message>` — Broadcast a system message to all proxy players.

#### Automation commands

- `/goto <x> <y>` — Walk to coordinates on the current map.
- `/nav <mapId> [x] [y]` — Navigate cross-map to a destination.
- `/walk <direction> [steps]` — Walk a short directional path.
- `/stop` — Stop movement/combat/heal/follow/desync automation.
- `/follow <playerName>` — Follow a target player by tracked movement.
- `/cast <spellName> [targetSerial]` — Cast a tracked spell by name.
- `/skill <skillName>` — Use a tracked skill by name.
- `/spells` — List tracked spells.
- `/skills` — List tracked skills.
- `/grind start|stop|status|config|target|ignore|lure` — Control combat grinding. Notable args: target mode, ignore add/remove, lure mode, config keys.
- `/heal on|off|config|status` — Control or inspect the heal engine.
- `/loot on|off|allow|deny` — Control or inspect the loot engine/filter.
- `/buffs` — Show tracked buff icons and named statuses.
- `/inventory` — Show tracked inventory contents.

#### Custom doors and exit markers

- `/door create <name> <sprite> <targetMapId> <targetX> <targetY>` — Create a custom door at the current position.
- `/door list` — List all custom doors.
- `/door remove <id>` — Remove a custom door.
- `/exitmark add [mapId x y]` — Add a custom exit marker at the tile in front of the player or at explicit coordinates.
- `/exitmark remove [mapId x y]` — Remove a custom exit marker.
- `/exitmark list` — List custom exit markers.
- `/exitmark speed <value>` — Change exit marker animation speed.
- `/exitmark interval <ms>` — Change exit marker refresh interval.
- `/afkexitmark add [mapId x y]` — Add an AFK-world exit marker.
- `/afkexitmark remove [mapId x y]` — Remove an AFK-world exit marker.
- `/afkexitmark list` — List AFK-world exit markers.

#### Monster-system commands

- `/capture` — Attempt to capture a wild monster.
- `/fight` — Start a wild monster battle.
- `/monsters` — List owned monsters.
- `/active [slot]` — Show or set the active monster.
- `/battle <playerName>` — Challenge another player to a monster battle.
- `/accept` — Accept a battle challenge.
- `/decline` — Decline a battle challenge.
- `/forfeit` — Forfeit the current battle.
- `/train` — Train the active monster for passive XP.
- `/mstats` — Show active monster stats.
- `/nickname <name>` — Rename the active monster.
- `/companion` — Toggle whether the active monster follows as a companion.

#### AFK commands

- `/afk` — Toggle AFK shadow mode.
- `/afkchat` — Toggle whether AFK-mode chat is live to the real server or kept silent.

#### Hot-reload command

- `/reload [module]` — Reload all hot-reloadable modules or one named module.

### Appendix D: MCP Tools

The MCP server in `mcp-server.js` exposes seven tools:

| Tool | Inputs | Purpose |
| --- | --- | --- |
| `list_opcodes` | optional `direction` | List known Dark Ages opcodes, directions, and field definitions from the live opcode registry |
| `decode_packet` | `opcode`, `direction`, `hex` | Decode a packet body using saved XML field definitions |
| `analyze_packet` | `hex`, optional `opcode`, optional `direction` | Heuristically analyze unknown packet hex and guess likely field types |
| `search_packets` | optional `opcode`, `direction`, `character`, `since`, `limit` | Search persisted packet captures in PostgreSQL |
| `get_packet_stats` | optional `since` | Return packet-capture statistics by opcode and direction |
| `save_opcode_definition` | `opcode`, `direction`, `name`, optional `fields` | Add or update an opcode definition in `data/opcodes.xml` |
| `compare_packets` | `hex_dumps`, optional `opcode`, optional `direction` | Compare multiple packet bodies to identify fixed vs variable offsets |

### Appendix E: Persistence Inventory

#### Core PostgreSQL tables from `src/features/database.ts`

These 19 tables are created by the main DASB schema bootstrap:

- `players` — master player records, class/title/master flags, last-seen metadata, sense fields.
- `player_sightings` — timestamped sightings, including userlist-derived sightings.
- `player_legends` — current legend marks per player.
- `player_legend_history` — stored snapshots of old legend sets.
- `chat_logs` — persistent chat history.
- `bot_config` — DB-backed app config JSON.
- `discord_rules` — Discord webhook rule storage.
- `scheduled_messages` — saved schedules and last-fire status.
- `player_sessions` — online session windows for tracked players.
- `player_appearances` — saved appearance blobs for sprite rendering.
- `game_leaderboard` — chat-game scoreboard data.
- `ai_conversations` — persisted AI chat history.
- `knowledge_base` — AI knowledge entries.
- `packet_captures` — persisted proxy packet captures.
- `attendance_events` — attendance event headers.
- `attendance_records` — per-player attendance results.
- `afk_shadow_progress` — AFK progression summary.
- `afk_shadow_inventory` — AFK inventory slots/items.
- `afk_shadow_spells` — AFK shadow spell/skill bar state.

#### Additional feature-owned PostgreSQL tables

These are active runtime schemas, but they are created by feature modules rather than the core 19-table bootstrap:

- `monster_captures` — captured monster roster, stats, active monster, companion-out state.
- `fishing_catches` — fishing catch history, weight, rarity, perfect/glimmer flags.

#### Additional Postgres tables assumed by active runtime code

These tables are referenced by active runtime code, but the inspected schema bootstrap paths do not create them automatically:

- `auction_listings` — active/sold/cancelled auction listings, item metadata, seller/buyer linkage, bot inventory slot, timestamps.
- `auction_balances` — seller balances, total earned, total withdrawn, updated timestamps.
- `auction_transactions` — listing, buy, cancel, and withdraw transaction history.

#### JSON / XML / binary data stores under `data/`

Existing or lazily created active stores under `data/`:

- `data/custom-doors.json` — persisted custom door definitions for the proxy door system.
- `data/custom-legends.json` — custom proxy legend definitions and issued-to lists.
- `data/disguise-state.json` — per-player disguise settings used by proxy rendering.
- `data/door-animations.json` — custom exit-marker placements and animation data.
- `data/lottery.json` — lottery state, tickets, winner, draw metadata.
- `data/map-exits.json` — navigator/proxy exit graph data and some exit-marker inputs.
- `data/map-nodes.json` — saved map metadata/dimensions used by navigator and custom-door helpers.
- `data/npc-positions.json` — saved real-NPC position/sprite overrides.
- `data/opcodes.xml` — live opcode metadata for packet logging and MCP decoding.
- `data/proxy-firstlogins.json` — first proxy-login timestamps used for Enhanced Aisling legend issuance.
- `data/slots.json` — slot-machine config, balances, ledger, banking state.
- `data/sotp.bin` — collision/SOTP data used by navigator and automation.
- `data/sprite-overrides.json` — per-player sprite override data for rendering corrections.
- `data/tickets.json` — scratch-ticket state/history.
- `data/afk/level-table.json` — AFK progression/level data.
- `data/afk/loot-tables.json` — AFK loot tables.
- `data/collision/*.bin` — per-map collision/cache artifacts used by navigation tooling.

Lazily created active stores that may not exist until their feature is used:

- `data/trade-offers.json` — item-trade offer definitions.
- `data/trade-log.json` — item-trade transaction log.

#### Persistence observations

- The runtime uses a mixed persistence model:
  - PostgreSQL for durable structured data
  - JSON/XML under `data/` for operator-owned or content-like state
  - binary files for navigation/collision support data
- Root-level repo JSON files such as `bot-config.json` and `discord-hooks.json` were not found in the active startup/load paths inspected here, so they should not be treated as the authoritative runtime source of truth without further code changes.

## 5. Design-Relevant Notes

### Reusable systems already available for new games/features

- **Chat command routing already exists in two flavors:**
  - regular bot public/whisper command parsing for chat games
  - proxy slash commands for proxied players
- **Virtual NPCs plus dialog virtualization are already powerful enough to host menu-driven in-world systems.**
- **Panel Socket.IO is already the dominant operator control plane**, so new admin tools can usually slot into existing panel patterns without inventing a new transport.
- **Packet capture + MCP tooling already support reverse-engineering loops**, which lowers the cost of adding undocumented protocol features.
- **DB-backed player knowledge is rich already:** classes, titles, legends, sessions, sightings, appearances, chat logs, HP/MP sense data.
- **The economy layer is already deep:** exchanges, parcels, ticketing, lotteries, slot credits, balances, escrow, and auction listings.

### Best extension points

- **Safest for new player-facing gameplay:**
  - `src/games/*` for chat-command-driven games
  - proxy virtual NPC + dialog handler for in-world menu systems
  - panel Socket.IO handlers for operator dashboards and controls
  - DB-backed feature modules modeled after fishing/monster capture
- **Safest for admin/research tooling:**
  - MCP tools
  - packet capture persistence
  - knowledge-base CRUD
  - hot-reloadable feature modules
- **Good proxy-side hooks for reactive features:**
  - `player:position`
  - `player:mapChange`
  - `player:command`
  - `npc:click`
  - `session:game`
  - packet inspector middleware

### Interaction channels already available

- Public say messages
- Whispers
- Emotes
- Proxy slash commands
- Virtual NPC click/menu/dialog/text-input flows
- Exchange protocol interactions
- Parcel/mail interception for targeted flows
- REST endpoints for selected external/operator workflows
- Socket.IO panel events
- MCP tools for packet research/admin work
- Discord webhooks for outbound integrations

### Persistence options already available

- Add a new table to the main PostgreSQL pool when the feature is first-class and query-heavy.
- Add a feature-owned schema initializer like monster capture or fishing when the feature is modular.
- Use `data/*.json` when state is operator-curated content/config and low write volume is acceptable.
- Reuse existing player tables when the feature piggybacks on player identity, sightings, chat, legends, or appearances.
- Reuse packet capture + opcode XML when the feature needs protocol discovery or introspection.

### Safer areas to extend

- Chat games and their content pools
- AI knowledge-base integrations
- Panel Socket.IO admin surfaces
- New REST utilities that follow existing auth patterns
- Virtual NPC dialogs and board-style content
- New DB-backed minigames modeled after fishing or monster capture

### Higher-risk or more fragile areas

- Proxy core encryption/resequence logic
- Map substitution and synthetic tile injection
- AFK shadow mode/world
- Runtime-only JS modules with no matching active TS source
- Public unauthenticated REST surfaces for slots/wheel/tickets/sprites
- Complex exchange/parcel/economy features that depend on live inventory or nearby entities

### Practical feature-design guidance

- If the new feature should work for all bots without proxy clients, build on the existing bot/chat/panel feature stack.
- If the new feature should feel like an in-world system, prefer proxy virtual NPCs plus dialog handling.
- If the new feature needs live map movement or combat, reuse proxy automation/nav instead of inventing a new mover.
- If the new feature needs player history or AI context, reuse player tracker and knowledge-base tables before adding new identity stores.
- If the new feature depends on undocumented packets, add packet captures first, then extend `data/opcodes.xml` and MCP tooling before hard-coding assumptions.
