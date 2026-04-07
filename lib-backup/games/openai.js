"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initOpenAI = initOpenAI;
exports.callOpenAI = callOpenAI;
exports.callOpenAIJson = callOpenAIJson;
// -- OpenAI Helpers -------------------------------------------------------
const openai_1 = __importDefault(require("openai"));
const state_1 = __importDefault(require("./state"));
function initOpenAI() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        state_1.default.openaiClient = null;
        return false;
    }
    state_1.default.openaiClient = new openai_1.default({ apiKey: apiKey, timeout: 15000 });
    return true;
}
function callOpenAI(systemPrompt, userPrompt) {
    if (!state_1.default.openaiClient) {
        return Promise.reject(new Error('OpenAI not initialized'));
    }
    const now = Date.now();
    const delay = Math.max(0, state_1.default.MIN_OPENAI_INTERVAL - (now - state_1.default.lastOpenAICall));
    return new Promise(function (resolve) {
        setTimeout(resolve, delay);
    }).then(function () {
        state_1.default.lastOpenAICall = Date.now();
        return state_1.default.openaiClient.chat.completions.create({
            model: state_1.default.config.openaiModel || 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            max_tokens: 150,
            temperature: 0.8
        });
    }).then(function (response) {
        return response.choices[0].message.content.trim();
    });
}
function callOpenAIJson(systemPrompt, userPrompt) {
    return callOpenAI(systemPrompt, userPrompt).then(function (text) {
        text = text.replace(/^```json\s*\n?/, '').replace(/\n?\s*```$/, '');
        return JSON.parse(text);
    });
}
//# sourceMappingURL=openai.js.map