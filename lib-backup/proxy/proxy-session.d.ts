import net from 'net';
import ProxyCrypto from './proxy-crypto';
export interface InventoryItem {
    slot: number;
    sprite: number;
    color: number;
    name: string;
    quantity: number;
    stackable: boolean;
}
export interface PlayerState {
    x: number;
    y: number;
    mapNumber: number;
    mapWidth: number;
    mapHeight: number;
    direction: number;
    serial: number;
    hp: number;
    maxHp: number;
    mp: number;
    maxMp: number;
    level: number;
    className: string;
    classId: number;
    inventory: Map<number, InventoryItem>;
}
export interface AfkState {
    active: boolean;
    realX: number;
    realY: number;
    realMapNumber: number;
    realMapWidth: number;
    realMapHeight: number;
    shadowX: number;
    shadowY: number;
    afkMapNumber: number;
    afkMapWidth: number;
    afkMapHeight: number;
    chatToServer: boolean;
    /** Throttle timestamps (Date.now()) */
    lastWalkTime: number;
    lastSpellTime: number;
    lastSkillTime: number;
    lastAssailTime: number;
    /** Per-slot cooldown expiry timestamps */
    spellCooldowns: Map<number, number>;
    skillCooldowns: Map<number, number>;
    /** MP regeneration interval handle */
    mpRegenTimer: ReturnType<typeof setInterval> | null;
    /** Shadow HP/MP for AFK world (separate from real server state) */
    shadowHp: number;
    shadowMp: number;
}
export interface RedirectInfo {
    address: string;
    port: number;
    seed: number;
    key: string;
    name: string;
    id: number;
}
export type SessionPhase = 'login' | 'redirect' | 'game';
export default class ProxySession {
    id: string;
    clientSocket: net.Socket;
    serverSocket: net.Socket | null;
    clientCrypto: ProxyCrypto;
    serverCrypto: ProxyCrypto;
    clientEncryptSeq: number;
    serverEncryptSeq: number;
    /** When true, all client→server packets are decrypted and re-encrypted
     *  with corrected ordinals (needed after injecting server-bound packets). */
    resequenceServerBound: boolean;
    phase: SessionPhase;
    username: string;
    characterName: string;
    pendingRedirect: RedirectInfo | null;
    playerState: PlayerState;
    connectedAt: Date;
    lastActivity: Date;
    clientBuffer: Buffer[];
    serverBuffer: Buffer[];
    destroyed: boolean;
    /** True between client 0x38 (refresh) and server 0x58 (map transfer complete) */
    refreshPending: boolean;
    refreshFallbackTimer: ReturnType<typeof setTimeout> | null;
    /** When set, the proxy is serving custom map tile data and must block the real
     *  server's 0x3C/0x58 packets until our injection is complete. */
    mapSubstitutionPending: boolean;
    /** Tile data waiting to be injected after the server finishes its map change sequence. */
    pendingMapInjection: {
        data: Buffer;
        width: number;
        height: number;
    } | null;
    /** The last replacement map number that was successfully injected into this client.
     *  Used to skip re-injection when the client already has our custom tiles cached. */
    lastInjectedMap: number | null;
    /** When non-null, the session is in AFK shadow mode. */
    afkState: AfkState | null;
    /** Cached raw decrypted 0x33 body for the player's own character (for AFK mode replay). */
    lastSelfShowUser: number[] | null;
    constructor(id: string, clientSocket: net.Socket);
    nextClientSeq(): number;
    nextServerSeq(): number;
    updateCrypto(seed: number, key: string, name?: string): void;
    updateGameCrypto(clientSeed: number, clientKey: string, serverSeed: number, serverKey: string, name: string): void;
    destroy(): void;
}
