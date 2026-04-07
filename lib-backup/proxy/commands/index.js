"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommandRegistry = void 0;
exports.registerBuiltinCommands = registerBuiltinCommands;
/**
 * Registers built-in slash commands on the given registry.
 */
function registerBuiltinCommands(registry, opts) {
    const { proxy, chat, players, npcs } = opts;
    const Packet = require('../../core/packet').default;
    function refreshMapswapSessions() {
        for (const session of proxy.sessions.values()) {
            if (session.phase !== 'game' || session.destroyed)
                continue;
            if (session.afkState?.active)
                continue;
            session.lastInjectedMap = null;
            session.refreshPending = true;
            const refreshPacket = new Packet(0x38);
            proxy.sendToServer(session, refreshPacket);
            chat.systemMessage(session, 'Map updated, refreshing...');
        }
    }
    registry.register('help', (session) => {
        const lines = registry.generateHelp();
        // Send each line as a system message (bar message) — max ~80 chars per line
        chat.systemMessage(session, '--- Proxy Commands ---');
        for (const line of lines) {
            chat.systemMessage(session, line);
        }
    }, 'List available commands');
    registry.register('pos', (session) => {
        const { x, y, mapNumber } = session.playerState;
        chat.systemMessage(session, `Position: (${x}, ${y}) Map: ${mapNumber}`);
    }, 'Show current position');
    registry.register('status', (session) => {
        const sessionCount = proxy.sessions.size;
        const playerList = players.getAllPlayers();
        chat.systemMessage(session, `Proxy: ${sessionCount} sessions, ${playerList.length} players`);
        chat.systemMessage(session, `You: ${session.characterName} [${session.id}] phase=${session.phase}`);
        const { serial, mapNumber, x, y, hp, maxHp, mp, maxMp } = session.playerState;
        chat.systemMessage(session, `Serial: ${serial} Map: ${mapNumber} (${x},${y})`);
        if (maxHp > 0) {
            chat.systemMessage(session, `HP: ${hp}/${maxHp} MP: ${mp}/${maxMp}`);
        }
    }, 'Show proxy status');
    registry.register('npcs', (session) => {
        const allNpcs = npcs.getAllNPCs();
        if (allNpcs.length === 0) {
            chat.systemMessage(session, 'No virtual NPCs defined.');
            return;
        }
        chat.systemMessage(session, `--- Virtual NPCs (${allNpcs.length}) ---`);
        for (const npc of allNpcs) {
            chat.systemMessage(session, `${npc.name} @ map ${npc.mapNumber} (${npc.x},${npc.y}) id=0x${npc.serial.toString(16)}`);
        }
    }, 'List virtual NPCs');
    registry.register('who', (session) => {
        const playerList = players.getAllPlayers();
        if (playerList.length === 0) {
            chat.systemMessage(session, 'No proxy players online.');
            return;
        }
        chat.systemMessage(session, `--- Proxy Players (${playerList.length}) ---`);
        for (const p of playerList) {
            chat.systemMessage(session, `${p.characterName} map=${p.position.mapNumber} (${p.position.x},${p.position.y})`);
        }
    }, 'List proxy-connected players');
    registry.register('say', (session, args) => {
        if (args.length === 0) {
            chat.systemMessage(session, 'Usage: /say <message>');
            return;
        }
        const message = args.join(' ');
        chat.sendChat(session, { channel: 'say', sender: 'Proxy', message });
    }, 'Send a local say message (visible only to you)', '<message>');
    registry.register('mapswap', (session, args) => {
        const subs = proxy.config.mapSubstitutions;
        if (args.length === 0) {
            // List current substitutions
            const entries = Object.entries(subs);
            if (entries.length === 0) {
                chat.systemMessage(session, 'No map substitutions active.');
            }
            else {
                chat.systemMessage(session, `--- Map Substitutions (${entries.length}) ---`);
                for (const [from, to] of entries) {
                    chat.systemMessage(session, `  map ${from} -> ${to}`);
                }
            }
            chat.systemMessage(session, 'Usage: /mapswap <from> <to> | /mapswap clear [from]');
            return;
        }
        if (args[0] === 'clear') {
            if (args[1]) {
                const from = parseInt(args[1], 10);
                delete subs[from];
                chat.systemMessage(session, `Cleared substitution for map ${from}.`);
            }
            else {
                Object.keys(subs).forEach(k => delete subs[k]);
                chat.systemMessage(session, 'Cleared all map substitutions.');
            }
            proxy.emit('mapswap:changed', subs);
            refreshMapswapSessions();
            return;
        }
        const from = parseInt(args[0], 10);
        const to = parseInt(args[1], 10);
        if (isNaN(from) || isNaN(to)) {
            chat.systemMessage(session, 'Usage: /mapswap <fromMapNumber> <toMapNumber>');
            return;
        }
        subs[from] = to;
        chat.systemMessage(session, `Map substitution set: ${from} -> ${to}`);
        proxy.emit('mapswap:changed', subs);
        refreshMapswapSessions();
    }, 'Swap map files: /mapswap <from> <to> | clear [from]', '<from> <to>');
    // ── /npc command: place, edit, remove, list, auction ──
    registry.register('npc', (session, args) => {
        const sub = (args[0] || '').toLowerCase();
        if (!sub || sub === 'help') {
            chat.systemMessage(session, '--- NPC Commands ---');
            chat.systemMessage(session, '/npc list - List all virtual NPCs');
            chat.systemMessage(session, '/npc place <name> <sprite> - Place NPC at your position');
            chat.systemMessage(session, '/npc remove <serial> - Remove an NPC');
            chat.systemMessage(session, '/npc move <serial> <x> <y> - Move an NPC');
            chat.systemMessage(session, '/npc edit <serial> <field> <value> - Edit NPC field');
            chat.systemMessage(session, '  Fields: name, sprite, direction, type');
            chat.systemMessage(session, '/npc auction <serial> - Attach auction house to NPC');
            return;
        }
        if (sub === 'list') {
            const allNpcs = npcs.getAllNPCs();
            if (allNpcs.length === 0) {
                chat.systemMessage(session, 'No virtual NPCs.');
                return;
            }
            chat.systemMessage(session, `--- Virtual NPCs (${allNpcs.length}) ---`);
            for (const npc of allNpcs) {
                const handler = npc.onInteract ? ' [handler]' : npc.dialog ? ' [dialog]' : '';
                chat.systemMessage(session, `0x${npc.serial.toString(16)} "${npc.name}" sprite=${npc.sprite} map=${npc.mapNumber} (${npc.x},${npc.y})${handler}`);
            }
            return;
        }
        if (sub === 'place') {
            const name = args[1];
            const sprite = parseInt(args[2], 10);
            if (!name || isNaN(sprite)) {
                chat.systemMessage(session, 'Usage: /npc place <name> <sprite>');
                return;
            }
            const serial = npcs.placeNPC({
                name,
                sprite,
                x: session.playerState.x,
                y: session.playerState.y,
                mapNumber: session.playerState.mapNumber,
                direction: 2,
                creatureType: 2,
            });
            chat.systemMessage(session, `Placed "${name}" serial=0x${serial.toString(16)} sprite=${sprite}`);
            return;
        }
        if (sub === 'remove') {
            const serial = parseInt(args[1], 16) || parseInt(args[1], 10);
            if (!serial) {
                chat.systemMessage(session, 'Usage: /npc remove <serial>');
                return;
            }
            const npc = npcs.getNPC(serial);
            if (!npc) {
                chat.systemMessage(session, `NPC 0x${serial.toString(16)} not found.`);
                return;
            }
            npcs.removeNPC(serial);
            chat.systemMessage(session, `Removed "${npc.name}" (0x${serial.toString(16)})`);
            return;
        }
        if (sub === 'move') {
            const serial = parseInt(args[1], 16) || parseInt(args[1], 10);
            const x = parseInt(args[2], 10);
            const y = parseInt(args[3], 10);
            if (!serial || isNaN(x) || isNaN(y)) {
                chat.systemMessage(session, 'Usage: /npc move <serial> <x> <y>');
                return;
            }
            const npc = npcs.getNPC(serial);
            if (!npc) {
                chat.systemMessage(session, `NPC 0x${serial.toString(16)} not found.`);
                return;
            }
            npcs.moveNPC(serial, x, y);
            chat.systemMessage(session, `Moved "${npc.name}" to (${x},${y})`);
            return;
        }
        if (sub === 'edit') {
            const serial = parseInt(args[1], 16) || parseInt(args[1], 10);
            const field = (args[2] || '').toLowerCase();
            const value = args.slice(3).join(' ');
            if (!serial || !field || !value) {
                chat.systemMessage(session, 'Usage: /npc edit <serial> <field> <value>');
                chat.systemMessage(session, 'Fields: name, sprite, direction, type');
                return;
            }
            const npc = npcs.getNPC(serial);
            if (!npc) {
                chat.systemMessage(session, `NPC 0x${serial.toString(16)} not found.`);
                return;
            }
            // Remove + re-place with updated fields to refresh on all clients
            const opts = {
                name: npc.name,
                sprite: npc.sprite,
                x: npc.x,
                y: npc.y,
                mapNumber: npc.mapNumber,
                direction: npc.direction,
                creatureType: npc.creatureType,
                dialog: npc.dialog,
            };
            const savedHandler = npc.onInteract;
            if (field === 'name') {
                opts.name = value;
            }
            else if (field === 'sprite') {
                const v = parseInt(value, 10);
                if (isNaN(v)) {
                    chat.systemMessage(session, 'Sprite must be a number.');
                    return;
                }
                opts.sprite = v;
            }
            else if (field === 'direction' || field === 'dir') {
                const v = parseInt(value, 10);
                if (isNaN(v) || v < 0 || v > 3) {
                    chat.systemMessage(session, 'Direction: 0=up 1=right 2=down 3=left');
                    return;
                }
                opts.direction = v;
            }
            else if (field === 'type') {
                const v = parseInt(value, 10);
                if (isNaN(v) || v < 0 || v > 3) {
                    chat.systemMessage(session, 'Type: 0=Monster 1=Passable 2=Mundane 3=Solid');
                    return;
                }
                opts.creatureType = v;
            }
            else {
                chat.systemMessage(session, `Unknown field "${field}". Use: name, sprite, direction, type`);
                return;
            }
            npcs.removeNPC(serial);
            const newSerial = npcs.placeNPC(opts);
            const newNpc = npcs.getNPC(newSerial);
            if (newNpc && savedHandler) {
                newNpc.onInteract = savedHandler;
            }
            chat.systemMessage(session, `Updated "${opts.name}" → new serial=0x${newSerial.toString(16)}`);
            return;
        }
        if (sub === 'auction') {
            const serial = parseInt(args[1], 16) || parseInt(args[1], 10);
            if (!serial) {
                chat.systemMessage(session, 'Usage: /npc auction <serial>');
                return;
            }
            const npc = npcs.getNPC(serial);
            if (!npc) {
                chat.systemMessage(session, `NPC 0x${serial.toString(16)} not found.`);
                return;
            }
            // Emit event so panel.js / index.ts can wire up the auction handler
            proxy.emit('npc:assignAuction', npc, session);
            chat.systemMessage(session, `Auction handler assigned to "${npc.name}" (0x${serial.toString(16)})`);
            return;
        }
        chat.systemMessage(session, `Unknown subcommand "${sub}". Try /npc help`);
    }, 'Manage virtual NPCs', '<place|remove|move|edit|list|auction>');
    registry.register('nametag', (session, args) => {
        if (args.length === 0) {
            const current = proxy.config.nameTags;
            chat.systemMessage(session, `NameTag: enabled=${current.enabled} style=${current.nameStyle}`);
            chat.systemMessage(session, 'Usage: /nametag <style 0-255> | /nametag on|off');
            return;
        }
        if (args[0] === 'on') {
            proxy.config.nameTags.enabled = true;
            chat.systemMessage(session, 'NameTag: enabled');
            return;
        }
        if (args[0] === 'off') {
            proxy.config.nameTags.enabled = false;
            chat.systemMessage(session, 'NameTag: disabled');
            return;
        }
        const val = parseInt(args[0], 10);
        if (isNaN(val) || val < 0 || val > 255) {
            chat.systemMessage(session, 'Style must be 0-255');
            return;
        }
        proxy.config.nameTags.nameStyle = val;
        proxy.config.nameTags.enabled = true;
        chat.systemMessage(session, `NameTag: style set to ${val} (0x${val.toString(16)}). Refresh to see changes.`);
    }, 'Set nameDisplayStyle for proxy players', '<style 0-255> | on | off');
    registry.register('king', (session) => {
        if (session.characterName !== 'Lancelot') {
            chat.systemMessage(session, 'Only Lancelot can use this command.');
            return;
        }
        // Toggle Lancelot's per-player disguise via the panel data store
        const fs = require('fs');
        const path = require('path');
        const file = path.join(__dirname, '../../../data/disguise-state.json');
        let disguises = {};
        try { disguises = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch (e) { /* ignore */ }
        if (!disguises['Lancelot']) {
            disguises['Lancelot'] = { enabled: false, title: 'King', displayClass: 'Elite Gladiator', guildRank: 'Founder', guild: 'Aisling Exchange', overcoatSprite: 335, overcoatColor: 0 };
        }
        disguises['Lancelot'].enabled = !disguises['Lancelot'].enabled;
        chat.systemMessage(session, disguises['Lancelot'].enabled ? 'King mode ON' : 'King mode OFF');
        try { fs.writeFileSync(file, JSON.stringify(disguises, null, 2), 'utf-8'); } catch (e) { /* ignore */ }
        // Sync in-memory state if getPlayerDisguise is wired
        if (proxy._reloadDisguises) proxy._reloadDisguises();
        // F5 refresh all proxy sessions on the same map so they see the change
        const myMap = session.playerState.mapNumber;
        const Packet = require('../../core/packet').default;
        for (const s of proxy.sessions.values()) {
            if (s.phase !== 'game' || s.destroyed)
                continue;
            if (s.afkState?.active)
                continue;
            if (s.playerState.mapNumber !== myMap)
                continue;
            s.lastInjectedMap = null;
            s.refreshPending = true;
            const refreshPacket = new Packet(0x38);
            proxy.sendToServer(s, refreshPacket);
        }
    }, 'Toggle king disguise (Lancelot only)');
    registry.register('broadcast', (session, args) => {
        if (args.length === 0) {
            chat.systemMessage(session, 'Usage: /broadcast <message>');
            return;
        }
        const message = args.join(' ');
        chat.systemBroadcast(message);
    }, 'Broadcast system message to all proxy players', '<message>');
}
var command_registry_1 = require("./command-registry");
Object.defineProperty(exports, "CommandRegistry", { enumerable: true, get: function () { return __importDefault(command_registry_1).default; } });
//# sourceMappingURL=index.js.map