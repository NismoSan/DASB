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
const DATA_FILE = path.resolve(__dirname, '../../../data/custom-doors.json');
/**
 * Custom door system — NPC-based teleporters that send players to custom maps.
 * Each door is a Mundane NPC with an onInteract handler that executes the full
 * map transition packet sequence when the player confirms.
 */
class CustomDoors {
    proxy;
    npcs;
    chat;
    dialogs;
    doors = new Map();
    doorSerials = new Map(); // doorId -> NPC serial
    nextDoorId = 1;
    constructor(proxy, npcs, chat, dialogs) {
        this.proxy = proxy;
        this.npcs = npcs;
        this.chat = chat;
        this.dialogs = dialogs;
    }
    /**
     * Load door definitions from data/custom-doors.json and place all NPCs.
     */
    loadDoors() {
        try {
            const raw = fs.readFileSync(DATA_FILE, 'utf-8');
            const defs = JSON.parse(raw);
            for (const def of defs) {
                this.doors.set(def.id, def);
                this._placeDoorNPC(def);
                // Track highest ID for auto-increment
                const numId = parseInt(def.id.replace('door_', ''), 10);
                if (!isNaN(numId) && numId >= this.nextDoorId) {
                    this.nextDoorId = numId + 1;
                }
            }
            console.log(`[CustomDoors] Loaded ${defs.length} doors from ${DATA_FILE}`);
        }
        catch (e) {
            if (e.code === 'ENOENT') {
                console.log(`[CustomDoors] No custom-doors.json found, starting fresh`);
            }
            else {
                console.log(`[CustomDoors] Failed to load doors: ${e}`);
            }
        }
    }
    /**
     * Persist all door definitions to disk.
     */
    saveDoors() {
        try {
            const defs = Array.from(this.doors.values());
            fs.writeFileSync(DATA_FILE, JSON.stringify(defs, null, 2), 'utf-8');
            console.log(`[CustomDoors] Saved ${defs.length} doors`);
        }
        catch (e) {
            console.log(`[CustomDoors] Failed to save doors: ${e}`);
        }
    }
    /**
     * Create a new custom door at the given location.
     */
    createDoor(def) {
        const id = `door_${this.nextDoorId++}`;
        const door = { id, ...def };
        this.doors.set(id, door);
        this._placeDoorNPC(door);
        this.saveDoors();
        console.log(`[CustomDoors] Created door "${door.name}" (${id}) at map ${door.sourceMapId} (${door.sourceX},${door.sourceY}) -> map ${door.targetMapId} (${door.targetX},${door.targetY})`);
        return door;
    }
    /**
     * Remove a custom door by ID.
     */
    removeDoor(id) {
        const door = this.doors.get(id);
        if (!door)
            return false;
        const serial = this.doorSerials.get(id);
        if (serial !== undefined) {
            this.npcs.removeNPC(serial);
            this.doorSerials.delete(id);
        }
        this.doors.delete(id);
        this.saveDoors();
        console.log(`[CustomDoors] Removed door "${door.name}" (${id})`);
        return true;
    }
    /**
     * List all custom doors.
     */
    listDoors() {
        return Array.from(this.doors.values());
    }
    /**
     * Place the NPC for a door definition with an onInteract handler.
     */
    _placeDoorNPC(def) {
        const serial = this.npcs.placeNPC({
            name: def.name,
            sprite: def.sprite,
            x: def.sourceX,
            y: def.sourceY,
            mapNumber: def.sourceMapId,
            direction: def.direction ?? 2,
            creatureType: 2, // Mundane
        });
        const npc = this.npcs.getNPC(serial);
        npc.onInteract = (session, event) => {
            if (event.type === 'click') {
                // Show confirmation dialog
                this.dialogs.sendDialog(session, {
                    type: 0x02, // Menu
                    entityId: serial,
                    sprite: def.sprite,
                    name: def.name,
                    text: `Enter ${def.name}?`,
                    pursuitId: 1,
                    stepId: 0,
                    hasPrevious: false,
                    hasNext: false,
                    options: ['Enter', 'Cancel'],
                });
            }
            else if (event.type === 'menuChoice' && event.slot === 0) {
                // Player chose "Enter" — teleport them
                this._teleportPlayer(session, def, serial);
            }
            // slot === 1 (Cancel) or anything else — dialog closes automatically
        };
        this.doorSerials.set(def.id, serial);
    }
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
    _teleportPlayer(session, def, npcSerial) {
        // 1. Close dialog
        const closePkt = new packet_1.default(0x30);
        closePkt.writeByte(0x0A); // CloseDialog
        closePkt.writeByte(0x01); // EntityType = Creature
        closePkt.writeUInt32(npcSerial);
        closePkt.writeByte(0x00);
        this.proxy.sendToClient(session, closePkt);
        // Load the target map file
        const mapInfo = this.proxy.getMapFileInfo(def.targetMapId);
        if (!mapInfo) {
            this.chat.systemMessage(session, `Door error: map file for map ${def.targetMapId} not found.`);
            return;
        }
        // We need dimensions — compute from file size (6 bytes per tile)
        // If map-nodes.json has this map's dimensions, use those. Otherwise estimate.
        let width = mapInfo.width;
        let height = mapInfo.height;
        if (width === 0 || height === 0) {
            // Try to load from map-nodes.json
            const dims = this._getMapDimensions(def.targetMapId);
            if (dims) {
                width = dims.width;
                height = dims.height;
                // Cache back into mapInfo
                mapInfo.width = width;
                mapInfo.height = height;
            }
            else {
                // Estimate square map from file size
                const totalTiles = mapInfo.data.length / 6;
                const side = Math.floor(Math.sqrt(totalTiles));
                width = side;
                height = side;
                console.log(`[CustomDoors] WARNING: No dimensions for map ${def.targetMapId}, estimating ${width}x${height}`);
            }
        }
        // 2. Send 0x67 MapChanging
        const changingPkt = new packet_1.default(0x67);
        changingPkt.writeByte(0x00); // ChangeType
        changingPkt.writeUInt32(0); // Unknown
        this.proxy.sendToClient(session, changingPkt);
        // 3. Send 0x15 MapInfo with invalid checksum to force tile download
        const mapInfoPkt = new packet_1.default(0x15);
        mapInfoPkt.writeUInt16(def.targetMapId); // MapId
        mapInfoPkt.writeByte(width & 0xFF); // WidthLo
        mapInfoPkt.writeByte(height & 0xFF); // HeightLo
        mapInfoPkt.writeByte(0x00); // Flags (none)
        mapInfoPkt.writeByte((width >> 8) & 0xFF); // WidthHi
        mapInfoPkt.writeByte((height >> 8) & 0xFF); // HeightHi
        const invalidChecksum = mapInfo.checksum ^ 0xFFFF;
        mapInfoPkt.writeUInt16(invalidChecksum); // Checksum (invalid to force download)
        mapInfoPkt.writeString8(def.name); // Map name
        this.proxy.sendToClient(session, mapInfoPkt);
        // 4. Inject tile data (0x3C rows + 0x58 complete)
        this.proxy._injectMapTileData(session, mapInfo.data, width, height);
        // 5. Send 0x04 MapLocation (landing position)
        const locPkt = new packet_1.default(0x04);
        locPkt.writeUInt16(def.targetX);
        locPkt.writeUInt16(def.targetY);
        locPkt.writeUInt16(11); // UnknownX (observed value)
        locPkt.writeUInt16(11); // UnknownY (observed value)
        this.proxy.sendToClient(session, locPkt);
        // 6. Update session player state
        session.playerState.mapNumber = def.targetMapId;
        session.playerState.x = def.targetX;
        session.playerState.y = def.targetY;
        session.playerState.mapWidth = width;
        session.playerState.mapHeight = height;
        // 7. Emit events so NPCs, exit markers, etc. re-inject
        this.proxy.emit('player:mapChange', session);
        this.proxy.emit('player:refreshComplete', session);
        this.chat.systemMessage(session, `Teleported to ${def.name} (map ${def.targetMapId}).`);
        console.log(`[CustomDoors] ${session.characterName} teleported via "${def.name}" to map ${def.targetMapId} (${def.targetX},${def.targetY})`);
    }
    /**
     * Try to get map dimensions from map-nodes.json.
     */
    _mapNodes = null;
    _getMapDimensions(mapId) {
        if (!this._mapNodes) {
            try {
                const nodesPath = path.resolve(__dirname, '../../../data/map-nodes.json');
                this._mapNodes = JSON.parse(fs.readFileSync(nodesPath, 'utf-8'));
            }
            catch {
                this._mapNodes = [];
            }
        }
        const node = this._mapNodes.find(n => n.mapId === mapId);
        return node ? { width: node.width, height: node.height } : null;
    }
    /**
     * Register /door slash commands.
     */
    registerCommands(commands) {
        commands.register('door', async (session, args, raw) => {
            const subcommand = args[0]?.toLowerCase();
            if (!subcommand || subcommand === 'help') {
                this.chat.systemMessage(session, '/door create <name> <sprite> <targetMapId> <targetX> <targetY> - Create a door at your position');
                this.chat.systemMessage(session, '/door list - List all custom doors');
                this.chat.systemMessage(session, '/door remove <id> - Remove a custom door');
                return;
            }
            if (subcommand === 'create') {
                // /door create <name> <sprite> <targetMapId> <targetX> <targetY>
                if (args.length < 6) {
                    this.chat.systemMessage(session, 'Usage: /door create <name> <sprite> <targetMapId> <targetX> <targetY>');
                    return;
                }
                const name = args[1];
                const sprite = parseInt(args[2], 10);
                const targetMapId = parseInt(args[3], 10);
                const targetX = parseInt(args[4], 10);
                const targetY = parseInt(args[5], 10);
                if (isNaN(sprite) || isNaN(targetMapId) || isNaN(targetX) || isNaN(targetY)) {
                    this.chat.systemMessage(session, 'Error: sprite, targetMapId, targetX, targetY must be numbers.');
                    return;
                }
                const door = this.createDoor({
                    name,
                    sprite,
                    sourceMapId: session.playerState.mapNumber,
                    sourceX: session.playerState.x,
                    sourceY: session.playerState.y,
                    targetMapId,
                    targetX,
                    targetY,
                });
                this.chat.systemMessage(session, `Door "${door.name}" (${door.id}) created at your position.`);
                return;
            }
            if (subcommand === 'list') {
                const doors = this.listDoors();
                if (doors.length === 0) {
                    this.chat.systemMessage(session, 'No custom doors defined.');
                    return;
                }
                this.chat.systemMessage(session, `--- Custom Doors (${doors.length}) ---`);
                for (const d of doors) {
                    this.chat.systemMessage(session, `[${d.id}] "${d.name}" map ${d.sourceMapId} (${d.sourceX},${d.sourceY}) -> map ${d.targetMapId} (${d.targetX},${d.targetY})`);
                }
                return;
            }
            if (subcommand === 'remove') {
                const id = args[1];
                if (!id) {
                    this.chat.systemMessage(session, 'Usage: /door remove <id>');
                    return;
                }
                if (this.removeDoor(id)) {
                    this.chat.systemMessage(session, `Door "${id}" removed.`);
                }
                else {
                    this.chat.systemMessage(session, `Door "${id}" not found.`);
                }
                return;
            }
            this.chat.systemMessage(session, `Unknown subcommand: ${subcommand}. Use /door help.`);
        }, 'Manage custom teleport doors', '/door <create|list|remove|help>');
    }
}
exports.default = CustomDoors;
//# sourceMappingURL=custom-doors.js.map