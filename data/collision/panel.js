require('dotenv').config();
const express = require('express');
const compression = require('compression');
const http = require('http');
const { Server: SocketIO } = require('socket.io');
const path = require('path');
const { Client, Packet } = require('./');
var aeIngest = require('./lib/features/ae-ingest');
var discord = require('./lib/features/discord');
var chatGames = require('./lib/games');
var tradeSessions = require('./lib/features/trade-sessions');
var aiChat = require('./lib/features/ai-chat');
var iconv = require('iconv-lite');
var db = require('./lib/features/database');

// Extracted modules
var auth = require('./lib/features/auth');
var configManager = require('./lib/features/config-manager');
var opcodes = require('./lib/core/opcodes');
var playerTracker = require('./lib/features/player-tracker');
var scheduledMessages = require('./lib/features/scheduled-messages');
var { getSpriteRenderer } = require('./lib/features/sprite-renderer');
var fs = require('fs');
var { Navigator } = require('./lib/features/navigator');
var lottery = require('./lib/features/lottery');
var sense = require('./lib/features/sense');
var itemTrade = require('./lib/features/item-trade');
var npcLeak = require('./lib/features/npc-leak');
var slotMachine = require('./lib/features/slot-machine');
var { createProxySystem } = require('./lib/proxy/index');

// ── Proxy System ────────────────────────────────────────────────
var proxySystem = null;

/**
 * Save the current virtual NPCs to config for persistence across restarts.
 * Strips runtime-only fields (serial) and saves the placement data.
 */
function saveVirtualNpcs() {
  if (!proxySystem) return;
  var npcs = proxySystem.augmentation.npcs.getAllNPCs();
  var toSave = npcs.map(function (npc) {
    return {
      name: npc.name,
      sprite: npc.sprite,
      x: npc.x,
      y: npc.y,
      mapNumber: npc.mapNumber,
      direction: npc.direction,
      creatureType: npc.creatureType,
      dialog: npc.dialog || undefined
    };
  });
  var config = loadConfig();
  config.virtualNpcs = toSave;
  saveConfig(config);
}

/**
 * Restore virtual NPCs from config on proxy startup.
 */
function restoreVirtualNpcs() {
  if (!proxySystem) return;
  var config = loadConfig();
  var saved = config.virtualNpcs;
  if (!saved || !Array.isArray(saved) || saved.length === 0) return;
  console.log('[Proxy] Restoring ' + saved.length + ' virtual NPCs from config...');
  for (var i = 0; i < saved.length; i++) {
    proxySystem.augmentation.npcs.placeNPC(saved[i]);
  }
}

// Initialize config manager with DB reference
configManager.init(db);

// Shorthand
var loadConfig = configManager.loadConfig;
var saveConfig = configManager.saveConfig;

// ── Sent-whisper echo dedup ──────────────────────────────────────
// When the bot sends a whisper, the server echoes it back as a 0x0A
// packet on channel 0.  We track recently sent whispers so the
// incoming-whisper handler can ignore echoes and avoid double-processing.
var recentSentWhispers = new Map(); // key: "target|message" → expiry timestamp

function recordSentWhisper(target, message) {
  var key = target.toLowerCase() + '|' + message;
  recentSentWhispers.set(key, Date.now() + 5000); // 5s TTL
}

function isSentWhisperEcho(sender, message) {
  var key = sender.toLowerCase() + '|' + message;
  var expiry = recentSentWhispers.get(key);
  if (expiry && Date.now() < expiry) {
    recentSentWhispers.delete(key);
    return true;
  }
  if (expiry) recentSentWhispers.delete(key); // expired, clean up
  return false;
}

// ── Multi-Bot State ─────────────────────────────────────────────

var bots = new Map();

function createBotState(botConfig) {
  return {
    id: botConfig.id,
    status: 'disconnected',
    connectedAt: null,
    position: { x: 0, y: 0 },
    mapNumber: 0,
    mapName: '',
    serverName: '',
    username: botConfig.username,
    reconnectAttempt: 0,
    reconnectDelay: 0,
    role: botConfig.role || 'secondary'
  };
}

function getPrimaryBot() {
  var primary = null;
  bots.forEach(function (bot) {
    if (bot.config.role === 'primary' && bot.client && bot.state.status === 'logged_in') {
      primary = bot;
    }
  });
  if (!primary) {
    bots.forEach(function (bot) {
      if (!primary && bot.client && bot.state.status === 'logged_in') {
        primary = bot;
      }
    });
  }
  return primary;
}

function getAllBotStates() {
  var states = [];
  bots.forEach(function (bot) { states.push(bot.state); });
  return states;
}

function isPrimaryBot(botId) {
  var bot = bots.get(botId);
  return bot && bot.config.role === 'primary';
}

function isLotteryBot(botId) {
  var bot = bots.get(botId);
  return bot && bot.config.role === 'lottery';
}

function getLotteryBot() {
  var found = null;
  bots.forEach(function (bot) {
    if (bot.config.role === 'lottery' && bot.client && bot.state.status === 'logged_in') {
      found = bot;
    }
  });
  return found;
}

function isTrackerBot(botId) {
  var bot = bots.get(botId);
  return bot && bot.config.role === 'tracker';
}

function getTrackerBot() {
  var found = null;
  bots.forEach(function (bot) {
    if (bot.config.role === 'tracker' && bot.client && bot.state.status === 'logged_in') {
      found = bot;
    }
  });
  return found;
}

function isSenseBot(botId) {
  var bot = bots.get(botId);
  return bot && bot.config.role === 'sense';
}

function getSenseBot() {
  var found = null;
  bots.forEach(function (bot) {
    if (bot.config.role === 'sense' && bot.client && bot.state.status === 'logged_in') {
      found = bot;
    }
  });
  return found;
}

function isLeakBot(botId) {
  var bot = bots.get(botId);
  return bot && bot.config.role === 'leak';
}

function getLeakBot() {
  var found = null;
  bots.forEach(function (bot) {
    if (bot.config.role === 'leak' && bot.client && bot.state.status === 'logged_in') {
      found = bot;
    }
  });
  return found;
}

function isTraderBot(botId) {
  var bot = bots.get(botId);
  return bot && bot.config.role === 'trader';
}

function getTraderBot() {
  var found = null;
  bots.forEach(function (bot) {
    if (bot.config.role === 'trader' && bot.client && bot.state.status === 'logged_in') {
      found = bot;
    }
  });
  return found;
}

function traderSendPacket(packet) {
  var traderBot = getTraderBot();
  if (traderBot && traderBot.client && traderBot.state.status === 'logged_in') {
    traderBot.client.send(packet);
  }
}

function traderSendWhisper(target, message) {
  var traderBot = getTraderBot();
  if (traderBot && traderBot.client && traderBot.state.status === 'logged_in') {
    recordSentWhisper(target, message.substring(0, 64));
    var p = new Packet(0x19);
    p.writeString8(target);
    p.writeString8(message.substring(0, 64));
    traderBot.client.send(p);
  }
}

// ── Slot Machine Bot Helpers ─────────────────────────────────────

function isSlotBot(botId) {
  var bot = bots.get(botId);
  return bot && bot.config.role === 'slots';
}

function getSlotBot() {
  var found = null;
  bots.forEach(function (bot) {
    if (bot.config.role === 'slots' && bot.client && bot.state.status === 'logged_in') {
      found = bot;
    }
  });
  return found;
}

var slotBankingActive = false;

function slotSendPacket(packet) {
  var slotBot = getSlotBot();
  if (slotBot && slotBot.client && slotBot.state.status === 'logged_in') {
    slotBot.client.send(packet);
  }
}

function slotSendWhisper(target, message) {
  var slotBot = getSlotBot();
  if (slotBot && slotBot.client && slotBot.state.status === 'logged_in') {
    recordSentWhisper(target, message.substring(0, 64));
    var p = new Packet(0x19);
    p.writeString8(target);
    p.writeString8(message.substring(0, 64));
    slotBot.client.send(p);
  }
}

function slotSendSay(message) {
  var slotBot = getSlotBot();
  if (slotBot && slotBot.client && slotBot.state.status === 'logged_in') {
    var p = new Packet(0x0E);
    p.writeByte(0x00);
    p.writeString8(message.substring(0, 64));
    slotBot.client.send(p);
  }
}

// ── Attendance Tracker ──────────────────────────────────────────
// Tracks unique players who appear on the tracker bot's screen during an event.

var attendanceState = {
  active: false,
  eventName: '',
  startedAt: null,
  stoppedAt: null,
  attendees: {},   // key: name.toLowerCase(), value: { name, firstSeen, lastSeen, sightings }
  totalCount: 0,
  eventId: null     // DB event ID for persistence
};

function attendanceRecordPlayer(name) {
  if (!attendanceState.active || !name) return;
  var key = name.toLowerCase();
  var now = Date.now();
  if (attendanceState.attendees[key]) {
    attendanceState.attendees[key].lastSeen = now;
    attendanceState.attendees[key].sightings++;
  } else {
    attendanceState.attendees[key] = {
      name: name,
      firstSeen: now,
      lastSeen: now,
      sightings: 1
    };
    attendanceState.totalCount++;
    io.emit('attendance:newAttendee', { name: name, totalCount: attendanceState.totalCount });
    if (attendanceState.eventId) {
      db.updateAttendanceEventCount(attendanceState.eventId, attendanceState.totalCount);
    }
  }
  // Persist attendee record to DB
  if (attendanceState.eventId) {
    var a = attendanceState.attendees[key];
    db.upsertAttendanceRecord(attendanceState.eventId, a.name, a.firstSeen, a.lastSeen, a.sightings);
  }
}

function getAttendanceState() {
  var list = [];
  var keys = Object.keys(attendanceState.attendees);
  for (var i = 0; i < keys.length; i++) {
    list.push(attendanceState.attendees[keys[i]]);
  }
  list.sort(function (a, b) { return a.firstSeen - b.firstSeen; });
  return {
    active: attendanceState.active,
    eventName: attendanceState.eventName,
    startedAt: attendanceState.startedAt,
    stoppedAt: attendanceState.stoppedAt,
    attendees: list,
    totalCount: attendanceState.totalCount
  };
}

function lotterySendSay(message) {
  var lotteryBot = getLotteryBot();
  if (lotteryBot && lotteryBot.client && lotteryBot.state.status === 'logged_in') {
    var p = new Packet(0x0E);
    p.writeByte(0x00);
    p.writeString8(message.substring(0, 64));
    lotteryBot.client.send(p);
  }
}

function lotterySendWhisper(target, message) {
  var lotteryBot = getLotteryBot();
  if (lotteryBot && lotteryBot.client && lotteryBot.state.status === 'logged_in') {
    recordSentWhisper(target, message.substring(0, 64));
    var p = new Packet(0x19);
    p.writeString8(target);
    p.writeString8(message.substring(0, 64));
    lotteryBot.client.send(p);
  }
}

function lotterySendPacket(packet) {
  var lotteryBot = getLotteryBot();
  if (lotteryBot && lotteryBot.client && lotteryBot.state.status === 'logged_in') {
    lotteryBot.client.send(packet);
  }
}

// ── Mention Detection ─────────────────────────────────────────────

function getAllBotUsernames() {
  var names = [];
  bots.forEach(function (bot) {
    if (bot.state.username) names.push(bot.state.username.toLowerCase());
  });
  return names;
}

function checkForMentions(chatEntry, senderBotUsername) {
  var botNames = getAllBotUsernames();
  var textToCheck = (chatEntry.message || chatEntry.raw || '').toLowerCase();
  var sender = (chatEntry.sender || '').toLowerCase();
  var mentioned = [];
  for (var i = 0; i < botNames.length; i++) {
    var name = botNames[i];
    if (sender === name) continue;
    if (senderBotUsername && senderBotUsername.toLowerCase() === name) continue;
    if (textToCheck.indexOf(name) !== -1) mentioned.push(name);
  }
  return mentioned;
}

// ── Express + Socket.IO ──────────────────────────────────────────

var app = express();
var server = http.createServer(app);
var io = new SocketIO(server);

app.use(compression());
app.use(express.json());

// ── Auth Routes ──────────────────────────────────────────────────

app.get('/login', function (req, res) {
  res.sendFile(path.join(__dirname, 'panel', 'login.html'));
});

