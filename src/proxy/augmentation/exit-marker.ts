import Packet from '../../core/packet';
import * as fs from 'fs';
import * as path from 'path';
import type ProxyServer from '../proxy-server';
import type ProxySession from '../proxy-session';
import type PlayerRegistry from '../player-registry';
import type ChatInjector from './chat-injector';
import type CommandRegistry from '../commands/command-registry';

const DOOR_ANIM_FILE = path.resolve(__dirname, '../../../data/door-animations.json');
const AFK_EXIT_FILE = path.resolve(__dirname, '../../../data/afk-exit-markers.json');

interface ExitCoord {
    x: number;
    y: number;
}

interface DoorAnimationEntry {
    mapId: number;
    x: number;
    y: number;
}

interface MapExit {
    fromMapId: number;
    fromX: number;
    fromY: number;
    [key: string]: unknown;
}

interface RefreshTimerEntry {
    timer: ReturnType<typeof setInterval>;
    session: ProxySession;
}

/**
 * Marks all known map exits with floor-targeted animation effects (0x29).
 *
 * Uses the real 0x29 packet format with Serial=0 for floor animations.
 * Each exit tile gets its own animation packet — the server sends multiple
 * floor animations simultaneously (no fake entity workaround needed).
 *
 * Also supports custom door animation markers added via /exitmark command.
 */
export default class ExitMarker {
    private proxy: ProxyServer;
    private registry: PlayerRegistry;
    /** fromMapId -> list of exit coordinates */
    private exitsByMap: Map<number, ExitCoord[]> = new Map();
    /** sessionId -> { timer, session } for periodic animation refresh */
    private refreshTimers: Map<string, RefreshTimerEntry> = new Map();
    /** Custom door animation entries (persisted to door-animations.json) */
    private doorAnimations: DoorAnimationEntry[] = [];
    /** AFK shadow world exit markers (persisted to afk-exit-markers.json) */
    private afkExitsByMap: Map<number, ExitCoord[]> = new Map();
    private afkExitEntries: DoorAnimationEntry[] = [];

    static VIEW_RANGE = 15;
    static ANIMATION_ID = 214;
    static ANIMATION_SPEED = 200;
    static REFRESH_INTERVAL_MS = 1000;

    constructor(proxy: ProxyServer, registry: PlayerRegistry) {
        this.proxy = proxy;
        this.registry = registry;
        this.loadExits();
        this.loadDoorAnimations();
        this.loadAfkExits();
        const map3052 = this.exitsByMap.get(3052);
        console.log(`[ExitMarker] INIT exitsByMap has ${this.exitsByMap.size} maps, map 3052 has ${map3052?.length ?? 0} entries`);
    }

    private loadExits(): void {
        try {
            const filePath = path.resolve(__dirname, '../../../data/map-exits.json');
            const raw = fs.readFileSync(filePath, 'utf-8');
            const exits: MapExit[] = JSON.parse(raw);
            for (const exit of exits) {
                let list = this.exitsByMap.get(exit.fromMapId);
                if (!list) {
                    list = [];
                    this.exitsByMap.set(exit.fromMapId, list);
                }
                if (!list.some(e => e.x === exit.fromX && e.y === exit.fromY)) {
                    list.push({ x: exit.fromX, y: exit.fromY });
                }
            }
            let totalExits = 0;
            for (const list of this.exitsByMap.values())
                totalExits += list.length;
            console.log(`[ExitMarker] Loaded ${totalExits} exit tiles across ${this.exitsByMap.size} maps`);
        }
        catch (e) {
            console.log(`[ExitMarker] Failed to load map-exits.json: ${e}`);
        }
    }

    // --- Door Animations ---

    private loadDoorAnimations(): void {
        try {
            const raw = fs.readFileSync(DOOR_ANIM_FILE, 'utf-8');
            const entries: DoorAnimationEntry[] = JSON.parse(raw);
            this.doorAnimations = entries;
            for (const entry of entries) {
                let list = this.exitsByMap.get(entry.mapId);
                if (!list) {
                    list = [];
                    this.exitsByMap.set(entry.mapId, list);
                }
                if (!list.some(e => e.x === entry.x && e.y === entry.y)) {
                    list.push({ x: entry.x, y: entry.y });
                }
            }
            if (entries.length > 0) {
                console.log(`[ExitMarker] Loaded ${entries.length} custom door animations`);
            }
        }
        catch (e: any) {
            if (e.code === 'ENOENT') {
                // File doesn't exist yet — that's fine
            }
            else {
                console.log(`[ExitMarker] Failed to load door-animations.json: ${e}`);
            }
        }
    }

