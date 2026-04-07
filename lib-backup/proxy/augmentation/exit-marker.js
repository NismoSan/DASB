"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const packet_1 = __importDefault(require("../../core/packet"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const DOOR_ANIM_FILE = path.resolve(__dirname, '../../../data/door-animations.json');
/**
 * Marks all known map exits with floor-targeted animation effects (0x29).
 *
 * Uses the real 0x29 packet format with Serial=0 for floor animations.
 * Each exit tile gets its own animation packet — the server sends multiple
 * floor animations simultaneously (no fake entity workaround needed).
 *
 * Also supports custom door animation markers added via /exitmark command.
 */
class ExitMarker {
    proxy;
    registry;
    /** fromMapId -> list of exit coordinates */
    exitsByMap = new Map();
    /** sessionId -> { timer, session } for periodic animation refresh */
    refreshTimers = new Map();
    /** Custom door animation entries (persisted to door-animations.json) */
    doorAnimations = [];
    static VIEW_RANGE = 15;
    static ANIMATION_ID = 214;
    static ANIMATION_SPEED = 200;
    static REFRESH_INTERVAL_MS = 1000;
    constructor(proxy, registry) {
        this.proxy = proxy;
        this.registry = registry;
        this.loadExits();
        this.loadDoorAnimations();
    }
    loadExits() {
        try {
            const filePath = path.resolve(__dirname, '../../../data/map-exits.json');
            const raw = fs.readFileSync(filePath, 'utf-8');
            const exits = JSON.parse(raw);
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
    // ─── Door Animations ─────────────────────────────────────────
    loadDoorAnimations() {
        try {
            const raw = fs.readFileSync(DOOR_ANIM_FILE, 'utf-8');
            const entries = JSON.parse(raw);
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
        catch (e) {
            if (e.code === 'ENOENT') {
                // File doesn't exist yet — that's fine
            }
            else {
                console.log(`[ExitMarker] Failed to load door-animations.json: ${e}`);
            }
        }
    }
    saveDoorAnimations() {
        try {
            fs.writeFileSync(DOOR_ANIM_FILE, JSON.stringify(this.doorAnimations, null, 2), 'utf-8');
        }
        catch (e) {
            console.log(`[ExitMarker] Failed to save door-animations.json: ${e}`);
        }
    }
    addDoorAnimation(mapId, x, y) {
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
    removeDoorAnimation(mapId, x, y) {
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
    listDoorAnimations() {
        return this.doorAnimations.slice();
    }
    // ─── Events ──────────────────────────────────────────────────
    onPlayerMapChange(session) {
        this._stopRefreshTimer(session.id);
        setTimeout(() => {
            if (session.destroyed)
                return;
            this._sendExitAnimations(session);
            this._startRefreshTimer(session);
        }, 1000);
    }
    onPlayerRefresh(session) {
        this._stopRefreshTimer(session.id);
        setTimeout(() => {
            if (session.destroyed)
                return;
            this._sendExitAnimations(session);
            this._startRefreshTimer(session);
        }, 500);
    }
    onPlayerPosition(session) {
        // Animations are refreshed on timer; no per-move action needed
    }
    clearSession(sessionId) {
        this._stopRefreshTimer(sessionId);
    }
    // ─── Packet builder ──────────────────────────────────────
    /**
     * Send floor-targeted 0x29 animation for all exits in viewport.
     *
     * Real 0x29 format (confirmed from server packets):
     * [Serial:u32] [AnimationId:u16] [Speed:u16] [X:u16] [Y:u16] [Unknown:u16]
     * Serial=0 means floor animation (no entity).
     */
    _sendExitAnimations(session) {
        const px = session.playerState.x;
        const py = session.playerState.y;
        const exits = this._getExitsForSession(session);
        if (!exits || exits.length === 0)
            return;
        let count = 0;
        for (const exit of exits) {
            if (this._inRange(px, py, exit.x, exit.y)) {
                const pkt = new packet_1.default(0x29);
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
    // ─── Timer ─────────────────────────────────────────────────
    _startRefreshTimer(session) {
        this._stopRefreshTimer(session.id);
        const timer = setInterval(() => {
            if (session.destroyed) {
                this._stopRefreshTimer(session.id);
                return;
            }
            this._sendExitAnimations(session);
        }, ExitMarker.REFRESH_INTERVAL_MS);
        this.refreshTimers.set(session.id, { timer, session });
    }
    _stopRefreshTimer(sessionId) {
        const entry = this.refreshTimers.get(sessionId);
        if (entry) {
            clearInterval(entry.timer);
            this.refreshTimers.delete(sessionId);
        }
    }
    _restartAllTimers() {
        const sessions = [];
        for (const [, entry] of this.refreshTimers) {
            sessions.push(entry.session);
        }
        for (const session of sessions) {
            this._startRefreshTimer(session);
        }
    }
    // ─── Helpers ───────────────────────────────────────────────
    _getExitsForSession(session) {
        const mapNumber = session.playerState.mapNumber;
        const direct = this.exitsByMap.get(mapNumber);
        if (direct && direct.length > 0)
            return direct;
        const subs = this.proxy.config.mapSubstitutions;
        for (const [originalStr, replacement] of Object.entries(subs)) {
            if (replacement === mapNumber) {
                const original = parseInt(originalStr, 10);
                const exits = this.exitsByMap.get(original);
                if (exits && exits.length > 0)
                    return exits;
            }
        }
        return undefined;
    }
    _inRange(px, py, ex, ey) {
        return Math.abs(ex - px) < ExitMarker.VIEW_RANGE
            && Math.abs(ey - py) < ExitMarker.VIEW_RANGE;
    }
    // Get the tile one step in front of the player based on facing direction
    // Direction: 0=up(-y), 1=right(+x), 2=down(+y), 3=left(-x)
    _getTileInFront(session) {
        const player = this.registry.getPlayer(session.id);
        const dir = player ? player.direction : 0;
        const x = session.playerState.x + (dir === 1 ? 1 : dir === 3 ? -1 : 0);
        const y = session.playerState.y + (dir === 0 ? -1 : dir === 2 ? 1 : 0);
        return { x, y };
    }
    // ─── Slash Commands ───────────────────────────────────────
    registerCommands(commands, chat) {
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
                let mapId, x, y;
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
                if (this.addDoorAnimation(mapId, x, y)) {
                    chat.systemMessage(session, `Exit marker added at map ${mapId} (${x},${y}).`);
                } else {
                    chat.systemMessage(session, `Marker already exists at map ${mapId} (${x},${y}).`);
                }
                return;
            }
            if (sub === 'remove') {
                let mapId, x, y;
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
    }
}
exports.default = ExitMarker;
//# sourceMappingURL=exit-marker.js.map