app.post('/api/login', function (req, res) {
  var result = auth.login(req.body.username, req.body.password);
  if (result.success) {
    res.cookie('dasb_session', result.token, {
      httpOnly: true,
      maxAge: auth.SESSION_MAX_AGE,
      sameSite: 'strict'
    });
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.post('/api/logout', function (req, res) {
  var cookies = auth.parseCookies(req.headers.cookie);
  auth.logout(cookies.dasb_session);
  res.clearCookie('dasb_session');
  res.json({ success: true });
});

// ── Auth Middleware ────────────────────────────────────────────────

function authMiddleware(req, res, next) {
  var url = req.url.split('?')[0];
  if (url === '/login' || url === '/login.html' ||
      url === '/api/login' || url === '/api/logout') {
    return next();
  }
  if (url.indexOf('/api/trade/') === 0) return next();
  if (url.indexOf('/api/sprite/') === 0) return next();
  if (url.indexOf('/api/sprite-overrides') === 0) return next();
  if (url.indexOf('/api/appearance/') === 0) return next();
  if (url === '/api/userlist') return next();
  if (url.indexOf('/api/slots/') === 0 || url === '/api/slots') return next();
  if (url.indexOf('/api/wheel/') === 0) return next();
  if (url.indexOf('/api/tickets/') === 0 || url === '/api/tickets') return next();
  if (url === '/panel.css' || url === '/panel.min.css') return next();

  var cookies = auth.parseCookies(req.headers.cookie);
  if (auth.isValidSession(cookies.dasb_session)) return next();

  if (req.headers.accept && req.headers.accept.indexOf('text/html') !== -1) {
    return res.redirect('/login');
  }
  res.status(401).json({ error: 'Unauthorized' });
}

app.use(authMiddleware);
app.get('/chat', function (req, res) {
  res.sendFile(path.join(__dirname, 'panel', 'chat.html'));
});
app.use(express.static(path.join(__dirname, 'panel'), { etag: false, maxAge: 0 }));

// ── Trade Session REST API ───────────────────────────────────────

function getIngestKey() {
  var config = loadConfig();
  return (config.aeIngest && config.aeIngest.apiKey) || '';
}

function validateIngestKey(req, res) {
  var key = getIngestKey();
  if (!key) {
    res.status(503).json({ error: 'Ingest key not configured.' });
    return false;
  }
  if (req.headers['x-ingest-key'] !== key) {
    res.status(401).json({ error: 'Unauthorized.' });
    return false;
  }
  return true;
}

app.get('/api/userlist', function (_req, res) {
  var users = playerTracker.getOnlineUsers();
  res.json({ count: users.length, players: users, timestamp: playerTracker.getLastUserListPulse() });
});

// ── Sprite Overrides ─────────────────────────────────────────────

var SPRITE_OVERRIDES_PATH = './data/sprite-overrides.json';

function loadSpriteOverrides() {
  try {
    if (fs.existsSync(SPRITE_OVERRIDES_PATH)) {
      return JSON.parse(fs.readFileSync(SPRITE_OVERRIDES_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('[SpriteOverrides] Error loading:', e.message);
  }
  return {};
}

function saveSpriteOverrides(overrides) {
  try {
    fs.writeFileSync(SPRITE_OVERRIDES_PATH, JSON.stringify(overrides, null, 2), 'utf-8');
  } catch (e) {
    console.error('[SpriteOverrides] Error saving:', e.message);
  }
}

// Apply saved overrides to an appearance object (mutates a copy)
function applyOverrides(appearance, playerName) {
  var overrides = loadSpriteOverrides();
  var key = playerName.toLowerCase();
  if (!overrides[key]) return appearance;
  var merged = Object.assign({}, appearance);
  var ov = overrides[key];
  for (var field in ov) {
    if (ov.hasOwnProperty(field) && field !== '_name') {
      merged[field] = ov[field];
    }
  }
  return merged;
}

// Save override for a player
app.post('/api/sprite-overrides/:playerName', function (req, res) {
  var name = req.params.playerName;
  var fields = req.body;
  if (!fields || typeof fields !== 'object') {
    return res.status(400).json({ error: 'Override fields required' });
  }
  var overrides = loadSpriteOverrides();
  overrides[name.toLowerCase()] = Object.assign({ _name: name }, fields);
  saveSpriteOverrides(overrides);
  // Clear render cache for this player so the override takes effect immediately
  var renderer = getSpriteRenderer();
  if (renderer.initialized) renderer.clearRenderCache();
  res.json({ ok: true, player: name });
});

// Get override for a player
app.get('/api/sprite-overrides/:playerName', function (req, res) {
  var overrides = loadSpriteOverrides();
  var ov = overrides[req.params.playerName.toLowerCase()];
  if (!ov) return res.status(404).json({ error: 'No override for this player' });
  res.json(ov);
});

// Delete override for a player
app.delete('/api/sprite-overrides/:playerName', function (req, res) {
  var overrides = loadSpriteOverrides();
  var key = req.params.playerName.toLowerCase();
  if (!overrides[key]) return res.status(404).json({ error: 'No override found' });
  delete overrides[key];
  saveSpriteOverrides(overrides);
  var renderer = getSpriteRenderer();
  if (renderer.initialized) renderer.clearRenderCache();
  res.json({ ok: true });
});

// List all overrides
app.get('/api/sprite-overrides', function (_req, res) {
  res.json(loadSpriteOverrides());
});

// ── Sprite Rendering API ─────────────────────────────────────────

app.get('/api/sprite/:playerName.png', function (req, res) {
  var renderer = getSpriteRenderer();
  if (!renderer.initialized) {
    renderer.init();
  }
  if (!renderer.initialized) {
    return res.status(503).send('Sprite renderer not available');
  }

  var playerDB = playerTracker.getPlayerDB();
  var player = playerDB[req.params.playerName.toLowerCase()];
  if (!player || !player.appearance) {
    return res.status(404).send('Player appearance not found');
  }

  // Apply any saved overrides for this player
  var appearance = applyOverrides(player.appearance, req.params.playerName);

  var png = renderer.renderCharacter(appearance);
  if (!png) {
    return res.status(404).send('Could not render sprite');
  }

  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'no-cache');
  res.send(png);
});

app.get('/api/appearance/:playerName', function (req, res) {
  var playerDB = playerTracker.getPlayerDB();
  var player = playerDB[req.params.playerName.toLowerCase()];
  if (!player || !player.appearance) {
    return res.status(404).json({ error: 'Player appearance not found' });
  }
  // Apply saved overrides so everyone sees the corrected appearance
  res.json(applyOverrides(player.appearance, req.params.playerName));
});

app.get('/api/sprite-stats', function (_req, res) {
  var renderer = getSpriteRenderer();
  if (!renderer.initialized) renderer.init();
  res.json(renderer.getStats() || { error: 'not initialized' });
});

app.post('/api/sprite/render-custom', function (req, res) {
  var renderer = getSpriteRenderer();
  if (!renderer.initialized) renderer.init();
  if (!renderer.initialized) return res.status(500).json({ error: 'Sprite renderer not available' });
  var appearance = req.body;
  if (!appearance || typeof appearance !== 'object') {
    return res.status(400).json({ error: 'Appearance object required' });
  }
  var png = renderer.renderCharacter(appearance);
  if (!png) return res.status(404).json({ error: 'Could not render with given appearance' });
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'no-cache');
  res.send(png);
});

// List available head/hair sprite IDs for a given gender
app.get('/api/sprite/head-ids/:gender', function (req, res) {
  var renderer = getSpriteRenderer();
  if (!renderer.initialized) renderer.init();
  if (!renderer.initialized) return res.status(500).json({ error: 'Sprite renderer not available' });

  var g = req.params.gender === 'f' ? 'w' : 'm';
  var ids = [];
  // Scan IDs 1-999 for any that have h, e, or f files
  for (var id = 1; id <= 999; id++) {
    if (renderer.findEpfByPrefixId(g + 'h', id, '01') ||
        renderer.findEpfByPrefixId(g + 'e', id, '01') ||
        renderer.findEpfByPrefixId(g + 'f', id, '01')) {
      ids.push(id);
    }
  }
  res.json({ gender: g, ids: ids });
});

// Render a character with a specific head sprite (for browsing)
app.get('/api/sprite/head-preview/:headId.png', function (req, res) {
  var renderer = getSpriteRenderer();
  if (!renderer.initialized) renderer.init();
  if (!renderer.initialized) return res.status(503).send('not ready');

  var baseAppearance = req.query.base ? JSON.parse(req.query.base) : null;
  if (!baseAppearance) {
    // Minimal default appearance
    baseAppearance = { bodySprite: 16, headSprite: 0, skinColor: 0, faceShape: 1 };
  }
  // Strip weapons/accessories so head is clearly visible in the browser
  var appearance = Object.assign({}, baseAppearance, {
    headSprite: parseInt(req.params.headId, 10) || 0,
    weaponSprite: 0,
    shieldSprite: 0,
    acc1Sprite: 0,
    acc2Sprite: 0,
    acc3Sprite: 0
  });
  var png = renderer.renderCharacter(appearance);
  if (!png) return res.status(404).send('no render');
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(png);
});

// List available armor sprite IDs for a given gender
app.get('/api/sprite/armor-ids/:gender', function (req, res) {
  var renderer = getSpriteRenderer();
  if (!renderer.initialized) renderer.init();
  if (!renderer.initialized) return res.status(500).json({ error: 'Sprite renderer not available' });

  var g = req.params.gender === 'f' ? 'w' : 'm';
  var ids = [];
  // Scan standard armor (u files) — IDs 1-999
  for (var id = 1; id <= 999; id++) {
    if (renderer.findEpfByPrefixId(g + 'u', id, '01') ||
        renderer.findEpfByPrefixId(g + 'u', id, '02')) {
      ids.push(id);
    }
  }
  // Scan item shop / high armor (i files) — stored as armorSprite = fileId + 1000
  for (var id2 = 0; id2 <= 999; id2++) {
    if (renderer.findEpfByPrefixId(g + 'i', id2, '01') ||
        renderer.findEpfByPrefixId(g + 'i', id2, '02')) {
      ids.push(id2 + 1000);
    }
  }
  res.json({ gender: g, ids: ids });
});

// Render a character with a specific armor sprite (for browsing)
app.get('/api/sprite/armor-preview/:armorId.png', function (req, res) {
  var renderer = getSpriteRenderer();
  if (!renderer.initialized) renderer.init();
  if (!renderer.initialized) return res.status(503).send('not ready');

  var baseAppearance = req.query.base ? JSON.parse(req.query.base) : null;
  if (!baseAppearance) {
    baseAppearance = { bodySprite: 16, headSprite: 0, skinColor: 0, faceShape: 1 };
  }
  // IDs > 999 are overcoats (i-files), <= 999 are standard armor (u-files)
  var armorId = parseInt(req.params.armorId, 10) || 0;
  var overrides = {
    weaponSprite: 0,
    shieldSprite: 0,
    acc1Sprite: 0,
    acc2Sprite: 0,
    acc3Sprite: 0
  };
  if (armorId > 999) {
    overrides.overcoatSprite = armorId;
    overrides.armorSprite = 0;
  } else {
    overrides.armorSprite = armorId;
    overrides.overcoatSprite = 0;
  }
  var appearance = Object.assign({}, baseAppearance, overrides);
  var png = renderer.renderCharacter(appearance);
  if (!png) return res.status(404).send('no render');
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(png);
});

app.post('/api/trade/send-whisper', function (req, res) {
  if (!validateIngestKey(req, res)) return;
  var result = tradeSessions.createSession({
    buyerUsername: req.body.buyerUsername,
    sellerUsername: req.body.sellerUsername,
    itemName: req.body.itemName,
    listingId: req.body.listingId,
    listingType: req.body.listingType,
    sellerAlts: req.body.sellerAlts || []
  });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ sessionId: result.sessionId });
});

app.get('/api/trade/status/:sessionId', function (req, res) {
  if (!validateIngestKey(req, res)) return;
  var session = tradeSessions.getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found.' });

  req.headers['accept-encoding'] = 'identity';
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  res.write('data: ' + JSON.stringify(session) + '\n\n');
  tradeSessions.addSSEClient(req.params.sessionId, res);
  req.on('close', function () {
    tradeSessions.removeSSEClient(req.params.sessionId, res);
  });
});

// ── Lottery API ──────────────────────────────────────────────────

app.get('/api/lottery', function (req, res) {
  res.json(lottery.getLotteryState());
});

app.post('/api/lottery/start', function (req, res) {
  var drawingName = req.body.drawingName || 'Lottery';
  var result = lottery.startLottery(drawingName);
  if (!result.success) return res.status(400).json({ error: result.message });
  io.emit('lottery:update', lottery.getLotteryState());
  res.json({ success: true, message: result.message });
});

app.post('/api/lottery/draw', function (req, res) {
  var result = lottery.drawWinner();
  if (!result.success) return res.status(400).json({ error: result.message });
  io.emit('lottery:update', lottery.getLotteryState());
  res.json({ success: true, message: result.message, winner: result.winner, audit: result.audit });
});

app.post('/api/lottery/cancel', function (req, res) {
  var result = lottery.cancelLottery();
  if (!result.success) return res.status(400).json({ error: result.message });
  io.emit('lottery:update', lottery.getLotteryState());
  res.json({ success: true, message: result.message });
});

app.post('/api/lottery/reset', function (req, res) {
  var result = lottery.resetLottery();
  io.emit('lottery:update', lottery.getLotteryState());
  res.json({ success: true, message: result.message });
});

app.post('/api/lottery/deliver', function (req, res) {
  var state = lottery.getLotteryState();
  if (!state.winner) return res.status(400).json({ error: 'No winner to deliver to.' });

  // Find the winner's serial from entityNames on the lottery bot
  var lotteryBot = getLotteryBot();
  if (!lotteryBot) return res.status(400).json({ error: 'Lottery bot is not online.' });

  var winnerSerial = null;
  if (lotteryBot.entityNames) {
    for (var serial in lotteryBot.entityNames) {
      if (lotteryBot.entityNames[serial].toLowerCase() === state.winner.toLowerCase()) {
        winnerSerial = parseInt(serial);
        break;
      }
    }
  }
  if (!winnerSerial) return res.status(400).json({ error: 'Winner ' + state.winner + ' is not nearby. They must be on the same map.' });

  lottery.deliverPrize(winnerSerial);
  io.emit('lottery:update', lottery.getLotteryState());
  res.json({ success: true, message: 'Delivering prizes to ' + state.winner });
});

app.post('/api/lottery/sync', function (req, res) {
  var state = lottery.getLotteryState();
  if (!state.id && !state.winner && state.tickets.length === 0) {
    return res.status(400).json({ error: 'No lottery data to sync.' });
  }

  var AE_BACKEND_URL = process.env.AE_BACKEND_URL || '';
  var AE_INGEST_KEY = process.env.AE_INGEST_KEY || '';
  if (!AE_BACKEND_URL) {
    return res.status(400).json({ error: 'AE_BACKEND_URL not configured.' });
  }

  var lotteryId = state.id || ('legacy-' + state.createdAt);
  var uniquePlayers = {};
  state.tickets.forEach(function (t) { uniquePlayers[t.playerName.toLowerCase()] = true; });
  var uniqueCount = Object.keys(uniquePlayers).length;

  // Step 1: Create the lottery record
  fetch(AE_BACKEND_URL + '/api/lottery/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Ingest-Key': AE_INGEST_KEY },
    body: JSON.stringify({
      event: 'lottery:started',
      id: lotteryId,
      drawingName: state.drawingName,
      createdAt: state.createdAt
    })
  }).then(function () {
    // Step 2: Push all tickets
    if (state.tickets.length > 0) {
      return fetch(AE_BACKEND_URL + '/api/lottery/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Ingest-Key': AE_INGEST_KEY },
        body: JSON.stringify({
          event: 'lottery:ticket',
          lotteryId: lotteryId,
          tickets: state.tickets.map(function (t) {
            return { ticketNumber: t.ticketNumber, playerName: t.playerName, itemName: t.itemName || 'Gold Bar', timestamp: t.timestamp };
          })
        })
      });
    }
  }).then(function () {
    // Step 3: If drawn, push the drawn event (without audit for legacy lotteries)
    if (state.winner) {
      var winningTicket = state.tickets.find(function (t) {
        return t.playerName.toLowerCase() === state.winner.toLowerCase();
      });
      return fetch(AE_BACKEND_URL + '/api/lottery/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Ingest-Key': AE_INGEST_KEY },
        body: JSON.stringify({
          event: 'lottery:drawn',
          lotteryId: lotteryId,
          winnerName: state.winner,
          winningTicketNumber: winningTicket ? winningTicket.ticketNumber : null,
          totalTickets: state.tickets.length,
          uniquePlayers: uniqueCount,
          drawnAt: state.drawnAt ? new Date(state.drawnAt).toISOString() : new Date().toISOString()
        })
      });
    }
  }).then(function () {
    res.json({ success: true, message: 'Lottery synced to AislingExchange.' });
  }).catch(function (err) {
    console.log('[Lottery] Sync to AE failed: ' + (err.message || err));
    res.status(500).json({ error: 'Failed to sync: ' + (err.message || 'unknown error') });
  });
});

app.get('/api/lottery/tickets/:playerName', function (req, res) {
  var tickets = lottery.getPlayerTickets(req.params.playerName);
  res.json({ playerName: req.params.playerName, tickets: tickets });
});

// ── Slot Machine API ─────────────────────────────────────────────

app.get('/api/slots', function (req, res) {
  res.json(slotMachine.getSlotState());
});

app.get('/api/slots/player/:name', function (req, res) {
  var state = slotMachine.getPlayerState(req.params.name);
  if (!state) return res.status(404).json({ error: 'Player not found.' });
  res.json(state);
});

app.post('/api/slots/config', function (req, res) {
  var updated = slotMachine.saveConfigUpdate(req.body);
  res.json({ success: true, config: updated });
});

app.post('/api/slots/end-session', function (req, res) {
  var result = slotMachine.forceEndSession();
  if (!result.success) return res.status(400).json({ error: result.message });
  res.json(result);
});

app.post('/api/slots/clear-queue', function (req, res) {
  var result = slotMachine.forceClearQueue();
  res.json(result);
});

