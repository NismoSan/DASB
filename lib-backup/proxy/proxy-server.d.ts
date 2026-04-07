import net from 'net';
import EventEmitter from 'events';
import ProxySession from './proxy-session';
import Packet from '../core/packet';
import type { PacketInspector } from './packet-inspector';
import type PlayerRegistry from './player-registry';
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
     *  e.g. { 1234: 9999 } → clients load map 9999 instead of 1234. */
    mapSubstitutions: Record<number, number>;
    /** Directory containing lod*.map files for checksum computation. */
    mapsDir: string;
    /** Name tag settings for proxy players. */
    nameTags: {
        enabled: boolean;
        /** nameDisplayStyle byte (0=NeutralHover, 1=Hostile, 2=FriendlyHover/persistent green, 3=Neutral). */
        nameStyle: number;
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
export default class ProxyServer extends EventEmitter {
    config: ProxyServerConfig;
    servers: net.Server[];
    sessions: Map<string, ProxySession>;
    inspector: PacketInspector | null;
    registry: PlayerRegistry | null;
    private _nextSessionId;
    private _mapFileCache;
    constructor(config?: Partial<ProxyServerConfig>);
    /**
     * Load a map file and compute its CRC16 checksum + dimensions.
     * Results are cached so the file is only read once per map number.
     */
    getMapFileInfo(mapNumber: number): MapFileInfo | null;
    /** Clear cached map file info (call after replacing a map file on disk). */
    clearMapFileCache(mapNumber?: number): void;
    setInspector(inspector: PacketInspector): void;
    start(): Promise<void>;
    private _listenOnPort;
    stop(): void;
    /**
     * Send a synthetic packet to a specific client session (server->client direction).
     * Used by augmentation engine to inject fake packets.
     */
    sendToClient(session: ProxySession, packet: Packet): void;
    /**
     * Send a synthetic packet to the real server on behalf of a session.
     */
    sendToServer(session: ProxySession, packet: Packet): void;
    /**
     * Inject replacement map tile data (0x3C rows + 0x58 complete) from a local .map file.
     * The .map file stores tiles in little-endian format (6 bytes per tile: bg:u16LE, xfg:u16LE, yfg:u16LE).
     * Network 0x3C packets use big-endian, so we byte-swap each u16 during injection.
     */
    _injectMapTileData(session: ProxySession, mapData: Buffer, width: number, height: number): void;
    private _handleClientConnection;
    private _connectToRealServer;
    /**
     * Handle raw data from the game CLIENT. Parse packets, decrypt, inspect, re-encrypt, forward to real server.
     * During login phase, forward raw bytes (both sides have same crypto params).
     * During game phase, decrypt/inspect/re-encrypt.
     */
    private _handleClientData;
    /**
     * During login phase, forward raw client bytes to real server.
     * Peek at unencrypted opcodes (0x00, 0x62) for logging only.
     *
     * For virtual entity interception: certain opcodes (0x43, 0x39, 0x3A)
     * are decrypted on a copy to check if they target a virtual entity.
     * If virtual → block (don't forward) + emit event.
     * If real → forward raw as normal.
     */
    private _handleClientDataPassthrough;
    /**
     * Handle raw data from the REAL SERVER. Parse packets, decrypt, inspect, re-encrypt, forward to client.
     * During login phase, forward raw bytes but intercept unencrypted protocol packets (0x00, 0x03, 0x7E).
     */
    private _handleServerData;
    /**
     * During login phase, forward raw server bytes to client.
     * Intercept unencrypted protocol packets: 0x00 (read crypto params), 0x03 (rewrite redirect).
     */
    private _handleServerDataPassthrough;
    /**
     * Intercept critical protocol packets that the proxy must handle itself.
     * Returns true if the packet was fully handled (should not be forwarded normally).
     */
    private _interceptServerPacket;
    /**
     * Handle the 0x00 Encryption packet from the real server.
     * We need to read the seed/key and set up crypto for both sides.
     */
    private _handleEncryption;
    /**
     * Handle the 0x03 Redirect packet from the real server.
     * This is the critical MITM point: we rewrite the address to point back to the proxy.
     */
    private _handleRedirect;
    /**
     * Handle 0x05 UserId - extract the serial for tracking.
     */
    private _handleUserId;
    /**
     * Prepare for client reconnection after redirect.
     * The client will drop its connection and reconnect to us on the same port.
     * We keep the session data so we can match the reconnection.
     */
    private _prepareForReconnect;
    /**
     * Called when a new client connects. Check if this is a redirect reconnection.
     */
    private _checkForRedirectReconnection;
    /**
     * Handle redirect reconnection. The client reconnects after getting a redirect.
     * Simply connect to the REAL game server and passthrough all bytes in both directions.
     * The client handles its own handshake with the game server.
     */
    private _handleRedirectReconnection;
    /**
     * Re-encrypt and forward a decrypted packet to the real server.
     */
    private _forwardToServer;
    /**
     * Re-encrypt and forward a decrypted packet to the client.
     */
    private _forwardToClient;
    /**
     * Forward a packet to the client without re-encrypting (for unencrypted opcodes like 0x00, 0x03, 0x7E).
     */
    private _forwardToClientRaw;
    private _inspect;
    private _destroySession;
}
export {};
