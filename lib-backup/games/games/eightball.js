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
exports.handle8Ball = handle8Ball;
exports.handleFortune = handleFortune;
// -- Magic 8-Ball & Fortune -----------------------------------------------
const state_1 = __importDefault(require("../state"));
const sm = __importStar(require("../session-manager"));
function handle8Ball(sender, question, isWhisper) {
    if (!question) {
        const p = state_1.default.config.commandPrefix || '!';
        sm.sendGameResponse(sender, 'Ask a question! e.g. ' + p + '8ball Will I win?', isWhisper);
        return;
    }
    sm.setCooldown(sender);
    const pool = state_1.default.custom8Ball.length > 0 ? state_1.default.custom8Ball : [
        'The gods say yes, Aisling.', 'The stars say no.', 'Ask again, young Aisling.',
        'The elements are unclear.', 'Danaan wills it so.', 'Chadul clouds my vision...',
        'It is certain, by Deoch.', 'Do not count on it.', 'Ceannlaidir nods approval.',
        'Sgrios frowns upon this path.', 'Glioca blesses this choice.', 'Luathas reveals: perhaps.'
    ];
    const answer = pool[Math.floor(Math.random() * pool.length)];
    sm.sendGameResponse(sender, '8-Ball: ' + answer, isWhisper);
    sm.emitActivity(sender, '8ball', 'asked');
}
function handleFortune(sender, isWhisper) {
    sm.setCooldown(sender);
    const pool = state_1.default.customFortunes.length > 0 ? state_1.default.customFortunes : [
        'The Dubhaimid stir... guard your path, Aisling.',
        'Danaan smiles upon you this moon.',
        'Seek the altar of Glioca for answers.',
        'The elements shift - Srad rises.',
        'An old power awakens beneath Mileth.',
        'Chadul whispers your name in the dark.',
        'The mundanes speak of your deeds.',
        'Trust the path of your element, Aisling.'
    ];
    const fortune = pool[Math.floor(Math.random() * pool.length)];
    sm.sendGameResponse(sender, 'Oracle: ' + fortune, isWhisper);
    sm.emitActivity(sender, 'fortune', 'told');
}
//# sourceMappingURL=eightball.js.map