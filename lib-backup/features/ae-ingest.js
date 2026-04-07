"use strict";
// ── AE (Aisling Exchange) Ingest Module ──────────────────────────
// Handles world shout batching, whisper forwarding for site
// verification, and local shout file logging.
// Ported from tracker's aeIngest.ts for use without Electron.
Object.defineProperty(exports, "__esModule", { value: true });
exports.init = init;
exports.setConfigFromDB = setConfigFromDB;
exports.enqueueWorldShout = enqueueWorldShout;
exports.forwardWhisper = forwardWhisper;
exports.getConfig = getConfig;
exports.saveConfig = saveConfig;
exports.testConnection = testConnection;
// ── State ────────────────────────────────────────────────────────
const config = { enabled: false, apiUrl: '', apiKey: '' };
// ── Deduplication ────────────────────────────────────────────────
const recentShouts = new Map();
const DEDUP_WINDOW_MS = 3000;
function isDuplicate(text) {
    const now = Date.now();
    const last = recentShouts.get(text);
    if (last && now - last < DEDUP_WINDOW_MS)
        return true;
    recentShouts.set(text, now);
    if (recentShouts.size > 200) {
        for (const entry of recentShouts) {
            if (now - entry[1] > DEDUP_WINDOW_MS)
                recentShouts.delete(entry[0]);
        }
    }
    return false;
}
// Periodic TTL sweep (every 60s) to prevent unbounded growth
const _dedupCleanupTimer = setInterval(function () {
    const now = Date.now();
    recentShouts.forEach(function (ts, key) {
        if (now - ts > DEDUP_WINDOW_MS)
            recentShouts.delete(key);
    });
}, 60000);
if (_dedupCleanupTimer.unref)
    _dedupCleanupTimer.unref();
// ── Batch queue ──────────────────────────────────────────────────
let pendingBatch = [];
let batchTimer = null;
const BATCH_DELAY_MS = 2000;
const MAX_BATCH_SIZE = 25;
function scheduleBatchFlush() {
    if (batchTimer)
        return;
    batchTimer = setTimeout(function () {
        batchTimer = null;
        flushBatch();
    }, BATCH_DELAY_MS);
}
function flushBatch() {
    if (pendingBatch.length === 0)
        return;
    const batch = pendingBatch.splice(0, MAX_BATCH_SIZE);
    const remaining = pendingBatch.length;
    sendBatch(batch, 1)
        .then(function () {
        console.log('[AE Ingest] Sent ' + batch.length + ' shouts');
    })
        .catch(function (err) {
        console.error('[AE Ingest] Batch send failed, requeueing:', err.message || err);
        pendingBatch.unshift.apply(pendingBatch, batch);
        setTimeout(function () { flushBatch(); }, 5000);
    })
        .then(function () {
        if (remaining > 0)
            scheduleBatchFlush();
    });
}
// ── HTTP send ────────────────────────────────────────────────────
const MAX_RETRIES = 3;
function sendBatch(shouts, attempt) {
    if (!config.apiUrl || !config.apiKey) {
        return Promise.reject(new Error('AE Ingest not configured'));
    }
    const url = config.apiUrl.replace(/\/+$/, '') + '/batch';
    return fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-ingest-key': config.apiKey
        },
        body: JSON.stringify({ shouts: shouts })
    }).then(function (response) {
        if (response.status === 429 && attempt < MAX_RETRIES) {
            const retryAfter = parseInt(response.headers.get('retry-after') || '2', 10);
            console.warn('[AE Ingest] Rate limited, retrying in ' + retryAfter + 's');
            return new Promise(function (resolve) {
                setTimeout(resolve, retryAfter * 1000);
            }).then(function () {
                return sendBatch(shouts, attempt + 1);
            });
        }
        if (!response.ok) {
            return response.text().catch(function () { return ''; }).then(function (body) {
                throw new Error('HTTP ' + response.status + ': ' + body);
            });
        }
    });
}
// ── Parse helpers ────────────────────────────────────────────────
function parsePlayerName(text) {
    const match = text.match(/^\[(.+?)\]:\s*([\s\S]*)$/);
    if (match)
        return { playerName: match[1], message: match[2] };
    return { playerName: 'Unknown', message: text };
}
// ── Exports ──────────────────────────────────────────────────────
function init() {
    console.log('[AE Ingest] Initialized (enabled=' + config.enabled + ')');
}
function setConfigFromDB(aeConfig) {
    if (aeConfig) {
        config.enabled = !!aeConfig.enabled;
        config.apiUrl = aeConfig.apiUrl || '';
        config.apiKey = aeConfig.apiKey || '';
    }
}
function enqueueWorldShout(text) {
    console.log('[AE Ingest] enqueueWorldShout called: "' + text.substring(0, 60) + '"');
    if (!config.enabled || !config.apiUrl || !config.apiKey) {
        console.log('[AE Ingest] Skipped — enabled=' + config.enabled + ' url=' + !!config.apiUrl + ' key=' + !!config.apiKey);
        return;
    }
    if (isDuplicate(text)) {
        console.log('[AE Ingest] Skipped — duplicate');
        return;
    }
    const parsed = parsePlayerName(text);
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
    }
    else {
        scheduleBatchFlush();
    }
}
function forwardWhisper(fromPlayer, toPlayer, message) {
    if (!config.enabled || !config.apiUrl || !config.apiKey)
        return;
    const base = config.apiUrl.replace(/\/+$/, '').replace(/\/shouts.*$/, '').replace(/\/batch.*$/, '');
    const url = base + '/auth/whisper-ingest';
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
    })
        .then(function (res) {
        if (!res.ok) {
            res.text().then(function (t) {
                console.error('[AE Ingest] Whisper forward failed: HTTP ' + res.status + ': ' + t);
            });
        }
        else {
            console.log('[AE Ingest] Whisper forwarded: ' + fromPlayer + ' -> ' + toPlayer);
        }
    })
        .catch(function (err) {
        console.error('[AE Ingest] Whisper forward error:', err.message || err);
    });
}
function getConfig() {
    return {
        enabled: config.enabled,
        apiUrl: config.apiUrl,
        hasKey: !!config.apiKey
    };
}
function saveConfig(update) {
    config.enabled = update.enabled;
    config.apiUrl = update.apiUrl;
    if (update.apiKey && update.apiKey !== '__keep__') {
        config.apiKey = update.apiKey;
    }
    return getConfig();
}
function testConnection() {
    if (!config.apiUrl || !config.apiKey) {
        return Promise.resolve({ success: false, error: 'URL and Ingest API Key are required' });
    }
    const url = config.apiUrl.replace(/\/+$/, '');
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
    })
        .then(function (response) {
        if (response.ok) {
            return { success: true };
        }
        return response.text().catch(function () { return ''; }).then(function (body) {
            return { success: false, error: 'HTTP ' + response.status + ': ' + body };
        });
    })
        .catch(function (err) {
        return { success: false, error: String(err) };
    });
}
//# sourceMappingURL=ae-ingest.js.map