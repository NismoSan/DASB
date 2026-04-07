import EventEmitter from 'events';
import Packet from '../../core/packet';
import type Client from '../../core/client';
import { Direction, DIRECTION_DELTA } from './types';

export interface StepResult {
  success: boolean;
  x: number;
  y: number;
}

export default class MovementController extends EventEmitter {
  private client: Client;
  private pendingResolve: ((result: StepResult) => void) | null;
  private pendingTimeout: ReturnType<typeof setTimeout> | null;
  private pendingDirection: Direction | null;
  private cancelled: boolean;
  private walking: boolean;
  currentX: number;
  currentY: number;
  walkDelay: number;
  responseTimeout: number;

  /** Optional callback to check if a tile is blocked by an entity before stepping. */
  isTileBlocked: ((x: number, y: number) => boolean) | null = null;

  constructor(client: Client, options?: { walkDelay?: number; responseTimeout?: number }) {
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

  updatePosition(x: number, y: number): void {
    this.currentX = x;
    this.currentY = y;
  }

  get isWalking(): boolean {
    return this.walking;
  }

  step(direction: Direction): Promise<StepResult> {
    return new Promise<StepResult>((resolve) => {
      if (this.cancelled) {
        resolve({ success: false, x: this.currentX, y: this.currentY });
        return;
      }

      const delta = DIRECTION_DELTA[direction];
      const expectedX = this.currentX + delta.x;
      const expectedY = this.currentY + delta.y;

      // Build walk packet: opcode 0x06, direction byte only
      const packet = new Packet(0x06);
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
          } else {
            console.log('[Walk] Step timeout at (' + this.currentX + ',' + this.currentY + ') dir=' + direction + ' (expected ' + expectedX + ',' + expectedY + ')');
            res({ success: false, x: this.currentX, y: this.currentY });
          }
        }
      }, this.responseTimeout);

      this.client.send(packet);
    });
  }

  // Called when server sends WalkResponse (0x0B)
  handleWalkResponse(packet: Packet): void {
    const direction = packet.readByte() as Direction;
    const prevX = packet.readUInt16();
    const prevY = packet.readUInt16();

    // Calculate new position from previous position + direction
    const delta = DIRECTION_DELTA[direction];
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
  handleMapLocation(x: number, y: number): void {
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

  async walkPath(directions: Direction[], delayMs?: number): Promise<boolean> {
    const delay = delayMs ?? this.walkDelay;
    this.walking = true;
    this.cancelled = false;

    console.log('[Walk] Starting path: ' + directions.length + ' steps from (' + this.currentX + ',' + this.currentY + ')');

    for (let i = 0; i < directions.length; i++) {
      if (this.cancelled) {
        this.walking = false;
        return false;
      }

      if (this.isTileBlocked) {
        const delta = DIRECTION_DELTA[directions[i]];
        const nextX = this.currentX + delta.x;
        const nextY = this.currentY + delta.y;
        if (this.isTileBlocked(nextX, nextY)) {
          this.walking = false;
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
  turn(direction: Direction): void {
    const packet = new Packet(0x11);
    packet.writeByte(direction);
    this.client.send(packet);
  }

  cancel(): void {
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
