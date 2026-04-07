"use strict";

var OpenAI = require('openai');

// ── Module State ─────────────────────────────────────────────────

var config = {
  enabled: false,
  openaiModel: 'gpt-4o-mini',
  commandPrefix: '!',
  publicChatEnabled: true,
  whisperEnabled: true,
  cooldownSeconds: 10,
  games: {
    trivia: true,
    riddle: true,
    eightball: true,
    scramble: true,
    numberguess: true,
    fortune: true,
    rps: true,
    blackjack: true,
    hangman: true
  }
};
var openaiClient = null;
var activeGames = new Map(); // key: lowercase playerName, value: session
var playerCooldowns = new Map();
var scoreboard = new Map(); // key: lowercase playerName, value: { name, wins, played }
var totalGamesPlayed = 0;

// Custom content
var customTrivia = []; // [{question, answer, hint}]
var customWords = []; // [{word, hint}]
var customRiddles = []; // [{riddle, answer, hint}]
var custom8Ball = []; // [string]
var customFortunes = []; // [string]

// Admin player - only this player can use host/admin commands
var adminPlayer = 'lancelot';

// Roast / Rage Bait mode
var roastModeEnabled = false;
var rageBaitEnabled = false;
var roastTarget = ''; // If set, only roast/rage this specific player
var chatHistoryBuffer = []; // [{sender, message, timestamp}]
var MAX_CHAT_HISTORY = 20;
var lastRoastTime = 0;
var ROAST_COOLDOWN = 7000; // 7 seconds between roast/rage responses

// Host Mode state
var hostSession = null;

// Blackjack Group state
var bjGroupSession = null;
// hostSession = {
//   gameType: 'trivia' | 'riddle' | 'scramble' | 'numberguess',
//   totalRounds: 10,
//   currentRound: 0,
//   hostPlayer: 'PlayerName',  // who started it
//   leaderboard: Map<lowercase name, {name, points}>,
//   currentQuestion: {question, answer, hint, targetNumber},
//   questionActive: false,
//   timeoutTimer: null,
//   roundTimer: null,
//   delayBetweenRounds: 5000
// }
var HOST_ROUND_TIMEOUT = 45000; // 45 seconds per question
var HOST_DELAY_BETWEEN = 5000; // 5 seconds between rounds

// Injected dependencies
var sendSay = null;
var sendWhisper = null;
var sendEmote = null;
var ioRef = null;
var getUsername = null;
var dbRef = null;

// Rate limiting
var lastOpenAICall = 0;
var MIN_OPENAI_INTERVAL = 1000;

// Message length limits
var PUBLIC_SAY_MAX = 64;
var WHISPER_MAX = 64;
function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9 _-]/g, '').substring(0, 30);
}

// ── Shuffle Deck (no-repeat cycling) ────────────────────────────

function ShuffleDeck(sourceArrayGetter) {
  this._get = sourceArrayGetter;
  this._deck = [];
}
ShuffleDeck.prototype._refill = function () {
  var src = this._get();
  if (!src || src.length === 0) {
    this._deck = [];
    return;
  }
  this._deck = src.slice();
  for (var i = this._deck.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = this._deck[i];
    this._deck[i] = this._deck[j];
    this._deck[j] = tmp;
  }
};
ShuffleDeck.prototype.draw = function () {
  if (this._deck.length === 0) this._refill();
  if (this._deck.length === 0) return null;
  return this._deck.pop();
};
ShuffleDeck.prototype.reset = function () {
  this._deck = [];
};

// ── Fallback Questions ───────────────────────────────────────────

var FALLBACK_TRIVIA = [{
  question: 'What element beats water?',
  answer: 'Earth',
  hint: 'Solid ground'
}, {
  question: 'How many classes exist in Temuair?',
  answer: '5',
  hint: 'A handful'
}, {
  question: 'What creature drops wolf fur?',
  answer: 'Wolf',
  hint: 'It howls'
}, {
  question: 'What town has the mileth altar?',
  answer: 'Mileth',
  hint: 'Starting town'
}, {
  question: 'What stat does a warrior need most?',
  answer: 'Strength',
  hint: 'Raw power'
}, {
  question: 'Which god represents darkness?',
  answer: 'Chadul',
  hint: 'Opposite of light'
}, {
  question: 'What is the currency in Temuair?',
  answer: 'Gold',
  hint: 'Shiny metal'
}, {
  question: 'What element beats fire?',
  answer: 'Water',
  hint: 'Flows and quenches'
}, {
  question: 'What class uses staves?',
  answer: 'Wizard',
  hint: 'Master of spells'
}, {
  question: 'What element beats wind?',
  answer: 'Fire',
  hint: 'It burns bright'
}, {
  question: 'Which god is patron of warriors?',
  answer: 'Ceannlaidir',
  hint: 'Strength deity'
}, {
  question: 'What town is known for fishing?',
  answer: 'Abel',
  hint: 'Port town'
}, {
  question: 'What element is Srad?',
  answer: 'Fire',
  hint: 'It burns'
}, {
  question: 'Which class can heal others?',
  answer: 'Priest',
  hint: 'Holy power'
}, {
  question: 'What goddess watches over love?',
  answer: 'Glioca',
  hint: 'Compassion'
}, {
  question: 'Where do new Aislings awaken?',
  answer: 'Mileth',
  hint: 'Starting village'
}, {
  question: 'What god governs wisdom?',
  answer: 'Luathas',
  hint: 'Knowledge deity'
}, {
  question: 'What class relies on stealth?',
  answer: 'Rogue',
  hint: 'Shadows'
}, {
  question: 'What is Athar element?',
  answer: 'Wind',
  hint: 'Air and breeze'
}, {
  question: 'What is Creag element?',
  answer: 'Earth',
  hint: 'Stone and rock'
}, {
  question: 'Who is the god of inspiration?',
  answer: 'Deoch',
  hint: 'Creative spark'
}, {
  question: 'What class fights bare-handed?',
  answer: 'Monk',
  hint: 'Discipline of body'
}, {
  question: 'What deity represents luck?',
  answer: 'Fiosachd',
  hint: 'Fortune and wealth'
}, {
  question: 'What city has the Loures Castle?',
  answer: 'Loures',
  hint: 'Royal seat'
}, {
  question: 'What is the dark god Sgrios of?',
  answer: 'Destruction',
  hint: 'Death and decay'
}];
var FALLBACK_RIDDLES = [{
  riddle: 'I burn without flame in Temuair.',
  answer: 'Srad',
  hint: 'An element'
}, {
  riddle: 'I guard the dead but live forever.',
  answer: 'Sgrios',
  hint: 'A dark god'
}, {
  riddle: 'Aislings seek me but I have no form.',
  answer: 'Insight',
  hint: 'Inner knowledge'
}, {
  riddle: 'I flow through Abel but cannot be held.',
  answer: 'Water',
  hint: 'An element'
}, {
  riddle: 'Five paths diverge, each with power.',
  answer: 'Classes',
  hint: 'Warrior, Wizard...'
}, {
  riddle: 'I am earned in battle but spent in peace.',
  answer: 'Experience',
  hint: 'Growth'
}, {
  riddle: 'Mundanes see me not, yet I walk among them.',
  answer: 'Aisling',
  hint: 'A player'
}, {
  riddle: 'I stand at the crossroads of all elements.',
  answer: 'Light',
  hint: 'Opposing darkness'
}];
var FALLBACK_WORDS = [{
  word: 'mileth',
  hint: 'Starting town'
}, {
  word: 'aisling',
  hint: 'An awakened one'
}, {
  word: 'wizard',
  hint: 'A master of magic'
}, {
  word: 'priest',
  hint: 'A holy healer'
}, {
  word: 'warrior',
  hint: 'A strong fighter'
}, {
  word: 'loures',
  hint: 'A great castle city'
}, {
  word: 'rucesion',
  hint: 'City of sorcery'
}, {
  word: 'suomi',
  hint: 'Northern village'
}, {
  word: 'rogue',
  hint: 'Master of shadows'
}, {
  word: 'temuair',
  hint: 'The world itself'
}, {
  word: 'chadul',
  hint: 'God of darkness'
}, {
  word: 'danaan',
  hint: 'Goddess of light'
}, {
  word: 'creag',
  hint: 'Earth element'
}, {
  word: 'deoch',
  hint: 'God of inspiration'
}, {
  word: 'mundane',
  hint: 'Non-Aisling person'
}];

// ── Shuffle Deck Instances ───────────────────────────────────────

var deckFallbackTrivia = new ShuffleDeck(function () {
  return FALLBACK_TRIVIA;
});
var deckFallbackRiddles = new ShuffleDeck(function () {
  return FALLBACK_RIDDLES;
});
var deckFallbackWords = new ShuffleDeck(function () {
  return FALLBACK_WORDS;
});
var deckCustomTrivia = new ShuffleDeck(function () {
  return customTrivia;
});
var deckCustomRiddles = new ShuffleDeck(function () {
  return customRiddles;
});
var deckCustomWords = new ShuffleDeck(function () {
  return customWords;
});

// ── Rock Paper Scissors Constants ────────────────────────────────

var RPS_CHOICES = ['rock', 'paper', 'scissors'];
var RPS_EMOTES = {
  rock: 0x0E,
  scissors: 0x0F,
  paper: 0x10
};
var RPS_BEATS = {
  rock: 'scissors',
  scissors: 'paper',
  paper: 'rock'
};
// Incoming animation IDs from server 0x1A packets (body animation byte)
var RPS_ANIM_TO_CHOICE = {
  0x17: 'rock',
  0x18: 'scissors',
  0x19: 'paper'
};

// ── Initialization ───────────────────────────────────────────────

function init(_, deps) {
  sendSay = deps.sendSay;
  sendWhisper = deps.sendWhisper;
  sendEmote = deps.sendEmote;
  ioRef = deps.io;
  getUsername = deps.getUsername;
  dbRef = deps.db || null;
  initOpenAI();
  console.log('[ChatGames] Initialized' + (openaiClient ? ' (OpenAI ready)' : ' (no API key)'));
}
function initOpenAI() {
  var apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    openaiClient = null;
    return false;
  }
  openaiClient = new OpenAI({
    apiKey: apiKey,
    timeout: 15000
  });
  return true;
}

// ── Leaderboard Persistence ─────────────────────────────────────

function saveLeaderboard(updatedPlayerName) {
  if (dbRef && updatedPlayerName) {
    var key = updatedPlayerName.toLowerCase();
    var stats = scoreboard.get(key);
    if (stats) {
      dbRef.savePlayerScore(updatedPlayerName, stats);
    }
  }
}
function getLeaderboard() {
  var board = [];
  scoreboard.forEach(function (val) {
    board.push({
      name: val.name,
      wins: val.wins || 0,
      played: val.played || 0,
      losses: (val.played || 0) - (val.wins || 0),
      winRate: val.played > 0 ? Math.round(val.wins / val.played * 100) : 0,
      currentStreak: val.currentStreak || 0,
      bestStreak: val.bestStreak || 0
    });
  });
  board.sort(function (a, b) {
    return b.wins - a.wins;
  });
  return board;
}
var GAME_TYPES = ['trivia', 'riddle', 'scramble', 'numberguess', 'rps', 'blackjack', 'hangman'];
function getLeaderboardByGame(gameType) {
  var board = [];
  scoreboard.forEach(function (val) {
    var g = val.byGame && val.byGame[gameType];
    if (g && g.played > 0) {
      board.push({
        name: val.name,
        wins: g.wins || 0,
        played: g.played || 0,
        losses: (g.played || 0) - (g.wins || 0),
        winRate: g.played > 0 ? Math.round(g.wins / g.played * 100) : 0
      });
    }
  });
  board.sort(function (a, b) {
    return b.wins - a.wins;
  });
  return board;
}
function clearLeaderboard() {
  scoreboard = new Map();
  totalGamesPlayed = 0;
  if (dbRef) dbRef.clearLeaderboard();
}
function clearLeaderboardByGame(gameType) {
  if (!gameType) return;
  scoreboard.forEach(function (stats, key) {
    if (stats.byGame && stats.byGame[gameType]) {
      var g = stats.byGame[gameType];
      stats.played = Math.max(0, (stats.played || 0) - (g.played || 0));
      stats.wins = Math.max(0, (stats.wins || 0) - (g.wins || 0));
      delete stats.byGame[gameType];
      // Reset streaks since we can't accurately recalculate them
      stats.currentStreak = 0;
      stats.bestStreak = 0;
      scoreboard.set(key, stats);
      saveLeaderboard(stats.name);
    }
  });
  // Remove players with no games left
  scoreboard.forEach(function (stats, key) {
    if (stats.played <= 0) scoreboard["delete"](key);
  });
  totalGamesPlayed = 0;
  scoreboard.forEach(function (stats) {
    totalGamesPlayed += stats.played;
  });
}
function applyConfigUpdate(update) {
  var merged = Object.assign({}, config, update, {
    games: Object.assign({}, config.games, update && update.games || {})
  });

  // Persist custom content
  merged.customTrivia = update && update.customTrivia || customTrivia;
  merged.customRiddles = update && update.customRiddles || customRiddles;
  merged.customWords = update && update.customWords || customWords;
  merged.custom8Ball = update && update.custom8Ball || custom8Ball;
  merged.customFortunes = update && update.customFortunes || customFortunes;

  // Handle roast/rage bait mutual exclusivity
  if (update && update.roastMode) {
    merged.roastMode = true;
    merged.rageBaitMode = false;
  } else if (update && update.rageBaitMode) {
    merged.rageBaitMode = true;
    merged.roastMode = false;
  } else {
    merged.roastMode = update && update.roastMode !== undefined ? update.roastMode : roastModeEnabled;
    merged.rageBaitMode = update && update.rageBaitMode !== undefined ? update.rageBaitMode : rageBaitEnabled;
  }

  // Persist roast target
  merged.roastTarget = update && update.roastTarget !== undefined ? update.roastTarget : roastTarget;

  // Update local state
  config = merged;
  if (update && update.customTrivia) {
    customTrivia = update.customTrivia;
    deckCustomTrivia.reset();
  }
  if (update && update.customRiddles) {
    customRiddles = update.customRiddles;
    deckCustomRiddles.reset();
  }
  if (update && update.customWords) {
    customWords = update.customWords;
    deckCustomWords.reset();
  }
  if (update && update.custom8Ball) {
    custom8Ball = update.custom8Ball;
  }
  if (update && update.customFortunes) {
    customFortunes = update.customFortunes;
  }
  roastModeEnabled = !!merged.roastMode;
  rageBaitEnabled = !!merged.rageBaitMode;
  roastTarget = merged.roastTarget || '';
  return getConfig();
}

// ── Public API ───────────────────────────────────────────────────

function isEnabled() {
  return config.enabled && (openaiClient !== null || true); // allow local-only games even without key
}
function getConfig() {
  return {
    enabled: config.enabled,
    openaiModel: config.openaiModel,
    commandPrefix: config.commandPrefix,
    publicChatEnabled: config.publicChatEnabled,
    whisperEnabled: config.whisperEnabled,
    cooldownSeconds: config.cooldownSeconds,
    games: config.games,
    hasApiKey: !!process.env.OPENAI_API_KEY,
    customTrivia: customTrivia,
    customRiddles: customRiddles,
    customWords: customWords,
    custom8Ball: custom8Ball,
    customFortunes: customFortunes,
    roastMode: roastModeEnabled,
    rageBaitMode: rageBaitEnabled,
    roastTarget: roastTarget
  };
}
function saveConfig(update) {
  return applyConfigUpdate(update);
}
function getStats() {
  return {
    activeGameCount: activeGames.size,
    totalGamesPlayed: totalGamesPlayed,
    scoreboard: getLeaderboard().slice(0, 20)
  };
}
function getActiveGames() {
  var list = [];
  activeGames.forEach(function (session) {
    list.push({
      player: session.playerName,
      gameType: session.gameType,
      startedAt: session.startedAt,
      attempts: session.attempts,
      isWhisper: session.isWhisper
    });
  });
  return list;
}

// ── Message Handling ─────────────────────────────────────────────

