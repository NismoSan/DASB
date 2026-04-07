// -- Rock Paper Scissors Game ---------------------------------------------
import S from '../state';
import * as sm from '../session-manager';

const RPS_CHOICES: string[] = ['rock', 'paper', 'scissors'];
const RPS_EMOTES: { [key: string]: number } = { rock: 0x0E, scissors: 0x0F, paper: 0x10 };
const RPS_BEATS: { [key: string]: string } = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
const RPS_ANIM_TO_CHOICE: { [key: number]: string } = { 0x17: 'rock', 0x18: 'scissors', 0x19: 'paper' };

export function startRps(sender: string, isWhisper: boolean): void {
  sm.setCooldown(sender);

  const botChoice = RPS_CHOICES[Math.floor(Math.random() * 3)];
  const session: any = sm.createSession(sender, 'rps', isWhisper, {
    question: 'RPS',
    answer: botChoice,
    hint: 'rock, paper, or scissors'
  });
  session.botChoice = botChoice;
  session.playerWins = 0;
  session.botWins = 0;
  session.currentRound = 1;

  const prompt = isWhisper ? 'RPS! Best 2 of 3. Round 1 - type rock, paper, or scissors!' : 'RPS! Best 2 of 3. Round 1 - do your emote!';
  sm.sendGameResponse(sender, prompt, isWhisper);
  sm.emitActivity(sender, 'rps', 'started');
}

export function handleEmote(senderName: string, bodyAnimId: number): void {
  if (!S.config.enabled || !S.config.games.rps) return;

  const choice = RPS_ANIM_TO_CHOICE[bodyAnimId];
  if (!choice) return;

  const key = senderName.toLowerCase();
  const session = S.activeGames.get(key);
  if (!session || session.gameType !== 'rps') return;

  handleRpsRound(session, choice);
}

export function handleRpsAnswer(session: any, message: string): void {
  const choice = message.trim().toLowerCase();
  if (RPS_CHOICES.indexOf(choice) === -1) return;
  handleRpsRound(session, choice);
}

function handleRpsRound(session: any, choice: string): void {
  if (session.roundLocked) return;
  session.roundLocked = true;

  const botChoice: string = session.botChoice;
  const playerName: string = session.playerName;
  const whisper: boolean = session.isWhisper;

  if (!whisper && S.sendEmote) S.sendEmote(RPS_EMOTES[botChoice]);

  if (choice === botChoice) {
    session.botChoice = RPS_CHOICES[Math.floor(Math.random() * 3)];
    setTimeout(function () {
      sm.sendGameResponse(playerName, 'We both chose ' + botChoice + '! Draw! Go again.', whisper);
      setTimeout(function () {
        session.roundLocked = false;
      }, 300);
    }, 800);
    return;
  }

  const playerWon = RPS_BEATS[choice] === botChoice;

  if (playerWon) {
    session.playerWins++;
  } else {
    session.botWins++;
  }

  let roundMsg = choice + ' vs ' + botChoice + ' - ';
  if (playerWon) {
    roundMsg += 'You win this round!';
  } else {
    roundMsg += 'I win this round!';
  }

  const score = ' (' + playerName + ' ' + session.playerWins + '-' + session.botWins + ')';

  setTimeout(function () {
    sm.sendGameResponse(playerName, 'R' + session.currentRound + ': ' + roundMsg + score, whisper);

    if (session.playerWins >= 2) {
      setTimeout(function () {
        sm.sendGameResponse(playerName, playerName + ' wins the match! GG!', whisper);
        sm.recordGame(playerName, true, 'rps');
        sm.cancelSession(playerName);
        sm.emitActivity(playerName, 'rps', 'won the match');
      }, 800);
    } else if (session.botWins >= 2) {
      setTimeout(function () {
        sm.sendGameResponse(playerName, 'I win the match! Better luck next time.', whisper);
        sm.recordGame(playerName, false, 'rps');
        sm.cancelSession(playerName);
        sm.emitActivity(playerName, 'rps', 'lost the match');
      }, 800);
    } else {
      session.currentRound++;
      session.botChoice = RPS_CHOICES[Math.floor(Math.random() * 3)];
      const nextPrompt = whisper ? 'Round ' + session.currentRound + ' - type rock, paper, or scissors!' : 'Round ' + session.currentRound + ' - do your emote!';
      setTimeout(function () {
        sm.sendGameResponse(playerName, nextPrompt, whisper);
        session.roundLocked = false;
      }, 800);
    }
  }, 800);
}
