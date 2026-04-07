// @ts-nocheck
import { escapeHtml } from './text';

type NpcLeakUiDeps = {
  socket: any,
  navLinks: any,
  showToast: (message: string, isError?: boolean) => void,
};

export function createNpcLeakUi(deps: NpcLeakUiDeps) {
  var socket = deps.socket;
  var navLinks = deps.navLinks;
  var showToast = deps.showToast;

  var npcleakLogEl = document.getElementById('npcleak-log');
  var npcleakStatusEl = document.getElementById('npcleak-status');
  var npcleakStatusText = document.getElementById('npcleak-status-text');
  var npcleakLeaksSection = document.getElementById('npcleak-leaks-section');
  var npcleakLeaksList = document.getElementById('npcleak-leaks-list');
  var npcleakStartBtn = document.getElementById('npcleak-start-btn');
  var npcleakStopBtn = document.getElementById('npcleak-stop-btn');
  var npcleakRefreshBtn = document.getElementById('npcleak-refresh-btn');
  var npcleakTarget = document.getElementById('npcleak-target');
  var npcleakClicks = document.getElementById('npcleak-clicks');
  var npcleakInterval = document.getElementById('npcleak-interval');
  var npcleakLogEntries = [];

  function npcleakColorForOpcode(hex) {
    if (hex === '0x6A') return '#ef4444';
    if (hex === '0x2F') return '#60a5fa';
    if (hex === '0x1A') return '#a78bfa';
    if (hex === '0x3A') return '#4ade80';
    if (hex === '0x0A') return '#fbbf24';
    if (hex === '0x43') return '#38bdf8';
    return '#94a3b8';
  }

  function npcleakAddLogLine(html) {
    if (!npcleakLogEl) return;
    var div = document.createElement('div');
    div.innerHTML = html;
    npcleakLogEl.appendChild(div);
    npcleakLogEl.scrollTop = npcleakLogEl.scrollHeight;
  }

  function npcleakFormatEntry(entry) {
    var timeStr = (entry.elapsed / 1000).toFixed(1) + 's';
    var arrow = entry.direction === 'sent' ? '<span style="color:#38bdf8;">&gt;&gt;</span>' : '<span style="color:#fb923c;">&lt;&lt;</span>';
    var color = npcleakColorForOpcode(entry.opcodeHex);
    var line = '<span style="color:#6b7280;">[' + timeStr + ']</span> ' +
      arrow + ' ' +
      '<span style="color:' + color + ';font-weight:600;">' + entry.opcodeHex + '</span> ' +
      '<span style="color:#d1d5db;">' + escapeHtml(entry.summary) + '</span> ' +
      '<span style="color:#6b7280;">(' + entry.bodyLength + 'b)</span>';

    if (entry.summary && entry.summary.indexOf('OVERFLOW') !== -1) {
      line = '<div style="background:#1c1010;border-left:3px solid #ef4444;padding:2px 6px;margin:2px 0;">' + line + '</div>';
    }

    if (entry.opcodeHex === '0x6A' || (entry.direction === 'recv' && ['0x2F', '0x1A', '0x3A', '0x0A', '0x0C', '0x0D', '0x0E', '0x11', '0x33', '0x39', '0x3B', '0x68'].indexOf(entry.opcodeHex) === -1)) {
      line += '<div style="color:#ef4444;margin-left:20px;word-break:break-all;">' + escapeHtml(entry.payloadHex) + '</div>';
    }
    return line;
  }

  function npcleakUpdateStatus(data) {
    if (!npcleakStatusEl) return;
    npcleakStatusEl.style.display = 'block';

    if (data.error) {
      npcleakStatusText.innerHTML = '<span style="color:#ef4444;">Error: ' + escapeHtml(data.error) + '</span>';
      npcleakStartBtn.disabled = false;
      npcleakStopBtn.disabled = true;
      return;
    }

    if (data.active) {
      var elapsed = (data.elapsed / 1000).toFixed(0);
      npcleakStatusText.innerHTML =
        '<span style="color:#4ade80;">SCANNING</span> ' +
        escapeHtml(data.targetName) + ' (' + data.targetSerial + ') &mdash; ' +
        'Click ' + data.clickCount + '/' + data.maxClicks + ' &mdash; ' +
        data.packetsLogged + ' packets &mdash; ' +
        elapsed + 's &mdash; ' +
        '<span style="color:' + (data.leaksFound > 0 ? '#ef4444;font-weight:700' : '#6b7280') + ';">' +
        data.leaksFound + ' leaks</span>';
      npcleakStartBtn.disabled = true;
      npcleakStopBtn.disabled = false;
    } else {
      npcleakStatusText.innerHTML =
        '<span style="color:#94a3b8;">IDLE</span>' +
        (data.clickCount > 0 ? ' &mdash; Last scan: ' + data.clickCount + ' clicks, ' + data.packetsLogged + ' packets, ' + data.leaksFound + ' leaks' : '');
      npcleakStartBtn.disabled = false;
      npcleakStopBtn.disabled = true;
    }

    if (data.leaks && data.leaks.length > 0) {
      npcleakLeaksSection.style.display = 'block';
      npcleakLeaksList.innerHTML = '';
      for (var i = 0; i < data.leaks.length; i++) {
        var leak = data.leaks[i];
        var el = document.createElement('div');
        el.style.cssText = 'padding:8px 12px;background:#1c1010;border:1px solid #ef4444;border-radius:4px;font-family:Fira Code,monospace;font-size:11px;';
        el.innerHTML = '<div style="color:#ef4444;font-weight:700;">Leak #' + (i + 1) + ' at ' + (leak.elapsed / 1000).toFixed(1) + 's</div>' +
          '<div style="color:#fbbf24;">Name: ' + escapeHtml(leak.parsedName) + '</div>' +
          '<div style="color:#d1d5db;">' + escapeHtml(leak.parsedData) + '</div>' +
          '<div style="color:#6b7280;word-break:break-all;margin-top:4px;">Raw: ' + escapeHtml(leak.fullPayload) + '</div>';
        npcleakLeaksList.appendChild(el);
      }
    }
  }

  socket.on('npcleak:status', npcleakUpdateStatus);

  socket.on('npcleak:log', function (entry) {
    npcleakLogEntries.push(entry);
    npcleakAddLogLine(npcleakFormatEntry(entry));
  });

  socket.on('npcleak:leakFound', function (leak) {
    npcleakAddLogLine('<div style="color:#ef4444;font-weight:700;padding:4px 0;">★★★ LEAK DETECTED: ' + escapeHtml(leak.parsedName) + ' ★★★</div>');
    showToast('LEAK DETECTED: ' + leak.parsedName);
  });

  socket.on('npcleak:npcList', function (npcs) {
    if (!npcleakTarget) return;
    npcleakTarget.innerHTML = '<option value="">-- Select NPC (' + npcs.length + ' entities) --</option>';
    for (var i = 0; i < npcs.length; i++) {
      var opt = document.createElement('option');
      opt.value = npcs[i].serial;
      opt.textContent = npcs[i].name + ' (0x' + npcs[i].serial.toString(16).toUpperCase() + ')';
      opt.dataset.name = npcs[i].name;
      npcleakTarget.appendChild(opt);
    }
  });

  if (npcleakRefreshBtn) {
    npcleakRefreshBtn.addEventListener('click', function () {
      socket.emit('npcleak:listNpcs');
    });
  }

  if (npcleakStartBtn) {
    npcleakStartBtn.addEventListener('click', function () {
      var serial = 0;
      var name = '';
      var manualSerial = document.getElementById('npcleak-manual-serial');
      var manualName = document.getElementById('npcleak-manual-name');
      if (manualSerial && manualSerial.value.trim()) {
        serial = parseInt(manualSerial.value.trim(), 16);
        name = (manualName && manualName.value.trim()) || ('NPC_0x' + serial.toString(16).toUpperCase());
        if (!serial || isNaN(serial)) {
          showToast('Invalid hex serial. Use format like 575C');
          return;
        }
      } else {
        var selected = npcleakTarget.options[npcleakTarget.selectedIndex];
        if (!selected || !selected.value) {
          showToast('Select a target NPC or enter a serial manually.');
          return;
        }
        serial = parseInt(selected.value);
        name = selected.dataset.name || '';
      }

      var maxClicks = parseInt(npcleakClicks.value) || 20;
      var intervalMs = parseInt(npcleakInterval.value) || 500;
      var lookupEl = document.getElementById('npcleak-lookup');
      var lookupName = lookupEl ? lookupEl.value.trim() : '';

      npcleakLogEntries = [];
      npcleakLogEl.innerHTML = '';
      if (npcleakLeaksSection) npcleakLeaksSection.style.display = 'none';

      var startMsg = 'Starting scan on ' + escapeHtml(name) + ' (0x' + serial.toString(16).toUpperCase() + ') - ' + maxClicks + ' clicks @ ' + intervalMs + 'ms';
      if (lookupName) startMsg += ' — Lookup: ' + escapeHtml(lookupName);
      npcleakAddLogLine('<span style="color:#4ade80;">' + startMsg + '</span>');

      socket.emit('npcleak:start', {
        serial: serial,
        npcName: name,
        lookupName: lookupName,
        maxClicks: maxClicks,
        intervalMs: intervalMs
      });
    });
  }

  if (npcleakStopBtn) {
    npcleakStopBtn.addEventListener('click', function () {
      socket.emit('npcleak:stop');
    });
  }

  var npcleakClearBtn = document.getElementById('npcleak-clear-log-btn');
  if (npcleakClearBtn) {
    npcleakClearBtn.addEventListener('click', function () {
      npcleakLogEntries = [];
      npcleakLogEl.innerHTML = '<div style="color:var(--text-secondary);">Log cleared.</div>';
    });
  }

  var npcleakExportBtn = document.getElementById('npcleak-export-log-btn');
  if (npcleakExportBtn) {
    npcleakExportBtn.addEventListener('click', function () {
      if (npcleakLogEntries.length === 0) {
        showToast('No log data to export.');
        return;
      }
      var text = JSON.stringify(npcleakLogEntries, null, 2);
      var blob = new Blob([text], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'npcleak-log-' + Date.now() + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  for (var nli = 0; nli < navLinks.length; nli++) {
    if (navLinks[nli].getAttribute('data-panel') === 'npc-leak') {
      navLinks[nli].addEventListener('click', function () {
        socket.emit('npcleak:listNpcs');
        socket.emit('npcleak:status');
      });
    }
  }
}
