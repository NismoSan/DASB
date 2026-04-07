// -- Host Mode (Game Show) ------------------------------------------------
import S from './state';
import * as sm from './session-manager';
import * as content from './content';
import * as openai from './openai';

const HOST_INTROS: { [key: string]: string[] } = {
  trivia: [
    'Gather round, Aislings! Trivia hour begins!',
    'The oracle calls! Time for trivia!',
    'Step up, Aislings! Trivia challenge!',
    'Attention Temuair! Trivia time!'
  ],
  riddle: [
    'The sage speaks! Riddle hour begins!',
    'Gather round for riddles, Aislings!',
    'Who dares solve the sage\'s riddles?',
    'Riddle challenge begins, Aislings!'
  ],
  scramble: [
    'Unscramble if you can, Aislings!',
    'Word scramble challenge begins!',
    'Scramble hour! Test your wit!',
    'Letters await! Scramble time, Aislings!'
  ],
  numberguess: [
    'Guess the number, Aislings!',
    'Number challenge begins!',
    'Think fast! Number guessing time!',
    'Can you guess it? Game on, Aislings!'
  ],
  hangman: [
    'Hangman begins! Guess the letters, Aislings!',
    'The gallows await! Hangman time!',
    'Save the Aisling! Hangman challenge!',
    'Letter by letter! Hangman starts now!'
  ]
};

export function handleHostStart(sender: string, args: string): void {
  if (S.hostSession) {
    const p = S.config.commandPrefix || '!';
    if (S.sendWhisper) S.sendWhisper(sender, 'A hosted game is already running. Use ' + p + 'hoststop first.');
    return;
  }

  const parts = args.trim().split(/\s+/);
  const gameType = (parts[0] || 'trivia').toLowerCase();
  let rounds = parseInt(parts[1]) || 5;

  if (['trivia', 'riddle', 'scramble', 'numberguess', 'hangman'].indexOf(gameType) === -1) {
    if (S.sendWhisper) S.sendWhisper(sender, 'Valid types: trivia, riddle, scramble, numberguess, hangman');
    return;
  }
  if (rounds < 1) rounds = 1;
  if (rounds > 20) rounds = 20;

  S.hostSession = {
    gameType: gameType,
    totalRounds: rounds,
    currentRound: 0,
    hostPlayer: sender,
    leaderboard: new Map<string, { name: string; points: number }>(),
    currentQuestion: null as any,
    questionActive: false,
    timeoutTimer: null as any,
    roundTimer: null as any,
    delayBetweenRounds: S.HOST_DELAY_BETWEEN
  };

  const intros = HOST_INTROS[gameType] || HOST_INTROS.trivia;
  const intro = intros[Math.floor(Math.random() * intros.length)];

  if (S.sendWhisper) S.sendWhisper(sender, 'Starting ' + rounds + ' rounds of ' + gameType + '!');

  sm.sendGameResponse(null, intro, false);
  setTimeout(function () {
    sm.sendGameResponse(null, rounds + ' rounds of ' + gameType + '! First to answer wins!', false);
  }, 1200);

  sm.emitActivity(sender, 'host-' + gameType, 'started ' + rounds + ' rounds');
  if (S.ioRef) S.ioRef.emit('chatgames:hostUpdate', getHostStatus());

  setTimeout(function () {
    hostNextRound();
  }, 3000);
}

export function handleHostStop(sender: string): void {
  if (!S.hostSession) {
    if (S.sendWhisper) S.sendWhisper(sender, 'No hosted game is running.');
    return;
  }
  sm.sendGameResponse(null, 'Game over! The host has ended the game.', false);
  hostShowFinalLeaderboard();
  sm.emitActivity(sender, 'host', 'stopped the game');
  hostCleanup();
}

export function handleHostSkip(sender: string): void {
  if (!S.hostSession) {
    if (S.sendWhisper) S.sendWhisper(sender, 'No hosted game is running.');
    return;
  }
  if (S.hostSession.questionActive && S.hostSession.currentQuestion) {
    sm.sendGameResponse(null, 'Skipped! Answer: ' + S.hostSession.currentQuestion.answer, false);
    S.hostSession.questionActive = false;
    clearTimeout(S.hostSession.timeoutTimer);
    sm.emitActivity(sender, 'host', 'skipped round ' + S.hostSession.currentRound);
    setTimeout(function () { hostNextRound(); }, 2000);
  } else {
    if (S.sendWhisper) S.sendWhisper(sender, 'No active question to skip.');
  }
}

