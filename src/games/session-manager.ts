// -- Session Management & Scoring -----------------------------------------
import S from './state';

// -- Message Sending --

export function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  while (text.length > 0) {
    if (text.length <= maxLen) {
      chunks.push(text);
      break;
    }
    let splitAt = text.lastIndexOf(' ', maxLen);
    if (splitAt <= 0) splitAt = maxLen;
    chunks.push(text.substring(0, splitAt));
    text = text.substring(splitAt).trim();
  }
  return chunks;
}

export function sendGameResponse(playerName: string | null, text: string, isWhisper: boolean): void {
  if (!text) return;

  if (isWhisper) {
    const whisperChunks = splitMessage(text, S.WHISPER_MAX);
    whisperChunks.forEach(function (chunk: string, i: number) {
      setTimeout(function () {
        if (S.sendWhisper) S.sendWhisper(playerName!, chunk);
      }, i * 500);
    });
  } else {
    // Stealth mode: whisper to player instead of public say
    // Only use public say for host-mode broadcasts (playerName is null)
    if (playerName) {
      const wChunks = splitMessage(text, S.WHISPER_MAX);
      wChunks.forEach(function (chunk: string, i: number) {
        setTimeout(function () {
          if (S.sendWhisper) S.sendWhisper(playerName, chunk);
        }, i * 500);
      });
    } else {
      // Host mode broadcast - keep as public say (Lancelot-only)
      const sayChunks = splitMessage(text, S.PUBLIC_SAY_MAX);
      sayChunks.forEach(function (chunk: string, i: number) {
        setTimeout(function () {
          if (S.sendSay) S.sendSay(chunk);
        }, i * 800);
      });
    }
  }
}

// -- Panel Activity --

export function emitActivity(player: string, gameType: string, action: string): void {
  if (S.ioRef) {
    S.ioRef.emit('chatgames:activity', {
      timestamp: Date.now(),
      player: player,
      gameType: gameType,
      action: action
    });
  }
}

// -- Active Games API --

