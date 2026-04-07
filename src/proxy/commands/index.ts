import fs from 'fs';
import path from 'path';
import Packet from '../../core/packet';
import * as configManager from '../../features/config-manager';
import CommandRegistry from './command-registry';
import type ChatInjector from '../augmentation/chat-injector';
import type PlayerRegistry from '../player-registry';
import type NpcInjector from '../augmentation/npc-injector';
import type ProxyServer from '../proxy-server';

// ── Persistent NPC position overrides ────────────────────────────

export interface NpcPositionOverride {
    name: string;
    x: number;
    y: number;
    sprite?: number;
    mapNumber?: number;
    direction?: number;
    serial?: number;
}

const NPC_POSITIONS_FILE = path.join(__dirname, '../../../data/npc-positions.json');
let npcPositionOverrides: Record<string, NpcPositionOverride> = {};
let monsterKeeperModule: any = null;
let auctionHouseModule: any = null;
let fishingModule: any = null;

function getMonsterKeeperModule(): any {
    if (monsterKeeperModule !== null)
        return monsterKeeperModule;
    try {
        monsterKeeperModule = require(path.join(__dirname, '../../features/monster-capture/keeper-npc'));
    }
    catch (_err) {
        monsterKeeperModule = undefined;
    }
    return monsterKeeperModule;
}

function getAuctionHouseModule(): any {
    if (auctionHouseModule !== null)
        return auctionHouseModule;
    try {
        auctionHouseModule = require(path.join(__dirname, '../../features/auction-house'));
    }
    catch (_err) {
        auctionHouseModule = undefined;
    }
    return auctionHouseModule;
}

function getFishingModule(): any {
    if (fishingModule !== null)
        return fishingModule;
    try {
        fishingModule = require(path.join(__dirname, '../../features/fishing'));
    }
    catch (_err) {
        fishingModule = undefined;
    }
    return fishingModule;
}

function normalizeKeeperAmbientSpeech(ambientSpeech?: { intervalSeconds?: number; messages?: string[] }): { intervalSeconds: number; messages: string[] } | undefined {
    if (!ambientSpeech)
        return undefined;
    const messages = Array.isArray(ambientSpeech.messages)
        ? ambientSpeech.messages.map(msg => String(msg ?? '').trim()).filter(Boolean)
        : [];
    if (messages.length === 0)
        return undefined;
    const parsedInterval = Math.floor(Number(ambientSpeech.intervalSeconds));
    return {
        intervalSeconds: Number.isFinite(parsedInterval) ? Math.max(5, parsedInterval) : 30,
        messages,
    };
}

function syncMonsterKeeperConfig(npc: {
    mapNumber: number;
    x: number;
    y: number;
    direction: number;
    sprite: number;
    name: string;
    ambientSpeech?: { intervalSeconds?: number; messages?: string[] };
}): void {
    const config = configManager.loadConfig();
    if (!config.proxy)
        config.proxy = {};
    if (!config.proxy.monsters)
        config.proxy.monsters = {};
    config.proxy.monsters.keeperMapNumber = npc.mapNumber;
    config.proxy.monsters.keeperX = npc.x;
    config.proxy.monsters.keeperY = npc.y;
    config.proxy.monsters.keeperDirection = npc.direction;
    config.proxy.monsters.keeperSprite = npc.sprite;
    config.proxy.monsters.keeperName = npc.name;
    config.proxy.monsters.keeperAmbientSpeech = normalizeKeeperAmbientSpeech(npc.ambientSpeech);
    configManager.saveConfig(config);
}

function clearMonsterKeeperConfig(): void {
    const config = configManager.loadConfig();
    if (!config.proxy?.monsters) {
        return;
    }

    config.proxy.monsters.keeperMapNumber = undefined;
    config.proxy.monsters.keeperX = undefined;
    config.proxy.monsters.keeperY = undefined;
    config.proxy.monsters.keeperDirection = undefined;
    config.proxy.monsters.keeperSprite = undefined;
    config.proxy.monsters.keeperName = undefined;
    config.proxy.monsters.keeperAmbientSpeech = undefined;
    configManager.saveConfig(config);
}