app.post('/api/slots/spin', function (req, res) {
  var playerName = req.body.playerName;
  var betAmount = req.body.betAmount;
  if (!playerName) return res.status(400).json({ error: 'playerName required' });
  var result = slotMachine.webSpin(playerName, betAmount);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

app.post('/api/slots/bet', function (req, res) {
  var playerName = req.body.playerName;
  var amount = parseInt(req.body.amount);
  if (!playerName) return res.status(400).json({ error: 'playerName required' });
  if (isNaN(amount) || amount <= 0) return res.status(400).json({ error: 'Invalid bet amount.' });
  var result = slotMachine.webSetBet(playerName, amount);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

app.get('/api/slots/banking', function (req, res) {
  res.json(slotMachine.getBankingConfig());
});

app.post('/api/slots/banking', function (req, res) {
  var updated = slotMachine.saveBankingConfigUpdate(req.body);
  res.json({ success: true, banking: updated });
});

app.post('/api/slots/offload', function (req, res) {
  var targetName = req.body.targetName;
  var amount = parseInt(req.body.amount);
  if (!targetName || typeof targetName !== 'string') return res.status(400).json({ error: 'targetName required' });
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
  var result = slotMachine.initiateOffload(targetName.trim(), amount);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true });
});

// ── Wheel Spin API ────────────────────────────────────────────────

app.post('/api/wheel/spin', function (req, res) {
  var playerName = req.body.playerName;
  if (!playerName) return res.status(400).json({ error: 'playerName required' });
  var result = slotMachine.wheelSpin(playerName);
  if (result.error) {
    var status = result.error === 'Already spun today' ? 429 : 400;
    return res.status(status).json(result);
  }
  res.json(result);
});

app.get('/api/wheel/status/:playerName', function (req, res) {
  res.json(slotMachine.wheelStatus(req.params.playerName));
});

app.get('/api/wheel/history/:playerName', function (req, res) {
  res.json(slotMachine.wheelHistory(req.params.playerName));
});

// ── Scratch-Off Tickets API ───────────────────────────────────────

app.post('/api/tickets/buy', function (req, res) {
  var playerName = req.body.playerName;
  var tier = req.body.tier;
  if (!playerName) return res.status(400).json({ error: 'playerName required' });
  if (!tier) return res.status(400).json({ error: 'tier required' });
  var result = slotMachine.buyTicket(playerName, tier);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json(result);
});

app.get('/api/tickets/history/:playerName', function (req, res) {
  var playerName = decodeURIComponent(req.params.playerName);
  var result = slotMachine.getTicketHistory(playerName);
  res.json(result);
});

// ── Item Trade API ───────────────────────────────────────────────

app.get('/api/item-trade/offers', function (req, res) {
  res.json({ offers: itemTrade.getOffers(), inventory: itemTrade.getInventory() });
});

app.post('/api/item-trade/offers', function (req, res) {
  var result = itemTrade.addOffer(req.body.wantItem, req.body.giveItem);
  if (!result.success) return res.status(400).json({ error: result.message });
  io.emit('itemTrade:update', { offers: itemTrade.getOffers(), inventory: itemTrade.getInventory() });
  res.json({ success: true, message: result.message, offer: result.offer });
});

app.delete('/api/item-trade/offers/:offerId', function (req, res) {
  var result = itemTrade.removeOffer(req.params.offerId);
  if (!result.success) return res.status(400).json({ error: result.message });
  io.emit('itemTrade:update', { offers: itemTrade.getOffers(), inventory: itemTrade.getInventory() });
  res.json({ success: true, message: result.message });
});

app.post('/api/item-trade/offers/:offerId/toggle', function (req, res) {
  var result = itemTrade.toggleOffer(req.params.offerId);
  if (!result.success) return res.status(400).json({ error: result.message });
  io.emit('itemTrade:update', { offers: itemTrade.getOffers(), inventory: itemTrade.getInventory() });
  res.json({ success: true, message: result.message, enabled: result.enabled });
});

app.get('/api/item-trade/log', function (req, res) {
  res.json({ log: itemTrade.getTradeLog() });
});

app.get('/api/item-trade/inventory', function (req, res) {
  res.json({ inventory: itemTrade.getInventory() });
});

// ── Sequential Reconnect Orchestrator ────────────────────────────

var reconnectOrchestrator = {
  active: false,
  leaderBotId: null,
  pendingBotIds: [],

  onBotDisconnected: function (botId) {
    var config = loadConfig();
    if (!config.reconnectStrategy || !config.reconnectStrategy.sequential) return false;

    if (!this.active) {
      this.active = true;
      this.leaderBotId = botId;
      this.pendingBotIds = [];
      var self = this;
      if (config.bots) {
        config.bots.forEach(function (botConfig) {
          if (botConfig.id !== botId && botConfig.enabled !== false) {
            self.pendingBotIds.push(botConfig.id);
          }
        });
      }
      console.log('Reconnect orchestrator: ' + botId + ' is leader, ' + this.pendingBotIds.length + ' bots queued');
      return false;
    } else {
      if (botId === this.leaderBotId) return false;
      if (this.pendingBotIds.indexOf(botId) === -1) this.pendingBotIds.push(botId);
      return true;
    }
  },

  onBotLoggedIn: function (botId) {
    if (!this.active) return;
    console.log('Reconnect orchestrator: ' + botId + ' logged in, ' + this.pendingBotIds.length + ' remaining');
    this.reconnectNext();
  },

  reconnectNext: function () {
    if (this.pendingBotIds.length === 0) {
      console.log('Reconnect orchestrator: all bots reconnected');
      this.active = false;
      this.leaderBotId = null;
      return;
    }
    var nextBotId = this.pendingBotIds.shift();
    var config = loadConfig();
    var delay = (config.reconnectStrategy && config.reconnectStrategy.delayBetweenBots) || 5000;
    console.log('Reconnect orchestrator: starting ' + nextBotId + ' in ' + (delay / 1000) + 's');
    setTimeout(function () {
      var bot = bots.get(nextBotId);
      if (bot && (!bot.client || bot.state.status === 'disconnected' || bot.state.status === 'waiting_reconnect')) {
        startBot(nextBotId);
      } else {
        reconnectOrchestrator.reconnectNext();
      }
    }, delay);
  },

  reset: function () {
    this.active = false;
    this.leaderBotId = null;
    this.pendingBotIds = [];
  }
};

// ── Bot Client Management ────────────────────────────────────────

function botSendSay(message) {
  var primary = getPrimaryBot();
  if (primary && primary.client && primary.state.status === 'logged_in') {
    var p = new Packet(0x0E);
    p.writeByte(0x00);
    p.writeString8(message);
    primary.client.send(p);
  }
}

function botSendWhisper(target, message) {
  var primary = getPrimaryBot();
  if (primary && primary.client && primary.state.status === 'logged_in') {
    recordSentWhisper(target, message);
    var p = new Packet(0x19);
    p.writeString8(target);
    p.writeString8(message);
    primary.client.send(p);
  }
}

function botSendEmote(emoteId) {
  var primary = getPrimaryBot();
  if (primary && primary.client && primary.state.status === 'logged_in') {
    var p = new Packet(0x1D);
    p.writeByte(emoteId);
    primary.client.send(p);
  }
}

function botRequestUserList() {
  var primary = getPrimaryBot();
  if (primary && primary.client && primary.state.status === 'logged_in') {
    var p = new Packet(0x18);
    primary.client.send(p);
  }
}

function attachPacketInterceptors(c, botId) {
  var originalSend = c.send.bind(c);
  c.send = function (packet) {
    var bot = bots.get(botId);
    var info = {
      botId: botId,
      direction: 'out',
      opcode: opcodes.toHex(packet.opcode),
      bodyLength: packet.body.length,
      hexDump: packet.bodyWithHeader().map(function (b) {
        return ('0' + b.toString(16).toUpperCase()).slice(-2);
      }).join(' '),
      timestamp: Date.now(),
      label: opcodes.getOpcodeLabel('out', packet.opcode)
    };
    io.emit('packet:data', info);

    if (isPrimaryBot(botId) && packet.opcode === 0x19 && packet.body.length >= 4) {
      var tLen = packet.body[0];
      if (tLen > 0 && tLen + 1 < packet.body.length) {
        var wTarget = iconv.decode(Buffer.from(packet.body.slice(1, 1 + tLen)), 'win1252');
        var mStart = 1 + tLen;
        var mLen = packet.body[mStart];
        if (mLen > 0 && mStart + 1 + mLen <= packet.body.length) {
          var wMsg = iconv.decode(Buffer.from(packet.body.slice(mStart + 1, mStart + 1 + mLen)), 'win1252');
          aeIngest.forwardWhisper(bot ? bot.state.username : '', wTarget, wMsg);
          discord.checkAndDispatch({
            type: 'Whisper',
            text: wMsg,
            target: wTarget,
            clientId: 0,
            characterName: bot ? bot.state.username : ''
          });
        }
      }
    }

    originalSend(packet);
  };

  var originalEmit = c.events.emit.bind(c.events);
  c.events.emit = function (opcode, packet, clientRef) {
    if (typeof opcode === 'number' && packet && packet.body) {
      var savedPosition = packet.position;
      var info = {
        botId: botId,
        direction: 'in',
        opcode: opcodes.toHex(opcode),
        bodyLength: packet.body.length,
        hexDump: packet.bodyWithHeader().map(function (b) {
          return ('0' + b.toString(16).toUpperCase()).slice(-2);
        }).join(' '),
        timestamp: Date.now(),
        label: opcodes.getOpcodeLabel('in', opcode)
      };
      io.emit('packet:data', info);
      packet.position = savedPosition;
    }
    return originalEmit.apply(c.events, arguments);
  };
}

// Position guard: schedule a navigation attempt back to the bot's favorite spot.
// Retries indefinitely on failure with increasing delays (1.5s → 3s → 5s → 8s → 8s...).
function guardNavigate(bot) {
  var guard = bot.positionGuard;
  if (!guard || guard._debounceTimer) return;
  var delay = guard._retryDelay || 1500;
  guard._debounceTimer = setTimeout(function () {
    guard._debounceTimer = null;
    // Pre-flight checks
    if (!bot.navigator || bot.state.status !== 'logged_in') { guard._retryDelay = 1500; return; }
    var navState = bot.navigator.getStatus().state;
    if (navState !== 'idle' && navState !== 'failed') return;
    var stillDisplaced = (bot.state.position.x !== guard.x || bot.state.position.y !== guard.y || bot.state.mapNumber !== guard.mapId);
    if (!stillDisplaced) { guard._retryDelay = 1500; return; }

    console.log('[Guard] ' + bot.state.username + ' was displaced — walking back to ' + guard.name + ' (' + guard.mapId + ': ' + guard.x + ',' + guard.y + ')');

    // Reset navigator state so walkTo/navigateTo can start fresh
    bot.navigator.stop();

    var guardArrived = function () {
      bot.navigator.removeListener('arrived', guardArrived);
      bot.navigator.removeListener('failed', guardFailed);
      guard._retryDelay = 1500; // reset on success
      // Face direction after arriving
      if (guard.faceDirection >= 0 && guard.faceDirection <= 3 && bot.client && bot.state.status === 'logged_in') {
        setTimeout(function () {
          if (bot.client && bot.state.status === 'logged_in') {
            var dp = new Packet(0x11);
            dp.writeByte(guard.faceDirection);
            bot.client.send(dp);
          }
        }, 300);
      }
    };
    var guardFailed = function () {
      bot.navigator.removeListener('arrived', guardArrived);
      bot.navigator.removeListener('failed', guardFailed);
      // Schedule retry with backoff
      guard._retryDelay = Math.min((guard._retryDelay || 1500) + 1500, 8000);
      console.log('[Guard] ' + bot.state.username + ' failed to reach spot — retrying in ' + guard._retryDelay + 'ms');
      guardNavigate(bot);
    };
    bot.navigator.on('arrived', guardArrived);
    bot.navigator.on('failed', guardFailed);

    if (guard.mapId === bot.state.mapNumber) {
      bot.navigator.walkTo(guard.x, guard.y);
    } else {
      bot.navigator.navigateTo({ mapId: guard.mapId, x: guard.x, y: guard.y });
    }
  }, delay);
}

function attachGameHandlers(c, botId) {
  var bot = bots.get(botId);

  // Position tracking (0x04)
  c.events.on(0x04, function (packet) {
    var saved = packet.position;
    bot.state.position.x = packet.readUInt16();
    bot.state.position.y = packet.readUInt16();
    packet.position = saved;
    io.emit('bot:status', bot.state);
    if (bot.navigator) {
      bot.navigator.movement.handleMapLocation(bot.state.position.x, bot.state.position.y);
      bot.navigator.updatePosition(bot.state.position.x, bot.state.position.y);
    }
    if (isSenseBot(botId)) {
      sense.updateBotPosition(bot.state.position.x, bot.state.position.y);
    }

    // Position guard: if bot was moved away from its favorite spot, walk back
    var guard = bot.positionGuard;
    if (guard && bot.navigator && bot.state.status === 'logged_in') {
      var displaced = (bot.state.position.x !== guard.x || bot.state.position.y !== guard.y || bot.state.mapNumber !== guard.mapId);
      var navState = bot.navigator.getStatus().state;
      if (displaced && (navState === 'idle' || navState === 'failed')) {
        guardNavigate(bot);
      }
    }
  });

  // Map info (0x15) - format: MapId(u16), WidthLo, HeightLo, Flags, WidthHi, HeightHi, Checksum(u16), Name(string8)
  // Note: built-in mapData handler runs first and consumes packet.position, so we reset to 0
  c.events.on(0x15, function (packet) {
    var saved = packet.position;
    packet.position = 0;
    try {
      if (packet.body.length < 9) { packet.position = saved; return; }
      var mapNumber = packet.readUInt16();
      var widthLo = packet.readByte();
      var heightLo = packet.readByte();
      var flags = packet.readByte();
      var widthHi = packet.readByte();
      var heightHi = packet.readByte();
      var checksum = packet.readUInt16();
      var width = (widthHi << 8) | widthLo;
      var height = (heightHi << 8) | heightLo;

      var mapName = '';
      if (packet.remainder() >= 1) {
        mapName = packet.readString8();
      }

      if (mapNumber > 0) {
        var mapChanged = mapNumber !== bot.state.mapNumber;
        bot.state.mapNumber = mapNumber;
        bot.state.mapWidth = width;
        bot.state.mapHeight = height;
        if (mapName) bot.state.mapName = mapName;
        bot.entityNames = {};
        bot.entityPositions = {};
        if (isSenseBot(botId) && mapChanged) sense.clearEntities();
        io.emit('bot:status', bot.state);
        // console.log('[Map] ' + bot.state.username + ' entered map ' + mapNumber + ': ' + (mapName || '?') + ' (' + width + 'x' + height + ')');
        // Set dimensions on the map object so tile data aligns with the grid
        if (c.map) {
          c.map.Width = width;
          c.map.Height = height;
        }
        if (bot.navigator) bot.navigator.updateMap(mapNumber, mapName || ('Map ' + mapNumber), width, height);
      }
    } catch (e) {
      console.log('[Map] Parse error: ' + (e.message || e));
    }
    packet.position = saved;
  });

  // Map transfer (0x3C) - early map change signal before 0x15 arrives
  c.events.on(0x3C, function (packet) {
    var saved = packet.position;
    try {
      if (packet.remainder() >= 3) {
        packet.readByte();
        var mapNum = packet.readUInt16();
        bot.state.mapNumber = mapNum;
        // Notify navigator of the map change so it detects transitions immediately
        // (0x15 will follow with full dimensions, but 0x3C arrives first)
        if (bot.navigator) {
          bot.navigator.onMapTransfer(mapNum);
        }
      }
    } catch (e) { /* ignore */ }
    packet.position = saved;
    bot.entityNames = {};
    bot.entityPositions = {};
    if (isSenseBot(botId)) sense.clearEntities();
    io.emit('bot:status', bot.state);
  });

  // WalkResponse (0x0B) - forward to navigator
  c.events.on(0x0B, function (packet) {
    var saved = packet.position;
    if (bot.navigator) {
      bot.navigator.movement.handleWalkResponse(packet);
    }
    packet.position = saved;
  });

  // MapTransferComplete (0x58) - notify navigator and build collision from local map files
  c.events.on(0x58, function (packet) {
    if (bot.navigator) {
      // Build collision grid from local .map files + SOTP
      var mapNum = bot.state.mapNumber || 0;
      var w = bot.state.mapWidth || 0;
      var h = bot.state.mapHeight || 0;
      if (mapNum > 0 && w > 0 && h > 0) {
        bot.navigator.buildCollision(mapNum, w, h).then(function () {
          bot.navigator.onMapLoadComplete();
        });
      } else {
        bot.navigator.onMapLoadComplete();
      }
    }
  });

  // WorldMapMessage (0x2E) - learn map nodes
  c.events.on(0x2E, function (packet) {
    var saved = packet.position;
    try {
      if (bot.navigator && packet.remainder() >= 3) {
        var fieldName = packet.readString8();
        var nodeCount = packet.readByte();
        var fieldIndex = packet.readByte();
        var nodes = [];
        for (var i = 0; i < nodeCount; i++) {
          if (packet.remainder() < 10) break;
          var screenX = packet.readUInt16();
          var screenY = packet.readUInt16();
          var name = packet.readString8();
          var checksum = packet.readUInt16();
          var mapId = packet.readUInt16();
          var mapX = packet.readUInt16();
          var mapY = packet.readUInt16();
          nodes.push({ name: name, checksum: checksum, mapId: mapId, mapX: mapX, mapY: mapY });
        }
        if (nodes.length > 0) {
          bot.navigator.mapGraph.addWorldMapNodes(fieldName, nodes);
          console.log('[Nav] Learned ' + nodes.length + ' world map nodes from field: ' + fieldName);
        }
        // Notify navigator that world map UI opened — pass nodes so it can
        // look up checksum/mapId/mapX/mapY for the 0x3F packet
        bot.navigator.onWorldMapReceived(nodes);
      }
    } catch (e) { /* ignore parse errors */ }
    packet.position = saved;
  });

  // Login success (0x05)
  c.events.on(0x05, function (packet) {
    bot.state.status = 'logged_in';
    bot.state.serverName = c.server ? c.server.name : 'Unknown';
    bot.state.username = c.username;
    io.emit('bot:status', bot.state);
    reconnectOrchestrator.onBotLoggedIn(botId);

    // Login walk: navigate to saved favorite after a short delay for map to load
    setTimeout(function () {
      var cfg = loadConfig();
      if (!cfg.loginWalkTargets || !cfg.loginWalkTargets[botId]) return;
      var loginTarget = cfg.loginWalkTargets[botId];
      // Backward compat: old format was just a string favId
      var favId = typeof loginTarget === 'string' ? loginTarget : loginTarget.favId;
      var faceDirection = typeof loginTarget === 'object' && loginTarget.faceDirection >= 0 ? loginTarget.faceDirection : -1;
      var favs = (cfg.walkFavorites && cfg.walkFavorites[botId]) || [];
      var fav = favs.find(function (f) { return f.id === favId; });
      if (!fav || !bot.navigator || bot.state.status !== 'logged_in') return;
      var x = typeof fav.x === 'number' ? fav.x : 0;
      var y = typeof fav.y === 'number' ? fav.y : 0;
      console.log('[Nav] Login walk for ' + bot.state.username + ': navigating to ' + fav.name + ' (map ' + fav.mapId + ', ' + x + ',' + y + ')' + (faceDirection >= 0 ? ' face=' + faceDirection : ''));

      // Set position guard so the bot automatically walks back if displaced
      if (x > 0 || y > 0) {
        bot.positionGuard = { mapId: fav.mapId, x: x, y: y, name: fav.name, faceDirection: faceDirection, _debounceTimer: null };
        console.log('[Guard] Position guard enabled for ' + bot.state.username + ' → ' + fav.name + ' (' + fav.mapId + ': ' + x + ',' + y + ')');
      }

      // Helper: send turn packet after navigation completes
      function sendFaceTurn() {
        if (faceDirection >= 0 && faceDirection <= 3 && bot.client && bot.state.status === 'logged_in') {
          var dirNames = ['North', 'East', 'South', 'West'];
          console.log('[Nav] Login walk complete — turning ' + dirNames[faceDirection]);
          var p = new Packet(0x11);
          p.writeByte(faceDirection);
          bot.client.send(p);
        }
      }

      // Listen for navigation completion to send the face turn
      if (faceDirection >= 0) {
        var onArrived = function () {
          bot.navigator.removeListener('arrived', onArrived);
          bot.navigator.removeListener('failed', onFailed);
          setTimeout(sendFaceTurn, 300);
        };
        var onFailed = function () {
          bot.navigator.removeListener('arrived', onArrived);
          bot.navigator.removeListener('failed', onFailed);
          // Still try to face even if walk failed (bot may be close enough)
          setTimeout(sendFaceTurn, 300);
        };
        bot.navigator.on('arrived', onArrived);
        bot.navigator.on('failed', onFailed);
      }

      if (x <= 0 && y <= 0) {
        // No specific tile saved — just navigate to the map without a tile target
        if (fav.mapId !== bot.state.mapNumber) {
          bot.navigator.navigateTo({ mapId: fav.mapId, x: -1, y: -1 });
        } else if (faceDirection >= 0) {
          // Already on the map, just face
          sendFaceTurn();
        }
      } else if (fav.mapId === bot.state.mapNumber) {
        bot.navigator.walkTo(x, y);
      } else {
        bot.navigator.navigateTo({ mapId: fav.mapId, x: x, y: y });
      }
    }, 3000);
  });

  // Login failure (0x02)
  c.events.on(0x02, function (packet) {
    var saved = packet.position;
    var code = packet.readByte();
    var message = packet.readString8();
    packet.position = saved;
    if (code === 3 || code === 14 || code === 15) {
      bot.state.status = 'disconnected';
      bot.state.connectedAt = null;
      io.emit('bot:status', bot.state);
      io.emit('bot:error', { botId: botId, message: bot.state.username + ' login failed: ' + message });
    }
  });

  // Chat messages (0x0A)
  c.events.on(0x0A, function (packet) {
    var saved = packet.position;
    var channelByte = packet.readByte();
    var messageRaw = '';
    if (packet.remainder() >= 2) messageRaw = packet.readString16();
    packet.position = saved;
    if (!messageRaw) return;

    var chatEntry = {
      botId: botId,
      timestamp: Date.now(),
      channel: channelByte,
      channelName: opcodes.getChatChannelName(channelByte),
      raw: messageRaw,
      sender: '',
      message: ''
    };

    var chatMsg = { type: 'WorldMessage', text: messageRaw, clientId: 0, characterName: bot.state.username };

    if (channelByte === 0) {
      chatMsg.type = 'WhisperReceived';
      var whisperMatch = messageRaw.match(/^"?([A-Za-z][^"]*)"\s*([\s\S]*)$/);
      if (whisperMatch) {
        chatEntry.sender = whisperMatch[1];
        chatEntry.message = whisperMatch[2];
        // Skip echoes of whispers the bot itself sent
        var isEcho = isSentWhisperEcho(whisperMatch[1], whisperMatch[2]);
        if (isPrimaryBot(botId) && bot.client && bot.state.status === 'logged_in' && !isEcho) {
          // Lancelot "say:" override - only Lancelot can make the bot speak publicly
          if (whisperMatch[1].toLowerCase() === 'lancelot') {
            var sayOverride = whisperMatch[2].match(/^say:\s*(.+)/i);
            if (sayOverride) {
              botSendSay(sayOverride[1].trim().substring(0, 64));
            }
          }
          tradeSessions.handleIncomingWhisper(whisperMatch[1], whisperMatch[2]);
          aeIngest.forwardWhisper(whisperMatch[1], bot.state.username, whisperMatch[2]);
          var handled = chatGames.handleWhisper(whisperMatch[1], whisperMatch[2]);
          if (!handled && /^AE-[A-Z0-9]+$/i.test(whisperMatch[2].trim())) {
            var verifyMsg = 'Thank you for verifying your account for AislingExchange!';
            recordSentWhisper(whisperMatch[1], verifyMsg);
            var replyPacket = new Packet(0x19);
            replyPacket.writeString8(whisperMatch[1]);
            replyPacket.writeString8(verifyMsg);
            bot.client.send(replyPacket);
          } else if (!handled && !/^AE-/i.test(whisperMatch[2].trim()) && /^[A-Za-z][A-Za-z0-9 ]{0,29}$/.test(whisperMatch[1])) {
            aiChat.handleWhisper(whisperMatch[1], whisperMatch[2]);
          }
        }
      } else {
        chatEntry.message = messageRaw;
        if (isPrimaryBot(botId)) tradeSessions.handleSystemMessage(messageRaw);
      }

      chatEntry.mentions = checkForMentions(chatEntry, bot.state.username);
      emitChat(chatEntry);
      if (isPrimaryBot(botId)) {
        if (chatEntry.sender) {
          io.emit('whisper:received', {
            botId: botId, timestamp: chatEntry.timestamp,
            sender: chatEntry.sender, message: chatEntry.message,
            channelName: 'Whisper', channel: 0
          });
        }
        if (chatEntry.mentions.length > 0) io.emit('mention:detected', chatEntry);
        discord.checkAndDispatch(chatMsg);
      }

    } else if (channelByte === 11) {
      chatMsg.type = 'GroupMessage';
      var quoteIdx = messageRaw.indexOf('" ');
      if (quoteIdx !== -1) {
        chatEntry.sender = messageRaw.substring(0, quoteIdx).replace(/^"/, '');
        chatEntry.message = messageRaw.substring(quoteIdx + 2);
      } else {
        chatEntry.message = messageRaw;
      }
      chatEntry.mentions = checkForMentions(chatEntry, bot.state.username);
      emitChat(chatEntry);
      if (isPrimaryBot(botId)) {
        if (chatEntry.mentions.length > 0) io.emit('mention:detected', chatEntry);
        discord.checkAndDispatch(chatMsg);
      }

    } else if (channelByte === 12) {
      chatMsg.type = 'GuildMessage';
      var guildMatch = messageRaw.match(/^<!.+?>\s*(.+?):\s*([\s\S]*)$/);
      if (guildMatch) {
        chatEntry.sender = guildMatch[1];
        chatEntry.message = guildMatch[2];
      } else {
        chatEntry.message = messageRaw;
      }
      chatEntry.mentions = checkForMentions(chatEntry, bot.state.username);
      emitChat(chatEntry);
      if (isPrimaryBot(botId)) {
        if (chatEntry.mentions.length > 0) io.emit('mention:detected', chatEntry);
        discord.checkAndDispatch(chatMsg);
      }

    } else {
      var shoutMatch = messageRaw.match(/^\[(.+?)\]:\s*([\s\S]*)$/);
      if (shoutMatch) {
        chatMsg.type = 'WorldShout';
        chatEntry.channelName = 'World Shout';
        chatEntry.channel = 5;
        chatEntry.sender = shoutMatch[1];
        chatEntry.message = shoutMatch[2];
      } else {
        chatEntry.message = messageRaw;
      }
      chatEntry.mentions = checkForMentions(chatEntry, bot.state.username);
      emitChat(chatEntry);
      if (isPrimaryBot(botId)) {
        if (shoutMatch) aeIngest.enqueueWorldShout(messageRaw);
        if (chatEntry.mentions.length > 0) io.emit('mention:detected', chatEntry);
        discord.checkAndDispatch(chatMsg);
      }
    }
  });

  // Entity tracking
  if (!bot.entityNames) bot.entityNames = {};
  if (!bot.entityPositions) bot.entityPositions = {};

  // AddEntity (0x07) - extract NPC serials so banking can find Celesta etc.
  c.events.on(0x07, function (packet) {
    var saved = packet.position;
    try {
      var count = packet.readUInt16();
      for (var i = 0; i < count; i++) {
        var x = packet.readUInt16();
        var y = packet.readUInt16();
        var serial = packet.readUInt32();
        var sprite = packet.readUInt16();

        if (sprite & 0x4000) {
          // Creature
          packet.readUInt32(); // unknown
          packet.readByte();   // direction
          packet.readByte();   // unknown
          var creatureType = packet.readByte();
          if (creatureType === 2) {
            // Mundane NPC — has a name
            var name = packet.readString8();
            if (serial && name) {
              bot.entityNames[serial] = name;
              bot.entityPositions[serial] = { x: x, y: y };
              console.log('[Entity] NPC from 0x07: "' + name + '" serial=0x' + serial.toString(16) + ' at (' + x + ',' + y + ')');
            }
          }
        } else if (sprite & 0x8000) {
          // Item
          packet.readByte();   // dyeColor
          packet.readUInt16(); // unknown
        }
        // else: bare sprite (no extra data)
      }
    } catch (e) {
      // Parsing error — don't crash, just stop
    }
    packet.position = saved;
  });

  // ShowUser (0x33) - full sprite/equipment parsing
  c.events.on(0x33, function (packet) {
    var saved = packet.position;
    try {
      if (packet.remainder() < 10) { packet.position = saved; return; }
      var x = packet.readUInt16();
      var y = packet.readUInt16();
      var direction = packet.readByte();
      var serial = packet.readUInt32();
      var headSprite = packet.readUInt16();

      var spriteData = null;

      if (headSprite === 0xFFFF) {
        // Monster display
        var monsterSprite = packet.readUInt16() & 0x3FFF;
        var monHairColor = packet.readByte();
        var monBootsColor = packet.readByte();
        packet.read(6); // unknown bytes
        var nameStyle = packet.readByte();
        var name = packet.readString8();
        var groupBox = packet.readString8();

        spriteData = { isMonster: true, monsterSprite: monsterSprite };
        if (name && serial) {
          bot.entityNames[serial] = name;
          bot.entityPositions[serial] = { x: x, y: y };
          if (isSlotBot(botId)) {
            console.log('[Slots] Entity spotted: "' + name + '" serial=0x' + serial.toString(16) + ' at (' + x + ',' + y + ') sprite=' + monsterSprite);
          }
          playerTracker.recordSighting(name);
          playerTracker.updatePlayerAppearance(name, spriteData);
          if (name !== bot.state.username && !(isSlotBot(botId) && slotBankingActive)) {
            try {
              var profileReq = new Packet(0x43);
              profileReq.writeByte(0x01);
              profileReq.writeUInt32(serial);
              c.send(profileReq);
              // console.log('[Legend] Sent profile request for ' + name + ' (serial ' + serial + ')');
            } catch (e2) { /* ignore */ }
          }
        }
      } else {
        // Human character display
        var bodyByte = packet.readByte();
        var pantsColor = bodyByte % 16;
        var bodySprite = bodyByte - pantsColor;

        var armsSprite = packet.readUInt16();
        var bootsSprite = packet.readByte();
        var armorSprite = packet.readUInt16();
        var shieldSprite = packet.readByte();
        var weaponSprite = packet.readUInt16();
        var hairColor = packet.readByte();
        var bootsColor = packet.readByte();

        var acc1Color = packet.readByte();
        var acc1Sprite = packet.readUInt16();
        var acc2Color = packet.readByte();
        var acc2Sprite = packet.readUInt16();
        var acc3Color = packet.readByte();
        var acc3Sprite = packet.readUInt16();

        var lantern = packet.readByte();
        var restPosition = packet.readByte();

        var overcoatSprite = packet.readUInt16();
        var overcoatColor = packet.readByte();

        var skinColor = packet.readByte();
        var isTranslucent = packet.readByte();
        var faceShape = packet.readByte();

        var nameStyle = packet.readByte();
        var name = packet.readString8();
        var groupBox = packet.readString8();

        spriteData = {
          isMonster: false,
          headSprite: headSprite,
          bodySprite: bodySprite,
          gender: (bodySprite === 0x10 || bodySprite === 0x80) ? 'Male' : (bodySprite === 0x20 || bodySprite === 0x90) ? 'Female' : 'Other',
          hairColor: hairColor,
          skinColor: skinColor,
          pantsColor: pantsColor,
          faceShape: faceShape,
          armorSprite: armorSprite,
          armsSprite: armsSprite,
          bootsSprite: bootsSprite,
          bootsColor: bootsColor,
          weaponSprite: weaponSprite,
          shieldSprite: shieldSprite,
          overcoatSprite: overcoatSprite,
          overcoatColor: overcoatColor,
          acc1Sprite: acc1Sprite, acc1Color: acc1Color,
          acc2Sprite: acc2Sprite, acc2Color: acc2Color,
          acc3Sprite: acc3Sprite, acc3Color: acc3Color,
          isTranslucent: isTranslucent === 1,
          direction: direction,
          groupBox: groupBox || ''
        };

        if (name && serial) {
          bot.entityNames[serial] = name;
          bot.entityPositions[serial] = { x: x, y: y };
          playerTracker.recordSighting(name);
          playerTracker.updatePlayerAppearance(name, spriteData);
          if (name !== bot.state.username && playerTracker.canRequestProfile(name) && !(isSlotBot(botId) && slotBankingActive)) {
            try {
              var profileReq = new Packet(0x43);
              profileReq.writeByte(0x01);
              profileReq.writeUInt32(serial);
              c.send(profileReq);
              // console.log('[Legend] Sent profile request for ' + name + ' (serial ' + serial + ')');
            } catch (e2) { console.log('[Legend] Failed to send profile request for ' + name + ': ' + e2.message); }
          }
          // Attendance tracker: record player if this is the tracker bot
          if (isTrackerBot(botId) && name !== bot.state.username) {
            attendanceRecordPlayer(name);
          }
          // Sense bot: track entity position for auto-sensing
          if (isSenseBot(botId)) {
            if (name === bot.state.username) {
              // This is the bot itself — store its serial and direction
              bot.senseSerial = serial;
              sense.updateBotDirection(direction);
              // console.log('[Sense] Bot serial=' + serial + ' direction=' + direction + ' pos=(' + x + ',' + y + ')');
            } else {
              sense.onEntityAppeared(serial, name, x, y);
            }
          }
        }
      }
    } catch (e) { /* ignore */ }
    packet.position = saved;
  });

  // Legend marks (0x34)
  c.events.on(0x34, function (packet) {
    var saved = packet.position;
    try {
      var peekSerial = packet.readUInt32();
      packet.position = saved;
      var knownName = bot.entityNames ? bot.entityNames[peekSerial] : '';
      if (!knownName) {
        console.log('[Legend] No known name for serial ' + peekSerial + ', skipping 0x34');
        packet.position = saved;
        return;
      }
      var result = playerTracker.parseOtherProfile(packet, knownName);
      if (!result) {
        playerTracker.markProfileFailed(knownName);
        packet.position = saved;
        var dumpLen = Math.min(packet.body.length, 140);
        var hexDump = packet.body.slice(0, dumpLen).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join(' ');
        console.log('[Legend] Failed to parse 0x34 for ' + knownName + ' (serial ' + peekSerial + ') hex: ' + hexDump);
        return;
      }
      if (!result.legends || result.legends.length === 0) {
        packet.position = saved;
        var dumpLen2 = Math.min(packet.body.length, 300);
        var hexDump2 = packet.body.slice(0, dumpLen2).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join(' ');
        console.log('[Legend] No legends found for ' + knownName + ' (serial ' + peekSerial + ', class=' + result.className + ') hex: ' + hexDump2);
        return;
      }
      // console.log('[Legend] Parsed ' + result.legends.length + ' legend marks for ' + result.name);
      playerTracker.updatePlayerRecord(result.name, {
        legends: result.legends,
        className: result.className,
        legendClassName: result.className,
        groupName: result.groupName,
        source: 'legend'
      });
    } catch (e) { /* ignore */ }
    packet.position = saved;
  });

  // ── Sense Bot Handlers ──────────────────────────────────────────
  if (isSenseBot(botId)) {
    // Initialize sense module for this bot
    sense.init({
      sendPacket: function (pkt) { c.send(pkt); },
      onResult: function (name, hp, mp) {
        playerTracker.updatePlayerRecord(name, {
          hp: hp,
          mp: mp,
          lastSenseUpdate: new Date().toISOString(),
          source: 'sense'
        });
        io.emit('player:senseUpdate', { name: name, hp: hp, mp: mp, timestamp: Date.now() });
      }
    });

    // EntityWalk (0x0C) — entity moved on map
    // Format: serial(u32) + x(u16) + y(u16) + direction(byte)
    c.events.on(0x0C, function (packet) {
      var saved = packet.position;
      try {
        if (packet.remainder() < 8) { packet.position = saved; return; }
        var serial = packet.readUInt32();
        var ex = packet.readUInt16();
        var ey = packet.readUInt16();
        sense.onEntityWalk(serial, ex, ey);
      } catch (e) { /* ignore */ }
      packet.position = saved;
    });

    // RemoveEntity (0x0E) — entity left screen
    c.events.on(0x0E, function (packet) {
      var saved = packet.position;
      try {
        var serial = packet.readUInt32();
        sense.onEntityRemoved(serial);
      } catch (e) { /* ignore */ }
      packet.position = saved;
    });

    // Chat (0x0A) — intercept sense results
    c.events.on(0x0A, function (packet) {
      var saved = packet.position;
      var channelByte = packet.readByte();
      var messageRaw = '';
      if (packet.remainder() >= 2) messageRaw = packet.readString16();
      packet.position = saved;
      if (messageRaw) sense.handleChatMessage(channelByte, messageRaw);
    });

    // Skill response (0x3F) — cooldown / success confirmation
    c.events.on(0x3F, function (packet) {
      var saved = packet.position;
      try {
        var success = packet.readByte();
        var slot = packet.readByte();
        sense.handleSkillResponse(success, slot);
      } catch (e) { /* ignore */ }
      packet.position = saved;
    });

    // EntityDirection (0x11) — track bot's own direction changes
    c.events.on(0x11, function (packet) {
      var saved = packet.position;
      try {
        var serial = packet.readUInt32();
        var dir = packet.readByte();
        if (bot.senseSerial && serial === bot.senseSerial) {
          sense.updateBotDirection(dir);
          // console.log('[Sense] Bot direction changed to ' + dir);
        }
      } catch (e) { /* ignore */ }
      packet.position = saved;
    });
  }

  // ── NPC Leak Scanner ──────────────────────────────────────────
  if (isLeakBot(botId)) {
    npcLeak.init({
      sendPacket: function (pkt) { c.send(pkt); },
      onLeakFound: function (entry) {
        console.log('[NpcLeak] ★ LEAK FOUND via ' + bot.state.username + ': ' + entry.parsedName);
        io.emit('npcleak:leakFound', entry);
      },
      onLogEntry: function (entry) {
        io.emit('npcleak:log', entry);
      },
      onSessionUpdate: function (status) {
        io.emit('npcleak:status', status);
      }
    });

    // Listen for ALL incoming packets during a leak session
    // Use a catch-all event listener instead of overriding emit
    // to avoid interfering with other handlers
    var npcLeakOpcodes = [0x2F, 0x1A, 0x3A, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x11, 0x33, 0x39, 0x3B, 0x68, 0x6A, 0x34, 0x36, 0x37, 0x38, 0x42, 0x4B, 0x3F, 0x05, 0x07, 0x08, 0x15, 0x3C, 0x58, 0x67, 0x6F, 0x4C, 0x29, 0x17, 0x18, 0x2C, 0x2D, 0x2E, 0x31];
    for (var nli = 0; nli < npcLeakOpcodes.length; nli++) {
      (function (op) {
        c.events.on(op, function (packet) {
          if (!npcLeak.getStatus().active) return;
          var saved = packet.position;
          try {
            npcLeak.handleIncomingPacket(op, packet);
          } catch (e) { /* don't break normal flow */ }
          packet.position = saved;
        });
      })(npcLeakOpcodes[nli]);
    }

    console.log('[NpcLeak] Wired up for leak bot ' + bot.state.username);
  }

  // User list (0x36)
  c.events.on(0x36, function (packet) {
    if (!isPrimaryBot(botId)) return;
    var users = playerTracker.parseUserList(packet);
    console.log('[UserList] Received ' + users.length + ' online players');
    io.emit('userlist:update', { users: users, timestamp: Date.now() });
  });

  // Public messages (0x0D)
  c.events.on(0x0D, function (packet) {
    var saved = packet.position;
    var msgType = packet.readByte();
    if (msgType > 5) { packet.position = saved; return; }
    var senderId = packet.readUInt32();
    var text = '';
    if (packet.remainder() >= 1) text = packet.readString8();
    packet.position = saved;

    if (text) {
      var sender = '';
      var message = text;
      var colonIdx = text.indexOf(': ');
      if (colonIdx !== -1 && colonIdx < 30) {
        sender = text.substring(0, colonIdx);
        message = text.substring(colonIdx + 2);
      }
      if (sender && senderId) {
        bot.entityNames[senderId] = sender;
        playerTracker.recordSighting(sender);
        // Attendance tracker: record speaker if this is the tracker bot
        if (isTrackerBot(botId) && sender !== bot.state.username) {
          attendanceRecordPlayer(sender);
        }
      }
      var typeName = opcodes.getPublicMessageTypeName(msgType);
      var pubChatEntry = {
        botId: botId, timestamp: Date.now(),
        channel: 100 + msgType, channelName: typeName,
        raw: text, sender: sender, message: message
      };
      pubChatEntry.mentions = checkForMentions(pubChatEntry, bot.state.username);
      if (!isPrimaryBot(botId)) return;
      emitChat(pubChatEntry);
      if (pubChatEntry.mentions.length > 0) io.emit('mention:detected', pubChatEntry);
      {
        discord.checkAndDispatch({
          type: 'PublicMessage', text: text, clientId: senderId, characterName: bot.state.username
        });
        if (msgType === 0 && sender && sender !== bot.state.username) {
          chatGames.handlePublicMessage(sender, message);
          chatGames.handlePossibleAnswer(sender, message, false);
          chatGames.handlePublicChatForRoast(sender, message);
          aiChat.handlePublicMention(sender, message);
        }
      }
    }
  });

  // Animation / RPS (0x1A)
  c.events.on(0x1A, function (packet) {
    if (!isPrimaryBot(botId)) return;
    var saved = packet.position;
    if (packet.remainder() < 5) { packet.position = saved; return; }
    var entitySerial = packet.readUInt32();
    var bodyAnimId = packet.readByte();
    packet.position = saved;
    if (bodyAnimId < 0x17 || bodyAnimId > 0x19) return;
    var senderName = bot.entityNames[entitySerial];
    if (!senderName || senderName === bot.state.username) return;
    chatGames.handleEmote(senderName, bodyAnimId);
  });

  // ── Lottery Bot Exchange Handlers ──────────────────────────────
  if (isLotteryBot(botId)) {
    // ExchangeMessage (0x42) — exchange requests, item info, completion
    c.events.on(0x42, function (packet) {
      lottery.handleExchangeMessage(packet);
    });

    // ExchangeSlot (0x4B) — item placed in exchange slot confirmation
    c.events.on(0x4B, function (packet) {
      lottery.handleExchangeSlot(packet);
    });

    // AddItem (0x37) — item added to lottery bot's inventory
    c.events.on(0x37, function (packet) {
      lottery.handleAddItem(packet);
    });

    // RemoveItem (0x38) — item removed from lottery bot's inventory
    c.events.on(0x38, function (packet) {
      lottery.handleRemoveItem(packet);
    });

    // Whisper handling for lottery bot
    c.events.on(0x0A, function (packet) {
      var saved = packet.position;
      var channelByte = packet.readByte();
      var messageRaw = '';
      if (packet.remainder() >= 2) messageRaw = packet.readString16();
      packet.position = saved;
      if (!messageRaw || channelByte !== 0) return;

      var whisperMatch = messageRaw.match(/^"?([A-Za-z][^"]*)"\s*([\s\S]*)$/);
      if (whisperMatch && !isSentWhisperEcho(whisperMatch[1], whisperMatch[2])) {
        lottery.handleWhisper(whisperMatch[1], whisperMatch[2]);
      }
    });
  }

  // ── Trader Bot Exchange Handlers ─────────────────────────────────
  if (isTraderBot(botId)) {
    c.events.on(0x42, function (packet) {
      itemTrade.handleExchangeMessage(packet);
    });

    c.events.on(0x4B, function (packet) {
      itemTrade.handleExchangeSlot(packet);
    });

    c.events.on(0x37, function (packet) {
      itemTrade.handleAddItem(packet);
    });

    c.events.on(0x38, function (packet) {
      itemTrade.handleRemoveItem(packet);
    });

    // Whisper handling for trader bot
    c.events.on(0x0A, function (packet) {
      var saved = packet.position;
      var channelByte = packet.readByte();
      var messageRaw = '';
      if (packet.remainder() >= 2) messageRaw = packet.readString16();
      packet.position = saved;
      if (!messageRaw || channelByte !== 0) return;

      var whisperMatch = messageRaw.match(/^"?([A-Za-z][^"]*)"\s*([\s\S]*)$/);
      if (whisperMatch && !isSentWhisperEcho(whisperMatch[1], whisperMatch[2])) {
        itemTrade.handleWhisper(whisperMatch[1], whisperMatch[2]);
      }
    });
  }

  // ── Slot Machine Bot Exchange Handlers ─────────────────────────
  if (isSlotBot(botId)) {
    c.events.on(0x42, function (packet) {
      slotMachine.handleExchangeMessage(packet);
    });

    c.events.on(0x4B, function (packet) {
      slotMachine.handleExchangeSlot(packet);
    });

    c.events.on(0x37, function (packet) {
      slotMachine.handleAddItem(packet);
    });

    c.events.on(0x38, function (packet) {
      slotMachine.handleRemoveItem(packet);
    });

    // Inventory item on login (0x0F) — same format as 0x37, one per item
    c.events.on(0x0F, function (packet) {
      slotMachine.handleInventoryItem(packet);
    });

    // Whisper handling for slot machine bot
    c.events.on(0x0A, function (packet) {
      var saved = packet.position;
      var channelByte = packet.readByte();
      var messageRaw = '';
      if (packet.remainder() >= 2) messageRaw = packet.readString16();
      packet.position = saved;
      if (!messageRaw || channelByte !== 0) return;

      var whisperMatch = messageRaw.match(/^"?([A-Za-z][^"]*)"\s*([\s\S]*)$/);
      if (whisperMatch && !isSentWhisperEcho(whisperMatch[1], whisperMatch[2])) {
        slotMachine.handleWhisper(whisperMatch[1], whisperMatch[2]);
      }
    });

    // Banking: NPC dialog (0x2F) — also learn NPC serial+name
    c.events.on(0x2F, function (packet) {
      var saved = packet.position;
      try {
        packet.readByte();     // dialogType
        packet.readByte();     // dialogId
        var npcSerial = packet.readUInt32();
        packet.readUInt16(); packet.readUInt16();
        packet.readUInt16(); packet.readUInt16();
        packet.readByte();
        var npcName = packet.readString8();
        if (npcSerial && npcName) {
          bot.entityNames[npcSerial] = npcName;
        }
      } catch (e) { /* ignore */ }
      packet.position = saved;
      slotMachine.handleNpcDialog(packet);
    });

    // Banking: Public message confirmation (0x0D)
    c.events.on(0x0D, function (packet) {
      slotMachine.handlePublicMessage(packet);
    });

    // Banking: Stats update for gold-on-hand tracking (0x08)
    c.events.on(0x08, function (packet) {
      slotMachine.handleStatsUpdate(packet);
    });
  }
}

