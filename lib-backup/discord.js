"use strict";

function _createForOfIteratorHelper(r, e) { var t = "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (!t) { if (Array.isArray(r) || (t = _unsupportedIterableToArray(r)) || e && r && "number" == typeof r.length) { t && (r = t); var _n = 0, F = function F() {}; return { s: F, n: function n() { return _n >= r.length ? { done: !0 } : { done: !1, value: r[_n++] }; }, e: function e(r) { throw r; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var o, a = !0, u = !1; return { s: function s() { t = t.call(r); }, n: function n() { var r = t.next(); return a = r.done, r; }, e: function e(r) { u = !0, o = r; }, f: function f() { try { a || null == t["return"] || t["return"](); } finally { if (u) throw o; } } }; }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
// ── Discord Webhook Integration ──────────────────────────────────
// Dispatches decoded chat messages to Discord channels via webhooks,
// based on user-configured rules with message type and regex matching.
// Ported from tracker's discord.ts for use without Electron.

// ── State ────────────────────────────────────────────────────────

var config = {
  rules: []
};
var dbRef = null;

// ── Rule matching ────────────────────────────────────────────────

var WORLD_SUBTYPES = {
  WorldMessage: true,
  WorldShout: true,
  WhisperReceived: true,
  GuildMessage: true
};
function matchesRule(rule, msg) {
  if (!rule.enabled) return false;
  var types = rule.messageTypes || [];
  var typeMatch = types.indexOf('Any') !== -1 || types.indexOf(msg.type) !== -1 || WORLD_SUBTYPES[msg.type] && types.indexOf('WorldMessage (All)') !== -1;
  if (!typeMatch) return false;
  if (rule.pattern) {
    try {
      var re = new RegExp(rule.pattern, 'i');
      if (!re.test(msg.text)) return false;
    } catch (e) {
      return false;
    }
  }
  return true;
}

// ── Discord embed formatting ─────────────────────────────────────

var COLOR_MAP = {
  WorldMessage: 0xd4a440,
  WorldShout: 0xfbbf24,
  WhisperReceived: 0xf472b6,
  GuildMessage: 0xa78bfa,
  PublicMessage: 0x60a5fa,
  Say: 0x34d399,
  Whisper: 0xf472b6
};
function parseWhisperText(text) {
  var m = text.match(/^"?([A-Za-z][^"]*)"\s*([\s\S]*)$/);
  if (m) return {
    sender: m[1],
    message: m[2]
  };
  return {
    sender: 'Unknown',
    message: text
  };
}
function formatDiscordPayload(rule, msg) {
  var timestamp = new Date().toISOString();
  var isWhisperType = msg.type === 'WhisperReceived';

  // Incoming whisper embeds: show From / To / Message
  if (isWhisperType) {
    var parsed = parseWhisperText(msg.text);
    var recipient = msg.characterName || 'Unknown';
    return {
      username: rule.botName || 'DASB',
      avatar_url: rule.botAvatar || undefined,
      embeds: [{
        color: 0xf472b6,
        author: {
          name: 'Whisper Received'
        },
        fields: [{
          name: 'From',
          value: '**' + parsed.sender + '**',
          inline: true
        }, {
          name: 'To',
          value: '**' + recipient + '**',
          inline: true
        }],
        description: '>>> ' + parsed.message,
        timestamp: timestamp,
        footer: {
          text: 'Whisper'
        }
      }]
    };
  }

  // Outgoing whisper: show who sent it and who it's going to
  if (msg.type === 'Whisper' && msg.target) {
    var sender = msg.characterName || 'Unknown';
    return {
      username: rule.botName || 'DASB',
      avatar_url: rule.botAvatar || undefined,
      embeds: [{
        color: 0xc084fc,
        author: {
          name: 'Whisper Sent'
        },
        fields: [{
          name: 'From',
          value: '**' + sender + '**',
          inline: true
        }, {
          name: 'To',
          value: '**' + msg.target + '**',
          inline: true
        }],
        description: '>>> ' + msg.text,
        timestamp: timestamp,
        footer: {
          text: 'Whisper'
        }
      }]
    };
  }

  // All other message types
  var footerText = msg.type === 'GuildMessage' ? 'Guild Chat' : msg.type === 'WorldMessage' ? 'World Message' : msg.type === 'WorldShout' ? 'World Shout' : msg.type === 'PublicMessage' ? 'Local Chat' : msg.type;
  return {
    username: rule.botName || 'DASB',
    avatar_url: rule.botAvatar || undefined,
    embeds: [{
      description: msg.text,
      color: COLOR_MAP[msg.type] || 0xd4a440,
      timestamp: timestamp,
      footer: {
        text: footerText
      }
    }]
  };
}