    private saveDoorAnimations(): void {
        try {
            fs.writeFileSync(DOOR_ANIM_FILE, JSON.stringify(this.doorAnimations, null, 2), 'utf-8');
        }
        catch (e) {
            console.log(`[ExitMarker] Failed to save door-animations.json: ${e}`);
        }
    }

    addDoorAnimation(mapId: number, x: number, y: number): boolean {
        // Check if already exists in doorAnimations
        if (this.doorAnimations.some(e => e.mapId === mapId && e.x === x && e.y === y)) {
            return false;
        }
        this.doorAnimations.push({ mapId, x, y });
        // Add to exitsByMap
        let list = this.exitsByMap.get(mapId);
        if (!list) {
            list = [];
            this.exitsByMap.set(mapId, list);
        }
        if (!list.some(e => e.x === x && e.y === y)) {
            list.push({ x, y });
        }
        this.saveDoorAnimations();
        return true;
    }

    removeDoorAnimation(mapId: number, x: number, y: number): boolean {
        const idx = this.doorAnimations.findIndex(e => e.mapId === mapId && e.x === x && e.y === y);
        if (idx === -1) return false;
        this.doorAnimations.splice(idx, 1);
        // Remove from exitsByMap
        const list = this.exitsByMap.get(mapId);
        if (list) {
            const listIdx = list.findIndex(e => e.x === x && e.y === y);
            if (listIdx !== -1) list.splice(listIdx, 1);
            if (list.length === 0) this.exitsByMap.delete(mapId);
        }
        this.saveDoorAnimations();
        return true;
    }

    listDoorAnimations(): DoorAnimationEntry[] {
        return this.doorAnimations.slice();
    }

    // --- AFK Exit Markers ---

    private loadAfkExits(): void {
        try {
            const raw = fs.readFileSync(AFK_EXIT_FILE, 'utf-8');
            const entries: DoorAnimationEntry[] = JSON.parse(raw);
            this.afkExitEntries = entries;
            for (const entry of entries) {
                let list = this.afkExitsByMap.get(entry.mapId);
                if (!list) {
                    list = [];
                    this.afkExitsByMap.set(entry.mapId, list);
                }
                if (!list.some(e => e.x === entry.x && e.y === entry.y)) {
                    list.push({ x: entry.x, y: entry.y });
                }
            }
            if (entries.length > 0) {
                console.log(`[ExitMarker] Loaded ${entries.length} AFK exit markers`);
            }
        }
        catch (e: any) {
            if (e.code !== 'ENOENT') {
                console.log(`[ExitMarker] Failed to load afk-exit-markers.json: ${e}`);
            }
        }
    }

    private saveAfkExits(): void {
        try {
            fs.writeFileSync(AFK_EXIT_FILE, JSON.stringify(this.afkExitEntries, null, 2), 'utf-8');
        }
        catch (e) {
            console.log(`[ExitMarker] Failed to save afk-exit-markers.json: ${e}`);
        }
    }

    addAfkExit(mapId: number, x: number, y: number): boolean {
        if (this.afkExitEntries.some(e => e.mapId === mapId && e.x === x && e.y === y)) {
            return false;
        }
        this.afkExitEntries.push({ mapId, x, y });
        let list = this.afkExitsByMap.get(mapId);
        if (!list) {
            list = [];
            this.afkExitsByMap.set(mapId, list);
        }
        if (!list.some(e => e.x === x && e.y === y)) {
            list.push({ x, y });
        }
        this.saveAfkExits();
        return true;
    }