function attachReconnectHandlers(c, botId) {
  var bot = bots.get(botId);

  var originalSchedule = c._scheduleAutoReconnect.bind(c);
  c._scheduleAutoReconnect = function () {
    var suppressed = reconnectOrchestrator.onBotDisconnected(botId);
    if (suppressed) {
      try { c.stop(); } catch (e) { /* ignore */ }
      bot.client = null;
      bot.state.status = 'waiting_reconnect';
      bot.state.connectedAt = null;
      bot.state.position = { x: 0, y: 0 };
      io.emit('bot:status', bot.state);
      io.emit('bot:notification', { message: bot.state.username + ' waiting for leader to reconnect...' });
      return;
    }
    originalSchedule();
  };

  c.events.on('reconnecting', function (info) {
    bot.state.status = 'reconnecting';
    bot.state.reconnectAttempt = info.attempt;
    bot.state.reconnectDelay = info.delay;
    bot.state.connectedAt = null;
    bot.state.position = { x: 0, y: 0 };
    io.emit('bot:status', bot.state);
    io.emit('bot:notification', {
      message: bot.state.username + ' reconnecting... attempt ' + info.attempt + ' (waiting ' + (info.delay / 1000) + 's)'
    });
  });

  c.events.on('autoReconnectDisabled', function () {
    bot.state.status = 'disconnected';
    bot.state.connectedAt = null;
    bot.state.position = { x: 0, y: 0 };
    io.emit('bot:status', bot.state);
    io.emit('bot:notification', { message: bot.state.username + ' disconnected. Auto-reconnect is disabled.' });
    bot.client = null;
  });
}