// ── Webhook send with rate-limit awareness ───────────────────────

function sendWebhook(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  }).then(function (response) {
    if (response.status === 429) {
      var retryAfter = parseInt(response.headers.get('retry-after')) || 60;
      console.warn('[Discord] Rate limited. Retry after ' + retryAfter + 's');
      return {
        rateLimited: true,
        retryAfter: retryAfter
      };
    }
    if (!response.ok) {
      console.error('[Discord] Webhook error: ' + response.status + ' ' + response.statusText);
      return false;
    }
    return true;
  })["catch"](function (err) {
    console.error('[Discord] Webhook failed:', err.message || err);
    return false;
  });
}

// ── Per-webhook send queue (respects Discord rate limits) ────────

var webhookQueues = new Map();
var MIN_SEND_INTERVAL_MS = 600;
var MAX_QUEUE_SIZE = 50;
function getQueue(url) {
  var q = webhookQueues.get(url);
  if (!q) {
    q = {
      pending: [],
      timer: null,
      lastSend: 0,
      rateLimitedUntil: 0
    };
    webhookQueues.set(url, q);
  }
  return q;
}
function enqueueSend(rule, msg) {
  var q = getQueue(rule.webhookUrl);

  // Drop messages if queue is too large (we're backed up)
  if (q.pending.length >= MAX_QUEUE_SIZE) {
    return;
  }
  q.pending.push({
    rule: rule,
    msg: msg
  });
  if (!q.timer) {
    var now = Date.now();
    // Respect rate limit backoff
    var rateLimitDelay = Math.max(0, q.rateLimitedUntil - now);
    var elapsed = now - q.lastSend;
    var delay = Math.max(rateLimitDelay, MIN_SEND_INTERVAL_MS - elapsed);
    q.timer = setTimeout(function () {
      processQueue(rule.webhookUrl);
    }, delay);
  }
}
function processQueue(url) {
  var q = webhookQueues.get(url);
  if (!q || q.pending.length === 0) {
    if (q) q.timer = null;
    return;
  }

  // If still rate-limited, reschedule
  var now = Date.now();
  if (q.rateLimitedUntil > now) {
    q.timer = setTimeout(function () {
      processQueue(url);
    }, q.rateLimitedUntil - now + 100);
    return;
  }
  var item = q.pending.shift();
  var body = formatDiscordPayload(item.rule, item.msg);
  q.lastSend = Date.now();
  q.timer = null;
  sendWebhook(url, body).then(function (result) {
    // result is false on rate limit or error, { rateLimited, retryAfter } on rate limit
    if (result && result.rateLimited) {
      var backoffMs = (result.retryAfter || 60) * 1000;
      q.rateLimitedUntil = Date.now() + backoffMs;
      console.warn('[Discord] Backing off for ' + result.retryAfter + 's, dropping ' + q.pending.length + ' queued messages');
      q.pending = []; // Clear queue to stop flooding
      return;
    }
    if (q.pending.length > 0) {
      q.timer = setTimeout(function () {
        processQueue(url);
      }, MIN_SEND_INTERVAL_MS);
    }
  });
}

// ── Deduplication ────────────────────────────────────────────────

