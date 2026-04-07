// -- Chat Games Module ----------------------------------------------------
// Main entry point - maintains identical exports interface to the
// original monolithic chat-games.js

import S from './state';
import * as ai from './openai';
import * as sm from './session-manager';
import * as content from './content';

// Game modules
import * as trivia from './games/trivia';
import * as scramble from './games/scramble';
import * as hangman from './games/hangman';
import * as numberguess from './games/numberguess';
import * as eightball from './games/eightball';
import * as rps from './games/rps';
import * as blackjack from './games/blackjack';
import * as hostMode from './host-mode';
import * as roast from './roast';

// -- Initialization --

export function init(_: any, deps: any): void {
  S.sendSay = deps.sendSay;
  S.sendWhisper = deps.sendWhisper;
  S.sendEmote = deps.sendEmote;
  S.ioRef = deps.io;
  S.getUsername = deps.getUsername;
  S.dbRef = deps.db || null;

  ai.initOpenAI();

  console.log('[ChatGames] Initialized' + (S.openaiClient ? ' (OpenAI ready)' : ' (no API key)'));
}

// -- Config Management --

function applyConfigUpdate(update: any): any {
  const merged: any = Object.assign({}, S.config, update, {
    games: Object.assign({}, S.config.games, (update && update.games) || {})
  });

  merged.customTrivia = (update && update.customTrivia) || S.customTrivia;
  merged.customRiddles = (update && update.customRiddles) || S.customRiddles;
  merged.customWords = (update && update.customWords) || S.customWords;
  merged.custom8Ball = (update && update.custom8Ball) || S.custom8Ball;
  merged.customFortunes = (update && update.customFortunes) || S.customFortunes;

  if (update && update.roastMode) {
    merged.roastMode = true;
    merged.rageBaitMode = false;
  } else if (update && update.rageBaitMode) {
    merged.rageBaitMode = true;
    merged.roastMode = false;
  } else {
    merged.roastMode = (update && update.roastMode !== undefined) ? update.roastMode : S.roastModeEnabled;
    merged.rageBaitMode = (update && update.rageBaitMode !== undefined) ? update.rageBaitMode : S.rageBaitEnabled;
  }

  merged.roastTarget = (update && update.roastTarget !== undefined) ? update.roastTarget : S.roastTarget;

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

export function isEnabled(): boolean {
  return S.config.enabled && (S.openaiClient !== null || true);
}

export function getConfig(): any {
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

export function saveConfig(update: any): any {
  return applyConfigUpdate(update);
}

export function getStats(): any {
  return {
    activeGameCount: S.activeGames.size,
    totalGamesPlayed: S.totalGamesPlayed,
    scoreboard: sm.getLeaderboard().slice(0, 20)
  };
}

// -- Message Handling --

export function handlePublicMessage(sender: string, message: string): void {
  if (!S.config.enabled || !S.config.publicChatEnabled) return;
  if (!sender || !message) return;
  if (S.getUsername && sender.toLowerCase() === S.getUsername().toLowerCase()) return;

  const prefix = S.config.commandPrefix || '!';

  if (S.hostSession && S.hostSession.questionActive) {
    if (!message.startsWith(prefix)) {
      const handled = hostMode.handleHostAnswer(sender, message);
      if (handled) return;
    }
  }

  if (S.bjGroupSession && S.bjGroupSession.phase === 'playing') {
    if (!message.startsWith(prefix)) {
      const bjHandled = blackjack.handleGroupBjMessage(sender, message);
      if (bjHandled) return;
    }
  }

  if (message.startsWith(prefix)) {
    processCommand(sender, message, false);
  }
}

export function handleWhisper(sender: string, message: string): boolean {
  if (!S.config.enabled || !S.config.whisperEnabled) return false;
  if (!sender || !message) return false;
  if (S.getUsername && sender.toLowerCase() === S.getUsername().toLowerCase()) return false;

  const prefix = S.config.commandPrefix || '!';
  if (message.startsWith(prefix)) {
    processCommand(sender, message, true);
    return true;
  }
  return handlePossibleAnswer(sender, message, true);
}

export function handlePossibleAnswer(sender: string, message: string, isWhisper: boolean): boolean {
  if (!S.config.enabled) return false;
  if (!sender || !message) return false;

  const prefix = S.config.commandPrefix || '!';
  if (message.startsWith(prefix)) return false;

  const key = sender.toLowerCase();
  const session = S.activeGames.get(key);
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

// -- Command Dispatch --

function parseCommand(message: string, prefix: string): { command: string; args: string } {
  const withoutPrefix = message.substring(prefix.length).trim();
  const spaceIdx = withoutPrefix.indexOf(' ');
  if (spaceIdx === -1) {
    return { command: withoutPrefix.toLowerCase(), args: '' };
  }
  return {
    command: withoutPrefix.substring(0, spaceIdx).toLowerCase(),
    args: withoutPrefix.substring(spaceIdx + 1).trim()
  };
}

function processCommand(sender: string, message: string, isWhisper: boolean): void {
  const prefix = S.config.commandPrefix || '!';
  const parsed = parseCommand(message, prefix);
  const cmd = parsed.command;
  const args = parsed.args;

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
  if (cmd === 'help') { showHelp(sender, isWhisper); return; }
  if (cmd === 'score' || cmd === 'scores') { showScore(sender, isWhisper); return; }
  if (cmd === 'leaderboard' || cmd === 'top') { showLeaderboard(sender, isWhisper, args); return; }
  if (cmd === 'answer' || cmd === 'a') { handleAnswerCommand(sender, args, isWhisper); return; }
  if (cmd === 'hint' || cmd === 'h') { handleHint(sender, isWhisper); return; }
  if (cmd === 'giveup' || cmd === 'quit') { handleGiveUp(sender, isWhisper); return; }

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
      const betAmt = parseInt(args);
      if (!isNaN(betAmt)) blackjack.bjGroupHandleBet(sender, betAmt);
    }
  }
}

// -- Help, Score, Leaderboard, Answer, Hint, GiveUp --

function showHelp(sender: string, isWhisper: boolean): void {
  if (isWhisper) {
    const prefix = S.config.commandPrefix || '!';
    const lines = [
      'Chat Games: ' + prefix + 'trivia, ' + prefix + 'riddle, ' + prefix + '8ball <question>',
      prefix + 'scramble, ' + prefix + 'guess, ' + prefix + 'fortune, ' + prefix + 'rps',
      prefix + 'hangman, ' + prefix + 'bj (blackjack), ' + prefix + 'bjhost (group)',
      prefix + 'answer <text>, ' + prefix + 'hint, ' + prefix + 'giveup',
      prefix + 'score, ' + prefix + 'leaderboard'
    ];
    lines.forEach(function (line: string, i: number) {
      setTimeout(function () {
        S.sendWhisper!(sender, line);
      }, i * 500);
    });
  } else {
    const p = S.config.commandPrefix || '!';
    sm.sendGameResponse(sender, p + 'trivia ' + p + 'riddle ' + p + '8ball ' + p + 'scramble', false);
    setTimeout(function () {
      sm.sendGameResponse(sender, p + 'guess ' + p + 'fortune ' + p + 'rps ' + p + 'hangman', false);
    }, 800);
    setTimeout(function () {
      sm.sendGameResponse(sender, p + 'score ' + p + 'leaderboard', false);
    }, 1600);
  }
}

function showScore(sender: string, isWhisper: boolean): void {
  const key = sender.toLowerCase();
  const stats = S.scoreboard.get(key);
  if (!stats) {
    sm.sendGameResponse(sender, sender + ': No games played yet.', isWhisper);
    return;
  }

  const losses = stats.played - stats.wins;
  const rate = stats.played > 0 ? Math.round(stats.wins / stats.played * 100) : 0;
  let msg = sender + ': ' + stats.wins + 'W/' + losses + 'L (' + rate + '%)';
  if (stats.bestStreak > 0) {
    msg += ' | Best: ' + stats.bestStreak;
  }
  sm.sendGameResponse(sender, msg, isWhisper);

  if (isWhisper && stats.byGame) {
    const gameNames: { [key: string]: string } = { trivia: 'Trivia', riddle: 'Riddle', scramble: 'Scramble', numberguess: 'Guess', rps: 'RPS', blackjack: 'BJ', hangman: 'Hangman' };
    const parts: string[] = [];
    for (const gt in gameNames) {
      const g = stats.byGame[gt];
      if (g && g.played > 0) {
        parts.push(gameNames[gt] + ' ' + g.wins + '/' + g.played);
      }
    }
    if (parts.length > 0) {
      const breakdown = parts.join(' | ');
      setTimeout(function () {
        S.sendWhisper!(sender, breakdown);
      }, 500);
    }
  }
}

function showLeaderboard(sender: string, isWhisper: boolean, args: string): void {
  let gameFilter = (args || '').trim().toLowerCase();
  if (gameFilter) {
    if (gameFilter === 'guess' || gameFilter === 'number') gameFilter = 'numberguess';
    if (S.GAME_TYPES.indexOf(gameFilter) === -1) gameFilter = '';
  }

  let board: any[];
  let label = '';
  if (gameFilter) {
    board = sm.getLeaderboardByGame(gameFilter);
    const labels: { [key: string]: string } = { trivia: 'Trivia', riddle: 'Riddle', scramble: 'Scramble', numberguess: 'Guess', rps: 'RPS' };
    label = labels[gameFilter] || gameFilter;
  } else {
    board = [];
    S.scoreboard.forEach(function (val: any) { board.push(val); });
    board.sort(function (a: any, b: any) { return b.wins - a.wins; });
  }

  const top5 = board.slice(0, 5);

  if (top5.length === 0) {
    sm.sendGameResponse(sender, 'No ' + (label ? label + ' ' : '') + 'games played yet!', isWhisper);
    return;
  }

  if (isWhisper) {
    S.sendWhisper!(sender, (label ? label + ' ' : '') + 'Top Players:');
    top5.forEach(function (p: any, i: number) {
      const rate = p.played > 0 ? Math.round(p.wins / p.played * 100) : 0;
      setTimeout(function () {
        S.sendWhisper!(sender, (i + 1) + '. ' + p.name + ': ' + p.wins + 'W/' + ((p.played || 0) - (p.wins || 0)) + 'L (' + rate + '%)');
      }, (i + 1) * 400);
    });
  } else {
    let line = (label ? label + ' ' : '') + 'Top: ';
    top5.forEach(function (p: any, i: number) {
      if (i > 0) line += ', ';
      line += (i + 1) + '.' + p.name + ' ' + (p.wins || 0) + 'W';
    });
    if (line.length > 64) line = line.substring(0, 61) + '...';
    sm.sendGameResponse(sender, line, false);
  }
}

function handleAnswerCommand(sender: string, answer: string, isWhisper: boolean): void {
  const key = sender.toLowerCase();
  const session = S.activeGames.get(key);
  if (!session) {
    const p = S.config.commandPrefix || '!';
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

function handleHint(sender: string, isWhisper: boolean): void {
  const key = sender.toLowerCase();
  const session = S.activeGames.get(key);
  if (!session) {
    sm.sendGameResponse(sender, 'No active game.', isWhisper);
    return;
  }
  if (session.gameType === 'hangman') {
    const revealed = content.buildRevealedWord(session.answer, session.guessedLetters);
    const guessed = session.guessedLetters.length > 0 ? session.guessedLetters.join(',') : 'none';
    sm.sendGameResponse(sender, 'Hint: ' + (session.hint || 'No hint') + ' | ' + revealed, session.isWhisper);
    if (session.isWhisper) {
      setTimeout(function () {
        S.sendWhisper!(sender, 'Guessed: ' + guessed + ' | Lives: ' + (session.maxWrong - session.wrongCount));
      }, 500);
    }
    return;
  }
  sm.sendGameResponse(sender, 'Hint: ' + (session.hint || 'No hint available'), session.isWhisper);
}

function handleGiveUp(sender: string, isWhisper: boolean): void {
  const key = sender.toLowerCase();
  const session = S.activeGames.get(key);
  if (!session) {
    sm.sendGameResponse(sender, 'No active game.', isWhisper);
    return;
  }
  const answer = session.answer || '???';
  sm.sendGameResponse(sender, 'The answer was: ' + answer, session.isWhisper);
  sm.recordGame(sender, false, session.gameType);
  sm.cancelSession(sender);
  sm.emitActivity(sender, session.gameType, 'gave up');
}

// -- Exports (identical interface) --

export const handleEmote = rps.handleEmote;
export const handlePublicChatForRoast = roast.handlePublicChatForRoast;
export const getLeaderboard = sm.getLeaderboard;
export const getLeaderboardByGame = sm.getLeaderboardByGame;
export const clearLeaderboard = sm.clearLeaderboard;
export const clearLeaderboardByGame = sm.clearLeaderboardByGame;
export const getActiveGames = sm.getActiveGames;
export const getHostStatus = hostMode.getHostStatus;
export const getBjStatus = blackjack.getBjStatus;

export function setScoreboardFromDB(map: Map<string, any>, total: number): void {
  S.scoreboard = map;
  S.totalGamesPlayed = total;
}

export function setConfigFromDB(chatGamesConfig: any): void {
  if (chatGamesConfig) {
    applyConfigUpdate(chatGamesConfig);
  }
}

export function startHostGame(gameType: string, rounds: number): void {
  hostMode.handleHostStart('Panel', (gameType || 'trivia') + ' ' + (rounds || 5));
}

export function stopHostGame(): void {
  hostMode.handleHostStop('Panel');
}

export function skipHostRound(): void {
  hostMode.handleHostSkip('Panel');
}