function handlePublicMessage(sender, message) {
  if (!config.enabled || !config.publicChatEnabled) return;
  if (!sender || !message) return;
  if (getUsername && sender.toLowerCase() === getUsername().toLowerCase()) return;
  var prefix = config.commandPrefix || '!';

  // During host mode, check every public message as a possible answer
  if (hostSession && hostSession.questionActive) {
    if (!message.startsWith(prefix)) {
      var handled = handleHostAnswer(sender, message);
      if (handled) return;
    }
  }

  // During group blackjack, intercept active player's messages
  if (bjGroupSession && bjGroupSession.phase === 'playing') {
    if (!message.startsWith(prefix)) {
      var bjHandled = handleGroupBjMessage(sender, message);
      if (bjHandled) return;
    }
  }
  if (message.startsWith(prefix)) {
    processCommand(sender, message, false);
  }
}
function handleWhisper(sender, message) {
  if (!config.enabled || !config.whisperEnabled) return false;
  if (!sender || !message) return false;
  if (getUsername && sender.toLowerCase() === getUsername().toLowerCase()) return false;
  var prefix = config.commandPrefix || '!';
  if (message.startsWith(prefix)) {
    processCommand(sender, message, true);
    return true;
  }
  // Check if player has an active game and this is an answer attempt
  return handlePossibleAnswer(sender, message, true);
}
function handlePossibleAnswer(sender, message, isWhisper) {
  if (!config.enabled) return false;
  if (!sender || !message) return false;

  // Don't auto-detect answers from command messages (handled by processCommand)
  var prefix = config.commandPrefix || '!';
  if (message.startsWith(prefix)) return false;
  var key = sender.toLowerCase();
  var session = activeGames.get(key);
  if (!session) return false;

  // Only intercept answers for the matching channel type
  // Blackjack allows actions from either channel (bet out loud, etc.)
  if (session.gameType !== 'blackjack' && session.isWhisper !== isWhisper) return false;

  // Stateful games accept free-form answers
  if (session.gameType === 'trivia' || session.gameType === 'riddle') {
    checkAnswerFuzzy(session, message);
    return true;
  }
  if (session.gameType === 'scramble') {
    checkAnswerExact(session, message);
    return true;
  }
  if (session.gameType === 'numberguess') {
    checkNumberGuess(session, message);
    return true;
  }
  if (session.gameType === 'rps') {
    handleRpsAnswer(session, message);
    return true;
  }
  if (session.gameType === 'blackjack') {
    handleBlackjackAction(session, message);
    return true;
  }
  if (session.gameType === 'hangman') {
    handleHangmanGuess(session, message);
    return true;
  }
  return false;
}

// ── Command Dispatch ─────────────────────────────────────────────

function parseCommand(message, prefix) {
  var withoutPrefix = message.substring(prefix.length).trim();
  var spaceIdx = withoutPrefix.indexOf(' ');
  if (spaceIdx === -1) {
    return {
      command: withoutPrefix.toLowerCase(),
      args: ''
    };
  }
  return {
    command: withoutPrefix.substring(0, spaceIdx).toLowerCase(),
    args: withoutPrefix.substring(spaceIdx + 1).trim()
  };
}
function processCommand(sender, message, isWhisper) {
  var prefix = config.commandPrefix || '!';
  var parsed = parseCommand(message, prefix);
  var cmd = parsed.command;
  var args = parsed.args;

  // Host mode commands (admin only)
  if (cmd === 'host' || cmd === 'hoststart' || cmd === 'hoststop' || cmd === 'hostend' || cmd === 'hostskip') {
    if (sender.toLowerCase() !== adminPlayer) {
      sendGameResponse(sender, 'Only ' + adminPlayer + ' can use host commands.', isWhisper);
      return;
    }
    if (cmd === 'host' || cmd === 'hoststart') {
      handleHostStart(sender, args);
      return;
    }
    if (cmd === 'hoststop' || cmd === 'hostend') {
      handleHostStop(sender);
      return;
    }
    if (cmd === 'hostskip') {
      handleHostSkip(sender);
      return;
    }
  }

  // Commands that don't need cooldown
  if (cmd === 'help') {
    showHelp(sender, isWhisper);
    return;
  }
  if (cmd === 'score' || cmd === 'scores') {
    showScore(sender, isWhisper);
    return;
  }
  if (cmd === 'leaderboard' || cmd === 'top') {
    showLeaderboard(sender, isWhisper, args);
    return;
  }
  if (cmd === 'answer' || cmd === 'a') {
    handleAnswerCommand(sender, args, isWhisper);
    return;
  }
  if (cmd === 'hint' || cmd === 'h') {
    handleHint(sender, isWhisper);
    return;
  }
  if (cmd === 'giveup' || cmd === 'quit') {
    handleGiveUp(sender, isWhisper);
    return;
  }

  // Check cooldown for game-starting commands
  if (isOnCooldown(sender)) {
    sendGameResponse(sender, 'Wait a moment before playing again.', isWhisper);
    return;
  }

  // Game commands
  if (cmd === 'trivia' && config.games.trivia) {
    startTrivia(sender, isWhisper);
  } else if (cmd === 'riddle' && config.games.riddle) {
    startRiddle(sender, isWhisper);
  } else if ((cmd === '8ball' || cmd === 'eightball') && config.games.eightball) {
    handle8Ball(sender, args, isWhisper);
  } else if (cmd === 'scramble' && config.games.scramble) {
    startScramble(sender, isWhisper);
  } else if ((cmd === 'guess' || cmd === 'numberguess') && config.games.numberguess) {
    startNumberGuess(sender, isWhisper);
  } else if (cmd === 'fortune' && config.games.fortune) {
    handleFortune(sender, isWhisper);
  } else if (cmd === 'rps' && config.games.rps) {
    startRps(sender, isWhisper);
  } else if ((cmd === 'blackjack' || cmd === 'bj') && config.games.blackjack) {
    startBlackjack(sender, isWhisper);
  } else if ((cmd === 'bjhost' || cmd === 'blackjackhost') && config.games.blackjack && !isWhisper) {
    if (sender.toLowerCase() !== adminPlayer) {
      sendGameResponse(sender, 'Only ' + adminPlayer + ' can host group blackjack.', isWhisper);
      return;
    }
    startBjLobby(sender, args);
  } else if (cmd === 'bjjoin' && config.games.blackjack && !isWhisper) {
    joinBjLobby(sender);
  } else if (cmd === 'bjstart' && config.games.blackjack && !isWhisper) {
    if (sender.toLowerCase() !== adminPlayer) {
      sendGameResponse(sender, 'Only ' + adminPlayer + ' can start group blackjack.', isWhisper);
      return;
    }
    forceStartBj(sender);
  } else if (cmd === 'bjleave' && config.games.blackjack) {
    leaveBj(sender, isWhisper);
  } else if (cmd === 'bjstop' && config.games.blackjack) {
    if (sender.toLowerCase() !== adminPlayer) {
      sendGameResponse(sender, 'Only ' + adminPlayer + ' can stop group blackjack.', isWhisper);
      return;
    }
    stopBjGame(sender);
  } else if (cmd === 'bjstatus' && config.games.blackjack) {
    showBjStatus(sender, isWhisper);
  } else if (cmd === 'hangman' && config.games.hangman) {
    startHangman(sender, isWhisper);
  } else if (cmd === 'bet' && config.games.blackjack) {
    // Group blackjack betting (public or whisper)
    if (bjGroupSession && bjGroupSession.phase === 'betting') {
      var betAmt = parseInt(args);
      if (!isNaN(betAmt)) bjGroupHandleBet(sender, betAmt);
    }
  } else {
    // Unknown command - no response to avoid spam
  }
}

// ── Game Implementations ─────────────────────────────────────────

// ── Trivia ──

function startTrivia(sender, isWhisper) {
  setCooldown(sender);
  var charLimit = isWhisper ? 200 : 55;
  generateTrivia(charLimit, function (err, data) {
    createSession(sender, 'trivia', isWhisper, data);
    sendGameResponse(sender, 'Trivia: ' + data.question, isWhisper);
    emitActivity(sender, 'trivia', 'started');
  });
}

// ── Riddle ──

function startRiddle(sender, isWhisper) {
  setCooldown(sender);
  var charLimit = isWhisper ? 200 : 55;
  generateRiddle(charLimit, function (err, data) {
    createSession(sender, 'riddle', isWhisper, data);
    sendGameResponse(sender, 'Riddle: ' + data.question, isWhisper);
    emitActivity(sender, 'riddle', 'started');
  });
}

// ── Magic 8-Ball ──

function handle8Ball(sender, question, isWhisper) {
  if (!question) {
    var p = config.commandPrefix || '!';
    sendGameResponse(sender, 'Ask a question! e.g. ' + p + '8ball Will I win?', isWhisper);
    return;
  }
  setCooldown(sender);

  // Use custom 8ball responses first if available, otherwise use fallback list
  var pool = custom8Ball.length > 0 ? custom8Ball : ['The gods say yes, Aisling.', 'The stars say no.', 'Ask again, young Aisling.', 'The elements are unclear.', 'Danaan wills it so.', 'Chadul clouds my vision...', 'It is certain, by Deoch.', 'Do not count on it.', 'Ceannlaidir nods approval.', 'Sgrios frowns upon this path.', 'Glioca blesses this choice.', 'Luathas reveals: perhaps.'];
  var answer = pool[Math.floor(Math.random() * pool.length)];
  sendGameResponse(sender, '8-Ball: ' + answer, isWhisper);
  emitActivity(sender, '8ball', 'asked');
}

// ── Word Scramble ──

function startScramble(sender, isWhisper) {
  setCooldown(sender);
  generateScramble(function (err, data) {
    createSession(sender, 'scramble', isWhisper, data);
    sendGameResponse(sender, 'Unscramble: ' + data.question, isWhisper);
    emitActivity(sender, 'scramble', 'started');
  });
}
function scrambleWord(word) {
  var chars = word.split('');
  // Fisher-Yates shuffle, ensure it differs from original
  var attempts = 0;
  var shuffled;
  do {
    shuffled = chars.slice();
    for (var i = shuffled.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }
    attempts++;
  } while (shuffled.join('') === word && attempts < 10);
  return shuffled.join('');
}

// ── Hangman ──

function startHangman(sender, isWhisper) {
  setCooldown(sender);
  generateHangman(function (err, data) {
    createSession(sender, 'hangman', isWhisper, data);
    var msg = 'Hangman: ' + data.question + ' (' + data.maxWrong + ' lives)';
    sendGameResponse(sender, msg, isWhisper);
    if (isWhisper) {
      setTimeout(function () {
        sendWhisper(sender, 'Hint: ' + (data.hint || 'No hint'));
      }, 500);
    }
    emitActivity(sender, 'hangman', 'started');
  });
}

// ── Number Guessing ──

function startNumberGuess(sender, isWhisper) {
  setCooldown(sender);
  var data = generateNumberGuess();
  data.maxAttempts = 10;
  createSession(sender, 'numberguess', isWhisper, data);
  sendGameResponse(sender, 'I picked a number 1-100. Guess it!', isWhisper);
  emitActivity(sender, 'numberguess', 'started');
}

// ── Fortune ──

function handleFortune(sender, isWhisper) {
  setCooldown(sender);

  // Use custom fortunes first if available, otherwise use fallback list
  var pool = customFortunes.length > 0 ? customFortunes : ['The Dubhaimid stir... guard your path, Aisling.', 'Danaan smiles upon you this moon.', 'Seek the altar of Glioca for answers.', 'The elements shift - Srad rises.', 'An old power awakens beneath Mileth.', 'Chadul whispers your name in the dark.', 'The mundanes speak of your deeds.', 'Trust the path of your element, Aisling.'];
  var fortune = pool[Math.floor(Math.random() * pool.length)];
  sendGameResponse(sender, 'Oracle: ' + fortune, isWhisper);
  emitActivity(sender, 'fortune', 'told');
}

// ── Rock Paper Scissors ──

function startRps(sender, isWhisper) {
  setCooldown(sender);
  var botChoice = RPS_CHOICES[Math.floor(Math.random() * 3)];
  var session = createSession(sender, 'rps', isWhisper, {
    question: 'RPS',
    answer: botChoice,
    hint: 'rock, paper, or scissors'
  });
  session.botChoice = botChoice;
  session.playerWins = 0;
  session.botWins = 0;
  session.currentRound = 1;
  var prompt = isWhisper ? 'RPS! Best 2 of 3. Round 1 - type rock, paper, or scissors!' : 'RPS! Best 2 of 3. Round 1 - do your emote!';
  sendGameResponse(sender, prompt, isWhisper);
  emitActivity(sender, 'rps', 'started');
}

// Called when a player's emote animation is detected via 0x1A packet
function handleEmote(senderName, bodyAnimId) {
  if (!config.enabled || !config.games.rps) return;
  var choice = RPS_ANIM_TO_CHOICE[bodyAnimId];
  if (!choice) return;
  var key = senderName.toLowerCase();
  var session = activeGames.get(key);
  if (!session || session.gameType !== 'rps') return;
  handleRpsRound(session, choice);
}
function handleRpsAnswer(session, message) {
  var choice = message.trim().toLowerCase();
  if (RPS_CHOICES.indexOf(choice) === -1) return;
  handleRpsRound(session, choice);
}
function handleRpsRound(session, choice) {
  // Prevent duplicate processing from emote spam / held emotes
  if (session.roundLocked) return;
  session.roundLocked = true;
  var botChoice = session.botChoice;
  var playerName = session.playerName;
  var whisper = session.isWhisper;

  // Send the bot's emote (only in public games to avoid spamming chat)
  if (!whisper && sendEmote) sendEmote(RPS_EMOTES[botChoice]);

  // Determine round result
  if (choice === botChoice) {
    // Draw - pick new bot choice, replay same round
    session.botChoice = RPS_CHOICES[Math.floor(Math.random() * 3)];
    setTimeout(function () {
      sendGameResponse(playerName, 'We both chose ' + botChoice + '! Draw! Go again.', whisper);
      setTimeout(function () {
        session.roundLocked = false;
      }, 300);
    }, 800);
    return;
  }
  var playerWon = RPS_BEATS[choice] === botChoice;
  if (playerWon) {
    session.playerWins++;
  } else {
    session.botWins++;
  }
  var roundMsg = choice + ' vs ' + botChoice + ' - ';
  if (playerWon) {
    roundMsg += 'You win this round!';
  } else {
    roundMsg += 'I win this round!';
  }
  var score = ' (' + playerName + ' ' + session.playerWins + '-' + session.botWins + ')';
  setTimeout(function () {
    sendGameResponse(playerName, 'R' + session.currentRound + ': ' + roundMsg + score, whisper);

    // Check for match winner
    if (session.playerWins >= 2) {
      setTimeout(function () {
        sendGameResponse(playerName, playerName + ' wins the match! GG!', whisper);
        recordGame(playerName, true, 'rps');
        cancelSession(playerName);
        emitActivity(playerName, 'rps', 'won the match');
      }, 800);
    } else if (session.botWins >= 2) {
      setTimeout(function () {
        sendGameResponse(playerName, 'I win the match! Better luck next time.', whisper);
        recordGame(playerName, false, 'rps');
        cancelSession(playerName);
        emitActivity(playerName, 'rps', 'lost the match');
      }, 800);
    } else {
      // Next round
      session.currentRound++;
      session.botChoice = RPS_CHOICES[Math.floor(Math.random() * 3)];
      var nextPrompt = whisper ? 'Round ' + session.currentRound + ' - type rock, paper, or scissors!' : 'Round ' + session.currentRound + ' - do your emote!';
      setTimeout(function () {
        sendGameResponse(playerName, nextPrompt, whisper);
        session.roundLocked = false;
      }, 800);
    }
  }, 800);
}

// ── Blackjack ──

var BJ_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
var BJ_STARTING_CHIPS = 500000;
var BJ_MIN_BET = 100;
var BJ_MAX_BET = 100000;
var BJ_SOLO_ACTION_TIMEOUT = 60000;
var BJ_SOLO_SESSION_TIMEOUT = 600000;
var BJ_GROUP_ACTION_TIMEOUT = 45000;
var BJ_GROUP_LOBBY_TIMEOUT = 90000;
var BJ_GROUP_BETWEEN_HANDS = 5000;
var BJ_GROUP_MAX_HANDS = 20;

// ── Streak & Milestone Config ──

var BJ_STREAK_BONUSES = [{
  streak: 3,
  multiplier: 1.5,
  label: '{=c3-win streak! 1.5x payout'
}, {
  streak: 5,
  multiplier: 2.0,
  label: '{=c5-win streak! 2x payout!'
}, {
  streak: 7,
  multiplier: 2.5,
  label: '{=c7-win streak! 2.5x payout!!'
}, {
  streak: 10,
  multiplier: 3.0,
  label: '{=c10-WIN STREAK! 3x PAYOUT!!!'
}];
var BJ_MILESTONES = [100000, 250000, 500000, 1000000, 2500000, 5000000];

