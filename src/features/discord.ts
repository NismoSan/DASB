// ── Discord Webhook Integration ──────────────────────────────────
// Dispatches decoded chat messages to Discord channels via webhooks,
// based on user-configured rules with message type and regex matching.
// Ported from tracker's discord.ts for use without Electron.

import { DiscordRule, DiscordMessage } from '../types';

// ── State ────────────────────────────────────────────────────────

const config: { rules: DiscordRule[] } = { rules: [] };
let dbRef: any = null;

// ── Rule matching ────────────────────────────────────────────────

const WORLD_SUBTYPES: Record<string, boolean> = { WorldMessage: true, WorldShout: true, WhisperReceived: true, GuildMessage: true };

function matchesRule(rule: DiscordRule, msg: DiscordMessage): boolean {
  if (!rule.enabled) return false;

  const types = rule.messageTypes || [];
  const typeMatch =
    types.indexOf('Any') !== -1 ||
    types.indexOf(msg.type) !== -1 ||
    (WORLD_SUBTYPES[msg.type] && types.indexOf('WorldMessage (All)') !== -1);

  if (!typeMatch) return false;

  if (rule.pattern) {
    try {
      const re = new RegExp(rule.pattern, 'i');
      if (!re.test(msg.text)) return false;
    } catch (e) {
      return false;
    }
  }

  return true;
}

// ── Discord embed formatting ─────────────────────────────────────

const COLOR_MAP: Record<string, number> = {
  WorldMessage: 0xd4a440,
  WorldShout: 0xfbbf24,
  WhisperReceived: 0xf472b6,
  GuildMessage: 0xa78bfa,
  PublicMessage: 0x60a5fa,
  Say: 0x34d399,
  Whisper: 0xf472b6
};

function parseWhisperText(text: string): { sender: string; message: string } {
  const m = text.match(/^"?([A-Za-z][^"]*)"\s*([\s\S]*)$/);
  if (m) return { sender: m[1], message: m[2] };
  return { sender: 'Unknown', message: text };
}

function formatDiscordPayload(rule: DiscordRule, msg: DiscordMessage): any {
  const timestamp = new Date().toISOString();
  const isWhisperType = msg.type === 'WhisperReceived';

  // Incoming whisper embeds: show From / To / Message
  if (isWhisperType) {
    const parsed = parseWhisperText(msg.text);
    const recipient = msg.characterName || 'Unknown';

    return {
      username: rule.botName || 'DASB',
      avatar_url: rule.botAvatar || undefined,
      embeds: [{
        color: 0xf472b6,
        author: { name: 'Whisper Received' },
        fields: [
          { name: 'From', value: '**' + parsed.sender + '**', inline: true },
          { name: 'To', value: '**' + recipient + '**', inline: true }
        ],
        description: '>>> ' + parsed.message,
        timestamp: timestamp,
        footer: { text: 'Whisper' }
      }]
    };
  }

  // Outgoing whisper: show who sent it and who it's going to
  if (msg.type === 'Whisper' && msg.target) {
    const sender = msg.characterName || 'Unknown';

    return {
      username: rule.botName || 'DASB',
      avatar_url: rule.botAvatar || undefined,
      embeds: [{
        color: 0xc084fc,
        author: { name: 'Whisper Sent' },
        fields: [
          { name: 'From', value: '**' + sender + '**', inline: true },
          { name: 'To', value: '**' + msg.target + '**', inline: true }
        ],
        description: '>>> ' + msg.text,
        timestamp: timestamp,
        footer: { text: 'Whisper' }
      }]
    };
  }

  // All other message types
  const footerText = msg.type === 'GuildMessage' ? 'Guild Chat'
    : msg.type === 'WorldMessage' ? 'World Message'
    : msg.type === 'WorldShout' ? 'World Shout'
    : msg.type === 'PublicMessage' ? 'Local Chat'
    : msg.type;

  return {
    username: rule.botName || 'DASB',
    avatar_url: rule.botAvatar || undefined,
    embeds: [{
      description: msg.text,
      color: COLOR_MAP[msg.type] || 0xd4a440,
      timestamp: timestamp,
      footer: { text: footerText }
    }]
  };
}

// ── Webhook send with rate-limit awareness ───────────────────────

function sendWebhook(url: string, body: any): Promise<any> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
    .then(function (response: Response) {
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('retry-after') as string) || 60;
        console.warn('[Discord] Rate limited. Retry after ' + retryAfter + 's');
        return { rateLimited: true, retryAfter: retryAfter };
      }
      if (!response.ok) {
        console.error('[Discord] Webhook error: ' + response.status + ' ' + response.statusText);
        return false;
      }
      return true;
    })
    .catch(function (err: any) {
      console.error('[Discord] Webhook failed:', err.message || err);
      return false;
    });
}

// ── Per-webhook send queue (respects Discord rate limits) ────────

interface WebhookQueue {
  pending: { rule: DiscordRule; msg: DiscordMessage }[];
  timer: ReturnType<typeof setTimeout> | null;
  lastSend: number;
  rateLimitedUntil: number;
}

const webhookQueues: Map<string, WebhookQueue> = new Map();
const MIN_SEND_INTERVAL_MS = 600;
const MAX_QUEUE_SIZE = 50;

function getQueue(url: string): WebhookQueue {
  let q = webhookQueues.get(url);
  if (!q) {
    q = { pending: [], timer: null, lastSend: 0, rateLimitedUntil: 0 };
    webhookQueues.set(url, q);
  }
  return q;
}

