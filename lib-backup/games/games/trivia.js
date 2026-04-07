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
exports.startTrivia = startTrivia;
exports.startRiddle = startRiddle;
exports.checkAnswerFuzzy = checkAnswerFuzzy;
const sm = __importStar(require("../session-manager"));
const content = __importStar(require("../content"));
const openai = __importStar(require("../openai"));
function startTrivia(sender, isWhisper) {
    sm.setCooldown(sender);
    const charLimit = isWhisper ? 200 : 55;
    content.generateTrivia(charLimit, function (_err, data) {
        sm.createSession(sender, 'trivia', isWhisper, data);
        sm.sendGameResponse(sender, 'Trivia: ' + data.question, isWhisper);
        sm.emitActivity(sender, 'trivia', 'started');
    });
}
function startRiddle(sender, isWhisper) {
    sm.setCooldown(sender);
    const charLimit = isWhisper ? 200 : 55;
    content.generateRiddle(charLimit, function (_err, data) {
        sm.createSession(sender, 'riddle', isWhisper, data);
        sm.sendGameResponse(sender, 'Riddle: ' + data.question, isWhisper);
        sm.emitActivity(sender, 'riddle', 'started');
    });
}
function checkAnswerFuzzy(session, playerAnswer) {
    if (!playerAnswer || !playerAnswer.trim())
        return;
    if (session.answerProcessing)
        return;
    session.answerProcessing = true;
    session.attempts++;
    if (playerAnswer.trim().toLowerCase() === session.answer.toLowerCase()) {
        sm.onCorrectAnswer(session);
        return;
    }
    openai.callOpenAIJson('You are judging a trivia/riddle answer. The correct answer is "' + session.answer + '". The player answered "' + playerAnswer.trim() + '". Is this close enough to be correct (allowing for typos, synonyms, abbreviations)? Return ONLY valid JSON: {"correct":true or false}', 'Judge this answer.').then(function (result) {
        if (result.correct) {
            sm.onCorrectAnswer(session);
        }
        else {
            sm.onWrongAnswer(session);
        }
    }).catch(function () {
        const a = session.answer.toLowerCase().trim();
        const p = playerAnswer.toLowerCase().trim();
        if (p === a || a.indexOf(p) === 0 || p.indexOf(a) === 0) {
            sm.onCorrectAnswer(session);
        }
        else {
            sm.onWrongAnswer(session);
        }
    });
}
//# sourceMappingURL=trivia.js.map