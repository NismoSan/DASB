// @ts-nocheck
import { createBotUi } from './modules/bot-ui';
import { createChatUi } from './modules/chat-ui';
import { createConfigPanel } from './modules/config-panel';
import { createAePanel } from './modules/ae-panel';
import { createDiscordPanel } from './modules/discord-panel';
import { createChatGamesUi } from './modules/chat-games-ui';
import { createScheduledUi } from './modules/scheduled-ui';
import { createPlayersUi } from './modules/players-ui';
import { createStatsUi } from './modules/stats-ui';
import { createAssetMapUi } from './modules/asset-map-ui';
import { createLotteryUi } from './modules/lottery-ui';
import { createSlotsUi } from './modules/slots-ui';
import { createNpcLeakUi } from './modules/npc-leak-ui';
import { createAttendanceUi } from './modules/attendance-ui';
import { createAiChatUi } from './modules/ai-chat-ui';
import { createProxyUi } from './modules/proxy-ui';

(function () {
  var socket = io();

  // ── Logout Handler ─────────────────────────────────────────────

  var logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      fetch('/api/logout', { method: 'POST' }).then(function () {
        window.location.href = '/login';
      }).catch(function () {
        window.location.href = '/login';
      });
    });
  }

  // ── Panel Navigation ─────────────────────────────────────────────

  var navLinks = document.querySelectorAll('#sidebar a[data-panel]');
  var panels = document.querySelectorAll('.panel');

  var contentEl = document.getElementById('content');

  // ── Mobile Sidebar Toggle ──────────────────────────────────────

  var mobileMenuBtn = document.getElementById('mobile-menu-btn');
  var sidebar = document.getElementById('sidebar');
  var sidebarOverlay = document.getElementById('sidebar-overlay');

  function openSidebar() {
    sidebar.classList.add('open');
    sidebarOverlay.classList.add('visible');
    mobileMenuBtn.classList.add('active');
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('visible');
    mobileMenuBtn.classList.remove('active');
  }

  mobileMenuBtn.addEventListener('click', function () {
    if (sidebar.classList.contains('open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  });

  sidebarOverlay.addEventListener('click', function () {
    closeSidebar();
  });

  // ── Panel Navigation ──────────────────────────────────────────

  navLinks.forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      navLinks.forEach(function (l) { l.classList.remove('active'); });
      panels.forEach(function (p) { p.classList.remove('active'); });
      link.classList.add('active');
      document.getElementById('panel-' + link.dataset.panel).classList.add('active');
      // Toggle flex layout on content when chat panel is active
      contentEl.classList.toggle('chat-active', link.dataset.panel === 'chat');
      // Close sidebar on mobile after navigation
      closeSidebar();
    });
  });

  // ── Multi-Bot State ────────────────────────────────────────────

  var botStates = {}; // botId -> state object
  var selectedWalkBotId = null;
  var selectedChatBotId = null;
  var selectedWhisperBotId = null;
  var selectedNavBotId = null;

  var chatUi = createChatUi({
    socket: socket,
    getBotStates: function () { return botStates; },
    getSelectedChatBotId: function () { return selectedChatBotId; },
    setSelectedChatBotId: function (id) { selectedChatBotId = id; },
    getSelectedWhisperBotId: function () { return selectedWhisperBotId; },
    setSelectedWhisperBotId: function (id) { selectedWhisperBotId = id; },
    navLinks: navLinks,
    panels: panels,
    contentEl: contentEl
  });

  var renderChatBotTabs = chatUi.renderChatBotTabs;
  var showToast = chatUi.showToast;

  // ── Uptime Timer ───────────────────────────────────────────────

  setInterval(function () {
    var uptimeEls = document.querySelectorAll('.bot-uptime');
    uptimeEls.forEach(function (el) {
      var connectedAt = parseInt(el.dataset.connectedAt);
      if (!connectedAt) { el.textContent = '--'; return; }
      var elapsed = Date.now() - connectedAt;
      var h = Math.floor(elapsed / 3600000);
      var m = Math.floor((elapsed % 3600000) / 60000);
      var s = Math.floor((elapsed % 60000) / 1000);
      el.textContent = h + 'h ' + m + 'm ' + s + 's';
    });
  }, 1000);

  // ── Tabbed Bot UI ─────────────────────────────────────────────

  var activeBotTabId = null;
  var mapListCache = { nodes: [], reachableIds: [] };
  var walkFavorites = {}; // botId -> [{id, name, mapId, x, y}]
  var loginWalkTargets = {}; // botId -> { favId, faceDirection } or legacy string favId

  var botUi = createBotUi({
    socket: socket,
    getBotStates: function () { return botStates; },
    getActiveBotTabId: function () { return activeBotTabId; },
    setActiveBotTabId: function (id) { activeBotTabId = id; },
    getMapListCache: function () { return mapListCache; },
    getWalkFavorites: function () { return walkFavorites; },
    getLoginWalkTargets: function () { return loginWalkTargets; },
    setSelectedWalkBotId: function (id) { selectedWalkBotId = id; },
    setSelectedChatBotId: function (id) { selectedChatBotId = id; },
    setSelectedWhisperBotId: function (id) { selectedWhisperBotId = id; },
    setSelectedNavBotId: function (id) { selectedNavBotId = id; },
    showToast: showToast,
    renderChatBotTabs: renderChatBotTabs
  });

  var buildMapOptions = botUi.buildMapOptions;
  var setNavStatus = botUi.setNavStatus;
  var renderActiveBotTab = botUi.renderActiveBotTab;
  var renderAllBotCards = botUi.renderAllBotCards;
  var updateBotCard = botUi.updateBotCard;
  var updateSidebarIndicator = botUi.updateSidebarIndicator;
  var updateBotSelectors = botUi.updateBotSelectors;

  createConfigPanel({
    socket: socket,
    showToast: showToast
  });

  createAePanel({
    socket: socket
  });

  createDiscordPanel({
    socket: socket,
    showToast: showToast
  });

  createChatGamesUi({
    socket: socket,
    showToast: showToast
  });

  createScheduledUi({
    socket: socket,
    getBotStates: function () { return botStates; },
    showToast: showToast
  });

  createPlayersUi({
    socket: socket,
    navLinks: navLinks,
    showToast: showToast
  });

  createStatsUi({
    socket: socket,
    navLinks: navLinks
  });

  createAssetMapUi({
    navLinks: navLinks
  });

  createLotteryUi({
    socket: socket,
    navLinks: navLinks,
    showToast: showToast
  });

  createSlotsUi({
    socket: socket,
    navLinks: navLinks,
    showToast: showToast
  });

  createNpcLeakUi({
    socket: socket,
    navLinks: navLinks,
    showToast: showToast
  });

  createAttendanceUi({
    socket: socket
  });

  createAiChatUi({
    socket: socket
  });

  createProxyUi({
    socket: socket,
    buildMapOptions: buildMapOptions,
    getMapListCache: function () { return mapListCache; },
    getBotStates: function () { return botStates; },
    showToast: showToast
  });

  socket.emit('nav:getMapList');
  socket.emit('nav:getFavorites');
  socket.emit('nav:getLoginWalkTargets');

  socket.on('nav:mapList', function (data) {
    mapListCache = data || { nodes: [], reachableIds: [] };
    renderActiveBotTab();
  });

  socket.on('nav:favorites', function (data) {
    walkFavorites = data || {};
    renderActiveBotTab();
  });

  socket.on('nav:loginWalkTargets', function (data) {
    loginWalkTargets = data || {};
    Object.keys(loginWalkTargets).forEach(function (bid) {
      var v = loginWalkTargets[bid];
      if (typeof v === 'string') {
        loginWalkTargets[bid] = { favId: v, faceDirection: -1 };
      }
    });
    renderActiveBotTab();
  });

  // ── Bot Status Events ──────────────────────────────────────────

  socket.on('bots:statusAll', function (states) {
    botStates = {};
    if (states && states.length > 0) {
      states.forEach(function (state) {
        botStates[state.id] = state;
      });
    }
    renderAllBotCards();
    updateSidebarIndicator();
    updateBotSelectors();
    renderChatBotTabs();
  });

  socket.on('bot:status', function (state) {
    if (!state || !state.id) return;
    var isNew = !botStates[state.id];
    botStates[state.id] = state;
    updateBotCard(state);
    updateSidebarIndicator();
    updateBotSelectors();
    if (isNew) renderChatBotTabs();
  });

  // ── Global Bot Controls ────────────────────────────────────────

  document.getElementById('btn-start-all').addEventListener('click', function () {
    socket.emit('bots:startAll');
  });
  document.getElementById('btn-stop-all').addEventListener('click', function () {
    socket.emit('bots:stopAll');
  });

  document.getElementById('btn-reload-modules').addEventListener('click', function () {
    socket.emit('hotreload:trigger', {});
  });

  // Hot-reload notifications
  socket.on('hotreload:success', function (data) {
    showToast('Reloaded: ' + data.file, false);
  });
  socket.on('hotreload:error', function (data) {
    showToast('Reload failed: ' + data.file + ' — ' + (data.error || 'unknown'), true);
  });
  socket.on('hotreload:result', function (data) {
    if (data.succeeded !== undefined) {
      showToast('Reloaded ' + data.succeeded + ' modules (' + data.failed + ' failed)', data.failed > 0);
    } else {
      showToast(data.success ? 'Reloaded: ' + data.file : 'Failed: ' + (data.error || data.file), !data.success);
    }
  });

  // ── D-Pad Controls ─────────────────────────────────────────────

  // Arrow key movement for active bot tab
  var arrowDirMap = { ArrowUp: 0, ArrowRight: 1, ArrowDown: 2, ArrowLeft: 3 };

  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (!arrowDirMap.hasOwnProperty(e.key)) return;
    e.preventDefault();
    if (activeBotTabId) {
      var modeBtn = document.querySelector('.bot-tab-panel .bot-dpad-mode-btn');
      var mode = modeBtn ? modeBtn.dataset.mode : 'walk';
      var evt = mode === 'turn' ? 'bot:turn' : 'bot:walk';
      socket.emit(evt, { botId: activeBotTabId, direction: arrowDirMap[e.key] });
    }
    var btn = document.querySelector('.bot-tab-panel .bot-dpad-btn[data-dir="' + arrowDirMap[e.key] + '"]');
    if (btn) {
      btn.classList.add('dpad-pressed');
      setTimeout(function () { btn.classList.remove('dpad-pressed'); }, 150);
    }
  });

  // ── Navigation Events (per-bot status updates) ──────────────

  socket.on('nav:arrived', function (data) {
    setNavStatus(data.botId, 'Arrived at (' + data.x + ', ' + data.y + ') on map ' + data.mapId, 'var(--green-400)');
    showToast((botStates[data.botId] ? botStates[data.botId].username : data.botId) + ' arrived at destination');
    // Auto-turn after arrival if configured
    var faceSelect = document.querySelector('.bot-face-after-select[data-bot-id="' + data.botId + '"]');
    if (faceSelect) {
      var faceDir = parseInt(faceSelect.value);
      if (faceDir >= 0 && faceDir <= 3) {
        socket.emit('bot:turn', { botId: data.botId, direction: faceDir });
      }
    }
  });

  socket.on('nav:failed', function (data) {
    setNavStatus(data.botId, 'Failed: ' + data.reason, 'var(--red-400)');
    showToast((botStates[data.botId] ? botStates[data.botId].username : data.botId) + ' navigation failed: ' + data.reason, true);
  });

  socket.on('nav:step', function (data) {
    setNavStatus(data.botId, 'Walking... step ' + (data.index + 1) + '/' + data.total + ' (' + data.x + ', ' + data.y + ')', 'var(--gold-400)');
  });

  socket.on('nav:status', function (data) {
    if (data.status) {
      var s = data.status;
      if (s.state === 'idle') {
        setNavStatus(data.botId, 'Idle', 'var(--text-secondary)');
      } else if (s.state === 'waiting_map_load') {
        setNavStatus(data.botId, 'Waiting for map load...', 'var(--gold-400)');
      }
    }
  });

  socket.on('nav:walkToResult', function (data) {
    if (data.success) {
      setNavStatus(data.botId, 'Arrived at (' + data.x + ', ' + data.y + ')', 'var(--green-400)');
      // Auto-turn after walk if configured
      var faceSelect = document.querySelector('.bot-face-after-select[data-bot-id="' + data.botId + '"]');
      if (faceSelect) {
        var faceDir = parseInt(faceSelect.value);
        if (faceDir >= 0 && faceDir <= 3) {
          socket.emit('bot:turn', { botId: data.botId, direction: faceDir });
        }
      }
    }
  });

  socket.on('nav:navigateToResult', function (data) {
    if (data.success) {
      setNavStatus(data.botId, 'Arrived at map ' + data.mapId + ' (' + data.x + ', ' + data.y + ')', 'var(--green-400)');
      // Auto-turn after navigate if configured
      var faceSelect = document.querySelector('.bot-face-after-select[data-bot-id="' + data.botId + '"]');
      if (faceSelect) {
        var faceDir = parseInt(faceSelect.value);
        if (faceDir >= 0 && faceDir <= 3) {
          socket.emit('bot:turn', { botId: data.botId, direction: faceDir });
        }
      }
    }
  });

})();
