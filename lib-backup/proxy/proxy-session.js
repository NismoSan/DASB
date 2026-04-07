"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const proxy_crypto_1 = __importDefault(require("./proxy-crypto"));
const datatypes_1 = require("../core/datatypes");
class ProxySession {
    id;
    clientSocket;
    serverSocket;
    clientCrypto;
    serverCrypto;
    clientEncryptSeq;
    serverEncryptSeq;
    /** When true, all client→server packets are decrypted and re-encrypted
     *  with corrected ordinals (needed after injecting server-bound packets). */
    resequenceServerBound;
    phase;
    username;
    characterName;
    pendingRedirect;
    playerState;
    connectedAt;
    lastActivity;
    clientBuffer;
    serverBuffer;
    destroyed;
    /** True between client 0x38 (refresh) and server 0x58 (map transfer complete) */
    refreshPending;
    refreshFallbackTimer;
    /** When set, the proxy is serving custom map tile data and must block the real
     *  server's 0x3C/0x58 packets until our injection is complete. */
    mapSubstitutionPending;
    /** Tile data waiting to be injected after the server finishes its map change sequence. */
    pendingMapInjection;
    /** The last replacement map number that was successfully injected into this client.
     *  Used to skip re-injection when the client already has our custom tiles cached. */
    lastInjectedMap;
    /** When non-null, the session is in AFK shadow mode. */
    afkState;
    /** Cached raw decrypted 0x33 body for the player's own character (for AFK mode replay). */
    lastSelfShowUser;
    constructor(id, clientSocket) {
        this.id = id;
        this.clientSocket = clientSocket;
        this.serverSocket = null;
        this.clientCrypto = new proxy_crypto_1.default();
        this.serverCrypto = new proxy_crypto_1.default();
        this.clientEncryptSeq = 0;
        this.serverEncryptSeq = 0;
        this.resequenceServerBound = false;
        this.phase = 'login';
        this.username = '';
        this.characterName = '';
        this.pendingRedirect = null;
        this.playerState = {
            x: 0, y: 0,
            mapNumber: 0, mapWidth: 0, mapHeight: 0,
            direction: 0, serial: 0,
            hp: 0, maxHp: 0, mp: 0, maxMp: 0,
            level: 0, className: 'Peasant', classId: 0,
            inventory: new Map(),
        };
        this.connectedAt = new Date();
        this.lastActivity = new Date();
        this.clientBuffer = [];
        this.serverBuffer = [];
        this.destroyed = false;
        this.refreshPending = false;
        this.refreshFallbackTimer = null;
        this.mapSubstitutionPending = false;
        this.pendingMapInjection = null;
        this.lastInjectedMap = null;
        this.afkState = null;
        this.lastSelfShowUser = null;
    }
    nextClientSeq() {
        const seq = this.clientEncryptSeq;
        this.clientEncryptSeq = (0, datatypes_1.uint8)(this.clientEncryptSeq + 1);
        return seq;
    }
    nextServerSeq() {
        const seq = this.serverEncryptSeq;
        this.serverEncryptSeq = (0, datatypes_1.uint8)(this.serverEncryptSeq + 1);
        return seq;
    }
    updateCrypto(seed, key, name) {
        this.clientCrypto = new proxy_crypto_1.default(seed, key, name);
        this.serverCrypto = new proxy_crypto_1.default(seed, key, name);
    }
    updateGameCrypto(clientSeed, clientKey, serverSeed, serverKey, name) {
        this.clientCrypto = new proxy_crypto_1.default(clientSeed, clientKey, name);
        this.serverCrypto = new proxy_crypto_1.default(serverSeed, serverKey, name);
    }
    destroy() {
        this.destroyed = true;
        if (this.refreshFallbackTimer) {
            clearTimeout(this.refreshFallbackTimer);
            this.refreshFallbackTimer = null;
        }
        if (this.clientSocket && !this.clientSocket.destroyed) {
            this.clientSocket.destroy();
        }
        if (this.serverSocket && !this.serverSocket.destroyed) {
            this.serverSocket.destroy();
        }
    }
}
exports.default = ProxySession;
//# sourceMappingURL=proxy-session.js.map