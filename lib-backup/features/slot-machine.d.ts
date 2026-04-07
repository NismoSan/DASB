import Packet from '../core/packet';
interface SlotSymbol {
    name: string;
    weight: number;
    multiplier: number;
}
interface WheelHistoryEntry {
    segmentIndex: number;
    prize: number;
    timestamp: number;
}
interface SlotPlayerState {
    playerName: string;
    balance: number;
    bet: number;
    totalDeposited: number;
    totalWithdrawn: number;
    totalSpins: number;
    totalWon: number;
    totalLost: number;
    lastActive: number;
    lastWheelSpin: number;
    wheelTotalSpins: number;
    wheelTotalWon: number;
    wheelHistory: WheelHistoryEntry[];
}
interface SlotConfig {
    enabled: boolean;
    spinCost: number;
    symbols: SlotSymbol[];
}
interface BankingConfig {
    enabled: boolean;
    bankerName: string;
    bankerSerial: number;
    bankerX: number;
    bankerY: number;
    highWatermark: number;
    lowWatermark: number;
    depositTarget: number;
    withdrawTarget: number;
    checkIntervalMs: number;
    timeoutMs: number;
    maxRetries: number;
}
type SendPacketFn = (packet: Packet) => void;
type SendWhisperFn = (target: string, message: string) => void;
type SendSayFn = (message: string) => void;
type GetSerialByNameFn = (name: string) => number;
type GetEntityPositionFn = (serial: number) => {
    x: number;
    y: number;
} | null;
export declare function initiateOffload(targetName: string, amount: number): {
    success: boolean;
    error?: string;
};
export declare function handleNpcDialog(packet: Packet): void;
export declare function handlePublicMessage(packet: Packet): void;
export declare function handleStatsUpdate(packet: Packet): void;
export declare function init(deps: {
    sendPacket: SendPacketFn;
    sendWhisper: SendWhisperFn;
    sendSay: SendSayFn;
    io: any;
    getBotSerial: () => number;
    getEntityName?: (serial: number) => string | undefined;
    getSerialByName?: GetSerialByNameFn;
    setBankingActive?: (active: boolean) => void;
    getEntityPosition?: GetEntityPositionFn;
}): void;
export declare function handleExchangeMessage(packet: Packet): void;
export declare function handleExchangeSlot(packet: Packet): void;
export declare function handleAddItem(packet: Packet): void;
/**
 * Handle incoming 0x0F packet (Inventory item)
 * Sent on login for each item in inventory — same format as 0x37.
 * Format: [slot:1] [sprite:2] [color:1] [name:string8] ...trailing bytes
 */
export declare function handleInventoryItem(packet: Packet): void;
export declare function handleRemoveItem(packet: Packet): void;
export declare function handleWhisper(senderName: string, message: string): boolean;
export declare function getSlotState(): any;
export declare function getPlayerState(name: string): SlotPlayerState | null;
export declare function webSpin(playerName: string, betAmount?: number): {
    error?: string;
    reel?: [string, string, string];
    outcome?: 'lose' | 'win' | 'jackpot' | 'push';
    payout?: number;
    newBalance?: number;
    cost?: number;
};
export declare function webSetBet(playerName: string, amount: number): {
    error?: string;
    bet?: number;
    balance?: number;
};
export declare function wheelSpin(playerName: string): any;
export declare function wheelStatus(playerName: string): any;
export declare function wheelHistory(playerName: string): any;
export declare function getConfig(): SlotConfig;
export declare function saveConfigUpdate(update: any): SlotConfig;
export declare function getBankingConfig(): BankingConfig & {
    bankBalance: number;
    goldOnHand: number;
};
export declare function saveBankingConfigUpdate(update: any): BankingConfig & {
    bankBalance: number;
    goldOnHand: number;
};
export declare function forceEndSession(): {
    success: boolean;
    message: string;
};
export declare function forceClearQueue(): {
    success: boolean;
    message: string;
};
interface TicketHistoryEntry {
    ticketId: string;
    playerName: string;
    tier: string;
    cost: number;
    outcome: 'win' | 'lose';
    prize: number;
    timestamp: number;
}
export declare function buyTicket(playerName: string, tier: string): {
    error?: string;
    ticketId?: string;
    tier?: string;
    cost?: number;
    grid?: string[][];
    outcome?: 'win' | 'lose';
    prize?: number;
    matchedSymbol?: string;
    matchedPositions?: number[];
    newBalance?: number;
};
export declare function getTicketHistory(playerName: string): {
    history: TicketHistoryEntry[];
    stats: {
        totalTickets: number;
        totalSpent: number;
        totalWon: number;
    };
};
export {};
