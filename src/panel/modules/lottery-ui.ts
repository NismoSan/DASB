// @ts-nocheck
import { escapeHtml } from './text';

type LotteryUiDeps = {
  socket: any,
  navLinks: any,
  showToast: (message: string, isError?: boolean) => void,
};

export function createLotteryUi(deps: LotteryUiDeps) {
  var socket = deps.socket;
  var navLinks = deps.navLinks;
  var showToast = deps.showToast;

  var lotteryInitialized = false;
  var lastKnownTicketCount = -1;

  function lotteryFetchStatus() {
    fetch('/api/lottery').then(function (r) { return r.json(); }).then(function (data) {
      lotteryRender(data);
    }).catch(function () {});
  }

  function lotteryRender(state) {
    var badge = document.getElementById('lottery-status-badge');
    var nameEl = document.getElementById('lottery-drawing-name');
    var ticketCountEl = document.getElementById('lottery-ticket-count');
    var playerCountEl = document.getElementById('lottery-player-count');
    var winnerRow = document.getElementById('lottery-winner-row');
    var winnerName = document.getElementById('lottery-winner-name');
    var startForm = document.getElementById('lottery-start-form');
    var activeActions = document.getElementById('lottery-active-actions');
    var deliverActions = document.getElementById('lottery-deliver-actions');

    if (!badge) return;

    var isActive = state.active;
    var isDrawn = !state.active && (state.winner || state.tickets.length > 0);

    if (isActive) {
      badge.innerHTML = '<span class="lottery-badge lottery-badge-active">Active</span>';
    } else if (isDrawn) {
      badge.innerHTML = '<span class="lottery-badge lottery-badge-drawn">Drawn</span>';
    } else {
      badge.innerHTML = '<span class="lottery-badge lottery-badge-inactive">Inactive</span>';
    }

    nameEl.textContent = state.drawingName || '—';

    var tickets = state.tickets || [];
    ticketCountEl.textContent = tickets.length;
    var uniquePlayers = {};
    tickets.forEach(function (t) { uniquePlayers[t.playerName] = true; });
    playerCountEl.textContent = Object.keys(uniquePlayers).length;

    if (state.winner) {
      winnerRow.style.display = '';
      winnerName.textContent = state.winner;
    } else {
      winnerRow.style.display = 'none';
    }

    if (isActive) {
      startForm.style.display = 'none';
      activeActions.style.display = '';
      deliverActions.style.display = 'none';
    } else if (isDrawn) {
      startForm.style.display = 'none';
      activeActions.style.display = 'none';
      deliverActions.style.display = '';
    } else {
      startForm.style.display = '';
      activeActions.style.display = 'none';
      deliverActions.style.display = 'none';
    }

    var tbody = document.getElementById('lottery-ticket-tbody');
    if (tickets.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="lottery-empty">No tickets yet.</td></tr>';
      return;
    }

    var rows = '';
    tickets.forEach(function (t) {
      var isWinner = state.winner && t.playerName.toLowerCase() === state.winner.toLowerCase();
      var cls = isWinner ? ' class="lottery-winner-row"' : '';
      var d = new Date(t.timestamp);
      var timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      rows += '<tr' + cls + '>' +
        '<td>' + escapeHtml(String(t.ticketNumber)) + '</td>' +
        '<td>' + escapeHtml(t.playerName) + (isWinner ? ' &#9733;' : '') + '</td>' +
        '<td>' + escapeHtml(t.itemName || 'Gold Bar') + '</td>' +
        '<td>' + timeStr + '</td>' +
        '</tr>';
    });
    tbody.innerHTML = rows;
  }

  document.getElementById('lottery-start-btn').addEventListener('click', function () {
    var nameInput = document.getElementById('lottery-name-input');
    var drawingName = nameInput.value.trim() || 'Lottery';
    fetch('/api/lottery/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drawingName: drawingName })
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.success) {
        nameInput.value = '';
        showToast(data.message);
        lotteryFetchStatus();
      } else {
        showToast(data.message || data.error || 'Failed to start lottery', true);
      }
    }).catch(function () { showToast('Network error', true); });
  });

  document.getElementById('lottery-draw-btn').addEventListener('click', function () {
    if (!confirm('Draw a winner now? This will end ticket collection.')) return;
    fetch('/api/lottery/draw', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.success) {
        showToast(data.message);
        lotteryFetchStatus();
      } else {
        showToast(data.message || data.error || 'Failed to draw', true);
      }
    }).catch(function () { showToast('Network error', true); });
  });

  function lotteryCancel() {
    if (!confirm('Cancel the lottery? All tickets will be cleared.')) return;
    fetch('/api/lottery/cancel', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.success) {
        showToast(data.message);
        lotteryFetchStatus();
      } else {
        showToast(data.message || data.error || 'Failed to cancel', true);
      }
    }).catch(function () { showToast('Network error', true); });
  }

  document.getElementById('lottery-cancel-btn').addEventListener('click', lotteryCancel);

  document.getElementById('lottery-reset-btn').addEventListener('click', function () {
    if (!confirm('Delete this lottery? All tickets and data will be permanently erased.')) return;
    fetch('/api/lottery/reset', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.success) {
        showToast(data.message);
        lotteryFetchStatus();
      } else {
        showToast(data.message || data.error || 'Failed to reset', true);
      }
    }).catch(function () { showToast('Network error', true); });
  });

  document.getElementById('lottery-deliver-btn').addEventListener('click', function () {
    if (!confirm('Deliver all Gold Bars to the winner?')) return;
    fetch('/api/lottery/deliver', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.success || data.message) {
        showToast(data.message || 'Delivering prize...');
        lotteryFetchStatus();
      } else {
        showToast(data.error || 'Failed to deliver', true);
      }
    }).catch(function () { showToast('Network error', true); });
  });

  document.getElementById('lottery-sync-btn').addEventListener('click', function () {
    if (!confirm('Sync this lottery to the AislingExchange database?')) return;
    fetch('/api/lottery/sync', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.success) {
        showToast(data.message || 'Synced to AE!');
      } else {
        showToast(data.error || 'Failed to sync', true);
      }
    }).catch(function () { showToast('Network error', true); });
  });

  socket.on('lottery:update', function (data) {
    var newCount = data && data.tickets ? data.tickets.length : 0;
    if (lastKnownTicketCount >= 0 && newCount > lastKnownTicketCount) {
      var diff = newCount - lastKnownTicketCount;
      var newest = data.tickets[data.tickets.length - 1];
      var who = newest ? newest.playerName : 'Someone';
      showToast(who + ' traded a Gold Bar! (+' + diff + ' ticket' + (diff > 1 ? 's' : '') + ')');
    }
    lastKnownTicketCount = newCount;
    lotteryRender(data);
  });

  for (var li = 0; li < navLinks.length; li++) {
    if (navLinks[li].getAttribute('data-panel') === 'lottery') {
      navLinks[li].addEventListener('click', function () {
        if (!lotteryInitialized) {
          lotteryFetchStatus();
          lotteryInitialized = true;
        } else {
          lotteryFetchStatus();
        }
      });
    }
  }
}
