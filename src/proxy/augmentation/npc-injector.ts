import Packet from '../../core/packet';
import { uint16 } from '../../core/datatypes';
import type ProxyServer from '../proxy-server';
import type ProxySession from '../proxy-session';
import type PlayerRegistry from '../player-registry';
import type { DialogConfig } from './dialog-handler';
import type ChatInjector from './chat-injector';

export type DialogEvent =
    | { type: 'click'; entityId: number }
    | { type: 'menuChoice'; entityId: number; slot: number; pursuitId: number }
    | { type: 'dialogChoice'; entityId: number; stepId: number; pursuitId: number }
    | { type: 'textInput'; entityId: number; text: string; pursuitId: number };

export type VirtualNpcWorldScope = 'live' | 'afk' | 'any';

export interface AmbientSpeechConfig {
    intervalSeconds: number;
    messages: string[];
}

export interface VirtualNPC {
    serial: number;
    name: string;
    sprite: number;
    x: number;
    y: number;
    mapNumber: number;
    direction: number;
    creatureType: number;
    worldScope: VirtualNpcWorldScope;
    /** Whether this NPC should be saved and restored across proxy restarts. */
    persistent: boolean;
    ambientSpeech?: AmbientSpeechConfig;
    dialog?: DialogConfig;
    /** Dynamic dialog handler — if set, bypasses static DialogConfig entirely */
    onInteract?: (session: ProxySession, event: DialogEvent) => void;
    /** If true, this NPC won't be re-sent during bulk broadcasts (mapChange/refresh/walkNear).
     *  Use sparingly — e.g. NPCs that must never appear on other clients. Companions use the normal broadcast path. */
    excludeFromBroadcast?: boolean;
}

export default class NpcInjector {
    private proxy: ProxyServer;
    private registry: PlayerRegistry;
    private chat: ChatInjector;
    private npcs: Map<number, VirtualNPC>;
    private ambientSpeechTimers: Map<number, { timer: ReturnType<typeof setInterval>; nextMessageIndex: number }>;
    /** Tracks which virtual entities are currently in each session's viewport */
    private visibleEntities: Map<string, Set<number>>; // sessionId -> Set<serial>
    /** Viewport radius — Arbiter uses 15 tiles */
    private static VIEW_RANGE = 15;

    constructor(proxy: ProxyServer, registry: PlayerRegistry, chat: ChatInjector) {
        this.proxy = proxy;
        this.registry = registry;
        this.chat = chat;
        this.npcs = new Map();
        this.ambientSpeechTimers = new Map();
        this.visibleEntities = new Map();
    }

    /**
     * Check if an NPC's map matches the player's current map, accounting for
     * map substitutions. An NPC on map A is visible if the player is on map A,
     * or if map A is substituted to map B and the player is on map B.
     */
    private _isOnSameMap(session: ProxySession, npcMapNumber: number): boolean {
        const playerMap = this._getSessionView(session).mapNumber;
        if (npcMapNumber === playerMap)
            return true;
        // Check if npcMapNumber is substituted → playerMap
        const subs = this.proxy.config.mapSubstitutions;
        return subs[npcMapNumber] === playerMap;
    }

    private _getSessionView(session: ProxySession): { mapNumber: number; x: number; y: number } {
        if (session.afkState?.active) {
            return {
                mapNumber: session.afkState.afkMapNumber,
                x: session.afkState.shadowX,
                y: session.afkState.shadowY,
            };
        }
        return {
            mapNumber: session.playerState.mapNumber,
            x: session.playerState.x,
            y: session.playerState.y,
        };
    }