function hostNextRound(): void {
  if (!S.hostSession) return;

  S.hostSession.currentRound++;
  if (S.hostSession.currentRound > S.hostSession.totalRounds) {
    const finishedHost = S.hostSession.hostPlayer;
    const finishedType = S.hostSession.gameType;
    sm.sendGameResponse(null, 'Final round complete! Here are the results:', false);
    setTimeout(function () {
      hostShowFinalLeaderboard();
      sm.emitActivity(finishedHost, 'host-' + finishedType, 'finished all rounds');
      hostCleanup();
    }, 1500);
    return;
  }

  const roundLabel = 'Round ' + S.hostSession.currentRound + '/' + S.hostSession.totalRounds;

  if (S.hostSession.gameType === 'trivia') {
    hostGenerateTrivia(roundLabel);
  } else if (S.hostSession.gameType === 'riddle') {
    hostGenerateRiddle(roundLabel);
  } else if (S.hostSession.gameType === 'scramble') {
    hostGenerateScramble(roundLabel);
  } else if (S.hostSession.gameType === 'numberguess') {
    hostGenerateNumberGuess(roundLabel);
  } else if (S.hostSession.gameType === 'hangman') {
    hostGenerateHangman(roundLabel);
  }
}

function hostGenerateTrivia(roundLabel: string): void {
  content.generateTrivia(50, function (_err: any, data: any) {
    hostSetQuestion(roundLabel, data.question, data.answer, data.hint);
  });
}

function hostGenerateRiddle(roundLabel: string): void {
  content.generateRiddle(50, function (_err: any, data: any) {
    hostSetQuestion(roundLabel, data.question, data.answer, data.hint);
  });
}

function hostGenerateScramble(roundLabel: string): void {
  content.generateScramble(function (_err: any, data: any) {
    hostSetQuestion(roundLabel, data.question, data.answer, data.hint);
  });
}

function hostGenerateNumberGuess(roundLabel: string): void {
  S.hostAnswerQueue = [];
  S.hostAnswerProcessing = false;
  const data = content.generateNumberGuess();
  S.hostSession.currentQuestion = {
    question: '1-100',
    answer: data.answer,
    hint: data.hint,
    targetNumber: data.targetNumber,
    guessHigh: 100,
    guessLow: 1
  };
  S.hostSession.questionActive = true;

  sm.sendGameResponse(null, roundLabel + ': I picked a number 1-100!', false);
  setTimeout(function () {
    sm.sendGameResponse(null, 'Type your guess! Exact number wins!', false);
  }, 800);

  S.hostSession.timeoutTimer = setTimeout(function () {
    hostRoundTimeout();
  }, S.HOST_ROUND_TIMEOUT);

  if (S.ioRef) S.ioRef.emit('chatgames:hostUpdate', getHostStatus());
  sm.emitActivity('Host', 'host-numberguess', roundLabel);
}

function hostGenerateHangman(roundLabel: string): void {
  content.generateHangman(function (_err: any, data: any) {
    S.hostAnswerQueue = [];
    S.hostAnswerProcessing = false;
    S.hostSession.currentQuestion = {
      question: data.question,
      answer: data.answer,
      hint: data.hint,
      guessedLetters: [] as string[],
      wrongCount: 0,
      maxWrong: 6,
      revealedWord: data.question
    };
    S.hostSession.questionActive = true;

    sm.sendGameResponse(null, roundLabel + ' Hangman: ' + data.question, false);
    setTimeout(function () {
      sm.sendGameResponse(null, 'Guess a letter! (' + (data.hint || 'No hint') + ')', false);
    }, 800);

    S.hostSession.timeoutTimer = setTimeout(function () {
      hostRoundTimeout();
    }, S.HOST_ROUND_TIMEOUT * 2);

    if (S.ioRef) S.ioRef.emit('chatgames:hostUpdate', getHostStatus());
    sm.emitActivity('Host', 'host-hangman', roundLabel);
  });
}

