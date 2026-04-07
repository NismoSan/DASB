export declare function init(): void;
export declare function setConfigFromDB(aeConfig: any): void;
export declare function enqueueWorldShout(text: string): void;
export declare function forwardWhisper(fromPlayer: string, toPlayer: string, message: string): void;
export declare function getConfig(): {
    enabled: boolean;
    apiUrl: string;
    hasKey: boolean;
};
export declare function saveConfig(update: {
    enabled: boolean;
    apiUrl: string;
    apiKey?: string;
}): {
    enabled: boolean;
    apiUrl: string;
    hasKey: boolean;
};
export declare function testConnection(): Promise<{
    success: boolean;
    error?: string;
}>;
