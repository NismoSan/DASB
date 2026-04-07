import EventEmitter from 'events';
import Packet from '../../core/packet';
import type Client from '../../core/client';
import { Direction } from './types';
export interface StepResult {
    success: boolean;
    x: number;
    y: number;
}
export default class MovementController extends EventEmitter {
    private client;
    private pendingResolve;
    private pendingTimeout;
    private pendingDirection;
    private cancelled;
    private walking;
    currentX: number;
    currentY: number;
    walkDelay: number;
    responseTimeout: number;
    constructor(client: Client, options?: {
        walkDelay?: number;
        responseTimeout?: number;
    });
    updatePosition(x: number, y: number): void;
    get isWalking(): boolean;
    step(direction: Direction): Promise<StepResult>;
    handleWalkResponse(packet: Packet): void;
    handleMapLocation(x: number, y: number): void;
    walkPath(directions: Direction[], delayMs?: number): Promise<boolean>;
    turn(direction: Direction): void;
    cancel(): void;
}
