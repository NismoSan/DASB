"use strict";

// -- Blackjack Game (Solo & Group) ----------------------------------------
import S from '../state';
import * as sm from '../session-manager';

const BJ_RANKS: string[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
const BJ_STARTING_CHIPS = 500000;
const BJ_MIN_BET = 100;
const BJ_MAX_BET = 100000;
const BJ_SOLO_ACTION_TIMEOUT = 60000;
const BJ_SOLO_SESSION_TIMEOUT = 600000;
const BJ_GROUP_ACTION_TIMEOUT = 45000;
const BJ_GROUP_LOBBY_TIMEOUT = 90000;
const BJ_GROUP_BETWEEN_HANDS = 5000;
const BJ_GROUP_MAX_HANDS = 20;

// -- Streak & Milestone Config --

interface StreakBonus {
  streak: number;
  multiplier: number;
  label: string;
}

const BJ_STREAK_BONUSES: StreakBonus[] = [
  { streak: 3, multiplier: 1.5, label: '{=c3-win streak! 1.5x payout' },
  { streak: 5, multiplier: 2.0, label: '{=c5-win streak! 2x payout!' },
  { streak: 7, multiplier: 2.5, label: '{=c7-win streak! 2.5x payout!!' },
  { streak: 10, multiplier: 3.0, label: '{=c10-WIN STREAK! 3x PAYOUT!!!' }
];
const BJ_MILESTONES: number[] = [100000, 250000, 500000, 1000000, 2500000, 5000000];

// -- Dealer Flavor Text --

const BJ_DEAL_COMMENTS: string[] = [
  '{=aCards are out. Lets see what we got.',
  '{=aFresh hand coming your way.',
  '{=aDealing... good luck out there.',
  '{=aAlright, cards on the table.',
  '{=aAnother round, another chance.'
];
const BJ_BLACKJACK_CONGRATS: string[] = [
  '{=cNatural 21! Beautiful hand!',
  '{=cBlackjack baby! Thats how its done!',
  '{=cBLACKJACK! Chefs kiss.',
  '{=cNow THAT is a hand!'
];
const BJ_DEALER_BJ: string[] = [
  '{=rOuch. Dealer flips blackjack.',
  '{=rHate to show you this... blackjack.',
  '{=rSorry friend. Natural 21 over here.'
];
const BJ_PLAYER_BUST: string[] = [
  '{=rBust! Rough break.',
  '{=rOoof, too many. Busted.',
  '{=rWent a little too far there.',
  '{=rThats a bust. It happens.',
  '{=rOver 21. Tough luck.'
];
const BJ_DEALER_BUST: string[] = [
  '{=dDealer busts! Your lucky day.',
  '{=dToo many for the house! You win!',
  '{=dDealer went overboard. Nice.',
  '{=dBusted! House takes the L.'
];
const BJ_WIN_COMMENTS: string[] = [
  '{=dWinner winner!',
  '{=dNice hand! Chips coming your way.',
  '{=dThats a W. Well played.',
  '{=dYou beat the house. Respect.'
];
const BJ_LOSE_COMMENTS: string[] = [
  '{=rHouse wins this one.',
  '{=rNot your hand. Next one though.',
  '{=rDealer takes it. Hang in there.',
  '{=rTough break. The table will turn.'
];
const BJ_PUSH_COMMENTS: string[] = [
  '{=bPush! Nobody wins, nobody loses.',
  '{=bTied up. Bet comes back.',
  '{=bDead even. Well see next hand.'
];
const BJ_CLOSE_WIN: string[] = [
  '{=dSqueaked it out! Close one.',
  '{=dBy the skin of your teeth! Nice.',
  '{=dThat was CLOSE. But a win is a win.'
];
const BJ_CLOSE_LOSS: string[] = [
  '{=rSo close! One more wouldve done it.',
  '{=rAgh, just barely. Painful.',
  '{=rOff by one. Thats rough.'
];
const BJ_DEALER_REVEAL: string[] = [
  '{=cDealer flips... ',
  '{=cAnd the hole card is... ',
  '{=cMoment of truth... ',
  '{=cDealer reveals... '
];
const BJ_HIT_REACTIONS_GOOD: string[] = [
  '{=dSolid card.',
  '{=dNot bad at all.',
  '{=dStill in it!'
];
const BJ_HIT_REACTIONS_RISKY: string[] = [
  '{=oGetting up there...',
  '{=oLiving dangerously!',
  '{=oBrave move.'
];
const BJ_HIT_21: string[] = [
  '{=c21! Perfect!',
  '{=cTwenty-one on the dot!',
  '{=cNailed it! 21!'
];
const BJ_HOT_STATUS: string[] = ['{=o[HOT] ', '{=o[FIRE] ', '{=o[STREAK] '];
const BJ_COLD_STATUS: string[] = ['{=b[COLD] ', '{=b[ICE] ', '{=b[ROUGH] '];
const BJ_STREAK_BROKEN: string[] = ['{=rStreak broken at ', '{=rRun ends at '];
const BJ_LOSS_STREAK: string[] = [
  '{=bHang in there. Itll turn around.',
  '{=bCold spell. Stay patient.',
  '{=bRough patch. Keep playing.'
];

// -- Deck & Helpers --

function bjCreateDeck(): string[] {
  const deck: string[] = [];
  for (let r = 0; r < BJ_RANKS.length; r++) {
    deck.push(BJ_RANKS[r], BJ_RANKS[r], BJ_RANKS[r], BJ_RANKS[r]);
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
  return deck;
}
function bjDeal(state: any): string {
  if (state.deckIndex >= state.deck.length) {
    state.deck = bjCreateDeck();
    state.deckIndex = 0;
  }
  return state.deck[state.deckIndex++];
}
function bjCardValue(card: string): number {
  const r = card[0];
  if (r === 'A') return 11;
  if (r === 'T' || r === 'J' || r === 'Q' || r === 'K') return 10;
  return parseInt(r);
}
function bjHandTotal(hand: string[]): number {
  let total = 0;
  let aces = 0;
  for (let i = 0; i < hand.length; i++) {
    const v = bjCardValue(hand[i]);
    if (v === 11) aces++;
    total += v;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}
function bjIsBlackjack(hand: string[]): boolean {
  return hand.length === 2 && bjHandTotal(hand) === 21;
}
function bjFormatCards(hand: string[]): string {
  return hand.join(' ');
}
function bjFormatHand(hand: string[]): string {
  return bjFormatCards(hand) + ' (' + bjHandTotal(hand) + ')';
}

// -- Streak & Personality Helpers --

function bjPickRandom(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}
function bjGetStreakMultiplier(winStreak: number): number {
  let mult = 1.0;
  for (let i = 0; i < BJ_STREAK_BONUSES.length; i++) {
    if (winStreak >= BJ_STREAK_BONUSES[i].streak) {
      mult = BJ_STREAK_BONUSES[i].multiplier;
    }
  }
  return mult;
}
function bjGetStreakLabel(winStreak: number): string {
  let label = '';
  for (let i = 0; i < BJ_STREAK_BONUSES.length; i++) {
    if (winStreak >= BJ_STREAK_BONUSES[i].streak) {
      label = BJ_STREAK_BONUSES[i].label;
    }
  }
  return label;
}
function bjGetStatusTag(session: any): string {
  if (session.winStreak >= 3) return bjPickRandom(BJ_HOT_STATUS);
  if (session.lossStreak >= 3) return bjPickRandom(BJ_COLD_STATUS);
  return '';
}
function bjCheckMilestone(session: any, oldChips: number): void {
  const newChips = session.playerChips;
  for (let i = 0; i < BJ_MILESTONES.length; i++) {
    const m = BJ_MILESTONES[i];
    if (oldChips < m && newChips >= m) {
      const label = m >= 1000000 ? (m / 1000000) + 'M' : (m / 1000) + 'K';
      sm.sendGameResponse(session.playerName,
        '{=wMILESTONE! You hit ' + label + ' chips!', session.isWhisper);
    }
  }
  if (newChips > session.peakChips) {
    session.peakChips = newChips;
  }
}
function bjApplyStreakBonus(session: any, baseWinnings: number): number {
  const mult = bjGetStreakMultiplier(session.winStreak);
  if (mult > 1.0) {
    const bonus = Math.floor(baseWinnings * mult) - baseWinnings;
    sm.sendGameResponse(session.playerName,
      bjGetStreakLabel(session.winStreak) + ' +' + bonus, session.isWhisper);
    return baseWinnings + bonus;
  }
  return baseWinnings;
}

function bjGetSavedChips(playerName: string): number {
  const key = playerName.toLowerCase();
  const stats = S.scoreboard.get(key);
  if (stats && stats.byGame && stats.byGame.blackjack && typeof stats.byGame.blackjack.chips === 'number') {
    return stats.byGame.blackjack.chips || BJ_STARTING_CHIPS;
  }
  return BJ_STARTING_CHIPS;
}
function bjSaveChips(playerName: string, chips: number): void {
  const key = playerName.toLowerCase();
  const stats: any = S.scoreboard.get(key) || {
    name: playerName,
    wins: 0,
    played: 0,
    currentStreak: 0,
    bestStreak: 0
  };
  if (!stats.byGame) stats.byGame = {};
  if (!stats.byGame.blackjack) stats.byGame.blackjack = {
    wins: 0,
    played: 0
  };
  stats.byGame.blackjack.chips = chips;
  stats.name = playerName;
  S.scoreboard.set(key, stats);
  sm.saveLeaderboard(playerName);
}

// -- Solo Blackjack --

export function startBlackjack(sender: string, isWhisper: boolean): void {
  if (S.bjGroupSession) {
    const seats = S.bjGroupSession.seats;
    for (let i = 0; i < seats.length; i++) {
      if (seats[i].name.toLowerCase() === sender.toLowerCase() && !seats[i].eliminated) {
        sm.sendGameResponse(sender, 'You are in a group blackjack game.', isWhisper);
        return;
      }
    }
  }
  sm.setCooldown(sender);
  sm.cancelSession(sender);
  const deck = bjCreateDeck();
  const session: any = {
    playerName: sender,
    gameType: 'blackjack',
    isWhisper: isWhisper,
    startedAt: Date.now(),
    attempts: 0,
    maxAttempts: 999,
    question: 'blackjack',
    answer: '',
    hint: '',
    bjMode: 'solo',
    deck: deck,
    deckIndex: 0,
    playerHand: [] as string[],
    dealerHand: [] as string[],
    playerChips: bjGetSavedChips(sender),
    currentBet: 0,
    phase: 'betting',
    handNumber: 1,
    canDouble: false,
    canSplit: false,
    splitHand: null as string[] | null,
    playingSplit: false,
    winStreak: 0,
    lossStreak: 0,
    totalWins: 0,
    totalLosses: 0,
    peakChips: bjGetSavedChips(sender),
    chipsBeforeHand: 0,
    actionTimer: null as any,
    timeoutTimer: setTimeout(function () {
      bjSoloTimeout(sender);
    }, BJ_SOLO_SESSION_TIMEOUT)
  };
  S.activeGames.set(sender.toLowerCase(), session);
  if (S.ioRef) {
    S.ioRef.emit('chatgames:sessionStart', {
      player: sender,
      gameType: 'blackjack',
      timestamp: Date.now()
    });
    S.ioRef.emit('chatgames:active', sm.getActiveGames());
  }
  sm.emitActivity(sender, 'blackjack', 'started blackjack');
  bjPromptBet(session);
}
function bjPromptBet(session: any): void {
  const name = session.playerName;
  const w = session.isWhisper;
  session.phase = 'betting';
  const tag = bjGetStatusTag(session);
  const msg = tag + '{=cChips:' + session.playerChips + ' | Bet ' + BJ_MIN_BET + '-' + Math.min(BJ_MAX_BET, session.playerChips);
  sm.sendGameResponse(name, msg, w);
  setTimeout(function () {
    if (session.winStreak >= 3) {
      sm.sendGameResponse(name, '{=oWin streak: ' + session.winStreak + '! Next win ' + bjGetStreakMultiplier(session.winStreak) + 'x', w);
    }
    sm.sendGameResponse(name, 'Type a bet amount (or "quit" to leave)', w);
  }, 800);
  if (session.actionTimer) clearTimeout(session.actionTimer);
  session.actionTimer = setTimeout(function () {
    if (!S.activeGames.has(session.playerName.toLowerCase())) return;
    if (session.phase !== 'betting') return;
    sm.sendGameResponse(name, 'Time up! Auto-bet ' + BJ_MIN_BET + '.', w);
    bjPlaceBet(session, BJ_MIN_BET);
  }, BJ_SOLO_ACTION_TIMEOUT);
}
function bjPlaceBet(session: any, amount: number): void {
  session.chipsBeforeHand = session.playerChips;
  const bet = Math.max(BJ_MIN_BET, Math.min(amount, session.playerChips, BJ_MAX_BET));
  session.currentBet = bet;
  session.playerChips -= bet;
  session.phase = 'dealing';
  bjDealHand(session);
}
function bjDealHand(session: any): void {
  const name = session.playerName;
  const w = session.isWhisper;
  session.playerHand = [bjDeal(session), bjDeal(session)];
  session.dealerHand = [bjDeal(session), bjDeal(session)];
  session.splitHand = null;
  session.playingSplit = false;
  const dealerUp = session.dealerHand[0];
  sm.sendGameResponse(name, '{=c--- Hand ' + session.handNumber + ' | Bet:' + session.currentBet + ' ---', w);
  if (Math.random() < 0.5) {
    setTimeout(function () {
      sm.sendGameResponse(name, bjPickRandom(BJ_DEAL_COMMENTS), w);
    }, 400);
  }
  setTimeout(function () {
    if (w) {
      sm.sendGameResponse(name, '{=aYou: ' + bjFormatHand(session.playerHand) + ' | Dealer: ' + dealerUp + ' ??', true);
    } else {
      if (S.sendWhisper) {
        const chunks = sm.splitMessage('BJ Hand: ' + bjFormatHand(session.playerHand), S.WHISPER_MAX);
        chunks.forEach(function (chunk: string, ci: number) {
          setTimeout(function () {
            S.sendWhisper!(name, chunk);
          }, ci * 500);
        });
      }
      sm.sendGameResponse(name, 'Cards whispered! Dealer shows: ' + dealerUp, false);
    }
    if (bjIsBlackjack(session.playerHand) && bjIsBlackjack(session.dealerHand)) {
      setTimeout(function () {
        sm.sendGameResponse(name, '{=bBoth blackjack! Push. Bet returned.', w);
        session.playerChips += session.currentBet;
        bjNextHand(session);
      }, 1200);
      return;
    }
    if (bjIsBlackjack(session.playerHand)) {
      setTimeout(function () {
        let winnings = Math.floor(session.currentBet * 2.5);
        session.winStreak++;
        session.lossStreak = 0;
        session.totalWins++;
        winnings = bjApplyStreakBonus(session, winnings);
        sm.sendGameResponse(name, bjPickRandom(BJ_BLACKJACK_CONGRATS) + ' {=cWin ' + winnings + '!', w);
        session.playerChips += winnings;
        sm.recordGame(name, true, 'blackjack');
        sm.emitActivity(name, 'blackjack', 'got blackjack');
        bjNextHand(session);
      }, 1200);
      return;
    }
    if (bjIsBlackjack(session.dealerHand)) {
      setTimeout(function () {
        sm.sendGameResponse(name, bjPickRandom(BJ_DEALER_BJ), w);
        sm.sendGameResponse(name, '{=rYou lose ' + session.currentBet + '.', w);
        if (session.winStreak >= 3) {
          sm.sendGameResponse(name, bjPickRandom(BJ_STREAK_BROKEN) + session.winStreak + '.', w);
        }
        session.lossStreak++;
        session.winStreak = 0;
        session.totalLosses++;
        sm.recordGame(name, false, 'blackjack');
        sm.emitActivity(name, 'blackjack', 'dealer blackjack');
        bjNextHand(session);
      }, 1200);
      return;
    }
    session.canDouble = session.playerChips >= session.currentBet && session.playerHand.length === 2;
    const r1 = bjCardValue(session.playerHand[0]);
    const r2 = bjCardValue(session.playerHand[1]);
    session.canSplit = r1 === r2 && session.playerChips >= session.currentBet;
    setTimeout(function () {
      bjPromptAction(session);
    }, 1200);
  }, 800);
}
function bjPromptAction(session: any): void {
  if (!S.activeGames.has(session.playerName.toLowerCase())) return;
  session.phase = 'playing';
  const handLabel = session.playingSplit ? 'Split hand' : 'Your hand';
  const hand = session.playingSplit ? session.splitHand : session.playerHand;
  let options = 'hit/stand';
  if (session.canDouble && !session.playingSplit) options += '/double';
  if (session.canSplit && !session.playingSplit && !session.splitHand) options += '/split';
  const tag = bjGetStatusTag(session);
  const msg = tag + '{=a' + handLabel + ': ' + bjFormatHand(hand) + ' | ' + options;
  sm.sendGameResponse(session.playerName, msg, session.isWhisper);
  if (session.actionTimer) clearTimeout(session.actionTimer);
  session.actionTimer = setTimeout(function () {
    if (!S.activeGames.has(session.playerName.toLowerCase())) return;
    if (session.phase !== 'playing') return;
    sm.sendGameResponse(session.playerName, 'Time up! Auto-stand.', session.isWhisper);
    bjStand(session);
  }, BJ_SOLO_ACTION_TIMEOUT);
}
export function handleBlackjackAction(session: any, message: string): void {
  const msg = message.trim().toLowerCase();
  if (session.phase === 'betting') {
    if (msg === 'quit' || msg === 'leave') {
      bjSaveChips(session.playerName, session.playerChips);
      sm.sendGameResponse(session.playerName, '{=aLeft blackjack. {=cChips:' + session.playerChips, session.isWhisper);
      sm.cancelSession(session.playerName);
      sm.emitActivity(session.playerName, 'blackjack', 'quit');
      return;
    }
    const betAmt = parseInt(msg);
    if (isNaN(betAmt) || betAmt < BJ_MIN_BET) {
      sm.sendGameResponse(session.playerName, 'Bet ' + BJ_MIN_BET + '-' + Math.min(BJ_MAX_BET, session.playerChips) + ' or "quit"', session.isWhisper);
      return;
    }
    if (session.actionTimer) clearTimeout(session.actionTimer);
    bjPlaceBet(session, betAmt);
    return;
  }
  if (session.phase !== 'playing') return;
  if (session.actionTimer) clearTimeout(session.actionTimer);
  if (msg === 'hit' || msg === 'h') {
    bjHit(session);
  } else if (msg === 'stand' || msg === 's' || msg === 'stay') {
    bjStand(session);
  } else if ((msg === 'double' || msg === 'dd' || msg === 'd') && session.canDouble && !session.playingSplit) {
    bjDouble(session);
  } else if (msg === 'split' && session.canSplit && !session.playingSplit && !session.splitHand) {
    bjSplit(session);
  } else {
    sm.sendGameResponse(session.playerName, 'Try: hit, stand' + (session.canDouble && !session.playingSplit ? ', double' : '') + (session.canSplit && !session.playingSplit && !session.splitHand ? ', split' : ''), session.isWhisper);
    bjPromptAction(session);
  }
}
function bjHit(session: any): void {
  const hand = session.playingSplit ? session.splitHand : session.playerHand;
  hand.push(bjDeal(session));
  const total = bjHandTotal(hand);
  const label = session.playingSplit ? 'Split' : 'You';
  sm.sendGameResponse(session.playerName, '{=a' + label + ': ' + bjFormatHand(hand), session.isWhisper);
  if (total > 21) {
    setTimeout(function () {
      sm.sendGameResponse(session.playerName, bjPickRandom(BJ_PLAYER_BUST), session.isWhisper);
      if (session.playingSplit) {
        session.playingSplit = false;
        bjDealerPlay(session);
      } else if (session.splitHand) {
        session.playingSplit = true;
        session.canDouble = false;
        setTimeout(function () {
          bjPromptAction(session);
        }, 800);
      } else {
        bjDealerPlay(session);
      }
    }, 800);
    return;
  }
  if (total === 21) {
    setTimeout(function () {
      sm.sendGameResponse(session.playerName, bjPickRandom(BJ_HIT_21), session.isWhisper);
      if (session.playingSplit) {
        session.playingSplit = false;
        bjDealerPlay(session);
      } else if (session.splitHand) {
        session.playingSplit = true;
        session.canDouble = false;
        setTimeout(function () {
          bjPromptAction(session);
        }, 800);
      } else {
        bjDealerPlay(session);
      }
    }, 800);
    return;
  }
  if (total >= 17 && Math.random() < 0.6) {
    sm.sendGameResponse(session.playerName, bjPickRandom(BJ_HIT_REACTIONS_RISKY), session.isWhisper);
  } else if (total <= 16 && Math.random() < 0.4) {
    sm.sendGameResponse(session.playerName, bjPickRandom(BJ_HIT_REACTIONS_GOOD), session.isWhisper);
  }
  session.canDouble = false;
  session.canSplit = false;
  setTimeout(function () {
    bjPromptAction(session);
  }, 800);
}
function bjStand(session: any): void {
  if (session.playingSplit) {
    session.playingSplit = false;
    bjDealerPlay(session);
  } else if (session.splitHand) {
    session.playingSplit = true;
    session.canDouble = false;
    sm.sendGameResponse(session.playerName, '{=aStanding. Now playing split hand.', session.isWhisper);
    setTimeout(function () {
      bjPromptAction(session);
    }, 800);
  } else {
    bjDealerPlay(session);
  }
}
function bjDouble(session: any): void {
  session.playerChips -= session.currentBet;
  session.currentBet *= 2;
  const hand = session.playerHand;
  hand.push(bjDeal(session));
  const total = bjHandTotal(hand);
  sm.sendGameResponse(session.playerName, '{=cDouble! ' + bjFormatHand(hand) + ' Bet:' + session.currentBet, session.isWhisper);
  if (total > 21) {
    setTimeout(function () {
      sm.sendGameResponse(session.playerName, bjPickRandom(BJ_PLAYER_BUST), session.isWhisper);
      if (session.splitHand) {
        session.playingSplit = true;
        setTimeout(function () {
          bjPromptAction(session);
        }, 800);
      } else {
        bjDealerPlay(session);
      }
    }, 800);
  } else {
    if (session.splitHand) {
      session.playingSplit = true;
      session.canDouble = false;
      setTimeout(function () {
        sm.sendGameResponse(session.playerName, 'Now playing split hand.', session.isWhisper);
        setTimeout(function () {
          bjPromptAction(session);
        }, 800);
      }, 800);
    } else {
      setTimeout(function () {
        bjDealerPlay(session);
      }, 800);
    }
  }
}
function bjSplit(session: any): void {
  session.playerChips -= session.currentBet;
  session.splitHand = [session.playerHand.pop()!];
  session.playerHand.push(bjDeal(session));
  session.splitHand.push(bjDeal(session));
  session.canSplit = false;
  session.canDouble = session.playerChips >= session.currentBet;
  sm.sendGameResponse(session.playerName, '{=cSplit! {=aHand 1: ' + bjFormatHand(session.playerHand), session.isWhisper);
  setTimeout(function () {
    sm.sendGameResponse(session.playerName, '{=aHand 2: ' + bjFormatHand(session.splitHand), session.isWhisper);
    setTimeout(function () {
      sm.sendGameResponse(session.playerName, 'Playing hand 1 first.', session.isWhisper);
      setTimeout(function () {
        bjPromptAction(session);
      }, 800);
    }, 800);
  }, 800);
}
function bjDealerPlay(session: any): void {
  if (!S.activeGames.has(session.playerName.toLowerCase())) return;
  session.phase = 'dealer';
  const name = session.playerName;
  const w = session.isWhisper;
  const mainBust = bjHandTotal(session.playerHand) > 21;
  const splitBust = session.splitHand ? bjHandTotal(session.splitHand) > 21 : true;
  if (mainBust && splitBust) {
    sm.sendGameResponse(name, bjPickRandom(BJ_DEALER_REVEAL) + session.dealerHand[1], w);
    setTimeout(function () {
      sm.sendGameResponse(name, '{=aDealer: ' + bjFormatHand(session.dealerHand), w);
      setTimeout(function () {
        const totalLost = session.splitHand ? session.currentBet * 2 : session.currentBet;
        sm.sendGameResponse(name, '{=rYou lose ' + totalLost + '.', w);
        if (session.winStreak >= 3) {
          sm.sendGameResponse(name, bjPickRandom(BJ_STREAK_BROKEN) + session.winStreak + '.', w);
        }
        session.lossStreak++;
        session.winStreak = 0;
        session.totalLosses++;
        if (session.lossStreak === 3 || session.lossStreak === 5) {
          sm.sendGameResponse(name, bjPickRandom(BJ_LOSS_STREAK), w);
        }
        sm.recordGame(name, false, 'blackjack');
        bjNextHand(session);
      }, 800);
    }, 1000);
    return;
  }
  sm.sendGameResponse(name, bjPickRandom(BJ_DEALER_REVEAL) + session.dealerHand[1], w);
  function dealerDraw(): void {
    const dealerTotal = bjHandTotal(session.dealerHand);
    if (dealerTotal < 17) {
      setTimeout(function () {
        session.dealerHand.push(bjDeal(session));
        sm.sendGameResponse(name, '{=aDealer draws: ' + bjFormatHand(session.dealerHand), w);
        dealerDraw();
      }, 1200);
    } else {
      setTimeout(function () {
        bjResolve(session);
      }, 800);
    }
  }
  setTimeout(function () {
    sm.sendGameResponse(name, '{=aDealer: ' + bjFormatHand(session.dealerHand), w);
    setTimeout(function () {
      dealerDraw();
    }, 800);
  }, 1000);
}
function bjResolve(session: any): void {
  const name = session.playerName;
  const w = session.isWhisper;
  const dealerTotal = bjHandTotal(session.dealerHand);
  const dealerBust = dealerTotal > 21;
  function resolveHand(hand: string[], bet: number, label: string): { result: string; winnings: number; flavor: string; msg: string } {
    const playerTotal = bjHandTotal(hand);
    const playerBust = playerTotal > 21;
    const diff = Math.abs(playerTotal - dealerTotal);
    let flavor = '';
    if (playerBust) {
      return {
        result: 'lose', winnings: 0, flavor: '',
        msg: '{=r' + label + ': Bust. Lose ' + bet + '.'
      };
    }
    if (dealerBust) {
      flavor = bjPickRandom(BJ_DEALER_BUST);
      return {
        result: 'win', winnings: bet * 2, flavor: flavor,
        msg: '{=d' + label + ': Dealer bust! Win ' + bet + '!'
      };
    }
    if (playerTotal > dealerTotal) {
      flavor = diff === 1 ? bjPickRandom(BJ_CLOSE_WIN) : bjPickRandom(BJ_WIN_COMMENTS);
      return {
        result: 'win', winnings: bet * 2, flavor: flavor,
        msg: '{=d' + label + ': ' + playerTotal + ' vs ' + dealerTotal + '. Win ' + bet + '!'
      };
    }
    if (playerTotal < dealerTotal) {
      flavor = diff === 1 ? bjPickRandom(BJ_CLOSE_LOSS) : bjPickRandom(BJ_LOSE_COMMENTS);
      return {
        result: 'lose', winnings: 0, flavor: flavor,
        msg: '{=r' + label + ': ' + playerTotal + ' vs ' + dealerTotal + '. Lose ' + bet + '.'
      };
    }
    flavor = bjPickRandom(BJ_PUSH_COMMENTS);
    return {
      result: 'push', winnings: bet, flavor: flavor,
      msg: '{=b' + label + ': ' + playerTotal + ' vs ' + dealerTotal + '. Push!'
    };
  }
  function sendResultWithFlavor(result: { msg: string; flavor: string }): void {
    sm.sendGameResponse(name, result.msg, w);
    if (result.flavor && Math.random() < 0.6) {
      sm.sendGameResponse(name, result.flavor, w);
    }
  }
  function applyStreakAfterResolve(won: boolean, lost: boolean): void {
    if (won) {
      session.winStreak++;
      session.lossStreak = 0;
      session.totalWins++;
      sm.recordGame(name, true, 'blackjack');
    } else if (lost) {
      if (session.winStreak >= 3) {
        sm.sendGameResponse(name, bjPickRandom(BJ_STREAK_BROKEN) + session.winStreak + '.', w);
      }
      session.lossStreak++;
      session.winStreak = 0;
      session.totalLosses++;
      if (session.lossStreak === 3 || session.lossStreak === 5) {
        sm.sendGameResponse(name, bjPickRandom(BJ_LOSS_STREAK), w);
      }
      sm.recordGame(name, false, 'blackjack');
    }
  }
  const mainResult = resolveHand(session.playerHand, session.currentBet, session.splitHand ? 'Hand 1' : 'Result');
  session.playerChips += mainResult.winnings;
  sendResultWithFlavor(mainResult);
  let anyWin = mainResult.result === 'win';
  if (session.splitHand) {
    const splitBet = session.currentBet;
    setTimeout(function () {
      const splitResult = resolveHand(session.splitHand, splitBet, 'Hand 2');
      session.playerChips += splitResult.winnings;
      sendResultWithFlavor(splitResult);
      if (splitResult.result === 'win') anyWin = true;
      const allLose = mainResult.result === 'lose' && splitResult.result === 'lose';
      setTimeout(function () {
        applyStreakAfterResolve(anyWin, allLose);
        if (anyWin) {
          const bonus = bjApplyStreakBonus(session, mainResult.winnings + splitResult.winnings);
          const extra = bonus - (mainResult.winnings + splitResult.winnings);
          if (extra > 0) session.playerChips += extra;
        }
        bjNextHand(session);
      }, 800);
    }, 800);
  } else {
    setTimeout(function () {
      applyStreakAfterResolve(mainResult.result === 'win', mainResult.result === 'lose');
      if (mainResult.result === 'win') {
        const bonus = bjApplyStreakBonus(session, mainResult.winnings);
        const extra = bonus - mainResult.winnings;
        if (extra > 0) session.playerChips += extra;
      }
      bjNextHand(session);
    }, 800);
  }
}
function bjNextHand(session: any): void {
  if (!S.activeGames.has(session.playerName.toLowerCase())) return;
  if (session.playerChips <= 0) {
    bjSaveChips(session.playerName, 0);
    sm.sendGameResponse(session.playerName, '{=rOut of chips! Game over.', session.isWhisper);
    sm.cancelSession(session.playerName);
    sm.emitActivity(session.playerName, 'blackjack', 'busted out');
    return;
  }
  session.handNumber++;
  bjCheckMilestone(session, session.chipsBeforeHand);
  bjSaveChips(session.playerName, session.playerChips);
  const record = session.totalWins + 'W-' + session.totalLosses + 'L';
  sm.sendGameResponse(session.playerName, '{=cChips: ' + session.playerChips + ' | ' + record, session.isWhisper);
  setTimeout(function () {
    if (S.activeGames.has(session.playerName.toLowerCase())) {
      bjPromptBet(session);
    }
  }, 3000);
}
function bjSoloTimeout(playerName: string): void {
  const key = playerName.toLowerCase();
  const session = S.activeGames.get(key);
  if (!session || session.gameType !== 'blackjack') return;
  bjSaveChips(playerName, session.playerChips);
  sm.sendGameResponse(playerName, '{=rBlackjack timed out.', session.isWhisper);
  sm.cancelSession(playerName);
  sm.emitActivity(playerName, 'blackjack', 'timed out');
}

// -- Group Blackjack --

export function startBjLobby(sender: string, args: string): void {
  if (S.bjGroupSession) {
    sm.sendGameResponse(sender, 'A blackjack table is already open.', false);
    return;
  }
  const existing = S.activeGames.get(sender.toLowerCase());
  if (existing) {
    sm.sendGameResponse(sender, 'Finish your current game first.', false);
    return;
  }
  let maxSeats = 4;
  if (args) {
    const parsed = parseInt(args);
    if (parsed >= 2 && parsed <= 5) maxSeats = parsed;
  }
  sm.setCooldown(sender);
  S.bjGroupSession = {
    hostPlayer: sender,
    phase: 'lobby',
    seats: [{
      name: sender,
      chips: BJ_STARTING_CHIPS,
      hand: [] as string[],
      splitHand: null,
      playingSplit: false,
      currentBet: 0,
      standing: false,
      busted: false,
      eliminated: false,
      hasActed: false
    }],
    maxSeats: maxSeats,
    deck: bjCreateDeck(),
    deckIndex: 0,
    dealerHand: [] as string[],
    currentTurnIndex: 0,
    handNumber: 0,
    maxHands: BJ_GROUP_MAX_HANDS,
    bettingCount: 0,
    actionTimer: null as any,
    lobbyTimer: setTimeout(function () {
      bjGroupLobbyTimeout();
    }, BJ_GROUP_LOBBY_TIMEOUT)
  };
  const p = S.config.commandPrefix || '!';
  sm.sendGameResponse(sender, 'Blackjack table open! ' + p + 'bjjoin (1/' + maxSeats + ')', false);
  sm.emitActivity(sender, 'blackjack', 'opened blackjack lobby');
}
export function joinBjLobby(sender: string): void {
  if (!S.bjGroupSession) {
    sm.sendGameResponse(sender, 'No blackjack table open.', false);
    return;
  }
  if (S.bjGroupSession.phase !== 'lobby') {
    sm.sendGameResponse(sender, 'Game already in progress.', false);
    return;
  }
  for (let i = 0; i < S.bjGroupSession.seats.length; i++) {
    if (S.bjGroupSession.seats[i].name.toLowerCase() === sender.toLowerCase()) {
      sm.sendGameResponse(sender, 'You are already seated.', false);
      return;
    }
  }
  const existing = S.activeGames.get(sender.toLowerCase());
  if (existing) {
    sm.sendGameResponse(sender, 'Finish your current game first.', false);
    return;
  }
  S.bjGroupSession.seats.push({
    name: sender,
    chips: BJ_STARTING_CHIPS,
    hand: [] as string[],
    splitHand: null,
    playingSplit: false,
    currentBet: 0,
    standing: false,
    busted: false,
    eliminated: false,
    hasActed: false
  });
  const count = S.bjGroupSession.seats.length;
  const max = S.bjGroupSession.maxSeats;
  sm.sendGameResponse(sender, sender + ' joins blackjack! (' + count + '/' + max + ')', false);
  sm.emitActivity(sender, 'blackjack', 'joined blackjack lobby');
  if (count >= max) {
    bjGroupStartGame();
  }
}
export function forceStartBj(sender: string): void {
  if (!S.bjGroupSession) {
    sm.sendGameResponse(sender, 'No blackjack table open.', false);
    return;
  }
  if (S.bjGroupSession.hostPlayer.toLowerCase() !== sender.toLowerCase()) {
    sm.sendGameResponse(sender, 'Only the host can start.', false);
    return;
  }
  if (S.bjGroupSession.phase !== 'lobby') {
    sm.sendGameResponse(sender, 'Game already started.', false);
    return;
  }
  if (S.bjGroupSession.seats.length < 2) {
    sm.sendGameResponse(sender, 'Need at least 2 players.', false);
    return;
  }
  bjGroupStartGame();
}
function bjGroupLobbyTimeout(): void {
  if (!S.bjGroupSession || S.bjGroupSession.phase !== 'lobby') return;
  if (S.bjGroupSession.seats.length >= 2) {
    sm.sendGameResponse(S.bjGroupSession.hostPlayer, 'Lobby timer up. Dealing!', false);
    bjGroupStartGame();
  } else {
    sm.sendGameResponse(S.bjGroupSession.hostPlayer, 'Not enough players. Cancelled.', false);
    bjGroupCleanup();
  }
}
function bjGroupStartGame(): void {
  if (!S.bjGroupSession) return;
  if (S.bjGroupSession.lobbyTimer) {
    clearTimeout(S.bjGroupSession.lobbyTimer);
    S.bjGroupSession.lobbyTimer = null;
  }
  const names = S.bjGroupSession.seats.map(function (s: any) {
    return s.name;
  }).join(', ');
  sm.sendGameResponse(S.bjGroupSession.hostPlayer, 'Blackjack starting! ' + names, false);
  sm.emitActivity(S.bjGroupSession.hostPlayer, 'blackjack', 'group game started');
  setTimeout(function () {
    bjGroupDealHand();
  }, 1500);
}
function bjGroupDealHand(): void {
  const gs = S.bjGroupSession;
  if (!gs) return;
  gs.handNumber++;
  if (gs.handNumber > gs.maxHands) {
    bjGroupEndByLimit();
    return;
  }
  if (gs.deckIndex > 30) {
    gs.deck = bjCreateDeck();
    gs.deckIndex = 0;
  }
  gs.dealerHand = [];
  gs.phase = 'betting';
  gs.bettingCount = 0;
  let activePlayers = 0;
  for (let i = 0; i < gs.seats.length; i++) {
    if (!gs.seats[i].eliminated) {
      gs.seats[i].hand = [];
      gs.seats[i].splitHand = null;
      gs.seats[i].playingSplit = false;
      gs.seats[i].currentBet = 0;
      gs.seats[i].standing = false;
      gs.seats[i].busted = false;
      gs.seats[i].hasActed = false;
      activePlayers++;
    }
  }
  if (activePlayers < 2) {
    bjGroupEndGame();
    return;
  }
  sm.sendGameResponse(gs.hostPlayer, '--- Hand ' + gs.handNumber + '/' + gs.maxHands + ' ---', false);
  setTimeout(function () {
    bjGroupPromptBets();
  }, 800);
}
function bjGroupPromptBets(): void {
  const gs = S.bjGroupSession;
  if (!gs) return;
  const p = S.config.commandPrefix || '!';
  sm.sendGameResponse(gs.hostPlayer, 'Place bets! ' + p + 'bet <amount>', false);
  setTimeout(function () {
    let chipList = '';
    for (let i = 0; i < gs.seats.length; i++) {
      if (!gs.seats[i].eliminated) {
        if (chipList) chipList += ', ';
        chipList += gs.seats[i].name + ':' + gs.seats[i].chips;
      }
    }
    sm.sendGameResponse(gs.hostPlayer, chipList, false);
  }, 800);
  if (gs.actionTimer) clearTimeout(gs.actionTimer);
  gs.actionTimer = setTimeout(function () {
    bjGroupAutoBets();
  }, BJ_GROUP_ACTION_TIMEOUT);
}
export function bjGroupHandleBet(sender: string, amount: number): boolean {
  const gs = S.bjGroupSession;
  if (!gs || gs.phase !== 'betting') return false;
  let seat: any = null;
  for (let i = 0; i < gs.seats.length; i++) {
    if (gs.seats[i].name.toLowerCase() === sender.toLowerCase() && !gs.seats[i].eliminated) {
      seat = gs.seats[i];
      break;
    }
  }
  if (!seat) return false;
  if (seat.currentBet > 0) {
    sm.sendGameResponse(sender, sender + ' already bet!', false);
    return true;
  }
  const bet = Math.max(BJ_MIN_BET, Math.min(amount, seat.chips, BJ_MAX_BET));
  seat.currentBet = bet;
  seat.chips -= bet;
  gs.bettingCount++;
  sm.sendGameResponse(sender, sender + ' bets ' + bet + '.', false);
  let activeCount = 0;
  for (let j = 0; j < gs.seats.length; j++) {
    if (!gs.seats[j].eliminated) activeCount++;
  }
  if (gs.bettingCount >= activeCount) {
    if (gs.actionTimer) clearTimeout(gs.actionTimer);
    bjGroupDealCards();
  }
  return true;
}
function bjGroupAutoBets(): void {
  const gs = S.bjGroupSession;
  if (!gs || gs.phase !== 'betting') return;
  for (let i = 0; i < gs.seats.length; i++) {
    const seat = gs.seats[i];
    if (!seat.eliminated && seat.currentBet === 0) {
      const bet = Math.min(BJ_MIN_BET, seat.chips);
      seat.currentBet = bet;
      seat.chips -= bet;
    }
  }
  sm.sendGameResponse(gs.hostPlayer, 'Auto-bets placed. Dealing!', false);
  bjGroupDealCards();
}
function bjGroupDealCards(): void {
  const gs = S.bjGroupSession;
  if (!gs) return;
  gs.phase = 'playing';
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < gs.seats.length; i++) {
      if (!gs.seats[i].eliminated) {
        gs.seats[i].hand.push(bjDeal(gs));
      }
    }
    gs.dealerHand.push(bjDeal(gs));
  }
  sm.sendGameResponse(gs.hostPlayer, 'Dealer shows: ' + gs.dealerHand[0], false);
  setTimeout(function () {
    let cardDelay = 0;
    for (let j = 0; j < gs.seats.length; j++) {
      if (!gs.seats[j].eliminated) {
        (function (seat: any, d: number) {
          setTimeout(function () {
            sm.sendGameResponse(gs.hostPlayer, seat.name + ': ' + bjFormatHand(seat.hand), false);
          }, d);
        })(gs.seats[j], cardDelay);
        cardDelay += 800;
      }
    }
    if (bjIsBlackjack(gs.dealerHand)) {
      setTimeout(function () {
        sm.sendGameResponse(gs.hostPlayer, 'Dealer blackjack! ' + bjFormatHand(gs.dealerHand), false);
        bjGroupResolveAll();
      }, 1500);
      return;
    }
    setTimeout(function () {
      gs.currentTurnIndex = -1;
      bjGroupNextTurn();
    }, 1500);
  }, 800);
}
function bjGroupNextTurn(): void {
  const gs = S.bjGroupSession;
  if (!gs) return;
  let found = false;
  for (let i = gs.currentTurnIndex + 1; i < gs.seats.length; i++) {
    const seat = gs.seats[i];
    if (!seat.eliminated && !seat.standing && !seat.busted) {
      if (bjIsBlackjack(seat.hand)) {
        sm.sendGameResponse(gs.hostPlayer, seat.name + ': Blackjack!', false);
        seat.standing = true;
        continue;
      }
      gs.currentTurnIndex = i;
      found = true;
      break;
    }
  }
  if (!found) {
    bjGroupDealerPlay();
    return;
  }
  const current = gs.seats[gs.currentTurnIndex];
  sm.sendGameResponse(gs.hostPlayer, current.name + ': ' + bjFormatHand(current.hand) + ' hit/stand', false);
  if (gs.actionTimer) clearTimeout(gs.actionTimer);
  gs.actionTimer = setTimeout(function () {
    bjGroupActionTimeout();
  }, BJ_GROUP_ACTION_TIMEOUT);
}
export function handleGroupBjMessage(sender: string, message: string): boolean {
  const gs = S.bjGroupSession;
  if (!gs || gs.phase !== 'playing') return false;
  const seat = gs.seats[gs.currentTurnIndex];
  if (!seat || seat.name.toLowerCase() !== sender.toLowerCase()) return false;
  const msg = message.trim().toLowerCase();
  if (['hit', 'h', 'stand', 's', 'stay'].indexOf(msg) === -1) return false;
  if (gs.actionTimer) clearTimeout(gs.actionTimer);
  if (msg === 'hit' || msg === 'h') {
    seat.hand.push(bjDeal(gs));
    const total = bjHandTotal(seat.hand);
    sm.sendGameResponse(gs.hostPlayer, seat.name + ': ' + bjFormatHand(seat.hand), false);
    if (total > 21) {
      setTimeout(function () {
        sm.sendGameResponse(gs.hostPlayer, seat.name + ' busts!', false);
        seat.busted = true;
        bjGroupNextTurn();
      }, 800);
    } else if (total === 21) {
      setTimeout(function () {
        sm.sendGameResponse(gs.hostPlayer, seat.name + ': 21! Standing.', false);
        seat.standing = true;
        bjGroupNextTurn();
      }, 800);
    } else {
      setTimeout(function () {
        sm.sendGameResponse(gs.hostPlayer, seat.name + ': hit/stand', false);
        if (gs.actionTimer) clearTimeout(gs.actionTimer);
        gs.actionTimer = setTimeout(function () {
          bjGroupActionTimeout();
        }, BJ_GROUP_ACTION_TIMEOUT);
      }, 800);
    }
  } else {
    seat.standing = true;
    sm.sendGameResponse(gs.hostPlayer, seat.name + ' stands.', false);
    setTimeout(function () {
      bjGroupNextTurn();
    }, 800);
  }
  return true;
}
function bjGroupActionTimeout(): void {
  const gs = S.bjGroupSession;
  if (!gs) return;
  const seat = gs.seats[gs.currentTurnIndex];
  if (!seat) return;
  sm.sendGameResponse(gs.hostPlayer, seat.name + ' timed out (stand).', false);
  seat.standing = true;
  bjGroupNextTurn();
}
function bjGroupDealerPlay(): void {
  const gs = S.bjGroupSession;
  if (!gs) return;
  gs.phase = 'dealer';
  let allBusted = true;
  for (let i = 0; i < gs.seats.length; i++) {
    if (!gs.seats[i].eliminated && !gs.seats[i].busted) {
      allBusted = false;
      break;
    }
  }
  sm.sendGameResponse(gs.hostPlayer, 'Dealer: ' + bjFormatHand(gs.dealerHand), false);
  if (allBusted) {
    setTimeout(function () {
      sm.sendGameResponse(gs.hostPlayer, 'All players busted!', false);
      bjGroupResolveAll();
    }, 800);
    return;
  }
  function dealerDraw(): void {
    const total = bjHandTotal(gs.dealerHand);
    if (total < 17) {
      setTimeout(function () {
        gs.dealerHand.push(bjDeal(gs));
        sm.sendGameResponse(gs.hostPlayer, 'Dealer draws: ' + bjFormatHand(gs.dealerHand), false);
        dealerDraw();
      }, 1200);
    } else {
      setTimeout(function () {
        bjGroupResolveAll();
      }, 800);
    }
  }
  setTimeout(function () {
    dealerDraw();
  }, 800);
}
function bjGroupResolveAll(): void {
  const gs = S.bjGroupSession;
  if (!gs) return;
  const dealerTotal = bjHandTotal(gs.dealerHand);
  const dealerBust = dealerTotal > 21;
  const dealerBJ = bjIsBlackjack(gs.dealerHand);
  let delay = 0;
  for (let i = 0; i < gs.seats.length; i++) {
    const seat = gs.seats[i];
    if (seat.eliminated) continue;
    (function (s: any, d: number) {
      setTimeout(function () {
        const playerTotal = bjHandTotal(s.hand);
        const playerBJ = bjIsBlackjack(s.hand);
        if (s.busted) {
          sm.sendGameResponse(gs.hostPlayer, s.name + ': Bust. -' + s.currentBet, false);
          sm.recordGame(s.name, false, 'blackjack');
        } else if (playerBJ && !dealerBJ) {
          const win = Math.floor(s.currentBet * 1.5);
          s.chips += s.currentBet + win;
          sm.sendGameResponse(gs.hostPlayer, s.name + ': BJ! +' + win, false);
          sm.recordGame(s.name, true, 'blackjack');
        } else if (dealerBust) {
          s.chips += s.currentBet * 2;
          sm.sendGameResponse(gs.hostPlayer, s.name + ': Dealer bust! +' + s.currentBet, false);
          sm.recordGame(s.name, true, 'blackjack');
        } else if (playerTotal > dealerTotal) {
          s.chips += s.currentBet * 2;
          sm.sendGameResponse(gs.hostPlayer, s.name + ': ' + playerTotal + ' beats ' + dealerTotal + '! +' + s.currentBet, false);
          sm.recordGame(s.name, true, 'blackjack');
        } else if (playerTotal < dealerTotal) {
          sm.sendGameResponse(gs.hostPlayer, s.name + ': ' + playerTotal + ' vs ' + dealerTotal + '. -' + s.currentBet, false);
          sm.recordGame(s.name, false, 'blackjack');
        } else if (dealerBJ && !playerBJ) {
          sm.sendGameResponse(gs.hostPlayer, s.name + ': Dealer BJ. -' + s.currentBet, false);
          sm.recordGame(s.name, false, 'blackjack');
        } else {
          s.chips += s.currentBet;
          sm.sendGameResponse(gs.hostPlayer, s.name + ': Push. Bet returned.', false);
        }
      }, d);
    })(seat, delay);
    delay += 800;
  }
  setTimeout(function () {
    bjGroupCheckEliminations();
  }, delay + 500);
}
function bjGroupCheckEliminations(): void {
  const gs = S.bjGroupSession;
  if (!gs) return;
  const eliminated: any[] = [];
  const alive: any[] = [];
  for (let i = 0; i < gs.seats.length; i++) {
    if (gs.seats[i].eliminated) continue;
    if (gs.seats[i].chips <= 0) {
      gs.seats[i].eliminated = true;
      eliminated.push(gs.seats[i]);
      sm.emitActivity(gs.seats[i].name, 'blackjack', 'eliminated');
    } else {
      alive.push(gs.seats[i]);
    }
  }
  if (eliminated.length > 0) {
    const names = eliminated.map(function (s: any) {
      return s.name;
    }).join(', ');
    sm.sendGameResponse(gs.hostPlayer, names + ' eliminated!', false);
  }
  if (alive.length <= 1) {
    bjGroupEndGame();
  } else {
    gs.phase = 'between_hands';
    setTimeout(function () {
      bjGroupDealHand();
    }, BJ_GROUP_BETWEEN_HANDS);
  }
}
function bjGroupEndByLimit(): void {
  const gs = S.bjGroupSession;
  if (!gs) return;
  const alive = gs.seats.filter(function (s: any) {
    return !s.eliminated;
  });
  alive.sort(function (a: any, b: any) {
    return b.chips - a.chips;
  });
  sm.sendGameResponse(gs.hostPlayer, 'Max hands reached! Results:', false);
  let delay = 800;
  for (let i = 0; i < alive.length; i++) {
    (function (seat: any, place: number, d: number) {
      setTimeout(function () {
        sm.sendGameResponse(gs.hostPlayer, place + 1 + '. ' + seat.name + ' (' + seat.chips + ' chips)', false);
      }, d);
    })(alive[i], i, delay);
    delay += 800;
  }
  setTimeout(function () {
    if (alive.length > 0) {
      sm.sendGameResponse(gs.hostPlayer, 'Winner: ' + alive[0].name + '! GG!', false);
      sm.emitActivity(alive[0].name, 'blackjack', 'won group blackjack');
    }
    bjGroupCleanup();
  }, delay + 500);
}
function bjGroupEndGame(): void {
  const gs = S.bjGroupSession;
  if (!gs) return;
  const alive = gs.seats.filter(function (s: any) {
    return !s.eliminated;
  });
  if (alive.length === 1) {
    sm.sendGameResponse(gs.hostPlayer, 'Winner: ' + alive[0].name + ' (' + alive[0].chips + ' chips)! GG!', false);
    sm.emitActivity(alive[0].name, 'blackjack', 'won group blackjack');
  } else {
    sm.sendGameResponse(gs.hostPlayer, 'Blackjack game over!', false);
  }
  bjGroupCleanup();
}
export function leaveBj(sender: string, isWhisper: boolean): void {
  const key = sender.toLowerCase();
  const session = S.activeGames.get(key);
  if (session && session.gameType === 'blackjack') {
    bjSaveChips(sender, session.playerChips);
    sm.sendGameResponse(sender, 'Left blackjack. Chips:' + session.playerChips, isWhisper);
    sm.cancelSession(sender);
    sm.emitActivity(sender, 'blackjack', 'quit');
    return;
  }
  if (S.bjGroupSession) {
    const gs = S.bjGroupSession;
    for (let i = 0; i < gs.seats.length; i++) {
      if (gs.seats[i].name.toLowerCase() === key && !gs.seats[i].eliminated) {
        gs.seats[i].eliminated = true;
        sm.sendGameResponse(sender, sender + ' left blackjack.', false);
        sm.emitActivity(sender, 'blackjack', 'left');
        if (gs.phase === 'lobby') {
          gs.seats.splice(i, 1);
          sm.sendGameResponse(gs.hostPlayer, '(' + gs.seats.length + '/' + gs.maxSeats + ' seats)', false);
          if (gs.seats.length === 0) bjGroupCleanup();
        } else {
          const alive = gs.seats.filter(function (s: any) {
            return !s.eliminated;
          });
          if (alive.length <= 1) {
            bjGroupEndGame();
          } else if (gs.phase === 'playing' && gs.currentTurnIndex === i) {
            if (gs.actionTimer) clearTimeout(gs.actionTimer);
            gs.currentTurnIndex = i - 1;
            bjGroupNextTurn();
          }
        }
        return;
      }
    }
  }
  sm.sendGameResponse(sender, 'You are not in a blackjack game.', isWhisper);
}
export function stopBjGame(sender: string): void {
  if (!S.bjGroupSession) {
    sm.sendGameResponse(sender, 'No blackjack game active.', false);
    return;
  }
  if (S.bjGroupSession.hostPlayer.toLowerCase() !== sender.toLowerCase()) {
    sm.sendGameResponse(sender, 'Only the host can stop.', false);
    return;
  }
  sm.sendGameResponse(sender, 'Blackjack cancelled by host.', false);
  sm.emitActivity(sender, 'blackjack', 'cancelled');
  bjGroupCleanup();
}
export function showBjStatus(sender: string, isWhisper: boolean): void {
  const session = S.activeGames.get(sender.toLowerCase());
  if (session && session.gameType === 'blackjack') {
    sm.sendGameResponse(sender, 'Hand ' + session.handNumber + ' | Chips:' + session.playerChips + ' Bet:' + session.currentBet, isWhisper);
    return;
  }
  if (S.bjGroupSession) {
    const gs = S.bjGroupSession;
    if (gs.phase === 'lobby') {
      sm.sendGameResponse(sender, 'BJ lobby: ' + gs.seats.length + '/' + gs.maxSeats + ' seats', isWhisper);
    } else {
      const alive = gs.seats.filter(function (s: any) {
        return !s.eliminated;
      });
      sm.sendGameResponse(sender, 'Hand ' + gs.handNumber + '/' + gs.maxHands + ' | ' + alive.length + ' players', isWhisper);
    }
    return;
  }
  sm.sendGameResponse(sender, 'No blackjack game active.', isWhisper);
}
function bjGroupCleanup(): void {
  if (S.bjGroupSession) {
    if (S.bjGroupSession.actionTimer) clearTimeout(S.bjGroupSession.actionTimer);
    if (S.bjGroupSession.lobbyTimer) clearTimeout(S.bjGroupSession.lobbyTimer);
    S.bjGroupSession = null;
  }
}
export function getBjStatus(): any {
  if (!S.bjGroupSession) return null;
  const gs = S.bjGroupSession;
  return {
    phase: gs.phase,
    handNumber: gs.handNumber,
    maxHands: gs.maxHands,
    seats: gs.seats.map(function (s: any) {
      return {
        name: s.name,
        chips: s.chips,
        busted: s.busted,
        eliminated: s.eliminated
      };
    })
  };
}
