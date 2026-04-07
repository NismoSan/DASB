"use strict";

// ── Chat Games Module ────────────────────────────────────────────
// Main entry point - maintains identical exports interface to the
// original monolithic chat-games.js

var S = require('./state');
var ai = require('./openai');
var sm = require('./session-manager');
var content = require('./content');

// Game modules
var trivia = require('./games/trivia');
var scramble = require('./games/scramble');
var hangman = require('./games/hangman');
var numberguess = require('./games/numberguess');
var eightball = require('./games/eightball');
var rps = require('./games/rps');
var blackjack = require('./games/blackjack');
var hostMode = require('./host-mode');
var roast = require('./roast');

// ── Initialization ──

function init(_, deps) {
  S.sendSay = deps.sendSay;
  S.sendWhisper = deps.sendWhisper;
  S.sendEmote = deps.sendEmote;
  S.ioRef = deps.io;
  S.getUsername = deps.getUsername;
  S.dbRef = deps.db || null;
  ai.initOpenAI();
  console.log('[ChatGames] Initialized' + (S.openaiClient ? ' (OpenAI ready)' : ' (no API key)'));
}

// ── Config Management ──

function applyConfigUpdate(update) {
  var merged = Object.assign({}, S.config, update, {
    games: Object.assign({}, S.config.games, update && update.games || {})
  });
  merged.customTrivia = update && update.customTrivia || S.customTrivia;
  merged.customRiddles = update && update.customRiddles || S.customRiddles;
  merged.customWords = update && update.customWords || S.customWords;
  merged.custom8Ball = update && update.custom8Ball || S.custom8Ball;
  merged.customFortunes = update && update.customFortunes || S.customFortunes;
  if (update && update.roastMode) {
    merged.roastMode = true;
    merged.rageBaitMode = false;
  } else if (update && update.rageBaitMode) {
    merged.rageBaitMode = true;
    merged.roastMode = false;
  } else {
    merged.roastMode = update && update.roastMode !== undefined ? update.roastMode : S.roastModeEnabled;
    merged.rageBaitMode = update && update.rageBaitMode !== undefined ? update.rageBaitMode : S.rageBaitEnabled;
  }
  merged.roastTarget = update && update.roastTarget !== undefined ? update.roastTarget : S.roastTarget;
  S.config = merged;
  if (update && update.customTrivia) {
    S.customTrivia = update.customTrivia;
    content.resetCustomDecks();
  }
  if (update && update.customRiddles) {
    S.customRiddles = update.customRiddles;
    content.resetCustomDecks();
  }
  if (update && update.customWords) {
    S.customWords = update.customWords;
    content.resetCustomDecks();
  }
  if (update && update.custom8Ball) {
    S.custom8Ball = update.custom8Ball;
  }
  if (update && update.customFortunes) {
    S.customFortunes = update.customFortunes;
  }
  S.roastModeEnabled = !!merged.roastMode;
  S.rageBaitEnabled = !!merged.rageBaitMode;
  S.roastTarget = merged.roastTarget || '';
  return getConfig();
}
function isEnabled() {
  return S.config.enabled && (S.openaiClient !== null || true);
}
function getConfig() {
  return {
    enabled: S.config.enabled,
    openaiModel: S.config.openaiModel,
    commandPrefix: S.config.commandPrefix,
    publicChatEnabled: S.config.publicChatEnabled,
    whisperEnabled: S.config.whisperEnabled,
    cooldownSeconds: S.config.cooldownSeconds,
    games: S.config.games,
    hasApiKey: !!process.env.OPENAI_API_KEY,
    customTrivia: S.customTrivia,
    customRiddles: S.customRiddles,
    customWords: S.customWords,
    custom8Ball: S.custom8Ball,
    customFortunes: S.customFortunes,
    roastMode: S.roastModeEnabled,
    rageBaitMode: S.rageBaitEnabled,
    roastTarget: S.roastTarget
  };
}
function saveConfig(update) {
  return applyConfigUpdate(update);
}
function getStats() {
  return {
    activeGameCount: S.activeGames.size,
    totalGamesPlayed: S.totalGamesPlayed,
    scoreboard: sm.getLeaderboard().slice(0, 20)
  };
}

// ── Message Handling ──

