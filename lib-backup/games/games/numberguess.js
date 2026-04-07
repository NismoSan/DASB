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
Object.defineProperty(exports, "__esModule", { value: true });
exports.startNumberGuess = startNumberGuess;
exports.checkNumberGuess = checkNumberGuess;
// -- Number Guessing Game -------------------------------------------------
const sm = __importStar(require("../session-manager"));
const content = __importStar(require("../content"));
function startNumberGuess(sender, isWhisper) {
    sm.setCooldown(sender);
    const data = content.generateNumberGuess();
    data.maxAttempts = 10;
    sm.createSession(sender, 'numberguess', isWhisper, data);
    sm.sendGameResponse(sender, 'I picked a number 1-100. Guess it!', isWhisper);
    sm.emitActivity(sender, 'numberguess', 'started');
}
function checkNumberGuess(session, playerAnswer) {
    const num = parseInt(playerAnswer.trim(), 10);
    if (isNaN(num))
        return;
    session.attempts++;
    if (num === session.targetNumber) {
        sm.sendGameResponse(session.playerName, 'Correct! The number was ' + session.targetNumber + ' (' + session.attempts + ' guesses)', session.isWhisper);
        sm.recordGame(session.playerName, true, 'numberguess');
        sm.cancelSession(session.playerName);
        sm.emitActivity(session.playerName, 'numberguess', 'won in ' + session.attempts);
    }
    else if (session.attempts >= session.maxAttempts) {
        sm.sendGameResponse(session.playerName, 'Out of guesses! It was ' + session.targetNumber, session.isWhisper);
        sm.recordGame(session.playerName, false, 'numberguess');
        sm.cancelSession(session.playerName);
        sm.emitActivity(session.playerName, 'numberguess', 'lost');
    }
    else if (num < session.targetNumber) {
        sm.sendGameResponse(session.playerName, 'Too low! (' + session.attempts + '/' + session.maxAttempts + ')', session.isWhisper);
    }
    else {
        sm.sendGameResponse(session.playerName, 'Too high! (' + session.attempts + '/' + session.maxAttempts + ')', session.isWhisper);
    }
}
//# sourceMappingURL=numberguess.js.map