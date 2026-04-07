"use strict";

// ── Content Generation (Fallbacks, ShuffleDeck, Helpers) ─────────

// ── Shuffle Deck (no-repeat cycling) ──

function ShuffleDeck(sourceArrayGetter) {
  this._get = sourceArrayGetter;
  this._deck = [];
}
ShuffleDeck.prototype._refill = function () {
  var src = this._get();
  if (!src || src.length === 0) {
    this._deck = [];
    return;
  }
  this._deck = src.slice();
  for (var i = this._deck.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = this._deck[i];
    this._deck[i] = this._deck[j];
    this._deck[j] = tmp;
  }
};
ShuffleDeck.prototype.draw = function () {
  if (this._deck.length === 0) this._refill();
  if (this._deck.length === 0) return null;
  return this._deck.pop();
};
ShuffleDeck.prototype.reset = function () {
  this._deck = [];
};

// ── Fallback Data ──

var FALLBACK_TRIVIA = [{
  question: 'What element beats water?',
  answer: 'Earth',
  hint: 'Solid ground'
}, {
  question: 'How many classes exist in Temuair?',
  answer: '5',
  hint: 'A handful'
}, {
  question: 'What creature drops wolf fur?',
  answer: 'Wolf',
  hint: 'It howls'
}, {
  question: 'What town has the mileth altar?',
  answer: 'Mileth',
  hint: 'Starting town'
}, {
  question: 'What stat does a warrior need most?',
  answer: 'Strength',
  hint: 'Raw power'
}, {
  question: 'Which god represents darkness?',
  answer: 'Chadul',
  hint: 'Opposite of light'
}, {
  question: 'What is the currency in Temuair?',
  answer: 'Gold',
  hint: 'Shiny metal'
}, {
  question: 'What element beats fire?',
  answer: 'Water',
  hint: 'Flows and quenches'
}, {
  question: 'What class uses staves?',
  answer: 'Wizard',
  hint: 'Master of spells'
}, {
  question: 'What element beats wind?',
  answer: 'Fire',
  hint: 'It burns bright'
}, {
  question: 'Which god is patron of warriors?',
  answer: 'Ceannlaidir',
  hint: 'Strength deity'
}, {
  question: 'What town is known for fishing?',
  answer: 'Abel',
  hint: 'Port town'
}, {
  question: 'What element is Srad?',
  answer: 'Fire',
  hint: 'It burns'
}, {
  question: 'Which class can heal others?',
  answer: 'Priest',
  hint: 'Holy power'
}, {
  question: 'What goddess watches over love?',
  answer: 'Glioca',
  hint: 'Compassion'
}, {
  question: 'Where do new Aislings awaken?',
  answer: 'Mileth',
  hint: 'Starting village'
}, {
  question: 'What god governs wisdom?',
  answer: 'Luathas',
  hint: 'Knowledge deity'
}, {
  question: 'What class relies on stealth?',
  answer: 'Rogue',
  hint: 'Shadows'
}, {
  question: 'What is Athar element?',
  answer: 'Wind',
  hint: 'Air and breeze'
}, {
  question: 'What is Creag element?',
  answer: 'Earth',
  hint: 'Stone and rock'
}, {
  question: 'Who is the god of inspiration?',
  answer: 'Deoch',
  hint: 'Creative spark'
}, {
  question: 'What class fights bare-handed?',
  answer: 'Monk',
  hint: 'Discipline of body'
}, {
  question: 'What deity represents luck?',
  answer: 'Fiosachd',
  hint: 'Fortune and wealth'
}, {
  question: 'What city has the Loures Castle?',
  answer: 'Loures',
  hint: 'Royal seat'
}, {
  question: 'What is the dark god Sgrios of?',
  answer: 'Destruction',
  hint: 'Death and decay'
}];
var FALLBACK_RIDDLES = [{
  riddle: 'I burn without flame in Temuair.',
  answer: 'Srad',
  hint: 'An element'
}, {
  riddle: 'I guard the dead but live forever.',
  answer: 'Sgrios',
  hint: 'A dark god'
}, {
  riddle: 'Aislings seek me but I have no form.',
  answer: 'Insight',
  hint: 'Inner knowledge'
}, {
  riddle: 'I flow through Abel but cannot be held.',
  answer: 'Water',
  hint: 'An element'
}, {
  riddle: 'Five paths diverge, each with power.',
  answer: 'Classes',
  hint: 'Warrior, Wizard...'
}, {
  riddle: 'I am earned in battle but spent in peace.',
  answer: 'Experience',
  hint: 'Growth'
}, {
  riddle: 'Mundanes see me not, yet I walk among them.',
  answer: 'Aisling',
  hint: 'A player'
}, {
  riddle: 'I stand at the crossroads of all elements.',
  answer: 'Light',
  hint: 'Opposing darkness'
}];
var FALLBACK_WORDS = [{
  word: 'mileth',
  hint: 'Starting town'
}, {
  word: 'aisling',
  hint: 'An awakened one'
}, {
  word: 'wizard',
  hint: 'A master of magic'
}, {
  word: 'priest',
  hint: 'A holy healer'
}, {
  word: 'warrior',
  hint: 'A strong fighter'
}, {
  word: 'loures',
  hint: 'A great castle city'
}, {
  word: 'rucesion',
  hint: 'City of sorcery'
}, {
  word: 'suomi',
  hint: 'Northern village'
}, {
  word: 'rogue',
  hint: 'Master of shadows'
}, {
  word: 'temuair',
  hint: 'The world itself'
}, {
  word: 'chadul',
  hint: 'God of darkness'
}, {
  word: 'danaan',
  hint: 'Goddess of light'
}, {
  word: 'creag',
  hint: 'Earth element'
}, {
  word: 'deoch',
  hint: 'God of inspiration'
}, {
  word: 'mundane',
  hint: 'Non-Aisling person'
}];

