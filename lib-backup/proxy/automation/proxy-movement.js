"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = __importDefault(require("events"));
const packet_1 = __importDefault(require("../../core/packet"));
const types_1 = require("../../features/navigator/types");
/**
 * Proxy-side movement controller. Mirrors MovementController but sends
 * walk packets through ProxyServer.sendToServer() instead of Client.send().
 *
 * Position is tracked from the session's playerState (updated by proxy-server
 * passthrough decryption of 0x0B and 0x04).
 */
class ProxyMovementController extends events_1.default {
    proxy;
    session;
    pendingResolve = null;
    pendingTimeout = null;
    pendingDirection = null;
    cancelled = false;
    _walking = false;
    walkDelay;
    responseTimeout;
    constructor(proxy, session, options) {
        super();
        this.proxy = proxy;
        this.session = session;
        this.walkDelay = options?.walkDelay ?? 150;
        this.responseTimeout = options?.responseTimeout ?? 600;
    }
    get isWalking() {
        return this._walking;
    }
    get currentX() {
        return this.session.playerState.x;
    }
    get currentY() {
        return this.session.playerState.y;
    }
    /**
     * Take a single step in the given direction.
     * Sends 0x06 Walk via the proxy, waits for 0x0B or 0x04 confirmation.
     */
    step(direction) {
        return new Promise((resolve) => {
            if (this.cancelled) {
                resolve({ success: false, x: this.currentX, y: this.currentY });
                return;
            }
            const delta = types_1.DIRECTION_DELTA[direction];
            const expectedX = this.currentX + delta.x;
            const expectedY = this.currentY + delta.y;
            // Send 0x06 Walk to the real server
            const walkPacket = new packet_1.default(0x06);
            walkPacket.writeByte(direction);
            // Send 0x0C CreatureWalk to the CLIENT so it visually moves.
            // The client only processes 0x0B if it initiated the walk itself.
            // Since we're injecting the walk from the proxy, the client has no
            // pending walk state. Instead, use 0x0C (CreatureWalk) which the client
            // processes for any entity, including itself.
            // Format per Arbiter: [ActorId:u32] [FromX:u16] [FromY:u16] [Direction:u8]
            const confirmPacket = new packet_1.default(0x0C);
            confirmPacket.writeUInt32(this.session.playerState.serial);
            confirmPacket.writeUInt16(this.currentX); // previous X (before step)
            confirmPacket.writeUInt16(this.currentY); // previous Y (before step)
            confirmPacket.writeByte(direction);
            this.pendingResolve = resolve;
            this.pendingDirection = direction;
            this.pendingTimeout = setTimeout(() => {
                this.pendingTimeout = null;
                const res = this.pendingResolve;
                this.pendingResolve = null;
                this.pendingDirection = null;
                if (res) {
                    if (this.currentX === expectedX && this.currentY === expectedY) {
                        res({ success: true, x: this.currentX, y: this.currentY });
                    }
                    else {
                        res({ success: false, x: this.currentX, y: this.currentY });
                    }
                }
            }, this.responseTimeout);
            // Send walk to server and confirm to client
            this.proxy.sendToServer(this.session, walkPacket);
            this.proxy.sendToClient(this.session, confirmPacket);
        });
    }
    /**
     * Called when proxy detects 0x0B WalkResponse for this session.
     */
    handleWalkResponse(direction, prevX, prevY) {
        const delta = types_1.DIRECTION_DELTA[direction];
        if (delta) {
            this.session.playerState.x = prevX + delta.x;
            this.session.playerState.y = prevY + delta.y;
        }
        if (this.pendingTimeout) {
            clearTimeout(this.pendingTimeout);
            this.pendingTimeout = null;
        }
        const res = this.pendingResolve;
        this.pendingResolve = null;
        this.pendingDirection = null;
        if (res) {
            res({ success: true, x: this.currentX, y: this.currentY });
        }
    }
    /**
     * Called when proxy detects 0x04 MapLocation for this session.
     */
    handleMapLocation(x, y) {
        const moved = (x !== this.currentX || y !== this.currentY);
        this.session.playerState.x = x;
        this.session.playerState.y = y;
        if (this.pendingResolve && this._walking && moved && this.pendingDirection !== null) {
            if (this.pendingTimeout) {
                clearTimeout(this.pendingTimeout);
                this.pendingTimeout = null;
            }
            const res = this.pendingResolve;
            this.pendingResolve = null;
            this.pendingDirection = null;
            res({ success: true, x: this.currentX, y: this.currentY });
        }
    }
    /**
     * Optional callback to check if a tile is blocked by an entity before stepping.
     * Set by the navigator for proactive monster avoidance.
     */
    isTileBlocked = null;
    /**
     * Walk an array of directions with delays between steps.
     */
    async walkPath(directions, delayMs) {
        const delay = delayMs ?? this.walkDelay;
        this._walking = true;
        this.cancelled = false;
        for (let i = 0; i < directions.length; i++) {
            if (this.cancelled) {
                this._walking = false;
                return false;
            }
            // Proactive entity avoidance: check if the next tile is blocked BEFORE stepping
            if (this.isTileBlocked) {
                const delta = types_1.DIRECTION_DELTA[directions[i]];
                const nextX = this.currentX + delta.x;
                const nextY = this.currentY + delta.y;
                if (this.isTileBlocked(nextX, nextY)) {
                    // Entity in our path — abort walk so navigator can repath
                    this._walking = false;
                    return false;
                }
            }
            const result = await this.step(directions[i]);
            this.emit('step', {
                success: result.success,
                x: result.x,
                y: result.y,
                index: i,
                total: directions.length
            });
            if (!result.success) {
                this._walking = false;
                return false;
            }
            if (i < directions.length - 1) {
                const jitter = delay * 0.1;
                const actualDelay = delay + (Math.random() * jitter * 2 - jitter);
                await new Promise(r => setTimeout(r, Math.max(100, actualDelay)));
            }
        }
        this._walking = false;
        return true;
    }
    /**
     * Send a turn packet (0x11) to face a direction without moving.
     */
    turn(direction) {
        const packet = new packet_1.default(0x11);
        packet.writeByte(direction);
        this.proxy.sendToServer(this.session, packet);
    }
    cancel() {
        this.cancelled = true;
        if (this.pendingTimeout) {
            clearTimeout(this.pendingTimeout);
            this.pendingTimeout = null;
        }
        const res = this.pendingResolve;
        this.pendingResolve = null;
        if (res) {
            res({ success: false, x: this.currentX, y: this.currentY });
        }
        this._walking = false;
    }
}
exports.default = ProxyMovementController;
//# sourceMappingURL=proxy-movement.js.map