"use strict";

// ── Roast / Rage Bait Mode ───────────────────────────────────────
var S = require('./state');
var sm = require('./session-manager');
var openai = require('./openai');
var content = require('./content');
function addToChatHistory(sender, message) {
  S.chatHistoryBuffer.push({
    sender: sender,
    message: message,
    timestamp: Date.now()
  });
  while (S.chatHistoryBuffer.length > S.MAX_CHAT_HISTORY) {
    S.chatHistoryBuffer.shift();
  }
}
function handleRoastOrRageBait(sender, message) {
  if (!S.roastModeEnabled && !S.rageBaitEnabled) return;
  if (!sender || !message) return;
  if (S.getUsername && sender.toLowerCase() === S.getUsername().toLowerCase()) return;
  if (S.roastTarget && sender.toLowerCase() !== S.roastTarget.toLowerCase()) return;
  var now = Date.now();
  if (now - S.lastRoastTime < S.ROAST_COOLDOWN) return;
  var contextLines = S.chatHistoryBuffer.slice(-10).map(function (entry) {
    return entry.sender + ': ' + entry.message;
  }).join('\n');
  var mode = S.roastModeEnabled ? 'roast' : 'ragebait';
  var systemPrompt;
  if (mode === 'roast') {
    systemPrompt = 'You are a witty Aisling in the world of Dark Ages (Temuair). Someone just spoke in public chat. Roast them humorously based on their name and what they said. Be funny, not cruel. Use Dark Ages references (classes, elements, towns, gods). Keep it under 55 characters. Do not use quotes. Recent chat for context:\n' + contextLines;
  } else {
    systemPrompt = 'You are a provocative Aisling in the world of Dark Ages (Temuair). Someone just spoke in public chat. Give a playful rage-bait response designed to get a reaction, based on their name and what they said. Be provocative but not hateful. Use Dark Ages references. Keep it under 55 characters. Do not use quotes. Recent chat for context:\n' + contextLines;
  }
  S.lastRoastTime = now;
  openai.callOpenAI(systemPrompt, content.sanitizeName(sender) + ' says: ' + message.replace(/["\n\r]/g, ' ').substring(0, 100)).then(function (response) {
    var text = response.substring(0, S.WHISPER_MAX);
    if (S.sendWhisper) S.sendWhisper(sender, text);
    sm.emitActivity(sender, mode, 'responded to ' + sender);
  })["catch"](function () {
    var fallbackRoasts = [sender + ' speaks, yet says nothing.', 'Even a Kobold has better takes, ' + sender + '.', sender + ' must be lost from Mileth.', 'Did a Dubhaimid write that, ' + sender + '?', 'Sgrios called, ' + sender + '. He wants you back.'];
    var fallbackBaits = [sender + ', warriors hit harder than your words.', 'Imagine being from Abel and saying that.', sender + ' clearly never passed Mileth.', 'Is that the best Temuair has, ' + sender + '?', sender + ', even mundanes disagree.'];
    var pool = mode === 'roast' ? fallbackRoasts : fallbackBaits;
    var text = pool[Math.floor(Math.random() * pool.length)];
    if (S.sendWhisper) S.sendWhisper(sender, text.substring(0, S.WHISPER_MAX));
  });
}
function handlePublicChatForRoast(sender, message) {
  addToChatHistory(sender, message);
  handleRoastOrRageBait(sender, message);
}
module.exports = {
  handlePublicChatForRoast: handlePublicChatForRoast
};