function syncFishingConfig(npc: {
    mapNumber: number;
    x: number;
    y: number;
    direction: number;
    sprite: number;
    name: string;
    ambientSpeech?: { intervalSeconds?: number; messages?: string[] };
}): void {
    const config = configManager.loadConfig();
    if (!config.proxy)
        config.proxy = {};
    if (!config.proxy.fishing)
        config.proxy.fishing = {};
    config.proxy.fishing.enabled = true;
    config.proxy.fishing.npcMapNumber = npc.mapNumber;
    config.proxy.fishing.npcX = npc.x;
    config.proxy.fishing.npcY = npc.y;
    config.proxy.fishing.npcDirection = npc.direction;
    config.proxy.fishing.npcSprite = npc.sprite;
    config.proxy.fishing.npcName = npc.name;
    config.proxy.fishing.npcAmbientSpeech = normalizeKeeperAmbientSpeech(npc.ambientSpeech);
    configManager.saveConfig(config);
}

function clearFishingConfig(): void {
    const config = configManager.loadConfig();
    if (!config.proxy?.fishing) {
        return;
    }

    config.proxy.fishing.npcMapNumber = undefined;
    config.proxy.fishing.npcX = undefined;
    config.proxy.fishing.npcY = undefined;
    config.proxy.fishing.npcDirection = undefined;
    config.proxy.fishing.npcSprite = undefined;
    config.proxy.fishing.npcName = undefined;
    config.proxy.fishing.npcAmbientSpeech = undefined;
    configManager.saveConfig(config);
}

function loadNpcPositions(): void {
    try {
        if (fs.existsSync(NPC_POSITIONS_FILE)) {
            npcPositionOverrides = JSON.parse(fs.readFileSync(NPC_POSITIONS_FILE, 'utf-8'));
            console.log(`[NPC] Loaded ${Object.keys(npcPositionOverrides).length} position overrides`);
        }
    } catch (e) {
        console.log(`[NPC] Failed to load npc-positions.json: ${e}`);
        npcPositionOverrides = {};
    }
}

function saveNpcPositions(): void {
    try {
        fs.writeFileSync(NPC_POSITIONS_FILE, JSON.stringify(npcPositionOverrides, null, 2));
    } catch (e) {
        console.log(`[NPC] Failed to save npc-positions.json: ${e}`);
    }
}

export function getNpcPositionOverride(name: string): NpcPositionOverride | undefined {
    return npcPositionOverrides[name.toLowerCase()];
}

export function getAllNpcPositionOverrides(): NpcPositionOverride[] {
    return Object.values(npcPositionOverrides);
}

export function updateNpcOverrideSerial(name: string, serial: number): void {
    const key = name.toLowerCase();
    const ov = npcPositionOverrides[key];
    if (ov && ov.serial !== serial) {
        ov.serial = serial;
        saveNpcPositions();
    }
}

export function updateNpcOverrideVisualData(name: string, data: { sprite: number; mapNumber: number; direction: number; serial: number }): void {
    const key = name.toLowerCase();
    const ov = npcPositionOverrides[key];
    if (ov) {
        ov.sprite = data.sprite;
        ov.mapNumber = data.mapNumber;
        ov.direction = data.direction;
        ov.serial = data.serial;
        saveNpcPositions();
    }
}

loadNpcPositions();

/**
 * Registers built-in slash commands on the given registry.
 */