    removeAfkExit(mapId: number, x: number, y: number): boolean {
        const idx = this.afkExitEntries.findIndex(e => e.mapId === mapId && e.x === x && e.y === y);
        if (idx === -1) return false;
        this.afkExitEntries.splice(idx, 1);
        const list = this.afkExitsByMap.get(mapId);
        if (list) {
            const listIdx = list.findIndex(e => e.x === x && e.y === y);
            if (listIdx !== -1) list.splice(listIdx, 1);
            if (list.length === 0) this.afkExitsByMap.delete(mapId);
        }
        this.saveAfkExits();
        return true;
    }

    listAfkExits(): DoorAnimationEntry[] {
        return this.afkExitEntries.slice();
    }

    // --- Events ---

    onPlayerMapChange(session: ProxySession): void {
        this._stopRefreshTimer(session.id);
        setTimeout(() => {
            if (session.destroyed) return;
            if ((session as any).afkState?.active) {
                this._sendAfkExitAnimations(session);
            } else {
                this._sendExitAnimations(session);
            }
            this._startRefreshTimer(session);
        }, 1000);
    }

    onPlayerRefresh(session: ProxySession): void {
        this._stopRefreshTimer(session.id);
        setTimeout(() => {
            if (session.destroyed) return;
            if ((session as any).afkState?.active) {
                this._sendAfkExitAnimations(session);
            } else {
                this._sendExitAnimations(session);
            }
            this._startRefreshTimer(session);
        }, 500);
    }

    onAfkRefresh(session: ProxySession): void {
        this._stopRefreshTimer(session.id);
        setTimeout(() => {
            if (session.destroyed || !(session as any).afkState?.active) return;
            this._sendAfkExitAnimations(session);
            this._startRefreshTimer(session);
        }, 500);
    }

    onPlayerPosition(session: ProxySession): void {
        // Animations are refreshed on timer; no per-move action needed
    }

    clearSession(sessionId: string): void {
        this._stopRefreshTimer(sessionId);
    }

    // --- Packet builder ---

    /**
     * Send floor-targeted 0x29 animation for all exits in viewport.
     *
     * Real 0x29 format (confirmed from server packets):
     * [Serial:u32] [AnimationId:u16] [Speed:u16] [X:u16] [Y:u16] [Unknown:u16]
     * Serial=0 means floor animation (no entity).
     */
    private _exitAnimDebugOnce = new Set<string>();
    private _sendExitAnimations(session: ProxySession): void {
        if (session.destroyed || !session.clientSocket || session.clientSocket.destroyed) return;
        const px = session.playerState.x;
        const py = session.playerState.y;
        const exits = this._getExitsForSession(session);
        if (!exits || exits.length === 0)
            return;
        const debugKey = `${session.id}:${session.playerState.mapNumber}`;
        if (!this._exitAnimDebugOnce.has(debugKey)) {
            this._exitAnimDebugOnce.add(debugKey);
            const related = this._getRelatedMapNumbers(session.playerState.mapNumber);
            console.log(`[ExitMarker] DEBUG [${session.id}]: map=${session.playerState.mapNumber} resolved=${related.join(',')} pos=(${px},${py}) total exits=${exits.length}`);
            for (const e of exits) {
                console.log(`[ExitMarker] DEBUG   tile (${e.x},${e.y}) inRange=${this._inRange(px, py, e.x, e.y)}`);
            }
        }
        let count = 0;
        for (const exit of exits) {
            if (this._inRange(px, py, exit.x, exit.y)) {
                const pkt = new Packet(0x29);
                pkt.writeUInt32(0);                          // Serial (0 = floor)
                pkt.writeUInt16(ExitMarker.ANIMATION_ID);    // AnimationId
                pkt.writeUInt16(ExitMarker.ANIMATION_SPEED); // Speed
                pkt.writeUInt16(exit.x);                     // X
                pkt.writeUInt16(exit.y);                     // Y
                pkt.writeUInt16(0);                          // Unknown
                this.proxy.sendToClient(session, pkt);
                count++;
            }
        }
    }

    // --- Timer ---