export function getActiveGames(): any[] {
  const list: any[] = [];
  S.activeGames.forEach(function (session: any) {
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

// -- Session Lifecycle --

export function createSession(playerName: string, gameType: string, isWhisper: boolean, gameData: any): any {
  cancelSession(playerName);

  const timeouts: { [key: string]: number } = { trivia: 60000, riddle: 90000, scramble: 60000, numberguess: 120000, rps: 90000, hangman: 120000 };
  const timeout = timeouts[gameType] || 60000;
  const maxAttempts = gameData.maxAttempts || (gameType === 'numberguess' ? 10 : 3);

  const session: any = {
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

export function cancelSession(playerName: string): void {
  const key = playerName.toLowerCase();
  const session = S.activeGames.get(key);
  if (session) {
    clearTimeout(session.timeoutTimer);
    S.activeGames.delete(key);
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

function onSessionTimeout(playerName: string): void {
  const key = playerName.toLowerCase();
  const session = S.activeGames.get(key);
  if (!session) return;
  sendGameResponse(playerName, 'Time up! Answer: ' + (session.answer || '???'), session.isWhisper);
  recordGame(playerName, false, session.gameType);
  cancelSession(playerName);
  emitActivity(playerName, session.gameType, 'timed out');
}

// -- Cooldown --

export function isOnCooldown(playerName: string): boolean {
  const key = playerName.toLowerCase();
  const last = S.playerCooldowns.get(key);
  if (!last) return false;
  return (Date.now() - last) < (S.config.cooldownSeconds || 10) * 1000;
}

export function setCooldown(playerName: string): void {
  S.playerCooldowns.set(playerName.toLowerCase(), Date.now());
}

// Periodic sweep of expired cooldown entries (every 5 min)
const _cooldownCleanupTimer = setInterval(function () {
  const now = Date.now();
  const maxAge = (S.config.cooldownSeconds || 10) * 1000;
  S.playerCooldowns.forEach(function (ts: number, key: string) {
    if (now - ts > maxAge) S.playerCooldowns.delete(key);
  });
}, 5 * 60 * 1000);
if (_cooldownCleanupTimer.unref) _cooldownCleanupTimer.unref();

// -- Scoring --

export function recordGame(playerName: string, won: boolean, gameType?: string): void {
  const key = playerName.toLowerCase();
  const stats: any = S.scoreboard.get(key) || { name: playerName, wins: 0, played: 0, currentStreak: 0, bestStreak: 0 };
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
    if (!stats.byGame[gameType]) stats.byGame[gameType] = { wins: 0, played: 0 };
    stats.byGame[gameType].played++;
    if (won) stats.byGame[gameType].wins++;
  }

  S.scoreboard.set(key, stats);
  S.totalGamesPlayed++;
  saveLeaderboard(playerName);
  if (S.ioRef) S.ioRef.emit('chatgames:leaderboard', getLeaderboard());
}

// -- Leaderboard --

export function saveLeaderboard(updatedPlayerName: string): void {
  if (S.dbRef && updatedPlayerName) {
    const key = updatedPlayerName.toLowerCase();
    const stats = S.scoreboard.get(key);
    if (stats) {
      S.dbRef.savePlayerScore(updatedPlayerName, stats);
    }
  }
}

export function getLeaderboard(): any[] {
  const board: any[] = [];
  S.scoreboard.forEach(function (val: any) {
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
  board.sort(function (a: any, b: any) { return b.wins - a.wins; });
  return board;
}

export function getLeaderboardByGame(gameType: string): any[] {
  const board: any[] = [];
  S.scoreboard.forEach(function (val: any) {
    const g = val.byGame && val.byGame[gameType];
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
  board.sort(function (a: any, b: any) { return b.wins - a.wins; });
  return board;
}

export function clearLeaderboard(): void {
  S.scoreboard = new Map();
  S.totalGamesPlayed = 0;
  if (S.dbRef) S.dbRef.clearLeaderboard();
}

export function clearLeaderboardByGame(gameType: string): void {
  if (!gameType) return;
  S.scoreboard.forEach(function (stats: any, key: string) {
    if (stats.byGame && stats.byGame[gameType]) {
      const g = stats.byGame[gameType];
      stats.played = Math.max(0, (stats.played || 0) - (g.played || 0));
      stats.wins = Math.max(0, (stats.wins || 0) - (g.wins || 0));
      delete stats.byGame[gameType];
      stats.currentStreak = 0;
      stats.bestStreak = 0;
      S.scoreboard.set(key, stats);
      saveLeaderboard(stats.name);
    }
  });
  S.scoreboard.forEach(function (stats: any, key: string) {
    if (stats.played <= 0) S.scoreboard.delete(key);
  });
  S.totalGamesPlayed = 0;
  S.scoreboard.forEach(function (stats: any) { S.totalGamesPlayed += stats.played; });
}

// -- Answer Checking --

export function onCorrectAnswer(session: any): void {
  session.answerProcessing = false;
  sendGameResponse(session.playerName, 'Correct, ' + session.playerName + '! Answer: ' + session.answer, session.isWhisper);
  recordGame(session.playerName, true, session.gameType);
  cancelSession(session.playerName);
  emitActivity(session.playerName, session.gameType, 'answered correctly');
}

export function onWrongAnswer(session: any): void {
  session.answerProcessing = false;
  if (session.attempts >= (session.maxAttempts || 3)) {
    sendGameResponse(session.playerName, 'No more tries! Answer: ' + session.answer, session.isWhisper);
    recordGame(session.playerName, false, session.gameType);
    cancelSession(session.playerName);
    emitActivity(session.playerName, session.gameType, 'ran out of attempts');
  } else {
    const remaining = (session.maxAttempts || 3) - session.attempts;
    const p = S.config.commandPrefix || '!';
    sendGameResponse(session.playerName, 'Wrong! ' + remaining + ' tries left. (' + p + 'hint)', session.isWhisper);
  }
}
