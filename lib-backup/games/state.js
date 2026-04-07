"use strict";
// -- Shared State for Chat Games ------------------------------------------
// All game modules reference this shared state object to avoid
// passing dozens of variables between files.
Object.defineProperty(exports, "__esModule", { value: true });
const state = {
    // Config
    config: {
        enabled: false,
        openaiModel: 'gpt-4o-mini',
        commandPrefix: '!',
        publicChatEnabled: true,
        whisperEnabled: true,
        cooldownSeconds: 10,
        games: {
            trivia: true, riddle: true, eightball: true, scramble: true,
            numberguess: true, fortune: true, rps: true, blackjack: true, hangman: true
        }
    },
    // OpenAI client
    openaiClient: null,
    // Active game sessions: key = lowercase playerName, value = session
    activeGames: new Map(),
    playerCooldowns: new Map(),
    scoreboard: new Map(),
    totalGamesPlayed: 0,
    // Custom content
    customTrivia: [],
    customWords: [],
    customRiddles: [],
    custom8Ball: [],
    customFortunes: [],
    // Roast / Rage Bait
    roastModeEnabled: false,
    rageBaitEnabled: false,
    roastTarget: '',
    chatHistoryBuffer: [],
    MAX_CHAT_HISTORY: 20,
    lastRoastTime: 0,
    ROAST_COOLDOWN: 7000,
    // Host Mode
    hostSession: null,
    hostAnswerQueue: [],
    hostAnswerProcessing: false,
    HOST_ROUND_TIMEOUT: 45000,
    HOST_DELAY_BETWEEN: 5000,
    // Blackjack Group
    bjGroupSession: null,
    // Injected dependencies
    sendSay: null,
    sendWhisper: null,
    sendEmote: null,
    ioRef: null,
    getUsername: null,
    dbRef: null,
    // Rate limiting
    lastOpenAICall: 0,
    MIN_OPENAI_INTERVAL: 1000,
    // Message length limits
    PUBLIC_SAY_MAX: 64,
    WHISPER_MAX: 64,
    // Game type list
    GAME_TYPES: ['trivia', 'riddle', 'scramble', 'numberguess', 'rps', 'blackjack', 'hangman']
};
exports.default = state;
//# sourceMappingURL=state.js.map