// ── Chat History Buffer ──────────────────────────────────────────
var chatHistory = [];
var MAX_CHAT_HISTORY = 200;

function emitChat(entry) {
  chatHistory.push(entry);
  while (chatHistory.length > MAX_CHAT_HISTORY) chatHistory.shift();
  io.emit('chat:message', entry);
  db.insertChatLog(entry);
}

// ── Bot Lifecycle ────────────────────────────────────────────────

function startBot(botId) {
  var bot = bots.get(botId);
  if (!bot) {
    io.emit('bot:error', { botId: botId, message: 'Unknown bot: ' + botId });
    return;
  }
  if (bot.client) {
    io.emit('bot:error', { botId: botId, message: bot.state.username + ' is already running' });
    if (reconnectOrchestrator.active) reconnectOrchestrator.reconnectNext();
    return;
  }
  if (!bot.config.username || !bot.config.password) {
    io.emit('bot:error', { botId: botId, message: 'Username and password required for ' + botId });
    if (reconnectOrchestrator.active) reconnectOrchestrator.reconnectNext();
    return;
  }

  var config = loadConfig();
  bot.state.status = 'connecting';
  bot.state.username = bot.config.username;
  io.emit('bot:status', bot.state);

  var c = new Client(bot.config.username, bot.config.password);
  c.autoReconnect = config.features.autoReconnect !== false;
  bot.client = c;

  // Create navigator for this bot
  bot.navigator = new Navigator(c, { walkDelay: 200, dataDir: './data' });
  bot.navigator.init().catch(function (e) {
    console.log('[Nav] Init error for ' + botId + ': ' + (e.message || e));
  });
  bot.navigator.on('arrived', function (data) {
    io.emit('nav:arrived', { botId: botId, mapId: data.mapId, x: data.x, y: data.y });
    console.log('[Nav] ' + bot.state.username + ' arrived at (' + data.x + ',' + data.y + ') on map ' + data.mapId);
  });
  bot.navigator.on('failed', function (data) {
    io.emit('nav:failed', { botId: botId, reason: data.reason });
    console.log('[Nav] ' + bot.state.username + ' navigation failed: ' + data.reason);
  });
  bot.navigator.on('status', function (status) {
    io.emit('nav:status', { botId: botId, status: status });
  });
  bot.navigator.on('step', function (data) {
    io.emit('nav:step', { botId: botId, x: data.x, y: data.y, index: data.index, total: data.total });
  });

  attachPacketInterceptors(c, botId);
  attachGameHandlers(c, botId);
  attachReconnectHandlers(c, botId);

  var origConnect = c.connect.bind(c);
  c.connect = function (address, port) {
    return origConnect(address, port).then(function () {
      bot.state.status = 'connected';
      bot.state.connectedAt = Date.now();
      bot.state.reconnectAttempt = 0;
      bot.state.reconnectDelay = 0;
      io.emit('bot:status', bot.state);
    });
  };

  var origDisconnect = c.disconnect.bind(c);
  c.disconnect = function (socket) {
    origDisconnect(socket);
    if (!socket || socket === c.socket) {
      if (!c._reconnecting && !c._intentionalReconnect) {
        bot.state.status = 'disconnected';
        bot.state.connectedAt = null;
        bot.state.position = { x: 0, y: 0 };
        // Clear position guard state on disconnect
        if (bot.positionGuard) {
          if (bot.positionGuard._debounceTimer) {
            clearTimeout(bot.positionGuard._debounceTimer);
            bot.positionGuard._debounceTimer = null;
          }
          bot.positionGuard._retryDelay = 1500;
        }
        io.emit('bot:status', bot.state);
      }
    }
  };

  var address = config.server.address || undefined;
  var port = config.server.port || undefined;
  c.connect(address, port).catch(function (err) {
    bot.state.status = 'disconnected';
    io.emit('bot:status', bot.state);
    io.emit('bot:error', { botId: botId, message: bot.state.username + ' connection failed: ' + (err.message || err) });
    bot.client = null;
    if (reconnectOrchestrator.active) reconnectOrchestrator.reconnectNext();
  });
}

