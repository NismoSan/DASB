"use strict";

// ── Trade Sessions Module ─────────────────────────────────────────
// Handles whisper-to-buy flow: sends whisper to seller, tracks
// response (Yes/No), detects offline, broadcasts status via SSE.

// ── State ─────────────────────────────────────────────────────────

var tradeSessions = new Map(); // sessionId -> session
var pendingWhispers = new Map(); // sellerName.toLowerCase() -> sessionId
var sseClients = new Map(); // sessionId -> Set<res>
var buyerCooldowns = new Map(); // buyerUsername.toLowerCase() -> timestamp

// Dependencies (injected via init)
var sendWhisperFn = null;
var ioRef = null;
var getBotUsernameFn = null;

// Constants
var SESSION_TIMEOUT_MS = 60 * 1000;
var OFFLINE_DETECT_WINDOW_MS = 3 * 1000;
var SESSION_CLEANUP_MS = 5 * 60 * 1000;
var TERMINAL_RETAIN_MS = 2 * 60 * 1000;
var MAX_CONCURRENT_SESSIONS = 20;
var BUYER_COOLDOWN_MS = 15 * 1000;
var WHISPER_MAX = 64;
function splitAndSendWhisper(target, text) {
  if (!sendWhisperFn) return;
  var chunks = [];
  var remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= WHISPER_MAX) {
      chunks.push(remaining);
      break;
    }
    var slice = remaining.substring(0, WHISPER_MAX);
    var lastSpace = slice.lastIndexOf(' ');
    if (lastSpace > WHISPER_MAX * 0.3) {
      chunks.push(remaining.substring(0, lastSpace));
      remaining = remaining.substring(lastSpace + 1);
    } else {
      chunks.push(slice);
      remaining = remaining.substring(WHISPER_MAX);
    }
  }
  chunks.forEach(function (chunk, i) {
    setTimeout(function () {
      sendWhisperFn(target, chunk);
    }, i * 500);
  });
}

// ── Alt Character Fallback ────────────────────────────────────────

function tryNextAlt(session) {
  session.currentAltIndex++;
  var altName = session.sellerAlts[session.currentAltIndex];
  session.currentWhisperTarget = altName;

  // Register this alt in pendingWhispers so offline/response detection works
  var altKey = altName.toLowerCase();
  pendingWhispers.set(altKey, session.id);

  // Update status to checking_alts
  var altNum = session.currentAltIndex + 1;
  var altTotal = session.sellerAlts.length;
  updateSession(session, 'checking_alts', 'Checking alt characters... (' + altNum + '/' + altTotal + ') Trying ' + altName + '...');

  // Build and send the whisper to this alt
  var whisperMsg;
  if (session.listingType === 'BUY') {
    whisperMsg = session.buyerUsername + ' wants to sell you ' + session.itemName + ' on AislingExchange. Interested? (Yes/No)';
  } else {
    whisperMsg = session.buyerUsername + ' wants to buy your ' + session.itemName + ' on AislingExchange. Interested? (Yes/No)';
  }
  splitAndSendWhisper(altName, whisperMsg);

  // New offline detection window for this alt
  session.offlineTimer = setTimeout(function () {
    session.offlineTimer = null;
    if (session.status === 'checking_alts') {
      // 3 seconds passed without "nowhere to be found" — alt is online!
      updateSession(session, 'waiting_response', altName + ' (alt of ' + session.sellerUsername + ') is online! Waiting for response...');
    }
  }, OFFLINE_DETECT_WINDOW_MS);
  console.log('[Trade Sessions] Session ' + session.id + ': trying alt ' + altName + ' (' + altNum + '/' + altTotal + ')');
}

// ── Helpers ───────────────────────────────────────────────────────