function handlePublicMessage(sender, message) {
  if (!S.config.enabled || !S.config.publicChatEnabled) return;
  if (!sender || !message) return;
  if (S.getUsername && sender.toLowerCase() === S.getUsername().toLowerCase()) return;
  var prefix = S.config.commandPrefix || '!';
  if (S.hostSession && S.hostSession.questionActive) {
    if (!message.startsWith(prefix)) {
      var handled = hostMode.handleHostAnswer(sender, message);
      if (handled) return;
    }
  }
  if (S.bjGroupSession && S.bjGroupSession.phase === 'playing') {
    if (!message.startsWith(prefix)) {
      var bjHandled = blackjack.handleGroupBjMessage(sender, message);
      if (bjHandled) return;
    }
  }
  if (message.startsWith(prefix)) {
    processCommand(sender, message, false);
  }
}
function handleWhisper(sender, message) {
  if (!S.config.enabled || !S.config.whisperEnabled) return false;
  if (!sender || !message) return false;
  if (S.getUsername && sender.toLowerCase() === S.getUsername().toLowerCase()) return false;
  var prefix = S.config.commandPrefix || '!';
  if (message.startsWith(prefix)) {
    processCommand(sender, message, true);
    return true;
  }
  return handlePossibleAnswer(sender, message, true);
}
function handlePossibleAnswer(sender, message, isWhisper) {
  if (!S.config.enabled) return false;
  if (!sender || !message) return false;
  var prefix = S.config.commandPrefix || '!';
  if (message.startsWith(prefix)) return false;
  var key = sender.toLowerCase();
  var session = S.activeGames.get(key);
  if (!session) return false;
  if (session.gameType !== 'blackjack' && session.isWhisper !== isWhisper) return false;
  if (session.gameType === 'trivia' || session.gameType === 'riddle') {
    trivia.checkAnswerFuzzy(session, message);
    return true;
  }
  if (session.gameType === 'scramble') {
    scramble.checkAnswerExact(session, message);
    return true;
  }
  if (session.gameType === 'numberguess') {
    numberguess.checkNumberGuess(session, message);
    return true;
  }
  if (session.gameType === 'rps') {
    rps.handleRpsAnswer(session, message);
    return true;
  }
  if (session.gameType === 'blackjack') {
    blackjack.handleBlackjackAction(session, message);
    return true;
  }
  if (session.gameType === 'hangman') {
    hangman.handleHangmanGuess(session, message);
    return true;
  }
  return false;
}

// ── Command Dispatch ──

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
  var prefix = S.config.commandPrefix || '!';
  var parsed = parseCommand(message, prefix);
  var cmd = parsed.command;
  var args = parsed.args;

  // Host mode commands
  if (isWhisper && (cmd === 'host' || cmd === 'hoststart')) {
    hostMode.handleHostStart(sender, args);
    return;
  }
  if (isWhisper && (cmd === 'hoststop' || cmd === 'hostend')) {
    hostMode.handleHostStop(sender);
    return;
  }
  if (isWhisper && cmd === 'hostskip') {
    hostMode.handleHostSkip(sender);
    return;
  }

  // Non-cooldown commands
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

  // Check cooldown
  if (sm.isOnCooldown(sender)) {
    sm.sendGameResponse(sender, 'Wait a moment before playing again.', isWhisper);
    return;
  }

  // Game commands
  if (cmd === 'trivia' && S.config.games.trivia) {
    trivia.startTrivia(sender, isWhisper);
  } else if (cmd === 'riddle' && S.config.games.riddle) {
    trivia.startRiddle(sender, isWhisper);
  } else if ((cmd === '8ball' || cmd === 'eightball') && S.config.games.eightball) {
    eightball.handle8Ball(sender, args, isWhisper);
  } else if (cmd === 'scramble' && S.config.games.scramble) {
    scramble.startScramble(sender, isWhisper);
  } else if ((cmd === 'guess' || cmd === 'numberguess') && S.config.games.numberguess) {
    numberguess.startNumberGuess(sender, isWhisper);
  } else if (cmd === 'fortune' && S.config.games.fortune) {
    eightball.handleFortune(sender, isWhisper);
  } else if (cmd === 'rps' && S.config.games.rps) {
    rps.startRps(sender, isWhisper);
  } else if ((cmd === 'blackjack' || cmd === 'bj') && S.config.games.blackjack) {
    blackjack.startBlackjack(sender, isWhisper);
  } else if ((cmd === 'bjhost' || cmd === 'blackjackhost') && S.config.games.blackjack && !isWhisper) {
    blackjack.startBjLobby(sender, args);
  } else if (cmd === 'bjjoin' && S.config.games.blackjack && !isWhisper) {
    blackjack.joinBjLobby(sender);
  } else if (cmd === 'bjstart' && S.config.games.blackjack && !isWhisper) {
    blackjack.forceStartBj(sender);
  } else if (cmd === 'bjleave' && S.config.games.blackjack) {
    blackjack.leaveBj(sender, isWhisper);
  } else if (cmd === 'bjstop' && S.config.games.blackjack) {
    blackjack.stopBjGame(sender);
  } else if (cmd === 'bjstatus' && S.config.games.blackjack) {
    blackjack.showBjStatus(sender, isWhisper);
  } else if (cmd === 'hangman' && S.config.games.hangman) {
    hangman.startHangman(sender, isWhisper);
  } else if (cmd === 'bet' && S.config.games.blackjack) {
    if (S.bjGroupSession && S.bjGroupSession.phase === 'betting') {
      var betAmt = parseInt(args);
      if (!isNaN(betAmt)) blackjack.bjGroupHandleBet(sender, betAmt);
    }
  }
}

