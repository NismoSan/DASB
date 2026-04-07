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
exports.startHangman = startHangman;
exports.handleHangmanGuess = handleHangmanGuess;
// -- Hangman Game ---------------------------------------------------------
const state_1 = __importDefault(require("../state"));
const sm = __importStar(require("../session-manager"));
const content = __importStar(require("../content"));
function startHangman(sender, isWhisper) {
    sm.setCooldown(sender);
    content.generateHangman(function (_err, data) {
        sm.createSession(sender, 'hangman', isWhisper, data);
        const msg = 'Hangman: ' + data.question + ' (' + data.maxWrong + ' lives)';
        sm.sendGameResponse(sender, msg, isWhisper);
        if (isWhisper) {
            setTimeout(function () {
                state_1.default.sendWhisper(sender, 'Hint: ' + (data.hint || 'No hint'));
            }, 500);
        }
        sm.emitActivity(sender, 'hangman', 'started');
    });
}
function handleHangmanGuess(session, message) {
    const input = message.trim().toLowerCase();
    if (!input)
        return;
    // Full word guess
    if (input.length > 1) {
        if (input === session.answer.toLowerCase()) {
            sm.onCorrectAnswer(session);
        }
        else {
            session.wrongCount++;
            if (session.wrongCount >= session.maxWrong) {
                sm.sendGameResponse(session.playerName, 'Hanged! The word was: ' + session.answer, session.isWhisper);
                sm.recordGame(session.playerName, false, 'hangman');
                sm.cancelSession(session.playerName);
                sm.emitActivity(session.playerName, 'hangman', 'lost');
            }
            else {
                const lives = session.maxWrong - session.wrongCount;
                const revealed = content.buildRevealedWord(session.answer, session.guessedLetters);
                sm.sendGameResponse(session.playerName, 'Wrong word! ' + revealed + ' (' + lives + ' lives)', session.isWhisper);
            }
        }
        return;
    }
    // Single letter guess
    if (!/^[a-z]$/.test(input)) {
        sm.sendGameResponse(session.playerName, 'Letters only!', session.isWhisper);
        return;
    }
    if (session.guessedLetters.indexOf(input) !== -1) {
        sm.sendGameResponse(session.playerName, 'Already guessed [' + input + ']!', session.isWhisper);
        return;
    }
    session.guessedLetters.push(input);
    if (session.answer.toLowerCase().indexOf(input) !== -1) {
        const revealed = content.buildRevealedWord(session.answer, session.guessedLetters);
        if (revealed.indexOf('_') === -1) {
            sm.onCorrectAnswer(session);
        }
        else {
            const lives = session.maxWrong - session.wrongCount;
            sm.sendGameResponse(session.playerName, 'Hit! ' + revealed + ' (' + lives + ' lives)', session.isWhisper);
        }
    }
    else {
        session.wrongCount++;
        if (session.wrongCount >= session.maxWrong) {
            sm.sendGameResponse(session.playerName, 'Hanged! The word was: ' + session.answer, session.isWhisper);
            sm.recordGame(session.playerName, false, 'hangman');
            sm.cancelSession(session.playerName);
            sm.emitActivity(session.playerName, 'hangman', 'lost');
        }
        else {
            const lives = session.maxWrong - session.wrongCount;
            const revealed = content.buildRevealedWord(session.answer, session.guessedLetters);
            sm.sendGameResponse(session.playerName, 'Miss! ' + revealed + ' (' + lives + ' lives)', session.isWhisper);
        }
    }
}
//# sourceMappingURL=hangman.js.map