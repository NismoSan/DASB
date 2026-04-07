// -- Magic 8-Ball & Fortune -----------------------------------------------
import S from '../state';
import * as sm from '../session-manager';

export function handle8Ball(sender: string, question: string, isWhisper: boolean): void {
  if (!question) {
    const p = S.config.commandPrefix || '!';
    sm.sendGameResponse(sender, 'Ask a question! e.g. ' + p + '8ball Will I win?', isWhisper);
    return;
  }
  sm.setCooldown(sender);

  const pool: string[] = S.custom8Ball.length > 0 ? S.custom8Ball : [
    'The gods say yes, Aisling.', 'The stars say no.', 'Ask again, young Aisling.',
    'The elements are unclear.', 'Danaan wills it so.', 'Chadul clouds my vision...',
    'It is certain, by Deoch.', 'Do not count on it.', 'Ceannlaidir nods approval.',
    'Sgrios frowns upon this path.', 'Glioca blesses this choice.', 'Luathas reveals: perhaps.'
  ];
  const answer = pool[Math.floor(Math.random() * pool.length)];
  sm.sendGameResponse(sender, '8-Ball: ' + answer, isWhisper);
  sm.emitActivity(sender, '8ball', 'asked');
}

export function handleFortune(sender: string, isWhisper: boolean): void {
  sm.setCooldown(sender);

  const pool: string[] = S.customFortunes.length > 0 ? S.customFortunes : [
    'The Dubhaimid stir... guard your path, Aisling.',
    'Danaan smiles upon you this moon.',
    'Seek the altar of Glioca for answers.',
    'The elements shift - Srad rises.',
    'An old power awakens beneath Mileth.',
    'Chadul whispers your name in the dark.',
    'The mundanes speak of your deeds.',
    'Trust the path of your element, Aisling.'
  ];
  const fortune = pool[Math.floor(Math.random() * pool.length)];
  sm.sendGameResponse(sender, 'Oracle: ' + fortune, isWhisper);
  sm.emitActivity(sender, 'fortune', 'told');
}