// ── Dealer Flavor Text ──

var BJ_DEAL_COMMENTS = ['{=aCards are out. Lets see what we got.', '{=aFresh hand coming your way.', '{=aDealing... good luck out there.', '{=aAlright, cards on the table.', '{=aAnother round, another chance.'];
var BJ_BLACKJACK_CONGRATS = ['{=cNatural 21! Beautiful hand!', '{=cBlackjack baby! Thats how its done!', '{=cBLACKJACK! Chefs kiss.', '{=cNow THAT is a hand!'];
var BJ_DEALER_BJ = ['{=rOuch. Dealer flips blackjack.', '{=rHate to show you this... blackjack.', '{=rSorry friend. Natural 21 over here.'];
var BJ_PLAYER_BUST = ['{=rBust! Rough break.', '{=rOoof, too many. Busted.', '{=rWent a little too far there.', '{=rThats a bust. It happens.', '{=rOver 21. Tough luck.'];
var BJ_DEALER_BUST = ['{=dDealer busts! Your lucky day.', '{=dToo many for the house! You win!', '{=dDealer went overboard. Nice.', '{=dBusted! House takes the L.'];
var BJ_WIN_COMMENTS = ['{=dWinner winner!', '{=dNice hand! Chips coming your way.', '{=dThats a W. Well played.', '{=dYou beat the house. Respect.'];
var BJ_LOSE_COMMENTS = ['{=rHouse wins this one.', '{=rNot your hand. Next one though.', '{=rDealer takes it. Hang in there.', '{=rTough break. The table will turn.'];
var BJ_PUSH_COMMENTS = ['{=bPush! Nobody wins, nobody loses.', '{=bTied up. Bet comes back.', '{=bDead even. Well see next hand.'];
var BJ_CLOSE_WIN = ['{=dSqueaked it out! Close one.', '{=dBy the skin of your teeth! Nice.', '{=dThat was CLOSE. But a win is a win.'];
var BJ_CLOSE_LOSS = ['{=rSo close! One more wouldve done it.', '{=rAgh, just barely. Painful.', '{=rOff by one. Thats rough.'];
var BJ_DEALER_REVEAL = ['{=cDealer flips... ', '{=cAnd the hole card is... ', '{=cMoment of truth... ', '{=cDealer reveals... '];
var BJ_HIT_REACTIONS_GOOD = ['{=dSolid card.', '{=dNot bad at all.', '{=dStill in it!'];
var BJ_HIT_REACTIONS_RISKY = ['{=oGetting up there...', '{=oLiving dangerously!', '{=oBrave move.'];
var BJ_HIT_21 = ['{=c21! Perfect!', '{=cTwenty-one on the dot!', '{=cNailed it! 21!'];
var BJ_HOT_STATUS = ['{=o[HOT] ', '{=o[FIRE] ', '{=o[STREAK] '];
var BJ_COLD_STATUS = ['{=b[COLD] ', '{=b[ICE] ', '{=b[ROUGH] '];
var BJ_STREAK_BROKEN = ['{=rStreak broken at ', '{=rRun ends at '];
var BJ_LOSS_STREAK = ['{=bHang in there. Itll turn around.', '{=bCold spell. Stay patient.', '{=bRough patch. Keep playing.'];

// ── Blackjack Deck & Helpers ──

