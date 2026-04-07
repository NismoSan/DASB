import type ProxyServer from '../proxy-server';
import type ProxySession from '../proxy-session';
/**
 * Monitors for position desync between predicted and confirmed positions.
 * Sends periodic refresh packets to resync state.
 *
 * In Dark Ages, desync happens when:
 * - Walk packets are sent faster than server confirms
 * - Network lag causes position drift
 * - Server rejects a walk (blocked tile) but client already moved
 *
 * Solution: periodic F5-equivalent refresh packets (0x38) with randomized
 * timing between 1.2-2s (from Slowpoke's `refreshdelay`).
 */
export default class DesyncMonitor {
    private proxy;
    private session;
    private humanizer;
    /** Position we think we're at based on sent walk packets. */
    predictedX: number;
    predictedY: number;
    /** Position confirmed by server (0x04 MapLocation / 0x0B WalkResponse). */
    confirmedX: number;
    confirmedY: number;
    private lastRefreshTime;
    private refreshTimer;
    private enabled;
    constructor(proxy: ProxyServer, session: ProxySession);
    /** Start periodic refresh monitoring. */
    start(): void;
    /** Stop monitoring. */
    stop(): void;
    /** Sync predicted position from session state. */
    syncFromSession(): void;
    /** Called when we send a walk packet (0x06). Update predicted position. */
    onWalkSent(direction: number): void;
    /** Called when server confirms position (0x04 MapLocation). */
    onPositionConfirmed(x: number, y: number): void;
    /** Called when server confirms a walk (0x0B WalkResponse). */
    onWalkConfirmed(direction: number, prevX: number, prevY: number): void;
    /** Check if we're desynced. */
    isDesynced(): boolean;
    /** Get desync distance. */
    desyncDistance(): number;
    /** Minimum ms that must pass before next refresh (from Slowpoke). */
    canRefresh(): boolean;
    private checkAndRefresh;
    /** Send a refresh packet to the server. */
    sendRefresh(): void;
    destroy(): void;
}
