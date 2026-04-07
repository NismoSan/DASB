interface SessionSnapshot {
    sessionId: string;
    buyerUsername: string;
    sellerUsername: string;
    itemName: string;
    listingId: string;
    status: string;
    statusMessage: string;
    createdAt: number;
    updatedAt: number;
    currentWhisperTarget: string;
    altCheckProgress: {
        current: number;
        total: number;
    } | null;
}
export declare function init(deps: {
    sendWhisper: (target: string, text: string) => void;
    io: any;
    getBotUsername: () => string;
}): void;
export declare function createSession(opts: {
    buyerUsername: string;
    sellerUsername: string;
    itemName: string;
    listingId: string;
    listingType?: string;
    sellerAlts?: string[];
}): {
    sessionId: string;
} | {
    error: string;
};
export declare function handleIncomingWhisper(senderName: string, message: string): boolean;
export declare function handleSystemMessage(messageRaw: string): void;
export declare function handleBotDisconnect(): void;
export declare function getSession(sessionId: string): SessionSnapshot | null;
export declare function addSSEClient(sessionId: string, res: any): void;
export declare function removeSSEClient(sessionId: string, res: any): void;
export {};
