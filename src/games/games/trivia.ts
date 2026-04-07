// -- Trivia & Riddle Games -------------------------------------------------
import S from '../state';
import * as sm from '../session-manager';
import * as content from '../content';
import * as openai from '../openai';

export function startTrivia(sender: string, isWhisper: boolean): void {
  sm.setCooldown(sender);
  const charLimit = isWhisper ? 200 : 55;

  content.generateTrivia(charLimit, function (_err: any, data: any) {
    sm.createSession(sender, 'trivia', isWhisper, data);
    sm.sendGameResponse(sender, 'Trivia: ' + data.question, isWhisper);
    sm.emitActivity(sender, 'trivia', 'started');
  });
}

export function startRiddle(sender: string, isWhisper: boolean): void {
  sm.setCooldown(sender);
  const charLimit = isWhisper ? 200 : 55;

  content.generateRiddle(charLimit, function (_err: any, data: any) {
    sm.createSession(sender, 'riddle', isWhisper, data);
    sm.sendGameResponse(sender, 'Riddle: ' + data.question, isWhisper);
    sm.emitActivity(sender, 'riddle', 'started');
  });
}

export function checkAnswerFuzzy(session: any, playerAnswer: string): void {
  if (!playerAnswer || !playerAnswer.trim()) return;
  if (session.answerProcessing) return;
  session.answerProcessing = true;

  session.attempts++;

  if (playerAnswer.trim().toLowerCase() === session.answer.toLowerCase()) {
    sm.onCorrectAnswer(session);
    return;
  }

  openai.callOpenAIJson(
    'You are judging a trivia/riddle answer. The correct answer is "' + session.answer + '". The player answered "' + playerAnswer.trim() + '". Is this close enough to be correct (allowing for typos, synonyms, abbreviations)? Return ONLY valid JSON: {"correct":true or false}',
    'Judge this answer.'
  ).then(function (result: any) {
    if (result.correct) {
      sm.onCorrectAnswer(session);
    } else {
      sm.onWrongAnswer(session);
    }
  }).catch(function () {
    const a = session.answer.toLowerCase().trim();
    const p = playerAnswer.toLowerCase().trim();
    if (p === a || a.indexOf(p) === 0 || p.indexOf(a) === 0) {
      sm.onCorrectAnswer(session);
    } else {
      sm.onWrongAnswer(session);
    }
  });
}
