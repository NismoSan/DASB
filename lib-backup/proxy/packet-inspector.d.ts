import Packet from '../core/packet';
import ProxySession from './proxy-session';
export type PacketAction = 'forward' | 'block' | 'modify';
export type PacketDirection = 'client-to-server' | 'server-to-client';
export interface InspectionResult {
    action: PacketAction;
    packet?: Packet;
    inject?: Packet[];
}
export type PacketMiddleware = (packet: Packet, direction: PacketDirection, session: ProxySession) => InspectionResult | null;
/**
 * PacketInspector runs decrypted packets through a chain of middleware functions.
 * Each middleware can:
 *   - Return null to pass to the next middleware (no opinion)
 *   - Return { action: 'forward' } to explicitly forward
 *   - Return { action: 'block' } to drop the packet
 *   - Return { action: 'modify', packet } to forward a modified version
 *   - Include `inject` to also send extra packets to the client
 */
export declare class PacketInspector {
    private middlewares;
    private blockedOpcodes;
    onPacket: ((packet: Packet, direction: PacketDirection, session: ProxySession) => void) | null;
    constructor();
    use(name: string, fn: PacketMiddleware): void;
    enable(name: string): void;
    disable(name: string): void;
    blockOpcode(direction: PacketDirection, opcode: number): void;
    unblockOpcode(direction: PacketDirection, opcode: number): void;
    inspect(packet: Packet, direction: PacketDirection, session: ProxySession): InspectionResult;
}
/**
 * Built-in middleware: logs all packets to console.
 */
export declare function loggerMiddleware(): PacketMiddleware;
/**
 * Built-in middleware: updates player state from observed packets.
 */
export declare function playerStateMiddleware(): PacketMiddleware;
