// ── Trade Sessions Module ─────────────────────────────────────────
// Handles whisper-to-buy flow: sends whisper to seller, tracks
// response (Yes/No), detects offline, broadcasts status via SSE.

// ── State ─────────────────────────────────────────────────────────

interface TradeSession {
  id: string;
  buyerUsername: string;
  sellerUsername: string;
  itemName: string;
  listingId: string;
  listingType: string;
  status: string;
  statusMessage: string;
  createdAt: number;
  updatedAt: number;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
  offlineTimer: ReturnType<typeof setTimeout> | null;
  sellerAlts: string[];
  currentAltIndex: number;
  currentWhisperTarget: string;
}

interface SessionSnapshot {
  sessionId: string;
  buyerUsername: string;
  sellerUsername: string;
  itemName: string;
  listingId: string;
  status: string;
  statusMessage: string;
  createdAt: number;
  updatedAt: number;
  currentWhisperTarget: string;
  altCheckProgress: { current: number; total: number } | null;
}

const tradeSessions: Map<string, TradeSession> = new Map();   // sessionId -> session
const pendingWhispers: Map<string, string> = new Map(); // sellerName.toLowerCase() -> sessionId
const sseClients: Map<string, Set<any>> = new Map();      // sessionId -> Set<res>
const buyerCooldowns: Map<string, number> = new Map();  // buyerUsername.toLowerCase() -> timestamp

// Dependencies (injected via init)
let sendWhisperFn: ((target: string, text: string) => void) | null = null;
let ioRef: any = null;
let getBotUsernameFn: (() => string) | null = null;

// Constants
const SESSION_TIMEOUT_MS = 60 * 1000;
const OFFLINE_DETECT_WINDOW_MS = 3 * 1000;
const SESSION_CLEANUP_MS = 5 * 60 * 1000;
const TERMINAL_RETAIN_MS = 2 * 60 * 1000;
const MAX_CONCURRENT_SESSIONS = 20;
const BUYER_COOLDOWN_MS = 15 * 1000;
const WHISPER_MAX = 64;

function splitAndSendWhisper(target: string, text: string): void {
  if (!sendWhisperFn) return;
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= WHISPER_MAX) {
      chunks.push(remaining);
      break;
    }
    const slice = remaining.substring(0, WHISPER_MAX);
    const lastSpace = slice.lastIndexOf(' ');
    if (lastSpace > WHISPER_MAX * 0.3) {
      chunks.push(remaining.substring(0, lastSpace));
      remaining = remaining.substring(lastSpace + 1);
    } else {
      chunks.push(slice);
      remaining = remaining.substring(WHISPER_MAX);
    }
  }
  chunks.forEach(function (chunk: string, i: number) {
    setTimeout(function () {
      sendWhisperFn!(target, chunk);
    }, i * 500);
  });
}

// ── Alt Character Fallback ────────────────────────────────────────

function tryNextAlt(session: TradeSession): void {
  session.currentAltIndex++;
  const altName = session.sellerAlts[session.currentAltIndex];
  session.currentWhisperTarget = altName;

  // Register this alt in pendingWhispers so offline/response detection works
  const altKey = altName.toLowerCase();
  pendingWhispers.set(altKey, session.id);

  // Update status to checking_alts
  const altNum = session.currentAltIndex + 1;
  const altTotal = session.sellerAlts.length;
  updateSession(session, 'checking_alts',
    'Checking alt characters... (' + altNum + '/' + altTotal + ') Trying ' + altName + '...');

  // Build and send the whisper to this alt
  let whisperMsg: string;
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
      updateSession(session, 'waiting_response',
        altName + ' (alt of ' + session.sellerUsername + ') is online! Waiting for response...');
    }
  }, OFFLINE_DETECT_WINDOW_MS);

  console.log('[Trade Sessions] Session ' + session.id + ': trying alt ' + altName + ' (' + altNum + '/' + altTotal + ')');
}

// ── Helpers ───────────────────────────────────────────────────────

function generateId(): string {
  return 'ts_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function isTerminal(status: string): boolean {
  return status === 'confirmed' || status === 'declined' ||
         status === 'offline' || status === 'no_reply' || status === 'error';
}

function sessionSnapshot(session: TradeSession): SessionSnapshot {
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
    altCheckProgress: session.sellerAlts && session.sellerAlts.length > 0
      ? { current: session.currentAltIndex + 1, total: session.sellerAlts.length }
      : null
  };
}