var recentWorldMessages = new Map();
var DEDUP_WINDOW_MS = 3000;
function deduplicateKey(msg) {
  // Whispers are private 1:1 messages — never deduplicate them
  if (msg.type === 'WhisperReceived' || msg.type === 'Whisper') {
    return null;
  }
  if (msg.type === 'WorldMessage' || msg.type === 'WorldShout' || msg.type === 'GuildMessage') {
    return 'world:' + msg.text;
  }
  if (msg.type === 'PublicMessage') {
    return 'pub:' + (msg.sender || '') + ':' + msg.text;
  }
  return null;
}
function isDuplicate(msg) {
  var key = deduplicateKey(msg);
  if (!key) return false;
  var now = Date.now();
  var lastSeen = recentWorldMessages.get(key);
  if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) return true;
  recentWorldMessages.set(key, now);
  if (recentWorldMessages.size > 200) {
    var _iterator = _createForOfIteratorHelper(recentWorldMessages),
      _step;
    try {
      for (_iterator.s(); !(_step = _iterator.n()).done;) {
        var entry = _step.value;
        if (now - entry[1] > DEDUP_WINDOW_MS) recentWorldMessages["delete"](entry[0]);
      }
    } catch (err) {
      _iterator.e(err);
    } finally {
      _iterator.f();
    }
  }
  return false;
}

// Periodic TTL sweep (every 60s) to prevent unbounded growth
var _dedupCleanupTimer = setInterval(function () {
  var now = Date.now();
  recentWorldMessages.forEach(function (ts, key) {
    if (now - ts > DEDUP_WINDOW_MS) recentWorldMessages["delete"](key);
  });
}, 60000);
if (_dedupCleanupTimer.unref) _dedupCleanupTimer.unref();

// ── Exports ──────────────────────────────────────────────────────

module.exports = {
  init: function init(_, db) {
    dbRef = db || null;
    console.log('[Discord] Initialized (rules loaded from DB)');
  },
  setRulesFromDB: function setRulesFromDB(rules) {
    config.rules = rules;
  },
  checkAndDispatch: function checkAndDispatch(msg) {
    var enabledRules = config.rules.filter(function (r) {
      return r.enabled;
    });
    if (isDuplicate(msg)) return;
    if (enabledRules.length === 0) return;
    for (var i = 0; i < enabledRules.length; i++) {
      var rule = enabledRules[i];
      if (matchesRule(rule, msg)) {
        enqueueSend(rule, msg);
      }
    }
  },
  getRules: function getRules() {
    return config.rules;
  },
  saveRule: function saveRule(rule) {
    var idx = -1;
    for (var i = 0; i < config.rules.length; i++) {
      if (config.rules[i].id === rule.id) {
        idx = i;
        break;
      }
    }
    if (idx >= 0) {
      config.rules[idx] = rule;
    } else {
      config.rules.push(rule);
    }
    if (dbRef) dbRef.saveDiscordRule(rule);
    return config.rules;
  },
  deleteRule: function deleteRule(id) {
    config.rules = config.rules.filter(function (r) {
      return r.id !== id;
    });
    if (dbRef) dbRef.deleteDiscordRule(id);
    return config.rules;
  },
  toggleRule: function toggleRule(id, enabled) {
    for (var i = 0; i < config.rules.length; i++) {
      if (config.rules[i].id === id) {
        config.rules[i].enabled = enabled;
        if (dbRef) dbRef.saveDiscordRule(config.rules[i]);
        break;
      }
    }
    return config.rules;
  },
  testWebhook: function testWebhook(url, botName) {
    var body = {
      username: botName || 'DASB',
      embeds: [{
        description: 'Webhook test successful! This channel is now connected to DASB.',
        color: 0x34d399,
        timestamp: new Date().toISOString(),
        footer: {
          text: 'Test Message'
        }
      }]
    };
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }).then(function (response) {
      if (!response.ok) {
        return {
          success: false,
          error: 'HTTP ' + response.status + ': ' + response.statusText
        };
      }
      return {
        success: true
      };
    })["catch"](function (err) {
      return {
        success: false,
        error: String(err)
      };
    });
  }
};