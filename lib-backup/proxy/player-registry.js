"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = __importDefault(require("events"));
class PlayerRegistry extends events_1.default {
    players; // sessionId -> player
    entities; // sessionId -> (serial -> entity)
    groundItems; // sessionId -> (serial -> ground item)
    virtualEntities; // global virtual entity registry (serial -> entity)
    _nextVirtualSerial;
    constructor() {
        super();
        this.players = new Map();
        this.entities = new Map();
        this.groundItems = new Map();
        this.virtualEntities = new Map();
        this._nextVirtualSerial = 0xF0000000; // high range to avoid collisions with real serials
    }
    registerSession(session) {
        const player = {
            sessionId: session.id,
            username: session.username,
            characterName: session.characterName,
            serial: session.playerState.serial,
            connectedAt: session.connectedAt,
            position: {
                x: session.playerState.x,
                y: session.playerState.y,
                mapNumber: session.playerState.mapNumber,
            },
            direction: session.playerState.direction,
            hp: session.playerState.hp,
            maxHp: session.playerState.maxHp,
            mp: session.playerState.mp,
            maxMp: session.playerState.maxMp,
            level: session.playerState.level,
            classId: session.playerState.classId,
            className: session.playerState.className,
            lastActivity: new Date(),
        };
        this.players.set(session.id, player);
        this.entities.set(session.id, new Map());
        this.groundItems.set(session.id, new Map());
        this.emit('player:join', player);
    }
    unregisterSession(sessionId) {
        const player = this.players.get(sessionId);
        if (player) {
            this.players.delete(sessionId);
            this.entities.delete(sessionId);
            this.groundItems.delete(sessionId);
            this.emit('player:leave', player);
        }
    }
    getPlayer(sessionId) {
        return this.players.get(sessionId);
    }
    getPlayerBySerial(serial) {
        for (const player of this.players.values()) {
            if (player.serial === serial)
                return player;
        }
        return undefined;
    }
    getAllPlayers() {
        return Array.from(this.players.values());
    }
    isVirtualEntity(serial) {
        return this.virtualEntities.has(serial);
    }
    allocateVirtualSerial() {
        return this._nextVirtualSerial++;
    }
    registerVirtualEntity(entity) {
        entity.isVirtual = true;
        this.virtualEntities.set(entity.serial, entity);
        this.emit('entity:virtual:add', entity);
    }
    removeVirtualEntity(serial) {
        const entity = this.virtualEntities.get(serial);
        if (entity) {
            this.virtualEntities.delete(serial);
            this.emit('entity:virtual:remove', entity);
        }
    }
    getVirtualEntitiesOnMap(mapNumber) {
        return Array.from(this.virtualEntities.values()).filter(e => true // virtual entities don't have map info stored yet; will be extended
        );
    }
    /**
     * Creates a middleware that updates the registry from packet data.
     */
    createMiddleware() {
        return (packet, direction, session) => {
            const player = this.players.get(session.id);
            if (!player)
                return null;
            const savedPos = packet.position;
            if (direction === 'server-to-client') {
                switch (packet.opcode) {
                    case 0x04: { // MapLocation
                        const x = packet.readUInt16();
                        const y = packet.readUInt16();
                        player.position.x = x;
                        player.position.y = y;
                        player.lastActivity = new Date();
                        this.emit('player:move', player);
                        break;
                    }
                    case 0x05: { // UserId
                        player.serial = packet.readUInt32();
                        break;
                    }
                    case 0x15: { // MapData
                        player.position.mapNumber = packet.readUInt16();
                        this.emit('player:mapChange', player);
                        break;
                    }
                    case 0x08: { // UpdateStats / Attributes
                        // This varies by sub-type - parse what we can
                        this._parseStats(packet, player);
                        break;
                    }
                    case 0x33: { // ShowUser - entity appeared
                        this._parseShowUser(packet, session.id);
                        break;
                    }
                    case 0x0C: { // EntityWalk
                        this._parseEntityWalk(packet, session.id);
                        break;
                    }
                    case 0x0E: { // RemoveEntity
                        const serial = packet.readUInt32();
                        const entityMap = this.entities.get(session.id);
                        if (entityMap)
                            entityMap.delete(serial);
                        const itemMap = this.groundItems.get(session.id);
                        if (itemMap)
                            itemMap.delete(serial);
                        break;
                    }
                }
            }
            else {
                // client-to-server
                switch (packet.opcode) {
                    case 0x06: { // Walk
                        const dir = packet.readByte();
                        player.direction = dir;
                        player.lastActivity = new Date();
                        break;
                    }
                }
            }
            packet.position = savedPos;
            return null; // always pass through
        };
    }
    _parseStats(packet, player) {
        // 0x08 has multiple sub-formats. Try to parse the common one.
        try {
            const subType = packet.readByte();
            if (subType === 1) {
                // Full stat block
                // Skip to HP/MP fields - exact offsets depend on protocol version
                // This is a best-effort parse
            }
        }
        catch {
            // ignore parse errors
        }
    }
    _parseShowUser(packet, sessionId) {
        try {
            const x = packet.readUInt16();
            const y = packet.readUInt16();
            const dir = packet.readByte();
            const serial = packet.readUInt32();
            const entityMap = this.entities.get(sessionId);
            if (entityMap) {
                const existing = entityMap.get(serial);
                entityMap.set(serial, {
                    serial, x, y,
                    name: existing?.name ?? '', sprite: 0, direction: dir,
                    isVirtual: false,
                    entityType: 'player',
                    image: 0,
                    hpPercent: existing?.hpPercent ?? 100,
                    creationTime: existing?.creationTime ?? Date.now(),
                });
            }
        }
        catch {
            // ShowUser format varies; ignore parse errors
        }
    }
    _parseEntityWalk(packet, sessionId) {
        try {
            const serial = packet.readUInt32();
            const oldX = packet.readUInt16();
            const oldY = packet.readUInt16();
            const dir = packet.readByte();
            const entityMap = this.entities.get(sessionId);
            const entity = entityMap?.get(serial);
            if (entity) {
                // Calculate new position from direction
                const dx = [0, 1, 0, -1]; // up, right, down, left
                const dy = [-1, 0, 1, 0];
                entity.x = oldX + (dx[dir] || 0);
                entity.y = oldY + (dy[dir] || 0);
                entity.direction = dir;
            }
        }
        catch {
            // ignore parse errors
        }
    }
    // ─── Helper Methods ──────────────────────────────────────
    /** Update HP% for an entity from 0x13 HpBar packet. */
    updateEntityHp(sessionId, serial, hpPercent) {
        const entityMap = this.entities.get(sessionId);
        const entity = entityMap?.get(serial);
        if (entity) {
            entity.hpPercent = hpPercent;
        }
    }
    /** Add or update a monster/NPC entity from 0x07 packet data. */
    addCreatureEntity(sessionId, serial, x, y, image, name, direction, entityType) {
        const entityMap = this.entities.get(sessionId);
        if (!entityMap)
            return;
        const existing = entityMap.get(serial);
        entityMap.set(serial, {
            serial, x, y, name,
            sprite: image, direction,
            isVirtual: false,
            entityType,
            image,
            hpPercent: existing?.hpPercent ?? 100,
            creationTime: existing?.creationTime ?? Date.now(),
        });
    }
    /** Add a ground item from 0x07 packet data. */
    addGroundItem(sessionId, serial, x, y, image, name) {
        const itemMap = this.groundItems.get(sessionId);
        if (!itemMap)
            return;
        itemMap.set(serial, { serial, x, y, image, name, droppedAt: Date.now() });
    }
    /** Get all monster entities for a session. */
    getMonsters(sessionId) {
        const entityMap = this.entities.get(sessionId);
        if (!entityMap)
            return [];
        return Array.from(entityMap.values()).filter(e => e.entityType === 'monster');
    }
    /** Get all ground items for a session. */
    getGroundItems(sessionId) {
        const itemMap = this.groundItems.get(sessionId);
        if (!itemMap)
            return [];
        return Array.from(itemMap.values());
    }
    /** Get a specific entity by serial for a session. */
    getEntity(sessionId, serial) {
        return this.entities.get(sessionId)?.get(serial);
    }
    /** Clear all entities for a session (on map change). */
    clearEntities(sessionId) {
        this.entities.get(sessionId)?.clear();
        this.groundItems.get(sessionId)?.clear();
    }
}
exports.default = PlayerRegistry;
//# sourceMappingURL=player-registry.js.map