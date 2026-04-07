import { escapeHtml } from './text';

type ChatUiDeps = {
  socket: any,
  getBotStates: () => Record<string, any>,
  getSelectedChatBotId: () => string | null,
  setSelectedChatBotId: (id: string | null) => void,
  getSelectedWhisperBotId: () => string | null,
  setSelectedWhisperBotId: (id: string | null) => void,
  navLinks: any,
  panels: any,
  contentEl: HTMLElement | null,
};

export function createChatUi(deps: ChatUiDeps) {
  var chatLog = document.getElementById('chat-log') as HTMLElement | null;
  var MAX_CHAT = 500;
  var chatMessages: any[] = [];
  var activeChatChannel = 'all';
  var activeChatBotId = '';
  var recentChatKeys: Record<string, any> = {};

  var mentions: any[] = [];
  var unreadCount = 0;
  var MAX_MENTIONS = 100;

  function renderChatEntry(msg: any) {
    var entry = document.createElement('div');
    var hasMention = msg.mentions && msg.mentions.length > 0;
    entry.className = 'chat-entry chat-channel-' + msg.channel + (hasMention ? ' chat-mention' : '');

    var time = new Date(msg.timestamp).toLocaleTimeString();
    var botStates = deps.getBotStates();
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

  function chatMsgMatchesFilter(msg: any) {
    if (activeChatChannel !== 'all' && String(msg.channel) !== activeChatChannel) return false;
    if (activeChatBotId && msg.botId !== activeChatBotId) return false;
    return true;
  }

  function chatDedupKey(msg: any) {
    return msg.channel + ':' + msg.sender + ':' + msg.message;
  }

  function maybeAutoScrollChatLog() {
    var autoScroll = document.getElementById('chat-auto-scroll') as HTMLInputElement | null;
    if (chatLog && autoScroll && autoScroll.checked) {
      chatLog.scrollTop = chatLog.scrollHeight;
    }
  }

  function renderChatLog() {
    var chatLogEl = chatLog;
    if (!chatLogEl) return;
    chatLogEl.innerHTML = '';
    var showAllBots = !activeChatBotId;
    var seenAt: Record<string, number> = {};

    chatMessages.forEach(function (msg) {
      if (!chatMsgMatchesFilter(msg)) return;
      if (showAllBots && msg.channel !== 0 && String(msg.channel) !== '0') {
        var key = chatDedupKey(msg);
        if (seenAt[key] !== undefined && msg.timestamp - seenAt[key] < 3000) return;
        seenAt[key] = msg.timestamp;
      }
      chatLogEl!.appendChild(renderChatEntry(msg));
    });

    maybeAutoScrollChatLog();
  }

  function renderChatBotTabs() {
    var container = document.getElementById('chat-bot-tabs') as HTMLElement | null;
    if (!container) return;
    var botStates = deps.getBotStates();
    var ids = Object.keys(botStates);
    if (ids.length <= 1) {
      container.innerHTML = '';
      container.style.display = 'none';
      return;
    }
    container.style.display = '';
    var html = '<button class="chat-tab chat-tab-bot' + (activeChatBotId === '' ? ' active' : '') + '" data-bot="">All Bots</button>';
    ids.forEach(function (id) {
      var label = botStates[id].username || id;
      var active = activeChatBotId === id ? ' active' : '';
      html += '<button class="chat-tab chat-tab-bot' + active + '" data-bot="' + escapeHtml(id) + '">' + escapeHtml(label) + '</button>';
    });
    container.innerHTML = html;
  }

  function showToast(message: string, isError?: boolean) {
    var container = document.getElementById('toast-container');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'toast' + (isError ? ' toast-error' : '');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 3000);
  }

  function showMentionToast(msg: any) {
    var container = document.getElementById('toast-container');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'toast toast-mention';
    toast.innerHTML =
      '<span class="toast-mention-label">Mention</span>' +
      '<strong>' + escapeHtml(msg.sender || 'Unknown') + '</strong> in ' +
      escapeHtml(msg.channelName) + ': ' + escapeHtml(msg.message).substring(0, 80) +
      (msg.message && msg.message.length > 80 ? '...' : '');
    container.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 5000);
  }

  function showWhisperToast(msg: any) {
    var container = document.getElementById('toast-container');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'toast toast-whisper';
    toast.innerHTML =
      '<span class="toast-whisper-label">Whisper</span>' +
      '<strong>' + escapeHtml(msg.sender || 'Unknown') + '</strong>: ' +
      escapeHtml(msg.message).substring(0, 80) +
      (msg.message && msg.message.length > 80 ? '...' : '');
    container.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 5000);
  }

  function renderNotifList() {
    var container = document.getElementById('notif-list') as HTMLElement | null;
    var badge = document.getElementById('notif-badge') as HTMLElement | null;
    if (!container || !badge) return;

    if (mentions.length === 0) {
      container.innerHTML = '<div class="notif-empty">No mentions or whispers yet.</div>';
      badge.style.display = 'none';
      return;
    }

    badge.textContent = '' + unreadCount;
    badge.style.display = unreadCount > 0 ? '' : 'none';

    var html = '';
    for (var i = mentions.length - 1; i >= 0; i--) {
      var m = mentions[i];
      var time = new Date(m.timestamp).toLocaleTimeString();
      var isWhisper = m.type === 'whisper';
      var readClass = m.read ? '' : ' notif-unread';
      var whisperClass = isWhisper ? ' notif-whisper' : '';
      var badgeHtml = isWhisper
        ? '<span class="notif-whisper-badge">DM</span>'
        : '<span class="chat-mention-badge">@</span>';
      html +=
        '<div class="notif-entry' + readClass + whisperClass + '" data-notif-idx="' + i + '">' +
          '<span class="chat-time">' + time + '</span>' +
          '<span class="chat-channel">[' + escapeHtml(m.channelName) + ']</span>' +
          badgeHtml +
          '<span class="chat-sender">' + escapeHtml(m.sender || 'Unknown') + '</span>' +
          '<span class="chat-text">' + escapeHtml(m.message).substring(0, 120) + '</span>' +
        '</div>';
    }
    container.innerHTML = html;
  }

  function activateChatPanel() {
    deps.navLinks.forEach(function (link: any) { link.classList.remove('active'); });
    deps.panels.forEach(function (panel: any) { panel.classList.remove('active'); });
    var chatLink = document.querySelector('#sidebar a[data-panel="chat"]') as HTMLElement | null;
    if (chatLink) chatLink.classList.add('active');
    var chatPanel = document.getElementById('panel-chat');
    if (chatPanel) chatPanel.classList.add('active');
    if (deps.contentEl) deps.contentEl.classList.add('chat-active');
  }

  deps.socket.on('chat:history', function (messages: any[]) {
    chatMessages = messages.slice(-MAX_CHAT);
    renderChatLog();
  });

  deps.socket.on('chat:message', function (msg: any) {
    chatMessages.push(msg);
    while (chatMessages.length > MAX_CHAT) {
      chatMessages.shift();
    }

    if (!chatMsgMatchesFilter(msg) || !chatLog) return;

    if (!activeChatBotId && msg.channel !== 0 && String(msg.channel) !== '0') {
      var key = chatDedupKey(msg);
      var now = msg.timestamp;
      if (recentChatKeys[key] !== undefined && now - recentChatKeys[key] < 3000) return;
      recentChatKeys[key] = now;
      setTimeout(function () { delete recentChatKeys[key]; }, 5000);
    }

    chatLog.appendChild(renderChatEntry(msg));

    while (chatLog.children.length > MAX_CHAT) {
      chatLog.removeChild(chatLog.firstChild as ChildNode);
    }

    maybeAutoScrollChatLog();
  });

  var channelTabsEl = document.getElementById('chat-channel-tabs');
  var botTabsEl = document.getElementById('chat-bot-tabs');

  if (channelTabsEl) {
    var channelTabs = channelTabsEl;
    channelTabs.addEventListener('click', function (e: any) {
      var tab = e.target.closest('.chat-tab');
      if (!tab) return;
      channelTabs.querySelectorAll('.chat-tab.active').forEach(function (t: any) {
        t.classList.remove('active');
      });
      tab.classList.add('active');
      activeChatChannel = tab.getAttribute('data-channel') || 'all';
      renderChatLog();
    });
  }

  if (botTabsEl) {
    var botTabs = botTabsEl;
    botTabs.addEventListener('click', function (e: any) {
      var tab = e.target.closest('.chat-tab');
      if (!tab) return;
      botTabs.querySelectorAll('.chat-tab.active').forEach(function (t: any) {
        t.classList.remove('active');
      });
      tab.classList.add('active');
      activeChatBotId = tab.getAttribute('data-bot') || '';
      renderChatLog();
    });
  }

  var chatClearBtn = document.getElementById('chat-clear');
  if (chatClearBtn && chatLog) {
    var chatLogEl = chatLog;
    chatClearBtn.addEventListener('click', function () {
      chatMessages = [];
      chatLogEl.innerHTML = '';
    });
  }

  var chatBotSelect = document.getElementById('chat-bot-select') as HTMLSelectElement | null;
  if (chatBotSelect) {
    var chatBotSelectEl = chatBotSelect;
    chatBotSelectEl.addEventListener('change', function () {
      deps.setSelectedChatBotId(chatBotSelectEl.value);
    });
  }

  var whisperBotSelect = document.getElementById('whisper-bot-select') as HTMLSelectElement | null;
  if (whisperBotSelect) {
    var whisperBotSelectEl = whisperBotSelect;
    whisperBotSelectEl.addEventListener('change', function () {
      deps.setSelectedWhisperBotId(whisperBotSelectEl.value);
    });
  }

  var sayBtn = document.getElementById('btn-say');
  if (sayBtn) {
    var sayBtnEl = sayBtn;
    sayBtnEl.addEventListener('click', function () {
      var messageInput = document.getElementById('say-message') as HTMLInputElement | null;
      var message = messageInput ? messageInput.value.trim() : '';
      var botId = deps.getSelectedChatBotId() || (chatBotSelect ? chatBotSelect.value : '');
      if (message && botId) {
        deps.socket.emit('bot:say', { botId: botId, message: message });
        if (messageInput) messageInput.value = '';
      }
    });
  }

  var sayMessageInput = document.getElementById('say-message');
  if (sayMessageInput && sayBtn) {
    var sayBtnEl = sayBtn;
    sayMessageInput.addEventListener('keydown', function (e: any) {
      if (e.key === 'Enter') {
        sayBtnEl.click();
      }
    });
  }

  var whisperBtn = document.getElementById('btn-whisper');
  if (whisperBtn) {
    var whisperBtnEl = whisperBtn;
    whisperBtnEl.addEventListener('click', function () {
      var targetInput = document.getElementById('whisper-target') as HTMLInputElement | null;
      var messageInput = document.getElementById('whisper-message') as HTMLInputElement | null;
      var target = targetInput ? targetInput.value.trim() : '';
      var message = messageInput ? messageInput.value.trim() : '';
      var botId = deps.getSelectedWhisperBotId() || (whisperBotSelect ? whisperBotSelect.value : '');
      if (target && message && botId) {
        deps.socket.emit('bot:whisper', { botId: botId, target: target, message: message });
        if (messageInput) messageInput.value = '';
      }
    });
  }

  var whisperMessageInput = document.getElementById('whisper-message');
  if (whisperMessageInput && whisperBtn) {
    var whisperBtnEl = whisperBtn;
    whisperMessageInput.addEventListener('keydown', function (e: any) {
      if (e.key === 'Enter') {
        whisperBtnEl.click();
      }
    });
  }

  deps.socket.on('bot:notification', function (data: any) {
    showToast(data.message, false);
  });

  deps.socket.on('bot:error', function (data: any) {
    showToast(data.message, true);
  });

  deps.socket.on('toast', function (message: string) {
    showToast(message);
  });

  deps.socket.on('mention:detected', function (msg: any) {
    mentions.push({
      type: 'mention',
      timestamp: msg.timestamp,
      sender: msg.sender,
      message: msg.message,
      channelName: msg.channelName,
      channel: msg.channel,
      botId: msg.botId,
      mentions: msg.mentions,
      read: false
    });
    while (mentions.length > MAX_MENTIONS) {
      if (!mentions[0].read) unreadCount--;
      mentions.shift();
    }
    unreadCount++;
    renderNotifList();
    showMentionToast(msg);
  });

  deps.socket.on('whisper:received', function (msg: any) {
    mentions.push({
      type: 'whisper',
      timestamp: msg.timestamp,
      sender: msg.sender,
      message: msg.message,
      channelName: 'Whisper',
      channel: 0,
      botId: msg.botId,
      read: false
    });
    while (mentions.length > MAX_MENTIONS) {
      if (!mentions[0].read) unreadCount--;
      mentions.shift();
    }
    unreadCount++;
    renderNotifList();
    showWhisperToast(msg);
  });

  var notifMarkReadBtn = document.getElementById('notif-mark-read');
  if (notifMarkReadBtn) {
    notifMarkReadBtn.addEventListener('click', function () {
      for (var i = 0; i < mentions.length; i++) {
        mentions[i].read = true;
      }
      unreadCount = 0;
      renderNotifList();
    });
  }

  var notifClearBtn = document.getElementById('notif-clear');
  if (notifClearBtn) {
    notifClearBtn.addEventListener('click', function () {
      mentions = [];
      unreadCount = 0;
      renderNotifList();
    });
  }

  var notifList = document.getElementById('notif-list');
  if (notifList) {
    notifList.addEventListener('click', function (e: any) {
      var entry = e.target.closest('.notif-entry');
      if (!entry) return;
      var idx = parseInt(entry.dataset.notifIdx, 10);
      if (mentions[idx] && !mentions[idx].read) {
        mentions[idx].read = true;
        unreadCount = Math.max(0, unreadCount - 1);
        renderNotifList();
      }
      activateChatPanel();
    });
  }

  return {
    renderChatBotTabs: renderChatBotTabs,
    showToast: showToast
  };
}