function stopBot(botId) {
  var bot = bots.get(botId);
  if (!bot) return;
  if (bot.navigator) {
    try { bot.navigator.stop(); } catch (e) { /* ignore */ }
    bot.navigator = null;
  }
  if (bot.client) {
    try { bot.client.events.removeAllListeners(); } catch (e) { /* ignore */ }
    try { bot.client.stop(); } catch (e) { /* ignore */ }
    bot.client = null;
  }
  bot.state.status = 'disconnected';
  bot.state.connectedAt = null;
  bot.state.position = { x: 0, y: 0 };
  bot.state.mapNumber = 0;
  bot.state.serverName = '';
  bot.state.reconnectAttempt = 0;
  bot.state.reconnectDelay = 0;
  io.emit('bot:status', bot.state);
}

function reconnectBot(botId) {
  stopBot(botId);
  setTimeout(function () { startBot(botId); }, 1000);
}

function forceResetBot(botId) {
  var bot = bots.get(botId);
  if (!bot) return;
  if (bot.client) {
    try { bot.client._cancelAutoReconnect(); } catch (e) { /* ignore */ }
    try { bot.client._stopped = true; } catch (e) { /* ignore */ }
    try { bot.client.events.removeAllListeners(); } catch (e) { /* ignore */ }
    try { bot.client.disconnect(); } catch (e) { /* ignore */ }
    try {
      if (bot.client.socket) {
        bot.client.socket.removeAllListeners();
        bot.client.socket.destroy();
      }
    } catch (e) { /* ignore */ }
    bot.client = null;
  }
  bot.state.status = 'disconnected';
  bot.state.connectedAt = null;
  bot.state.position = { x: 0, y: 0 };
  bot.state.mapNumber = 0;
  bot.state.serverName = '';
  bot.state.reconnectAttempt = 0;
  bot.state.reconnectDelay = 0;
  io.emit('bot:status', bot.state);
  io.emit('bot:notification', { message: bot.state.username + ' force reset' });
}

function startAllBots() {
  var enabledBots = [];
  bots.forEach(function (bot) {
    if (bot.config.enabled !== false && !bot.client) enabledBots.push(bot.config.id);
  });
  enabledBots.forEach(function (botId, idx) {
    setTimeout(function () { startBot(botId); }, idx * 2000);
  });
}

function stopAllBots() {
  reconnectOrchestrator.reset();
  bots.forEach(function (bot) { stopBot(bot.config.id); });
}

function syncBotsMap(botConfigs) {
  var configIds = botConfigs.map(function (b) { return b.id; });
  bots.forEach(function (bot, botId) {
    if (configIds.indexOf(botId) === -1) {
      stopBot(botId);
      bots.delete(botId);
    }
  });
  botConfigs.forEach(function (botConfig) {
    var existing = bots.get(botConfig.id);
    if (existing) {
      existing.config = botConfig;
      existing.state.role = botConfig.role || 'secondary';
      if (!existing.client) existing.state.username = botConfig.username;
    } else {
      bots.set(botConfig.id, { client: null, state: createBotState(botConfig), config: botConfig });
    }
  });
}

// ── Socket.IO Auth Middleware ─────────────────────────────────────

io.use(function (socket, next) {
  var cookies = auth.parseCookies(socket.handshake.headers.cookie);
  if (auth.isValidSession(cookies.dasb_session)) return next();
  next(new Error('Unauthorized'));
});

// ── Socket.IO Connection Handler ─────────────────────────────────