// ── Help, Score, Leaderboard, Answer, Hint, GiveUp ──

function showHelp(sender, isWhisper) {
  if (isWhisper) {
    var prefix = S.config.commandPrefix || '!';
    var lines = ['Chat Games: ' + prefix + 'trivia, ' + prefix + 'riddle, ' + prefix + '8ball <question>', prefix + 'scramble, ' + prefix + 'guess, ' + prefix + 'fortune, ' + prefix + 'rps', prefix + 'hangman, ' + prefix + 'bj (blackjack), ' + prefix + 'bjhost (group)', prefix + 'answer <text>, ' + prefix + 'hint, ' + prefix + 'giveup', prefix + 'score, ' + prefix + 'leaderboard'];
    lines.forEach(function (line, i) {
      setTimeout(function () {
        S.sendWhisper(sender, line);
      }, i * 500);
    });
  } else {
    var p = S.config.commandPrefix || '!';
    sm.sendGameResponse(sender, p + 'trivia ' + p + 'riddle ' + p + '8ball ' + p + 'scramble', false);
    setTimeout(function () {
      sm.sendGameResponse(sender, p + 'guess ' + p + 'fortune ' + p + 'rps ' + p + 'hangman', false);
    }, 800);
    setTimeout(function () {
      sm.sendGameResponse(sender, p + 'score ' + p + 'leaderboard', false);
    }, 1600);
  }
}
function showScore(sender, isWhisper) {
  var key = sender.toLowerCase();
  var stats = S.scoreboard.get(key);
  if (!stats) {
    sm.sendGameResponse(sender, sender + ': No games played yet.', isWhisper);
    return;
  }
  var losses = stats.played - stats.wins;
  var rate = stats.played > 0 ? Math.round(stats.wins / stats.played * 100) : 0;
  var msg = sender + ': ' + stats.wins + 'W/' + losses + 'L (' + rate + '%)';
  if (stats.bestStreak > 0) {
    msg += ' | Best: ' + stats.bestStreak;
  }
  sm.sendGameResponse(sender, msg, isWhisper);
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
        S.sendWhisper(sender, breakdown);
      }, 500);
    }
  }
}
function showLeaderboard(sender, isWhisper, args) {
  var gameFilter = (args || '').trim().toLowerCase();
  if (gameFilter) {
    if (gameFilter === 'guess' || gameFilter === 'number') gameFilter = 'numberguess';
    if (S.GAME_TYPES.indexOf(gameFilter) === -1) gameFilter = '';
  }
  var board;
  var label = '';
  if (gameFilter) {
    board = sm.getLeaderboardByGame(gameFilter);
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
    S.scoreboard.forEach(function (val) {
      board.push(val);
    });
    board.sort(function (a, b) {
      return b.wins - a.wins;
    });
  }
  var top5 = board.slice(0, 5);
  if (top5.length === 0) {
    sm.sendGameResponse(sender, 'No ' + (label ? label + ' ' : '') + 'games played yet!', isWhisper);
    return;
  }
  if (isWhisper) {
    S.sendWhisper(sender, (label ? label + ' ' : '') + 'Top Players:');
    top5.forEach(function (p, i) {
      var rate = p.played > 0 ? Math.round(p.wins / p.played * 100) : 0;
      setTimeout(function () {
        S.sendWhisper(sender, i + 1 + '. ' + p.name + ': ' + p.wins + 'W/' + ((p.played || 0) - (p.wins || 0)) + 'L (' + rate + '%)');
      }, (i + 1) * 400);
    });
  } else {
    var line = (label ? label + ' ' : '') + 'Top: ';
    top5.forEach(function (p, i) {
      if (i > 0) line += ', ';
      line += i + 1 + '.' + p.name + ' ' + (p.wins || 0) + 'W';
    });
    if (line.length > 64) line = line.substring(0, 61) + '...';
    sm.sendGameResponse(sender, line, false);
  }
}
function handleAnswerCommand(sender, answer, isWhisper) {
  var key = sender.toLowerCase();
  var session = S.activeGames.get(key);
  if (!session) {
    var p = S.config.commandPrefix || '!';
    sm.sendGameResponse(sender, 'No active game. Try ' + p + 'trivia or ' + p + 'riddle', isWhisper);
    return;
  }
  if (session.gameType === 'trivia' || session.gameType === 'riddle') {
    trivia.checkAnswerFuzzy(session, answer);
  } else if (session.gameType === 'scramble') {
    scramble.checkAnswerExact(session, answer);
  } else if (session.gameType === 'numberguess') {
    numberguess.checkNumberGuess(session, answer);
  } else if (session.gameType === 'hangman') {
    hangman.handleHangmanGuess(session, answer);
  }
}
function handleHint(sender, isWhisper) {
  var key = sender.toLowerCase();
  var session = S.activeGames.get(key);
  if (!session) {
    sm.sendGameResponse(sender, 'No active game.', isWhisper);
    return;
  }
  if (session.gameType === 'hangman') {
    var revealed = content.buildRevealedWord(session.answer, session.guessedLetters);
    var guessed = session.guessedLetters.length > 0 ? session.guessedLetters.join(',') : 'none';
    sm.sendGameResponse(sender, 'Hint: ' + (session.hint || 'No hint') + ' | ' + revealed, session.isWhisper);
    if (session.isWhisper) {
      setTimeout(function () {
        S.sendWhisper(sender, 'Guessed: ' + guessed + ' | Lives: ' + (session.maxWrong - session.wrongCount));
      }, 500);
    }
    return;
  }
  sm.sendGameResponse(sender, 'Hint: ' + (session.hint || 'No hint available'), session.isWhisper);
}
function handleGiveUp(sender, isWhisper) {
  var key = sender.toLowerCase();
  var session = S.activeGames.get(key);
  if (!session) {
    sm.sendGameResponse(sender, 'No active game.', isWhisper);
    return;
  }
  var answer = session.answer || '???';
  sm.sendGameResponse(sender, 'The answer was: ' + answer, session.isWhisper);
  sm.recordGame(sender, false, session.gameType);
  sm.cancelSession(sender);
  sm.emitActivity(sender, session.gameType, 'gave up');
}

