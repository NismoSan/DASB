"use strict";

function _createForOfIteratorHelper(r, e) { var t = "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (!t) { if (Array.isArray(r) || (t = _unsupportedIterableToArray(r)) || e && r && "number" == typeof r.length) { t && (r = t); var _n = 0, F = function F() {}; return { s: F, n: function n() { return _n >= r.length ? { done: !0 } : { done: !1, value: r[_n++] }; }, e: function e(r) { throw r; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var o, a = !0, u = !1; return { s: function s() { t = t.call(r); }, n: function n() { var r = t.next(); return a = r.done, r; }, e: function e(r) { u = !0, o = r; }, f: function f() { try { a || null == t["return"] || t["return"](); } finally { if (u) throw o; } } }; }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
// ── AE (Aisling Exchange) Ingest Module ──────────────────────────
// Handles world shout batching, whisper forwarding for site
// verification, and local shout file logging.
// Ported from tracker's aeIngest.ts for use without Electron.

// ── State ────────────────────────────────────────────────────────

var config = {
  enabled: false,
  apiUrl: '',
  apiKey: ''
};

// ── Deduplication ────────────────────────────────────────────────

var recentShouts = new Map();
var DEDUP_WINDOW_MS = 3000;
function isDuplicate(text) {
  var now = Date.now();
  var last = recentShouts.get(text);
  if (last && now - last < DEDUP_WINDOW_MS) return true;
  recentShouts.set(text, now);
  if (recentShouts.size > 200) {
    var _iterator = _createForOfIteratorHelper(recentShouts),
      _step;
    try {
      for (_iterator.s(); !(_step = _iterator.n()).done;) {
        var entry = _step.value;
        if (now - entry[1] > DEDUP_WINDOW_MS) recentShouts["delete"](entry[0]);
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
  recentShouts.forEach(function (ts, key) {
    if (now - ts > DEDUP_WINDOW_MS) recentShouts["delete"](key);
  });
}, 60000);
if (_dedupCleanupTimer.unref) _dedupCleanupTimer.unref();

// ── Batch queue ──────────────────────────────────────────────────

var pendingBatch = [];
var batchTimer = null;
var BATCH_DELAY_MS = 2000;
var MAX_BATCH_SIZE = 25;
function scheduleBatchFlush() {
  if (batchTimer) return;
  batchTimer = setTimeout(function () {
    batchTimer = null;
    flushBatch();
  }, BATCH_DELAY_MS);
}
function flushBatch() {
  if (pendingBatch.length === 0) return;
  var batch = pendingBatch.splice(0, MAX_BATCH_SIZE);
  var remaining = pendingBatch.length;
  sendBatch(batch, 1).then(function () {
    console.log('[AE Ingest] Sent ' + batch.length + ' shouts');
  })["catch"](function (err) {
    console.error('[AE Ingest] Batch send failed, requeueing:', err.message || err);
    pendingBatch.unshift.apply(pendingBatch, batch);
    setTimeout(function () {
      flushBatch();
    }, 5000);
  }).then(function () {
    if (remaining > 0) scheduleBatchFlush();
  });
}

// ── HTTP send ────────────────────────────────────────────────────

var MAX_RETRIES = 3;
function sendBatch(shouts, attempt) {
  if (!config.apiUrl || !config.apiKey) {
    return Promise.reject(new Error('AE Ingest not configured'));
  }
  var url = config.apiUrl.replace(/\/+$/, '') + '/batch';
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-ingest-key': config.apiKey
    },
    body: JSON.stringify({
      shouts: shouts
    })
  }).then(function (response) {
    if (response.status === 429 && attempt < MAX_RETRIES) {
      var retryAfter = parseInt(response.headers.get('retry-after') || '2', 10);
      console.warn('[AE Ingest] Rate limited, retrying in ' + retryAfter + 's');
      return new Promise(function (resolve) {
        setTimeout(resolve, retryAfter * 1000);
      }).then(function () {
        return sendBatch(shouts, attempt + 1);
      });
    }
    if (!response.ok) {
      return response.text()["catch"](function () {
        return '';
      }).then(function (body) {
        throw new Error('HTTP ' + response.status + ': ' + body);
      });
    }
  });
}