function bjCreateDeck() {
  var deck = [];
  for (var r = 0; r < BJ_RANKS.length; r++) {
    // 4 copies of each rank (no suit tracking)
    deck.push(BJ_RANKS[r], BJ_RANKS[r], BJ_RANKS[r], BJ_RANKS[r]);
  }
  for (var i = deck.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
  return deck;
}
function bjDeal(state) {
  if (state.deckIndex >= state.deck.length) {
    state.deck = bjCreateDeck();
    state.deckIndex = 0;
  }
  return state.deck[state.deckIndex++];
}
function bjCardValue(card) {
  var r = card[0];
  if (r === 'A') return 11;
  if (r === 'T' || r === 'J' || r === 'Q' || r === 'K') return 10;
  return parseInt(r);
}
function bjHandTotal(hand) {
  var total = 0;
  var aces = 0;
  for (var i = 0; i < hand.length; i++) {
    var v = bjCardValue(hand[i]);
    if (v === 11) aces++;
    total += v;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}
function bjIsBlackjack(hand) {
  return hand.length === 2 && bjHandTotal(hand) === 21;
}
function bjFormatCards(hand) {
  return hand.join(' ');
}
function bjFormatHand(hand) {
  return bjFormatCards(hand) + ' (' + bjHandTotal(hand) + ')';
}

// ── Streak & Personality Helpers ──

function bjPickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function bjGetStreakMultiplier(winStreak) {
  var mult = 1.0;
  for (var i = 0; i < BJ_STREAK_BONUSES.length; i++) {
    if (winStreak >= BJ_STREAK_BONUSES[i].streak) {
      mult = BJ_STREAK_BONUSES[i].multiplier;
    }
  }
  return mult;
}
function bjGetStreakLabel(winStreak) {
  var label = '';
  for (var i = 0; i < BJ_STREAK_BONUSES.length; i++) {
    if (winStreak >= BJ_STREAK_BONUSES[i].streak) {
      label = BJ_STREAK_BONUSES[i].label;
    }
  }
  return label;
}
function bjGetStatusTag(session) {
  if (session.winStreak >= 3) return bjPickRandom(BJ_HOT_STATUS);
  if (session.lossStreak >= 3) return bjPickRandom(BJ_COLD_STATUS);
  return '';
}
function bjCheckMilestone(session, oldChips) {
  var newChips = session.playerChips;
  for (var i = 0; i < BJ_MILESTONES.length; i++) {
    var m = BJ_MILESTONES[i];
    if (oldChips < m && newChips >= m) {
      var label = m >= 1000000 ? m / 1000000 + 'M' : m / 1000 + 'K';
      sendGameResponse(session.playerName, '{=wMILESTONE! You hit ' + label + ' chips!', session.isWhisper);
    }
  }
  if (newChips > session.peakChips) {
    session.peakChips = newChips;
  }
}
function bjApplyStreakBonus(session, baseWinnings) {
  var mult = bjGetStreakMultiplier(session.winStreak);
  if (mult > 1.0) {
    var bonus = Math.floor(baseWinnings * mult) - baseWinnings;
    sendGameResponse(session.playerName, bjGetStreakLabel(session.winStreak) + ' +' + bonus, session.isWhisper);
    return baseWinnings + bonus;
  }
  return baseWinnings;
}
function bjGetSavedChips(playerName) {
  var key = playerName.toLowerCase();
  var stats = scoreboard.get(key);
  if (stats && stats.byGame && stats.byGame.blackjack && typeof stats.byGame.blackjack.chips === 'number') {
    return stats.byGame.blackjack.chips || BJ_STARTING_CHIPS; // reset if 0
  }
  return BJ_STARTING_CHIPS;
}
function bjSaveChips(playerName, chips) {
  var key = playerName.toLowerCase();
  var stats = scoreboard.get(key) || {
    name: playerName,
    wins: 0,
    played: 0,
    currentStreak: 0,
    bestStreak: 0
  };
  if (!stats.byGame) stats.byGame = {};
  if (!stats.byGame.blackjack) stats.byGame.blackjack = {
    wins: 0,
    played: 0
  };
  stats.byGame.blackjack.chips = chips;
  stats.name = playerName;
  scoreboard.set(key, stats);
  saveLeaderboard(playerName);
}

// ── Solo Blackjack ──

function startBlackjack(sender, isWhisper) {
  // Check if player is in group blackjack
  if (bjGroupSession) {
    var seats = bjGroupSession.seats;
    for (var i = 0; i < seats.length; i++) {
      if (seats[i].name.toLowerCase() === sender.toLowerCase() && !seats[i].eliminated) {
        sendGameResponse(sender, 'You are in a group blackjack game.', isWhisper);
        return;
      }
    }
  }
  setCooldown(sender);
  cancelSession(sender);
  var deck = bjCreateDeck();
  var session = {
    playerName: sender,
    gameType: 'blackjack',
    isWhisper: isWhisper,
    startedAt: Date.now(),
    attempts: 0,
    maxAttempts: 999,
    question: 'blackjack',
    answer: '',
    hint: '',
    bjMode: 'solo',
    deck: deck,
    deckIndex: 0,
    playerHand: [],
    dealerHand: [],
    playerChips: bjGetSavedChips(sender),
    currentBet: 0,
    phase: 'betting',
    handNumber: 1,
    canDouble: false,
    canSplit: false,
    splitHand: null,
    playingSplit: false,
    winStreak: 0,
    lossStreak: 0,
    totalWins: 0,
    totalLosses: 0,
    peakChips: bjGetSavedChips(sender),
    chipsBeforeHand: 0,
    actionTimer: null,
    timeoutTimer: setTimeout(function () {
      bjSoloTimeout(sender);
    }, BJ_SOLO_SESSION_TIMEOUT)
  };
  activeGames.set(sender.toLowerCase(), session);
  if (ioRef) {
    ioRef.emit('chatgames:sessionStart', {
      player: sender,
      gameType: 'blackjack',
      timestamp: Date.now()
    });
    ioRef.emit('chatgames:active', getActiveGames());
  }
  emitActivity(sender, 'blackjack', 'started blackjack');
  bjPromptBet(session);
}
function bjPromptBet(session) {
  var name = session.playerName;
  var w = session.isWhisper;
  session.phase = 'betting';
  var tag = bjGetStatusTag(session);
  var msg = tag + '{=cChips:' + session.playerChips + ' | Bet ' + BJ_MIN_BET + '-' + Math.min(BJ_MAX_BET, session.playerChips);
  sendGameResponse(name, msg, w);
  setTimeout(function () {
    if (session.winStreak >= 3) {
      sendGameResponse(name, '{=oWin streak: ' + session.winStreak + '! Next win ' + bjGetStreakMultiplier(session.winStreak) + 'x', w);
    }
    sendGameResponse(name, 'Type a bet amount (or "quit" to leave)', w);
  }, 800);
  if (session.actionTimer) clearTimeout(session.actionTimer);
  session.actionTimer = setTimeout(function () {
    if (!activeGames.has(session.playerName.toLowerCase())) return;
    if (session.phase !== 'betting') return;
    sendGameResponse(name, 'Time up! Auto-bet ' + BJ_MIN_BET + '.', w);
    bjPlaceBet(session, BJ_MIN_BET);
  }, BJ_SOLO_ACTION_TIMEOUT);
}
function bjPlaceBet(session, amount) {
  session.chipsBeforeHand = session.playerChips;
  var bet = Math.max(BJ_MIN_BET, Math.min(amount, session.playerChips, BJ_MAX_BET));
  session.currentBet = bet;
  session.playerChips -= bet;
  session.phase = 'dealing';
  bjDealHand(session);
}
function bjDealHand(session) {
  var name = session.playerName;
  var w = session.isWhisper;
  session.playerHand = [bjDeal(session), bjDeal(session)];
  session.dealerHand = [bjDeal(session), bjDeal(session)];
  session.splitHand = null;
  session.playingSplit = false;
  var dealerUp = session.dealerHand[0];
  sendGameResponse(name, '{=c--- Hand ' + session.handNumber + ' | Bet:' + session.currentBet + ' ---', w);
  if (Math.random() < 0.5) {
    setTimeout(function () {
      sendGameResponse(name, bjPickRandom(BJ_DEAL_COMMENTS), w);
    }, 400);
  }
  setTimeout(function () {
    if (w) {
      sendGameResponse(name, '{=aYou: ' + bjFormatHand(session.playerHand) + ' | Dealer: ' + dealerUp + ' ??', true);
    } else {
      if (sendWhisper) {
        var chunks = splitMessage('BJ Hand: ' + bjFormatHand(session.playerHand), WHISPER_MAX);
        chunks.forEach(function (chunk, ci) {
          setTimeout(function () {
            sendWhisper(name, chunk);
          }, ci * 500);
        });
      }
      sendGameResponse(name, 'Cards whispered! Dealer shows: ' + dealerUp, false);
    }
    if (bjIsBlackjack(session.playerHand) && bjIsBlackjack(session.dealerHand)) {
      setTimeout(function () {
        sendGameResponse(name, '{=bBoth blackjack! Push. Bet returned.', w);
        session.playerChips += session.currentBet;
        bjNextHand(session);
      }, 1200);
      return;
    }
    if (bjIsBlackjack(session.playerHand)) {
      setTimeout(function () {
        var winnings = Math.floor(session.currentBet * 2.5);
        session.winStreak++;
        session.lossStreak = 0;
        session.totalWins++;
        winnings = bjApplyStreakBonus(session, winnings);
        sendGameResponse(name, bjPickRandom(BJ_BLACKJACK_CONGRATS) + ' {=cWin ' + winnings + '!', w);
        session.playerChips += winnings;
        recordGame(name, true, 'blackjack');
        emitActivity(name, 'blackjack', 'got blackjack');
        bjNextHand(session);
      }, 1200);
      return;
    }
    if (bjIsBlackjack(session.dealerHand)) {
      setTimeout(function () {
        sendGameResponse(name, bjPickRandom(BJ_DEALER_BJ), w);
        sendGameResponse(name, '{=rYou lose ' + session.currentBet + '.', w);
        if (session.winStreak >= 3) {
          sendGameResponse(name, bjPickRandom(BJ_STREAK_BROKEN) + session.winStreak + '.', w);
        }
        session.lossStreak++;
        session.winStreak = 0;
        session.totalLosses++;
        recordGame(name, false, 'blackjack');
        emitActivity(name, 'blackjack', 'dealer blackjack');
        bjNextHand(session);
      }, 1200);
      return;
    }

    // Check for split/double eligibility
    session.canDouble = session.playerChips >= session.currentBet && session.playerHand.length === 2;
    var r1 = bjCardValue(session.playerHand[0]);
    var r2 = bjCardValue(session.playerHand[1]);
    session.canSplit = r1 === r2 && session.playerChips >= session.currentBet;
    setTimeout(function () {
      bjPromptAction(session);
    }, 1200);
  }, 800);
}
function bjPromptAction(session) {
  if (!activeGames.has(session.playerName.toLowerCase())) return;
  session.phase = 'playing';
  var handLabel = session.playingSplit ? 'Split hand' : 'Your hand';
  var hand = session.playingSplit ? session.splitHand : session.playerHand;
  var options = 'hit/stand';
  if (session.canDouble && !session.playingSplit) options += '/double';
  if (session.canSplit && !session.playingSplit && !session.splitHand) options += '/split';
  var tag = bjGetStatusTag(session);
  var msg = tag + '{=a' + handLabel + ': ' + bjFormatHand(hand) + ' | ' + options;
  sendGameResponse(session.playerName, msg, session.isWhisper);
  if (session.actionTimer) clearTimeout(session.actionTimer);
  session.actionTimer = setTimeout(function () {
    if (!activeGames.has(session.playerName.toLowerCase())) return;
    if (session.phase !== 'playing') return;
    sendGameResponse(session.playerName, 'Time up! Auto-stand.', session.isWhisper);
    bjStand(session);
  }, BJ_SOLO_ACTION_TIMEOUT);
}
function handleBlackjackAction(session, message) {
  var msg = message.trim().toLowerCase();
  if (session.phase === 'betting') {
    if (msg === 'quit' || msg === 'leave') {
      bjSaveChips(session.playerName, session.playerChips);
      sendGameResponse(session.playerName, '{=aLeft blackjack. {=cChips:' + session.playerChips, session.isWhisper);
      cancelSession(session.playerName);
      emitActivity(session.playerName, 'blackjack', 'quit');
      return;
    }
    var betAmt = parseInt(msg);
    if (isNaN(betAmt) || betAmt < BJ_MIN_BET) {
      sendGameResponse(session.playerName, 'Bet ' + BJ_MIN_BET + '-' + Math.min(BJ_MAX_BET, session.playerChips) + ' or "quit"', session.isWhisper);
      return;
    }
    if (session.actionTimer) clearTimeout(session.actionTimer);
    bjPlaceBet(session, betAmt);
    return;
  }
  if (session.phase !== 'playing') return;
  if (session.actionTimer) clearTimeout(session.actionTimer);
  if (msg === 'hit' || msg === 'h') {
    bjHit(session);
  } else if (msg === 'stand' || msg === 's' || msg === 'stay') {
    bjStand(session);
  } else if ((msg === 'double' || msg === 'dd' || msg === 'd') && session.canDouble && !session.playingSplit) {
    bjDouble(session);
  } else if (msg === 'split' && session.canSplit && !session.playingSplit && !session.splitHand) {
    bjSplit(session);
  } else {
    sendGameResponse(session.playerName, 'Try: hit, stand' + (session.canDouble && !session.playingSplit ? ', double' : '') + (session.canSplit && !session.playingSplit && !session.splitHand ? ', split' : ''), session.isWhisper);
    bjPromptAction(session);
  }
}
function bjHit(session) {
  var hand = session.playingSplit ? session.splitHand : session.playerHand;
  hand.push(bjDeal(session));
  var total = bjHandTotal(hand);
  var label = session.playingSplit ? 'Split' : 'You';
  sendGameResponse(session.playerName, '{=a' + label + ': ' + bjFormatHand(hand), session.isWhisper);
  if (total > 21) {
    setTimeout(function () {
      sendGameResponse(session.playerName, bjPickRandom(BJ_PLAYER_BUST), session.isWhisper);
      if (session.playingSplit) {
        session.playingSplit = false;
        // Check if main hand still needs playing (it was played first in our flow, so split bust means done)
        bjDealerPlay(session);
      } else if (session.splitHand) {
        // Move to split hand
        session.playingSplit = true;
        session.canDouble = false;
        setTimeout(function () {
          bjPromptAction(session);
        }, 800);
      } else {
        bjDealerPlay(session);
      }
    }, 800);
    return;
  }
  if (total === 21) {
    setTimeout(function () {
      sendGameResponse(session.playerName, bjPickRandom(BJ_HIT_21), session.isWhisper);
      if (session.playingSplit) {
        session.playingSplit = false;
        bjDealerPlay(session);
      } else if (session.splitHand) {
        session.playingSplit = true;
        session.canDouble = false;
        setTimeout(function () {
          bjPromptAction(session);
        }, 800);
      } else {
        bjDealerPlay(session);
      }
    }, 800);
    return;
  }
  if (total >= 17 && Math.random() < 0.6) {
    sendGameResponse(session.playerName, bjPickRandom(BJ_HIT_REACTIONS_RISKY), session.isWhisper);
  } else if (total <= 16 && Math.random() < 0.4) {
    sendGameResponse(session.playerName, bjPickRandom(BJ_HIT_REACTIONS_GOOD), session.isWhisper);
  }
  session.canDouble = false;
  session.canSplit = false;
  setTimeout(function () {
    bjPromptAction(session);
  }, 800);
}
function bjStand(session) {
  if (session.playingSplit) {
    session.playingSplit = false;
    bjDealerPlay(session);
  } else if (session.splitHand) {
    session.playingSplit = true;
    session.canDouble = false;
    sendGameResponse(session.playerName, '{=aStanding. Now playing split hand.', session.isWhisper);
    setTimeout(function () {
      bjPromptAction(session);
    }, 800);
  } else {
    bjDealerPlay(session);
  }
}
function bjDouble(session) {
  session.playerChips -= session.currentBet;
  session.currentBet *= 2;
  var hand = session.playerHand;
  hand.push(bjDeal(session));
  var total = bjHandTotal(hand);
  sendGameResponse(session.playerName, '{=cDouble! ' + bjFormatHand(hand) + ' Bet:' + session.currentBet, session.isWhisper);
  if (total > 21) {
    setTimeout(function () {
      sendGameResponse(session.playerName, bjPickRandom(BJ_PLAYER_BUST), session.isWhisper);
      if (session.splitHand) {
        session.playingSplit = true;
        setTimeout(function () {
          bjPromptAction(session);
        }, 800);
      } else {
        bjDealerPlay(session);
      }
    }, 800);
  } else {
    // Auto-stand after double
    if (session.splitHand) {
      session.playingSplit = true;
      session.canDouble = false;
      setTimeout(function () {
        sendGameResponse(session.playerName, 'Now playing split hand.', session.isWhisper);
        setTimeout(function () {
          bjPromptAction(session);
        }, 800);
      }, 800);
    } else {
      setTimeout(function () {
        bjDealerPlay(session);
      }, 800);
    }
  }
}
function bjSplit(session) {
  session.playerChips -= session.currentBet;
  session.splitHand = [session.playerHand.pop()];
  session.playerHand.push(bjDeal(session));
  session.splitHand.push(bjDeal(session));
  session.canSplit = false;
  session.canDouble = session.playerChips >= session.currentBet;
  sendGameResponse(session.playerName, '{=cSplit! {=aHand 1: ' + bjFormatHand(session.playerHand), session.isWhisper);
  setTimeout(function () {
    sendGameResponse(session.playerName, '{=aHand 2: ' + bjFormatHand(session.splitHand), session.isWhisper);
    setTimeout(function () {
      sendGameResponse(session.playerName, 'Playing hand 1 first.', session.isWhisper);
      setTimeout(function () {
        bjPromptAction(session);
      }, 800);
    }, 800);
  }, 800);
}
function bjDealerPlay(session) {
  if (!activeGames.has(session.playerName.toLowerCase())) return;
  session.phase = 'dealer';
  var name = session.playerName;
  var w = session.isWhisper;

  // Check if all player hands busted
  var mainBust = bjHandTotal(session.playerHand) > 21;
  var splitBust = session.splitHand ? bjHandTotal(session.splitHand) > 21 : true;
  if (mainBust && splitBust) {
    sendGameResponse(name, bjPickRandom(BJ_DEALER_REVEAL) + session.dealerHand[1], w);
    setTimeout(function () {
      sendGameResponse(name, '{=aDealer: ' + bjFormatHand(session.dealerHand), w);
      setTimeout(function () {
        var totalLost = session.splitHand ? session.currentBet * 2 : session.currentBet;
        sendGameResponse(name, '{=rYou lose ' + totalLost + '.', w);
        if (session.winStreak >= 3) {
          sendGameResponse(name, bjPickRandom(BJ_STREAK_BROKEN) + session.winStreak + '.', w);
        }
        session.lossStreak++;
        session.winStreak = 0;
        session.totalLosses++;
        if (session.lossStreak === 3 || session.lossStreak === 5) {
          sendGameResponse(name, bjPickRandom(BJ_LOSS_STREAK), w);
        }
        recordGame(name, false, 'blackjack');
        bjNextHand(session);
      }, 800);
    }, 1000);
    return;
  }
  sendGameResponse(name, bjPickRandom(BJ_DEALER_REVEAL) + session.dealerHand[1], w);
  function dealerDraw() {
    var dealerTotal = bjHandTotal(session.dealerHand);
    if (dealerTotal < 17) {
      setTimeout(function () {
        session.dealerHand.push(bjDeal(session));
        sendGameResponse(name, '{=aDealer draws: ' + bjFormatHand(session.dealerHand), w);
        dealerDraw();
      }, 1200);
    } else {
      setTimeout(function () {
        bjResolve(session);
      }, 800);
    }
  }
  setTimeout(function () {
    sendGameResponse(name, '{=aDealer: ' + bjFormatHand(session.dealerHand), w);
    setTimeout(function () {
      dealerDraw();
    }, 800);
  }, 1000);
}
function bjResolve(session) {
  var name = session.playerName;
  var w = session.isWhisper;
  var dealerTotal = bjHandTotal(session.dealerHand);
  var dealerBust = dealerTotal > 21;
  function resolveHand(hand, bet, label) {
    var playerTotal = bjHandTotal(hand);
    var playerBust = playerTotal > 21;
    var diff = Math.abs(playerTotal - dealerTotal);
    var flavor = '';
    if (playerBust) {
      return {
        result: 'lose',
        winnings: 0,
        flavor: '',
        msg: '{=r' + label + ': Bust. Lose ' + bet + '.'
      };
    }
    if (dealerBust) {
      flavor = bjPickRandom(BJ_DEALER_BUST);
      return {
        result: 'win',
        winnings: bet * 2,
        flavor: flavor,
        msg: '{=d' + label + ': Dealer bust! Win ' + bet + '!'
      };
    }
    if (playerTotal > dealerTotal) {
      flavor = diff === 1 ? bjPickRandom(BJ_CLOSE_WIN) : bjPickRandom(BJ_WIN_COMMENTS);
      return {
        result: 'win',
        winnings: bet * 2,
        flavor: flavor,
        msg: '{=d' + label + ': ' + playerTotal + ' vs ' + dealerTotal + '. Win ' + bet + '!'
      };
    }
    if (playerTotal < dealerTotal) {
      flavor = diff === 1 ? bjPickRandom(BJ_CLOSE_LOSS) : bjPickRandom(BJ_LOSE_COMMENTS);
      return {
        result: 'lose',
        winnings: 0,
        flavor: flavor,
        msg: '{=r' + label + ': ' + playerTotal + ' vs ' + dealerTotal + '. Lose ' + bet + '.'
      };
    }
    flavor = bjPickRandom(BJ_PUSH_COMMENTS);
    return {
      result: 'push',
      winnings: bet,
      flavor: flavor,
      msg: '{=b' + label + ': ' + playerTotal + ' vs ' + dealerTotal + '. Push!'
    };
  }
  function sendResultWithFlavor(result) {
    sendGameResponse(name, result.msg, w);
    if (result.flavor && Math.random() < 0.6) {
      sendGameResponse(name, result.flavor, w);
    }
  }
  function applyStreakAfterResolve(won, lost) {
    if (won) {
      session.winStreak++;
      session.lossStreak = 0;
      session.totalWins++;
      recordGame(name, true, 'blackjack');
    } else if (lost) {
      if (session.winStreak >= 3) {
        sendGameResponse(name, bjPickRandom(BJ_STREAK_BROKEN) + session.winStreak + '.', w);
      }
      session.lossStreak++;
      session.winStreak = 0;
      session.totalLosses++;
      if (session.lossStreak === 3 || session.lossStreak === 5) {
        sendGameResponse(name, bjPickRandom(BJ_LOSS_STREAK), w);
      }
      recordGame(name, false, 'blackjack');
    }
  }
  var mainResult = resolveHand(session.playerHand, session.currentBet, session.splitHand ? 'Hand 1' : 'Result');
  session.playerChips += mainResult.winnings;
  sendResultWithFlavor(mainResult);
  var anyWin = mainResult.result === 'win';
  if (session.splitHand) {
    var splitBet = session.currentBet;
    setTimeout(function () {
      var splitResult = resolveHand(session.splitHand, splitBet, 'Hand 2');
      session.playerChips += splitResult.winnings;
      sendResultWithFlavor(splitResult);
      if (splitResult.result === 'win') anyWin = true;
      var allLose = mainResult.result === 'lose' && splitResult.result === 'lose';
      setTimeout(function () {
        applyStreakAfterResolve(anyWin, allLose);
        if (anyWin) {
          var bonus = bjApplyStreakBonus(session, mainResult.winnings + splitResult.winnings);
          var extra = bonus - (mainResult.winnings + splitResult.winnings);
          if (extra > 0) session.playerChips += extra;
        }
        bjNextHand(session);
      }, 800);
    }, 800);
  } else {
    setTimeout(function () {
      applyStreakAfterResolve(mainResult.result === 'win', mainResult.result === 'lose');
      if (mainResult.result === 'win') {
        var bonus = bjApplyStreakBonus(session, mainResult.winnings);
        var extra = bonus - mainResult.winnings;
        if (extra > 0) session.playerChips += extra;
      }
      bjNextHand(session);
    }, 800);
  }
}
function bjNextHand(session) {
  if (!activeGames.has(session.playerName.toLowerCase())) return;
  if (session.playerChips <= 0) {
    bjSaveChips(session.playerName, 0);
    sendGameResponse(session.playerName, '{=rOut of chips! Game over.', session.isWhisper);
    cancelSession(session.playerName);
    emitActivity(session.playerName, 'blackjack', 'busted out');
    return;
  }
  session.handNumber++;
  bjCheckMilestone(session, session.chipsBeforeHand);
  bjSaveChips(session.playerName, session.playerChips);
  var record = session.totalWins + 'W-' + session.totalLosses + 'L';
  sendGameResponse(session.playerName, '{=cChips: ' + session.playerChips + ' | ' + record, session.isWhisper);
  setTimeout(function () {
    if (activeGames.has(session.playerName.toLowerCase())) {
      bjPromptBet(session);
    }
  }, 3000);
}
function bjSoloTimeout(playerName) {
  var key = playerName.toLowerCase();
  var session = activeGames.get(key);
  if (!session || session.gameType !== 'blackjack') return;
  bjSaveChips(playerName, session.playerChips);
  sendGameResponse(playerName, '{=rBlackjack timed out.', session.isWhisper);
  cancelSession(playerName);
  emitActivity(playerName, 'blackjack', 'timed out');
}

// ── Group Blackjack ──

function startBjLobby(sender, args) {
  if (bjGroupSession) {
    sendGameResponse(sender, 'A blackjack table is already open.', false);
    return;
  }
  var existing = activeGames.get(sender.toLowerCase());
  if (existing) {
    sendGameResponse(sender, 'Finish your current game first.', false);
    return;
  }
  var maxSeats = 4;
  if (args) {
    var parsed = parseInt(args);
    if (parsed >= 2 && parsed <= 5) maxSeats = parsed;
  }
  setCooldown(sender);
  bjGroupSession = {
    hostPlayer: sender,
    phase: 'lobby',
    seats: [{
      name: sender,
      chips: BJ_STARTING_CHIPS,
      hand: [],
      splitHand: null,
      playingSplit: false,
      currentBet: 0,
      standing: false,
      busted: false,
      eliminated: false,
      hasActed: false
    }],
    maxSeats: maxSeats,
    deck: bjCreateDeck(),
    deckIndex: 0,
    dealerHand: [],
    currentTurnIndex: 0,
    handNumber: 0,
    maxHands: BJ_GROUP_MAX_HANDS,
    bettingCount: 0,
    actionTimer: null,
    lobbyTimer: setTimeout(function () {
      bjGroupLobbyTimeout();
    }, BJ_GROUP_LOBBY_TIMEOUT)
  };
  var p = config.commandPrefix || '!';
  sendGameResponse(sender, 'Blackjack table open! ' + p + 'bjjoin (1/' + maxSeats + ')', false);
  emitActivity(sender, 'blackjack', 'opened blackjack lobby');
  if (ioRef) ioRef.emit('chatgames:bjUpdate', getBjStatus());
}
function joinBjLobby(sender) {
  if (!bjGroupSession) {
    sendGameResponse(sender, 'No blackjack table open.', false);
    return;
  }
  if (bjGroupSession.phase !== 'lobby') {
    sendGameResponse(sender, 'Game already in progress.', false);
    return;
  }
  for (var i = 0; i < bjGroupSession.seats.length; i++) {
    if (bjGroupSession.seats[i].name.toLowerCase() === sender.toLowerCase()) {
      sendGameResponse(sender, 'You are already seated.', false);
      return;
    }
  }
  var existing = activeGames.get(sender.toLowerCase());
  if (existing) {
    sendGameResponse(sender, 'Finish your current game first.', false);
    return;
  }
  bjGroupSession.seats.push({
    name: sender,
    chips: BJ_STARTING_CHIPS,
    hand: [],
    splitHand: null,
    playingSplit: false,
    currentBet: 0,
    standing: false,
    busted: false,
    eliminated: false,
    hasActed: false
  });
  var count = bjGroupSession.seats.length;
  var max = bjGroupSession.maxSeats;
  sendGameResponse(sender, sender + ' joins blackjack! (' + count + '/' + max + ')', false);
  emitActivity(sender, 'blackjack', 'joined blackjack lobby');
  if (ioRef) ioRef.emit('chatgames:bjUpdate', getBjStatus());
  if (count >= max) {
    bjGroupStartGame();
  }
}
function forceStartBj(sender) {
  if (!bjGroupSession) {
    sendGameResponse(sender, 'No blackjack table open.', false);
    return;
  }
  if (sender !== 'Panel' && bjGroupSession.hostPlayer.toLowerCase() !== sender.toLowerCase()) {
    sendGameResponse(sender, 'Only the host can start.', false);
    return;
  }
  if (bjGroupSession.phase !== 'lobby') {
    sendGameResponse(sender, 'Game already started.', false);
    return;
  }
  if (bjGroupSession.seats.length < 2) {
    sendGameResponse(sender, 'Need at least 2 players.', false);
    return;
  }
  bjGroupStartGame();
}
function bjGroupLobbyTimeout() {
  if (!bjGroupSession || bjGroupSession.phase !== 'lobby') return;
  if (bjGroupSession.seats.length >= 2) {
    sendGameResponse(bjGroupSession.hostPlayer, 'Lobby timer up. Dealing!', false);
    bjGroupStartGame();
  } else {
    sendGameResponse(bjGroupSession.hostPlayer, 'Not enough players. Cancelled.', false);
    bjGroupCleanup();
  }
}
function bjGroupStartGame() {
  if (!bjGroupSession) return;
  if (bjGroupSession.lobbyTimer) {
    clearTimeout(bjGroupSession.lobbyTimer);
    bjGroupSession.lobbyTimer = null;
  }
  var names = bjGroupSession.seats.map(function (s) {
    return s.name;
  }).join(', ');
  sendGameResponse(bjGroupSession.hostPlayer, 'Blackjack starting! ' + names, false);
  emitActivity(bjGroupSession.hostPlayer, 'blackjack', 'group game started');
  if (ioRef) ioRef.emit('chatgames:bjUpdate', getBjStatus());
  setTimeout(function () {
    bjGroupDealHand();
  }, 1500);
}
function bjGroupDealHand() {
  var gs = bjGroupSession;
  if (!gs) return;
  gs.handNumber++;
  if (gs.handNumber > gs.maxHands) {
    bjGroupEndByLimit();
    return;
  }

  // Reshuffle if needed
  if (gs.deckIndex > 30) {
    gs.deck = bjCreateDeck();
    gs.deckIndex = 0;
  }
  gs.dealerHand = [];
  gs.phase = 'betting';
  gs.bettingCount = 0;

  // Reset seats
  var activePlayers = 0;
  for (var i = 0; i < gs.seats.length; i++) {
    if (!gs.seats[i].eliminated) {
      gs.seats[i].hand = [];
      gs.seats[i].splitHand = null;
      gs.seats[i].playingSplit = false;
      gs.seats[i].currentBet = 0;
      gs.seats[i].standing = false;
      gs.seats[i].busted = false;
      gs.seats[i].hasActed = false;
      activePlayers++;
    }
  }
  if (activePlayers < 2) {
    bjGroupEndGame();
    return;
  }
  sendGameResponse(gs.hostPlayer, '--- Hand ' + gs.handNumber + '/' + gs.maxHands + ' ---', false);
  setTimeout(function () {
    bjGroupPromptBets();
  }, 800);
}
function bjGroupPromptBets() {
  var gs = bjGroupSession;
  if (!gs) return;
  var p = config.commandPrefix || '!';
  sendGameResponse(gs.hostPlayer, 'Place bets! ' + p + 'bet <amount>', false);
  setTimeout(function () {
    var chipList = '';
    for (var i = 0; i < gs.seats.length; i++) {
      if (!gs.seats[i].eliminated) {
        if (chipList) chipList += ', ';
        chipList += gs.seats[i].name + ':' + gs.seats[i].chips;
      }
    }
    sendGameResponse(gs.hostPlayer, chipList, false);
  }, 800);
  if (gs.actionTimer) clearTimeout(gs.actionTimer);
  gs.actionTimer = setTimeout(function () {
    bjGroupAutoBets();
  }, BJ_GROUP_ACTION_TIMEOUT);
}
function bjGroupHandleBet(sender, amount) {
  var gs = bjGroupSession;
  if (!gs || gs.phase !== 'betting') return false;
  var seat = null;
  for (var i = 0; i < gs.seats.length; i++) {
    if (gs.seats[i].name.toLowerCase() === sender.toLowerCase() && !gs.seats[i].eliminated) {
      seat = gs.seats[i];
      break;
    }
  }
  if (!seat) return false;
  if (seat.currentBet > 0) {
    sendGameResponse(sender, sender + ' already bet!', false);
    return true;
  }
  var bet = Math.max(BJ_MIN_BET, Math.min(amount, seat.chips, BJ_MAX_BET));
  seat.currentBet = bet;
  seat.chips -= bet;
  gs.bettingCount++;
  sendGameResponse(sender, sender + ' bets ' + bet + '.', false);

  // Check if all active players have bet
  var activeCount = 0;
  for (var j = 0; j < gs.seats.length; j++) {
    if (!gs.seats[j].eliminated) activeCount++;
  }
  if (gs.bettingCount >= activeCount) {
    if (gs.actionTimer) clearTimeout(gs.actionTimer);
    bjGroupDealCards();
  }
  return true;
}
function bjGroupAutoBets() {
  var gs = bjGroupSession;
  if (!gs || gs.phase !== 'betting') return;

  // Auto-bet minimum for anyone who hasn't bet
  for (var i = 0; i < gs.seats.length; i++) {
    var seat = gs.seats[i];
    if (!seat.eliminated && seat.currentBet === 0) {
      var bet = Math.min(BJ_MIN_BET, seat.chips);
      seat.currentBet = bet;
      seat.chips -= bet;
    }
  }
  sendGameResponse(gs.hostPlayer, 'Auto-bets placed. Dealing!', false);
  bjGroupDealCards();
}
function bjGroupDealCards() {
  var gs = bjGroupSession;
  if (!gs) return;
  gs.phase = 'playing';

  // Deal 2 cards to each player and dealer
  for (var round = 0; round < 2; round++) {
    for (var i = 0; i < gs.seats.length; i++) {
      if (!gs.seats[i].eliminated) {
        gs.seats[i].hand.push(bjDeal(gs));
      }
    }
    gs.dealerHand.push(bjDeal(gs));
  }

  // Show dealer up card
  sendGameResponse(gs.hostPlayer, 'Dealer shows: ' + gs.dealerHand[0], false);

  // Show each player's cards out loud
  setTimeout(function () {
    var cardDelay = 0;
    for (var j = 0; j < gs.seats.length; j++) {
      if (!gs.seats[j].eliminated) {
        (function (seat, d) {
          setTimeout(function () {
            sendGameResponse(gs.hostPlayer, seat.name + ': ' + bjFormatHand(seat.hand), false);
          }, d);
        })(gs.seats[j], cardDelay);
        cardDelay += 800;
      }
    }

    // Check for dealer blackjack
    if (bjIsBlackjack(gs.dealerHand)) {
      setTimeout(function () {
        sendGameResponse(gs.hostPlayer, 'Dealer blackjack! ' + bjFormatHand(gs.dealerHand), false);
        bjGroupResolveAll();
      }, 1500);
      return;
    }

    // Start turns - first active player
    setTimeout(function () {
      gs.currentTurnIndex = -1;
      bjGroupNextTurn();
    }, 1500);
  }, 800);
}
function bjGroupNextTurn() {
  var gs = bjGroupSession;
  if (!gs) return;

  // Find next active player who hasn't stood/busted
  var found = false;
  for (var i = gs.currentTurnIndex + 1; i < gs.seats.length; i++) {
    var seat = gs.seats[i];
    if (!seat.eliminated && !seat.standing && !seat.busted) {
      // Check for player blackjack - auto stand
      if (bjIsBlackjack(seat.hand)) {
        sendGameResponse(gs.hostPlayer, seat.name + ': Blackjack!', false);
        seat.standing = true;
        continue;
      }
      gs.currentTurnIndex = i;
      found = true;
      break;
    }
  }
  if (!found) {
    // All players done, dealer plays
    bjGroupDealerPlay();
    return;
  }
  var current = gs.seats[gs.currentTurnIndex];
  sendGameResponse(gs.hostPlayer, current.name + ': ' + bjFormatHand(current.hand) + ' hit/stand', false);
  if (gs.actionTimer) clearTimeout(gs.actionTimer);
  gs.actionTimer = setTimeout(function () {
    bjGroupActionTimeout();
  }, BJ_GROUP_ACTION_TIMEOUT);
}
function handleGroupBjMessage(sender, message) {
  var gs = bjGroupSession;
  if (!gs || gs.phase !== 'playing') return false;
  var seat = gs.seats[gs.currentTurnIndex];
  if (!seat || seat.name.toLowerCase() !== sender.toLowerCase()) return false;
  var msg = message.trim().toLowerCase();
  if (['hit', 'h', 'stand', 's', 'stay'].indexOf(msg) === -1) return false;
  if (gs.actionTimer) clearTimeout(gs.actionTimer);
  if (msg === 'hit' || msg === 'h') {
    seat.hand.push(bjDeal(gs));
    var total = bjHandTotal(seat.hand);
    sendGameResponse(gs.hostPlayer, seat.name + ': ' + bjFormatHand(seat.hand), false);
    if (total > 21) {
      setTimeout(function () {
        sendGameResponse(gs.hostPlayer, seat.name + ' busts!', false);
        seat.busted = true;
        bjGroupNextTurn();
      }, 800);
    } else if (total === 21) {
      setTimeout(function () {
        sendGameResponse(gs.hostPlayer, seat.name + ': 21! Standing.', false);
        seat.standing = true;
        bjGroupNextTurn();
      }, 800);
    } else {
      setTimeout(function () {
        sendGameResponse(gs.hostPlayer, seat.name + ': hit/stand', false);
        if (gs.actionTimer) clearTimeout(gs.actionTimer);
        gs.actionTimer = setTimeout(function () {
          bjGroupActionTimeout();
        }, BJ_GROUP_ACTION_TIMEOUT);
      }, 800);
    }
  } else {
    // Stand
    seat.standing = true;
    sendGameResponse(gs.hostPlayer, seat.name + ' stands.', false);
    setTimeout(function () {
      bjGroupNextTurn();
    }, 800);
  }
  return true;
}
function bjGroupActionTimeout() {
  var gs = bjGroupSession;
  if (!gs) return;
  var seat = gs.seats[gs.currentTurnIndex];
  if (!seat) return;
  sendGameResponse(gs.hostPlayer, seat.name + ' timed out (stand).', false);
  seat.standing = true;
  bjGroupNextTurn();
}
function bjGroupDealerPlay() {
  var gs = bjGroupSession;
  if (!gs) return;
  gs.phase = 'dealer';

  // Check if all players busted
  var allBusted = true;
  for (var i = 0; i < gs.seats.length; i++) {
    if (!gs.seats[i].eliminated && !gs.seats[i].busted) {
      allBusted = false;
      break;
    }
  }
  sendGameResponse(gs.hostPlayer, 'Dealer: ' + bjFormatHand(gs.dealerHand), false);
  if (allBusted) {
    setTimeout(function () {
      sendGameResponse(gs.hostPlayer, 'All players busted!', false);
      bjGroupResolveAll();
    }, 800);
    return;
  }
  function dealerDraw() {
    var total = bjHandTotal(gs.dealerHand);
    if (total < 17) {
      setTimeout(function () {
        gs.dealerHand.push(bjDeal(gs));
        sendGameResponse(gs.hostPlayer, 'Dealer draws: ' + bjFormatHand(gs.dealerHand), false);
        dealerDraw();
      }, 1200);
    } else {
      setTimeout(function () {
        bjGroupResolveAll();
      }, 800);
    }
  }
  setTimeout(function () {
    dealerDraw();
  }, 800);
}
function bjGroupResolveAll() {
  var gs = bjGroupSession;
  if (!gs) return;
  var dealerTotal = bjHandTotal(gs.dealerHand);
  var dealerBust = dealerTotal > 21;
  var dealerBJ = bjIsBlackjack(gs.dealerHand);
  var delay = 0;
  for (var i = 0; i < gs.seats.length; i++) {
    var seat = gs.seats[i];
    if (seat.eliminated) continue;
    (function (s, d) {
      setTimeout(function () {
        var playerTotal = bjHandTotal(s.hand);
        var playerBJ = bjIsBlackjack(s.hand);
        if (s.busted) {
          sendGameResponse(gs.hostPlayer, s.name + ': Bust. -' + s.currentBet, false);
          recordGame(s.name, false, 'blackjack');
        } else if (playerBJ && !dealerBJ) {
          var win = Math.floor(s.currentBet * 1.5);
          s.chips += s.currentBet + win;
          sendGameResponse(gs.hostPlayer, s.name + ': BJ! +' + win, false);
          recordGame(s.name, true, 'blackjack');
        } else if (dealerBust) {
          s.chips += s.currentBet * 2;
          sendGameResponse(gs.hostPlayer, s.name + ': Dealer bust! +' + s.currentBet, false);
          recordGame(s.name, true, 'blackjack');
        } else if (playerTotal > dealerTotal) {
          s.chips += s.currentBet * 2;
          sendGameResponse(gs.hostPlayer, s.name + ': ' + playerTotal + ' beats ' + dealerTotal + '! +' + s.currentBet, false);
          recordGame(s.name, true, 'blackjack');
        } else if (playerTotal < dealerTotal) {
          sendGameResponse(gs.hostPlayer, s.name + ': ' + playerTotal + ' vs ' + dealerTotal + '. -' + s.currentBet, false);
          recordGame(s.name, false, 'blackjack');
        } else if (dealerBJ && !playerBJ) {
          sendGameResponse(gs.hostPlayer, s.name + ': Dealer BJ. -' + s.currentBet, false);
          recordGame(s.name, false, 'blackjack');
        } else {
          s.chips += s.currentBet;
          sendGameResponse(gs.hostPlayer, s.name + ': Push. Bet returned.', false);
        }
      }, d);
    })(seat, delay);
    delay += 800;
  }
  setTimeout(function () {
    bjGroupCheckEliminations();
  }, delay + 500);
}
function bjGroupCheckEliminations() {
  var gs = bjGroupSession;
  if (!gs) return;
  var eliminated = [];
  var alive = [];
  for (var i = 0; i < gs.seats.length; i++) {
    if (gs.seats[i].eliminated) continue;
    if (gs.seats[i].chips <= 0) {
      gs.seats[i].eliminated = true;
      eliminated.push(gs.seats[i]);
      emitActivity(gs.seats[i].name, 'blackjack', 'eliminated');
    } else {
      alive.push(gs.seats[i]);
    }
  }
  if (eliminated.length > 0) {
    var names = eliminated.map(function (s) {
      return s.name;
    }).join(', ');
    sendGameResponse(gs.hostPlayer, names + ' eliminated!', false);
  }
  if (alive.length <= 1) {
    bjGroupEndGame();
  } else {
    gs.phase = 'between_hands';
    setTimeout(function () {
      bjGroupDealHand();
    }, BJ_GROUP_BETWEEN_HANDS);
  }
}
function bjGroupEndByLimit() {
  var gs = bjGroupSession;
  if (!gs) return;
  var alive = gs.seats.filter(function (s) {
    return !s.eliminated;
  });
  alive.sort(function (a, b) {
    return b.chips - a.chips;
  });
  sendGameResponse(gs.hostPlayer, 'Max hands reached! Results:', false);
  var delay = 800;
  for (var i = 0; i < alive.length; i++) {
    (function (seat, place, d) {
      setTimeout(function () {
        sendGameResponse(gs.hostPlayer, place + 1 + '. ' + seat.name + ' (' + seat.chips + ' chips)', false);
      }, d);
    })(alive[i], i, delay);
    delay += 800;
  }
  setTimeout(function () {
    if (alive.length > 0) {
      sendGameResponse(gs.hostPlayer, 'Winner: ' + alive[0].name + '! GG!', false);
      emitActivity(alive[0].name, 'blackjack', 'won group blackjack');
    }
    bjGroupCleanup();
  }, delay + 500);
}
function bjGroupEndGame() {
  var gs = bjGroupSession;
  if (!gs) return;
  var alive = gs.seats.filter(function (s) {
    return !s.eliminated;
  });
  if (alive.length === 1) {
    sendGameResponse(gs.hostPlayer, 'Winner: ' + alive[0].name + ' (' + alive[0].chips + ' chips)! GG!', false);
    emitActivity(alive[0].name, 'blackjack', 'won group blackjack');
  } else {
    sendGameResponse(gs.hostPlayer, 'Blackjack game over!', false);
  }
  bjGroupCleanup();
}
function leaveBj(sender, isWhisper) {
  var key = sender.toLowerCase();
  var session = activeGames.get(key);
  if (session && session.gameType === 'blackjack') {
    bjSaveChips(sender, session.playerChips);
    sendGameResponse(sender, 'Left blackjack. Chips:' + session.playerChips, isWhisper);
    cancelSession(sender);
    emitActivity(sender, 'blackjack', 'quit');
    return;
  }
  if (bjGroupSession) {
    var gs = bjGroupSession;
    for (var i = 0; i < gs.seats.length; i++) {
      if (gs.seats[i].name.toLowerCase() === key && !gs.seats[i].eliminated) {
        gs.seats[i].eliminated = true;
        sendGameResponse(sender, sender + ' left blackjack.', false);
        emitActivity(sender, 'blackjack', 'left');
        if (gs.phase === 'lobby') {
          gs.seats.splice(i, 1);
          sendGameResponse(gs.hostPlayer, '(' + gs.seats.length + '/' + gs.maxSeats + ' seats)', false);
          if (gs.seats.length === 0) bjGroupCleanup();
        } else {
          var alive = gs.seats.filter(function (s) {
            return !s.eliminated;
          });
          if (alive.length <= 1) {
            bjGroupEndGame();
          } else if (gs.phase === 'playing' && gs.currentTurnIndex === i) {
            if (gs.actionTimer) clearTimeout(gs.actionTimer);
            gs.currentTurnIndex = i - 1;
            bjGroupNextTurn();
          }
        }
        return;
      }
    }
  }
  sendGameResponse(sender, 'You are not in a blackjack game.', isWhisper);
}
function stopBjGame(sender) {
  if (!bjGroupSession) {
    sendGameResponse(sender, 'No blackjack game active.', false);
    return;
  }
  if (bjGroupSession.hostPlayer.toLowerCase() !== sender.toLowerCase()) {
    sendGameResponse(sender, 'Only the host can stop.', false);
    return;
  }
  sendGameResponse(sender, 'Blackjack cancelled by host.', false);
  emitActivity(sender, 'blackjack', 'cancelled');
  bjGroupCleanup();
}
function showBjStatus(sender, isWhisper) {
  var session = activeGames.get(sender.toLowerCase());
  if (session && session.gameType === 'blackjack') {
    sendGameResponse(sender, 'Hand ' + session.handNumber + ' | Chips:' + session.playerChips + ' Bet:' + session.currentBet, isWhisper);
    return;
  }
  if (bjGroupSession) {
    var gs = bjGroupSession;
    if (gs.phase === 'lobby') {
      sendGameResponse(sender, 'BJ lobby: ' + gs.seats.length + '/' + gs.maxSeats + ' seats', isWhisper);
    } else {
      var alive = gs.seats.filter(function (s) {
        return !s.eliminated;
      });
      sendGameResponse(sender, 'Hand ' + gs.handNumber + '/' + gs.maxHands + ' | ' + alive.length + ' players', isWhisper);
    }
    return;
  }
  sendGameResponse(sender, 'No blackjack game active.', isWhisper);
}
function bjGroupCleanup() {
  if (bjGroupSession) {
    if (bjGroupSession.actionTimer) clearTimeout(bjGroupSession.actionTimer);
    if (bjGroupSession.lobbyTimer) clearTimeout(bjGroupSession.lobbyTimer);
    bjGroupSession = null;
  }
  if (ioRef) ioRef.emit('chatgames:bjUpdate', null);
}
function getBjStatus() {
  if (!bjGroupSession) return null;
  var gs = bjGroupSession;
  return {
    active: true,
    phase: gs.phase,
    handNumber: gs.handNumber,
    maxHands: gs.maxHands,
    seats: gs.seats.map(function (s) {
      return {
        name: s.name,
        chips: s.chips,
        busted: s.busted,
        eliminated: s.eliminated
      };
    })
  };
}

// ── Help & Score ──

function showHelp(sender, isWhisper) {
  if (isWhisper) {
    var prefix = config.commandPrefix || '!';
    var lines = ['Chat Games: ' + prefix + 'trivia, ' + prefix + 'riddle, ' + prefix + '8ball <question>', prefix + 'scramble, ' + prefix + 'guess, ' + prefix + 'fortune, ' + prefix + 'rps', prefix + 'hangman, ' + prefix + 'bj (blackjack), ' + prefix + 'bjhost (group)', prefix + 'answer <text>, ' + prefix + 'hint, ' + prefix + 'giveup', prefix + 'score, ' + prefix + 'leaderboard'];
    lines.forEach(function (line, i) {
      setTimeout(function () {
        sendWhisper(sender, line);
      }, i * 500);
    });
  } else {
    var p = config.commandPrefix || '!';
    sendGameResponse(sender, p + 'trivia ' + p + 'riddle ' + p + '8ball ' + p + 'scramble', false);
    setTimeout(function () {
      sendGameResponse(sender, p + 'guess ' + p + 'fortune ' + p + 'rps ' + p + 'hangman', false);
    }, 800);
    setTimeout(function () {
      sendGameResponse(sender, p + 'score ' + p + 'leaderboard', false);
    }, 1600);
  }
}
function showScore(sender, isWhisper) {
  var key = sender.toLowerCase();
  var stats = scoreboard.get(key);
  if (!stats) {
    sendGameResponse(sender, sender + ': No games played yet.', isWhisper);
    return;
  }
  var losses = stats.played - stats.wins;
  var rate = stats.played > 0 ? Math.round(stats.wins / stats.played * 100) : 0;
  var msg = sender + ': ' + stats.wins + 'W/' + losses + 'L (' + rate + '%)';
  if (stats.bestStreak > 0) {
    msg += ' | Best: ' + stats.bestStreak;
  }
  sendGameResponse(sender, msg, isWhisper);

  // Per-game breakdown via whisper
  if (isWhisper && stats.byGame) {
    var gameNames = {
      trivia: 'Trivia',
      riddle: 'Riddle',
      scramble: 'Scramble',
      numberguess: 'Guess',
      rps: 'RPS',
      blackjack: 'BJ',
      hangman: 'Hangman'
    };
    var parts = [];
    for (var gt in gameNames) {
      var g = stats.byGame[gt];
      if (g && g.played > 0) {
        parts.push(gameNames[gt] + ' ' + g.wins + '/' + g.played);
      }
    }
    if (parts.length > 0) {
      var breakdown = parts.join(' | ');
      setTimeout(function () {
        sendWhisper(sender, breakdown);
      }, 500);
    }
  }
}
function showLeaderboard(sender, isWhisper, args) {
  var gameFilter = (args || '').trim().toLowerCase();
  // Validate and alias game type
  if (gameFilter) {
    if (gameFilter === 'guess' || gameFilter === 'number') gameFilter = 'numberguess';
    if (GAME_TYPES.indexOf(gameFilter) === -1) gameFilter = '';
  }
  var board;
  var label = '';
  if (gameFilter) {
    board = getLeaderboardByGame(gameFilter);
    var labels = {
      trivia: 'Trivia',
      riddle: 'Riddle',
      scramble: 'Scramble',
      numberguess: 'Guess',
      rps: 'RPS'
    };
    label = labels[gameFilter] || gameFilter;
  } else {
    board = [];
    scoreboard.forEach(function (val) {
      board.push(val);
    });
    board.sort(function (a, b) {
      return b.wins - a.wins;
    });
  }
  var top5 = board.slice(0, 5);
  if (top5.length === 0) {
    sendGameResponse(sender, 'No ' + (label ? label + ' ' : '') + 'games played yet!', isWhisper);
    return;
  }
  if (isWhisper) {
    sendWhisper(sender, (label ? label + ' ' : '') + 'Top Players:');
    top5.forEach(function (p, i) {
      var rate = p.played > 0 ? Math.round(p.wins / p.played * 100) : 0;
      setTimeout(function () {
        sendWhisper(sender, i + 1 + '. ' + p.name + ': ' + p.wins + 'W/' + ((p.played || 0) - (p.wins || 0)) + 'L (' + rate + '%)');
      }, (i + 1) * 400);
    });
  } else {
    var line = (label ? label + ' ' : '') + 'Top: ';
    top5.forEach(function (p, i) {
      if (i > 0) line += ', ';
      line += i + 1 + '.' + p.name + ' ' + (p.wins || 0) + 'W';
    });
    if (line.length > 64) line = line.substring(0, 61) + '...';
    sendGameResponse(sender, line, false);
  }
}

// ── Answer Handling ──────────────────────────────────────────────

function handleAnswerCommand(sender, answer, isWhisper) {
  var key = sender.toLowerCase();
  var session = activeGames.get(key);
  if (!session) {
    var p = config.commandPrefix || '!';
    sendGameResponse(sender, 'No active game. Try ' + p + 'trivia or ' + p + 'riddle', isWhisper);
    return;
  }
  if (session.gameType === 'trivia' || session.gameType === 'riddle') {
    checkAnswerFuzzy(session, answer);
  } else if (session.gameType === 'scramble') {
    checkAnswerExact(session, answer);
  } else if (session.gameType === 'numberguess') {
    checkNumberGuess(session, answer);
  } else if (session.gameType === 'hangman') {
    handleHangmanGuess(session, answer);
  }
}
function handleHint(sender, isWhisper) {
  var key = sender.toLowerCase();
  var session = activeGames.get(key);
  if (!session) {
    sendGameResponse(sender, 'No active game.', isWhisper);
    return;
  }
  if (session.gameType === 'hangman') {
    var revealed = buildRevealedWord(session.answer, session.guessedLetters);
    var guessed = session.guessedLetters.length > 0 ? session.guessedLetters.join(',') : 'none';
    sendGameResponse(sender, 'Hint: ' + (session.hint || 'No hint') + ' | ' + revealed, session.isWhisper);
    if (session.isWhisper) {
      setTimeout(function () {
        sendWhisper(sender, 'Guessed: ' + guessed + ' | Lives: ' + (session.maxWrong - session.wrongCount));
      }, 500);
    }
    return;
  }
  sendGameResponse(sender, 'Hint: ' + (session.hint || 'No hint available'), session.isWhisper);
}
function handleGiveUp(sender, isWhisper) {
  var key = sender.toLowerCase();
  var session = activeGames.get(key);
  if (!session) {
    sendGameResponse(sender, 'No active game.', isWhisper);
    return;
  }
  var answer = session.answer || '???';
  sendGameResponse(sender, 'The answer was: ' + answer, session.isWhisper);
  recordGame(sender, false, session.gameType);
  cancelSession(sender);
  emitActivity(sender, session.gameType, 'gave up');
}
function checkAnswerFuzzy(session, playerAnswer) {
  if (!playerAnswer || !playerAnswer.trim()) return;
  if (session.answerProcessing) return;
  session.answerProcessing = true;
  session.attempts++;

  // Quick exact match first
  if (playerAnswer.trim().toLowerCase() === session.answer.toLowerCase()) {
    onCorrectAnswer(session);
    return;
  }

  // Use OpenAI for fuzzy matching
  callOpenAIJson('You are judging a trivia/riddle answer. The correct answer is "' + session.answer + '". The player answered "' + playerAnswer.trim() + '". Is this close enough to be correct (allowing for typos, synonyms, abbreviations)? Return ONLY valid JSON: {"correct":true or false}', 'Judge this answer.').then(function (result) {
    if (result.correct) {
      onCorrectAnswer(session);
    } else {
      onWrongAnswer(session);
    }
  })["catch"](function () {
    // Fallback: simple case-insensitive partial match
    var a = session.answer.toLowerCase().trim();
    var p = playerAnswer.toLowerCase().trim();
    if (p === a || a.indexOf(p) === 0 || p.indexOf(a) === 0) {
      onCorrectAnswer(session);
    } else {
      onWrongAnswer(session);
    }
  });
}
function checkAnswerExact(session, playerAnswer) {
  if (!playerAnswer || !playerAnswer.trim()) return;
  session.attempts++;
  if (playerAnswer.trim().toLowerCase() === session.answer.toLowerCase()) {
    onCorrectAnswer(session);
  } else {
    onWrongAnswer(session);
  }
}
function checkNumberGuess(session, playerAnswer) {
  var num = parseInt(playerAnswer.trim(), 10);
  if (isNaN(num)) return;
  session.attempts++;
  if (num === session.targetNumber) {
    sendGameResponse(session.playerName, 'Correct! The number was ' + session.targetNumber + ' (' + session.attempts + ' guesses)', session.isWhisper);
    recordGame(session.playerName, true, 'numberguess');
    cancelSession(session.playerName);
    emitActivity(session.playerName, 'numberguess', 'won in ' + session.attempts);
  } else if (session.attempts >= session.maxAttempts) {
    sendGameResponse(session.playerName, 'Out of guesses! It was ' + session.targetNumber, session.isWhisper);
    recordGame(session.playerName, false, 'numberguess');
    cancelSession(session.playerName);
    emitActivity(session.playerName, 'numberguess', 'lost');
  } else if (num < session.targetNumber) {
    sendGameResponse(session.playerName, 'Too low! (' + session.attempts + '/' + session.maxAttempts + ')', session.isWhisper);
  } else {
    sendGameResponse(session.playerName, 'Too high! (' + session.attempts + '/' + session.maxAttempts + ')', session.isWhisper);
  }
}
function handleHangmanGuess(session, message) {
  var input = message.trim().toLowerCase();
  if (!input) return;

  // Full word guess
  if (input.length > 1) {
    if (input === session.answer.toLowerCase()) {
      onCorrectAnswer(session);
    } else {
      session.wrongCount++;
      if (session.wrongCount >= session.maxWrong) {
        sendGameResponse(session.playerName, 'Hanged! The word was: ' + session.answer, session.isWhisper);
        recordGame(session.playerName, false, 'hangman');
        cancelSession(session.playerName);
        emitActivity(session.playerName, 'hangman', 'lost');
      } else {
        var lives = session.maxWrong - session.wrongCount;
        var revealed = buildRevealedWord(session.answer, session.guessedLetters);
        sendGameResponse(session.playerName, 'Wrong word! ' + revealed + ' (' + lives + ' lives)', session.isWhisper);
      }
    }
    return;
  }

  // Single letter guess
  if (!/^[a-z]$/.test(input)) {
    sendGameResponse(session.playerName, 'Letters only!', session.isWhisper);
    return;
  }
  if (session.guessedLetters.indexOf(input) !== -1) {
    sendGameResponse(session.playerName, 'Already guessed [' + input + ']!', session.isWhisper);
    return;
  }
  session.guessedLetters.push(input);
  if (session.answer.toLowerCase().indexOf(input) !== -1) {
    // Hit
    var revealed = buildRevealedWord(session.answer, session.guessedLetters);
    if (revealed.indexOf('_') === -1) {
      // Word fully revealed
      onCorrectAnswer(session);
    } else {
      var lives = session.maxWrong - session.wrongCount;
      sendGameResponse(session.playerName, 'Hit! ' + revealed + ' (' + lives + ' lives)', session.isWhisper);
    }
  } else {
    // Miss
    session.wrongCount++;
    if (session.wrongCount >= session.maxWrong) {
      sendGameResponse(session.playerName, 'Hanged! The word was: ' + session.answer, session.isWhisper);
      recordGame(session.playerName, false, 'hangman');
      cancelSession(session.playerName);
      emitActivity(session.playerName, 'hangman', 'lost');
    } else {
      var lives = session.maxWrong - session.wrongCount;
      var revealed = buildRevealedWord(session.answer, session.guessedLetters);
      sendGameResponse(session.playerName, 'Miss! ' + revealed + ' (' + lives + ' lives)', session.isWhisper);
    }
  }
}
function onCorrectAnswer(session) {
  session.answerProcessing = false;
  sendGameResponse(session.playerName, 'Correct, ' + session.playerName + '! Answer: ' + session.answer, session.isWhisper);
  recordGame(session.playerName, true, session.gameType);
  cancelSession(session.playerName);
  emitActivity(session.playerName, session.gameType, 'answered correctly');
}
function onWrongAnswer(session) {
  session.answerProcessing = false;
  if (session.attempts >= (session.maxAttempts || 3)) {
    sendGameResponse(session.playerName, 'No more tries! Answer: ' + session.answer, session.isWhisper);
    recordGame(session.playerName, false, session.gameType);
    cancelSession(session.playerName);
    emitActivity(session.playerName, session.gameType, 'ran out of attempts');
  } else {
    var remaining = (session.maxAttempts || 3) - session.attempts;
    var p = config.commandPrefix || '!';
    sendGameResponse(session.playerName, 'Wrong! ' + remaining + ' tries left. (' + p + 'hint)', session.isWhisper);
  }
}

// ── Session Management ───────────────────────────────────────────

function createSession(playerName, gameType, isWhisper, gameData) {
  cancelSession(playerName);
  var timeouts = {
    trivia: 60000,
    riddle: 90000,
    scramble: 60000,
    numberguess: 120000,
    rps: 90000,
    hangman: 120000
  };
  var timeout = timeouts[gameType] || 60000;
  var maxAttempts = gameData.maxAttempts || (gameType === 'numberguess' ? 10 : 3);
  var session = {
    playerName: playerName,
    gameType: gameType,
    isWhisper: isWhisper,
    startedAt: Date.now(),
    attempts: 0,
    maxAttempts: maxAttempts,
    question: gameData.question || '',
    answer: gameData.answer || '',
    hint: gameData.hint || '',
    targetNumber: gameData.targetNumber || 0,
    guessedLetters: gameData.guessedLetters || [],
    wrongCount: gameData.wrongCount || 0,
    maxWrong: gameData.maxWrong || 6,
    answerProcessing: false,
    timeoutTimer: setTimeout(function () {
      onSessionTimeout(playerName);
    }, timeout)
  };
  activeGames.set(playerName.toLowerCase(), session);
  if (ioRef) {
    ioRef.emit('chatgames:sessionStart', {
      player: playerName,
      gameType: gameType,
      timestamp: Date.now()
    });
    ioRef.emit('chatgames:active', getActiveGames());
  }
  return session;
}
function cancelSession(playerName) {
  var key = playerName.toLowerCase();
  var session = activeGames.get(key);
  if (session) {
    clearTimeout(session.timeoutTimer);
    activeGames["delete"](key);
    if (ioRef) {
      ioRef.emit('chatgames:sessionEnd', {
        player: playerName,
        gameType: session.gameType,
        timestamp: Date.now()
      });
      ioRef.emit('chatgames:active', getActiveGames());
    }
  }
}
function onSessionTimeout(playerName) {
  var key = playerName.toLowerCase();
  var session = activeGames.get(key);
  if (!session) return;
  sendGameResponse(playerName, 'Time up! Answer: ' + (session.answer || '???'), session.isWhisper);
  recordGame(playerName, false, session.gameType);
  cancelSession(playerName);
  emitActivity(playerName, session.gameType, 'timed out');
}

// ── Scoring ──────────────────────────────────────────────────────

function recordGame(playerName, won, gameType) {
  var key = playerName.toLowerCase();
  var stats = scoreboard.get(key) || {
    name: playerName,
    wins: 0,
    played: 0,
    currentStreak: 0,
    bestStreak: 0
  };
  stats.played++;
  if (won) {
    stats.wins++;
    stats.currentStreak = (stats.currentStreak || 0) + 1;
    if (stats.currentStreak > (stats.bestStreak || 0)) {
      stats.bestStreak = stats.currentStreak;
    }
  } else {
    stats.currentStreak = 0;
  }
  stats.name = playerName; // keep latest casing

  // Per-game tracking
  if (gameType) {
    if (!stats.byGame) stats.byGame = {};
    if (!stats.byGame[gameType]) stats.byGame[gameType] = {
      wins: 0,
      played: 0
    };
    stats.byGame[gameType].played++;
    if (won) stats.byGame[gameType].wins++;
  }
  scoreboard.set(key, stats);
  totalGamesPlayed++;
  saveLeaderboard(playerName);
  if (ioRef) ioRef.emit('chatgames:leaderboard', getLeaderboard());
}

// ── Cooldown ─────────────────────────────────────────────────────

function isOnCooldown(playerName) {
  var key = playerName.toLowerCase();
  var last = playerCooldowns.get(key);
  if (!last) return false;
  return Date.now() - last < (config.cooldownSeconds || 10) * 1000;
}
function setCooldown(playerName) {
  playerCooldowns.set(playerName.toLowerCase(), Date.now());
}

// ── OpenAI Helpers ───────────────────────────────────────────────

function callOpenAI(systemPrompt, userPrompt) {
  if (!openaiClient) {
    return Promise.reject(new Error('OpenAI not initialized'));
  }

  // Rate limiting
  var now = Date.now();
  var delay = Math.max(0, MIN_OPENAI_INTERVAL - (now - lastOpenAICall));
  return new Promise(function (resolve) {
    setTimeout(resolve, delay);
  }).then(function () {
    lastOpenAICall = Date.now();
    return openaiClient.chat.completions.create({
      model: config.openaiModel || 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: systemPrompt
      }, {
        role: 'user',
        content: userPrompt
      }],
      max_tokens: 150,
      temperature: 0.8
    });
  }).then(function (response) {
    return response.choices[0].message.content.trim();
  });
}
function callOpenAIJson(systemPrompt, userPrompt) {
  return callOpenAI(systemPrompt, userPrompt).then(function (text) {
    // Strip markdown code fences if present
    text = text.replace(/^```json\s*\n?/, '').replace(/\n?\s*```$/, '');
    return JSON.parse(text);
  });
}

