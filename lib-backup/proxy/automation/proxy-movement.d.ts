import EventEmitter from 'events';
import { Direction } from '../../features/navigator/types';
import type ProxyServer from '../proxy-server';
import type ProxySession from '../proxy-session';
export interface StepResult {
    success: boolean;
    x: number;
    y: number;
}
/**
 * Proxy-side movement controller. Mirrors MovementController but sends
 * walk packets through ProxyServer.sendToServer() instead of Client.send().
 *
 * Position is tracked from the session's playerState (updated by proxy-server
 * passthrough decryption of 0x0B and 0x04).
 */
export default class ProxyMovementController extends EventEmitter {
    private proxy;
    private session;
    private pendingResolve;
    private pendingTimeout;
    private pendingDirection;
    private cancelled;
    private _walking;
    walkDelay: number;
    responseTimeout: number;
    constructor(proxy: ProxyServer, session: ProxySession, options?: {
        walkDelay?: number;
        responseTimeout?: number;
    });
    get isWalking(): boolean;
    get currentX(): number;
    get currentY(): number;
    /**
     * Take a single step in the given direction.
     * Sends 0x06 Walk via the proxy, waits for 0x0B or 0x04 confirmation.
     */
    step(direction: Direction): Promise<StepResult>;
    /**
     * Called when proxy detects 0x0B WalkResponse for this session.
     */
    handleWalkResponse(direction: Direction, prevX: number, prevY: number): void;
    /**
     * Called when proxy detects 0x04 MapLocation for this session.
     */
    handleMapLocation(x: number, y: number): void;
    /**
     * Optional callback to check if a tile is blocked by an entity before stepping.
     * Set by the navigator for proactive monster avoidance.
     */
    isTileBlocked: ((x: number, y: number) => boolean) | null;
    /**
     * Walk an array of directions with delays between steps.
     */
    walkPath(directions: Direction[], delayMs?: number): Promise<boolean>;
    /**
     * Send a turn packet (0x11) to face a direction without moving.
     */
    turn(direction: Direction): void;
    cancel(): void;
}
