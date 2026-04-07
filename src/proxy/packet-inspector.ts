import Packet from '../core/packet';
import { getOpcodeLabel } from '../core/opcodes';
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
export class PacketInspector {
    private middlewares: { name: string; fn: PacketMiddleware; enabled: boolean }[];
    private blockedOpcodes: Map<PacketDirection, Set<number>>; // direction -> set of blocked opcodes
    onPacket: ((packet: Packet, direction: PacketDirection, session: ProxySession) => void) | null;
    /** When true, the proxy will decrypt and copy full packet bodies for onPacket. When false, only opcode is provided. */
    captureBody: boolean;

    constructor() {
        this.middlewares = [];
        this.blockedOpcodes = new Map();
        this.blockedOpcodes.set('client-to-server', new Set());
        this.blockedOpcodes.set('server-to-client', new Set());
        this.onPacket = null;
        this.captureBody = true;
    }

    use(name: string, fn: PacketMiddleware): void {
        this.middlewares.push({ name, fn, enabled: true });
    }

    enable(name: string): void {
        const mw = this.middlewares.find(m => m.name === name);
        if (mw) mw.enabled = true;
    }

    disable(name: string): void {
        const mw = this.middlewares.find(m => m.name === name);
        if (mw) mw.enabled = false;
    }

    blockOpcode(direction: PacketDirection, opcode: number): void {
        this.blockedOpcodes.get(direction)?.add(opcode);
    }

    unblockOpcode(direction: PacketDirection, opcode: number): void {
        this.blockedOpcodes.get(direction)?.delete(opcode);
    }

    inspect(packet: Packet, direction: PacketDirection, session: ProxySession): InspectionResult {
        // Notify listener (for logging/panel)
        if (this.onPacket) {
            this.onPacket(packet, direction, session);
        }

        // Check opcode block list
        const blocked = this.blockedOpcodes.get(direction);
        if (blocked && blocked.has(packet.opcode)) {
            return { action: 'block' };
        }

        // Run through middleware chain
        for (const mw of this.middlewares) {
            if (!mw.enabled) continue;
            const result = mw.fn(packet, direction, session);
            if (result !== null) {
                return result;
            }
        }

        return { action: 'forward' };
    }
}

/**
 * Built-in middleware: logs all packets to console.
 */
export function loggerMiddleware(): PacketMiddleware {
    return (packet: Packet, direction: PacketDirection, session: ProxySession) => {
        const dirLabel = direction === 'client-to-server' ? 'C→S' : 'S→C';
        const opcodeLabel = getOpcodeLabel(
            direction === 'client-to-server' ? 'out' : 'in',
            packet.opcode
        );
        console.log(
            `[Inspector] ${dirLabel} [${session.id}] 0x${packet.opcode.toString(16).padStart(2, '0')} (${opcodeLabel}) body=${packet.body.length}b`
        );
        return null; // pass through
    };
}

/**
 * Built-in middleware: updates player state from observed packets.
 */
export function playerStateMiddleware(): PacketMiddleware {
    return (packet: Packet, direction: PacketDirection, session: ProxySession) => {
        if (direction !== 'server-to-client') return null;

        const savedPos = packet.position;

        switch (packet.opcode) {
            case 0x04: { // MapLocation
                session.playerState.x = packet.readUInt16();
                session.playerState.y = packet.readUInt16();
                break;
            }
            case 0x05: { // UserId
                session.playerState.serial = packet.readUInt32();
                break;
            }
            case 0x15: { // MapData
                session.playerState.mapNumber = packet.readUInt16();
                session.playerState.mapWidth = packet.readByte();
                session.playerState.mapHeight = packet.readByte();
                break;
            }
        }

        packet.position = savedPos;
        return null; // pass through
    };
}
