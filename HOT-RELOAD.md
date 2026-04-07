# Hot-Reload System

This project has a hot-reload system that swaps code without dropping game connections. When making changes, you need to know what hot-reloads and what requires a restart.

## Running

```bash
npm run dev        # tsc --watch + node (hot-reload, no restart)
npm run dev:restart  # tsc --watch + nodemon (full restart on change)
```

Use `npm run dev` for normal development. Use `dev:restart` only when you've changed something that can't hot-reload (see below).

## What hot-reloads

### Feature modules (edit TypeScript in src/features/, tsc compiles automatically)
- ai-chat.ts, discord.ts, player-tracker.ts, scheduled-messages.ts
- trade-sessions.ts, lottery.ts, slot-machine.ts, sense.ts, ae-ingest.ts
- src/games/ (chat games)

These get require.cache invalidated, re-required, and re-initialized with the same dependencies. The panel.js `var` references are reassigned so all existing event handler closures pick up the new code on next invocation.

### Proxy subsystems (edit JS directly in lib/proxy/)
- augmentation/ (npc-injector, chat-injector, dialog-handler, exit-marker, custom-doors)
- automation/ (combat-engine, heal-engine, loot-engine, proxy-navigator, spell-caster, buff-tracker, desync-monitor)
- commands/ (slash command handlers)
- triggers/ (trigger engine)
- packet-inspector.js, player-registry.js

These use prototype swapping (Object.setPrototypeOf) to replace methods on existing instances while preserving all state (NPC registries, active sessions, combat state, etc).

### Opcode definitions
- data/opcodes.xml hot-reloads via its own fs.watch (predates this system)

## What needs a full restart

- **panel.js** - REST API routes, socket.io handlers, bot connection wiring
- **lib/proxy/proxy-server.js** - TCP socket management
- **lib/proxy/proxy-session.js** - Session state structure
- **lib/proxy/proxy-crypto.js** - Encryption
- **lib/proxy/index.js** - Proxy system event wiring
- **lib/core/** - Packet, datatypes, CRC fundamentals

## Adding new opcode handlers

When implementing a new opcode:

1. Define it in `data/opcodes.xml` - hot-reloads immediately
2. Write the processing logic in a feature module or proxy subsystem - hot-reloads
3. **Wire the opcode to its handler** - this is the part that needs ONE restart:
   - If wiring in `panel.js` (e.g., `c.events.on(0xNN, ...)`) - restart required
   - If wiring in `lib/proxy/index.js` (e.g., `server.on('player:newEvent', ...)`) - restart required
   - If wiring in `lib/proxy/proxy-server.js` (new packet interception) - restart required

After the wiring is in place, all future changes to the handler logic hot-reload without restart.

## In-game commands

- `/reload` - Reload all registered feature modules
- `/reload <name>` - Reload a specific module (e.g., `/reload ai-chat`)

## Error handling

If a module fails to reload (e.g., syntax error), the old code is restored from cache and the proxy continues running. Check the console for `[HotReload] FAILED` messages.

## Key files

- `src/features/hot-reloader.ts` - The HotReloader class
- `panel.js` (search "featureRegistry") - Feature registration and HotReloader init
