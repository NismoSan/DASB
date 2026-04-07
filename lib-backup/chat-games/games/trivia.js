"use strict";

// ── Trivia & Riddle Games ─────────────────────────────────────────
var S = require('../state');
var sm = require('../session-manager');
var content = require('../content');
var openai = require('../openai');
function startTrivia(sender, isWhisper) {
  sm.setCooldown(sender);
  var charLimit = isWhisper ? 200 : 55;
  content.generateTrivia(charLimit, function (err, data) {
    sm.createSession(sender, 'trivia', isWhisper, data);
    sm.sendGameResponse(sender, 'Trivia: ' + data.question, isWhisper);
    sm.emitActivity(sender, 'trivia', 'started');
  });
}
function startRiddle(sender, isWhisper) {
  sm.setCooldown(sender);
  var charLimit = isWhisper ? 200 : 55;
  content.generateRiddle(charLimit, function (err, data) {
    sm.createSession(sender, 'riddle', isWhisper, data);
    sm.sendGameResponse(sender, 'Riddle: ' + data.question, isWhisper);
    sm.emitActivity(sender, 'riddle', 'started');
  });
}
function checkAnswerFuzzy(session, playerAnswer) {
  if (!playerAnswer || !playerAnswer.trim()) return;
  if (session.answerProcessing) return;
  session.answerProcessing = true;
  session.attempts++;
  if (playerAnswer.trim().toLowerCase() === session.answer.toLowerCase()) {
    sm.onCorrectAnswer(session);
    return;
  }
  openai.callOpenAIJson('You are judging a trivia/riddle answer. The correct answer is "' + session.answer + '". The player answered "' + playerAnswer.trim() + '". Is this close enough to be correct (allowing for typos, synonyms, abbreviations)? Return ONLY valid JSON: {"correct":true or false}', 'Judge this answer.').then(function (result) {
    if (result.correct) {
      sm.onCorrectAnswer(session);
    } else {
      sm.onWrongAnswer(session);
    }
  })["catch"](function () {
    var a = session.answer.toLowerCase().trim();
    var p = playerAnswer.toLowerCase().trim();
    if (p === a || a.indexOf(p) === 0 || p.indexOf(a) === 0) {
      sm.onCorrectAnswer(session);
    } else {
      sm.onWrongAnswer(session);
    }
  });
}
module.exports = {
  startTrivia: startTrivia,
  startRiddle: startRiddle,
  checkAnswerFuzzy: checkAnswerFuzzy
};