function updateSession(session: TradeSession, status: string, statusMessage: string): void {
  session.status = status;
  session.statusMessage = statusMessage;
  session.updatedAt = Date.now();
  broadcastStatus(session.id);

  if (isTerminal(status)) {
    cleanupTimers(session);
    // Remove primary seller from pendingWhispers
    const sellerKey = session.sellerUsername.toLowerCase();
    if (pendingWhispers.get(sellerKey) === session.id) {
      pendingWhispers.delete(sellerKey);
    }
    // Remove current alt target from pendingWhispers
    if (session.currentWhisperTarget) {
      const targetKey = session.currentWhisperTarget.toLowerCase();
      if (targetKey !== sellerKey && pendingWhispers.get(targetKey) === session.id) {
        pendingWhispers.delete(targetKey);
      }
    }
    // Schedule removal
    setTimeout(function () {
      tradeSessions.delete(session.id);
      closeSSEClients(session.id);
      sseClients.delete(session.id);
    }, TERMINAL_RETAIN_MS);
  }
}

function cleanupTimers(session: TradeSession): void {
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

function broadcastStatus(sessionId: string): void {
  const session = tradeSessions.get(sessionId);
  if (!session) return;

  const clients = sseClients.get(sessionId);
  if (!clients || clients.size === 0) return;

  const data = 'data: ' + JSON.stringify(sessionSnapshot(session)) + '\n\n';

  clients.forEach(function (res: any) {
    try {
      res.write(data);
      if (typeof res.flush === 'function') res.flush();
    } catch (err) {
      // Client disconnected
      clients.delete(res);
    }
  });
}

function closeSSEClients(sessionId: string): void {
  const clients = sseClients.get(sessionId);
  if (!clients) return;
  clients.forEach(function (res: any) {
    try { res.end(); } catch (e) { /* ignore */ }
  });
  clients.clear();
}

// ── Periodic Cleanup ──────────────────────────────────────────────

setInterval(function () {
  const now = Date.now();
  tradeSessions.forEach(function (session: TradeSession, id: string) {
    // Remove stale terminal sessions
    if (isTerminal(session.status) && now - session.updatedAt > TERMINAL_RETAIN_MS) {
      tradeSessions.delete(id);
      closeSSEClients(id);
      sseClients.delete(id);
    }
    // Force-expire sessions that somehow exceed 5 minutes
    if (!isTerminal(session.status) && now - session.createdAt > 5 * 60 * 1000) {
      updateSession(session, 'error', 'Session expired.');
    }
  });

  // Clean old buyer cooldowns
  buyerCooldowns.forEach(function (ts: number, key: string) {
    if (now - ts > BUYER_COOLDOWN_MS * 2) {
      buyerCooldowns.delete(key);
    }
  });
}, SESSION_CLEANUP_MS);

// ── Exports ───────────────────────────────────────────────────────

export function init(deps: { sendWhisper: (target: string, text: string) => void; io: any; getBotUsername: () => string }): void {
  sendWhisperFn = deps.sendWhisper;
  ioRef = deps.io;
  getBotUsernameFn = deps.getBotUsername;
  console.log('[Trade Sessions] Initialized');
}

export function createSession(opts: {
  buyerUsername: string;
  sellerUsername: string;
  itemName: string;
  listingId: string;
  listingType?: string;
  sellerAlts?: string[];
}): { sessionId: string } | { error: string } {
  const buyerUsername = opts.buyerUsername;
  const sellerUsername = opts.sellerUsername;
  const itemName = opts.itemName;
  const listingId = opts.listingId;
  const listingType = opts.listingType || 'SELL'; // SELL = clicker is buying, BUY = clicker is selling

  if (!buyerUsername || !sellerUsername || !itemName) {
    return { error: 'Missing required fields.' };
  }

  // Check bot is online
  const botName = getBotUsernameFn ? getBotUsernameFn() : '';
  if (!botName) {
    return { error: 'Bot is not online. Please try again later.' };
  }

  // Rate limit per buyer
  const buyerKey = buyerUsername.toLowerCase();
  const lastWhisper = buyerCooldowns.get(buyerKey);
  if (lastWhisper && Date.now() - lastWhisper < BUYER_COOLDOWN_MS) {
    const wait = Math.ceil((BUYER_COOLDOWN_MS - (Date.now() - lastWhisper)) / 1000);
    return { error: 'Please wait ' + wait + ' seconds before sending another whisper.' };
  }

  // One active session per seller
  const sellerKey = sellerUsername.toLowerCase();
  if (pendingWhispers.has(sellerKey)) {
    const existingId = pendingWhispers.get(sellerKey)!;
    const existing = tradeSessions.get(existingId);
    if (existing && !isTerminal(existing.status)) {
      return { error: 'Someone is already contacting this seller. Please try again in a moment.' };
    }
  }

  // Max concurrent sessions
  let activeCount = 0;
  tradeSessions.forEach(function (s: TradeSession) {
    if (!isTerminal(s.status)) activeCount++;
  });
  if (activeCount >= MAX_CONCURRENT_SESSIONS) {
    return { error: 'Too many active trade requests. Please try again shortly.' };
  }

  // Create session
  const sessionId = generateId();
  const now = Date.now();

  const session: TradeSession = {
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
  let whisperMsg: string;
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

  return { sessionId: sessionId };
}

export function handleIncomingWhisper(senderName: string, message: string): boolean {
  const senderKey = senderName.toLowerCase();
  const sessionId = pendingWhispers.get(senderKey);
  if (!sessionId) return false;

  const session = tradeSessions.get(sessionId);
  if (!session || isTerminal(session.status)) return false;

  const trimmed = message.trim().toLowerCase();

  // Determine if the responder is an alt character
  const responderName = senderName;
  const isAlt = session.currentWhisperTarget.toLowerCase() === senderKey
                && senderKey !== session.sellerUsername.toLowerCase();
  const displayName = isAlt
    ? responderName + ' (alt of ' + session.sellerUsername + ')'
    : session.sellerUsername;

  // Check for Yes
  if (trimmed === 'yes' || trimmed === 'y' || trimmed === 'yeah' || trimmed === 'yep' || trimmed === 'sure') {
    const isBuyListing = session.listingType === 'BUY';
    // Status message shown in the modal to the clicker
    const confirmMsg = isBuyListing
      ? displayName + ' wants to buy your ' + session.itemName + '! Reach out to them in-game.'
      : displayName + ' is interested in selling ' + session.itemName + '! Reach out to them in-game.';
    updateSession(session, 'confirmed', confirmMsg);

    // Whisper the clicker (buyerUsername) in-game — use actual responder name
    const buyerMsg = isBuyListing
      ? responderName + ' wants to buy your ' + session.itemName + '! Whisper them in-game.'
      : responderName + ' wants to sell you ' + session.itemName + '! Whisper them in-game.';
    splitAndSendWhisper(session.buyerUsername, buyerMsg);

    // Also whisper the responder a confirmation
    const posterMsg = isBuyListing
      ? 'Great! ' + session.buyerUsername + ' will sell you ' + session.itemName + '. They will reach out to you shortly.'
      : 'Great! ' + session.buyerUsername + ' will buy your ' + session.itemName + '. They will reach out to you shortly.';
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
}

export function handleSystemMessage(messageRaw: string): void {
  if (!messageRaw) return;

  // Match "PlayerName is nowhere to be found" pattern
  const offlineMatch = messageRaw.match(/(.+?)\s+is nowhere to be found/i);
  if (!offlineMatch) return;

  const offlineName = offlineMatch[1].replace(/^"/, '').replace(/"$/, '').trim();
  const nameKey = offlineName.toLowerCase();
  const sessionId = pendingWhispers.get(nameKey);
  if (!sessionId) return;

  const session = tradeSessions.get(sessionId);
  if (!session || isTerminal(session.status)) return;

  // Only process if this offline message is for the character we're currently trying
  if (session.currentWhisperTarget.toLowerCase() !== nameKey) return;

  // Clear the offline detection timer since we got a definitive answer
  if (session.offlineTimer) {
    clearTimeout(session.offlineTimer);
    session.offlineTimer = null;
  }

  // Remove this name from pendingWhispers
  pendingWhispers.delete(nameKey);

  // Check if there are more alts to try
  if (session.sellerAlts.length > 0 && session.currentAltIndex < session.sellerAlts.length - 1) {
    tryNextAlt(session);
  } else {
    // No more alts — terminal offline
    const msg = session.sellerAlts.length > 0
      ? 'No available characters online for ' + session.sellerUsername + '.'
      : offlineName + ' is nowhere to be found (offline).';
    updateSession(session, 'offline', msg);
    console.log('[Trade Sessions] Session ' + sessionId + ': ' + offlineName + ' is OFFLINE (no alts remaining)');
  }
}

export function handleBotDisconnect(): void {
  tradeSessions.forEach(function (session: TradeSession) {
    if (!isTerminal(session.status)) {
      updateSession(session, 'error', 'Bot went offline. Please try again later.');
    }
  });
}

export function getSession(sessionId: string): SessionSnapshot | null {
  const session = tradeSessions.get(sessionId);
  if (!session) return null;
  return sessionSnapshot(session);
}

export function addSSEClient(sessionId: string, res: any): void {
  if (!sseClients.has(sessionId)) {
    sseClients.set(sessionId, new Set());
  }
  sseClients.get(sessionId)!.add(res);
}

export function removeSSEClient(sessionId: string, res: any): void {
  const clients = sseClients.get(sessionId);
  if (clients) {
    clients.delete(res);
  }
}
