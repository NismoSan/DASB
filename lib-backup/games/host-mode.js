"use strict";
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
exports.handleHostStart = handleHostStart;
exports.handleHostStop = handleHostStop;
exports.handleHostSkip = handleHostSkip;
exports.handleHostAnswer = handleHostAnswer;
exports.getHostStatus = getHostStatus;
// -- Host Mode (Game Show) ------------------------------------------------
const state_1 = __importDefault(require("./state"));
const sm = __importStar(require("./session-manager"));
const content = __importStar(require("./content"));
const openai = __importStar(require("./openai"));
const HOST_INTROS = {
    trivia: [
        'Gather round, Aislings! Trivia hour begins!',
        'The oracle calls! Time for trivia!',
        'Step up, Aislings! Trivia challenge!',
        'Attention Temuair! Trivia time!'
    ],
    riddle: [
        'The sage speaks! Riddle hour begins!',
        'Gather round for riddles, Aislings!',
        'Who dares solve the sage\'s riddles?',
        'Riddle challenge begins, Aislings!'
    ],
    scramble: [
        'Unscramble if you can, Aislings!',
        'Word scramble challenge begins!',
        'Scramble hour! Test your wit!',
        'Letters await! Scramble time, Aislings!'
    ],
    numberguess: [
        'Guess the number, Aislings!',
        'Number challenge begins!',
        'Think fast! Number guessing time!',
        'Can you guess it? Game on, Aislings!'
    ],
    hangman: [
        'Hangman begins! Guess the letters, Aislings!',
        'The gallows await! Hangman time!',
        'Save the Aisling! Hangman challenge!',
        'Letter by letter! Hangman starts now!'
    ]
};
function handleHostStart(sender, args) {
    if (state_1.default.hostSession) {
        const p = state_1.default.config.commandPrefix || '!';
        if (state_1.default.sendWhisper)
            state_1.default.sendWhisper(sender, 'A hosted game is already running. Use ' + p + 'hoststop first.');
        return;
    }
    const parts = args.trim().split(/\s+/);
    const gameType = (parts[0] || 'trivia').toLowerCase();
    let rounds = parseInt(parts[1]) || 5;
    if (['trivia', 'riddle', 'scramble', 'numberguess', 'hangman'].indexOf(gameType) === -1) {
        if (state_1.default.sendWhisper)
            state_1.default.sendWhisper(sender, 'Valid types: trivia, riddle, scramble, numberguess, hangman');
        return;
    }
    if (rounds < 1)
        rounds = 1;
    if (rounds > 20)
        rounds = 20;
    state_1.default.hostSession = {
        gameType: gameType,
        totalRounds: rounds,
        currentRound: 0,
        hostPlayer: sender,
        leaderboard: new Map(),
        currentQuestion: null,
        questionActive: false,
        timeoutTimer: null,
        roundTimer: null,
        delayBetweenRounds: state_1.default.HOST_DELAY_BETWEEN
    };
    const intros = HOST_INTROS[gameType] || HOST_INTROS.trivia;
    const intro = intros[Math.floor(Math.random() * intros.length)];
    if (state_1.default.sendWhisper)
        state_1.default.sendWhisper(sender, 'Starting ' + rounds + ' rounds of ' + gameType + '!');
    sm.sendGameResponse(null, intro, false);
    setTimeout(function () {
        sm.sendGameResponse(null, rounds + ' rounds of ' + gameType + '! First to answer wins!', false);
    }, 1200);
    sm.emitActivity(sender, 'host-' + gameType, 'started ' + rounds + ' rounds');
    if (state_1.default.ioRef)
        state_1.default.ioRef.emit('chatgames:hostUpdate', getHostStatus());
    setTimeout(function () {
        hostNextRound();
    }, 3000);
}
function handleHostStop(sender) {
    if (!state_1.default.hostSession) {
        if (state_1.default.sendWhisper)
            state_1.default.sendWhisper(sender, 'No hosted game is running.');
        return;
    }
    sm.sendGameResponse(null, 'Game over! The host has ended the game.', false);
    hostShowFinalLeaderboard();
    sm.emitActivity(sender, 'host', 'stopped the game');
    hostCleanup();
}
function handleHostSkip(sender) {
    if (!state_1.default.hostSession) {
        if (state_1.default.sendWhisper)
            state_1.default.sendWhisper(sender, 'No hosted game is running.');
        return;
    }
    if (state_1.default.hostSession.questionActive && state_1.default.hostSession.currentQuestion) {
        sm.sendGameResponse(null, 'Skipped! Answer: ' + state_1.default.hostSession.currentQuestion.answer, false);
        state_1.default.hostSession.questionActive = false;
        clearTimeout(state_1.default.hostSession.timeoutTimer);
        sm.emitActivity(sender, 'host', 'skipped round ' + state_1.default.hostSession.currentRound);
        setTimeout(function () { hostNextRound(); }, 2000);
    }
    else {
        if (state_1.default.sendWhisper)
            state_1.default.sendWhisper(sender, 'No active question to skip.');
    }
}
function hostNextRound() {
    if (!state_1.default.hostSession)
        return;
    state_1.default.hostSession.currentRound++;
    if (state_1.default.hostSession.currentRound > state_1.default.hostSession.totalRounds) {
        const finishedHost = state_1.default.hostSession.hostPlayer;
        const finishedType = state_1.default.hostSession.gameType;
        sm.sendGameResponse(null, 'Final round complete! Here are the results:', false);
        setTimeout(function () {
            hostShowFinalLeaderboard();
            sm.emitActivity(finishedHost, 'host-' + finishedType, 'finished all rounds');
            hostCleanup();
        }, 1500);
        return;
    }
    const roundLabel = 'Round ' + state_1.default.hostSession.currentRound + '/' + state_1.default.hostSession.totalRounds;
    if (state_1.default.hostSession.gameType === 'trivia') {
        hostGenerateTrivia(roundLabel);
    }
    else if (state_1.default.hostSession.gameType === 'riddle') {
        hostGenerateRiddle(roundLabel);
    }
    else if (state_1.default.hostSession.gameType === 'scramble') {
        hostGenerateScramble(roundLabel);
    }
    else if (state_1.default.hostSession.gameType === 'numberguess') {
        hostGenerateNumberGuess(roundLabel);
    }
    else if (state_1.default.hostSession.gameType === 'hangman') {
        hostGenerateHangman(roundLabel);
    }
}
function hostGenerateTrivia(roundLabel) {
    content.generateTrivia(50, function (_err, data) {
        hostSetQuestion(roundLabel, data.question, data.answer, data.hint);
    });
}
function hostGenerateRiddle(roundLabel) {
    content.generateRiddle(50, function (_err, data) {
        hostSetQuestion(roundLabel, data.question, data.answer, data.hint);
    });
}
function hostGenerateScramble(roundLabel) {
    content.generateScramble(function (_err, data) {
        hostSetQuestion(roundLabel, data.question, data.answer, data.hint);
    });
}
function hostGenerateNumberGuess(roundLabel) {
    state_1.default.hostAnswerQueue = [];
    state_1.default.hostAnswerProcessing = false;
    const data = content.generateNumberGuess();
    state_1.default.hostSession.currentQuestion = {
        question: '1-100',
        answer: data.answer,
        hint: data.hint,
        targetNumber: data.targetNumber,
        guessHigh: 100,
        guessLow: 1
    };
    state_1.default.hostSession.questionActive = true;
    sm.sendGameResponse(null, roundLabel + ': I picked a number 1-100!', false);
    setTimeout(function () {
        sm.sendGameResponse(null, 'Type your guess! Exact number wins!', false);
    }, 800);
    state_1.default.hostSession.timeoutTimer = setTimeout(function () {
        hostRoundTimeout();
    }, state_1.default.HOST_ROUND_TIMEOUT);
    if (state_1.default.ioRef)
        state_1.default.ioRef.emit('chatgames:hostUpdate', getHostStatus());
    sm.emitActivity('Host', 'host-numberguess', roundLabel);
}
function hostGenerateHangman(roundLabel) {
    content.generateHangman(function (_err, data) {
        state_1.default.hostAnswerQueue = [];
        state_1.default.hostAnswerProcessing = false;
        state_1.default.hostSession.currentQuestion = {
            question: data.question,
            answer: data.answer,
            hint: data.hint,
            guessedLetters: [],
            wrongCount: 0,
            maxWrong: 6,
            revealedWord: data.question
        };
        state_1.default.hostSession.questionActive = true;
        sm.sendGameResponse(null, roundLabel + ' Hangman: ' + data.question, false);
        setTimeout(function () {
            sm.sendGameResponse(null, 'Guess a letter! (' + (data.hint || 'No hint') + ')', false);
        }, 800);
        state_1.default.hostSession.timeoutTimer = setTimeout(function () {
            hostRoundTimeout();
        }, state_1.default.HOST_ROUND_TIMEOUT * 2);
        if (state_1.default.ioRef)
            state_1.default.ioRef.emit('chatgames:hostUpdate', getHostStatus());
        sm.emitActivity('Host', 'host-hangman', roundLabel);
    });
}
function hostSetQuestion(roundLabel, question, answer, hint) {
    if (!state_1.default.hostSession)
        return;
    state_1.default.hostAnswerQueue = [];
    state_1.default.hostAnswerProcessing = false;
    state_1.default.hostSession.currentQuestion = {
        question: question,
        answer: answer,
        hint: hint || 'No hint'
    };
    state_1.default.hostSession.questionActive = true;
    const prefix = state_1.default.hostSession.gameType === 'scramble' ? 'Unscramble' : (state_1.default.hostSession.gameType === 'riddle' ? 'Riddle' : 'Q');
    sm.sendGameResponse(null, roundLabel + ' ' + prefix + ': ' + question, false);
    state_1.default.hostSession.timeoutTimer = setTimeout(function () {
        hostRoundTimeout();
    }, state_1.default.HOST_ROUND_TIMEOUT);
    if (state_1.default.ioRef)
        state_1.default.ioRef.emit('chatgames:hostUpdate', getHostStatus());
    sm.emitActivity('Host', 'host-' + state_1.default.hostSession.gameType, roundLabel);
}
function handleHostAnswer(sender, message) {
    if (!state_1.default.hostSession || !state_1.default.hostSession.questionActive || !state_1.default.hostSession.currentQuestion)
        return false;
    if (state_1.default.hostSession.gameType === 'numberguess') {
        const num = parseInt(message.trim(), 10);
        if (isNaN(num) || num < 1 || num > 100)
            return false;
    }
    if (state_1.default.hostSession.gameType === 'hangman') {
        if (!/^[a-z]+$/i.test(message.trim()))
            return false;
    }
    state_1.default.hostAnswerQueue.push({ sender: sender, message: message });
    if (!state_1.default.hostAnswerProcessing) {
        processNextAnswer();
    }
    return true;
}
function processNextAnswer() {
    if (state_1.default.hostAnswerQueue.length === 0) {
        state_1.default.hostAnswerProcessing = false;
        return;
    }
    if (!state_1.default.hostSession || !state_1.default.hostSession.questionActive || !state_1.default.hostSession.currentQuestion) {
        state_1.default.hostAnswerQueue = [];
        state_1.default.hostAnswerProcessing = false;
        return;
    }
    state_1.default.hostAnswerProcessing = true;
    const entry = state_1.default.hostAnswerQueue.shift();
    const gameType = state_1.default.hostSession.gameType;
    if (gameType === 'numberguess') {
        processNumberGuessEntry(entry);
    }
    else if (gameType === 'scramble') {
        processScrambleEntry(entry);
    }
    else if (gameType === 'hangman') {
        processHangmanEntry(entry);
    }
    else {
        processTriviaRiddleEntry(entry);
    }
}
function processNumberGuessEntry(entry) {
    const num = parseInt(entry.message.trim(), 10);
    const target = state_1.default.hostSession.currentQuestion.targetNumber;
    if (num === target) {
        state_1.default.hostAnswerQueue = [];
        state_1.default.hostAnswerProcessing = false;
        hostRoundWon(entry.sender);
        return;
    }
    if (num < target) {
        sm.sendGameResponse(null, entry.sender + ' guessed ' + num + ' - too low!', false);
    }
    else {
        sm.sendGameResponse(null, entry.sender + ' guessed ' + num + ' - too high!', false);
    }
    setTimeout(function () { processNextAnswer(); }, 1200);
}
function processScrambleEntry(entry) {
    const playerText = entry.message.trim().toLowerCase();
    const correctAnswer = state_1.default.hostSession.currentQuestion.answer.toLowerCase();
    if (playerText === correctAnswer) {
        state_1.default.hostAnswerQueue = [];
        state_1.default.hostAnswerProcessing = false;
        hostRoundWon(entry.sender);
        return;
    }
    setTimeout(function () { processNextAnswer(); }, 400);
}
function processHangmanEntry(entry) {
    if (!state_1.default.hostSession || !state_1.default.hostSession.questionActive || !state_1.default.hostSession.currentQuestion) {
        state_1.default.hostAnswerQueue = [];
        state_1.default.hostAnswerProcessing = false;
        return;
    }
    const q = state_1.default.hostSession.currentQuestion;
    const input = entry.message.trim().toLowerCase();
    if (input.length > 1) {
        if (input === q.answer.toLowerCase()) {
            state_1.default.hostAnswerQueue = [];
            state_1.default.hostAnswerProcessing = false;
            hostRoundWon(entry.sender);
            return;
        }
        q.wrongCount++;
        if (q.wrongCount >= q.maxWrong) {
            state_1.default.hostSession.questionActive = false;
            clearTimeout(state_1.default.hostSession.timeoutTimer);
            sm.sendGameResponse(null, 'Hanged! The word was: ' + q.answer, false);
            state_1.default.hostAnswerQueue = [];
            state_1.default.hostAnswerProcessing = false;
            state_1.default.hostSession.roundTimer = setTimeout(function () { hostNextRound(); }, state_1.default.HOST_DELAY_BETWEEN);
            return;
        }
        sm.sendGameResponse(null, entry.sender + ' wrong word! (' + (q.maxWrong - q.wrongCount) + ' lives)', false);
        setTimeout(function () { processNextAnswer(); }, 800);
        return;
    }
    if (input.length === 1 && /^[a-z]$/.test(input)) {
        if (q.guessedLetters.indexOf(input) !== -1) {
            setTimeout(function () { processNextAnswer(); }, 100);
            return;
        }
        q.guessedLetters.push(input);
        if (q.answer.toLowerCase().indexOf(input) !== -1) {
            q.revealedWord = content.buildRevealedWord(q.answer, q.guessedLetters);
            if (q.revealedWord.indexOf('_') === -1) {
                state_1.default.hostAnswerQueue = [];
                state_1.default.hostAnswerProcessing = false;
                hostRoundWon(entry.sender);
                return;
            }
            sm.sendGameResponse(null, entry.sender + ' found [' + input + ']! ' + q.revealedWord, false);
        }
        else {
            q.wrongCount++;
            if (q.wrongCount >= q.maxWrong) {
                state_1.default.hostSession.questionActive = false;
                clearTimeout(state_1.default.hostSession.timeoutTimer);
                sm.sendGameResponse(null, 'Hanged! The word was: ' + q.answer, false);
                state_1.default.hostAnswerQueue = [];
                state_1.default.hostAnswerProcessing = false;
                state_1.default.hostSession.roundTimer = setTimeout(function () { hostNextRound(); }, state_1.default.HOST_DELAY_BETWEEN);
                return;
            }
            sm.sendGameResponse(null, entry.sender + ' miss [' + input + ']! ' + q.revealedWord + ' (' + (q.maxWrong - q.wrongCount) + ' lives)', false);
        }
    }
    setTimeout(function () { processNextAnswer(); }, 800);
}
function processTriviaRiddleEntry(entry) {
    if (!state_1.default.hostSession || !state_1.default.hostSession.questionActive || !state_1.default.hostSession.currentQuestion) {
        state_1.default.hostAnswerQueue = [];
        state_1.default.hostAnswerProcessing = false;
        return;
    }
    const answer = state_1.default.hostSession.currentQuestion.answer;
    const playerText = entry.message.trim().toLowerCase();
    const correctAnswer = answer.toLowerCase();
    if (playerText === correctAnswer) {
        state_1.default.hostAnswerQueue = [];
        state_1.default.hostAnswerProcessing = false;
        hostRoundWon(entry.sender);
        return;
    }
    openai.callOpenAIJson('You are judging a trivia/riddle answer. The correct answer is "' + answer + '". The player answered "' + entry.message.trim() + '". Is this close enough to be correct (allowing typos, synonyms)? Return ONLY valid JSON: {"correct":true or false}', 'Judge this answer.').then(function (result) {
        if (!state_1.default.hostSession || !state_1.default.hostSession.questionActive) {
            state_1.default.hostAnswerQueue = [];
            state_1.default.hostAnswerProcessing = false;
            return;
        }
        if (result.correct) {
            state_1.default.hostAnswerQueue = [];
            state_1.default.hostAnswerProcessing = false;
            hostRoundWon(entry.sender);
        }
        else {
            setTimeout(function () { processNextAnswer(); }, 400);
        }
    }).catch(function () {
        if (!state_1.default.hostSession || !state_1.default.hostSession.questionActive) {
            state_1.default.hostAnswerQueue = [];
            state_1.default.hostAnswerProcessing = false;
            return;
        }
        if (correctAnswer.indexOf(playerText) === 0 || playerText.indexOf(correctAnswer) === 0) {
            state_1.default.hostAnswerQueue = [];
            state_1.default.hostAnswerProcessing = false;
            hostRoundWon(entry.sender);
        }
        else {
            setTimeout(function () { processNextAnswer(); }, 400);
        }
    });
}
function hostRoundWon(winner) {
    if (!state_1.default.hostSession || !state_1.default.hostSession.questionActive)
        return;
    state_1.default.hostSession.questionActive = false;
    clearTimeout(state_1.default.hostSession.timeoutTimer);
    const key = winner.toLowerCase();
    const entry = state_1.default.hostSession.leaderboard.get(key) || { name: winner, points: 0 };
    entry.points++;
    entry.name = winner;
    state_1.default.hostSession.leaderboard.set(key, entry);
    const answer = state_1.default.hostSession.currentQuestion ? state_1.default.hostSession.currentQuestion.answer : '???';
    sm.sendGameResponse(null, winner + ' got it! Answer: ' + answer + ' (+1 pt)', false);
    sm.emitActivity(winner, 'host-' + state_1.default.hostSession.gameType, 'won round ' + state_1.default.hostSession.currentRound);
    sm.recordGame(winner, true, state_1.default.hostSession.gameType);
    if (state_1.default.ioRef)
        state_1.default.ioRef.emit('chatgames:hostUpdate', getHostStatus());
    setTimeout(function () {
        hostNextRound();
    }, state_1.default.hostSession.delayBetweenRounds);
}
function hostRoundTimeout() {
    if (!state_1.default.hostSession || !state_1.default.hostSession.questionActive)
        return;
    state_1.default.hostAnswerQueue = [];
    state_1.default.hostAnswerProcessing = false;
    state_1.default.hostSession.questionActive = false;
    const answer = state_1.default.hostSession.currentQuestion ? state_1.default.hostSession.currentQuestion.answer : '???';
    sm.sendGameResponse(null, 'Time up! Answer: ' + answer, false);
    sm.emitActivity('Host', 'host-' + state_1.default.hostSession.gameType, 'round ' + state_1.default.hostSession.currentRound + ' timed out');
    if (state_1.default.ioRef)
        state_1.default.ioRef.emit('chatgames:hostUpdate', getHostStatus());
    setTimeout(function () {
        hostNextRound();
    }, state_1.default.hostSession.delayBetweenRounds);
}
function hostShowFinalLeaderboard() {
    if (!state_1.default.hostSession)
        return;
    const board = [];
    state_1.default.hostSession.leaderboard.forEach(function (entry) {
        board.push(entry);
    });
    board.sort(function (a, b) { return b.points - a.points; });
    if (board.length === 0) {
        sm.sendGameResponse(null, 'No one scored! Better luck next time.', false);
        return;
    }
    setTimeout(function () {
        sm.sendGameResponse(null, 'Winner: ' + board[0].name + ' with ' + board[0].points + ' pts!', false);
    }, 800);
    if (board.length > 1) {
        setTimeout(function () {
            const lines = [];
            for (let i = 0; i < Math.min(board.length, 3); i++) {
                lines.push((i + 1) + '. ' + board[i].name + ' - ' + board[i].points);
            }
            sm.sendGameResponse(null, lines.join(' | '), false);
        }, 2400);
    }
}
function hostCleanup() {
    if (!state_1.default.hostSession)
        return;
    clearTimeout(state_1.default.hostSession.timeoutTimer);
    clearTimeout(state_1.default.hostSession.roundTimer);
    state_1.default.hostSession = null;
    state_1.default.hostAnswerQueue = [];
    state_1.default.hostAnswerProcessing = false;
    if (state_1.default.ioRef)
        state_1.default.ioRef.emit('chatgames:hostUpdate', getHostStatus());
}
function getHostStatus() {
    if (!state_1.default.hostSession) {
        return { active: false };
    }
    const board = [];
    state_1.default.hostSession.leaderboard.forEach(function (entry) {
        board.push(entry);
    });
    board.sort(function (a, b) { return b.points - a.points; });
    return {
        active: true,
        gameType: state_1.default.hostSession.gameType,
        currentRound: state_1.default.hostSession.currentRound,
        totalRounds: state_1.default.hostSession.totalRounds,
        hostPlayer: state_1.default.hostSession.hostPlayer,
        questionActive: state_1.default.hostSession.questionActive,
        currentQuestion: state_1.default.hostSession.questionActive ? (state_1.default.hostSession.currentQuestion ? state_1.default.hostSession.currentQuestion.question : '') : '',
        leaderboard: board
    };
}
//# sourceMappingURL=host-mode.js.map