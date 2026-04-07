"use strict";

// ── OpenAI Helpers ───────────────────────────────────────────────
var OpenAI = require('openai');
var S = require('./state');
function initOpenAI() {
  var apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    S.openaiClient = null;
    return false;
  }
  S.openaiClient = new OpenAI({
    apiKey: apiKey,
    timeout: 15000
  });
  return true;
}
function callOpenAI(systemPrompt, userPrompt) {
  if (!S.openaiClient) {
    return Promise.reject(new Error('OpenAI not initialized'));
  }
  var now = Date.now();
  var delay = Math.max(0, S.MIN_OPENAI_INTERVAL - (now - S.lastOpenAICall));
  return new Promise(function (resolve) {
    setTimeout(resolve, delay);
  }).then(function () {
    S.lastOpenAICall = Date.now();
    return S.openaiClient.chat.completions.create({
      model: S.config.openaiModel || 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: systemPrompt
      }, {
        role: 'user',
        content: userPrompt
      }],
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
module.exports = {
  initOpenAI: initOpenAI,
  callOpenAI: callOpenAI,
  callOpenAIJson: callOpenAIJson
};