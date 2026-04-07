// @ts-nocheck
import { escapeHtml } from './text';

type ChatGamesUiDeps = {
  socket: any,
  showToast: (message: string, isError?: boolean) => void,
};

export function createChatGamesUi(deps: ChatGamesUiDeps) {
  var socket = deps.socket;
  var showToast = deps.showToast;

  document.querySelectorAll('#cg-tabs .cg-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('#cg-tabs .cg-tab').forEach(function (t) { t.classList.remove('active'); });
      document.querySelectorAll('.cg-tab-content').forEach(function (c) { c.classList.remove('active'); });
      tab.classList.add('active');
      var target = document.getElementById('cg-tab-' + tab.dataset.cgTab);
      if (target) target.classList.add('active');
    });
  });

  socket.on('chatgames:config', function (cfg) {
    document.getElementById('cg-enabled').checked = cfg.enabled;
    document.getElementById('cg-model').value = cfg.openaiModel || 'gpt-4o-mini';
    var cfgPrefix = cfg.commandPrefix || '!';
    document.getElementById('cg-prefix').value = cfgPrefix;
    document.getElementById('cg-cooldown').value = cfg.cooldownSeconds || 10;
    var hostHint = document.getElementById('cg-host-prefix-hint');
    if (hostHint) hostHint.textContent = cfgPrefix + 'host trivia 10';
    document.getElementById('cg-public').checked = cfg.publicChatEnabled !== false;
    document.getElementById('cg-whisper').checked = cfg.whisperEnabled !== false;

    var games = cfg.games || {};
    document.getElementById('cg-game-trivia').checked = games.trivia !== false;
    document.getElementById('cg-game-riddle').checked = games.riddle !== false;
    document.getElementById('cg-game-8ball').checked = games.eightball !== false;
    document.getElementById('cg-game-scramble').checked = games.scramble !== false;
    document.getElementById('cg-game-guess').checked = games.numberguess !== false;
    document.getElementById('cg-game-fortune').checked = games.fortune !== false;
    document.getElementById('cg-game-rps').checked = games.rps !== false;
    document.getElementById('cg-game-hangman').checked = games.hangman !== false;

    document.getElementById('cg-roast-mode').checked = !!cfg.roastMode;
    document.getElementById('cg-ragebait-mode').checked = !!cfg.rageBaitMode;
    document.getElementById('cg-roast-target').value = cfg.roastTarget || '';

    var keyEl = document.getElementById('cg-key-status');
    keyEl.textContent = cfg.hasApiKey
      ? 'OPENAI_API_KEY detected'
      : 'No OPENAI_API_KEY set (games will use fallback mode)';
    keyEl.style.color = cfg.hasApiKey ? 'var(--green-400)' : 'var(--amber-400)';

    renderCustomTrivia(cfg.customTrivia);
    renderCustomRiddles(cfg.customRiddles);
    renderCustomWords(cfg.customWords);
    renderCustom8Ball(cfg.custom8Ball);
    renderCustomFortunes(cfg.customFortunes);
  });

  document.getElementById('chatgames-form').addEventListener('submit', function (e) {
    e.preventDefault();
    socket.emit('chatgames:saveConfig', {
      enabled: document.getElementById('cg-enabled').checked,
      openaiModel: document.getElementById('cg-model').value.trim() || 'gpt-4o-mini',
      commandPrefix: document.getElementById('cg-prefix').value.trim() || '!',
      cooldownSeconds: parseInt(document.getElementById('cg-cooldown').value) || 10,
      publicChatEnabled: document.getElementById('cg-public').checked,
      whisperEnabled: document.getElementById('cg-whisper').checked,
      roastMode: document.getElementById('cg-roast-mode').checked,
      rageBaitMode: document.getElementById('cg-ragebait-mode').checked,
      roastTarget: document.getElementById('cg-roast-target').value.trim(),
      games: {
        trivia: document.getElementById('cg-game-trivia').checked,
        riddle: document.getElementById('cg-game-riddle').checked,
        eightball: document.getElementById('cg-game-8ball').checked,
        scramble: document.getElementById('cg-game-scramble').checked,
        numberguess: document.getElementById('cg-game-guess').checked,
        fortune: document.getElementById('cg-game-fortune').checked,
        rps: document.getElementById('cg-game-rps').checked,
        hangman: document.getElementById('cg-game-hangman').checked
      }
    });
  });

  function renderActiveGames(games) {
    var container = document.getElementById('cg-active-games');
    if (!games || games.length === 0) {
      container.innerHTML = '<div class="rules-empty">No active games.</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < games.length; i++) {
      var g = games[i];
      var elapsed = Math.floor((Date.now() - g.startedAt) / 1000);
      html +=
        '<div class="rule-item rule-enabled">' +
          '<div class="rule-header">' +
            '<span class="rule-name">' + escapeHtml(g.player) + '</span>' +
            '<span class="cg-game-badge">' + escapeHtml(g.gameType) + '</span>' +
          '</div>' +
          '<div class="rule-details">' +
            '<span class="rule-types">' + (g.isWhisper ? 'Whisper' : 'Public') + '</span>' +
            '<span class="rule-pattern">Attempts: ' + g.attempts + ' | ' + elapsed + 's</span>' +
          '</div>' +
        '</div>';
    }
    container.innerHTML = html;
  }

  socket.on('chatgames:sessionStart', function () {});
  socket.on('chatgames:sessionEnd', function () {});

  socket.on('chatgames:active', function (games) {
    renderActiveGames(games);
  });

  var cgActivityLog = document.getElementById('cg-activity-log');
  var MAX_CG_ACTIVITY = 100;

  socket.on('chatgames:activity', function (entry) {
    var el = document.createElement('div');
    el.className = 'cg-activity-entry';

    var time = new Date(entry.timestamp).toLocaleTimeString();
    el.innerHTML =
      '<span class="chat-time">' + time + '</span>' +
      '<span class="cg-game-badge">' + escapeHtml(entry.gameType) + '</span>' +
      '<span class="chat-sender">' + escapeHtml(entry.player) + '</span>' +
      '<span class="chat-text">' + escapeHtml(entry.action) + '</span>';

    cgActivityLog.appendChild(el);

    while (cgActivityLog.children.length > MAX_CG_ACTIVITY) {
      cgActivityLog.removeChild(cgActivityLog.firstChild);
    }
    cgActivityLog.scrollTop = cgActivityLog.scrollHeight;
  });

  socket.on('chatgames:error', function (err) {
    var el = document.createElement('div');
    el.className = 'cg-activity-entry cg-activity-error';

    var time = new Date(err.timestamp).toLocaleTimeString();
    el.innerHTML =
      '<span class="chat-time">' + time + '</span>' +
      '<span class="cg-game-badge">error</span>' +
      '<span class="chat-sender">' + escapeHtml(err.player || 'system') + '</span>' +
      '<span class="chat-text">' + escapeHtml(err.error) + '</span>';

    cgActivityLog.appendChild(el);
    cgActivityLog.scrollTop = cgActivityLog.scrollHeight;
  });

  document.getElementById('cg-roast-mode').addEventListener('change', function () {
    if (this.checked) {
      document.getElementById('cg-ragebait-mode').checked = false;
    }
  });
  document.getElementById('cg-ragebait-mode').addEventListener('change', function () {
    if (this.checked) {
      document.getElementById('cg-roast-mode').checked = false;
    }
  });

  var cgCustomTrivia = [];
  var cgCustomRiddles = [];
  var cgCustomWords = [];
  var cgCustom8Ball = [];
  var cgCustomFortunes = [];

  function renderCustomTrivia(list) {
    cgCustomTrivia = list || [];
    var container = document.getElementById('cg-custom-trivia-list');
    if (cgCustomTrivia.length === 0) {
      container.innerHTML = '<div class="rules-empty">No custom trivia yet.</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < cgCustomTrivia.length; i++) {
      var t = cgCustomTrivia[i];
      html +=
        '<div class="rule-item rule-enabled">' +
          '<div class="rule-header">' +
            '<span class="rule-name">' + escapeHtml(t.question) + '</span>' +
            '<div class="rule-actions">' +
              '<button class="btn btn-small btn-red cg-trivia-delete" data-index="' + i + '">Delete</button>' +
            '</div>' +
          '</div>' +
          '<div class="rule-details">' +
            '<span class="rule-types">A: ' + escapeHtml(t.answer) + '</span>' +
            (t.hint ? '<span class="rule-pattern">Hint: ' + escapeHtml(t.hint) + '</span>' : '') +
          '</div>' +
        '</div>';
    }
    container.innerHTML = html;

    container.querySelectorAll('.cg-trivia-delete').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.dataset.index);
        cgCustomTrivia.splice(idx, 1);
        socket.emit('chatgames:saveConfig', { customTrivia: cgCustomTrivia });
        renderCustomTrivia(cgCustomTrivia);
      });
    });
  }

  function renderCustomWords(list) {
    cgCustomWords = list || [];
    var container = document.getElementById('cg-custom-words-list');
    if (cgCustomWords.length === 0) {
      container.innerHTML = '<div class="rules-empty">No custom words yet.</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < cgCustomWords.length; i++) {
      var w = cgCustomWords[i];
      html +=
        '<div class="rule-item rule-enabled">' +
          '<div class="rule-header">' +
            '<span class="rule-name">' + escapeHtml(w.word) + '</span>' +
            '<div class="rule-actions">' +
              '<button class="btn btn-small btn-red cg-word-delete" data-index="' + i + '">Delete</button>' +
            '</div>' +
          '</div>' +
          '<div class="rule-details">' +
            '<span class="rule-types">Hint: ' + escapeHtml(w.hint || 'none') + '</span>' +
          '</div>' +
        '</div>';
    }
    container.innerHTML = html;

    container.querySelectorAll('.cg-word-delete').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.dataset.index);
        cgCustomWords.splice(idx, 1);
        socket.emit('chatgames:saveConfig', { customWords: cgCustomWords });
        renderCustomWords(cgCustomWords);
      });
    });
  }

  document.getElementById('cg-trivia-add-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = document.getElementById('cg-trivia-q').value.trim();
    var a = document.getElementById('cg-trivia-a').value.trim();
    var h = document.getElementById('cg-trivia-h').value.trim();
    if (!q || !a) {
      showToast('Question and answer are required', true);
      return;
    }
    cgCustomTrivia.push({ question: q, answer: a, hint: h || 'No hint' });
    socket.emit('chatgames:saveConfig', { customTrivia: cgCustomTrivia });
    renderCustomTrivia(cgCustomTrivia);
    document.getElementById('cg-trivia-q').value = '';
    document.getElementById('cg-trivia-a').value = '';
    document.getElementById('cg-trivia-h').value = '';
  });

  function renderCustomRiddles(list) {
    cgCustomRiddles = list || [];
    var container = document.getElementById('cg-custom-riddles-list');
    if (cgCustomRiddles.length === 0) {
      container.innerHTML = '<div class="rules-empty">No custom riddles yet.</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < cgCustomRiddles.length; i++) {
      var r = cgCustomRiddles[i];
      html +=
        '<div class="rule-item rule-enabled">' +
          '<div class="rule-header">' +
            '<span class="rule-name">' + escapeHtml(r.riddle) + '</span>' +
            '<div class="rule-actions">' +
              '<button class="btn btn-small btn-red cg-riddle-delete" data-index="' + i + '">Delete</button>' +
            '</div>' +
          '</div>' +
          '<div class="rule-details">' +
            '<span class="rule-types">A: ' + escapeHtml(r.answer) + '</span>' +
            (r.hint ? '<span class="rule-pattern">Hint: ' + escapeHtml(r.hint) + '</span>' : '') +
          '</div>' +
        '</div>';
    }
    container.innerHTML = html;

    container.querySelectorAll('.cg-riddle-delete').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.dataset.index);
        cgCustomRiddles.splice(idx, 1);
        socket.emit('chatgames:saveConfig', { customRiddles: cgCustomRiddles });
        renderCustomRiddles(cgCustomRiddles);
      });
    });
  }

  document.getElementById('cg-riddles-add-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var r = document.getElementById('cg-riddle-r').value.trim();
    var a = document.getElementById('cg-riddle-a').value.trim();
    var h = document.getElementById('cg-riddle-h').value.trim();
    if (!r || !a) {
      showToast('Riddle and answer are required', true);
      return;
    }
    cgCustomRiddles.push({ riddle: r, answer: a, hint: h || 'No hint' });
    socket.emit('chatgames:saveConfig', { customRiddles: cgCustomRiddles });
    renderCustomRiddles(cgCustomRiddles);
    document.getElementById('cg-riddle-r').value = '';
    document.getElementById('cg-riddle-a').value = '';
    document.getElementById('cg-riddle-h').value = '';
  });

  document.getElementById('cg-words-add-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var w = document.getElementById('cg-word-w').value.trim().toLowerCase();
    var h = document.getElementById('cg-word-h').value.trim();
    if (!w || w.length < 3) {
      showToast('Word must be at least 3 characters', true);
      return;
    }
    cgCustomWords.push({ word: w, hint: h || 'Think carefully' });
    socket.emit('chatgames:saveConfig', { customWords: cgCustomWords });
    renderCustomWords(cgCustomWords);
    document.getElementById('cg-word-w').value = '';
    document.getElementById('cg-word-h').value = '';
  });

  function renderCustom8Ball(list) {
    cgCustom8Ball = list || [];
    var container = document.getElementById('cg-custom-8ball-list');
    if (cgCustom8Ball.length === 0) {
      container.innerHTML = '<div class="rules-empty">No custom 8-Ball responses yet.</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < cgCustom8Ball.length; i++) {
      html +=
        '<div class="rule-item rule-enabled">' +
          '<div class="rule-header">' +
            '<span class="rule-name">' + escapeHtml(cgCustom8Ball[i]) + '</span>' +
            '<div class="rule-actions">' +
              '<button class="btn btn-small btn-red cg-8ball-delete" data-index="' + i + '">Delete</button>' +
            '</div>' +
          '</div>' +
        '</div>';
    }
    container.innerHTML = html;

    container.querySelectorAll('.cg-8ball-delete').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.dataset.index);
        cgCustom8Ball.splice(idx, 1);
        socket.emit('chatgames:saveConfig', { custom8Ball: cgCustom8Ball });
        renderCustom8Ball(cgCustom8Ball);
      });
    });
  }

  document.getElementById('cg-8ball-add-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = document.getElementById('cg-8ball-text').value.trim();
    if (!text) {
      showToast('Response text is required', true);
      return;
    }
    cgCustom8Ball.push(text);
    socket.emit('chatgames:saveConfig', { custom8Ball: cgCustom8Ball });
    renderCustom8Ball(cgCustom8Ball);
    document.getElementById('cg-8ball-text').value = '';
  });

  function renderCustomFortunes(list) {
    cgCustomFortunes = list || [];
    var container = document.getElementById('cg-custom-fortunes-list');
    if (cgCustomFortunes.length === 0) {
      container.innerHTML = '<div class="rules-empty">No custom fortunes yet.</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < cgCustomFortunes.length; i++) {
      html +=
        '<div class="rule-item rule-enabled">' +
          '<div class="rule-header">' +
            '<span class="rule-name">' + escapeHtml(cgCustomFortunes[i]) + '</span>' +
            '<div class="rule-actions">' +
              '<button class="btn btn-small btn-red cg-fortune-delete" data-index="' + i + '">Delete</button>' +
            '</div>' +
          '</div>' +
        '</div>';
    }
    container.innerHTML = html;

    container.querySelectorAll('.cg-fortune-delete').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.dataset.index);
        cgCustomFortunes.splice(idx, 1);
        socket.emit('chatgames:saveConfig', { customFortunes: cgCustomFortunes });
        renderCustomFortunes(cgCustomFortunes);
      });
    });
  }

  document.getElementById('cg-fortunes-add-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = document.getElementById('cg-fortune-text').value.trim();
    if (!text) {
      showToast('Fortune text is required', true);
      return;
    }
    cgCustomFortunes.push(text);
    socket.emit('chatgames:saveConfig', { customFortunes: cgCustomFortunes });
    renderCustomFortunes(cgCustomFortunes);
    document.getElementById('cg-fortune-text').value = '';
  });

  function renderHostStatus(status) {
    var container = document.getElementById('cg-host-status');
    var startBtn = document.getElementById('cg-host-start');
    var stopBtn = document.getElementById('cg-host-stop');
    var skipBtn = document.getElementById('cg-host-skip');

    if (!status || !status.active) {
      container.innerHTML = '<div class="rules-empty">No hosted game running.</div>';
      startBtn.disabled = false;
      stopBtn.disabled = true;
      skipBtn.disabled = true;
      return;
    }

    startBtn.disabled = true;
    stopBtn.disabled = false;
    skipBtn.disabled = !status.questionActive;

    var html = '<div class="rule-item rule-enabled">' +
      '<div class="rule-header">' +
        '<span class="rule-name">Game Show: ' + escapeHtml(status.gameType) + '</span>' +
        '<span class="cg-game-badge">Round ' + status.currentRound + '/' + status.totalRounds + '</span>' +
      '</div>' +
      '<div class="rule-details">' +
        '<span class="rule-types">Host: ' + escapeHtml(status.hostPlayer || 'Panel') + '</span>' +
        '<span class="rule-pattern">' + (status.questionActive ? 'Waiting for answer...' : 'Between rounds') + '</span>' +
      '</div>';

    if (status.leaderboard && status.leaderboard.length > 0) {
      html += '<div class="rule-details" style="margin-top:0.25rem;">';
      for (var i = 0; i < Math.min(status.leaderboard.length, 5); i++) {
        var entry = status.leaderboard[i];
        html += '<span class="rule-types" style="margin-right:0.75rem;">' + (i + 1) + '. ' + escapeHtml(entry.name) + ': ' + entry.points + 'pt</span>';
      }
      html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
  }

  socket.on('chatgames:hostUpdate', function (status) {
    renderHostStatus(status);
  });

  document.getElementById('cg-host-start').addEventListener('click', function () {
    var gameType = document.getElementById('cg-host-type').value;
    var rounds = parseInt(document.getElementById('cg-host-rounds').value) || 5;
    socket.emit('chatgames:hostStart', { gameType: gameType, rounds: rounds });
  });

  document.getElementById('cg-host-stop').addEventListener('click', function () {
    socket.emit('chatgames:hostStop');
  });

  document.getElementById('cg-host-skip').addEventListener('click', function () {
    socket.emit('chatgames:hostSkip');
  });

  function renderBjStatus(status) {
    var container = document.getElementById('cg-bj-status');
    var openBtn = document.getElementById('cg-bj-open');
    var forceBtn = document.getElementById('cg-bj-force');
    var stopBtn = document.getElementById('cg-bj-stop');

    if (!status || !status.active) {
      container.innerHTML = '<div class="rules-empty">No group blackjack running.</div>';
      openBtn.disabled = false;
      forceBtn.disabled = true;
      stopBtn.disabled = true;
      return;
    }

    openBtn.disabled = true;
    forceBtn.disabled = status.phase !== 'lobby';
    stopBtn.disabled = false;

    var html = '<div class="rule-item rule-enabled">' +
      '<div class="rule-header">' +
        '<span class="rule-name">Group Blackjack</span>' +
        '<span class="cg-game-badge">' + escapeHtml(status.phase) + '</span>' +
      '</div>' +
      '<div class="rule-details">' +
        '<span class="rule-types">Players: ' + (status.seats ? status.seats.length : 0) + '</span>' +
        '<span class="rule-pattern">Hand ' + (status.handNumber || 0) + '/' + (status.maxHands || 0) + '</span>' +
      '</div>' +
    '</div>';
    container.innerHTML = html;
  }

  socket.on('chatgames:bjUpdate', function (status) {
    renderBjStatus(status);
  });

  document.getElementById('cg-bj-open').addEventListener('click', function () {
    var rounds = parseInt(document.getElementById('cg-bj-rounds').value) || 5;
    socket.emit('chatgames:bjStart', { rounds: rounds });
  });

  document.getElementById('cg-bj-force').addEventListener('click', function () {
    socket.emit('chatgames:bjForceStart');
  });

  document.getElementById('cg-bj-stop').addEventListener('click', function () {
    socket.emit('chatgames:bjStop');
  });

  var activeLbFilter = '';

  function renderLeaderboard(board) {
    var tbody = document.getElementById('cg-lb-tbody');
    var showStreak = (activeLbFilter === '');
    var streakCol = document.getElementById('lb-streak-col');
    if (streakCol) streakCol.style.display = showStreak ? '' : 'none';

    var cols = showStreak ? 6 : 5;
    if (!board || board.length === 0) {
      tbody.innerHTML = '<tr><td colspan="' + cols + '" class="lb-empty">No games played yet.</td></tr>';
      return;
    }
    var html = '';
    board.forEach(function (p, i) {
      var rank = i + 1;
      var medalClass = rank <= 3 ? ' lb-rank-' + rank : '';
      html +=
        '<tr>' +
          '<td class="lb-rank' + medalClass + '">' + rank + '</td>' +
          '<td class="lb-name">' + escapeHtml(p.name) + '</td>' +
          '<td class="lb-wins">' + p.wins + '</td>' +
          '<td>' + p.played + '</td>' +
          '<td>' + (p.winRate || 0) + '%</td>' +
          (showStreak ? '<td>' + (p.bestStreak || 0) + '</td>' : '') +
        '</tr>';
    });
    tbody.innerHTML = html;
  }

  document.querySelectorAll('#lb-filter-tabs .lb-filter-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('#lb-filter-tabs .lb-filter-tab').forEach(function (t) {
        t.classList.remove('active');
      });
      tab.classList.add('active');
      activeLbFilter = tab.dataset.game || '';
      var clearGameBtn = document.getElementById('cg-lb-clear-game');
      if (activeLbFilter) {
        clearGameBtn.style.display = '';
        clearGameBtn.textContent = 'Reset ' + (tab.textContent || activeLbFilter);
        socket.emit('chatgames:getLeaderboardByGame', activeLbFilter);
      } else {
        clearGameBtn.style.display = 'none';
        socket.emit('chatgames:getLeaderboard');
      }
    });
  });

  socket.on('chatgames:leaderboard', function (board) {
    if (activeLbFilter === '') {
      renderLeaderboard(board);
    }
  });

  socket.on('chatgames:leaderboardByGame', function (board) {
    if (activeLbFilter !== '') {
      renderLeaderboard(board);
    }
  });

  document.querySelectorAll('#cg-tabs .cg-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      if (tab.dataset.cgTab === 'leaderboard') {
        if (activeLbFilter) {
          socket.emit('chatgames:getLeaderboardByGame', activeLbFilter);
        } else {
          socket.emit('chatgames:getLeaderboard');
        }
      }
    });
  });

  document.getElementById('cg-lb-clear').addEventListener('click', function () {
    if (confirm('Clear all leaderboard data? This cannot be undone.')) {
      socket.emit('chatgames:clearLeaderboard');
    }
  });

  document.getElementById('cg-lb-clear-game').addEventListener('click', function () {
    if (!activeLbFilter) return;
    if (confirm('Clear all ' + activeLbFilter.toUpperCase() + ' leaderboard data? This cannot be undone.')) {
      socket.emit('chatgames:clearLeaderboardByGame', activeLbFilter);
    }
  });
}
