"use strict";
// -- Chat Games Module ----------------------------------------------------
// Main entry point - maintains identical exports interface to the
// original monolithic chat-games.js
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBjStatus = exports.getHostStatus = exports.getActiveGames = exports.clearLeaderboardByGame = exports.clearLeaderboard = exports.getLeaderboardByGame = exports.getLeaderboard = exports.handlePublicChatForRoast = exports.handleEmote = void 0;
exports.init = init;
exports.isEnabled = isEnabled;
exports.getConfig = getConfig;
exports.saveConfig = saveConfig;
exports.getStats = getStats;
exports.handlePublicMessage = handlePublicMessage;
exports.handleWhisper = handleWhisper;
exports.handlePossibleAnswer = handlePossibleAnswer;
exports.setScoreboardFromDB = setScoreboardFromDB;
exports.setConfigFromDB = setConfigFromDB;
exports.startHostGame = startHostGame;
exports.stopHostGame = stopHostGame;
exports.skipHostRound = skipHostRound;
const state_1 = __importDefault(require("./state"));
const ai = __importStar(require("./openai"));
const sm = __importStar(require("./session-manager"));
const content = __importStar(require("./content"));
// Game modules
const trivia = __importStar(require("./games/trivia"));
const scramble = __importStar(require("./games/scramble"));
const hangman = __importStar(require("./games/hangman"));
const numberguess = __importStar(require("./games/numberguess"));
const eightball = __importStar(require("./games/eightball"));
const rps = __importStar(require("./games/rps"));
const blackjack = __importStar(require("./games/blackjack"));
const hostMode = __importStar(require("./host-mode"));
const roast = __importStar(require("./roast"));
// -- Initialization --
function init(_, deps) {
    state_1.default.sendSay = deps.sendSay;
    state_1.default.sendWhisper = deps.sendWhisper;
    state_1.default.sendEmote = deps.sendEmote;
    state_1.default.ioRef = deps.io;
    state_1.default.getUsername = deps.getUsername;
    state_1.default.dbRef = deps.db || null;
    ai.initOpenAI();
    console.log('[ChatGames] Initialized' + (state_1.default.openaiClient ? ' (OpenAI ready)' : ' (no API key)'));
}
// -- Config Management --
function applyConfigUpdate(update) {
    const merged = Object.assign({}, state_1.default.config, update, {
        games: Object.assign({}, state_1.default.config.games, (update && update.games) || {})
    });
    merged.customTrivia = (update && update.customTrivia) || state_1.default.customTrivia;
    merged.customRiddles = (update && update.customRiddles) || state_1.default.customRiddles;
    merged.customWords = (update && update.customWords) || state_1.default.customWords;
    merged.custom8Ball = (update && update.custom8Ball) || state_1.default.custom8Ball;
    merged.customFortunes = (update && update.customFortunes) || state_1.default.customFortunes;
    if (update && update.roastMode) {
        merged.roastMode = true;
        merged.rageBaitMode = false;
    }
    else if (update && update.rageBaitMode) {
        merged.rageBaitMode = true;
        merged.roastMode = false;
    }
    else {
        merged.roastMode = (update && update.roastMode !== undefined) ? update.roastMode : state_1.default.roastModeEnabled;
        merged.rageBaitMode = (update && update.rageBaitMode !== undefined) ? update.rageBaitMode : state_1.default.rageBaitEnabled;
    }
    merged.roastTarget = (update && update.roastTarget !== undefined) ? update.roastTarget : state_1.default.roastTarget;
    state_1.default.config = merged;
    if (update && update.customTrivia) {
        state_1.default.customTrivia = update.customTrivia;
        content.resetCustomDecks();
    }
    if (update && update.customRiddles) {
        state_1.default.customRiddles = update.customRiddles;
        content.resetCustomDecks();
    }
    if (update && update.customWords) {
        state_1.default.customWords = update.customWords;
        content.resetCustomDecks();
    }
    if (update && update.custom8Ball) {
        state_1.default.custom8Ball = update.custom8Ball;
    }
    if (update && update.customFortunes) {
        state_1.default.customFortunes = update.customFortunes;
    }
    state_1.default.roastModeEnabled = !!merged.roastMode;
    state_1.default.rageBaitEnabled = !!merged.rageBaitMode;
    state_1.default.roastTarget = merged.roastTarget || '';
    return getConfig();
}
function isEnabled() {
    return state_1.default.config.enabled && (state_1.default.openaiClient !== null || true);
}
function getConfig() {
    return {
        enabled: state_1.default.config.enabled,
        openaiModel: state_1.default.config.openaiModel,
        commandPrefix: state_1.default.config.commandPrefix,
        publicChatEnabled: state_1.default.config.publicChatEnabled,
        whisperEnabled: state_1.default.config.whisperEnabled,
        cooldownSeconds: state_1.default.config.cooldownSeconds,
        games: state_1.default.config.games,
        hasApiKey: !!process.env.OPENAI_API_KEY,
        customTrivia: state_1.default.customTrivia,
        customRiddles: state_1.default.customRiddles,
        customWords: state_1.default.customWords,
        custom8Ball: state_1.default.custom8Ball,
        customFortunes: state_1.default.customFortunes,
        roastMode: state_1.default.roastModeEnabled,
        rageBaitMode: state_1.default.rageBaitEnabled,
        roastTarget: state_1.default.roastTarget
    };
}
function saveConfig(update) {
    return applyConfigUpdate(update);
}
function getStats() {
    return {
        activeGameCount: state_1.default.activeGames.size,
        totalGamesPlayed: state_1.default.totalGamesPlayed,
        scoreboard: sm.getLeaderboard().slice(0, 20)
    };
}
// -- Message Handling --
function handlePublicMessage(sender, message) {
    if (!state_1.default.config.enabled || !state_1.default.config.publicChatEnabled)
        return;
    if (!sender || !message)
        return;
    if (state_1.default.getUsername && sender.toLowerCase() === state_1.default.getUsername().toLowerCase())
        return;
    const prefix = state_1.default.config.commandPrefix || '!';
    if (state_1.default.hostSession && state_1.default.hostSession.questionActive) {
        if (!message.startsWith(prefix)) {
            const handled = hostMode.handleHostAnswer(sender, message);
            if (handled)
                return;
        }
    }
    if (state_1.default.bjGroupSession && state_1.default.bjGroupSession.phase === 'playing') {
        if (!message.startsWith(prefix)) {
            const bjHandled = blackjack.handleGroupBjMessage(sender, message);
            if (bjHandled)
                return;
        }
    }
    if (message.startsWith(prefix)) {
        processCommand(sender, message, false);
    }
}
function handleWhisper(sender, message) {
    if (!state_1.default.config.enabled || !state_1.default.config.whisperEnabled)
        return false;
    if (!sender || !message)
        return false;
    if (state_1.default.getUsername && sender.toLowerCase() === state_1.default.getUsername().toLowerCase())
        return false;
    const prefix = state_1.default.config.commandPrefix || '!';
    if (message.startsWith(prefix)) {
        processCommand(sender, message, true);
        return true;
    }
    return handlePossibleAnswer(sender, message, true);
}
function handlePossibleAnswer(sender, message, isWhisper) {
    if (!state_1.default.config.enabled)
        return false;
    if (!sender || !message)
        return false;
    const prefix = state_1.default.config.commandPrefix || '!';
    if (message.startsWith(prefix))
        return false;
    const key = sender.toLowerCase();
    const session = state_1.default.activeGames.get(key);
    if (!session)
        return false;
    if (session.gameType !== 'blackjack' && session.isWhisper !== isWhisper)
        return false;
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
function parseCommand(message, prefix) {
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
function processCommand(sender, message, isWhisper) {
    const prefix = state_1.default.config.commandPrefix || '!';
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
    if (cmd === 'trivia' && state_1.default.config.games.trivia) {
        trivia.startTrivia(sender, isWhisper);
    }
    else if (cmd === 'riddle' && state_1.default.config.games.riddle) {
        trivia.startRiddle(sender, isWhisper);
    }
    else if ((cmd === '8ball' || cmd === 'eightball') && state_1.default.config.games.eightball) {
        eightball.handle8Ball(sender, args, isWhisper);
    }
    else if (cmd === 'scramble' && state_1.default.config.games.scramble) {
        scramble.startScramble(sender, isWhisper);
    }
    else if ((cmd === 'guess' || cmd === 'numberguess') && state_1.default.config.games.numberguess) {
        numberguess.startNumberGuess(sender, isWhisper);
    }
    else if (cmd === 'fortune' && state_1.default.config.games.fortune) {
        eightball.handleFortune(sender, isWhisper);
    }
    else if (cmd === 'rps' && state_1.default.config.games.rps) {
        rps.startRps(sender, isWhisper);
    }
    else if ((cmd === 'blackjack' || cmd === 'bj') && state_1.default.config.games.blackjack) {
        blackjack.startBlackjack(sender, isWhisper);
    }
    else if ((cmd === 'bjhost' || cmd === 'blackjackhost') && state_1.default.config.games.blackjack && !isWhisper) {
        blackjack.startBjLobby(sender, args);
    }
    else if (cmd === 'bjjoin' && state_1.default.config.games.blackjack && !isWhisper) {
        blackjack.joinBjLobby(sender);
    }
    else if (cmd === 'bjstart' && state_1.default.config.games.blackjack && !isWhisper) {
        blackjack.forceStartBj(sender);
    }
    else if (cmd === 'bjleave' && state_1.default.config.games.blackjack) {
        blackjack.leaveBj(sender, isWhisper);
    }
    else if (cmd === 'bjstop' && state_1.default.config.games.blackjack) {
        blackjack.stopBjGame(sender);
    }
    else if (cmd === 'bjstatus' && state_1.default.config.games.blackjack) {
        blackjack.showBjStatus(sender, isWhisper);
    }
    else if (cmd === 'hangman' && state_1.default.config.games.hangman) {
        hangman.startHangman(sender, isWhisper);
    }
    else if (cmd === 'bet' && state_1.default.config.games.blackjack) {
        if (state_1.default.bjGroupSession && state_1.default.bjGroupSession.phase === 'betting') {
            const betAmt = parseInt(args);
            if (!isNaN(betAmt))
                blackjack.bjGroupHandleBet(sender, betAmt);
        }
    }
}
// -- Help, Score, Leaderboard, Answer, Hint, GiveUp --
function showHelp(sender, isWhisper) {
    if (isWhisper) {
        const prefix = state_1.default.config.commandPrefix || '!';
        const lines = [
            'Chat Games: ' + prefix + 'trivia, ' + prefix + 'riddle, ' + prefix + '8ball <question>',
            prefix + 'scramble, ' + prefix + 'guess, ' + prefix + 'fortune, ' + prefix + 'rps',
            prefix + 'hangman, ' + prefix + 'bj (blackjack), ' + prefix + 'bjhost (group)',
            prefix + 'answer <text>, ' + prefix + 'hint, ' + prefix + 'giveup',
            prefix + 'score, ' + prefix + 'leaderboard'
        ];
        lines.forEach(function (line, i) {
            setTimeout(function () {
                state_1.default.sendWhisper(sender, line);
            }, i * 500);
        });
    }
    else {
        const p = state_1.default.config.commandPrefix || '!';
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
    const key = sender.toLowerCase();
    const stats = state_1.default.scoreboard.get(key);
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
        const gameNames = { trivia: 'Trivia', riddle: 'Riddle', scramble: 'Scramble', numberguess: 'Guess', rps: 'RPS', blackjack: 'BJ', hangman: 'Hangman' };
        const parts = [];
        for (const gt in gameNames) {
            const g = stats.byGame[gt];
            if (g && g.played > 0) {
                parts.push(gameNames[gt] + ' ' + g.wins + '/' + g.played);
            }
        }
        if (parts.length > 0) {
            const breakdown = parts.join(' | ');
            setTimeout(function () {
                state_1.default.sendWhisper(sender, breakdown);
            }, 500);
        }
    }
}
function showLeaderboard(sender, isWhisper, args) {
    let gameFilter = (args || '').trim().toLowerCase();
    if (gameFilter) {
        if (gameFilter === 'guess' || gameFilter === 'number')
            gameFilter = 'numberguess';
        if (state_1.default.GAME_TYPES.indexOf(gameFilter) === -1)
            gameFilter = '';
    }
    let board;
    let label = '';
    if (gameFilter) {
        board = sm.getLeaderboardByGame(gameFilter);
        const labels = { trivia: 'Trivia', riddle: 'Riddle', scramble: 'Scramble', numberguess: 'Guess', rps: 'RPS' };
        label = labels[gameFilter] || gameFilter;
    }
    else {
        board = [];
        state_1.default.scoreboard.forEach(function (val) { board.push(val); });
        board.sort(function (a, b) { return b.wins - a.wins; });
    }
    const top5 = board.slice(0, 5);
    if (top5.length === 0) {
        sm.sendGameResponse(sender, 'No ' + (label ? label + ' ' : '') + 'games played yet!', isWhisper);
        return;
    }
    if (isWhisper) {
        state_1.default.sendWhisper(sender, (label ? label + ' ' : '') + 'Top Players:');
        top5.forEach(function (p, i) {
            const rate = p.played > 0 ? Math.round(p.wins / p.played * 100) : 0;
            setTimeout(function () {
                state_1.default.sendWhisper(sender, (i + 1) + '. ' + p.name + ': ' + p.wins + 'W/' + ((p.played || 0) - (p.wins || 0)) + 'L (' + rate + '%)');
            }, (i + 1) * 400);
        });
    }
    else {
        let line = (label ? label + ' ' : '') + 'Top: ';
        top5.forEach(function (p, i) {
            if (i > 0)
                line += ', ';
            line += (i + 1) + '.' + p.name + ' ' + (p.wins || 0) + 'W';
        });
        if (line.length > 64)
            line = line.substring(0, 61) + '...';
        sm.sendGameResponse(sender, line, false);
    }
}
function handleAnswerCommand(sender, answer, isWhisper) {
    const key = sender.toLowerCase();
    const session = state_1.default.activeGames.get(key);
    if (!session) {
        const p = state_1.default.config.commandPrefix || '!';
        sm.sendGameResponse(sender, 'No active game. Try ' + p + 'trivia or ' + p + 'riddle', isWhisper);
        return;
    }
    if (session.gameType === 'trivia' || session.gameType === 'riddle') {
        trivia.checkAnswerFuzzy(session, answer);
    }
    else if (session.gameType === 'scramble') {
        scramble.checkAnswerExact(session, answer);
    }
    else if (session.gameType === 'numberguess') {
        numberguess.checkNumberGuess(session, answer);
    }
    else if (session.gameType === 'hangman') {
        hangman.handleHangmanGuess(session, answer);
    }
}
function handleHint(sender, isWhisper) {
    const key = sender.toLowerCase();
    const session = state_1.default.activeGames.get(key);
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
                state_1.default.sendWhisper(sender, 'Guessed: ' + guessed + ' | Lives: ' + (session.maxWrong - session.wrongCount));
            }, 500);
        }
        return;
    }
    sm.sendGameResponse(sender, 'Hint: ' + (session.hint || 'No hint available'), session.isWhisper);
}
function handleGiveUp(sender, isWhisper) {
    const key = sender.toLowerCase();
    const session = state_1.default.activeGames.get(key);
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
exports.handleEmote = rps.handleEmote;
exports.handlePublicChatForRoast = roast.handlePublicChatForRoast;
exports.getLeaderboard = sm.getLeaderboard;
exports.getLeaderboardByGame = sm.getLeaderboardByGame;
exports.clearLeaderboard = sm.clearLeaderboard;
exports.clearLeaderboardByGame = sm.clearLeaderboardByGame;
exports.getActiveGames = sm.getActiveGames;
exports.getHostStatus = hostMode.getHostStatus;
exports.getBjStatus = blackjack.getBjStatus;
function setScoreboardFromDB(map, total) {
    state_1.default.scoreboard = map;
    state_1.default.totalGamesPlayed = total;
}
function setConfigFromDB(chatGamesConfig) {
    if (chatGamesConfig) {
        applyConfigUpdate(chatGamesConfig);
    }
}
function startHostGame(gameType, rounds) {
    hostMode.handleHostStart('Panel', (gameType || 'trivia') + ' ' + (rounds || 5));
}
function stopHostGame() {
    hostMode.handleHostStop('Panel');
}
function skipHostRound() {
    hostMode.handleHostSkip('Panel');
}
//# sourceMappingURL=index.js.map