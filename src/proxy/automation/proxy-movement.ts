import EventEmitter from 'events';
import Packet from '../../core/packet';
import { Direction, DIRECTION_DELTA } from '../../features/navigator/types';
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
  private proxy: ProxyServer;
  private session: ProxySession;
  private pendingResolve: ((result: StepResult) => void) | null = null;
  private pendingTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingDirection: Direction | null = null;
  private cancelled = false;
  private _walking = false;
  walkDelay: number;
  responseTimeout: number;

  /** Optional callback to check if a tile is blocked by an entity before stepping. */
  isTileBlocked: ((x: number, y: number) => boolean) | null = null;

  constructor(proxy: ProxyServer, session: ProxySession, options?: { walkDelay?: number; responseTimeout?: number }) {
    super();
    this.proxy = proxy;
    this.session = session;
    this.walkDelay = options?.walkDelay ?? 150;
    this.responseTimeout = options?.responseTimeout ?? 600;
  }

  get isWalking(): boolean { return this._walking; }
  get currentX(): number { return this.session.playerState.x; }
  get currentY(): number { return this.session.playerState.y; }

  /**
   * Take a single step in the given direction.
   * Sends 0x06 Walk via the proxy, waits for 0x0B or 0x04 confirmation.
   */
  step(direction: Direction): Promise<StepResult> {
    return new Promise<StepResult>((resolve) => {
      if (this.cancelled) {
        resolve({ success: false, x: this.currentX, y: this.currentY });
        return;
      }

      const delta = DIRECTION_DELTA[direction];
      const expectedX = this.currentX + delta.x;
      const expectedY = this.currentY + delta.y;

      // Send 0x06 Walk to the real server
      const walkPacket = new Packet(0x06);
      walkPacket.writeByte(direction);

      // Send 0x0C CreatureWalk to the CLIENT so it visually moves.
      const confirmPacket = new Packet(0x0C);
      confirmPacket.writeUInt32(this.session.playerState.serial);
      confirmPacket.writeUInt16(this.currentX);
      confirmPacket.writeUInt16(this.currentY);
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
          } else {
            res({ success: false, x: this.currentX, y: this.currentY });
          }
        }
      }, this.responseTimeout);

      this.proxy.sendToServer(this.session, walkPacket);
      this.proxy.sendToClient(this.session, confirmPacket);
    });
  }

  /** Called when proxy detects 0x0B WalkResponse for this session. */
  handleWalkResponse(direction: Direction, prevX: number, prevY: number): void {
    const delta = DIRECTION_DELTA[direction];
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
    if (res) res({ success: true, x: this.currentX, y: this.currentY });
  }

  /** Called when proxy detects 0x04 MapLocation for this session. */
  handleMapLocation(x: number, y: number): void {
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

  /** Walk an array of directions with delays between steps. */
  async walkPath(directions: Direction[], delayMs?: number): Promise<boolean> {
    const delay = delayMs ?? this.walkDelay;
    this._walking = true;
    this.cancelled = false;

    for (let i = 0; i < directions.length; i++) {
      if (this.cancelled) { this._walking = false; return false; }

      // Proactive entity avoidance before stepping
      if (this.isTileBlocked) {
        const delta = DIRECTION_DELTA[directions[i]];
        const nextX = this.currentX + delta.x;
        const nextY = this.currentY + delta.y;
        if (this.isTileBlocked(nextX, nextY)) {
          this._walking = false;
          return false;
        }
      }

      const result = await this.step(directions[i]);
      this.emit('step', { success: result.success, x: result.x, y: result.y, index: i, total: directions.length });

      if (!result.success) { this._walking = false; return false; }

      if (i < directions.length - 1) {
        const jitter = delay * 0.1;
        const actualDelay = delay + (Math.random() * jitter * 2 - jitter);
        await new Promise(r => setTimeout(r, Math.max(100, actualDelay)));
      }
    }
    this._walking = false;
    return true;
  }

  /** Send a turn packet (0x11) to face a direction without moving. */
  turn(direction: Direction): void {
    const packet = new Packet(0x11);
    packet.writeByte(direction);
    this.proxy.sendToServer(this.session, packet);
  }

  cancel(): void {
    this.cancelled = true;
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
    const res = this.pendingResolve;
    this.pendingResolve = null;
    if (res) res({ success: false, x: this.currentX, y: this.currentY });
    this._walking = false;
  }
}