function enqueueSend(rule: DiscordRule, msg: DiscordMessage): void {
  const q = getQueue(rule.webhookUrl);

  // Drop messages if queue is too large (we're backed up)
  if (q.pending.length >= MAX_QUEUE_SIZE) {
    return;
  }

  q.pending.push({ rule: rule, msg: msg });

  if (!q.timer) {
    const now = Date.now();
    // Respect rate limit backoff
    const rateLimitDelay = Math.max(0, q.rateLimitedUntil - now);
    const elapsed = now - q.lastSend;
    const delay = Math.max(rateLimitDelay, MIN_SEND_INTERVAL_MS - elapsed);
    q.timer = setTimeout(function () { processQueue(rule.webhookUrl); }, delay);
  }
}

function processQueue(url: string): void {
  const q = webhookQueues.get(url);
  if (!q || q.pending.length === 0) {
    if (q) q.timer = null;
    return;
  }

  // If still rate-limited, reschedule
  const now = Date.now();
  if (q.rateLimitedUntil > now) {
    q.timer = setTimeout(function () { processQueue(url); }, q.rateLimitedUntil - now + 100);
    return;
  }

  const item = q.pending.shift()!;
  const body = formatDiscordPayload(item.rule, item.msg);
  q.lastSend = Date.now();
  q.timer = null;

  sendWebhook(url, body).then(function (result: any) {
    // result is false on rate limit or error, { rateLimited, retryAfter } on rate limit
    if (result && result.rateLimited) {
      const backoffMs = (result.retryAfter || 60) * 1000;
      q.rateLimitedUntil = Date.now() + backoffMs;
      console.warn('[Discord] Backing off for ' + result.retryAfter + 's, dropping ' + q.pending.length + ' queued messages');
      q.pending = []; // Clear queue to stop flooding
      return;
    }
    if (q.pending.length > 0) {
      q.timer = setTimeout(function () { processQueue(url); }, MIN_SEND_INTERVAL_MS);
    }
  });
}

// ── Deduplication ────────────────────────────────────────────────

const recentWorldMessages: Map<string, number> = new Map();
const DEDUP_WINDOW_MS = 3000;

function deduplicateKey(msg: DiscordMessage): string | null {
  // Whispers are private 1:1 messages — never deduplicate them
  if (msg.type === 'WhisperReceived' || msg.type === 'Whisper') {
    return null;
  }
  if (msg.type === 'WorldMessage' || msg.type === 'WorldShout' ||
      msg.type === 'GuildMessage') {
    return 'world:' + msg.text;
  }
  if (msg.type === 'PublicMessage') {
    return 'pub:' + (msg.sender || '') + ':' + msg.text;
  }
  return null;
}

function isDuplicate(msg: DiscordMessage): boolean {
  const key = deduplicateKey(msg);
  if (!key) return false;

  const now = Date.now();
  const lastSeen = recentWorldMessages.get(key);
  if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) return true;
  recentWorldMessages.set(key, now);

  if (recentWorldMessages.size > 200) {
    for (const entry of recentWorldMessages) {
      if (now - entry[1] > DEDUP_WINDOW_MS) recentWorldMessages.delete(entry[0]);
    }
  }
  return false;
}

// Periodic TTL sweep (every 60s) to prevent unbounded growth
const _dedupCleanupTimer = setInterval(function () {
  const now = Date.now();
  recentWorldMessages.forEach(function (ts: number, key: string) {
    if (now - ts > DEDUP_WINDOW_MS) recentWorldMessages.delete(key);
  });
}, 60000);
if (_dedupCleanupTimer.unref) _dedupCleanupTimer.unref();

// ── Exports ──────────────────────────────────────────────────────

export function init(_: any, db: any): void {
  dbRef = db || null;
  console.log('[Discord] Initialized (rules loaded from DB)');
}

export function setRulesFromDB(rules: DiscordRule[]): void {
  config.rules = rules;
}

export function checkAndDispatch(msg: DiscordMessage): void {
  const enabledRules = config.rules.filter(function (r: DiscordRule) { return r.enabled; });

  if (isDuplicate(msg)) return;

  if (enabledRules.length === 0) return;

  for (let i = 0; i < enabledRules.length; i++) {
    const rule = enabledRules[i];
    if (matchesRule(rule, msg)) {
      enqueueSend(rule, msg);
    }
  }
}

export function getRules(): DiscordRule[] {
  return config.rules;
}

export function saveRule(rule: DiscordRule): DiscordRule[] {
  let idx = -1;
  for (let i = 0; i < config.rules.length; i++) {
    if (config.rules[i].id === rule.id) { idx = i; break; }
  }
  if (idx >= 0) {
    config.rules[idx] = rule;
  } else {
    config.rules.push(rule);
  }
  if (dbRef) dbRef.saveDiscordRule(rule);
  return config.rules;
}

export function deleteRule(id: string): DiscordRule[] {
  config.rules = config.rules.filter(function (r: DiscordRule) { return r.id !== id; });
  if (dbRef) dbRef.deleteDiscordRule(id);
  return config.rules;
}

export function toggleRule(id: string, enabled: boolean): DiscordRule[] {
  for (let i = 0; i < config.rules.length; i++) {
    if (config.rules[i].id === id) {
      config.rules[i].enabled = enabled;
      if (dbRef) dbRef.saveDiscordRule(config.rules[i]);
      break;
    }
  }
  return config.rules;
}

export function testWebhook(url: string, botName?: string): Promise<{ success: boolean; error?: string }> {
  const body = {
    username: botName || 'DASB',
    embeds: [{
      description: 'Webhook test successful! This channel is now connected to DASB.',
      color: 0x34d399,
      timestamp: new Date().toISOString(),
      footer: { text: 'Test Message' }
    }]
  };

  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
    .then(function (response: Response) {
      if (!response.ok) {
        return { success: false, error: 'HTTP ' + response.status + ': ' + response.statusText };
      }
      return { success: true };
    })
    .catch(function (err: any) {
      return { success: false, error: String(err) };
    });
}
