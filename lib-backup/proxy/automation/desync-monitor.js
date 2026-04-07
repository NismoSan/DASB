"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const packet_1 = __importDefault(require("../../core/packet"));
const humanizer_1 = __importDefault(require("./humanizer"));
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
class DesyncMonitor {
    proxy;
    session;
    humanizer;
    /** Position we think we're at based on sent walk packets. */
    predictedX = 0;
    predictedY = 0;
    /** Position confirmed by server (0x04 MapLocation / 0x0B WalkResponse). */
    confirmedX = 0;
    confirmedY = 0;
    lastRefreshTime = 0;
    refreshTimer = null;
    enabled = false;
    constructor(proxy, session) {
        this.proxy = proxy;
        this.session = session;
        this.humanizer = new humanizer_1.default();
    }
    /** Start periodic refresh monitoring. */
    start() {
        if (this.enabled)
            return;
        this.enabled = true;
        this.syncFromSession();
        this.refreshTimer = setInterval(() => {
            if (this.enabled) {
                this.checkAndRefresh();
            }
        }, 1500); // Check every 1.5s
    }
    /** Stop monitoring. */
    stop() {
        this.enabled = false;
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
    }
    /** Sync predicted position from session state. */
    syncFromSession() {
        this.predictedX = this.session.playerState.x;
        this.predictedY = this.session.playerState.y;
        this.confirmedX = this.session.playerState.x;
        this.confirmedY = this.session.playerState.y;
    }
    /** Called when we send a walk packet (0x06). Update predicted position. */
    onWalkSent(direction) {
        const dx = [0, 1, 0, -1]; // up, right, down, left
        const dy = [-1, 0, 1, 0];
        this.predictedX += dx[direction] ?? 0;
        this.predictedY += dy[direction] ?? 0;
    }
    /** Called when server confirms position (0x04 MapLocation). */
    onPositionConfirmed(x, y) {
        this.confirmedX = x;
        this.confirmedY = y;
        // Also update predicted to match confirmed
        this.predictedX = x;
        this.predictedY = y;
    }
    /** Called when server confirms a walk (0x0B WalkResponse). */
    onWalkConfirmed(direction, prevX, prevY) {
        const dx = [0, 1, 0, -1];
        const dy = [-1, 0, 1, 0];
        this.confirmedX = prevX + (dx[direction] ?? 0);
        this.confirmedY = prevY + (dy[direction] ?? 0);
    }
    /** Check if we're desynced. */
    isDesynced() {
        return this.predictedX !== this.confirmedX || this.predictedY !== this.confirmedY;
    }
    /** Get desync distance. */
    desyncDistance() {
        return Math.abs(this.predictedX - this.confirmedX) +
            Math.abs(this.predictedY - this.confirmedY);
    }
    /** Minimum ms that must pass before next refresh (from Slowpoke). */
    canRefresh() {
        return Date.now() - this.lastRefreshTime >= 1200;
    }
    // ─── Internal ───────────────────────────────────────────
    checkAndRefresh() {
        if (!this.canRefresh())
            return;
        // Send refresh packet (F5 equivalent = 0x38)
        this.sendRefresh();
    }
    /** Send a refresh packet to the server. */
    sendRefresh() {
        if (this.session.refreshPending)
            return; // already waiting for response
        if (!this.canRefresh())
            return;
        const pkt = new packet_1.default(0x38);
        pkt.writeByte(0x00);
        this.proxy.sendToServer(this.session, pkt);
        this.lastRefreshTime = Date.now();
    }
    destroy() {
        this.stop();
    }
}
exports.default = DesyncMonitor;
//# sourceMappingURL=desync-monitor.js.map