    private _sendAfkExitAnimations(session: ProxySession): void {
        if (session.destroyed || !session.clientSocket || session.clientSocket.destroyed) return;
        const afk = (session as any).afkState;
        if (!afk?.active) return;
        const px = afk.shadowX;
        const py = afk.shadowY;
        const mapId = afk.afkMapNumber;
        const exits = this.afkExitsByMap.get(mapId);
        if (!exits || exits.length === 0) return;
        for (const exit of exits) {
            if (this._inRange(px, py, exit.x, exit.y)) {
                const pkt = new Packet(0x29);
                pkt.writeUInt32(0);
                pkt.writeUInt16(ExitMarker.ANIMATION_ID);
                pkt.writeUInt16(ExitMarker.ANIMATION_SPEED);
                pkt.writeUInt16(exit.x);
                pkt.writeUInt16(exit.y);
                pkt.writeUInt16(0);
                this.proxy.sendToClient(session, pkt);
            }
        }
    }

    private _startRefreshTimer(session: ProxySession): void {
        this._stopRefreshTimer(session.id);
        const timer = setInterval(() => {
            if (session.destroyed || !session.clientSocket || session.clientSocket.destroyed) {
                this._stopRefreshTimer(session.id);
                return;
            }
            if ((session as any).afkState?.active) {
                this._sendAfkExitAnimations(session);
            } else {
                this._sendExitAnimations(session);
            }
        }, ExitMarker.REFRESH_INTERVAL_MS);
        this.refreshTimers.set(session.id, { timer, session });
    }

    private _stopRefreshTimer(sessionId: string): void {
        const entry = this.refreshTimers.get(sessionId);
        if (entry) {
            clearInterval(entry.timer);
            this.refreshTimers.delete(sessionId);
        }
    }

    private _restartAllTimers(): void {
        const sessions: ProxySession[] = [];
        for (const [, entry] of this.refreshTimers) {
            sessions.push(entry.session);
        }
        for (const session of sessions) {
            this._startRefreshTimer(session);
        }
    }

    // --- Helpers ---

    /**
     * Resolve a map number to its original (pre-substitution) map number.
     * If `mapNumber` is a substitution *target* (e.g. 33332), returns the
     * original key (e.g. 3052). If it's already an original or unrelated,
     * returns itself.
     */
    resolveOriginalMap(mapNumber: number): number {
        const subs = this.proxy.config.mapSubstitutions;
        for (const [originalStr, replacement] of Object.entries(subs)) {
            if (replacement === mapNumber) {
                return parseInt(originalStr, 10);
            }
        }
        return mapNumber;
    }

    /**
     * Collect all map numbers related to a given map: the original plus every
     * substitution target that has ever been used. This lets exit markers set
     * on *any* version of a swapped map appear on *all* versions.
     */
    private _getRelatedMapNumbers(mapNumber: number): number[] {
        const original = this.resolveOriginalMap(mapNumber);
        const related = new Set<number>([original]);
        const subs = this.proxy.config.mapSubstitutions;
        // Add the current substitution target (if any)
        if (subs[original] !== undefined) {
            related.add(subs[original]);
        }
        // Also add mapNumber itself in case it's a past substitution target
        // that's still in exitsByMap from a previous /exitmark add
        related.add(mapNumber);
        return Array.from(related);
    }

