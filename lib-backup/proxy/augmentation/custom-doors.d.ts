import type ProxyServer from '../proxy-server';
import type NpcInjector from './npc-injector';
import type ChatInjector from './chat-injector';
import type DialogHandler from './dialog-handler';
import type CommandRegistry from '../commands/command-registry';
export interface CustomDoorDef {
    id: string;
    name: string;
    sprite: number;
    sourceMapId: number;
    sourceX: number;
    sourceY: number;
    targetMapId: number;
    targetX: number;
    targetY: number;
    direction?: number;
}
/**
 * Custom door system — NPC-based teleporters that send players to custom maps.
 * Each door is a Mundane NPC with an onInteract handler that executes the full
 * map transition packet sequence when the player confirms.
 */
export default class CustomDoors {
    private proxy;
    private npcs;
    private chat;
    private dialogs;
    private doors;
    private doorSerials;
    private nextDoorId;
    constructor(proxy: ProxyServer, npcs: NpcInjector, chat: ChatInjector, dialogs: DialogHandler);
    /**
     * Load door definitions from data/custom-doors.json and place all NPCs.
     */
    loadDoors(): void;
    /**
     * Persist all door definitions to disk.
     */
    private saveDoors;
    /**
     * Create a new custom door at the given location.
     */
    createDoor(def: Omit<CustomDoorDef, 'id'>): CustomDoorDef;
    /**
     * Remove a custom door by ID.
     */
    removeDoor(id: string): boolean;
    /**
     * List all custom doors.
     */
    listDoors(): CustomDoorDef[];
    /**
     * Place the NPC for a door definition with an onInteract handler.
     */
    private _placeDoorNPC;
    /**
     * Execute the full map transition sequence to teleport a player.
     *
     * Sequence (confirmed by Chaos Server MapInstance.InnerAddEntity):
     * 1. Close dialog
     * 2. 0x67 MapChanging
     * 3. 0x15 MapInfo (with invalid checksum to force tile download)
     * 4. 0x3C tile rows + 0x58 MapTransferComplete (via _injectMapTileData)
     * 5. 0x04 MapLocation (landing position)
     * 6. Update session state + emit events
     */
    private _teleportPlayer;
    /**
     * Try to get map dimensions from map-nodes.json.
     */
    private _mapNodes;
    private _getMapDimensions;
    /**
     * Register /door slash commands.
     */
    registerCommands(commands: CommandRegistry): void;
}