// ── Message Sending ──────────────────────────────────────────────

function sendGameResponse(playerName, text, isWhisper) {
  if (!text) return;
  if (isWhisper) {
    var whisperChunks = splitMessage(text, WHISPER_MAX);
    whisperChunks.forEach(function (chunk, i) {
      setTimeout(function () {
        if (sendWhisper) sendWhisper(playerName, chunk);
      }, i * 500);
    });
  } else {
    // Stealth mode: whisper to player instead of public say
    // Only use public say for host-mode broadcasts (playerName is null)
    if (playerName) {
      var wChunks = splitMessage(text, WHISPER_MAX);
      wChunks.forEach(function (chunk, i) {
        setTimeout(function () {
          if (sendWhisper) sendWhisper(playerName, chunk);
        }, i * 500);
      });
    } else {
      // Host mode broadcast - keep as public say (Lancelot-only)
      var sayChunks = splitMessage(text, PUBLIC_SAY_MAX);
      sayChunks.forEach(function (chunk, i) {
        setTimeout(function () {
          if (sendSay) sendSay(chunk);
        }, i * 800);
      });
    }
  }
}
function splitMessage(text, maxLen) {
  if (text.length <= maxLen) return [text];
  var chunks = [];
  while (text.length > 0) {
    if (text.length <= maxLen) {
      chunks.push(text);
      break;
    }
    var splitAt = text.lastIndexOf(' ', maxLen);
    if (splitAt <= 0) splitAt = maxLen;
    chunks.push(text.substring(0, splitAt));
    text = text.substring(splitAt).trim();
  }
  return chunks;
}

