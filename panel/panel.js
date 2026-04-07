"use strict";
(() => {
  // src/panel/modules/text.ts
  function escapeHtml(text) {
    if (!text) return "";
    var div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
  function getStatusLabel(status) {
    switch (status) {
      case "disconnected":
        return "Offline";
      case "connecting":
        return "Connecting";
      case "connected":
        return "Connected";
      case "logged_in":
        return "Online";
      case "reconnecting":
        return "Reconnecting";
      case "waiting_reconnect":
        return "Waiting";
      default:
        return status;
    }
  }
  function formatFiredAgo(ts) {
    if (!ts) return "";
    var diff = Date.now() - ts;
    if (diff < 6e4) return "just now";
    if (diff < 36e5) return Math.floor(diff / 6e4) + "m ago";
    if (diff < 864e5) return Math.floor(diff / 36e5) + "h ago";
    return Math.floor(diff / 864e5) + "d ago";
  }
  function formatCountdown(ms) {
    if (ms <= 0) return "now";
    var s = Math.floor(ms / 1e3);
    var h = Math.floor(s / 3600);
    var m = Math.floor(s % 3600 / 60);
    var sec = s % 60;
    if (h > 0) return h + "h " + m + "m " + sec + "s";
    if (m > 0) return m + "m " + sec + "s";
    return sec + "s";
  }
  function formatDateTime(date) {
    var month = date.getMonth() + 1;
    var day = date.getDate();
    var year = date.getFullYear();
    var hours = date.getHours();
    var ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    if (hours === 0) hours = 12;
    var minutes = date.getMinutes();
    var minStr = minutes < 10 ? "0" + minutes : "" + minutes;
    return month + "/" + day + "/" + year + " " + hours + ":" + minStr + " " + ampm;
  }

  // src/panel/modules/bot-ui.ts
  function createBotUi(deps) {
    function buildMapOptions(currentMapId) {
      var mapListCache = deps.getMapListCache();
      var html = '<option value="">-- Select Map --</option>';
      var nameMap = {};
      mapListCache.nodes.forEach(function(n) {
        nameMap[n.mapId] = n.mapName;
      });
      var ids = mapListCache.reachableIds.length > 0 ? mapListCache.reachableIds : Object.keys(nameMap).map(Number).sort(function(a, b) {
        return a - b;
      });
      var entries = ids.map(function(id) {
        return { id, name: nameMap[id] || "Map " + id };
      });
      entries.sort(function(a, b) {
        var aIsMap = a.name.indexOf("Map ") === 0 && /^Map \d+$/.test(a.name);
        var bIsMap = b.name.indexOf("Map ") === 0 && /^Map \d+$/.test(b.name);
        if (aIsMap && !bIsMap) return 1;
        if (!aIsMap && bIsMap) return -1;
        if (aIsMap && bIsMap) return a.id - b.id;
        return a.name.localeCompare(b.name);
      });
      entries.forEach(function(entry) {
        var selected = entry.id === currentMapId ? " selected" : "";
        html += '<option value="' + entry.id + '"' + selected + ">" + escapeHtml(entry.name) + " (" + entry.id + ")</option>";
      });
      return html;
    }
    function setNavStatus(botId, text, color) {
      var el = document.querySelector('.bot-nav-status[data-bot-id="' + botId + '"]');
      if (el) {
        el.textContent = text;
        el.style.color = color || "";
      }
    }
    function renderBotTabBar() {
      var botStates = deps.getBotStates();
      var activeBotTabId = deps.getActiveBotTabId();
      var tabBar = document.getElementById("bot-tab-bar");
      var emptyMsg = document.getElementById("bot-tabs-empty");
      if (!tabBar || !emptyMsg) return;
      var tabBarEl = tabBar;
      var ids = Object.keys(botStates);
      if (ids.length === 0) {
        emptyMsg.style.display = "";
        tabBarEl.querySelectorAll(".bot-tab").forEach(function(t) {
          t.remove();
        });
        var content = document.getElementById("bot-tab-content");
        if (content) content.innerHTML = "";
        return;
      }
      emptyMsg.style.display = "none";
      tabBarEl.querySelectorAll(".bot-tab").forEach(function(tab) {
        if (!botStates[tab.dataset.botId]) tab.remove();
      });
      ids.forEach(function(id) {
        var state = botStates[id];
        var existing = tabBarEl.querySelector('.bot-tab[data-bot-id="' + id + '"]');
        if (existing) {
          existing.dataset.status = state.status;
          var label = existing.querySelector(".bot-tab-label");
          if (label) label.textContent = state.username || id;
        } else {
          var tab = document.createElement("button");
          tab.className = "bot-tab";
          tab.dataset.botId = id;
          tab.dataset.status = state.status;
          tab.innerHTML = '<span class="bot-tab-dot"></span><span class="bot-tab-label">' + escapeHtml(state.username || id) + "</span>";
          tab.addEventListener("click", function() {
            deps.setActiveBotTabId(id);
            tabBarEl.querySelectorAll(".bot-tab").forEach(function(t) {
              t.classList.remove("active");
            });
            tab.classList.add("active");
            renderActiveBotTab();
          });
          tabBarEl.insertBefore(tab, emptyMsg);
        }
      });
      if (!activeBotTabId || !botStates[activeBotTabId]) {
        deps.setActiveBotTabId(ids[0]);
        activeBotTabId = ids[0];
      }
      tabBarEl.querySelectorAll(".bot-tab").forEach(function(t) {
        t.classList.toggle("active", t.dataset.botId === activeBotTabId);
      });
    }
    function renderActiveBotTab() {
      var botStates = deps.getBotStates();
      var activeBotTabId = deps.getActiveBotTabId();
      var mapListCache = deps.getMapListCache();
      var walkFavorites = deps.getWalkFavorites();
      var loginWalkTargets = deps.getLoginWalkTargets();
      var container = document.getElementById("bot-tab-content");
      if (!container) return;
      if (!activeBotTabId || !botStates[activeBotTabId]) {
        container.innerHTML = "";
        return;
      }
      var state = botStates[activeBotTabId];
      var botId = state.id;
      var posStr = state.position ? state.position.x + ", " + state.position.y : "--";
      var mapStr = state.mapName ? escapeHtml(state.mapName) + " (" + state.mapNumber + ")" : state.mapNumber ? "Map " + state.mapNumber : "--";
      var favs = walkFavorites[botId] || [];
      var loginObj = loginWalkTargets[botId] || null;
      var loginFavId = loginObj ? loginObj.favId : null;
      var loginFaceDir = loginObj ? loginObj.faceDirection >= 0 ? loginObj.faceDirection : -1 : -1;
      var hasMapList = mapListCache.reachableIds.length > 0 || mapListCache.nodes.length > 0;
      var html = '<div class="bot-tab-panel" data-bot-id="' + escapeHtml(botId) + '" data-status="' + state.status + '"><div class="btp-header"><div class="btp-identity"><span class="btp-name">' + escapeHtml(state.username || botId) + "</span>" + (state.role === "primary" ? '<span class="btp-badge">Primary</span>' : state.role === "lottery" ? '<span class="btp-badge" style="background:#d4a017;color:#000;">Lottery</span>' : state.role === "tracker" ? '<span class="btp-badge" style="background:#17a2b8;color:#fff;">Tracker</span>' : state.role === "trader" ? '<span class="btp-badge" style="background:#a855f7;color:#fff;">Trader</span>' : state.role === "leak" ? '<span class="btp-badge" style="background:#ef4444;color:#fff;">Leak</span>' : "") + '<span class="btp-status" data-status="' + state.status + '">' + getStatusLabel(state.status) + '</span></div><div class="btp-controls"><button class="btn btn-icon btn-green bot-btn-start" data-bot-id="' + escapeHtml(botId) + '"' + (state.status !== "disconnected" ? " disabled" : "") + ' title="Start"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg></button><button class="btn btn-icon btn-red bot-btn-stop" data-bot-id="' + escapeHtml(botId) + '"' + (state.status === "disconnected" ? " disabled" : "") + ' title="Stop"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="1"/></svg></button><button class="btn btn-icon btn-yellow bot-btn-reconnect" data-bot-id="' + escapeHtml(botId) + '"' + (state.status === "disconnected" || state.status === "reconnecting" || state.status === "waiting_reconnect" ? " disabled" : "") + ' title="Reconnect"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button><button class="btn btn-icon bot-btn-force-reset" data-bot-id="' + escapeHtml(botId) + '"' + (state.status === "disconnected" ? " disabled" : "") + ' title="Force Reset"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64A9 9 0 0 1 20.77 15M3.23 15A9 9 0 0 1 12 3m0 0v4m0-4L8 7m4-4l4 4"/><line x1="2" y1="2" x2="22" y2="22"/></svg></button></div></div>' + (state.status === "reconnecting" ? '<div class="btp-reconnect">Reconnecting... attempt ' + (state.reconnectAttempt || "?") + "</div>" : "") + (state.status === "waiting_reconnect" ? '<div class="btp-reconnect">Waiting for leader...</div>' : "") + '<div class="btp-info-bar"><div class="btp-stat"><span class="btp-stat-label">Map</span><span class="btp-stat-value">' + mapStr + '</span></div><div class="btp-stat"><span class="btp-stat-label">Position</span><span class="btp-stat-value">' + posStr + '</span></div><div class="btp-stat"><span class="btp-stat-label">Server</span><span class="btp-stat-value">' + escapeHtml(state.serverName || "--") + '</span></div><div class="btp-stat"><span class="btp-stat-label">Uptime</span><span class="btp-stat-value bot-uptime" data-connected-at="' + (state.connectedAt || "") + '">--</span></div></div><div class="bot-nav-status" data-bot-id="' + escapeHtml(botId) + '"></div><div class="btp-panels"><div class="btp-card btp-move-card"><div class="btp-card-title">Movement</div><div class="dpad"><div class="dpad-row dpad-center"><button data-dir="0" data-bot-id="' + escapeHtml(botId) + '" class="btn btn-dpad bot-dpad-btn" title="North">N</button></div><div class="dpad-row"><button data-dir="3" data-bot-id="' + escapeHtml(botId) + '" class="btn btn-dpad bot-dpad-btn" title="West">W</button><div class="dpad-center-gem"></div><button data-dir="1" data-bot-id="' + escapeHtml(botId) + '" class="btn btn-dpad bot-dpad-btn" title="East">E</button></div><div class="dpad-row dpad-center"><button data-dir="2" data-bot-id="' + escapeHtml(botId) + '" class="btn btn-dpad bot-dpad-btn" title="South">S</button></div></div><div class="dpad-mode-toggle"><button class="btn btn-small bot-dpad-mode-btn" data-bot-id="' + escapeHtml(botId) + '" data-mode="walk" title="Toggle Walk/Turn mode">Mode: Walk</button></div><div class="btp-walk-xy"><input type="number" class="bot-nav-x" data-bot-id="' + escapeHtml(botId) + '" placeholder="X"><input type="number" class="bot-nav-y" data-bot-id="' + escapeHtml(botId) + '" placeholder="Y"><button class="btn btn-small btn-green bot-nav-walk-btn" data-bot-id="' + escapeHtml(botId) + '">Walk</button></div><div class="btp-face-after"><label class="btp-face-label">Face after walk:</label><select class="bot-face-after-select" data-bot-id="' + escapeHtml(botId) + '"><option value="-1">None</option><option value="0">North</option><option value="1">East</option><option value="2">South</option><option value="3">West</option></select></div></div><div class="btp-card btp-nav-card"><div class="btp-card-title">Navigate to Map</div><select class="toolbar-select bot-nav-map-select" data-bot-id="' + escapeHtml(botId) + '">' + buildMapOptions(state.mapNumber || null) + '</select><div class="btp-nav-coords"><input type="number" class="bot-nav-target-x" data-bot-id="' + escapeHtml(botId) + '" placeholder="X (optional)"><input type="number" class="bot-nav-target-y" data-bot-id="' + escapeHtml(botId) + '" placeholder="Y (optional)"></div><div class="btp-nav-actions"><button class="btn btn-small bot-nav-navigate-btn" data-bot-id="' + escapeHtml(botId) + '">Navigate</button><button class="btn btn-small btn-red bot-nav-stop-btn" data-bot-id="' + escapeHtml(botId) + '">Stop</button><button class="btn btn-small btp-save-fav-btn bot-nav-save-btn" data-bot-id="' + escapeHtml(botId) + '" title="Save as favorite spot">Save Spot</button></div>' + (!hasMapList ? '<div class="btp-map-hint">Map list populates after bots connect and explore.</div>' : "") + '</div></div><div class="btp-card btp-spots-card"><div class="btp-card-title">Saved Spots' + (favs.length > 0 ? ' <span class="btp-spot-count">' + favs.length + "</span>" : "") + "</div>" + (favs.length === 0 ? '<div class="btp-spots-empty">No saved spots. Use "Save Spot" above after selecting a map.</div>' : '<div class="btp-spots-list">' + favs.map(function(fav) {
        var isLogin = loginFavId === fav.id;
        var coordStr = fav.x || fav.y ? fav.x + ", " + fav.y : "entrance";
        var mapLabel = "Map " + fav.mapId;
        mapListCache.nodes.forEach(function(n) {
          if (n.mapId === fav.mapId) mapLabel = n.mapName;
        });
        return '<div class="btp-spot' + (isLogin ? " btp-spot-login" : "") + '"><div class="btp-spot-info"><span class="btp-spot-name">' + escapeHtml(fav.name) + '</span><span class="btp-spot-detail">' + escapeHtml(mapLabel) + " (" + coordStr + ')</span></div><div class="btp-spot-actions"><button class="btn btn-small btn-green bot-fav-go" data-bot-id="' + escapeHtml(botId) + '" data-fav-id="' + fav.id + '" title="Navigate here now">Go</button><button class="btn btn-small bot-fav-login-btn' + (isLogin ? " btp-login-active" : "") + '" data-bot-id="' + escapeHtml(botId) + '" data-fav-id="' + fav.id + '" title="' + (isLogin ? "Remove auto-walk on login" : "Auto-walk here on login") + '">' + (isLogin ? "On Login" : "Set Login") + "</button>" + (isLogin ? '<select class="bot-login-face-select" data-bot-id="' + escapeHtml(botId) + '" data-fav-id="' + fav.id + '" title="Face direction after login walk"><option value="-1"' + (loginFaceDir === -1 ? " selected" : "") + '>No Face</option><option value="0"' + (loginFaceDir === 0 ? " selected" : "") + '>North</option><option value="1"' + (loginFaceDir === 1 ? " selected" : "") + '>East</option><option value="2"' + (loginFaceDir === 2 ? " selected" : "") + '>South</option><option value="3"' + (loginFaceDir === 3 ? " selected" : "") + ">West</option></select>" : "") + '<button class="btn btn-small btn-red bot-fav-delete" data-bot-id="' + escapeHtml(botId) + '" data-fav-id="' + fav.id + '" title="Delete">&times;</button></div></div>';
      }).join("") + "</div>") + "</div></div>";
      container.innerHTML = html;
      attachBotTabEvents(botId);
    }
    function attachBotTabEvents(botId) {
      var botStates = deps.getBotStates();
      var walkFavorites = deps.getWalkFavorites();
      var loginWalkTargets = deps.getLoginWalkTargets();
      var panel = document.querySelector('.bot-tab-panel[data-bot-id="' + botId + '"]');
      if (!panel) return;
      var panelEl = panel;
      panelEl.querySelectorAll("button[data-bot-id]").forEach(function(btn) {
        if (btn.classList.contains("bot-btn-start")) {
          btn.addEventListener("click", function() {
            deps.socket.emit("bot:start", { botId });
          });
        } else if (btn.classList.contains("bot-btn-stop")) {
          btn.addEventListener("click", function() {
            deps.socket.emit("bot:stop", { botId });
          });
        } else if (btn.classList.contains("bot-btn-reconnect")) {
          btn.addEventListener("click", function() {
            deps.socket.emit("bot:reconnect", { botId });
          });
        } else if (btn.classList.contains("bot-btn-force-reset")) {
          btn.addEventListener("click", function() {
            deps.socket.emit("bot:forceReset", { botId });
          });
        }
      });
      var modeBtn = panelEl.querySelector(".bot-dpad-mode-btn");
      if (modeBtn) {
        modeBtn.addEventListener("click", function() {
          var current = modeBtn.dataset.mode;
          if (current === "walk") {
            modeBtn.dataset.mode = "turn";
            modeBtn.textContent = "Mode: Turn";
            modeBtn.classList.add("dpad-mode-turn");
          } else {
            modeBtn.dataset.mode = "walk";
            modeBtn.textContent = "Mode: Walk";
            modeBtn.classList.remove("dpad-mode-turn");
          }
        });
      }
      panelEl.querySelectorAll(".bot-dpad-btn").forEach(function(btn) {
        btn.addEventListener("click", function() {
          var mode = modeBtn ? modeBtn.dataset.mode : "walk";
          var evt = mode === "turn" ? "bot:turn" : "bot:walk";
          deps.socket.emit(evt, { botId, direction: parseInt(btn.dataset.dir) });
        });
      });
      var walkBtn = panelEl.querySelector(".bot-nav-walk-btn");
      if (walkBtn) {
        walkBtn.addEventListener("click", function() {
          var x = parseInt(panelEl.querySelector(".bot-nav-x").value);
          var y = parseInt(panelEl.querySelector(".bot-nav-y").value);
          if (isNaN(x) || isNaN(y)) {
            deps.showToast("Enter X and Y coordinates", true);
            return;
          }
          setNavStatus(botId, "Walking to (" + x + ", " + y + ")...", "var(--gold-400)");
          deps.socket.emit("bot:walkTo", { botId, x, y });
        });
      }
      var navBtn = panelEl.querySelector(".bot-nav-navigate-btn");
      if (navBtn) {
        navBtn.addEventListener("click", function() {
          var mapSelect = panelEl.querySelector(".bot-nav-map-select");
          var mapId = parseInt(mapSelect.value);
          var x = parseInt(panelEl.querySelector(".bot-nav-target-x").value) || 0;
          var y = parseInt(panelEl.querySelector(".bot-nav-target-y").value) || 0;
          if (isNaN(mapId)) {
            deps.showToast("Select a map first", true);
            return;
          }
          setNavStatus(botId, "Navigating to map " + mapId + "...", "var(--gold-400)");
          deps.socket.emit("bot:navigateTo", { botId, mapId, x, y });
        });
      }
      var stopBtn = panelEl.querySelector(".bot-nav-stop-btn");
      if (stopBtn) {
        stopBtn.addEventListener("click", function() {
          deps.socket.emit("bot:navStop", { botId });
          setNavStatus(botId, "Stopped", "var(--text-secondary)");
        });
      }
      var saveBtn = panelEl.querySelector(".bot-nav-save-btn");
      if (saveBtn) {
        saveBtn.addEventListener("click", function() {
          var mapSelect = panelEl.querySelector(".bot-nav-map-select");
          var mapId = parseInt(mapSelect.value);
          var xInput = panelEl.querySelector(".bot-nav-target-x").value;
          var yInput = panelEl.querySelector(".bot-nav-target-y").value;
          var st = botStates[botId];
          var x = xInput ? parseInt(xInput) : st && st.position ? st.position.x : 0;
          var y = yInput ? parseInt(yInput) : st && st.position ? st.position.y : 0;
          if (isNaN(mapId)) {
            if (st && st.mapNumber) {
              mapId = st.mapNumber;
            } else {
              deps.showToast("Select a map first", true);
              return;
            }
          }
          var mapName = "Map " + mapId;
          var opt = mapSelect.querySelector('option[value="' + mapId + '"]');
          if (opt) mapName = opt.textContent || mapName;
          var name = prompt("Name this spot:", mapName);
          if (!name) return;
          deps.socket.emit("nav:saveFavorite", { botId, favorite: { name, mapId, x, y } });
        });
      }
      panelEl.querySelectorAll(".bot-fav-go").forEach(function(btn) {
        btn.addEventListener("click", function() {
          var favId = btn.dataset.favId;
          var favs = walkFavorites[botId] || [];
          var fav = favs.find(function(f) {
            return f.id === favId;
          });
          if (!fav) return;
          var x = fav.x || 0;
          var y = fav.y || 0;
          setNavStatus(botId, "Navigating to " + fav.name + "...", "var(--gold-400)");
          deps.socket.emit("bot:navigateTo", { botId, mapId: fav.mapId, x, y });
        });
      });
      panelEl.querySelectorAll(".bot-fav-login-btn").forEach(function(btn) {
        btn.addEventListener("click", function() {
          var favId = btn.dataset.favId;
          var current = loginWalkTargets[botId];
          var currentFavId = current ? current.favId : null;
          if (currentFavId === favId) {
            deps.socket.emit("nav:setLoginWalk", { botId, favId: null, faceDirection: -1 });
          } else {
            deps.socket.emit("nav:setLoginWalk", { botId, favId, faceDirection: -1 });
          }
        });
      });
      panelEl.querySelectorAll(".bot-login-face-select").forEach(function(sel) {
        sel.addEventListener("change", function() {
          deps.socket.emit("nav:setLoginWalk", { botId, favId: sel.dataset.favId, faceDirection: parseInt(sel.value, 10) });
        });
      });
      panelEl.querySelectorAll(".bot-fav-delete").forEach(function(btn) {
        btn.addEventListener("click", function() {
          deps.socket.emit("nav:deleteFavorite", { botId, favId: btn.dataset.favId });
        });
      });
    }
    function renderAllBotCards() {
      renderBotTabBar();
      renderActiveBotTab();
    }
    function updateBotCard(state) {
      renderBotTabBar();
      if (deps.getActiveBotTabId() === state.id) {
        renderActiveBotTab();
      }
    }
    function updateSidebarIndicator() {
      var botStates = deps.getBotStates();
      var total = Object.keys(botStates).length;
      var online = 0;
      var bestStatus = "disconnected";
      for (var id in botStates) {
        if (botStates[id].status === "logged_in") online++;
        if (botStates[id].status === "logged_in") bestStatus = "logged_in";
        else if (bestStatus !== "logged_in" && (botStates[id].status === "connecting" || botStates[id].status === "connected" || botStates[id].status === "reconnecting")) {
          bestStatus = botStates[id].status;
        }
      }
      var dot = document.getElementById("status-dot");
      var text = document.getElementById("status-text");
      if (dot) dot.dataset.status = bestStatus;
      if (text) text.textContent = online + " / " + total + " online";
    }
    function updateBotSelectors() {
      var botStates = deps.getBotStates();
      var activeBotTabId = deps.getActiveBotTabId();
      var selects = [
        document.getElementById("walk-bot-select"),
        document.getElementById("chat-bot-select"),
        document.getElementById("whisper-bot-select"),
        document.getElementById("pkt-bot-filter"),
        document.getElementById("nav-bot-select")
      ];
      var ids = Object.keys(botStates);
      selects.forEach(function(select, idx) {
        if (!select) return;
        var currentVal = select.value;
        var html = idx === 3 ? '<option value="all">All Bots</option>' : "";
        ids.forEach(function(id) {
          var label = botStates[id].username || id;
          html += '<option value="' + escapeHtml(id) + '">' + escapeHtml(label) + "</option>";
        });
        select.innerHTML = html;
        if (currentVal && select.querySelector('option[value="' + currentVal + '"]')) {
          select.value = currentVal;
        }
      });
      var walkSel = document.getElementById("walk-bot-select");
      var chatSel = document.getElementById("chat-bot-select");
      var whisperSel = document.getElementById("whisper-bot-select");
      var navSel = document.getElementById("nav-bot-select");
      deps.setSelectedWalkBotId(walkSel ? walkSel.value || null : activeBotTabId);
      deps.setSelectedChatBotId(chatSel ? chatSel.value || null : null);
      deps.setSelectedWhisperBotId(whisperSel ? whisperSel.value || null : null);
      deps.setSelectedNavBotId(navSel ? navSel.value || null : activeBotTabId);
    }
    return {
      buildMapOptions,
      setNavStatus,
      renderActiveBotTab,
      renderAllBotCards,
      updateBotCard,
      updateSidebarIndicator,
      updateBotSelectors
    };
  }

  // src/panel/modules/chat-ui.ts
  function createChatUi(deps) {
    var chatLog = document.getElementById("chat-log");
    var MAX_CHAT = 500;
    var chatMessages = [];
    var activeChatChannel = "all";
    var activeChatBotId = "";
    var recentChatKeys = {};
    var mentions = [];
    var unreadCount = 0;
    var MAX_MENTIONS = 100;
    function renderChatEntry(msg) {
      var entry = document.createElement("div");
      var hasMention = msg.mentions && msg.mentions.length > 0;
      entry.className = "chat-entry chat-channel-" + msg.channel + (hasMention ? " chat-mention" : "");
      var time = new Date(msg.timestamp).toLocaleTimeString();
      var botStates = deps.getBotStates();
      var botName = msg.botId ? botStates[msg.botId] ? botStates[msg.botId].username : msg.botId : "";
      var botLabel = botName ? '<span class="chat-bot-label">[' + escapeHtml(botName) + "]</span>" : "";
      var mentionBadge = hasMention ? '<span class="chat-mention-badge">@</span>' : "";
      entry.innerHTML = '<span class="chat-time">' + time + "</span>" + botLabel + '<span class="chat-channel">[' + escapeHtml(msg.channelName) + "]</span>" + mentionBadge + '<span class="chat-sender">' + escapeHtml(msg.sender || "System") + '</span><span class="chat-text">' + escapeHtml(msg.message) + "</span>";
      return entry;
    }
    function chatMsgMatchesFilter(msg) {
      if (activeChatChannel !== "all" && String(msg.channel) !== activeChatChannel) return false;
      if (activeChatBotId && msg.botId !== activeChatBotId) return false;
      return true;
    }
    function chatDedupKey(msg) {
      return msg.channel + ":" + msg.sender + ":" + msg.message;
    }
    function maybeAutoScrollChatLog() {
      var autoScroll = document.getElementById("chat-auto-scroll");
      if (chatLog && autoScroll && autoScroll.checked) {
        chatLog.scrollTop = chatLog.scrollHeight;
      }
    }
    function renderChatLog() {
      var chatLogEl2 = chatLog;
      if (!chatLogEl2) return;
      chatLogEl2.innerHTML = "";
      var showAllBots = !activeChatBotId;
      var seenAt = {};
      chatMessages.forEach(function(msg) {
        if (!chatMsgMatchesFilter(msg)) return;
        if (showAllBots && msg.channel !== 0 && String(msg.channel) !== "0") {
          var key = chatDedupKey(msg);
          if (seenAt[key] !== void 0 && msg.timestamp - seenAt[key] < 3e3) return;
          seenAt[key] = msg.timestamp;
        }
        chatLogEl2.appendChild(renderChatEntry(msg));
      });
      maybeAutoScrollChatLog();
    }
    function renderChatBotTabs() {
      var container = document.getElementById("chat-bot-tabs");
      if (!container) return;
      var botStates = deps.getBotStates();
      var ids = Object.keys(botStates);
      if (ids.length <= 1) {
        container.innerHTML = "";
        container.style.display = "none";
        return;
      }
      container.style.display = "";
      var html = '<button class="chat-tab chat-tab-bot' + (activeChatBotId === "" ? " active" : "") + '" data-bot="">All Bots</button>';
      ids.forEach(function(id) {
        var label = botStates[id].username || id;
        var active = activeChatBotId === id ? " active" : "";
        html += '<button class="chat-tab chat-tab-bot' + active + '" data-bot="' + escapeHtml(id) + '">' + escapeHtml(label) + "</button>";
      });
      container.innerHTML = html;
    }
    function showToast(message, isError) {
      var container = document.getElementById("toast-container");
      if (!container) return;
      var toast = document.createElement("div");
      toast.className = "toast" + (isError ? " toast-error" : "");
      toast.textContent = message;
      container.appendChild(toast);
      setTimeout(function() {
        toast.remove();
      }, 3e3);
    }
    function showMentionToast(msg) {
      var container = document.getElementById("toast-container");
      if (!container) return;
      var toast = document.createElement("div");
      toast.className = "toast toast-mention";
      toast.innerHTML = '<span class="toast-mention-label">Mention</span><strong>' + escapeHtml(msg.sender || "Unknown") + "</strong> in " + escapeHtml(msg.channelName) + ": " + escapeHtml(msg.message).substring(0, 80) + (msg.message && msg.message.length > 80 ? "..." : "");
      container.appendChild(toast);
      setTimeout(function() {
        toast.remove();
      }, 5e3);
    }
    function showWhisperToast(msg) {
      var container = document.getElementById("toast-container");
      if (!container) return;
      var toast = document.createElement("div");
      toast.className = "toast toast-whisper";
      toast.innerHTML = '<span class="toast-whisper-label">Whisper</span><strong>' + escapeHtml(msg.sender || "Unknown") + "</strong>: " + escapeHtml(msg.message).substring(0, 80) + (msg.message && msg.message.length > 80 ? "..." : "");
      container.appendChild(toast);
      setTimeout(function() {
        toast.remove();
      }, 5e3);
    }
    function renderNotifList() {
      var container = document.getElementById("notif-list");
      var badge = document.getElementById("notif-badge");
      if (!container || !badge) return;
      if (mentions.length === 0) {
        container.innerHTML = '<div class="notif-empty">No mentions or whispers yet.</div>';
        badge.style.display = "none";
        return;
      }
      badge.textContent = "" + unreadCount;
      badge.style.display = unreadCount > 0 ? "" : "none";
      var html = "";
      for (var i = mentions.length - 1; i >= 0; i--) {
        var m = mentions[i];
        var time = new Date(m.timestamp).toLocaleTimeString();
        var isWhisper = m.type === "whisper";
        var readClass = m.read ? "" : " notif-unread";
        var whisperClass = isWhisper ? " notif-whisper" : "";
        var badgeHtml = isWhisper ? '<span class="notif-whisper-badge">DM</span>' : '<span class="chat-mention-badge">@</span>';
        html += '<div class="notif-entry' + readClass + whisperClass + '" data-notif-idx="' + i + '"><span class="chat-time">' + time + '</span><span class="chat-channel">[' + escapeHtml(m.channelName) + "]</span>" + badgeHtml + '<span class="chat-sender">' + escapeHtml(m.sender || "Unknown") + '</span><span class="chat-text">' + escapeHtml(m.message).substring(0, 120) + "</span></div>";
      }
      container.innerHTML = html;
    }
    function activateChatPanel() {
      deps.navLinks.forEach(function(link) {
        link.classList.remove("active");
      });
      deps.panels.forEach(function(panel) {
        panel.classList.remove("active");
      });
      var chatLink = document.querySelector('#sidebar a[data-panel="chat"]');
      if (chatLink) chatLink.classList.add("active");
      var chatPanel = document.getElementById("panel-chat");
      if (chatPanel) chatPanel.classList.add("active");
      if (deps.contentEl) deps.contentEl.classList.add("chat-active");
    }
    deps.socket.on("chat:history", function(messages) {
      chatMessages = messages.slice(-MAX_CHAT);
      renderChatLog();
    });
    deps.socket.on("chat:message", function(msg) {
      chatMessages.push(msg);
      while (chatMessages.length > MAX_CHAT) {
        chatMessages.shift();
      }
      if (!chatMsgMatchesFilter(msg) || !chatLog) return;
      if (!activeChatBotId && msg.channel !== 0 && String(msg.channel) !== "0") {
        var key = chatDedupKey(msg);
        var now = msg.timestamp;
        if (recentChatKeys[key] !== void 0 && now - recentChatKeys[key] < 3e3) return;
        recentChatKeys[key] = now;
        setTimeout(function() {
          delete recentChatKeys[key];
        }, 5e3);
      }
      chatLog.appendChild(renderChatEntry(msg));
      while (chatLog.children.length > MAX_CHAT) {
        chatLog.removeChild(chatLog.firstChild);
      }
      maybeAutoScrollChatLog();
    });
    var channelTabsEl = document.getElementById("chat-channel-tabs");
    var botTabsEl = document.getElementById("chat-bot-tabs");
    if (channelTabsEl) {
      var channelTabs = channelTabsEl;
      channelTabs.addEventListener("click", function(e) {
        var tab = e.target.closest(".chat-tab");
        if (!tab) return;
        channelTabs.querySelectorAll(".chat-tab.active").forEach(function(t) {
          t.classList.remove("active");
        });
        tab.classList.add("active");
        activeChatChannel = tab.getAttribute("data-channel") || "all";
        renderChatLog();
      });
    }
    if (botTabsEl) {
      var botTabs = botTabsEl;
      botTabs.addEventListener("click", function(e) {
        var tab = e.target.closest(".chat-tab");
        if (!tab) return;
        botTabs.querySelectorAll(".chat-tab.active").forEach(function(t) {
          t.classList.remove("active");
        });
        tab.classList.add("active");
        activeChatBotId = tab.getAttribute("data-bot") || "";
        renderChatLog();
      });
    }
    var chatClearBtn = document.getElementById("chat-clear");
    if (chatClearBtn && chatLog) {
      var chatLogEl = chatLog;
      chatClearBtn.addEventListener("click", function() {
        chatMessages = [];
        chatLogEl.innerHTML = "";
      });
    }
    var chatBotSelect = document.getElementById("chat-bot-select");
    if (chatBotSelect) {
      var chatBotSelectEl = chatBotSelect;
      chatBotSelectEl.addEventListener("change", function() {
        deps.setSelectedChatBotId(chatBotSelectEl.value);
      });
    }
    var whisperBotSelect = document.getElementById("whisper-bot-select");
    if (whisperBotSelect) {
      var whisperBotSelectEl = whisperBotSelect;
      whisperBotSelectEl.addEventListener("change", function() {
        deps.setSelectedWhisperBotId(whisperBotSelectEl.value);
      });
    }
    var sayBtn = document.getElementById("btn-say");
    if (sayBtn) {
      var sayBtnEl = sayBtn;
      sayBtnEl.addEventListener("click", function() {
        var messageInput = document.getElementById("say-message");
        var message = messageInput ? messageInput.value.trim() : "";
        var botId = deps.getSelectedChatBotId() || (chatBotSelect ? chatBotSelect.value : "");
        if (message && botId) {
          deps.socket.emit("bot:say", { botId, message });
          if (messageInput) messageInput.value = "";
        }
      });
    }
    var sayMessageInput = document.getElementById("say-message");
    if (sayMessageInput && sayBtn) {
      var sayBtnEl = sayBtn;
      sayMessageInput.addEventListener("keydown", function(e) {
        if (e.key === "Enter") {
          sayBtnEl.click();
        }
      });
    }
    var whisperBtn = document.getElementById("btn-whisper");
    if (whisperBtn) {
      var whisperBtnEl = whisperBtn;
      whisperBtnEl.addEventListener("click", function() {
        var targetInput = document.getElementById("whisper-target");
        var messageInput = document.getElementById("whisper-message");
        var target = targetInput ? targetInput.value.trim() : "";
        var message = messageInput ? messageInput.value.trim() : "";
        var botId = deps.getSelectedWhisperBotId() || (whisperBotSelect ? whisperBotSelect.value : "");
        if (target && message && botId) {
          deps.socket.emit("bot:whisper", { botId, target, message });
          if (messageInput) messageInput.value = "";
        }
      });
    }
    var whisperMessageInput = document.getElementById("whisper-message");
    if (whisperMessageInput && whisperBtn) {
      var whisperBtnEl = whisperBtn;
      whisperMessageInput.addEventListener("keydown", function(e) {
        if (e.key === "Enter") {
          whisperBtnEl.click();
        }
      });
    }
    deps.socket.on("bot:notification", function(data) {
      showToast(data.message, false);
    });
    deps.socket.on("bot:error", function(data) {
      showToast(data.message, true);
    });
    deps.socket.on("toast", function(message) {
      showToast(message);
    });
    deps.socket.on("mention:detected", function(msg) {
      mentions.push({
        type: "mention",
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
    deps.socket.on("whisper:received", function(msg) {
      mentions.push({
        type: "whisper",
        timestamp: msg.timestamp,
        sender: msg.sender,
        message: msg.message,
        channelName: "Whisper",
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
    var notifMarkReadBtn = document.getElementById("notif-mark-read");
    if (notifMarkReadBtn) {
      notifMarkReadBtn.addEventListener("click", function() {
        for (var i = 0; i < mentions.length; i++) {
          mentions[i].read = true;
        }
        unreadCount = 0;
        renderNotifList();
      });
    }
    var notifClearBtn = document.getElementById("notif-clear");
    if (notifClearBtn) {
      notifClearBtn.addEventListener("click", function() {
        mentions = [];
        unreadCount = 0;
        renderNotifList();
      });
    }
    var notifList = document.getElementById("notif-list");
    if (notifList) {
      notifList.addEventListener("click", function(e) {
        var entry = e.target.closest(".notif-entry");
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
      renderChatBotTabs,
      showToast
    };
  }

  // src/panel/modules/config-panel.ts
  function createConfigPanel(deps) {
    var currentConfigBots = [];
    function renderBotConfigRows(botsList) {
      currentConfigBots = botsList || [];
      var container = document.getElementById("bot-config-list");
      var html = "";
      for (var i = 0; i < currentConfigBots.length; i++) {
        var b = currentConfigBots[i];
        html += '<div class="bot-config-row" data-idx="' + i + '"><span class="bot-config-num">' + (i + 1) + '</span><input type="text" class="cfg-bot-username" value="' + escapeHtml(b.username || "") + '" placeholder="Username" autocomplete="off" /><input type="password" class="cfg-bot-password" value="' + escapeHtml(b.password || "") + '" placeholder="Password" autocomplete="off" /><label class="toolbar-check"><input type="checkbox" class="cfg-bot-enabled" ' + (b.enabled !== false ? "checked" : "") + ' /> On</label><select class="cfg-bot-role toolbar-select" style="width:auto;min-width:90px;font-size:12px;padding:2px 4px;"><option value="secondary"' + (b.role === "secondary" || !b.role ? " selected" : "") + '>Secondary</option><option value="primary"' + (b.role === "primary" ? " selected" : "") + '>Primary</option><option value="lottery"' + (b.role === "lottery" ? " selected" : "") + '>Lottery</option><option value="tracker"' + (b.role === "tracker" ? " selected" : "") + '>Tracker</option><option value="sense"' + (b.role === "sense" ? " selected" : "") + '>Sense</option><option value="trader"' + (b.role === "trader" ? " selected" : "") + '>Trader</option><option value="leak"' + (b.role === "leak" ? " selected" : "") + '>Leak Scanner</option><option value="slots"' + (b.role === "slots" ? " selected" : "") + '>Slot Machine</option></select><button type="button" class="btn btn-small btn-red cfg-bot-remove" data-idx="' + i + '">X</button></div>';
      }
      container.innerHTML = html;
      container.querySelectorAll(".cfg-bot-remove").forEach(function(btn) {
        btn.addEventListener("click", function() {
          var idx = parseInt(btn.dataset.idx, 10);
          currentConfigBots.splice(idx, 1);
          renderBotConfigRows(currentConfigBots);
        });
      });
      var addBtn = document.getElementById("btn-add-bot");
      if (addBtn) {
        addBtn.style.display = "";
      }
    }
    document.getElementById("btn-add-bot").addEventListener("click", function() {
      currentConfigBots.push({
        id: "bot_" + Date.now().toString(36),
        username: "",
        password: "",
        enabled: true,
        role: currentConfigBots.length === 0 ? "primary" : "secondary"
      });
      renderBotConfigRows(currentConfigBots);
    });
    deps.socket.on("config:data", function(config) {
      renderBotConfigRows(config.bots || []);
      document.getElementById("cfg-server-address").value = config.server && config.server.address || "52.88.55.94";
      document.getElementById("cfg-server-port").value = config.server && config.server.port || 2610;
      document.getElementById("cfg-web-port").value = config.webPort || 3e3;
      document.getElementById("cfg-auto-reconnect").checked = config.features ? config.features.autoReconnect !== false : true;
      document.getElementById("cfg-log-chat").checked = config.features ? config.features.logChat !== false : true;
      document.getElementById("cfg-log-packets").checked = config.features ? config.features.logPackets !== false : true;
      var rs = config.reconnectStrategy || {};
      document.getElementById("cfg-sequential-reconnect").checked = rs.sequential !== false;
      document.getElementById("cfg-reconnect-delay").value = rs.delayBetweenBots || 5e3;
      document.getElementById("cfg-walk-paths").value = JSON.stringify(config.walkPaths || [], null, 2);
      document.getElementById("cfg-timezone").value = config.timezone || "America/Chicago";
      var proxy = config.proxy || {};
      document.getElementById("cfg-proxy-enabled").checked = !!proxy.enabled;
      document.getElementById("cfg-proxy-log").checked = proxy.logPackets !== false;
      document.getElementById("cfg-proxy-public-address").value = proxy.publicAddress || "";
      document.getElementById("cfg-proxy-listen-port").value = proxy.listenPort || 2610;
      document.getElementById("cfg-proxy-game-port1").value = proxy.gamePort1 || 2611;
      document.getElementById("cfg-proxy-game-port2").value = proxy.gamePort2 || 2612;
      document.getElementById("cfg-proxy-real-address").value = proxy.realServerAddress || "52.88.55.94";
      document.getElementById("cfg-proxy-real-port").value = proxy.realLoginPort || 2610;
      var monsters = proxy.monsters || {};
      document.getElementById("cfg-monsters-enabled").checked = !!monsters.enabled;
      document.getElementById("cfg-monsters-encounter-map").value = monsters.encounterMapNumber || 449;
      document.getElementById("cfg-monsters-encounter-rate").value = "" + (monsters.encounterRate ? Math.round(monsters.encounterRate * 100) : 15);
      document.getElementById("cfg-monsters-max").value = monsters.maxMonsters || 6;
      document.getElementById("cfg-monsters-cooldown").value = monsters.companionCastCooldownMs || 6e3;
      document.getElementById("cfg-monsters-keeper-map").value = monsters.keeperMapNumber || 449;
      document.getElementById("cfg-monsters-keeper-x").value = monsters.keeperX || 5;
      document.getElementById("cfg-monsters-keeper-y").value = monsters.keeperY || 5;
      document.getElementById("cfg-monsters-keeper-sprite").value = monsters.keeperSprite || 1;
      document.getElementById("cfg-monsters-keeper-name").value = monsters.keeperName || "Monster Keeper";
      var nameTags = proxy.nameTags || {};
      document.getElementById("cfg-nametags-enabled").checked = nameTags.enabled !== false;
      document.getElementById("cfg-nametags-style").value = nameTags.nameStyle != null ? nameTags.nameStyle : 3;
    });
    document.getElementById("config-form").addEventListener("submit", function(e) {
      e.preventDefault();
      var rows = document.querySelectorAll(".bot-config-row");
      var botsArr = [];
      rows.forEach(function(row, i) {
        var username = row.querySelector(".cfg-bot-username").value.trim();
        var password = row.querySelector(".cfg-bot-password").value.trim();
        var enabled = row.querySelector(".cfg-bot-enabled").checked;
        var role = row.querySelector(".cfg-bot-role").value || "secondary";
        var existingBot = currentConfigBots[i] || {};
        botsArr.push({
          id: existingBot.id || "bot_" + Date.now().toString(36) + i,
          username,
          password,
          enabled,
          role
        });
      });
      var usernames = botsArr.map(function(b) {
        return b.username.toLowerCase();
      }).filter(function(u) {
        return u;
      });
      var uniqueUsernames = usernames.filter(function(u, i) {
        return usernames.indexOf(u) === i;
      });
      if (uniqueUsernames.length !== usernames.length) {
        deps.showToast("Bot usernames must be unique", true);
        return;
      }
      var walkPaths = [];
      try {
        walkPaths = JSON.parse(document.getElementById("cfg-walk-paths").value || "[]");
      } catch (err) {
        deps.showToast("Invalid JSON in Walk Paths field", true);
        return;
      }
      deps.socket.emit("config:save", {
        bots: botsArr,
        server: {
          address: document.getElementById("cfg-server-address").value,
          port: parseInt(document.getElementById("cfg-server-port").value, 10) || 2610
        },
        webPort: parseInt(document.getElementById("cfg-web-port").value, 10) || 3e3,
        features: {
          autoReconnect: document.getElementById("cfg-auto-reconnect").checked,
          logChat: document.getElementById("cfg-log-chat").checked,
          logPackets: document.getElementById("cfg-log-packets").checked
        },
        reconnectStrategy: {
          sequential: document.getElementById("cfg-sequential-reconnect").checked,
          delayBetweenBots: parseInt(document.getElementById("cfg-reconnect-delay").value, 10) || 5e3
        },
        walkPaths,
        timezone: document.getElementById("cfg-timezone").value,
        proxy: {
          enabled: document.getElementById("cfg-proxy-enabled").checked,
          listenPort: parseInt(document.getElementById("cfg-proxy-listen-port").value, 10) || 2610,
          gamePort1: parseInt(document.getElementById("cfg-proxy-game-port1").value, 10) || 2611,
          gamePort2: parseInt(document.getElementById("cfg-proxy-game-port2").value, 10) || 2612,
          publicAddress: document.getElementById("cfg-proxy-public-address").value.trim(),
          realServerAddress: document.getElementById("cfg-proxy-real-address").value.trim() || "52.88.55.94",
          realLoginPort: parseInt(document.getElementById("cfg-proxy-real-port").value, 10) || 2610,
          logPackets: document.getElementById("cfg-proxy-log").checked,
          monsters: {
            enabled: document.getElementById("cfg-monsters-enabled").checked,
            encounterMapNumber: parseInt(document.getElementById("cfg-monsters-encounter-map").value, 10) || 449,
            encounterRate: (parseInt(document.getElementById("cfg-monsters-encounter-rate").value, 10) || 15) / 100,
            maxMonsters: parseInt(document.getElementById("cfg-monsters-max").value, 10) || 6,
            companionCastCooldownMs: parseInt(document.getElementById("cfg-monsters-cooldown").value, 10) || 6e3,
            keeperMapNumber: parseInt(document.getElementById("cfg-monsters-keeper-map").value, 10) || 449,
            keeperX: parseInt(document.getElementById("cfg-monsters-keeper-x").value, 10) || 5,
            keeperY: parseInt(document.getElementById("cfg-monsters-keeper-y").value, 10) || 5,
            keeperSprite: parseInt(document.getElementById("cfg-monsters-keeper-sprite").value, 10) || 1,
            keeperName: document.getElementById("cfg-monsters-keeper-name").value.trim() || "Monster Keeper"
          },
          nameTags: {
            enabled: document.getElementById("cfg-nametags-enabled").checked,
            nameStyle: parseInt(document.getElementById("cfg-nametags-style").value, 10) || 3
          }
        }
      });
    });
  }

  // src/panel/modules/ae-panel.ts
  function createAePanel(deps) {
    deps.socket.on("ae:config", function(cfg) {
      document.getElementById("ae-enabled").checked = cfg.enabled;
      document.getElementById("ae-api-url").value = cfg.apiUrl || "";
      document.getElementById("ae-api-key").value = "";
      document.getElementById("ae-key-status").textContent = cfg.hasKey ? "(key is set)" : "(no key set)";
    });
    document.getElementById("ae-form").addEventListener("submit", function(e) {
      e.preventDefault();
      var keyValue = document.getElementById("ae-api-key").value.trim();
      deps.socket.emit("ae:saveConfig", {
        enabled: document.getElementById("ae-enabled").checked,
        apiUrl: document.getElementById("ae-api-url").value.trim(),
        apiKey: keyValue || "__keep__"
      });
    });
    document.getElementById("ae-test-btn").addEventListener("click", function() {
      document.getElementById("ae-test-result").textContent = "Testing...";
      document.getElementById("ae-test-result").className = "test-result";
      deps.socket.emit("ae:testConnection");
    });
    deps.socket.on("ae:testResult", function(result) {
      var el = document.getElementById("ae-test-result");
      if (result.success) {
        el.textContent = "Connection successful!";
        el.className = "test-result test-success";
      } else {
        el.textContent = "Failed: " + (result.error || "Unknown error");
        el.className = "test-result test-error";
      }
    });
  }

  // src/panel/modules/discord-panel.ts
  function createDiscordPanel(deps) {
    var discordRules = [];
    function renderDiscordRules(rules) {
      discordRules = rules || [];
      var container = document.getElementById("discord-rules-list");
      if (discordRules.length === 0) {
        container.innerHTML = '<div class="rules-empty">No webhook rules configured yet.</div>';
        return;
      }
      var html = "";
      for (var i = 0; i < discordRules.length; i++) {
        var r = discordRules[i];
        var typesStr = (r.messageTypes || []).join(", ");
        html += '<div class="rule-item' + (r.enabled ? " rule-enabled" : " rule-disabled") + '" data-rule-id="' + escapeHtml(r.id) + '"><div class="rule-header"><label class="rule-toggle"><input type="checkbox" ' + (r.enabled ? "checked" : "") + ' data-toggle-id="' + escapeHtml(r.id) + '" /> <span class="rule-name">' + escapeHtml(r.name || "Unnamed") + '</span></label><div class="rule-actions"><button class="btn btn-small rule-edit-btn" data-edit-idx="' + i + '">Edit</button><button class="btn btn-small btn-red rule-delete-btn" data-delete-id="' + escapeHtml(r.id) + '">Delete</button></div></div><div class="rule-details"><span class="rule-types">' + escapeHtml(typesStr) + "</span>" + (r.pattern ? '<span class="rule-pattern">/' + escapeHtml(r.pattern) + "/i</span>" : "") + "</div></div>";
      }
      container.innerHTML = html;
      container.querySelectorAll("input[data-toggle-id]").forEach(function(cb) {
        cb.addEventListener("change", function() {
          deps.socket.emit("discord:toggleRule", { id: cb.dataset.toggleId, enabled: cb.checked });
        });
      });
      container.querySelectorAll(".rule-edit-btn").forEach(function(btn) {
        btn.addEventListener("click", function() {
          var idx = parseInt(btn.dataset.editIdx, 10);
          loadRuleIntoForm(discordRules[idx]);
        });
      });
      container.querySelectorAll(".rule-delete-btn").forEach(function(btn) {
        btn.addEventListener("click", function() {
          deps.socket.emit("discord:deleteRule", { id: btn.dataset.deleteId });
        });
      });
    }
    function loadRuleIntoForm(rule) {
      document.getElementById("dr-id").value = rule.id || "";
      document.getElementById("dr-name").value = rule.name || "";
      document.getElementById("dr-bot-name").value = rule.botName || "";
      document.getElementById("dr-webhook-url").value = rule.webhookUrl || "";
      document.getElementById("dr-pattern").value = rule.pattern || "";
      document.querySelectorAll('#discord-rule-form fieldset input[type="checkbox"]').forEach(function(cb) {
        cb.checked = false;
      });
      var types = rule.messageTypes || [];
      var typeMap = {
        "Any": "dr-type-any",
        "WorldMessage (All)": "dr-type-world-all",
        "WorldShout": "dr-type-worldshout",
        "WorldMessage": "dr-type-worldmessage",
        "WhisperReceived": "dr-type-whisper",
        "Whisper": "dr-type-whisper-sent",
        "GuildMessage": "dr-type-guild",
        "PublicMessage": "dr-type-public"
      };
      for (var t = 0; t < types.length; t++) {
        var elId = typeMap[types[t]];
        if (elId) {
          var el = document.getElementById(elId);
          if (el) el.checked = true;
        }
      }
    }
    function clearRuleForm() {
      document.getElementById("dr-id").value = "";
      document.getElementById("dr-name").value = "";
      document.getElementById("dr-bot-name").value = "";
      document.getElementById("dr-webhook-url").value = "";
      document.getElementById("dr-pattern").value = "";
      document.querySelectorAll('#discord-rule-form fieldset input[type="checkbox"]').forEach(function(cb) {
        cb.checked = false;
      });
      document.getElementById("discord-test-result").textContent = "";
    }
    function generateId() {
      return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }
    deps.socket.on("discord:rules", function(rules) {
      renderDiscordRules(rules);
    });
    document.getElementById("discord-rule-form").addEventListener("submit", function(e) {
      e.preventDefault();
      var id = document.getElementById("dr-id").value.trim();
      if (!id) id = generateId();
      var selectedTypes = [];
      document.querySelectorAll('#discord-rule-form fieldset input[type="checkbox"]:checked').forEach(function(cb) {
        selectedTypes.push(cb.value);
      });
      var rule = {
        id,
        name: document.getElementById("dr-name").value.trim() || "Unnamed",
        enabled: true,
        webhookUrl: document.getElementById("dr-webhook-url").value.trim(),
        messageTypes: selectedTypes,
        pattern: document.getElementById("dr-pattern").value.trim() || null,
        botName: document.getElementById("dr-bot-name").value.trim() || "DASB",
        botAvatar: null
      };
      for (var i = 0; i < discordRules.length; i++) {
        if (discordRules[i].id === rule.id) {
          rule.enabled = discordRules[i].enabled;
          break;
        }
      }
      if (!rule.webhookUrl) {
        deps.showToast("Webhook URL is required", true);
        return;
      }
      if (selectedTypes.length === 0) {
        deps.showToast("Select at least one message type", true);
        return;
      }
      deps.socket.emit("discord:saveRule", rule);
      clearRuleForm();
    });
    document.getElementById("dr-clear-btn").addEventListener("click", function() {
      clearRuleForm();
    });
    document.getElementById("dr-test-btn").addEventListener("click", function() {
      var url = document.getElementById("dr-webhook-url").value.trim();
      var botName = document.getElementById("dr-bot-name").value.trim() || "DASB";
      if (!url) {
        deps.showToast("Enter a webhook URL first", true);
        return;
      }
      document.getElementById("discord-test-result").textContent = "Testing...";
      document.getElementById("discord-test-result").className = "test-result";
      deps.socket.emit("discord:testWebhook", { url, botName });
    });
    deps.socket.on("discord:testResult", function(result) {
      var el = document.getElementById("discord-test-result");
      if (result.success) {
        el.textContent = "Webhook test successful!";
        el.className = "test-result test-success";
      } else {
        el.textContent = "Failed: " + (result.error || "Unknown error");
        el.className = "test-result test-error";
      }
    });
  }

  // src/panel/modules/chat-games-ui.ts
  function createChatGamesUi(deps) {
    var socket = deps.socket;
    var showToast = deps.showToast;
    document.querySelectorAll("#cg-tabs .cg-tab").forEach(function(tab) {
      tab.addEventListener("click", function() {
        document.querySelectorAll("#cg-tabs .cg-tab").forEach(function(t) {
          t.classList.remove("active");
        });
        document.querySelectorAll(".cg-tab-content").forEach(function(c) {
          c.classList.remove("active");
        });
        tab.classList.add("active");
        var target = document.getElementById("cg-tab-" + tab.dataset.cgTab);
        if (target) target.classList.add("active");
      });
    });
    socket.on("chatgames:config", function(cfg) {
      document.getElementById("cg-enabled").checked = cfg.enabled;
      document.getElementById("cg-model").value = cfg.openaiModel || "gpt-4o-mini";
      var cfgPrefix = cfg.commandPrefix || "!";
      document.getElementById("cg-prefix").value = cfgPrefix;
      document.getElementById("cg-cooldown").value = cfg.cooldownSeconds || 10;
      var hostHint = document.getElementById("cg-host-prefix-hint");
      if (hostHint) hostHint.textContent = cfgPrefix + "host trivia 10";
      document.getElementById("cg-public").checked = cfg.publicChatEnabled !== false;
      document.getElementById("cg-whisper").checked = cfg.whisperEnabled !== false;
      var games = cfg.games || {};
      document.getElementById("cg-game-trivia").checked = games.trivia !== false;
      document.getElementById("cg-game-riddle").checked = games.riddle !== false;
      document.getElementById("cg-game-8ball").checked = games.eightball !== false;
      document.getElementById("cg-game-scramble").checked = games.scramble !== false;
      document.getElementById("cg-game-guess").checked = games.numberguess !== false;
      document.getElementById("cg-game-fortune").checked = games.fortune !== false;
      document.getElementById("cg-game-rps").checked = games.rps !== false;
      document.getElementById("cg-game-hangman").checked = games.hangman !== false;
      document.getElementById("cg-roast-mode").checked = !!cfg.roastMode;
      document.getElementById("cg-ragebait-mode").checked = !!cfg.rageBaitMode;
      document.getElementById("cg-roast-target").value = cfg.roastTarget || "";
      var keyEl = document.getElementById("cg-key-status");
      keyEl.textContent = cfg.hasApiKey ? "OPENAI_API_KEY detected" : "No OPENAI_API_KEY set (games will use fallback mode)";
      keyEl.style.color = cfg.hasApiKey ? "var(--green-400)" : "var(--amber-400)";
      renderCustomTrivia(cfg.customTrivia);
      renderCustomRiddles(cfg.customRiddles);
      renderCustomWords(cfg.customWords);
      renderCustom8Ball(cfg.custom8Ball);
      renderCustomFortunes(cfg.customFortunes);
    });
    document.getElementById("chatgames-form").addEventListener("submit", function(e) {
      e.preventDefault();
      socket.emit("chatgames:saveConfig", {
        enabled: document.getElementById("cg-enabled").checked,
        openaiModel: document.getElementById("cg-model").value.trim() || "gpt-4o-mini",
        commandPrefix: document.getElementById("cg-prefix").value.trim() || "!",
        cooldownSeconds: parseInt(document.getElementById("cg-cooldown").value) || 10,
        publicChatEnabled: document.getElementById("cg-public").checked,
        whisperEnabled: document.getElementById("cg-whisper").checked,
        roastMode: document.getElementById("cg-roast-mode").checked,
        rageBaitMode: document.getElementById("cg-ragebait-mode").checked,
        roastTarget: document.getElementById("cg-roast-target").value.trim(),
        games: {
          trivia: document.getElementById("cg-game-trivia").checked,
          riddle: document.getElementById("cg-game-riddle").checked,
          eightball: document.getElementById("cg-game-8ball").checked,
          scramble: document.getElementById("cg-game-scramble").checked,
          numberguess: document.getElementById("cg-game-guess").checked,
          fortune: document.getElementById("cg-game-fortune").checked,
          rps: document.getElementById("cg-game-rps").checked,
          hangman: document.getElementById("cg-game-hangman").checked
        }
      });
    });
    function renderActiveGames(games) {
      var container = document.getElementById("cg-active-games");
      if (!games || games.length === 0) {
        container.innerHTML = '<div class="rules-empty">No active games.</div>';
        return;
      }
      var html = "";
      for (var i = 0; i < games.length; i++) {
        var g = games[i];
        var elapsed = Math.floor((Date.now() - g.startedAt) / 1e3);
        html += '<div class="rule-item rule-enabled"><div class="rule-header"><span class="rule-name">' + escapeHtml(g.player) + '</span><span class="cg-game-badge">' + escapeHtml(g.gameType) + '</span></div><div class="rule-details"><span class="rule-types">' + (g.isWhisper ? "Whisper" : "Public") + '</span><span class="rule-pattern">Attempts: ' + g.attempts + " | " + elapsed + "s</span></div></div>";
      }
      container.innerHTML = html;
    }
    socket.on("chatgames:sessionStart", function() {
    });
    socket.on("chatgames:sessionEnd", function() {
    });
    socket.on("chatgames:active", function(games) {
      renderActiveGames(games);
    });
    var cgActivityLog = document.getElementById("cg-activity-log");
    var MAX_CG_ACTIVITY = 100;
    socket.on("chatgames:activity", function(entry) {
      var el = document.createElement("div");
      el.className = "cg-activity-entry";
      var time = new Date(entry.timestamp).toLocaleTimeString();
      el.innerHTML = '<span class="chat-time">' + time + '</span><span class="cg-game-badge">' + escapeHtml(entry.gameType) + '</span><span class="chat-sender">' + escapeHtml(entry.player) + '</span><span class="chat-text">' + escapeHtml(entry.action) + "</span>";
      cgActivityLog.appendChild(el);
      while (cgActivityLog.children.length > MAX_CG_ACTIVITY) {
        cgActivityLog.removeChild(cgActivityLog.firstChild);
      }
      cgActivityLog.scrollTop = cgActivityLog.scrollHeight;
    });
    socket.on("chatgames:error", function(err) {
      var el = document.createElement("div");
      el.className = "cg-activity-entry cg-activity-error";
      var time = new Date(err.timestamp).toLocaleTimeString();
      el.innerHTML = '<span class="chat-time">' + time + '</span><span class="cg-game-badge">error</span><span class="chat-sender">' + escapeHtml(err.player || "system") + '</span><span class="chat-text">' + escapeHtml(err.error) + "</span>";
      cgActivityLog.appendChild(el);
      cgActivityLog.scrollTop = cgActivityLog.scrollHeight;
    });
    document.getElementById("cg-roast-mode").addEventListener("change", function() {
      if (this.checked) {
        document.getElementById("cg-ragebait-mode").checked = false;
      }
    });
    document.getElementById("cg-ragebait-mode").addEventListener("change", function() {
      if (this.checked) {
        document.getElementById("cg-roast-mode").checked = false;
      }
    });
    var cgCustomTrivia = [];
    var cgCustomRiddles = [];
    var cgCustomWords = [];
    var cgCustom8Ball = [];
    var cgCustomFortunes = [];
    function renderCustomTrivia(list) {
      cgCustomTrivia = list || [];
      var container = document.getElementById("cg-custom-trivia-list");
      if (cgCustomTrivia.length === 0) {
        container.innerHTML = '<div class="rules-empty">No custom trivia yet.</div>';
        return;
      }
      var html = "";
      for (var i = 0; i < cgCustomTrivia.length; i++) {
        var t = cgCustomTrivia[i];
        html += '<div class="rule-item rule-enabled"><div class="rule-header"><span class="rule-name">' + escapeHtml(t.question) + '</span><div class="rule-actions"><button class="btn btn-small btn-red cg-trivia-delete" data-index="' + i + '">Delete</button></div></div><div class="rule-details"><span class="rule-types">A: ' + escapeHtml(t.answer) + "</span>" + (t.hint ? '<span class="rule-pattern">Hint: ' + escapeHtml(t.hint) + "</span>" : "") + "</div></div>";
      }
      container.innerHTML = html;
      container.querySelectorAll(".cg-trivia-delete").forEach(function(btn) {
        btn.addEventListener("click", function() {
          var idx = parseInt(btn.dataset.index);
          cgCustomTrivia.splice(idx, 1);
          socket.emit("chatgames:saveConfig", { customTrivia: cgCustomTrivia });
          renderCustomTrivia(cgCustomTrivia);
        });
      });
    }
    function renderCustomWords(list) {
      cgCustomWords = list || [];
      var container = document.getElementById("cg-custom-words-list");
      if (cgCustomWords.length === 0) {
        container.innerHTML = '<div class="rules-empty">No custom words yet.</div>';
        return;
      }
      var html = "";
      for (var i = 0; i < cgCustomWords.length; i++) {
        var w = cgCustomWords[i];
        html += '<div class="rule-item rule-enabled"><div class="rule-header"><span class="rule-name">' + escapeHtml(w.word) + '</span><div class="rule-actions"><button class="btn btn-small btn-red cg-word-delete" data-index="' + i + '">Delete</button></div></div><div class="rule-details"><span class="rule-types">Hint: ' + escapeHtml(w.hint || "none") + "</span></div></div>";
      }
      container.innerHTML = html;
      container.querySelectorAll(".cg-word-delete").forEach(function(btn) {
        btn.addEventListener("click", function() {
          var idx = parseInt(btn.dataset.index);
          cgCustomWords.splice(idx, 1);
          socket.emit("chatgames:saveConfig", { customWords: cgCustomWords });
          renderCustomWords(cgCustomWords);
        });
      });
    }
    document.getElementById("cg-trivia-add-form").addEventListener("submit", function(e) {
      e.preventDefault();
      var q = document.getElementById("cg-trivia-q").value.trim();
      var a = document.getElementById("cg-trivia-a").value.trim();
      var h = document.getElementById("cg-trivia-h").value.trim();
      if (!q || !a) {
        showToast("Question and answer are required", true);
        return;
      }
      cgCustomTrivia.push({ question: q, answer: a, hint: h || "No hint" });
      socket.emit("chatgames:saveConfig", { customTrivia: cgCustomTrivia });
      renderCustomTrivia(cgCustomTrivia);
      document.getElementById("cg-trivia-q").value = "";
      document.getElementById("cg-trivia-a").value = "";
      document.getElementById("cg-trivia-h").value = "";
    });
    function renderCustomRiddles(list) {
      cgCustomRiddles = list || [];
      var container = document.getElementById("cg-custom-riddles-list");
      if (cgCustomRiddles.length === 0) {
        container.innerHTML = '<div class="rules-empty">No custom riddles yet.</div>';
        return;
      }
      var html = "";
      for (var i = 0; i < cgCustomRiddles.length; i++) {
        var r = cgCustomRiddles[i];
        html += '<div class="rule-item rule-enabled"><div class="rule-header"><span class="rule-name">' + escapeHtml(r.riddle) + '</span><div class="rule-actions"><button class="btn btn-small btn-red cg-riddle-delete" data-index="' + i + '">Delete</button></div></div><div class="rule-details"><span class="rule-types">A: ' + escapeHtml(r.answer) + "</span>" + (r.hint ? '<span class="rule-pattern">Hint: ' + escapeHtml(r.hint) + "</span>" : "") + "</div></div>";
      }
      container.innerHTML = html;
      container.querySelectorAll(".cg-riddle-delete").forEach(function(btn) {
        btn.addEventListener("click", function() {
          var idx = parseInt(btn.dataset.index);
          cgCustomRiddles.splice(idx, 1);
          socket.emit("chatgames:saveConfig", { customRiddles: cgCustomRiddles });
          renderCustomRiddles(cgCustomRiddles);
        });
      });
    }
    document.getElementById("cg-riddles-add-form").addEventListener("submit", function(e) {
      e.preventDefault();
      var r = document.getElementById("cg-riddle-r").value.trim();
      var a = document.getElementById("cg-riddle-a").value.trim();
      var h = document.getElementById("cg-riddle-h").value.trim();
      if (!r || !a) {
        showToast("Riddle and answer are required", true);
        return;
      }
      cgCustomRiddles.push({ riddle: r, answer: a, hint: h || "No hint" });
      socket.emit("chatgames:saveConfig", { customRiddles: cgCustomRiddles });
      renderCustomRiddles(cgCustomRiddles);
      document.getElementById("cg-riddle-r").value = "";
      document.getElementById("cg-riddle-a").value = "";
      document.getElementById("cg-riddle-h").value = "";
    });
    document.getElementById("cg-words-add-form").addEventListener("submit", function(e) {
      e.preventDefault();
      var w = document.getElementById("cg-word-w").value.trim().toLowerCase();
      var h = document.getElementById("cg-word-h").value.trim();
      if (!w || w.length < 3) {
        showToast("Word must be at least 3 characters", true);
        return;
      }
      cgCustomWords.push({ word: w, hint: h || "Think carefully" });
      socket.emit("chatgames:saveConfig", { customWords: cgCustomWords });
      renderCustomWords(cgCustomWords);
      document.getElementById("cg-word-w").value = "";
      document.getElementById("cg-word-h").value = "";
    });
    function renderCustom8Ball(list) {
      cgCustom8Ball = list || [];
      var container = document.getElementById("cg-custom-8ball-list");
      if (cgCustom8Ball.length === 0) {
        container.innerHTML = '<div class="rules-empty">No custom 8-Ball responses yet.</div>';
        return;
      }
      var html = "";
      for (var i = 0; i < cgCustom8Ball.length; i++) {
        html += '<div class="rule-item rule-enabled"><div class="rule-header"><span class="rule-name">' + escapeHtml(cgCustom8Ball[i]) + '</span><div class="rule-actions"><button class="btn btn-small btn-red cg-8ball-delete" data-index="' + i + '">Delete</button></div></div></div>';
      }
      container.innerHTML = html;
      container.querySelectorAll(".cg-8ball-delete").forEach(function(btn) {
        btn.addEventListener("click", function() {
          var idx = parseInt(btn.dataset.index);
          cgCustom8Ball.splice(idx, 1);
          socket.emit("chatgames:saveConfig", { custom8Ball: cgCustom8Ball });
          renderCustom8Ball(cgCustom8Ball);
        });
      });
    }
    document.getElementById("cg-8ball-add-form").addEventListener("submit", function(e) {
      e.preventDefault();
      var text = document.getElementById("cg-8ball-text").value.trim();
      if (!text) {
        showToast("Response text is required", true);
        return;
      }
      cgCustom8Ball.push(text);
      socket.emit("chatgames:saveConfig", { custom8Ball: cgCustom8Ball });
      renderCustom8Ball(cgCustom8Ball);
      document.getElementById("cg-8ball-text").value = "";
    });
    function renderCustomFortunes(list) {
      cgCustomFortunes = list || [];
      var container = document.getElementById("cg-custom-fortunes-list");
      if (cgCustomFortunes.length === 0) {
        container.innerHTML = '<div class="rules-empty">No custom fortunes yet.</div>';
        return;
      }
      var html = "";
      for (var i = 0; i < cgCustomFortunes.length; i++) {
        html += '<div class="rule-item rule-enabled"><div class="rule-header"><span class="rule-name">' + escapeHtml(cgCustomFortunes[i]) + '</span><div class="rule-actions"><button class="btn btn-small btn-red cg-fortune-delete" data-index="' + i + '">Delete</button></div></div></div>';
      }
      container.innerHTML = html;
      container.querySelectorAll(".cg-fortune-delete").forEach(function(btn) {
        btn.addEventListener("click", function() {
          var idx = parseInt(btn.dataset.index);
          cgCustomFortunes.splice(idx, 1);
          socket.emit("chatgames:saveConfig", { customFortunes: cgCustomFortunes });
          renderCustomFortunes(cgCustomFortunes);
        });
      });
    }
    document.getElementById("cg-fortunes-add-form").addEventListener("submit", function(e) {
      e.preventDefault();
      var text = document.getElementById("cg-fortune-text").value.trim();
      if (!text) {
        showToast("Fortune text is required", true);
        return;
      }
      cgCustomFortunes.push(text);
      socket.emit("chatgames:saveConfig", { customFortunes: cgCustomFortunes });
      renderCustomFortunes(cgCustomFortunes);
      document.getElementById("cg-fortune-text").value = "";
    });
    function renderHostStatus(status) {
      var container = document.getElementById("cg-host-status");
      var startBtn = document.getElementById("cg-host-start");
      var stopBtn = document.getElementById("cg-host-stop");
      var skipBtn = document.getElementById("cg-host-skip");
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
      var html = '<div class="rule-item rule-enabled"><div class="rule-header"><span class="rule-name">Game Show: ' + escapeHtml(status.gameType) + '</span><span class="cg-game-badge">Round ' + status.currentRound + "/" + status.totalRounds + '</span></div><div class="rule-details"><span class="rule-types">Host: ' + escapeHtml(status.hostPlayer || "Panel") + '</span><span class="rule-pattern">' + (status.questionActive ? "Waiting for answer..." : "Between rounds") + "</span></div>";
      if (status.leaderboard && status.leaderboard.length > 0) {
        html += '<div class="rule-details" style="margin-top:0.25rem;">';
        for (var i = 0; i < Math.min(status.leaderboard.length, 5); i++) {
          var entry = status.leaderboard[i];
          html += '<span class="rule-types" style="margin-right:0.75rem;">' + (i + 1) + ". " + escapeHtml(entry.name) + ": " + entry.points + "pt</span>";
        }
        html += "</div>";
      }
      html += "</div>";
      container.innerHTML = html;
    }
    socket.on("chatgames:hostUpdate", function(status) {
      renderHostStatus(status);
    });
    document.getElementById("cg-host-start").addEventListener("click", function() {
      var gameType = document.getElementById("cg-host-type").value;
      var rounds = parseInt(document.getElementById("cg-host-rounds").value) || 5;
      socket.emit("chatgames:hostStart", { gameType, rounds });
    });
    document.getElementById("cg-host-stop").addEventListener("click", function() {
      socket.emit("chatgames:hostStop");
    });
    document.getElementById("cg-host-skip").addEventListener("click", function() {
      socket.emit("chatgames:hostSkip");
    });
    function renderBjStatus(status) {
      var container = document.getElementById("cg-bj-status");
      var openBtn = document.getElementById("cg-bj-open");
      var forceBtn = document.getElementById("cg-bj-force");
      var stopBtn = document.getElementById("cg-bj-stop");
      if (!status || !status.active) {
        container.innerHTML = '<div class="rules-empty">No group blackjack running.</div>';
        openBtn.disabled = false;
        forceBtn.disabled = true;
        stopBtn.disabled = true;
        return;
      }
      openBtn.disabled = true;
      forceBtn.disabled = status.phase !== "lobby";
      stopBtn.disabled = false;
      var html = '<div class="rule-item rule-enabled"><div class="rule-header"><span class="rule-name">Group Blackjack</span><span class="cg-game-badge">' + escapeHtml(status.phase) + '</span></div><div class="rule-details"><span class="rule-types">Players: ' + (status.seats ? status.seats.length : 0) + '</span><span class="rule-pattern">Hand ' + (status.handNumber || 0) + "/" + (status.maxHands || 0) + "</span></div></div>";
      container.innerHTML = html;
    }
    socket.on("chatgames:bjUpdate", function(status) {
      renderBjStatus(status);
    });
    document.getElementById("cg-bj-open").addEventListener("click", function() {
      var rounds = parseInt(document.getElementById("cg-bj-rounds").value) || 5;
      socket.emit("chatgames:bjStart", { rounds });
    });
    document.getElementById("cg-bj-force").addEventListener("click", function() {
      socket.emit("chatgames:bjForceStart");
    });
    document.getElementById("cg-bj-stop").addEventListener("click", function() {
      socket.emit("chatgames:bjStop");
    });
    var activeLbFilter = "";
    function renderLeaderboard(board) {
      var tbody = document.getElementById("cg-lb-tbody");
      var showStreak = activeLbFilter === "";
      var streakCol = document.getElementById("lb-streak-col");
      if (streakCol) streakCol.style.display = showStreak ? "" : "none";
      var cols = showStreak ? 6 : 5;
      if (!board || board.length === 0) {
        tbody.innerHTML = '<tr><td colspan="' + cols + '" class="lb-empty">No games played yet.</td></tr>';
        return;
      }
      var html = "";
      board.forEach(function(p, i) {
        var rank = i + 1;
        var medalClass = rank <= 3 ? " lb-rank-" + rank : "";
        html += '<tr><td class="lb-rank' + medalClass + '">' + rank + '</td><td class="lb-name">' + escapeHtml(p.name) + '</td><td class="lb-wins">' + p.wins + "</td><td>" + p.played + "</td><td>" + (p.winRate || 0) + "%</td>" + (showStreak ? "<td>" + (p.bestStreak || 0) + "</td>" : "") + "</tr>";
      });
      tbody.innerHTML = html;
    }
    document.querySelectorAll("#lb-filter-tabs .lb-filter-tab").forEach(function(tab) {
      tab.addEventListener("click", function() {
        document.querySelectorAll("#lb-filter-tabs .lb-filter-tab").forEach(function(t) {
          t.classList.remove("active");
        });
        tab.classList.add("active");
        activeLbFilter = tab.dataset.game || "";
        var clearGameBtn = document.getElementById("cg-lb-clear-game");
        if (activeLbFilter) {
          clearGameBtn.style.display = "";
          clearGameBtn.textContent = "Reset " + (tab.textContent || activeLbFilter);
          socket.emit("chatgames:getLeaderboardByGame", activeLbFilter);
        } else {
          clearGameBtn.style.display = "none";
          socket.emit("chatgames:getLeaderboard");
        }
      });
    });
    socket.on("chatgames:leaderboard", function(board) {
      if (activeLbFilter === "") {
        renderLeaderboard(board);
      }
    });
    socket.on("chatgames:leaderboardByGame", function(board) {
      if (activeLbFilter !== "") {
        renderLeaderboard(board);
      }
    });
    document.querySelectorAll("#cg-tabs .cg-tab").forEach(function(tab) {
      tab.addEventListener("click", function() {
        if (tab.dataset.cgTab === "leaderboard") {
          if (activeLbFilter) {
            socket.emit("chatgames:getLeaderboardByGame", activeLbFilter);
          } else {
            socket.emit("chatgames:getLeaderboard");
          }
        }
      });
    });
    document.getElementById("cg-lb-clear").addEventListener("click", function() {
      if (confirm("Clear all leaderboard data? This cannot be undone.")) {
        socket.emit("chatgames:clearLeaderboard");
      }
    });
    document.getElementById("cg-lb-clear-game").addEventListener("click", function() {
      if (!activeLbFilter) return;
      if (confirm("Clear all " + activeLbFilter.toUpperCase() + " leaderboard data? This cannot be undone.")) {
        socket.emit("chatgames:clearLeaderboardByGame", activeLbFilter);
      }
    });
  }

  // src/panel/modules/scheduled-ui.ts
  function createScheduledUi(deps) {
    var socket = deps.socket;
    var showToast = deps.showToast;
    var schedules = [];
    var schedActiveBot = "all";
    function getBotLabel(botId) {
      var botStates = deps.getBotStates();
      if (!botId || botId === "primary") return "Primary Bot";
      if (botStates[botId] && botStates[botId].username) return botStates[botId].username;
      return botId;
    }
    function renderSchedBotTabs() {
      var tabBar = document.getElementById("sched-bot-tabs");
      var botIds = {};
      schedules.forEach(function(s) {
        var bid = s.botId || "primary";
        botIds[bid] = true;
      });
      var html = '<button class="sched-bot-tab' + (schedActiveBot === "all" ? " active" : "") + '" data-sched-bot="all">All</button>';
      Object.keys(botIds).forEach(function(bid) {
        html += '<button class="sched-bot-tab' + (schedActiveBot === bid ? " active" : "") + '" data-sched-bot="' + escapeHtml(bid) + '">' + escapeHtml(getBotLabel(bid)) + "</button>";
      });
      tabBar.innerHTML = html;
    }
    function renderScheduleList(list) {
      schedules = list || [];
      var container = document.getElementById("sched-list");
      renderSchedBotTabs();
      var filtered = schedActiveBot === "all" ? schedules : schedules.filter(function(s) {
        return (s.botId || "primary") === schedActiveBot;
      });
      if (filtered.length === 0) {
        container.innerHTML = '<div class="rules-empty">No schedules' + (schedActiveBot !== "all" ? " for this bot" : " configured") + ".</div>";
        return;
      }
      var html = "";
      filtered.forEach(function(s) {
        var typeLabel = s.type === "interval" ? "Every " + s.interval + " min" : s.type === "daily" ? "Daily at " + s.dailyTime : "Once at " + new Date(s.onetimeAt).toLocaleString();
        var msgTypeLabel = s.messageType === "whisper" ? "Whisper to " + escapeHtml(s.whisperTarget || "?") : "Say";
        var firedHtml = "";
        if (s.lastFired) {
          var icon = s.lastSuccess ? '<span class="sched-status-icon sched-ok" title="Succeeded">&#x2713;</span>' : '<span class="sched-status-icon sched-fail" title="Failed (bot offline)">&#x26D4;</span>';
          firedHtml = '<span class="sched-last-fired">' + icon + " Last fired " + formatFiredAgo(s.lastFired) + "</span>";
        }
        var countdownHtml = "";
        if (s.enabled && s.nextFireAt) {
          var remaining = s.nextFireAt - Date.now();
          countdownHtml = '<span class="sched-countdown" data-next-fire="' + s.nextFireAt + '">Next: ' + formatCountdown(remaining) + "</span>";
        }
        html += '<div class="rule-item sched-item' + (s.enabled ? "" : " sched-disabled") + '" data-id="' + escapeHtml(s.id) + '"><div class="rule-header"><span class="rule-name">' + escapeHtml(s.name || "Unnamed") + '</span><div class="rule-actions"><button class="btn btn-small sched-btn-fire" data-id="' + escapeHtml(s.id) + '" title="Fire now">Fire</button><button class="btn btn-small sched-btn-edit" data-id="' + escapeHtml(s.id) + '">Edit</button><button class="btn btn-small ' + (s.enabled ? "btn-yellow sched-btn-disable" : "btn-green sched-btn-enable") + '" data-id="' + escapeHtml(s.id) + '">' + (s.enabled ? "Disable" : "Enable") + '</button><button class="btn btn-small btn-red sched-btn-delete" data-id="' + escapeHtml(s.id) + '">Del</button></div></div><div class="rule-details"><span class="rule-types">' + typeLabel + " | " + msgTypeLabel + '</span><span class="rule-pattern">' + escapeHtml(s.message || "").substring(0, 60) + (s.message && s.message.length > 60 ? "..." : "") + "</span>" + firedHtml + countdownHtml + "</div></div>";
      });
      container.innerHTML = html;
    }
    setInterval(function() {
      var els = document.querySelectorAll(".sched-countdown[data-next-fire]");
      els.forEach(function(el) {
        var nextFire = parseInt(el.dataset.nextFire);
        if (!nextFire) return;
        var remaining = nextFire - Date.now();
        el.textContent = "Next: " + formatCountdown(remaining);
      });
    }, 1e3);
    document.getElementById("sched-bot-tabs").addEventListener("click", function(e) {
      var tab = e.target.closest(".sched-bot-tab");
      if (!tab) return;
      schedActiveBot = tab.dataset.schedBot;
      renderScheduleList(schedules);
    });
    socket.on("scheduled:list", function(list) {
      renderScheduleList(list);
      var select = document.getElementById("sched-bot");
      var currentVal = select.value;
      var html = '<option value="primary">Primary Bot</option>';
      var botStates = deps.getBotStates();
      Object.keys(botStates).forEach(function(id) {
        html += '<option value="' + escapeHtml(id) + '">' + escapeHtml(botStates[id].username || id) + "</option>";
      });
      select.innerHTML = html;
      if (currentVal && select.querySelector('option[value="' + currentVal + '"]')) select.value = currentVal;
    });
    socket.on("scheduled:fired", function(data) {
      var label = data.success ? "fired" : "FAILED";
      showToast("Schedule " + label + ": " + data.name, !data.success);
    });
    document.getElementById("sched-type").addEventListener("change", function() {
      var t = this.value;
      document.getElementById("sched-interval-cfg").style.display = t === "interval" ? "" : "none";
      document.getElementById("sched-daily-cfg").style.display = t === "daily" ? "" : "none";
      document.getElementById("sched-onetime-cfg").style.display = t === "onetime" ? "" : "none";
    });
    document.getElementById("sched-msg-type").addEventListener("change", function() {
      document.getElementById("sched-target-cfg").style.display = this.value === "whisper" ? "" : "none";
    });
    document.getElementById("sched-form").addEventListener("submit", function(e) {
      e.preventDefault();
      var sched = {
        id: document.getElementById("sched-id").value || "",
        name: document.getElementById("sched-name").value.trim(),
        enabled: true,
        type: document.getElementById("sched-type").value,
        interval: parseInt(document.getElementById("sched-interval").value) || 30,
        dailyTime: document.getElementById("sched-daily-time").value || "08:00",
        onetimeAt: document.getElementById("sched-onetime-at").value || null,
        message: document.getElementById("sched-message").value.trim(),
        botId: document.getElementById("sched-bot").value,
        messageType: document.getElementById("sched-msg-type").value,
        whisperTarget: document.getElementById("sched-whisper-target").value.trim()
      };
      if (!sched.name || !sched.message) {
        showToast("Name and message are required", true);
        return;
      }
      for (var i = 0; i < schedules.length; i++) {
        if (schedules[i].id === sched.id) {
          sched.enabled = schedules[i].enabled;
          break;
        }
      }
      socket.emit("scheduled:save", sched);
      clearSchedForm();
    });
    document.getElementById("sched-form-clear").addEventListener("click", clearSchedForm);
    function clearSchedForm() {
      document.getElementById("sched-id").value = "";
      document.getElementById("sched-name").value = "";
      document.getElementById("sched-message").value = "";
      document.getElementById("sched-whisper-target").value = "";
      document.getElementById("sched-form-title").textContent = "Add Schedule";
      document.getElementById("sched-form-fold").removeAttribute("open");
      document.getElementById("sched-type").value = "interval";
      document.getElementById("sched-interval").value = "30";
      document.getElementById("sched-daily-time").value = "08:00";
      document.getElementById("sched-onetime-at").value = "";
      document.getElementById("sched-interval-cfg").style.display = "";
      document.getElementById("sched-daily-cfg").style.display = "none";
      document.getElementById("sched-onetime-cfg").style.display = "none";
      document.getElementById("sched-msg-type").value = "say";
      document.getElementById("sched-target-cfg").style.display = "none";
    }
    document.getElementById("sched-list").addEventListener("click", function(e) {
      var btn = e.target.closest("button[data-id]");
      if (!btn) return;
      var id = btn.dataset.id;
      if (btn.classList.contains("sched-btn-delete")) {
        if (confirm("Delete this schedule?")) socket.emit("scheduled:delete", { id });
      } else if (btn.classList.contains("sched-btn-enable")) {
        socket.emit("scheduled:toggle", { id, enabled: true });
      } else if (btn.classList.contains("sched-btn-disable")) {
        socket.emit("scheduled:toggle", { id, enabled: false });
      } else if (btn.classList.contains("sched-btn-fire")) {
        socket.emit("scheduled:fireNow", { id });
      } else if (btn.classList.contains("sched-btn-edit")) {
        var sched = null;
        for (var i = 0; i < schedules.length; i++) {
          if (schedules[i].id === id) {
            sched = schedules[i];
            break;
          }
        }
        if (!sched) return;
        document.getElementById("sched-id").value = sched.id;
        document.getElementById("sched-name").value = sched.name || "";
        document.getElementById("sched-type").value = sched.type || "interval";
        document.getElementById("sched-type").dispatchEvent(new Event("change"));
        document.getElementById("sched-interval").value = sched.interval || 30;
        document.getElementById("sched-daily-time").value = sched.dailyTime || "08:00";
        document.getElementById("sched-onetime-at").value = sched.onetimeAt || "";
        document.getElementById("sched-message").value = sched.message || "";
        document.getElementById("sched-bot").value = sched.botId || "primary";
        document.getElementById("sched-msg-type").value = sched.messageType || "say";
        document.getElementById("sched-msg-type").dispatchEvent(new Event("change"));
        document.getElementById("sched-whisper-target").value = sched.whisperTarget || "";
        document.getElementById("sched-form-title").textContent = "Edit Schedule";
        document.getElementById("sched-form-fold").setAttribute("open", "");
      }
    });
    var currentUserList = [];
    var userlistSearchEl = document.getElementById("userlist-search");
    var userlistContainer = document.getElementById("userlist-container");
    var userlistTimestamp = document.getElementById("userlist-timestamp");
    var onlineCountBadge = document.getElementById("online-count");
    var userlistRefreshBtn = document.getElementById("userlist-refresh");
    function renderUserList(users, filter) {
      if (!users || users.length === 0) {
        userlistContainer.innerHTML = '<div class="notif-empty">No user list data yet. Data refreshes every 5 minutes.</div>';
        onlineCountBadge.style.display = "none";
        return;
      }
      var filtered = users;
      if (filter) {
        var f = filter.toLowerCase();
        filtered = users.filter(function(u2) {
          return u2.name.toLowerCase().indexOf(f) !== -1 || u2.className.toLowerCase().indexOf(f) !== -1 || u2.title && u2.title.toLowerCase().indexOf(f) !== -1;
        });
      }
      onlineCountBadge.textContent = users.length;
      onlineCountBadge.style.display = "";
      var html = '<table class="userlist-table"><thead><tr><th>Name</th><th>Class</th><th>Title</th></tr></thead><tbody>';
      for (var i = 0; i < filtered.length; i++) {
        var u = filtered[i];
        var nameClass = u.isMaster ? "userlist-name userlist-master" : "userlist-name";
        html += '<tr><td class="' + nameClass + '">' + escapeHtml(u.name) + '</td><td class="userlist-class">' + escapeHtml(u.className) + '</td><td class="userlist-title">' + escapeHtml(u.title || "") + "</td></tr>";
      }
      html += "</tbody></table>";
      userlistContainer.innerHTML = html;
    }
    socket.on("userlist:update", function(data) {
      if (data && data.users) {
        currentUserList = data.users;
        renderUserList(currentUserList, userlistSearchEl ? userlistSearchEl.value : "");
        if (data.timestamp) {
          userlistTimestamp.textContent = "Last updated: " + new Date(data.timestamp).toLocaleTimeString();
        }
      }
    });
    if (userlistSearchEl) {
      userlistSearchEl.addEventListener("input", function() {
        renderUserList(currentUserList, userlistSearchEl.value);
      });
    }
    if (userlistRefreshBtn) {
      userlistRefreshBtn.addEventListener("click", function() {
        socket.emit("userlist:refresh");
      });
    }
    socket.emit("userlist:get");
  }

  // src/panel/modules/players-ui.ts
  function createPlayersUi(deps) {
    var socket = deps.socket;
    var navLinks = deps.navLinks;
    var showToast = deps.showToast;
    var resetAppearancesBtn = document.getElementById("btn-reset-appearances");
    if (resetAppearancesBtn) {
      resetAppearancesBtn.addEventListener("click", function() {
        if (!confirm("Reset all player appearances?\n\nThis clears stored looks and sprite cache. New appearances will be collected automatically.")) return;
        socket.emit("players:resetAppearances");
      });
    }
    var wipeBtn = document.getElementById("btn-wipe-player-data");
    if (wipeBtn) {
      wipeBtn.addEventListener("click", function() {
        if (!confirm("Are you sure you want to wipe ALL player data?\n\nThis will delete all sightings, player profiles, legend marks, and chat logs.\n\nThis cannot be undone.")) return;
        if (!confirm("Really? This deletes everything. Last chance.")) return;
        socket.emit("players:wipeAll");
      });
    }
    var playersListView = document.getElementById("players-list-view");
    var playersDetailView = document.getElementById("players-detail-view");
    var playersSearch = document.getElementById("players-search");
    var playersClassFilter = document.getElementById("players-class-filter");
    var playersSort = document.getElementById("players-sort");
    var playersRefreshBtn = document.getElementById("players-refresh");
    var playersTableContainer = document.getElementById("players-table-container");
    var playersCountEl = document.getElementById("players-count");
    var playersBackBtn = document.getElementById("players-back-btn");
    var allPlayersData = [];
    function flattenSessions(players) {
      var rows = [];
      for (var i = 0; i < players.length; i++) {
        var p = players[i];
        var sessions = p.sessions || [];
        if (sessions.length === 0) {
          rows.push({
            name: p.name,
            className: p.className,
            title: p.title,
            isMaster: p.isMaster,
            appeared: p.firstSeen || null,
            disappeared: p.lastSeen || null,
            isOnline: false
          });
        } else {
          for (var j = 0; j < sessions.length; j++) {
            var s = sessions[j];
            rows.push({
              name: p.name,
              className: p.className,
              title: p.title,
              isMaster: p.isMaster,
              appeared: s.appeared,
              disappeared: s.disappeared,
              isOnline: !s.disappeared
            });
          }
        }
      }
      return rows;
    }
    var playersPage = 0;
    var PLAYERS_PER_PAGE = 100;
    function renderPlayersTable(players) {
      var search = playersSearch ? playersSearch.value.toLowerCase() : "";
      var classFilter = playersClassFilter ? playersClassFilter.value : "";
      var sortBy = playersSort ? playersSort.value : "appeared";
      var filtered = [];
      for (var i = 0; i < players.length; i++) {
        var p = players[i];
        if (classFilter && (p.className || "").indexOf(classFilter) === -1) continue;
        if (search) {
          var matchesSearch = p.name.toLowerCase().indexOf(search) !== -1 || (p.className || "").toLowerCase().indexOf(search) !== -1 || p.title && p.title.toLowerCase().indexOf(search) !== -1;
          if (!matchesSearch) continue;
        }
        var sessions = p.sessions || [];
        var lastSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;
        var isOnline = lastSession && !lastSession.disappeared;
        filtered.push({
          name: p.name,
          className: p.className,
          title: p.title,
          isMaster: p.isMaster,
          appeared: lastSession ? lastSession.appeared : p.firstSeen || null,
          disappeared: lastSession ? lastSession.disappeared : p.lastSeen || null,
          isOnline,
          sessionCount: sessions.length,
          hp: p.hp || null,
          mp: p.mp || null
        });
      }
      filtered.sort(function(a, b) {
        if (sortBy === "name") return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        if (sortBy === "disappeared") {
          if (!a.disappeared && !b.disappeared) return new Date(b.appeared || 0).getTime() - new Date(a.appeared || 0).getTime();
          if (!a.disappeared) return -1;
          if (!b.disappeared) return 1;
          return new Date(b.disappeared).getTime() - new Date(a.disappeared).getTime();
        }
        return new Date(b.appeared || 0).getTime() - new Date(a.appeared || 0).getTime();
      });
      var totalPages = Math.ceil(filtered.length / PLAYERS_PER_PAGE) || 1;
      if (playersPage >= totalPages) playersPage = totalPages - 1;
      if (playersPage < 0) playersPage = 0;
      var start = playersPage * PLAYERS_PER_PAGE;
      var pageItems = filtered.slice(start, start + PLAYERS_PER_PAGE);
      if (playersCountEl) {
        playersCountEl.textContent = filtered.length + " players" + (totalPages > 1 ? " (page " + (playersPage + 1) + "/" + totalPages + ")" : "");
      }
      if (pageItems.length === 0) {
        playersTableContainer.innerHTML = '<div class="rules-empty">No players found.</div>';
        return;
      }
      var html = '<table class="players-table"><thead><tr><th>Name</th><th>Class</th><th>Title</th><th>HP / MP</th><th>Last Seen</th><th>Status</th></tr></thead><tbody>';
      for (var j = 0; j < pageItems.length; j++) {
        var r = pageItems[j];
        var nameClass = "player-name-cell" + (r.isMaster ? " is-master" : "");
        var lastSeen = r.appeared ? formatDateTime(new Date(r.appeared)) : "--";
        var status = r.isOnline ? '<span style="color:#4caf50;font-weight:bold;">Online</span>' : r.disappeared ? formatDateTime(new Date(r.disappeared)) : "--";
        var hpmp = "";
        if (r.hp || r.mp) {
          hpmp = (r.hp ? '<span class="stat-hp">' + r.hp.toLocaleString() + "</span>" : "") + (r.hp && r.mp ? " / " : "") + (r.mp ? '<span class="stat-mp">' + r.mp.toLocaleString() + "</span>" : "");
        }
        html += '<tr data-player-name="' + escapeHtml(r.name) + '"><td class="' + nameClass + '">' + escapeHtml(r.name) + '</td><td class="player-class-cell">' + escapeHtml(r.className || "--") + '</td><td class="player-title-cell">' + escapeHtml(r.title || "") + '</td><td class="player-seen-cell">' + hpmp + '</td><td class="player-seen-cell">' + lastSeen + '</td><td class="player-seen-cell">' + status + "</td></tr>";
      }
      html += "</tbody></table>";
      if (totalPages > 1) {
        html += '<div class="players-pagination"><button class="btn btn-small players-page-prev"' + (playersPage === 0 ? " disabled" : "") + '>&laquo; Prev</button><span class="players-page-info">Page ' + (playersPage + 1) + " of " + totalPages + '</span><button class="btn btn-small players-page-next"' + (playersPage >= totalPages - 1 ? " disabled" : "") + ">Next &raquo;</button></div>";
      }
      playersTableContainer.innerHTML = html;
      playersTableContainer.onclick = function(e) {
        var row = e.target.closest("tr[data-player-name]");
        if (row) showPlayerDetail(row.getAttribute("data-player-name"));
        var prevBtn = e.target.closest(".players-page-prev");
        if (prevBtn && playersPage > 0) {
          playersPage--;
          renderPlayersTable(allPlayersData);
        }
        var nextBtn = e.target.closest(".players-page-next");
        if (nextBtn && playersPage < totalPages - 1) {
          playersPage++;
          renderPlayersTable(allPlayersData);
        }
      };
    }
    function showPlayerDetail(name) {
      playersListView.style.display = "none";
      playersDetailView.style.display = "";
      socket.emit("players:getDetail", { name });
    }
    function showPlayersList() {
      playersDetailView.style.display = "none";
      playersListView.style.display = "";
    }
    socket.on("players:list", function(players) {
      allPlayersData = players || [];
      renderPlayersTable(allPlayersData);
    });
    socket.on("players:detail", function(detail) {
      if (!detail) return;
      renderPlayerDetail(detail);
    });
    function renderPlayerDetail(d) {
      var headerEl = document.getElementById("player-detail-header");
      var nameClass = d.isMaster ? "player-detail-name is-master" : "player-detail-name";
      var firstSeen = d.firstSeen ? new Date(d.firstSeen).toLocaleString() : "Unknown";
      var lastSeen = d.lastSeen ? new Date(d.lastSeen).toLocaleString() : "Unknown";
      headerEl.innerHTML = '<div class="' + nameClass + '">' + escapeHtml(d.name) + '</div><div class="player-detail-meta"><div class="player-detail-meta-item"><label>Class</label><span>' + escapeHtml(d.className || "Unknown") + '</span></div><div class="player-detail-meta-item"><label>Title</label><span>' + escapeHtml(d.title || "None") + '</span></div><div class="player-detail-meta-item"><label>First Seen</label><span>' + firstSeen + '</span></div><div class="player-detail-meta-item"><label>Last Seen</label><span>' + lastSeen + '</span></div><div class="player-detail-meta-item"><label>Total Sightings</label><span>' + (d.sightingCount || 0) + '</span></div><div class="player-detail-meta-item"><label>User List Appearances</label><span>' + (d.userListSightings ? d.userListSightings.length : 0) + "</span></div></div>";
      var activityEl = document.getElementById("player-activity-list");
      var events = [];
      if (d.sightings && d.sightings.length) {
        for (var i = 0; i < d.sightings.length; i++) {
          events.push({ time: d.sightings[i], type: "sighting", label: "Seen near bot" });
        }
      }
      if (d.userListSightings && d.userListSightings.length) {
        for (var j = 0; j < d.userListSightings.length; j++) {
          events.push({ time: d.userListSightings[j], type: "userlist", label: "On user list" });
        }
      }
      events.sort(function(a, b) {
        return new Date(b.time).getTime() - new Date(a.time).getTime();
      });
      events = events.slice(0, 200);
      if (events.length === 0) {
        activityEl.innerHTML = '<div class="rules-empty">No activity recorded.</div>';
      } else {
        var html = "";
        for (var k = 0; k < events.length; k++) {
          var ev = events[k];
          html += '<div class="player-activity-item"><span class="player-activity-time">' + new Date(ev.time).toLocaleString() + '</span><span class="player-activity-label ' + ev.type + '">' + ev.label + "</span></div>";
        }
        activityEl.innerHTML = html;
      }
      var chatLogsEl = document.getElementById("player-chat-logs");
      if (d.chatLogs && d.chatLogs.length > 0) {
        var logHtml = "";
        for (var l = 0; l < d.chatLogs.length; l++) {
          logHtml += '<div class="log-line">' + escapeHtml(d.chatLogs[l]) + "</div>";
        }
        chatLogsEl.innerHTML = logHtml;
        chatLogsEl.scrollTop = chatLogsEl.scrollHeight;
      } else {
        chatLogsEl.innerHTML = '<div class="rules-empty">No chat logs for this player.</div>';
      }
      var ulHistEl = document.getElementById("player-userlist-history");
      if (d.userListSightings && d.userListSightings.length > 0) {
        var ulHtml = "";
        var ulSightings = d.userListSightings.slice(-100).reverse();
        for (var m = 0; m < ulSightings.length; m++) {
          ulHtml += '<div class="player-activity-item"><span class="player-activity-time">' + new Date(ulSightings[m]).toLocaleString() + '</span><span class="player-activity-label userlist">Appeared on user list</span></div>';
        }
        ulHistEl.innerHTML = ulHtml;
      } else {
        ulHistEl.innerHTML = '<div class="rules-empty">No user list history for this player.</div>';
      }
      var legendsEl = document.getElementById("player-legends-list");
      if (d.legends && d.legends.length > 0) {
        var legendHtml = "";
        if (d.lastLegendUpdate) {
          legendHtml += '<div class="legend-updated">Last updated: ' + new Date(d.lastLegendUpdate).toLocaleString() + "</div>";
        }
        if (d.groupName) {
          legendHtml += '<div class="legend-profile-info"><label>Group</label><span>' + escapeHtml(d.groupName) + "</span></div>";
        }
        legendHtml += '<div class="legend-marks-container">';
        for (var li = 0; li < d.legends.length; li++) {
          var leg = d.legends[li];
          var colorClass = leg.color > 0 ? " legend-color-" + leg.color : "";
          legendHtml += '<div class="legend-mark-item"><span class="legend-mark-icon" title="Icon ' + leg.icon + '"></span><span class="legend-mark-key">' + escapeHtml(leg.key) + '</span><span class="legend-mark-text' + colorClass + '">' + escapeHtml(leg.text) + "</span></div>";
        }
        legendHtml += "</div>";
        if (d.legendHistory && d.legendHistory.length > 0) {
          legendHtml += '<div class="legend-history-section"><div class="legend-history-header">Legend History (' + d.legendHistory.length + " snapshots)</div>";
          for (var lh = d.legendHistory.length - 1; lh >= 0; lh--) {
            var snap = d.legendHistory[lh];
            legendHtml += '<div class="legend-history-snapshot"><div class="legend-history-time">' + new Date(snap.timestamp).toLocaleString() + " (" + snap.legends.length + ' marks)</div><div class="legend-history-marks">';
            for (var lhi = 0; lhi < snap.legends.length; lhi++) {
              var sleg = snap.legends[lhi];
              legendHtml += '<div class="legend-mark-item small"><span class="legend-mark-key">' + escapeHtml(sleg.key) + '</span><span class="legend-mark-text">' + escapeHtml(sleg.text) + "</span></div>";
            }
            legendHtml += "</div></div>";
          }
          legendHtml += "</div>";
        }
        legendsEl.innerHTML = legendHtml;
      } else {
        legendsEl.innerHTML = '<div class="rules-empty">No legend marks recorded. Legends are captured when bots see this player on their map.</div>';
      }
    }
    var playerTabs = document.querySelectorAll(".player-tab");
    var playerTabContents = document.querySelectorAll(".player-tab-content");
    for (var pt = 0; pt < playerTabs.length; pt++) {
      playerTabs[pt].addEventListener("click", function() {
        var tabName = this.getAttribute("data-player-tab");
        for (var i = 0; i < playerTabs.length; i++) playerTabs[i].classList.remove("active");
        for (var j = 0; j < playerTabContents.length; j++) playerTabContents[j].classList.remove("active");
        this.classList.add("active");
        var target = document.getElementById("player-tab-" + tabName);
        if (target) target.classList.add("active");
      });
    }
    if (playersBackBtn) {
      playersBackBtn.addEventListener("click", showPlayersList);
    }
    if (playersSearch) {
      playersSearch.addEventListener("input", function() {
        playersPage = 0;
        renderPlayersTable(allPlayersData);
      });
    }
    if (playersClassFilter) {
      playersClassFilter.addEventListener("change", function() {
        playersPage = 0;
        renderPlayersTable(allPlayersData);
      });
    }
    if (playersSort) {
      playersSort.addEventListener("change", function() {
        playersPage = 0;
        renderPlayersTable(allPlayersData);
      });
    }
    if (playersRefreshBtn) {
      playersRefreshBtn.addEventListener("click", function() {
        socket.emit("players:getAll");
      });
    }
    for (var nl = 0; nl < navLinks.length; nl++) {
      if (navLinks[nl].getAttribute("data-panel") === "players") {
        navLinks[nl].addEventListener("click", function() {
          socket.emit("players:getAll");
        });
      }
    }
    var knowledgeEntries = [];
    function renderKnowledgeList(entries) {
      knowledgeEntries = entries || [];
      var container = document.getElementById("kb-list");
      var filterCat = document.getElementById("kb-filter-category").value;
      var countEl = document.getElementById("kb-count");
      var filtered = filterCat ? knowledgeEntries.filter(function(e) {
        return e.category === filterCat;
      }) : knowledgeEntries;
      countEl.textContent = filtered.length + " entr" + (filtered.length === 1 ? "y" : "ies");
      if (filtered.length === 0) {
        container.innerHTML = '<div class="rules-empty">No knowledge entries' + (filterCat ? " in this category" : " yet") + ".</div>";
        return;
      }
      var html = "";
      filtered.forEach(function(entry) {
        html += '<div class="rule-item kb-item" data-id="' + entry.id + '"><div class="rule-header"><span class="rule-name">' + escapeHtml(entry.title) + '</span><div class="rule-actions"><button class="btn btn-small kb-btn-edit" data-id="' + entry.id + '">Edit</button><button class="btn btn-small btn-red kb-btn-delete" data-id="' + entry.id + '">Del</button></div></div><div class="rule-details"><span class="rule-types">' + escapeHtml(entry.category) + '</span><span class="rule-pattern">' + escapeHtml(entry.content).substring(0, 120) + (entry.content.length > 120 ? "..." : "") + "</span></div></div>";
      });
      container.innerHTML = html;
    }
    socket.on("knowledge:list", function(entries) {
      renderKnowledgeList(entries);
    });
    document.getElementById("kb-filter-category").addEventListener("change", function() {
      renderKnowledgeList(knowledgeEntries);
    });
    document.getElementById("kb-form").addEventListener("submit", function(e) {
      e.preventDefault();
      var entry = {
        id: document.getElementById("kb-id").value ? parseInt(document.getElementById("kb-id").value) : null,
        category: document.getElementById("kb-category").value,
        title: document.getElementById("kb-title").value.trim(),
        content: document.getElementById("kb-content").value.trim()
      };
      if (!entry.title || !entry.content) {
        showToast("Title and content are required", true);
        return;
      }
      socket.emit("knowledge:save", entry);
      clearKbForm();
    });
    document.getElementById("kb-form-clear").addEventListener("click", clearKbForm);
    function clearKbForm() {
      document.getElementById("kb-id").value = "";
      document.getElementById("kb-category").value = "items";
      document.getElementById("kb-title").value = "";
      document.getElementById("kb-content").value = "";
      document.getElementById("kb-form-title").textContent = "Add Entry";
      document.getElementById("kb-form-fold").removeAttribute("open");
    }
    document.getElementById("kb-list").addEventListener("click", function(e) {
      var btn = e.target.closest("button[data-id]");
      if (!btn) return;
      var id = parseInt(btn.dataset.id);
      if (btn.classList.contains("kb-btn-delete")) {
        if (confirm("Delete this knowledge entry?")) {
          socket.emit("knowledge:delete", { id });
        }
      } else if (btn.classList.contains("kb-btn-edit")) {
        var entry = null;
        for (var i = 0; i < knowledgeEntries.length; i++) {
          if (knowledgeEntries[i].id === id) {
            entry = knowledgeEntries[i];
            break;
          }
        }
        if (!entry) return;
        document.getElementById("kb-id").value = entry.id;
        document.getElementById("kb-category").value = entry.category;
        document.getElementById("kb-title").value = entry.title;
        document.getElementById("kb-content").value = entry.content;
        document.getElementById("kb-form-title").textContent = "Edit Entry";
        document.getElementById("kb-form-fold").setAttribute("open", "");
      }
    });
    var bulkText = document.getElementById("kb-bulk-text");
    var bulkPreview = document.getElementById("kb-bulk-preview");
    function parseBulkEntries() {
      var raw = bulkText.value.trim();
      if (!raw) return [];
      var blocks = raw.split(/\n\s*\n/);
      var entries = [];
      var category = document.getElementById("kb-bulk-category").value;
      for (var i = 0; i < blocks.length; i++) {
        var lines = blocks[i].trim().split("\n");
        if (lines.length === 0 || !lines[0].trim()) continue;
        var title = lines[0].trim();
        var content = lines.length > 1 ? lines.slice(1).join("\n").trim() : title;
        entries.push({ category, title, content });
      }
      return entries;
    }
    bulkText.addEventListener("input", function() {
      var entries = parseBulkEntries();
      bulkPreview.textContent = entries.length + " entr" + (entries.length === 1 ? "y" : "ies") + " detected";
    });
    document.getElementById("kb-bulk-import-btn").addEventListener("click", function() {
      var entries = parseBulkEntries();
      if (entries.length === 0) {
        showToast("No entries to import", true);
        return;
      }
      if (!confirm("Import " + entries.length + ' entries as "' + entries[0].category + '"?')) return;
      document.getElementById("kb-bulk-import-btn").disabled = true;
      bulkPreview.textContent = "Importing...";
      socket.emit("knowledge:bulk-import", { entries });
    });
    socket.on("knowledge:bulk-import-done", function(data) {
      document.getElementById("kb-bulk-import-btn").disabled = false;
      if (data.error) {
        showToast("Import error: " + data.error, true);
        bulkPreview.textContent = "Error after " + data.count + " entries";
      } else {
        showToast("Imported " + data.count + " entries");
        bulkText.value = "";
        bulkPreview.textContent = "";
      }
    });
    for (var kl = 0; kl < navLinks.length; kl++) {
      if (navLinks[kl].getAttribute("data-panel") === "knowledge") {
        navLinks[kl].addEventListener("click", function() {
          socket.emit("knowledge:list");
        });
      }
    }
  }

  // src/panel/modules/appearance-reference.ts
  var DYE_COLORS = {
    0: { name: "Default", hex: "#808080" },
    1: { name: "Apple", hex: "#cc3333" },
    2: { name: "Carrot", hex: "#ff6600" },
    3: { name: "Yellow", hex: "#ffcc00" },
    4: { name: "Teal", hex: "#339999" },
    5: { name: "Blue", hex: "#3366cc" },
    6: { name: "Violet", hex: "#9933cc" },
    7: { name: "Olive", hex: "#666633" },
    8: { name: "Green", hex: "#339933" },
    9: { name: "Pumpkin", hex: "#cc6600" },
    10: { name: "Brown", hex: "#663300" },
    11: { name: "Gray", hex: "#999999" },
    12: { name: "Navy", hex: "#333366" },
    13: { name: "Tan", hex: "#cc9966" },
    14: { name: "White", hex: "#ffffff" },
    15: { name: "Pink", hex: "#ff66cc" },
    16: { name: "Chartreuse", hex: "#66cc33" },
    17: { name: "Orange", hex: "#ff9933" },
    18: { name: "Light Blonde", hex: "#ffcc99" },
    19: { name: "Midnight", hex: "#1a1a33" },
    20: { name: "Sky", hex: "#66ccff" },
    21: { name: "Mauve", hex: "#cc6699" },
    22: { name: "Orchid", hex: "#cc66cc" },
    23: { name: "BubbleGum", hex: "#ff99cc" },
    24: { name: "LightBlue", hex: "#99ccff" },
    25: { name: "HotPink", hex: "#ff3399" },
    26: { name: "Cyan", hex: "#00cccc" },
    27: { name: "Lilac", hex: "#cc99ff" },
    28: { name: "Salmon", hex: "#ff6666" },
    29: { name: "NeonBlue", hex: "#3399ff" },
    30: { name: "NeonGreen", hex: "#33ff33" },
    31: { name: "PastelGreen", hex: "#99cc99" },
    32: { name: "Blonde", hex: "#ffcc66" },
    33: { name: "RoyalBlue", hex: "#3333cc" },
    34: { name: "Leather", hex: "#996633" },
    35: { name: "Scarlet", hex: "#cc0000" },
    36: { name: "Forest", hex: "#006633" },
    37: { name: "Scarlet2", hex: "#cc0033" },
    38: { name: "YaleBlue", hex: "#003399" },
    39: { name: "Tangerine", hex: "#ff6633" },
    40: { name: "DirtyBlonde", hex: "#cccc66" },
    41: { name: "Sage", hex: "#669966" },
    42: { name: "Grass", hex: "#33cc33" },
    43: { name: "Cobalt", hex: "#0033cc" },
    44: { name: "Blush", hex: "#ff9999" },
    45: { name: "Glitch", hex: "#ff00ff" },
    46: { name: "Aqua", hex: "#00ffcc" },
    47: { name: "Lime", hex: "#99ff33" },
    48: { name: "Purple", hex: "#6633cc" },
    49: { name: "NeonRed", hex: "#ff0033" },
    50: { name: "NeonYellow", hex: "#ffff33" },
    51: { name: "PalePink", hex: "#ffcccc" },
    52: { name: "Peach", hex: "#ffcc99" },
    53: { name: "Crimson", hex: "#990033" },
    54: { name: "Mustard", hex: "#cc9933" },
    55: { name: "Silver", hex: "#cccccc" },
    56: { name: "Fire", hex: "#ff3300" },
    57: { name: "Ice", hex: "#ccffff" },
    58: { name: "Magenta", hex: "#cc33cc" },
    59: { name: "PaleGreen", hex: "#ccffcc" },
    60: { name: "BabyBlue", hex: "#ccccff" },
    61: { name: "Void", hex: "#0a0a0a" },
    62: { name: "GhostBlue", hex: "#99cccc" },
    63: { name: "Mint", hex: "#66ffcc" },
    64: { name: "Fern", hex: "#339966" },
    65: { name: "GhostPink", hex: "#cc9999" },
    66: { name: "Flamingo", hex: "#ff6699" },
    67: { name: "Turquoise", hex: "#33cccc" },
    68: { name: "MatteBlack", hex: "#1a1a1a" },
    69: { name: "Taffy", hex: "#ff66ff" },
    70: { name: "NeonPurple", hex: "#9933ff" }
  };
  var SKIN_COLORS = {
    0: "Default",
    1: "Pale",
    2: "Brown",
    3: "Green",
    4: "Yellow",
    5: "Tan",
    6: "Grey",
    7: "LightBlue",
    8: "Orange",
    9: "Purple"
  };
  function getDyeInfo(colorId) {
    return DYE_COLORS[colorId] || { name: "Dye " + colorId, hex: "#808080" };
  }

  // src/panel/modules/stats-ui.ts
  function createStatsUi(deps) {
    var socket = deps.socket;
    var navLinks = deps.navLinks;
    var statsPlayers = [];
    function renderStatCards(players) {
      var grid = document.getElementById("stats-grid");
      var search = (document.getElementById("stats-search").value || "").toLowerCase();
      var classFilter = document.getElementById("stats-class-filter").value;
      var sortBy = document.getElementById("stats-sort").value;
      var filtered = players.filter(function(p2) {
        if (!p2.appearance) return false;
        if (search && p2.name.toLowerCase().indexOf(search) === -1) return false;
        if (classFilter && (p2.className || "").indexOf(classFilter) === -1) return false;
        return true;
      });
      filtered.sort(function(a2, b) {
        if (sortBy === "name") return a2.name.localeCompare(b.name);
        if (sortBy === "className") return (a2.className || "").localeCompare(b.className || "");
        return new Date(b.lastSeen || 0).getTime() - new Date(a2.lastSeen || 0).getTime();
      });
      document.getElementById("stats-count").textContent = filtered.length + " character" + (filtered.length !== 1 ? "s" : "");
      if (filtered.length === 0) {
        grid.innerHTML = '<div class="rules-empty">No character appearance data matches your filters.</div>';
        return;
      }
      var html = "";
      for (var i = 0; i < filtered.length; i++) {
        var p = filtered[i];
        var a = p.appearance;
        if (a.isMonster) continue;
        var genderIcon = a.gender === "Male" ? "\u2642" : a.gender === "Female" ? "\u2640" : "\u26A5";
        var isOnline = p.sessions && p.sessions.length > 0 && p.sessions[p.sessions.length - 1] && !p.sessions[p.sessions.length - 1].disappeared;
        var onlineDot = isOnline ? '<div class="stat-card-online" title="Online"></div>' : "";
        var spriteVer = p.lastAppearanceUpdate ? "?v=" + new Date(p.lastAppearanceUpdate).getTime() : "";
        var spriteImg = '<img class="stat-card-sprite" src="/api/sprite/' + encodeURIComponent(p.name) + ".png" + spriteVer + `" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="stat-card-sprite-fallback" style="display:none"><span class="gender-icon">` + genderIcon + "</span></div>";
        var hpMpLine = "";
        if (p.hp || p.mp) {
          hpMpLine = '<div class="stat-card-hpmp">' + (p.hp ? '<span class="stat-hp">HP ' + p.hp.toLocaleString() + "</span>" : "") + (p.hp && p.mp ? " / " : "") + (p.mp ? '<span class="stat-mp">MP ' + p.mp.toLocaleString() + "</span>" : "") + "</div>";
        }
        html += '<div class="stat-card" data-stat-player="' + escapeHtml(p.name) + '">' + onlineDot + '<div class="stat-card-sprite-wrap">' + spriteImg + '</div><div class="stat-card-name">' + escapeHtml(p.name) + '</div><div class="stat-card-class">' + escapeHtml(p.className || "Unknown") + (p.title ? " \u2014 " + escapeHtml(p.title) : "") + "</div>" + hpMpLine + "</div>";
      }
      grid.innerHTML = html;
    }
    function showStatDetail(name) {
      var player = null;
      for (var i = 0; i < statsPlayers.length; i++) {
        if (statsPlayers[i].name === name) {
          player = statsPlayers[i];
          break;
        }
      }
      if (!player || !player.appearance) return;
      var a = player.appearance;
      var overlay = document.getElementById("stats-detail-overlay");
      var content = document.getElementById("stats-detail-content");
      var genderIcon = a.gender === "Male" ? "\u2642" : a.gender === "Female" ? "\u2640" : "\u26A5";
      var bodyInfo = "";
      function bodyItem(label, value) {
        return '<div class="detail-body-item"><div class="detail-body-item-label">' + label + '</div><div class="detail-body-item-value">' + value + "</div></div>";
      }
      bodyInfo += bodyItem("Gender", a.gender || "Unknown");
      bodyInfo += bodyItem("Skin", SKIN_COLORS[a.skinColor] || "Default");
      bodyInfo += bodyItem("Hair", getDyeInfo(a.hairColor).name);
      bodyInfo += bodyItem("Head", "#" + (a.headSprite || 0));
      bodyInfo += bodyItem("Face", "#" + (a.faceShape || 0));
      bodyInfo += bodyItem("Body", "#" + (a.bodySprite || 0));
      var equipRows = "";
      function equipRow(slot, spriteId, colorId) {
        var colorInfo = getDyeInfo(colorId || 0);
        var hasColor = colorId && colorId > 0;
        var hasSprite = spriteId && spriteId > 0;
        var colorCell = hasColor ? '<td><div class="detail-equip-color-cell"><span class="equip-color-swatch" style="background:' + colorInfo.hex + '"></span> ' + colorInfo.name + "</div></td>" : '<td style="color:var(--text-muted)">-</td>';
        return '<tr><td class="detail-equip-slot">' + slot + '</td><td class="detail-equip-id">' + (hasSprite ? "#" + spriteId : '<span style="color:var(--text-muted)">None</span>') + "</td>" + colorCell + "</tr>";
      }
      equipRows += equipRow("Armor", a.armorSprite, 0);
      equipRows += equipRow("Arms", a.armsSprite, 0);
      equipRows += equipRow("Weapon", a.weaponSprite, 0);
      equipRows += equipRow("Shield", a.shieldSprite, 0);
      equipRows += equipRow("Boots", a.bootsSprite, a.bootsColor);
      equipRows += equipRow("Overcoat", a.overcoatSprite, a.overcoatColor);
      equipRows += equipRow("Pants", 0, a.pantsColor);
      equipRows += equipRow("Accessory 1", a.acc1Sprite, a.acc1Color);
      equipRows += equipRow("Accessory 2", a.acc2Sprite, a.acc2Color);
      equipRows += equipRow("Accessory 3", a.acc3Sprite, a.acc3Color);
      var lastSeen = player.lastSeen ? new Date(player.lastSeen).toLocaleString() : "Unknown";
      var isOnline = player.sessions && player.sessions.length > 0 && player.sessions[player.sessions.length - 1] && !player.sessions[player.sessions.length - 1].disappeared;
      var statusText = isOnline ? '<span style="color:var(--green-400)">Online</span>' : "Last seen: " + lastSeen;
      content.innerHTML = '<div class="detail-header"><div class="detail-avatar"><img class="detail-sprite" src="/api/sprite/' + encodeURIComponent(player.name) + ".png" + (player.lastAppearanceUpdate ? "?v=" + new Date(player.lastAppearanceUpdate).getTime() : "") + `" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"><span class="gender-icon" style="display:none">` + genderIcon + '</span></div><div><div class="detail-name">' + escapeHtml(player.name) + '</div><div class="detail-class">' + escapeHtml(player.className || "Unknown") + (player.title ? " \u2014 " + escapeHtml(player.title) : "") + "</div>" + (a.groupBox ? '<div class="detail-group">' + escapeHtml(a.groupBox) + "</div>" : "") + '<div class="detail-meta">' + statusText + "</div>" + (player.hp || player.mp ? '<div class="detail-hpmp">' + (player.hp ? '<span class="detail-hp">HP ' + player.hp.toLocaleString() + "</span>" : "") + (player.hp && player.mp ? " &nbsp;/&nbsp; " : "") + (player.mp ? '<span class="detail-mp">MP ' + player.mp.toLocaleString() + "</span>" : "") + (player.lastSenseUpdate ? '<span class="detail-sense-time"> (sensed ' + new Date(player.lastSenseUpdate).toLocaleString() + ")</span>" : "") + "</div>" : "") + '</div></div><div class="detail-body-info">' + bodyInfo + '</div><table class="detail-equip-table"><thead><tr><th>Slot</th><th>Sprite ID</th><th>Color</th></tr></thead><tbody>' + equipRows + "</tbody></table>";
      overlay.style.display = "flex";
    }
    document.getElementById("stats-grid").addEventListener("click", function(e) {
      var card = e.target.closest(".stat-card");
      if (card) showStatDetail(card.dataset.statPlayer);
    });
    document.getElementById("stats-detail-close").addEventListener("click", function() {
      document.getElementById("stats-detail-overlay").style.display = "none";
    });
    document.getElementById("stats-detail-overlay").addEventListener("click", function(e) {
      if (e.target === this) this.style.display = "none";
    });
    document.getElementById("stats-search").addEventListener("input", function() {
      renderStatCards(statsPlayers);
    });
    document.getElementById("stats-class-filter").addEventListener("change", function() {
      renderStatCards(statsPlayers);
    });
    document.getElementById("stats-sort").addEventListener("change", function() {
      renderStatCards(statsPlayers);
    });
    socket.on("players:list", function(players) {
      statsPlayers = players;
      if (document.getElementById("panel-stats").classList.contains("active")) {
        renderStatCards(statsPlayers);
      }
    });
    socket.on("player:appearanceUpdate", function(data) {
      console.log("[AppearanceUpdate] Received update for", data.name);
      for (var i = 0; i < statsPlayers.length; i++) {
        if (statsPlayers[i].name === data.name) {
          statsPlayers[i].appearance = data.appearance;
          statsPlayers[i].lastAppearanceUpdate = data.lastAppearanceUpdate;
          break;
        }
      }
      var ver = "?v=" + new Date(data.lastAppearanceUpdate).getTime();
      var encodedName = encodeURIComponent(data.name);
      var newSrc = "/api/sprite/" + encodedName + ".png" + ver;
      var allImgs = document.querySelectorAll("img.stat-card-sprite, img.detail-sprite");
      for (var j = 0; j < allImgs.length; j++) {
        if (allImgs[j].src.indexOf("/api/sprite/" + encodedName + ".png") !== -1) {
          allImgs[j].src = newSrc;
        }
      }
      var overlay = document.getElementById("stats-detail-overlay");
      if (overlay && overlay.style.display === "flex") {
        var detailName = overlay.querySelector(".detail-name");
        if (detailName && detailName.textContent === data.name) {
          showStatDetail(data.name);
        }
      }
    });
    socket.on("player:senseUpdate", function(data) {
      console.log("[Sense] " + data.name + " HP=" + data.hp + " MP=" + data.mp);
      for (var i = 0; i < statsPlayers.length; i++) {
        if (statsPlayers[i].name === data.name) {
          statsPlayers[i].hp = data.hp;
          statsPlayers[i].mp = data.mp;
          statsPlayers[i].lastSenseUpdate = new Date(data.timestamp).toISOString();
          break;
        }
      }
      if (document.getElementById("panel-stats").classList.contains("active")) {
        renderStatCards(statsPlayers);
      }
      var overlay = document.getElementById("stats-detail-overlay");
      if (overlay && overlay.style.display === "flex") {
        var detailName = overlay.querySelector(".detail-name");
        if (detailName && detailName.textContent === data.name) {
          showStatDetail(data.name);
        }
      }
    });
    for (var sl = 0; sl < navLinks.length; sl++) {
      if (navLinks[sl].getAttribute("data-panel") === "stats") {
        navLinks[sl].addEventListener("click", function() {
          socket.emit("players:getAll");
          renderStatCards(statsPlayers);
        });
      }
    }
  }

  // src/panel/modules/asset-map-ui.ts
  function createAssetMapUi(deps) {
    var navLinks = deps.navLinks;
    var AM_LAYERS = [
      { z: 0, prefix: "g", name: "Accessories 2 (behind body)", field: "acc1/2/3Sprite", palLetter: "c", palNote: "remapped from g", dyeable: true, dyeField: "accColor", archive: "khanm/wad.dat", offset: "X: -27" },
      { z: 1, prefix: "f", name: "Head 3 (behind body)", field: "armorSprite", palLetter: "f", palNote: "", dyeable: false, dyeField: "", archive: "khanm/weh.dat", offset: "\u2014", note: "New armor system only; skipped if headSprite set or overcoat equipped" },
      { z: 2, prefix: "b", name: "Body 1 (base)", field: "bodySprite", palLetter: "b", palNote: "", dyeable: false, dyeField: "", archive: "khanm/wad.dat", offset: "\u2014", note: "Always ID 1" },
      { z: 3, prefix: "l", name: "Boots", field: "bootsSprite", palLetter: "l", palNote: "", dyeable: true, dyeField: "bootsColor", archive: "khanm/wim.dat", offset: "\u2014" },
      { z: 4, prefix: "u", name: "Armor 1 (undergarment)", field: "armorSprite", palLetter: "u", palNote: "", dyeable: false, dyeField: "", archive: "khanm/wtz.dat", offset: "\u2014", note: "Skipped when overcoat is equipped" },
      { z: 5, prefix: "i/e", name: "Armor 2 overlay / Overcoat", field: "armorSprite or overcoatSprite", palLetter: "i or e", palNote: "i=old armor, e=new armor", dyeable: true, dyeField: "overcoatColor", archive: "khanm/wim.dat or khanm/weh.dat", offset: "\u2014", note: "Overcoat replaces armor entirely; IDs 1000+ need offset subtraction (-1000 or -999)" },
      { z: 6, prefix: "a", name: "Arms 1", field: "armsSprite", palLetter: "b", palNote: "remapped from a", dyeable: false, dyeField: "", archive: "khanm/wad.dat", offset: "\u2014" },
      { z: 7, prefix: "o", name: "Faces", field: "faceShape", palLetter: "palm[skinColor]", palNote: "direct lookup, no table", dyeable: false, dyeField: "", archive: "khanm/wns.dat", offset: "\u2014", note: "Uses palm palettes indexed by skinColor; magenta (255,0,255) = transparent" },
      { z: 8, prefix: "s", name: "Shields", field: "shieldSprite", palLetter: "p", palNote: "remapped from s", dyeable: false, dyeField: "", archive: "khanm/wns.dat", offset: "\u2014", note: "Value 255 (0xFF) = no shield sentinel" },
      { z: 9, prefix: "h", name: "Head 2 / Hair", field: "headSprite", palLetter: "h", palNote: "", dyeable: true, dyeField: "hairColor", archive: "khanm/weh.dat", offset: "\u2014" },
      { z: 10, prefix: "c", name: "Accessories 1 (front)", field: "acc1/2/3Sprite", palLetter: "c", palNote: "", dyeable: true, dyeField: "accColor", archive: "khanm/wad.dat", offset: "X: -27", note: "Same IDs as layer 0 (g) but drawn in front" },
      { z: 11, prefix: "w", name: "Weapons 1", field: "weaponSprite", palLetter: "w", palNote: "", dyeable: false, dyeField: "", archive: "khanm/wtz.dat", offset: "X: -27" }
    ];
    var AM_EQUIPMENT = [
      { field: "bodySprite", type: "b", name: "Body", palLetter: "b", archive: "khanm/wad.dat", dyeable: false, dyeField: "\u2014", filePattern: "[g]b001[suffix].epf", notes: "Always ID 1. Values: 16=Male (0x10), 32=Female (0x20), 64=Other (0x40). Gender prefix: m or w." },
      { field: "armorSprite", type: "u/i/e", name: "Armor", palLetter: "u, i, e", archive: "khanm/wtz + khanm/wim + khanm/weh", dyeable: false, dyeField: "\u2014", filePattern: "[g]u[ID][suffix].epf + [g]i/e[ID][suffix].epf", notes: "u = undergarment, i = old overlay, e = new overlay. New armor IDs have me###.epf files. Armor also triggers f (behind-body head) layer." },
      { field: "armsSprite", type: "a", name: "Arms", palLetter: "b (remapped)", archive: "khanm/wad.dat", dyeable: false, dyeField: "\u2014", filePattern: "[g]a[ID][suffix].epf", notes: "Palette letter remaps a \u2192 b." },
      { field: "bootsSprite", type: "l", name: "Boots", palLetter: "l", archive: "khanm/wim.dat", dyeable: true, dyeField: "bootsColor", filePattern: "[g]l[ID][suffix].epf", notes: "" },
      { field: "weaponSprite", type: "w", name: "Weapon", palLetter: "w", archive: "khanm/wtz.dat", dyeable: false, dyeField: "\u2014", filePattern: "[g]w[ID][suffix].epf", notes: "Draw offset X: -27. Also has type p (casting) variant." },
      { field: "shieldSprite", type: "s", name: "Shield", palLetter: "p (remapped)", archive: "khanm/wns.dat", dyeable: false, dyeField: "\u2014", filePattern: "[g]s[ID][suffix].epf", notes: "Palette letter remaps s \u2192 p. Value 255 = no shield." },
      { field: "headSprite", type: "h", name: "Hair/Head", palLetter: "h", archive: "khanm/weh.dat", dyeable: true, dyeField: "hairColor", filePattern: "[g]h[ID][suffix].epf", notes: "When set, suppresses armor head layers (e, f)." },
      { field: "faceShape", type: "o", name: "Face", palLetter: "palm[skinColor]", archive: "khanm/wns.dat", dyeable: false, dyeField: "\u2014", filePattern: "[g]o[ID][suffix].epf", notes: "Direct palm palette lookup (no .tbl). Palette remaps o \u2192 m. Magenta pixels = transparent placeholder." },
      { field: "overcoatSprite", type: "u/i/e", name: "Overcoat", palLetter: "u, i, e", archive: "khanm/wtz + khanm/wim + khanm/weh", dyeable: true, dyeField: "overcoatColor", filePattern: "[g]u/i/e[ID][suffix].epf", notes: "Replaces armor entirely. IDs 1000+ need offset subtraction (-1000 or -999) to find actual EPF." },
      { field: "acc1Sprite", type: "c/g", name: "Accessory 1", palLetter: "c", archive: "khanm/wad.dat", dyeable: true, dyeField: "acc1Color", filePattern: "[g]c[ID][suffix].epf", notes: "Rendered in both front (c, z10) and behind-body (g, z0) layers. Draw offset X: -27." },
      { field: "acc2Sprite", type: "c/g", name: "Accessory 2", palLetter: "c", archive: "khanm/wad.dat", dyeable: true, dyeField: "acc2Color", filePattern: "[g]c[ID][suffix].epf", notes: "Same as acc1Sprite \u2014 separate slot, same file lookup." },
      { field: "acc3Sprite", type: "c/g", name: "Accessory 3", palLetter: "c", archive: "khanm/wad.dat", dyeable: true, dyeField: "acc3Color", filePattern: "[g]c[ID][suffix].epf", notes: "Same as acc1Sprite \u2014 separate slot, same file lookup." }
    ];
    var AM_ARCHIVES = [
      { name: "khanmad.dat", gender: "Male", range: "a\u2013d", types: "Arms 1 (a), Body 1 (b), Accessories 1 (c), (d unused)" },
      { name: "khanmeh.dat", gender: "Male", range: "e\u2013h", types: "Head 1/front (e), Head 3/behind (f), Accessories 2/behind (g), Head 2/hair (h)" },
      { name: "khanmim.dat", gender: "Male", range: "i\u2013m", types: "Armor 2 overlay (i), Arms 2 (j), Boots (l), Body 2 (m)" },
      { name: "khanmns.dat", gender: "Male", range: "n\u2013s", types: "Pants (n), Faces (o), Weapons 2/casting (p), (q/r unused), Shields (s)" },
      { name: "khanmtz.dat", gender: "Male", range: "t\u2013z", types: "Armor 1/undergarment (u), (v/x/y unused), Weapons 1 (w)" },
      { name: "khanwad.dat", gender: "Female", range: "a\u2013d", types: "(same as male)" },
      { name: "khanweh.dat", gender: "Female", range: "e\u2013h", types: "(same as male)" },
      { name: "khanwim.dat", gender: "Female", range: "i\u2013m", types: "(same as male)" },
      { name: "khanwns.dat", gender: "Female", range: "n\u2013s", types: "(same as male)" },
      { name: "khanwtz.dat", gender: "Female", range: "t\u2013z", types: "(same as male)" },
      { name: "khanpal.dat", gender: "Both", range: "\u2014", types: "All palettes: palb, palc, pale, palf, palh, pali, pall, palp, palu, palw, palm0\u2013palm9" }
    ];
    var AM_ANIMATIONS = [
      { suffix: "(none)", desc: "Base / idle frame", frames: "Varies" },
      { suffix: "01", desc: "Walk / Idle", frames: "10: [0]=N idle, [1-4]=N walk, [5]=S idle, [6-9]=S walk" },
      { suffix: "02", desc: "Assail / Attack", frames: "4: [0-1]=N assail, [2-3]=S assail" },
      { suffix: "03", desc: "Emote", frames: "Varies per emote type" },
      { suffix: "04", desc: "Idle Animation", frames: "Varies" },
      { suffix: "b", desc: "Priest Cast", frames: "14: various priest/bard animations" },
      { suffix: "c", desc: "Warrior", frames: "30: two-handed, jump, swipe attacks" },
      { suffix: "d", desc: "Monk", frames: "18: kick, punch, heavy kick" },
      { suffix: "e", desc: "Rogue", frames: "36: stab, double stab, bow, volley" },
      { suffix: "f", desc: "Wizard", frames: "12: wizard cast, summoner cast" }
    ];
    var AM_PAL_REMAP = [
      { from: "a (Arms 1)", to: "b", note: "Arms use body palettes" },
      { from: "g (Accessories 2)", to: "c", note: "Behind-body accessories use front accessory palettes" },
      { from: "j (Arms 2)", to: "c", note: "Secondary arms use accessory palettes" },
      { from: "o (Faces)", to: "palm[skinColor]", note: "Direct palm palette lookup, no table; indexed by skinColor 0-9" },
      { from: "s (Shields)", to: "p", note: "Shields use weapon-casting palettes" }
    ];
    var AM_OVERRIDE_FIELDS = [
      { key: "bodySprite", label: "Body", palHint: "b" },
      { key: "headSprite", label: "Hair/Head", palHint: "h" },
      { key: "faceShape", label: "Face", palHint: "palm" },
      { key: "armorSprite", label: "Armor", palHint: "u/i/e" },
      { key: "armsSprite", label: "Arms", palHint: "b" },
      { key: "bootsSprite", label: "Boots", palHint: "l" },
      { key: "weaponSprite", label: "Weapon", palHint: "w" },
      { key: "shieldSprite", label: "Shield", palHint: "p" },
      { key: "overcoatSprite", label: "Overcoat", palHint: "i/e" },
      { key: "acc1Sprite", label: "Accessory 1", palHint: "c" },
      { key: "acc2Sprite", label: "Accessory 2", palHint: "c" },
      { key: "acc3Sprite", label: "Accessory 3", palHint: "c" },
      { key: "hairColor", label: "Hair Color", palHint: "dye" },
      { key: "skinColor", label: "Skin Color", palHint: "0-9" },
      { key: "bootsColor", label: "Boots Color", palHint: "dye" },
      { key: "overcoatColor", label: "Overcoat Color", palHint: "dye" },
      { key: "acc1Color", label: "Acc1 Color", palHint: "dye" },
      { key: "acc2Color", label: "Acc2 Color", palHint: "dye" },
      { key: "acc3Color", label: "Acc3 Color", palHint: "dye" },
      { key: "pantsColor", label: "Pants Color", palHint: "dye" }
    ];
    function renderAmLayers() {
    }
    function renderAmEquipment() {
    }
    function renderAmArchives() {
    }
    function renderAmPalettes() {
    }
    function renderAmAnimations() {
    }
    function renderAmBody() {
    }
    function renderAmDyes() {
    }
    function renderAmSkin() {
    }
    renderAmLayers = function() {
      var el = document.getElementById("am-layers");
      var html = "<h3>Rendering Layer Order (back \u2192 front)</h3>";
      html += "<p>The sprite renderer composites these layers in order. Layer 0 is drawn first (behind everything), layer 11 is drawn last (on top).</p>";
      html += '<div class="am-layer-stack">';
      for (var i = AM_LAYERS.length - 1; i >= 0; i--) {
        var L = AM_LAYERS[i];
        html += '<div class="am-layer-bar">';
        html += '<span class="am-z">' + L.z + "</span>";
        html += '<span class="am-prefix">' + L.prefix + "</span>";
        html += '<span class="am-name">' + L.name + "</span>";
        if (L.dyeable) html += '<span class="am-dye-tag">dyeable</span>';
        html += '<span class="am-field">' + L.field + "</span>";
        html += "</div>";
      }
      html += "</div>";
      html += "<h4>Detailed Layer Reference</h4>";
      html += '<div style="overflow-x:auto"><table class="am-table"><thead><tr>';
      html += "<th>Z</th><th>Prefix</th><th>Layer</th><th>Appearance Field</th><th>Palette</th><th>Dyeable</th><th>Offset</th><th>Notes</th>";
      html += "</tr></thead><tbody>";
      for (var j = 0; j < AM_LAYERS.length; j++) {
        var R = AM_LAYERS[j];
        html += "<tr><td><code>" + R.z + "</code></td><td><code>" + R.prefix + "</code></td>";
        html += "<td>" + R.name + "</td><td><code>" + R.field + "</code></td>";
        html += "<td><code>" + R.palLetter + "</code>" + (R.palNote ? ' <span class="note">(' + R.palNote + ")</span>" : "") + "</td>";
        html += "<td>" + (R.dyeable ? '<span class="am-dye-tag">Yes</span> <code>' + R.dyeField + "</code>" : "\u2014") + "</td>";
        html += "<td><code>" + R.offset + "</code></td>";
        html += "<td>" + (R.note || "") + "</td></tr>";
      }
      html += "</tbody></table></div>";
      html += "<h4>Key Notes</h4><ul>";
      html += "<li>Accessories render in <strong>both</strong> behind-body (g, z0) and front (c, z10) layers</li>";
      html += "<li>Overcoat replaces armor entirely \u2014 skips u (undergarment) and armor overlay layers</li>";
      html += "<li>New armor system: IDs with <code>me###01.epf</code> files use <code>e/f</code> prefixes instead of <code>i</code></li>";
      html += '<li>Shield value <code>255</code> (0xFF) is a sentinel for "no shield"</li>';
      html += "<li>Overcoat IDs 1000+ need offset subtraction (try -1000, then -999) to locate the actual EPF file</li>";
      html += "<li>Renderer uses walk suffix <code>01</code> frame 5 (south idle) for display, falls back to assail suffix <code>02</code> frame 2</li>";
      html += "</ul>";
      el.innerHTML = html;
    };
    renderAmEquipment = function() {
      var el = document.getElementById("am-equipment");
      var html = "<h3>Equipment Slot Mapping</h3>";
      html += "<p>Maps each <code>appearance</code> field (from 0x33 ShowUser packets) to ChaosAssetManager type letters, archive files, and rendering details.</p>";
      html += '<div style="overflow-x:auto"><table class="am-table"><thead><tr>';
      html += "<th>Field</th><th>Type</th><th>Name</th><th>Palette</th><th>Archive(s)</th><th>Dyeable</th><th>Dye Field</th><th>File Pattern</th><th>Notes</th>";
      html += "</tr></thead><tbody>";
      for (var i = 0; i < AM_EQUIPMENT.length; i++) {
        var E = AM_EQUIPMENT[i];
        html += "<tr><td><code>" + E.field + "</code></td><td><code>" + E.type + "</code></td>";
        html += "<td>" + E.name + "</td><td><code>" + E.palLetter + "</code></td>";
        html += "<td><code>" + E.archive + "</code></td>";
        html += "<td>" + (E.dyeable ? '<span class="am-dye-tag">Yes</span>' : "\u2014") + "</td>";
        html += "<td>" + (E.dyeable ? "<code>" + E.dyeField + "</code>" : "\u2014") + "</td>";
        html += "<td><code>" + E.filePattern + "</code></td>";
        html += "<td>" + E.notes + "</td></tr>";
      }
      html += "</tbody></table></div>";
      html += "<h4>File Naming Convention</h4><ul>";
      html += "<li>Pattern: <code>[gender][type][ID:3digits][animSuffix].epf</code></li>";
      html += "<li>Gender prefix: <code>m</code> = Male, <code>w</code> = Female</li>";
      html += "<li>ID: Zero-padded 3 digits (001\u2013999)</li>";
      html += "<li>Example: <code>mu025</code> = Male Armor undergarment ID 25, <code>wa003b</code> = Female Arms ID 3, Priest animation</li>";
      html += "</ul>";
      el.innerHTML = html;
    };
    renderAmArchives = function() {
      var el = document.getElementById("am-archives");
      var html = "<h3>Archive File Reference</h3>";
      html += "<p>Dark Ages stores sprites in <code>.dat</code> archive files. Each archive contains EPF sprite files and is organized by equipment type letter range and gender.</p>";
      html += '<table class="am-table"><thead><tr>';
      html += "<th>Archive</th><th>Gender</th><th>Letter Range</th><th>Equipment Types Contained</th>";
      html += "</tr></thead><tbody>";
      for (var i = 0; i < AM_ARCHIVES.length; i++) {
        var A = AM_ARCHIVES[i];
        html += "<tr><td><code>" + A.name + "</code></td><td>" + A.gender + "</td>";
        html += "<td><code>" + A.range + "</code></td><td>" + A.types + "</td></tr>";
      }
      html += "</tbody></table>";
      html += "<h4>Archive Path</h4>";
      html += "<p>Archives are read from <code>DA_PATH</code> env var (default: <code>C:/Program Files (x86)/KRU/Dark Ages</code>)</p>";
      html += "<h4>Archive Format</h4><ul>";
      html += "<li>Header: <code>UInt32LE</code> entry count</li>";
      html += "<li>Each entry: <code>UInt32LE</code> offset + 13-byte null-terminated ASCII name</li>";
      html += "<li>Entry data starts at the recorded offset; size = next offset - current offset</li>";
      html += "</ul>";
      el.innerHTML = html;
    };
    renderAmPalettes = function() {
      var el = document.getElementById("am-palettes");
      var html = "<h3>Palette System</h3>";
      html += "<h4>Palette Letter Remapping</h4>";
      html += "<p>Some equipment types use palettes from a different letter. The renderer looks up <code>pal[letter]</code> in <code>khanpal.dat</code>.</p>";
      html += '<table class="am-table"><thead><tr><th>Equipment Type</th><th>Uses Palette</th><th>Reason</th></tr></thead><tbody>';
      for (var i = 0; i < AM_PAL_REMAP.length; i++) {
        var P = AM_PAL_REMAP[i];
        html += "<tr><td><code>" + P.from + "</code></td><td><code>" + P.to + "</code></td><td>" + P.note + "</td></tr>";
      }
      html += "</tbody></table>";
      html += "<h4>Palette File Format (.pal)</h4><ul>";
      html += "<li>256 RGB color entries = 768 bytes per palette</li>";
      html += "<li>Each entry: 3 bytes (R, G, B), index 0-255</li>";
      html += "<li>Stored inside <code>khanpal.dat</code> as entries named <code>pal[letter][number].pal</code></li>";
      html += "</ul>";
      html += "<h4>Palette Table Format (.tbl)</h4><ul>";
      html += "<li>Text format, one mapping per line</li>";
      html += "<li>2-column: <code>spriteId paletteNum</code> \u2014 maps sprite ID to palette number</li>";
      html += "<li>3-column: <code>spriteId paletteNum genderOverride</code> \u2014 gender: <code>-1</code> = male only, <code>-2</code> = female only</li>";
      html += "<li>Range: <code>minId maxId paletteNum</code> \u2014 applies palette to all IDs in range</li>";
      html += "<li>Stored in <code>khanpal.dat</code> as <code>pal[letter].tbl</code></li>";
      html += "</ul>";
      html += "<h4>Dye System</h4><ul>";
      html += "<li>Palette indices <strong>98\u2013103</strong> are the 6 dye color slots</li>";
      html += "<li><code>color0.tbl</code> from <code>legend.dat</code> maps a <code>dyeColor</code> byte (0\u201370) to 6 RGB values</li>";
      html += "<li>When rendering, the dye replaces palette indices 98\u2013103 with the 6 colors from the dye table</li>";
      html += "<li>Dyeable equipment: Boots (bootsColor), Hair (hairColor), Overcoat (overcoatColor), Accessories (accColor), Pants (pantsColor 0\u201315)</li>";
      html += "</ul>";
      html += "<h4>Palm Palettes (Skin/Face)</h4><ul>";
      html += "<li>Faces use <code>palm[skinColor].pal</code> \u2014 direct lookup by skin color ID (0\u20139), no table</li>";
      html += "<li>Magenta pixels (R:255, G:0, B:255) in palm palettes are transparent placeholders for face layer compositing</li>";
      html += "</ul>";
      el.innerHTML = html;
    };
    renderAmAnimations = function() {
      var el = document.getElementById("am-animations");
      var html = "<h3>Animation Reference</h3>";
      html += "<h4>EPF Animation Suffixes</h4>";
      html += "<p>Each equipment ID can have multiple EPF files with different suffixes for different animations.</p>";
      html += '<table class="am-table"><thead><tr><th>Suffix</th><th>Animation</th><th>Frame Layout</th></tr></thead><tbody>';
      for (var i = 0; i < AM_ANIMATIONS.length; i++) {
        var A = AM_ANIMATIONS[i];
        html += "<tr><td><code>" + A.suffix + "</code></td><td>" + A.desc + "</td><td>" + A.frames + "</td></tr>";
      }
      html += "</tbody></table>";
      html += "<h4>Direction System</h4><ul>";
      html += "<li>4 directions: Up (North), Right (East), Down (South), Left (West)</li>";
      html += "<li>Up/Left share animation frames; Right/Down share frames (horizontally flipped)</li>";
      html += "<li>Walk files (suffix 01): frames 0-4 = North, frames 5-9 = South</li>";
      html += "<li>Assail files (suffix 02): frames 0-1 = North, frames 2-3 = South</li>";
      html += "</ul>";
      html += "<h4>Renderer Display Frame</h4><ul>";
      html += "<li>Primary: Walk suffix <code>01</code>, frame index <strong>5</strong> (south-facing idle)</li>";
      html += "<li>Fallback: Assail suffix <code>02</code>, frame index <strong>2</strong> (south-facing assail)</li>";
      html += "<li>Last resort: frame index <strong>0</strong></li>";
      html += "</ul>";
      html += "<h4>EPF File Format</h4><ul>";
      html += "<li>Header: <code>UInt16LE</code> frame count + padding + <code>UInt32LE</code> TOC address</li>";
      html += "<li>Pixel data starts at byte 12</li>";
      html += "<li>TOC (Table of Contents): 16 bytes per frame \u2014 top, left, bottom, right (Int16LE), startAddress, endAddress (UInt32LE)</li>";
      html += "<li>Frame dimensions: width = right - left, height = bottom - top</li>";
      html += "<li>Each pixel is a palette index (1 byte)</li>";
      html += "</ul>";
      el.innerHTML = html;
    };
    renderAmBody = function() {
      var el = document.getElementById("am-body");
      var html = "<h3>Body & Gender Reference</h3>";
      html += "<h4>Body Sprite Values</h4>";
      html += '<table class="am-table"><thead><tr><th>Value</th><th>Hex</th><th>Gender</th><th>File Prefix</th><th>Body EPF</th></tr></thead><tbody>';
      html += "<tr><td><code>16</code></td><td><code>0x10</code></td><td>Male</td><td><code>m</code></td><td><code>mb001[suffix].epf</code></td></tr>";
      html += "<tr><td><code>32</code></td><td><code>0x20</code></td><td>Female</td><td><code>w</code></td><td><code>wb001[suffix].epf</code></td></tr>";
      html += "<tr><td><code>64</code></td><td><code>0x40</code></td><td>Other</td><td><code>w</code></td><td><code>wb001[suffix].epf</code> (treated as female)</td></tr>";
      html += "</tbody></table>";
      html += "<h4>Gender Determination in Renderer</h4><ul>";
      html += "<li>Code: <code>const isFemale = appearance.bodySprite === 32 || appearance.bodySprite === 64</code></li>";
      html += '<li>Gender prefix <code>g</code> = <code>isFemale ? "w" : "m"</code></li>';
      html += "<li>All equipment EPF lookups use this prefix: <code>[g][type][ID][suffix].epf</code></li>";
      html += "</ul>";
      html += "<h4>Canvas Dimensions</h4><ul>";
      html += "<li>Render canvas: <strong>111 \xD7 85</strong> pixels</li>";
      html += "<li>Output is auto-cropped to content bounds with 1px padding</li>";
      html += "<li>Result is PNG-compressed</li>";
      html += "</ul>";
      html += "<h4>Transparency</h4><ul>";
      html += "<li>Magenta (R:255, G:0, B:255) in palm/body palettes = transparent</li>";
      html += "<li>Used as placeholder for face layer compositing in body sprites</li>";
      html += "<li><code>isTranslucent</code> field exists in appearance data but is not currently rendered differently</li>";
      html += "</ul>";
      el.innerHTML = html;
    };
    renderAmDyes = function() {
      var el = document.getElementById("am-dyes");
      var html = "<h3>Dye Color Table</h3>";
      html += "<p>71 dye colors (IDs 0\u201370). These map to palette indices 98\u2013103 via <code>color0.tbl</code> in <code>legend.dat</code>.</p>";
      html += '<div class="am-dye-grid">';
      for (var id = 0; id <= 70; id++) {
        var c = DYE_COLORS[id];
        if (!c) continue;
        html += '<div class="am-dye-chip">';
        html += '<div class="am-dye-swatch" style="background:' + c.hex + '"></div>';
        html += '<span class="am-dye-id">' + id + "</span>";
        html += '<span class="am-dye-name">' + c.name + "</span>";
        html += '<span class="am-dye-hex">' + c.hex + "</span>";
        html += "</div>";
      }
      html += "</div>";
      html += "<h4>Dye Application</h4><ul>";
      html += "<li>Equipment with a dye field (bootsColor, hairColor, overcoatColor, accColor, pantsColor) uses palette index remapping</li>";
      html += "<li>Palette indices 98\u2013103 are replaced with the 6 RGB colors looked up from <code>color0.tbl</code> by dye ID</li>";
      html += "<li>Pants (pantsColor) only supports IDs 0\u201315 to avoid interfering with body shape</li>";
      html += "</ul>";
      el.innerHTML = html;
    };
    renderAmSkin = function() {
      var el = document.getElementById("am-skin");
      var html = "<h3>Skin, Hair & Face Reference</h3>";
      html += "<h4>Skin Colors (skinColor: 0\u20139)</h4>";
      html += "<p>The <code>skinColor</code> value selects which <code>palm[N].pal</code> palette is used for the face layer.</p>";
      html += '<div class="am-skin-grid">';
      for (var id = 0; id <= 9; id++) {
        var name = SKIN_COLORS[id] || "Unknown";
        html += '<div class="am-dye-chip"><span class="am-dye-id">' + id + '</span><span class="am-dye-name">' + name + "</span></div>";
      }
      html += "</div>";
      html += "<h4>Hair (headSprite + hairColor)</h4><ul>";
      html += "<li>Hair sprite: <code>[g]h[headSprite][suffix].epf</code></li>";
      html += "<li>Hair color: dye applied via <code>hairColor</code> (0\u201370, see Dye Colors tab)</li>";
      html += "<li>Palette letter: <code>h</code> (uses <code>palh.tbl</code> for palette lookup)</li>";
      html += "<li>When <code>headSprite</code> is set, it suppresses armor head layers (e, f)</li>";
      html += "</ul>";
      html += "<h4>Face (faceShape + skinColor)</h4><ul>";
      html += "<li>Face sprite: <code>[g]o[faceShape][suffix].epf</code></li>";
      html += "<li>Palette: <code>palm[skinColor].pal</code> \u2014 direct lookup, no table file</li>";
      html += "<li>Palette letter remaps: o \u2192 m (but uses palm direct lookup, not palm.tbl)</li>";
      html += "<li>Magenta pixels (255,0,255) in palm palettes are transparent placeholders</li>";
      html += "</ul>";
      html += "<h4>Appearance Data Types</h4>";
      html += '<table class="am-table"><thead><tr><th>Field</th><th>Type</th><th>Range</th><th>Notes</th></tr></thead><tbody>';
      html += "<tr><td><code>headSprite</code></td><td>number</td><td>0\u2013999+</td><td>0 = no hair/head</td></tr>";
      html += "<tr><td><code>faceShape</code></td><td>byte</td><td>0\u2013255</td><td>Face sprite ID</td></tr>";
      html += "<tr><td><code>skinColor</code></td><td>byte</td><td>0\u20139</td><td>Indexes palm palette</td></tr>";
      html += "<tr><td><code>hairColor</code></td><td>byte</td><td>0\u201370</td><td>Dye color ID</td></tr>";
      html += "<tr><td><code>armorSprite</code></td><td>UInt16</td><td>0\u201365535</td><td>Armor sprite ID</td></tr>";
      html += "<tr><td><code>armsSprite</code></td><td>UInt16</td><td>0\u201365535</td><td>Arms sprite ID</td></tr>";
      html += "<tr><td><code>bootsSprite</code></td><td>UInt16</td><td>0\u201365535</td><td>Boots sprite ID</td></tr>";
      html += "<tr><td><code>weaponSprite</code></td><td>UInt16</td><td>0\u201365535</td><td>Weapon sprite ID</td></tr>";
      html += "<tr><td><code>shieldSprite</code></td><td>byte</td><td>0\u2013255</td><td>255 = no shield</td></tr>";
      html += "<tr><td><code>overcoatSprite</code></td><td>UInt16</td><td>0\u201365535</td><td>1000+ needs offset</td></tr>";
      html += "<tr><td><code>acc1/2/3Sprite</code></td><td>UInt16</td><td>0\u201365535</td><td>Accessory sprite IDs</td></tr>";
      html += "<tr><td><code>pantsColor</code></td><td>byte</td><td>0\u201315</td><td>Limited range for pants</td></tr>";
      html += "</tbody></table>";
      el.innerHTML = html;
    };
    var amOverrideAppearance = null;
    var amOverrideOriginal = null;
    var amOverrideDebounceTimer = null;
    function renderAmOverride() {
      var el = document.getElementById("am-override");
      var html = "<h3>Sprite Override Tester</h3>";
      html += `<p>Load a player's appearance, modify individual sprite IDs, and preview the result. Useful for testing "what if this armor showed sprite X?"</p>`;
      html += '<div class="am-override-load">';
      html += '<input type="text" id="am-override-name" placeholder="Player name...">';
      html += '<button class="btn" id="am-override-load-btn">Load</button>';
      html += "</div>";
      html += '<div class="am-override-wrap">';
      html += '<div class="am-override-form" id="am-override-fields"></div>';
      html += '<div class="am-override-preview" id="am-override-preview"><p style="color:var(--text-muted);font-size:0.8rem;">Load a player to begin</p></div>';
      html += "</div>";
      el.innerHTML = html;
      document.getElementById("am-override-load-btn").addEventListener("click", function() {
        var name = document.getElementById("am-override-name").value.trim();
        if (!name) return;
        fetch("/api/appearance/" + encodeURIComponent(name)).then(function(r) {
          return r.ok ? r.json() : Promise.reject("Player not found");
        }).then(function(app) {
          amOverrideOriginal = JSON.parse(JSON.stringify(app));
          amOverrideAppearance = app;
          renderOverrideFields();
          renderOverridePreview();
        }).catch(function(err) {
          document.getElementById("am-override-fields").innerHTML = '<p style="color:#ff6666;">Could not load player: ' + err + "</p>";
        });
      });
      document.getElementById("am-override-name").addEventListener("keydown", function(e) {
        if (e.key === "Enter") document.getElementById("am-override-load-btn").click();
      });
    }
    function readOverrideFieldsIntoAppearance() {
      var el = document.getElementById("am-override-fields");
      if (!el || !amOverrideAppearance) return;
      var inputs = el.querySelectorAll("input[data-key]");
      for (var j = 0; j < inputs.length; j++) {
        amOverrideAppearance[inputs[j].getAttribute("data-key")] = parseInt(inputs[j].value, 10) || 0;
      }
    }
    function triggerLivePreview() {
      readOverrideFieldsIntoAppearance();
      if (amOverrideDebounceTimer) clearTimeout(amOverrideDebounceTimer);
      amOverrideDebounceTimer = setTimeout(function() {
        renderOverridePreview();
      }, 300);
    }
    function renderOverrideFields() {
      var el = document.getElementById("am-override-fields");
      var html = "";
      for (var i = 0; i < AM_OVERRIDE_FIELDS.length; i++) {
        var F = AM_OVERRIDE_FIELDS[i];
        var val = amOverrideAppearance[F.key] || 0;
        html += '<div class="am-override-row">';
        html += "<label>" + F.label + "</label>";
        html += '<input type="number" data-key="' + F.key + '" value="' + val + '" min="0">';
        if (F.key === "headSprite") {
          html += `<button type="button" class="btn am-browse-btn" id="am-browse-head" onclick="window.__openSpriteBrowser('head')" title="Browse all hair/head sprites">Browse</button>`;
        }
        if (F.key === "armorSprite") {
          html += `<button type="button" class="btn am-browse-btn" id="am-browse-armor" onclick="window.__openSpriteBrowser('armor')" title="Browse all armor sprites">Browse</button>`;
        }
        html += '<span class="am-pal-hint">pal: ' + F.palHint + "</span>";
        html += "</div>";
      }
      html += '<div class="am-override-btns">';
      html += '<button class="btn" id="am-override-render-btn">Render Preview</button>';
      html += '<button class="btn" id="am-override-reset-btn">Reset</button>';
      html += '<button class="btn am-override-save-btn" id="am-override-save-btn">Save Override</button>';
      html += '<button class="btn am-override-delete-btn" id="am-override-delete-btn">Delete Override</button>';
      html += "</div>";
      html += '<div id="am-override-status" class="am-override-status"></div>';
      el.innerHTML = html;
      var inputs = el.querySelectorAll("input[data-key]");
      for (var j = 0; j < inputs.length; j++) {
        inputs[j].addEventListener("input", triggerLivePreview);
      }
      document.getElementById("am-override-render-btn").addEventListener("click", function() {
        readOverrideFieldsIntoAppearance();
        renderOverridePreview();
      });
      document.getElementById("am-override-reset-btn").addEventListener("click", function() {
        if (amOverrideOriginal) {
          amOverrideAppearance = JSON.parse(JSON.stringify(amOverrideOriginal));
          renderOverrideFields();
          renderOverridePreview();
        }
      });
      document.getElementById("am-override-save-btn").addEventListener("click", function() {
        var name = document.getElementById("am-override-name").value.trim();
        if (!name || !amOverrideAppearance || !amOverrideOriginal) return;
        readOverrideFieldsIntoAppearance();
        var diff = {};
        for (var k = 0; k < AM_OVERRIDE_FIELDS.length; k++) {
          var key = AM_OVERRIDE_FIELDS[k].key;
          var cur = amOverrideAppearance[key] || 0;
          var orig = amOverrideOriginal[key] || 0;
          if (cur !== orig) {
            diff[key] = cur;
          }
        }
        if (Object.keys(diff).length === 0) {
          showOverrideStatus("No changes to save", "warn");
          return;
        }
        fetch("/api/sprite-overrides/" + encodeURIComponent(name), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(diff)
        }).then(function(r) {
          return r.json();
        }).then(function(data) {
          if (data.ok) {
            showOverrideStatus("Override saved for " + name + " (" + Object.keys(diff).join(", ") + ")", "ok");
          } else {
            showOverrideStatus("Error: " + (data.error || "unknown"), "err");
          }
        }).catch(function(err) {
          showOverrideStatus("Save failed: " + err, "err");
        });
      });
      document.getElementById("am-override-delete-btn").addEventListener("click", function() {
        var name = document.getElementById("am-override-name").value.trim();
        if (!name) return;
        fetch("/api/sprite-overrides/" + encodeURIComponent(name), { method: "DELETE" }).then(function(r) {
          return r.json();
        }).then(function(data) {
          if (data.ok) {
            showOverrideStatus("Override deleted for " + name, "ok");
          } else {
            showOverrideStatus(data.error || "No override found", "warn");
          }
        }).catch(function(err) {
          showOverrideStatus("Delete failed: " + err, "err");
        });
      });
      window.__openSpriteBrowser = function(type) {
        console.log("[Browse] Button clicked for", type, "amOverrideAppearance=", !!amOverrideAppearance);
        if (amOverrideAppearance) openSpriteBrowser(type);
        else console.warn("[Browse] No player loaded yet");
      };
      checkExistingOverride();
    }
    var BROWSE_CONFIG = {
      head: {
        title: "Hair / Head Browser",
        idsEndpoint: "/api/sprite/head-ids/",
        previewEndpoint: "/api/sprite/head-preview/",
        fieldKey: "headSprite",
        overrideKey: "headSprite"
      },
      armor: {
        title: "Armor / Overcoat Browser",
        idsEndpoint: "/api/sprite/armor-ids/",
        previewEndpoint: "/api/sprite/armor-preview/",
        fieldKey: "armorSprite",
        overrideKey: "armorSprite",
        isOvercoatAware: true
      }
    };
    function openSpriteBrowser(type) {
      var config = BROWSE_CONFIG[type];
      if (!config) {
        console.error("[Browse] Unknown type:", type);
        return;
      }
      console.log("[Browse] Opening", type, "browser");
      var genderParam = amOverrideAppearance.bodySprite === 32 || amOverrideAppearance.bodySprite === 64 || amOverrideAppearance.bodySprite === 144 ? "f" : "m";
      var overlay = document.createElement("div");
      overlay.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;";
      var modal = document.createElement("div");
      modal.style.cssText = "background:#1e1e2e;border:1px solid #333;border-radius:8px;width:90vw;max-width:900px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;";
      var header = document.createElement("div");
      header.style.cssText = "display:flex;align-items:center;gap:1rem;padding:0.75rem 1rem;border-bottom:1px solid #333;";
      header.innerHTML = '<h3 style="margin:0;font-size:1rem;flex:1;color:#eee;">' + config.title + '</h3><span style="color:#888;font-size:0.8rem;">Click to select</span>';
      var closeBtn = document.createElement("button");
      closeBtn.textContent = "\xD7";
      closeBtn.style.cssText = "background:none;border:none;color:#ccc;font-size:1.4rem;cursor:pointer;padding:0 0.3rem;";
      closeBtn.onclick = function() {
        document.body.removeChild(overlay);
      };
      header.appendChild(closeBtn);
      var grid = document.createElement("div");
      grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:6px;padding:1rem;overflow-y:auto;";
      grid.innerHTML = '<p style="color:#888">Loading sprites...</p>';
      modal.appendChild(header);
      modal.appendChild(grid);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      overlay.onclick = function(e) {
        if (e.target === overlay) document.body.removeChild(overlay);
      };
      var url = config.idsEndpoint + genderParam;
      console.log("[Browse] Fetching", url);
      fetch(url).then(function(r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function(data) {
        console.log("[Browse] Got", data.ids ? data.ids.length : 0, "sprite IDs");
        if (!data.ids || data.ids.length === 0) {
          grid.innerHTML = '<p style="color:#f66">No sprites found</p>';
          return;
        }
        var minApp = {
          bodySprite: amOverrideAppearance.bodySprite || 0,
          headSprite: amOverrideAppearance.headSprite || 0,
          skinColor: amOverrideAppearance.skinColor || 0,
          faceShape: amOverrideAppearance.faceShape || 0,
          hairColor: amOverrideAppearance.hairColor || 0
        };
        var baseParam = encodeURIComponent(JSON.stringify(minApp));
        var currentVal = amOverrideAppearance[config.fieldKey] || 0;
        var html = "";
        for (var i = 0; i < data.ids.length; i++) {
          var sid = data.ids[i];
          var borderColor = sid === currentVal ? "#6fc" : "transparent";
          html += '<div class="am-sprite-pick" data-sid="' + sid + '" style="display:flex;flex-direction:column;align-items:center;padding:4px;border:2px solid ' + borderColor + ';border-radius:6px;cursor:pointer;background:#111;">';
          html += '<img src="' + config.previewEndpoint + sid + ".png?base=" + baseParam + '" loading="lazy" style="width:64px;height:64px;object-fit:contain;image-rendering:pixelated;" alt="' + sid + '">';
          html += '<span style="font-size:0.7rem;color:#888;margin-top:2px;">' + sid + "</span>";
          html += "</div>";
        }
        grid.innerHTML = html;
        var items = grid.querySelectorAll(".am-sprite-pick");
        for (var j = 0; j < items.length; j++) {
          (function(item) {
            item.onclick = function() {
              var spriteId = parseInt(item.getAttribute("data-sid"), 10);
              console.log("[Browse] Selected", type, spriteId, "fieldKey=", config.fieldKey);
              var input = document.querySelector('input[data-key="' + config.fieldKey + '"]');
              console.log("[Browse] Input element found:", !!input);
              if (input) {
                if (config.isOvercoatAware && spriteId > 999) {
                  amOverrideAppearance.overcoatSprite = spriteId;
                  amOverrideAppearance.armorSprite = 0;
                  var ocInput = document.querySelector('input[data-key="overcoatSprite"]');
                  var arInput = document.querySelector('input[data-key="armorSprite"]');
                  if (ocInput) ocInput.value = spriteId;
                  if (arInput) arInput.value = 0;
                  console.log("[Browse] Set overcoatSprite =", spriteId, ", armorSprite = 0");
                  showOverrideStatus("Selected overcoat " + spriteId, "ok");
                } else if (config.isOvercoatAware) {
                  amOverrideAppearance.armorSprite = spriteId;
                  amOverrideAppearance.overcoatSprite = 0;
                  var ocInput2 = document.querySelector('input[data-key="overcoatSprite"]');
                  var arInput2 = document.querySelector('input[data-key="armorSprite"]');
                  if (arInput2) arInput2.value = spriteId;
                  if (ocInput2) ocInput2.value = 0;
                  console.log("[Browse] Set armorSprite =", spriteId, ", overcoatSprite = 0");
                  showOverrideStatus("Selected armor " + spriteId, "ok");
                } else {
                  input.value = spriteId;
                  amOverrideAppearance[config.fieldKey] = spriteId;
                  console.log("[Browse] Set", config.fieldKey, "=", spriteId);
                }
                renderOverridePreview();
              }
              for (var k = 0; k < items.length; k++) items[k].style.borderColor = "transparent";
              item.style.borderColor = "#6fc";
              setTimeout(function() {
                if (overlay.parentNode) document.body.removeChild(overlay);
              }, 300);
            };
          })(items[j]);
        }
      }).catch(function(err) {
        console.error("[Browse] Error:", err);
        grid.innerHTML = '<p style="color:#f66">Failed to load: ' + err + "</p>";
      });
    }
    function showOverrideStatus(msg, type) {
      var el = document.getElementById("am-override-status");
      if (!el) return;
      el.textContent = msg;
      el.className = "am-override-status am-override-status-" + (type || "ok");
      clearTimeout(el._timer);
      el._timer = setTimeout(function() {
        el.textContent = "";
      }, 4e3);
    }
    function checkExistingOverride() {
      var name = document.getElementById("am-override-name").value.trim();
      if (!name) return;
      fetch("/api/sprite-overrides/" + encodeURIComponent(name)).then(function(r) {
        if (r.ok) return r.json();
        return null;
      }).then(function(ov) {
        if (ov) {
          var fields = Object.keys(ov).filter(function(k) {
            return k !== "_name";
          });
          showOverrideStatus("Has saved override: " + fields.join(", "), "ok");
        }
      }).catch(function() {
      });
    }
    function renderOverridePreview() {
      var el = document.getElementById("am-override-preview");
      if (!amOverrideAppearance) {
        el.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;">Load a player to begin</p>';
        return;
      }
      console.log("[Preview] Rendering with appearance:", JSON.stringify(amOverrideAppearance));
      el.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;">Rendering...</p>';
      fetch("/api/sprite/render-custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(amOverrideAppearance)
      }).then(function(r) {
        console.log("[Preview] Response status:", r.status);
        if (!r.ok) throw new Error("Render failed: " + r.status);
        return r.blob();
      }).then(function(blob) {
        console.log("[Preview] Got blob, size:", blob.size);
        var url = URL.createObjectURL(blob);
        el.innerHTML = '<img src="' + url + '" alt="Override preview" title="Custom render" style="image-rendering:pixelated;">';
      }).catch(function(err) {
        console.error("[Preview] Error:", err);
        el.innerHTML = '<p style="color:#ff6666;font-size:0.8rem;">Could not render sprite</p>';
      });
    }
    var amInitialized = false;
    document.querySelectorAll(".am-tab").forEach(function(tab) {
      tab.addEventListener("click", function() {
        document.querySelectorAll(".am-tab").forEach(function(t) {
          t.classList.remove("active");
        });
        document.querySelectorAll(".am-section").forEach(function(s) {
          s.classList.remove("active");
        });
        tab.classList.add("active");
        document.getElementById(tab.getAttribute("data-section")).classList.add("active");
      });
    });
    for (var ami = 0; ami < navLinks.length; ami++) {
      if (navLinks[ami].getAttribute("data-panel") === "assetmap") {
        navLinks[ami].addEventListener("click", function() {
          if (!amInitialized) {
            renderAmLayers();
            renderAmEquipment();
            renderAmArchives();
            renderAmPalettes();
            renderAmAnimations();
            renderAmBody();
            renderAmDyes();
            renderAmSkin();
            renderAmOverride();
            amInitialized = true;
          }
        });
      }
    }
  }

  // src/panel/modules/lottery-ui.ts
  function createLotteryUi(deps) {
    var socket = deps.socket;
    var navLinks = deps.navLinks;
    var showToast = deps.showToast;
    var lotteryInitialized = false;
    var lastKnownTicketCount = -1;
    function lotteryFetchStatus() {
      fetch("/api/lottery").then(function(r) {
        return r.json();
      }).then(function(data) {
        lotteryRender(data);
      }).catch(function() {
      });
    }
    function lotteryRender(state) {
      var badge = document.getElementById("lottery-status-badge");
      var nameEl = document.getElementById("lottery-drawing-name");
      var ticketCountEl = document.getElementById("lottery-ticket-count");
      var playerCountEl = document.getElementById("lottery-player-count");
      var winnerRow = document.getElementById("lottery-winner-row");
      var winnerName = document.getElementById("lottery-winner-name");
      var startForm = document.getElementById("lottery-start-form");
      var activeActions = document.getElementById("lottery-active-actions");
      var deliverActions = document.getElementById("lottery-deliver-actions");
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
      nameEl.textContent = state.drawingName || "\u2014";
      var tickets = state.tickets || [];
      ticketCountEl.textContent = tickets.length;
      var uniquePlayers = {};
      tickets.forEach(function(t) {
        uniquePlayers[t.playerName] = true;
      });
      playerCountEl.textContent = Object.keys(uniquePlayers).length;
      if (state.winner) {
        winnerRow.style.display = "";
        winnerName.textContent = state.winner;
      } else {
        winnerRow.style.display = "none";
      }
      if (isActive) {
        startForm.style.display = "none";
        activeActions.style.display = "";
        deliverActions.style.display = "none";
      } else if (isDrawn) {
        startForm.style.display = "none";
        activeActions.style.display = "none";
        deliverActions.style.display = "";
      } else {
        startForm.style.display = "";
        activeActions.style.display = "none";
        deliverActions.style.display = "none";
      }
      var tbody = document.getElementById("lottery-ticket-tbody");
      if (tickets.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="lottery-empty">No tickets yet.</td></tr>';
        return;
      }
      var rows = "";
      tickets.forEach(function(t) {
        var isWinner = state.winner && t.playerName.toLowerCase() === state.winner.toLowerCase();
        var cls = isWinner ? ' class="lottery-winner-row"' : "";
        var d = new Date(t.timestamp);
        var timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        rows += "<tr" + cls + "><td>" + escapeHtml(String(t.ticketNumber)) + "</td><td>" + escapeHtml(t.playerName) + (isWinner ? " &#9733;" : "") + "</td><td>" + escapeHtml(t.itemName || "Gold Bar") + "</td><td>" + timeStr + "</td></tr>";
      });
      tbody.innerHTML = rows;
    }
    document.getElementById("lottery-start-btn").addEventListener("click", function() {
      var nameInput = document.getElementById("lottery-name-input");
      var drawingName = nameInput.value.trim() || "Lottery";
      fetch("/api/lottery/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drawingName })
      }).then(function(r) {
        return r.json();
      }).then(function(data) {
        if (data.success) {
          nameInput.value = "";
          showToast(data.message);
          lotteryFetchStatus();
        } else {
          showToast(data.message || data.error || "Failed to start lottery", true);
        }
      }).catch(function() {
        showToast("Network error", true);
      });
    });
    document.getElementById("lottery-draw-btn").addEventListener("click", function() {
      if (!confirm("Draw a winner now? This will end ticket collection.")) return;
      fetch("/api/lottery/draw", { method: "POST" }).then(function(r) {
        return r.json();
      }).then(function(data) {
        if (data.success) {
          showToast(data.message);
          lotteryFetchStatus();
        } else {
          showToast(data.message || data.error || "Failed to draw", true);
        }
      }).catch(function() {
        showToast("Network error", true);
      });
    });
    function lotteryCancel() {
      if (!confirm("Cancel the lottery? All tickets will be cleared.")) return;
      fetch("/api/lottery/cancel", { method: "POST" }).then(function(r) {
        return r.json();
      }).then(function(data) {
        if (data.success) {
          showToast(data.message);
          lotteryFetchStatus();
        } else {
          showToast(data.message || data.error || "Failed to cancel", true);
        }
      }).catch(function() {
        showToast("Network error", true);
      });
    }
    document.getElementById("lottery-cancel-btn").addEventListener("click", lotteryCancel);
    document.getElementById("lottery-reset-btn").addEventListener("click", function() {
      if (!confirm("Delete this lottery? All tickets and data will be permanently erased.")) return;
      fetch("/api/lottery/reset", { method: "POST" }).then(function(r) {
        return r.json();
      }).then(function(data) {
        if (data.success) {
          showToast(data.message);
          lotteryFetchStatus();
        } else {
          showToast(data.message || data.error || "Failed to reset", true);
        }
      }).catch(function() {
        showToast("Network error", true);
      });
    });
    document.getElementById("lottery-deliver-btn").addEventListener("click", function() {
      if (!confirm("Deliver all Gold Bars to the winner?")) return;
      fetch("/api/lottery/deliver", { method: "POST" }).then(function(r) {
        return r.json();
      }).then(function(data) {
        if (data.success || data.message) {
          showToast(data.message || "Delivering prize...");
          lotteryFetchStatus();
        } else {
          showToast(data.error || "Failed to deliver", true);
        }
      }).catch(function() {
        showToast("Network error", true);
      });
    });
    document.getElementById("lottery-sync-btn").addEventListener("click", function() {
      if (!confirm("Sync this lottery to the AislingExchange database?")) return;
      fetch("/api/lottery/sync", { method: "POST" }).then(function(r) {
        return r.json();
      }).then(function(data) {
        if (data.success) {
          showToast(data.message || "Synced to AE!");
        } else {
          showToast(data.error || "Failed to sync", true);
        }
      }).catch(function() {
        showToast("Network error", true);
      });
    });
    socket.on("lottery:update", function(data) {
      var newCount = data && data.tickets ? data.tickets.length : 0;
      if (lastKnownTicketCount >= 0 && newCount > lastKnownTicketCount) {
        var diff = newCount - lastKnownTicketCount;
        var newest = data.tickets[data.tickets.length - 1];
        var who = newest ? newest.playerName : "Someone";
        showToast(who + " traded a Gold Bar! (+" + diff + " ticket" + (diff > 1 ? "s" : "") + ")");
      }
      lastKnownTicketCount = newCount;
      lotteryRender(data);
    });
    for (var li = 0; li < navLinks.length; li++) {
      if (navLinks[li].getAttribute("data-panel") === "lottery") {
        navLinks[li].addEventListener("click", function() {
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

  // src/panel/modules/slots-ui.ts
  function createSlotsUi(deps) {
    var socket = deps.socket;
    var navLinks = deps.navLinks;
    var showToast = deps.showToast;
    function slotsFetchState() {
      fetch("/api/slots").then(function(r) {
        return r.json();
      }).then(function(data) {
        slotsRender(data);
      }).catch(function() {
      });
    }
    function slotsRender(state) {
      if (!state) return;
      var enabledEl = document.getElementById("slots-enabled");
      var spinCostEl = document.getElementById("slots-spin-cost");
      if (enabledEl) enabledEl.checked = state.config && state.config.enabled;
      if (spinCostEl) spinCostEl.value = state.config && state.config.spinCost || 1;
      var setEl = function(id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = val;
      };
      var setClass = function(id, cls) {
        var el = document.getElementById(id);
        if (el) el.className = "slots-stat-value " + cls;
      };
      if (state.spinningPlayer) {
        setEl("slots-active-player", state.spinningPlayer);
        var spinPlayer = null;
        if (state.players) {
          for (var i = 0; i < state.players.length; i++) {
            if (state.players[i].playerName.toLowerCase() === state.spinningPlayer.toLowerCase()) {
              spinPlayer = state.players[i];
              break;
            }
          }
        }
        setEl("slots-active-balance", spinPlayer ? spinPlayer.balance.toLocaleString() : "?");
      } else {
        setEl("slots-active-player", "None");
        setEl("slots-active-balance", "-");
      }
      setEl("slots-bot-gold", (state.botGoldCount || 0).toLocaleString());
      setEl("slots-max-bet", state.dynamicMaxBet != null ? state.dynamicMaxBet.toLocaleString() : "-");
      var bankWarning = document.getElementById("slots-bank-warning");
      if (bankWarning) {
        bankWarning.style.display = state.bankLow ? "block" : "none";
      }
      if (state.financials) {
        var f = state.financials;
        setEl("slots-total-deposited", f.totalDeposited.toLocaleString());
        setEl("slots-total-withdrawn", f.totalWithdrawn.toLocaleString());
        setEl("slots-outstanding", f.totalOutstandingBalance.toLocaleString());
        setEl("slots-total-bets", f.totalBets.toLocaleString());
        setEl("slots-total-payouts", f.totalPayouts.toLocaleString());
        setEl("slots-total-spins", f.totalSpins.toLocaleString());
        var profitEl = document.getElementById("slots-house-profit");
        if (profitEl) {
          profitEl.textContent = (f.houseProfit >= 0 ? "+" : "") + f.houseProfit.toLocaleString();
          profitEl.className = "slots-stat-value " + (f.houseProfit >= 0 ? "positive" : "negative");
        }
        var edgeEl = document.getElementById("slots-house-edge");
        if (edgeEl) {
          edgeEl.textContent = (f.houseEdge >= 0 ? "+" : "") + f.houseEdge.toLocaleString();
          edgeEl.className = "slots-stat-value " + (f.houseEdge >= 0 ? "positive" : "negative");
        }
        var edgePct = f.totalBets > 0 ? (f.houseEdge / f.totalBets * 100).toFixed(1) : "0.0";
        setEl("slots-edge-pct", edgePct + "% of total bets");
        if (f.ledger) {
          var periods = [
            { key: "today", data: f.ledger.today },
            { key: "week", data: f.ledger.week },
            { key: "all", data: f.ledger.allTime }
          ];
          for (var pi = 0; pi < periods.length; pi++) {
            var p = periods[pi];
            if (!p.data) continue;
            setEl("ledger-" + p.key + "-spins", p.data.spins.toLocaleString());
            setEl("ledger-" + p.key + "-bets", p.data.bets.toLocaleString());
            setEl("ledger-" + p.key + "-payouts", p.data.payouts.toLocaleString());
            setEl("ledger-" + p.key + "-deposited", p.data.deposited.toLocaleString());
            setEl("ledger-" + p.key + "-withdrawn", p.data.withdrawn.toLocaleString());
            var profitId = "ledger-" + p.key + "-profit";
            var profitVal = p.data.profit;
            setEl(profitId, (profitVal >= 0 ? "+" : "") + profitVal.toLocaleString());
            setClass(profitId, profitVal >= 0 ? "positive" : "negative");
          }
        }
      }
      if (state.banking) {
        var b = state.banking;
        setEl("slots-gold-on-hand", b.goldOnHand.toLocaleString());
        setEl("slots-bank-balance", b.bankBalance.toLocaleString());
        setEl("slots-banking-phase", b.phase || "idle");
        setEl("slots-banking-enabled", b.config && b.config.enabled ? "On" : "Off");
        setEl("slots-banker-name", b.config ? b.config.bankerName : "-");
        var phaseEl = document.getElementById("slots-banking-phase");
        if (phaseEl) {
          phaseEl.style.background = b.phase && b.phase !== "idle" ? "var(--gold-400)" : "";
          phaseEl.style.color = b.phase && b.phase !== "idle" ? "#000" : "";
        }
        var bankToggle = document.getElementById("slots-banking-toggle");
        if (bankToggle && document.activeElement !== bankToggle) bankToggle.checked = b.config.enabled;
        var bankerInput = document.getElementById("slots-banker-name-input");
        if (bankerInput && document.activeElement !== bankerInput) bankerInput.value = b.config.bankerName;
        var bankerSerialInput = document.getElementById("slots-banker-serial-input");
        if (bankerSerialInput && document.activeElement !== bankerSerialInput) bankerSerialInput.value = b.config.resolvedSerial || b.config.bankerSerial || 0;
        var bankHighInput = document.getElementById("slots-bank-high");
        if (bankHighInput && document.activeElement !== bankHighInput) bankHighInput.value = b.config.highWatermark;
        var bankDtInput = document.getElementById("slots-bank-deposit-target");
        if (bankDtInput && document.activeElement !== bankDtInput) bankDtInput.value = b.config.depositTarget;
      }
      if (state.offload) {
        setEl("slots-offload-phase", state.offload.phase);
        var offloadPhaseEl = document.getElementById("slots-offload-phase");
        if (offloadPhaseEl) {
          var isActive = state.offload.phase !== "complete" && state.offload.phase !== "failed";
          offloadPhaseEl.style.background = isActive ? "var(--gold-400)" : state.offload.phase === "failed" ? "#d32f2f" : "#4caf50";
          offloadPhaseEl.style.color = "#000";
        }
        var offloadStatus = "";
        if (state.offload.phase === "complete") {
          offloadStatus = "Transferred " + state.offload.totalTransferred.toLocaleString() + " gold to " + state.offload.targetName;
        } else if (state.offload.phase === "failed") {
          offloadStatus = state.offload.errorMessage || "Transfer failed";
        } else {
          offloadStatus = "Transferring to " + state.offload.targetName + ": " + state.offload.totalTransferred.toLocaleString() + " / " + state.offload.totalRequested.toLocaleString();
        }
        setEl("slots-offload-status", offloadStatus);
      } else {
        setEl("slots-offload-phase", "idle");
        setEl("slots-offload-status", "");
        var offloadPhaseEl2 = document.getElementById("slots-offload-phase");
        if (offloadPhaseEl2) {
          offloadPhaseEl2.style.background = "";
          offloadPhaseEl2.style.color = "";
        }
      }
      var queueCountEl = document.getElementById("slots-queue-count");
      var queueTbody = document.querySelector("#slots-queue-table tbody");
      if (queueCountEl) queueCountEl.textContent = state.queueLength || 0;
      if (queueTbody) {
        var queue = state.queue || [];
        if (queue.length === 0) {
          queueTbody.innerHTML = '<tr class="empty-row"><td colspan="4">No players waiting</td></tr>';
        } else {
          var qrows = "";
          for (var qi = 0; qi < queue.length; qi++) {
            var q = queue[qi];
            var waitMin = Math.round((Date.now() - q.joinedAt) / 1e3 / 60);
            qrows += "<tr><td>" + q.position + "</td><td>" + escapeHtml(q.playerName) + '</td><td class="gold-cell">' + q.bet.toLocaleString() + "</td><td>" + waitMin + "m</td></tr>";
          }
          queueTbody.innerHTML = qrows;
        }
      }
      var spinTbody = document.querySelector("#slots-spin-log tbody");
      if (spinTbody) {
        var history = state.spinHistory || [];
        if (history.length === 0) {
          spinTbody.innerHTML = '<tr class="empty-row"><td colspan="5">No spins yet</td></tr>';
        } else {
          var rows = "";
          for (var j = history.length - 1; j >= 0; j--) {
            var s = history[j];
            var d = new Date(s.timestamp);
            var timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            var oc = s.outcome === "jackpot" ? "outcome-jackpot" : s.outcome === "win" ? "outcome-win" : s.outcome === "push" ? "outcome-push" : "outcome-lose";
            var label = s.outcome === "push" ? "PUSH" : s.outcome.toUpperCase();
            rows += "<tr><td>" + escapeHtml(s.playerName) + '</td><td class="reel-cell">' + escapeHtml(s.reel[0]) + '</td><td class="' + oc + '">' + label + '</td><td class="gold-cell">' + (s.payout > 0 ? "+" : "") + s.payout.toLocaleString() + "</td><td>" + timeStr + "</td></tr>";
          }
          spinTbody.innerHTML = rows;
        }
      }
      var balTbody = document.querySelector("#slots-balances-table tbody");
      if (balTbody) {
        var players = state.players || [];
        if (players.length === 0) {
          balTbody.innerHTML = '<tr class="empty-row"><td colspan="6">No players yet</td></tr>';
        } else {
          var brows = "";
          players.sort(function(a, b2) {
            return b2.balance - a.balance;
          });
          for (var k = 0; k < players.length; k++) {
            var p = players[k];
            var winRate = p.totalWon + p.totalLost > 0 ? Math.round(p.totalWon / (p.totalWon + p.totalLost) * 100) : 0;
            brows += "<tr><td>" + escapeHtml(p.playerName) + '</td><td class="gold-cell">' + p.balance.toLocaleString() + '</td><td class="gold-cell">' + p.totalDeposited.toLocaleString() + '</td><td class="gold-cell">' + p.totalWithdrawn.toLocaleString() + "</td><td>" + p.totalSpins + '</td><td class="wl-cell"><span style="color:#4caf50">' + p.totalWon + 'W</span> / <span style="color:#e57373">' + p.totalLost + 'L</span> <span style="color:var(--text-muted);font-size:0.65rem">(' + winRate + "%)</span></td></tr>";
          }
          balTbody.innerHTML = brows;
        }
      }
      if (state.tickets) {
        var ts = state.tickets.stats || {};
        setEl("ticket-total-sold", (ts.totalTickets || 0).toLocaleString());
        setEl("ticket-total-spent", (ts.totalSpent || 0).toLocaleString());
        setEl("ticket-total-won", (ts.totalWon || 0).toLocaleString());
        var ticketBadge = document.getElementById("ticket-stats-badge");
        if (ticketBadge) ticketBadge.textContent = (ts.totalTickets || 0) + " tickets";
        var ticketProfitEl = document.getElementById("ticket-house-profit");
        if (ticketProfitEl) {
          var tp = ts.totalProfit || 0;
          ticketProfitEl.textContent = (tp >= 0 ? "+" : "") + tp.toLocaleString();
          ticketProfitEl.className = "slots-stat-value " + (tp >= 0 ? "positive" : "negative");
        }
        var ticketTbody = document.querySelector("#ticket-history-table tbody");
        if (ticketTbody) {
          var th = state.tickets.history || [];
          if (th.length === 0) {
            ticketTbody.innerHTML = '<tr class="empty-row"><td colspan="6">No tickets yet</td></tr>';
          } else {
            var trows = "";
            for (var ti = th.length - 1; ti >= 0; ti--) {
              var t = th[ti];
              var td = new Date(t.timestamp);
              var ttime = td.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
              var tierColor = t.tier === "gold" ? "#fbbf24" : t.tier === "silver" ? "#94a3b8" : "#cd7f32";
              var toc = t.outcome === "win" ? "outcome-win" : "outcome-lose";
              trows += "<tr><td>" + escapeHtml(t.playerName) + '</td><td><span style="color:' + tierColor + ';text-transform:capitalize;">' + escapeHtml(t.tier) + '</span></td><td class="gold-cell">' + t.cost.toLocaleString() + '</td><td class="' + toc + '">' + t.outcome.toUpperCase() + '</td><td class="gold-cell">' + (t.prize > 0 ? "+" + t.prize.toLocaleString() : "0") + "</td><td>" + ttime + "</td></tr>";
            }
            ticketTbody.innerHTML = trows;
          }
        }
      }
    }
    document.getElementById("slots-save-config").addEventListener("click", function() {
      var enabled = document.getElementById("slots-enabled").checked;
      var spinCost = parseInt(document.getElementById("slots-spin-cost").value) || 1;
      fetch("/api/slots/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, spinCost })
      }).then(function(r) {
        return r.json();
      }).then(function(data) {
        if (data.success) {
          showToast("Slot machine config saved.");
          slotsFetchState();
        } else {
          showToast(data.error || "Failed to save config", true);
        }
      }).catch(function() {
        showToast("Network error", true);
      });
    });
    document.getElementById("slots-end-session").addEventListener("click", function() {
      if (!confirm("Force end the active slot machine session?")) return;
      fetch("/api/slots/end-session", { method: "POST" }).then(function(r) {
        return r.json();
      }).then(function(data) {
        if (data.success) {
          showToast(data.message);
          slotsFetchState();
        } else {
          showToast(data.error || "No active session", true);
        }
      }).catch(function() {
        showToast("Network error", true);
      });
    });
    document.getElementById("slots-clear-queue").addEventListener("click", function() {
      if (!confirm("Clear all players from the slot machine queue?")) return;
      fetch("/api/slots/clear-queue", { method: "POST" }).then(function(r) {
        return r.json();
      }).then(function(data) {
        if (data.success) {
          showToast(data.message);
          slotsFetchState();
        } else {
          showToast(data.error || "Failed to clear queue", true);
        }
      }).catch(function() {
        showToast("Network error", true);
      });
    });
    document.getElementById("slots-bank-save").addEventListener("click", function() {
      var payload = {
        enabled: document.getElementById("slots-banking-toggle").checked,
        bankerName: document.getElementById("slots-banker-name-input").value.trim() || "Celesta",
        bankerSerial: parseInt(document.getElementById("slots-banker-serial-input").value) || 0,
        highWatermark: parseInt(document.getElementById("slots-bank-high").value) || 8e7,
        depositTarget: parseInt(document.getElementById("slots-bank-deposit-target").value) || 15e6
      };
      fetch("/api/slots/banking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(function(r) {
        return r.json();
      }).then(function(data) {
        if (data.success) {
          showToast("Banking config saved.");
          slotsFetchState();
        } else {
          showToast(data.error || "Failed to save banking config", true);
        }
      }).catch(function() {
        showToast("Network error", true);
      });
    });
    document.getElementById("slots-bank-deposit").addEventListener("click", function() {
      var amount = parseInt(document.getElementById("slots-banking-amount").value);
      if (!amount || amount <= 0) return showToast("Enter a valid amount", true);
      fetch("/api/slots/banking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manualDeposit: amount })
      }).then(function(r) {
        return r.json();
      }).then(function(data) {
        if (data.success) {
          showToast("Depositing " + amount.toLocaleString() + " gold to bank...");
          slotsFetchState();
        } else {
          showToast(data.error || "Deposit failed", true);
        }
      }).catch(function() {
        showToast("Network error", true);
      });
    });
    document.getElementById("slots-bank-withdraw").addEventListener("click", function() {
      var amount = parseInt(document.getElementById("slots-banking-amount").value);
      if (!amount || amount <= 0) return showToast("Enter a valid amount", true);
      fetch("/api/slots/banking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manualWithdraw: amount })
      }).then(function(r) {
        return r.json();
      }).then(function(data) {
        if (data.success) {
          showToast("Withdrawing " + amount.toLocaleString() + " gold from bank...");
          slotsFetchState();
        } else {
          showToast(data.error || "Withdraw failed", true);
        }
      }).catch(function() {
        showToast("Network error", true);
      });
    });
    document.getElementById("slots-bank-override").addEventListener("click", function() {
      var payload = {};
      var goh = document.getElementById("slots-set-gold-on-hand").value;
      var bb = document.getElementById("slots-set-bank-balance").value;
      if (goh !== "") payload.goldOnHand = parseInt(goh) || 0;
      if (bb !== "") payload.bankBalance = parseInt(bb) || 0;
      if (Object.keys(payload).length === 0) return showToast("Enter at least one value", true);
      fetch("/api/slots/banking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).then(function(r) {
        return r.json();
      }).then(function(data) {
        if (data.success) {
          showToast("Values updated.");
          slotsFetchState();
        } else {
          showToast(data.error || "Failed to update", true);
        }
      }).catch(function() {
        showToast("Network error", true);
      });
    });
    document.getElementById("slots-offload-btn").addEventListener("click", function() {
      var target = document.getElementById("slots-offload-target").value.trim();
      var amount = parseInt(document.getElementById("slots-offload-amount").value);
      if (!target) return showToast("Enter a target character name", true);
      if (!amount || amount <= 0) return showToast("Enter a valid amount", true);
      fetch("/api/slots/offload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetName: target, amount })
      }).then(function(r) {
        return r.json();
      }).then(function(data) {
        if (data.success) {
          showToast("Offload initiated to " + target);
          slotsFetchState();
        } else {
          showToast(data.error || "Offload failed", true);
        }
      }).catch(function() {
        showToast("Network error", true);
      });
    });
    socket.on("slots:update", function(data) {
      slotsRender(data);
    });
    for (var si = 0; si < navLinks.length; si++) {
      if (navLinks[si].getAttribute("data-panel") === "slots") {
        navLinks[si].addEventListener("click", function() {
          slotsFetchState();
        });
      }
    }
  }

  // src/panel/modules/npc-leak-ui.ts
  function createNpcLeakUi(deps) {
    var socket = deps.socket;
    var navLinks = deps.navLinks;
    var showToast = deps.showToast;
    var npcleakLogEl = document.getElementById("npcleak-log");
    var npcleakStatusEl = document.getElementById("npcleak-status");
    var npcleakStatusText = document.getElementById("npcleak-status-text");
    var npcleakLeaksSection = document.getElementById("npcleak-leaks-section");
    var npcleakLeaksList = document.getElementById("npcleak-leaks-list");
    var npcleakStartBtn = document.getElementById("npcleak-start-btn");
    var npcleakStopBtn = document.getElementById("npcleak-stop-btn");
    var npcleakRefreshBtn = document.getElementById("npcleak-refresh-btn");
    var npcleakTarget = document.getElementById("npcleak-target");
    var npcleakClicks = document.getElementById("npcleak-clicks");
    var npcleakInterval = document.getElementById("npcleak-interval");
    var npcleakLogEntries = [];
    function npcleakColorForOpcode(hex) {
      if (hex === "0x6A") return "#ef4444";
      if (hex === "0x2F") return "#60a5fa";
      if (hex === "0x1A") return "#a78bfa";
      if (hex === "0x3A") return "#4ade80";
      if (hex === "0x0A") return "#fbbf24";
      if (hex === "0x43") return "#38bdf8";
      return "#94a3b8";
    }
    function npcleakAddLogLine(html) {
      if (!npcleakLogEl) return;
      var div = document.createElement("div");
      div.innerHTML = html;
      npcleakLogEl.appendChild(div);
      npcleakLogEl.scrollTop = npcleakLogEl.scrollHeight;
    }
    function npcleakFormatEntry(entry) {
      var timeStr = (entry.elapsed / 1e3).toFixed(1) + "s";
      var arrow = entry.direction === "sent" ? '<span style="color:#38bdf8;">&gt;&gt;</span>' : '<span style="color:#fb923c;">&lt;&lt;</span>';
      var color = npcleakColorForOpcode(entry.opcodeHex);
      var line = '<span style="color:#6b7280;">[' + timeStr + "]</span> " + arrow + ' <span style="color:' + color + ';font-weight:600;">' + entry.opcodeHex + '</span> <span style="color:#d1d5db;">' + escapeHtml(entry.summary) + '</span> <span style="color:#6b7280;">(' + entry.bodyLength + "b)</span>";
      if (entry.summary && entry.summary.indexOf("OVERFLOW") !== -1) {
        line = '<div style="background:#1c1010;border-left:3px solid #ef4444;padding:2px 6px;margin:2px 0;">' + line + "</div>";
      }
      if (entry.opcodeHex === "0x6A" || entry.direction === "recv" && ["0x2F", "0x1A", "0x3A", "0x0A", "0x0C", "0x0D", "0x0E", "0x11", "0x33", "0x39", "0x3B", "0x68"].indexOf(entry.opcodeHex) === -1) {
        line += '<div style="color:#ef4444;margin-left:20px;word-break:break-all;">' + escapeHtml(entry.payloadHex) + "</div>";
      }
      return line;
    }
    function npcleakUpdateStatus(data) {
      if (!npcleakStatusEl) return;
      npcleakStatusEl.style.display = "block";
      if (data.error) {
        npcleakStatusText.innerHTML = '<span style="color:#ef4444;">Error: ' + escapeHtml(data.error) + "</span>";
        npcleakStartBtn.disabled = false;
        npcleakStopBtn.disabled = true;
        return;
      }
      if (data.active) {
        var elapsed = (data.elapsed / 1e3).toFixed(0);
        npcleakStatusText.innerHTML = '<span style="color:#4ade80;">SCANNING</span> ' + escapeHtml(data.targetName) + " (" + data.targetSerial + ") &mdash; Click " + data.clickCount + "/" + data.maxClicks + " &mdash; " + data.packetsLogged + " packets &mdash; " + elapsed + 's &mdash; <span style="color:' + (data.leaksFound > 0 ? "#ef4444;font-weight:700" : "#6b7280") + ';">' + data.leaksFound + " leaks</span>";
        npcleakStartBtn.disabled = true;
        npcleakStopBtn.disabled = false;
      } else {
        npcleakStatusText.innerHTML = '<span style="color:#94a3b8;">IDLE</span>' + (data.clickCount > 0 ? " &mdash; Last scan: " + data.clickCount + " clicks, " + data.packetsLogged + " packets, " + data.leaksFound + " leaks" : "");
        npcleakStartBtn.disabled = false;
        npcleakStopBtn.disabled = true;
      }
      if (data.leaks && data.leaks.length > 0) {
        npcleakLeaksSection.style.display = "block";
        npcleakLeaksList.innerHTML = "";
        for (var i = 0; i < data.leaks.length; i++) {
          var leak = data.leaks[i];
          var el = document.createElement("div");
          el.style.cssText = "padding:8px 12px;background:#1c1010;border:1px solid #ef4444;border-radius:4px;font-family:Fira Code,monospace;font-size:11px;";
          el.innerHTML = '<div style="color:#ef4444;font-weight:700;">Leak #' + (i + 1) + " at " + (leak.elapsed / 1e3).toFixed(1) + 's</div><div style="color:#fbbf24;">Name: ' + escapeHtml(leak.parsedName) + '</div><div style="color:#d1d5db;">' + escapeHtml(leak.parsedData) + '</div><div style="color:#6b7280;word-break:break-all;margin-top:4px;">Raw: ' + escapeHtml(leak.fullPayload) + "</div>";
          npcleakLeaksList.appendChild(el);
        }
      }
    }
    socket.on("npcleak:status", npcleakUpdateStatus);
    socket.on("npcleak:log", function(entry) {
      npcleakLogEntries.push(entry);
      npcleakAddLogLine(npcleakFormatEntry(entry));
    });
    socket.on("npcleak:leakFound", function(leak) {
      npcleakAddLogLine('<div style="color:#ef4444;font-weight:700;padding:4px 0;">\u2605\u2605\u2605 LEAK DETECTED: ' + escapeHtml(leak.parsedName) + " \u2605\u2605\u2605</div>");
      showToast("LEAK DETECTED: " + leak.parsedName);
    });
    socket.on("npcleak:npcList", function(npcs) {
      if (!npcleakTarget) return;
      npcleakTarget.innerHTML = '<option value="">-- Select NPC (' + npcs.length + " entities) --</option>";
      for (var i = 0; i < npcs.length; i++) {
        var opt = document.createElement("option");
        opt.value = npcs[i].serial;
        opt.textContent = npcs[i].name + " (0x" + npcs[i].serial.toString(16).toUpperCase() + ")";
        opt.dataset.name = npcs[i].name;
        npcleakTarget.appendChild(opt);
      }
    });
    if (npcleakRefreshBtn) {
      npcleakRefreshBtn.addEventListener("click", function() {
        socket.emit("npcleak:listNpcs");
      });
    }
    if (npcleakStartBtn) {
      npcleakStartBtn.addEventListener("click", function() {
        var serial = 0;
        var name = "";
        var manualSerial = document.getElementById("npcleak-manual-serial");
        var manualName = document.getElementById("npcleak-manual-name");
        if (manualSerial && manualSerial.value.trim()) {
          serial = parseInt(manualSerial.value.trim(), 16);
          name = manualName && manualName.value.trim() || "NPC_0x" + serial.toString(16).toUpperCase();
          if (!serial || isNaN(serial)) {
            showToast("Invalid hex serial. Use format like 575C");
            return;
          }
        } else {
          var selected = npcleakTarget.options[npcleakTarget.selectedIndex];
          if (!selected || !selected.value) {
            showToast("Select a target NPC or enter a serial manually.");
            return;
          }
          serial = parseInt(selected.value);
          name = selected.dataset.name || "";
        }
        var maxClicks = parseInt(npcleakClicks.value) || 20;
        var intervalMs = parseInt(npcleakInterval.value) || 500;
        var lookupEl = document.getElementById("npcleak-lookup");
        var lookupName = lookupEl ? lookupEl.value.trim() : "";
        npcleakLogEntries = [];
        npcleakLogEl.innerHTML = "";
        if (npcleakLeaksSection) npcleakLeaksSection.style.display = "none";
        var startMsg = "Starting scan on " + escapeHtml(name) + " (0x" + serial.toString(16).toUpperCase() + ") - " + maxClicks + " clicks @ " + intervalMs + "ms";
        if (lookupName) startMsg += " \u2014 Lookup: " + escapeHtml(lookupName);
        npcleakAddLogLine('<span style="color:#4ade80;">' + startMsg + "</span>");
        socket.emit("npcleak:start", {
          serial,
          npcName: name,
          lookupName,
          maxClicks,
          intervalMs
        });
      });
    }
    if (npcleakStopBtn) {
      npcleakStopBtn.addEventListener("click", function() {
        socket.emit("npcleak:stop");
      });
    }
    var npcleakClearBtn = document.getElementById("npcleak-clear-log-btn");
    if (npcleakClearBtn) {
      npcleakClearBtn.addEventListener("click", function() {
        npcleakLogEntries = [];
        npcleakLogEl.innerHTML = '<div style="color:var(--text-secondary);">Log cleared.</div>';
      });
    }
    var npcleakExportBtn = document.getElementById("npcleak-export-log-btn");
    if (npcleakExportBtn) {
      npcleakExportBtn.addEventListener("click", function() {
        if (npcleakLogEntries.length === 0) {
          showToast("No log data to export.");
          return;
        }
        var text = JSON.stringify(npcleakLogEntries, null, 2);
        var blob = new Blob([text], { type: "application/json" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "npcleak-log-" + Date.now() + ".json";
        a.click();
        URL.revokeObjectURL(a.href);
      });
    }
    for (var nli = 0; nli < navLinks.length; nli++) {
      if (navLinks[nli].getAttribute("data-panel") === "npc-leak") {
        navLinks[nli].addEventListener("click", function() {
          socket.emit("npcleak:listNpcs");
          socket.emit("npcleak:status");
        });
      }
    }
  }

  // src/panel/modules/attendance-ui.ts
  function createAttendanceUi(deps) {
    var socket = deps.socket;
    var lastAttendanceState = null;
    function attendanceFormatTime(ts) {
      if (!ts) return "\u2014";
      var d = new Date(ts);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }
    function attendanceRender(state) {
      var badge = document.getElementById("attendance-status-badge");
      var eventNameEl = document.getElementById("attendance-event-name");
      var startedAtEl = document.getElementById("attendance-started-at");
      var totalCountEl = document.getElementById("attendance-total-count");
      var startForm = document.getElementById("attendance-start-form");
      var activeActions = document.getElementById("attendance-active-actions");
      var stoppedActions = document.getElementById("attendance-stopped-actions");
      if (!badge) return;
      if (state.active) {
        badge.innerHTML = '<span class="attendance-badge attendance-badge-active">Tracking</span>';
        startForm.style.display = "none";
        activeActions.style.display = "";
        stoppedActions.style.display = "none";
      } else if (state.stoppedAt) {
        badge.innerHTML = '<span class="attendance-badge attendance-badge-stopped">Stopped</span>';
        startForm.style.display = "none";
        activeActions.style.display = "none";
        stoppedActions.style.display = "";
      } else {
        badge.innerHTML = '<span class="attendance-badge attendance-badge-inactive">Inactive</span>';
        startForm.style.display = "";
        activeActions.style.display = "none";
        stoppedActions.style.display = "none";
      }
      eventNameEl.textContent = state.eventName || "\u2014";
      startedAtEl.textContent = state.startedAt ? new Date(state.startedAt).toLocaleString() : "\u2014";
      totalCountEl.textContent = state.totalCount || 0;
      var tbody = document.getElementById("attendance-tbody");
      if (!state.attendees || state.attendees.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="attendance-empty">No attendees yet.' + (state.active ? " Players will appear as they enter the tracker bot's screen." : " Start tracking to begin.") + "</td></tr>";
        return;
      }
      var rows = "";
      for (var i = 0; i < state.attendees.length; i++) {
        var a = state.attendees[i];
        rows += "<tr><td>" + (i + 1) + '</td><td class="attendance-player-name">' + escapeHtml(a.name) + "</td><td>" + attendanceFormatTime(a.firstSeen) + "</td><td>" + attendanceFormatTime(a.lastSeen) + "</td><td>" + a.sightings + "</td></tr>";
      }
      tbody.innerHTML = rows;
    }
    function attendanceExport(state) {
      if (!state || !state.attendees || state.attendees.length === 0) return;
      var lines = ["Attendance Report: " + (state.eventName || "Event")];
      lines.push("Date: " + new Date(state.startedAt).toLocaleString());
      lines.push("Total Attendees: " + state.totalCount);
      lines.push("");
      for (var i = 0; i < state.attendees.length; i++) {
        lines.push(i + 1 + ". " + state.attendees[i].name);
      }
      var text = lines.join("\n");
      navigator.clipboard.writeText(text).then(function() {
        var notif = document.createElement("div");
        notif.className = "toast";
        notif.textContent = "Attendance copied to clipboard!";
        document.body.appendChild(notif);
        setTimeout(function() {
          notif.remove();
        }, 3e3);
      });
    }
    socket.on("attendance:update", function(state) {
      lastAttendanceState = state;
      attendanceRender(state);
    });
    socket.on("attendance:newAttendee", function() {
      socket.emit("attendance:getState");
    });
    document.getElementById("attendance-start-btn").addEventListener("click", function() {
      var nameInput = document.getElementById("attendance-name-input");
      var eventName = nameInput.value.trim() || "Event";
      socket.emit("attendance:start", { eventName });
    });
    document.getElementById("attendance-stop-btn").addEventListener("click", function() {
      socket.emit("attendance:stop");
    });
    document.getElementById("attendance-export-btn").addEventListener("click", function() {
      if (lastAttendanceState) attendanceExport(lastAttendanceState);
    });
    document.getElementById("attendance-export-btn-2").addEventListener("click", function() {
      if (lastAttendanceState) attendanceExport(lastAttendanceState);
    });
    document.getElementById("attendance-clear-btn").addEventListener("click", function() {
      if (confirm("Clear all attendance data?")) {
        socket.emit("attendance:clear");
      }
    });
  }

  // src/panel/modules/ai-chat-ui.ts
  function createAiChatUi(deps) {
    var socket = deps.socket;
    function renderBlacklist(list) {
      var container = document.getElementById("ai-blacklist-list");
      if (!container) return;
      if (!list || list.length === 0) {
        container.innerHTML = '<div class="rules-empty">No players blacklisted.</div>';
        return;
      }
      var html = "";
      for (var i = 0; i < list.length; i++) {
        html += '<div class="rule-item rule-enabled" style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0.6rem;"><span class="rule-name">' + escapeHtml(list[i]) + '</span><button class="btn btn-small" data-unblock="' + escapeHtml(list[i]) + '">Unblock</button></div>';
      }
      container.innerHTML = html;
      var btns = container.querySelectorAll("[data-unblock]");
      for (var j = 0; j < btns.length; j++) {
        btns[j].addEventListener("click", function() {
          socket.emit("aichat:removeBlacklist", this.getAttribute("data-unblock"));
        });
      }
    }
    socket.on("aichat:blacklist", function(list) {
      renderBlacklist(list);
    });
    socket.emit("aichat:getBlacklist");
    var addBtn = document.getElementById("ai-blacklist-add");
    if (addBtn) {
      addBtn.addEventListener("click", function() {
        var input = document.getElementById("ai-blacklist-name");
        var name = input.value.trim();
        if (!name) return;
        socket.emit("aichat:addBlacklist", name);
        input.value = "";
      });
    }
  }

  // src/panel/modules/proxy-ui.ts
  function createProxyUi(deps) {
    var socket = deps.socket;
    var buildMapOptions = deps.buildMapOptions;
    var getMapListCache = deps.getMapListCache;
    var getBotStates = deps.getBotStates;
    var showToast = deps.showToast;
    var proxySessions = [];
    var proxyNpcs = [];
    var activeProxyPlayerId = null;
    var proxyNavStatuses = {};
    document.querySelectorAll(".proxy-tab").forEach(function(tab) {
      tab.addEventListener("click", function() {
        document.querySelectorAll(".proxy-tab").forEach(function(t) {
          t.classList.remove("active");
          t.style.opacity = "0.6";
          t.style.borderBottomColor = "transparent";
        });
        tab.classList.add("active");
        tab.style.opacity = "1";
        tab.style.borderBottomColor = "#6bf";
        document.querySelectorAll(".proxy-tab-content").forEach(function(c) {
          c.style.display = "none";
          c.classList.remove("active");
        });
        var target = document.getElementById("proxy-content-" + tab.getAttribute("data-proxy-tab"));
        if (target) {
          target.style.display = "";
          target.classList.add("active");
        }
      });
    });
    var firstTab = document.querySelector(".proxy-tab.active");
    if (firstTab) {
      firstTab.style.opacity = "1";
      firstTab.style.borderBottomColor = "#6bf";
    }
    function updateProxyMapDropdown() {
      var select = document.getElementById("proxy-npc-map");
      if (!select) return;
      var currentVal = select.value;
      select.innerHTML = buildMapOptions(currentVal ? parseInt(currentVal) : 0);
    }
    socket.on("nav:mapList", function() {
      updateProxyMapDropdown();
    });
    setTimeout(updateProxyMapDropdown, 500);
    function renderProxySessions() {
      renderProxyPlayerTabBar();
      renderActiveProxyPlayerTab();
      var targetSelect = document.getElementById("proxy-chat-target");
      if (targetSelect) {
        var currentVal = targetSelect.value;
        targetSelect.innerHTML = '<option value="broadcast">All Players</option>';
        for (var j = 0; j < proxySessions.length; j++) {
          var sess = proxySessions[j];
          var opt = document.createElement("option");
          opt.value = sess.id;
          opt.textContent = sess.characterName || sess.id;
          targetSelect.appendChild(opt);
        }
        targetSelect.value = currentVal;
      }
    }
    function renderProxyPlayerTabBar() {
      var tabBar = document.getElementById("proxy-player-tab-bar");
      var emptyMsg = document.getElementById("proxy-player-tabs-empty");
      if (!tabBar) return;
      var gameSessions = proxySessions.filter(function(s) {
        return s.phase === "game" && s.characterName;
      });
      if (gameSessions.length === 0) {
        emptyMsg.style.display = "";
        tabBar.querySelectorAll(".bot-tab").forEach(function(t) {
          t.remove();
        });
        document.getElementById("proxy-player-tab-content").innerHTML = "";
        activeProxyPlayerId = null;
        return;
      }
      emptyMsg.style.display = "none";
      var sessionIds = gameSessions.map(function(s) {
        return s.id;
      });
      tabBar.querySelectorAll(".bot-tab").forEach(function(tab) {
        if (sessionIds.indexOf(tab.dataset.proxyId) === -1) tab.remove();
      });
      gameSessions.forEach(function(s) {
        var existing = tabBar.querySelector('.bot-tab[data-proxy-id="' + s.id + '"]');
        if (existing) {
          existing.querySelector(".bot-tab-label").textContent = s.characterName || s.id;
          var navState = proxyNavStatuses[s.id];
          existing.dataset.status = navState && navState.state === "walking" ? "connected" : "idle";
        } else {
          var tab = document.createElement("button");
          tab.className = "bot-tab";
          tab.dataset.proxyId = s.id;
          tab.dataset.status = "idle";
          tab.innerHTML = '<span class="bot-tab-dot"></span><span class="bot-tab-label">' + escapeHtml(s.characterName || s.id) + "</span>";
          tab.addEventListener("click", function() {
            activeProxyPlayerId = s.id;
            tabBar.querySelectorAll(".bot-tab").forEach(function(t) {
              t.classList.remove("active");
            });
            tab.classList.add("active");
            renderActiveProxyPlayerTab();
          });
          tabBar.insertBefore(tab, emptyMsg);
        }
      });
      if (!activeProxyPlayerId || sessionIds.indexOf(activeProxyPlayerId) === -1) {
        activeProxyPlayerId = sessionIds[0];
      }
      tabBar.querySelectorAll(".bot-tab").forEach(function(t) {
        t.classList.toggle("active", t.dataset.proxyId === activeProxyPlayerId);
      });
    }
    function renderActiveProxyPlayerTab() {
      var container = document.getElementById("proxy-player-tab-content");
      if (!container) return;
      if (!activeProxyPlayerId) {
        container.innerHTML = "";
        return;
      }
      var session = null;
      for (var i = 0; i < proxySessions.length; i++) {
        if (proxySessions[i].id === activeProxyPlayerId) {
          session = proxySessions[i];
          break;
        }
      }
      if (!session) {
        container.innerHTML = "";
        return;
      }
      var ps = session.playerState || {};
      var mapName = getMapName(ps.mapNumber);
      var posStr = ps.x !== void 0 ? ps.x + ", " + ps.y : "--";
      var mapStr = mapName ? escapeHtml(mapName) + " (" + ps.mapNumber + ")" : ps.mapNumber ? "Map " + ps.mapNumber : "--";
      var sid = session.id;
      var navState = proxyNavStatuses[sid] || {};
      var navLabel = navState.state === "walking" ? "Walking..." : navState.state === "failed" ? "Failed" : "Idle";
      var html = '<div class="bot-tab-panel" data-proxy-id="' + escapeHtml(sid) + '"><div class="btp-header"><div class="btp-identity"><span class="btp-name">' + escapeHtml(session.characterName || sid) + '</span><span class="btp-badge" style="background:#6bf;color:#000;">Proxy</span><span class="btp-status" data-status="' + (navState.state || "idle") + '">' + navLabel + '</span></div></div><div class="btp-info-bar"><div class="btp-stat"><span class="btp-stat-label">Map</span><span class="btp-stat-value">' + mapStr + '</span></div><div class="btp-stat"><span class="btp-stat-label">Position</span><span class="btp-stat-value">' + posStr + '</span></div><div class="btp-stat"><span class="btp-stat-label">Session</span><span class="btp-stat-value" style="font-size:0.75em;opacity:0.6">' + escapeHtml(sid) + '</span></div></div><div class="proxy-nav-status" data-proxy-id="' + escapeHtml(sid) + '"></div><div class="btp-panels"><div class="btp-card btp-move-card"><div class="btp-card-title">Movement</div><div class="dpad"><div class="dpad-row dpad-center"><button data-dir="0" data-proxy-id="' + escapeHtml(sid) + '" class="btn btn-dpad proxy-dpad-btn" title="North">N</button></div><div class="dpad-row"><button data-dir="3" data-proxy-id="' + escapeHtml(sid) + '" class="btn btn-dpad proxy-dpad-btn" title="West">W</button><div class="dpad-center-gem"></div><button data-dir="1" data-proxy-id="' + escapeHtml(sid) + '" class="btn btn-dpad proxy-dpad-btn" title="East">E</button></div><div class="dpad-row dpad-center"><button data-dir="2" data-proxy-id="' + escapeHtml(sid) + '" class="btn btn-dpad proxy-dpad-btn" title="South">S</button></div></div><div class="btp-walk-xy"><input type="number" class="proxy-nav-x" data-proxy-id="' + escapeHtml(sid) + '" placeholder="X"><input type="number" class="proxy-nav-y" data-proxy-id="' + escapeHtml(sid) + '" placeholder="Y"><button class="btn btn-small btn-green proxy-walk-btn" data-proxy-id="' + escapeHtml(sid) + '">Walk</button></div></div><div class="btp-card btp-nav-card"><div class="btp-card-title">Navigate to Map</div><select class="toolbar-select proxy-nav-map-select" data-proxy-id="' + escapeHtml(sid) + '">' + buildMapOptions(ps.mapNumber || null) + '</select><div class="btp-nav-coords"><input type="number" class="proxy-nav-target-x" data-proxy-id="' + escapeHtml(sid) + '" placeholder="X (optional)"><input type="number" class="proxy-nav-target-y" data-proxy-id="' + escapeHtml(sid) + '" placeholder="Y (optional)"></div><div class="btp-nav-actions"><button class="btn btn-small proxy-navigate-btn" data-proxy-id="' + escapeHtml(sid) + '">Navigate</button><button class="btn btn-small btn-red proxy-stop-btn" data-proxy-id="' + escapeHtml(sid) + '">Stop</button></div></div></div></div>';
      container.innerHTML = html;
      attachProxyPlayerTabEvents(sid);
    }
    function attachProxyPlayerTabEvents(sessionId) {
      var panel = document.querySelector('.bot-tab-panel[data-proxy-id="' + sessionId + '"]');
      if (!panel) return;
      panel.querySelectorAll(".proxy-dpad-btn").forEach(function(btn) {
        btn.addEventListener("click", function() {
          socket.emit("proxy:walk", { sessionId, direction: parseInt(btn.dataset.dir) });
        });
      });
      var walkBtn = panel.querySelector(".proxy-walk-btn");
      if (walkBtn) {
        walkBtn.addEventListener("click", function() {
          var x = parseInt(panel.querySelector(".proxy-nav-x").value);
          var y = parseInt(panel.querySelector(".proxy-nav-y").value);
          if (isNaN(x) || isNaN(y)) {
            showToast("Enter X and Y coordinates");
            return;
          }
          socket.emit("proxy:walkTo", { sessionId, x, y });
          showToast("Walking to (" + x + ", " + y + ")...");
        });
      }
      var navBtn = panel.querySelector(".proxy-navigate-btn");
      if (navBtn) {
        navBtn.addEventListener("click", function() {
          var mapSelect = panel.querySelector(".proxy-nav-map-select");
          var mapId = parseInt(mapSelect.value);
          if (isNaN(mapId)) {
            showToast("Select a map first");
            return;
          }
          var x = parseInt(panel.querySelector(".proxy-nav-target-x").value);
          var y = parseInt(panel.querySelector(".proxy-nav-target-y").value);
          if (isNaN(x)) x = -1;
          if (isNaN(y)) y = -1;
          socket.emit("proxy:navigateTo", { sessionId, mapId, x, y });
          var mapName = mapSelect.options[mapSelect.selectedIndex].textContent;
          showToast("Navigating to " + mapName + "...");
        });
      }
      var stopBtn = panel.querySelector(".proxy-stop-btn");
      if (stopBtn) {
        stopBtn.addEventListener("click", function() {
          socket.emit("proxy:stop", { sessionId });
          showToast("Navigation stopped.");
        });
      }
    }
    function getMapName(mapId) {
      var mapListCache = getMapListCache();
      if (!mapListCache || !mapListCache.nodes) return "";
      for (var i = 0; i < mapListCache.nodes.length; i++) {
        if (mapListCache.nodes[i].mapId === mapId) return mapListCache.nodes[i].mapName;
      }
      return "";
    }
    var editingNpcSerial = null;
    function syncAmbientSpeechVisibility() {
      var enabledEl = document.getElementById("proxy-npc-ambient-enabled");
      var fieldsEl = document.getElementById("proxy-npc-ambient-fields");
      if (!enabledEl || !fieldsEl) return;
      fieldsEl.style.display = enabledEl.checked ? "" : "none";
    }
    function setAmbientSpeechForm(ambientSpeech) {
      var enabledEl = document.getElementById("proxy-npc-ambient-enabled");
      var intervalEl = document.getElementById("proxy-npc-ambient-interval");
      var messagesEl = document.getElementById("proxy-npc-ambient-messages");
      if (!enabledEl || !intervalEl || !messagesEl) return;
      var hasAmbientSpeech = !!(ambientSpeech && ambientSpeech.messages && ambientSpeech.messages.length);
      enabledEl.checked = hasAmbientSpeech;
      intervalEl.value = hasAmbientSpeech && ambientSpeech.intervalSeconds ? ambientSpeech.intervalSeconds : 30;
      messagesEl.value = hasAmbientSpeech ? ambientSpeech.messages.join("\n") : "";
      syncAmbientSpeechVisibility();
    }
    function renderProxyNpcs() {
      var container = document.getElementById("proxy-npc-list");
      if (!container) return;
      if (proxyNpcs.length === 0) {
        container.innerHTML = '<div class="rules-empty">No virtual NPCs placed.</div>';
        return;
      }
      var dirNames = ["Up", "Right", "Down", "Left"];
      var html = "";
      for (var i = 0; i < proxyNpcs.length; i++) {
        var npc = proxyNpcs[i];
        var mapName = getMapName(npc.mapNumber);
        var hasDialog = npc.dialog && npc.dialog.greeting;
        var hasHandler = npc.hasHandler;
        var isMonsterKeeper = !!npc.isMonsterKeeper;
        var isFishingNpc = !!npc.isFishingNpc;
        var hasAmbientSpeech = npc.ambientSpeech && npc.ambientSpeech.messages && npc.ambientSpeech.messages.length > 0;
        html += '<div class="rule-row" style="padding:0.5rem 0.75rem">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center">';
        html += "<div>";
        html += "<strong>" + escapeHtml(npc.name) + "</strong>";
        html += ' <span style="opacity:0.5;font-size:0.8em">Sprite ' + npc.sprite + "</span>";
        if (hasDialog) html += ' <span style="color:#6bf;font-size:0.75em" title="' + escapeHtml(npc.dialog.greeting) + '">\u{1F4AC}</span>';
        if (hasHandler) html += ' <span style="color:#f90;font-size:0.75em" title="Has dynamic handler">\u26A1</span>';
        if (isMonsterKeeper) html += ' <span style="color:#9f6;font-size:0.75em" title="Current Monster Keeper">Keeper</span>';
        if (isFishingNpc) html += ' <span style="color:#7fd;font-size:0.75em" title="Current Fishing Master">Fishing</span>';
        if (hasAmbientSpeech) html += ' <span style="color:#8fd;font-size:0.75em" title="Periodic ambient speech enabled">Speech</span>';
        html += "</div>";
        html += '<div style="display:flex;gap:4px">';
        html += '<button class="btn btn-small" onclick="window._proxyEditNpc(' + npc.serial + ')" style="color:#6bf;font-size:0.75em">Edit</button>';
        html += '<button class="btn btn-small" onclick="window._proxyKeeperNpc(' + npc.serial + ')" style="color:' + (isMonsterKeeper ? "#9f6" : "#8fd") + ';font-size:0.75em" title="Assign as Monster Keeper">' + (isMonsterKeeper ? "Keeper \u2713" : "Keeper") + "</button>";
        html += '<button class="btn btn-small" onclick="window._proxyFishingNpc(' + npc.serial + ')" style="color:' + (isFishingNpc ? "#7fd" : "#8fd") + ';font-size:0.75em" title="Assign as Fishing Master">' + (isFishingNpc ? "Fishing \u2713" : "Fishing") + "</button>";
        html += '<button class="btn btn-small" onclick="window._proxyAuctionNpc(' + npc.serial + ')" style="color:#f90;font-size:0.75em" title="Assign auction handler">Auction</button>';
        html += '<button class="btn btn-small" onclick="window._proxyRemoveNpc(' + npc.serial + ')" style="color:#f66;font-size:0.75em">Remove</button>';
        html += "</div>";
        html += "</div>";
        html += '<div style="font-size:0.78em;opacity:0.55;margin-top:2px">';
        html += escapeHtml(mapName || "Map " + npc.mapNumber) + " (" + npc.x + "," + npc.y + ") " + (dirNames[npc.direction] || "");
        html += ' <span style="opacity:0.6">| 0x' + npc.serial.toString(16).toUpperCase() + "</span>";
        html += "</div>";
        if (hasAmbientSpeech) {
          html += '<div style="font-size:0.76em;opacity:0.68;margin-top:4px">';
          html += "Ambient speech every " + npc.ambientSpeech.intervalSeconds + "s";
          html += " | " + npc.ambientSpeech.messages.length + " line" + (npc.ambientSpeech.messages.length === 1 ? "" : "s");
          html += "</div>";
        }
        html += "</div>";
      }
      container.innerHTML = html;
    }
    window._proxyRemoveNpc = function(serial) {
      socket.emit("proxy:npc:remove", { serial });
    };
    window._proxyEditNpc = function(serial) {
      var npc = null;
      for (var i = 0; i < proxyNpcs.length; i++) {
        if (proxyNpcs[i].serial === serial) {
          npc = proxyNpcs[i];
          break;
        }
      }
      if (!npc) return;
      editingNpcSerial = serial;
      document.getElementById("proxy-npc-name").value = npc.name;
      document.getElementById("proxy-npc-sprite").value = npc.sprite;
      document.getElementById("proxy-npc-dir").value = npc.direction;
      document.getElementById("proxy-npc-x").value = npc.x;
      document.getElementById("proxy-npc-y").value = npc.y;
      var mapSelect = document.getElementById("proxy-npc-map");
      mapSelect.value = npc.mapNumber;
      if (!mapSelect.value) {
        var opt = document.createElement("option");
        opt.value = npc.mapNumber;
        opt.textContent = "Map " + npc.mapNumber;
        mapSelect.appendChild(opt);
        mapSelect.value = npc.mapNumber;
      }
      dialogSteps = [];
      if (npc.dialog && npc.dialog.steps && npc.dialog.steps.length > 0) {
        for (var j = 0; j < npc.dialog.steps.length; j++) {
          var s = npc.dialog.steps[j];
          dialogSteps.push({
            type: s.type || "popup",
            text: s.text || "",
            autoClose: !!s.autoClose,
            options: (s.options || []).map(function(o) {
              return { text: o.text || "", action: o.action || "close", gotoStep: o.gotoStep };
            })
          });
        }
      }
      setAmbientSpeechForm(npc.ambientSpeech || null);
      renderDialogSteps();
      var placeBtn = document.getElementById("btn-proxy-npc-place");
      if (placeBtn) placeBtn.textContent = "Update NPC";
      showToast('Editing "' + npc.name + '" \u2014 change fields and click Update');
    };
    window._proxyAuctionNpc = function(serial) {
      socket.emit("proxy:npc:auction", { serial });
    };
    window._proxyKeeperNpc = function(serial) {
      socket.emit("proxy:npc:keeper", { serial });
    };
    window._proxyFishingNpc = function(serial) {
      socket.emit("proxy:npc:fishing", { serial });
    };
    function appendProxyLog(entries) {
      var logEl = document.getElementById("proxy-packet-log");
      var enabled = document.getElementById("proxy-log-enabled");
      if (!logEl || !enabled || !enabled.checked) return;
      if (logEl.querySelector(".rules-empty")) logEl.innerHTML = "";
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var dir = e.dir === "client-to-server" ? '<span style="color:#6bf">C\u2192S</span>' : '<span style="color:#fb6">S\u2192C</span>';
        var op = "0x" + ("0" + e.op.toString(16)).slice(-2).toUpperCase();
        var line = document.createElement("div");
        line.innerHTML = dir + ' <span style="color:#aaa">[' + (e.char || e.sid) + "]</span> " + op + ' <span style="opacity:0.5">' + e.len + "b</span>";
        logEl.appendChild(line);
      }
      while (logEl.childNodes.length > 500) logEl.removeChild(logEl.firstChild);
      logEl.scrollTop = logEl.scrollHeight;
    }
    socket.on("proxy:sessions", function(sessions) {
      proxySessions = sessions;
      renderProxySessions();
    });
    socket.on("proxy:players", function() {
      renderProxySessions();
    });
    socket.on("proxy:npcs", function(npcs) {
      proxyNpcs = npcs;
      renderProxyNpcs();
    });
    socket.on("proxy:session:new", function(data) {
      proxySessions.push(data);
      renderProxySessions();
    });
    socket.on("proxy:session:game", function(data) {
      for (var i = 0; i < proxySessions.length; i++) {
        if (proxySessions[i].id === data.id) {
          proxySessions[i].characterName = data.characterName;
          proxySessions[i].phase = "game";
          break;
        }
      }
      renderProxySessions();
    });
    socket.on("proxy:session:end", function(data) {
      proxySessions = proxySessions.filter(function(s) {
        return s.id !== data.id;
      });
      delete proxyNavStatuses[data.id];
      if (activeProxyPlayerId === data.id) activeProxyPlayerId = null;
      renderProxySessions();
    });
    socket.on("proxy:playerUpdate", function(data) {
      for (var i = 0; i < proxySessions.length; i++) {
        if (proxySessions[i].id === data.sessionId) {
          if (!proxySessions[i].playerState) proxySessions[i].playerState = {};
          if (data.x !== void 0) proxySessions[i].playerState.x = data.x;
          if (data.y !== void 0) proxySessions[i].playerState.y = data.y;
          if (data.mapNumber !== void 0) proxySessions[i].playerState.mapNumber = data.mapNumber;
          break;
        }
      }
      if (data.sessionId === activeProxyPlayerId) renderActiveProxyPlayerTab();
    });
    socket.on("proxy:navStatus", function(data) {
      proxyNavStatuses[data.sessionId] = { state: data.state, target: data.target };
      if (data.sessionId === activeProxyPlayerId) renderActiveProxyPlayerTab();
      renderProxyPlayerTabBar();
    });
    socket.on("proxy:packets", function(entries) {
      appendProxyLog(entries);
    });
    socket.on("proxy:npc:placed", function(data) {
      showToast("NPC placed (serial: " + data.serial + ")");
    });
    socket.on("proxy:npc:click", function(data) {
      var logEl = document.getElementById("proxy-npc-clicks");
      if (!logEl) return;
      if (logEl.querySelector(".rules-empty")) logEl.innerHTML = "";
      var entry = document.createElement("div");
      entry.style.padding = "2px 0";
      var mapName = getMapName(data.mapNumber);
      entry.textContent = "[" + (/* @__PURE__ */ new Date()).toLocaleTimeString() + "] " + data.playerName + ' \u2192 "' + data.npcName + '"' + (mapName ? " (" + mapName + ")" : "");
      logEl.appendChild(entry);
      while (logEl.childNodes.length > 50) logEl.removeChild(logEl.firstChild);
      logEl.scrollTop = logEl.scrollHeight;
    });
    var dialogSteps = [];
    var DIALOG_STEP_LIMIT = 20;
    function syncStepsFromDOM() {
      var container = document.getElementById("proxy-npc-steps-list");
      if (!container) return;
      var stepEls = container.querySelectorAll(".dialog-step");
      for (var i = 0; i < stepEls.length; i++) {
        var el = stepEls[i];
        var step = dialogSteps[i];
        if (!step) continue;
        step.type = el.querySelector(".dialog-step-type").value;
        step.text = el.querySelector(".dialog-step-text").value;
        var acEl = el.querySelector(".dialog-step-autoclose");
        step.autoClose = acEl ? acEl.checked : false;
        if (step.type === "menu") {
          var optRows = el.querySelectorAll(".dialog-step-option-row");
          step.options = [];
          for (var j = 0; j < optRows.length; j++) {
            var textEl = optRows[j].querySelector(".dialog-option-text");
            var actionEl = optRows[j].querySelector(".dialog-option-action");
            var gotoEl = optRows[j].querySelector(".dialog-option-goto");
            step.options.push({
              text: textEl ? textEl.value : "",
              action: actionEl ? actionEl.value : "close",
              gotoStep: actionEl && actionEl.value === "goto" && gotoEl ? parseInt(gotoEl.value) : void 0
            });
          }
        }
      }
    }
    function renderDialogSteps() {
      var container = document.getElementById("proxy-npc-steps-list");
      if (!container) return;
      container.innerHTML = "";
      for (var i = 0; i < dialogSteps.length; i++) {
        container.appendChild(buildStepCard(i));
      }
    }
    function buildStepCard(idx) {
      var step = dialogSteps[idx];
      var card = document.createElement("div");
      card.className = "dialog-step";
      card.setAttribute("data-step-index", idx);
      var header = document.createElement("div");
      header.className = "dialog-step-header";
      var numLabel = document.createElement("span");
      numLabel.className = "dialog-step-number";
      numLabel.textContent = "Step " + idx;
      header.appendChild(numLabel);
      var typeSelect = document.createElement("select");
      typeSelect.className = "dialog-step-type";
      typeSelect.innerHTML = '<option value="popup"' + (step.type === "popup" ? " selected" : "") + '>Popup</option><option value="menu"' + (step.type === "menu" ? " selected" : "") + ">Menu</option>";
      typeSelect.addEventListener("change", /* @__PURE__ */ (function(i) {
        return function() {
          syncStepsFromDOM();
          dialogSteps[i].type = this.value;
          if (this.value === "menu" && (!dialogSteps[i].options || dialogSteps[i].options.length === 0)) {
            dialogSteps[i].options = [];
          }
          renderDialogSteps();
        };
      })(idx));
      header.appendChild(typeSelect);
      if (step.type === "popup") {
        var acLabel = document.createElement("label");
        acLabel.className = "dialog-step-autoclose-label";
        acLabel.innerHTML = '<input type="checkbox" class="dialog-step-autoclose"' + (step.autoClose ? " checked" : "") + " /> Auto-close";
        header.appendChild(acLabel);
      }
      var removeBtn = document.createElement("button");
      removeBtn.className = "btn btn-small";
      removeBtn.style.color = "#f66";
      removeBtn.style.marginLeft = "auto";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", /* @__PURE__ */ (function(i) {
        return function() {
          removeDialogStep(i);
        };
      })(idx));
      header.appendChild(removeBtn);
      card.appendChild(header);
      var textarea = document.createElement("textarea");
      textarea.className = "dialog-step-text";
      textarea.rows = 2;
      textarea.placeholder = idx === 0 ? "Greeting / dialog text..." : "Dialog text for this step...";
      textarea.value = step.text || "";
      card.appendChild(textarea);
      if (step.type === "menu") {
        var optContainer = document.createElement("div");
        optContainer.className = "dialog-step-options";
        var opts = step.options || [];
        for (var j = 0; j < opts.length; j++) {
          optContainer.appendChild(buildOptionRow(idx, j, opts[j]));
        }
        var btnRow = document.createElement("div");
        btnRow.className = "dialog-step-option-btns";
        var addOptBtn = document.createElement("button");
        addOptBtn.type = "button";
        addOptBtn.className = "btn btn-small";
        addOptBtn.textContent = "+ Option";
        addOptBtn.addEventListener("click", /* @__PURE__ */ (function(i) {
          return function() {
            syncStepsFromDOM();
            addOptionToStep(i);
          };
        })(idx));
        btnRow.appendChild(addOptBtn);
        var addOptStepBtn = document.createElement("button");
        addOptStepBtn.type = "button";
        addOptStepBtn.className = "btn btn-small";
        addOptStepBtn.style.color = "#6bf";
        addOptStepBtn.innerHTML = "+ Option &rarr; New Step";
        addOptStepBtn.addEventListener("click", /* @__PURE__ */ (function(i) {
          return function() {
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
      var row = document.createElement("div");
      row.className = "dialog-step-option-row";
      var textInput = document.createElement("input");
      textInput.type = "text";
      textInput.className = "dialog-option-text";
      textInput.placeholder = "Option text";
      textInput.value = opt.text || "";
      row.appendChild(textInput);
      var actionSelect = document.createElement("select");
      actionSelect.className = "dialog-option-action";
      actionSelect.innerHTML = '<option value="close"' + (opt.action !== "goto" ? " selected" : "") + '>Close</option><option value="goto"' + (opt.action === "goto" ? " selected" : "") + ">Go to step\u2026</option>";
      row.appendChild(actionSelect);
      var gotoSelect = document.createElement("select");
      gotoSelect.className = "dialog-option-goto";
      gotoSelect.style.display = opt.action === "goto" ? "" : "none";
      for (var k = 0; k < dialogSteps.length; k++) {
        if (k === stepIdx) continue;
        var goOpt = document.createElement("option");
        goOpt.value = k;
        goOpt.textContent = "Step " + k;
        if (opt.action === "goto" && opt.gotoStep === k) goOpt.selected = true;
        gotoSelect.appendChild(goOpt);
      }
      row.appendChild(gotoSelect);
      actionSelect.addEventListener("change", function() {
        gotoSelect.style.display = this.value === "goto" ? "" : "none";
        if (this.value === "goto" && !gotoSelect.value) {
          for (var m = 0; m < dialogSteps.length; m++) {
            if (m !== stepIdx) {
              gotoSelect.value = m;
              break;
            }
          }
        }
      });
      gotoSelect.addEventListener("change", function() {
        highlightStep(parseInt(this.value));
      });
      var removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn btn-small";
      removeBtn.style.color = "#f66";
      removeBtn.innerHTML = "&times;";
      removeBtn.addEventListener("click", /* @__PURE__ */ (function(si, oi) {
        return function() {
          syncStepsFromDOM();
          removeOption(si, oi);
        };
      })(stepIdx, optIdx));
      row.appendChild(removeBtn);
      return row;
    }
    function addDialogStep(type) {
      if (dialogSteps.length >= DIALOG_STEP_LIMIT) {
        showToast("Step limit reached (" + DIALOG_STEP_LIMIT + ")");
        return -1;
      }
      syncStepsFromDOM();
      var newIdx = dialogSteps.length;
      dialogSteps.push({ type, text: "", options: type === "menu" ? [] : void 0, autoClose: false });
      renderDialogSteps();
      return newIdx;
    }
    function removeDialogStep(index) {
      if (index < 0 || index >= dialogSteps.length) return;
      syncStepsFromDOM();
      dialogSteps.splice(index, 1);
      for (var i = 0; i < dialogSteps.length; i++) {
        var opts = dialogSteps[i].options;
        if (!opts) continue;
        for (var j = 0; j < opts.length; j++) {
          if (opts[j].action === "goto" && opts[j].gotoStep !== void 0) {
            if (opts[j].gotoStep === index) {
              opts[j].action = "close";
              opts[j].gotoStep = void 0;
            } else if (opts[j].gotoStep > index) {
              opts[j].gotoStep--;
            }
          }
        }
      }
      renderDialogSteps();
      if (dialogSteps.length === 0) return;
      showToast("Step removed. Goto references updated.");
    }
    function addOptionToStep(stepIndex) {
      var step = dialogSteps[stepIndex];
      if (!step || step.type !== "menu") return;
      if (!step.options) step.options = [];
      step.options.push({ text: "", action: "close" });
      renderDialogSteps();
    }
    function addOptionWithNewStep(stepIndex) {
      var step = dialogSteps[stepIndex];
      if (!step || step.type !== "menu") return;
      if (!step.options) step.options = [];
      var newStepIdx = dialogSteps.length;
      if (newStepIdx >= DIALOG_STEP_LIMIT) {
        showToast("Step limit reached (" + DIALOG_STEP_LIMIT + ")");
        return;
      }
      dialogSteps.push({ type: "menu", text: "", options: [], autoClose: false });
      step.options.push({ text: "", action: "goto", gotoStep: newStepIdx });
      renderDialogSteps();
      var container = document.getElementById("proxy-npc-steps-list");
      if (container && container.lastChild) {
        container.lastChild.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
      var container = document.getElementById("proxy-npc-steps-list");
      if (!container) return;
      var stepEls = container.querySelectorAll(".dialog-step");
      if (!stepEls[index]) return;
      stepEls[index].classList.add("highlight-target");
      setTimeout(function() {
        if (stepEls[index]) stepEls[index].classList.remove("highlight-target");
      }, 800);
    }
    var btnAddStep = document.getElementById("btn-proxy-npc-add-step");
    if (btnAddStep) {
      btnAddStep.addEventListener("click", function() {
        addDialogStep("popup");
      });
    }
    var btnAddStepMenu = document.getElementById("btn-proxy-npc-add-step-menu");
    if (btnAddStepMenu) {
      btnAddStepMenu.addEventListener("click", function() {
        addDialogStep("menu");
      });
    }
    var ambientSpeechEnabledEl = document.getElementById("proxy-npc-ambient-enabled");
    if (ambientSpeechEnabledEl) {
      ambientSpeechEnabledEl.addEventListener("change", syncAmbientSpeechVisibility);
    }
    setAmbientSpeechForm(null);
    var btnPlaceNpc = document.getElementById("btn-proxy-npc-place");
    if (btnPlaceNpc) {
      btnPlaceNpc.addEventListener("click", function() {
        var mapVal = document.getElementById("proxy-npc-map").value;
        if (!mapVal) {
          showToast("Select a map first");
          return;
        }
        syncStepsFromDOM();
        var parsedDirection = parseInt(document.getElementById("proxy-npc-dir").value, 10);
        var placeData = {
          name: document.getElementById("proxy-npc-name").value || "NPC",
          sprite: parseInt(document.getElementById("proxy-npc-sprite").value) || 1,
          mapNumber: parseInt(mapVal),
          x: parseInt(document.getElementById("proxy-npc-x").value) || 0,
          y: parseInt(document.getElementById("proxy-npc-y").value) || 0,
          direction: isNaN(parsedDirection) ? 2 : parsedDirection
        };
        var ambientEnabled = document.getElementById("proxy-npc-ambient-enabled");
        var ambientInterval = document.getElementById("proxy-npc-ambient-interval");
        var ambientMessages = document.getElementById("proxy-npc-ambient-messages");
        if (ambientEnabled && ambientEnabled.checked) {
          var intervalSeconds = parseInt(ambientInterval.value, 10);
          if (isNaN(intervalSeconds) || intervalSeconds < 5) {
            showToast("Ambient speech interval must be at least 5 seconds");
            return;
          }
          var speechLines = (ambientMessages.value || "").split(/\r?\n/).map(function(line) {
            return line.trim();
          }).filter(Boolean);
          if (speechLines.length === 0) {
            showToast("Ambient speech needs at least one message");
            return;
          }
          placeData.ambientSpeech = {
            intervalSeconds,
            messages: speechLines
          };
        } else {
          placeData.ambientSpeech = null;
        }
        if (dialogSteps.length > 0) {
          for (var i = 0; i < dialogSteps.length; i++) {
            if (!dialogSteps[i].text.trim()) {
              showToast("Step " + i + " has empty text");
              highlightStep(i);
              return;
            }
          }
          for (var i = 0; i < dialogSteps.length; i++) {
            var opts = dialogSteps[i].options;
            if (!opts) continue;
            for (var j = 0; j < opts.length; j++) {
              if (opts[j].action === "goto") {
                var target = opts[j].gotoStep;
                if (target === void 0 || target < 0 || target >= dialogSteps.length) {
                  showToast("Step " + i + ', option "' + (opts[j].text || j) + '" has invalid goto target');
                  highlightStep(i);
                  return;
                }
              }
            }
          }
          var greeting = dialogSteps[0].text.trim();
          placeData.dialog = {
            greeting,
            steps: dialogSteps.map(function(s) {
              var step = { type: s.type, text: s.text.trim() };
              if (s.autoClose) step.autoClose = true;
              if (s.type === "menu" && s.options && s.options.length > 0) {
                step.options = s.options.map(function(o) {
                  var opt = { text: o.text.trim() };
                  if (o.action === "goto" && o.gotoStep !== void 0) {
                    opt.action = "goto";
                    opt.gotoStep = o.gotoStep;
                  } else {
                    opt.action = "close";
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
          socket.emit("proxy:npc:edit", placeData);
          editingNpcSerial = null;
          var placeBtn = document.getElementById("btn-proxy-npc-place");
          if (placeBtn) placeBtn.textContent = "Place NPC";
        } else {
          socket.emit("proxy:npc:place", placeData);
        }
        dialogSteps = [];
        renderDialogSteps();
      });
    }
    var btnChatSend = document.getElementById("btn-proxy-chat-send");
    if (btnChatSend) {
      btnChatSend.addEventListener("click", function() {
        var target = document.getElementById("proxy-chat-target").value;
        var data = {
          channel: document.getElementById("proxy-chat-channel").value,
          message: document.getElementById("proxy-chat-message").value,
          sender: document.getElementById("proxy-chat-sender").value || void 0
        };
        if (target === "broadcast") {
          data.broadcast = true;
        } else {
          data.sessionId = target;
        }
        socket.emit("proxy:chat:send", data);
        document.getElementById("proxy-chat-message").value = "";
      });
    }
    var btnClearLog = document.getElementById("btn-proxy-log-clear");
    if (btnClearLog) {
      btnClearLog.addEventListener("click", function() {
        var logEl = document.getElementById("proxy-packet-log");
        if (logEl) logEl.innerHTML = '<div class="rules-empty">Waiting for packets...</div>';
      });
    }
    var packetLog = document.getElementById("packet-log");
    var MAX_PACKETS = 500;
    socket.on("packet:data", function(pkt) {
      if (!packetLog) return;
      var showIn = document.getElementById("pkt-show-in").checked;
      var showOut = document.getElementById("pkt-show-out").checked;
      if (pkt.direction === "in" && !showIn) return;
      if (pkt.direction === "out" && !showOut) return;
      var botFilter = document.getElementById("pkt-bot-filter").value;
      if (botFilter !== "all" && pkt.botId !== botFilter) return;
      var filterText = document.getElementById("pkt-filter").value.trim().toLowerCase();
      if (filterText) {
        if (pkt.opcode.toLowerCase().indexOf(filterText) === -1 && pkt.label.toLowerCase().indexOf(filterText) === -1) return;
      }
      var entry = document.createElement("div");
      entry.className = "packet-entry packet-" + pkt.direction;
      var time = new Date(pkt.timestamp).toLocaleTimeString();
      var arrow = pkt.direction === "in" ? "<<<" : ">>>";
      var botStates = getBotStates();
      var botLabel = pkt.botId ? botStates[pkt.botId] ? botStates[pkt.botId].username : pkt.botId : "";
      entry.innerHTML = '<span class="pkt-bot">' + escapeHtml(botLabel) + '</span><span class="pkt-time">' + time + '</span><span class="pkt-dir">' + arrow + '</span><span class="pkt-opcode">' + pkt.opcode + '</span><span class="pkt-label">' + escapeHtml(pkt.label) + '</span><span class="pkt-size">' + pkt.bodyLength + 'B</span><div class="pkt-hex">' + escapeHtml(pkt.hexDump) + "</div>";
      entry.addEventListener("click", function() {
        entry.classList.toggle("expanded");
      });
      packetLog.appendChild(entry);
      while (packetLog.children.length > MAX_PACKETS) {
        packetLog.removeChild(packetLog.firstChild);
      }
      if (document.getElementById("pkt-auto-scroll").checked) {
        packetLog.scrollTop = packetLog.scrollHeight;
      }
    });
    var btnPacketClear = document.getElementById("pkt-clear");
    if (btnPacketClear) {
      btnPacketClear.addEventListener("click", function() {
        if (packetLog) packetLog.innerHTML = "";
      });
    }
    var btnCaptureStart = document.getElementById("btn-proxy-capture-start");
    var btnCaptureStop = document.getElementById("btn-proxy-capture-stop");
    var btnCaptureCopy = document.getElementById("btn-proxy-capture-copy");
    var captureStatusEl = document.getElementById("proxy-capture-status");
    var captureOutputEl = document.getElementById("proxy-capture-output");
    if (btnCaptureStart) {
      btnCaptureStart.addEventListener("click", function() {
        var opStr = (document.getElementById("proxy-capture-opcodes").value || "").trim();
        var opcodes = [];
        if (opStr) {
          opStr.split(/[,\s]+/).forEach(function(s) {
            var v = parseInt(s.replace(/^0x/i, ""), 16);
            if (!isNaN(v)) opcodes.push(v);
          });
        }
        socket.emit("proxy:capture:start", { opcodes });
        btnCaptureStart.disabled = true;
        btnCaptureStop.disabled = false;
        captureStatusEl.textContent = "Capturing...";
        captureStatusEl.style.color = "#0f0";
      });
    }
    if (btnCaptureStop) {
      btnCaptureStop.addEventListener("click", function() {
        socket.emit("proxy:capture:stop");
        btnCaptureStart.disabled = false;
        btnCaptureStop.disabled = true;
      });
    }
    if (btnCaptureCopy) {
      btnCaptureCopy.addEventListener("click", function() {
        socket.emit("proxy:capture:get");
      });
    }
    socket.on("proxy:capture:status", function(data) {
      if (captureStatusEl) {
        if (data.enabled) {
          captureStatusEl.textContent = "Capturing... (" + data.count + " packets)";
          captureStatusEl.style.color = "#0f0";
        } else {
          captureStatusEl.textContent = "Stopped (" + data.count + " packets)";
          captureStatusEl.style.color = "#fa0";
          btnCaptureStart.disabled = false;
          btnCaptureStop.disabled = true;
        }
      }
    });
    socket.on("proxy:capture:data", function(packets) {
      if (!captureOutputEl) return;
      if (packets.length === 0) {
        captureOutputEl.style.display = "block";
        captureOutputEl.textContent = "No captured packets.";
        return;
      }
      var dirLabel = { "client-to-server": "C>S", "server-to-client": "S>C" };
      var lines = packets.map(function(p) {
        var dir = dirLabel[p.dir] || p.dir;
        var op = "0x" + ("0" + p.op.toString(16)).slice(-2).toUpperCase();
        var char = p.char || p.sid;
        return dir + " [" + char + "] " + op + " (" + p.len + "b)\n" + (p.hex || "(no body)");
      });
      var text = lines.join("\n\n");
      captureOutputEl.style.display = "block";
      captureOutputEl.textContent = text;
      navigator.clipboard.writeText(text).then(function() {
        showToast("Captured " + packets.length + " packets copied to clipboard");
      }).catch(function() {
        showToast("Packets shown below \u2014 select and copy manually");
      });
    });
    var grindStatuses = {};
    function updateGrindSessionSelect() {
      var select = document.getElementById("grind-session-select");
      if (!select) return;
      var current = select.value;
      select.innerHTML = '<option value="">-- Select Player --</option>';
      var gameSessions = proxySessions.filter(function(s) {
        return s.phase === "game" && s.characterName;
      });
      gameSessions.forEach(function(s) {
        var opt = document.createElement("option");
        opt.value = s.id;
        opt.textContent = s.characterName || s.id;
        select.appendChild(opt);
      });
      if (current) select.value = current;
      if (!select.value && gameSessions.length === 1) {
        select.value = gameSessions[0].id;
        onGrindSessionSelected(gameSessions[0].id);
      }
    }
    function onGrindSessionSelected(sessionId) {
      if (sessionId) {
        socket.emit("grind:getStatus", { sessionId });
      }
    }
    var grindSelect = document.getElementById("grind-session-select");
    if (grindSelect) {
      grindSelect.addEventListener("change", function() {
        onGrindSessionSelected(grindSelect.value);
      });
    }
    document.querySelectorAll(".proxy-tab").forEach(function(tab) {
      tab.addEventListener("click", function() {
        if (tab.getAttribute("data-proxy-tab") === "grind") {
          updateGrindSessionSelect();
          var sid = document.getElementById("grind-session-select").value;
          if (sid) socket.emit("grind:getStatus", { sessionId: sid });
        }
      });
    });
    var btnGrindStart = document.getElementById("btn-grind-start");
    var btnGrindStop = document.getElementById("btn-grind-stop");
    if (btnGrindStart) {
      btnGrindStart.addEventListener("click", function() {
        var sid = document.getElementById("grind-session-select").value;
        if (!sid) {
          showToast("Select a player first");
          return;
        }
        socket.emit("grind:start", { sessionId: sid });
      });
    }
    if (btnGrindStop) {
      btnGrindStop.addEventListener("click", function() {
        var sid = document.getElementById("grind-session-select").value;
        if (!sid) return;
        socket.emit("grind:stop", { sessionId: sid });
      });
    }
    var btnGrindApply = document.getElementById("btn-grind-apply");
    if (btnGrindApply) {
      btnGrindApply.addEventListener("click", function() {
        var sid = document.getElementById("grind-session-select").value;
        if (!sid) {
          showToast("Select a player first");
          return;
        }
        var data = {
          sessionId: sid,
          primaryAttack: document.getElementById("grind-primary-attack").value,
          secondaryAttack: document.getElementById("grind-secondary-attack").value,
          curse: document.getElementById("grind-curse").value,
          fasSpell: document.getElementById("grind-fas").value,
          pramhSpell: document.getElementById("grind-pramh").value,
          targetMode: document.getElementById("grind-target-mode").value,
          curseMode: document.getElementById("grind-curse-mode").value,
          engagementMode: document.getElementById("grind-engagement").value,
          attackRange: document.getElementById("grind-attack-range").value,
          minMpPercent: document.getElementById("grind-min-mp").value,
          walkSpeed: document.getElementById("grind-walk-speed").value,
          assailEnabled: document.getElementById("grind-assail").checked,
          assailBetweenSpells: document.getElementById("grind-assail-between").checked,
          halfCast: document.getElementById("grind-halfcast").checked,
          pramhSpam: document.getElementById("grind-pramh-spam").checked,
          useAmbush: document.getElementById("grind-ambush").checked,
          useCrash: document.getElementById("grind-crash").checked,
          healEnabled: document.getElementById("grind-heal-enabled").checked,
          hpPotionThreshold: document.getElementById("grind-hp-pot-threshold").value,
          mpPotionThreshold: document.getElementById("grind-mp-pot-threshold").value,
          hpSpellThreshold: document.getElementById("grind-hp-spell-threshold").value,
          mpRecoverySpell: document.getElementById("grind-mp-recovery").value,
          aoCursesSelf: document.getElementById("grind-ao-curses").checked,
          aoSuainSelf: document.getElementById("grind-ao-suain").checked,
          aoPuinseinSelf: document.getElementById("grind-ao-poison").checked,
          counterAttack: document.getElementById("grind-counter-attack").checked,
          dionEnabled: document.getElementById("grind-dion-enabled").checked,
          dionType: document.getElementById("grind-dion-type").value,
          dionHpThreshold: document.getElementById("grind-dion-hp").value,
          lootEnabled: document.getElementById("grind-loot-enabled").checked,
          lootFilterMode: document.getElementById("grind-loot-mode").value,
          lootAntiSteal: document.getElementById("grind-loot-anti-steal").checked,
          lootWalkToLoot: document.getElementById("grind-loot-walk").checked,
          lootOnlyWhenNotMobbed: document.getElementById("grind-loot-not-mobbed").checked
        };
        socket.emit("grind:applyConfig", data);
      });
    }
    var btnIgnoreAdd = document.getElementById("btn-grind-ignore-add");
    if (btnIgnoreAdd) {
      btnIgnoreAdd.addEventListener("click", function() {
        var sid = document.getElementById("grind-session-select").value;
        var input = document.getElementById("grind-ignore-input");
        if (!sid || !input.value.trim()) return;
        socket.emit("grind:ignoreAdd", { sessionId: sid, value: input.value.trim() });
        input.value = "";
      });
    }
    var btnLootAdd = document.getElementById("btn-grind-loot-add");
    if (btnLootAdd) {
      btnLootAdd.addEventListener("click", function() {
        var sid = document.getElementById("grind-session-select").value;
        var input = document.getElementById("grind-loot-filter-input");
        if (!sid || !input.value.trim()) return;
        socket.emit("grind:lootFilterAdd", { sessionId: sid, value: input.value.trim() });
        input.value = "";
      });
    }
    socket.on("grind:status", function(data) {
      if (!data || !data.sessionId) return;
      grindStatuses[data.sessionId] = data;
      var selectedSid = document.getElementById("grind-session-select").value;
      if (data.sessionId === selectedSid) {
        renderGrindStatus(data);
      }
    });
    function renderGrindStatus(data) {
      var badge = document.getElementById("grind-status-badge");
      if (badge) {
        if (data.running) {
          badge.textContent = "RUNNING";
          badge.style.background = "rgba(0,255,100,0.2)";
          badge.style.color = "#0f6";
        } else {
          badge.textContent = "Idle";
          badge.style.background = "rgba(255,255,255,0.08)";
          badge.style.color = "";
        }
      }
      var hpPct = data.maxHp > 0 ? Math.round(data.hp / data.maxHp * 100) : 0;
      var mpPct = data.maxMp > 0 ? Math.round(data.mp / data.maxMp * 100) : 0;
      setEl("grind-stat-hp", data.hp + "/" + data.maxHp + " (" + hpPct + "%)");
      setEl("grind-stat-mp", data.mp + "/" + data.maxMp + " (" + mpPct + "%)");
      setEl("grind-stat-kills", String(data.kills || 0));
      setEl("grind-stat-kpm", String(data.kpm || "0.0"));
      setEl("grind-stat-target", "--");
      setEl("grind-stat-buffs", data.buffs && data.buffs.length > 0 ? data.buffs.join(", ") : "--");
      var hpEl = document.getElementById("grind-stat-hp");
      if (hpEl) {
        hpEl.style.color = hpPct > 70 ? "#0f6" : hpPct > 30 ? "#fa0" : "#f44";
      }
      if (data.config) {
        populateIfEmpty("grind-primary-attack", data.config.primaryAttack);
        populateIfEmpty("grind-secondary-attack", data.config.secondaryAttack);
        populateIfEmpty("grind-curse", data.config.curse);
        populateIfEmpty("grind-fas", data.config.fasSpell);
        populateIfEmpty("grind-pramh", data.config.pramhSpell);
        setSelect("grind-target-mode", data.config.targetMode);
        setSelect("grind-curse-mode", data.config.curseMode);
        setSelect("grind-engagement", data.config.engagementMode);
        setNumIfDefault("grind-attack-range", data.config.attackRange);
        setNumIfDefault("grind-min-mp", data.config.minMpPercent);
        setNumIfDefault("grind-walk-speed", data.config.walkSpeed);
      }
      if (data.config) {
        var ignoreList = document.getElementById("grind-ignore-list");
        if (ignoreList) {
          var items = (data.config.nameIgnoreList || []).concat((data.config.imageExcludeList || []).map(function(n) {
            return "img:" + n;
          }));
          if (items.length === 0) {
            ignoreList.innerHTML = '<span style="opacity:0.4">No ignores.</span>';
          } else {
            ignoreList.innerHTML = items.map(function(item) {
              return '<span style="display:inline-flex;align-items:center;gap:0.25rem;padding:1px 6px;margin:1px;background:rgba(255,255,255,0.08);border-radius:3px">' + escapeHtml(String(item)) + '<button class="grind-ignore-remove" data-value="' + escapeHtml(String(item).replace(/^img:/, "")) + '" style="background:none;border:none;color:#f66;cursor:pointer;font-size:0.9em;padding:0 2px">&times;</button></span>';
            }).join("");
            ignoreList.querySelectorAll(".grind-ignore-remove").forEach(function(btn) {
              btn.addEventListener("click", function() {
                var sid = document.getElementById("grind-session-select").value;
                socket.emit("grind:ignoreRemove", { sessionId: sid, value: btn.dataset.value });
              });
            });
          }
        }
      }
      if (data.lootConfig) {
        var lootList = document.getElementById("grind-loot-filter-list");
        if (lootList) {
          var lootItems = data.lootConfig.itemFilter || [];
          if (lootItems.length === 0) {
            lootList.innerHTML = '<span style="opacity:0.4">No filters.</span>';
          } else {
            lootList.innerHTML = lootItems.map(function(item) {
              return '<span style="display:inline-flex;align-items:center;gap:0.25rem;padding:1px 6px;margin:1px;background:rgba(255,255,255,0.08);border-radius:3px">' + escapeHtml(item) + '<button class="grind-loot-remove" data-value="' + escapeHtml(item) + '" style="background:none;border:none;color:#f66;cursor:pointer;font-size:0.9em;padding:0 2px">&times;</button></span>';
            }).join("");
            lootList.querySelectorAll(".grind-loot-remove").forEach(function(btn) {
              btn.addEventListener("click", function() {
                var sid = document.getElementById("grind-session-select").value;
                socket.emit("grind:lootFilterRemove", { sessionId: sid, value: btn.dataset.value });
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
      if (el && value !== void 0) el.value = value;
    }
    socket.on("proxy:sessions", function() {
      updateGrindSessionSelect();
    });
    socket.on("proxy:session:game", function() {
      setTimeout(updateGrindSessionSelect, 500);
    });
    socket.on("proxy:session:end", function(data) {
      delete grindStatuses[data.id];
      updateGrindSessionSelect();
    });
    var monData = { species: [], evolvedSpecies: [], moves: {} };
    document.querySelectorAll(".mon-tab").forEach(function(tab) {
      tab.addEventListener("click", function() {
        document.querySelectorAll(".mon-tab").forEach(function(t) {
          t.classList.remove("active");
          t.style.opacity = "0.6";
          t.style.borderBottomColor = "transparent";
        });
        tab.classList.add("active");
        tab.style.opacity = "1";
        tab.style.borderBottomColor = "#6bf";
        document.querySelectorAll(".mon-tab-content").forEach(function(c) {
          c.style.display = "none";
          c.classList.remove("active");
        });
        var target = document.getElementById("mon-content-" + tab.getAttribute("data-mon-tab"));
        if (target) {
          target.style.display = "";
          target.classList.add("active");
        }
      });
    });
    var monDataLoaded = false;
    function loadMonsterData() {
      socket.emit("monsters:getData");
      socket.emit("monsters:leaderboard");
    }
    document.querySelectorAll(".proxy-tab").forEach(function(tab) {
      tab.addEventListener("click", function() {
        if (tab.getAttribute("data-proxy-tab") === "monsters") {
          loadMonsterData();
        }
      });
    });
    socket.on("connect", function() {
      var activeMonTab = document.querySelector('.proxy-tab.active[data-proxy-tab="monsters"]');
      if (activeMonTab) loadMonsterData();
    });
    setTimeout(function() {
      if (!monDataLoaded) loadMonsterData();
    }, 2e3);
    socket.on("monsters:data", function(data) {
      monDataLoaded = true;
      monData = data;
      renderSpeciesList();
      renderEvolvedList();
      renderMovesList();
    });
    function saveMonsterData() {
      socket.emit("monsters:saveData", monData);
    }
    function renderSpeciesList() {
      var list = document.getElementById("mon-species-list");
      if (!list) return;
      if (!monData.species || monData.species.length === 0) {
        list.innerHTML = '<div class="rules-empty">No species defined. Click "+ Add Species" to create one.</div>';
        return;
      }
      list.innerHTML = "";
      monData.species.forEach(function(s, i) {
        var el = document.createElement("div");
        el.style.cssText = "padding:0.4rem 0.6rem;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;align-items:center";
        var evo = s.evolution ? " &rarr; " + s.evolution.name + " Lv." + s.evolution.level : "";
        var movesStr = Object.keys(s.moves || {}).sort(function(a, b) {
          return a - b;
        }).map(function(lv) {
          return "Lv" + lv + ":" + s.moves[lv];
        }).join(", ");
        el.innerHTML = "<div><strong>" + s.name + '</strong> <span style="opacity:0.5">[' + s.type + "]</span> Spr:" + s.sprite + evo + '<div style="font-size:0.8em;opacity:0.6">HP:' + s.baseHp + " ATK:" + s.baseAtk + " DEF:" + s.baseDef + " SPD:" + s.baseSpd + " SPA:" + s.baseSpAtk + " SPD:" + s.baseSpDef + '</div><div style="font-size:0.75em;opacity:0.45">' + movesStr + '</div></div><div style="display:flex;gap:0.25rem"><button class="btn btn-small" data-mon-edit="' + i + '" style="font-size:0.7em">Edit</button><button class="btn btn-small" data-mon-del="' + i + '" style="font-size:0.7em;color:#f66">Del</button></div>';
        list.appendChild(el);
      });
      list.querySelectorAll("[data-mon-edit]").forEach(function(b) {
        b.addEventListener("click", function() {
          editSpecies(parseInt(b.getAttribute("data-mon-edit")), false);
        });
      });
      list.querySelectorAll("[data-mon-del]").forEach(function(b) {
        b.addEventListener("click", function() {
          if (confirm("Delete this species?")) {
            monData.species.splice(parseInt(b.getAttribute("data-mon-del")), 1);
            saveMonsterData();
          }
        });
      });
    }
    function renderEvolvedList() {
      var list = document.getElementById("mon-evolved-list");
      if (!list) return;
      if (!monData.evolvedSpecies || monData.evolvedSpecies.length === 0) {
        list.innerHTML = '<div class="rules-empty">No evolved species.</div>';
        return;
      }
      list.innerHTML = "";
      monData.evolvedSpecies.forEach(function(s, i) {
        var el = document.createElement("div");
        el.style.cssText = "padding:0.4rem 0.6rem;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;align-items:center";
        el.innerHTML = "<div><strong>" + s.name + '</strong> <span style="opacity:0.5">[' + s.type + "]</span> Spr:" + s.sprite + '<div style="font-size:0.8em;opacity:0.6">HP:' + s.baseHp + " ATK:" + s.baseAtk + " DEF:" + s.baseDef + " SPD:" + s.baseSpd + '</div></div><div style="display:flex;gap:0.25rem"><button class="btn btn-small" data-evo-edit="' + i + '" style="font-size:0.7em">Edit</button><button class="btn btn-small" data-evo-del="' + i + '" style="font-size:0.7em;color:#f66">Del</button></div>';
        list.appendChild(el);
      });
      list.querySelectorAll("[data-evo-edit]").forEach(function(b) {
        b.addEventListener("click", function() {
          editSpecies(parseInt(b.getAttribute("data-evo-edit")), true);
        });
      });
      list.querySelectorAll("[data-evo-del]").forEach(function(b) {
        b.addEventListener("click", function() {
          if (confirm("Delete this evolved species?")) {
            monData.evolvedSpecies.splice(parseInt(b.getAttribute("data-evo-del")), 1);
            saveMonsterData();
          }
        });
      });
    }
    function showSpeciesForm(title) {
      document.getElementById("mon-species-form").style.display = "";
      document.getElementById("mon-species-form-title").textContent = title;
    }
    function hideSpeciesForm() {
      document.getElementById("mon-species-form").style.display = "none";
    }
    document.getElementById("btn-mon-add-species").addEventListener("click", function() {
      clearSpeciesForm();
      document.getElementById("mon-sp-is-evolved").value = "";
      showSpeciesForm("Add Base Species");
    });
    document.getElementById("btn-mon-sp-cancel").addEventListener("click", hideSpeciesForm);
    function clearSpeciesForm() {
      ["mon-sp-name", "mon-sp-m1", "mon-sp-m2", "mon-sp-m3", "mon-sp-m4", "mon-sp-evo-name"].forEach(function(id) {
        document.getElementById(id).value = "";
      });
      document.getElementById("mon-sp-sprite").value = "33";
      document.getElementById("mon-sp-type").value = "Normal";
      document.getElementById("mon-sp-hp").value = "45";
      document.getElementById("mon-sp-atk").value = "49";
      document.getElementById("mon-sp-def").value = "49";
      document.getElementById("mon-sp-spd").value = "45";
      document.getElementById("mon-sp-spatk").value = "35";
      document.getElementById("mon-sp-spdef").value = "35";
      document.getElementById("mon-sp-m1lv").value = "1";
      document.getElementById("mon-sp-m2lv").value = "5";
      document.getElementById("mon-sp-m3lv").value = "10";
      document.getElementById("mon-sp-m4lv").value = "15";
      document.getElementById("mon-sp-evo-sprite").value = "0";
      document.getElementById("mon-sp-evo-level").value = "16";
      document.getElementById("mon-sp-editing").value = "";
    }
    function editSpecies(idx, isEvolved) {
      var s = isEvolved ? monData.evolvedSpecies[idx] : monData.species[idx];
      if (!s) return;
      document.getElementById("mon-sp-name").value = s.name;
      document.getElementById("mon-sp-sprite").value = s.sprite;
      document.getElementById("mon-sp-type").value = s.type;
      document.getElementById("mon-sp-hp").value = s.baseHp;
      document.getElementById("mon-sp-atk").value = s.baseAtk;
      document.getElementById("mon-sp-def").value = s.baseDef;
      document.getElementById("mon-sp-spd").value = s.baseSpd;
      document.getElementById("mon-sp-spatk").value = s.baseSpAtk;
      document.getElementById("mon-sp-spdef").value = s.baseSpDef;
      var mkeys = Object.keys(s.moves || {}).sort(function(a, b) {
        return a - b;
      });
      document.getElementById("mon-sp-m1").value = s.moves[mkeys[0]] || "";
      document.getElementById("mon-sp-m1lv").value = mkeys[0] || "1";
      document.getElementById("mon-sp-m2").value = s.moves[mkeys[1]] || "";
      document.getElementById("mon-sp-m2lv").value = mkeys[1] || "5";
      document.getElementById("mon-sp-m3").value = s.moves[mkeys[2]] || "";
      document.getElementById("mon-sp-m3lv").value = mkeys[2] || "10";
      document.getElementById("mon-sp-m4").value = s.moves[mkeys[3]] || "";
      document.getElementById("mon-sp-m4lv").value = mkeys[3] || "15";
      if (s.evolution) {
        document.getElementById("mon-sp-evo-name").value = s.evolution.name;
        document.getElementById("mon-sp-evo-sprite").value = s.evolution.sprite;
        document.getElementById("mon-sp-evo-level").value = s.evolution.level;
      } else {
        document.getElementById("mon-sp-evo-name").value = "";
        document.getElementById("mon-sp-evo-sprite").value = "0";
        document.getElementById("mon-sp-evo-level").value = "16";
      }
      document.getElementById("mon-sp-editing").value = String(idx);
      document.getElementById("mon-sp-is-evolved").value = isEvolved ? "true" : "";
      showSpeciesForm(isEvolved ? "Edit Evolved Species" : "Edit Base Species");
    }
    document.getElementById("btn-mon-sp-save").addEventListener("click", function() {
      var name = document.getElementById("mon-sp-name").value.trim();
      if (!name) {
        showToast("Name is required", true);
        return;
      }
      var moves = {};
      var pairs = [
        [document.getElementById("mon-sp-m1"), document.getElementById("mon-sp-m1lv")],
        [document.getElementById("mon-sp-m2"), document.getElementById("mon-sp-m2lv")],
        [document.getElementById("mon-sp-m3"), document.getElementById("mon-sp-m3lv")],
        [document.getElementById("mon-sp-m4"), document.getElementById("mon-sp-m4lv")]
      ];
      pairs.forEach(function(p) {
        if (p[0].value.trim()) moves[parseInt(p[1].value) || 1] = p[0].value.trim();
      });
      var sp = {
        name,
        sprite: parseInt(document.getElementById("mon-sp-sprite").value) || 0,
        type: document.getElementById("mon-sp-type").value,
        baseHp: parseInt(document.getElementById("mon-sp-hp").value) || 45,
        baseAtk: parseInt(document.getElementById("mon-sp-atk").value) || 49,
        baseDef: parseInt(document.getElementById("mon-sp-def").value) || 49,
        baseSpd: parseInt(document.getElementById("mon-sp-spd").value) || 45,
        baseSpAtk: parseInt(document.getElementById("mon-sp-spatk").value) || 35,
        baseSpDef: parseInt(document.getElementById("mon-sp-spdef").value) || 35,
        moves
      };
      var evoName = document.getElementById("mon-sp-evo-name").value.trim();
      if (evoName) {
        sp.evolution = {
          name: evoName,
          sprite: parseInt(document.getElementById("mon-sp-evo-sprite").value) || 0,
          level: parseInt(document.getElementById("mon-sp-evo-level").value) || 16
        };
      }
      var editIdx = document.getElementById("mon-sp-editing").value;
      var isEvolved = document.getElementById("mon-sp-is-evolved").value === "true";
      var arr = isEvolved ? monData.evolvedSpecies : monData.species;
      if (editIdx !== "") {
        arr[parseInt(editIdx)] = sp;
      } else {
        arr.push(sp);
      }
      saveMonsterData();
      hideSpeciesForm();
    });
    function renderMovesList() {
      var list = document.getElementById("mon-moves-list");
      if (!list) return;
      var keys = Object.keys(monData.moves || {}).sort();
      if (keys.length === 0) {
        list.innerHTML = '<div class="rules-empty">No moves defined.</div>';
        return;
      }
      list.innerHTML = "";
      keys.forEach(function(k) {
        var m = monData.moves[k];
        var el = document.createElement("div");
        el.style.cssText = "padding:0.3rem 0.6rem;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;align-items:center";
        var extra = m.heals ? " Heal:" + m.heals + "%" : "";
        el.innerHTML = "<div><strong>" + m.name + '</strong> <span style="opacity:0.5">[' + m.type + " " + m.category + "]</span> PWR:" + m.power + " ACC:" + m.accuracy + "%" + extra + '</div><div style="display:flex;gap:0.25rem"><button class="btn btn-small" data-mv-edit="' + k + '" style="font-size:0.7em">Edit</button><button class="btn btn-small" data-mv-del="' + k + '" style="font-size:0.7em;color:#f66">Del</button></div>';
        list.appendChild(el);
      });
      list.querySelectorAll("[data-mv-edit]").forEach(function(b) {
        b.addEventListener("click", function() {
          editMove(b.getAttribute("data-mv-edit"));
        });
      });
      list.querySelectorAll("[data-mv-del]").forEach(function(b) {
        b.addEventListener("click", function() {
          if (confirm('Delete move "' + b.getAttribute("data-mv-del") + '"?')) {
            delete monData.moves[b.getAttribute("data-mv-del")];
            saveMonsterData();
          }
        });
      });
    }
    document.getElementById("btn-mon-add-move").addEventListener("click", function() {
      clearMoveForm();
      document.getElementById("mon-move-form").style.display = "";
      document.getElementById("mon-move-form-title").textContent = "Add Move";
    });
    document.getElementById("btn-mon-mv-cancel").addEventListener("click", function() {
      document.getElementById("mon-move-form").style.display = "none";
    });
    function clearMoveForm() {
      document.getElementById("mon-mv-name").value = "";
      document.getElementById("mon-mv-type").value = "Normal";
      document.getElementById("mon-mv-cat").value = "physical";
      document.getElementById("mon-mv-power").value = "40";
      document.getElementById("mon-mv-acc").value = "100";
      document.getElementById("mon-mv-priority").value = "0";
      document.getElementById("mon-mv-heals").value = "0";
      document.getElementById("mon-mv-anim").value = "1";
      document.getElementById("mon-mv-source").value = "0";
      document.getElementById("mon-mv-body").value = "";
      document.getElementById("mon-mv-sound").value = "0";
      document.getElementById("mon-mv-self").checked = false;
      document.getElementById("mon-mv-editing").value = "";
    }
    function editMove(key) {
      var m = monData.moves[key];
      if (!m) return;
      document.getElementById("mon-mv-name").value = m.name;
      document.getElementById("mon-mv-type").value = m.type;
      document.getElementById("mon-mv-cat").value = m.category;
      document.getElementById("mon-mv-power").value = m.power;
      document.getElementById("mon-mv-acc").value = m.accuracy;
      document.getElementById("mon-mv-priority").value = m.priority || 0;
      document.getElementById("mon-mv-heals").value = m.heals || 0;
      document.getElementById("mon-mv-anim").value = m.animationId || 1;
      document.getElementById("mon-mv-source").value = m.sourceAnimationId != null ? m.sourceAnimationId : 0;
      document.getElementById("mon-mv-body").value = m.bodyAnimationId != null ? m.bodyAnimationId : "";
      document.getElementById("mon-mv-sound").value = m.soundId || 0;
      document.getElementById("mon-mv-self").checked = !!m.targetsSelf;
      document.getElementById("mon-mv-editing").value = key;
      document.getElementById("mon-move-form").style.display = "";
      document.getElementById("mon-move-form-title").textContent = "Edit Move";
    }
    document.getElementById("btn-mon-mv-save").addEventListener("click", function() {
      var name = document.getElementById("mon-mv-name").value.trim();
      if (!name) {
        showToast("Move name required", true);
        return;
      }
      var mv = {
        name,
        type: document.getElementById("mon-mv-type").value,
        category: document.getElementById("mon-mv-cat").value,
        power: parseInt(document.getElementById("mon-mv-power").value) || 0,
        accuracy: parseInt(document.getElementById("mon-mv-acc").value) || 100,
        priority: parseInt(document.getElementById("mon-mv-priority").value) || 0,
        heals: parseInt(document.getElementById("mon-mv-heals").value) || 0,
        animationId: parseInt(document.getElementById("mon-mv-anim").value) || 1,
        sourceAnimationId: parseInt(document.getElementById("mon-mv-source").value, 10) || 0,
        soundId: parseInt(document.getElementById("mon-mv-sound").value) || 0
      };
      var bodyStr = document.getElementById("mon-mv-body").value.trim();
      if (bodyStr !== "") mv.bodyAnimationId = parseInt(bodyStr, 10);
      if (document.getElementById("mon-mv-self").checked) mv.targetsSelf = true;
      if (!mv.heals) delete mv.heals;
      if (!mv.priority) delete mv.priority;
      if (!mv.sourceAnimationId) delete mv.sourceAnimationId;
      if (!mv.targetsSelf) delete mv.targetsSelf;
      var editKey = document.getElementById("mon-mv-editing").value;
      if (editKey && editKey !== name) delete monData.moves[editKey];
      monData.moves[name] = mv;
      saveMonsterData();
      document.getElementById("mon-move-form").style.display = "none";
    });
    var monsterSearchBtn = document.getElementById("btn-monster-search");
    var monsterSearchInput = document.getElementById("monster-player-search");
    if (monsterSearchBtn && monsterSearchInput) {
      monsterSearchBtn.addEventListener("click", function() {
        var n = monsterSearchInput.value.trim();
        if (n) socket.emit("monsters:search", { playerName: n });
      });
      monsterSearchInput.addEventListener("keypress", function(e) {
        if (e.key === "Enter") {
          var n = monsterSearchInput.value.trim();
          if (n) socket.emit("monsters:search", { playerName: n });
        }
      });
    }
    socket.on("monsters:playerMonsters", function(data) {
      var list = document.getElementById("monster-player-list");
      if (!list) return;
      if (!data.monsters || data.monsters.length === 0) {
        list.innerHTML = '<div class="rules-empty">' + data.playerName + " has no monsters.</div>";
        return;
      }
      list.innerHTML = '<div style="padding:0.3rem 0.6rem;font-weight:bold;opacity:0.7">' + data.playerName + "'s Monsters (" + data.monsters.length + ")</div>";
      data.monsters.forEach(function(m) {
        var el = document.createElement("div");
        el.style.cssText = "padding:0.4rem 0.6rem;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;align-items:center";
        var active = m.isActive ? ' <span style="color:#6f6">[ACTIVE]</span>' : "";
        var moves = (m.moves || []).filter(function(x) {
          return x;
        }).join(", ") || "None";
        el.innerHTML = "<div><strong>" + m.nickname + '</strong> <span style="opacity:0.5">(' + m.speciesName + ")</span> Lv." + m.level + active + '<div style="font-size:0.8em;opacity:0.6">HP:' + m.hp + "/" + m.maxHp + " ATK:" + m.atk + " DEF:" + m.def + " SPD:" + m.spd + " | " + m.nature + '</div><div style="font-size:0.8em;opacity:0.5">Moves: ' + moves + " | " + m.wins + "W/" + m.losses + 'L</div></div><button class="btn btn-small" style="color:#f66;font-size:0.75em" data-monster-delete="' + m.id + '" data-monster-owner="' + m.ownerName + '">Del</button>';
        list.appendChild(el);
      });
      list.querySelectorAll("[data-monster-delete]").forEach(function(btn) {
        btn.addEventListener("click", function() {
          if (confirm("Delete this monster permanently?")) socket.emit("monsters:delete", { monsterId: parseInt(btn.getAttribute("data-monster-delete")), ownerName: btn.getAttribute("data-monster-owner") });
        });
      });
    });
    socket.on("monsters:deleteResult", function(data) {
      if (data.success) {
        showToast("Monster deleted");
        var n = document.getElementById("monster-player-search");
        if (n && n.value.trim()) socket.emit("monsters:search", { playerName: n.value.trim() });
      } else {
        showToast("Failed to delete monster");
      }
    });
    var leaderboardBtn = document.getElementById("btn-monster-refresh-leaderboard");
    if (leaderboardBtn) leaderboardBtn.addEventListener("click", function() {
      socket.emit("monsters:leaderboard");
    });
    socket.on("monsters:leaderboard", function(leaders) {
      var list = document.getElementById("monster-leaderboard");
      if (!list) return;
      if (!leaders || leaders.length === 0) {
        list.innerHTML = '<div class="rules-empty">No battles recorded yet.</div>';
        return;
      }
      list.innerHTML = "";
      leaders.forEach(function(e, i) {
        var el = document.createElement("div");
        el.style.cssText = "padding:0.3rem 0.6rem;border-bottom:1px solid rgba(255,255,255,0.05);font-size:0.85em";
        el.innerHTML = "<strong>#" + (i + 1) + "</strong> " + e.nickname + " (" + e.speciesName + ') \u2014 <span style="opacity:0.7">' + e.ownerName + "</span> | " + e.wins + "W/" + e.losses + "L Lv." + e.level;
        list.appendChild(el);
      });
    });
    var customLegends = [];
    var LEGEND_ICON_NAMES = ["Aisling", "Warrior", "Rogue", "Wizard", "Priest", "Monk", "Heart", "Victory", "None"];
    var LEGEND_COLOR_NAMES = [
      "Cyan",
      "Bright Red",
      "Gray Tan",
      "Dark Blue",
      "Purple",
      "Dark Gray",
      "Brown",
      "Sky Blue",
      "Yellow",
      "Deep Blue",
      "Coral",
      "Tan",
      "White",
      "Green",
      "Orange",
      "Light Pink",
      "Turquoise",
      "Pale Pink",
      "Maroon",
      "Beige",
      "Dark Green",
      "Olive",
      "Dark Olive",
      "Peach",
      "Dark Peach",
      "Teal",
      "Light Green",
      "Light Gray",
      "Rust Red",
      "Dark Red",
      "Red"
    ];
    var LEGEND_COLOR_CSS = [
      "#0ff",
      "#f33",
      "#b0a090",
      "#34a",
      "#a4c",
      "#888",
      "#8b6914",
      "#87ceeb",
      "#ff0",
      "#23b",
      "#ff7f50",
      "#d2b48c",
      "#fff",
      "#3c3",
      "#f80",
      "#ffb6c1",
      "#40e0d0",
      "#ffc0cb",
      "#800000",
      "#f5deb3",
      "#006400",
      "#808000",
      "#556b2f",
      "#fc9",
      "#c96",
      "#008080",
      "#90ee90",
      "#c0c0c0",
      "#b7410e",
      "#8b0000",
      "#f00"
    ];
    function renderLegendMarksList() {
      var container = document.getElementById("legend-marks-list");
      var countBadge = document.getElementById("legend-mark-count");
      if (!container) return;
      if (countBadge) countBadge.textContent = customLegends.length + " mark" + (customLegends.length !== 1 ? "s" : "");
      if (customLegends.length === 0) {
        container.innerHTML = '<div class="rules-empty">No custom legend marks created.</div>';
        return;
      }
      var html = "";
      for (var i = 0; i < customLegends.length; i++) {
        var mark = customLegends[i];
        var iconName = LEGEND_ICON_NAMES[mark.icon] || "Icon " + mark.icon;
        var colorCss = LEGEND_COLOR_CSS[mark.color] || "#ccc";
        var issuedCount = (mark.issuedTo || []).length;
        html += '<div style="padding:0.4rem 0.6rem;border-bottom:1px solid rgba(255,255,255,0.05)">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center">';
        html += '<div style="display:flex;align-items:center;gap:6px;min-width:0;flex:1">';
        html += '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + colorCss + ';flex-shrink:0"></span>';
        html += '<strong style="color:' + colorCss + '">' + escapeHtml(mark.key) + "</strong> ";
        html += '<span style="opacity:0.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(mark.text) + "</span>";
        html += "</div>";
        html += '<div style="display:flex;align-items:center;gap:4px;flex-shrink:0">';
        html += '<span style="font-size:0.7em;opacity:0.35">' + iconName + "</span>";
        html += '<button class="btn btn-small legend-edit-btn" data-id="' + escapeHtml(mark.id) + '" style="color:#6bf;font-size:0.75em">Edit</button>';
        html += '<button class="btn btn-small legend-delete-btn" data-id="' + escapeHtml(mark.id) + '" style="color:#f66;font-size:0.75em">Delete</button>';
        html += "</div>";
        html += "</div>";
        if (issuedCount > 0) {
          html += '<div style="margin-top:3px;font-size:0.78em">';
          html += '<span style="opacity:0.5">Issued to (' + issuedCount + "):</span> ";
          for (var j = 0; j < mark.issuedTo.length; j++) {
            html += '<span style="display:inline-flex;align-items:center;gap:2px;background:rgba(46,204,113,0.1);color:#2ecc71;padding:1px 6px;border-radius:8px;font-size:0.85em;margin:1px 2px;border:1px solid rgba(46,204,113,0.2)">';
            html += escapeHtml(mark.issuedTo[j]);
            html += '<button class="legend-revoke-btn" data-id="' + escapeHtml(mark.id) + '" data-player="' + escapeHtml(mark.issuedTo[j]) + '" style="background:none;border:none;color:#f66;cursor:pointer;font-size:0.9em;padding:0 2px;opacity:0.6" title="Revoke">&times;</button>';
            html += "</span>";
          }
          html += "</div>";
        }
        html += "</div>";
      }
      container.innerHTML = html;
      container.querySelectorAll(".legend-edit-btn").forEach(function(btn) {
        btn.addEventListener("click", function() {
          editLegendMark(btn.dataset.id);
        });
      });
      container.querySelectorAll(".legend-delete-btn").forEach(function(btn) {
        btn.addEventListener("click", function() {
          if (confirm("Delete this legend mark? It will be removed from all players.")) {
            socket.emit("proxy:legends:delete", { id: btn.dataset.id });
          }
        });
      });
      container.querySelectorAll(".legend-revoke-btn").forEach(function(btn) {
        btn.addEventListener("click", function() {
          socket.emit("proxy:legends:revoke", { id: btn.dataset.id, playerName: btn.dataset.player });
        });
      });
    }
    function updateLegendIssueDropdown() {
      var select = document.getElementById("legend-issue-mark");
      if (!select) return;
      var current = select.value;
      select.innerHTML = '<option value="">-- Select --</option>';
      for (var i = 0; i < customLegends.length; i++) {
        var opt = document.createElement("option");
        opt.value = customLegends[i].id;
        opt.textContent = customLegends[i].key + " \u2014 " + customLegends[i].text;
        select.appendChild(opt);
      }
      select.value = current;
    }
    function editLegendMark(id) {
      var mark = null;
      for (var i = 0; i < customLegends.length; i++) {
        if (customLegends[i].id === id) {
          mark = customLegends[i];
          break;
        }
      }
      if (!mark) return;
      document.getElementById("legend-key").value = mark.key;
      document.getElementById("legend-text").value = mark.text;
      document.getElementById("legend-icon").value = mark.icon;
      document.getElementById("legend-color").value = mark.color;
      document.getElementById("legend-editing-id").value = mark.id;
      document.getElementById("legend-form-title").textContent = "Edit Legend Mark";
      document.getElementById("btn-legend-save").textContent = "Update Legend Mark";
      document.getElementById("btn-legend-cancel").style.display = "";
      updateLegendPreview();
    }
    function resetLegendForm() {
      document.getElementById("legend-key").value = "";
      document.getElementById("legend-text").value = "";
      document.getElementById("legend-icon").value = "0";
      document.getElementById("legend-color").value = "0";
      document.getElementById("legend-editing-id").value = "";
      document.getElementById("legend-form-title").textContent = "Create Legend Mark";
      document.getElementById("btn-legend-save").textContent = "Create Legend Mark";
      document.getElementById("btn-legend-cancel").style.display = "none";
      updateLegendPreview();
    }
    function updateLegendPreview() {
      var preview = document.getElementById("legend-preview");
      if (!preview) return;
      var key = document.getElementById("legend-key").value || "Key";
      var text = document.getElementById("legend-text").value || "Description text";
      var colorIdx = parseInt(document.getElementById("legend-color").value) || 0;
      var colorCss = LEGEND_COLOR_CSS[colorIdx] || "#ccc";
      preview.innerHTML = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + colorCss + '"></span><span style="font-weight:600;color:' + colorCss + '">' + escapeHtml(key) + '</span><span style="opacity:0.7">' + escapeHtml(text) + "</span>";
    }
    ["legend-key", "legend-text", "legend-icon", "legend-color"].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener("input", updateLegendPreview);
        el.addEventListener("change", updateLegendPreview);
      }
    });
    var btnLegendSave = document.getElementById("btn-legend-save");
    if (btnLegendSave) {
      btnLegendSave.addEventListener("click", function() {
        var key = document.getElementById("legend-key").value.trim();
        var text = document.getElementById("legend-text").value.trim();
        if (!key || !text) {
          showToast("Key and text are required", true);
          return;
        }
        var data = {
          key,
          text,
          icon: parseInt(document.getElementById("legend-icon").value) || 0,
          color: parseInt(document.getElementById("legend-color").value) || 0
        };
        var editId = document.getElementById("legend-editing-id").value;
        if (editId) {
          data.id = editId;
          socket.emit("proxy:legends:update", data);
        } else {
          socket.emit("proxy:legends:create", data);
        }
        resetLegendForm();
      });
    }
    var btnLegendCancel = document.getElementById("btn-legend-cancel");
    if (btnLegendCancel) {
      btnLegendCancel.addEventListener("click", resetLegendForm);
    }
    var btnLegendIssue = document.getElementById("btn-legend-issue");
    if (btnLegendIssue) {
      btnLegendIssue.addEventListener("click", function() {
        var markId = document.getElementById("legend-issue-mark").value;
        var playerName = document.getElementById("legend-issue-player").value.trim();
        if (!markId) {
          showToast("Select a legend mark first", true);
          return;
        }
        if (!playerName) {
          showToast("Enter a player name", true);
          return;
        }
        socket.emit("proxy:legends:issue", { id: markId, playerName });
        document.getElementById("legend-issue-player").value = "";
      });
    }
    socket.on("proxy:legends:list", function(legends) {
      customLegends = legends || [];
      renderLegendMarksList();
      updateLegendIssueDropdown();
    });
    var playerDisguises = {};
    function renderDisguiseList() {
      var container = document.getElementById("disguise-list");
      var countBadge = document.getElementById("disguise-count");
      if (!container) return;
      var names = Object.keys(playerDisguises);
      if (countBadge) countBadge.textContent = names.length + " player" + (names.length !== 1 ? "s" : "");
      if (names.length === 0) {
        container.innerHTML = '<div class="rules-empty">No player disguises configured.</div>';
        return;
      }
      var html = "";
      for (var i = 0; i < names.length; i++) {
        var name = names[i];
        var d = playerDisguises[name];
        var statusColor = d.enabled ? "#2ecc71" : "#e74c3c";
        var statusText = d.enabled ? "ON" : "OFF";
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0.5rem;border-bottom:1px solid rgba(255,255,255,0.05)">';
        html += '<div style="flex:1;min-width:0">';
        html += "<strong>" + escapeHtml(name) + '</strong> <span style="font-size:0.8em;color:' + statusColor + '">[' + statusText + "]</span><br>";
        html += '<span style="font-size:0.82em;opacity:0.6">';
        var parts = [];
        if (d.title) parts.push("Title: " + escapeHtml(d.title));
        if (d.displayClass) parts.push("Class: " + escapeHtml(d.displayClass));
        if (d.guildRank) parts.push("Rank: " + escapeHtml(d.guildRank));
        if (d.guild) parts.push("Guild: " + escapeHtml(d.guild));
        html += parts.join(" \xB7 ") || "No overrides set";
        html += "</span>";
        if (d.overcoatSprite) html += '<br><span style="font-size:0.78em;opacity:0.5">Overcoat: sprite=' + d.overcoatSprite + " color=" + (d.overcoatColor || 0) + "</span>";
        html += "</div>";
        html += '<div style="display:flex;gap:4px;flex-shrink:0">';
        html += '<button class="btn btn-small" data-disguise-toggle="' + escapeHtml(name) + '">' + (d.enabled ? "Disable" : "Enable") + "</button>";
        html += '<button class="btn btn-small" data-disguise-edit="' + escapeHtml(name) + '">Edit</button>';
        html += '<button class="btn btn-small" data-disguise-delete="' + escapeHtml(name) + '" style="color:#e74c3c">Del</button>';
        html += "</div></div>";
      }
      container.innerHTML = html;
      container.querySelectorAll("[data-disguise-toggle]").forEach(function(btn) {
        btn.addEventListener("click", function() {
          socket.emit("proxy:disguises:toggle", { playerName: btn.getAttribute("data-disguise-toggle") });
        });
      });
      container.querySelectorAll("[data-disguise-edit]").forEach(function(btn) {
        btn.addEventListener("click", function() {
          var n = btn.getAttribute("data-disguise-edit");
          var d2 = playerDisguises[n];
          if (!d2) return;
          document.getElementById("disguise-player").value = n;
          document.getElementById("disguise-player").disabled = true;
          document.getElementById("disguise-title").value = d2.title || "";
          document.getElementById("disguise-class").value = d2.displayClass || "";
          document.getElementById("disguise-rank").value = d2.guildRank || "";
          document.getElementById("disguise-guild").value = d2.guild || "";
          document.getElementById("disguise-sprite").value = d2.overcoatSprite || 0;
          document.getElementById("disguise-color").value = d2.overcoatColor || 0;
          document.getElementById("disguise-enabled").checked = d2.enabled !== false;
          document.getElementById("disguise-editing").value = n;
          document.getElementById("disguise-form-title").textContent = "Edit: " + n;
          document.getElementById("btn-disguise-save").textContent = "Update Disguise";
          document.getElementById("btn-disguise-cancel").style.display = "";
        });
      });
      container.querySelectorAll("[data-disguise-delete]").forEach(function(btn) {
        btn.addEventListener("click", function() {
          var n = btn.getAttribute("data-disguise-delete");
          if (confirm("Remove disguise for " + n + "?")) {
            socket.emit("proxy:disguises:delete", { playerName: n });
          }
        });
      });
    }
    function resetDisguiseForm() {
      document.getElementById("disguise-player").value = "";
      document.getElementById("disguise-player").disabled = false;
      document.getElementById("disguise-title").value = "";
      document.getElementById("disguise-class").value = "";
      document.getElementById("disguise-rank").value = "";
      document.getElementById("disguise-guild").value = "";
      document.getElementById("disguise-sprite").value = "0";
      document.getElementById("disguise-color").value = "0";
      document.getElementById("disguise-enabled").checked = true;
      document.getElementById("disguise-editing").value = "";
      document.getElementById("disguise-form-title").textContent = "Add Player Disguise";
      document.getElementById("btn-disguise-save").textContent = "Save Disguise";
      document.getElementById("btn-disguise-cancel").style.display = "none";
    }
    var btnDisguiseSave = document.getElementById("btn-disguise-save");
    if (btnDisguiseSave) {
      btnDisguiseSave.addEventListener("click", function() {
        var editing = document.getElementById("disguise-editing").value;
        var playerName = editing || document.getElementById("disguise-player").value.trim();
        if (!playerName) {
          showToast("Enter a player name", true);
          return;
        }
        socket.emit("proxy:disguises:save", {
          playerName,
          enabled: document.getElementById("disguise-enabled").checked,
          title: document.getElementById("disguise-title").value.trim(),
          displayClass: document.getElementById("disguise-class").value.trim(),
          guildRank: document.getElementById("disguise-rank").value.trim(),
          guild: document.getElementById("disguise-guild").value.trim(),
          overcoatSprite: parseInt(document.getElementById("disguise-sprite").value) || 0,
          overcoatColor: parseInt(document.getElementById("disguise-color").value) || 0
        });
        resetDisguiseForm();
      });
    }
    var btnDisguiseCancel = document.getElementById("btn-disguise-cancel");
    if (btnDisguiseCancel) {
      btnDisguiseCancel.addEventListener("click", function() {
        resetDisguiseForm();
      });
    }
    socket.on("proxy:disguises:list", function(data) {
      playerDisguises = data || {};
      renderDisguiseList();
    });
  }

  // src/panel/panel.ts
  (function() {
    var socket = io();
    var logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function() {
        fetch("/api/logout", { method: "POST" }).then(function() {
          window.location.href = "/login";
        }).catch(function() {
          window.location.href = "/login";
        });
      });
    }
    var navLinks = document.querySelectorAll("#sidebar a[data-panel]");
    var panels = document.querySelectorAll(".panel");
    var contentEl = document.getElementById("content");
    var mobileMenuBtn = document.getElementById("mobile-menu-btn");
    var sidebar = document.getElementById("sidebar");
    var sidebarOverlay = document.getElementById("sidebar-overlay");
    function openSidebar() {
      sidebar.classList.add("open");
      sidebarOverlay.classList.add("visible");
      mobileMenuBtn.classList.add("active");
    }
    function closeSidebar() {
      sidebar.classList.remove("open");
      sidebarOverlay.classList.remove("visible");
      mobileMenuBtn.classList.remove("active");
    }
    mobileMenuBtn.addEventListener("click", function() {
      if (sidebar.classList.contains("open")) {
        closeSidebar();
      } else {
        openSidebar();
      }
    });
    sidebarOverlay.addEventListener("click", function() {
      closeSidebar();
    });
    navLinks.forEach(function(link) {
      link.addEventListener("click", function(e) {
        e.preventDefault();
        navLinks.forEach(function(l) {
          l.classList.remove("active");
        });
        panels.forEach(function(p) {
          p.classList.remove("active");
        });
        link.classList.add("active");
        document.getElementById("panel-" + link.dataset.panel).classList.add("active");
        contentEl.classList.toggle("chat-active", link.dataset.panel === "chat");
        closeSidebar();
      });
    });
    var botStates = {};
    var selectedWalkBotId = null;
    var selectedChatBotId = null;
    var selectedWhisperBotId = null;
    var selectedNavBotId = null;
    var chatUi = createChatUi({
      socket,
      getBotStates: function() {
        return botStates;
      },
      getSelectedChatBotId: function() {
        return selectedChatBotId;
      },
      setSelectedChatBotId: function(id) {
        selectedChatBotId = id;
      },
      getSelectedWhisperBotId: function() {
        return selectedWhisperBotId;
      },
      setSelectedWhisperBotId: function(id) {
        selectedWhisperBotId = id;
      },
      navLinks,
      panels,
      contentEl
    });
    var renderChatBotTabs = chatUi.renderChatBotTabs;
    var showToast = chatUi.showToast;
    setInterval(function() {
      var uptimeEls = document.querySelectorAll(".bot-uptime");
      uptimeEls.forEach(function(el) {
        var connectedAt = parseInt(el.dataset.connectedAt);
        if (!connectedAt) {
          el.textContent = "--";
          return;
        }
        var elapsed = Date.now() - connectedAt;
        var h = Math.floor(elapsed / 36e5);
        var m = Math.floor(elapsed % 36e5 / 6e4);
        var s = Math.floor(elapsed % 6e4 / 1e3);
        el.textContent = h + "h " + m + "m " + s + "s";
      });
    }, 1e3);
    var activeBotTabId = null;
    var mapListCache = { nodes: [], reachableIds: [] };
    var walkFavorites = {};
    var loginWalkTargets = {};
    var botUi = createBotUi({
      socket,
      getBotStates: function() {
        return botStates;
      },
      getActiveBotTabId: function() {
        return activeBotTabId;
      },
      setActiveBotTabId: function(id) {
        activeBotTabId = id;
      },
      getMapListCache: function() {
        return mapListCache;
      },
      getWalkFavorites: function() {
        return walkFavorites;
      },
      getLoginWalkTargets: function() {
        return loginWalkTargets;
      },
      setSelectedWalkBotId: function(id) {
        selectedWalkBotId = id;
      },
      setSelectedChatBotId: function(id) {
        selectedChatBotId = id;
      },
      setSelectedWhisperBotId: function(id) {
        selectedWhisperBotId = id;
      },
      setSelectedNavBotId: function(id) {
        selectedNavBotId = id;
      },
      showToast,
      renderChatBotTabs
    });
    var buildMapOptions = botUi.buildMapOptions;
    var setNavStatus = botUi.setNavStatus;
    var renderActiveBotTab = botUi.renderActiveBotTab;
    var renderAllBotCards = botUi.renderAllBotCards;
    var updateBotCard = botUi.updateBotCard;
    var updateSidebarIndicator = botUi.updateSidebarIndicator;
    var updateBotSelectors = botUi.updateBotSelectors;
    createConfigPanel({
      socket,
      showToast
    });
    createAePanel({
      socket
    });
    createDiscordPanel({
      socket,
      showToast
    });
    createChatGamesUi({
      socket,
      showToast
    });
    createScheduledUi({
      socket,
      getBotStates: function() {
        return botStates;
      },
      showToast
    });
    createPlayersUi({
      socket,
      navLinks,
      showToast
    });
    createStatsUi({
      socket,
      navLinks
    });
    createAssetMapUi({
      navLinks
    });
    createLotteryUi({
      socket,
      navLinks,
      showToast
    });
    createSlotsUi({
      socket,
      navLinks,
      showToast
    });
    createNpcLeakUi({
      socket,
      navLinks,
      showToast
    });
    createAttendanceUi({
      socket
    });
    createAiChatUi({
      socket
    });
    createProxyUi({
      socket,
      buildMapOptions,
      getMapListCache: function() {
        return mapListCache;
      },
      getBotStates: function() {
        return botStates;
      },
      showToast
    });
    socket.emit("nav:getMapList");
    socket.emit("nav:getFavorites");
    socket.emit("nav:getLoginWalkTargets");
    socket.on("nav:mapList", function(data) {
      mapListCache = data || { nodes: [], reachableIds: [] };
      renderActiveBotTab();
    });
    socket.on("nav:favorites", function(data) {
      walkFavorites = data || {};
      renderActiveBotTab();
    });
    socket.on("nav:loginWalkTargets", function(data) {
      loginWalkTargets = data || {};
      Object.keys(loginWalkTargets).forEach(function(bid) {
        var v = loginWalkTargets[bid];
        if (typeof v === "string") {
          loginWalkTargets[bid] = { favId: v, faceDirection: -1 };
        }
      });
      renderActiveBotTab();
    });
    socket.on("bots:statusAll", function(states) {
      botStates = {};
      if (states && states.length > 0) {
        states.forEach(function(state) {
          botStates[state.id] = state;
        });
      }
      renderAllBotCards();
      updateSidebarIndicator();
      updateBotSelectors();
      renderChatBotTabs();
    });
    socket.on("bot:status", function(state) {
      if (!state || !state.id) return;
      var isNew = !botStates[state.id];
      botStates[state.id] = state;
      updateBotCard(state);
      updateSidebarIndicator();
      updateBotSelectors();
      if (isNew) renderChatBotTabs();
    });
    document.getElementById("btn-start-all").addEventListener("click", function() {
      socket.emit("bots:startAll");
    });
    document.getElementById("btn-stop-all").addEventListener("click", function() {
      socket.emit("bots:stopAll");
    });
    document.getElementById("btn-reload-modules").addEventListener("click", function() {
      socket.emit("hotreload:trigger", {});
    });
    socket.on("hotreload:success", function(data) {
      showToast("Reloaded: " + data.file, false);
    });
    socket.on("hotreload:error", function(data) {
      showToast("Reload failed: " + data.file + " \u2014 " + (data.error || "unknown"), true);
    });
    socket.on("hotreload:result", function(data) {
      if (data.succeeded !== void 0) {
        showToast("Reloaded " + data.succeeded + " modules (" + data.failed + " failed)", data.failed > 0);
      } else {
        showToast(data.success ? "Reloaded: " + data.file : "Failed: " + (data.error || data.file), !data.success);
      }
    });
    var arrowDirMap = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 };
    document.addEventListener("keydown", function(e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;
      if (!arrowDirMap.hasOwnProperty(e.key)) return;
      e.preventDefault();
      if (activeBotTabId) {
        var modeBtn = document.querySelector(".bot-tab-panel .bot-dpad-mode-btn");
        var mode = modeBtn ? modeBtn.dataset.mode : "walk";
        var evt = mode === "turn" ? "bot:turn" : "bot:walk";
        socket.emit(evt, { botId: activeBotTabId, direction: arrowDirMap[e.key] });
      }
      var btn = document.querySelector('.bot-tab-panel .bot-dpad-btn[data-dir="' + arrowDirMap[e.key] + '"]');
      if (btn) {
        btn.classList.add("dpad-pressed");
        setTimeout(function() {
          btn.classList.remove("dpad-pressed");
        }, 150);
      }
    });
    socket.on("nav:arrived", function(data) {
      setNavStatus(data.botId, "Arrived at (" + data.x + ", " + data.y + ") on map " + data.mapId, "var(--green-400)");
      showToast((botStates[data.botId] ? botStates[data.botId].username : data.botId) + " arrived at destination");
      var faceSelect = document.querySelector('.bot-face-after-select[data-bot-id="' + data.botId + '"]');
      if (faceSelect) {
        var faceDir = parseInt(faceSelect.value);
        if (faceDir >= 0 && faceDir <= 3) {
          socket.emit("bot:turn", { botId: data.botId, direction: faceDir });
        }
      }
    });
    socket.on("nav:failed", function(data) {
      setNavStatus(data.botId, "Failed: " + data.reason, "var(--red-400)");
      showToast((botStates[data.botId] ? botStates[data.botId].username : data.botId) + " navigation failed: " + data.reason, true);
    });
    socket.on("nav:step", function(data) {
      setNavStatus(data.botId, "Walking... step " + (data.index + 1) + "/" + data.total + " (" + data.x + ", " + data.y + ")", "var(--gold-400)");
    });
    socket.on("nav:status", function(data) {
      if (data.status) {
        var s = data.status;
        if (s.state === "idle") {
          setNavStatus(data.botId, "Idle", "var(--text-secondary)");
        } else if (s.state === "waiting_map_load") {
          setNavStatus(data.botId, "Waiting for map load...", "var(--gold-400)");
        }
      }
    });
    socket.on("nav:walkToResult", function(data) {
      if (data.success) {
        setNavStatus(data.botId, "Arrived at (" + data.x + ", " + data.y + ")", "var(--green-400)");
        var faceSelect = document.querySelector('.bot-face-after-select[data-bot-id="' + data.botId + '"]');
        if (faceSelect) {
          var faceDir = parseInt(faceSelect.value);
          if (faceDir >= 0 && faceDir <= 3) {
            socket.emit("bot:turn", { botId: data.botId, direction: faceDir });
          }
        }
      }
    });
    socket.on("nav:navigateToResult", function(data) {
      if (data.success) {
        setNavStatus(data.botId, "Arrived at map " + data.mapId + " (" + data.x + ", " + data.y + ")", "var(--green-400)");
        var faceSelect = document.querySelector('.bot-face-after-select[data-bot-id="' + data.botId + '"]');
        if (faceSelect) {
          var faceDir = parseInt(faceSelect.value);
          if (faceDir >= 0 && faceDir <= 3) {
            socket.emit("bot:turn", { botId: data.botId, direction: faceDir });
          }
        }
      }
    });
  })();
})();