// ── Exports (identical interface) ──

module.exports = {
  init: init,
  handlePublicMessage: handlePublicMessage,
  handleWhisper: handleWhisper,
  handlePossibleAnswer: handlePossibleAnswer,
  handleEmote: rps.handleEmote,
  handlePublicChatForRoast: roast.handlePublicChatForRoast,
  isEnabled: isEnabled,
  getConfig: getConfig,
  saveConfig: saveConfig,
  getStats: getStats,
  getLeaderboard: sm.getLeaderboard,
  getLeaderboardByGame: sm.getLeaderboardByGame,
  clearLeaderboard: sm.clearLeaderboard,
  clearLeaderboardByGame: sm.clearLeaderboardByGame,
  getActiveGames: sm.getActiveGames,
  getHostStatus: hostMode.getHostStatus,
  getBjStatus: blackjack.getBjStatus,
  setScoreboardFromDB: function setScoreboardFromDB(map, total) {
    S.scoreboard = map;
    S.totalGamesPlayed = total;
  },
  setConfigFromDB: function setConfigFromDB(chatGamesConfig) {
    if (chatGamesConfig) {
      applyConfigUpdate(chatGamesConfig);
    }
  },
  startHostGame: function startHostGame(gameType, rounds) {
    hostMode.handleHostStart('Panel', (gameType || 'trivia') + ' ' + (rounds || 5));
  },
  stopHostGame: function stopHostGame() {
    hostMode.handleHostStop('Panel');
  },
  skipHostRound: function skipHostRound() {
    hostMode.handleHostSkip('Panel');
  }
};