// ── Panel Activity ───────────────────────────────────────────────

function emitActivity(player, gameType, action) {
  if (ioRef) {
    ioRef.emit('chatgames:activity', {
      timestamp: Date.now(),
      player: player,
      gameType: gameType,
      action: action
    });
  }
}

// ── Shared Question Generation ───────────────────────────────────
// Used by both normal chat games and host mode to avoid duplicate logic.
// callback(err, {question, answer, hint, targetNumber?})

function generateTrivia(charLimit, callback) {
  // Use custom trivia first if available, otherwise use fallback list
  var q = null;
  if (customTrivia.length > 0) {
    q = deckCustomTrivia.draw();
  }
  if (!q) {
    q = deckFallbackTrivia.draw() || FALLBACK_TRIVIA[0];
  }
  callback(null, {
    question: q.question,
    answer: q.answer,
    hint: q.hint || 'No hint available'
  });
}
function generateRiddle(charLimit, callback) {
  // Use custom riddles first if available, otherwise use fallback list
  var r = null;
  if (customRiddles.length > 0) {
    r = deckCustomRiddles.draw();
  }
  if (r) {
    callback(null, {
      question: r.riddle,
      answer: r.answer,
      hint: r.hint || 'No hint available'
    });
  } else {
    r = deckFallbackRiddles.draw() || FALLBACK_RIDDLES[0];
    callback(null, {
      question: r.riddle,
      answer: r.answer,
      hint: r.hint
    });
  }
}
function buildRevealedWord(word, guessedLetters) {
  var result = [];
  for (var i = 0; i < word.length; i++) {
    var ch = word[i].toLowerCase();
    if (/[a-z]/.test(ch)) {
      result.push(guessedLetters.indexOf(ch) !== -1 ? word[i] : '_');
    } else {
      result.push(word[i]); // preserve spaces, hyphens, etc.
    }
  }
  return result.join(' ');
}
function generateHangman(callback) {
  var w = null;
  if (customWords.length > 0) {
    w = deckCustomWords.draw();
  }
  if (!w) {
    w = deckFallbackWords.draw() || FALLBACK_WORDS[0];
  }
  var word = w.word.toLowerCase();
  var display = buildRevealedWord(word, []);
  callback(null, {
    question: display,
    answer: word,
    hint: w.hint || 'Think carefully',
    guessedLetters: [],
    wrongCount: 0,
    maxWrong: 6,
    maxAttempts: 50
  });
}
function generateScramble(callback) {
  // Use custom words first if available, otherwise use fallback list
  var w = null;
  if (customWords.length > 0) {
    w = deckCustomWords.draw();
  }
  if (!w) {
    w = deckFallbackWords.draw() || FALLBACK_WORDS[0];
  }
  var scrambled = scrambleWord(w.word.toLowerCase());
  callback(null, {
    question: scrambled.toUpperCase(),
    answer: w.word.toLowerCase(),
    hint: w.hint || 'Think carefully'
  });
}
function generateNumberGuess() {
  var target = Math.floor(Math.random() * 100) + 1;
  return {
    targetNumber: target,
    answer: String(target),
    hint: 'Between 1 and 100'
  };
}

