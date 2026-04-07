import net from 'net';
import fs from 'fs';
import path from 'path';
import EventEmitter from 'events';
import ProxySession from './proxy-session';
import { isEncryptOpcode, isDecryptOpcode } from './proxy-crypto';
import Packet from '../core/packet';
import { uint8 } from '../core/datatypes';
import { calculateCRC16 } from '../core/crc';
import { getOpcodeLabel } from '../core/opcodes';
import type { PacketInspector, PacketDirection } from './packet-inspector';
import type PlayerRegistry from './player-registry';
import { getNpcPositionOverride } from './commands/index';

/** Server→client opcodes that require decrypt-peek for state tracking */
const TRACKED_OPCODES_SET = new Set([0x04, 0x05, 0x07, 0x08, 0x0B, 0x0C, 0x0E, 0x0F, 0x10, 0x13, 0x15, 0x17, 0x18, 0x29, 0x2C, 0x2D, 0x2E, 0x33, 0x37, 0x38, 0x3A, 0x3C]);
/** Opcodes to skip tracking during AFK mode to preserve real position */
const AFK_SKIP_TRACKING_SET = new Set([0x04, 0x0B, 0x07, 0x0C, 0x0E, 0x33]);

/**
 * Decrypt the inner dialog envelope on 0x39/0x3A packets.
 * After the outer crypto is removed by decryptClientPacket, dialog opcodes
 * still have a 6-byte header: [randHi] [randLo] [lenHi^y] [lenLo^(y+1)]
 * followed by (crc + payload) each XOR'd with (z + i).
 * Returns the raw payload bytes (EntityType, EntityId, PursuitId, Slot/StepId).
 */
function decryptDialogPayload(body: number[]): number[] | null {
    if (body.length < 6)
        return null;
    const xPrime = uint8(body[0] - 0x2D);
    const x = uint8(body[1] ^ xPrime);
    const y = uint8(x + 0x72);
    const z = uint8(x + 0x28);
    // Decrypt length bytes
    const lenHi = body[2] ^ y;
    const lenLo = body[3] ^ uint8((y + 1) & 0xFF);
    const dataLengthPlusTwo = (lenHi << 8) | lenLo;
    // Decrypt checksum + payload (starting at index 4)
    const decrypted: number[] = [];
    for (let i = 0; i < dataLengthPlusTwo && (4 + i) < body.length; i++) {
        decrypted.push(uint8(body[4 + i] ^ uint8((z + i) & 0xFF)));
    }
    // First 2 bytes are CRC, rest is actual payload
    if (decrypted.length < 2)
        return null;
    return decrypted.slice(2);
}

export interface ProxyServerConfig {
    listenPort: number;
    gamePort1: number;
    gamePort2: number;
    publicAddress: string;
    realServerAddress: string;
    realLoginPort: number;
    logPackets: boolean;
    /** Map substitutions: when the server sends map X, the client receives map Y instead.
     *  Key = original map number from server, Value = replacement map number.
     *  e.g. { 1234: 9999 } -> clients load map 9999 instead of 1234. */
    mapSubstitutions: Record<number, number>;
    /** Directory containing lod*.map files for checksum computation. */
    mapsDir: string;
    /** Name tag settings for proxy players. */
    nameTags: {
        enabled: boolean;
        /** nameDisplayStyle byte (0=NeutralHover, 1=Hostile, 2=FriendlyHover/persistent green, 3=Neutral). */
        nameStyle: number;
    };
    disguise: {
        enabled: boolean;
    };
}

/** Cached info about a replacement map file (checksum + dimensions + raw data). */
interface MapFileInfo {
    checksum: number;
    width: number;
    height: number;
    /** Raw map file bytes (little-endian, 6 bytes per tile: bg:u16LE, xfg:u16LE, yfg:u16LE). */
    data: Buffer;
}

const DEFAULT_CONFIG: ProxyServerConfig = {
    listenPort: 2610,
    gamePort1: 2611,
    gamePort2: 2612,
    publicAddress: '127.0.0.1',
    realServerAddress: process.env.DA_SERVER_ADDRESS || '127.0.0.1',
    realLoginPort: 2610,
    logPackets: false,
    mapSubstitutions: {},
    mapsDir: './src/features/navigator/maps',
    nameTags: {
        enabled: true,
        nameStyle: 3,
    },
    disguise: {
        enabled: true,
    },
};

export default class ProxyServer extends EventEmitter {
    config: ProxyServerConfig;
    servers: net.Server[];
    sessions: Map<string, ProxySession>;
    inspector: PacketInspector | null;
    registry: PlayerRegistry | null;
    getPlayerDisguise: ((name: string) => any) | null;
    getCustomLegendsForPlayer: ((name: string) => any[]) | null;
    issueCustomLegendToPlayer: ((name: string, reward: {
        rewardKey: string;
        icon: number;
        color: number;
        key: string;
        text: string;
    }) => boolean) | null;
    getPlayerNameTagStyle: ((name: string) => number | null | undefined) | null;
    setPlayerNameTagStyle: ((name: string, style: number | null | undefined) => boolean) | null;
    private _nextSessionId: number;
    private _mapFileCache: Map<number, MapFileInfo>;
    private _injectFailLogged: Set<string> = new Set();

