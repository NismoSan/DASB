"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const net_1 = __importDefault(require("net"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const events_1 = __importDefault(require("events"));
const proxy_session_1 = __importDefault(require("./proxy-session"));
const proxy_crypto_1 = require("./proxy-crypto");
const packet_1 = __importDefault(require("../core/packet"));
const datatypes_1 = require("../core/datatypes");
const crc_1 = require("../core/crc");
const opcodes_1 = require("../core/opcodes");
/**
 * Decrypt the inner dialog envelope on 0x39/0x3A packets.
 * After the outer crypto is removed by decryptClientPacket, dialog opcodes
 * still have a 6-byte header: [randHi] [randLo] [lenHi^y] [lenLo^(y+1)]
 * followed by (crc + payload) each XOR'd with (z + i).
 * Returns the raw payload bytes (EntityType, EntityId, PursuitId, Slot/StepId).
 */
function decryptDialogPayload(body) {
    if (body.length < 6)
        return null;
    const xPrime = (0, datatypes_1.uint8)(body[0] - 0x2D);
    const x = (0, datatypes_1.uint8)(body[1] ^ xPrime);
    const y = (0, datatypes_1.uint8)(x + 0x72);
    const z = (0, datatypes_1.uint8)(x + 0x28);
    // Decrypt length bytes
    const lenHi = body[2] ^ y;
    const lenLo = body[3] ^ (0, datatypes_1.uint8)((y + 1) & 0xFF);
    const dataLengthPlusTwo = (lenHi << 8) | lenLo;
    // Decrypt checksum + payload (starting at index 4)
    const decrypted = [];
    for (let i = 0; i < dataLengthPlusTwo && (4 + i) < body.length; i++) {
        decrypted.push((0, datatypes_1.uint8)(body[4 + i] ^ (0, datatypes_1.uint8)((z + i) & 0xFF)));
    }
    // First 2 bytes are CRC, rest is actual payload
    if (decrypted.length < 2)
        return null;
    return decrypted.slice(2);
}
const DEFAULT_CONFIG = {
    listenPort: 2610,
    gamePort1: 2611,
    gamePort2: 2612,
    publicAddress: '127.0.0.1',
    realServerAddress: '52.88.55.94',
    realLoginPort: 2610,
    logPackets: true,
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
class ProxyServer extends events_1.default {
    config;
    servers;
    sessions;
    inspector;
    registry;
    _nextSessionId;
    _mapFileCache;
    constructor(config) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
        // getPlayerDisguise is attached from panel.js (like getCustomLegendsForPlayer)
        this.getPlayerDisguise = null;
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
    getMapFileInfo(mapNumber) {
        if (this._mapFileCache.has(mapNumber)) {
            return this._mapFileCache.get(mapNumber);
        }
        const filePath = path_1.default.join(this.config.mapsDir, `lod${mapNumber}.map`);
        try {
            const data = fs_1.default.readFileSync(filePath);
            const bytes = Array.from(data);
            const checksum = (0, crc_1.calculateCRC16)(bytes);
            const info = { checksum, width: 0, height: 0, data };
            this._mapFileCache.set(mapNumber, info);
            console.log(`[Proxy] Loaded map file ${filePath}: checksum=0x${checksum.toString(16).padStart(4, '0')} (${data.length} bytes)`);
            return info;
        }
        catch (e) {
            console.log(`[Proxy] Failed to load map file ${filePath}: ${e}`);
            return null;
        }
    }
    /** Clear cached map file info (call after replacing a map file on disk). */
    clearMapFileCache(mapNumber) {
        if (mapNumber !== undefined) {
            this._mapFileCache.delete(mapNumber);
        }
        else {
            this._mapFileCache.clear();
        }
    }
    setInspector(inspector) {
        this.inspector = inspector;
    }
    start() {
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
    _listenOnPort(port) {
        return new Promise((resolve, reject) => {
            const server = net_1.default.createServer((clientSocket) => {
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
    stop() {
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
    sendToClient(session, packet) {
        if (session.destroyed || !session.clientSocket || session.clientSocket.destroyed) {
            console.log(`[Proxy] INJECT FAILED → Client [${session.id}] socket destroyed/missing, opcode=0x${packet.opcode.toString(16).padStart(2, '0')}`);
            return;
        }
        packet.sequence = session.nextClientSeq();
        const preEncryptLen = packet.body.length;
        session.clientCrypto.encryptServerPacket(packet);
        const buf = packet.buffer();
        session.clientSocket.write(buf);
        const label = (0, opcodes_1.getOpcodeLabel)('in', packet.opcode);
        console.log(`[Proxy] INJECT → Client [${session.id}] 0x${packet.opcode.toString(16).padStart(2, '0')} (${label}) seq=${packet.sequence} pre=${preEncryptLen}b enc=${buf.length}b char=${session.characterName} cryptoName=${session.clientCrypto.name || 'NONE'}`);
    }
    /**
     * Send a synthetic packet to the real server on behalf of a session.
     */
    sendToServer(session, packet) {
        if (session.destroyed || !session.serverSocket || session.serverSocket.destroyed)
            return;
        if ((0, proxy_crypto_1.isEncryptOpcode)(packet.opcode)) {
            packet.sequence = session.nextServerSeq();
            // Once we inject a server-bound packet, all future client packets
            // must be re-sequenced to maintain monotonic ordinals.
            session.resequenceServerBound = true;
        }
        session.serverCrypto.encrypt(packet);
        const buf = packet.buffer();
        session.serverSocket.write(buf);
        if (this.config.logPackets) {
            const label = (0, opcodes_1.getOpcodeLabel)('out', packet.opcode);
            console.log(`[Proxy] INJECT → Server [${session.id}] 0x${packet.opcode.toString(16).padStart(2, '0')} (${label}) ${buf.length}b`);
        }
    }
    /**
     * Inject replacement map tile data (0x3C rows + 0x58 complete) from a local .map file.
     * The .map file stores tiles in little-endian format (6 bytes per tile: bg:u16LE, xfg:u16LE, yfg:u16LE).
     * Network 0x3C packets use big-endian, so we byte-swap each u16 during injection.
     */
    _injectMapTileData(session, mapData, width, height) {
        const bytesPerTile = 6;
        const expectedSize = width * height * bytesPerTile;
        if (mapData.length < expectedSize) {
            console.log(`[Proxy] MAP INJECT WARNING [${session.id}]: file ${mapData.length}b < expected ${expectedSize}b (${width}x${height})`);
        }
        console.log(`[Proxy] MAP INJECT [${session.id}]: sending ${height} rows of ${width} tiles (${width}x${height})`);
        for (let y = 0; y < height; y++) {
            const rowPacket = new packet_1.default(0x3C);
            // Row index (big-endian u16)
            rowPacket.writeUInt16(y);
            const rowOffset = y * width * bytesPerTile;
            for (let x = 0; x < width; x++) {
                const tileOffset = rowOffset + x * bytesPerTile;
                if (tileOffset + 5 < mapData.length) {
                    // Read little-endian u16 from file, write as big-endian u16 to packet
                    const bg = mapData.readUInt16LE(tileOffset);
                    const xfg = mapData.readUInt16LE(tileOffset + 2);
                    const yfg = mapData.readUInt16LE(tileOffset + 4);
                    rowPacket.writeUInt16(bg);
                    rowPacket.writeUInt16(xfg);
                    rowPacket.writeUInt16(yfg);
                }
                else {
                    // Pad with empty tiles if file is shorter than expected
                    rowPacket.writeUInt16(0);
                    rowPacket.writeUInt16(0);
                    rowPacket.writeUInt16(0);
                }
            }
            this.sendToClient(session, rowPacket);
        }
        // Send 0x58 MapTransferComplete
        const completePacket = new packet_1.default(0x58);
        completePacket.writeByte(0x00);
        this.sendToClient(session, completePacket);
        // Clear the substitution flag and remember what we injected
        session.mapSubstitutionPending = false;
        session.lastInjectedMap = session.playerState.mapNumber;
        console.log(`[Proxy] MAP INJECT COMPLETE [${session.id}]: ${height} rows sent, cached as map ${session.lastInjectedMap}`);
    }
    // ─── Private ──────────────────────────────────────────────
    _handleClientConnection(clientSocket) {
        const sessionId = `proxy-${this._nextSessionId++}`;
        const session = new proxy_session_1.default(sessionId, clientSocket);
        this.sessions.set(sessionId, session);
        const clientAddr = `${clientSocket.remoteAddress}:${clientSocket.remotePort}`;
        console.log(`[Proxy] New client connection: ${clientAddr} → session ${sessionId}`);
        this.emit('session:new', session);
        // Check if this is a redirect reconnection
        const redirectSession = this._checkForRedirectReconnection(session);
        if (redirectSession) {
            this._handleRedirectReconnection(session, redirectSession);
            return; // _handleRedirectReconnection sets up its own data handlers
        }
        // Normal new connection - connect to real login server
        this._connectToRealServer(session, this.config.realServerAddress, this.config.realLoginPort);
        clientSocket.on('data', (data) => {
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
        clientSocket.on('error', (err) => {
            console.log(`[Proxy] Client socket error [${sessionId}]: ${err.message}`);
        });
    }
    _connectToRealServer(session, address, port) {
        const serverSocket = new net_1.default.Socket();
        session.serverSocket = serverSocket;
        serverSocket.connect(port, address, () => {
            console.log(`[Proxy] Connected to real server ${address}:${port} for session ${session.id}`);
        });
        serverSocket.on('data', (data) => {
            this._handleServerData(session, data);
        });
        serverSocket.on('close', () => {
            console.log(`[Proxy] Real server disconnected for session ${session.id}`);
            if (!session.destroyed && session.phase !== 'redirect') {
                this._destroySession(session);
            }
        });
        serverSocket.on('error', (err) => {
            console.log(`[Proxy] Server socket error [${session.id}]: ${err.message}`);
        });
    }
    /**
     * Handle raw data from the game CLIENT. Parse packets, decrypt, inspect, re-encrypt, forward to real server.
     * During login phase, forward raw bytes (both sides have same crypto params).
     * During game phase, decrypt/inspect/re-encrypt.
     */
    _handleClientData(session, data) {
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
     * If virtual → block (don't forward) + emit event.
     * If real → forward raw as normal.
     */
    _handleClientDataPassthrough(session, data) {
        // Parse packets to check for interception BEFORE forwarding
        let offset = 0;
        const buf = data;
        const blockedRanges = [];
        while (offset + 3 < buf.length && buf[offset] === 0xAA) {
            const length = (buf[offset + 1] << 8 | buf[offset + 2]) + 3;
            const opcode = buf[offset + 3];
            if (this.config.logPackets) {
                const label = (0, opcodes_1.getOpcodeLabel)('out', opcode);
                console.log(`[Proxy] Client → Server [${session.id}] 0x${opcode.toString(16).padStart(2, '0')} (${label}) [passthrough]`);
            }
            // Notify inspector for panel packet logging — decrypt body for capture
            if (this.inspector && this.inspector.onPacket) {
                const pkt = new packet_1.default(opcode);
                if (session.clientCrypto.name && (0, proxy_crypto_1.isEncryptOpcode)(opcode)) {
                    try {
                        const capPacket = new packet_1.default(Array.from(buf.slice(offset, offset + length)));
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
                this.inspector.onPacket(pkt, 'client-to-server', session);
            }
            // Detect refresh (0x38) - flag session so we inject NPCs after server finishes
            if (opcode === 0x38) {
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
            // (Custom legend injection moved to server→client 0x39 path below)
            // Intercept 0x43 (Interact) - client clicks on entity
            // Decrypt a copy to read the target entity ID
            if (opcode === 0x43 && session.clientCrypto.name && length > 4) {
                try {
                    const rawPacket = buf.slice(offset, offset + length);
                    const peekPacket = new packet_1.default(Array.from(rawPacket));
                    session.clientCrypto.decryptClientPacket(peekPacket);
                    // After decrypt: body[0] = InteractionType (1=Entity), body[1..4] = TargetId
                    if (peekPacket.body.length >= 5 && peekPacket.body[0] === 1) {
                        const targetId = ((peekPacket.body[1] << 24) | (peekPacket.body[2] << 16) | (peekPacket.body[3] << 8) | peekPacket.body[4]) >>> 0;
                        console.log(`[Proxy] 0x43 entity click → targetId=0x${targetId.toString(16)}`);
                        if (targetId >= 0xF0000000) {
                            // Virtual entity click - BLOCK from reaching real server
                            console.log(`[Proxy] BLOCKED 0x43 Interact → virtual entity 0x${targetId.toString(16)} from ${session.characterName}`);
                            blockedRanges.push({ start: offset, end: offset + length });
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
                    const peekPacket = new packet_1.default(Array.from(rawPacket));
                    session.clientCrypto.decryptClientPacket(peekPacket);
                    const dialogBody = decryptDialogPayload(peekPacket.body);
                    if (dialogBody && dialogBody.length >= 7) {
                        const entityId = ((dialogBody[1] << 24) | (dialogBody[2] << 16) | (dialogBody[3] << 8) | dialogBody[4]) >>> 0;
                        if (entityId >= 0xF0000000) {
                            const pursuitId = (dialogBody[5] << 8) | dialogBody[6];
                            blockedRanges.push({ start: offset, end: offset + length });
                            // Read String8 at position [7] — present for both ItemChoices and TextInput responses
                            let argText = '';
                            if (dialogBody.length > 7) {
                                const strLen = dialogBody[7];
                                if (strLen > 0 && dialogBody.length >= 8 + strLen) {
                                    argText = Buffer.from(dialogBody.slice(8, 8 + strLen)).toString('utf8');
                                }
                            }
                            if (argText) {
                                // Has text argument — could be item name (ItemChoices) or typed text (TextInput)
                                console.log(`[Proxy] BLOCKED 0x39 TextInput → virtual 0x${entityId.toString(16)} pursuit=${pursuitId} text="${argText}"`);
                                this.emit('virtual:textInput', session, entityId, pursuitId, argText);
                            }
                            else {
                                // No text — plain menu choice, slot is at position [7]
                                const slot = dialogBody.length > 7 ? dialogBody[7] : 0;
                                console.log(`[Proxy] BLOCKED 0x39 MenuChoice → virtual 0x${entityId.toString(16)} pursuit=${pursuitId} slot=${slot}`);
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
                    const peekPacket = new packet_1.default(Array.from(rawPacket));
                    session.clientCrypto.decryptClientPacket(peekPacket);
                    const dialogBody = decryptDialogPayload(peekPacket.body);
                    if (dialogBody && dialogBody.length >= 9) {
                        const entityId = ((dialogBody[1] << 24) | (dialogBody[2] << 16) | (dialogBody[3] << 8) | dialogBody[4]) >>> 0;
                        if (entityId >= 0xF0000000) {
                            const pursuitId = (dialogBody[5] << 8) | dialogBody[6];
                            const stepId = (dialogBody[7] << 8) | dialogBody[8];
                            const argsType = dialogBody.length > 9 ? dialogBody[9] : 0;
                            blockedRanges.push({ start: offset, end: offset + length });
                            if (argsType === 1 && dialogBody.length > 10) {
                                // Menu choice — slot is at position [10], 1-based from client
                                const rawSlot = dialogBody[10];
                                const slot = rawSlot > 0 ? rawSlot - 1 : 0;
                                console.log(`[Proxy] BLOCKED 0x3A MenuChoice → virtual 0x${entityId.toString(16)} pursuit=${pursuitId} step=${stepId} rawSlot=${rawSlot} slot=${slot}`);
                                this.emit('virtual:menuChoice', session, entityId, pursuitId, slot);
                            }
                            else if (argsType === 2 && dialogBody.length > 10) {
                                // Text input — read String8 at position [10]
                                const textLen = dialogBody[10];
                                let text = '';
                                if (textLen > 0 && dialogBody.length > 11 + textLen - 1) {
                                    text = Buffer.from(dialogBody.slice(11, 11 + textLen)).toString('utf8');
                                }
                                console.log(`[Proxy] BLOCKED 0x3A TextInput → virtual 0x${entityId.toString(16)} pursuit=${pursuitId} text="${text}"`);
                                this.emit('virtual:textInput', session, entityId, pursuitId, text);
                            }
                            else {
                                // Next/prev or no args — treat as dialog navigation
                                console.log(`[Proxy] BLOCKED 0x3A DialogChoice → virtual 0x${entityId.toString(16)} pursuit=${pursuitId} step=${stepId} argsType=${argsType}`);
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
                    const peekPacket = new packet_1.default(Array.from(rawPacket));
                    session.clientCrypto.decryptClientPacket(peekPacket);
                    if (peekPacket.body.length >= 2) {
                        const messageType = peekPacket.body[0];
                        // Only intercept Say messages (type 0) starting with '/'
                        if (messageType === 0) {
                            peekPacket.position = 1;
                            const message = peekPacket.readString8();
                            if (message.startsWith('/')) {
                                console.log(`[Proxy] BLOCKED 0x0E Chat → slash command "${message}" from ${session.characterName}`);
                                blockedRanges.push({ start: offset, end: offset + length });
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
                    const peekPacket = new packet_1.default(Array.from(rawPacket));
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
                                // Virtual board — block from reaching real server
                                blockedRanges.push({ start: offset, end: offset + length });
                                if (action === 1) {
                                    const startPostId = peekPacket.remainder() >= 2 ? peekPacket.readInt16() : 0;
                                    console.log(`[Proxy] BLOCKED 0x3B ViewBoard → virtual board 0x${boardId.toString(16)} startPostId=${startPostId} from ${session.characterName}`);
                                    this.emit('virtual:viewBoard', session, boardId, startPostId);
                                }
                                else {
                                    const postId = peekPacket.remainder() >= 2 ? peekPacket.readInt16() : 0;
                                    const navigation = peekPacket.remainder() >= 1 ? (peekPacket.readByte() << 24 >> 24) : 0;
                                    console.log(`[Proxy] BLOCKED 0x3B ViewPost → virtual board 0x${boardId.toString(16)} postId=${postId} nav=${navigation} from ${session.characterName}`);
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
                    // Block movement, action, spell, and skill opcodes
                    // 0x06=Walk, 0x11=Turn, 0x13=Attack, 0x0F=CastSpell, 0x1C=UseItem,
                    // 0x24=DropItem, 0x29=Throw, 0x4D=BeginChant, 0x4E=Chant, 0x3E=UseSkill
                    if (opcode === 0x06 || opcode === 0x11 || opcode === 0x13 ||
                        opcode === 0x0F || opcode === 0x1C || opcode === 0x24 || opcode === 0x29 ||
                        opcode === 0x4D || opcode === 0x4E || opcode === 0x3E) {
                        blockedRanges.push({ start: offset, end: offset + length });
                        if (session.clientCrypto.name && length > 4) {
                            try {
                                const rawPacket = buf.slice(offset, offset + length);
                                const peekPacket = new packet_1.default(Array.from(rawPacket));
                                session.clientCrypto.decryptClientPacket(peekPacket);
                                if (opcode === 0x06) {
                                    // Walk: simulate locally
                                    this.emit('afk:walk', session, peekPacket.body[0]);
                                }
                                else if (opcode === 0x11 && peekPacket.body.length >= 1) {
                                    // Turn: [Direction:1]
                                    this.emit('afk:turn', session, peekPacket.body[0]);
                                }
                                else if (opcode === 0x0F && peekPacket.body.length >= 1) {
                                    // CastSpell: [Slot:1] [TargetId?:4] [TargetX?:2] [TargetY?:2]
                                    this.emit('afk:castSpell', session, peekPacket.body[0], [...peekPacket.body]);
                                }
                                else if (opcode === 0x3E && peekPacket.body.length >= 1) {
                                    // UseSkill: [Slot:1]
                                    this.emit('afk:useSkill', session, peekPacket.body[0]);
                                }
                                else if (opcode === 0x13) {
                                    // Assail
                                    this.emit('afk:assail', session);
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
                                const peekPacket = new packet_1.default(Array.from(rawPacket));
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
                        blockedRanges.push({ start: offset, end: offset + length });
                    }
                }
            }
            // Track and re-sequence client→server encrypted packets.
            if ((0, proxy_crypto_1.isEncryptOpcode)(opcode) && length > 4) {
                const isBlocked = blockedRanges.some(r => r.start === offset);
                if (isBlocked) {
                    // Blocked packets create an ordinal gap — enable resequencing
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
                        const rePacket = new packet_1.default(Array.from(rawSlice));
                        session.serverCrypto.decryptClientPacket(rePacket);
                        rePacket.sequence = session.nextServerSeq();
                        session.serverCrypto.encrypt(rePacket);
                        // Block original, send re-encrypted version directly
                        blockedRanges.push({ start: offset, end: offset + length });
                        if (session.serverSocket && !session.serverSocket.destroyed) {
                            session.serverSocket.write(rePacket.buffer());
                        }
                    }
                    else {
                        // No injection yet — forward raw, sync our counter from client's ordinal
                        session.serverEncryptSeq = (0, datatypes_1.uint8)(buf[offset + 4] + 1);
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
            const chunks = [];
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
    _handleServerData(session, data) {
        // Forward raw bytes and intercept unencrypted protocol packets.
        this._handleServerDataPassthrough(session, data);
        return;
        // TODO: Full decrypt/inspect/re-encrypt mode for when we need to modify game packets
    }
    /**
     * During login phase, forward raw server bytes to client.
     * Intercept unencrypted protocol packets: 0x00 (read crypto params), 0x03 (rewrite redirect).
     */
    _handleServerDataPassthrough(session, data) {
        session.serverBuffer.push(data);
        let buffer = Buffer.concat(session.serverBuffer.splice(0));
        while (buffer.length > 3 && buffer[0] === 0xAA) {
            const length = (buffer[1] << 8 | buffer[2]) + 3;
            if (length > buffer.length) {
                session.serverBuffer.push(buffer);
                break;
            }
            const rawPacket = buffer.slice(0, length);
            const opcode = rawPacket[3];
            if (this.config.logPackets) {
                const label = (0, opcodes_1.getOpcodeLabel)('in', opcode);
                console.log(`[Proxy] Server → Client [${session.id}] 0x${opcode.toString(16).padStart(2, '0')} (${label}) [passthrough]`);
            }
            // Notify inspector for panel packet logging — decrypt body for capture
            if (this.inspector && this.inspector.onPacket) {
                const pkt = new packet_1.default(opcode);
                // Try to provide decrypted body for capture
                if (session.clientCrypto.name && (0, proxy_crypto_1.isDecryptOpcode)(opcode)) {
                    try {
                        const capPacket = new packet_1.default(Array.from(rawPacket));
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
                this.inspector.onPacket(pkt, 'server-to-client', session);
            }
            if (opcode === 0x00) {
                // Encryption packet - parse to read seed/key, then forward raw
                const packet = new packet_1.default(Array.from(rawPacket));
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
                const packet = new packet_1.default(Array.from(rawPacket));
                this._handleRedirect(session, packet);
            }
            else if (opcode === 0x02) {
                // LoginResult - forward raw, peek for logging
                const packet = new packet_1.default(Array.from(rawPacket));
                // 0x02 is static-key encrypted from server, just forward raw
                if (session.clientSocket && !session.clientSocket.destroyed) {
                    session.clientSocket.write(rawPacket);
                }
            }
            else {
                // Map substitution: intercept 0x15 (MapInfo) and rewrite the map number
                // before forwarding, so the client loads our custom map file instead.
                let forwarded = false;
                let substitutedMapNumber;
                if (opcode === 0x15 && session.clientCrypto.name && Object.keys(this.config.mapSubstitutions).length > 0) {
                    try {
                        const modPacket = new packet_1.default(Array.from(rawPacket));
                        session.clientCrypto.decrypt(modPacket);
                        const originalMapNumber = (modPacket.body[0] << 8) | modPacket.body[1];
                        const replacement = this.config.mapSubstitutions[originalMapNumber];
                        if (replacement !== undefined) {
                            const mapInfo = this.getMapFileInfo(replacement);
                            const alreadyCached = false; // Always re-inject — cache can go stale after AFK exit or throw/teleport
                            // Body layout: [0-1]=mapNum [2]=wLo [3]=hLo [4]=flags [5]=wHi [6]=hHi [7-8]=checksum [9..]=name
                            // Rewrite the map number (first 2 bytes of body, big-endian)
                            modPacket.body[0] = (replacement >> 8) & 0xFF;
                            modPacket.body[1] = replacement & 0xFF;
                            if (alreadyCached && mapInfo) {
                                // Client already has our custom tiles cached from a previous injection.
                                // Send the REAL checksum so the client reuses its cache — no re-download needed.
                                modPacket.body[7] = (mapInfo.checksum >> 8) & 0xFF;
                                modPacket.body[8] = mapInfo.checksum & 0xFF;
                                console.log(`[Proxy] MAP SUBSTITUTION [${session.id}]: map ${originalMapNumber} → ${replacement} (cached, skipping tile injection)`);
                            }
                            else if (mapInfo) {
                                // First time — send INVALID checksum to force client to discard cache
                                // and accept our injected tile data.
                                const invalidChecksum = mapInfo.checksum ^ 0xFFFF;
                                modPacket.body[7] = (invalidChecksum >> 8) & 0xFF;
                                modPacket.body[8] = invalidChecksum & 0xFF;
                                console.log(`[Proxy] MAP SUBSTITUTION [${session.id}]: map ${originalMapNumber} → ${replacement} (forcing tile download, file=${mapInfo.data.length}b)`);
                            }
                            substitutedMapNumber = replacement;
                            // Read the map dimensions from the packet so we know how to slice the file
                            const widthLo = modPacket.body[2];
                            const heightLo = modPacket.body[3];
                            const widthHi = modPacket.body[5];
                            const heightHi = modPacket.body[6];
                            const mapWidth = (widthHi << 8) | widthLo;
                            const mapHeight = (heightHi << 8) | heightLo;
                            // Re-encrypt and forward the modified 0x15 packet
                            modPacket.sequence = session.nextClientSeq();
                            session.clientCrypto.encryptServerPacket(modPacket);
                            if (session.clientSocket && !session.clientSocket.destroyed) {
                                session.clientSocket.write(modPacket.buffer());
                            }
                            forwarded = true;
                            if (!alreadyCached) {
                                // Flag session to block real server's 0x3C/0x58 and inject ours
                                // after the server sends 0x58 (MapTransferComplete).
                                session.mapSubstitutionPending = true;
                                session.pendingMapInjection = mapInfo && mapInfo.data.length > 0
                                    ? { data: mapInfo.data, width: mapWidth, height: mapHeight }
                                    : null;
                            }
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
                        const modPacket = new packet_1.default(Array.from(rawPacket));
                        session.clientCrypto.decrypt(modPacket);
                        const resultType = modPacket.body[0];
                        if (resultType === 0x01) {
                            // ResultType 1 = BoardList: [ResultType:1=0x01] [BoardCount:2] per board: [BoardId:2] [BoardName:String8]
                            // Inject our virtual board(s) at the end
                            const boardCountHi = modPacket.body[1];
                            const boardCountLo = modPacket.body[2];
                            const originalCount = (boardCountHi << 8) | boardCountLo;
                            // Build virtual board entries to inject
                            const virtualBoards = [];
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
                                console.log(`[Proxy] BOARD LIST INJECTION [${session.id}]: ${originalCount} → ${newCount} boards (added ${virtualBoards.length} virtual)`);
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
                // ── 0x33 (ShowUser) patching: name tags + disguise ──
                // Combines nametag style patching and disguise appearance patching
                // on the same decrypted packet to avoid double-decrypt issues.
                if (!forwarded && opcode === 0x33 && session.clientCrypto.name) {
                    const wantNameTag = this.registry && this.config.nameTags && this.config.nameTags.enabled;
                    const wantDisguise = this.config.disguise && this.config.disguise.enabled && this.getPlayerDisguise;
                    if (wantNameTag || wantDisguise) {
                        try {
                            const modPacket = new packet_1.default(Array.from(rawPacket));
                            session.clientCrypto.decrypt(modPacket);
                            const body = modPacket.body;
                            let patched = false;
                            if (body.length >= 20) {
                                const serial = (body[5] << 24 | body[6] << 16 | body[7] << 8 | body[8]) >>> 0;
                                const headSprite = (body[9] << 8) | body[10];
                                const isNormalForm = headSprite !== 0xFFFF;
                                // ── NameTag patching ──
                                if (wantNameTag && this.registry) {
                                    const proxyPlayer = this.registry.getPlayerBySerial(serial);
                                    const isSelf = serial === session.playerState.serial ||
                                        (proxyPlayer && proxyPlayer.characterName === session.characterName) ||
                                        (proxyPlayer && proxyPlayer.sessionId === session.id);
                                    if (proxyPlayer && !isSelf) {
                                        const styleOffset = isNormalForm ? 39 : 21;
                                        if (styleOffset < body.length) {
                                            const oldStyle = body[styleOffset];
                                            body[styleOffset] = this.config.nameTags.nameStyle;
                                            patched = true;
                                            console.log(`[Proxy] NameTag: patched 0x33 serial=0x${serial.toString(16)} style ${oldStyle}→${this.config.nameTags.nameStyle} (${isNormalForm ? 'normal' : 'monster'} form)`);
                                        }
                                    }
                                }
                                // ── Disguise patching (per-player) ──
                                if (wantDisguise && isNormalForm && body.length >= 42) {
                                    const nameLen = body[40];
                                    if (nameLen > 0 && nameLen < 30 && 40 + 1 + nameLen <= body.length) {
                                        const nameBuf = body.slice(41, 41 + nameLen);
                                        const charName = Buffer.from(nameBuf).toString('latin1');
                                        const d = this.getPlayerDisguise(charName);
                                        if (d && d.enabled) {
                                            const sprite = d.overcoatSprite != null ? d.overcoatSprite : 0;
                                            const color = d.overcoatColor != null ? d.overcoatColor : 0;
                                            if (sprite > 0) {
                                                body[33] = (sprite >> 8) & 0xFF;
                                                body[34] = sprite & 0xFF;
                                                body[35] = color;
                                                patched = true;
                                                console.log(`[Proxy] Disguise: patched 0x33 for ${charName} → overcoat=${sprite} color=${color}`);
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
                // ── Disguise: patch 0x34 (UserProfile) for target player ──
                // 0x34: [EntityId:u32] [18 equip×3] [Status:1] [Name:S8] [Nation:1]
                //        [Title:S8] [IsGroupOpen:1] [GuildRank:S8] [DisplayClass:S8] [Guild:S8] ...
                if (!forwarded && opcode === 0x34 && session.clientCrypto.name &&
                    this.config.disguise && this.config.disguise.enabled && this.getPlayerDisguise) {
                    try {
                        const modPacket = new packet_1.default(Array.from(rawPacket));
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
                                    const rebuilt = new packet_1.default(modPacket.opcode);
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
                // ── Append custom proxy legend marks to 0x34 (PlayerProfile) ──
                // 0x34: [EntityId:4] [18equip×3=54] [Status:1] [Name:S8] [Nation:1]
                //        [Title:S8] [IsGroupOpen:1] [GuildRank:S8] [DisplayClass:S8]
                //        [Guild:S8] [LegendCount:1] [marks...]
                if (!forwarded && opcode === 0x34 && session.clientCrypto.name && session.characterName) {
                    try {
                        const modPacket = new packet_1.default(Array.from(rawPacket));
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
                                    const origMarks = Buffer.from(body.slice(pos + 1));
                                    const customParts = [];
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
                                    const rebuilt = new packet_1.default(modPacket.opcode);
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
                // ── Disguise: patch 0x39 (SelfProfile) for target player ──
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
                        const modPacket = new packet_1.default(Array.from(rawPacket));
                        session.clientCrypto.decrypt(modPacket);
                        const body = modPacket.body;
                        if (body.length >= 6) {
                            const d = _selfDisguise;
                            // Collect replacement points: {start, end, replacement}
                            const patches = [];
                            let pos = 1; // skip Nation
                            // GuildRank (String8)
                            const grStart = pos;
                            const oldGRLen = body[pos]; pos += 1 + oldGRLen;
                            patches.push({ start: grStart, end: pos, buf: Buffer.from(d.guildRank, 'latin1') });
                            // Title (String8)
                            const tStart = pos;
                            const oldTLen = body[pos]; pos += 1 + oldTLen;
                            patches.push({ start: tStart, end: pos, buf: Buffer.from(d.title, 'latin1') });
                            // GroupMembers (String8) — keep as-is
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
                            const parts = [];
                            let cursor = 0;
                            for (const p of patches) {
                                parts.push(Buffer.from(body.slice(cursor, p.start)));
                                parts.push(Buffer.from([p.buf.length]));
                                parts.push(p.buf);
                                cursor = p.end;
                            }
                            parts.push(Buffer.from(body.slice(cursor)));
                            const newBody = Buffer.concat(parts);
                            const rebuilt = new packet_1.default(modPacket.opcode);
                            rebuilt.body = Array.from(newBody);
                            rebuilt.sequence = session.nextClientSeq();
                            session.clientCrypto.encryptServerPacket(rebuilt);
                            if (session.clientSocket && !session.clientSocket.destroyed) {
                                session.clientSocket.write(rebuilt.buffer());
                            }
                            forwarded = true;
                            session._cachedSelfProfileBody = Array.from(newBody);
                            console.log(`[Proxy] Disguise: patched 0x39 self-profile`);
                        }
                    }
                    catch (e) {
                        console.log(`[Proxy] Disguise: 0x39 patch failed: ${e}`);
                    }
                    }
                }
                // (Custom legends are appended to 0x39 SelfProfile in server→client path below)
                // ── Disguise: patch 0x36 (WorldList) — custom ordering with sections ──
                if (!forwarded && opcode === 0x36 && session.clientCrypto.name &&
                    this.config.disguise && this.config.disguise.enabled && this.getPlayerDisguise) {
                    try {
                        const modPacket = new packet_1.default(Array.from(rawPacket));
                        session.clientCrypto.decrypt(modPacket);
                        const body = modPacket.body;
                        // 0x36: [WorldCount:u16] [CountryCount:u16] then per entry:
                        //   [ClassWithFlags:1] [Color:1] [Status:1] [Title:String8] [IsMaster:1] [Name:String8]
                        if (body.length >= 4) {
                            const count = (body[0] << 8) | body[1];
                            let pos = 4;
                            // Get proxy player names
                            const proxyNames = new Set();
                            if (this.registry) {
                                for (const p of this.registry.getAllPlayers()) {
                                    if (p.characterName) proxyNames.add(p.characterName);
                                }
                            }
                            // Parse all entries
                            const entries = [];
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
                                const ed = this.getPlayerDisguise(e.name);
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
                                function makeSpacer(titleText) {
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
                                const disguisedBufs = [];
                                const proxyBufs = [];
                                const otherBufs = [];
                                for (let i = 0; i < entries.length; i++) {
                                    const ed = this.getPlayerDisguise(entries[i].name);
                                    if (ed && ed.enabled) {
                                        disguisedBufs.push(entryBuffers[i]);
                                    } else if (proxyNames.has(entries[i].name)) {
                                        proxyBufs.push(entryBuffers[i]);
                                    } else {
                                        otherBufs.push(entryBuffers[i]);
                                    }
                                }
                                const ordered = [aeHeader, ...disguisedBufs];
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
                                const rebuilt = new packet_1.default(modPacket.opcode);
                                rebuilt.body = Array.from(newBody);
                                rebuilt.sequence = session.nextClientSeq();
                                session.clientCrypto.encryptServerPacket(rebuilt);
                                if (session.clientSocket && !session.clientSocket.destroyed) {
                                    session.clientSocket.write(rebuilt.buffer());
                                }
                                forwarded = true;
                                console.log(`[Proxy] Disguise: patched 0x36 — ${disguisedBufs.length} disguised, ${proxyBufs.length} proxy, ${otherBufs.length} others`);
                            }
                        }
                    }
                    catch (e) {
                        console.log(`[Proxy] Disguise: 0x36 patch failed: ${e}`);
                    }
                }
                // Block real server's 0x3C (MapTransfer) while map substitution is pending.
                if (!forwarded && session.mapSubstitutionPending && opcode === 0x3C) {
                    forwarded = true; // suppress real tile data
                }
                // When the real server sends 0x58 (MapTransferComplete) and we have pending
                // tile injection, block the real 0x58 and inject our custom tiles + our own 0x58.
                // By this point the client has received 0x15, 0x04 (position), entities, etc.
                if (!forwarded && session.mapSubstitutionPending && session.pendingMapInjection && opcode === 0x58) {
                    forwarded = true; // block real 0x58
                    const injection = session.pendingMapInjection;
                    session.pendingMapInjection = null;
                    session.mapSubstitutionPending = false;
                    this._injectMapTileData(session, injection.data, injection.width, injection.height);
                }
                // AFK Shadow Mode: block real server position/entity updates from reaching client
                if (!forwarded && session.afkState?.active) {
                    const AFK_SERVER_BLOCKED = [0x04, 0x0B, 0x07, 0x0C, 0x0E, 0x33];
                    if (AFK_SERVER_BLOCKED.includes(opcode)) {
                        forwarded = true; // suppress
                    }
                    // If server sends 0x15 (MapInfo) while AFK — server-initiated teleport → exit AFK
                    if (opcode === 0x15) {
                        this.emit('afk:serverMapChange', session);
                        // Don't block — let the map change flow through (afkState cleared by handler)
                    }
                }
                // ── Append custom proxy legend marks to 0x39 (SelfProfile) ──
                // Runs regardless of disguise — uses cached body if disguise already patched,
                // otherwise decrypts from raw. This ensures custom marks always appear.
                if (opcode === 0x39 && session.clientCrypto.name && session.characterName) {
                    let body = null;
                    const alreadyForwarded = forwarded;
                    try {
                        if (alreadyForwarded && session._cachedSelfProfileBody) {
                            // Disguise already processed — use the cached patched body
                            body = session._cachedSelfProfileBody;
                        }
                        else if (!alreadyForwarded) {
                            const modPacket = new packet_1.default(Array.from(rawPacket));
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
                                    const customParts = [];
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
                                    const rebuilt = new packet_1.default(0x39);
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
                // Forward everything else raw
                if (!forwarded && session.clientSocket && !session.clientSocket.destroyed) {
                    session.clientSocket.write(rawPacket);
                }
                // Track server→client sequence for encrypted opcodes so that
                // sendToClient() uses the next available sequence for injections.
                // The client reads the ordinal from each packet independently
                // (no monotonic enforcement), so injected packets with different
                // ordinals won't break the stream.
                if (!forwarded && (0, proxy_crypto_1.isDecryptOpcode)(opcode) && rawPacket.length > 4) {
                    session.clientEncryptSeq = (0, datatypes_1.uint8)(rawPacket[4] + 1);
                }
                // Detect 0x58 MapTransferComplete — signals map data is fully sent.
                // If a refresh is pending, this is the safe moment to inject virtual NPCs.
                if (opcode === 0x58 && session.refreshPending) {
                    session.refreshPending = false;
                    if (session.refreshFallbackTimer) {
                        clearTimeout(session.refreshFallbackTimer);
                        session.refreshFallbackTimer = null;
                    }
                    this.emit('player:refreshComplete', session);
                }
                // Selective decrypt for state tracking (decrypt a copy, forward original raw)
                // Skip position/entity tracking for AFK-blocked packets to preserve real position
                const AFK_SKIP_TRACKING = [0x04, 0x0B, 0x07, 0x0C, 0x0E, 0x33];
                const skipForAfk = session.afkState?.active && AFK_SKIP_TRACKING.includes(opcode);
                const TRACKED_OPCODES = [0x04, 0x05, 0x07, 0x08, 0x0B, 0x0C, 0x0E, 0x0F, 0x10, 0x13, 0x15, 0x17, 0x18, 0x29, 0x2C, 0x2D, 0x2E, 0x33, 0x3A, 0x3C];
                if (TRACKED_OPCODES.includes(opcode) && session.clientCrypto.name && !skipForAfk) {
                    try {
                        const peekPacket = new packet_1.default(Array.from(rawPacket));
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
                        else if (opcode === 0x04) { // MapLocation (forced position set — charge/ambush/warp)
                            session.playerState.x = peekPacket.readUInt16();
                            session.playerState.y = peekPacket.readUInt16();
                            this.emit('player:position', session);
                            this.emit('player:teleport', session);
                        }
                        else if (opcode === 0x0B) { // WalkResponse
                            const dir = peekPacket.readByte();
                            const prevX = peekPacket.readUInt16();
                            const prevY = peekPacket.readUInt16();
                            // Update player position from walk — direction: 0=up(-y), 1=right(+x), 2=down(+y), 3=left(-x)
                            const walkDx = dir === 1 ? 1 : dir === 3 ? -1 : 0;
                            const walkDy = dir === 0 ? -1 : dir === 2 ? 1 : 0;
                            session.playerState.x = prevX + walkDx;
                            session.playerState.y = prevY + walkDy;
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
                            // Stats packet has variable format; track HP/MP from the common fields
                            const flags = peekPacket.readByte();
                            if (flags === 1 && peekPacket.body.length >= 37) {
                                // Full stat update — skip to HP/MP fields
                                // Format: [Flags:1] [Level:1] [Ability:1] [MaxHP:4] [MaxMP:4] [STR:1]... [HP:4] [MP:4]...
                                peekPacket.position = 1; // skip flags
                                session.playerState.level = peekPacket.readByte(); // level
                                peekPacket.readByte(); // ability
                                session.playerState.maxHp = peekPacket.readUInt32();
                                session.playerState.maxMp = peekPacket.readUInt32();
                                peekPacket.read(6); // STR, INT, WIS, CON, DEX, (stat points available)
                                peekPacket.readByte(); // stat points
                                session.playerState.hp = peekPacket.readUInt32();
                                session.playerState.mp = peekPacket.readUInt32();
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
                        else if (opcode === 0x07) { // AddEntity (DisplayVisibleEntities / NPCs / Items)
                            // Format: [X:u16] [Y:u16] [Serial:u32] [Image:u16] [Color?:u8] [Dir:u8] [Padding:u8] [Type:u8] [Name?:String8]
                            // Type: 0x00=monster/NPC, 0x01=item on ground, 0x02=unknown
                            if (peekPacket.body.length >= 8) {
                                const ex = peekPacket.readUInt16();
                                const ey = peekPacket.readUInt16();
                                const eid = peekPacket.readUInt32();
                                const eimage = peekPacket.remainder() >= 2 ? peekPacket.readUInt16() : 0;
                                // Skip color/padding/direction bytes to get to type
                                let ecolor = 0, edir = 0, epadding = 0, etype = 0;
                                let ename = '';
                                if (peekPacket.remainder() >= 1)
                                    ecolor = peekPacket.readByte();
                                if (peekPacket.remainder() >= 1)
                                    edir = peekPacket.readByte();
                                if (peekPacket.remainder() >= 1)
                                    epadding = peekPacket.readByte();
                                if (peekPacket.remainder() >= 1)
                                    etype = peekPacket.readByte();
                                if (peekPacket.remainder() >= 1)
                                    ename = peekPacket.readString8();
                                this.emit('entity:add', session, eid, ex, ey, eimage, ename, edir, etype);
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
                                const nodes = [];
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
                            catch (e) { /* parse error — ignore */ }
                        }
                        else if (opcode === 0x0F) { // AddItem (inventory)
                            // Per DARKAGES-PROTOCOL.md: [Slot:1] [Sprite:2] [Color:1] [Name:String8] [Quantity:4] [Stackable:1]
                            const slot = peekPacket.readByte();
                            const sprite = peekPacket.readUInt16();
                            const color = peekPacket.readByte();
                            const name = peekPacket.readString8();
                            const quantity = peekPacket.readUInt32();
                            const stackable = peekPacket.readByte() !== 0;
                            session.playerState.inventory.set(slot, { slot, sprite, color, name, quantity, stackable });
                        }
                        else if (opcode === 0x10) { // RemoveItem (inventory)
                            // Per DARKAGES-PROTOCOL.md: [Slot:1]
                            const slot = peekPacket.readByte();
                            session.playerState.inventory.delete(slot);
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
                                const icons = [];
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
    _interceptServerPacket(session, packet) {
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
    _handleEncryption(session, packet) {
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
    _handleRedirect(session, packet) {
        // Parse the redirect
        const addressBytes = packet.read(4);
        const port = packet.readUInt16();
        const remainingCount = packet.readByte();
        const seed = packet.readByte();
        const key = packet.readString8();
        const name = packet.readString8();
        const id = packet.readUInt32();
        // Build the real address
        const realAddress = [...addressBytes].reverse().join('.');
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
        const rewritePacket = new packet_1.default(0x03);
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
    _handleUserId(session, packet) {
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
    _prepareForReconnect(session) {
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
    _checkForRedirectReconnection(session) {
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
    _handleRedirectReconnection(newSession, redirectSession) {
        const redirect = redirectSession.pendingRedirect;
        console.log(`[Proxy] Redirect reconnection detected [${newSession.id}] for char "${redirect.name}" → ${redirect.address}:${redirect.port}`);
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
        let pendingClientData = [];
        newSession.clientSocket.on('data', (data) => {
            newSession.lastActivity = new Date();
            if (serverReady) {
                this._handleClientData(newSession, data);
            }
            else {
                pendingClientData.push(data);
            }
        });
        newSession.clientSocket.on('close', () => {
            console.log(`[Proxy] Client disconnected: ${newSession.id} (phase=${newSession.phase})`);
            if (newSession.phase !== 'redirect') {
                this._destroySession(newSession);
            }
        });
        newSession.clientSocket.on('error', (err) => {
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
    _forwardToServer(session, packet) {
        if (!session.serverSocket || session.serverSocket.destroyed)
            return;
        // Re-encrypt for the server (client->server direction)
        if ((0, proxy_crypto_1.isEncryptOpcode)(packet.opcode)) {
            packet.sequence = session.nextServerSeq();
        }
        session.serverCrypto.encrypt(packet);
        session.serverSocket.write(packet.buffer());
    }
    /**
     * Re-encrypt and forward a decrypted packet to the client.
     */
    _forwardToClient(session, packet) {
        if (!session.clientSocket || session.clientSocket.destroyed)
            return;
        // Re-encrypt for the client (server->client direction)
        if ((0, proxy_crypto_1.isDecryptOpcode)(packet.opcode)) {
            packet.sequence = session.nextClientSeq();
            session.clientCrypto.encryptServerPacket(packet);
        }
        session.clientSocket.write(packet.buffer());
    }
    /**
     * Forward a packet to the client without re-encrypting (for unencrypted opcodes like 0x00, 0x03, 0x7E).
     */
    _forwardToClientRaw(session, packet) {
        if (!session.clientSocket || session.clientSocket.destroyed)
            return;
        session.clientSocket.write(packet.buffer());
    }
    _inspect(packet, direction, session) {
        if (!this.inspector) {
            return { action: 'forward' };
        }
        return this.inspector.inspect(packet, direction, session);
    }
    _destroySession(session) {
        if (session.destroyed)
            return;
        console.log(`[Proxy] Destroying session ${session.id} (${session.characterName || session.username || 'unknown'})`);
        this.sessions.delete(session.id);
        session.destroy();
        this.emit('session:end', session);
    }
}
exports.default = ProxyServer;
//# sourceMappingURL=proxy-server.js.map