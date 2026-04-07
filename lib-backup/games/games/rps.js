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
exports.startRps = startRps;
exports.handleEmote = handleEmote;
exports.handleRpsAnswer = handleRpsAnswer;
// -- Rock Paper Scissors Game ---------------------------------------------
const state_1 = __importDefault(require("../state"));
const sm = __importStar(require("../session-manager"));
const RPS_CHOICES = ['rock', 'paper', 'scissors'];
const RPS_EMOTES = { rock: 0x0E, scissors: 0x0F, paper: 0x10 };
const RPS_BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
const RPS_ANIM_TO_CHOICE = { 0x17: 'rock', 0x18: 'scissors', 0x19: 'paper' };
function startRps(sender, isWhisper) {
    sm.setCooldown(sender);
    const botChoice = RPS_CHOICES[Math.floor(Math.random() * 3)];
    const session = sm.createSession(sender, 'rps', isWhisper, {
        question: 'RPS',
        answer: botChoice,
        hint: 'rock, paper, or scissors'
    });
    session.botChoice = botChoice;
    session.playerWins = 0;
    session.botWins = 0;
    session.currentRound = 1;
    const prompt = isWhisper ? 'RPS! Best 2 of 3. Round 1 - type rock, paper, or scissors!' : 'RPS! Best 2 of 3. Round 1 - do your emote!';
    sm.sendGameResponse(sender, prompt, isWhisper);
    sm.emitActivity(sender, 'rps', 'started');
}
function handleEmote(senderName, bodyAnimId) {
    if (!state_1.default.config.enabled || !state_1.default.config.games.rps)
        return;
    const choice = RPS_ANIM_TO_CHOICE[bodyAnimId];
    if (!choice)
        return;
    const key = senderName.toLowerCase();
    const session = state_1.default.activeGames.get(key);
    if (!session || session.gameType !== 'rps')
        return;
    handleRpsRound(session, choice);
}
function handleRpsAnswer(session, message) {
    const choice = message.trim().toLowerCase();
    if (RPS_CHOICES.indexOf(choice) === -1)
        return;
    handleRpsRound(session, choice);
}
function handleRpsRound(session, choice) {
    if (session.roundLocked)
        return;
    session.roundLocked = true;
    const botChoice = session.botChoice;
    const playerName = session.playerName;
    const whisper = session.isWhisper;
    if (!whisper && state_1.default.sendEmote)
        state_1.default.sendEmote(RPS_EMOTES[botChoice]);
    if (choice === botChoice) {
        session.botChoice = RPS_CHOICES[Math.floor(Math.random() * 3)];
        setTimeout(function () {
            sm.sendGameResponse(playerName, 'We both chose ' + botChoice + '! Draw! Go again.', whisper);
            setTimeout(function () {
                session.roundLocked = false;
            }, 300);
        }, 800);
        return;
    }
    const playerWon = RPS_BEATS[choice] === botChoice;
    if (playerWon) {
        session.playerWins++;
    }
    else {
        session.botWins++;
    }
    let roundMsg = choice + ' vs ' + botChoice + ' - ';
    if (playerWon) {
        roundMsg += 'You win this round!';
    }
    else {
        roundMsg += 'I win this round!';
    }
    const score = ' (' + playerName + ' ' + session.playerWins + '-' + session.botWins + ')';
    setTimeout(function () {
        sm.sendGameResponse(playerName, 'R' + session.currentRound + ': ' + roundMsg + score, whisper);
        if (session.playerWins >= 2) {
            setTimeout(function () {
                sm.sendGameResponse(playerName, playerName + ' wins the match! GG!', whisper);
                sm.recordGame(playerName, true, 'rps');
                sm.cancelSession(playerName);
                sm.emitActivity(playerName, 'rps', 'won the match');
            }, 800);
        }
        else if (session.botWins >= 2) {
            setTimeout(function () {
                sm.sendGameResponse(playerName, 'I win the match! Better luck next time.', whisper);
                sm.recordGame(playerName, false, 'rps');
                sm.cancelSession(playerName);
                sm.emitActivity(playerName, 'rps', 'lost the match');
            }, 800);
        }
        else {
            session.currentRound++;
            session.botChoice = RPS_CHOICES[Math.floor(Math.random() * 3)];
            const nextPrompt = whisper ? 'Round ' + session.currentRound + ' - type rock, paper, or scissors!' : 'Round ' + session.currentRound + ' - do your emote!';
            setTimeout(function () {
                sm.sendGameResponse(playerName, nextPrompt, whisper);
                session.roundLocked = false;
            }, 800);
        }
    }, 800);
}
//# sourceMappingURL=rps.js.map