function hostSetQuestion(roundLabel: string, question: string, answer: string, hint: string): void {
  if (!S.hostSession) return;

  S.hostAnswerQueue = [];
  S.hostAnswerProcessing = false;

  S.hostSession.currentQuestion = {
    question: question,
    answer: answer,
    hint: hint || 'No hint'
  };
  S.hostSession.questionActive = true;

  const prefix = S.hostSession.gameType === 'scramble' ? 'Unscramble' : (S.hostSession.gameType === 'riddle' ? 'Riddle' : 'Q');
  sm.sendGameResponse(null, roundLabel + ' ' + prefix + ': ' + question, false);

  S.hostSession.timeoutTimer = setTimeout(function () {
    hostRoundTimeout();
  }, S.HOST_ROUND_TIMEOUT);

  if (S.ioRef) S.ioRef.emit('chatgames:hostUpdate', getHostStatus());
  sm.emitActivity('Host', 'host-' + S.hostSession.gameType, roundLabel);
}

export function handleHostAnswer(sender: string, message: string): boolean {
  if (!S.hostSession || !S.hostSession.questionActive || !S.hostSession.currentQuestion) return false;

  if (S.hostSession.gameType === 'numberguess') {
    const num = parseInt(message.trim(), 10);
    if (isNaN(num) || num < 1 || num > 100) return false;
  }

  if (S.hostSession.gameType === 'hangman') {
    if (!/^[a-z]+$/i.test(message.trim())) return false;
  }

  S.hostAnswerQueue.push({ sender: sender, message: message });
  if (!S.hostAnswerProcessing) {
    processNextAnswer();
  }
  return true;
}

function processNextAnswer(): void {
  if (S.hostAnswerQueue.length === 0) {
    S.hostAnswerProcessing = false;
    return;
  }
  if (!S.hostSession || !S.hostSession.questionActive || !S.hostSession.currentQuestion) {
    S.hostAnswerQueue = [];
    S.hostAnswerProcessing = false;
    return;
  }

  S.hostAnswerProcessing = true;
  const entry = S.hostAnswerQueue.shift()!;
  const gameType = S.hostSession.gameType;

  if (gameType === 'numberguess') {
    processNumberGuessEntry(entry);
  } else if (gameType === 'scramble') {
    processScrambleEntry(entry);
  } else if (gameType === 'hangman') {
    processHangmanEntry(entry);
  } else {
    processTriviaRiddleEntry(entry);
  }
}

function processNumberGuessEntry(entry: { sender: string; message: string }): void {
  const num = parseInt(entry.message.trim(), 10);
  const target = S.hostSession.currentQuestion.targetNumber;

  if (num === target) {
    S.hostAnswerQueue = [];
    S.hostAnswerProcessing = false;
    hostRoundWon(entry.sender);
    return;
  }

  if (num < target) {
    sm.sendGameResponse(null, entry.sender + ' guessed ' + num + ' - too low!', false);
  } else {
    sm.sendGameResponse(null, entry.sender + ' guessed ' + num + ' - too high!', false);
  }

  setTimeout(function () { processNextAnswer(); }, 1200);
}

function processScrambleEntry(entry: { sender: string; message: string }): void {
  const playerText = entry.message.trim().toLowerCase();
  const correctAnswer = S.hostSession.currentQuestion.answer.toLowerCase();

  if (playerText === correctAnswer) {
    S.hostAnswerQueue = [];
    S.hostAnswerProcessing = false;
    hostRoundWon(entry.sender);
    return;
  }

  setTimeout(function () { processNextAnswer(); }, 400);
}

