// @ts-nocheck
(function() {
  var socket = io();
  
  // Basic utils
  function escapeHtml(unsafe) {
    if (unsafe == null) return '';
    return String(unsafe).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function showToast(message, isError) {
    var container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.style.position = 'fixed';
      container.style.bottom = '20px';
      container.style.right = '20px';
      container.style.zIndex = '9999';
      document.body.appendChild(container);
    }
    var toast = document.createElement('div');
    toast.textContent = message;
    toast.style.background = isError ? '#e74c3c' : '#2ecc71';
    toast.style.color = '#fff';
    toast.style.padding = '12px 24px';
    toast.style.borderRadius = '8px';
    toast.style.marginBottom = '10px';
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    container.appendChild(toast);
    setTimeout(() => toast.style.opacity = '1', 10);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // Minimal map caching
  var mapListCache = { nodes: [], reachableIds: [] };
  socket.emit('nav:getMapList');
  socket.on('nav:mapList', function (data) {
    mapListCache = data;
    if(typeof updateProxyMapDropdown === 'function') updateProxyMapDropdown();
  });

  function getMapName(mapId) {
    for (var i = 0; i < mapListCache.nodes.length; i++) {
        if (mapListCache.nodes[i].mapId === mapId) return mapListCache.nodes[i].mapName;
    }
    return '';
  }

  function buildMapOptions(currentMapId) {
    var html = '<option value="">-- Select Map --</option>';
    var nameMap = {};
    mapListCache.nodes.forEach(function (n) { nameMap[n.mapId] = n.mapName; });
    var ids = mapListCache.reachableIds.length > 0 ? mapListCache.reachableIds : Object.keys(nameMap).map(Number).sort(function (a, b) { return a - b; });
    ids.forEach(function (id) {
      var selected = id === currentMapId ? ' selected' : '';
      html += '<option value="' + id + '"' + selected + '>' + escapeHtml(nameMap[id] || ('Map ' + id)) + ' (' + id + ')</option>';
    });
    return html;
  }

  // --- Start Proxy Logic Extracted from panel.js ---

  // ── MITM Proxy Panel ──────────────────────────────────────────

  var proxySessions = [];
  var proxyNpcs = [];
  var activeProxyPlayerId = null;
  var proxyNavStatuses = {}; // sessionId -> { state, target }

  // ── Sub-tab switching ──
  document.querySelectorAll('.proxy-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.proxy-tab').forEach(function (t) {
        t.classList.remove('active');
        t.style.opacity = '0.6';
        t.style.borderBottomColor = 'transparent';
      });
      tab.classList.add('active');
      tab.style.opacity = '1';
      tab.style.borderBottomColor = '#6bf';
      document.querySelectorAll('.proxy-tab-content').forEach(function (c) {
        c.style.display = 'none';
        c.classList.remove('active');
      });
      var target = document.getElementById('proxy-content-' + tab.getAttribute('data-proxy-tab'));
      if (target) { target.style.display = ''; target.classList.add('active'); }
    });
  });
  // Activate first tab
  var firstTab = document.querySelector('.proxy-tab.active');
  if (firstTab) { firstTab.style.opacity = '1'; firstTab.style.borderBottomColor = '#6bf'; }

  // ── Map dropdown for NPC placement ──
  function updateProxyMapDropdown() {
    var select = document.getElementById('proxy-npc-map');
    if (!select) return;
    var currentVal = select.value;
    select.innerHTML = buildMapOptions(currentVal ? parseInt(currentVal) : 0);
  }
  // Refresh when map list updates (piggyback on existing event)
  var _origMapListHandler = null;
  socket.on('nav:mapList', function () {
    // mapListCache is already updated by the main handler
    updateProxyMapDropdown();
  });
  // Initial populate
  setTimeout(updateProxyMapDropdown, 500);

  // ── Render functions ──
  function renderProxySessions() {
    renderProxyPlayerTabBar();
    renderActiveProxyPlayerTab();
    // Update chat target dropdown
    var targetSelect = document.getElementById('proxy-chat-target');
    if (targetSelect) {
      var currentVal = targetSelect.value;
      targetSelect.innerHTML = '<option value="broadcast">All Players</option>';
      for (var j = 0; j < proxySessions.length; j++) {
        var sess = proxySessions[j];
        var opt = document.createElement('option');
        opt.value = sess.id;
        opt.textContent = sess.characterName || sess.id;
        targetSelect.appendChild(opt);
      }
      targetSelect.value = currentVal;
    }
  }

  function renderProxyPlayerTabBar() {
    var tabBar = document.getElementById('proxy-player-tab-bar');
    var emptyMsg = document.getElementById('proxy-player-tabs-empty');
    if (!tabBar) return;
    var gameSessions = proxySessions.filter(function (s) { return s.phase === 'game' && s.characterName; });
    if (gameSessions.length === 0) {
      emptyMsg.style.display = '';
      tabBar.querySelectorAll('.bot-tab').forEach(function (t) { t.remove(); });
      document.getElementById('proxy-player-tab-content').innerHTML = '';
      activeProxyPlayerId = null;
      return;
    }
    emptyMsg.style.display = 'none';
    var sessionIds = gameSessions.map(function (s) { return s.id; });
    // Remove tabs for disconnected players
    tabBar.querySelectorAll('.bot-tab').forEach(function (tab) {
      if (sessionIds.indexOf(tab.dataset.proxyId) === -1) tab.remove();
    });
    // Add/update tabs
    gameSessions.forEach(function (s) {
      var existing = tabBar.querySelector('.bot-tab[data-proxy-id="' + s.id + '"]');
      if (existing) {
        existing.querySelector('.bot-tab-label').textContent = s.characterName || s.id;
        var navState = proxyNavStatuses[s.id];
        existing.dataset.status = navState && navState.state === 'walking' ? 'connected' : 'idle';
      } else {
        var tab = document.createElement('button');
        tab.className = 'bot-tab';
        tab.dataset.proxyId = s.id;
        tab.dataset.status = 'idle';
        tab.innerHTML = '<span class="bot-tab-dot"></span><span class="bot-tab-label">' + escapeHtml(s.characterName || s.id) + '</span>';
        tab.addEventListener('click', function () {
          activeProxyPlayerId = s.id;
          tabBar.querySelectorAll('.bot-tab').forEach(function (t) { t.classList.remove('active'); });
          tab.classList.add('active');
          renderActiveProxyPlayerTab();
        });
        tabBar.insertBefore(tab, emptyMsg);
      }
    });
    // Auto-select first tab if none selected
    if (!activeProxyPlayerId || sessionIds.indexOf(activeProxyPlayerId) === -1) {
      activeProxyPlayerId = sessionIds[0];
    }
    tabBar.querySelectorAll('.bot-tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.proxyId === activeProxyPlayerId);
    });
  }

  function renderActiveProxyPlayerTab() {
    var container = document.getElementById('proxy-player-tab-content');
    if (!container) return;
    if (!activeProxyPlayerId) { container.innerHTML = ''; return; }
    var session = null;
    for (var i = 0; i < proxySessions.length; i++) {
      if (proxySessions[i].id === activeProxyPlayerId) { session = proxySessions[i]; break; }
    }
    if (!session) { container.innerHTML = ''; return; }

    var ps = session.playerState || {};
    var mapName = getMapName(ps.mapNumber);
    var posStr = ps.x !== undefined ? ps.x + ', ' + ps.y : '--';
    var mapStr = mapName ? escapeHtml(mapName) + ' (' + ps.mapNumber + ')' : (ps.mapNumber ? 'Map ' + ps.mapNumber : '--');
    var sid = session.id;
    var navState = proxyNavStatuses[sid] || {};
    var navLabel = navState.state === 'walking' ? 'Walking...' : navState.state === 'failed' ? 'Failed' : 'Idle';

    var html = '<div class="bot-tab-panel" data-proxy-id="' + escapeHtml(sid) + '">' +

      // Header
      '<div class="btp-header">' +
        '<div class="btp-identity">' +
          '<span class="btp-name">' + escapeHtml(session.characterName || sid) + '</span>' +
          '<span class="btp-badge" style="background:#6bf;color:#000;">Proxy</span>' +
          '<span class="btp-status" data-status="' + (navState.state || 'idle') + '">' + navLabel + '</span>' +
        '</div>' +
      '</div>' +

      // Info bar
      '<div class="btp-info-bar">' +
        '<div class="btp-stat"><span class="btp-stat-label">Map</span><span class="btp-stat-value">' + mapStr + '</span></div>' +
        '<div class="btp-stat"><span class="btp-stat-label">Position</span><span class="btp-stat-value">' + posStr + '</span></div>' +
        '<div class="btp-stat"><span class="btp-stat-label">Session</span><span class="btp-stat-value" style="font-size:0.75em;opacity:0.6">' + escapeHtml(sid) + '</span></div>' +
      '</div>' +

      // Nav status
      '<div class="proxy-nav-status" data-proxy-id="' + escapeHtml(sid) + '"></div>' +

      // Two panels: Movement + Navigate
      '<div class="btp-panels">' +

        // Left: D-Pad + Walk To
        '<div class="btp-card btp-move-card">' +
          '<div class="btp-card-title">Movement</div>' +
          '<div class="dpad">' +
            '<div class="dpad-row dpad-center"><button data-dir="0" data-proxy-id="' + escapeHtml(sid) + '" class="btn btn-dpad proxy-dpad-btn" title="North">N</button></div>' +
            '<div class="dpad-row"><button data-dir="3" data-proxy-id="' + escapeHtml(sid) + '" class="btn btn-dpad proxy-dpad-btn" title="West">W</button><div class="dpad-center-gem"></div><button data-dir="1" data-proxy-id="' + escapeHtml(sid) + '" class="btn btn-dpad proxy-dpad-btn" title="East">E</button></div>' +
            '<div class="dpad-row dpad-center"><button data-dir="2" data-proxy-id="' + escapeHtml(sid) + '" class="btn btn-dpad proxy-dpad-btn" title="South">S</button></div>' +
          '</div>' +
          '<div class="btp-walk-xy">' +
            '<input type="number" class="proxy-nav-x" data-proxy-id="' + escapeHtml(sid) + '" placeholder="X">' +
            '<input type="number" class="proxy-nav-y" data-proxy-id="' + escapeHtml(sid) + '" placeholder="Y">' +
            '<button class="btn btn-small btn-green proxy-walk-btn" data-proxy-id="' + escapeHtml(sid) + '">Walk</button>' +
          '</div>' +
        '</div>' +

        // Right: Navigate to Map
        '<div class="btp-card btp-nav-card">' +
          '<div class="btp-card-title">Navigate to Map</div>' +
          '<select class="toolbar-select proxy-nav-map-select" data-proxy-id="' + escapeHtml(sid) + '">' + buildMapOptions(ps.mapNumber || null) + '</select>' +
          '<div class="btp-nav-coords">' +
            '<input type="number" class="proxy-nav-target-x" data-proxy-id="' + escapeHtml(sid) + '" placeholder="X (optional)">' +
            '<input type="number" class="proxy-nav-target-y" data-proxy-id="' + escapeHtml(sid) + '" placeholder="Y (optional)">' +
          '</div>' +
          '<div class="btp-nav-actions">' +
            '<button class="btn btn-small proxy-navigate-btn" data-proxy-id="' + escapeHtml(sid) + '">Navigate</button>' +
            '<button class="btn btn-small btn-red proxy-stop-btn" data-proxy-id="' + escapeHtml(sid) + '">Stop</button>' +
          '</div>' +
        '</div>' +

      '</div>' +
    '</div>';

    container.innerHTML = html;
    attachProxyPlayerTabEvents(sid);
  }

  function attachProxyPlayerTabEvents(sessionId) {
    var panel = document.querySelector('.bot-tab-panel[data-proxy-id="' + sessionId + '"]');
    if (!panel) return;

    // D-Pad buttons
    panel.querySelectorAll('.proxy-dpad-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        socket.emit('proxy:walk', { sessionId: sessionId, direction: parseInt(btn.dataset.dir) });
      });
    });

    // Walk To button
    var walkBtn = panel.querySelector('.proxy-walk-btn');
    if (walkBtn) {
      walkBtn.addEventListener('click', function () {
        var x = parseInt(panel.querySelector('.proxy-nav-x').value);
        var y = parseInt(panel.querySelector('.proxy-nav-y').value);
        if (isNaN(x) || isNaN(y)) { showToast('Enter X and Y coordinates'); return; }
        socket.emit('proxy:walkTo', { sessionId: sessionId, x: x, y: y });
        showToast('Walking to (' + x + ', ' + y + ')...');
      });
    }

    // Navigate button
    var navBtn = panel.querySelector('.proxy-navigate-btn');
    if (navBtn) {
      navBtn.addEventListener('click', function () {
        var mapSelect = panel.querySelector('.proxy-nav-map-select');
        var mapId = parseInt(mapSelect.value);
        if (isNaN(mapId)) { showToast('Select a map first'); return; }
        var x = parseInt(panel.querySelector('.proxy-nav-target-x').value);
        var y = parseInt(panel.querySelector('.proxy-nav-target-y').value);
        if (isNaN(x)) x = -1;
        if (isNaN(y)) y = -1;
        socket.emit('proxy:navigateTo', { sessionId: sessionId, mapId: mapId, x: x, y: y });
        var mapName = mapSelect.options[mapSelect.selectedIndex].textContent;
        showToast('Navigating to ' + mapName + '...');
      });
    }

    // Stop button
    var stopBtn = panel.querySelector('.proxy-stop-btn');
    if (stopBtn) {
      stopBtn.addEventListener('click', function () {
        socket.emit('proxy:stop', { sessionId: sessionId });
        showToast('Navigation stopped.');
      });
    }
  }

  function getMapName(mapId) {
    if (!mapListCache || !mapListCache.nodes) return '';
    for (var i = 0; i < mapListCache.nodes.length; i++) {
      if (mapListCache.nodes[i].mapId === mapId) return mapListCache.nodes[i].mapName;
    }
    return '';
  }

  var editingNpcSerial = null; // track which NPC is being edited

  function renderProxyNpcs() {
    var container = document.getElementById('proxy-npc-list');
    if (!container) return;
    if (proxyNpcs.length === 0) {
      container.innerHTML = '<div class="rules-empty">No virtual NPCs placed.</div>';
      return;
    }
    var dirNames = ['Up', 'Right', 'Down', 'Left'];
    var html = '';
    for (var i = 0; i < proxyNpcs.length; i++) {
      var npc = proxyNpcs[i];
      var mapName = getMapName(npc.mapNumber);
      var hasDialog = npc.dialog && npc.dialog.greeting;
      var hasHandler = npc.hasHandler;
      html += '<div class="rule-row" style="padding:0.5rem 0.75rem">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center">';
      html += '<div>';
      html += '<strong>' + escapeHtml(npc.name) + '</strong>';
      html += ' <span style="opacity:0.5;font-size:0.8em">Sprite ' + npc.sprite + '</span>';
      if (hasDialog) html += ' <span style="color:#6bf;font-size:0.75em" title="' + escapeHtml(npc.dialog.greeting) + '">💬</span>';
      if (hasHandler) html += ' <span style="color:#f90;font-size:0.75em" title="Has dynamic handler">⚡</span>';
      html += '</div>';
      html += '<div style="display:flex;gap:4px">';
      html += '<button class="btn btn-small" onclick="window._proxyEditNpc(' + npc.serial + ')" style="color:#6bf;font-size:0.75em">Edit</button>';
      html += '<button class="btn btn-small" onclick="window._proxyAuctionNpc(' + npc.serial + ')" style="color:#f90;font-size:0.75em" title="Assign auction handler">Auction</button>';
      html += '<button class="btn btn-small" onclick="window._proxyRemoveNpc(' + npc.serial + ')" style="color:#f66;font-size:0.75em">Remove</button>';
      html += '</div>';
      html += '</div>';
      html += '<div style="font-size:0.78em;opacity:0.55;margin-top:2px">';
      html += escapeHtml(mapName || 'Map ' + npc.mapNumber) + ' (' + npc.x + ',' + npc.y + ') ' + (dirNames[npc.direction] || '');
      html += ' <span style="opacity:0.6">| 0x' + npc.serial.toString(16).toUpperCase() + '</span>';
      html += '</div>';
      html += '</div>';
    }
    container.innerHTML = html;
  }

  window._proxyRemoveNpc = function (serial) {
    socket.emit('proxy:npc:remove', { serial: serial });
  };

  window._proxyEditNpc = function (serial) {
    var npc = null;
    for (var i = 0; i < proxyNpcs.length; i++) {
      if (proxyNpcs[i].serial === serial) { npc = proxyNpcs[i]; break; }
    }
    if (!npc) return;
    editingNpcSerial = serial;
    document.getElementById('proxy-npc-name').value = npc.name;
    document.getElementById('proxy-npc-sprite').value = npc.sprite;
    document.getElementById('proxy-npc-dir').value = npc.direction;
    document.getElementById('proxy-npc-x').value = npc.x;
    document.getElementById('proxy-npc-y').value = npc.y;
    // Set map dropdown
    var mapSelect = document.getElementById('proxy-npc-map');
    mapSelect.value = npc.mapNumber;
    if (!mapSelect.value) {
      // Map not in dropdown — add a temporary option
      var opt = document.createElement('option');
      opt.value = npc.mapNumber;
      opt.textContent = 'Map ' + npc.mapNumber;
      mapSelect.appendChild(opt);
      mapSelect.value = npc.mapNumber;
    }
    // Fill dialog steps into tree builder
    dialogSteps = [];
    if (npc.dialog && npc.dialog.steps && npc.dialog.steps.length > 0) {
      for (var j = 0; j < npc.dialog.steps.length; j++) {
        var s = npc.dialog.steps[j];
        dialogSteps.push({
          type: s.type || 'popup',
          text: s.text || '',
          autoClose: !!s.autoClose,
          options: (s.options || []).map(function (o) {
            return { text: o.text || '', action: o.action || 'close', gotoStep: o.gotoStep };
          })
        });
      }
    }
    renderDialogSteps();
    // Change button text
    var placeBtn = document.getElementById('btn-proxy-npc-place');
    if (placeBtn) placeBtn.textContent = 'Update NPC';
    showToast('Editing "' + npc.name + '" — change fields and click Update');
  };

  window._proxyAuctionNpc = function (serial) {
    socket.emit('proxy:npc:auction', { serial: serial });
  };

  function appendProxyLog(entries) {
    var logEl = document.getElementById('proxy-packet-log');
    var enabled = document.getElementById('proxy-log-enabled');
    if (!logEl || !enabled || !enabled.checked) return;
    if (logEl.querySelector('.rules-empty')) logEl.innerHTML = '';
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var dir = e.dir === 'client-to-server' ? '<span style="color:#6bf">C→S</span>' : '<span style="color:#fb6">S→C</span>';
      var op = '0x' + ('0' + e.op.toString(16)).slice(-2).toUpperCase();
      var line = document.createElement('div');
      line.innerHTML = dir + ' <span style="color:#aaa">[' + (e.char || e.sid) + ']</span> ' + op + ' <span style="opacity:0.5">' + e.len + 'b</span>';
      logEl.appendChild(line);
    }
    while (logEl.childNodes.length > 500) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
  }

  // ── Socket events ──
  socket.on('proxy:sessions', function (sessions) {
    proxySessions = sessions;
    renderProxySessions();
  });

  socket.on('proxy:players', function () { renderProxySessions(); });

  socket.on('proxy:npcs', function (npcs) {
    proxyNpcs = npcs;
    renderProxyNpcs();
  });

  socket.on('proxy:session:new', function (data) {
    proxySessions.push(data);
    renderProxySessions();
  });

  socket.on('proxy:session:game', function (data) {
    for (var i = 0; i < proxySessions.length; i++) {
      if (proxySessions[i].id === data.id) {
        proxySessions[i].characterName = data.characterName;
        proxySessions[i].phase = 'game';
        break;
      }
    }
    renderProxySessions();
  });

  socket.on('proxy:session:end', function (data) {
    proxySessions = proxySessions.filter(function (s) { return s.id !== data.id; });
    delete proxyNavStatuses[data.id];
    if (activeProxyPlayerId === data.id) activeProxyPlayerId = null;
    renderProxySessions();
  });

  // Real-time proxy player position updates
  socket.on('proxy:playerUpdate', function (data) {
    for (var i = 0; i < proxySessions.length; i++) {
      if (proxySessions[i].id === data.sessionId) {
        if (!proxySessions[i].playerState) proxySessions[i].playerState = {};
        if (data.x !== undefined) proxySessions[i].playerState.x = data.x;
        if (data.y !== undefined) proxySessions[i].playerState.y = data.y;
        if (data.mapNumber !== undefined) proxySessions[i].playerState.mapNumber = data.mapNumber;
        break;
      }
    }
    if (data.sessionId === activeProxyPlayerId) renderActiveProxyPlayerTab();
  });

  // Navigation status updates
  socket.on('proxy:navStatus', function (data) {
    proxyNavStatuses[data.sessionId] = { state: data.state, target: data.target };
    if (data.sessionId === activeProxyPlayerId) renderActiveProxyPlayerTab();
    renderProxyPlayerTabBar();
  });

  socket.on('proxy:packets', function (entries) { appendProxyLog(entries); });

  socket.on('proxy:npc:placed', function (data) {
    showToast('NPC placed (serial: ' + data.serial + ')');
  });

  socket.on('proxy:npc:click', function (data) {
    var logEl = document.getElementById('proxy-npc-clicks');
    if (!logEl) return;
    if (logEl.querySelector('.rules-empty')) logEl.innerHTML = '';
    var entry = document.createElement('div');
    entry.style.padding = '2px 0';
    var mapName = getMapName(data.mapNumber);
    entry.textContent = '[' + new Date().toLocaleTimeString() + '] ' + data.playerName + ' → "' + data.npcName + '"' + (mapName ? ' (' + mapName + ')' : '');
    logEl.appendChild(entry);
    while (logEl.childNodes.length > 50) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
  });

  // ── Dialog Tree Builder ──
  var dialogSteps = [];
  var DIALOG_STEP_LIMIT = 20;

  function syncStepsFromDOM() {
    var container = document.getElementById('proxy-npc-steps-list');
    if (!container) return;
    var stepEls = container.querySelectorAll('.dialog-step');
    for (var i = 0; i < stepEls.length; i++) {
      var el = stepEls[i];
      var step = dialogSteps[i];
      if (!step) continue;
      step.type = el.querySelector('.dialog-step-type').value;
      step.text = el.querySelector('.dialog-step-text').value;
      var acEl = el.querySelector('.dialog-step-autoclose');
      step.autoClose = acEl ? acEl.checked : false;
      if (step.type === 'menu') {
        var optRows = el.querySelectorAll('.dialog-step-option-row');
        step.options = [];
        for (var j = 0; j < optRows.length; j++) {
          var textEl = optRows[j].querySelector('.dialog-option-text');
          var actionEl = optRows[j].querySelector('.dialog-option-action');
          var gotoEl = optRows[j].querySelector('.dialog-option-goto');
          step.options.push({
            text: textEl ? textEl.value : '',
            action: actionEl ? actionEl.value : 'close',
            gotoStep: (actionEl && actionEl.value === 'goto' && gotoEl) ? parseInt(gotoEl.value) : undefined
          });
        }
      }
    }
  }

  function renderDialogSteps() {
    var container = document.getElementById('proxy-npc-steps-list');
    if (!container) return;
    container.innerHTML = '';
    for (var i = 0; i < dialogSteps.length; i++) {
      container.appendChild(buildStepCard(i));
    }
  }

  function buildStepCard(idx) {
    var step = dialogSteps[idx];
    var card = document.createElement('div');
    card.className = 'dialog-step';
    card.setAttribute('data-step-index', idx);

    // Header
    var header = document.createElement('div');
    header.className = 'dialog-step-header';

    var numLabel = document.createElement('span');
    numLabel.className = 'dialog-step-number';
    numLabel.textContent = 'Step ' + idx;
    header.appendChild(numLabel);

    var typeSelect = document.createElement('select');
    typeSelect.className = 'dialog-step-type';
    typeSelect.innerHTML = '<option value="popup"' + (step.type === 'popup' ? ' selected' : '') + '>Popup</option>' +
      '<option value="menu"' + (step.type === 'menu' ? ' selected' : '') + '>Menu</option>';
    typeSelect.addEventListener('change', (function (i) {
      return function () {
        syncStepsFromDOM();
        dialogSteps[i].type = this.value;
        if (this.value === 'menu' && (!dialogSteps[i].options || dialogSteps[i].options.length === 0)) {
          dialogSteps[i].options = [];
        }
        renderDialogSteps();
      };
    })(idx));
    header.appendChild(typeSelect);

    if (step.type === 'popup') {
      var acLabel = document.createElement('label');
      acLabel.className = 'dialog-step-autoclose-label';
      acLabel.innerHTML = '<input type="checkbox" class="dialog-step-autoclose"' + (step.autoClose ? ' checked' : '') + ' /> Auto-close';
      header.appendChild(acLabel);
    }

    var removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-small';
    removeBtn.style.color = '#f66';
    removeBtn.style.marginLeft = 'auto';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', (function (i) {
      return function () { removeDialogStep(i); };
    })(idx));
    header.appendChild(removeBtn);

    card.appendChild(header);

    // Text area
    var textarea = document.createElement('textarea');
    textarea.className = 'dialog-step-text';
    textarea.rows = 2;
    textarea.placeholder = idx === 0 ? 'Greeting / dialog text...' : 'Dialog text for this step...';
    textarea.value = step.text || '';
    card.appendChild(textarea);

    // Options section (menu only)
    if (step.type === 'menu') {
      var optContainer = document.createElement('div');
      optContainer.className = 'dialog-step-options';

      var opts = step.options || [];
      for (var j = 0; j < opts.length; j++) {
        optContainer.appendChild(buildOptionRow(idx, j, opts[j]));
      }

      var btnRow = document.createElement('div');
      btnRow.className = 'dialog-step-option-btns';

      var addOptBtn = document.createElement('button');
      addOptBtn.type = 'button';
      addOptBtn.className = 'btn btn-small';
      addOptBtn.textContent = '+ Option';
      addOptBtn.addEventListener('click', (function (i) {
        return function () {
          syncStepsFromDOM();
          addOptionToStep(i);
        };
      })(idx));
      btnRow.appendChild(addOptBtn);

      var addOptStepBtn = document.createElement('button');
      addOptStepBtn.type = 'button';
      addOptStepBtn.className = 'btn btn-small';
      addOptStepBtn.style.color = '#6bf';
      addOptStepBtn.innerHTML = '+ Option &rarr; New Step';
      addOptStepBtn.addEventListener('click', (function (i) {
        return function () {
          syncStepsFromDOM();
          addOptionWithNewStep(i);
        };
      })(idx));
      btnRow.appendChild(addOptStepBtn);

      optContainer.appendChild(btnRow);
      card.appendChild(optContainer);
    }

    return card;
  }

  function buildOptionRow(stepIdx, optIdx, opt) {
    var row = document.createElement('div');
    row.className = 'dialog-step-option-row';

    var textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.className = 'dialog-option-text';
    textInput.placeholder = 'Option text';
    textInput.value = opt.text || '';
    row.appendChild(textInput);

    var actionSelect = document.createElement('select');
    actionSelect.className = 'dialog-option-action';
    actionSelect.innerHTML = '<option value="close"' + (opt.action !== 'goto' ? ' selected' : '') + '>Close</option>' +
      '<option value="goto"' + (opt.action === 'goto' ? ' selected' : '') + '>Go to step\u2026</option>';
    row.appendChild(actionSelect);

    var gotoSelect = document.createElement('select');
    gotoSelect.className = 'dialog-option-goto';
    gotoSelect.style.display = opt.action === 'goto' ? '' : 'none';
    // Populate goto options (exclude self step)
    for (var k = 0; k < dialogSteps.length; k++) {
      if (k === stepIdx) continue;
      var goOpt = document.createElement('option');
      goOpt.value = k;
      goOpt.textContent = 'Step ' + k;
      if (opt.action === 'goto' && opt.gotoStep === k) goOpt.selected = true;
      gotoSelect.appendChild(goOpt);
    }
    row.appendChild(gotoSelect);

    actionSelect.addEventListener('change', function () {
      gotoSelect.style.display = this.value === 'goto' ? '' : 'none';
      if (this.value === 'goto' && !gotoSelect.value) {
        // Default to first available step
        for (var m = 0; m < dialogSteps.length; m++) {
          if (m !== stepIdx) { gotoSelect.value = m; break; }
        }
      }
    });

    // Highlight target step on goto selection change
    gotoSelect.addEventListener('change', function () {
      highlightStep(parseInt(this.value));
    });

    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-small';
    removeBtn.style.color = '#f66';
    removeBtn.innerHTML = '&times;';
    removeBtn.addEventListener('click', (function (si, oi) {
      return function () {
        syncStepsFromDOM();
        removeOption(si, oi);
      };
    })(stepIdx, optIdx));
    row.appendChild(removeBtn);

    return row;
  }

  function addDialogStep(type) {
    if (dialogSteps.length >= DIALOG_STEP_LIMIT) {
      showToast('Step limit reached (' + DIALOG_STEP_LIMIT + ')');
      return -1;
    }
    syncStepsFromDOM();
    var newIdx = dialogSteps.length;
    dialogSteps.push({ type: type, text: '', options: type === 'menu' ? [] : undefined, autoClose: false });
    renderDialogSteps();
    return newIdx;
  }

  function removeDialogStep(index) {
    if (index < 0 || index >= dialogSteps.length) return;
    syncStepsFromDOM();
    dialogSteps.splice(index, 1);
    // Fix goto references
    for (var i = 0; i < dialogSteps.length; i++) {
      var opts = dialogSteps[i].options;
      if (!opts) continue;
      for (var j = 0; j < opts.length; j++) {
        if (opts[j].action === 'goto' && opts[j].gotoStep !== undefined) {
          if (opts[j].gotoStep === index) {
            opts[j].action = 'close';
            opts[j].gotoStep = undefined;
          } else if (opts[j].gotoStep > index) {
            opts[j].gotoStep--;
          }
        }
      }
    }
    renderDialogSteps();
    if (dialogSteps.length === 0) return;
    showToast('Step removed. Goto references updated.');
  }

  function addOptionToStep(stepIndex) {
    var step = dialogSteps[stepIndex];
    if (!step || step.type !== 'menu') return;
    if (!step.options) step.options = [];
    step.options.push({ text: '', action: 'close' });
    renderDialogSteps();
  }

  function addOptionWithNewStep(stepIndex) {
    var step = dialogSteps[stepIndex];
    if (!step || step.type !== 'menu') return;
    if (!step.options) step.options = [];
    var newStepIdx = dialogSteps.length;
    if (newStepIdx >= DIALOG_STEP_LIMIT) {
      showToast('Step limit reached (' + DIALOG_STEP_LIMIT + ')');
      return;
    }
    dialogSteps.push({ type: 'menu', text: '', options: [], autoClose: false });
    step.options.push({ text: '', action: 'goto', gotoStep: newStepIdx });
    renderDialogSteps();
    // Scroll to new step
    var container = document.getElementById('proxy-npc-steps-list');
    if (container && container.lastChild) {
      container.lastChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    highlightStep(newStepIdx);
  }

  function removeOption(stepIndex, optionIndex) {
    var step = dialogSteps[stepIndex];
    if (!step || !step.options) return;
    step.options.splice(optionIndex, 1);
    renderDialogSteps();
  }

  function highlightStep(index) {
    var container = document.getElementById('proxy-npc-steps-list');
    if (!container) return;
    var stepEls = container.querySelectorAll('.dialog-step');
    if (!stepEls[index]) return;
    stepEls[index].classList.add('highlight-target');
    setTimeout(function () {
      if (stepEls[index]) stepEls[index].classList.remove('highlight-target');
    }, 800);
  }

  // Add step buttons
  var btnAddStep = document.getElementById('btn-proxy-npc-add-step');
  if (btnAddStep) {
    btnAddStep.addEventListener('click', function () { addDialogStep('popup'); });
  }
  var btnAddStepMenu = document.getElementById('btn-proxy-npc-add-step-menu');
  if (btnAddStepMenu) {
    btnAddStepMenu.addEventListener('click', function () { addDialogStep('menu'); });
  }

  // ── Place NPC button ──
  var btnPlaceNpc = document.getElementById('btn-proxy-npc-place');
  if (btnPlaceNpc) {
    btnPlaceNpc.addEventListener('click', function () {
      var mapVal = document.getElementById('proxy-npc-map').value;
      if (!mapVal) { showToast('Select a map first'); return; }

      syncStepsFromDOM();

      var parsedDirection = parseInt(document.getElementById('proxy-npc-dir').value, 10);
      var placeData = {
        name: document.getElementById('proxy-npc-name').value || 'NPC',
        sprite: parseInt(document.getElementById('proxy-npc-sprite').value) || 1,
        mapNumber: parseInt(mapVal),
        x: parseInt(document.getElementById('proxy-npc-x').value) || 0,
        y: parseInt(document.getElementById('proxy-npc-y').value) || 0,
        direction: isNaN(parsedDirection) ? 2 : parsedDirection
      };

      if (dialogSteps.length > 0) {
        // Validate: check for empty step text
        for (var i = 0; i < dialogSteps.length; i++) {
          if (!dialogSteps[i].text.trim()) {
            showToast('Step ' + i + ' has empty text');
            highlightStep(i);
            return;
          }
        }
        // Validate goto targets
        for (var i = 0; i < dialogSteps.length; i++) {
          var opts = dialogSteps[i].options;
          if (!opts) continue;
          for (var j = 0; j < opts.length; j++) {
            if (opts[j].action === 'goto') {
              var target = opts[j].gotoStep;
              if (target === undefined || target < 0 || target >= dialogSteps.length) {
                showToast('Step ' + i + ', option "' + (opts[j].text || j) + '" has invalid goto target');
                highlightStep(i);
                return;
              }
            }
          }
        }

        var greeting = dialogSteps[0].text.trim();
        placeData.dialog = {
          greeting: greeting,
          steps: dialogSteps.map(function (s) {
            var step = { type: s.type, text: s.text.trim() };
            if (s.autoClose) step.autoClose = true;
            if (s.type === 'menu' && s.options && s.options.length > 0) {
              step.options = s.options.map(function (o) {
                var opt = { text: o.text.trim() };
                if (o.action === 'goto' && o.gotoStep !== undefined) {
                  opt.action = 'goto';
                  opt.gotoStep = o.gotoStep;
                } else {
                  opt.action = 'close';
                }
                return opt;
              });
            }
            return step;
          })
        };
      }

      if (editingNpcSerial) {
        placeData.editSerial = editingNpcSerial;
        socket.emit('proxy:npc:edit', placeData);
        editingNpcSerial = null;
        var placeBtn = document.getElementById('btn-proxy-npc-place');
        if (placeBtn) placeBtn.textContent = 'Place NPC';
      } else {
        socket.emit('proxy:npc:place', placeData);
      }
      dialogSteps = [];
      renderDialogSteps();
    });
  }

  // ── Chat send ──
  var btnChatSend = document.getElementById('btn-proxy-chat-send');
  if (btnChatSend) {
    btnChatSend.addEventListener('click', function () {
      var target = document.getElementById('proxy-chat-target').value;
      var data = {
        channel: document.getElementById('proxy-chat-channel').value,
        message: document.getElementById('proxy-chat-message').value,
        sender: document.getElementById('proxy-chat-sender').value || undefined
      };
      if (target === 'broadcast') { data.broadcast = true; } else { data.sessionId = target; }
      socket.emit('proxy:chat:send', data);
      document.getElementById('proxy-chat-message').value = '';
    });
  }

  // ── Packet log clear ──
  var btnClearLog = document.getElementById('btn-proxy-log-clear');
  if (btnClearLog) {
    btnClearLog.addEventListener('click', function () {
      var logEl = document.getElementById('proxy-packet-log');
      if (logEl) logEl.innerHTML = '<div class="rules-empty">Waiting for packets...</div>';
    });
  }

  // ── Packet Capture ──
  var btnCaptureStart = document.getElementById('btn-proxy-capture-start');
  var btnCaptureStop = document.getElementById('btn-proxy-capture-stop');
  var btnCaptureCopy = document.getElementById('btn-proxy-capture-copy');
  var captureStatusEl = document.getElementById('proxy-capture-status');
  var captureOutputEl = document.getElementById('proxy-capture-output');

  if (btnCaptureStart) {
    btnCaptureStart.addEventListener('click', function () {
      var opStr = (document.getElementById('proxy-capture-opcodes').value || '').trim();
      var opcodes = [];
      if (opStr) {
        opStr.split(/[,\s]+/).forEach(function (s) {
          var v = parseInt(s.replace(/^0x/i, ''), 16);
          if (!isNaN(v)) opcodes.push(v);
        });
      }
      socket.emit('proxy:capture:start', { opcodes: opcodes });
      btnCaptureStart.disabled = true;
      btnCaptureStop.disabled = false;
      captureStatusEl.textContent = 'Capturing...';
      captureStatusEl.style.color = '#0f0';
    });
  }

  if (btnCaptureStop) {
    btnCaptureStop.addEventListener('click', function () {
      socket.emit('proxy:capture:stop');
      btnCaptureStart.disabled = false;
      btnCaptureStop.disabled = true;
    });
  }

  if (btnCaptureCopy) {
    btnCaptureCopy.addEventListener('click', function () {
      socket.emit('proxy:capture:get');
    });
  }

  socket.on('proxy:capture:status', function (data) {
    if (captureStatusEl) {
      if (data.enabled) {
        captureStatusEl.textContent = 'Capturing... (' + data.count + ' packets)';
        captureStatusEl.style.color = '#0f0';
      } else {
        captureStatusEl.textContent = 'Stopped (' + data.count + ' packets)';
        captureStatusEl.style.color = '#fa0';
        btnCaptureStart.disabled = false;
        btnCaptureStop.disabled = true;
      }
    }
  });

  socket.on('proxy:capture:data', function (packets) {
    if (!captureOutputEl) return;
    if (packets.length === 0) {
      captureOutputEl.style.display = 'block';
      captureOutputEl.textContent = 'No captured packets.';
      return;
    }
    var dirLabel = { 'client-to-server': 'C>S', 'server-to-client': 'S>C' };
    var lines = packets.map(function (p) {
      var dir = dirLabel[p.dir] || p.dir;
      var op = '0x' + ('0' + p.op.toString(16)).slice(-2).toUpperCase();
      var char = p.char || p.sid;
      return dir + ' [' + char + '] ' + op + ' (' + p.len + 'b)\n' + (p.hex || '(no body)');
    });
    var text = lines.join('\n\n');
    captureOutputEl.style.display = 'block';
    captureOutputEl.textContent = text;
    // Copy to clipboard
    navigator.clipboard.writeText(text).then(function () {
      showToast('Captured ' + packets.length + ' packets copied to clipboard');
    }).catch(function () {
      showToast('Packets shown below — select and copy manually');
    });
  });

  // ══════════════════════════════════════════════════════════════
  // ═══ Grind Automation Panel ═══
  // ══════════════════════════════════════════════════════════════

  var grindStatuses = {}; // sessionId -> status object

  // Populate session selector when grind tab opens
  function updateGrindSessionSelect() {
    var select = document.getElementById('grind-session-select');
    if (!select) return;
    var current = select.value;
    select.innerHTML = '<option value="">-- Select Player --</option>';
    var gameSessions = proxySessions.filter(function (s) { return s.phase === 'game' && s.characterName; });
    gameSessions.forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.characterName || s.id;
      select.appendChild(opt);
    });
    if (current) select.value = current;
    // Auto-select if only one
    if (!select.value && gameSessions.length === 1) {
      select.value = gameSessions[0].id;
      onGrindSessionSelected(gameSessions[0].id);
    }
  }

  function onGrindSessionSelected(sessionId) {
    if (sessionId) {
      socket.emit('grind:getStatus', { sessionId: sessionId });
    }
  }

  var grindSelect = document.getElementById('grind-session-select');
  if (grindSelect) {
    grindSelect.addEventListener('change', function () {
      onGrindSessionSelected(grindSelect.value);
    });
  }

  // Load grind data when tab opens
  document.querySelectorAll('.proxy-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      if (tab.getAttribute('data-proxy-tab') === 'grind') {
        updateGrindSessionSelect();
        var sid = document.getElementById('grind-session-select').value;
        if (sid) socket.emit('grind:getStatus', { sessionId: sid });
      }
    });
  });

  // Start / Stop buttons
  var btnGrindStart = document.getElementById('btn-grind-start');
  var btnGrindStop = document.getElementById('btn-grind-stop');
  if (btnGrindStart) {
    btnGrindStart.addEventListener('click', function () {
      var sid = document.getElementById('grind-session-select').value;
      if (!sid) { showToast('Select a player first'); return; }
      socket.emit('grind:start', { sessionId: sid });
    });
  }
  if (btnGrindStop) {
    btnGrindStop.addEventListener('click', function () {
      var sid = document.getElementById('grind-session-select').value;
      if (!sid) return;
      socket.emit('grind:stop', { sessionId: sid });
    });
  }

  // Apply Config button
  var btnGrindApply = document.getElementById('btn-grind-apply');
  if (btnGrindApply) {
    btnGrindApply.addEventListener('click', function () {
      var sid = document.getElementById('grind-session-select').value;
      if (!sid) { showToast('Select a player first'); return; }
      var data = {
        sessionId: sid,
        primaryAttack: document.getElementById('grind-primary-attack').value,
        secondaryAttack: document.getElementById('grind-secondary-attack').value,
        curse: document.getElementById('grind-curse').value,
        fasSpell: document.getElementById('grind-fas').value,
        pramhSpell: document.getElementById('grind-pramh').value,
        targetMode: document.getElementById('grind-target-mode').value,
        curseMode: document.getElementById('grind-curse-mode').value,
        engagementMode: document.getElementById('grind-engagement').value,
        attackRange: document.getElementById('grind-attack-range').value,
        minMpPercent: document.getElementById('grind-min-mp').value,
        walkSpeed: document.getElementById('grind-walk-speed').value,
        assailEnabled: document.getElementById('grind-assail').checked,
        assailBetweenSpells: document.getElementById('grind-assail-between').checked,
        halfCast: document.getElementById('grind-halfcast').checked,
        pramhSpam: document.getElementById('grind-pramh-spam').checked,
        useAmbush: document.getElementById('grind-ambush').checked,
        useCrash: document.getElementById('grind-crash').checked,
        // Heal
        healEnabled: document.getElementById('grind-heal-enabled').checked,
        hpPotionThreshold: document.getElementById('grind-hp-pot-threshold').value,
        mpPotionThreshold: document.getElementById('grind-mp-pot-threshold').value,
        hpSpellThreshold: document.getElementById('grind-hp-spell-threshold').value,
        mpRecoverySpell: document.getElementById('grind-mp-recovery').value,
        aoCursesSelf: document.getElementById('grind-ao-curses').checked,
        aoSuainSelf: document.getElementById('grind-ao-suain').checked,
        aoPuinseinSelf: document.getElementById('grind-ao-poison').checked,
        counterAttack: document.getElementById('grind-counter-attack').checked,
        dionEnabled: document.getElementById('grind-dion-enabled').checked,
        dionType: document.getElementById('grind-dion-type').value,
        dionHpThreshold: document.getElementById('grind-dion-hp').value,
        // Loot
        lootEnabled: document.getElementById('grind-loot-enabled').checked,
        lootFilterMode: document.getElementById('grind-loot-mode').value,
        lootAntiSteal: document.getElementById('grind-loot-anti-steal').checked,
        lootWalkToLoot: document.getElementById('grind-loot-walk').checked,
        lootOnlyWhenNotMobbed: document.getElementById('grind-loot-not-mobbed').checked,
      };
      socket.emit('grind:applyConfig', data);
    });
  }

  // Ignore list management
  var btnIgnoreAdd = document.getElementById('btn-grind-ignore-add');
  if (btnIgnoreAdd) {
    btnIgnoreAdd.addEventListener('click', function () {
      var sid = document.getElementById('grind-session-select').value;
      var input = document.getElementById('grind-ignore-input');
      if (!sid || !input.value.trim()) return;
      socket.emit('grind:ignoreAdd', { sessionId: sid, value: input.value.trim() });
      input.value = '';
    });
  }

  // Loot filter management
  var btnLootAdd = document.getElementById('btn-grind-loot-add');
  if (btnLootAdd) {
    btnLootAdd.addEventListener('click', function () {
      var sid = document.getElementById('grind-session-select').value;
      var input = document.getElementById('grind-loot-filter-input');
      if (!sid || !input.value.trim()) return;
      socket.emit('grind:lootFilterAdd', { sessionId: sid, value: input.value.trim() });
      input.value = '';
    });
  }

  // Receive grind status updates
  socket.on('grind:status', function (data) {
    if (!data || !data.sessionId) return;
    grindStatuses[data.sessionId] = data;
    var selectedSid = document.getElementById('grind-session-select').value;
    if (data.sessionId === selectedSid) {
      renderGrindStatus(data);
    }
  });

  function renderGrindStatus(data) {
    // Status badge
    var badge = document.getElementById('grind-status-badge');
    if (badge) {
      if (data.running) {
        badge.textContent = 'RUNNING';
        badge.style.background = 'rgba(0,255,100,0.2)';
        badge.style.color = '#0f6';
      } else {
        badge.textContent = 'Idle';
        badge.style.background = 'rgba(255,255,255,0.08)';
        badge.style.color = '';
      }
    }

    // Stats
    var hpPct = data.maxHp > 0 ? Math.round((data.hp / data.maxHp) * 100) : 0;
    var mpPct = data.maxMp > 0 ? Math.round((data.mp / data.maxMp) * 100) : 0;
    setEl('grind-stat-hp', data.hp + '/' + data.maxHp + ' (' + hpPct + '%)');
    setEl('grind-stat-mp', data.mp + '/' + data.maxMp + ' (' + mpPct + '%)');
    setEl('grind-stat-kills', String(data.kills || 0));
    setEl('grind-stat-kpm', String(data.kpm || '0.0'));
    setEl('grind-stat-target', '--');
    setEl('grind-stat-buffs', data.buffs && data.buffs.length > 0 ? data.buffs.join(', ') : '--');

    // HP color
    var hpEl = document.getElementById('grind-stat-hp');
    if (hpEl) {
      hpEl.style.color = hpPct > 70 ? '#0f6' : hpPct > 30 ? '#fa0' : '#f44';
    }

    // Populate form fields from config (only if not actively editing)
    if (data.config) {
      populateIfEmpty('grind-primary-attack', data.config.primaryAttack);
      populateIfEmpty('grind-secondary-attack', data.config.secondaryAttack);
      populateIfEmpty('grind-curse', data.config.curse);
      populateIfEmpty('grind-fas', data.config.fasSpell);
      populateIfEmpty('grind-pramh', data.config.pramhSpell);
      setSelect('grind-target-mode', data.config.targetMode);
      setSelect('grind-curse-mode', data.config.curseMode);
      setSelect('grind-engagement', data.config.engagementMode);
      setNumIfDefault('grind-attack-range', data.config.attackRange);
      setNumIfDefault('grind-min-mp', data.config.minMpPercent);
      setNumIfDefault('grind-walk-speed', data.config.walkSpeed);
    }

    // Ignore list
    if (data.config) {
      var ignoreList = document.getElementById('grind-ignore-list');
      if (ignoreList) {
        var items = (data.config.nameIgnoreList || []).concat((data.config.imageExcludeList || []).map(function (n) { return 'img:' + n; }));
        if (items.length === 0) {
          ignoreList.innerHTML = '<span style="opacity:0.4">No ignores.</span>';
        } else {
          ignoreList.innerHTML = items.map(function (item) {
            return '<span style="display:inline-flex;align-items:center;gap:0.25rem;padding:1px 6px;margin:1px;background:rgba(255,255,255,0.08);border-radius:3px">' +
              escapeHtml(String(item)) +
              '<button class="grind-ignore-remove" data-value="' + escapeHtml(String(item).replace(/^img:/, '')) + '" style="background:none;border:none;color:#f66;cursor:pointer;font-size:0.9em;padding:0 2px">&times;</button></span>';
          }).join('');
          ignoreList.querySelectorAll('.grind-ignore-remove').forEach(function (btn) {
            btn.addEventListener('click', function () {
              var sid = document.getElementById('grind-session-select').value;
              socket.emit('grind:ignoreRemove', { sessionId: sid, value: btn.dataset.value });
            });
          });
        }
      }
    }

    // Loot filter list
    if (data.lootConfig) {
      var lootList = document.getElementById('grind-loot-filter-list');
      if (lootList) {
        var lootItems = data.lootConfig.itemFilter || [];
        if (lootItems.length === 0) {
          lootList.innerHTML = '<span style="opacity:0.4">No filters.</span>';
        } else {
          lootList.innerHTML = lootItems.map(function (item) {
            return '<span style="display:inline-flex;align-items:center;gap:0.25rem;padding:1px 6px;margin:1px;background:rgba(255,255,255,0.08);border-radius:3px">' +
              escapeHtml(item) +
              '<button class="grind-loot-remove" data-value="' + escapeHtml(item) + '" style="background:none;border:none;color:#f66;cursor:pointer;font-size:0.9em;padding:0 2px">&times;</button></span>';
          }).join('');
          lootList.querySelectorAll('.grind-loot-remove').forEach(function (btn) {
            btn.addEventListener('click', function () {
              var sid = document.getElementById('grind-session-select').value;
              socket.emit('grind:lootFilterRemove', { sessionId: sid, value: btn.dataset.value });
            });
          });
        }
      }
    }
  }

  function setEl(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }
  function populateIfEmpty(id, value) {
    var el = document.getElementById(id);
    if (el && !el.value && value) el.value = value;
  }
  function setSelect(id, value) {
    var el = document.getElementById(id);
    if (el && value) el.value = value;
  }
  function setNumIfDefault(id, value) {
    var el = document.getElementById(id);
    if (el && value !== undefined) el.value = value;
  }

  // Update grind session select when sessions change
  socket.on('proxy:sessions', function () {
    updateGrindSessionSelect();
  });
  socket.on('proxy:session:game', function () {
    setTimeout(updateGrindSessionSelect, 500);
  });
  socket.on('proxy:session:end', function (data) {
    delete grindStatuses[data.id];
    updateGrindSessionSelect();
  });

  // ══════════════════════════════════════════════════════════════
  // ═══ DA Monsters Panel Tab ═══
  // ══════════════════════════════════════════════════════════════

  var monData = { species: [], evolvedSpecies: [], moves: {} };

  // Monster sub-tab switching
  document.querySelectorAll('.mon-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.mon-tab').forEach(function (t) { t.classList.remove('active'); t.style.opacity = '0.6'; t.style.borderBottomColor = 'transparent'; });
      tab.classList.add('active'); tab.style.opacity = '1'; tab.style.borderBottomColor = '#6bf';
      document.querySelectorAll('.mon-tab-content').forEach(function (c) { c.style.display = 'none'; c.classList.remove('active'); });
      var target = document.getElementById('mon-content-' + tab.getAttribute('data-mon-tab'));
      if (target) { target.style.display = ''; target.classList.add('active'); }
    });
  });

  // Load data when Monsters proxy tab is opened
  var monDataLoaded = false;
  function loadMonsterData() {
    socket.emit('monsters:getData');
    socket.emit('monsters:leaderboard');
  }
  document.querySelectorAll('.proxy-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      if (tab.getAttribute('data-proxy-tab') === 'monsters') {
        loadMonsterData();
      }
    });
  });
  // Also load on socket connect (in case we're already on the tab)
  socket.on('connect', function () {
    var activeMonTab = document.querySelector('.proxy-tab.active[data-proxy-tab="monsters"]');
    if (activeMonTab) loadMonsterData();
  });
  // Load once after a short delay on page load
  setTimeout(function () {
    if (!monDataLoaded) loadMonsterData();
  }, 2000);

  // ── Receive data ──
  socket.on('monsters:data', function (data) {
    monDataLoaded = true;
    monData = data;
    renderSpeciesList();
    renderEvolvedList();
    renderMovesList();
  });

  function saveMonsterData() {
    socket.emit('monsters:saveData', monData);
  }

  // ── Species rendering ──
  function renderSpeciesList() {
    var list = document.getElementById('mon-species-list');
    if (!list) return;
    if (!monData.species || monData.species.length === 0) { list.innerHTML = '<div class="rules-empty">No species defined. Click "+ Add Species" to create one.</div>'; return; }
    list.innerHTML = '';
    monData.species.forEach(function (s, i) {
      var el = document.createElement('div');
      el.style.cssText = 'padding:0.4rem 0.6rem;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;align-items:center';
      var evo = s.evolution ? ' &rarr; ' + s.evolution.name + ' Lv.' + s.evolution.level : '';
      var movesStr = Object.keys(s.moves || {}).sort(function(a,b){return a-b;}).map(function(lv){return 'Lv'+lv+':'+s.moves[lv];}).join(', ');
      el.innerHTML = '<div><strong>' + s.name + '</strong> <span style="opacity:0.5">[' + s.type + ']</span> Spr:' + s.sprite + evo +
        '<div style="font-size:0.8em;opacity:0.6">HP:' + s.baseHp + ' ATK:' + s.baseAtk + ' DEF:' + s.baseDef + ' SPD:' + s.baseSpd + ' SPA:' + s.baseSpAtk + ' SPD:' + s.baseSpDef + '</div>' +
        '<div style="font-size:0.75em;opacity:0.45">' + movesStr + '</div></div>' +
        '<div style="display:flex;gap:0.25rem"><button class="btn btn-small" data-mon-edit="' + i + '" style="font-size:0.7em">Edit</button>' +
        '<button class="btn btn-small" data-mon-del="' + i + '" style="font-size:0.7em;color:#f66">Del</button></div>';
      list.appendChild(el);
    });
    list.querySelectorAll('[data-mon-edit]').forEach(function (b) { b.addEventListener('click', function () { editSpecies(parseInt(b.getAttribute('data-mon-edit')), false); }); });
    list.querySelectorAll('[data-mon-del]').forEach(function (b) { b.addEventListener('click', function () { if (confirm('Delete this species?')) { monData.species.splice(parseInt(b.getAttribute('data-mon-del')), 1); saveMonsterData(); } }); });
  }

  function renderEvolvedList() {
    var list = document.getElementById('mon-evolved-list');
    if (!list) return;
    if (!monData.evolvedSpecies || monData.evolvedSpecies.length === 0) { list.innerHTML = '<div class="rules-empty">No evolved species.</div>'; return; }
    list.innerHTML = '';
    monData.evolvedSpecies.forEach(function (s, i) {
      var el = document.createElement('div');
      el.style.cssText = 'padding:0.4rem 0.6rem;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;align-items:center';
      el.innerHTML = '<div><strong>' + s.name + '</strong> <span style="opacity:0.5">[' + s.type + ']</span> Spr:' + s.sprite +
        '<div style="font-size:0.8em;opacity:0.6">HP:' + s.baseHp + ' ATK:' + s.baseAtk + ' DEF:' + s.baseDef + ' SPD:' + s.baseSpd + '</div></div>' +
        '<div style="display:flex;gap:0.25rem"><button class="btn btn-small" data-evo-edit="' + i + '" style="font-size:0.7em">Edit</button>' +
        '<button class="btn btn-small" data-evo-del="' + i + '" style="font-size:0.7em;color:#f66">Del</button></div>';
      list.appendChild(el);
    });
    list.querySelectorAll('[data-evo-edit]').forEach(function (b) { b.addEventListener('click', function () { editSpecies(parseInt(b.getAttribute('data-evo-edit')), true); }); });
    list.querySelectorAll('[data-evo-del]').forEach(function (b) { b.addEventListener('click', function () { if (confirm('Delete this evolved species?')) { monData.evolvedSpecies.splice(parseInt(b.getAttribute('data-evo-del')), 1); saveMonsterData(); } }); });
  }

  // ── Species form ──
  function showSpeciesForm(title) {
    document.getElementById('mon-species-form').style.display = '';
    document.getElementById('mon-species-form-title').textContent = title;
  }
  function hideSpeciesForm() { document.getElementById('mon-species-form').style.display = 'none'; }

  document.getElementById('btn-mon-add-species').addEventListener('click', function () {
    clearSpeciesForm(); document.getElementById('mon-sp-is-evolved').value = ''; showSpeciesForm('Add Base Species');
  });
  document.getElementById('btn-mon-sp-cancel').addEventListener('click', hideSpeciesForm);

  function clearSpeciesForm() {
    ['mon-sp-name','mon-sp-m1','mon-sp-m2','mon-sp-m3','mon-sp-m4','mon-sp-evo-name'].forEach(function(id){document.getElementById(id).value='';});
    document.getElementById('mon-sp-sprite').value='33'; document.getElementById('mon-sp-type').value='Normal';
    document.getElementById('mon-sp-hp').value='45'; document.getElementById('mon-sp-atk').value='49';
    document.getElementById('mon-sp-def').value='49'; document.getElementById('mon-sp-spd').value='45';
    document.getElementById('mon-sp-spatk').value='35'; document.getElementById('mon-sp-spdef').value='35';
    document.getElementById('mon-sp-m1lv').value='1'; document.getElementById('mon-sp-m2lv').value='5';
    document.getElementById('mon-sp-m3lv').value='10'; document.getElementById('mon-sp-m4lv').value='15';
    document.getElementById('mon-sp-evo-sprite').value='0'; document.getElementById('mon-sp-evo-level').value='16';
    document.getElementById('mon-sp-editing').value = '';
  }

  function editSpecies(idx, isEvolved) {
    var s = isEvolved ? monData.evolvedSpecies[idx] : monData.species[idx];
    if (!s) return;
    document.getElementById('mon-sp-name').value = s.name; document.getElementById('mon-sp-sprite').value = s.sprite;
    document.getElementById('mon-sp-type').value = s.type; document.getElementById('mon-sp-hp').value = s.baseHp;
    document.getElementById('mon-sp-atk').value = s.baseAtk; document.getElementById('mon-sp-def').value = s.baseDef;
    document.getElementById('mon-sp-spd').value = s.baseSpd; document.getElementById('mon-sp-spatk').value = s.baseSpAtk;
    document.getElementById('mon-sp-spdef').value = s.baseSpDef;
    var mkeys = Object.keys(s.moves||{}).sort(function(a,b){return a-b;});
    document.getElementById('mon-sp-m1').value = s.moves[mkeys[0]]||''; document.getElementById('mon-sp-m1lv').value = mkeys[0]||'1';
    document.getElementById('mon-sp-m2').value = s.moves[mkeys[1]]||''; document.getElementById('mon-sp-m2lv').value = mkeys[1]||'5';
    document.getElementById('mon-sp-m3').value = s.moves[mkeys[2]]||''; document.getElementById('mon-sp-m3lv').value = mkeys[2]||'10';
    document.getElementById('mon-sp-m4').value = s.moves[mkeys[3]]||''; document.getElementById('mon-sp-m4lv').value = mkeys[3]||'15';
    if (s.evolution) {
      document.getElementById('mon-sp-evo-name').value = s.evolution.name;
      document.getElementById('mon-sp-evo-sprite').value = s.evolution.sprite;
      document.getElementById('mon-sp-evo-level').value = s.evolution.level;
    } else { document.getElementById('mon-sp-evo-name').value = ''; document.getElementById('mon-sp-evo-sprite').value = '0'; document.getElementById('mon-sp-evo-level').value = '16'; }
    document.getElementById('mon-sp-editing').value = String(idx);
    document.getElementById('mon-sp-is-evolved').value = isEvolved ? 'true' : '';
    showSpeciesForm(isEvolved ? 'Edit Evolved Species' : 'Edit Base Species');
  }

  document.getElementById('btn-mon-sp-save').addEventListener('click', function () {
    var name = document.getElementById('mon-sp-name').value.trim();
    if (!name) { showToast('Name is required', true); return; }
    var moves = {};
    var pairs = [[document.getElementById('mon-sp-m1'),document.getElementById('mon-sp-m1lv')],[document.getElementById('mon-sp-m2'),document.getElementById('mon-sp-m2lv')],[document.getElementById('mon-sp-m3'),document.getElementById('mon-sp-m3lv')],[document.getElementById('mon-sp-m4'),document.getElementById('mon-sp-m4lv')]];
    pairs.forEach(function(p){if(p[0].value.trim())moves[parseInt(p[1].value)||1]=p[0].value.trim();});
    var sp = {
      name: name, sprite: parseInt(document.getElementById('mon-sp-sprite').value)||0,
      type: document.getElementById('mon-sp-type').value,
      baseHp: parseInt(document.getElementById('mon-sp-hp').value)||45,
      baseAtk: parseInt(document.getElementById('mon-sp-atk').value)||49,
      baseDef: parseInt(document.getElementById('mon-sp-def').value)||49,
      baseSpd: parseInt(document.getElementById('mon-sp-spd').value)||45,
      baseSpAtk: parseInt(document.getElementById('mon-sp-spatk').value)||35,
      baseSpDef: parseInt(document.getElementById('mon-sp-spdef').value)||35,
      moves: moves,
    };
    var evoName = document.getElementById('mon-sp-evo-name').value.trim();
    if (evoName) { sp.evolution = { name: evoName, sprite: parseInt(document.getElementById('mon-sp-evo-sprite').value)||0, level: parseInt(document.getElementById('mon-sp-evo-level').value)||16 }; }
    var editIdx = document.getElementById('mon-sp-editing').value;
    var isEvolved = document.getElementById('mon-sp-is-evolved').value === 'true';
    var arr = isEvolved ? monData.evolvedSpecies : monData.species;
    if (editIdx !== '') { arr[parseInt(editIdx)] = sp; } else { arr.push(sp); }
    saveMonsterData();
    hideSpeciesForm();
  });

  // ── Moves rendering ──
  function renderMovesList() {
    var list = document.getElementById('mon-moves-list');
    if (!list) return;
    var keys = Object.keys(monData.moves || {}).sort();
    if (keys.length === 0) { list.innerHTML = '<div class="rules-empty">No moves defined.</div>'; return; }
    list.innerHTML = '';
    keys.forEach(function (k) {
      var m = monData.moves[k];
      var el = document.createElement('div');
      el.style.cssText = 'padding:0.3rem 0.6rem;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;align-items:center';
      var extra = m.heals ? ' Heal:' + m.heals + '%' : '';
      el.innerHTML = '<div><strong>' + m.name + '</strong> <span style="opacity:0.5">[' + m.type + ' ' + m.category + ']</span> PWR:' + m.power + ' ACC:' + m.accuracy + '%' + extra + '</div>' +
        '<div style="display:flex;gap:0.25rem"><button class="btn btn-small" data-mv-edit="' + k + '" style="font-size:0.7em">Edit</button>' +
        '<button class="btn btn-small" data-mv-del="' + k + '" style="font-size:0.7em;color:#f66">Del</button></div>';
      list.appendChild(el);
    });
    list.querySelectorAll('[data-mv-edit]').forEach(function (b) { b.addEventListener('click', function () { editMove(b.getAttribute('data-mv-edit')); }); });
    list.querySelectorAll('[data-mv-del]').forEach(function (b) { b.addEventListener('click', function () { if (confirm('Delete move "' + b.getAttribute('data-mv-del') + '"?')) { delete monData.moves[b.getAttribute('data-mv-del')]; saveMonsterData(); } }); });
  }

  // ── Move form ──
  document.getElementById('btn-mon-add-move').addEventListener('click', function () {
    clearMoveForm(); document.getElementById('mon-move-form').style.display = '';
    document.getElementById('mon-move-form-title').textContent = 'Add Move';
  });
  document.getElementById('btn-mon-mv-cancel').addEventListener('click', function () { document.getElementById('mon-move-form').style.display = 'none'; });

  function clearMoveForm() {
    document.getElementById('mon-mv-name').value = ''; document.getElementById('mon-mv-type').value = 'Normal';
    document.getElementById('mon-mv-cat').value = 'physical'; document.getElementById('mon-mv-power').value = '40';
    document.getElementById('mon-mv-acc').value = '100'; document.getElementById('mon-mv-priority').value = '0';
    document.getElementById('mon-mv-heals').value = '0'; document.getElementById('mon-mv-anim').value = '1';
    document.getElementById('mon-mv-source').value = '0'; document.getElementById('mon-mv-body').value = '';
    document.getElementById('mon-mv-sound').value = '0'; document.getElementById('mon-mv-self').checked = false;
    document.getElementById('mon-mv-editing').value = '';
  }

  function editMove(key) {
    var m = monData.moves[key]; if (!m) return;
    document.getElementById('mon-mv-name').value = m.name; document.getElementById('mon-mv-type').value = m.type;
    document.getElementById('mon-mv-cat').value = m.category; document.getElementById('mon-mv-power').value = m.power;
    document.getElementById('mon-mv-acc').value = m.accuracy; document.getElementById('mon-mv-priority').value = m.priority||0;
    document.getElementById('mon-mv-heals').value = m.heals||0; document.getElementById('mon-mv-anim').value = m.animationId||1;
    document.getElementById('mon-mv-source').value = (m.sourceAnimationId != null ? m.sourceAnimationId : 0);
    document.getElementById('mon-mv-body').value = (m.bodyAnimationId != null ? m.bodyAnimationId : '');
    document.getElementById('mon-mv-sound').value = m.soundId||0; document.getElementById('mon-mv-self').checked = !!m.targetsSelf;
    document.getElementById('mon-mv-editing').value = key;
    document.getElementById('mon-move-form').style.display = '';
    document.getElementById('mon-move-form-title').textContent = 'Edit Move';
  }

  document.getElementById('btn-mon-mv-save').addEventListener('click', function () {
    var name = document.getElementById('mon-mv-name').value.trim();
    if (!name) { showToast('Move name required', true); return; }
    var mv = {
      name: name, type: document.getElementById('mon-mv-type').value,
      category: document.getElementById('mon-mv-cat').value,
      power: parseInt(document.getElementById('mon-mv-power').value)||0,
      accuracy: parseInt(document.getElementById('mon-mv-acc').value)||100,
      priority: parseInt(document.getElementById('mon-mv-priority').value)||0,
      heals: parseInt(document.getElementById('mon-mv-heals').value)||0,
      animationId: parseInt(document.getElementById('mon-mv-anim').value)||1,
      sourceAnimationId: parseInt(document.getElementById('mon-mv-source').value, 10) || 0,
      soundId: parseInt(document.getElementById('mon-mv-sound').value)||0,
    };
    var bodyStr = document.getElementById('mon-mv-body').value.trim();
    if (bodyStr !== '') mv.bodyAnimationId = parseInt(bodyStr, 10);
    if (document.getElementById('mon-mv-self').checked) mv.targetsSelf = true;
    if (!mv.heals) delete mv.heals;
    if (!mv.priority) delete mv.priority;
    if (!mv.sourceAnimationId) delete mv.sourceAnimationId;
    if (!mv.targetsSelf) delete mv.targetsSelf;
    var editKey = document.getElementById('mon-mv-editing').value;
    if (editKey && editKey !== name) delete monData.moves[editKey];
    monData.moves[name] = mv;
    saveMonsterData();
    document.getElementById('mon-move-form').style.display = 'none';
  });

  // ── Player search ──
  var monsterSearchBtn = document.getElementById('btn-monster-search');
  var monsterSearchInput = document.getElementById('monster-player-search');
  if (monsterSearchBtn && monsterSearchInput) {
    monsterSearchBtn.addEventListener('click', function () { var n = monsterSearchInput.value.trim(); if (n) socket.emit('monsters:search', { playerName: n }); });
    monsterSearchInput.addEventListener('keypress', function (e) { if (e.key === 'Enter') { var n = monsterSearchInput.value.trim(); if (n) socket.emit('monsters:search', { playerName: n }); } });
  }

  socket.on('monsters:playerMonsters', function (data) {
    var list = document.getElementById('monster-player-list');
    if (!list) return;
    if (!data.monsters || data.monsters.length === 0) { list.innerHTML = '<div class="rules-empty">' + data.playerName + ' has no monsters.</div>'; return; }
    list.innerHTML = '<div style="padding:0.3rem 0.6rem;font-weight:bold;opacity:0.7">' + data.playerName + '\'s Monsters (' + data.monsters.length + ')</div>';
    data.monsters.forEach(function (m) {
      var el = document.createElement('div');
      el.style.cssText = 'padding:0.4rem 0.6rem;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;align-items:center';
      var active = m.isActive ? ' <span style="color:#6f6">[ACTIVE]</span>' : '';
      var moves = (m.moves || []).filter(function (x) { return x; }).join(', ') || 'None';
      el.innerHTML = '<div><strong>' + m.nickname + '</strong> <span style="opacity:0.5">(' + m.speciesName + ')</span> Lv.' + m.level + active +
        '<div style="font-size:0.8em;opacity:0.6">HP:' + m.hp + '/' + m.maxHp + ' ATK:' + m.atk + ' DEF:' + m.def + ' SPD:' + m.spd + ' | ' + m.nature + '</div>' +
        '<div style="font-size:0.8em;opacity:0.5">Moves: ' + moves + ' | ' + m.wins + 'W/' + m.losses + 'L</div></div>' +
        '<button class="btn btn-small" style="color:#f66;font-size:0.75em" data-monster-delete="' + m.id + '" data-monster-owner="' + m.ownerName + '">Del</button>';
      list.appendChild(el);
    });
    list.querySelectorAll('[data-monster-delete]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (confirm('Delete this monster permanently?')) socket.emit('monsters:delete', { monsterId: parseInt(btn.getAttribute('data-monster-delete')), ownerName: btn.getAttribute('data-monster-owner') });
      });
    });
  });

  socket.on('monsters:deleteResult', function (data) {
    if (data.success) { showToast('Monster deleted'); var n = document.getElementById('monster-player-search'); if (n && n.value.trim()) socket.emit('monsters:search', { playerName: n.value.trim() }); }
    else showToast('Failed to delete monster');
  });

  // ── Leaderboard ──
  var leaderboardBtn = document.getElementById('btn-monster-refresh-leaderboard');
  if (leaderboardBtn) leaderboardBtn.addEventListener('click', function () { socket.emit('monsters:leaderboard'); });

  socket.on('monsters:leaderboard', function (leaders) {
    var list = document.getElementById('monster-leaderboard');
    if (!list) return;
    if (!leaders || leaders.length === 0) { list.innerHTML = '<div class="rules-empty">No battles recorded yet.</div>'; return; }
    list.innerHTML = '';
    leaders.forEach(function (e, i) {
      var el = document.createElement('div');
      el.style.cssText = 'padding:0.3rem 0.6rem;border-bottom:1px solid rgba(255,255,255,0.05);font-size:0.85em';
      el.innerHTML = '<strong>#' + (i + 1) + '</strong> ' + e.nickname + ' (' + e.speciesName + ') — <span style="opacity:0.7">' + e.ownerName + '</span> | ' + e.wins + 'W/' + e.losses + 'L Lv.' + e.level;
      list.appendChild(el);
    });
  });

})();