function generateId() {
  return 'ts_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function isTerminal(status) {
  return status === 'confirmed' || status === 'declined' || status === 'offline' || status === 'no_reply' || status === 'error';
}
function sessionSnapshot(session) {
  return {
    sessionId: session.id,
    buyerUsername: session.buyerUsername,
    sellerUsername: session.sellerUsername,
    itemName: session.itemName,
    listingId: session.listingId,
    status: session.status,
    statusMessage: session.statusMessage,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    currentWhisperTarget: session.currentWhisperTarget || session.sellerUsername,
    altCheckProgress: session.sellerAlts && session.sellerAlts.length > 0 ? {
      current: session.currentAltIndex + 1,
      total: session.sellerAlts.length
    } : null
  };
}
function updateSession(session, status, statusMessage) {
  session.status = status;
  session.statusMessage = statusMessage;
  session.updatedAt = Date.now();
  broadcastStatus(session.id);
  if (isTerminal(status)) {
    cleanupTimers(session);
    // Remove primary seller from pendingWhispers
    var sellerKey = session.sellerUsername.toLowerCase();
    if (pendingWhispers.get(sellerKey) === session.id) {
      pendingWhispers["delete"](sellerKey);
    }
    // Remove current alt target from pendingWhispers
    if (session.currentWhisperTarget) {
      var targetKey = session.currentWhisperTarget.toLowerCase();
      if (targetKey !== sellerKey && pendingWhispers.get(targetKey) === session.id) {
        pendingWhispers["delete"](targetKey);
      }
    }
    // Schedule removal
    setTimeout(function () {
      tradeSessions["delete"](session.id);
      closeSSEClients(session.id);
      sseClients["delete"](session.id);
    }, TERMINAL_RETAIN_MS);
  }
}
function cleanupTimers(session) {
  if (session.timeoutTimer) {
    clearTimeout(session.timeoutTimer);
    session.timeoutTimer = null;
  }
  if (session.offlineTimer) {
    clearTimeout(session.offlineTimer);
    session.offlineTimer = null;
  }
}

// ── SSE Broadcasting ──────────────────────────────────────────────

function broadcastStatus(sessionId) {
  var session = tradeSessions.get(sessionId);
  if (!session) return;
  var clients = sseClients.get(sessionId);
  if (!clients || clients.size === 0) return;
  var data = 'data: ' + JSON.stringify(sessionSnapshot(session)) + '\n\n';
  clients.forEach(function (res) {
    try {
      res.write(data);
      if (typeof res.flush === 'function') res.flush();
    } catch (err) {
      // Client disconnected
      clients["delete"](res);
    }
  });
}
function closeSSEClients(sessionId) {
  var clients = sseClients.get(sessionId);
  if (!clients) return;
  clients.forEach(function (res) {
    try {
      res.end();
    } catch (e) {/* ignore */}
  });
  clients.clear();
}

// ── Periodic Cleanup ──────────────────────────────────────────────

setInterval(function () {
  var now = Date.now();
  tradeSessions.forEach(function (session, id) {
    // Remove stale terminal sessions
    if (isTerminal(session.status) && now - session.updatedAt > TERMINAL_RETAIN_MS) {
      tradeSessions["delete"](id);
      closeSSEClients(id);
      sseClients["delete"](id);
    }
    // Force-expire sessions that somehow exceed 5 minutes
    if (!isTerminal(session.status) && now - session.createdAt > 5 * 60 * 1000) {
      updateSession(session, 'error', 'Session expired.');
    }
  });

  // Clean old buyer cooldowns
  buyerCooldowns.forEach(function (ts, key) {
    if (now - ts > BUYER_COOLDOWN_MS * 2) {
      buyerCooldowns["delete"](key);
    }
  });
}, SESSION_CLEANUP_MS);

// ── Exports ───────────────────────────────────────────────────────

