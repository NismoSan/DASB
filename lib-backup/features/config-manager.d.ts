export declare const DEFAULT_CONFIG: {
    bots: any[];
    server: {
        address: string;
        port: number;
    };
    webPort: number;
    features: {
        autoReconnect: boolean;
        logChat: boolean;
        logPackets: boolean;
    };
    reconnectStrategy: {
        sequential: boolean;
        delayBetweenBots: number;
    };
    timezone: string;
    walkPaths: any[];
    aeIngest: {
        enabled: boolean;
        apiUrl: string;
        apiKey: string;
    };
    chatGames: {
        enabled: boolean;
        openaiModel: string;
        commandPrefix: string;
        publicChatEnabled: boolean;
        whisperEnabled: boolean;
        cooldownSeconds: number;
        games: {
            trivia: boolean;
            riddle: boolean;
            eightball: boolean;
            scramble: boolean;
            numberguess: boolean;
            fortune: boolean;
            rps: boolean;
            blackjack: boolean;
        };
    };
};
export declare function mergeWithDefaults(config: any): any;
export declare function loadConfig(): any;
export declare function saveConfig(config: any): void;
export declare function setFromDB(dbConfig: any): any;
export declare function init(database: any): void;
