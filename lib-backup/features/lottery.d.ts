import Packet from '../core/packet';
interface LotteryTicket {
    ticketNumber: number;
    playerName: string;
    itemName: string;
    inventorySlot: number;
    timestamp: number;
}
interface LotteryAudit {
    lotteryId: string;
    seedInputs: {
        lotteryId: string;
        drawnTimestamp: string;
        entrantHash: string;
    };
    finalSeed: string;
    entrantHash: string;
    entrantSnapshot: {
        ticketNumber: number;
        playerName: string;
    }[];
    winningIndex: number;
    algorithmVersion: string;
}
type SendPacketFn = (packet: Packet) => void;
type SendWhisperFn = (target: string, message: string) => void;
type SendSayFn = (message: string) => void;
export declare function init(deps: {
    sendPacket: SendPacketFn;
    sendWhisper: SendWhisperFn;
    sendSay: SendSayFn;
    io: any;
    getBotSerial: () => number;
    getEntityName?: (serial: number) => string | undefined;
}): void;
/**
 * Handle incoming 0x42 packet (Exchange messages)
 * type=0x00: Exchange request from another player
 * type=0x02: Item placed in their trade window
 * type=0x05: "You exchanged." — completed
 */
export declare function handleExchangeMessage(packet: Packet): void;
/**
 * Handle incoming 0x4B packet (Exchange slot update)
 * Confirms an item was placed in the exchange window
 */
export declare function handleExchangeSlot(packet: Packet): void;
/**
 * Handle incoming 0x37 packet (AddItem) — tracks items added to our inventory
 */
export declare function handleAddItem(packet: Packet): void;
/**
 * Handle incoming 0x38 packet (RemoveItem) — tracks items removed from inventory
 */
export declare function handleRemoveItem(packet: Packet): void;
/**
 * Handle whisper commands to the lottery bot
 */
export declare function handleWhisper(senderName: string, message: string): boolean;
/**
 * Initiate exchange with the winner to deliver prizes.
 * The winner must be nearby (on same map, within exchange range).
 */
export declare function deliverPrize(winnerSerial: number): void;
/**
 * When the winner accepts our exchange request, start placing items
 */
export declare function onPayoutAccepted(): void;
export declare function startLottery(drawingName: string): {
    success: boolean;
    message: string;
};
export declare function drawWinner(): {
    success: boolean;
    message: string;
    winner?: string;
    audit?: LotteryAudit;
};
export declare function cancelLottery(): {
    success: boolean;
    message: string;
};
export declare function resetLottery(): {
    success: boolean;
    message: string;
};
export declare function getLotteryState(): {
    id: string;
    active: boolean;
    drawingName: string;
    ticketCount: number;
    uniquePlayers: number;
    tickets: LotteryTicket[];
    winner: string | null;
    createdAt: number;
    drawnAt: number | null;
};
export declare function getPlayerTickets(playerName: string): LotteryTicket[];
export declare function handleExchangeAccepted(serial: number): void;
export declare function isLotteryBot(): boolean;
export declare function hasActiveExchange(): boolean;
export declare function hasPendingPayout(): boolean;
export {};
