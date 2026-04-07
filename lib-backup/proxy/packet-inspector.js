"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PacketInspector = void 0;
exports.loggerMiddleware = loggerMiddleware;
exports.playerStateMiddleware = playerStateMiddleware;
const opcodes_1 = require("../core/opcodes");
/**
 * PacketInspector runs decrypted packets through a chain of middleware functions.
 * Each middleware can:
 *   - Return null to pass to the next middleware (no opinion)
 *   - Return { action: 'forward' } to explicitly forward
 *   - Return { action: 'block' } to drop the packet
 *   - Return { action: 'modify', packet } to forward a modified version
 *   - Include `inject` to also send extra packets to the client
 */
class PacketInspector {
    middlewares;
    blockedOpcodes; // direction -> set of blocked opcodes
    onPacket;
    constructor() {
        this.middlewares = [];
        this.blockedOpcodes = new Map();
        this.blockedOpcodes.set('client-to-server', new Set());
        this.blockedOpcodes.set('server-to-client', new Set());
        this.onPacket = null;
    }
    use(name, fn) {
        this.middlewares.push({ name, fn, enabled: true });
    }
    enable(name) {
        const mw = this.middlewares.find(m => m.name === name);
        if (mw)
            mw.enabled = true;
    }
    disable(name) {
        const mw = this.middlewares.find(m => m.name === name);
        if (mw)
            mw.enabled = false;
    }
    blockOpcode(direction, opcode) {
        this.blockedOpcodes.get(direction)?.add(opcode);
    }
    unblockOpcode(direction, opcode) {
        this.blockedOpcodes.get(direction)?.delete(opcode);
    }
    inspect(packet, direction, session) {
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
            if (!mw.enabled)
                continue;
            const result = mw.fn(packet, direction, session);
            if (result !== null) {
                return result;
            }
        }
        return { action: 'forward' };
    }
}
exports.PacketInspector = PacketInspector;
/**
 * Built-in middleware: logs all packets to console.
 */
function loggerMiddleware() {
    return (packet, direction, session) => {
        const dirLabel = direction === 'client-to-server' ? 'C→S' : 'S→C';
        const opcodeLabel = (0, opcodes_1.getOpcodeLabel)(direction === 'client-to-server' ? 'out' : 'in', packet.opcode);
        console.log(`[Inspector] ${dirLabel} [${session.id}] 0x${packet.opcode.toString(16).padStart(2, '0')} (${opcodeLabel}) body=${packet.body.length}b`);
        return null; // pass through
    };
}
/**
 * Built-in middleware: updates player state from observed packets.
 */
function playerStateMiddleware() {
    return (packet, direction, session) => {
        if (direction !== 'server-to-client')
            return null;
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
//# sourceMappingURL=packet-inspector.js.map