io.on('connection', function (socket) {
  console.log('Panel connected');

  socket.emit('bots:statusAll', getAllBotStates());
  socket.emit('config:data', loadConfig());
  socket.emit('ae:config', aeIngest.getConfig());
  socket.emit('discord:rules', discord.getRules());
  socket.emit('chatgames:config', chatGames.getConfig());
  socket.emit('chatgames:hostUpdate', chatGames.getHostStatus());
  socket.emit('chatgames:leaderboard', chatGames.getLeaderboard());
  socket.emit('scheduled:list', scheduledMessages.getSchedulesWithNextFire());

  if (chatHistory.length > 0) socket.emit('chat:history', chatHistory);
  socket.emit('attendance:update', getAttendanceState());

  // Proxy controls
  if (proxySystem) {
    var sessions = [];
    for (var [sid, sess] of proxySystem.server.sessions) {
      sessions.push({ id: sid, characterName: sess.characterName, phase: sess.phase, connectedAt: sess.connectedAt, playerState: sess.playerState });
    }
    socket.emit('proxy:sessions', sessions);
    socket.emit('proxy:players', proxySystem.registry.getAllPlayers());
    socket.emit('proxy:npcs', proxySystem.augmentation.npcs.getAllNPCs());

    socket.on('proxy:npc:place', function (data) {
      if (!proxySystem || !data) return;
      var serial = proxySystem.augmentation.npcs.placeNPC(data);
      io.emit('proxy:npcs', proxySystem.augmentation.npcs.getAllNPCs());
      socket.emit('proxy:npc:placed', { serial: serial });
      saveVirtualNpcs();
    });

    socket.on('proxy:npc:remove', function (data) {
      if (!proxySystem || !data || !data.serial) return;
      proxySystem.augmentation.npcs.removeNPC(data.serial);
      io.emit('proxy:npcs', proxySystem.augmentation.npcs.getAllNPCs());
      saveVirtualNpcs();
    });

    socket.on('proxy:npc:move', function (data) {
      if (!proxySystem || !data) return;
      proxySystem.augmentation.npcs.moveNPC(data.serial, data.x, data.y);
    });

    socket.on('proxy:npc:dialog', function (data) {
      if (!proxySystem || !data || !data.serial) return;
      proxySystem.augmentation.npcs.updateDialog(data.serial, data.dialog || undefined);
      io.emit('proxy:npcs', proxySystem.augmentation.npcs.getAllNPCs());
      saveVirtualNpcs();
    });

    socket.on('proxy:chat:send', function (data) {
      if (!proxySystem || !data) return;
      if (data.broadcast) {
        proxySystem.augmentation.chat.broadcast(data);
      } else if (data.sessionId) {
        var session = proxySystem.server.sessions.get(data.sessionId);
        if (session) proxySystem.augmentation.chat.sendChat(session, data);
      }
    });

    socket.on('proxy:chat:system', function (data) {
      if (!proxySystem || !data || !data.message) return;
      proxySystem.augmentation.chat.systemBroadcast(data.message);
    });

    socket.on('proxy:block:add', function (data) {
      if (!proxySystem || !data) return;
      proxySystem.inspector.blockOpcode(data.direction, data.opcode);
    });

    socket.on('proxy:block:remove', function (data) {
      if (!proxySystem || !data) return;
      proxySystem.inspector.unblockOpcode(data.direction, data.opcode);
    });

    // ── Proxy Player Movement Controls ──
    socket.on('proxy:walk', function (data) {
      if (!proxySystem || !data || !data.sessionId) return;
      var auto = proxySystem.automation.getSession(data.sessionId);
      if (auto && data.direction !== undefined) {
        auto.navigator.movement.step(data.direction);
      }
    });

    socket.on('proxy:walkTo', function (data) {
      if (!proxySystem || !data || !data.sessionId) return;
      var auto = proxySystem.automation.getSession(data.sessionId);
      if (auto) {
        auto.navigator.walkTo(data.x, data.y).then(function (result) {
          io.emit('proxy:navStatus', { sessionId: data.sessionId, state: result ? 'idle' : 'failed' });
        });
        io.emit('proxy:navStatus', { sessionId: data.sessionId, state: 'walking', target: { x: data.x, y: data.y } });
      }
    });

    socket.on('proxy:navigateTo', function (data) {
      if (!proxySystem || !data || !data.sessionId) return;
      var auto = proxySystem.automation.getSession(data.sessionId);
      if (auto) {
        auto.navigator.navigateTo({ mapId: data.mapId, x: data.x || -1, y: data.y || -1 }).then(function (result) {
          io.emit('proxy:navStatus', { sessionId: data.sessionId, state: result ? 'idle' : 'failed' });
        });
        io.emit('proxy:navStatus', { sessionId: data.sessionId, state: 'walking', target: { mapId: data.mapId, x: data.x, y: data.y } });
      }
    });

    socket.on('proxy:stop', function (data) {
      if (!proxySystem || !data || !data.sessionId) return;
      var auto = proxySystem.automation.getSession(data.sessionId);
      if (auto) {
        auto.navigator.cancel();
        io.emit('proxy:navStatus', { sessionId: data.sessionId, state: 'idle' });
      }
    });
  }

  // Bot controls
  socket.on('bot:start', function (data) { if (data && data.botId) startBot(data.botId); });
  socket.on('bot:stop', function (data) { if (data && data.botId) stopBot(data.botId); });
  socket.on('bot:reconnect', function (data) { if (data && data.botId) reconnectBot(data.botId); });
  socket.on('bot:forceReset', function (data) { if (data && data.botId) forceResetBot(data.botId); });
  socket.on('bots:startAll', function () { startAllBots(); });
  socket.on('bots:stopAll', function () { stopAllBots(); });

  // Lottery
  socket.on('lottery:start', function (data) {
    var result = lottery.startLottery(data && data.drawingName || 'Lottery');
    socket.emit('lottery:result', result);
    io.emit('lottery:update', lottery.getLotteryState());
  });
  socket.on('lottery:draw', function () {
    var result = lottery.drawWinner();
    socket.emit('lottery:result', result);
    io.emit('lottery:update', lottery.getLotteryState());
  });
  socket.on('lottery:cancel', function () {
    var result = lottery.cancelLottery();
    socket.emit('lottery:result', result);
    io.emit('lottery:update', lottery.getLotteryState());
  });
  socket.on('lottery:status', function () {
    socket.emit('lottery:update', lottery.getLotteryState());
  });

  // Config
  socket.on('config:save', function (newConfig) {
    var existing = loadConfig();
    var merged = Object.assign({}, existing, newConfig);
    if (!newConfig.aeIngest) merged.aeIngest = existing.aeIngest;
    if (!newConfig.chatGames) merged.chatGames = existing.chatGames;
    if (!newConfig.scheduledMessages) merged.scheduledMessages = existing.scheduledMessages;
    if (!newConfig.virtualNpcs) merged.virtualNpcs = existing.virtualNpcs;

    saveConfig(merged);
    var saved = loadConfig();
    syncBotsMap(saved.bots || []);
    io.emit('config:data', saved);
    io.emit('bots:statusAll', getAllBotStates());

    bots.forEach(function (bot) {
      if (bot.client) bot.client.autoReconnect = saved.features.autoReconnect !== false;
    });
    if (existing.timezone !== saved.timezone) scheduledMessages.startAllSchedules();
    io.emit('bot:notification', { message: 'Configuration saved' });
  });

  // Wipe all player data
  socket.on('players:wipeAll', function () {
    bots.forEach(function (bot) { bot.entityNames = {}; bot.entityPositions = {}; });
    playerTracker.wipeAll().then(function () {
      io.emit('bot:notification', { message: 'All player data wiped successfully' });
      io.emit('players:list', []);
    }).catch(function (e) {
      console.error('[Wipe] Error:', e.message);
      socket.emit('bot:error', { message: 'Failed to wipe player data: ' + e.message });
    });
  });

  // Reset appearances only (clears stored looks + render cache)
  socket.on('players:resetAppearances', function () {
    var renderer = getSpriteRenderer();
    if (renderer.initialized) renderer.clearRenderCache();
    playerTracker.clearAppearances().then(function () {
      io.emit('bot:notification', { message: 'All player appearances reset. New looks will be collected automatically.' });
    }).catch(function (e) {
      console.error('[Reset Appearances] Error:', e.message);
      socket.emit('bot:error', { message: 'Failed to reset appearances: ' + e.message });
    });
  });

  // Walk command
  socket.on('bot:walk', function (data) {
    if (!data || !data.botId) return;
    var bot = bots.get(data.botId);
    if (bot && bot.client && bot.state.status === 'logged_in' && data.direction >= 0 && data.direction <= 3) {
      var p = new Packet(0x06);
      p.writeByte(data.direction);
      bot.client.send(p);
    }
  });

  // Turn (face direction without walking)
  socket.on('bot:turn', function (data) {
    if (!data || !data.botId) return;
    var bot = bots.get(data.botId);
    if (bot && bot.client && bot.state.status === 'logged_in' && data.direction >= 0 && data.direction <= 3) {
      console.log('[Turn] Sending turn packet: botId=' + data.botId + ' direction=' + data.direction);
      var p = new Packet(0x11);
      p.writeByte(data.direction);
      bot.client.send(p);
    }
  });

  // Navigate to tile on current map
  socket.on('bot:walkTo', function (data) {
    if (!data || !data.botId) return;
    var bot = bots.get(data.botId);
    if (bot && bot.navigator && bot.state.status === 'logged_in' &&
        typeof data.x === 'number' && typeof data.y === 'number') {
      bot.navigator.walkTo(data.x, data.y).then(function (success) {
        socket.emit('nav:walkToResult', { botId: data.botId, success: success, x: data.x, y: data.y });
      });
    }
  });

  // Navigate to tile on any map (cross-map)
  socket.on('bot:navigateTo', function (data) {
    if (!data || !data.botId) return;
    var bot = bots.get(data.botId);
    if (bot && bot.navigator && bot.state.status === 'logged_in' &&
        typeof data.mapId === 'number' && typeof data.x === 'number' && typeof data.y === 'number') {
      bot.navigator.navigateTo({ mapId: data.mapId, x: data.x, y: data.y }).then(function (success) {
        socket.emit('nav:navigateToResult', { botId: data.botId, success: success, mapId: data.mapId, x: data.x, y: data.y });
      });
    }
  });

  // Stop navigation
  socket.on('bot:navStop', function (data) {
    if (!data || !data.botId) return;
    var bot = bots.get(data.botId);
    if (bot && bot.navigator) {
      bot.navigator.stop();
      socket.emit('nav:stopped', { botId: data.botId });
    }
  });

  // Get navigation status
  socket.on('bot:navStatus', function (data) {
    if (!data || !data.botId) return;
    var bot = bots.get(data.botId);
    if (bot && bot.navigator) {
      socket.emit('nav:status', { botId: data.botId, status: bot.navigator.getStatus() });
    }
  });

  // ── Map List ──────────────────────────────────────────────────
  // Returns all known map nodes (id + name), merging in-memory navigator data with persisted files
  socket.on('nav:getMapList', function () {
    var nodeMap = {};
    var idSet = {};

    // 1. Load from persisted files first (always available even with no bots connected)
    try {
      var nodesRaw = fs.readFileSync('./data/map-nodes.json', 'utf-8');
      var fileNodes = JSON.parse(nodesRaw);
      fileNodes.forEach(function (n) { nodeMap[n.mapId] = n; });
    } catch (e) { /* no file yet */ }
    try {
      var exitsRaw = fs.readFileSync('./data/map-exits.json', 'utf-8');
      var fileExits = JSON.parse(exitsRaw);
      fileExits.forEach(function (ex) {
        idSet[ex.fromMapId] = true;
        idSet[ex.toMapId] = true;
      });
    } catch (e) { /* no file yet */ }

    // 2. Merge in-memory data from connected bots (may have fresher names)
    for (var entry of bots.entries()) {
      var b = entry[1];
      if (b.navigator) {
        var nodes = b.navigator.mapGraph.getAllNodes();
        nodes.forEach(function (n) { nodeMap[n.mapId] = n; });
        var ids = b.navigator.mapGraph.getReachableMapIds();
        ids.forEach(function (id) { idSet[id] = true; });
      }
    }

    var mapNodes = Object.values(nodeMap);
    var reachableIds = Object.keys(idSet).map(Number).sort(function (a, b) { return a - b; });
    socket.emit('nav:mapList', { nodes: mapNodes, reachableIds: reachableIds });
  });

  // ── Walk Favorites ──────────────────────────────────────────
  // Favorites are stored per-bot in bot_config JSONB as walkFavorites: { botId: [...] }
  socket.on('nav:getFavorites', function () {
    var cfg = loadConfig();
    socket.emit('nav:favorites', cfg.walkFavorites || {});
  });

  socket.on('nav:saveFavorite', function (data) {
    if (!data || !data.botId || !data.favorite) return;
    var fav = data.favorite;
    if (!fav.name || typeof fav.mapId !== 'number') return;
    var cfg = loadConfig();
    if (!cfg.walkFavorites) cfg.walkFavorites = {};
    if (!cfg.walkFavorites[data.botId]) cfg.walkFavorites[data.botId] = [];
    fav.id = 'fav_' + Date.now().toString(36);
    cfg.walkFavorites[data.botId].push(fav);
    saveConfig(cfg);
    socket.emit('nav:favorites', cfg.walkFavorites);
  });

  socket.on('nav:deleteFavorite', function (data) {
    if (!data || !data.botId || !data.favId) return;
    var cfg = loadConfig();
    if (!cfg.walkFavorites || !cfg.walkFavorites[data.botId]) return;
    cfg.walkFavorites[data.botId] = cfg.walkFavorites[data.botId].filter(function (f) {
      return f.id !== data.favId;
    });
    saveConfig(cfg);
    socket.emit('nav:favorites', cfg.walkFavorites);
  });

  socket.on('nav:setLoginWalk', function (data) {
    if (!data || !data.botId) return;
    var cfg = loadConfig();
    if (!cfg.walkFavorites) cfg.walkFavorites = {};
    if (!cfg.loginWalkTargets) cfg.loginWalkTargets = {};
    if (data.favId) {
      cfg.loginWalkTargets[data.botId] = {
        favId: data.favId,
        faceDirection: typeof data.faceDirection === 'number' ? data.faceDirection : -1
      };
    } else {
      cfg.loginWalkTargets[data.botId] = null;
    }
    saveConfig(cfg);
    socket.emit('nav:loginWalkTargets', cfg.loginWalkTargets);
  });

  socket.on('nav:getLoginWalkTargets', function () {
    var cfg = loadConfig();
    socket.emit('nav:loginWalkTargets', cfg.loginWalkTargets || {});
  });

  // Send whisper
  socket.on('bot:whisper', function (data) {
    if (!data || !data.botId) return;
    var bot = bots.get(data.botId);
    if (bot && bot.client && bot.state.status === 'logged_in' && data.target && data.message) {
      recordSentWhisper(data.target, data.message);
      var p = new Packet(0x19);
      p.writeString8(data.target);
      p.writeString8(data.message);
      bot.client.send(p);
    }
  });

  // Send say
  socket.on('bot:say', function (data) {
    if (!data || !data.botId) return;
    var bot = bots.get(data.botId);
    if (bot && bot.client && bot.state.status === 'logged_in' && data.message) {
      var p = new Packet(0x0E);
      p.writeByte(0x00);
      p.writeString8(data.message);
      bot.client.send(p);
    }
  });

  // Send emote
  socket.on('bot:emote', function (data) {
    if (data && typeof data.emoteId === 'number') botSendEmote(data.emoteId);
  });

  // Player sightings
  socket.on('sightings:get', function () {
    db.getSightings().then(function (list) { socket.emit('sightings:list', list); });
  });

  // Online user list
  socket.on('userlist:get', function () {
    socket.emit('userlist:update', { users: playerTracker.getOnlineUsers(), timestamp: playerTracker.getLastUserListPulse() });
  });
  socket.on('userlist:refresh', function () { botRequestUserList(); });

  // Player database
  socket.on('players:getAll', function () { socket.emit('players:list', playerTracker.getAllPlayers()); });
  socket.on('players:getDetail', function (data) {
    if (data && data.name) {
      playerTracker.getPlayerDetail(data.name, function (detail) { socket.emit('players:detail', detail); });
    }
  });

  // AE Ingest
  socket.on('ae:getConfig', function () { socket.emit('ae:config', aeIngest.getConfig()); });
  socket.on('ae:saveConfig', function (update) {
    var result = aeIngest.saveConfig(update);
    io.emit('ae:config', result);
    io.emit('bot:notification', { message: 'AE Ingest configuration saved' });
  });
  socket.on('ae:testConnection', function () {
    aeIngest.testConnection().then(function (result) { socket.emit('ae:testResult', result); });
  });

  // Discord
  socket.on('discord:getRules', function () { socket.emit('discord:rules', discord.getRules()); });
  socket.on('discord:saveRule', function (rule) {
    var rules = discord.saveRule(rule);
    io.emit('discord:rules', rules);
    io.emit('bot:notification', { message: 'Discord rule saved' });
  });
  socket.on('discord:deleteRule', function (data) {
    var rules = discord.deleteRule(data.id);
    io.emit('discord:rules', rules);
    io.emit('bot:notification', { message: 'Discord rule deleted' });
  });
  socket.on('discord:toggleRule', function (data) {
    var rules = discord.toggleRule(data.id, data.enabled);
    io.emit('discord:rules', rules);
  });
  socket.on('discord:testWebhook', function (data) {
    discord.testWebhook(data.url, data.botName).then(function (result) { socket.emit('discord:testResult', result); });
  });

  // Chat Games
  socket.on('chatgames:getConfig', function () { socket.emit('chatgames:config', chatGames.getConfig()); });
  socket.on('chatgames:saveConfig', function (update) {
    var result = chatGames.saveConfig(update);
    io.emit('chatgames:config', result);
    io.emit('bot:notification', { message: 'Chat Games configuration saved' });
  });
  socket.on('chatgames:getStats', function () { socket.emit('chatgames:stats', chatGames.getStats()); });
  socket.on('chatgames:getActive', function () { socket.emit('chatgames:active', chatGames.getActiveGames()); });

  // Leaderboard
  socket.on('chatgames:getLeaderboard', function () { socket.emit('chatgames:leaderboard', chatGames.getLeaderboard()); });
  socket.on('chatgames:getLeaderboardByGame', function (gameType) {
    var validTypes = ['trivia', 'riddle', 'scramble', 'numberguess', 'rps', 'blackjack'];
    if (validTypes.indexOf(gameType) === -1) return;
    socket.emit('chatgames:leaderboardByGame', chatGames.getLeaderboardByGame(gameType));
  });
  socket.on('chatgames:clearLeaderboard', function () {
    chatGames.clearLeaderboard();
    io.emit('chatgames:leaderboard', chatGames.getLeaderboard());
    io.emit('bot:notification', { message: 'Leaderboard cleared' });
  });
  socket.on('chatgames:clearLeaderboardByGame', function (gameType) {
    var validTypes = ['trivia', 'riddle', 'scramble', 'numberguess', 'rps', 'blackjack'];
    if (validTypes.indexOf(gameType) === -1) return;
    chatGames.clearLeaderboardByGame(gameType);
    io.emit('chatgames:leaderboard', chatGames.getLeaderboard());
    io.emit('chatgames:leaderboardByGame', chatGames.getLeaderboardByGame(gameType));
    io.emit('bot:notification', { message: gameType.toUpperCase() + ' leaderboard cleared' });
  });

  // Host Mode
  socket.on('chatgames:getHostStatus', function () { socket.emit('chatgames:hostUpdate', chatGames.getHostStatus()); });
  socket.on('chatgames:hostStart', function (data) { chatGames.startHostGame(data.gameType, data.rounds); });
  socket.on('chatgames:hostStop', function () { chatGames.stopHostGame(); });
  socket.on('chatgames:hostSkip', function () { chatGames.skipHostRound(); });

  // AI Chat Blacklist
  socket.on('aichat:getBlacklist', function () { socket.emit('aichat:blacklist', aiChat.getBlacklist()); });
  socket.on('aichat:addBlacklist', function (name) {
    if (name && typeof name === 'string') {
      aiChat.addToBlacklist(name);
      var list = aiChat.getBlacklist();
      io.emit('aichat:blacklist', list);
      var cfg = loadConfig();
      cfg.aiBlacklist = list;
      saveConfig(cfg);
    }
  });
  socket.on('aichat:removeBlacklist', function (name) {
    if (name && typeof name === 'string') {
      aiChat.removeFromBlacklist(name);
      var list = aiChat.getBlacklist();
      io.emit('aichat:blacklist', list);
      var cfg = loadConfig();
      cfg.aiBlacklist = list;
      saveConfig(cfg);
    }
  });

  // Knowledge Base
  socket.on('knowledge:list', function () {
    db.getAllKnowledge().then(function (entries) {
      socket.emit('knowledge:list', entries);
    });
  });
  socket.on('knowledge:save', function (entry) {
    if (!entry || !entry.category || !entry.title || !entry.content) return;
    db.saveKnowledge(entry).then(function () {
      return db.getAllKnowledge();
    }).then(function (entries) {
      io.emit('knowledge:list', entries);
      aiChat.refreshKnowledgeCache();
      io.emit('bot:notification', { message: 'Knowledge entry saved: ' + entry.title });
    });
  });
  socket.on('knowledge:delete', function (data) {
    if (!data || !data.id) return;
    db.deleteKnowledge(data.id).then(function () {
      return db.getAllKnowledge();
    }).then(function (entries) {
      io.emit('knowledge:list', entries);
      aiChat.refreshKnowledgeCache();
      io.emit('bot:notification', { message: 'Knowledge entry deleted' });
    });
  });

  socket.on('knowledge:bulk-import', function (data) {
    if (!data || !data.entries || !Array.isArray(data.entries)) return;
    var entries = data.entries.filter(function (e) { return e.category && e.title && e.content; });
    if (entries.length === 0) return;

    var saved = 0;
    var chain = Promise.resolve();
    entries.forEach(function (entry) {
      chain = chain.then(function () {
        return db.saveKnowledge({ category: entry.category, title: entry.title, content: entry.content });
      }).then(function () { saved++; });
    });
    chain.then(function () {
      return db.getAllKnowledge();
    }).then(function (allEntries) {
      io.emit('knowledge:list', allEntries);
      aiChat.refreshKnowledgeCache();
      io.emit('bot:notification', { message: 'Bulk imported ' + saved + ' knowledge entries' });
      socket.emit('knowledge:bulk-import-done', { count: saved });
    }).catch(function (err) {
      socket.emit('knowledge:bulk-import-done', { count: saved, error: err.message });
    });
  });

  // Group Blackjack
  socket.on('chatgames:getBjStatus', function () { socket.emit('chatgames:bjUpdate', chatGames.getBjStatus()); });
  socket.on('chatgames:bjStart', function (data) { chatGames.startGroupBlackjack(data && data.rounds); });
  socket.on('chatgames:bjForceStart', function () { chatGames.forceStartGroupBlackjack(); });
  socket.on('chatgames:bjStop', function () { chatGames.stopGroupBlackjack(); });

  // Scheduled Messages
  socket.on('scheduled:getList', function () { socket.emit('scheduled:list', scheduledMessages.getSchedulesWithNextFire()); });
  socket.on('scheduled:save', function (sched) {
    if (!sched.id) sched.id = 'sched_' + Date.now().toString(36);
    db.saveScheduledMessage(sched).then(function () {
      return db.loadScheduledMessages();
    }).then(function (dbScheds) {
      scheduledMessages.setCachedSchedules(dbScheds);
      scheduledMessages.startScheduleTimer(sched);
      io.emit('scheduled:list', scheduledMessages.getSchedulesWithNextFire(dbScheds));
      io.emit('bot:notification', { message: 'Schedule saved: ' + sched.name });
    });
  });
  socket.on('scheduled:delete', function (data) {
    scheduledMessages.clearScheduleTimer(data.id);
    db.deleteScheduledMessage(data.id).then(function () {
      return db.loadScheduledMessages();
    }).then(function (dbScheds) {
      scheduledMessages.setCachedSchedules(dbScheds);
      io.emit('scheduled:list', scheduledMessages.getSchedulesWithNextFire(dbScheds));
      io.emit('bot:notification', { message: 'Schedule deleted' });
    });
  });
  socket.on('scheduled:toggle', function (data) {
    var scheds = scheduledMessages.getSchedules();
    var targetSched = null;
    for (var i = 0; i < scheds.length; i++) {
      if (scheds[i].id === data.id) {
        scheds[i].enabled = data.enabled;
        targetSched = scheds[i];
        break;
      }
    }
    if (targetSched) {
      if (data.enabled) {
        scheduledMessages.startScheduleTimer(targetSched);
      } else {
        scheduledMessages.clearScheduleTimer(targetSched.id);
      }
      db.saveScheduledMessage(targetSched).then(function () {
        io.emit('scheduled:list', scheduledMessages.getSchedulesWithNextFire(scheds));
      });
    }
  });
  socket.on('scheduled:fireNow', function (data) {
    var scheds = scheduledMessages.getSchedules();
    for (var i = 0; i < scheds.length; i++) {
      if (scheds[i].id === data.id) {
        scheduledMessages.sendScheduledMessage(scheds[i]);
        break;
      }
    }
  });

  // ── Attendance Tracker ──────────────────────────────────────
  socket.on('attendance:getState', function () {
    socket.emit('attendance:update', getAttendanceState());
  });

  socket.on('attendance:start', function (data) {
    var eventName = (data && data.eventName) || 'Event';
    var trackerBot = getTrackerBot();
    if (!trackerBot) {
      socket.emit('bot:error', { message: 'No tracker bot is connected. Set a bot role to "tracker" and start it first.' });
      return;
    }
    var startedAt = Date.now();
    attendanceState.active = true;
    attendanceState.eventName = eventName;
    attendanceState.startedAt = startedAt;
    attendanceState.stoppedAt = null;
    attendanceState.attendees = {};
    attendanceState.totalCount = 0;
    attendanceState.eventId = null;

    // Create DB event, then seed players
    db.createAttendanceEvent(eventName, startedAt).then(function (eventId) {
      attendanceState.eventId = eventId;

      // Seed with players already on screen (from entityNames)
      if (trackerBot.entityNames) {
        var serials = Object.keys(trackerBot.entityNames);
        for (var i = 0; i < serials.length; i++) {
          var name = trackerBot.entityNames[serials[i]];
          if (name && name !== trackerBot.state.username) {
            attendanceRecordPlayer(name);
          }
        }
      }

      io.emit('attendance:update', getAttendanceState());
      io.emit('bot:notification', { message: 'Attendance tracking started for: ' + eventName });
      console.log('[Attendance] Started tracking for event: ' + eventName + ' (DB id: ' + eventId + ')');
    }).catch(function (err) {
      console.error('[Attendance] Failed to create DB event:', err.message);
      // Still works in-memory even if DB fails
      if (trackerBot.entityNames) {
        var serials = Object.keys(trackerBot.entityNames);
        for (var i = 0; i < serials.length; i++) {
          var name = trackerBot.entityNames[serials[i]];
          if (name && name !== trackerBot.state.username) {
            attendanceRecordPlayer(name);
          }
        }
      }
      io.emit('attendance:update', getAttendanceState());
      io.emit('bot:notification', { message: 'Attendance tracking started for: ' + eventName });
    });
  });

  socket.on('attendance:stop', function () {
    if (!attendanceState.active) return;
    attendanceState.active = false;
    attendanceState.stoppedAt = Date.now();
    if (attendanceState.eventId) {
      db.stopAttendanceEvent(attendanceState.eventId, attendanceState.stoppedAt);
    }
    io.emit('attendance:update', getAttendanceState());
    io.emit('bot:notification', { message: 'Attendance tracking stopped. Total: ' + attendanceState.totalCount + ' attendees.' });
    console.log('[Attendance] Stopped. Total attendees: ' + attendanceState.totalCount);
  });

  socket.on('attendance:clear', function () {
    if (attendanceState.eventId) {
      db.clearAttendanceEvent(attendanceState.eventId);
    }
    attendanceState.active = false;
    attendanceState.eventName = '';
    attendanceState.startedAt = null;
    attendanceState.stoppedAt = null;
    attendanceState.attendees = {};
    attendanceState.totalCount = 0;
    attendanceState.eventId = null;
    io.emit('attendance:update', getAttendanceState());
    io.emit('bot:notification', { message: 'Attendance data cleared.' });
  });

  // ── NPC Leak Scanner Controls ────────────────────────────────
  socket.on('npcleak:start', function (data) {
    var leakBot = getLeakBot();
    if (!leakBot) {
      socket.emit('bot:error', { message: 'No leak bot is connected. Set a bot role to "leak" and start it first.' });
      return;
    }
    if (!data || !data.serial) {
      // If no serial given, try to find the NPC by name in the leak bot's entity list
      if (data && data.npcName && leakBot.entityNames) {
        var foundSerial = null;
        var serials = Object.keys(leakBot.entityNames);
        for (var i = 0; i < serials.length; i++) {
          if (leakBot.entityNames[serials[i]] === data.npcName) {
            foundSerial = parseInt(serials[i]);
            break;
          }
        }
        if (!foundSerial) {
          socket.emit('npcleak:status', { active: false, error: 'NPC "' + data.npcName + '" not found on screen. Walk near the NPC first.' });
          return;
        }
        data.serial = foundSerial;
      } else {
        socket.emit('npcleak:status', { active: false, error: 'Provide serial or npcName' });
        return;
      }
    }
    var result = npcLeak.start({
      serial: data.serial,
      name: data.npcName || data.name,
      lookupName: data.lookupName || '',
      maxClicks: data.maxClicks || 20,
      intervalMs: data.intervalMs || 500
    });
    if (!result.ok) {
      socket.emit('npcleak:status', { active: false, error: result.error });
    }
  });

  socket.on('npcleak:stop', function () {
    npcLeak.stop();
  });

  socket.on('npcleak:status', function () {
    socket.emit('npcleak:status', npcLeak.getStatus());
  });

  socket.on('npcleak:getLog', function () {
    socket.emit('npcleak:fullLog', npcLeak.getLog());
  });

  socket.on('npcleak:listNpcs', function () {
    var leakBot = getLeakBot();
    var npcs = [];
    var seen = {};

    // First: leak bot's own entities
    if (leakBot && leakBot.entityNames) {
      var serials = Object.keys(leakBot.entityNames);
      console.log('[NpcLeak] Leak bot has ' + serials.length + ' entities');
      for (var i = 0; i < serials.length; i++) {
        var s = parseInt(serials[i]);
        npcs.push({ serial: s, name: leakBot.entityNames[serials[i]] });
        seen[s] = true;
      }
    } else {
      console.log('[NpcLeak] No leak bot found or no entityNames');
    }

    // Fallback: merge entities from ALL bots on the same map
    if (leakBot) {
      bots.forEach(function (otherBot) {
        if (otherBot === leakBot) return;
        if (!otherBot.entityNames) return;
        if (otherBot.state.mapNumber !== leakBot.state.mapNumber) return;
        var otherSerials = Object.keys(otherBot.entityNames);
        for (var j = 0; j < otherSerials.length; j++) {
          var os = parseInt(otherSerials[j]);
          if (!seen[os]) {
            npcs.push({ serial: os, name: otherBot.entityNames[otherSerials[j]] });
            seen[os] = true;
          }
        }
      });
    }

    console.log('[NpcLeak] Returning ' + npcs.length + ' entities to panel');
    socket.emit('npcleak:npcList', npcs);
  });

  socket.on('npcleak:refresh', function () {
    var leakBot = getLeakBot();
    if (!leakBot || !leakBot.client) {
      socket.emit('bot:error', { message: 'Leak bot not connected' });
      return;
    }
    // Send 0x38 (Refresh) to force server to resend all entities on screen
    console.log('[NpcLeak] Sending 0x38 refresh to force entity resend');
    var refreshPkt = new Packet(0x38);
    leakBot.client.send(refreshPkt);
    socket.emit('bot:notification', { message: 'Refresh sent. Click the refresh button again in a moment to see updated entities.' });
  });

  socket.on('disconnect', function () { console.log('Panel disconnected'); });
});