// ── Parse helpers ────────────────────────────────────────────────

function parsePlayerName(text) {
  var match = text.match(/^\[(.+?)\]:\s*([\s\S]*)$/);
  if (match) return {
    playerName: match[1],
    message: match[2]
  };
  return {
    playerName: 'Unknown',
    message: text
  };
}

// ── Exports ──────────────────────────────────────────────────────

module.exports = {
  init: function init() {
    console.log('[AE Ingest] Initialized (enabled=' + config.enabled + ')');
  },
  setConfigFromDB: function setConfigFromDB(aeConfig) {
    if (aeConfig) {
      config.enabled = !!aeConfig.enabled;
      config.apiUrl = aeConfig.apiUrl || '';
      config.apiKey = aeConfig.apiKey || '';
    }
  },
  enqueueWorldShout: function enqueueWorldShout(text) {
    console.log('[AE Ingest] enqueueWorldShout called: "' + text.substring(0, 60) + '"');
    if (!config.enabled || !config.apiUrl || !config.apiKey) {
      console.log('[AE Ingest] Skipped — enabled=' + config.enabled + ' url=' + !!config.apiUrl + ' key=' + !!config.apiKey);
      return;
    }
    if (isDuplicate(text)) {
      console.log('[AE Ingest] Skipped — duplicate');
      return;
    }
    var parsed = parsePlayerName(text);
    console.log('[AE Ingest] Queued: playerName=' + parsed.playerName + ', batchSize=' + (pendingBatch.length + 1));
    pendingBatch.push({
      playerName: parsed.playerName,
      message: text,
      timestamp: new Date().toISOString()
    });
    if (pendingBatch.length >= MAX_BATCH_SIZE) {
      if (batchTimer) {
        clearTimeout(batchTimer);
        batchTimer = null;
      }
      flushBatch();
    } else {
      scheduleBatchFlush();
    }
  },
  forwardWhisper: function forwardWhisper(fromPlayer, toPlayer, message) {
    if (!config.enabled || !config.apiUrl || !config.apiKey) return;
    var base = config.apiUrl.replace(/\/+$/, '').replace(/\/shouts.*$/, '').replace(/\/batch.*$/, '');
    var url = base + '/auth/whisper-ingest';
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ingest-key': config.apiKey
      },
      body: JSON.stringify({
        from_player: fromPlayer,
        to_player: toPlayer,
        message: message,
        timestamp: new Date().toISOString()
      })
    }).then(function (res) {
      if (!res.ok) {
        res.text().then(function (t) {
          console.error('[AE Ingest] Whisper forward failed: HTTP ' + res.status + ': ' + t);
        });
      } else {
        console.log('[AE Ingest] Whisper forwarded: ' + fromPlayer + ' -> ' + toPlayer);
      }
    })["catch"](function (err) {
      console.error('[AE Ingest] Whisper forward error:', err.message || err);
    });
  },
  getConfig: function getConfig() {
    return {
      enabled: config.enabled,
      apiUrl: config.apiUrl,
      hasKey: !!config.apiKey
    };
  },
  saveConfig: function saveConfig(update) {
    config.enabled = update.enabled;
    config.apiUrl = update.apiUrl;
    if (update.apiKey && update.apiKey !== '__keep__') {
      config.apiKey = update.apiKey;
    }
    return module.exports.getConfig();
  },
  testConnection: function testConnection() {
    if (!config.apiUrl || !config.apiKey) {
      return Promise.resolve({
        success: false,
        error: 'URL and Ingest API Key are required'
      });
    }
    var url = config.apiUrl.replace(/\/+$/, '');
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ingest-key': config.apiKey
      },
      body: JSON.stringify({
        playerName: '__test__',
        message: '[DASB]: Connection test — this shout can be ignored',
        timestamp: new Date().toISOString()
      })
    }).then(function (response) {
      if (response.ok) {
        return {
          success: true
        };
      }
      return response.text()["catch"](function () {
        return '';
      }).then(function (body) {
        return {
          success: false,
          error: 'HTTP ' + response.status + ': ' + body
        };
      });
    })["catch"](function (err) {
      return {
        success: false,
        error: String(err)
      };
    });
  }
};