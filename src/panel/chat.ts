// @ts-nocheck
(function () {
  'use strict';

  var socket = io();
  var botStates = {};
  var chatMessages = [];
  var activeChatChannel = 'all';
  var activeChatBotId = '';
  var selectedChatBotId = null;
  var selectedWhisperBotId = null;
  var MAX_CHAT = 500;
  var autoScroll = true;
  var notifEnabled = false;
  var recentChatKeys = {};

  var chatLog = document.getElementById('chat-log');
  var scrollBtn = document.getElementById('scroll-bottom-btn');

  // ── Utilities ───────────────────────────────────────────────

  function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ── Toast ───────────────────────────────────────────────────

  function showToast(message, isError) {
    var container = document.getElementById('toast-container');
    var toast = document.createElement('div');
    toast.className = 'chat-toast' + (isError ? ' error' : '');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function () {
      toast.classList.add('fade-out');
      setTimeout(function () { toast.remove(); }, 300);
    }, 3000);
  }

  // ── Connection Status ───────────────────────────────────────

  var connDot = document.getElementById('connection-dot');

  socket.on('connect', function () {
    connDot.className = 'connection-dot connected';
    connDot.title = 'Connected';
  });

  socket.on('disconnect', function () {
    connDot.className = 'connection-dot disconnected';
    connDot.title = 'Disconnected';
  });

  // ── Bot State ───────────────────────────────────────────────

  socket.on('bots:statusAll', function (states) {
    botStates = {};
    if (states && states.length > 0) {
      states.forEach(function (state) {
        botStates[state.id] = state;
      });
    }
    renderBotSelectors();
    renderBotTabs();
  });

  socket.on('bot:status', function (state) {
    if (!state || !state.id) return;
    var isNew = !botStates[state.id];
    botStates[state.id] = state;
    renderBotSelectors();
    if (isNew) renderBotTabs();
  });

  function renderBotSelectors() {
    var ids = Object.keys(botStates);
    var html = '';
    ids.forEach(function (id) {
      var name = botStates[id].username || id;
      html += '<option value="' + id + '">' + escapeHtml(name) + '</option>';
    });

    var chatSel = document.getElementById('chat-bot-select');
    var whisperSel = document.getElementById('whisper-bot-select');
    chatSel.innerHTML = html;
    whisperSel.innerHTML = html;

    if (selectedChatBotId && botStates[selectedChatBotId]) chatSel.value = selectedChatBotId;
    if (selectedWhisperBotId && botStates[selectedWhisperBotId]) whisperSel.value = selectedWhisperBotId;
  }

  function renderBotTabs() {
    var container = document.getElementById('chat-bot-tabs');
    var ids = Object.keys(botStates);
    if (ids.length <= 1) {
      container.innerHTML = '';
      return;
    }
    var html = '<button class="chat-tab' + (activeChatBotId === '' ? ' active' : '') + '" data-bot="">All Bots</button>';
    ids.forEach(function (id) {
      var label = botStates[id].username || id;
      var active = activeChatBotId === id ? ' active' : '';
      html += '<button class="chat-tab' + active + '" data-bot="' + escapeHtml(id) + '">' + escapeHtml(label) + '</button>';
    });
    container.innerHTML = html;
  }

  // ── Chat Rendering ─────────────────────────────────────────

  function renderChatEntry(msg) {
    var entry = document.createElement('div');
    var hasMention = msg.mentions && msg.mentions.length > 0;
    entry.className = 'chat-entry chat-channel-' + msg.channel + (hasMention ? ' chat-mention' : '');

    var time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    var botName = msg.botId ? (botStates[msg.botId] ? botStates[msg.botId].username : msg.botId) : '';
    var botLabel = botName ? '<span class="chat-bot-label">[' + escapeHtml(botName) + ']</span>' : '';
    var mentionBadge = hasMention ? '<span class="chat-mention-badge">@</span>' : '';

    entry.innerHTML =
      '<span class="chat-time">' + time + '</span>' +
      botLabel +
      '<span class="chat-channel">[' + escapeHtml(msg.channelName) + ']</span>' +
      mentionBadge +
      '<span class="chat-sender">' + escapeHtml(msg.sender || 'System') + '</span>' +
      '<span class="chat-text">' + escapeHtml(msg.message) + '</span>';

    return entry;
  }

  function chatMsgMatchesFilter(msg) {
    if (activeChatChannel !== 'all' && String(msg.channel) !== activeChatChannel) return false;
    if (activeChatBotId && msg.botId !== activeChatBotId) return false;
    return true;
  }

  function chatDedupKey(msg) {
    return msg.channel + ':' + msg.sender + ':' + msg.message;
  }

  function renderChatLog() {
    chatLog.innerHTML = '';
    var showAllBots = !activeChatBotId;
    var seenAt = {};

    chatMessages.forEach(function (msg) {
      if (!chatMsgMatchesFilter(msg)) return;
      if (showAllBots && msg.channel !== 0 && String(msg.channel) !== '0') {
        var key = chatDedupKey(msg);
        if (seenAt[key] !== undefined && msg.timestamp - seenAt[key] < 3000) return;
        seenAt[key] = msg.timestamp;
      }
      chatLog.appendChild(renderChatEntry(msg));
    });

    if (autoScroll) {
      chatLog.scrollTop = chatLog.scrollHeight;
    }
  }

  // ── Chat Events ─────────────────────────────────────────────

  socket.on('chat:history', function (messages) {
    chatMessages = messages.slice(-MAX_CHAT);
    renderChatLog();
  });

  socket.on('chat:message', function (msg) {
    chatMessages.push(msg);
    while (chatMessages.length > MAX_CHAT) {
      chatMessages.shift();
    }

    // Whisper notification
    if (String(msg.channel) === '0') {
      sendBrowserNotif('Whisper from ' + (msg.sender || 'Unknown'), msg.message);
    }

    if (!chatMsgMatchesFilter(msg)) return;

    // Live dedup
    if (!activeChatBotId && msg.channel !== 0 && String(msg.channel) !== '0') {
      var key = chatDedupKey(msg);
      var now = msg.timestamp;
      if (recentChatKeys[key] !== undefined && now - recentChatKeys[key] < 3000) return;
      recentChatKeys[key] = now;
      setTimeout(function () { delete recentChatKeys[key]; }, 5000);
    }

    chatLog.appendChild(renderChatEntry(msg));

    while (chatLog.children.length > MAX_CHAT) {
      chatLog.removeChild(chatLog.firstChild);
    }

    if (autoScroll) {
      chatLog.scrollTop = chatLog.scrollHeight;
    }
  });

  // ── Mention Notifications ──────────────────────────────────

  socket.on('mention:detected', function (msg) {
    showToast('Mention from ' + (msg.sender || 'Unknown') + ': ' + msg.message, false);
    sendBrowserNotif('Mention from ' + (msg.sender || 'Unknown'), msg.message);
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  });

  // ── Bot Notifications ──────────────────────────────────────

  socket.on('bot:notification', function (data) {
    showToast(data.message, false);
  });

  socket.on('bot:error', function (data) {
    showToast(data.message, true);
  });

  // ── Auto-Scroll ─────────────────────────────────────────────

  chatLog.addEventListener('scroll', function () {
    var threshold = 60;
    var atBottom = (chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight) < threshold;
    autoScroll = atBottom;
    scrollBtn.classList.toggle('hidden', atBottom);
  });

  scrollBtn.addEventListener('click', function () {
    chatLog.scrollTop = chatLog.scrollHeight;
    autoScroll = true;
    scrollBtn.classList.add('hidden');
  });

  // ── Channel Tabs ────────────────────────────────────────────

  document.getElementById('chat-channel-tabs').addEventListener('click', function (e) {
    var tab = e.target.closest('.chat-tab');
    if (!tab) return;
    activeChatChannel = tab.getAttribute('data-channel');
    this.querySelectorAll('.chat-tab').forEach(function (t) { t.classList.remove('active'); });
    tab.classList.add('active');
    renderChatLog();
  });

  document.getElementById('chat-bot-tabs').addEventListener('click', function (e) {
    var tab = e.target.closest('.chat-tab');
    if (!tab) return;
    activeChatBotId = tab.getAttribute('data-bot');
    this.querySelectorAll('.chat-tab').forEach(function (t) { t.classList.remove('active'); });
    tab.classList.add('active');
    renderChatLog();
  });

  // ── Mode Toggle ─────────────────────────────────────────────

  document.getElementById('mode-say').addEventListener('click', function () {
    this.classList.add('active');
    document.getElementById('mode-whisper').classList.remove('active');
    document.getElementById('say-row').classList.remove('hidden');
    document.getElementById('whisper-row').classList.add('hidden');
  });

  document.getElementById('mode-whisper').addEventListener('click', function () {
    this.classList.add('active');
    document.getElementById('mode-say').classList.remove('active');
    document.getElementById('whisper-row').classList.remove('hidden');
    document.getElementById('say-row').classList.add('hidden');
  });

  // ── Send Handlers ───────────────────────────────────────────

  document.getElementById('chat-bot-select').addEventListener('change', function () {
    selectedChatBotId = this.value;
  });

  document.getElementById('whisper-bot-select').addEventListener('change', function () {
    selectedWhisperBotId = this.value;
  });

  // Say
  document.getElementById('btn-say').addEventListener('click', function () {
    var input = document.getElementById('say-message');
    var message = input.value.trim();
    var botId = selectedChatBotId || document.getElementById('chat-bot-select').value;
    if (message && botId) {
      socket.emit('bot:say', { botId: botId, message: message });
      input.value = '';
      input.focus();
    }
  });

  document.getElementById('say-message').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      document.getElementById('btn-say').click();
    }
  });

  // Whisper
  document.getElementById('btn-whisper').addEventListener('click', function () {
    var target = document.getElementById('whisper-target').value.trim();
    var msgInput = document.getElementById('whisper-message');
    var message = msgInput.value.trim();
    var botId = selectedWhisperBotId || document.getElementById('whisper-bot-select').value;
    if (target && message && botId) {
      socket.emit('bot:whisper', { botId: botId, target: target, message: message });
      msgInput.value = '';
      msgInput.focus();
    }
  });

  document.getElementById('whisper-message').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      document.getElementById('btn-whisper').click();
    }
  });

  // ── Browser Notifications ──────────────────────────────────

  var notifBtn = document.getElementById('notif-btn');

  // Check if already granted
  if ('Notification' in window && Notification.permission === 'granted') {
    notifEnabled = true;
    notifBtn.classList.add('enabled');
  }

  notifBtn.addEventListener('click', function () {
    if (!('Notification' in window)) {
      showToast('Browser notifications not supported', true);
      return;
    }

    if (Notification.permission === 'granted') {
      notifEnabled = !notifEnabled;
      notifBtn.classList.toggle('enabled', notifEnabled);
      showToast(notifEnabled ? 'Notifications enabled' : 'Notifications muted', false);
      return;
    }

    if (Notification.permission === 'denied') {
      showToast('Notifications blocked. Enable in browser settings.', true);
      return;
    }

    Notification.requestPermission().then(function (perm) {
      notifEnabled = (perm === 'granted');
      notifBtn.classList.toggle('enabled', notifEnabled);
      if (notifEnabled) {
        showToast('Notifications enabled', false);
      } else {
        showToast('Notification permission denied', true);
      }
    });
  });

  function sendBrowserNotif(title, body) {
    if (!notifEnabled || !('Notification' in window)) return;
    if (document.hasFocus()) return;

    try {
      var n = new Notification(title, {
        body: (body || '').substring(0, 100),
        tag: 'dasb-chat',
        renotify: true
      });
      n.onclick = function () {
        window.focus();
        n.close();
      };
    } catch (e) {
      // Notification constructor may fail on some mobile browsers
    }
  }

  // ── Reconnect handling ──────────────────────────────────────

  socket.on('connect_error', function () {
    // After sustained connection failure, redirect to login
    setTimeout(function () {
      if (!socket.connected) {
        // Don't redirect immediately — Socket.IO will retry
      }
    }, 30000);
  });

})();
