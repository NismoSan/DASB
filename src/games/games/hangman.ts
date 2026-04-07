// -- Hangman Game ---------------------------------------------------------
import S from '../state';
import * as sm from '../session-manager';
import * as content from '../content';

export function startHangman(sender: string, isWhisper: boolean): void {
  sm.setCooldown(sender);

  content.generateHangman(function (_err: any, data: any) {
    sm.createSession(sender, 'hangman', isWhisper, data);
    const msg = 'Hangman: ' + data.question + ' (' + data.maxWrong + ' lives)';
    sm.sendGameResponse(sender, msg, isWhisper);
    if (isWhisper) {
      setTimeout(function () {
        S.sendWhisper!(sender, 'Hint: ' + (data.hint || 'No hint'));
      }, 500);
    }
    sm.emitActivity(sender, 'hangman', 'started');
  });
}

export function handleHangmanGuess(session: any, message: string): void {
  const input = message.trim().toLowerCase();
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
        const lives = session.maxWrong - session.wrongCount;
        const revealed = content.buildRevealedWord(session.answer, session.guessedLetters);
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
    const revealed = content.buildRevealedWord(session.answer, session.guessedLetters);
    if (revealed.indexOf('_') === -1) {
      sm.onCorrectAnswer(session);
    } else {
      const lives = session.maxWrong - session.wrongCount;
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
      const lives = session.maxWrong - session.wrongCount;
      const revealed = content.buildRevealedWord(session.answer, session.guessedLetters);
      sm.sendGameResponse(session.playerName, 'Miss! ' + revealed + ' (' + lives + ' lives)', session.isWhisper);
    }
  }
}