// ── Host Mode (Game Show) ────────────────────────────────────────

var HOST_INTROS = {
  trivia: ['Gather round, Aislings! Trivia hour begins!', 'The oracle calls! Time for trivia!', 'Step up, Aislings! Trivia challenge!', 'Attention Temuair! Trivia time!'],
  riddle: ['The sage speaks! Riddle hour begins!', 'Gather round for riddles, Aislings!', 'Who dares solve the sage\'s riddles?', 'Riddle challenge begins, Aislings!'],
  scramble: ['Unscramble if you can, Aislings!', 'Word scramble challenge begins!', 'Scramble hour! Test your wit!', 'Letters await! Scramble time, Aislings!'],
  numberguess: ['Guess the number, Aislings!', 'Number challenge begins!', 'Think fast! Number guessing time!', 'Can you guess it? Game on, Aislings!'],
  hangman: ['Hangman begins! Guess the letters, Aislings!', 'The gallows await! Hangman time!', 'Save the Aisling! Hangman challenge!', 'Letter by letter! Hangman starts now!']
};
function handleHostStart(sender, args) {
  if (hostSession) {
    var p = config.commandPrefix || '!';
    if (sendWhisper) sendWhisper(sender, 'A hosted game is already running. Use ' + p + 'hoststop first.');
    return;
  }

  // Parse: !host <gameType> [rounds]
  var parts = args.trim().split(/\s+/);
  var gameType = (parts[0] || 'trivia').toLowerCase();
  var rounds = parseInt(parts[1]) || 5;
  if (['trivia', 'riddle', 'scramble', 'numberguess', 'hangman'].indexOf(gameType) === -1) {
    if (sendWhisper) sendWhisper(sender, 'Valid types: trivia, riddle, scramble, numberguess, hangman');
    return;
  }
  if (rounds < 1) rounds = 1;
  if (rounds > 20) rounds = 20;
  hostSession = {
    gameType: gameType,
    totalRounds: rounds,
    currentRound: 0,
    hostPlayer: sender,
    leaderboard: new Map(),
    currentQuestion: null,
    questionActive: false,
    timeoutTimer: null,
    roundTimer: null,
    delayBetweenRounds: HOST_DELAY_BETWEEN
  };
  var intros = HOST_INTROS[gameType] || HOST_INTROS.trivia;
  var intro = intros[Math.floor(Math.random() * intros.length)];
  if (sendWhisper) sendWhisper(sender, 'Starting ' + rounds + ' rounds of ' + gameType + '!');
  sendGameResponse(null, intro, false);
  setTimeout(function () {
    sendGameResponse(null, rounds + ' rounds of ' + gameType + '! First to answer wins!', false);
  }, 1200);
  emitActivity(sender, 'host-' + gameType, 'started ' + rounds + ' rounds');
  if (ioRef) ioRef.emit('chatgames:hostUpdate', getHostStatus());

  // Start first round after intro
  setTimeout(function () {
    hostNextRound();
  }, 3000);
}
function handleHostStop(sender) {
  if (!hostSession) {
    if (sendWhisper) sendWhisper(sender, 'No hosted game is running.');
    return;
  }
  sendGameResponse(null, 'Game over! The host has ended the game.', false);
  hostShowFinalLeaderboard();
  emitActivity(sender, 'host', 'stopped the game');
  hostCleanup();
}
function handleHostSkip(sender) {
  if (!hostSession) {
    if (sendWhisper) sendWhisper(sender, 'No hosted game is running.');
    return;
  }
  if (hostSession.questionActive && hostSession.currentQuestion) {
    sendGameResponse(null, 'Skipped! Answer: ' + hostSession.currentQuestion.answer, false);
    hostSession.questionActive = false;
    clearTimeout(hostSession.timeoutTimer);
    emitActivity(sender, 'host', 'skipped round ' + hostSession.currentRound);
    setTimeout(function () {
      hostNextRound();
    }, 2000);
  } else {
    if (sendWhisper) sendWhisper(sender, 'No active question to skip.');
  }
}
function hostNextRound() {
  if (!hostSession) return;
  hostSession.currentRound++;
  if (hostSession.currentRound > hostSession.totalRounds) {
    // Game finished — save refs before cleanup nulls hostSession
    var finishedHost = hostSession.hostPlayer;
    var finishedType = hostSession.gameType;
    sendGameResponse(null, 'Final round complete! Here are the results:', false);
    setTimeout(function () {
      hostShowFinalLeaderboard();
      emitActivity(finishedHost, 'host-' + finishedType, 'finished all rounds');
      hostCleanup();
    }, 1500);
    return;
  }
  var roundLabel = 'Round ' + hostSession.currentRound + '/' + hostSession.totalRounds;
  if (hostSession.gameType === 'trivia') {
    hostGenerateTrivia(roundLabel);
  } else if (hostSession.gameType === 'riddle') {
    hostGenerateRiddle(roundLabel);
  } else if (hostSession.gameType === 'scramble') {
    hostGenerateScramble(roundLabel);
  } else if (hostSession.gameType === 'numberguess') {
    hostGenerateNumberGuess(roundLabel);
  } else if (hostSession.gameType === 'hangman') {
    hostGenerateHangman(roundLabel);
  }
}
function hostGenerateTrivia(roundLabel) {
  generateTrivia(50, function (err, data) {
    hostSetQuestion(roundLabel, data.question, data.answer, data.hint);
  });
}
function hostGenerateRiddle(roundLabel) {
  generateRiddle(50, function (err, data) {
    hostSetQuestion(roundLabel, data.question, data.answer, data.hint);
  });
}
function hostGenerateScramble(roundLabel) {
  generateScramble(function (err, data) {
    hostSetQuestion(roundLabel, data.question, data.answer, data.hint);
  });
}
function hostGenerateNumberGuess(roundLabel) {
  hostAnswerQueue = [];
  hostAnswerProcessing = false;
  var data = generateNumberGuess();
  hostSession.currentQuestion = {
    question: '1-100',
    answer: data.answer,
    hint: data.hint,
    targetNumber: data.targetNumber,
    guessHigh: 100,
    guessLow: 1
  };
  hostSession.questionActive = true;
  sendGameResponse(null, roundLabel + ': I picked a number 1-100!', false);
  setTimeout(function () {
    sendGameResponse(null, 'Type your guess! Exact number wins!', false);
  }, 800);
  hostSession.timeoutTimer = setTimeout(function () {
    hostRoundTimeout();
  }, HOST_ROUND_TIMEOUT);
  if (ioRef) ioRef.emit('chatgames:hostUpdate', getHostStatus());
  emitActivity('Host', 'host-numberguess', roundLabel);
}
function hostGenerateHangman(roundLabel) {
  generateHangman(function (err, data) {
    hostAnswerQueue = [];
    hostAnswerProcessing = false;
    hostSession.currentQuestion = {
      question: data.question,
      answer: data.answer,
      hint: data.hint,
      guessedLetters: [],
      wrongCount: 0,
      maxWrong: 6,
      revealedWord: data.question
    };
    hostSession.questionActive = true;
    sendGameResponse(null, roundLabel + ' Hangman: ' + data.question, false);
    setTimeout(function () {
      sendGameResponse(null, 'Guess a letter! (' + (data.hint || 'No hint') + ')', false);
    }, 800);
    hostSession.timeoutTimer = setTimeout(function () {
      hostRoundTimeout();
    }, HOST_ROUND_TIMEOUT * 2);
    if (ioRef) ioRef.emit('chatgames:hostUpdate', getHostStatus());
    emitActivity('Host', 'host-hangman', roundLabel);
  });
}
function hostSetQuestion(roundLabel, question, answer, hint) {
  if (!hostSession) return;
  hostAnswerQueue = [];
  hostAnswerProcessing = false;
  hostSession.currentQuestion = {
    question: question,
    answer: answer,
    hint: hint || 'No hint'
  };
  hostSession.questionActive = true;
  var prefix = hostSession.gameType === 'scramble' ? 'Unscramble' : hostSession.gameType === 'riddle' ? 'Riddle' : 'Q';
  sendGameResponse(null, roundLabel + ' ' + prefix + ': ' + question, false);
  hostSession.timeoutTimer = setTimeout(function () {
    hostRoundTimeout();
  }, HOST_ROUND_TIMEOUT);
  if (ioRef) ioRef.emit('chatgames:hostUpdate', getHostStatus());
  emitActivity('Host', 'host-' + hostSession.gameType, roundLabel);
}
var hostAnswerQueue = [];
var hostAnswerProcessing = false;
function handleHostAnswer(sender, message) {
  if (!hostSession || !hostSession.questionActive || !hostSession.currentQuestion) return false;

  // For numberguess, validate input before queuing
  if (hostSession.gameType === 'numberguess') {
    var num = parseInt(message.trim(), 10);
    if (isNaN(num) || num < 1 || num > 100) return false;
  }

  // For hangman, only accept alphabetic input
  if (hostSession.gameType === 'hangman') {
    if (!/^[a-z]+$/i.test(message.trim())) return false;
  }

  // Queue the answer to process in order
  hostAnswerQueue.push({
    sender: sender,
    message: message
  });
  if (!hostAnswerProcessing) {
    processNextAnswer();
  }
  return true;
}
function processNextAnswer() {
  if (hostAnswerQueue.length === 0) {
    hostAnswerProcessing = false;
    return;
  }
  if (!hostSession || !hostSession.questionActive || !hostSession.currentQuestion) {
    hostAnswerQueue = [];
    hostAnswerProcessing = false;
    return;
  }
  hostAnswerProcessing = true;
  var entry = hostAnswerQueue.shift();
  var gameType = hostSession.gameType;
  if (gameType === 'numberguess') {
    processNumberGuessEntry(entry);
  } else if (gameType === 'scramble') {
    processScrambleEntry(entry);
  } else if (gameType === 'hangman') {
    processHangmanEntry(entry);
  } else {
    // trivia or riddle - needs fuzzy matching
    processTriviaRiddleEntry(entry);
  }
}
function processNumberGuessEntry(entry) {
  var num = parseInt(entry.message.trim(), 10);
  var target = hostSession.currentQuestion.targetNumber;
  if (num === target) {
    hostAnswerQueue = [];
    hostAnswerProcessing = false;
    hostRoundWon(entry.sender);
    return;
  }
  if (num < target) {
    sendGameResponse(null, entry.sender + ' guessed ' + num + ' - too low!', false);
  } else {
    sendGameResponse(null, entry.sender + ' guessed ' + num + ' - too high!', false);
  }
  setTimeout(function () {
    processNextAnswer();
  }, 1200);
}
function processScrambleEntry(entry) {
  var playerText = entry.message.trim().toLowerCase();
  var correctAnswer = hostSession.currentQuestion.answer.toLowerCase();
  if (playerText === correctAnswer) {
    hostAnswerQueue = [];
    hostAnswerProcessing = false;
    hostRoundWon(entry.sender);
    return;
  }

  // Wrong answer, move to next in queue
  setTimeout(function () {
    processNextAnswer();
  }, 400);
}
function processHangmanEntry(entry) {
  if (!hostSession || !hostSession.questionActive || !hostSession.currentQuestion) {
    hostAnswerQueue = [];
    hostAnswerProcessing = false;
    return;
  }
  var q = hostSession.currentQuestion;
  var input = entry.message.trim().toLowerCase();

  // Full word guess
  if (input.length > 1) {
    if (input === q.answer.toLowerCase()) {
      hostAnswerQueue = [];
      hostAnswerProcessing = false;
      hostRoundWon(entry.sender);
      return;
    }
    // Wrong full word costs a life
    q.wrongCount++;
    if (q.wrongCount >= q.maxWrong) {
      hostSession.questionActive = false;
      clearTimeout(hostSession.timeoutTimer);
      sendGameResponse(null, 'Hanged! The word was: ' + q.answer, false);
      hostAnswerQueue = [];
      hostAnswerProcessing = false;
      hostSession.roundTimer = setTimeout(function () {
        hostNextRound();
      }, HOST_DELAY_BETWEEN);
      return;
    }
    sendGameResponse(null, entry.sender + ' wrong word! (' + (q.maxWrong - q.wrongCount) + ' lives)', false);
    setTimeout(function () {
      processNextAnswer();
    }, 800);
    return;
  }

  // Single letter guess
  if (input.length === 1 && /^[a-z]$/.test(input)) {
    if (q.guessedLetters.indexOf(input) !== -1) {
      // Already guessed, skip silently in host mode
      setTimeout(function () {
        processNextAnswer();
      }, 100);
      return;
    }
    q.guessedLetters.push(input);
    if (q.answer.toLowerCase().indexOf(input) !== -1) {
      // Hit
      q.revealedWord = buildRevealedWord(q.answer, q.guessedLetters);
      if (q.revealedWord.indexOf('_') === -1) {
        // Word fully revealed — this player wins
        hostAnswerQueue = [];
        hostAnswerProcessing = false;
        hostRoundWon(entry.sender);
        return;
      }
      sendGameResponse(null, entry.sender + ' found [' + input + ']! ' + q.revealedWord, false);
    } else {
      // Miss
      q.wrongCount++;
      if (q.wrongCount >= q.maxWrong) {
        hostSession.questionActive = false;
        clearTimeout(hostSession.timeoutTimer);
        sendGameResponse(null, 'Hanged! The word was: ' + q.answer, false);
        hostAnswerQueue = [];
        hostAnswerProcessing = false;
        hostSession.roundTimer = setTimeout(function () {
          hostNextRound();
        }, HOST_DELAY_BETWEEN);
        return;
      }
      sendGameResponse(null, entry.sender + ' miss [' + input + ']! ' + q.revealedWord + ' (' + (q.maxWrong - q.wrongCount) + ' lives)', false);
    }
  }
  setTimeout(function () {
    processNextAnswer();
  }, 800);
}
function processTriviaRiddleEntry(entry) {
  if (!hostSession || !hostSession.questionActive || !hostSession.currentQuestion) {
    hostAnswerQueue = [];
    hostAnswerProcessing = false;
    return;
  }
  var answer = hostSession.currentQuestion.answer;
  var playerText = entry.message.trim().toLowerCase();
  var correctAnswer = answer.toLowerCase();

  // Quick exact match
  if (playerText === correctAnswer) {
    hostAnswerQueue = [];
    hostAnswerProcessing = false;
    hostRoundWon(entry.sender);
    return;
  }

  // Fuzzy match via OpenAI
  callOpenAIJson('You are judging a trivia/riddle answer. The correct answer is "' + answer + '". The player answered "' + entry.message.trim() + '". Is this close enough to be correct (allowing typos, synonyms)? Return ONLY valid JSON: {"correct":true or false}', 'Judge this answer.').then(function (result) {
    if (!hostSession || !hostSession.questionActive) {
      hostAnswerQueue = [];
      hostAnswerProcessing = false;
      return;
    }
    if (result.correct) {
      hostAnswerQueue = [];
      hostAnswerProcessing = false;
      hostRoundWon(entry.sender);
    } else {
      setTimeout(function () {
        processNextAnswer();
      }, 400);
    }
  })["catch"](function () {
    if (!hostSession || !hostSession.questionActive) {
      hostAnswerQueue = [];
      hostAnswerProcessing = false;
      return;
    }
    // Fallback: partial match
    if (correctAnswer.indexOf(playerText) === 0 || playerText.indexOf(correctAnswer) === 0) {
      hostAnswerQueue = [];
      hostAnswerProcessing = false;
      hostRoundWon(entry.sender);
    } else {
      setTimeout(function () {
        processNextAnswer();
      }, 400);
    }
  });
}
function hostRoundWon(winner) {
  if (!hostSession || !hostSession.questionActive) return;
  hostSession.questionActive = false;
  clearTimeout(hostSession.timeoutTimer);

  // Award point
  var key = winner.toLowerCase();
  var entry = hostSession.leaderboard.get(key) || {
    name: winner,
    points: 0
  };
  entry.points++;
  entry.name = winner;
  hostSession.leaderboard.set(key, entry);
  var answer = hostSession.currentQuestion ? hostSession.currentQuestion.answer : '???';
  sendGameResponse(null, winner + ' got it! Answer: ' + answer + ' (+1 pt)', false);
  emitActivity(winner, 'host-' + hostSession.gameType, 'won round ' + hostSession.currentRound);

  // Record in global scoreboard too
  recordGame(winner, true, hostSession.gameType);
  if (ioRef) ioRef.emit('chatgames:hostUpdate', getHostStatus());

  // Next round after delay
  setTimeout(function () {
    hostNextRound();
  }, hostSession.delayBetweenRounds);
}
function hostRoundTimeout() {
  if (!hostSession || !hostSession.questionActive) return;
  hostAnswerQueue = [];
  hostAnswerProcessing = false;
  hostSession.questionActive = false;
  var answer = hostSession.currentQuestion ? hostSession.currentQuestion.answer : '???';
  sendGameResponse(null, 'Time up! Answer: ' + answer, false);
  emitActivity('Host', 'host-' + hostSession.gameType, 'round ' + hostSession.currentRound + ' timed out');
  if (ioRef) ioRef.emit('chatgames:hostUpdate', getHostStatus());

  // Next round after delay
  setTimeout(function () {
    hostNextRound();
  }, hostSession.delayBetweenRounds);
}
function hostShowFinalLeaderboard() {
  if (!hostSession) return;
  var board = [];
  hostSession.leaderboard.forEach(function (entry) {
    board.push(entry);
  });
  board.sort(function (a, b) {
    return b.points - a.points;
  });
  if (board.length === 0) {
    sendGameResponse(null, 'No one scored! Better luck next time.', false);
    return;
  }

  // Announce winner
  setTimeout(function () {
    sendGameResponse(null, 'Winner: ' + board[0].name + ' with ' + board[0].points + ' pts!', false);
  }, 800);

  // Show top 3
  if (board.length > 1) {
    setTimeout(function () {
      var lines = [];
      for (var i = 0; i < Math.min(board.length, 3); i++) {
        lines.push(i + 1 + '. ' + board[i].name + ' - ' + board[i].points);
      }
      sendGameResponse(null, lines.join(' | '), false);
    }, 2400);
  }
}
function hostCleanup() {
  if (!hostSession) return;
  clearTimeout(hostSession.timeoutTimer);
  clearTimeout(hostSession.roundTimer);
  hostSession = null;
  hostAnswerQueue = [];
  hostAnswerProcessing = false;
  if (ioRef) ioRef.emit('chatgames:hostUpdate', getHostStatus());
}
function getHostStatus() {
  if (!hostSession) {
    return {
      active: false
    };
  }
  var board = [];
  hostSession.leaderboard.forEach(function (entry) {
    board.push(entry);
  });
  board.sort(function (a, b) {
    return b.points - a.points;
  });
  return {
    active: true,
    gameType: hostSession.gameType,
    currentRound: hostSession.currentRound,
    totalRounds: hostSession.totalRounds,
    hostPlayer: hostSession.hostPlayer,
    questionActive: hostSession.questionActive,
    currentQuestion: hostSession.questionActive ? hostSession.currentQuestion ? hostSession.currentQuestion.question : '' : '',
    leaderboard: board
  };
}

