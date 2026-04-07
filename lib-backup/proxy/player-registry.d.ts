import EventEmitter from 'events';
import ProxySession from './proxy-session';
import type { PacketMiddleware } from './packet-inspector';
export interface ProxiedPlayer {
    sessionId: string;
    username: string;
    characterName: string;
    serial: number;
    connectedAt: Date;
    position: {
        x: number;
        y: number;
        mapNumber: number;
    };
    direction: number;
    hp: number;
    maxHp: number;
    mp: number;
    maxMp: number;
    level: number;
    classId: number;
    className: string;
    lastActivity: Date;
}
export type EntityType = 'player' | 'monster' | 'npc' | 'item' | 'unknown';
export interface EntityInfo {
    serial: number;
    x: number;
    y: number;
    name: string;
    sprite: number;
    direction: number;
    isVirtual: boolean;
    entityType: EntityType;
    image: number;
    hpPercent: number;
    creationTime: number;
}
/** A ground item tracked separately from monsters/players. */
export interface GroundItem {
    serial: number;
    x: number;
    y: number;
    image: number;
    name: string;
    droppedAt: number;
}
export default class PlayerRegistry extends EventEmitter {
    players: Map<string, ProxiedPlayer>;
    entities: Map<string, Map<number, EntityInfo>>;
    groundItems: Map<string, Map<number, GroundItem>>;
    virtualEntities: Map<number, EntityInfo>;
    private _nextVirtualSerial;
    constructor();
    registerSession(session: ProxySession): void;
    unregisterSession(sessionId: string): void;
    getPlayer(sessionId: string): ProxiedPlayer | undefined;
    getPlayerBySerial(serial: number): ProxiedPlayer | undefined;
    getAllPlayers(): ProxiedPlayer[];
    isVirtualEntity(serial: number): boolean;
    allocateVirtualSerial(): number;
    registerVirtualEntity(entity: EntityInfo): void;
    removeVirtualEntity(serial: number): void;
    getVirtualEntitiesOnMap(mapNumber: number): EntityInfo[];
    /**
     * Creates a middleware that updates the registry from packet data.
     */
    createMiddleware(): PacketMiddleware;
    private _parseStats;
    private _parseShowUser;
    private _parseEntityWalk;
    /** Update HP% for an entity from 0x13 HpBar packet. */
    updateEntityHp(sessionId: string, serial: number, hpPercent: number): void;
    /** Add or update a monster/NPC entity from 0x07 packet data. */
    addCreatureEntity(sessionId: string, serial: number, x: number, y: number, image: number, name: string, direction: number, entityType: EntityType): void;
    /** Add a ground item from 0x07 packet data. */
    addGroundItem(sessionId: string, serial: number, x: number, y: number, image: number, name: string): void;
    /** Get all monster entities for a session. */
    getMonsters(sessionId: string): EntityInfo[];
    /** Get all ground items for a session. */
    getGroundItems(sessionId: string): GroundItem[];
    /** Get a specific entity by serial for a session. */
    getEntity(sessionId: string, serial: number): EntityInfo | undefined;
    /** Clear all entities for a session (on map change). */
    clearEntities(sessionId: string): void;
}
