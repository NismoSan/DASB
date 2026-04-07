import Packet from '../core/packet';
interface LeakLogEntry {
    timestamp: number;
    elapsed: number;
    direction: 'sent' | 'recv';
    opcode: number;
    opcodeHex: string;
    bodyLength: number;
    summary: string;
    rawHex: string;
    payloadHex: string;
}
interface LeakEntry {
    timestamp: number;
    elapsed: number;
    opcode: number;
    subcommand: number;
    rawHex: string;
    parsedName: string;
    parsedData: string;
    fullPayload: string;
}
export declare function init(opts: {
    sendPacket: (packet: Packet) => void;
    onLeakFound?: (entry: LeakEntry) => void;
    onLogEntry?: (entry: LeakLogEntry) => void;
    onSessionUpdate?: (status: any) => void;
}): void;
export declare function start(opts: {
    serial: number;
    name?: string;
    lookupName?: string;
    maxClicks?: number;
    intervalMs?: number;
}): {
    ok: boolean;
    error?: string;
};
export declare function stop(): void;
export declare function handleIncomingPacket(opcode: number, packet: Packet): void;
export declare function getStatus(): {
    active: boolean;
    targetName: string;
    targetSerial: string;
    clickCount: number;
    maxClicks: number;
    packetsLogged: number;
    leaksFound: number;
    elapsed: number;
    leaks: LeakEntry[];
};
export declare function getLog(): LeakLogEntry[];
export {};