module.exports = {
  init: function init(deps) {
    sendWhisperFn = deps.sendWhisper;
    ioRef = deps.io;
    getBotUsernameFn = deps.getBotUsername;
    console.log('[Trade Sessions] Initialized');
  },
  createSession: function createSession(opts) {
    var buyerUsername = opts.buyerUsername;
    var sellerUsername = opts.sellerUsername;
    var itemName = opts.itemName;
    var listingId = opts.listingId;
    var listingType = opts.listingType || 'SELL'; // SELL = clicker is buying, BUY = clicker is selling

    if (!buyerUsername || !sellerUsername || !itemName) {
      return {
        error: 'Missing required fields.'
      };
    }

    // Check bot is online
    var botName = getBotUsernameFn ? getBotUsernameFn() : '';
    if (!botName) {
      return {
        error: 'Bot is not online. Please try again later.'
      };
    }

    // Rate limit per buyer
    var buyerKey = buyerUsername.toLowerCase();
    var lastWhisper = buyerCooldowns.get(buyerKey);
    if (lastWhisper && Date.now() - lastWhisper < BUYER_COOLDOWN_MS) {
      var wait = Math.ceil((BUYER_COOLDOWN_MS - (Date.now() - lastWhisper)) / 1000);
      return {
        error: 'Please wait ' + wait + ' seconds before sending another whisper.'
      };
    }

    // One active session per seller
    var sellerKey = sellerUsername.toLowerCase();
    if (pendingWhispers.has(sellerKey)) {
      var existingId = pendingWhispers.get(sellerKey);
      var existing = tradeSessions.get(existingId);
      if (existing && !isTerminal(existing.status)) {
        return {
          error: 'Someone is already contacting this seller. Please try again in a moment.'
        };
      }
    }

    // Max concurrent sessions
    var activeCount = 0;
    tradeSessions.forEach(function (s) {
      if (!isTerminal(s.status)) activeCount++;
    });
    if (activeCount >= MAX_CONCURRENT_SESSIONS) {
      return {
        error: 'Too many active trade requests. Please try again shortly.'
      };
    }

    // Create session
    var sessionId = generateId();
    var now = Date.now();
    var session = {
      id: sessionId,
      buyerUsername: buyerUsername,
      sellerUsername: sellerUsername,
      itemName: itemName,
      listingId: listingId,
      listingType: listingType,
      status: 'sending',
      statusMessage: 'Sending whisper to ' + sellerUsername + '...',
      createdAt: now,
      updatedAt: now,
      timeoutTimer: null,
      offlineTimer: null,
      // Alt character fallback tracking
      sellerAlts: opts.sellerAlts || [],
      currentAltIndex: -1,
      currentWhisperTarget: sellerUsername
    };
    tradeSessions.set(sessionId, session);
    pendingWhispers.set(sellerKey, sessionId);
    buyerCooldowns.set(buyerKey, now);

    // Send the whisper — adapt message based on listing type
    var whisperMsg;
    if (listingType === 'BUY') {
      // The listing poster wants to buy, the clicker wants to sell to them
      whisperMsg = buyerUsername + ' wants to sell you ' + itemName + ' on AislingExchange. Interested? (Yes/No)';
    } else {
      // The listing poster is selling, the clicker wants to buy from them
      whisperMsg = buyerUsername + ' wants to buy your ' + itemName + ' on AislingExchange. Interested? (Yes/No)';
    }
    splitAndSendWhisper(sellerUsername, whisperMsg);

    // Update status
    updateSession(session, 'waiting_offline', 'Checking if ' + sellerUsername + ' is online...');

    // Offline detection window: if no "nowhere to be found" within 3s, they're online
    session.offlineTimer = setTimeout(function () {
      session.offlineTimer = null;
      if (session.status === 'waiting_offline') {
        updateSession(session, 'waiting_response', sellerUsername + ' is online! Waiting for response...');
      }
    }, OFFLINE_DETECT_WINDOW_MS);

    // Overall timeout: 60s total
    session.timeoutTimer = setTimeout(function () {
      session.timeoutTimer = null;
      if (!isTerminal(session.status)) {
        updateSession(session, 'no_reply', 'No reply. ' + sellerUsername + ' is probably daydreaming.');
      }
    }, SESSION_TIMEOUT_MS);
    console.log('[Trade Sessions] Created session ' + sessionId + ': ' + buyerUsername + ' -> ' + sellerUsername + ' (' + itemName + ') listingType=' + listingType + ' whisper="' + whisperMsg + '"');
    return {
      sessionId: sessionId
    };
  },
  handleIncomingWhisper: function handleIncomingWhisper(senderName, message) {
    var senderKey = senderName.toLowerCase();
    var sessionId = pendingWhispers.get(senderKey);
    if (!sessionId) return false;
    var session = tradeSessions.get(sessionId);
    if (!session || isTerminal(session.status)) return false;
    var trimmed = message.trim().toLowerCase();

    // Determine if the responder is an alt character
    var responderName = senderName;
    var isAlt = session.currentWhisperTarget.toLowerCase() === senderKey && senderKey !== session.sellerUsername.toLowerCase();
    var displayName = isAlt ? responderName + ' (alt of ' + session.sellerUsername + ')' : session.sellerUsername;

    // Check for Yes
    if (trimmed === 'yes' || trimmed === 'y' || trimmed === 'yeah' || trimmed === 'yep' || trimmed === 'sure') {
      var isBuyListing = session.listingType === 'BUY';
      // Status message shown in the modal to the clicker
      var confirmMsg = isBuyListing ? displayName + ' wants to buy your ' + session.itemName + '! Reach out to them in-game.' : displayName + ' is interested in selling ' + session.itemName + '! Reach out to them in-game.';
      updateSession(session, 'confirmed', confirmMsg);

      // Whisper the clicker (buyerUsername) in-game — use actual responder name
      var buyerMsg = isBuyListing ? responderName + ' wants to buy your ' + session.itemName + '! Whisper them in-game.' : responderName + ' wants to sell you ' + session.itemName + '! Whisper them in-game.';
      splitAndSendWhisper(session.buyerUsername, buyerMsg);

      // Also whisper the responder a confirmation
      var posterMsg = isBuyListing ? 'Great! ' + session.buyerUsername + ' will sell you ' + session.itemName + '. They will reach out to you shortly.' : 'Great! ' + session.buyerUsername + ' will buy your ' + session.itemName + '. They will reach out to you shortly.';
      splitAndSendWhisper(responderName, posterMsg);
      console.log('[Trade Sessions] Session ' + sessionId + ': CONFIRMED by ' + responderName + (isAlt ? ' (alt)' : ''));
      return true;
    }

    // Check for No
    if (trimmed === 'no' || trimmed === 'n' || trimmed === 'nah' || trimmed === 'nope') {
      updateSession(session, 'declined', displayName + ' declined the offer.');
      console.log('[Trade Sessions] Session ' + sessionId + ': DECLINED by ' + responderName + (isAlt ? ' (alt)' : ''));
      return true;
    }

    // Unrecognized response — don't consume, let it pass through
    return false;
  },
  handleSystemMessage: function handleSystemMessage(messageRaw) {
    if (!messageRaw) return;

    // Match "PlayerName is nowhere to be found" pattern
    var offlineMatch = messageRaw.match(/(.+?)\s+is nowhere to be found/i);
    if (!offlineMatch) return;
    var offlineName = offlineMatch[1].replace(/^"/, '').replace(/"$/, '').trim();
    var nameKey = offlineName.toLowerCase();
    var sessionId = pendingWhispers.get(nameKey);
    if (!sessionId) return;
    var session = tradeSessions.get(sessionId);
    if (!session || isTerminal(session.status)) return;

    // Only process if this offline message is for the character we're currently trying
    if (session.currentWhisperTarget.toLowerCase() !== nameKey) return;

    // Clear the offline detection timer since we got a definitive answer
    if (session.offlineTimer) {
      clearTimeout(session.offlineTimer);
      session.offlineTimer = null;
    }

    // Remove this name from pendingWhispers
    pendingWhispers["delete"](nameKey);

    // Check if there are more alts to try
    if (session.sellerAlts.length > 0 && session.currentAltIndex < session.sellerAlts.length - 1) {
      tryNextAlt(session);
    } else {
      // No more alts — terminal offline
      var msg = session.sellerAlts.length > 0 ? 'No available characters online for ' + session.sellerUsername + '.' : offlineName + ' is nowhere to be found (offline).';
      updateSession(session, 'offline', msg);
      console.log('[Trade Sessions] Session ' + sessionId + ': ' + offlineName + ' is OFFLINE (no alts remaining)');
    }
  },
  handleBotDisconnect: function handleBotDisconnect() {
    tradeSessions.forEach(function (session) {
      if (!isTerminal(session.status)) {
        updateSession(session, 'error', 'Bot went offline. Please try again later.');
      }
    });
  },
  getSession: function getSession(sessionId) {
    var session = tradeSessions.get(sessionId);
    if (!session) return null;
    return sessionSnapshot(session);
  },
  addSSEClient: function addSSEClient(sessionId, res) {
    if (!sseClients.has(sessionId)) {
      sseClients.set(sessionId, new Set());
    }
    sseClients.get(sessionId).add(res);
  },
  removeSSEClient: function removeSSEClient(sessionId, res) {
    var clients = sseClients.get(sessionId);
    if (clients) {
      clients["delete"](res);
    }
  }
};