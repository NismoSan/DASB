"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const packet_1 = __importDefault(require("../../core/packet"));
const datatypes_1 = require("../../core/datatypes");
class NpcInjector {
    proxy;
    registry;
    npcs;
    /** Tracks which virtual entities are currently in each session's viewport */
    visibleEntities; // sessionId -> Set<serial>
    /** Viewport radius — Arbiter uses 15 tiles */
    static VIEW_RANGE = 15;
    constructor(proxy, registry) {
        this.proxy = proxy;
        this.registry = registry;
        this.npcs = new Map();
        this.visibleEntities = new Map();
    }
    /**
     * Check if an NPC's map matches the player's current map, accounting for
     * map substitutions. An NPC on map A is visible if the player is on map A,
     * or if map A is substituted to map B and the player is on map B.
     */
    _isOnSameMap(session, npcMapNumber) {
        const playerMap = session.playerState.mapNumber;
        if (npcMapNumber === playerMap)
            return true;
        // Check if npcMapNumber is substituted → playerMap
        const subs = this.proxy.config.mapSubstitutions;
        return subs[npcMapNumber] === playerMap;
    }
    /**
     * Place a virtual NPC on a map. All players currently on that map will see it.
     * Uses 0x07 AddEntity with creature flag.
     * Returns the NPC serial.
     */
    placeNPC(opts) {
        const serial = this.registry.allocateVirtualSerial();
        const npc = {
            serial,
            name: opts.name,
            sprite: opts.sprite,
            x: opts.x,
            y: opts.y,
            mapNumber: opts.mapNumber,
            direction: opts.direction ?? 2,
            creatureType: opts.creatureType ?? 2, // Mundane by default
            dialog: opts.dialog,
            excludeFromBroadcast: opts.excludeFromBroadcast,
        };
        this.npcs.set(serial, npc);
        this.registry.registerVirtualEntity({
            serial,
            x: npc.x,
            y: npc.y,
            name: npc.name,
            sprite: npc.sprite,
            direction: npc.direction,
            isVirtual: true,
            entityType: 'npc',
            image: npc.sprite,
            hpPercent: 100,
            creationTime: Date.now(),
        });
        // Send AddEntity to players who have this NPC in their viewport
        for (const session of this.proxy.sessions.values()) {
            if (session.phase === 'game' && !session.destroyed) {
                if (this._isOnSameMap(session, npc.mapNumber) &&
                    this._inRange(session.playerState.x, session.playerState.y, npc)) {
                    this._sendAddEntity(session, npc);
                    let visible = this.visibleEntities.get(session.id);
                    if (!visible) {
                        visible = new Set();
                        this.visibleEntities.set(session.id, visible);
                    }
                    visible.add(npc.serial);
                }
            }
        }
        console.log(`[NPC] Placed "${npc.name}" (serial=${serial}, sprite=${npc.sprite}) at map ${npc.mapNumber} (${npc.x},${npc.y})`);
        return serial;
    }
    /**
     * Remove a virtual NPC from all clients.
     */
    removeNPC(serial) {
        const npc = this.npcs.get(serial);
        if (!npc)
            return;
        this.npcs.delete(serial);
        this.registry.removeVirtualEntity(serial);
        // Send RemoveEntity to all active game sessions
        for (const session of this.proxy.sessions.values()) {
            if (session.phase === 'game' && !session.destroyed) {
                this._sendRemoveEntity(session, serial);
            }
        }
        console.log(`[NPC] Removed "${npc.name}" (serial=${serial})`);
    }
    /**
     * Move a virtual NPC.
     */
    moveNPC(serial, x, y) {
        const npc = this.npcs.get(serial);
        if (!npc)
            return;
        const oldX = npc.x;
        const oldY = npc.y;
        let dir = npc.direction;
        if (x > oldX)
            dir = 1;
        else if (x < oldX)
            dir = 3;
        else if (y > oldY)
            dir = 2;
        else if (y < oldY)
            dir = 0;
        npc.x = x;
        npc.y = y;
        npc.direction = dir;
        for (const session of this.proxy.sessions.values()) {
            if (session.phase === 'game' && !session.destroyed) {
                this._sendEntityWalk(session, serial, oldX, oldY, dir);
            }
        }
    }
    /**
     * When a player enters a map, send them all NPCs within viewport.
     * Mirrors the real server: fresh viewport, send AddEntity for nearby NPCs.
     */
    onPlayerMapChange(session) {
        const mapNumber = session.playerState.mapNumber;
        // Clear visibility — everything needs to be resent on the new map
        const visible = new Set();
        this.visibleEntities.set(session.id, visible);
        const px = session.playerState.x;
        const py = session.playerState.y;
        console.log(`[NPC] onPlayerMapChange [${session.characterName}]: map=${mapNumber} pos=(${px},${py}) totalNPCs=${this.npcs.size}`);
        let count = 0;
        for (const npc of this.npcs.values()) {
            if (npc.excludeFromBroadcast) {
                console.log(`[NPC]   skip "${npc.name}" (excludeFromBroadcast)`);
                continue;
            }
            const sameMap = this._isOnSameMap(session, npc.mapNumber);
            if (!sameMap) {
                console.log(`[NPC]   skip "${npc.name}" (npcMap=${npc.mapNumber} != playerMap=${mapNumber})`);
                continue;
            }
            const inRange = this._inRange(px, py, npc);
            console.log(`[NPC]   "${npc.name}" at (${npc.x},${npc.y}) map=${npc.mapNumber} inRange=${inRange} (player at ${px},${py})`);
            if (inRange) {
                this._sendAddEntity(session, npc);
                visible.add(npc.serial);
                count++;
            }
        }
        if (count > 0) {
            console.log(`[NPC] Sent ${count} NPCs to ${session.characterName} on map ${mapNumber}`);
        }
        else {
            console.log(`[NPC] No NPCs sent to ${session.characterName} on map ${mapNumber}`);
        }
    }
    /**
     * When a player refreshes (0x38), resend all NPCs within viewport.
     */
    onPlayerRefresh(session) {
        const mapNumber = session.playerState.mapNumber;
        if (mapNumber === 0)
            return;
        const visible = new Set();
        this.visibleEntities.set(session.id, visible);
        const px = session.playerState.x;
        const py = session.playerState.y;
        for (const npc of this.npcs.values()) {
            if (npc.excludeFromBroadcast)
                continue;
            if (!this._isOnSameMap(session, npc.mapNumber))
                continue;
            if (this._inRange(px, py, npc)) {
                this._sendAddEntity(session, npc);
                visible.add(npc.serial);
            }
        }
    }
    /**
     * When a player is teleported (0x04 MapLocation — charge/ambush/warp),
     * the client rebuilds its entity list from server data. Virtual NPCs must
     * be re-sent because the real server doesn't know about them.
     */
    onPlayerTeleport(session) {
        this.onPlayerRefresh(session);
    }
    /**
     * Update the dialog configuration for an existing NPC.
     */
    updateDialog(serial, dialog) {
        const npc = this.npcs.get(serial);
        if (!npc)
            return false;
        npc.dialog = dialog;
        return true;
    }
    /**
     * Clear visibility tracking for a session (on disconnect).
     */
    clearSession(sessionId) {
        this.visibleEntities.delete(sessionId);
    }
    /**
     * Called on every player position update (walk steps + map location).
     * Mirrors the real DA server: send AddEntity for NPCs entering the viewport,
     * send RemoveEntity for NPCs leaving the viewport.
     */
    checkWalkNear(session) {
        const mapNumber = session.playerState.mapNumber;
        if (mapNumber === 0)
            return;
        const px = session.playerState.x;
        const py = session.playerState.y;
        let visible = this.visibleEntities.get(session.id);
        if (!visible) {
            visible = new Set();
            this.visibleEntities.set(session.id, visible);
        }
        // Send AddEntity for NPCs that just entered viewport
        for (const npc of this.npcs.values()) {
            if (npc.excludeFromBroadcast)
                continue;
            if (!this._isOnSameMap(session, npc.mapNumber))
                continue;
            const inRange = this._inRange(px, py, npc);
            if (inRange && !visible.has(npc.serial)) {
                // Entering viewport — send AddEntity
                console.log(`[NPC] checkWalkNear: sending "${npc.name}" to ${session.characterName} (player=${px},${py} npc=${npc.x},${npc.y} map=${mapNumber})`);
                this._sendAddEntity(session, npc);
                visible.add(npc.serial);
            }
            else if (!inRange && visible.has(npc.serial)) {
                // Leaving viewport — send RemoveEntity
                this._sendRemoveEntity(session, npc.serial);
                visible.delete(npc.serial);
            }
        }
    }
    /** Check if an NPC is within the player's viewport (15-tile radius per Arbiter). */
    _inRange(px, py, npc) {
        return Math.abs(npc.x - px) < NpcInjector.VIEW_RANGE
            && Math.abs(npc.y - py) < NpcInjector.VIEW_RANGE;
    }
    getAllNPCs() {
        return Array.from(this.npcs.values());
    }
    getNPC(serial) {
        return this.npcs.get(serial);
    }
    /**
     * Build and send a 0x07 AddEntity packet for a virtual NPC.
     *
     * Per Arbiter: 0x07 AddEntity format:
     *   [EntityCount: UInt16]
     *   Per entity:
     *     [X: UInt16] [Y: UInt16] [Id: UInt32] [Sprite: UInt16 | 0x4000 creature flag]
     *     If creature (0x4000):
     *       [Unknown: UInt32 = 0] [Direction: Byte] [Skip: Byte = 0] [CreatureType: Byte]
     *       If Mundane (type 2): [Name: String8]
     */
    _sendAddEntity(session, npc) {
        const pkt = new packet_1.default(0x07);
        // Entity count
        pkt.writeUInt16(1);
        // Position
        pkt.writeUInt16(npc.x);
        pkt.writeUInt16(npc.y);
        // Entity ID
        pkt.writeUInt32(npc.serial);
        // Sprite with creature flag (0x4000)
        pkt.writeUInt16((0, datatypes_1.uint16)(npc.sprite | 0x4000));
        // Creature fields
        pkt.writeUInt32(0); // Unknown
        pkt.writeByte(npc.direction); // Direction
        pkt.writeByte(0); // Skip/padding
        pkt.writeByte(npc.creatureType); // CreatureType
        // Name (only for Mundane NPCs, type 2)
        if (npc.creatureType === 2) {
            pkt.writeString8(npc.name);
            pkt.writeByte(0); // Null terminator (matches real server packets)
        }
        this.proxy.sendToClient(session, pkt);
    }
    /**
     * Send 0x0E RemoveEntity.
     * Per Arbiter: [EntityId: UInt32]
     */
    _sendRemoveEntity(session, serial) {
        const pkt = new packet_1.default(0x0E);
        pkt.writeUInt32(serial);
        this.proxy.sendToClient(session, pkt);
    }
    /**
     * Send 0x0C EntityWalk.
     * Per protocol: [EntityId: UInt32] [OldX: UInt16] [OldY: UInt16] [Direction: Byte]
     */
    _sendEntityWalk(session, serial, oldX, oldY, direction) {
        const pkt = new packet_1.default(0x0C);
        pkt.writeUInt32(serial);
        pkt.writeUInt16(oldX);
        pkt.writeUInt16(oldY);
        pkt.writeByte(direction);
        this.proxy.sendToClient(session, pkt);
    }
}
exports.default = NpcInjector;
//# sourceMappingURL=npc-injector.js.map