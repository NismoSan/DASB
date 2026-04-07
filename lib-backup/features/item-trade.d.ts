import Packet from '../core/packet';
interface TradeOffer {
    id: string;
    wantItem: string;
    giveItem: string;
    enabled: boolean;
    totalTrades: number;
    createdAt: number;
}
interface TradeLog {
    timestamp: number;
    playerName: string;
    offerId: string;
    wantItem: string;
    giveItem: string;
}
type SendPacketFn = (packet: Packet) => void;
type SendWhisperFn = (target: string, message: string) => void;
export declare function init(deps: {
    sendPacket: SendPacketFn;
    sendWhisper: SendWhisperFn;
    io: any;
}): void;
/**
 * Handle incoming 0x42 packet (Exchange messages)
 */
export declare function handleExchangeMessage(packet: Packet): void;
/**
 * Handle incoming 0x4B packet (Exchange slot confirmation)
 */
export declare function handleExchangeSlot(packet: Packet): void;
/**
 * Handle incoming 0x37 packet (AddItem) — track inventory
 */
export declare function handleAddItem(packet: Packet): void;
/**
 * Handle incoming 0x38 packet (RemoveItem) — track inventory
 */
export declare function handleRemoveItem(packet: Packet): void;
/**
 * Handle whisper commands to the trade bot
 */
export declare function handleWhisper(senderName: string, message: string): boolean;
export declare function addOffer(wantItem: string, giveItem: string): {
    success: boolean;
    message: string;
    offer?: TradeOffer;
};
export declare function removeOffer(offerId: string): {
    success: boolean;
    message: string;
};
export declare function toggleOffer(offerId: string): {
    success: boolean;
    message: string;
    enabled?: boolean;
};
export declare function getOffers(): TradeOffer[];
export declare function getTradeLog(): TradeLog[];
export declare function getInventory(): Array<{
    slot: number;
    name: string;
}>;
export declare function hasActiveExchange(): boolean;
export {};
