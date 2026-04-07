import type ProxyServer from '../proxy-server';
import type ProxySession from '../proxy-session';
import type PlayerRegistry from '../player-registry';
import type { DialogConfig } from './dialog-handler';
export type DialogEvent = {
    type: 'click';
} | {
    type: 'menuChoice';
    slot: number;
    pursuitId: number;
} | {
    type: 'dialogChoice';
    stepId: number;
    pursuitId: number;
} | {
    type: 'textInput';
    text: string;
    pursuitId: number;
};
export interface VirtualNPC {
    serial: number;
    name: string;
    sprite: number;
    x: number;
    y: number;
    mapNumber: number;
    direction: number;
    creatureType: number;
    dialog?: DialogConfig;
    /** Dynamic dialog handler — if set, bypasses static DialogConfig entirely */
    onInteract?: (session: ProxySession, event: DialogEvent) => void;
    /** If true, this NPC won't be re-sent during bulk broadcasts (mapChange/refresh/walkNear).
     *  Used for companion NPCs that manage their own lifecycle. */
    excludeFromBroadcast?: boolean;
}
export default class NpcInjector {
    private proxy;
    private registry;
    private npcs;
    /** Tracks which virtual entities are currently in each session's viewport */
    private visibleEntities;
    /** Viewport radius — Arbiter uses 15 tiles */
    private static readonly VIEW_RANGE;
    constructor(proxy: ProxyServer, registry: PlayerRegistry);
    /**
     * Check if an NPC's map matches the player's current map, accounting for
     * map substitutions. An NPC on map A is visible if the player is on map A,
     * or if map A is substituted to map B and the player is on map B.
     */
    private _isOnSameMap;
    /**
     * Place a virtual NPC on a map. All players currently on that map will see it.
     * Uses 0x07 AddEntity with creature flag.
     * Returns the NPC serial.
     */
    placeNPC(opts: {
        name: string;
        sprite: number;
        x: number;
        y: number;
        mapNumber: number;
        direction?: number;
        creatureType?: number;
        dialog?: DialogConfig;
        excludeFromBroadcast?: boolean;
    }): number;
    /**
     * Remove a virtual NPC from all clients.
     */
    removeNPC(serial: number): void;
    /**
     * Move a virtual NPC.
     */
    moveNPC(serial: number, x: number, y: number): void;
    /**
     * When a player enters a map, send them all NPCs within viewport.
     * Mirrors the real server: fresh viewport, send AddEntity for nearby NPCs.
     */
    onPlayerMapChange(session: ProxySession): void;
    /**
     * When a player refreshes (0x38), resend all NPCs within viewport.
     */
    onPlayerRefresh(session: ProxySession): void;
    /**
     * When a player is teleported (0x04 MapLocation — charge/ambush/warp),
     * the client rebuilds its entity list from server data. Virtual NPCs must
     * be re-sent because the real server doesn't know about them.
     */
    onPlayerTeleport(session: ProxySession): void;
    /**
     * Update the dialog configuration for an existing NPC.
     */
    updateDialog(serial: number, dialog: DialogConfig | undefined): boolean;
    /**
     * Clear visibility tracking for a session (on disconnect).
     */
    clearSession(sessionId: string): void;
    /**
     * Called on every player position update (walk steps + map location).
     * Mirrors the real DA server: send AddEntity for NPCs entering the viewport,
     * send RemoveEntity for NPCs leaving the viewport.
     */
    checkWalkNear(session: ProxySession): void;
    /** Check if an NPC is within the player's viewport (15-tile radius per Arbiter). */
    private _inRange;
    getAllNPCs(): VirtualNPC[];
    getNPC(serial: number): VirtualNPC | undefined;
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
    private _sendAddEntity;
    /**
     * Send 0x0E RemoveEntity.
     * Per Arbiter: [EntityId: UInt32]
     */
    private _sendRemoveEntity;
    /**
     * Send 0x0C EntityWalk.
     * Per protocol: [EntityId: UInt32] [OldX: UInt16] [OldY: UInt16] [Direction: Byte]
     */
    private _sendEntityWalk;
}