// ── Deck Instances ──

var S = require('./state');
var deckFallbackTrivia = new ShuffleDeck(function () {
  return FALLBACK_TRIVIA;
});
var deckFallbackRiddles = new ShuffleDeck(function () {
  return FALLBACK_RIDDLES;
});
var deckFallbackWords = new ShuffleDeck(function () {
  return FALLBACK_WORDS;
});
var deckCustomTrivia = new ShuffleDeck(function () {
  return S.customTrivia;
});
var deckCustomRiddles = new ShuffleDeck(function () {
  return S.customRiddles;
});
var deckCustomWords = new ShuffleDeck(function () {
  return S.customWords;
});

// ── Generators ──

function generateTrivia(charLimit, callback) {
  var q = null;
  if (S.customTrivia.length > 0) {
    q = deckCustomTrivia.draw();
  }
  if (!q) {
    q = deckFallbackTrivia.draw() || FALLBACK_TRIVIA[0];
  }
  callback(null, {
    question: q.question,
    answer: q.answer,
    hint: q.hint || 'No hint available'
  });
}
function generateRiddle(charLimit, callback) {
  var r = null;
  if (S.customRiddles.length > 0) {
    r = deckCustomRiddles.draw();
  }
  if (r) {
    callback(null, {
      question: r.riddle,
      answer: r.answer,
      hint: r.hint || 'No hint available'
    });
  } else {
    r = deckFallbackRiddles.draw() || FALLBACK_RIDDLES[0];
    callback(null, {
      question: r.riddle,
      answer: r.answer,
      hint: r.hint
    });
  }
}
function generateHangman(callback) {
  var w = null;
  if (S.customWords.length > 0) {
    w = deckCustomWords.draw();
  }
  if (!w) {
    w = deckFallbackWords.draw() || FALLBACK_WORDS[0];
  }
  var word = w.word.toLowerCase();
  var display = buildRevealedWord(word, []);
  callback(null, {
    question: display,
    answer: word,
    hint: w.hint || 'Think carefully',
    guessedLetters: [],
    wrongCount: 0,
    maxWrong: 6,
    maxAttempts: 50
  });
}
function generateScramble(callback) {
  var w = null;
  if (S.customWords.length > 0) {
    w = deckCustomWords.draw();
  }
  if (!w) {
    w = deckFallbackWords.draw() || FALLBACK_WORDS[0];
  }
  var scrambled = scrambleWord(w.word.toLowerCase());
  callback(null, {
    question: scrambled.toUpperCase(),
    answer: w.word.toLowerCase(),
    hint: w.hint || 'Think carefully'
  });
}
function generateNumberGuess() {
  var target = Math.floor(Math.random() * 100) + 1;
  return {
    targetNumber: target,
    answer: String(target),
    hint: 'Between 1 and 100'
  };
}
function scrambleWord(word) {
  var arr = word.split('');
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  var result = arr.join('');
  if (result === word && word.length > 1) return scrambleWord(word);
  return result;
}
function buildRevealedWord(word, guessedLetters) {
  var result = [];
  for (var i = 0; i < word.length; i++) {
    var ch = word[i].toLowerCase();
    if (/[a-z]/.test(ch)) {
      result.push(guessedLetters.indexOf(ch) !== -1 ? word[i] : '_');
    } else {
      result.push(word[i]);
    }
  }
  return result.join(' ');
}
function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9 _-]/g, '').substring(0, 30);
}

// Reset custom decks (called when custom content is updated)
function resetCustomDecks() {
  deckCustomTrivia.reset();
  deckCustomRiddles.reset();
  deckCustomWords.reset();
}
module.exports = {
  ShuffleDeck: ShuffleDeck,
  generateTrivia: generateTrivia,
  generateRiddle: generateRiddle,
  generateHangman: generateHangman,
  generateScramble: generateScramble,
  generateNumberGuess: generateNumberGuess,
  scrambleWord: scrambleWord,
  buildRevealedWord: buildRevealedWord,
  sanitizeName: sanitizeName,
  resetCustomDecks: resetCustomDecks,
  FALLBACK_TRIVIA: FALLBACK_TRIVIA,
  FALLBACK_RIDDLES: FALLBACK_RIDDLES,
  FALLBACK_WORDS: FALLBACK_WORDS
};