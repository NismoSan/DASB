import { escapeHtml, getStatusLabel } from './text';

type BotUiDeps = {
  socket: any,
  getBotStates: () => Record<string, any>,
  getActiveBotTabId: () => string | null,
  setActiveBotTabId: (id: string | null) => void,
  getMapListCache: () => any,
  getWalkFavorites: () => Record<string, any[]>,
  getLoginWalkTargets: () => Record<string, any>,
  setSelectedWalkBotId: (id: string | null) => void,
  setSelectedChatBotId: (id: string | null) => void,
  setSelectedWhisperBotId: (id: string | null) => void,
  setSelectedNavBotId: (id: string | null) => void,
  showToast: (message: string, isError?: boolean) => void,
  renderChatBotTabs: () => void,
};

export function createBotUi(deps: BotUiDeps) {
  function buildMapOptions(currentMapId: any) {
    var mapListCache = deps.getMapListCache();
    var html = '<option value="">-- Select Map --</option>';
    var nameMap: Record<string, any> = {};
    mapListCache.nodes.forEach(function (n: any) {
      nameMap[n.mapId] = n.mapName;
    });
    var ids = mapListCache.reachableIds.length > 0 ? mapListCache.reachableIds : Object.keys(nameMap).map(Number).sort(function (a, b) { return a - b; });
    var entries = ids.map(function (id: number) {
      return { id: id, name: nameMap[id] || ('Map ' + id) };
    });
    entries.sort(function (a: any, b: any) {
      var aIsMap = a.name.indexOf('Map ') === 0 && /^Map \d+$/.test(a.name);
      var bIsMap = b.name.indexOf('Map ') === 0 && /^Map \d+$/.test(b.name);
      if (aIsMap && !bIsMap) return 1;
      if (!aIsMap && bIsMap) return -1;
      if (aIsMap && bIsMap) return a.id - b.id;
      return a.name.localeCompare(b.name);
    });
    entries.forEach(function (entry: any) {
      var selected = entry.id === currentMapId ? ' selected' : '';
      html += '<option value="' + entry.id + '"' + selected + '>' + escapeHtml(entry.name) + ' (' + entry.id + ')</option>';
    });
    return html;
  }

  function setNavStatus(botId: any, text: string, color?: string) {
    var el = document.querySelector('.bot-nav-status[data-bot-id="' + botId + '"]') as HTMLElement | null;
    if (el) {
      el.textContent = text;
      el.style.color = color || '';
    }
  }

  function renderBotTabBar() {
    var botStates = deps.getBotStates();
    var activeBotTabId = deps.getActiveBotTabId();
    var tabBar = document.getElementById('bot-tab-bar') as HTMLElement | null;
    var emptyMsg = document.getElementById('bot-tabs-empty') as HTMLElement | null;
    if (!tabBar || !emptyMsg) return;
    var tabBarEl = tabBar as HTMLElement;
    var ids = Object.keys(botStates);
    if (ids.length === 0) {
      emptyMsg.style.display = '';
      tabBarEl.querySelectorAll('.bot-tab').forEach(function (t) { t.remove(); });
      var content = document.getElementById('bot-tab-content');
      if (content) content.innerHTML = '';
      return;
    }
    emptyMsg.style.display = 'none';
    tabBarEl.querySelectorAll('.bot-tab').forEach(function (tab: any) {
      if (!botStates[tab.dataset.botId]) tab.remove();
    });
    ids.forEach(function (id) {
      var state = botStates[id];
      var existing = tabBarEl.querySelector('.bot-tab[data-bot-id="' + id + '"]') as HTMLElement | null;
      if (existing) {
        existing.dataset.status = state.status;
        var label = existing.querySelector('.bot-tab-label');
        if (label) label.textContent = state.username || id;
      } else {
        var tab = document.createElement('button');
        tab.className = 'bot-tab';
        tab.dataset.botId = id;
        tab.dataset.status = state.status;
        tab.innerHTML = '<span class="bot-tab-dot"></span><span class="bot-tab-label">' + escapeHtml(state.username || id) + '</span>';
        tab.addEventListener('click', function () {
          deps.setActiveBotTabId(id);
          tabBarEl.querySelectorAll('.bot-tab').forEach(function (t) { t.classList.remove('active'); });
          tab.classList.add('active');
          renderActiveBotTab();
        });
        tabBarEl.insertBefore(tab, emptyMsg);
      }
    });
    if (!activeBotTabId || !botStates[activeBotTabId]) {
      deps.setActiveBotTabId(ids[0]);
      activeBotTabId = ids[0];
    }
    tabBarEl.querySelectorAll('.bot-tab').forEach(function (t: any) {
      t.classList.toggle('active', t.dataset.botId === activeBotTabId);
    });
  }

  function renderActiveBotTab() {
    var botStates = deps.getBotStates();
    var activeBotTabId = deps.getActiveBotTabId();
    var mapListCache = deps.getMapListCache();
    var walkFavorites = deps.getWalkFavorites();
    var loginWalkTargets = deps.getLoginWalkTargets();
    var container = document.getElementById('bot-tab-content');
    if (!container) return;
    if (!activeBotTabId || !botStates[activeBotTabId]) {
      container.innerHTML = '';
      return;
    }
    var state = botStates[activeBotTabId];
    var botId = state.id;
    var posStr = state.position ? state.position.x + ', ' + state.position.y : '--';
    var mapStr = state.mapName ? escapeHtml(state.mapName) + ' (' + state.mapNumber + ')' : (state.mapNumber ? 'Map ' + state.mapNumber : '--');
    var favs = walkFavorites[botId] || [];
    var loginObj = loginWalkTargets[botId] || null;
    var loginFavId = loginObj ? loginObj.favId : null;
    var loginFaceDir = loginObj ? (loginObj.faceDirection >= 0 ? loginObj.faceDirection : -1) : -1;
    var hasMapList = mapListCache.reachableIds.length > 0 || mapListCache.nodes.length > 0;

    var html = '<div class="bot-tab-panel" data-bot-id="' + escapeHtml(botId) + '" data-status="' + state.status + '">' +
      '<div class="btp-header">' +
        '<div class="btp-identity">' +
          '<span class="btp-name">' + escapeHtml(state.username || botId) + '</span>' +
          (state.role === 'primary' ? '<span class="btp-badge">Primary</span>' : state.role === 'lottery' ? '<span class="btp-badge" style="background:#d4a017;color:#000;">Lottery</span>' : state.role === 'tracker' ? '<span class="btp-badge" style="background:#17a2b8;color:#fff;">Tracker</span>' : state.role === 'trader' ? '<span class="btp-badge" style="background:#a855f7;color:#fff;">Trader</span>' : state.role === 'leak' ? '<span class="btp-badge" style="background:#ef4444;color:#fff;">Leak</span>' : '') +
          '<span class="btp-status" data-status="' + state.status + '">' + getStatusLabel(state.status) + '</span>' +
        '</div>' +
        '<div class="btp-controls">' +
          '<button class="btn btn-icon btn-green bot-btn-start" data-bot-id="' + escapeHtml(botId) + '"' + (state.status !== 'disconnected' ? ' disabled' : '') + ' title="Start"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>' +
          '<button class="btn btn-icon btn-red bot-btn-stop" data-bot-id="' + escapeHtml(botId) + '"' + (state.status === 'disconnected' ? ' disabled' : '') + ' title="Stop"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="1"/></svg></button>' +
          '<button class="btn btn-icon btn-yellow bot-btn-reconnect" data-bot-id="' + escapeHtml(botId) + '"' + (state.status === 'disconnected' || state.status === 'reconnecting' || state.status === 'waiting_reconnect' ? ' disabled' : '') + ' title="Reconnect"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>' +
          '<button class="btn btn-icon bot-btn-force-reset" data-bot-id="' + escapeHtml(botId) + '"' + (state.status === 'disconnected' ? ' disabled' : '') + ' title="Force Reset"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64A9 9 0 0 1 20.77 15M3.23 15A9 9 0 0 1 12 3m0 0v4m0-4L8 7m4-4l4 4"/><line x1="2" y1="2" x2="22" y2="22"/></svg></button>' +
        '</div>' +
      '</div>' +
      (state.status === 'reconnecting' ? '<div class="btp-reconnect">Reconnecting... attempt ' + (state.reconnectAttempt || '?') + '</div>' : '') +
      (state.status === 'waiting_reconnect' ? '<div class="btp-reconnect">Waiting for leader...</div>' : '') +
      '<div class="btp-info-bar">' +
        '<div class="btp-stat"><span class="btp-stat-label">Map</span><span class="btp-stat-value">' + mapStr + '</span></div>' +
        '<div class="btp-stat"><span class="btp-stat-label">Position</span><span class="btp-stat-value">' + posStr + '</span></div>' +
        '<div class="btp-stat"><span class="btp-stat-label">Server</span><span class="btp-stat-value">' + escapeHtml(state.serverName || '--') + '</span></div>' +
        '<div class="btp-stat"><span class="btp-stat-label">Uptime</span><span class="btp-stat-value bot-uptime" data-connected-at="' + (state.connectedAt || '') + '">--</span></div>' +
      '</div>' +
      '<div class="bot-nav-status" data-bot-id="' + escapeHtml(botId) + '"></div>' +
      '<div class="btp-panels">' +
        '<div class="btp-card btp-move-card">' +
          '<div class="btp-card-title">Movement</div>' +
          '<div class="dpad">' +
            '<div class="dpad-row dpad-center"><button data-dir="0" data-bot-id="' + escapeHtml(botId) + '" class="btn btn-dpad bot-dpad-btn" title="North">N</button></div>' +
            '<div class="dpad-row"><button data-dir="3" data-bot-id="' + escapeHtml(botId) + '" class="btn btn-dpad bot-dpad-btn" title="West">W</button><div class="dpad-center-gem"></div><button data-dir="1" data-bot-id="' + escapeHtml(botId) + '" class="btn btn-dpad bot-dpad-btn" title="East">E</button></div>' +
            '<div class="dpad-row dpad-center"><button data-dir="2" data-bot-id="' + escapeHtml(botId) + '" class="btn btn-dpad bot-dpad-btn" title="South">S</button></div>' +
          '</div>' +
          '<div class="dpad-mode-toggle">' +
            '<button class="btn btn-small bot-dpad-mode-btn" data-bot-id="' + escapeHtml(botId) + '" data-mode="walk" title="Toggle Walk/Turn mode">Mode: Walk</button>' +
          '</div>' +
          '<div class="btp-walk-xy">' +
            '<input type="number" class="bot-nav-x" data-bot-id="' + escapeHtml(botId) + '" placeholder="X">' +
            '<input type="number" class="bot-nav-y" data-bot-id="' + escapeHtml(botId) + '" placeholder="Y">' +
            '<button class="btn btn-small btn-green bot-nav-walk-btn" data-bot-id="' + escapeHtml(botId) + '">Walk</button>' +
          '</div>' +
          '<div class="btp-face-after">' +
            '<label class="btp-face-label">Face after walk:</label>' +
            '<select class="bot-face-after-select" data-bot-id="' + escapeHtml(botId) + '">' +
              '<option value="-1">None</option>' +
              '<option value="0">North</option>' +
              '<option value="1">East</option>' +
              '<option value="2">South</option>' +
              '<option value="3">West</option>' +
            '</select>' +
          '</div>' +
        '</div>' +
        '<div class="btp-card btp-nav-card">' +
          '<div class="btp-card-title">Navigate to Map</div>' +
          '<select class="toolbar-select bot-nav-map-select" data-bot-id="' + escapeHtml(botId) + '">' + buildMapOptions(state.mapNumber || null) + '</select>' +
          '<div class="btp-nav-coords">' +
            '<input type="number" class="bot-nav-target-x" data-bot-id="' + escapeHtml(botId) + '" placeholder="X (optional)">' +
            '<input type="number" class="bot-nav-target-y" data-bot-id="' + escapeHtml(botId) + '" placeholder="Y (optional)">' +
          '</div>' +
          '<div class="btp-nav-actions">' +
            '<button class="btn btn-small bot-nav-navigate-btn" data-bot-id="' + escapeHtml(botId) + '">Navigate</button>' +
            '<button class="btn btn-small btn-red bot-nav-stop-btn" data-bot-id="' + escapeHtml(botId) + '">Stop</button>' +
            '<button class="btn btn-small btp-save-fav-btn bot-nav-save-btn" data-bot-id="' + escapeHtml(botId) + '" title="Save as favorite spot">Save Spot</button>' +
          '</div>' +
          (!hasMapList ? '<div class="btp-map-hint">Map list populates after bots connect and explore.</div>' : '') +
        '</div>' +
      '</div>' +
      '<div class="btp-card btp-spots-card">' +
        '<div class="btp-card-title">Saved Spots' + (favs.length > 0 ? ' <span class="btp-spot-count">' + favs.length + '</span>' : '') + '</div>' +
        (favs.length === 0
          ? '<div class="btp-spots-empty">No saved spots. Use "Save Spot" above after selecting a map.</div>'
          : '<div class="btp-spots-list">' + favs.map(function (fav: any) {
              var isLogin = loginFavId === fav.id;
              var coordStr = (fav.x || fav.y) ? fav.x + ', ' + fav.y : 'entrance';
              var mapLabel = 'Map ' + fav.mapId;
              mapListCache.nodes.forEach(function (n: any) { if (n.mapId === fav.mapId) mapLabel = n.mapName; });
              return '<div class="btp-spot' + (isLogin ? ' btp-spot-login' : '') + '">' +
                '<div class="btp-spot-info">' +
                  '<span class="btp-spot-name">' + escapeHtml(fav.name) + '</span>' +
                  '<span class="btp-spot-detail">' + escapeHtml(mapLabel) + ' (' + coordStr + ')</span>' +
                '</div>' +
                '<div class="btp-spot-actions">' +
                  '<button class="btn btn-small btn-green bot-fav-go" data-bot-id="' + escapeHtml(botId) + '" data-fav-id="' + fav.id + '" title="Navigate here now">Go</button>' +
                  '<button class="btn btn-small bot-fav-login-btn' + (isLogin ? ' btp-login-active' : '') + '" data-bot-id="' + escapeHtml(botId) + '" data-fav-id="' + fav.id + '" title="' + (isLogin ? 'Remove auto-walk on login' : 'Auto-walk here on login') + '">' + (isLogin ? 'On Login' : 'Set Login') + '</button>' +
                  (isLogin ? '<select class="bot-login-face-select" data-bot-id="' + escapeHtml(botId) + '" data-fav-id="' + fav.id + '" title="Face direction after login walk">' +
                    '<option value="-1"' + (loginFaceDir === -1 ? ' selected' : '') + '>No Face</option>' +
                    '<option value="0"' + (loginFaceDir === 0 ? ' selected' : '') + '>North</option>' +
                    '<option value="1"' + (loginFaceDir === 1 ? ' selected' : '') + '>East</option>' +
                    '<option value="2"' + (loginFaceDir === 2 ? ' selected' : '') + '>South</option>' +
                    '<option value="3"' + (loginFaceDir === 3 ? ' selected' : '') + '>West</option>' +
                  '</select>' : '') +
                  '<button class="btn btn-small btn-red bot-fav-delete" data-bot-id="' + escapeHtml(botId) + '" data-fav-id="' + fav.id + '" title="Delete">&times;</button>' +
                '</div>' +
              '</div>';
            }).join('') + '</div>') +
      '</div>' +
    '</div>';
    container.innerHTML = html;
    attachBotTabEvents(botId);
  }

  function attachBotTabEvents(botId: string) {
    var botStates = deps.getBotStates();
    var walkFavorites = deps.getWalkFavorites();
    var loginWalkTargets = deps.getLoginWalkTargets();
    var panel = document.querySelector('.bot-tab-panel[data-bot-id="' + botId + '"]');
    if (!panel) return;
    var panelEl = panel as HTMLElement;
    panelEl.querySelectorAll('button[data-bot-id]').forEach(function (btn: any) {
      if (btn.classList.contains('bot-btn-start')) {
        btn.addEventListener('click', function () { deps.socket.emit('bot:start', { botId: botId }); });
      } else if (btn.classList.contains('bot-btn-stop')) {
        btn.addEventListener('click', function () { deps.socket.emit('bot:stop', { botId: botId }); });
      } else if (btn.classList.contains('bot-btn-reconnect')) {
        btn.addEventListener('click', function () { deps.socket.emit('bot:reconnect', { botId: botId }); });
      } else if (btn.classList.contains('bot-btn-force-reset')) {
        btn.addEventListener('click', function () { deps.socket.emit('bot:forceReset', { botId: botId }); });
      }
    });
    var modeBtn = panelEl.querySelector('.bot-dpad-mode-btn') as any;
    if (modeBtn) {
      modeBtn.addEventListener('click', function () {
        var current = modeBtn.dataset.mode;
        if (current === 'walk') {
          modeBtn.dataset.mode = 'turn';
          modeBtn.textContent = 'Mode: Turn';
          modeBtn.classList.add('dpad-mode-turn');
        } else {
          modeBtn.dataset.mode = 'walk';
          modeBtn.textContent = 'Mode: Walk';
          modeBtn.classList.remove('dpad-mode-turn');
        }
      });
    }
    panelEl.querySelectorAll('.bot-dpad-btn').forEach(function (btn: any) {
      btn.addEventListener('click', function () {
        var mode = modeBtn ? modeBtn.dataset.mode : 'walk';
        var evt = mode === 'turn' ? 'bot:turn' : 'bot:walk';
        deps.socket.emit(evt, { botId: botId, direction: parseInt(btn.dataset.dir) });
      });
    });
    var walkBtn = panelEl.querySelector('.bot-nav-walk-btn');
    if (walkBtn) {
      walkBtn.addEventListener('click', function () {
        var x = parseInt((panelEl.querySelector('.bot-nav-x') as HTMLInputElement).value);
        var y = parseInt((panelEl.querySelector('.bot-nav-y') as HTMLInputElement).value);
        if (isNaN(x) || isNaN(y)) { deps.showToast('Enter X and Y coordinates', true); return; }
        setNavStatus(botId, 'Walking to (' + x + ', ' + y + ')...', 'var(--gold-400)');
        deps.socket.emit('bot:walkTo', { botId: botId, x: x, y: y });
      });
    }
    var navBtn = panelEl.querySelector('.bot-nav-navigate-btn');
    if (navBtn) {
      navBtn.addEventListener('click', function () {
        var mapSelect = panelEl.querySelector('.bot-nav-map-select') as HTMLSelectElement;
        var mapId = parseInt(mapSelect.value);
        var x = parseInt((panelEl.querySelector('.bot-nav-target-x') as HTMLInputElement).value) || 0;
        var y = parseInt((panelEl.querySelector('.bot-nav-target-y') as HTMLInputElement).value) || 0;
        if (isNaN(mapId)) { deps.showToast('Select a map first', true); return; }
        setNavStatus(botId, 'Navigating to map ' + mapId + '...', 'var(--gold-400)');
        deps.socket.emit('bot:navigateTo', { botId: botId, mapId: mapId, x: x, y: y });
      });
    }
    var stopBtn = panelEl.querySelector('.bot-nav-stop-btn');
    if (stopBtn) {
      stopBtn.addEventListener('click', function () {
        deps.socket.emit('bot:navStop', { botId: botId });
        setNavStatus(botId, 'Stopped', 'var(--text-secondary)');
      });
    }
    var saveBtn = panelEl.querySelector('.bot-nav-save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        var mapSelect = panelEl.querySelector('.bot-nav-map-select') as HTMLSelectElement;
        var mapId = parseInt(mapSelect.value);
        var xInput = (panelEl.querySelector('.bot-nav-target-x') as HTMLInputElement).value;
        var yInput = (panelEl.querySelector('.bot-nav-target-y') as HTMLInputElement).value;
        var st = botStates[botId];
        var x = xInput ? parseInt(xInput) : (st && st.position ? st.position.x : 0);
        var y = yInput ? parseInt(yInput) : (st && st.position ? st.position.y : 0);
        if (isNaN(mapId)) {
          if (st && st.mapNumber) { mapId = st.mapNumber; }
          else { deps.showToast('Select a map first', true); return; }
        }
        var mapName = 'Map ' + mapId;
        var opt = mapSelect.querySelector('option[value="' + mapId + '"]');
        if (opt) mapName = (opt as HTMLOptionElement).textContent || mapName;
        var name = prompt('Name this spot:', mapName);
        if (!name) return;
        deps.socket.emit('nav:saveFavorite', { botId: botId, favorite: { name: name, mapId: mapId, x: x, y: y } });
      });
    }
    panelEl.querySelectorAll('.bot-fav-go').forEach(function (btn: any) {
      btn.addEventListener('click', function () {
        var favId = btn.dataset.favId;
        var favs = walkFavorites[botId] || [];
        var fav = favs.find(function (f: any) { return f.id === favId; });
        if (!fav) return;
        var x = fav.x || 0;
        var y = fav.y || 0;
        setNavStatus(botId, 'Navigating to ' + fav.name + '...', 'var(--gold-400)');
        deps.socket.emit('bot:navigateTo', { botId: botId, mapId: fav.mapId, x: x, y: y });
      });
    });
    panelEl.querySelectorAll('.bot-fav-login-btn').forEach(function (btn: any) {
      btn.addEventListener('click', function () {
        var favId = btn.dataset.favId;
        var current = loginWalkTargets[botId];
        var currentFavId = current ? current.favId : null;
        if (currentFavId === favId) {
          deps.socket.emit('nav:setLoginWalk', { botId: botId, favId: null, faceDirection: -1 });
        } else {
          deps.socket.emit('nav:setLoginWalk', { botId: botId, favId: favId, faceDirection: -1 });
        }
      });
    });
    panelEl.querySelectorAll('.bot-login-face-select').forEach(function (sel: any) {
      sel.addEventListener('change', function () {
        deps.socket.emit('nav:setLoginWalk', { botId: botId, favId: sel.dataset.favId, faceDirection: parseInt(sel.value, 10) });
      });
    });
    panelEl.querySelectorAll('.bot-fav-delete').forEach(function (btn: any) {
      btn.addEventListener('click', function () {
        deps.socket.emit('nav:deleteFavorite', { botId: botId, favId: btn.dataset.favId });
      });
    });
  }

  function renderAllBotCards() {
    renderBotTabBar();
    renderActiveBotTab();
  }

  function updateBotCard(state: any) {
    renderBotTabBar();
    if (deps.getActiveBotTabId() === state.id) {
      renderActiveBotTab();
    }
  }

  function updateSidebarIndicator() {
    var botStates = deps.getBotStates();
    var total = Object.keys(botStates).length;
    var online = 0;
    var bestStatus = 'disconnected';
    for (var id in botStates) {
      if (botStates[id].status === 'logged_in') online++;
      if (botStates[id].status === 'logged_in') bestStatus = 'logged_in';
      else if (bestStatus !== 'logged_in' && (botStates[id].status === 'connecting' || botStates[id].status === 'connected' || botStates[id].status === 'reconnecting')) {
        bestStatus = botStates[id].status;
      }
    }
    var dot = document.getElementById('status-dot') as HTMLElement | null;
    var text = document.getElementById('status-text') as HTMLElement | null;
    if (dot) dot.dataset.status = bestStatus;
    if (text) text.textContent = online + ' / ' + total + ' online';
  }

  function updateBotSelectors() {
    var botStates = deps.getBotStates();
    var activeBotTabId = deps.getActiveBotTabId();
    var selects = [
      document.getElementById('walk-bot-select'),
      document.getElementById('chat-bot-select'),
      document.getElementById('whisper-bot-select'),
      document.getElementById('pkt-bot-filter'),
      document.getElementById('nav-bot-select')
    ];
    var ids = Object.keys(botStates);
    selects.forEach(function (select: any, idx: number) {
      if (!select) return;
      var currentVal = select.value;
      var html = idx === 3 ? '<option value="all">All Bots</option>' : '';
      ids.forEach(function (id) {
        var label = botStates[id].username || id;
        html += '<option value="' + escapeHtml(id) + '">' + escapeHtml(label) + '</option>';
      });
      select.innerHTML = html;
      if (currentVal && select.querySelector('option[value="' + currentVal + '"]')) {
        select.value = currentVal;
      }
    });
    var walkSel = document.getElementById('walk-bot-select') as HTMLSelectElement | null;
    var chatSel = document.getElementById('chat-bot-select') as HTMLSelectElement | null;
    var whisperSel = document.getElementById('whisper-bot-select') as HTMLSelectElement | null;
    var navSel = document.getElementById('nav-bot-select') as HTMLSelectElement | null;
    deps.setSelectedWalkBotId(walkSel ? walkSel.value || null : activeBotTabId);
    deps.setSelectedChatBotId(chatSel ? chatSel.value || null : null);
    deps.setSelectedWhisperBotId(whisperSel ? whisperSel.value || null : null);
    deps.setSelectedNavBotId(navSel ? navSel.value || null : activeBotTabId);
  }

  return {
    buildMapOptions: buildMapOptions,
    setNavStatus: setNavStatus,
    renderActiveBotTab: renderActiveBotTab,
    renderAllBotCards: renderAllBotCards,
    updateBotCard: updateBotCard,
    updateSidebarIndicator: updateSidebarIndicator,
    updateBotSelectors: updateBotSelectors
  };
}
