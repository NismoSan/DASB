// -- Word Scramble Game ---------------------------------------------------
import * as sm from '../session-manager';
import * as content from '../content';

export function startScramble(sender: string, isWhisper: boolean): void {
  sm.setCooldown(sender);

  content.generateScramble(function (_err: any, data: any) {
    sm.createSession(sender, 'scramble', isWhisper, data);
    sm.sendGameResponse(sender, 'Unscramble: ' + data.question, isWhisper);
    sm.emitActivity(sender, 'scramble', 'started');
  });
}

export function checkAnswerExact(session: any, playerAnswer: string): void {
  if (!playerAnswer || !playerAnswer.trim()) return;

  session.attempts++;
  if (playerAnswer.trim().toLowerCase() === session.answer.toLowerCase()) {
    sm.onCorrectAnswer(session);
  } else {
    sm.onWrongAnswer(session);
  }
}
