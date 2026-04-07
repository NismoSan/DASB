"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitMessage = splitMessage;
exports.sendGameResponse = sendGameResponse;
exports.emitActivity = emitActivity;
exports.getActiveGames = getActiveGames;
exports.createSession = createSession;
exports.cancelSession = cancelSession;
exports.isOnCooldown = isOnCooldown;
exports.setCooldown = setCooldown;
exports.recordGame = recordGame;
exports.saveLeaderboard = saveLeaderboard;
exports.getLeaderboard = getLeaderboard;
exports.getLeaderboardByGame = getLeaderboardByGame;
exports.clearLeaderboard = clearLeaderboard;
exports.clearLeaderboardByGame = clearLeaderboardByGame;
exports.onCorrectAnswer = onCorrectAnswer;
exports.onWrongAnswer = onWrongAnswer;
// -- Session Management & Scoring -----------------------------------------
const state_1 = __importDefault(require("./state"));
// -- Message Sending --
function splitMessage(text, maxLen) {
    if (text.length <= maxLen)
        return [text];
    const chunks = [];
    while (text.length > 0) {
        if (text.length <= maxLen) {
            chunks.push(text);
            break;
        }
        let splitAt = text.lastIndexOf(' ', maxLen);
        if (splitAt <= 0)
            splitAt = maxLen;
        chunks.push(text.substring(0, splitAt));
        text = text.substring(splitAt).trim();
    }
    return chunks;
}
function sendGameResponse(playerName, text, isWhisper) {
    if (!text)
        return;
    if (isWhisper) {
        const whisperChunks = splitMessage(text, state_1.default.WHISPER_MAX);
        whisperChunks.forEach(function (chunk, i) {
            setTimeout(function () {
                if (state_1.default.sendWhisper)
                    state_1.default.sendWhisper(playerName, chunk);
            }, i * 500);
        });
    }
    else {
        // Stealth mode: whisper to player instead of public say
        // Only use public say for host-mode broadcasts (playerName is null)
        if (playerName) {
            const wChunks = splitMessage(text, state_1.default.WHISPER_MAX);
            wChunks.forEach(function (chunk, i) {
                setTimeout(function () {
                    if (state_1.default.sendWhisper)
                        state_1.default.sendWhisper(playerName, chunk);
                }, i * 500);
            });
        }
        else {
            // Host mode broadcast - keep as public say (Lancelot-only)
            const sayChunks = splitMessage(text, state_1.default.PUBLIC_SAY_MAX);
            sayChunks.forEach(function (chunk, i) {
                setTimeout(function () {
                    if (state_1.default.sendSay)
                        state_1.default.sendSay(chunk);
                }, i * 800);
            });
        }
    }
}
// -- Panel Activity --
function emitActivity(player, gameType, action) {
    if (state_1.default.ioRef) {
        state_1.default.ioRef.emit('chatgames:activity', {
            timestamp: Date.now(),
            player: player,
            gameType: gameType,
            action: action
        });
    }
}
// -- Active Games API --
function getActiveGames() {
    const list = [];
    state_1.default.activeGames.forEach(function (session) {
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
function createSession(playerName, gameType, isWhisper, gameData) {
    cancelSession(playerName);
    const timeouts = { trivia: 60000, riddle: 90000, scramble: 60000, numberguess: 120000, rps: 90000, hangman: 120000 };
    const timeout = timeouts[gameType] || 60000;
    const maxAttempts = gameData.maxAttempts || (gameType === 'numberguess' ? 10 : 3);
    const session = {
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
    state_1.default.activeGames.set(playerName.toLowerCase(), session);
    if (state_1.default.ioRef) {
        state_1.default.ioRef.emit('chatgames:sessionStart', {
            player: playerName,
            gameType: gameType,
            timestamp: Date.now()
        });
        state_1.default.ioRef.emit('chatgames:active', getActiveGames());
    }
    return session;
}
function cancelSession(playerName) {
    const key = playerName.toLowerCase();
    const session = state_1.default.activeGames.get(key);
    if (session) {
        clearTimeout(session.timeoutTimer);
        state_1.default.activeGames.delete(key);
        if (state_1.default.ioRef) {
            state_1.default.ioRef.emit('chatgames:sessionEnd', {
                player: playerName,
                gameType: session.gameType,
                timestamp: Date.now()
            });
            state_1.default.ioRef.emit('chatgames:active', getActiveGames());
        }
    }
}
function onSessionTimeout(playerName) {
    const key = playerName.toLowerCase();
    const session = state_1.default.activeGames.get(key);
    if (!session)
        return;
    sendGameResponse(playerName, 'Time up! Answer: ' + (session.answer || '???'), session.isWhisper);
    recordGame(playerName, false, session.gameType);
    cancelSession(playerName);
    emitActivity(playerName, session.gameType, 'timed out');
}
// -- Cooldown --
function isOnCooldown(playerName) {
    const key = playerName.toLowerCase();
    const last = state_1.default.playerCooldowns.get(key);
    if (!last)
        return false;
    return (Date.now() - last) < (state_1.default.config.cooldownSeconds || 10) * 1000;
}
function setCooldown(playerName) {
    state_1.default.playerCooldowns.set(playerName.toLowerCase(), Date.now());
}
// Periodic sweep of expired cooldown entries (every 5 min)
const _cooldownCleanupTimer = setInterval(function () {
    const now = Date.now();
    const maxAge = (state_1.default.config.cooldownSeconds || 10) * 1000;
    state_1.default.playerCooldowns.forEach(function (ts, key) {
        if (now - ts > maxAge)
            state_1.default.playerCooldowns.delete(key);
    });
}, 5 * 60 * 1000);
if (_cooldownCleanupTimer.unref)
    _cooldownCleanupTimer.unref();
// -- Scoring --
function recordGame(playerName, won, gameType) {
    const key = playerName.toLowerCase();
    const stats = state_1.default.scoreboard.get(key) || { name: playerName, wins: 0, played: 0, currentStreak: 0, bestStreak: 0 };
    stats.played++;
    if (won) {
        stats.wins++;
        stats.currentStreak = (stats.currentStreak || 0) + 1;
        if (stats.currentStreak > (stats.bestStreak || 0)) {
            stats.bestStreak = stats.currentStreak;
        }
    }
    else {
        stats.currentStreak = 0;
    }
    stats.name = playerName;
    if (gameType) {
        if (!stats.byGame)
            stats.byGame = {};
        if (!stats.byGame[gameType])
            stats.byGame[gameType] = { wins: 0, played: 0 };
        stats.byGame[gameType].played++;
        if (won)
            stats.byGame[gameType].wins++;
    }
    state_1.default.scoreboard.set(key, stats);
    state_1.default.totalGamesPlayed++;
    saveLeaderboard(playerName);
    if (state_1.default.ioRef)
        state_1.default.ioRef.emit('chatgames:leaderboard', getLeaderboard());
}
// -- Leaderboard --
function saveLeaderboard(updatedPlayerName) {
    if (state_1.default.dbRef && updatedPlayerName) {
        const key = updatedPlayerName.toLowerCase();
        const stats = state_1.default.scoreboard.get(key);
        if (stats) {
            state_1.default.dbRef.savePlayerScore(updatedPlayerName, stats);
        }
    }
}
function getLeaderboard() {
    const board = [];
    state_1.default.scoreboard.forEach(function (val) {
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
    board.sort(function (a, b) { return b.wins - a.wins; });
    return board;
}
function getLeaderboardByGame(gameType) {
    const board = [];
    state_1.default.scoreboard.forEach(function (val) {
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
    board.sort(function (a, b) { return b.wins - a.wins; });
    return board;
}
function clearLeaderboard() {
    state_1.default.scoreboard = new Map();
    state_1.default.totalGamesPlayed = 0;
    if (state_1.default.dbRef)
        state_1.default.dbRef.clearLeaderboard();
}
function clearLeaderboardByGame(gameType) {
    if (!gameType)
        return;
    state_1.default.scoreboard.forEach(function (stats, key) {
        if (stats.byGame && stats.byGame[gameType]) {
            const g = stats.byGame[gameType];
            stats.played = Math.max(0, (stats.played || 0) - (g.played || 0));
            stats.wins = Math.max(0, (stats.wins || 0) - (g.wins || 0));
            delete stats.byGame[gameType];
            stats.currentStreak = 0;
            stats.bestStreak = 0;
            state_1.default.scoreboard.set(key, stats);
            saveLeaderboard(stats.name);
        }
    });
    state_1.default.scoreboard.forEach(function (stats, key) {
        if (stats.played <= 0)
            state_1.default.scoreboard.delete(key);
    });
    state_1.default.totalGamesPlayed = 0;
    state_1.default.scoreboard.forEach(function (stats) { state_1.default.totalGamesPlayed += stats.played; });
}
// -- Answer Checking --
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
    }
    else {
        const remaining = (session.maxAttempts || 3) - session.attempts;
        const p = state_1.default.config.commandPrefix || '!';
        sendGameResponse(session.playerName, 'Wrong! ' + remaining + ' tries left. (' + p + 'hint)', session.isWhisper);
    }
}
//# sourceMappingURL=session-manager.js.map