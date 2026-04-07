"use strict";

// ── Session Management & Scoring ─────────────────────────────────
var S = require('./state');

// ── Message Sending ──

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
function sendGameResponse(playerName, text, isWhisper) {
  if (!text) return;
  if (isWhisper) {
    var whisperChunks = splitMessage(text, S.WHISPER_MAX);
    whisperChunks.forEach(function (chunk, i) {
      setTimeout(function () {
        if (S.sendWhisper) S.sendWhisper(playerName, chunk);
      }, i * 500);
    });
  } else {
    // Stealth mode: whisper to player instead of public say
    // Only use public say for host-mode broadcasts (playerName is null)
    if (playerName) {
      var wChunks = splitMessage(text, S.WHISPER_MAX);
      wChunks.forEach(function (chunk, i) {
        setTimeout(function () {
          if (S.sendWhisper) S.sendWhisper(playerName, chunk);
        }, i * 500);
      });
    } else {
      // Host mode broadcast - keep as public say (Lancelot-only)
      var sayChunks = splitMessage(text, S.PUBLIC_SAY_MAX);
      sayChunks.forEach(function (chunk, i) {
        setTimeout(function () {
          if (S.sendSay) S.sendSay(chunk);
        }, i * 800);
      });
    }
  }
}

// ── Panel Activity ──

function emitActivity(player, gameType, action) {
  if (S.ioRef) {
    S.ioRef.emit('chatgames:activity', {
      timestamp: Date.now(),
      player: player,
      gameType: gameType,
      action: action
    });
  }
}

// ── Active Games API ──

function getActiveGames() {
  var list = [];
  S.activeGames.forEach(function (session) {
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

// ── Session Lifecycle ──

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
  S.activeGames.set(playerName.toLowerCase(), session);
  if (S.ioRef) {
    S.ioRef.emit('chatgames:sessionStart', {
      player: playerName,
      gameType: gameType,
      timestamp: Date.now()
    });
    S.ioRef.emit('chatgames:active', getActiveGames());
  }
  return session;
}
function cancelSession(playerName) {
  var key = playerName.toLowerCase();
  var session = S.activeGames.get(key);
  if (session) {
    clearTimeout(session.timeoutTimer);
    S.activeGames["delete"](key);
    if (S.ioRef) {
      S.ioRef.emit('chatgames:sessionEnd', {
        player: playerName,
        gameType: session.gameType,
        timestamp: Date.now()
      });
      S.ioRef.emit('chatgames:active', getActiveGames());
    }
  }
}
function onSessionTimeout(playerName) {
  var key = playerName.toLowerCase();
  var session = S.activeGames.get(key);
  if (!session) return;
  sendGameResponse(playerName, 'Time up! Answer: ' + (session.answer || '???'), session.isWhisper);
  recordGame(playerName, false, session.gameType);
  cancelSession(playerName);
  emitActivity(playerName, session.gameType, 'timed out');
}

// ── Cooldown ──

function isOnCooldown(playerName) {
  var key = playerName.toLowerCase();
  var last = S.playerCooldowns.get(key);
  if (!last) return false;
  return Date.now() - last < (S.config.cooldownSeconds || 10) * 1000;
}
function setCooldown(playerName) {
  S.playerCooldowns.set(playerName.toLowerCase(), Date.now());
}

// Periodic sweep of expired cooldown entries (every 5 min)
var _cooldownCleanupTimer = setInterval(function () {
  var now = Date.now();
  var maxAge = (S.config.cooldownSeconds || 10) * 1000;
  S.playerCooldowns.forEach(function (ts, key) {
    if (now - ts > maxAge) S.playerCooldowns["delete"](key);
  });
}, 5 * 60 * 1000);
if (_cooldownCleanupTimer.unref) _cooldownCleanupTimer.unref();

// ── Scoring ──

function recordGame(playerName, won, gameType) {
  var key = playerName.toLowerCase();
  var stats = S.scoreboard.get(key) || {
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
  stats.name = playerName;
  if (gameType) {
    if (!stats.byGame) stats.byGame = {};
    if (!stats.byGame[gameType]) stats.byGame[gameType] = {
      wins: 0,
      played: 0
    };
    stats.byGame[gameType].played++;
    if (won) stats.byGame[gameType].wins++;
  }
  S.scoreboard.set(key, stats);
  S.totalGamesPlayed++;
  saveLeaderboard(playerName);
  if (S.ioRef) S.ioRef.emit('chatgames:leaderboard', getLeaderboard());
}

// ── Leaderboard ──

function saveLeaderboard(updatedPlayerName) {
  if (S.dbRef && updatedPlayerName) {
    var key = updatedPlayerName.toLowerCase();
    var stats = S.scoreboard.get(key);
    if (stats) {
      S.dbRef.savePlayerScore(updatedPlayerName, stats);
    }
  }
}
function getLeaderboard() {
  var board = [];
  S.scoreboard.forEach(function (val) {
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
function getLeaderboardByGame(gameType) {
  var board = [];
  S.scoreboard.forEach(function (val) {
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
  S.scoreboard = new Map();
  S.totalGamesPlayed = 0;
  if (S.dbRef) S.dbRef.clearLeaderboard();
}
function clearLeaderboardByGame(gameType) {
  if (!gameType) return;
  S.scoreboard.forEach(function (stats, key) {
    if (stats.byGame && stats.byGame[gameType]) {
      var g = stats.byGame[gameType];
      stats.played = Math.max(0, (stats.played || 0) - (g.played || 0));
      stats.wins = Math.max(0, (stats.wins || 0) - (g.wins || 0));
      delete stats.byGame[gameType];
      stats.currentStreak = 0;
      stats.bestStreak = 0;
      S.scoreboard.set(key, stats);
      saveLeaderboard(stats.name);
    }
  });
  S.scoreboard.forEach(function (stats, key) {
    if (stats.played <= 0) S.scoreboard["delete"](key);
  });
  S.totalGamesPlayed = 0;
  S.scoreboard.forEach(function (stats) {
    S.totalGamesPlayed += stats.played;
  });
}

// ── Answer Checking ──

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
    var p = S.config.commandPrefix || '!';
    sendGameResponse(session.playerName, 'Wrong! ' + remaining + ' tries left. (' + p + 'hint)', session.isWhisper);
  }
}
module.exports = {
  splitMessage: splitMessage,
  sendGameResponse: sendGameResponse,
  emitActivity: emitActivity,
  getActiveGames: getActiveGames,
  createSession: createSession,
  cancelSession: cancelSession,
  isOnCooldown: isOnCooldown,
  setCooldown: setCooldown,
  recordGame: recordGame,
  saveLeaderboard: saveLeaderboard,
  getLeaderboard: getLeaderboard,
  getLeaderboardByGame: getLeaderboardByGame,
  clearLeaderboard: clearLeaderboard,
  clearLeaderboardByGame: clearLeaderboardByGame,
  onCorrectAnswer: onCorrectAnswer,
  onWrongAnswer: onWrongAnswer
};