// ── Initialize Modules ───────────────────────────────────────────

playerTracker.init({ db: db, io: io });
scheduledMessages.init({
  db: db,
  io: io,
  Packet: Packet,
  getPrimaryBot: getPrimaryBot,
  bots: bots,
  loadConfig: loadConfig
});

aeIngest.init();
discord.init(null, db);
chatGames.init(__dirname, {
  sendSay: botSendSay,
  sendWhisper: botSendWhisper,
  sendEmote: botSendEmote,
  io: io,
  db: db,
  getUsername: function () {
    var primary = getPrimaryBot();
    return primary ? primary.state.username : '';
  }
});
tradeSessions.init({
  sendWhisper: botSendWhisper,
  io: io,
  getBotUsername: function () {
    var primary = getPrimaryBot();
    return primary ? primary.state.username : '';
  }
});
aiChat.init({
  sendSay: botSendSay,
  sendWhisper: botSendWhisper,
  io: io,
  db: db,
  getUsername: function () {
    var primary = getPrimaryBot();
    return primary ? primary.state.username : '';
  },
  getChatHistory: function () {
    return chatHistory;
  },
  playerTracker: playerTracker,
  chatGames: chatGames
});
lottery.init({
  sendPacket: lotterySendPacket,
  sendWhisper: lotterySendWhisper,
  sendSay: lotterySendSay,
  io: io,
  getBotSerial: function () {
    var lotteryBot = getLotteryBot();
    return lotteryBot ? (lotteryBot.state.serial || 0) : 0;
  },
  getEntityName: function (serial) {
    var lotteryBot = getLotteryBot();
    if (lotteryBot && lotteryBot.entityNames) {
      return lotteryBot.entityNames[serial];
    }
    return undefined;
  }
});
itemTrade.init({
  sendPacket: traderSendPacket,
  sendWhisper: traderSendWhisper,
  io: io
});
slotMachine.init({
  sendPacket: slotSendPacket,
  sendWhisper: slotSendWhisper,
  sendSay: slotSendSay,
  io: io,
  getBotSerial: function () {
    var slotBot = getSlotBot();
    return slotBot ? (slotBot.state.serial || 0) : 0;
  },
  getEntityName: function (serial) {
    var slotBot = getSlotBot();
    if (slotBot && slotBot.entityNames) {
      return slotBot.entityNames[serial];
    }
    return undefined;
  },
  getSerialByName: function (name) {
    var slotBot = getSlotBot();
    if (slotBot && slotBot.entityNames) {
      var entityCount = Object.keys(slotBot.entityNames).length;
      console.log('[Slots] getSerialByName("' + name + '") searching ' + entityCount + ' entities');
      for (var serial in slotBot.entityNames) {
        if (slotBot.entityNames[serial].toLowerCase() === name.toLowerCase()) {
          console.log('[Slots] getSerialByName: FOUND "' + name + '" → serial=0x' + parseInt(serial).toString(16));
          return parseInt(serial);
        }
      }
      console.log('[Slots] getSerialByName: NOT FOUND "' + name + '" in entity list');
    } else {
      console.log('[Slots] getSerialByName: no slotBot or no entityNames');
    }
    return 0;
  },
  getEntityPosition: function (serial) {
    var slotBot = getSlotBot();
    if (slotBot && slotBot.entityPositions && slotBot.entityPositions[serial]) {
      return slotBot.entityPositions[serial];
    }
    return null;
  },
  setBankingActive: function (active) {
    slotBankingActive = !!active;
    console.log('[Slots] Banking active flag: ' + slotBankingActive);
  }
});
var startupConfig = loadConfig();
if (startupConfig.aiBlacklist && startupConfig.aiBlacklist.length) {
  aiChat.setBlacklist(startupConfig.aiBlacklist);
}

// ── Database Initialization & Startup ────────────────────────────

db.init().then(function () {
  console.log('[DB] Connected to PostgreSQL');
  return db.loadConfig().then(function (dbConfig) {
    var config = configManager.setFromDB(dbConfig);
    aeIngest.setConfigFromDB(config.aeIngest);
    chatGames.setConfigFromDB(config.chatGames);
  });
}).then(function () {
  return db.loadScheduledMessages().then(function (scheds) {
    scheduledMessages.setCachedSchedules(scheds);
    console.log('[DB] Loaded ' + scheds.length + ' scheduled messages');
  });
}).then(function () {
  return db.getRecentChatHistory(200).then(function (history) {
    if (history.length > 0) {
      chatHistory = history;
      console.log('[DB] Loaded ' + history.length + ' chat history entries');
    }
  });
}).then(function () {
  return db.loadDiscordRules().then(function (rules) {
    if (rules.length > 0) {
      discord.setRulesFromDB(rules);
      console.log('[DB] Loaded ' + rules.length + ' discord rules');
    }
  });
}).then(function () {
  return db.loadLeaderboard().then(function (data) {
    if (data.scoreboard.size > 0) {
      chatGames.setScoreboardFromDB(data.scoreboard, data.totalGamesPlayed);
      console.log('[DB] Loaded ' + data.scoreboard.size + ' leaderboard entries');
    }
  });
}).then(function () {
  var config = loadConfig();
  if (config.bots && config.bots.length > 0) {
    config.bots.forEach(function (botConfig) {
      bots.set(botConfig.id, { client: null, state: createBotState(botConfig), config: botConfig });
    });
  }

  scheduledMessages.startAllSchedules();

  // User List Pulse (every 2 minutes)
  var userListPulseInterval = setInterval(function () {
    var primary = getPrimaryBot();
    if (primary && primary.client && primary.state.status === 'logged_in') {
      console.log('[Pulse] Requesting user list (0x18)');
      botRequestUserList();
    }
  }, 2 * 60 * 1000);

  // Graceful shutdown
  function gracefulShutdown() {
    console.log('\n[Shutdown] Gracefully shutting down...');
    clearInterval(userListPulseInterval);
    auth.cleanup();
    scheduledMessages.stopAllSchedules();
    stopAllBots();
    db.pool.end().then(function () {
      console.log('[Shutdown] Database pool closed');
      process.exit(0);
    }).catch(function () {
      process.exit(1);
    });
  }
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  // Start Server FIRST, then load heavy data in the background
  var webPort = config.webPort || 3000;
  server.on('error', function (err) {
    if (err.code === 'EADDRINUSE') {
      console.error('\n  Port ' + webPort + ' is already in use.\n  Either close the other process or change webPort in the database config.\n');
      process.exit(1);
    }
    throw err;
  });

  server.listen(webPort, function () {
    console.log('');
    console.log('  DASB Web Panel (Multi-Bot) [PostgreSQL]');
    console.log('  ────────────────────────────');
    console.log('  URL:  http://localhost:' + webPort);
    console.log('  Database: dasb (PostgreSQL)');
    console.log('  Bots configured: ' + (config.bots ? config.bots.length : 0));
    console.log('');
    console.log('  Open the URL in your browser to control the bots.');
    console.log('');

    // Start proxy if configured
    var proxyConfig = config.proxy;
    if (proxyConfig && proxyConfig.enabled) {
      proxySystem = createProxySystem({
        listenPort: proxyConfig.listenPort || 2610,
        gamePort1: proxyConfig.gamePort1 || 2611,
        gamePort2: proxyConfig.gamePort2 || 2612,
        publicAddress: proxyConfig.publicAddress || '127.0.0.1',
        realServerAddress: proxyConfig.realServerAddress || '52.88.55.94',
        realLoginPort: proxyConfig.realLoginPort || 2610,
        logPackets: proxyConfig.logPackets !== false,
      });

      // Wire proxy events to Socket.IO
      proxySystem.server.on('session:new', function (session) {
        io.emit('proxy:session:new', { id: session.id, connectedAt: session.connectedAt });
      });
      proxySystem.server.on('session:game', function (session) {
        io.emit('proxy:session:game', { id: session.id, characterName: session.characterName });
      });
      proxySystem.server.on('session:end', function (session) {
        io.emit('proxy:session:end', { id: session.id, characterName: session.characterName });
      });

      // Push proxy player position/map updates to panel
      proxySystem.server.on('player:position', function (session) {
        io.emit('proxy:playerUpdate', {
          sessionId: session.id,
          x: session.playerState.x,
          y: session.playerState.y,
          mapNumber: session.playerState.mapNumber
        });
      });
      proxySystem.server.on('player:mapChange', function (session) {
        io.emit('proxy:playerUpdate', {
          sessionId: session.id,
          mapNumber: session.playerState.mapNumber,
          x: session.playerState.x,
          y: session.playerState.y
        });
      });

      // NPC click notifications to panel
      proxySystem.server.on('npc:click', function (session, npc) {
        io.emit('proxy:npc:click', {
          playerName: session.characterName,
          npcName: npc.name,
          serial: npc.serial,
          mapNumber: npc.mapNumber
        });
      });

      // Packet logging to panel (throttled)
      var packetLogBuffer = [];
      var packetLogTimer = null;
      proxySystem.inspector.onPacket = function (packet, direction, session) {
        packetLogBuffer.push({
          ts: Date.now(),
          dir: direction,
          op: packet.opcode,
          len: packet.body.length,
          sid: session.id,
          char: session.characterName,
        });
        if (!packetLogTimer) {
          packetLogTimer = setTimeout(function () {
            io.emit('proxy:packets', packetLogBuffer.splice(0));
            packetLogTimer = null;
          }, 250);
        }
      };

      proxySystem.server.start().then(function () {
        console.log('  Proxy: ACTIVE on port ' + (proxyConfig.listenPort || 2610));
        restoreVirtualNpcs();
        // Initialize automation (loads SOTP collision data + map exit graph)
        return proxySystem.automation.init();
      }).then(function () {
        console.log('  Proxy: Automation initialized');
      }).catch(function (err) {
        console.error('[Proxy] Failed to start:', err.message);
      });
    }

    // Load heavy player data and attendance in the background after panel is up
    playerTracker.loadFromDB().then(function () {
      return db.loadLatestAttendanceEvent().then(function (event) {
        if (!event) return;
        return db.loadAttendanceRecords(event.id).then(function (records) {
          attendanceState.eventId = event.id;
          attendanceState.eventName = event.event_name;
          attendanceState.startedAt = parseInt(event.started_at);
          attendanceState.stoppedAt = event.stopped_at ? parseInt(event.stopped_at) : null;
          attendanceState.active = event.active;
          attendanceState.totalCount = event.total_count;
          attendanceState.attendees = {};
          for (var i = 0; i < records.length; i++) {
            var r = records[i];
            attendanceState.attendees[r.name.toLowerCase()] = {
              name: r.name,
              firstSeen: r.firstSeen,
              lastSeen: r.lastSeen,
              sightings: r.sightings
            };
          }
          console.log('[DB] Restored attendance event: ' + event.event_name + ' (' + records.length + ' attendees, active: ' + event.active + ')');
        });
      });
    }).then(function () {
      console.log('[DB] Background data loading complete');
    }).catch(function (err) {
      console.error('[DB] Background load error:', err.message);
    });
  });
}).catch(function (err) {
  console.error('[DB] Failed to initialize:', err.message);
  process.exit(1);
});
