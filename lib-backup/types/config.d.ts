export interface BotConfig {
    id: string;
    username: string;
    password: string;
    enabled: boolean;
    role: 'primary' | 'secondary' | 'tracker';
}
export interface WalkPath {
    name: string;
    steps: {
        x: number;
        y: number;
    }[];
}
export interface AeIngestConfig {
    enabled: boolean;
    apiUrl: string;
    apiKey: string;
}
export interface ChatGamesConfig {
    enabled: boolean;
    openaiModel: string;
    commandPrefix: string;
    publicChatEnabled: boolean;
    whisperEnabled: boolean;
    cooldownSeconds: number;
    games: Record<string, boolean>;
}
export interface AppConfig {
    bots: BotConfig[];
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
    walkPaths: WalkPath[];
    aeIngest: AeIngestConfig;
    chatGames: ChatGamesConfig;
}
export interface DiscordRule {
    id: string;
    name: string;
    enabled: boolean;
    webhookUrl: string;
    messageTypes: string[];
    pattern: string | null;
    botName: string;
    botAvatar: string | null;
}
export interface ScheduledMessage {
    id: string;
    name: string;
    enabled: boolean;
    type: string;
    interval: number;
    dailyTime: string;
    onetimeAt: string | null;
    message: string;
    botId: string;
    messageType: string;
    whisperTarget: string;
    lastFired?: number;
    lastSuccess?: boolean;
    nextFireAt?: number;
}
export interface ChatLogEntry {
    botId: string | null;
    timestamp: number;
    channel: number;
    channelName: string;
    raw: string;
    sender: string;
    message: string;
    mentions: string[];
}
export interface DiscordMessage {
    type: string;
    text: string;
    sender?: string;
    characterName?: string;
    target?: string;
}
export interface KnowledgeEntry {
    id?: number;
    category: string;
    title: string;
    content: string;
    createdAt?: string | null;
    updatedAt?: string | null;
}
