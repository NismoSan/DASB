// @ts-nocheck
import { escapeHtml, formatCountdown, formatFiredAgo } from './text';

type ScheduledUiDeps = {
  socket: any,
  getBotStates: () => Record<string, any>,
  showToast: (message: string, isError?: boolean) => void,
};

export function createScheduledUi(deps: ScheduledUiDeps) {
  var socket = deps.socket;
  var showToast = deps.showToast;
  var schedules = [];
  var schedActiveBot = 'all';

  function getBotLabel(botId) {
    var botStates = deps.getBotStates();
    if (!botId || botId === 'primary') return 'Primary Bot';
    if (botStates[botId] && botStates[botId].username) return botStates[botId].username;
    return botId;
  }

  function renderSchedBotTabs() {
    var tabBar = document.getElementById('sched-bot-tabs');
    var botIds = {};
    schedules.forEach(function (s) {
      var bid = s.botId || 'primary';
      botIds[bid] = true;
    });
    var html = '<button class="sched-bot-tab' + (schedActiveBot === 'all' ? ' active' : '') + '" data-sched-bot="all">All</button>';
    Object.keys(botIds).forEach(function (bid) {
      html += '<button class="sched-bot-tab' + (schedActiveBot === bid ? ' active' : '') + '" data-sched-bot="' + escapeHtml(bid) + '">' + escapeHtml(getBotLabel(bid)) + '</button>';
    });
    tabBar.innerHTML = html;
  }

  function renderScheduleList(list) {
    schedules = list || [];
    var container = document.getElementById('sched-list');

    renderSchedBotTabs();

    var filtered = schedActiveBot === 'all'
      ? schedules
      : schedules.filter(function (s) { return (s.botId || 'primary') === schedActiveBot; });

    if (filtered.length === 0) {
      container.innerHTML = '<div class="rules-empty">No schedules' + (schedActiveBot !== 'all' ? ' for this bot' : ' configured') + '.</div>';
      return;
    }

    var html = '';
    filtered.forEach(function (s) {
      var typeLabel = s.type === 'interval'
        ? 'Every ' + s.interval + ' min'
        : s.type === 'daily'
          ? 'Daily at ' + s.dailyTime
          : 'Once at ' + new Date(s.onetimeAt).toLocaleString();

      var msgTypeLabel = s.messageType === 'whisper'
        ? 'Whisper to ' + escapeHtml(s.whisperTarget || '?')
        : 'Say';

      var firedHtml = '';
      if (s.lastFired) {
        var icon = s.lastSuccess
          ? '<span class="sched-status-icon sched-ok" title="Succeeded">&#x2713;</span>'
          : '<span class="sched-status-icon sched-fail" title="Failed (bot offline)">&#x26D4;</span>';
        firedHtml = '<span class="sched-last-fired">' + icon + ' Last fired ' + formatFiredAgo(s.lastFired) + '</span>';
      }

      var countdownHtml = '';
      if (s.enabled && s.nextFireAt) {
        var remaining = s.nextFireAt - Date.now();
        countdownHtml = '<span class="sched-countdown" data-next-fire="' + s.nextFireAt + '">Next: ' + formatCountdown(remaining) + '</span>';
      }

      html +=
        '<div class="rule-item sched-item' + (s.enabled ? '' : ' sched-disabled') + '" data-id="' + escapeHtml(s.id) + '">' +
          '<div class="rule-header">' +
            '<span class="rule-name">' + escapeHtml(s.name || 'Unnamed') + '</span>' +
            '<div class="rule-actions">' +
              '<button class="btn btn-small sched-btn-fire" data-id="' + escapeHtml(s.id) + '" title="Fire now">Fire</button>' +
              '<button class="btn btn-small sched-btn-edit" data-id="' + escapeHtml(s.id) + '">Edit</button>' +
              '<button class="btn btn-small ' + (s.enabled ? 'btn-yellow sched-btn-disable' : 'btn-green sched-btn-enable') + '" data-id="' + escapeHtml(s.id) + '">' +
                (s.enabled ? 'Disable' : 'Enable') +
              '</button>' +
              '<button class="btn btn-small btn-red sched-btn-delete" data-id="' + escapeHtml(s.id) + '">Del</button>' +
            '</div>' +
          '</div>' +
          '<div class="rule-details">' +
            '<span class="rule-types">' + typeLabel + ' | ' + msgTypeLabel + '</span>' +
            '<span class="rule-pattern">' + escapeHtml(s.message || '').substring(0, 60) + (s.message && s.message.length > 60 ? '...' : '') + '</span>' +
            firedHtml +
            countdownHtml +
          '</div>' +
        '</div>';
    });
    container.innerHTML = html;
  }

  setInterval(function () {
    var els = document.querySelectorAll('.sched-countdown[data-next-fire]');
    els.forEach(function (el) {
      var nextFire = parseInt(el.dataset.nextFire);
      if (!nextFire) return;
      var remaining = nextFire - Date.now();
      el.textContent = 'Next: ' + formatCountdown(remaining);
    });
  }, 1000);

  document.getElementById('sched-bot-tabs').addEventListener('click', function (e) {
    var tab = e.target.closest('.sched-bot-tab');
    if (!tab) return;
    schedActiveBot = tab.dataset.schedBot;
    renderScheduleList(schedules);
  });

  socket.on('scheduled:list', function (list) {
    renderScheduleList(list);
    var select = document.getElementById('sched-bot');
    var currentVal = select.value;
    var html = '<option value="primary">Primary Bot</option>';
    var botStates = deps.getBotStates();
    Object.keys(botStates).forEach(function (id) {
      html += '<option value="' + escapeHtml(id) + '">' + escapeHtml(botStates[id].username || id) + '</option>';
    });
    select.innerHTML = html;
    if (currentVal && select.querySelector('option[value="' + currentVal + '"]')) select.value = currentVal;
  });

  socket.on('scheduled:fired', function (data) {
    var label = data.success ? 'fired' : 'FAILED';
    showToast('Schedule ' + label + ': ' + data.name, !data.success);
  });

  document.getElementById('sched-type').addEventListener('change', function () {
    var t = this.value;
    document.getElementById('sched-interval-cfg').style.display = t === 'interval' ? '' : 'none';
    document.getElementById('sched-daily-cfg').style.display = t === 'daily' ? '' : 'none';
    document.getElementById('sched-onetime-cfg').style.display = t === 'onetime' ? '' : 'none';
  });

  document.getElementById('sched-msg-type').addEventListener('change', function () {
    document.getElementById('sched-target-cfg').style.display = this.value === 'whisper' ? '' : 'none';
  });

  document.getElementById('sched-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var sched = {
      id: document.getElementById('sched-id').value || '',
      name: document.getElementById('sched-name').value.trim(),
      enabled: true,
      type: document.getElementById('sched-type').value,
      interval: parseInt(document.getElementById('sched-interval').value) || 30,
      dailyTime: document.getElementById('sched-daily-time').value || '08:00',
      onetimeAt: document.getElementById('sched-onetime-at').value || null,
      message: document.getElementById('sched-message').value.trim(),
      botId: document.getElementById('sched-bot').value,
      messageType: document.getElementById('sched-msg-type').value,
      whisperTarget: document.getElementById('sched-whisper-target').value.trim()
    };
    if (!sched.name || !sched.message) {
      showToast('Name and message are required', true);
      return;
    }
    for (var i = 0; i < schedules.length; i++) {
      if (schedules[i].id === sched.id) {
        sched.enabled = schedules[i].enabled;
        break;
      }
    }
    socket.emit('scheduled:save', sched);
    clearSchedForm();
  });

  document.getElementById('sched-form-clear').addEventListener('click', clearSchedForm);

  function clearSchedForm() {
    document.getElementById('sched-id').value = '';
    document.getElementById('sched-name').value = '';
    document.getElementById('sched-message').value = '';
    document.getElementById('sched-whisper-target').value = '';
    document.getElementById('sched-form-title').textContent = 'Add Schedule';
    document.getElementById('sched-form-fold').removeAttribute('open');
    document.getElementById('sched-type').value = 'interval';
    document.getElementById('sched-interval').value = '30';
    document.getElementById('sched-daily-time').value = '08:00';
    document.getElementById('sched-onetime-at').value = '';
    document.getElementById('sched-interval-cfg').style.display = '';
    document.getElementById('sched-daily-cfg').style.display = 'none';
    document.getElementById('sched-onetime-cfg').style.display = 'none';
    document.getElementById('sched-msg-type').value = 'say';
    document.getElementById('sched-target-cfg').style.display = 'none';
  }

  document.getElementById('sched-list').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-id]');
    if (!btn) return;
    var id = btn.dataset.id;

    if (btn.classList.contains('sched-btn-delete')) {
      if (confirm('Delete this schedule?')) socket.emit('scheduled:delete', { id: id });
    } else if (btn.classList.contains('sched-btn-enable')) {
      socket.emit('scheduled:toggle', { id: id, enabled: true });
    } else if (btn.classList.contains('sched-btn-disable')) {
      socket.emit('scheduled:toggle', { id: id, enabled: false });
    } else if (btn.classList.contains('sched-btn-fire')) {
      socket.emit('scheduled:fireNow', { id: id });
    } else if (btn.classList.contains('sched-btn-edit')) {
      var sched = null;
      for (var i = 0; i < schedules.length; i++) {
        if (schedules[i].id === id) { sched = schedules[i]; break; }
      }
      if (!sched) return;
      document.getElementById('sched-id').value = sched.id;
      document.getElementById('sched-name').value = sched.name || '';
      document.getElementById('sched-type').value = sched.type || 'interval';
      document.getElementById('sched-type').dispatchEvent(new Event('change'));
      document.getElementById('sched-interval').value = sched.interval || 30;
      document.getElementById('sched-daily-time').value = sched.dailyTime || '08:00';
      document.getElementById('sched-onetime-at').value = sched.onetimeAt || '';
      document.getElementById('sched-message').value = sched.message || '';
      document.getElementById('sched-bot').value = sched.botId || 'primary';
      document.getElementById('sched-msg-type').value = sched.messageType || 'say';
      document.getElementById('sched-msg-type').dispatchEvent(new Event('change'));
      document.getElementById('sched-whisper-target').value = sched.whisperTarget || '';
      document.getElementById('sched-form-title').textContent = 'Edit Schedule';
      document.getElementById('sched-form-fold').setAttribute('open', '');
    }
  });

  var currentUserList = [];
  var userlistSearchEl = document.getElementById('userlist-search');
  var userlistContainer = document.getElementById('userlist-container');
  var userlistTimestamp = document.getElementById('userlist-timestamp');
  var onlineCountBadge = document.getElementById('online-count');
  var userlistRefreshBtn = document.getElementById('userlist-refresh');

  function renderUserList(users, filter) {
    if (!users || users.length === 0) {
      userlistContainer.innerHTML = '<div class="notif-empty">No user list data yet. Data refreshes every 5 minutes.</div>';
      onlineCountBadge.style.display = 'none';
      return;
    }

    var filtered = users;
    if (filter) {
      var f = filter.toLowerCase();
      filtered = users.filter(function (u) {
        return u.name.toLowerCase().indexOf(f) !== -1 ||
               u.className.toLowerCase().indexOf(f) !== -1 ||
               (u.title && u.title.toLowerCase().indexOf(f) !== -1);
      });
    }

    onlineCountBadge.textContent = users.length;
    onlineCountBadge.style.display = '';

    var html = '<table class="userlist-table"><thead><tr>' +
      '<th>Name</th><th>Class</th><th>Title</th>' +
      '</tr></thead><tbody>';

    for (var i = 0; i < filtered.length; i++) {
      var u = filtered[i];
      var nameClass = u.isMaster ? 'userlist-name userlist-master' : 'userlist-name';
      html += '<tr>' +
        '<td class="' + nameClass + '">' + escapeHtml(u.name) + '</td>' +
        '<td class="userlist-class">' + escapeHtml(u.className) + '</td>' +
        '<td class="userlist-title">' + escapeHtml(u.title || '') + '</td>' +
        '</tr>';
    }

    html += '</tbody></table>';
    userlistContainer.innerHTML = html;
  }

  socket.on('userlist:update', function (data) {
    if (data && data.users) {
      currentUserList = data.users;
      renderUserList(currentUserList, userlistSearchEl ? userlistSearchEl.value : '');
      if (data.timestamp) {
        userlistTimestamp.textContent = 'Last updated: ' + new Date(data.timestamp).toLocaleTimeString();
      }
    }
  });

  if (userlistSearchEl) {
    userlistSearchEl.addEventListener('input', function () {
      renderUserList(currentUserList, userlistSearchEl.value);
    });
  }

  if (userlistRefreshBtn) {
    userlistRefreshBtn.addEventListener('click', function () {
      socket.emit('userlist:refresh');
    });
  }

  socket.emit('userlist:get');
}
