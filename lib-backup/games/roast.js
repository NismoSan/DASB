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
exports.handlePublicChatForRoast = handlePublicChatForRoast;
// -- Roast / Rage Bait Mode -----------------------------------------------
const state_1 = __importDefault(require("./state"));
const sm = __importStar(require("./session-manager"));
const openai = __importStar(require("./openai"));
const content = __importStar(require("./content"));
function addToChatHistory(sender, message) {
    state_1.default.chatHistoryBuffer.push({
        sender: sender,
        message: message,
        timestamp: Date.now()
    });
    while (state_1.default.chatHistoryBuffer.length > state_1.default.MAX_CHAT_HISTORY) {
        state_1.default.chatHistoryBuffer.shift();
    }
}
function handleRoastOrRageBait(sender, message) {
    if (!state_1.default.roastModeEnabled && !state_1.default.rageBaitEnabled)
        return;
    if (!sender || !message)
        return;
    if (state_1.default.getUsername && sender.toLowerCase() === state_1.default.getUsername().toLowerCase())
        return;
    if (state_1.default.roastTarget && sender.toLowerCase() !== state_1.default.roastTarget.toLowerCase())
        return;
    const now = Date.now();
    if (now - state_1.default.lastRoastTime < state_1.default.ROAST_COOLDOWN)
        return;
    const contextLines = state_1.default.chatHistoryBuffer.slice(-10).map(function (entry) {
        return entry.sender + ': ' + entry.message;
    }).join('\n');
    const mode = state_1.default.roastModeEnabled ? 'roast' : 'ragebait';
    let systemPrompt;
    if (mode === 'roast') {
        systemPrompt = 'You are a witty Aisling in the world of Dark Ages (Temuair). Someone just spoke in public chat. Roast them humorously based on their name and what they said. Be funny, not cruel. Use Dark Ages references (classes, elements, towns, gods). Keep it under 55 characters. Do not use quotes. Recent chat for context:\n' + contextLines;
    }
    else {
        systemPrompt = 'You are a provocative Aisling in the world of Dark Ages (Temuair). Someone just spoke in public chat. Give a playful rage-bait response designed to get a reaction, based on their name and what they said. Be provocative but not hateful. Use Dark Ages references. Keep it under 55 characters. Do not use quotes. Recent chat for context:\n' + contextLines;
    }
    state_1.default.lastRoastTime = now;
    openai.callOpenAI(systemPrompt, content.sanitizeName(sender) + ' says: ' + message.replace(/["\n\r]/g, ' ').substring(0, 100))
        .then(function (response) {
        const text = response.substring(0, state_1.default.WHISPER_MAX);
        if (state_1.default.sendWhisper)
            state_1.default.sendWhisper(sender, text);
        sm.emitActivity(sender, mode, 'responded to ' + sender);
    })
        .catch(function () {
        const fallbackRoasts = [
            sender + ' speaks, yet says nothing.',
            'Even a Kobold has better takes, ' + sender + '.',
            sender + ' must be lost from Mileth.',
            'Did a Dubhaimid write that, ' + sender + '?',
            'Sgrios called, ' + sender + '. He wants you back.'
        ];
        const fallbackBaits = [
            sender + ', warriors hit harder than your words.',
            'Imagine being from Abel and saying that.',
            sender + ' clearly never passed Mileth.',
            'Is that the best Temuair has, ' + sender + '?',
            sender + ', even mundanes disagree.'
        ];
        const pool = mode === 'roast' ? fallbackRoasts : fallbackBaits;
        const text = pool[Math.floor(Math.random() * pool.length)];
        if (state_1.default.sendWhisper)
            state_1.default.sendWhisper(sender, text.substring(0, state_1.default.WHISPER_MAX));
    });
}
function handlePublicChatForRoast(sender, message) {
    addToChatHistory(sender, message);
    handleRoastOrRageBait(sender, message);
}
//# sourceMappingURL=roast.js.map