// ── Roast / Rage Bait ────────────────────────────────────────────

function addToChatHistory(sender, message) {
  chatHistoryBuffer.push({
    sender: sender,
    message: message,
    timestamp: Date.now()
  });
  while (chatHistoryBuffer.length > MAX_CHAT_HISTORY) {
    chatHistoryBuffer.shift();
  }
}
function handleRoastOrRageBait(sender, message) {
  if (!roastModeEnabled && !rageBaitEnabled) return;
  if (!sender || !message) return;
  if (getUsername && sender.toLowerCase() === getUsername().toLowerCase()) return;

  // If a target user is set, only respond to that specific player
  if (roastTarget && sender.toLowerCase() !== roastTarget.toLowerCase()) return;

  // Rate limiting
  var now = Date.now();
  if (now - lastRoastTime < ROAST_COOLDOWN) return;

  // Build chat context from history
  var contextLines = chatHistoryBuffer.slice(-10).map(function (entry) {
    return entry.sender + ': ' + entry.message;
  }).join('\n');
  var mode = roastModeEnabled ? 'roast' : 'ragebait';
  var systemPrompt;
  if (mode === 'roast') {
    systemPrompt = 'You are a witty Aisling in the world of Dark Ages (Temuair). Someone just spoke in public chat. Roast them humorously based on their name and what they said. Be funny, not cruel. Use Dark Ages references (classes, elements, towns, gods). Keep it under 55 characters. Do not use quotes. Recent chat for context:\n' + contextLines;
  } else {
    systemPrompt = 'You are a provocative Aisling in the world of Dark Ages (Temuair). Someone just spoke in public chat. Give a playful rage-bait response designed to get a reaction, based on their name and what they said. Be provocative but not hateful. Use Dark Ages references. Keep it under 55 characters. Do not use quotes. Recent chat for context:\n' + contextLines;
  }
  lastRoastTime = now;
  callOpenAI(systemPrompt, sanitizeName(sender) + ' says: ' + message.replace(/["\n\r]/g, ' ').substring(0, 100)).then(function (response) {
    var text = response.substring(0, WHISPER_MAX);
    if (sendWhisper) sendWhisper(sender, text);
    emitActivity(sender, mode, 'responded to ' + sender);
  })["catch"](function () {
    var fallbackRoasts = [sender + ' speaks, yet says nothing.', 'Even a Kobold has better takes, ' + sender + '.', sender + ' must be lost from Mileth.', 'Did a Dubhaimid write that, ' + sender + '?', 'Sgrios called, ' + sender + '. He wants you back.'];
    var fallbackBaits = [sender + ', warriors hit harder than your words.', 'Imagine being from Abel and saying that.', sender + ' clearly never passed Mileth.', 'Is that the best Temuair has, ' + sender + '?', sender + ', even mundanes disagree.'];
    var pool = mode === 'roast' ? fallbackRoasts : fallbackBaits;
    var text = pool[Math.floor(Math.random() * pool.length)];
    if (sendWhisper) sendWhisper(sender, text.substring(0, WHISPER_MAX));
  });
}
function handlePublicChatForRoast(sender, message) {
  addToChatHistory(sender, message);
  handleRoastOrRageBait(sender, message);
}

// ── Exports ──────────────────────────────────────────────────────

module.exports = {
  init: init,
  handlePublicMessage: handlePublicMessage,
  handleWhisper: handleWhisper,
  handlePossibleAnswer: handlePossibleAnswer,
  handleEmote: handleEmote,
  handlePublicChatForRoast: handlePublicChatForRoast,
  isEnabled: isEnabled,
  getConfig: getConfig,
  saveConfig: saveConfig,
  getStats: getStats,
  getLeaderboard: getLeaderboard,
  getLeaderboardByGame: getLeaderboardByGame,
  clearLeaderboard: clearLeaderboard,
  clearLeaderboardByGame: clearLeaderboardByGame,
  getActiveGames: getActiveGames,
  getHostStatus: getHostStatus,
  getBjStatus: getBjStatus,
  setScoreboardFromDB: function setScoreboardFromDB(map, total) {
    scoreboard = map;
    totalGamesPlayed = total;
  },
  setConfigFromDB: function setConfigFromDB(chatGamesConfig) {
    if (chatGamesConfig) {
      applyConfigUpdate(chatGamesConfig);
    }
  },
  startHostGame: function startHostGame(gameType, rounds) {
    handleHostStart('Panel', (gameType || 'trivia') + ' ' + (rounds || 5));
  },
  stopHostGame: function stopHostGame() {
    handleHostStop('Panel');
  },
  skipHostRound: function skipHostRound() {
    handleHostSkip('Panel');
  },
  startGroupBlackjack: function startGroupBlackjack(rounds) {
    startBjLobby('Panel', String(rounds || 5));
  },
  forceStartGroupBlackjack: function forceStartGroupBlackjack() {
    forceStartBj('Panel');
  },
  stopGroupBlackjack: function stopGroupBlackjack() {
    stopBjGame('Panel');
  }
};