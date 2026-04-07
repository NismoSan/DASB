export interface GamesConfig {
    trivia: boolean;
    riddle: boolean;
    eightball: boolean;
    scramble: boolean;
    numberguess: boolean;
    fortune: boolean;
    rps: boolean;
    blackjack: boolean;
    hangman: boolean;
    [key: string]: boolean;
}
export interface Config {
    enabled: boolean;
    openaiModel: string;
    commandPrefix: string;
    publicChatEnabled: boolean;
    whisperEnabled: boolean;
    cooldownSeconds: number;
    games: GamesConfig;
    [key: string]: any;
}
export interface ChatHistoryEntry {
    sender: string;
    message: string;
    timestamp: number;
}
export interface GameState {
    config: Config;
    openaiClient: any;
    activeGames: Map<string, any>;
    playerCooldowns: Map<string, number>;
    scoreboard: Map<string, any>;
    totalGamesPlayed: number;
    customTrivia: any[];
    customWords: any[];
    customRiddles: any[];
    custom8Ball: string[];
    customFortunes: string[];
    roastModeEnabled: boolean;
    rageBaitEnabled: boolean;
    roastTarget: string;
    chatHistoryBuffer: ChatHistoryEntry[];
    MAX_CHAT_HISTORY: number;
    lastRoastTime: number;
    ROAST_COOLDOWN: number;
    hostSession: any;
    hostAnswerQueue: any[];
    hostAnswerProcessing: boolean;
    HOST_ROUND_TIMEOUT: number;
    HOST_DELAY_BETWEEN: number;
    bjGroupSession: any;
    sendSay: ((text: string) => void) | null;
    sendWhisper: ((target: string, text: string) => void) | null;
    sendEmote: ((emoteId: number) => void) | null;
    ioRef: any;
    getUsername: (() => string) | null;
    dbRef: any;
    lastOpenAICall: number;
    MIN_OPENAI_INTERVAL: number;
    PUBLIC_SAY_MAX: number;
    WHISPER_MAX: number;
    GAME_TYPES: string[];
}
declare const state: GameState;
export default state;
