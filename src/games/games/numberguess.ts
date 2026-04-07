// -- Number Guessing Game -------------------------------------------------
import * as sm from '../session-manager';
import * as content from '../content';

export function startNumberGuess(sender: string, isWhisper: boolean): void {
  sm.setCooldown(sender);
  const data: any = content.generateNumberGuess();
  data.maxAttempts = 10;
  sm.createSession(sender, 'numberguess', isWhisper, data);
  sm.sendGameResponse(sender, 'I picked a number 1-100. Guess it!', isWhisper);
  sm.emitActivity(sender, 'numberguess', 'started');
}

export function checkNumberGuess(session: any, playerAnswer: string): void {
  const num = parseInt(playerAnswer.trim(), 10);
  if (isNaN(num)) return;

  session.attempts++;

  if (num === session.targetNumber) {
    sm.sendGameResponse(session.playerName, 'Correct! The number was ' + session.targetNumber + ' (' + session.attempts + ' guesses)', session.isWhisper);
    sm.recordGame(session.playerName, true, 'numberguess');
    sm.cancelSession(session.playerName);
    sm.emitActivity(session.playerName, 'numberguess', 'won in ' + session.attempts);
  } else if (session.attempts >= session.maxAttempts) {
    sm.sendGameResponse(session.playerName, 'Out of guesses! It was ' + session.targetNumber, session.isWhisper);
    sm.recordGame(session.playerName, false, 'numberguess');
    sm.cancelSession(session.playerName);
    sm.emitActivity(session.playerName, 'numberguess', 'lost');
  } else if (num < session.targetNumber) {
    sm.sendGameResponse(session.playerName, 'Too low! (' + session.attempts + '/' + session.maxAttempts + ')', session.isWhisper);
  } else {
    sm.sendGameResponse(session.playerName, 'Too high! (' + session.attempts + '/' + session.maxAttempts + ')', session.isWhisper);
  }
}
