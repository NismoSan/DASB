"use strict";

// ── Word Scramble Game ───────────────────────────────────────────
var sm = require('../session-manager');
var content = require('../content');
function startScramble(sender, isWhisper) {
  sm.setCooldown(sender);
  content.generateScramble(function (err, data) {
    sm.createSession(sender, 'scramble', isWhisper, data);
    sm.sendGameResponse(sender, 'Unscramble: ' + data.question, isWhisper);
    sm.emitActivity(sender, 'scramble', 'started');
  });
}
function checkAnswerExact(session, playerAnswer) {
  if (!playerAnswer || !playerAnswer.trim()) return;
  session.attempts++;
  if (playerAnswer.trim().toLowerCase() === session.answer.toLowerCase()) {
    sm.onCorrectAnswer(session);
  } else {
    sm.onWrongAnswer(session);
  }
}
module.exports = {
  startScramble: startScramble,
  checkAnswerExact: checkAnswerExact
};