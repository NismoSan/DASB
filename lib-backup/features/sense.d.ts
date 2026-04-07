export declare function init(opts: {
    sendPacket: (packet: any) => void;
    onResult: (name: string, hp: number, mp: number) => void;
}): void;
export declare function updateBotPosition(x: number, y: number): void;
export declare function updateBotDirection(dir: number): void;
export declare function clearEntities(): void;
export declare function onEntityAppeared(serial: number, name: string, x: number, y: number): void;
export declare function onEntityWalk(serial: number, x: number, y: number): void;
export declare function onEntityRemoved(serial: number): void;
export declare function handleChatMessage(channelByte: number, message: string): boolean;
export declare function handleSkillResponse(success: number, slot: number): void;
export declare function getState(): {
    enabled: boolean;
    recentCount: number;
    pending: string | null;
};
export declare function setEnabled(enabled: boolean): void;