    private _getExitsForSession(session: ProxySession): ExitCoord[] | undefined {
        const mapNumber = session.playerState.mapNumber;
        const related = this._getRelatedMapNumbers(mapNumber);
        const merged: ExitCoord[] = [];
        const seen = new Set<string>();
        for (const id of related) {
            const list = this.exitsByMap.get(id);
            if (!list) continue;
            for (const e of list) {
                const key = `${e.x},${e.y}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    merged.push(e);
                }
            }
        }
        return merged.length > 0 ? merged : undefined;
    }

    private _inRange(px: number, py: number, ex: number, ey: number): boolean {
        return Math.abs(ex - px) < ExitMarker.VIEW_RANGE
            && Math.abs(ey - py) < ExitMarker.VIEW_RANGE;
    }

    // Get the tile one step in front of the player based on facing direction
    // Direction: 0=up(-y), 1=right(+x), 2=down(+y), 3=left(-x)
    private _getTileInFront(session: ProxySession): { x: number; y: number } {
        const player = this.registry.getPlayer(session.id);
        const dir = player ? player.direction : 0;
        const x = session.playerState.x + (dir === 1 ? 1 : dir === 3 ? -1 : 0);
        const y = session.playerState.y + (dir === 0 ? -1 : dir === 2 ? 1 : 0);
        return { x, y };
    }

    // --- Slash Commands ---

    registerCommands(commands: CommandRegistry, chat: ChatInjector): void {
        commands.register('exitmark', async (session, args, raw) => {
            const sub = args[0]?.toLowerCase();
            if (!sub || sub === 'help') {
                chat.systemMessage(session, '/exitmark add — mark tile in front of you');
                chat.systemMessage(session, '/exitmark add <mapId> <x> <y> — mark specific tile');
                chat.systemMessage(session, '/exitmark remove — remove mark in front of you');
                chat.systemMessage(session, '/exitmark remove <mapId> <x> <y> — remove specific');
                chat.systemMessage(session, '/exitmark list — list all custom markers');
                chat.systemMessage(session, '/exitmark speed <value> — set animation speed');
                chat.systemMessage(session, '/exitmark interval <value> — set refresh interval ms');
                return;
            }
            if (sub === 'add') {
                let mapId: number, x: number, y: number;
                if (args.length >= 4) {
                    mapId = parseInt(args[1], 10);
                    x = parseInt(args[2], 10);
                    y = parseInt(args[3], 10);
                    if (isNaN(mapId) || isNaN(x) || isNaN(y)) {
                        chat.systemMessage(session, 'Usage: /exitmark add <mapId> <x> <y>');
                        return;
                    }
                } else {
                    mapId = session.playerState.mapNumber;
                    const front = this._getTileInFront(session);
                    x = front.x;
                    y = front.y;
                }
                mapId = this.resolveOriginalMap(mapId);
                if (this.addDoorAnimation(mapId, x, y)) {
                    chat.systemMessage(session, `Exit marker added at map ${mapId} (${x},${y}).`);
                } else {
                    chat.systemMessage(session, `Marker already exists at map ${mapId} (${x},${y}).`);
                }
                return;
            }
            if (sub === 'remove') {
                let mapId: number, x: number, y: number;
                if (args.length >= 4) {
                    mapId = parseInt(args[1], 10);
                    x = parseInt(args[2], 10);
                    y = parseInt(args[3], 10);
                    if (isNaN(mapId) || isNaN(x) || isNaN(y)) {
                        chat.systemMessage(session, 'Usage: /exitmark remove <mapId> <x> <y>');
                        return;
                    }
                } else {
                    mapId = session.playerState.mapNumber;
                    const front = this._getTileInFront(session);
                    x = front.x;
                    y = front.y;
                }
                mapId = this.resolveOriginalMap(mapId);
                if (this.removeDoorAnimation(mapId, x, y)) {
                    chat.systemMessage(session, `Exit marker removed at map ${mapId} (${x},${y}).`);
                } else {
                    chat.systemMessage(session, `No custom marker at map ${mapId} (${x},${y}).`);
                }
                return;
            }
            if (sub === 'list') {
                const markers = this.listDoorAnimations();
                if (markers.length === 0) {
                    chat.systemMessage(session, 'No custom exit markers defined.');
                    return;
                }
                chat.systemMessage(session, `--- Custom Exit Markers (${markers.length}) ---`);
                for (const m of markers) {
                    chat.systemMessage(session, `Map ${m.mapId} (${m.x},${m.y})`);
                }
                return;
            }
            if (sub === 'speed') {
                const val = parseInt(args[1], 10);
                if (isNaN(val) || val < 1) {
                    chat.systemMessage(session, `Current speed: ${ExitMarker.ANIMATION_SPEED}. Usage: /exitmark speed <value>`);
                    return;
                }
                ExitMarker.ANIMATION_SPEED = val;
                chat.systemMessage(session, `Animation speed set to ${val}. Takes effect on next refresh cycle.`);
                return;
            }
            if (sub === 'interval') {
                const val = parseInt(args[1], 10);
                if (isNaN(val) || val < 100) {
                    chat.systemMessage(session, `Current interval: ${ExitMarker.REFRESH_INTERVAL_MS}ms. Usage: /exitmark interval <value> (min 100)`);
                    return;
                }
                ExitMarker.REFRESH_INTERVAL_MS = val;
                this._restartAllTimers();
                chat.systemMessage(session, `Refresh interval set to ${val}ms. All timers restarted.`);
                return;
            }
            chat.systemMessage(session, `Unknown subcommand: ${sub}. Use /exitmark help.`);
        }, 'Manage exit/door animation markers', '/exitmark <add|remove|list|speed|interval|help>');

        commands.register('afkexitmark', async (session, args) => {
            const sub = args[0]?.toLowerCase();
            if (!sub || sub === 'help') {
                chat.systemMessage(session, '/afkexitmark add — mark tile in front of you (AFK world)');
                chat.systemMessage(session, '/afkexitmark add <mapId> <x> <y> — mark specific tile');
                chat.systemMessage(session, '/afkexitmark remove — remove mark in front of you');
                chat.systemMessage(session, '/afkexitmark remove <mapId> <x> <y> — remove specific');
                chat.systemMessage(session, '/afkexitmark list — list all AFK exit markers');
                return;
            }
            if (sub === 'add') {
                let mapId: number, x: number, y: number;
                if (args.length >= 4) {
                    mapId = parseInt(args[1], 10);
                    x = parseInt(args[2], 10);
                    y = parseInt(args[3], 10);
                    if (isNaN(mapId) || isNaN(x) || isNaN(y)) {
                        chat.systemMessage(session, 'Usage: /afkexitmark add <mapId> <x> <y>');
                        return;
                    }
                } else {
                    const afk = (session as any).afkState;
                    if (!afk?.active) {
                        chat.systemMessage(session, 'You must be in AFK mode or specify <mapId> <x> <y>.');
                        return;
                    }
                    mapId = afk.afkMapNumber;
                    const front = this._getAfkTileInFront(session);
                    x = front.x;
                    y = front.y;
                }
                if (this.addAfkExit(mapId, x, y)) {
                    chat.systemMessage(session, `AFK exit marker added at map ${mapId} (${x},${y}).`);
                } else {
                    chat.systemMessage(session, `AFK marker already exists at map ${mapId} (${x},${y}).`);
                }
                return;
            }
            if (sub === 'remove') {
                let mapId: number, x: number, y: number;
                if (args.length >= 4) {
                    mapId = parseInt(args[1], 10);
                    x = parseInt(args[2], 10);
                    y = parseInt(args[3], 10);
                    if (isNaN(mapId) || isNaN(x) || isNaN(y)) {
                        chat.systemMessage(session, 'Usage: /afkexitmark remove <mapId> <x> <y>');
                        return;
                    }
                } else {
                    const afk = (session as any).afkState;
                    if (!afk?.active) {
                        chat.systemMessage(session, 'You must be in AFK mode or specify <mapId> <x> <y>.');
                        return;
                    }
                    mapId = afk.afkMapNumber;
                    const front = this._getAfkTileInFront(session);
                    x = front.x;
                    y = front.y;
                }
                if (this.removeAfkExit(mapId, x, y)) {
                    chat.systemMessage(session, `AFK exit marker removed at map ${mapId} (${x},${y}).`);
                } else {
                    chat.systemMessage(session, `No AFK marker at map ${mapId} (${x},${y}).`);
                }
                return;
            }
            if (sub === 'list') {
                const markers = this.listAfkExits();
                if (markers.length === 0) {
                    chat.systemMessage(session, 'No AFK exit markers defined.');
                    return;
                }
                chat.systemMessage(session, `--- AFK Exit Markers (${markers.length}) ---`);
                for (const m of markers) {
                    chat.systemMessage(session, `Map ${m.mapId} (${m.x},${m.y})`);
                }
                return;
            }
            chat.systemMessage(session, `Unknown subcommand: ${sub}. Use /afkexitmark help.`);
        }, 'Manage AFK shadow world exit markers', '/afkexitmark <add|remove|list|help>');
    }

    private _getAfkTileInFront(session: ProxySession): { x: number; y: number } {
        const afk = (session as any).afkState;
        const dir = (session as any).lastSelfShowUser ? (session as any).lastSelfShowUser[4] : 0;
        const x = (afk?.shadowX ?? 0) + (dir === 1 ? 1 : dir === 3 ? -1 : 0);
        const y = (afk?.shadowY ?? 0) + (dir === 0 ? -1 : dir === 2 ? 1 : 0);
        return { x, y };
    }
}