function processHangmanEntry(entry: { sender: string; message: string }): void {
  if (!S.hostSession || !S.hostSession.questionActive || !S.hostSession.currentQuestion) {
    S.hostAnswerQueue = [];
    S.hostAnswerProcessing = false;
    return;
  }
  const q = S.hostSession.currentQuestion;
  const input = entry.message.trim().toLowerCase();

  if (input.length > 1) {
    if (input === q.answer.toLowerCase()) {
      S.hostAnswerQueue = [];
      S.hostAnswerProcessing = false;
      hostRoundWon(entry.sender);
      return;
    }
    q.wrongCount++;
    if (q.wrongCount >= q.maxWrong) {
      S.hostSession.questionActive = false;
      clearTimeout(S.hostSession.timeoutTimer);
      sm.sendGameResponse(null, 'Hanged! The word was: ' + q.answer, false);
      S.hostAnswerQueue = [];
      S.hostAnswerProcessing = false;
      S.hostSession.roundTimer = setTimeout(function () { hostNextRound(); }, S.HOST_DELAY_BETWEEN);
      return;
    }
    sm.sendGameResponse(null, entry.sender + ' wrong word! (' + (q.maxWrong - q.wrongCount) + ' lives)', false);
    setTimeout(function () { processNextAnswer(); }, 800);
    return;
  }

  if (input.length === 1 && /^[a-z]$/.test(input)) {
    if (q.guessedLetters.indexOf(input) !== -1) {
      setTimeout(function () { processNextAnswer(); }, 100);
      return;
    }
    q.guessedLetters.push(input);

    if (q.answer.toLowerCase().indexOf(input) !== -1) {
      q.revealedWord = content.buildRevealedWord(q.answer, q.guessedLetters);
      if (q.revealedWord.indexOf('_') === -1) {
        S.hostAnswerQueue = [];
        S.hostAnswerProcessing = false;
        hostRoundWon(entry.sender);
        return;
      }
      sm.sendGameResponse(null, entry.sender + ' found [' + input + ']! ' + q.revealedWord, false);
    } else {
      q.wrongCount++;
      if (q.wrongCount >= q.maxWrong) {
        S.hostSession.questionActive = false;
        clearTimeout(S.hostSession.timeoutTimer);
        sm.sendGameResponse(null, 'Hanged! The word was: ' + q.answer, false);
        S.hostAnswerQueue = [];
        S.hostAnswerProcessing = false;
        S.hostSession.roundTimer = setTimeout(function () { hostNextRound(); }, S.HOST_DELAY_BETWEEN);
        return;
      }
      sm.sendGameResponse(null, entry.sender + ' miss [' + input + ']! ' + q.revealedWord + ' (' + (q.maxWrong - q.wrongCount) + ' lives)', false);
    }
  }
  setTimeout(function () { processNextAnswer(); }, 800);
}

function processTriviaRiddleEntry(entry: { sender: string; message: string }): void {
  if (!S.hostSession || !S.hostSession.questionActive || !S.hostSession.currentQuestion) {
    S.hostAnswerQueue = [];
    S.hostAnswerProcessing = false;
    return;
  }

  const answer = S.hostSession.currentQuestion.answer;
  const playerText = entry.message.trim().toLowerCase();
  const correctAnswer = answer.toLowerCase();

  if (playerText === correctAnswer) {
    S.hostAnswerQueue = [];
    S.hostAnswerProcessing = false;
    hostRoundWon(entry.sender);
    return;
  }

  openai.callOpenAIJson(
    'You are judging a trivia/riddle answer. The correct answer is "' + answer + '". The player answered "' + entry.message.trim() + '". Is this close enough to be correct (allowing typos, synonyms)? Return ONLY valid JSON: {"correct":true or false}',
    'Judge this answer.'
  ).then(function (result: any) {
    if (!S.hostSession || !S.hostSession.questionActive) {
      S.hostAnswerQueue = [];
      S.hostAnswerProcessing = false;
      return;
    }
    if (result.correct) {
      S.hostAnswerQueue = [];
      S.hostAnswerProcessing = false;
      hostRoundWon(entry.sender);
    } else {
      setTimeout(function () { processNextAnswer(); }, 400);
    }
  }).catch(function () {
    if (!S.hostSession || !S.hostSession.questionActive) {
      S.hostAnswerQueue = [];
      S.hostAnswerProcessing = false;
      return;
    }
    if (correctAnswer.indexOf(playerText) === 0 || playerText.indexOf(correctAnswer) === 0) {
      S.hostAnswerQueue = [];
      S.hostAnswerProcessing = false;
      hostRoundWon(entry.sender);
    } else {
      setTimeout(function () { processNextAnswer(); }, 400);
    }
  });
}

