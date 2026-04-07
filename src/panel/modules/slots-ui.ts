// @ts-nocheck
import { escapeHtml } from './text';

type SlotsUiDeps = {
  socket: any,
  navLinks: any,
  showToast: (message: string, isError?: boolean) => void,
};

export function createSlotsUi(deps: SlotsUiDeps) {
  var socket = deps.socket;
  var navLinks = deps.navLinks;
  var showToast = deps.showToast;

  function slotsFetchState() {
    fetch('/api/slots').then(function (r) { return r.json(); }).then(function (data) {
      slotsRender(data);
    }).catch(function () {});
  }

  function slotsRender(state) {
    if (!state) return;

    var enabledEl = document.getElementById('slots-enabled');
    var spinCostEl = document.getElementById('slots-spin-cost');
    if (enabledEl) enabledEl.checked = state.config && state.config.enabled;
    if (spinCostEl) spinCostEl.value = (state.config && state.config.spinCost) || 1;

    var setEl = function (id, val) {
      var el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    var setClass = function (id, cls) {
      var el = document.getElementById(id);
      if (el) el.className = 'slots-stat-value ' + cls;
    };

    if (state.spinningPlayer) {
      setEl('slots-active-player', state.spinningPlayer);
      var spinPlayer = null;
      if (state.players) {
        for (var i = 0; i < state.players.length; i++) {
          if (state.players[i].playerName.toLowerCase() === state.spinningPlayer.toLowerCase()) {
            spinPlayer = state.players[i];
            break;
          }
        }
      }
      setEl('slots-active-balance', spinPlayer ? spinPlayer.balance.toLocaleString() : '?');
    } else {
      setEl('slots-active-player', 'None');
      setEl('slots-active-balance', '-');
    }
    setEl('slots-bot-gold', (state.botGoldCount || 0).toLocaleString());
    setEl('slots-max-bet', state.dynamicMaxBet != null ? state.dynamicMaxBet.toLocaleString() : '-');

    var bankWarning = document.getElementById('slots-bank-warning');
    if (bankWarning) {
      bankWarning.style.display = state.bankLow ? 'block' : 'none';
    }

    if (state.financials) {
      var f = state.financials;
      setEl('slots-total-deposited', f.totalDeposited.toLocaleString());
      setEl('slots-total-withdrawn', f.totalWithdrawn.toLocaleString());
      setEl('slots-outstanding', f.totalOutstandingBalance.toLocaleString());
      setEl('slots-total-bets', f.totalBets.toLocaleString());
      setEl('slots-total-payouts', f.totalPayouts.toLocaleString());
      setEl('slots-total-spins', f.totalSpins.toLocaleString());

      var profitEl = document.getElementById('slots-house-profit');
      if (profitEl) {
        profitEl.textContent = (f.houseProfit >= 0 ? '+' : '') + f.houseProfit.toLocaleString();
        profitEl.className = 'slots-stat-value ' + (f.houseProfit >= 0 ? 'positive' : 'negative');
      }

      var edgeEl = document.getElementById('slots-house-edge');
      if (edgeEl) {
        edgeEl.textContent = (f.houseEdge >= 0 ? '+' : '') + f.houseEdge.toLocaleString();
        edgeEl.className = 'slots-stat-value ' + (f.houseEdge >= 0 ? 'positive' : 'negative');
      }
      var edgePct = f.totalBets > 0 ? ((f.houseEdge / f.totalBets) * 100).toFixed(1) : '0.0';
      setEl('slots-edge-pct', edgePct + '% of total bets');

      if (f.ledger) {
        var periods = [
          { key: 'today', data: f.ledger.today },
          { key: 'week', data: f.ledger.week },
          { key: 'all', data: f.ledger.allTime }
        ];
        for (var pi = 0; pi < periods.length; pi++) {
          var p = periods[pi];
          if (!p.data) continue;
          setEl('ledger-' + p.key + '-spins', p.data.spins.toLocaleString());
          setEl('ledger-' + p.key + '-bets', p.data.bets.toLocaleString());
          setEl('ledger-' + p.key + '-payouts', p.data.payouts.toLocaleString());
          setEl('ledger-' + p.key + '-deposited', p.data.deposited.toLocaleString());
          setEl('ledger-' + p.key + '-withdrawn', p.data.withdrawn.toLocaleString());
          var profitId = 'ledger-' + p.key + '-profit';
          var profitVal = p.data.profit;
          setEl(profitId, (profitVal >= 0 ? '+' : '') + profitVal.toLocaleString());
          setClass(profitId, profitVal >= 0 ? 'positive' : 'negative');
        }
      }
    }

    if (state.banking) {
      var b = state.banking;
      setEl('slots-gold-on-hand', b.goldOnHand.toLocaleString());
      setEl('slots-bank-balance', b.bankBalance.toLocaleString());
      setEl('slots-banking-phase', b.phase || 'idle');
      setEl('slots-banking-enabled', b.config && b.config.enabled ? 'On' : 'Off');
      setEl('slots-banker-name', b.config ? b.config.bankerName : '-');

      var phaseEl = document.getElementById('slots-banking-phase');
      if (phaseEl) {
        phaseEl.style.background = b.phase && b.phase !== 'idle' ? 'var(--gold-400)' : '';
        phaseEl.style.color = b.phase && b.phase !== 'idle' ? '#000' : '';
      }

      var bankToggle = document.getElementById('slots-banking-toggle');
      if (bankToggle && document.activeElement !== bankToggle) bankToggle.checked = b.config.enabled;
      var bankerInput = document.getElementById('slots-banker-name-input');
      if (bankerInput && document.activeElement !== bankerInput) bankerInput.value = b.config.bankerName;
      var bankerSerialInput = document.getElementById('slots-banker-serial-input');
      if (bankerSerialInput && document.activeElement !== bankerSerialInput) bankerSerialInput.value = b.config.resolvedSerial || b.config.bankerSerial || 0;
      var bankHighInput = document.getElementById('slots-bank-high');
      if (bankHighInput && document.activeElement !== bankHighInput) bankHighInput.value = b.config.highWatermark;
      var bankDtInput = document.getElementById('slots-bank-deposit-target');
      if (bankDtInput && document.activeElement !== bankDtInput) bankDtInput.value = b.config.depositTarget;
    }

    if (state.offload) {
      setEl('slots-offload-phase', state.offload.phase);
      var offloadPhaseEl = document.getElementById('slots-offload-phase');
      if (offloadPhaseEl) {
        var isActive = state.offload.phase !== 'complete' && state.offload.phase !== 'failed';
        offloadPhaseEl.style.background = isActive ? 'var(--gold-400)' : state.offload.phase === 'failed' ? '#d32f2f' : '#4caf50';
        offloadPhaseEl.style.color = '#000';
      }
      var offloadStatus = '';
      if (state.offload.phase === 'complete') {
        offloadStatus = 'Transferred ' + state.offload.totalTransferred.toLocaleString() + ' gold to ' + state.offload.targetName;
      } else if (state.offload.phase === 'failed') {
        offloadStatus = state.offload.errorMessage || 'Transfer failed';
      } else {
        offloadStatus = 'Transferring to ' + state.offload.targetName + ': ' + state.offload.totalTransferred.toLocaleString() + ' / ' + state.offload.totalRequested.toLocaleString();
      }
      setEl('slots-offload-status', offloadStatus);
    } else {
      setEl('slots-offload-phase', 'idle');
      setEl('slots-offload-status', '');
      var offloadPhaseEl2 = document.getElementById('slots-offload-phase');
      if (offloadPhaseEl2) {
        offloadPhaseEl2.style.background = '';
        offloadPhaseEl2.style.color = '';
      }
    }

    var queueCountEl = document.getElementById('slots-queue-count');
    var queueTbody = document.querySelector('#slots-queue-table tbody');
    if (queueCountEl) queueCountEl.textContent = state.queueLength || 0;
    if (queueTbody) {
      var queue = state.queue || [];
      if (queue.length === 0) {
        queueTbody.innerHTML = '<tr class="empty-row"><td colspan="4">No players waiting</td></tr>';
      } else {
        var qrows = '';
        for (var qi = 0; qi < queue.length; qi++) {
          var q = queue[qi];
          var waitMin = Math.round((Date.now() - q.joinedAt) / 1000 / 60);
          qrows += '<tr><td>' + q.position + '</td><td>' + escapeHtml(q.playerName) + '</td><td class="gold-cell">' + q.bet.toLocaleString() + '</td><td>' + waitMin + 'm</td></tr>';
        }
        queueTbody.innerHTML = qrows;
      }
    }

    var spinTbody = document.querySelector('#slots-spin-log tbody');
    if (spinTbody) {
      var history = state.spinHistory || [];
      if (history.length === 0) {
        spinTbody.innerHTML = '<tr class="empty-row"><td colspan="5">No spins yet</td></tr>';
      } else {
        var rows = '';
        for (var j = history.length - 1; j >= 0; j--) {
          var s = history[j];
          var d = new Date(s.timestamp);
          var timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          var oc = s.outcome === 'jackpot' ? 'outcome-jackpot' : s.outcome === 'win' ? 'outcome-win' : s.outcome === 'push' ? 'outcome-push' : 'outcome-lose';
          var label = s.outcome === 'push' ? 'PUSH' : s.outcome.toUpperCase();
          rows += '<tr>' +
            '<td>' + escapeHtml(s.playerName) + '</td>' +
            '<td class="reel-cell">' + escapeHtml(s.reel[0]) + '</td>' +
            '<td class="' + oc + '">' + label + '</td>' +
            '<td class="gold-cell">' + (s.payout > 0 ? '+' : '') + s.payout.toLocaleString() + '</td>' +
            '<td>' + timeStr + '</td></tr>';
        }
        spinTbody.innerHTML = rows;
      }
    }

    var balTbody = document.querySelector('#slots-balances-table tbody');
    if (balTbody) {
      var players = state.players || [];
      if (players.length === 0) {
        balTbody.innerHTML = '<tr class="empty-row"><td colspan="6">No players yet</td></tr>';
      } else {
        var brows = '';
        players.sort(function (a, b) { return b.balance - a.balance; });
        for (var k = 0; k < players.length; k++) {
          var p = players[k];
          var winRate = (p.totalWon + p.totalLost) > 0 ? Math.round((p.totalWon / (p.totalWon + p.totalLost)) * 100) : 0;
          brows += '<tr>' +
            '<td>' + escapeHtml(p.playerName) + '</td>' +
            '<td class="gold-cell">' + p.balance.toLocaleString() + '</td>' +
            '<td class="gold-cell">' + p.totalDeposited.toLocaleString() + '</td>' +
            '<td class="gold-cell">' + p.totalWithdrawn.toLocaleString() + '</td>' +
            '<td>' + p.totalSpins + '</td>' +
            '<td class="wl-cell"><span style="color:#4caf50">' + p.totalWon + 'W</span> / <span style="color:#e57373">' + p.totalLost + 'L</span> <span style="color:var(--text-muted);font-size:0.65rem">(' + winRate + '%)</span></td></tr>';
        }
        balTbody.innerHTML = brows;
      }
    }

    if (state.tickets) {
      var ts = state.tickets.stats || {};
      setEl('ticket-total-sold', (ts.totalTickets || 0).toLocaleString());
      setEl('ticket-total-spent', (ts.totalSpent || 0).toLocaleString());
      setEl('ticket-total-won', (ts.totalWon || 0).toLocaleString());
      var ticketBadge = document.getElementById('ticket-stats-badge');
      if (ticketBadge) ticketBadge.textContent = (ts.totalTickets || 0) + ' tickets';

      var ticketProfitEl = document.getElementById('ticket-house-profit');
      if (ticketProfitEl) {
        var tp = ts.totalProfit || 0;
        ticketProfitEl.textContent = (tp >= 0 ? '+' : '') + tp.toLocaleString();
        ticketProfitEl.className = 'slots-stat-value ' + (tp >= 0 ? 'positive' : 'negative');
      }

      var ticketTbody = document.querySelector('#ticket-history-table tbody');
      if (ticketTbody) {
        var th = state.tickets.history || [];
        if (th.length === 0) {
          ticketTbody.innerHTML = '<tr class="empty-row"><td colspan="6">No tickets yet</td></tr>';
        } else {
          var trows = '';
          for (var ti = th.length - 1; ti >= 0; ti--) {
            var t = th[ti];
            var td = new Date(t.timestamp);
            var ttime = td.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            var tierColor = t.tier === 'gold' ? '#fbbf24' : t.tier === 'silver' ? '#94a3b8' : '#cd7f32';
            var toc = t.outcome === 'win' ? 'outcome-win' : 'outcome-lose';
            trows += '<tr>' +
              '<td>' + escapeHtml(t.playerName) + '</td>' +
              '<td><span style="color:' + tierColor + ';text-transform:capitalize;">' + escapeHtml(t.tier) + '</span></td>' +
              '<td class="gold-cell">' + t.cost.toLocaleString() + '</td>' +
              '<td class="' + toc + '">' + t.outcome.toUpperCase() + '</td>' +
              '<td class="gold-cell">' + (t.prize > 0 ? '+' + t.prize.toLocaleString() : '0') + '</td>' +
              '<td>' + ttime + '</td></tr>';
          }
          ticketTbody.innerHTML = trows;
        }
      }
    }
  }

  document.getElementById('slots-save-config').addEventListener('click', function () {
    var enabled = document.getElementById('slots-enabled').checked;
    var spinCost = parseInt(document.getElementById('slots-spin-cost').value) || 1;
    fetch('/api/slots/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: enabled, spinCost: spinCost })
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.success) {
        showToast('Slot machine config saved.');
        slotsFetchState();
      } else {
        showToast(data.error || 'Failed to save config', true);
      }
    }).catch(function () { showToast('Network error', true); });
  });

  document.getElementById('slots-end-session').addEventListener('click', function () {
    if (!confirm('Force end the active slot machine session?')) return;
    fetch('/api/slots/end-session', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.success) {
        showToast(data.message);
        slotsFetchState();
      } else {
        showToast(data.error || 'No active session', true);
      }
    }).catch(function () { showToast('Network error', true); });
  });

  document.getElementById('slots-clear-queue').addEventListener('click', function () {
    if (!confirm('Clear all players from the slot machine queue?')) return;
    fetch('/api/slots/clear-queue', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.success) {
        showToast(data.message);
        slotsFetchState();
      } else {
        showToast(data.error || 'Failed to clear queue', true);
      }
    }).catch(function () { showToast('Network error', true); });
  });

  document.getElementById('slots-bank-save').addEventListener('click', function () {
    var payload = {
      enabled: document.getElementById('slots-banking-toggle').checked,
      bankerName: document.getElementById('slots-banker-name-input').value.trim() || 'Celesta',
      bankerSerial: parseInt(document.getElementById('slots-banker-serial-input').value) || 0,
      highWatermark: parseInt(document.getElementById('slots-bank-high').value) || 80000000,
      depositTarget: parseInt(document.getElementById('slots-bank-deposit-target').value) || 15000000
    };
    fetch('/api/slots/banking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.success) {
        showToast('Banking config saved.');
        slotsFetchState();
      } else {
        showToast(data.error || 'Failed to save banking config', true);
      }
    }).catch(function () { showToast('Network error', true); });
  });

  document.getElementById('slots-bank-deposit').addEventListener('click', function () {
    var amount = parseInt(document.getElementById('slots-banking-amount').value);
    if (!amount || amount <= 0) return showToast('Enter a valid amount', true);
    fetch('/api/slots/banking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manualDeposit: amount })
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.success) {
        showToast('Depositing ' + amount.toLocaleString() + ' gold to bank...');
        slotsFetchState();
      } else {
        showToast(data.error || 'Deposit failed', true);
      }
    }).catch(function () { showToast('Network error', true); });
  });

  document.getElementById('slots-bank-withdraw').addEventListener('click', function () {
    var amount = parseInt(document.getElementById('slots-banking-amount').value);
    if (!amount || amount <= 0) return showToast('Enter a valid amount', true);
    fetch('/api/slots/banking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manualWithdraw: amount })
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.success) {
        showToast('Withdrawing ' + amount.toLocaleString() + ' gold from bank...');
        slotsFetchState();
      } else {
        showToast(data.error || 'Withdraw failed', true);
      }
    }).catch(function () { showToast('Network error', true); });
  });

  document.getElementById('slots-bank-override').addEventListener('click', function () {
    var payload = {};
    var goh = document.getElementById('slots-set-gold-on-hand').value;
    var bb = document.getElementById('slots-set-bank-balance').value;
    if (goh !== '') payload.goldOnHand = parseInt(goh) || 0;
    if (bb !== '') payload.bankBalance = parseInt(bb) || 0;
    if (Object.keys(payload).length === 0) return showToast('Enter at least one value', true);
    fetch('/api/slots/banking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.success) {
        showToast('Values updated.');
        slotsFetchState();
      } else {
        showToast(data.error || 'Failed to update', true);
      }
    }).catch(function () { showToast('Network error', true); });
  });

  document.getElementById('slots-offload-btn').addEventListener('click', function () {
    var target = document.getElementById('slots-offload-target').value.trim();
    var amount = parseInt(document.getElementById('slots-offload-amount').value);
    if (!target) return showToast('Enter a target character name', true);
    if (!amount || amount <= 0) return showToast('Enter a valid amount', true);
    fetch('/api/slots/offload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetName: target, amount: amount })
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.success) {
        showToast('Offload initiated to ' + target);
        slotsFetchState();
      } else {
        showToast(data.error || 'Offload failed', true);
      }
    }).catch(function () { showToast('Network error', true); });
  });

  socket.on('slots:update', function (data) {
    slotsRender(data);
  });

  for (var si = 0; si < navLinks.length; si++) {
    if (navLinks[si].getAttribute('data-panel') === 'slots') {
      navLinks[si].addEventListener('click', function () {
        slotsFetchState();
      });
    }
  }
}
