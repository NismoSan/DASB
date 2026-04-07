import net from 'net';
import ProxyCrypto from './proxy-crypto';
import { uint8 } from '../core/datatypes';

export interface InventoryItem {
    slot: number;
    sprite: number;
    color: number;
    name: string;
    quantity: number;
    stackable: boolean;
}

export interface EquippedItem {
    slot: number;
    sprite: number;
    color: number;
    name: string;
    maxDurability: number;
    durability: number;
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
    equipment: Map<number, EquippedItem>;
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
    /** Tile data for the currently active map substitution, used to respond to
     *  client 0x05 (RequestMapData) instead of letting the real server reply. */
    substitutedMapData: { data: Buffer; width: number; height: number } | null;
    /** The replacement map number whose custom tiles the client is currently displaying. */
    lastInjectedMap: number | null;
    /** Fallback timer: fires refreshComplete if client uses cached map (no 0x05 sent). */
    substitutedMapFallbackTimer: ReturnType<typeof setTimeout> | null;
    /** When non-null, the session is in AFK shadow mode. */
    afkState: AfkState | null;
    /** Cached raw decrypted 0x33 body for the player's own character (for AFK mode replay). */
    lastSelfShowUser: number[] | null;

    constructor(id: string, clientSocket: net.Socket) {
        this.id = id;
        this.clientSocket = clientSocket;
        this.serverSocket = null;
        this.clientCrypto = new ProxyCrypto();
        this.serverCrypto = new ProxyCrypto();
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
            equipment: new Map(),
        };
        this.connectedAt = new Date();
        this.lastActivity = new Date();
        this.clientBuffer = [];
        this.serverBuffer = [];
        this.destroyed = false;
        this.refreshPending = false;
        this.refreshFallbackTimer = null;
        this.substitutedMapData = null;
        this.lastInjectedMap = null;
        this.substitutedMapFallbackTimer = null;
        this.afkState = null;
        this.lastSelfShowUser = null;
    }

    nextClientSeq(): number {
        const seq = this.clientEncryptSeq;
        this.clientEncryptSeq = uint8(this.clientEncryptSeq + 1);
        return seq;
    }

    nextServerSeq(): number {
        const seq = this.serverEncryptSeq;
        this.serverEncryptSeq = uint8(this.serverEncryptSeq + 1);
        return seq;
    }

    updateCrypto(seed: number, key: string, name?: string): void {
        this.clientCrypto = new ProxyCrypto(seed, key, name);
        this.serverCrypto = new ProxyCrypto(seed, key, name);
    }

    updateGameCrypto(clientSeed: number, clientKey: string, serverSeed: number, serverKey: string, name: string): void {
        this.clientCrypto = new ProxyCrypto(clientSeed, clientKey, name);
        this.serverCrypto = new ProxyCrypto(serverSeed, serverKey, name);
    }

    destroy(): void {
        this.destroyed = true;
        if (this.refreshFallbackTimer) {
            clearTimeout(this.refreshFallbackTimer);
            this.refreshFallbackTimer = null;
        }
        if (this.substitutedMapFallbackTimer) {
            clearTimeout(this.substitutedMapFallbackTimer);
            this.substitutedMapFallbackTimer = null;
        }
        if (this.clientSocket && !this.clientSocket.destroyed) {
            this.clientSocket.destroy();
        }
        if (this.serverSocket && !this.serverSocket.destroyed) {
            this.serverSocket.destroy();
        }
    }
}