function hostRoundWon(winner: string): void {
  if (!S.hostSession || !S.hostSession.questionActive) return;

  S.hostSession.questionActive = false;
  clearTimeout(S.hostSession.timeoutTimer);

  const key = winner.toLowerCase();
  const entry = S.hostSession.leaderboard.get(key) || { name: winner, points: 0 };
  entry.points++;
  entry.name = winner;
  S.hostSession.leaderboard.set(key, entry);

  const answer = S.hostSession.currentQuestion ? S.hostSession.currentQuestion.answer : '???';
  sm.sendGameResponse(null, winner + ' got it! Answer: ' + answer + ' (+1 pt)', false);
  sm.emitActivity(winner, 'host-' + S.hostSession.gameType, 'won round ' + S.hostSession.currentRound);

  sm.recordGame(winner, true, S.hostSession.gameType);

  if (S.ioRef) S.ioRef.emit('chatgames:hostUpdate', getHostStatus());

  setTimeout(function () {
    hostNextRound();
  }, S.hostSession.delayBetweenRounds);
}

function hostRoundTimeout(): void {
  if (!S.hostSession || !S.hostSession.questionActive) return;

  S.hostAnswerQueue = [];
  S.hostAnswerProcessing = false;
  S.hostSession.questionActive = false;
  const answer = S.hostSession.currentQuestion ? S.hostSession.currentQuestion.answer : '???';
  sm.sendGameResponse(null, 'Time up! Answer: ' + answer, false);
  sm.emitActivity('Host', 'host-' + S.hostSession.gameType, 'round ' + S.hostSession.currentRound + ' timed out');

  if (S.ioRef) S.ioRef.emit('chatgames:hostUpdate', getHostStatus());

  setTimeout(function () {
    hostNextRound();
  }, S.hostSession.delayBetweenRounds);
}

function hostShowFinalLeaderboard(): void {
  if (!S.hostSession) return;

  const board: { name: string; points: number }[] = [];
  S.hostSession.leaderboard.forEach(function (entry: { name: string; points: number }) {
    board.push(entry);
  });
  board.sort(function (a, b) { return b.points - a.points; });

  if (board.length === 0) {
    sm.sendGameResponse(null, 'No one scored! Better luck next time.', false);
    return;
  }

  setTimeout(function () {
    sm.sendGameResponse(null, 'Winner: ' + board[0].name + ' with ' + board[0].points + ' pts!', false);
  }, 800);

  if (board.length > 1) {
    setTimeout(function () {
      const lines: string[] = [];
      for (let i = 0; i < Math.min(board.length, 3); i++) {
        lines.push((i + 1) + '. ' + board[i].name + ' - ' + board[i].points);
      }
      sm.sendGameResponse(null, lines.join(' | '), false);
    }, 2400);
  }
}

function hostCleanup(): void {
  if (!S.hostSession) return;
  clearTimeout(S.hostSession.timeoutTimer);
  clearTimeout(S.hostSession.roundTimer);
  S.hostSession = null;
  S.hostAnswerQueue = [];
  S.hostAnswerProcessing = false;
  if (S.ioRef) S.ioRef.emit('chatgames:hostUpdate', getHostStatus());
}

export function getHostStatus(): any {
  if (!S.hostSession) {
    return { active: false };
  }
  const board: { name: string; points: number }[] = [];
  S.hostSession.leaderboard.forEach(function (entry: { name: string; points: number }) {
    board.push(entry);
  });
  board.sort(function (a, b) { return b.points - a.points; });

  return {
    active: true,
    gameType: S.hostSession.gameType,
    currentRound: S.hostSession.currentRound,
    totalRounds: S.hostSession.totalRounds,
    hostPlayer: S.hostSession.hostPlayer,
    questionActive: S.hostSession.questionActive,
    currentQuestion: S.hostSession.questionActive ? (S.hostSession.currentQuestion ? S.hostSession.currentQuestion.question : '') : '',
    leaderboard: board
  };
}