    private _sessionCanSeeNpc(session: ProxySession, npc: VirtualNPC): boolean {
        if (npc.worldScope === 'afk' && !session.afkState?.active)
            return false;
        if (npc.worldScope === 'live' && session.afkState?.active)
            return false;
        return this._isOnSameMap(session, npc.mapNumber);
    }

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
        worldScope?: VirtualNpcWorldScope;
        persistent?: boolean;
        ambientSpeech?: AmbientSpeechConfig;
    }): number {
        const serial = this.registry.allocateVirtualSerial();
        const npc: VirtualNPC = {
            serial,
            name: opts.name,
            sprite: opts.sprite,
            x: opts.x,
            y: opts.y,
            mapNumber: opts.mapNumber,
            direction: opts.direction ?? 2,
            creatureType: opts.creatureType ?? 2, // Mundane by default
            worldScope: opts.worldScope ?? 'live',
            persistent: opts.persistent ?? true,
            ambientSpeech: this._normalizeAmbientSpeech(opts.ambientSpeech),
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
                const view = this._getSessionView(session);
                if (this._sessionCanSeeNpc(session, npc)
                    && this._inRange(view.x, view.y, npc)) {
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
        this._restartAmbientSpeech(npc);
        return serial;
    }

    /**
     * Remove a virtual NPC from all clients.
     */
    removeNPC(serial: number): void {
        const npc = this.npcs.get(serial);
        if (!npc)
            return;
        this._stopAmbientSpeech(serial);
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
    moveNPC(serial: number, x: number, y: number): void {
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
     * Change a virtual NPC's sprite. Removes and re-adds the entity on all
     * clients so the new graphic takes effect immediately.
     */
    changeSpriteNPC(serial: number, newSprite: number): void {
        const npc = this.npcs.get(serial);
        if (!npc)
            return;
        npc.sprite = newSprite;
        this.registry.updateVirtualEntitySprite(serial, newSprite);
        for (const session of this.proxy.sessions.values()) {
            if (session.phase === 'game' && !session.destroyed) {
                const visible = this.visibleEntities.get(session.id);
                if (visible && visible.has(serial)) {
                    this._sendRemoveEntity(session, serial);
                    this._sendAddEntity(session, npc);
                }
            }
        }
    }

    /**
     * When a player enters a map, send them all NPCs within viewport.
     * Mirrors the real server: fresh viewport, send AddEntity for nearby NPCs.
     */
    onPlayerMapChange(session: ProxySession): void {
        const { mapNumber, x: px, y: py } = this._getSessionView(session);
        // Clear visibility — everything needs to be resent on the new map
        const visible = new Set<number>();
        this.visibleEntities.set(session.id, visible);
        console.log(`[NPC] onPlayerMapChange [${session.characterName}]: map=${mapNumber} pos=(${px},${py}) totalNPCs=${this.npcs.size}`);
        let count = 0;
        for (const npc of this.npcs.values()) {
            if (npc.excludeFromBroadcast) {
                console.log(`[NPC]   skip "${npc.name}" (excludeFromBroadcast)`);
                continue;
            }
            if (!this._sessionCanSeeNpc(session, npc)) {
                console.log(`[NPC]   skip "${npc.name}" (scope=${npc.worldScope} npcMap=${npc.mapNumber} currentMap=${mapNumber})`);
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
    onPlayerRefresh(session: ProxySession): void {
        const { mapNumber, x: px, y: py } = this._getSessionView(session);
        if (mapNumber === 0)
            return;
        const visible = new Set<number>();
        this.visibleEntities.set(session.id, visible);
        for (const npc of this.npcs.values()) {
            if (npc.excludeFromBroadcast)
                continue;
            if (!this._sessionCanSeeNpc(session, npc))
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
    onPlayerTeleport(session: ProxySession): void {
        this.onPlayerRefresh(session);
    }

    /**
     * Update the dialog configuration for an existing NPC.
     */
    updateDialog(serial: number, dialog: DialogConfig | undefined): boolean {
        const npc = this.npcs.get(serial);
        if (!npc)
            return false;
        npc.dialog = dialog;
        return true;
    }

    updateAmbientSpeech(serial: number, ambientSpeech: AmbientSpeechConfig | undefined): boolean {
        const npc = this.npcs.get(serial);
        if (!npc)
            return false;
        npc.ambientSpeech = this._normalizeAmbientSpeech(ambientSpeech);
        this._restartAmbientSpeech(npc);
        return true;
    }

    /**
     * Clear visibility tracking for a session (on disconnect).
     */
    clearSession(sessionId: string): void {
        this.visibleEntities.delete(sessionId);
    }

    /**
     * Called on every player position update (walk steps + map location).
     * Mirrors the real DA server: send AddEntity for NPCs entering the viewport,
     * send RemoveEntity for NPCs leaving the viewport.
     */
    checkWalkNear(session: ProxySession): void {
        const { mapNumber, x: px, y: py } = this._getSessionView(session);
        if (mapNumber === 0)
            return;
        let visible = this.visibleEntities.get(session.id);
        if (!visible) {
            visible = new Set();
            this.visibleEntities.set(session.id, visible);
        }
        // Send AddEntity for NPCs that just entered viewport
        for (const npc of this.npcs.values()) {
            if (npc.excludeFromBroadcast)
                continue;
            if (!this._sessionCanSeeNpc(session, npc))
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
    private _inRange(px: number, py: number, npc: VirtualNPC): boolean {
        return Math.abs(npc.x - px) < NpcInjector.VIEW_RANGE
            && Math.abs(npc.y - py) < NpcInjector.VIEW_RANGE;
    }

    getAllNPCs(): VirtualNPC[] {
        return Array.from(this.npcs.values());
    }

    getNPC(serial: number): VirtualNPC | undefined {
        return this.npcs.get(serial);
    }

    getNPCByName(name: string): VirtualNPC | undefined {
        const lower = name.toLowerCase();
        for (const npc of this.npcs.values()) {
            if (npc.name.toLowerCase() === lower)
                return npc;
        }
        return undefined;
    }

    private _normalizeAmbientSpeech(ambientSpeech?: AmbientSpeechConfig): AmbientSpeechConfig | undefined {
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

    private _restartAmbientSpeech(npc: VirtualNPC): void {
        this._stopAmbientSpeech(npc.serial);
        if (!npc.ambientSpeech)
            return;
        const timer = setInterval(() => {
            this._emitAmbientSpeech(npc.serial);
        }, npc.ambientSpeech.intervalSeconds * 1000);
        this.ambientSpeechTimers.set(npc.serial, {
            timer,
            nextMessageIndex: 0,
        });
    }

    private _stopAmbientSpeech(serial: number): void {
        const state = this.ambientSpeechTimers.get(serial);
        if (!state)
            return;
        clearInterval(state.timer);
        this.ambientSpeechTimers.delete(serial);
    }

    private _emitAmbientSpeech(serial: number): void {
        const npc = this.npcs.get(serial);
        const state = this.ambientSpeechTimers.get(serial);
        if (!npc || !npc.ambientSpeech || !state) {
            this._stopAmbientSpeech(serial);
            return;
        }

        const recipients: ProxySession[] = [];
        for (const session of this.proxy.sessions.values()) {
            if (session.phase !== 'game' || session.destroyed)
                continue;
            if (!this._sessionCanSeeNpc(session, npc))
                continue;
            const view = this._getSessionView(session);
            if (!this._inRange(view.x, view.y, npc))
                continue;
            recipients.push(session);
        }

        if (recipients.length === 0)
            return;

        const messages = npc.ambientSpeech.messages;
        const message = messages[state.nextMessageIndex] || messages[0];
        for (const session of recipients) {
            this.chat.sendPublicChatFromEntity(session, {
                channel: 'say',
                entityId: npc.serial,
                message,
            });
        }
        state.nextMessageIndex = (state.nextMessageIndex + 1) % messages.length;
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
    private _sendAddEntity(session: ProxySession, npc: VirtualNPC): void {
        const pkt = new Packet(0x07);
        // Entity count
        pkt.writeUInt16(1);
        // Position
        pkt.writeUInt16(npc.x);
        pkt.writeUInt16(npc.y);
        // Entity ID
        pkt.writeUInt32(npc.serial);
        // Sprite with creature flag (0x4000)
        pkt.writeUInt16(uint16(npc.sprite | 0x4000));
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
    private _sendRemoveEntity(session: ProxySession, serial: number): void {
        const pkt = new Packet(0x0E);
        pkt.writeUInt32(serial);
        this.proxy.sendToClient(session, pkt);
    }

    /**
     * Send 0x0C EntityWalk.
     * Per protocol: [EntityId: UInt32] [OldX: UInt16] [OldY: UInt16] [Direction: Byte]
     */
    private _sendEntityWalk(session: ProxySession, serial: number, oldX: number, oldY: number, direction: number): void {
        const pkt = new Packet(0x0C);
        pkt.writeUInt32(serial);
        pkt.writeUInt16(oldX);
        pkt.writeUInt16(oldY);
        pkt.writeByte(direction);
        this.proxy.sendToClient(session, pkt);
    }
}