export function registerBuiltinCommands(registry: CommandRegistry, opts: {
    proxy: ProxyServer;
    chat: ChatInjector;
    players: PlayerRegistry;
    npcs: NpcInjector;
}): void {
    const { proxy, chat, players, npcs } = opts;

    function notifyVirtualNpcChanged(): void {
        proxy.emit('npc:virtualChanged');
    }

    function refreshMapswapSessions() {
        for (const session of proxy.sessions.values()) {
            if (session.phase !== 'game' || session.destroyed)
                continue;
            if (session.afkState?.active)
                continue;
            session.lastInjectedMap = null;
            session.substitutedMapData = null;
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
        if (session.afkState?.active) {
            const afk = session.afkState;
            chat.systemMessage(session, `AFK Position: (${afk.shadowX}, ${afk.shadowY}) Map: ${afk.afkMapNumber}`);
            chat.systemMessage(session, `Real Position: (${afk.realX}, ${afk.realY}) Map: ${afk.realMapNumber}`);
            return;
        }
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
        if (session.afkState?.active) {
            const afk = session.afkState;
            chat.systemMessage(session, `AFK: map ${afk.afkMapNumber} (${afk.shadowX},${afk.shadowY}) real map ${afk.realMapNumber} (${afk.realX},${afk.realY})`);
        }
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
            chat.systemMessage(session, `${npc.name} @ map ${npc.mapNumber} (${npc.x},${npc.y}) scope=${npc.worldScope} id=0x${npc.serial.toString(16)}`);
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
                Object.keys(subs).forEach(k => delete (subs as any)[k]);
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

    function resolveNpc(identifier: string) {
        const asNum = parseInt(identifier, 16) || parseInt(identifier, 10);
        if (asNum) {
            const npc = npcs.getNPC(asNum);
            if (npc) return npc;
        }
        return npcs.getNPCByName(identifier);
    }

    // ── /npc command: place, edit, remove, list, auction ──
    registry.register('npc', (session, args) => {
        const sub = (args[0] || '').toLowerCase();
        if (!sub || sub === 'help') {
            chat.systemMessage(session, '--- NPC Commands ---');
            chat.systemMessage(session, '/npc list - List all virtual NPCs');
            chat.systemMessage(session, '/npc place <name> <sprite> - Place NPC at your position');
            chat.systemMessage(session, '/npc remove <name|serial> - Remove an NPC');
            chat.systemMessage(session, '/npc move <name|serial> <x> <y> - Move an NPC');
            chat.systemMessage(session, '/npc sprite <name|serial> <sprite#> - Change NPC sprite');
            chat.systemMessage(session, '/npc edit <name|serial> <field> <value> - Edit NPC field');
            chat.systemMessage(session, '  Fields: name, sprite, direction, type');
            chat.systemMessage(session, '/npc auction <name|serial> - Attach auction house to NPC');
            chat.systemMessage(session, '/npc reset <name> - Clear saved position for an NPC');
            chat.systemMessage(session, '/npc overrides - List all saved position overrides');
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
                chat.systemMessage(session, `0x${npc.serial.toString(16)} "${npc.name}" sprite=${npc.sprite} map=${npc.mapNumber} (${npc.x},${npc.y}) scope=${npc.worldScope}${handler}`);
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
            const afk = session.afkState?.active ? session.afkState : null;
            const serial = npcs.placeNPC({
                name,
                sprite,
                x: afk ? afk.shadowX : session.playerState.x,
                y: afk ? afk.shadowY : session.playerState.y,
                mapNumber: afk ? afk.afkMapNumber : session.playerState.mapNumber,
                direction: 2,
                creatureType: 2,
                worldScope: afk ? 'afk' : 'live',
            });
            notifyVirtualNpcChanged();
            chat.systemMessage(session, `Placed "${name}" serial=0x${serial.toString(16)} sprite=${sprite} scope=${afk ? 'afk' : 'live'}`);
            return;
        }
        if (sub === 'remove') {
            if (!args[1]) {
                chat.systemMessage(session, 'Usage: /npc remove <name|serial>');
                return;
            }
            const npc = resolveNpc(args[1]);
            if (!npc) {
                chat.systemMessage(session, `NPC "${args[1]}" not found.`);
                return;
            }
            const keeper = getMonsterKeeperModule();
            const auctionHouse = getAuctionHouseModule();
            const fishing = getFishingModule();
            if (auctionHouse && auctionHouse.isAuctionNpc && auctionHouse.isAuctionNpc(npc.serial) && auctionHouse.unassignFromNpc) {
                auctionHouse.unassignFromNpc(npc.serial);
            }
            if (keeper && keeper.isKeeperNpc && keeper.isKeeperNpc(npc.serial) && keeper.clearKeeperAssignment) {
                keeper.clearKeeperAssignment();
                clearMonsterKeeperConfig();
            }
            if (fishing && fishing.isFishingNpc && fishing.isFishingNpc(npc.serial) && fishing.unassignFromNpc) {
                fishing.unassignFromNpc(npc.serial);
                clearFishingConfig();
            }
            npcs.removeNPC(npc.serial);
            notifyVirtualNpcChanged();
            chat.systemMessage(session, `Removed "${npc.name}" (0x${npc.serial.toString(16)})`);
            return;
        }
        if (sub === 'move') {
            if (!args[1]) {
                chat.systemMessage(session, 'Usage: /npc move <name|serial> <x> <y>');
                return;
            }
            const x = parseInt(args[2], 10);
            const y = parseInt(args[3], 10);
            if (isNaN(x) || isNaN(y)) {
                chat.systemMessage(session, 'Usage: /npc move <name|serial> <x> <y>');
                return;
            }
            // Try virtual NPC first
            const virtualNpc = resolveNpc(args[1]);
            if (virtualNpc) {
                npcs.moveNPC(virtualNpc.serial, x, y);
                notifyVirtualNpcChanged();
                chat.systemMessage(session, `Moved "${virtualNpc.name}" to (${x},${y})`);
                return;
            }
            // Fall back to real entities visible to this session
            const entityMap = players.entities.get(session.id);
            if (entityMap) {
                const nameLower = args[1].toLowerCase();
                for (const entity of entityMap.values()) {
                    if (entity.name.toLowerCase() === nameLower) {
                        let dir = entity.direction;
                        if (x > entity.x) dir = 1;
                        else if (x < entity.x) dir = 3;
                        else if (y > entity.y) dir = 2;
                        else if (y < entity.y) dir = 0;
                        entity.x = x;
                        entity.y = y;
                        entity.direction = dir;
                        // Remove + re-add at new position for all proxy sessions
                        for (const s of proxy.sessions.values()) {
                            if (s.phase === 'game' && !s.destroyed) {
                                // 0x0E RemoveEntity
                                const removePkt = new Packet(0x0E);
                                removePkt.writeUInt32(entity.serial);
                                proxy.sendToClient(s, removePkt);
                                // 0x07 AddEntity at new position
                                const addPkt = new Packet(0x07);
                                addPkt.writeUInt16(1); // EntityCount
                                addPkt.writeUInt16(x);
                                addPkt.writeUInt16(y);
                                addPkt.writeUInt32(entity.serial);
                                addPkt.writeUInt16(entity.sprite | 0x4000); // creature flag
                                addPkt.writeUInt32(0); // Unknown
                                addPkt.writeByte(dir); // Direction
                                addPkt.writeByte(0); // Skip
                                addPkt.writeByte(2); // CreatureType: Mundane
                                addPkt.writeString8(entity.name);
                                proxy.sendToClient(s, addPkt);
                            }
                        }
                        npcPositionOverrides[entity.name.toLowerCase()] = {
                            name: entity.name, x, y,
                            sprite: entity.sprite,
                            mapNumber: session.playerState.mapNumber,
                            direction: dir,
                            serial: entity.serial,
                        };
                        saveNpcPositions();
                        chat.systemMessage(session, `Moved "${entity.name}" to (${x},${y}) [saved]`);
                        return;
                    }
                }
            }
            chat.systemMessage(session, `NPC "${args[1]}" not found (virtual or real).`);
            return;
        }
        if (sub === 'sprite') {
            if (!args[1] || !args[2]) {
                chat.systemMessage(session, 'Usage: /npc sprite <name|serial> <spriteNumber>');
                return;
            }
            const newSprite = parseInt(args[2], 10);
            if (isNaN(newSprite)) {
                chat.systemMessage(session, 'Usage: /npc sprite <name|serial> <spriteNumber>');
                return;
            }
            // Try virtual NPC first
            const virtualNpc = resolveNpc(args[1]);
            if (virtualNpc) {
                npcs.changeSpriteNPC(virtualNpc.serial, newSprite);
                notifyVirtualNpcChanged();
                chat.systemMessage(session, `Changed "${virtualNpc.name}" sprite to ${newSprite}`);
                return;
            }
            // Fall back to real entities visible to this session
            const entityMap = players.entities.get(session.id);
            if (entityMap) {
                const nameLower = args[1].toLowerCase();
                for (const entity of entityMap.values()) {
                    if (entity.name.toLowerCase() === nameLower) {
                        entity.sprite = newSprite;
                        entity.image = newSprite;
                        for (const s of proxy.sessions.values()) {
                            if (s.phase === 'game' && !s.destroyed) {
                                const removePkt = new Packet(0x0E);
                                removePkt.writeUInt32(entity.serial);
                                proxy.sendToClient(s, removePkt);
                                const addPkt = new Packet(0x07);
                                addPkt.writeUInt16(1);
                                addPkt.writeUInt16(entity.x);
                                addPkt.writeUInt16(entity.y);
                                addPkt.writeUInt32(entity.serial);
                                addPkt.writeUInt16(newSprite | 0x4000);
                                addPkt.writeUInt32(0);
                                addPkt.writeByte(entity.direction);
                                addPkt.writeByte(0);
                                addPkt.writeByte(2); // Mundane
                                addPkt.writeString8(entity.name);
                                proxy.sendToClient(s, addPkt);
                            }
                        }
                        const key = entity.name.toLowerCase();
                        if (npcPositionOverrides[key]) {
                            npcPositionOverrides[key].sprite = newSprite;
                            saveNpcPositions();
                            chat.systemMessage(session, `Changed "${entity.name}" sprite to ${newSprite} [saved]`);
                        } else {
                            npcPositionOverrides[key] = {
                                name: entity.name,
                                x: entity.x,
                                y: entity.y,
                                sprite: newSprite,
                                mapNumber: session.playerState.mapNumber,
                                direction: entity.direction,
                                serial: entity.serial,
                            };
                            saveNpcPositions();
                            chat.systemMessage(session, `Changed "${entity.name}" sprite to ${newSprite} [saved]`);
                        }
                        return;
                    }
                }
            }
            chat.systemMessage(session, `NPC "${args[1]}" not found (virtual or real).`);
            return;
        }
        if (sub === 'reset') {
            if (!args[1]) {
                chat.systemMessage(session, 'Usage: /npc reset <name>');
                return;
            }
            const key = args[1].toLowerCase();
            if (!npcPositionOverrides[key]) {
                chat.systemMessage(session, `No saved position for "${args[1]}".`);
                return;
            }
            delete npcPositionOverrides[key];
            saveNpcPositions();
            chat.systemMessage(session, `Cleared saved position for "${args[1]}". Will use server default on next load.`);
            return;
        }
        if (sub === 'overrides') {
            const entries = Object.values(npcPositionOverrides);
            if (entries.length === 0) {
                chat.systemMessage(session, 'No saved NPC position overrides.');
                return;
            }
            chat.systemMessage(session, `--- NPC Position Overrides (${entries.length}) ---`);
            for (const ov of entries) {
                const mapStr = ov.mapNumber != null ? ` map=${ov.mapNumber}` : '';
                const sprStr = ov.sprite != null ? ` spr=${ov.sprite}` : '';
                chat.systemMessage(session, `"${ov.name}" -> (${ov.x},${ov.y})${mapStr}${sprStr}`);
            }
            return;
        }
        if (sub === 'edit') {
            const field = (args[2] || '').toLowerCase();
            const value = args.slice(3).join(' ');
            if (!args[1] || !field || !value) {
                chat.systemMessage(session, 'Usage: /npc edit <name|serial> <field> <value>');
                chat.systemMessage(session, 'Fields: name, sprite, direction, type');
                return;
            }
            const npc = resolveNpc(args[1]);
            if (!npc) {
                chat.systemMessage(session, `NPC "${args[1]}" not found.`);
                return;
            }
            // Remove + re-place with updated fields to refresh on all clients
            const opts: any = {
                name: npc.name,
                sprite: npc.sprite,
                x: npc.x,
                y: npc.y,
                mapNumber: npc.mapNumber,
                direction: npc.direction,
                creatureType: npc.creatureType,
                worldScope: npc.worldScope,
                dialog: npc.dialog,
            };
            const keeper = getMonsterKeeperModule();
            const auctionHouse = getAuctionHouseModule();
            const fishing = getFishingModule();
            const wasMonsterKeeper = !!(keeper && keeper.isKeeperNpc && keeper.isKeeperNpc(npc.serial));
            const wasAuctioneer = !!(auctionHouse && auctionHouse.isAuctionNpc && auctionHouse.isAuctionNpc(npc.serial));
            const wasFishingNpc = !!(fishing && fishing.isFishingNpc && fishing.isFishingNpc(npc.serial));
            const savedHandler = (!wasMonsterKeeper && !wasAuctioneer && !wasFishingNpc) ? npc.onInteract : undefined;
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
            npcs.removeNPC(npc.serial);
            const newSerial = npcs.placeNPC(opts);
            const newNpc = npcs.getNPC(newSerial);
            if (newNpc && wasAuctioneer && auctionHouse && auctionHouse.unassignFromNpc && auctionHouse.assignToNpc) {
                auctionHouse.unassignFromNpc(npc.serial);
                auctionHouse.assignToNpc(newNpc);
            }
            if (newNpc && wasMonsterKeeper && keeper && keeper.assignKeeperToNpc) {
                if (keeper.assignKeeperToNpc(newNpc)) {
                    syncMonsterKeeperConfig(newNpc);
                }
            }
            else if (newNpc && wasFishingNpc && fishing && fishing.assignToNpc) {
                if (fishing.assignToNpc(newNpc)) {
                    syncFishingConfig(newNpc);
                }
            }
            else if (newNpc && savedHandler) {
                newNpc.onInteract = savedHandler;
            }
            notifyVirtualNpcChanged();
            chat.systemMessage(session, `Updated "${opts.name}" → new serial=0x${newSerial.toString(16)}`);
            return;
        }
        if (sub === 'auction') {
            if (!args[1]) {
                chat.systemMessage(session, 'Usage: /npc auction <name|serial>');
                return;
            }
            const npc = resolveNpc(args[1]);
            if (!npc) {
                chat.systemMessage(session, `NPC "${args[1]}" not found.`);
                return;
            }
            // Emit event so panel.js / index.ts can wire up the auction handler
            proxy.emit('npc:assignAuction', npc, session);
            chat.systemMessage(session, `Auction handler assigned to "${npc.name}" (0x${npc.serial.toString(16)})`);
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
        const file = path.join(__dirname, '../../../data/disguise-state.json');
        let disguises: Record<string, any> = {};
        try { disguises = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch (e) { /* ignore */ }
        if (!disguises['Lancelot']) {
            disguises['Lancelot'] = { enabled: false, title: 'King', displayClass: 'Elite Gladiator', guildRank: 'Founder', guild: 'Aisling Exchange', overcoatSprite: 335, overcoatColor: 0 };
        }
        disguises['Lancelot'].enabled = !disguises['Lancelot'].enabled;
        chat.systemMessage(session, disguises['Lancelot'].enabled ? 'King mode ON' : 'King mode OFF');
        try { fs.writeFileSync(file, JSON.stringify(disguises, null, 2), 'utf-8'); } catch (e) { /* ignore */ }
        // Sync in-memory state if getPlayerDisguise is wired
        if ((proxy as any)._reloadDisguises) (proxy as any)._reloadDisguises();
        // F5 refresh all proxy sessions on the same map so they see the change
        const myMap = session.playerState.mapNumber;
        for (const s of proxy.sessions.values()) {
            if (s.phase !== 'game' || s.destroyed)
                continue;
            if (s.afkState?.active) {
                // AFK sessions: trigger viewport refresh so other AFK players
                // re-see this player with the updated disguise appearance
                proxy.emit('afk:refresh', s);
                continue;
            }
            if (s.playerState.mapNumber !== myMap)
                continue;
            s.lastInjectedMap = null;
            s.substitutedMapData = null;
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

export { default as CommandRegistry } from './command-registry';
export type { CommandHandler, CommandInfo } from './command-registry';
