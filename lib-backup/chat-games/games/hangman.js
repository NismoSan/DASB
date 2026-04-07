"use strict";

// ── Hangman Game ─────────────────────────────────────────────────
var S = require('../state');
var sm = require('../session-manager');
var content = require('../content');
function startHangman(sender, isWhisper) {
  sm.setCooldown(sender);
  content.generateHangman(function (err, data) {
    sm.createSession(sender, 'hangman', isWhisper, data);
    var msg = 'Hangman: ' + data.question + ' (' + data.maxWrong + ' lives)';
    sm.sendGameResponse(sender, msg, isWhisper);
    if (isWhisper) {
      setTimeout(function () {
        S.sendWhisper(sender, 'Hint: ' + (data.hint || 'No hint'));
      }, 500);
    }
    sm.emitActivity(sender, 'hangman', 'started');
  });
}
function handleHangmanGuess(session, message) {
  var input = message.trim().toLowerCase();
  if (!input) return;

  // Full word guess
  if (input.length > 1) {
    if (input === session.answer.toLowerCase()) {
      sm.onCorrectAnswer(session);
    } else {
      session.wrongCount++;
      if (session.wrongCount >= session.maxWrong) {
        sm.sendGameResponse(session.playerName, 'Hanged! The word was: ' + session.answer, session.isWhisper);
        sm.recordGame(session.playerName, false, 'hangman');
        sm.cancelSession(session.playerName);
        sm.emitActivity(session.playerName, 'hangman', 'lost');
      } else {
        var lives = session.maxWrong - session.wrongCount;
        var revealed = content.buildRevealedWord(session.answer, session.guessedLetters);
        sm.sendGameResponse(session.playerName, 'Wrong word! ' + revealed + ' (' + lives + ' lives)', session.isWhisper);
      }
    }
    return;
  }

  // Single letter guess
  if (!/^[a-z]$/.test(input)) {
    sm.sendGameResponse(session.playerName, 'Letters only!', session.isWhisper);
    return;
  }
  if (session.guessedLetters.indexOf(input) !== -1) {
    sm.sendGameResponse(session.playerName, 'Already guessed [' + input + ']!', session.isWhisper);
    return;
  }
  session.guessedLetters.push(input);
  if (session.answer.toLowerCase().indexOf(input) !== -1) {
    var revealed = content.buildRevealedWord(session.answer, session.guessedLetters);
    if (revealed.indexOf('_') === -1) {
      sm.onCorrectAnswer(session);
    } else {
      var lives = session.maxWrong - session.wrongCount;
      sm.sendGameResponse(session.playerName, 'Hit! ' + revealed + ' (' + lives + ' lives)', session.isWhisper);
    }
  } else {
    session.wrongCount++;
    if (session.wrongCount >= session.maxWrong) {
      sm.sendGameResponse(session.playerName, 'Hanged! The word was: ' + session.answer, session.isWhisper);
      sm.recordGame(session.playerName, false, 'hangman');
      sm.cancelSession(session.playerName);
      sm.emitActivity(session.playerName, 'hangman', 'lost');
    } else {
      var lives = session.maxWrong - session.wrongCount;
      var revealed = content.buildRevealedWord(session.answer, session.guessedLetters);
      sm.sendGameResponse(session.playerName, 'Miss! ' + revealed + ' (' + lives + ' lives)', session.isWhisper);
    }
  }
}
module.exports = {
  startHangman: startHangman,
  handleHangmanGuess: handleHangmanGuess
};