    constructor(config?: Partial<ProxyServerConfig>) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
        // getPlayerDisguise is attached from panel.js (like getCustomLegendsForPlayer)
        this.getPlayerDisguise = null;
        this.getCustomLegendsForPlayer = null;
        this.issueCustomLegendToPlayer = null;
        this.getPlayerNameTagStyle = null;
        this.setPlayerNameTagStyle = null;
        this.servers = [];
        this.sessions = new Map();
        this.inspector = null;
        this.registry = null;
        this._nextSessionId = 1;
        this._mapFileCache = new Map();
    }

    /**
     * Load a map file and compute its CRC16 checksum + dimensions.
     * Results are cached so the file is only read once per map number.
     */
    getMapFileInfo(mapNumber: number): MapFileInfo | null {
        if (this._mapFileCache.has(mapNumber)) {
            return this._mapFileCache.get(mapNumber)!;
        }
        const filePath = path.join(this.config.mapsDir, `lod${mapNumber}.map`);
        try {
            const data = fs.readFileSync(filePath);
            const bytes = Array.from(data);
            const checksum = calculateCRC16(bytes);
            const info: MapFileInfo = { checksum, width: 0, height: 0, data };
            this._mapFileCache.set(mapNumber, info);
            console.log(`[Proxy] Loaded map file ${filePath}: checksum=0x${checksum.toString(16).padStart(4, '0')} (${data.length} bytes)`);
            return info;
        }
        catch (e) {
            console.log(`[Proxy] Failed to load map file ${filePath}: ${e}`);
            return null;
        }
    }

    /** Clear cached map file info (call after replacing a map file on disk).
     *  Also invalidates per-session injection records so the next 0x05 re-injects. */
    clearMapFileCache(mapNumber?: number): void {
        if (mapNumber !== undefined) {
            this._mapFileCache.delete(mapNumber);
            for (const session of this.sessions.values()) {
                if (session.lastInjectedMap === mapNumber) {
                    session.lastInjectedMap = null;
                    session.substitutedMapData = null;
                }
            }
        }
        else {
            this._mapFileCache.clear();
            for (const session of this.sessions.values()) {
                session.lastInjectedMap = null;
                session.substitutedMapData = null;
            }
        }
    }

    setInspector(inspector: PacketInspector): void {
        this.inspector = inspector;
    }

    start(): Promise<void> {
        // Listen on login port + both game ports so redirect reconnections land here
        const ports = [this.config.listenPort, this.config.gamePort1, this.config.gamePort2];
        // Deduplicate in case someone sets them the same
        const uniquePorts = [...new Set(ports)];
        const promises = uniquePorts.map(port => this._listenOnPort(port));
        return Promise.all(promises).then(() => {
            console.log(`[Proxy] Forwarding to ${this.config.realServerAddress}:${this.config.realLoginPort}`);
            console.log(`[Proxy] Redirect address: ${this.config.publicAddress}`);
        });
    }

    private _listenOnPort(port: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const server = net.createServer((clientSocket) => {
                this._handleClientConnection(clientSocket);
            });
            server.on('error', (err) => {
                console.error(`[Proxy] Server error on port ${port}: ${err.message}`);
                this.emit('error', err);
            });
            server.listen(port, '0.0.0.0', () => {
                console.log(`[Proxy] Listening on 0.0.0.0:${port}`);
                resolve();
            });
            server.once('error', reject);
            this.servers.push(server);
        });
    }

    stop(): void {
        for (const session of this.sessions.values()) {
            session.destroy();
        }
        this.sessions.clear();
        for (const server of this.servers) {
            server.close();
        }
        this.servers = [];
        console.log('[Proxy] Stopped.');
    }

    /**
     * Send a synthetic packet to a specific client session (server->client direction).
     * Used by augmentation engine to inject fake packets.
     */
    sendToClient(session: ProxySession, packet: Packet): void {
        if (session.destroyed || !session.clientSocket || session.clientSocket.destroyed) {
            if (!this._injectFailLogged.has(session.id)) {
                this._injectFailLogged.add(session.id);
                console.log(`[Proxy] INJECT FAILED -> Client [${session.id}] socket destroyed/missing, opcode=0x${packet.opcode.toString(16).padStart(2, '0')} (further failures for this session suppressed)`);
            }
            return;
        }
        packet.sequence = session.nextClientSeq();
        const preEncryptLen = packet.body.length;
        session.clientCrypto.encryptServerPacket(packet);
        const buf = packet.buffer();
        session.clientSocket.write(buf);
        const label = getOpcodeLabel('in', packet.opcode);
        console.log(`[Proxy] INJECT -> Client [${session.id}] 0x${packet.opcode.toString(16).padStart(2, '0')} (${label}) seq=${packet.sequence} pre=${preEncryptLen}b enc=${buf.length}b char=${session.characterName} cryptoName=${session.clientCrypto.name || 'NONE'}`);
    }

    /**
     * Send a synthetic packet to the real server on behalf of a session.
     */
    sendToServer(session: ProxySession, packet: Packet): void {
        if (session.destroyed || !session.serverSocket || session.serverSocket.destroyed)
            return;
        if (isEncryptOpcode(packet.opcode)) {
            packet.sequence = session.nextServerSeq();
            // Once we inject a server-bound packet, all future client packets
            // must be re-sequenced to maintain monotonic ordinals.
            session.resequenceServerBound = true;
        }
        session.serverCrypto.encrypt(packet);
        const buf = packet.buffer();
        session.serverSocket.write(buf);
        if (this.config.logPackets) {
            const label = getOpcodeLabel('out', packet.opcode);
            console.log(`[Proxy] INJECT -> Server [${session.id}] 0x${packet.opcode.toString(16).padStart(2, '0')} (${label}) ${buf.length}b`);
        }
    }

    /**
     * Inject replacement map tile data (0x3C rows) from a local .map file.
     * The .map file stores tiles in little-endian format (6 bytes per tile: bg:u16LE, xfg:u16LE, yfg:u16LE).
     * Network 0x3C packets use big-endian, so we byte-swap each u16 during injection.
     *
     * @param sendComplete - if true, also sends 0x58 MapTransferComplete after all rows.
     *   Used by custom-doors which run a fully synthetic map transition.
     *   For normal substitution (responding to client 0x05), pass false -- the real
     *   server's 0x58 will flow through naturally.
     */
    _injectMapTileData(session: ProxySession, mapData: Buffer, width: number, height: number, sendComplete = true): void {
        const bytesPerTile = 6;
        const expectedSize = width * height * bytesPerTile;
        if (mapData.length < expectedSize) {
            console.log(`[Proxy] MAP INJECT WARNING [${session.id}]: file ${mapData.length}b < expected ${expectedSize}b (${width}x${height})`);
        }
        console.log(`[Proxy] MAP INJECT [${session.id}]: sending ${height} rows of ${width} tiles (${width}x${height})`);
        for (let y = 0; y < height; y++) {
            const rowPacket = new Packet(0x3C);
            rowPacket.writeUInt16(y);
            const rowOffset = y * width * bytesPerTile;
            for (let x = 0; x < width; x++) {
                const tileOffset = rowOffset + x * bytesPerTile;
                if (tileOffset + 5 < mapData.length) {
                    const bg = mapData.readUInt16LE(tileOffset);
                    const xfg = mapData.readUInt16LE(tileOffset + 2);
                    const yfg = mapData.readUInt16LE(tileOffset + 4);
                    rowPacket.writeUInt16(bg);
                    rowPacket.writeUInt16(xfg);
                    rowPacket.writeUInt16(yfg);
                }
                else {
                    rowPacket.writeUInt16(0);
                    rowPacket.writeUInt16(0);
                    rowPacket.writeUInt16(0);
                }
            }
            this.sendToClient(session, rowPacket);
        }
        if (sendComplete) {
            const completePacket = new Packet(0x58);
            completePacket.writeByte(0x00);
            this.sendToClient(session, completePacket);
        }
        session.lastInjectedMap = session.playerState.mapNumber;
        console.log(`[Proxy] MAP INJECT COMPLETE [${session.id}]: ${height} rows sent for map ${session.lastInjectedMap}`);
    }

    // --- Private ----------------------------------------------------

    private _handleClientConnection(clientSocket: net.Socket): void {
        clientSocket.setNoDelay(true);
        const sessionId = `proxy-${this._nextSessionId++}`;
        const session = new ProxySession(sessionId, clientSocket);
        this.sessions.set(sessionId, session);
        const clientAddr = `${clientSocket.remoteAddress}:${clientSocket.remotePort}`;
        console.log(`[Proxy] New client connection: ${clientAddr} -> session ${sessionId}`);
        this.emit('session:new', session);
        // Check if this is a redirect reconnection
        const redirectSession = this._checkForRedirectReconnection(session);
        if (redirectSession) {
            this._handleRedirectReconnection(session, redirectSession);
            return; // _handleRedirectReconnection sets up its own data handlers
        }
        // Normal new connection - connect to real login server
        this._connectToRealServer(session, this.config.realServerAddress, this.config.realLoginPort);
        clientSocket.on('data', (data: Buffer) => {
            session.lastActivity = new Date();
            this._handleClientData(session, data);
        });
        clientSocket.on('close', () => {
            console.log(`[Proxy] Client disconnected: ${sessionId} (phase=${session.phase})`);
            // Don't destroy redirect sessions - the client will reconnect
            if (session.phase !== 'redirect') {
                this._destroySession(session);
            }
            else {
                console.log(`[Proxy] Keeping redirect session ${sessionId} alive for reconnection`);
                // Set a timeout to clean up if client never reconnects
                setTimeout(() => {
                    if (session.phase === 'redirect' && this.sessions.has(sessionId)) {
                        console.log(`[Proxy] Redirect session ${sessionId} timed out, cleaning up`);
                        this._destroySession(session);
                    }
                }, 15000);
            }
        });
        clientSocket.on('error', (err: Error) => {
            console.log(`[Proxy] Client socket error [${sessionId}]: ${err.message}`);
        });
    }

    private _connectToRealServer(session: ProxySession, address: string, port: number): void {
        const serverSocket = new net.Socket();
        serverSocket.setNoDelay(true);
        session.serverSocket = serverSocket;
        serverSocket.connect(port, address, () => {
            console.log(`[Proxy] Connected to real server ${address}:${port} for session ${session.id}`);
        });
        serverSocket.on('data', (data: Buffer) => {
            this._handleServerData(session, data);
        });
        serverSocket.on('close', () => {
            console.log(`[Proxy] Real server disconnected for session ${session.id}`);
            if (!session.destroyed && session.phase !== 'redirect') {
                this._destroySession(session);
            }
        });
        serverSocket.on('error', (err: Error) => {
            console.log(`[Proxy] Server socket error [${session.id}]: ${err.message}`);
        });
    }

    /**
     * Handle raw data from the game CLIENT. Parse packets, decrypt, inspect, re-encrypt, forward to real server.
     * During login phase, forward raw bytes (both sides have same crypto params).
     * During game phase, decrypt/inspect/re-encrypt.
     */
    private _handleClientData(session: ProxySession, data: Buffer): void {
        // During login and game phase, forward raw bytes.
        // Both sides share the same encryption params so passthrough works.
        // We only need to decrypt when we want to inspect/modify (future feature).
        this._handleClientDataPassthrough(session, data);
        return;
        // TODO: Full decrypt/inspect/re-encrypt mode for when we need to modify game packets
    }

    /**
     * During login phase, forward raw client bytes to real server.
     * Peek at unencrypted opcodes (0x00, 0x62) for logging only.
     *
     * For virtual entity interception: certain opcodes (0x43, 0x39, 0x3A)
     * are decrypted on a copy to check if they target a virtual entity.
     * If virtual -> block (don't forward) + emit event.
     * If real -> forward raw as normal.
     */
    private _handleClientDataPassthrough(session: ProxySession, data: Buffer): void {
        // Parse packets to check for interception BEFORE forwarding
        let offset = 0;
        const buf = data;
        const blockedRanges: { start: number; end: number }[] = [];
        const blockedOffsets = new Set<number>();
        while (offset + 3 < buf.length && buf[offset] === 0xAA) {
            const length = (buf[offset + 1] << 8 | buf[offset + 2]) + 3;
            const opcode = buf[offset + 3];
            if (this.config.logPackets) {
                const label = getOpcodeLabel('out', opcode);
                console.log(`[Proxy] Client -> Server [${session.id}] 0x${opcode.toString(16).padStart(2, '0')} (${label}) [passthrough]`);
            }
            // Notify inspector for panel packet logging
            if (this.inspector && this.inspector.onPacket) {
                const pkt = new Packet(opcode);
                if (this.inspector.captureBody) {
                    if (session.clientCrypto.name && isEncryptOpcode(opcode)) {
                        try {
                            const capPacket = new Packet(Array.from(buf.slice(offset, offset + length)));
                            session.clientCrypto.decryptClientPacket(capPacket);
                            pkt.body = capPacket.body;
                        }
                        catch (_e) {
                            pkt.body = Array.from(buf.slice(offset + 4, offset + length));
                        }
                    }
                    else {
                        pkt.body = Array.from(buf.slice(offset + 4, offset + length));
                    }
                }
                this.inspector.onPacket(pkt, 'client-to-server', session);
            }
            // Detect refresh (0x38) - flag session so we inject NPCs after server finishes
            if (opcode === 0x38) {
                if (session.afkState?.active) {
                    // In AFK mode: block refresh from reaching the real server and
                    // re-send the shadow map/entities instead.
                    blockedRanges.push({ start: offset, end: offset + length }); blockedOffsets.add(offset);
                    this.emit('afk:refresh', session);
                } else {
                    session.refreshPending = true;
                    if (session.refreshFallbackTimer) {
                        clearTimeout(session.refreshFallbackTimer);
                    }
                    // Fallback: if 0x58 MapTransferComplete never arrives, inject after 2s
                    session.refreshFallbackTimer = setTimeout(() => {
                        if (!session.destroyed && session.refreshPending) {
                            session.refreshPending = false;
                            session.refreshFallbackTimer = null;
                            this.emit('player:refreshComplete', session);
                        }
                    }, 2000);
                    this.emit('player:refresh', session);
                }
            }
            // Intercept client 0x05 (RequestMapData) for substituted maps.
            // The client sends this when it has a cache miss for the MapId+Checksum
            // we sent in 0x15. We let the 0x05 through to the real server (so it
            // doesn't time out), but inject our custom tiles to the client immediately
            // and block the real server's 0x3C response (handled in server->client path).
            if (opcode === 0x05 && session.substitutedMapData) {
                // Cancel the cache-hit fallback timer — client had a cache miss
                if (session.substitutedMapFallbackTimer) {
                    clearTimeout(session.substitutedMapFallbackTimer);
                    session.substitutedMapFallbackTimer = null;
                }
                const { data, width, height } = session.substitutedMapData;
                console.log(`[Proxy] INTERCEPT 0x05 RequestMapData [${session.id}]: injecting substituted tiles (${width}x${height}), forwarding 0x05 to server`);
                this._injectMapTileData(session, data, width, height, false);
                session.substitutedMapData = null;
                // Fire deferred refreshComplete now that tiles are in place
                this.emit('player:refreshComplete', session);
            }
            // Intercept 0x11 (Turn) - track facing direction for companion dodge
            if (opcode === 0x11 && session.clientCrypto.name && length > 4) {
                try {
                    const rawPacket = buf.slice(offset, offset + length);
                    const peekPacket = new Packet(Array.from(rawPacket));
                    session.clientCrypto.decryptClientPacket(peekPacket);
                    if (peekPacket.body.length >= 1) {
                        const turnDir = peekPacket.body[0];
                        session.playerState.direction = turnDir;
                        this.emit('player:turn', session);
                    }
                }
                catch (_e) { /* ignore decrypt failures */ }
            }
            // Intercept 0x43 (Interact) - client clicks on entity
            // Decrypt a copy to read the target entity ID
            if (opcode === 0x43 && session.clientCrypto.name && length > 4) {
                try {
                    const rawPacket = buf.slice(offset, offset + length);
                    const peekPacket = new Packet(Array.from(rawPacket));
                    session.clientCrypto.decryptClientPacket(peekPacket);
                    // After decrypt: body[0] = InteractionType (1=Entity), body[1..4] = TargetId
                    if (peekPacket.body.length >= 5 && peekPacket.body[0] === 1) {
                        const targetId = ((peekPacket.body[1] << 24) | (peekPacket.body[2] << 16) | (peekPacket.body[3] << 8) | peekPacket.body[4]) >>> 0;
                        if (targetId >= 0xF0000000) {
                            // Virtual entity click - BLOCK from reaching real server
                            console.log(`[Proxy] BLOCKED 0x43 Interact -> virtual entity 0x${targetId.toString(16)} from ${session.characterName}`);
                            blockedRanges.push({ start: offset, end: offset + length }); blockedOffsets.add(offset);
                            this.emit('virtual:interact', session, targetId);
                        }
                    }
                }
                catch (e) {
                    console.log(`[Proxy] 0x43 decrypt FAILED: ${e}`);
                }
            }
            // Intercept 0x39 (DialogMenuChoice) - client picks dialog option
            // 0x39 is a dialog opcode with an inner dialog envelope after outer crypto removal.
            // Per DARKAGES-PROTOCOL.md: [EntityType:1] [EntityId:4] [PursuitId:2] [Slot:1]
            if (opcode === 0x39 && session.clientCrypto.name && length > 4) {
                try {
                    const rawPacket = buf.slice(offset, offset + length);
                    const peekPacket = new Packet(Array.from(rawPacket));
                    session.clientCrypto.decryptClientPacket(peekPacket);
                    const dialogBody = decryptDialogPayload(peekPacket.body);
                    if (dialogBody && dialogBody.length >= 7) {
                        const entityId = ((dialogBody[1] << 24) | (dialogBody[2] << 16) | (dialogBody[3] << 8) | dialogBody[4]) >>> 0;
                        if (entityId >= 0xF0000000) {
                            const pursuitId = (dialogBody[5] << 8) | dialogBody[6];
                            blockedRanges.push({ start: offset, end: offset + length }); blockedOffsets.add(offset);
                            // Read String8 at position [7] -- present for both ItemChoices and TextInput responses
                            let argText = '';
                            if (dialogBody.length > 7) {
                                const strLen = dialogBody[7];
                                if (strLen > 0 && dialogBody.length >= 8 + strLen) {
                                    argText = Buffer.from(dialogBody.slice(8, 8 + strLen)).toString('utf8');
                                }
                            }
                            if (argText) {
                                // Has text argument -- could be item name (ItemChoices) or typed text (TextInput)
                                console.log(`[Proxy] BLOCKED 0x39 TextInput -> virtual 0x${entityId.toString(16)} pursuit=${pursuitId} text="${argText}"`);
                                this.emit('virtual:textInput', session, entityId, pursuitId, argText);
                            }
                            else {
                                // No text -- plain menu choice, slot is at position [7]
                                const slot = dialogBody.length > 7 ? dialogBody[7] : 0;
                                console.log(`[Proxy] BLOCKED 0x39 MenuChoice -> virtual 0x${entityId.toString(16)} pursuit=${pursuitId} slot=${slot}`);
                                this.emit('virtual:menuChoice', session, entityId, pursuitId, slot);
                            }
                        }
                    }
                }
                catch (e) {
                    // Decrypt failed - forward as normal
                }
            }
            // Intercept 0x3A (DialogChoice) - client responds to dialog/menu
            // 0x3A is a dialog opcode with an inner dialog envelope after outer crypto removal.
            // Per DARKAGES-PROTOCOL.md: [EntityType:1] [EntityId:4] [PursuitId:2] [StepId:2] [ArgsType:1] [MenuChoice:1?]
            // ArgsType: 0=None (next/prev), 1=MenuChoice, 2=TextInput
            if (opcode === 0x3A && session.clientCrypto.name && length > 4) {
                try {
                    const rawPacket = buf.slice(offset, offset + length);
                    const peekPacket = new Packet(Array.from(rawPacket));
                    session.clientCrypto.decryptClientPacket(peekPacket);
                    const dialogBody = decryptDialogPayload(peekPacket.body);
                    if (dialogBody && dialogBody.length >= 9) {
                        const entityId = ((dialogBody[1] << 24) | (dialogBody[2] << 16) | (dialogBody[3] << 8) | dialogBody[4]) >>> 0;
                        if (entityId >= 0xF0000000) {
                            const pursuitId = (dialogBody[5] << 8) | dialogBody[6];
                            const stepId = (dialogBody[7] << 8) | dialogBody[8];
                            const argsType = dialogBody.length > 9 ? dialogBody[9] : 0;
                            blockedRanges.push({ start: offset, end: offset + length }); blockedOffsets.add(offset);
                            if (argsType === 1 && dialogBody.length > 10) {
                                // Menu choice -- slot is at position [10], 1-based from client
                                const rawSlot = dialogBody[10];
                                const slot = rawSlot > 0 ? rawSlot - 1 : 0;
                                console.log(`[Proxy] BLOCKED 0x3A MenuChoice -> virtual 0x${entityId.toString(16)} pursuit=${pursuitId} step=${stepId} rawSlot=${rawSlot} slot=${slot}`);
                                this.emit('virtual:menuChoice', session, entityId, pursuitId, slot);
                            }
                            else if (argsType === 2 && dialogBody.length > 10) {
                                // Text input -- read String8 at position [10]
                                const textLen = dialogBody[10];
                                let text = '';
                                if (textLen > 0 && dialogBody.length > 11 + textLen - 1) {
                                    text = Buffer.from(dialogBody.slice(11, 11 + textLen)).toString('utf8');
                                }
                                console.log(`[Proxy] BLOCKED 0x3A TextInput -> virtual 0x${entityId.toString(16)} pursuit=${pursuitId} text="${text}"`);
                                this.emit('virtual:textInput', session, entityId, pursuitId, text);
                            }
                            else {
                                // Next/prev or no args -- treat as dialog navigation
                                console.log(`[Proxy] BLOCKED 0x3A DialogChoice -> virtual 0x${entityId.toString(16)} pursuit=${pursuitId} step=${stepId} argsType=${argsType}`);
                                this.emit('virtual:dialogChoice', session, entityId, pursuitId, stepId);
                            }
                        }
                    }
                }
                catch (e) {
                    // Decrypt failed - forward as normal
                }
            }
            // Intercept 0x0E (Chat) - check for slash commands
            // 0x0E is hash-key encrypted. After decrypt: body[0]=MessageType, body[1..]=String8(message)
            if (opcode === 0x0E && session.clientCrypto.name && length > 4) {
                try {
                    const rawPacket = buf.slice(offset, offset + length);
                    const peekPacket = new Packet(Array.from(rawPacket));
                    session.clientCrypto.decryptClientPacket(peekPacket);
                    if (peekPacket.body.length >= 2) {
                        const messageType = peekPacket.body[0];
                        // Only intercept Say messages (type 0) starting with '/'
                        if (messageType === 0) {
                            peekPacket.position = 1;
                            const message = peekPacket.readString8();
                            if (message.startsWith('/')) {
                                console.log(`[Proxy] BLOCKED 0x0E Chat -> slash command "${message}" from ${session.characterName}`);
                                blockedRanges.push({ start: offset, end: offset + length }); blockedOffsets.add(offset);
                                this.emit('player:command', session, message);
                            }
                        }
                    }
                }
                catch (e) {
                    // Decrypt failed - forward as normal
                }
            }
            // Intercept 0x3B (BoardAction) - detect parcels sent to bot for auction house
            // AND intercept virtual board actions (boardId >= 0xFF00)
            if (opcode === 0x3B && session.clientCrypto.name && length > 4) {
                try {
                    const rawPacket = buf.slice(offset, offset + length);
                    const peekPacket = new Packet(Array.from(rawPacket));
                    session.clientCrypto.decryptClientPacket(peekPacket);
                    // 0x3B BoardAction: [Action:u8] ...
                    if (peekPacket.body.length >= 1) {
                        peekPacket.position = 0;
                        const action = peekPacket.readByte();
                        if ((action === 1 || action === 2) && peekPacket.remainder() >= 2) {
                            // Action 1 = ViewBoard: [BoardId:u16] [StartPostId:i16] [Unknown:1]
                            // Action 2 = ViewPost:  [BoardId:u16] [PostId:i16] [Navigation:i8]
                            const boardId = peekPacket.readUInt16();
                            if (boardId >= 0xFF00) {
                                // Virtual board -- block from reaching real server
                                blockedRanges.push({ start: offset, end: offset + length }); blockedOffsets.add(offset);
                                if (action === 1) {
                                    const startPostId = peekPacket.remainder() >= 2 ? peekPacket.readInt16() : 0;
                                    console.log(`[Proxy] BLOCKED 0x3B ViewBoard -> virtual board 0x${boardId.toString(16)} startPostId=${startPostId} from ${session.characterName}`);
                                    this.emit('virtual:viewBoard', session, boardId, startPostId);
                                }
                                else {
                                    const postId = peekPacket.remainder() >= 2 ? peekPacket.readInt16() : 0;
                                    const navigation = peekPacket.remainder() >= 1 ? (peekPacket.readByte() << 24 >> 24) : 0;
                                    console.log(`[Proxy] BLOCKED 0x3B ViewPost -> virtual board 0x${boardId.toString(16)} postId=${postId} nav=${navigation} from ${session.characterName}`);
                                    this.emit('virtual:viewPost', session, boardId, postId, navigation);
                                }
                            }
                        }
                        else if (action === 6 && peekPacket.remainder() >= 3) {
                            // Action 6 = SendMail (MessageBoardAction.SendMail = 6): [BoardId:u16] [Recipient:String8] [Subject:String8] [Body:String16]
                            const boardId = peekPacket.readUInt16();
                            const recipient = peekPacket.readString8();
                            const subject = peekPacket.readString8();
                            this.emit('player:sendMail', session, recipient, subject, boardId);
                        }
                    }
                }
                catch (e) {
                    // Decrypt failed - forward as normal
                }
            }
            // AFK Shadow Mode: block action packets from reaching the real server
            if (session.afkState?.active) {
                const isAlreadyBlocked = blockedRanges.some(r => r.start === offset);
                if (!isAlreadyBlocked) {
                    // Block RequestMapData (0x05) — we already inject our own tiles;
                    // letting this reach the real server causes stray 0x3C/0x58 responses.
                    if (opcode === 0x05) {
                        blockedRanges.push({ start: offset, end: offset + length }); blockedOffsets.add(offset);
                    }
                    // Block movement, action, spell, skill, pickup, useItem, raiseStat, dropGold opcodes
                    // 0x06=Walk, 0x11=Turn, 0x13=Attack, 0x0F=CastSpell, 0x1C=UseItem,
                    // 0x24=DropItem, 0x29=Throw, 0x4D=BeginChant, 0x4E=Chant, 0x3E=UseSkill,
                    // 0x07=Pickup, 0x08=ItemDrop, 0x47=RaiseStat, 0x2E=WorldMapClick
                    if (opcode === 0x06 || opcode === 0x11 || opcode === 0x13 ||
                        opcode === 0x0F || opcode === 0x1C || opcode === 0x24 || opcode === 0x29 ||
                        opcode === 0x4D || opcode === 0x4E || opcode === 0x3E ||
                        opcode === 0x07 || opcode === 0x08 || opcode === 0x47 || opcode === 0x2E) {
                        blockedRanges.push({ start: offset, end: offset + length }); blockedOffsets.add(offset);
                        if (session.clientCrypto.name && length > 4) {
                            try {
                                const rawPacket = buf.slice(offset, offset + length);
                                const peekPacket = new Packet(Array.from(rawPacket));
                                session.clientCrypto.decryptClientPacket(peekPacket);
                                if (opcode === 0x06) {
                                    this.emit('afk:walk', session, peekPacket.body[0]);
                                }
                                else if (opcode === 0x11 && peekPacket.body.length >= 1) {
                                    this.emit('afk:turn', session, peekPacket.body[0]);
                                }
                                else if (opcode === 0x0F && peekPacket.body.length >= 1) {
                                    this.emit('afk:castSpell', session, peekPacket.body[0], [...peekPacket.body]);
                                }
                                else if (opcode === 0x3E && peekPacket.body.length >= 1) {
                                    this.emit('afk:useSkill', session, peekPacket.body[0]);
                                }
                                else if (opcode === 0x13) {
                                    this.emit('afk:assail', session);
                                }
                                else if (opcode === 0x07 && peekPacket.body.length >= 5) {
                                    peekPacket.position = 0;
                                    const _pickupSlot = peekPacket.readByte();
                                    const pickupX = peekPacket.readUInt16();
                                    const pickupY = peekPacket.readUInt16();
                                    this.emit('afk:pickup', session, pickupX, pickupY);
                                }
                                else if (opcode === 0x1C && peekPacket.body.length >= 1) {
                                    this.emit('afk:useItem', session, peekPacket.body[0]);
                                }
                                else if (opcode === 0x08 && peekPacket.body.length >= 1) {
                                    this.emit('afk:dropItem', session, peekPacket.body[0]);
                                }
                                else if (opcode === 0x24 && peekPacket.body.length >= 4) {
                                    peekPacket.position = 0;
                                    const amount = peekPacket.readUInt32();
                                    this.emit('afk:dropGold', session, amount);
                                }
                                else if (opcode === 0x47 && peekPacket.body.length >= 1) {
                                    this.emit('afk:raiseStat', session, peekPacket.body[0]);
                                }
                                else if (opcode === 0x2E && peekPacket.body.length >= 1) {
                                    this.emit('afk:worldMapClick', session, peekPacket.body[0]);
                                }
                            }
                            catch (e) {
                                // Decrypt failed
                            }
                        }
                    }
                    // When chatToServer is false, block chat from server and relay to proxy members
                    if (opcode === 0x0E && !session.afkState.chatToServer) {
                        // Decrypt to extract message for proxy relay
                        if (session.clientCrypto.name && length > 4) {
                            try {
                                const rawPacket = buf.slice(offset, offset + length);
                                const peekPacket = new Packet(Array.from(rawPacket));
                                session.clientCrypto.decryptClientPacket(peekPacket);
                                if (peekPacket.body.length >= 2) {
                                    const messageType = peekPacket.body[0];
                                    if (messageType === 0) { // Say
                                        peekPacket.position = 1;
                                        const message = peekPacket.readString8();
                                        if (!message.startsWith('/')) {
                                            this.emit('afk:chat', session, message);
                                        }
                                    }
                                }
                            }
                            catch (e) {
                                // Decrypt failed
                            }
                        }
                        blockedRanges.push({ start: offset, end: offset + length }); blockedOffsets.add(offset);
                    }
                }
            }
            // Track and re-sequence client->server encrypted packets.
            if (isEncryptOpcode(opcode) && length > 4) {
                const isBlocked = blockedOffsets.has(offset);
                if (isBlocked) {
                    // Blocked packets create an ordinal gap -- enable resequencing
                    // so the server sees continuous ordinals on subsequent packets.
                    if (!session.resequenceServerBound && session.serverCrypto.name) {
                        session.resequenceServerBound = true;
                    }
                }
                else if (!isBlocked) {
                    if (session.resequenceServerBound && session.serverCrypto.name) {
                        // Must re-encrypt with corrected ordinal to maintain server's sequence.
                        // Decrypt the client's packet, then re-encrypt with our next ordinal.
                        const rawSlice = buf.slice(offset, offset + length);
                        const rePacket = new Packet(Array.from(rawSlice));
                        session.serverCrypto.decryptClientPacket(rePacket);
                        rePacket.sequence = session.nextServerSeq();
                        session.serverCrypto.encrypt(rePacket);
                        // Block original, send re-encrypted version directly
                        blockedRanges.push({ start: offset, end: offset + length }); blockedOffsets.add(offset);
                        if (session.serverSocket && !session.serverSocket.destroyed) {
                            session.serverSocket.write(rePacket.buffer());
                        }
                    }
                    else {
                        // No injection yet -- forward raw, sync our counter from client's ordinal
                        session.serverEncryptSeq = uint8(buf[offset + 4] + 1);
                    }
                }
            }
            offset += length;
        }
        // Forward data to real server, excluding blocked packet ranges
        if (blockedRanges.length === 0) {
            // No blocked packets - forward everything raw
            if (session.serverSocket && !session.serverSocket.destroyed) {
                session.serverSocket.write(data);
            }
        }
        else {
            // Build a buffer excluding blocked ranges
            const chunks: Buffer[] = [];
            let pos = 0;
            blockedRanges.sort((a, b) => a.start - b.start);
            for (const range of blockedRanges) {
                if (pos < range.start) {
                    chunks.push(buf.slice(pos, range.start));
                }
                pos = range.end;
            }
            if (pos < buf.length) {
                chunks.push(buf.slice(pos));
            }
            if (chunks.length > 0 && session.serverSocket && !session.serverSocket.destroyed) {
                session.serverSocket.write(Buffer.concat(chunks));
            }
        }
    }

    /**
     * Handle raw data from the REAL SERVER. Parse packets, decrypt, inspect, re-encrypt, forward to client.
     * During login phase, forward raw bytes but intercept unencrypted protocol packets (0x00, 0x03, 0x7E).
     */
    private _handleServerData(session: ProxySession, data: Buffer): void {
        // Forward raw bytes and intercept unencrypted protocol packets.
        this._handleServerDataPassthrough(session, data);
        return;
        // TODO: Full decrypt/inspect/re-encrypt mode for when we need to modify game packets
    }

    /**
     * During login phase, forward raw server bytes to client.
     * Intercept unencrypted protocol packets: 0x00 (read crypto params), 0x03 (rewrite redirect).
     */
    private _handleServerDataPassthrough(session: ProxySession, data: Buffer): void {
        session.serverBuffer.push(data);
        let buffer = session.serverBuffer.length === 1
            ? session.serverBuffer.splice(0)[0]
            : Buffer.concat(session.serverBuffer.splice(0));
        while (buffer.length > 3 && buffer[0] === 0xAA) {
            const length = (buffer[1] << 8 | buffer[2]) + 3;
            if (length > buffer.length) {
                session.serverBuffer.push(buffer);
                break;
            }
            const rawPacket = buffer.slice(0, length);
            const opcode = rawPacket[3];
            if (this.config.logPackets) {
                const label = getOpcodeLabel('in', opcode);
                console.log(`[Proxy] Server -> Client [${session.id}] 0x${opcode.toString(16).padStart(2, '0')} (${label}) [passthrough]`);
            }
            // Notify inspector for panel packet logging
            if (this.inspector && this.inspector.onPacket) {
                const pkt = new Packet(opcode);
                if (this.inspector.captureBody) {
                    if (session.clientCrypto.name && isDecryptOpcode(opcode)) {
                        try {
                            const capPacket = new Packet(Array.from(rawPacket));
                            session.clientCrypto.decrypt(capPacket);
                            pkt.body = capPacket.body;
                        }
                        catch (_e) {
                            pkt.body = Array.from(rawPacket.slice(4));
                        }
                    }
                    else {
                        pkt.body = Array.from(rawPacket.slice(4));
                    }
                }
                this.inspector.onPacket(pkt, 'server-to-client', session);
            }
            if (opcode === 0x00) {
                // Encryption packet - parse to read seed/key, then forward raw
                const packet = new Packet(Array.from(rawPacket));
                const code = packet.readByte();
                if (code === 0) {
                    packet.readUInt32();
                    const seed = packet.readByte();
                    const key = packet.readString8();
                    const name = session.characterName || undefined;
                    console.log(`[Proxy] Encryption handshake [${session.id}]: seed=${seed} key=${key} name=${name || '(none)'}`);
                    session.updateCrypto(seed, key, name);
                    session.clientEncryptSeq = 0;
                    session.serverEncryptSeq = 0;
                }
                // Forward raw
                if (session.clientSocket && !session.clientSocket.destroyed) {
                    session.clientSocket.write(rawPacket);
                }
            }
            else if (opcode === 0x03) {
                // Redirect - must rewrite, cannot forward raw
                const packet = new Packet(Array.from(rawPacket));
                this._handleRedirect(session, packet);
            }
            else if (opcode === 0x02) {
                // LoginResult - forward raw, peek for logging
                const packet = new Packet(Array.from(rawPacket));
                // 0x02 is static-key encrypted from server, just forward raw
                if (session.clientSocket && !session.clientSocket.destroyed) {
                    session.clientSocket.write(rawPacket);
                }
            }
            else {
                // Map substitution: intercept 0x15 (MapInfo) and rewrite the map number
                // before forwarding, so the client loads our custom map file instead.
                let forwarded = false;
                let substitutedMapNumber: number | undefined;
                if (opcode === 0x15 && session.clientCrypto.name && Object.keys(this.config.mapSubstitutions).length > 0) {
                    try {
                        const modPacket = new Packet(Array.from(rawPacket));
                        session.clientCrypto.decrypt(modPacket);
                        const originalMapNumber = (modPacket.body[0] << 8) | modPacket.body[1];
                        const replacement = this.config.mapSubstitutions[originalMapNumber];
                        if (replacement !== undefined) {
                            const mapInfo = this.getMapFileInfo(replacement);
                            // Body layout: [0-1]=mapNum [2]=wLo [3]=hLo [4]=flags [5]=wHi [6]=hHi [7-8]=checksum [9..]=name
                            modPacket.body[0] = (replacement >> 8) & 0xFF;
                            modPacket.body[1] = replacement & 0xFF;
                            if (mapInfo) {
                                // Use the real checksum so the client can cache the substituted map.
                                // First visit: cache miss → client sends 0x05 → proxy injects tiles.
                                // Return visits: cache hit → instant load, no tile injection needed.
                                modPacket.body[7] = (mapInfo.checksum >> 8) & 0xFF;
                                modPacket.body[8] = mapInfo.checksum & 0xFF;
                            }
                            substitutedMapNumber = replacement;
                            const widthLo = modPacket.body[2];
                            const heightLo = modPacket.body[3];
                            const widthHi = modPacket.body[5];
                            const heightHi = modPacket.body[6];
                            const mapWidth = (widthHi << 8) | widthLo;
                            const mapHeight = (heightHi << 8) | heightLo;
                            modPacket.sequence = session.nextClientSeq();
                            session.clientCrypto.encryptServerPacket(modPacket);
                            if (session.clientSocket && !session.clientSocket.destroyed) {
                                session.clientSocket.write(modPacket.buffer());
                            }
                            forwarded = true;
                            // Block real server 0x3C tiles for this map (even if client uses cache)
                            session.lastInjectedMap = replacement;
                            // Store tile data so we can respond to client 0x05 (RequestMapData)
                            session.substitutedMapData = mapInfo && mapInfo.data.length > 0
                                ? { data: mapInfo.data, width: mapWidth, height: mapHeight }
                                : null;
                            console.log(`[Proxy] MAP SUBSTITUTION [${session.id}]: map ${originalMapNumber} -> ${replacement} (rewrite 0x15, file=${mapInfo?.data.length ?? 0}b)`);
                        } else {
                            session.lastInjectedMap = null;
                            session.substitutedMapData = null;
                        }
                    }
                    catch (e) {
                        console.log(`[Proxy] Map substitution decrypt failed: ${e}`);
                    }
                }
                // Board list injection: intercept 0x31 (BoardResult) and inject virtual boards
                // into the board list so they appear alongside Mail, Events, etc.
                if (!forwarded && opcode === 0x31 && session.clientCrypto.name) {
                    try {
                        const modPacket = new Packet(Array.from(rawPacket));
                        session.clientCrypto.decrypt(modPacket);
                        const resultType = modPacket.body[0];
                        if (resultType === 0x01) {
                            // ResultType 1 = BoardList: [ResultType:1=0x01] [BoardCount:2] per board: [BoardId:2] [BoardName:String8]
                            // Inject our virtual board(s) at the end
                            const boardCountHi = modPacket.body[1];
                            const boardCountLo = modPacket.body[2];
                            const originalCount = (boardCountHi << 8) | boardCountLo;
                            // Build virtual board entries to inject
                            const virtualBoards: { id: number; name: string }[] = [];
                            this.emit('virtualBoard:getBoards', virtualBoards);
                            if (virtualBoards.length > 0) {
                                const newCount = originalCount + virtualBoards.length;
                                modPacket.body[1] = (newCount >> 8) & 0xFF;
                                modPacket.body[2] = newCount & 0xFF;
                                // Append virtual board entries to the end of body
                                for (const vb of virtualBoards) {
                                    modPacket.body.push((vb.id >> 8) & 0xFF);
                                    modPacket.body.push(vb.id & 0xFF);
                                    const nameBytes = Array.from(Buffer.from(vb.name, 'utf8'));
                                    modPacket.body.push(nameBytes.length);
                                    modPacket.body.push(...nameBytes);
                                }
                                console.log(`[Proxy] BOARD LIST INJECTION [${session.id}]: ${originalCount} -> ${newCount} boards (added ${virtualBoards.length} virtual)`);
                                modPacket.sequence = session.nextClientSeq();
                                session.clientCrypto.encryptServerPacket(modPacket);
                                if (session.clientSocket && !session.clientSocket.destroyed) {
                                    session.clientSocket.write(modPacket.buffer());
                                }
                                forwarded = true;
                            }
                        }
                    }
                    catch (e) {
                        console.log(`[Proxy] Board list injection decrypt failed: ${e}`);
                    }
                }
                // -- 0x33 (ShowUser) patching: name tags + disguise --
                // Combines nametag style patching and disguise appearance patching
                // on the same decrypted packet to avoid double-decrypt issues.
                if (!forwarded && opcode === 0x33 && session.clientCrypto.name) {
                    const wantNameTag = this.registry && this.config.nameTags && this.config.nameTags.enabled;
                    const wantDisguise = this.config.disguise && this.config.disguise.enabled && this.getPlayerDisguise;
                    if (wantNameTag || wantDisguise) {
                        try {
                            const modPacket = new Packet(Array.from(rawPacket));
                            session.clientCrypto.decrypt(modPacket);
                            const body = modPacket.body;
                            let patched = false;
                            if (body.length >= 20) {
                                const serial = (body[5] << 24 | body[6] << 16 | body[7] << 8 | body[8]) >>> 0;
                                const headSprite = (body[9] << 8) | body[10];
                                const isNormalForm = headSprite !== 0xFFFF;
                                // -- NameTag patching --
                                if (wantNameTag && this.registry) {
                                    const proxyPlayer = this.registry.getPlayerBySerial(serial);
                                    const isSelf = serial === session.playerState.serial ||
                                        (proxyPlayer && proxyPlayer.characterName === session.characterName) ||
                                        (proxyPlayer && proxyPlayer.sessionId === session.id);
                                    if (proxyPlayer && !isSelf) {
                                        const styleOffset = isNormalForm ? 39 : 21;
                                        if (styleOffset < body.length) {
                                            const oldStyle = body[styleOffset];
                                            const perPlayerStyle = this.getPlayerNameTagStyle
                                                ? this.getPlayerNameTagStyle(proxyPlayer.characterName)
                                                : null;
                                            const nextStyle = typeof perPlayerStyle === 'number'
                                                ? perPlayerStyle
                                                : this.config.nameTags.nameStyle;
                                            body[styleOffset] = nextStyle;
                                            patched = true;
                                            console.log(`[Proxy] NameTag: patched 0x33 serial=0x${serial.toString(16)} style ${oldStyle}->${nextStyle} (${isNormalForm ? 'normal' : 'monster'} form)`);
                                        }
                                    }
                                }
                                // -- Disguise patching (per-player) --
                                if (wantDisguise && isNormalForm && body.length >= 42) {
                                    const nameLen = body[40];
                                    if (nameLen > 0 && nameLen < 30 && 40 + 1 + nameLen <= body.length) {
                                        const nameBuf = body.slice(41, 41 + nameLen);
                                        const charName = Buffer.from(nameBuf).toString('latin1');
                                        const d = this.getPlayerDisguise!(charName);
                                        if (d && d.enabled) {
                                            const sprite = d.overcoatSprite != null ? d.overcoatSprite : 0;
                                            const color = d.overcoatColor != null ? d.overcoatColor : 0;
                                            if (sprite > 0) {
                                                body[33] = (sprite >> 8) & 0xFF;
                                                body[34] = sprite & 0xFF;
                                                body[35] = color;
                                                patched = true;
                                                console.log(`[Proxy] Disguise: patched 0x33 for ${charName} -> overcoat=${sprite} color=${color}`);
                                            }
                                        }
                                    }
                                }
                            }
                            if (patched) {
                                modPacket.sequence = session.nextClientSeq();
                                session.clientCrypto.encryptServerPacket(modPacket);
                                if (session.clientSocket && !session.clientSocket.destroyed) {
                                    session.clientSocket.write(modPacket.buffer());
                                }
                                forwarded = true;
                            }
                        }
                        catch (e) {
                            console.log(`[Proxy] 0x33 patch failed: ${e}`);
                        }
                    }
                }
                // -- Disguise: patch 0x34 (UserProfile) for target player --
                // 0x34: [EntityId:u32] [18 equip x 3] [Status:1] [Name:S8] [Nation:1]
                //        [Title:S8] [IsGroupOpen:1] [GuildRank:S8] [DisplayClass:S8] [Guild:S8] ...
                if (!forwarded && opcode === 0x34) {
                    try {
                        const dbgPkt = new Packet(Array.from(rawPacket));
                        session.clientCrypto.decrypt(dbgPkt);
                        const dbgBody = dbgPkt.body;
                        const dbgNameOff = 59;
                        const dbgNameLen = dbgBody[dbgNameOff] || 0;
                        const dbgName = dbgNameLen > 0 && dbgNameLen < 30 ? Buffer.from(dbgBody.slice(dbgNameOff + 1, dbgNameOff + 1 + dbgNameLen)).toString('latin1') : '???';
                        console.log(`[Proxy] 0x34 DEBUG: session=${session.id} char=${session.characterName} cryptoName=${session.clientCrypto.name} profile=${dbgName} bodyLen=${dbgBody.length} nameOff=${dbgNameOff} nameLen=${dbgNameLen} hex[56..72]=${Buffer.from(dbgBody.slice(56, Math.min(dbgBody.length, 73))).toString('hex')}`);
                    } catch (e) {
                        console.log(`[Proxy] 0x34 DEBUG decrypt failed: ${e}`);
                    }
                }
                if (!forwarded && opcode === 0x34 && session.clientCrypto.name &&
                    this.config.disguise && this.config.disguise.enabled && this.getPlayerDisguise) {
                    try {
                        const modPacket = new Packet(Array.from(rawPacket));
                        session.clientCrypto.decrypt(modPacket);
                        const body = modPacket.body;
                        const nameOffset = 59; // 4 + 54 + 1
                        if (body.length > nameOffset + 1) {
                            const nameLen = body[nameOffset];
                            if (nameLen > 0 && nameLen < 30 && nameOffset + 1 + nameLen < body.length) {
                                const profileName = Buffer.from(body.slice(nameOffset + 1, nameOffset + 1 + nameLen)).toString('latin1');
                                const d = this.getPlayerDisguise(profileName);
                                if (d && d.enabled) {
                                    let pos = nameOffset + 1 + nameLen; // after Name
                                    pos += 1; // Nation byte
                                    // Parse existing String8 fields: Title, skip IsGroupOpen, GuildRank, DisplayClass, Guild
                                    const titleStart = pos;
                                    const oldTitleLen = body[pos]; pos += 1 + oldTitleLen;
                                    pos += 1; // IsGroupOpen
                                    const guildRankStart = pos;
                                    const oldGuildRankLen = body[pos]; pos += 1 + oldGuildRankLen;
                                    const displayClassStart = pos;
                                    const oldDisplayClassLen = body[pos]; pos += 1 + oldDisplayClassLen;
                                    const guildStart = pos;
                                    const oldGuildLen = body[pos]; pos += 1 + oldGuildLen;
                                    const afterGuild = pos; // everything after Guild
                                    // Build replacement segment: Title + IsGroupOpen + GuildRank + DisplayClass + Guild
                                    const newTitle = Buffer.from(d.title, 'latin1');
                                    const newGuildRank = Buffer.from(d.guildRank, 'latin1');
                                    const newDisplayClass = Buffer.from(d.displayClass, 'latin1');
                                    const newGuild = Buffer.from(d.guild, 'latin1');
                                    const isGroupOpenByte = body[titleStart + 1 + oldTitleLen]; // preserve original
                                    const middle = Buffer.concat([
                                        Buffer.from([newTitle.length]), newTitle,
                                        Buffer.from([isGroupOpenByte]),
                                        Buffer.from([newGuildRank.length]), newGuildRank,
                                        Buffer.from([newDisplayClass.length]), newDisplayClass,
                                        Buffer.from([newGuild.length]), newGuild,
                                    ]);
                                    const newBody = Buffer.concat([
                                        Buffer.from(body.slice(0, titleStart)),
                                        middle,
                                        Buffer.from(body.slice(afterGuild)),
                                    ]);
                                    const rebuilt = new Packet(modPacket.opcode);
                                    rebuilt.body = Array.from(newBody);
                                    rebuilt.sequence = session.nextClientSeq();
                                    session.clientCrypto.encryptServerPacket(rebuilt);
                                    if (session.clientSocket && !session.clientSocket.destroyed) {
                                        session.clientSocket.write(rebuilt.buffer());
                                    }
                                    forwarded = true;
                                    console.log(`[Proxy] Disguise: patched 0x34 profile for ${profileName}`);
                                }
                            }
                        }
                    }
                    catch (e) {
                        console.log(`[Proxy] Disguise: 0x34 patch failed: ${e}`);
                    }
                }
                // -- Append custom proxy legend marks to 0x34 (PlayerProfile) --
                // 0x34: [EntityId:4] [18equip x 3=54] [Status:1] [Name:S8] [Nation:1]
                //        [Title:S8] [IsGroupOpen:1] [GuildRank:S8] [DisplayClass:S8]
                //        [Guild:S8] [LegendCount:1] [marks...]
                if (!forwarded && opcode === 0x34 && session.clientCrypto.name && session.characterName) {
                    try {
                        const modPacket = new Packet(Array.from(rawPacket));
                        session.clientCrypto.decrypt(modPacket);
                        const body = modPacket.body;
                        const nameOffset = 59; // 4 + 54 + 1
                        if (body.length > nameOffset + 1) {
                            const nameLen = body[nameOffset];
                            if (nameLen > 0 && nameLen < 30 && nameOffset + 1 + nameLen < body.length) {
                                const profileName = Buffer.from(body.slice(nameOffset + 1, nameOffset + 1 + nameLen)).toString('latin1');
                                const customLegends = this.getCustomLegendsForPlayer
                                    ? this.getCustomLegendsForPlayer(profileName)
                                    : [];
                                if (customLegends.length > 0) {
                                    let pos = nameOffset + 1 + nameLen; // after Name
                                    pos += 1; // Nation
                                    pos += 1 + (body[pos] || 0); // Title S8
                                    pos += 1; // IsGroupOpen
                                    pos += 1 + (body[pos] || 0); // GuildRank S8
                                    pos += 1 + (body[pos] || 0); // DisplayClass S8
                                    pos += 1 + (body[pos] || 0); // Guild S8
                                    // pos is now at LegendCount
                                    const origCount = body[pos] || 0;
                                    const totalCount = Math.min(origCount + customLegends.length, 255);
                                    // Skip past original legend marks to find where portrait/bio section starts
                                    // Each mark: [icon:1] [color:1] [keyLen:1] [key...] [textLen:1] [text...]
                                    let marksEnd = pos + 1; // start after LegendCount byte
                                    for (let mi = 0; mi < origCount; mi++) {
                                        if (marksEnd + 4 > body.length) break; // need at least icon+color+keyLen+textLen
                                        marksEnd += 2; // icon + color
                                        marksEnd += 1 + (body[marksEnd] || 0); // key S8
                                        if (marksEnd >= body.length) break;
                                        marksEnd += 1 + (body[marksEnd] || 0); // text S8
                                    }
                                    const origMarks = Buffer.from(body.slice(pos + 1, marksEnd));
                                    const trailingData = Buffer.from(body.slice(marksEnd)); // portrait/bio section
                                    console.log(`[Proxy] Legends 0x34 debug: name=${profileName} origCount=${origCount} pos=${pos} marksEnd=${marksEnd} bodyLen=${body.length} trailingBytes=${trailingData.length} hex@pos=${Buffer.from(body.slice(Math.max(0,pos-2), Math.min(body.length, pos+30))).toString('hex')}`);
                                    const customParts: Buffer[] = [];
                                    for (let li = 0; li < customLegends.length && (origCount + li) < 255; li++) {
                                        const leg = customLegends[li];
                                        customParts.push(Buffer.from([leg.icon & 0xFF, leg.color & 0xFF]));
                                        const keyBuf = Buffer.from(leg.key || '', 'latin1');
                                        customParts.push(Buffer.from([keyBuf.length])); customParts.push(keyBuf);
                                        const textBuf = Buffer.from(leg.text || '', 'latin1');
                                        customParts.push(Buffer.from([textBuf.length])); customParts.push(textBuf);
                                    }
                                    const newBody = Buffer.concat([
                                        Buffer.from(body.slice(0, pos)),
                                        Buffer.from([totalCount]),
                                        origMarks,
                                        ...customParts,
                                        trailingData
                                    ]);
                                    const rebuilt = new Packet(modPacket.opcode);
                                    rebuilt.body = Array.from(newBody);
                                    rebuilt.sequence = session.nextClientSeq();
                                    session.clientCrypto.encryptServerPacket(rebuilt);
                                    if (session.clientSocket && !session.clientSocket.destroyed) {
                                        session.clientSocket.write(rebuilt.buffer());
                                    }
                                    forwarded = true;
                                    console.log(`[Proxy] Legends: appended ${customLegends.length} custom marks to 0x34 profile for ${profileName} (${origCount}+${customLegends.length}=${totalCount})`);
                                }
                            }
                        }
                    }
                    catch (e) {
                        console.log(`[Proxy] Legends 0x34 inject failed: ${e}`);
                    }
                }
                // -- Disguise: patch 0x39 (SelfProfile) for target player --
                // 0x39: [Nation:1] [GuildRank:S8] [Title:S8] [GroupMembers:S8]
                //        [IsGroupOpen:1] [IsRecruiting:1] {recruiting fields if true}
                //        [Class:1] [ShowAbilityMeta:1] [ShowMasterMeta:1]
                //        [DisplayClass:S8] [Guild:S8] [LegendCount:1] ...
                if (!forwarded && opcode === 0x39 && session.clientCrypto.name &&
                    this.config.disguise && this.config.disguise.enabled && this.getPlayerDisguise &&
                    session.characterName) {
                    const _selfDisguise = this.getPlayerDisguise(session.characterName);
                    if (_selfDisguise && _selfDisguise.enabled) {
                    try {
                        const modPacket = new Packet(Array.from(rawPacket));
                        session.clientCrypto.decrypt(modPacket);
                        const body = modPacket.body;
                        if (body.length >= 6) {
                            const d = _selfDisguise;
                            // Collect replacement points: {start, end, replacement}
                            const patches: { start: number; end: number; buf: Buffer }[] = [];
                            let pos = 1; // skip Nation
                            // GuildRank (String8)
                            const grStart = pos;
                            const oldGRLen = body[pos]; pos += 1 + oldGRLen;
                            patches.push({ start: grStart, end: pos, buf: Buffer.from(d.guildRank, 'latin1') });
                            // Title (String8)
                            const tStart = pos;
                            const oldTLen = body[pos]; pos += 1 + oldTLen;
                            patches.push({ start: tStart, end: pos, buf: Buffer.from(d.title, 'latin1') });
                            // GroupMembers (String8) -- keep as-is
                            const gmLen = body[pos]; pos += 1 + gmLen;
                            // IsGroupOpen (1), IsRecruiting (1)
                            pos += 1; // IsGroupOpen
                            const isRecruiting = body[pos]; pos += 1;
                            if (isRecruiting) {
                                // Skip recruiting fields: Leader(S8) GroupName(S8) GroupNote(S8) + 8 bytes
                                const leaderLen = body[pos]; pos += 1 + leaderLen;
                                const gnLen = body[pos]; pos += 1 + gnLen;
                                const noteLen = body[pos]; pos += 1 + noteLen;
                                pos += 8; // MinLevel..CurrentMonks
                            }
                            // Class (1), ShowAbilityMetadata (1), ShowMasterMetadata (1)
                            pos += 3;
                            // DisplayClass (String8)
                            const dcStart = pos;
                            const oldDCLen = body[pos]; pos += 1 + oldDCLen;
                            patches.push({ start: dcStart, end: pos, buf: Buffer.from(d.displayClass, 'latin1') });
                            // Guild (String8)
                            const gStart = pos;
                            const oldGLen = body[pos]; pos += 1 + oldGLen;
                            patches.push({ start: gStart, end: pos, buf: Buffer.from(d.guild, 'latin1') });
                            // Build new body by applying patches in order
                            const parts: Buffer[] = [];
                            let cursor = 0;
                            for (const p of patches) {
                                parts.push(Buffer.from(body.slice(cursor, p.start)));
                                parts.push(Buffer.from([p.buf.length]));
                                parts.push(p.buf);
                                cursor = p.end;
                            }
                            parts.push(Buffer.from(body.slice(cursor)));
                            const newBody = Buffer.concat(parts);
                            const rebuilt = new Packet(modPacket.opcode);
                            rebuilt.body = Array.from(newBody);
                            rebuilt.sequence = session.nextClientSeq();
                            session.clientCrypto.encryptServerPacket(rebuilt);
                            if (session.clientSocket && !session.clientSocket.destroyed) {
                                session.clientSocket.write(rebuilt.buffer());
                            }
                            forwarded = true;
                            (session as any)._cachedSelfProfileBody = Array.from(newBody);
                            console.log(`[Proxy] Disguise: patched 0x39 self-profile`);
                        }
                    }
                    catch (e) {
                        console.log(`[Proxy] Disguise: 0x39 patch failed: ${e}`);
                    }
                    }
                }
                // (Custom legends are appended to 0x39 SelfProfile in server->client path below)
                // -- Disguise: patch 0x36 (WorldList) -- custom ordering with sections --
                if (!forwarded && opcode === 0x36 && session.clientCrypto.name &&
                    this.config.disguise && this.config.disguise.enabled && this.getPlayerDisguise) {
                    try {
                        const modPacket = new Packet(Array.from(rawPacket));
                        session.clientCrypto.decrypt(modPacket);
                        const body = modPacket.body;
                        // 0x36: [WorldCount:u16] [CountryCount:u16] then per entry:
                        //   [ClassWithFlags:1] [Color:1] [Status:1] [Title:String8] [IsMaster:1] [Name:String8]
                        if (body.length >= 4) {
                            const count = (body[0] << 8) | body[1];
                            let pos = 4;
                            // Get proxy player names
                            const proxyNames = new Set<string>();
                            if (this.registry) {
                                for (const p of this.registry.getAllPlayers()) {
                                    if (p.characterName) proxyNames.add(p.characterName);
                                }
                            }
                            // Parse all entries
                            const entries: { start: number; end: number; name: string }[] = [];
                            for (let i = 0; i < count && pos < body.length - 2; i++) {
                                const entryStart = pos;
                                pos += 3; // ClassWithFlags, Color, Status
                                const titleLen = body[pos]; pos += 1 + titleLen;
                                pos += 1; // IsMaster
                                const nameLen = body[pos];
                                const entryName = (nameLen > 0 && pos + 1 + nameLen <= body.length)
                                    ? Buffer.from(body.slice(pos + 1, pos + 1 + nameLen)).toString('latin1') : '';
                                pos += 1 + nameLen;
                                entries.push({ start: entryStart, end: pos, name: entryName });
                            }
                            // Build entry buffers, patching disguised players' titles
                            let hasAnyDisguise = false;
                            const entryBuffers = entries.map(e => {
                                const ed = this.getPlayerDisguise!(e.name);
                                if (!ed || !ed.enabled || !ed.title) return Buffer.from(body.slice(e.start, e.end));
                                hasAnyDisguise = true;
                                const raw = body.slice(e.start, e.end);
                                const oldTitleLen = raw[3];
                                const newTitleBuf = Buffer.from(ed.title, 'latin1');
                                return Buffer.concat([
                                    Buffer.from(raw.slice(0, 3)),
                                    Buffer.from([newTitleBuf.length]), newTitleBuf,
                                    Buffer.from(raw.slice(3 + 1 + oldTitleLen)),
                                ]);
                            });
                            if (hasAnyDisguise) {
                                // Section header helpers
                                function makeSpacer(titleText: string): Buffer {
                                    const t = Buffer.from(titleText, 'latin1');
                                    return Buffer.from([
                                        0x00, 0x00, 0x00,  // ClassWithFlags, Color, Status
                                        t.length, ...t,    // Title
                                        0x00,              // IsMaster: false
                                        0x00,              // Name: empty String8
                                    ]);
                                }
                                const aeHeader = makeSpacer('AE ENHANCED ------');
                                const publicHeader = makeSpacer('PUBLIC ------');
                                // Categorise: disguised, proxy (non-disguised), others
                                const disguisedBufs: Buffer[] = [];
                                const proxyBufs: Buffer[] = [];
                                const otherBufs: Buffer[] = [];
                                for (let i = 0; i < entries.length; i++) {
                                    const ed = this.getPlayerDisguise!(entries[i].name);
                                    if (ed && ed.enabled) {
                                        disguisedBufs.push(entryBuffers[i]);
                                    } else if (proxyNames.has(entries[i].name)) {
                                        proxyBufs.push(entryBuffers[i]);
                                    } else {
                                        otherBufs.push(entryBuffers[i]);
                                    }
                                }
                                const ordered: Buffer[] = [aeHeader, ...disguisedBufs];
                                let extraEntries = 1; // aeHeader
                                if (proxyBufs.length > 0) {
                                    for (const b of proxyBufs) ordered.push(b);
                                }
                                ordered.push(publicHeader);
                                extraEntries++;
                                for (const b of otherBufs) ordered.push(b);
                                const newCount = entries.length + extraEntries;
                                const header = Buffer.from([
                                    (newCount >> 8) & 0xFF, newCount & 0xFF,
                                    body[2], body[3],  // preserve CountryCount/unk
                                ]);
                                const newBody = Buffer.concat([header, ...ordered]);
                                const rebuilt = new Packet(modPacket.opcode);
                                rebuilt.body = Array.from(newBody);
                                rebuilt.sequence = session.nextClientSeq();
                                session.clientCrypto.encryptServerPacket(rebuilt);
                                if (session.clientSocket && !session.clientSocket.destroyed) {
                                    session.clientSocket.write(rebuilt.buffer());
                                }
                                forwarded = true;
                                console.log(`[Proxy] Disguise: patched 0x36 -- ${disguisedBufs.length} disguised, ${proxyBufs.length} proxy, ${otherBufs.length} others`);
                            }
                        }
                    }
                    catch (e) {
                        console.log(`[Proxy] Disguise: 0x36 patch failed: ${e}`);
                    }
                }
                // Block real server 0x3C tile rows while on a substituted map.
                // We forward client 0x05 to keep the server happy, but drop its
                // tile response since we already injected our own tiles.
                if (!forwarded && opcode === 0x3C && session.lastInjectedMap !== null) {
                    forwarded = true;
                }
                // AFK Shadow Mode: block real server position/entity/inventory updates from reaching client
                if (!forwarded && session.afkState?.active) {
                    const AFK_SERVER_BLOCKED = [0x04, 0x0B, 0x07, 0x08, 0x0C, 0x0E, 0x33, 0x0F, 0x10, 0x17, 0x18, 0x2C, 0x2D, 0x37, 0x38, 0x3C, 0x58];
                    if (AFK_SERVER_BLOCKED.includes(opcode)) {
                        forwarded = true; // suppress
                    }
                    // If server sends 0x15 (MapInfo) while AFK -- server-initiated teleport -> exit AFK
                    if (opcode === 0x15) {
                        this.emit('afk:serverMapChange', session);
                        // Don't block -- let the map change flow through (afkState cleared by handler)
                    }
                }
                // -- Append custom proxy legend marks to 0x39 (SelfProfile) --
                // Runs regardless of disguise -- uses cached body if disguise already patched,
                // otherwise decrypts from raw. This ensures custom marks always appear.
                if (opcode === 0x39 && session.clientCrypto.name && session.characterName) {
                    let body: number[] | null = null;
                    const alreadyForwarded = forwarded;
                    try {
                        if (alreadyForwarded && (session as any)._cachedSelfProfileBody) {
                            // Disguise already processed -- use the cached patched body
                            body = (session as any)._cachedSelfProfileBody;
                        }
                        else if (!alreadyForwarded) {
                            const modPacket = new Packet(Array.from(rawPacket));
                            session.clientCrypto.decrypt(modPacket);
                            body = modPacket.body;
                        }
                    }
                    catch (_e) { /* decrypt failed */ }
                    if (body && body.length > 10) {
                        try {
                            // Walk the SelfProfile structure to find LegendCount
                            let pos = 1; // skip Nation
                            pos += 1 + (body[pos] || 0); // GuildRank S8
                            pos += 1 + (body[pos] || 0); // Title S8
                            pos += 1 + (body[pos] || 0); // GroupMembers S8
                            pos += 1; // IsGroupOpen
                            const isRecruiting = body[pos]; pos += 1;
                            if (isRecruiting) {
                                pos += 1 + (body[pos] || 0); // Leader S8
                                pos += 1 + (body[pos] || 0); // GroupName S8
                                pos += 1 + (body[pos] || 0); // GroupNote S8
                                pos += 8; // MinLevel..CurrentMonks
                            }
                            pos += 3; // Class, ShowAbilityMeta, ShowMasterMeta
                            pos += 1 + (body[pos] || 0); // DisplayClass S8
                            pos += 1 + (body[pos] || 0); // Guild S8
                            // pos is now at LegendMarkCount
                            if (pos < body.length && body[pos] > 0) {
                                const customLegends = this.getCustomLegendsForPlayer
                                    ? this.getCustomLegendsForPlayer(session.characterName)
                                    : [];
                                if (customLegends.length > 0) {
                                    const origCount = body[pos];
                                    const totalCount = Math.min(origCount + customLegends.length, 255);
                                    const origMarks = Buffer.from(body.slice(pos + 1));
                                    const customParts: Buffer[] = [];
                                    for (let li = 0; li < customLegends.length && (origCount + li) < 255; li++) {
                                        const leg = customLegends[li];
                                        customParts.push(Buffer.from([leg.icon & 0xFF, leg.color & 0xFF]));
                                        const keyBuf = Buffer.from(leg.key || '', 'latin1');
                                        customParts.push(Buffer.from([keyBuf.length])); customParts.push(keyBuf);
                                        const textBuf = Buffer.from(leg.text || '', 'latin1');
                                        customParts.push(Buffer.from([textBuf.length])); customParts.push(textBuf);
                                    }
                                    const newBody = Buffer.concat([
                                        Buffer.from(body.slice(0, pos)),
                                        Buffer.from([totalCount]),
                                        origMarks,
                                        ...customParts
                                    ]);
                                    const rebuilt = new Packet(0x39);
                                    rebuilt.body = Array.from(newBody);
                                    rebuilt.sequence = session.nextClientSeq();
                                    session.clientCrypto.encryptServerPacket(rebuilt);
                                    if (session.clientSocket && !session.clientSocket.destroyed) {
                                        session.clientSocket.write(rebuilt.buffer());
                                    }
                                    forwarded = true;
                                    console.log(`[Proxy] Legends: appended ${customLegends.length} custom marks to 0x39 self-profile (${origCount}+${customLegends.length}=${totalCount}) for ${session.characterName}`);
                                }
                            }
                        }
                        catch (e) {
                            console.log(`[Proxy] Legends 0x39 inject failed: ${e}`);
                        }
                    }
                }
                // -- 0x07 (AddEntity): rewrite NPC positions from saved overrides --
                // Modifies coordinates in the encrypted packet before the client sees it,
                // so the NPC appears directly at the override position with zero flicker.
                if (!forwarded && opcode === 0x07 && session.clientCrypto.name) {
                    try {
                        const modPacket = new Packet(Array.from(rawPacket));
                        session.clientCrypto.decrypt(modPacket);
                        const body = modPacket.body;
                        let patched = false;
                        if (body.length >= 2) {
                            const count = (body[0] << 8) | body[1];
                            let pos = 2;
                            for (let ei = 0; ei < count && pos + 10 <= body.length; ei++) {
                                const sprite = (body[pos + 8] << 8) | body[pos + 9];
                                if (sprite & 0x4000) {
                                    const creatureStart = pos + 10;
                                    if (creatureStart + 7 <= body.length) {
                                        const creatureType = body[creatureStart + 6];
                                        let nameEnd = creatureStart + 7;
                                        if (creatureType === 2 && nameEnd < body.length) {
                                            const nameLen = body[nameEnd];
                                            if (nameLen > 0 && nameEnd + 1 + nameLen <= body.length) {
                                                const eName = Buffer.from(body.slice(nameEnd + 1, nameEnd + 1 + nameLen)).toString('latin1');
                                                const ov = getNpcPositionOverride(eName);
                                                if (ov) {
                                                    body[pos] = (ov.x >> 8) & 0xFF;
                                                    body[pos + 1] = ov.x & 0xFF;
                                                    body[pos + 2] = (ov.y >> 8) & 0xFF;
                                                    body[pos + 3] = ov.y & 0xFF;
                                                    if (ov.sprite != null) {
                                                        const spriteWithFlag = (ov.sprite | 0x4000) & 0xFFFF;
                                                        body[pos + 8] = (spriteWithFlag >> 8) & 0xFF;
                                                        body[pos + 9] = spriteWithFlag & 0xFF;
                                                    }
                                                    patched = true;
                                                }
                                                nameEnd += 1 + nameLen;
                                            }
                                        }
                                        pos = nameEnd;
                                    } else {
                                        break;
                                    }
                                } else if (sprite & 0x8000) {
                                    pos = pos + 10 + 3;
                                } else {
                                    break;
                                }
                            }
                        }
                        if (patched) {
                            modPacket.sequence = session.nextClientSeq();
                            session.clientCrypto.encryptServerPacket(modPacket);
                            if (session.clientSocket && !session.clientSocket.destroyed) {
                                session.clientSocket.write(modPacket.buffer());
                            }
                            forwarded = true;
                        }
                    } catch (e) {
                        // Fall through to normal forwarding on error
                    }
                }
                // Forward everything else raw
                if (!forwarded && session.clientSocket && !session.clientSocket.destroyed) {
                    session.clientSocket.write(rawPacket);
                }
                // Track server->client sequence for encrypted opcodes so that
                // sendToClient() uses the next available sequence for injections.
                // The client reads the ordinal from each packet independently
                // (no monotonic enforcement), so injected packets with different
                // ordinals won't break the stream.
                if (!forwarded && isDecryptOpcode(opcode) && rawPacket.length > 4) {
                    session.clientEncryptSeq = uint8(rawPacket[4] + 1);
                }
                // Detect 0x58 MapTransferComplete -- signals map data is fully sent.
                // If a refresh is pending, this is the safe moment to inject virtual NPCs.
                // If substitutedMapData is set, the client may send 0x05 (cache miss) or
                // use its cache (no 0x05). A short fallback timer handles the cache-hit case.
                if (opcode === 0x58 && session.refreshPending) {
                    session.refreshPending = false;
                    if (session.refreshFallbackTimer) {
                        clearTimeout(session.refreshFallbackTimer);
                        session.refreshFallbackTimer = null;
                    }
                    if (!session.substitutedMapData) {
                        this.emit('player:refreshComplete', session);
                    } else {
                        // Client may use cached tiles (no 0x05). Set a short fallback
                        // to fire refreshComplete if 0x05 doesn't arrive.
                        if (session.substitutedMapFallbackTimer) {
                            clearTimeout(session.substitutedMapFallbackTimer);
                        }
                        session.substitutedMapFallbackTimer = setTimeout(() => {
                            session.substitutedMapFallbackTimer = null;
                            if (!session.destroyed && session.substitutedMapData) {
                                // Client used cache — no tile injection needed
                                session.substitutedMapData = null;
                                this.emit('player:refreshComplete', session);
                            }
                        }, 500);
                    }
                }
                // Selective decrypt for state tracking (decrypt a copy, forward original raw)
                // Skip position/entity tracking for AFK-blocked packets to preserve real position
                const skipForAfk = session.afkState?.active && AFK_SKIP_TRACKING_SET.has(opcode);
                if (TRACKED_OPCODES_SET.has(opcode) && session.clientCrypto.name && !skipForAfk) {
                    try {
                        const peekPacket = new Packet(Array.from(rawPacket));
                        session.clientCrypto.decrypt(peekPacket);
                        if (opcode === 0x05) { // UserId
                            session.playerState.serial = peekPacket.readUInt32();
                            // Update registry so serial-based lookups (e.g. name tags) work
                            if (this.registry) {
                                const regPlayer = this.registry.getPlayer(session.id);
                                if (regPlayer)
                                    regPlayer.serial = session.playerState.serial;
                            }
                            console.log(`[Proxy] Tracked UserId [${session.id}]: serial=${session.playerState.serial}`);
                        }
                        else if (opcode === 0x15) { // MapInfo
                            const prevMap = session.playerState.mapNumber;
                            const rawMapNumber = peekPacket.readUInt16();
                            session.playerState.mapNumber = substitutedMapNumber !== undefined ? substitutedMapNumber : rawMapNumber;
                            const widthLo = peekPacket.readByte();
                            const heightLo = peekPacket.readByte();
                            const flags = peekPacket.readByte();
                            const widthHi = peekPacket.readByte();
                            const heightHi = peekPacket.readByte();
                            session.playerState.mapWidth = (widthHi << 8) | widthLo;
                            session.playerState.mapHeight = (heightHi << 8) | heightLo;
                            const checksum = peekPacket.readUInt16();
                            let mapName = '';
                            if (peekPacket.remainder() >= 1) {
                                mapName = peekPacket.readString8();
                            }
                            console.log(`[Proxy] Tracked MapInfo [${session.id}]: map=${session.playerState.mapNumber} "${mapName}" ${session.playerState.mapWidth}x${session.playerState.mapHeight}`);
                            if (mapName) {
                                this.emit('player:mapName', session, session.playerState.mapNumber, mapName, session.playerState.mapWidth, session.playerState.mapHeight);
                            }
                            if (session.playerState.mapNumber !== prevMap) {
                                this.emit('player:mapChange', session);
                            }
                        }
                        else if (opcode === 0x04) { // MapLocation (forced position set -- charge/ambush/warp)
                            session.playerState.x = peekPacket.readUInt16();
                            session.playerState.y = peekPacket.readUInt16();
                            this.emit('player:position', session);
                            this.emit('player:teleport', session);
                        }
                        else if (opcode === 0x0B) { // WalkResponse
                            const dir = peekPacket.readByte();
                            const prevX = peekPacket.readUInt16();
                            const prevY = peekPacket.readUInt16();
                            // Update player position from walk -- direction: 0=up(-y), 1=right(+x), 2=down(+y), 3=left(-x)
                            const walkDx = dir === 1 ? 1 : dir === 3 ? -1 : 0;
                            const walkDy = dir === 0 ? -1 : dir === 2 ? 1 : 0;
                            session.playerState.x = prevX + walkDx;
                            session.playerState.y = prevY + walkDy;
                            session.playerState.direction = dir;
                            this.emit('player:position', session);
                            this.emit('player:walkResponse', session, dir, prevX, prevY);
                        }
                        else if (opcode === 0x0C) { // EntityWalk
                            const serial = peekPacket.readUInt32();
                            const prevX = peekPacket.readUInt16();
                            const prevY = peekPacket.readUInt16();
                            const dir = peekPacket.readByte();
                            this.emit('entity:walk', session, serial, prevX, prevY, dir);
                        }
                        else if (opcode === 0x08) { // Attributes/Stats
                            const flags = peekPacket.readByte();
                            try {
                                // Primary (0x20): level, maxHp/Mp, base stats, weight
                                if (flags & 0x20) {
                                    peekPacket.read(3); // 3-byte preamble
                                    session.playerState.level = peekPacket.readByte();
                                    peekPacket.readByte(); // ability
                                    session.playerState.maxHp = peekPacket.readUInt32();
                                    session.playerState.maxMp = peekPacket.readUInt32();
                                    peekPacket.read(7); // str,int,wis,con,dex, hasUnspent, unspent
                                    peekPacket.read(4); // maxWeight(2) + currentWeight(2)
                                    peekPacket.read(4); // 4-byte tail padding
                                    console.log(`[Proxy] Stats 0x08 Primary: level=${session.playerState.level} maxHp=${session.playerState.maxHp} maxMp=${session.playerState.maxMp} char=${session.characterName}`);
                                }
                                // Vitality (0x10): currentHp, currentMp
                                if (flags & 0x10) {
                                    session.playerState.hp = peekPacket.readUInt32();
                                    session.playerState.mp = peekPacket.readUInt32();
                                    console.log(`[Proxy] Stats 0x08 Vitality: hp=${session.playerState.hp} mp=${session.playerState.mp} char=${session.characterName}`);
                                }
                            } catch (_e) {
                                console.log(`[Proxy] Stats 0x08 parse error: flags=0x${flags.toString(16)} bodyLen=${peekPacket.body.length} char=${session.characterName} err=${_e}`);
                            }
                            this.emit('player:stats', session);
                        }
                        else if (opcode === 0x17) { // AddSpell
                            this.emit('player:addSpell', session, [...peekPacket.body]);
                        }
                        else if (opcode === 0x18) { // RemoveSpell
                            const slot = peekPacket.readByte();
                            this.emit('player:removeSpell', session, slot);
                        }
                        else if (opcode === 0x2C) { // AddSkill
                            this.emit('player:addSkill', session, [...peekPacket.body]);
                        }
                        else if (opcode === 0x2D) { // RemoveSkill
                            const slot = peekPacket.readByte();
                            this.emit('player:removeSkill', session, slot);
                        }
                        else if (opcode === 0x3C) { // MapTransfer (tile data per row)
                            // Format: [RowY: UInt16] [TileData: 6 bytes per tile...]
                            // Each tile: [bg:u16] [xfg:u16] [yfg:u16] (big-endian, network byte order)
                            const rowY = peekPacket.readUInt16();
                            const tileBytes = peekPacket.body.slice(peekPacket.position);
                            this.emit('player:tileData', session, rowY, tileBytes);
                        }
                        else if (opcode === 0x07) { // AddEntity
                            // Protocol: [EntityCount:u16] then per entity:
                            //   [X:u16] [Y:u16] [Id:u32] [Sprite:u16]
                            //   If creature (sprite & 0x4000): [Unk:u32] [Dir:u8] [Skip:u8] [CreatureType:u8] [Name:String8 if type==2]
                            //   If item (sprite & 0x8000): [Color:u8] [Unk:u16]
                            if (peekPacket.body.length >= 2) {
                                const entityCount = peekPacket.readUInt16();
                                for (let ei = 0; ei < entityCount && peekPacket.remainder() >= 10; ei++) {
                                    const ex = peekPacket.readUInt16();
                                    const ey = peekPacket.readUInt16();
                                    const eid = peekPacket.readUInt32();
                                    const esprite = peekPacket.readUInt16();
                                    let ename = '';
                                    let edir = 0;
                                    let ecreatureType = 0;
                                    if (esprite & 0x4000) {
                                        // Creature
                                        if (peekPacket.remainder() >= 7) {
                                            peekPacket.readUInt32(); // Unknown
                                            edir = peekPacket.readByte();
                                            peekPacket.readByte(); // Skip/padding
                                            ecreatureType = peekPacket.readByte();
                                            if (ecreatureType === 2 && peekPacket.remainder() >= 1) {
                                                ename = peekPacket.readString8();
                                            }
                                        }
                                        this.emit('entity:add', session, eid, ex, ey, esprite & 0x3FFF, ename, edir, 0x00);
                                    } else if (esprite & 0x8000) {
                                        // Item on ground
                                        if (peekPacket.remainder() >= 3) {
                                            peekPacket.readByte(); // Color
                                            peekPacket.readUInt16(); // Unknown
                                        }
                                        this.emit('entity:add', session, eid, ex, ey, esprite & 0x3FFF, '', 0, 0x01);
                                    }
                                }
                            }
                        }
                        else if (opcode === 0x33) { // ShowUser (DisplayAisling)
                            // Format: [X:u16] [Y:u16] [Direction:u8] [Serial:u32] ...
                            if (peekPacket.body.length >= 9) {
                                const ex = peekPacket.readUInt16();
                                const ey = peekPacket.readUInt16();
                                const edir = peekPacket.readByte();
                                const eserial = peekPacket.readUInt32();
                                this.emit('entity:show', session, eserial, ex, ey);
                                // Cache self appearance for AFK mode replay
                                if (eserial === session.playerState.serial) {
                                    session.lastSelfShowUser = Array.from(peekPacket.body);
                                }
                            }
                        }
                        else if (opcode === 0x0E) { // RemoveEntity
                            // Format: [Serial:u32]
                            if (peekPacket.body.length >= 4) {
                                const eserial = peekPacket.readUInt32();
                                this.emit('entity:remove', session, eserial);
                            }
                        }
                        else if (opcode === 0x2E) { // WorldMap
                            // Format: [FieldName:String8] [NodeCount:u8] [FieldIndex:u8]
                            // Per node: [ScreenX:u16] [ScreenY:u16] [Name:String8] [Checksum:u16] [MapId:u16] [MapX:u16] [MapY:u16]
                            try {
                                const fieldName = peekPacket.readString8();
                                const nodeCount = peekPacket.readByte();
                                const fieldIndex = peekPacket.readByte();
                                const nodes: { name: string; checksum: number; mapId: number; mapX: number; mapY: number }[] = [];
                                for (let i = 0; i < nodeCount; i++) {
                                    if (peekPacket.remainder() < 10)
                                        break;
                                    const screenX = peekPacket.readUInt16();
                                    const screenY = peekPacket.readUInt16();
                                    const name = peekPacket.readString8();
                                    const checksum = peekPacket.readUInt16();
                                    const mapId = peekPacket.readUInt16();
                                    const mapX = peekPacket.readUInt16();
                                    const mapY = peekPacket.readUInt16();
                                    nodes.push({ name, checksum, mapId, mapX, mapY });
                                }
                                if (nodes.length > 0) {
                                    console.log(`[Proxy] WorldMap 0x2E: ${nodes.length} nodes from "${fieldName}"`);
                                    this.emit('player:worldMap', session, nodes);
                                }
                            }
                            catch (e) { /* parse error -- ignore */ }
                        }
                        else if (opcode === 0x0F) { // AddItem (inventory)
                            const slot = peekPacket.readByte();
                            const sprite = peekPacket.readUInt16();
                            const color = peekPacket.readByte();
                            const name = peekPacket.readString8();
                            const quantity = peekPacket.readUInt32();
                            const stackable = peekPacket.readByte() !== 0;
                            session.playerState.inventory.set(slot, { slot, sprite, color, name, quantity, stackable });
                        }
                        else if (opcode === 0x10) { // RemoveItem (inventory)
                            const slot = peekPacket.readByte();
                            session.playerState.inventory.delete(slot);
                        }
                        else if (opcode === 0x37) { // SetEquipment
                            const slot = peekPacket.readByte();
                            const sprite = peekPacket.readUInt16();
                            const color = peekPacket.readByte();
                            const name = peekPacket.readString8();
                            peekPacket.readByte(); // protocol padding / unknown byte
                            const maxDurability = peekPacket.readUInt32();
                            const durability = peekPacket.readUInt32();
                            session.playerState.equipment.set(slot, {
                                slot,
                                sprite,
                                color,
                                name,
                                maxDurability,
                                durability,
                            });
                        }
                        else if (opcode === 0x38) { // RemoveEquipment
                            const slot = peekPacket.readByte();
                            session.playerState.equipment.delete(slot);
                        }
                        else if (opcode === 0x13) { // HpBar (entity HP percent)
                            // Format: [Serial:u32] [HpPercent:u8] [Sound?:u8]
                            if (peekPacket.body.length >= 5) {
                                const hpSerial = peekPacket.readUInt32();
                                const hpPercent = peekPacket.readByte();
                                this.emit('entity:hpBar', session, hpSerial, hpPercent);
                            }
                        }
                        else if (opcode === 0x29) { // SpellAnimation (effect on entity)
                            // Format: [TargetSerial:u32] [CasterSerial:u32] [AnimationId:u16] [TargetAnimation:u16] [Speed:u16]
                            if (peekPacket.body.length >= 10) {
                                const targetSerial = peekPacket.readUInt32();
                                const casterSerial = peekPacket.readUInt32();
                                const animationId = peekPacket.readUInt16();
                                this.emit('entity:spellAnimation', session, casterSerial, targetSerial, animationId);
                            }
                        }
                        else if (opcode === 0x3A) { // SpellBar (active effect icons on self)
                            // Format: [Count:u16] then [IconId:u16] per icon
                            if (peekPacket.body.length >= 2) {
                                const iconCount = peekPacket.readUInt16();
                                const icons: number[] = [];
                                for (let i = 0; i < iconCount && peekPacket.remainder() >= 2; i++) {
                                    icons.push(peekPacket.readUInt16());
                                }
                                this.emit('player:spellBar', session, icons);
                            }
                        }
                    }
                    catch (e) {
                        // Decrypt failed - crypto params may not match yet, ignore
                    }
                }
            }
            buffer = buffer.slice(length);
        }
    }

    /**
     * Intercept critical protocol packets that the proxy must handle itself.
     * Returns true if the packet was fully handled (should not be forwarded normally).
     */
    private _interceptServerPacket(session: ProxySession, packet: Packet): boolean {
        switch (packet.opcode) {
            case 0x00: // Encryption/ServerList
                return this._handleEncryption(session, packet);
            case 0x03: // Redirect
                return this._handleRedirect(session, packet);
            case 0x05: // UserId
                this._handleUserId(session, packet);
                return false; // still forward to client
            case 0x7E: // Welcome
                return false; // forward as-is
            default:
                return false;
        }
    }

    /**
     * Handle the 0x00 Encryption packet from the real server.
     * We need to read the seed/key and set up crypto for both sides.
     */
    private _handleEncryption(session: ProxySession, packet: Packet): boolean {
        const savedPos = packet.position;
        const code = packet.readByte();
        if (code === 0) {
            // Normal encryption handshake
            packet.readUInt32(); // skip
            const seed = packet.readByte();
            const key = packet.readString8();
            console.log(`[Proxy] Encryption handshake [${session.id}]: seed=${seed} key=${key}`);
            // Both sides get the same crypto params during login
            // During login phase, client and server use the same seed/key
            session.updateCrypto(seed, key);
            session.clientEncryptSeq = 0;
            session.serverEncryptSeq = 0;
        }
        // Reset position so it can be forwarded as-is
        packet.position = savedPos;
        // Forward the original packet to client (unencrypted opcode, no re-encryption needed)
        this._forwardToClientRaw(session, packet);
        return true;
    }

    /**
     * Handle the 0x03 Redirect packet from the real server.
     * This is the critical MITM point: we rewrite the address to point back to the proxy.
     */
    private _handleRedirect(session: ProxySession, packet: Packet): boolean {
        // Parse the redirect
        const addressBytes = packet.read(4);
        const port = packet.readUInt16();
        const remainingCount = packet.readByte();
        const seed = packet.readByte();
        const key = packet.readString8();
        const name = packet.readString8();
        const id = packet.readUInt32();
        // Build the real address
        const realAddress = (Array.isArray(addressBytes) ? addressBytes : []).slice().reverse().join('.');
        console.log(`[Proxy] Redirect [${session.id}]: ${realAddress}:${port} seed=${seed} key="${key}" name="${name}" id=${id}`);
        // Store redirect info for when client reconnects
        session.pendingRedirect = { address: realAddress, port, seed, key, name, id };
        session.characterName = name;
        session.phase = 'redirect';
        // Close the server connection (we'll open a new one when client reconnects)
        if (session.serverSocket && !session.serverSocket.destroyed) {
            session.serverSocket.destroy();
            session.serverSocket = null;
        }
        // Build a rewritten redirect packet pointing to the proxy
        const rewritePacket = new Packet(0x03);
        const proxyIpParts = this.config.publicAddress.split('.').map(Number);
        // Use the same game port the real server wanted (2611 or 2612)
        // so the client reconnects to the correct proxy listener
        const proxyPort = port;
        // Write IP bytes reversed (DA protocol stores them reversed)
        rewritePacket.write([proxyIpParts[3], proxyIpParts[2], proxyIpParts[1], proxyIpParts[0]]);
        rewritePacket.writeUInt16(proxyPort);
        rewritePacket.writeByte(remainingCount);
        rewritePacket.writeByte(seed);
        rewritePacket.writeString8(key);
        rewritePacket.writeString8(name);
        rewritePacket.writeUInt32(id);
        // Forward rewritten redirect to client (0x03 is unencrypted)
        this._forwardToClientRaw(session, rewritePacket);
        // The client will now disconnect and reconnect to our proxy.
        // We need to handle that reconnection specially.
        // Remove the old session but keep the redirect info around indexed by character name.
        this._prepareForReconnect(session);
        return true;
    }

    /**
     * Handle 0x05 UserId - extract the serial for tracking.
     */
    private _handleUserId(session: ProxySession, packet: Packet): void {
        const savedPos = packet.position;
        const serial = packet.readUInt32();
        session.playerState.serial = serial;
        console.log(`[Proxy] UserId [${session.id}]: serial=${serial} char=${session.characterName}`);
        packet.position = savedPos;
    }

    /**
     * Prepare for client reconnection after redirect.
     * The client will drop its connection and reconnect to us on the same port.
     * We keep the session data so we can match the reconnection.
     */
    private _prepareForReconnect(session: ProxySession): void {
        // Store the session so we can find it when the client reconnects.
        // The client socket will close, triggering 'close' event.
        // We mark phase='redirect' so the close handler doesn't destroy it.
        // When the client reconnects, we'll detect it's a redirect reconnection
        // by matching the incoming 0x10 ConfirmIdentity packet's name field.
        // For now, we store the redirect info globally keyed by name.
        this.emit('session:redirect', session);
    }

    /**
     * Called when a new client connects. Check if this is a redirect reconnection.
     */
    private _checkForRedirectReconnection(session: ProxySession): ProxySession | null {
        // Find a session in 'redirect' phase. The client connecting back after redirect
        // will be a new TCP connection, so we need to match it.
        for (const [id, existingSession] of this.sessions) {
            if (existingSession.phase === 'redirect' && existingSession.pendingRedirect && id !== session.id) {
                return existingSession;
            }
        }
        return null;
    }

    /**
     * Handle redirect reconnection. The client reconnects after getting a redirect.
     * Simply connect to the REAL game server and passthrough all bytes in both directions.
     * The client handles its own handshake with the game server.
     */
    private _handleRedirectReconnection(newSession: ProxySession, redirectSession: ProxySession): void {
        const redirect = redirectSession.pendingRedirect!;
        console.log(`[Proxy] Redirect reconnection detected [${newSession.id}] for char "${redirect.name}" -> ${redirect.address}:${redirect.port}`);
        // Transfer state from the redirect session to the new session
        newSession.characterName = redirect.name;
        newSession.username = redirectSession.username;
        newSession.phase = 'game';
        newSession.pendingRedirect = redirect;
        // Initialize crypto with redirect params so injection works
        newSession.updateCrypto(redirect.seed, redirect.key, redirect.name);
        // Remove the old redirect session
        this.sessions.delete(redirectSession.id);
        // Connect to the real game server and passthrough everything
        this._connectToRealServer(newSession, redirect.address, redirect.port);
        // Buffer client data until server connection is ready
        let serverReady = false;
        let pendingClientData: Buffer[] = [];
        newSession.clientSocket!.on('data', (data: Buffer) => {
            newSession.lastActivity = new Date();
            if (serverReady) {
                this._handleClientData(newSession, data);
            }
            else {
                pendingClientData.push(data);
            }
        });
        newSession.clientSocket!.on('close', () => {
            console.log(`[Proxy] Client disconnected: ${newSession.id} (phase=${newSession.phase})`);
            if (newSession.phase !== 'redirect') {
                this._destroySession(newSession);
            }
        });
        newSession.clientSocket!.on('error', (err: Error) => {
            console.log(`[Proxy] Client socket error [${newSession.id}]: ${err.message}`);
        });
        // Wait for server connection, then flush buffered client data
        const checkServerReady = () => {
            if (newSession.serverSocket && !newSession.serverSocket.destroyed) {
                serverReady = true;
                // Flush buffered client data
                if (pendingClientData.length > 0) {
                    const combined = Buffer.concat(pendingClientData);
                    pendingClientData = [];
                    this._handleClientData(newSession, combined);
                }
                console.log(`[Proxy] Game session bridged for ${newSession.id} (${redirect.name})`);
                this.emit('session:game', newSession);
            }
            else {
                setTimeout(checkServerReady, 50);
            }
        };
        setTimeout(checkServerReady, 50);
    }

    /**
     * Re-encrypt and forward a decrypted packet to the real server.
     */
    private _forwardToServer(session: ProxySession, packet: Packet): void {
        if (!session.serverSocket || session.serverSocket.destroyed)
            return;
        // Re-encrypt for the server (client->server direction)
        if (isEncryptOpcode(packet.opcode)) {
            packet.sequence = session.nextServerSeq();
        }
        session.serverCrypto.encrypt(packet);
        session.serverSocket.write(packet.buffer());
    }

    /**
     * Re-encrypt and forward a decrypted packet to the client.
     */
    private _forwardToClient(session: ProxySession, packet: Packet): void {
        if (!session.clientSocket || session.clientSocket.destroyed)
            return;
        // Re-encrypt for the client (server->client direction)
        if (isDecryptOpcode(packet.opcode)) {
            packet.sequence = session.nextClientSeq();
            session.clientCrypto.encryptServerPacket(packet);
        }
        session.clientSocket.write(packet.buffer());
    }

    /**
     * Forward a packet to the client without re-encrypting (for unencrypted opcodes like 0x00, 0x03, 0x7E).
     */
    private _forwardToClientRaw(session: ProxySession, packet: Packet): void {
        if (!session.clientSocket || session.clientSocket.destroyed)
            return;
        session.clientSocket.write(packet.buffer());
    }

    private _inspect(packet: Packet, direction: PacketDirection, session: ProxySession): { action: string; packet?: Packet; inject?: Packet[] } {
        if (!this.inspector) {
            return { action: 'forward' };
        }
        return this.inspector.inspect(packet, direction, session);
    }

    private _destroySession(session: ProxySession): void {
        if (session.destroyed)
            return;
        console.log(`[Proxy] Destroying session ${session.id} (${session.characterName || session.username || 'unknown'})`);
        this.sessions.delete(session.id);
        this._injectFailLogged.delete(session.id);
        session.destroy();
        this.emit('session:end', session);
    }
}
