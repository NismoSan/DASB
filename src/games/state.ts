// -- Shared State for Chat Games ------------------------------------------
// All game modules reference this shared state object to avoid
// passing dozens of variables between files.

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
  // Config
  config: Config;

  // OpenAI client
  openaiClient: any;

  // Active game sessions: key = lowercase playerName, value = session
  activeGames: Map<string, any>;
  playerCooldowns: Map<string, number>;
  scoreboard: Map<string, any>;
  totalGamesPlayed: number;

  // Custom content
  customTrivia: any[];
  customWords: any[];
  customRiddles: any[];
  custom8Ball: string[];
  customFortunes: string[];

  // Roast / Rage Bait
  roastModeEnabled: boolean;
  rageBaitEnabled: boolean;
  roastTarget: string;
  chatHistoryBuffer: ChatHistoryEntry[];
  MAX_CHAT_HISTORY: number;
  lastRoastTime: number;
  ROAST_COOLDOWN: number;

  // Host Mode
  hostSession: any;
  hostAnswerQueue: any[];
  hostAnswerProcessing: boolean;
  HOST_ROUND_TIMEOUT: number;
  HOST_DELAY_BETWEEN: number;

  // Blackjack Group
  bjGroupSession: any;

  // Injected dependencies
  sendSay: ((text: string) => void) | null;
  sendWhisper: ((target: string, text: string) => void) | null;
  sendEmote: ((emoteId: number) => void) | null;
  ioRef: any;
  getUsername: (() => string) | null;
  dbRef: any;

  // Rate limiting
  lastOpenAICall: number;
  MIN_OPENAI_INTERVAL: number;

  // Message length limits
  PUBLIC_SAY_MAX: number;
  WHISPER_MAX: number;

  // Game type list
  GAME_TYPES: string[];
}

const state: GameState = {
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

export default state;
