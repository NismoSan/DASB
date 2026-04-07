"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = __importDefault(require("events"));
const packet_1 = __importDefault(require("../../core/packet"));
const types_1 = require("./types");
class MovementController extends events_1.default {
    client;
    pendingResolve;
    pendingTimeout;
    pendingDirection;
    cancelled;
    walking;
    currentX;
    currentY;
    walkDelay;
    responseTimeout;
    constructor(client, options) {
        super();
        this.client = client;
        this.pendingResolve = null;
        this.pendingTimeout = null;
        this.pendingDirection = null;
        this.cancelled = false;
        this.walking = false;
        this.currentX = 0;
        this.currentY = 0;
        this.walkDelay = options?.walkDelay ?? 250;
        this.responseTimeout = options?.responseTimeout ?? 600;
    }
    updatePosition(x, y) {
        this.currentX = x;
        this.currentY = y;
    }
    get isWalking() {
        return this.walking;
    }
    step(direction) {
        return new Promise((resolve) => {
            if (this.cancelled) {
                resolve({ success: false, x: this.currentX, y: this.currentY });
                return;
            }
            const delta = types_1.DIRECTION_DELTA[direction];
            const expectedX = this.currentX + delta.x;
            const expectedY = this.currentY + delta.y;
            // Build walk packet: opcode 0x06, direction byte only
            const packet = new packet_1.default(0x06);
            packet.writeByte(direction);
            this.pendingResolve = resolve;
            this.pendingDirection = direction;
            // Set timeout — if no 0x0B within timeout, check if 0x04 moved us
            // or optimistically assume success (the server may not send 0x0B)
            this.pendingTimeout = setTimeout(() => {
                this.pendingTimeout = null;
                const res = this.pendingResolve;
                this.pendingResolve = null;
                this.pendingDirection = null;
                if (res) {
                    // If position changed to where we expected, treat as success
                    if (this.currentX === expectedX && this.currentY === expectedY) {
                        res({ success: true, x: this.currentX, y: this.currentY });
                    }
                    else {
                        console.log('[Walk] Step timeout at (' + this.currentX + ',' + this.currentY + ') dir=' + direction + ' (expected ' + expectedX + ',' + expectedY + ')');
                        res({ success: false, x: this.currentX, y: this.currentY });
                    }
                }
            }, this.responseTimeout);
            this.client.send(packet);
        });
    }
    // Called when server sends WalkResponse (0x0B)
    handleWalkResponse(packet) {
        const direction = packet.readByte();
        const prevX = packet.readUInt16();
        const prevY = packet.readUInt16();
        // Calculate new position from previous position + direction
        const delta = types_1.DIRECTION_DELTA[direction];
        if (delta) {
            this.currentX = prevX + delta.x;
            this.currentY = prevY + delta.y;
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
    // Called when server sends MapLocation (0x04) - position update from server
    handleMapLocation(x, y) {
        const moved = (x !== this.currentX || y !== this.currentY);
        this.currentX = x;
        this.currentY = y;
        // If we have a pending walk step and position changed, the server confirmed
        // the walk via 0x04 instead of 0x0B. Resolve as success.
        if (this.pendingResolve && this.walking && moved && this.pendingDirection !== null) {
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
    async walkPath(directions, delayMs) {
        const delay = delayMs ?? this.walkDelay;
        this.walking = true;
        this.cancelled = false;
        console.log('[Walk] Starting path: ' + directions.length + ' steps from (' + this.currentX + ',' + this.currentY + ')');
        for (let i = 0; i < directions.length; i++) {
            if (this.cancelled) {
                this.walking = false;
                return false;
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
                console.log('[Walk] Blocked at step ' + i + '/' + directions.length);
                this.walking = false;
                return false;
            }
            // Wait between steps (add slight jitter: +/- 10%)
            if (i < directions.length - 1) {
                const jitter = delay * 0.1;
                const actualDelay = delay + (Math.random() * jitter * 2 - jitter);
                await new Promise(r => setTimeout(r, Math.max(100, actualDelay)));
            }
        }
        console.log('[Walk] Path complete at (' + this.currentX + ',' + this.currentY + ')');
        this.walking = false;
        return true;
    }
    // Send a turn packet (0x11) to face a direction without walking
    turn(direction) {
        const packet = new packet_1.default(0x11);
        packet.writeByte(direction);
        this.client.send(packet);
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
        this.walking = false;
    }
}
exports.default = MovementController;
//# sourceMappingURL=movement.js.map