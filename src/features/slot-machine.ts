// @ts-nocheck
"use strict";
// ── Slot Machine Bot Module ──────────────────────────────────────
// Manages a slot machine where players trade gold to load credits,
// then whisper commands to spin. One player at a time.
//
// Symbols:
//   Red Balloon       — lose
//   Yellow Balloon    — lose
//   Green Balloon     — win (2x)
//   Bundle of Balloons — jackpot (5x)
//
// Exchange protocol (Dark Ages):
//   0x42 IN  (type 0x00) — Incoming exchange request
//   0x42 IN  (type 0x02) — Item placed in trade window
//   0x42 IN  (type 0x05) — Exchange completed
//   0x4B IN             — Exchange slot update
//   0x4A OUT (type 0x05) — Accept exchange request
//   0x4A OUT (type 0x01) — Place item from inventory
//   0x4A OUT (type 0x00) — Confirm trade
//   0x2A OUT             — Initiate exchange
//   0x37 IN  (AddItem)   — Item added to inventory
//   0x38 IN  (RemoveItem)— Item removed from inventory
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initiateOffload = initiateOffload;
exports.handleNpcDialog = handleNpcDialog;
exports.handlePublicMessage = handlePublicMessage;
exports.handleStatsUpdate = handleStatsUpdate;
exports.init = init;
exports.handleExchangeMessage = handleExchangeMessage;
exports.handleExchangeSlot = handleExchangeSlot;
exports.handleAddItem = handleAddItem;
exports.handleInventoryItem = handleInventoryItem;
exports.handleRemoveItem = handleRemoveItem;
exports.handleWhisper = handleWhisper;
exports.getSlotState = getSlotState;
exports.getPlayerState = getPlayerState;
exports.webSpin = webSpin;
exports.webSetBet = webSetBet;
exports.wheelSpin = wheelSpin;
exports.wheelStatus = wheelStatus;
exports.wheelHistory = wheelHistory;
exports.getConfig = getConfig;
exports.saveConfigUpdate = saveConfigUpdate;
exports.getBankingConfig = getBankingConfig;
exports.saveBankingConfigUpdate = saveBankingConfigUpdate;
exports.forceEndSession = forceEndSession;
exports.forceClearQueue = forceClearQueue;
exports.buyTicket = buyTicket;
exports.getTicketHistory = getTicketHistory;
const packet_1 = __importDefault(require("../core/packet"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
let nextCashoutId = 1;
// ── Constants ────────────────────────────────────────────────────
const DATA_DIR = path_1.default.join(__dirname, '..', '..', 'data');
const SLOTS_FILE = path_1.default.join(DATA_DIR, 'slots.json');
const EXCHANGE_TIMEOUT_MS = 60 * 1000;
const ITEM_PLACE_DELAY_MS = 1500;
const CONFIRM_DELAY_MS = 1500;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_SPIN_HISTORY = 100;
const MIN_BOT_BALANCE = 2_000_000; // auto-pause threshold — slots shut down below this
// ── Wheel Spin Constants ──────────────────────────────────────────
const WHEEL_SEGMENTS = [
    { prize: 0, weight: 5 }, // 0  Nothing
    { prize: 100_000, weight: 3 }, // 1
    { prize: 0, weight: 5 }, // 2  Nothing
    { prize: 250_000, weight: 2.5 }, // 3
    { prize: 0, weight: 5 }, // 4  Nothing
    { prize: 100_000, weight: 3 }, // 5
    { prize: 0, weight: 5 }, // 6  Nothing
    { prize: 500_000, weight: 1.5 }, // 7
    { prize: 0, weight: 5 }, // 8  Nothing
    { prize: 100_000, weight: 3 }, // 9
    { prize: 0, weight: 5 }, // 10 Nothing
    { prize: 1_000_000, weight: 0.8 }, // 11
    { prize: 0, weight: 5 }, // 12 Nothing
    { prize: 2_500_000, weight: 0.4 }, // 13
    { prize: 0, weight: 5 }, // 14 Nothing
    { prize: 5_000_000, weight: 0.15 }, // 15 Jackpot
];
const WHEEL_TOTAL_WEIGHT = WHEEL_SEGMENTS.reduce((sum, s) => sum + s.weight, 0);
const WHEEL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MAX_WHEEL_HISTORY = 20;
const DEFAULT_SYMBOLS = [
    { name: 'Red Polyp Puppet', weight: 48, multiplier: 0 }, // 48% lose
    { name: 'Yellow Polyp Puppet', weight: 30, multiplier: 1 }, // 30% push
    { name: 'Green Polyp Puppet', weight: 16, multiplier: 2 }, // 16% win 2x
    { name: 'Polyp Bunch', weight: 6, multiplier: 5 }, //  6% jackpot 5x
];
// RTP = 0 + 0.30 + 0.32 + 0.30 = 0.92 (92%) → 8% house edge
// The bot must physically hold these 4 items in inventory.
// We track by name, not slot number, so if a player skill
// forces an item back into a different slot it still works.
const REQUIRED_BALLOON_NAMES = DEFAULT_SYMBOLS.map(s => s.name.toLowerCase());
// ── State ────────────────────────────────────────────────────────
let slotConfig = {
    enabled: true,
    spinCost: 1,
    symbols: DEFAULT_SYMBOLS
};
let playerStates = new Map();
let spinHistory = [];
let dailyLedger = [];
let activeExchange = null;
let pendingCashout = null;
let cashoutRequested = new Set(); // lowercase player names who whispered "cashout"
let bankDepositPending = new Set(); // lowercase player names who whispered "deposit" (GM bank refill)
let waitingQueue = [];
let botInventory = new Map(); // slot -> itemName
let equippedItem = null; // name of currently equipped balloon (if any)
// Spin queue: sequence of balloons to equip, advanced on a timer
let spinQueue = [];
let spinCallback = null;
let currentSpinId = 0; // incremented each spin to guard against stale timers
// Banking state
let bankingState = null;
let bankingConfig = {
    enabled: false,
    bankerName: 'Celesta',
    bankerSerial: 0,
    bankerX: 48,
    bankerY: 17,
    highWatermark: 80_000_000,
    lowWatermark: 15_000_000,
    depositTarget: 15_000_000,
    withdrawTarget: 40_000_000,
    checkIntervalMs: 30_000,
    timeoutMs: 15_000,
    maxRetries: 2,
};
let nextBankingId = 1;
let bankBalance = 0;
let goldOnHand = 0;
let bankCheckTimer = null;
// Gold offload state
let pendingOffload = null;
let nextOffloadId = 1;
// ── Daily Ledger Helpers ─────────────────────────────────────────
function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function getTodayLedger() {
    const key = todayKey();
    let entry = dailyLedger.find(e => e.date === key);
    if (!entry) {
        entry = { date: key, bets: 0, payouts: 0, spins: 0, deposited: 0, withdrawn: 0 };
        dailyLedger.push(entry);
        // Keep max 90 days of history
        if (dailyLedger.length > 90) {
            dailyLedger = dailyLedger.slice(-90);
        }
    }
    return entry;
}
function ledgerRecordSpin(bet, payout) {
    const entry = getTodayLedger();
    entry.bets += bet;
    entry.payouts += payout;
    entry.spins += 1;
}
function ledgerRecordDeposit(amount) {
    getTodayLedger().deposited += amount;
}
function ledgerRecordWithdrawal(amount) {
    getTodayLedger().withdrawn += amount;
}
function getLedgerStats() {
    const now = new Date();
    const todayStr = todayKey();
    // Week = last 7 days
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekKey = weekAgo.getFullYear() + '-' + String(weekAgo.getMonth() + 1).padStart(2, '0') + '-' + String(weekAgo.getDate()).padStart(2, '0');
    const todayStats = { bets: 0, payouts: 0, spins: 0, deposited: 0, withdrawn: 0, profit: 0 };
    const weekStats = { bets: 0, payouts: 0, spins: 0, deposited: 0, withdrawn: 0, profit: 0 };
    const allTimeStats = { bets: 0, payouts: 0, spins: 0, deposited: 0, withdrawn: 0, profit: 0 };
    for (const entry of dailyLedger) {
        allTimeStats.bets += entry.bets;
        allTimeStats.payouts += entry.payouts;
        allTimeStats.spins += entry.spins;
        allTimeStats.deposited += entry.deposited;
        allTimeStats.withdrawn += entry.withdrawn;
        if (entry.date >= weekKey) {
            weekStats.bets += entry.bets;
            weekStats.payouts += entry.payouts;
            weekStats.spins += entry.spins;
            weekStats.deposited += entry.deposited;
            weekStats.withdrawn += entry.withdrawn;
        }
        if (entry.date === todayStr) {
            todayStats.bets = entry.bets;
            todayStats.payouts = entry.payouts;
            todayStats.spins = entry.spins;
            todayStats.deposited = entry.deposited;
            todayStats.withdrawn = entry.withdrawn;
        }
    }
    todayStats.profit = todayStats.bets - todayStats.payouts;
    weekStats.profit = weekStats.bets - weekStats.payouts;
    allTimeStats.profit = allTimeStats.bets - allTimeStats.payouts;
    return { today: todayStats, week: weekStats, allTime: allTimeStats };
}
// Jackpot streak cooldown — reduces jackpot chance for players hitting too many in a short window
const recentJackpots = new Map(); // playerName → timestamps
const JACKPOT_COOLDOWN_WINDOW = 10 * 60 * 1000; // 10 minutes
const JACKPOT_COOLDOWN_THRESHOLD = 3; // 3 jackpots in window triggers cooldown
const COOLDOWN_EXTRA_LOSE_WEIGHT = 10; // +10 to lose weight during cooldown
// Dependencies (injected via init)
let sendPacketFn = null;
let sendWhisperFn = null;
let sendSayFn = null;
let getSerialByNameFn = null;
let ioRef = null;
let getBotSerialFn = null;
let getEntityNameFn = null;
let setBankingActiveFn = null;
let getEntityPositionFn = null;
// ── Persistence ──────────────────────────────────────────────────
function saveSlots() {
    try {
        if (!fs_1.default.existsSync(DATA_DIR)) {
            fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
        }
        const data = {
            config: slotConfig,
            players: {},
            spinHistory: spinHistory.slice(-MAX_SPIN_HISTORY),
            bankBalance: bankBalance,
            goldOnHand: goldOnHand,
            bankingConfig: bankingConfig,
            dailyLedger: dailyLedger
        };
        playerStates.forEach((state, key) => {
            data.players[key] = state;
        });
        fs_1.default.writeFileSync(SLOTS_FILE, JSON.stringify(data, null, 2));
    }
    catch (e) {
        console.log('[Slots] Failed to save state: ' + e.message);
    }
}
function loadSlots() {
    try {
        if (fs_1.default.existsSync(SLOTS_FILE)) {
            const raw = JSON.parse(fs_1.default.readFileSync(SLOTS_FILE, 'utf8'));
            if (raw.config) {
                // Load config but always use DEFAULT_SYMBOLS (code is source of truth for odds)
                const { symbols, ...savedConfig } = raw.config;
                slotConfig = { ...slotConfig, ...savedConfig, symbols: DEFAULT_SYMBOLS };
            }
            if (raw.players) {
                for (const key in raw.players) {
                    const p = raw.players[key];
                    if (!p.bet)
                        p.bet = slotConfig.spinCost;
                    if (!p.lastWheelSpin)
                        p.lastWheelSpin = 0;
                    if (!p.wheelTotalSpins)
                        p.wheelTotalSpins = 0;
                    if (!p.wheelTotalWon)
                        p.wheelTotalWon = 0;
                    if (!p.wheelHistory)
                        p.wheelHistory = [];
                    playerStates.set(key, p);
                }
            }
            if (raw.spinHistory) {
                spinHistory = raw.spinHistory;
            }
            if (typeof raw.bankBalance === 'number') {
                bankBalance = raw.bankBalance;
            }
            if (typeof raw.goldOnHand === 'number') {
                goldOnHand = raw.goldOnHand;
            }
            if (raw.bankingConfig) {
                bankingConfig = { ...bankingConfig, ...raw.bankingConfig };
            }
            if (raw.dailyLedger && Array.isArray(raw.dailyLedger)) {
                dailyLedger = raw.dailyLedger;
            }
            console.log('[Slots] Loaded state: ' + playerStates.size + ' players, bank=' + bankBalance + ', goldOnHand=' + goldOnHand + ', ledger=' + dailyLedger.length + ' days');
        }
    }
    catch (e) {
        console.log('[Slots] Failed to load state: ' + e.message);
    }
}
// ── Helpers ──────────────────────────────────────────────────────
function emitUpdate() {
    if (ioRef) {
        ioRef.emit('slots:update', getSlotState());
    }
}
function getOrCreatePlayer(name) {
    const key = name.toLowerCase();
    let state = playerStates.get(key);
    if (!state) {
        state = {
            playerName: name,
            balance: 0,
            bet: slotConfig.spinCost,
            totalDeposited: 0,
            totalWithdrawn: 0,
            totalSpins: 0,
            totalWon: 0,
            totalLost: 0,
            lastActive: Date.now(),
            lastWheelSpin: 0,
            wheelTotalSpins: 0,
            wheelTotalWon: 0,
            wheelHistory: [],
        };
        playerStates.set(key, state);
    }
    state.playerName = name; // keep casing up to date
    return state;
}
// ── Queue Helpers ──────────────────────────────────────────────
function getQueuePosition(playerName) {
    const idx = waitingQueue.findIndex(q => q.playerName.toLowerCase() === playerName.toLowerCase());
    return idx === -1 ? -1 : idx + 1;
}
function notifyQueuePositions() {
    for (let i = 0; i < waitingQueue.length; i++) {
        if (sendWhisperFn) {
            const pos = i + 1;
            sendWhisperFn(waitingQueue[i].playerName, 'You are #' + pos + ' in line.' + (pos === 1 ? ' You are next!' : ''));
        }
    }
}
function removeFromQueue(playerName) {
    const idx = waitingQueue.findIndex(q => q.playerName.toLowerCase() === playerName.toLowerCase());
    if (idx === -1)
        return false;
    const entry = waitingQueue[idx];
    if (entry.idleTimer)
        clearTimeout(entry.idleTimer);
    waitingQueue.splice(idx, 1);
    notifyQueuePositions();
    emitUpdate();
    return true;
}
function resetQueueIdleTimer(entry) {
    if (entry.idleTimer)
        clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
        removeFromQueue(entry.playerName);
        if (sendWhisperFn) {
            sendWhisperFn(entry.playerName, 'Removed from queue due to inactivity. Balance saved.');
        }
    }, IDLE_TIMEOUT_MS);
}
function isGoldItem(itemName) {
    const lower = itemName.toLowerCase().trim();
    return lower === 'gold' || lower === 'raw gold';
}
function isBalloonItem(itemName) {
    return REQUIRED_BALLOON_NAMES.includes(itemName.toLowerCase().trim());
}
function pickSymbol(playerName) {
    let symbols = slotConfig.symbols;
    // Jackpot streak cooldown: boost lose weight if player hit too many jackpots recently
    if (playerName) {
        const key = playerName.toLowerCase();
        const timestamps = recentJackpots.get(key) || [];
        const recent = timestamps.filter(t => Date.now() - t < JACKPOT_COOLDOWN_WINDOW);
        if (recent.length >= JACKPOT_COOLDOWN_THRESHOLD) {
            symbols = symbols.map(s => s.multiplier === 0
                ? { ...s, weight: s.weight + COOLDOWN_EXTRA_LOSE_WEIGHT }
                : s);
        }
    }
    const totalWeight = symbols.reduce((sum, s) => sum + s.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const sym of symbols) {
        roll -= sym.weight;
        if (roll <= 0)
            return sym;
    }
    return symbols[0];
}
function recordJackpot(playerName) {
    const key = playerName.toLowerCase();
    const timestamps = recentJackpots.get(key) || [];
    timestamps.push(Date.now());
    recentJackpots.set(key, timestamps.filter(t => Date.now() - t < JACKPOT_COOLDOWN_WINDOW));
}
/** Find the inventory slot number for a balloon by name */
function findBalloonSlot(balloonName) {
    const target = balloonName.toLowerCase().trim();
    let found = null;
    botInventory.forEach((name, slot) => {
        if (name.toLowerCase().trim() === target)
            found = slot;
    });
    return found;
}
/** Send 0x1C to equip an item from an inventory slot.
 *  The game swaps: item at slot → hand, item in hand → slot.
 *  We track this locally so we always know what's in hand. */
function equipSlot(slot) {
    if (!sendPacketFn)
        return;
    const itemAtSlot = botInventory.get(slot) || null;
    const previouslyInHand = equippedItem;
    // Send the equip packet
    const p = new packet_1.default(0x1C);
    p.writeByte(slot);
    sendPacketFn(p);
    // Local swap: item at slot goes to hand, hand goes to slot
    equippedItem = itemAtSlot;
    botInventory.delete(slot);
    if (previouslyInHand) {
        botInventory.set(slot, previouslyInHand);
    }
    console.log('[Slots] Equip slot ' + slot + ': ' + (previouslyInHand || 'nothing') + ' → slot, ' + (itemAtSlot || 'nothing') + ' → hand');
}
/** Advance the spin queue — equip the next balloon in sequence.
 *  Each step is paced by a timer. equipSlot() handles the local swap
 *  so we always know what's in hand without waiting for server events. */
function advanceSpinQueue() {
    if (spinQueue.length === 0)
        return;
    const next = spinQueue.shift();
    const mySpinId = currentSpinId;
    // If this balloon is already in hand, skip to next
    if (equippedItem && equippedItem.toLowerCase().trim() === next.name.toLowerCase().trim()) {
        console.log('[Slots] Spin step: ' + next.name + ' already in hand, skipping');
        if (next.isLast) {
            if (spinCallback) {
                const cb = spinCallback;
                spinCallback = null;
                cb(equippedItem);
            }
        }
        else {
            advanceSpinQueue();
        }
        return;
    }
    const slot = findBalloonSlot(next.name);
    if (slot !== null) {
        equipSlot(slot); // local swap happens here — equippedItem is now next.name
        console.log('[Slots] Spin step: equipped ' + next.name + ' (slot ' + slot + '), ' + spinQueue.length + ' remaining');
        if (next.isLast) {
            // Result is known — equipSlot() already set equippedItem
            // Short delay so the player sees the final equip animation
            setTimeout(() => {
                if (currentSpinId === mySpinId && spinCallback) {
                    const cb = spinCallback;
                    spinCallback = null;
                    cb(equippedItem || next.name);
                }
            }, 800);
        }
        else {
            // Pace the animation — advance after a short delay
            setTimeout(() => {
                if (currentSpinId === mySpinId) {
                    advanceSpinQueue();
                }
            }, 600);
        }
    }
    else {
        console.log('[Slots] Spin step: could not find ' + next.name + ' in inventory, skipping');
        if (next.isLast) {
            if (spinCallback) {
                const cb = spinCallback;
                spinCallback = null;
                cb(next.name);
            }
        }
        else {
            advanceSpinQueue();
        }
    }
}
function hasAllBalloons() {
    const found = new Set();
    // Check inventory
    botInventory.forEach((name) => {
        const lower = name.toLowerCase().trim();
        if (REQUIRED_BALLOON_NAMES.includes(lower)) {
            found.add(lower);
        }
    });
    // The one in hand counts too
    if (equippedItem && REQUIRED_BALLOON_NAMES.includes(equippedItem.toLowerCase().trim())) {
        found.add(equippedItem.toLowerCase().trim());
    }
    return found.size === REQUIRED_BALLOON_NAMES.length;
}
function getMissingBalloons() {
    const found = new Set();
    botInventory.forEach((name) => {
        const lower = name.toLowerCase().trim();
        if (REQUIRED_BALLOON_NAMES.includes(lower)) {
            found.add(lower);
        }
    });
    if (equippedItem && REQUIRED_BALLOON_NAMES.includes(equippedItem.toLowerCase().trim())) {
        found.add(equippedItem.toLowerCase().trim());
    }
    return DEFAULT_SYMBOLS
        .filter(s => !found.has(s.name.toLowerCase()))
        .map(s => s.name);
}
function countGoldInInventory() {
    let count = 0;
    botInventory.forEach((name) => {
        if (isGoldItem(name))
            count++;
    });
    return count;
}
function getTotalOutstandingBalance() {
    let total = 0;
    playerStates.forEach(s => { total += s.balance; });
    return total;
}
function getSpinGuard(bet) {
    const botGold = goldOnHand;
    if (botGold < MIN_BOT_BALANCE)
        return 'Slot machine is temporarily closed for maintenance.';
    const dynamicMaxBet = Math.floor(botGold / 20);
    if (dynamicMaxBet < 1)
        return 'Slot machine temporarily unavailable.';
    if (bet > dynamicMaxBet)
        return 'Max bet is currently ' + dynamicMaxBet + ' gold.';
    if (botGold < bet * 5)
        return 'Bet too high for current reserves. Try a lower bet.';
    return null;
}
/**
 * After inventory loads on login, if exactly 1 balloon is missing
 * from inventory, it must be the one currently equipped in hand.
 */
function inferEquippedBalloon() {
    if (equippedItem)
        return; // already know what's equipped
    const inInventory = new Set();
    botInventory.forEach((name) => {
        const lower = name.toLowerCase().trim();
        if (REQUIRED_BALLOON_NAMES.includes(lower)) {
            inInventory.add(lower);
        }
    });
    const missing = DEFAULT_SYMBOLS.filter(s => !inInventory.has(s.name.toLowerCase()));
    if (missing.length === 1) {
        equippedItem = missing[0].name;
        console.log('[Slots] Inferred equipped balloon on login: ' + equippedItem);
    }
    else if (missing.length > 1) {
        console.log('[Slots] Multiple balloons missing from inventory: ' + missing.map(m => m.name).join(', '));
    }
}
// ── Banking ─────────────────────────────────────────────────────
function readNullTermString(packet) {
    const bytes = [];
    while (packet.remainder() > 0) {
        const b = packet.readByte();
        if (b === 0x00)
            break;
        bytes.push(b);
    }
    return Buffer.from(bytes).toString('utf8');
}
function canInitiateBanking() {
    if (!bankingConfig.enabled)
        return false;
    if (bankingState !== null)
        return false;
    if (activeExchange !== null)
        return false;
    if (pendingCashout !== null)
        return false;
    if (pendingOffload !== null)
        return false;
    if (spinningPlayer !== null)
        return false;
    if (spinQueue.length > 0)
        return false;
    if (waitingQueue.length > 0)
        return false;
    return true;
}
function checkAndInitiateBanking() {
    if (!canInitiateBanking())
        return;
    if (goldOnHand > bankingConfig.highWatermark) {
        let depositAmount = goldOnHand - bankingConfig.depositTarget;
        if (bankBalance > 0) {
            const bankRoom = 100_000_000 - bankBalance;
            if (bankRoom <= 0)
                return;
            if (depositAmount > bankRoom)
                depositAmount = bankRoom;
        }
        if (depositAmount > 0) {
            initiateBanking('deposit', depositAmount);
        }
    }
    else if (goldOnHand < bankingConfig.lowWatermark && goldOnHand > 0) {
        if (bankBalance <= 0)
            return; // nothing to withdraw
        let withdrawAmount = bankingConfig.withdrawTarget - goldOnHand;
        if (withdrawAmount <= 0)
            return;
        if (withdrawAmount > bankBalance)
            withdrawAmount = bankBalance;
        const handRoom = 99_000_000 - goldOnHand;
        if (withdrawAmount > handRoom)
            withdrawAmount = handRoom;
        if (withdrawAmount > 0) {
            initiateBanking('withdraw', withdrawAmount);
        }
    }
}
function startBankingCheckLoop() {
    if (bankCheckTimer)
        clearInterval(bankCheckTimer);
    if (!bankingConfig.enabled)
        return;
    bankCheckTimer = setInterval(() => {
        checkAndInitiateBanking();
    }, bankingConfig.checkIntervalMs);
}
function sendApproachPacket(serial) {
    if (!sendPacketFn)
        return;
    let pos = null;
    if (getEntityPositionFn) {
        pos = getEntityPositionFn(serial);
    }
    if (!pos && bankingConfig.bankerX > 0 && bankingConfig.bankerY > 0) {
        pos = { x: bankingConfig.bankerX, y: bankingConfig.bankerY };
    }
    if (!pos) {
        console.log('[Slots] Banking: no position for serial 0x' + serial.toString(16) + ', skipping approach');
        return;
    }
    const approachBody = [0x03, (pos.x >> 8) & 0xFF, pos.x & 0xFF, (pos.y >> 8) & 0xFF, pos.y & 0xFF, 0x00];
    console.log('[Slots] Banking: sending approach to (' + pos.x + ',' + pos.y + ') body=[' + approachBody.map((b) => b.toString(16).padStart(2, '0')).join(' ') + ']');
    const approach = new packet_1.default(0x43);
    approach.writeByte(0x03);
    approach.writeUInt16(pos.x);
    approach.writeUInt16(pos.y);
    approach.writeByte(0x00);
    sendPacketFn(approach);
}
function initiateBanking(action, amount) {
    if (!sendPacketFn)
        return;
    // Always prefer dynamic serial lookup — NPC serials change on server restart
    let serial = 0;
    let serialSource = 'none';
    if (getSerialByNameFn) {
        serial = getSerialByNameFn(bankingConfig.bankerName);
        if (serial)
            serialSource = 'entity-lookup("' + bankingConfig.bankerName + '")';
    }
    if (!serial && bankingConfig.bankerSerial) {
        serial = bankingConfig.bankerSerial;
        serialSource = 'config-fallback';
        console.log('[Slots] Banking: WARNING — using hardcoded serial 0x' + serial.toString(16) + ', NPC may have changed serial since last restart');
    }
    if (!serial) {
        console.log('[Slots] Banking: cannot find banker "' + bankingConfig.bankerName + '" — NPC not visible on screen and no fallback serial configured');
        return;
    }
    console.log('[Slots] Banking: resolved serial=0x' + serial.toString(16) + ' via ' + serialSource);
    const id = nextBankingId++;
    bankingState = {
        phase: 'clicking_npc',
        action,
        amount,
        npcSerial: serial,
        startedAt: Date.now(),
        bankingId: id,
        retryCount: 0,
        dialogId: 0,
    };
    console.log('[Slots] Banking: initiating ' + action + ' of ' + amount + ' gold (id=' + id + ') serial=0x' + serial.toString(16));
    if (setBankingActiveFn)
        setBankingActiveFn(true);
    emitUpdate();
    sendApproachPacket(serial);
    // Delay click by 2s after approach (matches real client timing)
    setTimeout(() => {
        if (!bankingState || bankingState.bankingId !== id || !sendPacketFn)
            return;
        const click = new packet_1.default(0x43);
        click.writeByte(0x01);
        click.writeUInt32(serial);
        console.log('[Slots] Banking: sending click body=[' + click.body.map((b) => b.toString(16).padStart(2, '0')).join(' ') + ']');
        sendPacketFn(click);
    }, 2000);
    scheduleBankingTimeout(id);
}
function scheduleBankingTimeout(bankingId) {
    setTimeout(() => {
        if (bankingState && bankingState.bankingId === bankingId) {
            console.log('[Slots] Banking: timeout in phase "' + bankingState.phase + '" (id=' + bankingId + ')');
            if (bankingState.retryCount < bankingConfig.maxRetries) {
                retryBanking();
            }
            else {
                abortBanking('max retries exceeded');
            }
        }
    }, bankingConfig.timeoutMs);
}
function retryBanking() {
    if (!bankingState || !sendPacketFn)
        return;
    bankingState.retryCount++;
    bankingState.phase = 'clicking_npc';
    bankingState.startedAt = Date.now();
    console.log('[Slots] Banking: retry #' + bankingState.retryCount + ' for ' + bankingState.action + ' ' + bankingState.amount);
    emitUpdate();
    sendApproachPacket(bankingState.npcSerial);
    const click = new packet_1.default(0x43);
    click.writeByte(0x01);
    click.writeUInt32(bankingState.npcSerial);
    sendPacketFn(click);
    scheduleBankingTimeout(bankingState.bankingId);
}
function abortBanking(reason) {
    if (!bankingState)
        return;
    console.log('[Slots] Banking: ABORTED (' + reason + '). Action=' + bankingState.action +
        ' Amount=' + bankingState.amount + ' Phase=' + bankingState.phase);
    bankingState = null;
    if (setBankingActiveFn)
        setBankingActiveFn(false);
    // If offload was waiting on this withdraw, fail it
    if (pendingOffload && pendingOffload.phase === 'withdrawing') {
        pendingOffload.phase = 'failed';
        pendingOffload.errorMessage = 'Bank withdraw failed: ' + reason;
        console.log('[Slots] Offload failed: banking aborted');
        emitUpdate();
        pendingOffload = null;
    }
    emitUpdate();
}
function completeBanking() {
    if (!bankingState)
        return;
    console.log('[Slots] Banking: completed ' + bankingState.action + ' successfully');
    bankingState = null;
    if (setBankingActiveFn)
        setBankingActiveFn(false);
    saveSlots();
    emitUpdate();
    // If offload was waiting on a withdraw, continue after a short delay
    if (pendingOffload && pendingOffload.phase === 'withdrawing') {
        setTimeout(() => continueOffload(), 1000);
    }
}
// ── Gold Offload ────────────────────────────────────────────────
function initiateOffload(targetName, amount) {
    if (pendingOffload)
        return { success: false, error: 'Offload already in progress' };
    if (activeExchange)
        return { success: false, error: 'Exchange in progress' };
    if (pendingCashout)
        return { success: false, error: 'Cashout in progress' };
    if (bankingState)
        return { success: false, error: 'Banking in progress' };
    if (spinningPlayer)
        return { success: false, error: 'Spin in progress' };
    if (!sendPacketFn)
        return { success: false, error: 'Not connected' };
    if (!getSerialByNameFn)
        return { success: false, error: 'Serial lookup not available' };
    const targetSerial = getSerialByNameFn(targetName);
    if (!targetSerial)
        return { success: false, error: targetName + ' is not visible on screen' };
    const available = goldOnHand + bankBalance - bankingConfig.depositTarget;
    if (available <= 0)
        return { success: false, error: 'No gold available above reserve (' + bankingConfig.depositTarget.toLocaleString() + ')' };
    const transferAmount = Math.min(amount, available);
    const id = nextOffloadId++;
    pendingOffload = {
        targetName,
        targetSerial,
        totalRequested: transferAmount,
        totalTransferred: 0,
        currentBatchAmount: 0,
        phase: 'approaching',
        offloadId: id,
        startedAt: Date.now(),
    };
    console.log('[Slots] Offload initiated: ' + transferAmount.toLocaleString() + ' gold to ' + targetName + ' (serial=0x' + targetSerial.toString(16) + ', id=' + id + ')');
    continueOffload();
    return { success: true };
}
function continueOffload() {
    if (!pendingOffload || !sendPacketFn)
        return;
    const remaining = pendingOffload.totalRequested - pendingOffload.totalTransferred;
    if (remaining <= 0) {
        console.log('[Slots] Offload complete: ' + pendingOffload.totalTransferred.toLocaleString() + ' gold to ' + pendingOffload.targetName);
        pendingOffload.phase = 'complete';
        emitUpdate();
        pendingOffload = null;
        return;
    }
    // How much gold is available on hand above the gambling reserve
    const handAvailable = goldOnHand - bankingConfig.depositTarget;
    if (handAvailable <= 0) {
        // Need to withdraw from bank first
        if (bankBalance <= 0) {
            console.log('[Slots] Offload: no more gold available (bank empty, hand at reserve)');
            if (pendingOffload.totalTransferred > 0) {
                pendingOffload.phase = 'complete';
                pendingOffload.errorMessage = 'Transferred ' + pendingOffload.totalTransferred.toLocaleString() + ' (all available gold)';
            }
            else {
                pendingOffload.phase = 'failed';
                pendingOffload.errorMessage = 'Not enough gold above reserve';
            }
            emitUpdate();
            pendingOffload = null;
            return;
        }
        const withdrawAmount = Math.min(remaining, 100_000_000, bankBalance);
        pendingOffload.phase = 'withdrawing';
        console.log('[Slots] Offload: withdrawing ' + withdrawAmount.toLocaleString() + ' from bank');
        emitUpdate();
        initiateBanking('withdraw', withdrawAmount);
        return;
    }
    // Calculate batch size: min of remaining, what's on hand above reserve, and 100M cap
    const batch = Math.min(remaining, handAvailable, 100_000_000);
    pendingOffload.currentBatchAmount = batch;
    pendingOffload.phase = 'approaching';
    // Re-resolve serial in case entity list updated
    if (getSerialByNameFn) {
        const freshSerial = getSerialByNameFn(pendingOffload.targetName);
        if (freshSerial)
            pendingOffload.targetSerial = freshSerial;
    }
    if (!pendingOffload.targetSerial) {
        pendingOffload.phase = 'failed';
        pendingOffload.errorMessage = pendingOffload.targetName + ' is no longer visible';
        emitUpdate();
        pendingOffload = null;
        return;
    }
    console.log('[Slots] Offload: initiating exchange for batch of ' + batch.toLocaleString() + ' gold (transferred so far: ' + pendingOffload.totalTransferred.toLocaleString() + ')');
    emitUpdate();
    // Send exchange initiation: 0x2A [00 00 00 00] [serial:4]
    const exchange = new packet_1.default(0x2A);
    exchange.writeUInt32(0); // no gold upfront
    exchange.writeUInt32(pendingOffload.targetSerial);
    sendPacketFn(exchange);
    // Timeout if target doesn't respond
    const myId = pendingOffload.offloadId;
    setTimeout(() => {
        if (pendingOffload && pendingOffload.offloadId === myId && pendingOffload.phase === 'approaching') {
            console.log('[Slots] Offload: exchange timeout — target did not accept');
            pendingOffload.phase = 'failed';
            pendingOffload.errorMessage = 'Target did not accept exchange';
            emitUpdate();
            pendingOffload = null;
            activeExchange = null;
        }
    }, 60_000);
}
function abortOffload(reason) {
    if (!pendingOffload)
        return;
    console.log('[Slots] Offload aborted: ' + reason);
    pendingOffload.phase = 'failed';
    pendingOffload.errorMessage = reason;
    emitUpdate();
    pendingOffload = null;
}
function handleNpcDialog(packet) {
    // Always log 0x2F arrival for debugging
    const peekSaved = packet.position;
    try {
        const peekType = packet.body[peekSaved];
        console.log('[Slots] 0x2F received: firstByte=0x' + (peekType !== undefined ? peekType.toString(16) : '?') +
            ' bodyLen=' + packet.body.length + ' banking=' + (bankingState ? bankingState.phase : 'none'));
    }
    catch (_e) { /* ignore */ }
    if (!bankingState) {
        return;
    }
    const saved = packet.position;
    try {
        const dialogType = packet.readByte();
        const dialogId = packet.readByte();
        const npcSerial = packet.readUInt32();
        bankingState.dialogId = dialogId;
        console.log('[Slots] Banking 0x2F: dialogId=0x' + dialogId.toString(16));
        if (npcSerial !== bankingState.npcSerial) {
            console.log('[Slots] Banking 0x2F: serial mismatch — got 0x' + npcSerial.toString(16) + ' expected 0x' + bankingState.npcSerial.toString(16));
            packet.position = saved;
            return;
        }
        // Skip 4x u16 + 1 zero byte (sprite/color data before NPC name)
        packet.readUInt16();
        packet.readUInt16();
        packet.readUInt16();
        packet.readUInt16();
        packet.readByte();
        // NPC name is string8 (length-prefixed), followed by 0x00 separator, then dialog text is also string8
        const npcName = packet.readString8();
        packet.readByte(); // skip 0x00 separator
        const dialogText = packet.readString8();
        // Dump remaining bytes after dialogText for analysis
        const remainPos = packet.position;
        const remainBytes = packet.body.slice(remainPos);
        const remainHex = remainBytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
        console.log('[Slots] Banking 0x2F: type=0x' + dialogType.toString(16) +
            ' phase=' + bankingState.phase +
            ' serial=0x' + npcSerial.toString(16) +
            ' npc="' + npcName + '" text="' + dialogText.substring(0, 80) + '"' +
            ' remaining(' + remainBytes.length + ')=[' + remainHex + ']');
        // Try to extract bank balance from dialog text
        const balanceMatch = dialogText.match(/(\d[\d,]*)\s*coins/);
        if (balanceMatch) {
            bankBalance = parseInt(balanceMatch[1].replace(/,/g, ''), 10);
            console.log('[Slots] Banking: bank balance updated to ' + bankBalance);
        }
        if (dialogType === 0x00 && bankingState.phase === 'clicking_npc') {
            // Parse menu options from remaining bytes: [count] then [len][label][00][id] repeated
            const menuOptions = [];
            try {
                const menuCount = packet.readByte();
                for (let mi = 0; mi < menuCount && packet.remainder() >= 3; mi++) {
                    const label = packet.readString8();
                    packet.readByte(); // 0x00 separator
                    const oid = packet.readByte();
                    menuOptions.push({ label, id: oid });
                }
            }
            catch (_e) { /* partial parse is OK */ }
            console.log('[Slots] Banking: menu options: ' + menuOptions.map(o => '"' + o.label + '"=0x' + o.id.toString(16)).join(', '));
            // Find the correct option ID dynamically
            let optionId = 0;
            if (bankingState.action === 'deposit') {
                const opt = menuOptions.find(o => o.label.toLowerCase().includes('deposit money'));
                optionId = opt ? opt.id : 0x42; // fallback to known ID
            }
            else {
                const opt = menuOptions.find(o => o.label.toLowerCase().includes('withdraw money'));
                if (opt) {
                    optionId = opt.id;
                }
                else {
                    console.log('[Slots] Banking: "Withdraw Money" option NOT found in menu! Aborting.');
                    abortBanking('withdraw option not available');
                    packet.position = saved;
                    return;
                }
            }
            console.log('[Slots] Banking: selected option "' + bankingState.action + '" → id=0x' + optionId.toString(16));
            const myBankingId = bankingState.bankingId;
            bankingState.phase = 'entering_amount';
            console.log('[Slots] Banking: selecting ' + bankingState.action + ' option (delayed 1.5s)');
            emitUpdate();
            setTimeout(() => {
                if (!bankingState || bankingState.bankingId !== myBankingId)
                    return;
                if (sendPacketFn) {
                    const resp = new packet_1.default(0x39);
                    resp.writeByte(bankingState.dialogId);
                    resp.writeUInt32(bankingState.npcSerial);
                    resp.writeUInt16(optionId);
                    const bodyHex = resp.body.map((b) => b.toString(16).padStart(2, '0')).join(' ');
                    console.log('[Slots] Banking: sending 0x39 dialogId=0x' + bankingState.dialogId.toString(16) + ' body=[' + bodyHex + '] serial=0x' + bankingState.npcSerial.toString(16));
                    sendPacketFn(resp);
                    console.log('[Slots] Banking: sent 0x39 option 0x' + optionId.toString(16));
                }
            }, 1500);
        }
        else if (dialogType === 0x02 && bankingState.phase === 'entering_amount') {
            // Amount prompt — send via 0x39 with String8 argument (no Slot byte)
            const responseId = bankingState.action === 'deposit' ? 0x52 : 0x55;
            const amountStr = String(bankingState.amount);
            if (sendPacketFn) {
                const resp = new packet_1.default(0x39);
                resp.writeByte(bankingState.dialogId);      // EntityType
                resp.writeUInt32(bankingState.npcSerial);    // EntityId
                resp.writeUInt16(responseId);                // PursuitId
                resp.writeString8(amountStr);                // Amount as String8 arg
                sendPacketFn(resp);
            }
            bankingState.phase = 'waiting_confirm';
            console.log('[Slots] Banking: sent amount ' + amountStr);
            emitUpdate();
        }
        else {
            console.log('[Slots] Banking 0x2F: UNHANDLED type=0x' + dialogType.toString(16) + ' phase=' + bankingState.phase);
        }
    }
    catch (e) {
        console.log('[Slots] Banking: error handling 0x2F: ' + e.message);
        abortBanking('dialog parse error');
    }
    packet.position = saved;
}
function handlePublicMessage(packet) {
    if (!bankingState || bankingState.phase !== 'waiting_confirm')
        return;
    const saved = packet.position;
    try {
        const _msgType = packet.readByte();
        const _senderId = packet.readUInt32();
        const text = packet.readString8();
        const bankerPrefix = bankingConfig.bankerName + ': ';
        if (!text.startsWith(bankerPrefix)) {
            packet.position = saved;
            return;
        }
        const msg = text.substring(bankerPrefix.length);
        if (bankingState.action === 'deposit') {
            const depositMatch = msg.match(/deposit\s+(\d[\d,]*)\s*coins/i);
            if (depositMatch) {
                const confirmed = parseInt(depositMatch[1].replace(/,/g, ''), 10);
                bankBalance += confirmed;
                console.log('[Slots] Banking: deposited ' + confirmed + ' gold. Bank=' + bankBalance);
                completeBanking();
                packet.position = saved;
                return;
            }
        }
        else if (bankingState.action === 'withdraw') {
            const withdrawMatch = msg.match(/(\d[\d,]*)\s*coins/i);
            if (withdrawMatch) {
                const confirmed = parseInt(withdrawMatch[1].replace(/,/g, ''), 10);
                bankBalance -= confirmed;
                if (bankBalance < 0)
                    bankBalance = 0;
                console.log('[Slots] Banking: withdrew ' + confirmed + ' gold. Bank=' + bankBalance);
                completeBanking();
                packet.position = saved;
                return;
            }
        }
    }
    catch (e) {
        console.log('[Slots] Banking: error handling 0x0D: ' + e.message);
    }
    packet.position = saved;
}
function handleStatsUpdate(packet) {
    const saved = packet.position;
    try {
        const flags = packet.readByte();
        // Only care about packets containing ExperienceGold section (bit 0x08)
        if (!(flags & 0x08)) {
            packet.position = saved;
            return;
        }
        // Sections appear in order: Stats(0x20) → Vitals(0x10) → ExperienceGold(0x08) → Modifiers(0x04)
        // Skip preceding sections to reach ExperienceGold
        if (flags & 0x20)
            for (let i = 0; i < 28; i++)
                packet.readByte(); // Stats section (28 bytes)
        if (flags & 0x10)
            for (let i = 0; i < 8; i++)
                packet.readByte(); // Vitals section (8 bytes)
        // ExperienceGold section: 5x u32 (exp, toNext, ability, toNextAbility, gamePoints) then gold u32
        for (let i = 0; i < 20; i++)
            packet.readByte(); // skip 20 bytes to reach gold
        const gold = packet.readUInt32();
        if (gold >= 0 && gold <= 999_999_999) {
            const changed = gold !== goldOnHand;
            goldOnHand = gold;
            if (changed)
                emitUpdate();
        }
    }
    catch (e) {
        // Short stats packet or parse error — ignore
    }
    packet.position = saved;
}
// ── Init ─────────────────────────────────────────────────────────
function init(deps) {
    sendPacketFn = deps.sendPacket;
    sendWhisperFn = deps.sendWhisper;
    sendSayFn = deps.sendSay;
    ioRef = deps.io;
    getBotSerialFn = deps.getBotSerial;
    getEntityNameFn = deps.getEntityName || null;
    getSerialByNameFn = deps.getSerialByName || null;
    setBankingActiveFn = deps.setBankingActive || null;
    getEntityPositionFn = deps.getEntityPosition || null;
    loadSlots();
    startBankingCheckLoop();
    console.log('[Slots] Initialized');
}
// ── Exchange Protocol Handlers ───────────────────────────────────
function handleExchangeMessage(packet) {
    const saved = packet.position;
    try {
        const hexBytes = packet.body.map((b) => b.toString(16).padStart(2, '0')).join(' ');
        console.log('[Slots] 0x42 raw body (' + packet.body.length + ' bytes): ' + hexBytes);
        const type = packet.readByte();
        if (type === 0x00) {
            // Exchange request: [00] [serial:4] [name:string8]
            const otherSerial = packet.readUInt32();
            const name = packet.readString8();
            let playerName = name;
            if (!playerName && getEntityNameFn) {
                playerName = getEntityNameFn(otherSerial) || '';
            }
            console.log('[Slots] Exchange request from "' + playerName + '" (serial 0x' + otherSerial.toString(16) + ')');
            // Check if this is a bot-initiated offload exchange
            if (pendingOffload && pendingOffload.phase === 'approaching' &&
                (otherSerial === pendingOffload.targetSerial ||
                    playerName.toLowerCase() === pendingOffload.targetName.toLowerCase())) {
                activeExchange = {
                    playerName: pendingOffload.targetName,
                    playerSerial: otherSerial,
                    itemsOffered: [],
                    goldOffered: 0,
                    startedAt: Date.now()
                };
                pendingOffload.phase = 'placing_gold';
                const myId = pendingOffload.offloadId;
                const batchAmount = pendingOffload.currentBatchAmount;
                const targetSerial = otherSerial;
                // Place gold after delay
                setTimeout(() => {
                    if (!pendingOffload || pendingOffload.offloadId !== myId || !sendPacketFn)
                        return;
                    const placeGold = new packet_1.default(0x4A);
                    placeGold.writeByte(0x03);
                    placeGold.writeUInt32(targetSerial);
                    placeGold.writeUInt32(batchAmount);
                    sendPacketFn(placeGold);
                    console.log('[Slots] Offload: placed ' + batchAmount.toLocaleString() + ' gold');
                    // Accept trade
                    setTimeout(() => {
                        if (!pendingOffload || pendingOffload.offloadId !== myId || !sendPacketFn)
                            return;
                        const accept = new packet_1.default(0x4A);
                        accept.writeByte(0x00);
                        accept.writeUInt32(targetSerial);
                        sendPacketFn(accept);
                        console.log('[Slots] Offload: sent accept');
                        // Confirm trade
                        setTimeout(() => {
                            if (!pendingOffload || pendingOffload.offloadId !== myId || !sendPacketFn)
                                return;
                            const confirm = new packet_1.default(0x4A);
                            confirm.writeByte(0x05);
                            confirm.writeUInt32(targetSerial);
                            sendPacketFn(confirm);
                            pendingOffload.phase = 'confirming';
                            console.log('[Slots] Offload: sent confirm');
                            emitUpdate();
                        }, 1000);
                    }, 500);
                }, 1500);
                packet.position = saved;
                return;
            }
            // Abort banking if in progress — player trades take priority
            if (bankingState) {
                abortBanking('player trade initiated by ' + playerName);
            }
            if (!slotConfig.enabled) {
                if (sendWhisperFn && playerName) {
                    sendWhisperFn(playerName, 'The slot machine is currently disabled.');
                }
                packet.position = saved;
                return;
            }
            // If this player requested a cashout, handle it as a cashout trade
            const cashoutKey = playerName.toLowerCase();
            if (cashoutRequested.has(cashoutKey)) {
                cashoutRequested.delete(cashoutKey);
                const player = getOrCreatePlayer(playerName);
                const cashoutAmount = player.balance;
                if (cashoutAmount > 0) {
                    // Set up cashout — don't send accept! Wait for player to place gold (0x03).
                    // The exchange window opens automatically for our side.
                    activeExchange = {
                        playerName: playerName,
                        playerSerial: otherSerial,
                        itemsOffered: [],
                        goldOffered: 0,
                        startedAt: Date.now()
                    };
                    const thisCashoutId = nextCashoutId++;
                    pendingCashout = {
                        playerName: playerName,
                        playerSerial: otherSerial,
                        goldAmount: cashoutAmount,
                        phase: 'placing_gold',
                        goldPlaced: false,
                        confirmSent: false,
                        cashoutId: thisCashoutId
                    };
                    console.log('[Slots] Cashout exchange opened for ' + playerName + ' (' + cashoutAmount + ' gold, id=' + thisCashoutId + '). Waiting for player to place gold.');
                    // Timeout stale cashout exchange
                    setTimeout(() => {
                        if (pendingCashout && pendingCashout.cashoutId === thisCashoutId) {
                            console.log('[Slots] Cashout exchange with ' + playerName + ' timed out');
                            pendingCashout = null;
                            activeExchange = null;
                        }
                    }, EXCHANGE_TIMEOUT_MS);
                    packet.position = saved;
                    return;
                }
            }
            // If a cashout, exchange, or spin is in progress, reject
            if (pendingCashout || activeExchange || spinningPlayer) {
                if (sendWhisperFn && playerName) {
                    sendWhisperFn(playerName, 'Please wait, a trade or spin is in progress. Try again in a moment.');
                }
                packet.position = saved;
                return;
            }
            // Accept the exchange from anyone — deposits are open to all
            activeExchange = {
                playerName: playerName,
                playerSerial: otherSerial,
                itemsOffered: [],
                goldOffered: 0,
                startedAt: Date.now()
            };
            // Welcome new players
            const isKnown = playerStates.has(playerName.toLowerCase());
            if (!isKnown) {
                setTimeout(() => {
                    if (sendWhisperFn) {
                        sendWhisperFn(playerName, 'Welcome to the Slot Machine! Whisper: spin, bet, balance, cashout');
                    }
                }, 2000);
            }
            // Send accept packet: 0x4A [05] [serial:4]
            if (sendPacketFn) {
                const accept = new packet_1.default(0x4A);
                accept.writeByte(0x05);
                accept.writeUInt32(otherSerial);
                sendPacketFn(accept);
                console.log('[Slots] Sent accept for ' + playerName);
            }
            // Timeout stale exchange
            setTimeout(() => {
                if (activeExchange && activeExchange.playerSerial === otherSerial) {
                    console.log('[Slots] Exchange with ' + playerName + ' timed out');
                    activeExchange = null;
                }
            }, EXCHANGE_TIMEOUT_MS);
        }
        else if (type === 0x02) {
            // Item placed: [02] [slot:1] [sprite:2] [color:1] [name:string16]
            const slot = packet.readByte();
            const itemSprite = packet.readUInt16();
            const itemColor = packet.readByte();
            const itemName = packet.readString16();
            console.log('[Slots] Item offered slot ' + slot + ': "' + itemName + '"');
            if (activeExchange) {
                activeExchange.itemsOffered.push({ slot, itemName });
                if (isGoldItem(itemName)) {
                    console.log('[Slots] Gold detected from ' + activeExchange.playerName);
                }
                else {
                    console.log('[Slots] Non-gold item: ' + itemName);
                    if (sendWhisperFn) {
                        sendWhisperFn(activeExchange.playerName, 'Only Gold is accepted! You placed: ' + itemName);
                    }
                }
            }
        }
        else if (type === 0x03) {
            // Gold placed in exchange: [03] [party] [gold:u32] ...
            // party: 0x00 = bot (our side), 0x01 = other player
            const party = packet.readByte();
            const goldAmount = packet.readUInt32();
            console.log('[Slots] Gold placed: ' + goldAmount + ' party=' + party + ' (0=us, 1=them)');
            // Only process gold from the OTHER player (party=1), ignore our own gold reflection
            if (party === 0x00) {
                console.log('[Slots] Ignoring our own gold placement reflection');
                packet.position = saved;
                return;
            }
            if (activeExchange) {
                activeExchange.goldOffered = goldAmount;
                console.log('[Slots] Gold deposit pending from ' + activeExchange.playerName + ': ' + goldAmount);
                // If cashout is pending and we haven't placed gold yet, player dropped their coin — place our gold and confirm
                if (pendingCashout && sendPacketFn && !pendingCashout.goldPlaced &&
                    activeExchange.playerName.toLowerCase() === pendingCashout.playerName.toLowerCase()) {
                    const cashoutSerial = pendingCashout.playerSerial;
                    const cashoutGold = pendingCashout.goldAmount;
                    const myCashoutId = pendingCashout.cashoutId;
                    // Validate we have enough gold on hand
                    if (cashoutGold > goldOnHand) {
                        console.log('[Slots] Cashout BLOCKED: need ' + cashoutGold + ' but only ' + goldOnHand + ' on hand');
                        // Trigger emergency bank withdraw if possible
                        if (bankBalance > 0 && !bankingState) {
                            const needed = cashoutGold - goldOnHand + 5_000_000;
                            console.log('[Slots] Triggering emergency withdraw of ' + Math.min(needed, bankBalance));
                            initiateBanking('withdraw', Math.min(needed, bankBalance));
                        }
                        if (sendWhisperFn) {
                            sendWhisperFn(pendingCashout.playerName, 'Reserves are refilling — please try cashout again in about 30 seconds.');
                        }
                        pendingCashout = null;
                        activeExchange = null;
                        emitUpdate();
                        packet.position = saved;
                        return;
                    }
                    // Step 1: Place gold — 0x4A [03] [serial:4] [gold:4]
                    const placeGold = new packet_1.default(0x4A);
                    placeGold.writeByte(0x03);
                    placeGold.writeUInt32(cashoutSerial);
                    placeGold.writeUInt32(cashoutGold);
                    sendPacketFn(placeGold);
                    pendingCashout.goldPlaced = true;
                    console.log('[Slots] Placed ' + cashoutGold + ' gold for cashout to ' + pendingCashout.playerName + ' (id=' + myCashoutId + ')');
                    // Step 2: Accept/lock — 0x4A [00] [serial:4]
                    setTimeout(() => {
                        if (!sendPacketFn || !pendingCashout || pendingCashout.cashoutId !== myCashoutId)
                            return;
                        const accept = new packet_1.default(0x4A);
                        accept.writeByte(0x00);
                        accept.writeUInt32(cashoutSerial);
                        sendPacketFn(accept);
                        console.log('[Slots] Accepted cashout trade for ' + pendingCashout.playerName + ' (id=' + myCashoutId + ')');
                        // Step 3: Confirm — 0x4A [05] [serial:4]
                        setTimeout(() => {
                            if (!sendPacketFn)
                                return;
                            if (!pendingCashout || pendingCashout.cashoutId !== myCashoutId) {
                                console.log('[Slots] Cashout confirm skipped — cashout ' + myCashoutId + ' no longer active');
                                return;
                            }
                            pendingCashout.confirmSent = true;
                            const confirm = new packet_1.default(0x4A);
                            confirm.writeByte(0x05);
                            confirm.writeUInt32(cashoutSerial);
                            sendPacketFn(confirm);
                            console.log('[Slots] Confirmed cashout for ' + pendingCashout.playerName + ' (id=' + myCashoutId + ')');
                        }, 1000);
                    }, 500);
                }
            }
        }
        else if (type === 0x04) {
            // Cancel or status message
            packet.readByte();
            const message = packet.readString8();
            console.log('[Slots] Exchange type 0x04: "' + message + '"');
            if (message.toLowerCase().includes('cancel')) {
                activeExchange = null;
                if (pendingCashout) {
                    console.log('[Slots] Cashout cancelled for ' + pendingCashout.playerName);
                    pendingCashout = null;
                }
                if (pendingOffload) {
                    abortOffload('Exchange cancelled');
                }
            }
        }
        else if (type === 0x05) {
            // Exchange completed
            const subtype = packet.readByte();
            const message = packet.readString8();
            console.log('[Slots] Exchange 0x05 subtype=' + subtype + ': "' + message + '"');
            // Deposit/cashout/offload completion
            if (subtype === 0x01 && activeExchange) {
                const playerName = activeExchange.playerName;
                const goldAmount = activeExchange.goldOffered;
                const playerKey = playerName.toLowerCase();
                // Check if this was an offload trade
                if (pendingOffload && pendingOffload.targetName.toLowerCase() === playerKey) {
                    pendingOffload.totalTransferred += pendingOffload.currentBatchAmount;
                    console.log('[Slots] Offload batch complete: ' + pendingOffload.currentBatchAmount.toLocaleString() +
                        ' gold (total: ' + pendingOffload.totalTransferred.toLocaleString() + '/' + pendingOffload.totalRequested.toLocaleString() + ')');
                    activeExchange = null;
                    emitUpdate();
                    if (pendingOffload.totalTransferred >= pendingOffload.totalRequested) {
                        console.log('[Slots] Offload fully complete: ' + pendingOffload.totalTransferred.toLocaleString() + ' gold to ' + pendingOffload.targetName);
                        pendingOffload.phase = 'complete';
                        emitUpdate();
                        pendingOffload = null;
                    }
                    else {
                        // More batches needed
                        setTimeout(() => continueOffload(), 2000);
                    }
                    saveSlots();
                    packet.position = saved;
                    return;
                }
                // If this was a cashout trade, deduct balance — but only if gold was placed
                if (pendingCashout && pendingCashout.playerName.toLowerCase() === playerKey) {
                    if (pendingCashout.goldPlaced) {
                        const player = getOrCreatePlayer(playerName);
                        const amount = pendingCashout.goldAmount;
                        player.balance -= amount;
                        if (player.balance < 0)
                            player.balance = 0;
                        player.totalWithdrawn += amount;
                        player.lastActive = Date.now();
                        ledgerRecordWithdrawal(amount);
                        saveSlots();
                        if (sendWhisperFn) {
                            sendWhisperFn(playerName, 'Cashed out ' + amount + ' gold! Remaining balance: ' + player.balance);
                        }
                        console.log('[Slots] ' + playerName + ' cashed out ' + amount + ' gold (id=' + pendingCashout.cashoutId + '). Gold on hand: ' + goldOnHand);
                    }
                    else {
                        // Exchange completed before bot placed gold — trade failed, don't deduct
                        console.log('[Slots] Cashout for ' + playerName + ' completed before gold was placed — no deduction (id=' + pendingCashout.cashoutId + ')');
                        if (sendWhisperFn) {
                            sendWhisperFn(playerName, 'Cashout failed — please try again. Your balance is unchanged.');
                        }
                    }
                    pendingCashout = null;
                    activeExchange = null;
                    emitUpdate();
                }
                else if (goldAmount > 0) {
                    if (bankDepositPending.has(playerKey)) {
                        // Bank deposit — gold stays in bot inventory, no player credit
                        bankDepositPending.delete(playerKey);
                        if (sendWhisperFn) {
                            sendWhisperFn(playerName, 'Bank deposit received: ' + goldAmount + ' gold added to house reserves.');
                        }
                        console.log('[Slots] BANK DEPOSIT from ' + playerName + ': ' + goldAmount + ' gold (house reserves). Gold on hand: ' + goldOnHand);
                        activeExchange = null;
                        emitUpdate();
                    }
                    else {
                        // Normal player deposit — credit their balance
                        const player = getOrCreatePlayer(playerName);
                        player.balance += goldAmount;
                        player.totalDeposited += goldAmount;
                        player.lastActive = Date.now();
                        ledgerRecordDeposit(goldAmount);
                        saveSlots();
                        if (sendWhisperFn) {
                            sendWhisperFn(playerName, 'Deposited ' + goldAmount + ' gold. Balance: ' + player.balance + '. Whisper "spin" to play!');
                        }
                        console.log('[Slots] ' + playerName + ' deposited ' + goldAmount + ' gold. Balance: ' + player.balance + '. Gold on hand: ' + goldOnHand);
                        activeExchange = null;
                        emitUpdate();
                    }
                }
                else {
                    activeExchange = null;
                }
            }
        }
        else {
            console.log('[Slots] Unhandled 0x42 type: 0x' + ('0' + type.toString(16)).slice(-2));
        }
    }
    catch (e) {
        console.log('[Slots] Error handling 0x42: ' + e.message);
    }
    packet.position = saved;
}
function handleExchangeSlot(packet) {
    const saved = packet.position;
    try {
        const type = packet.readByte();
        const slotInfo = packet.readByte();
        const unknown = packet.readByte();
        const slot = packet.readByte();
        console.log('[Slots] Exchange slot update: type=' + type + ' slot=' + slot);
    }
    catch (e) {
        console.log('[Slots] Error handling 0x4B: ' + e.message);
    }
    packet.position = saved;
}
function handleAddItem(packet) {
    const saved = packet.position;
    try {
        const slot = packet.readByte();
        const sprite = packet.readUInt16();
        const color = packet.readByte();
        const name = packet.readString8();
        // For balloons: don't overwrite — equipSlot() tracks the swaps locally.
        // Server events arrive out of order and would desync our tracking.
        // For non-balloons (gold etc.): accept normally.
        if (isBalloonItem(name)) {
            console.log('[Slots] Inventory add (balloon, kept local tracking): slot ' + slot + ' = ' + name);
        }
        else {
            botInventory.set(slot, name);
            console.log('[Slots] Inventory add: slot ' + slot + ' = ' + name);
        }
    }
    catch (e) {
        console.log('[Slots] Error handling 0x37: ' + e.message);
    }
    packet.position = saved;
}
/**
 * Handle incoming 0x0F packet (Inventory item)
 * Sent on login for each item in inventory — same format as 0x37.
 * Format: [slot:1] [sprite:2] [color:1] [name:string8] ...trailing bytes
 */
function handleInventoryItem(packet) {
    const saved = packet.position;
    try {
        const slot = packet.readByte();
        const sprite = packet.readUInt16();
        const color = packet.readByte();
        const name = packet.readString8();
        botInventory.set(slot, name);
        console.log('[Slots] Inventory item (0x0F): slot ' + slot + ' = ' + name);
        // After each inventory item loads, try to infer what's equipped
        inferEquippedBalloon();
    }
    catch (e) {
        console.log('[Slots] Error handling 0x0F: ' + e.message);
    }
    packet.position = saved;
}
function handleRemoveItem(packet) {
    const saved = packet.position;
    try {
        const slot = packet.readByte();
        const removedName = botInventory.get(slot) || null;
        // For balloons: don't delete from inventory — we track the swap locally
        // via equipSlot(). The balloon went to hand, it's not gone.
        // For non-balloons (gold etc.): delete normally.
        if (removedName && isBalloonItem(removedName)) {
            console.log('[Slots] Inventory remove (balloon, kept in tracking): slot ' + slot + ' (' + removedName + ')');
        }
        else {
            botInventory.delete(slot);
            console.log('[Slots] Inventory remove: slot ' + slot + (removedName ? ' (' + removedName + ')' : ''));
        }
    }
    catch (e) {
        console.log('[Slots] Error handling 0x38: ' + e.message);
    }
    packet.position = saved;
}
// ── Whisper Command Handler ──────────────────────────────────────
function handleWhisper(senderName, message) {
    const trimmed = message.trim().toLowerCase();
    if (trimmed === 'help' || trimmed === 'slots') {
        if (sendWhisperFn) {
            sendWhisperFn(senderName, 'Slot Machine! Trade me Gold to load credits.');
            setTimeout(() => {
                if (sendWhisperFn)
                    sendWhisperFn(senderName, 'Commands: spin, bet, balance, cashout');
            }, 500);
            setTimeout(() => {
                if (sendWhisperFn)
                    sendWhisperFn(senderName, 'Green Polyp = 2x, Polyp Bunch = 5x jackpot!');
            }, 1000);
        }
        return true;
    }
    if (trimmed === 'balance' || trimmed === 'bal') {
        const player = getOrCreatePlayer(senderName);
        if (sendWhisperFn) {
            sendWhisperFn(senderName, 'Balance: ' + player.balance + ' | Bet: ' + player.bet + ' | Spins: ' + player.totalSpins);
            setTimeout(() => {
                if (sendWhisperFn) {
                    sendWhisperFn(senderName, 'Won: ' + player.totalWon + ' | Lost: ' + player.totalLost);
                }
            }, 500);
        }
        return true;
    }
    // Bet command: "bet 500", "bet 1000", etc. — anyone can set their bet
    if (trimmed.startsWith('bet')) {
        const player = getOrCreatePlayer(senderName);
        const parts = trimmed.split(/\s+/);
        if (parts.length < 2) {
            if (sendWhisperFn) {
                sendWhisperFn(senderName, 'Current bet: ' + player.bet + ' | Balance: ' + player.balance);
            }
            return true;
        }
        const amount = parseInt(parts[1]);
        if (isNaN(amount) || amount <= 0) {
            if (sendWhisperFn)
                sendWhisperFn(senderName, 'Invalid bet. Example: bet 500');
            return true;
        }
        if (amount > player.balance) {
            if (sendWhisperFn)
                sendWhisperFn(senderName, 'Bet too high! Balance: ' + player.balance);
            return true;
        }
        player.bet = amount;
        saveSlots();
        if (sendWhisperFn)
            sendWhisperFn(senderName, 'Bet set to ' + amount + ' gold per spin.');
        return true;
    }
    // Spin — anyone with balance can spin. One at a time, auto-queued.
    if (trimmed === 'spin') {
        executeSpin(senderName);
        return true;
    }
    // Cashout — anyone with balance can cashout
    if (trimmed === 'cashout' || trimmed === 'cash out') {
        executeCashout(senderName);
        return true;
    }
    // GM bank deposit — next trade goes to house reserves, not player balance
    if (trimmed === 'deposit') {
        bankDepositPending.add(senderName.toLowerCase());
        if (sendWhisperFn) {
            sendWhisperFn(senderName, 'Bank deposit mode. Trade me gold now — it will go to the house, not your balance.');
        }
        return true;
    }
    if (trimmed === 'leave' || trimmed === 'quit') {
        removeFromQueue(senderName);
        const player = getOrCreatePlayer(senderName);
        if (sendWhisperFn) {
            sendWhisperFn(senderName, 'Left. Balance of ' + player.balance + ' saved. Come back anytime!');
        }
        return true;
    }
    return false;
}
// ── Spin Logic ───────────────────────────────────────────────────
let spinningPlayer = null; // who is currently spinning
function executeSpin(senderName) {
    const player = getOrCreatePlayer(senderName);
    // Must have balance
    if (player.balance <= 0) {
        if (sendWhisperFn)
            sendWhisperFn(senderName, 'Trade me Gold first!');
        return;
    }
    // If someone is already spinning, queue this player
    if (spinningPlayer) {
        // Already in queue?
        const pos = getQueuePosition(senderName);
        if (pos > 0) {
            if (sendWhisperFn)
                sendWhisperFn(senderName, 'You are #' + pos + ' in line.');
            return;
        }
        // Is this the spinning player?
        if (spinningPlayer.toLowerCase() === senderName.toLowerCase()) {
            if (sendWhisperFn)
                sendWhisperFn(senderName, 'Wait for your spin to finish!');
            return;
        }
        // Add to queue
        let playerSerial = 0;
        if (getSerialByNameFn)
            playerSerial = getSerialByNameFn(senderName);
        const entry = {
            playerName: senderName,
            playerSerial: playerSerial,
            joinedAt: Date.now(),
            bet: player.bet,
            idleTimer: null
        };
        waitingQueue.push(entry);
        const newPos = waitingQueue.length;
        if (sendWhisperFn)
            sendWhisperFn(senderName, 'Spinning! You are #' + newPos + ' in line.');
        emitUpdate();
        return;
    }
    // Must have all 4 balloons
    if (!hasAllBalloons()) {
        const missing = getMissingBalloons();
        if (sendWhisperFn) {
            sendWhisperFn(senderName, 'Machine is missing items: ' + missing.join(', ') + '. Please contact an admin.');
        }
        return;
    }
    const betAmount = player.bet;
    if (player.balance < betAmount) {
        if (sendWhisperFn) {
            sendWhisperFn(senderName, 'Not enough! Balance: ' + player.balance + ', Bet: ' + betAmount);
        }
        return;
    }
    // Bank protection: check reserves before allowing spin
    const guardMsg = getSpinGuard(betAmount);
    if (guardMsg) {
        if (sendWhisperFn)
            sendWhisperFn(senderName, guardMsg);
        return;
    }
    // Deduct and spin
    player.balance -= betAmount;
    player.totalSpins++;
    player.lastActive = Date.now();
    spinningPlayer = senderName;
    const targetSymbol = pickSymbol(senderName);
    const symbolOrder = slotConfig.symbols.map(s => s.name);
    const targetIndex = symbolOrder.findIndex(n => n.toLowerCase() === targetSymbol.name.toLowerCase());
    currentSpinId++;
    spinQueue = [];
    spinCallback = null;
    for (let i = 0; i < symbolOrder.length; i++) {
        spinQueue.push({ name: symbolOrder[i], isLast: false });
    }
    for (let i = 0; i <= targetIndex; i++) {
        const isLast = i === targetIndex;
        spinQueue.push({ name: symbolOrder[i], isLast });
    }
    spinCallback = (confirmedName) => {
        equippedItem = confirmedName;
        const landedSymbol = slotConfig.symbols.find(s => s.name.toLowerCase() === confirmedName.toLowerCase()) || slotConfig.symbols[0];
        const payout = landedSymbol.multiplier * betAmount;
        const outcome = landedSymbol.name === 'Polyp Bunch' && landedSymbol.multiplier > 0 ? 'jackpot' :
            landedSymbol.multiplier > 1 ? 'win' :
                landedSymbol.multiplier === 1 ? 'push' : 'lose';
        player.balance += payout;
        if (outcome === 'win' || outcome === 'jackpot') {
            player.totalWon++;
        }
        else if (outcome === 'lose') {
            player.totalLost++;
        }
        if (outcome === 'jackpot')
            recordJackpot(senderName);
        let resultMsg = '';
        if (outcome === 'jackpot') {
            resultMsg = '{=w JACKPOT!!! ' + landedSymbol.name + '! Won ' + payout + '! Balance: ' + player.balance;
        }
        else if (outcome === 'win') {
            resultMsg = '{=q Winner! ' + landedSymbol.name + '! Won ' + payout + '! Balance: ' + player.balance;
        }
        else if (outcome === 'push') {
            resultMsg = '{=c ' + landedSymbol.name + ' - bet returned! Balance: ' + player.balance;
        }
        else {
            resultMsg = '{=b ' + landedSymbol.name + ' - no luck. Balance: ' + player.balance;
        }
        if (sendWhisperFn)
            sendWhisperFn(senderName, resultMsg);
        spinHistory.push({
            playerName: senderName,
            reel: [landedSymbol.name, landedSymbol.name, landedSymbol.name],
            outcome, payout, cost: betAmount, timestamp: Date.now()
        });
        ledgerRecordSpin(betAmount, payout);
        if (spinHistory.length > MAX_SPIN_HISTORY) {
            spinHistory = spinHistory.slice(-MAX_SPIN_HISTORY);
        }
        spinningPlayer = null;
        saveSlots();
        emitUpdate();
        // Auto-spin next player in queue
        processSpinQueue();
    };
    if (sendWhisperFn)
        sendWhisperFn(senderName, 'Spinning...');
    advanceSpinQueue();
}
/** Process the next player in the spin queue automatically */
function processSpinQueue() {
    while (waitingQueue.length > 0) {
        const next = waitingQueue.shift();
        if (next.idleTimer)
            clearTimeout(next.idleTimer);
        const player = playerStates.get(next.playerName.toLowerCase());
        if (!player || player.balance <= 0)
            continue;
        // Auto-spin for this player
        executeSpin(next.playerName);
        return;
    }
}
// ── Cashout Logic ────────────────────────────────────────────────
// Cashout: player trades 1 gold coin (fee) to the bot.
// When the exchange completes, the bot marks the cashout as pending.
// The player then trades again — bot places the cashout gold and confirms.
// Flow:
//   1. Player whispers "cashout"
//   2. Bot whispers: "Trade me 1 coin to cashout. I'll give you X gold."
//   3. Player initiates trade, drops 1 gold → exchange completes
//   4. Bot sets pendingCashout, whispers: "Now trade me again to receive your gold."
//   5. Player initiates trade again → bot accepts, places gold, confirms
function executeCashout(senderName) {
    if (pendingCashout) {
        if (sendWhisperFn)
            sendWhisperFn(senderName, 'A cashout is in progress. Try again in a moment.');
        return;
    }
    const player = getOrCreatePlayer(senderName);
    if (player.balance <= 0) {
        if (sendWhisperFn)
            sendWhisperFn(senderName, 'No balance to cash out!');
        return;
    }
    cashoutRequested.add(senderName.toLowerCase());
    if (sendWhisperFn) {
        sendWhisperFn(senderName, 'Cashout: ' + player.balance + ' gold. 1 coin fee. Trade me to collect!');
    }
}
// ── State Getters ────────────────────────────────────────────────
function getSlotState() {
    const players = [];
    playerStates.forEach((state) => {
        players.push({
            playerName: state.playerName,
            balance: state.balance,
            totalDeposited: state.totalDeposited,
            totalWithdrawn: state.totalWithdrawn,
            totalSpins: state.totalSpins,
            totalWon: state.totalWon,
            totalLost: state.totalLost,
            net: state.totalDeposited - state.totalWithdrawn
        });
    });
    // Calculate financials: total deposited vs total withdrawn + outstanding balances
    let totalDeposited = 0;
    let totalWithdrawn = 0;
    let totalOutstandingBalance = 0;
    let totalSpinsAll = 0;
    let totalPayoutsAll = 0;
    let totalBetsAll = 0;
    playerStates.forEach((state) => {
        totalDeposited += state.totalDeposited;
        totalWithdrawn += state.totalWithdrawn;
        totalOutstandingBalance += state.balance;
        totalSpinsAll += state.totalSpins;
    });
    // Calculate total bets and payouts from spin history
    for (const s of spinHistory) {
        totalBetsAll += s.cost;
        totalPayoutsAll += s.payout;
    }
    return {
        config: slotConfig,
        spinningPlayer: spinningPlayer,
        botGoldCount: goldOnHand,
        dynamicMaxBet: Math.max(0, Math.floor(goldOnHand / 20)),
        bankLow: goldOnHand < MIN_BOT_BALANCE,
        equippedItem: equippedItem,
        balloonsReady: hasAllBalloons(),
        missingBalloons: getMissingBalloons(),
        queue: waitingQueue.map((q, i) => ({
            playerName: q.playerName,
            position: i + 1,
            joinedAt: q.joinedAt,
            bet: q.bet
        })),
        queueLength: waitingQueue.length,
        players: players,
        spinHistory: spinHistory.slice(-20),
        pendingCashout: !!pendingCashout,
        financials: {
            totalDeposited,
            totalWithdrawn,
            totalOutstandingBalance,
            houseProfit: totalDeposited - totalWithdrawn - totalOutstandingBalance,
            totalBets: totalBetsAll,
            totalPayouts: totalPayoutsAll,
            houseEdge: totalBetsAll - totalPayoutsAll,
            totalSpins: totalSpinsAll,
            totalAssets: goldOnHand + bankBalance,
            insolvent: totalOutstandingBalance > goldOnHand + bankBalance,
            ledger: getLedgerStats(),
        },
        banking: {
            phase: bankingState ? bankingState.phase : 'idle',
            action: bankingState ? bankingState.action : null,
            amount: bankingState ? bankingState.amount : 0,
            bankBalance: bankBalance,
            goldOnHand: goldOnHand,
            config: getBankingConfig()
        },
        offload: pendingOffload ? {
            targetName: pendingOffload.targetName,
            phase: pendingOffload.phase,
            totalRequested: pendingOffload.totalRequested,
            totalTransferred: pendingOffload.totalTransferred,
            currentBatch: pendingOffload.currentBatchAmount,
            errorMessage: pendingOffload.errorMessage
        } : null,
        tickets: {
            history: ticketHistory.slice(-50),
            stats: {
                totalTickets: ticketHistory.length,
                totalSpent: ticketHistory.reduce((sum, t) => sum + t.cost, 0),
                totalWon: ticketHistory.reduce((sum, t) => sum + t.prize, 0),
                totalProfit: ticketHistory.reduce((sum, t) => sum + (t.cost - t.prize), 0),
            }
        }
    };
}
function getPlayerState(name) {
    return playerStates.get(name.toLowerCase()) || null;
}
// ── Web Spin (no in-game animation) ─────────────────────────────
function webSpin(playerName, betAmount) {
    if (!slotConfig.enabled) {
        return { error: 'Slot machine is currently disabled.' };
    }
    const player = getOrCreatePlayer(playerName);
    const bet = betAmount || player.bet || slotConfig.spinCost;
    if (player.balance <= 0) {
        return { error: 'No balance. Deposit gold in-game first.' };
    }
    if (player.balance < bet) {
        return { error: 'Insufficient balance. Balance: ' + player.balance + ', Bet: ' + bet };
    }
    // Bank protection: check reserves before allowing spin
    const guardMsg = getSpinGuard(bet);
    if (guardMsg) {
        return { error: guardMsg };
    }
    // Deduct bet
    player.balance -= bet;
    player.totalSpins++;
    player.lastActive = Date.now();
    // Pick result (same weighted random as in-game)
    const symbol = pickSymbol(playerName);
    const payout = symbol.multiplier * bet;
    const outcome = symbol.name === 'Polyp Bunch' && symbol.multiplier > 0 ? 'jackpot' :
        symbol.multiplier > 1 ? 'win' :
            symbol.multiplier === 1 ? 'push' : 'lose';
    player.balance += payout;
    if (outcome === 'win' || outcome === 'jackpot')
        player.totalWon++;
    else if (outcome === 'lose')
        player.totalLost++;
    if (outcome === 'jackpot')
        recordJackpot(playerName);
    // Record history
    spinHistory.push({
        playerName,
        reel: [symbol.name, symbol.name, symbol.name],
        outcome, payout, cost: bet, timestamp: Date.now()
    });
    ledgerRecordSpin(bet, payout);
    if (spinHistory.length > MAX_SPIN_HISTORY) {
        spinHistory = spinHistory.slice(-MAX_SPIN_HISTORY);
    }
    saveSlots();
    emitUpdate();
    return {
        reel: [symbol.name, symbol.name, symbol.name],
        outcome, payout, newBalance: player.balance, cost: bet
    };
}
// ── Web Set Bet ─────────────────────────────────────────────────
function webSetBet(playerName, amount) {
    if (!amount || amount <= 0) {
        return { error: 'Bet must be greater than 0.' };
    }
    const player = getOrCreatePlayer(playerName);
    if (amount > player.balance) {
        return { error: 'Bet too high! Balance: ' + player.balance };
    }
    player.bet = amount;
    saveSlots();
    emitUpdate();
    return { bet: player.bet, balance: player.balance };
}
// ── Wheel Spin ──────────────────────────────────────────────────
function wheelSpin(playerName) {
    const player = getOrCreatePlayer(playerName);
    // Cooldown check
    if (player.lastWheelSpin > 0) {
        const nextSpinAt = player.lastWheelSpin + WHEEL_COOLDOWN_MS;
        if (Date.now() < nextSpinAt) {
            return { error: 'Already spun today', nextSpinAt: new Date(nextSpinAt).toISOString() };
        }
    }
    // Weighted random selection
    const roll = Math.random() * WHEEL_TOTAL_WEIGHT;
    let cumulative = 0;
    let segmentIndex = 0;
    for (let i = 0; i < WHEEL_SEGMENTS.length; i++) {
        cumulative += WHEEL_SEGMENTS[i].weight;
        if (roll < cumulative) {
            segmentIndex = i;
            break;
        }
    }
    const prize = WHEEL_SEGMENTS[segmentIndex].prize;
    // Bank protection: if prize > 0 and bot can't cover it, reject
    if (prize > 0 && prize > goldOnHand + bankBalance) {
        return { error: 'Wheel temporarily unavailable — reserves too low' };
    }
    // Apply prize
    player.balance += prize;
    player.lastWheelSpin = Date.now();
    player.wheelTotalSpins++;
    player.wheelTotalWon += prize;
    player.wheelHistory.unshift({ segmentIndex, prize, timestamp: Date.now() });
    if (player.wheelHistory.length > MAX_WHEEL_HISTORY) {
        player.wheelHistory = player.wheelHistory.slice(0, MAX_WHEEL_HISTORY);
    }
    player.lastActive = Date.now();
    saveSlots();
    emitUpdate();
    console.log('[Wheel] ' + playerName + ' spun → segment ' + segmentIndex + ' prize=' + prize + ' balance=' + player.balance);
    const nextSpinAt = new Date(player.lastWheelSpin + WHEEL_COOLDOWN_MS).toISOString();
    return { segmentIndex, prize, newBalance: player.balance, nextSpinAt };
}
function wheelStatus(playerName) {
    const player = playerStates.get(playerName.toLowerCase());
    if (!player) {
        return { canSpin: true, nextSpinAt: null, totalSpins: 0, totalWon: 0, lastPrize: null };
    }
    const now = Date.now();
    const nextSpinAt = player.lastWheelSpin > 0 ? player.lastWheelSpin + WHEEL_COOLDOWN_MS : 0;
    const canSpin = nextSpinAt === 0 || now >= nextSpinAt;
    const lastEntry = player.wheelHistory && player.wheelHistory.length > 0 ? player.wheelHistory[0] : null;
    return {
        canSpin,
        nextSpinAt: canSpin ? null : new Date(nextSpinAt).toISOString(),
        totalSpins: player.wheelTotalSpins || 0,
        totalWon: player.wheelTotalWon || 0,
        lastPrize: lastEntry ? lastEntry.prize : null,
    };
}
function wheelHistory(playerName) {
    const player = playerStates.get(playerName.toLowerCase());
    if (!player || !player.wheelHistory)
        return { history: [] };
    return { history: player.wheelHistory.slice(0, MAX_WHEEL_HISTORY) };
}
// ── Config Management ────────────────────────────────────────────
function getConfig() {
    return { ...slotConfig };
}
function saveConfigUpdate(update) {
    if (update.enabled !== undefined)
        slotConfig.enabled = !!update.enabled;
    if (update.spinCost !== undefined && update.spinCost > 0)
        slotConfig.spinCost = update.spinCost;
    if (update.symbols && Array.isArray(update.symbols))
        slotConfig.symbols = update.symbols;
    saveSlots();
    emitUpdate();
    return { ...slotConfig };
}
// ── Banking Config ───────────────────────────────────────────
function getBankingConfig() {
    // Include dynamically resolved serial so panel shows the live value
    let resolvedSerial = 0;
    if (getSerialByNameFn) {
        resolvedSerial = getSerialByNameFn(bankingConfig.bankerName) || 0;
    }
    return { ...bankingConfig, bankBalance, goldOnHand, resolvedSerial };
}
function saveBankingConfigUpdate(update) {
    if (update.enabled !== undefined)
        bankingConfig.enabled = !!update.enabled;
    if (update.bankerName && typeof update.bankerName === 'string')
        bankingConfig.bankerName = update.bankerName;
    if (typeof update.bankerSerial === 'number' && update.bankerSerial >= 0)
        bankingConfig.bankerSerial = update.bankerSerial;
    if (typeof update.highWatermark === 'number' && update.highWatermark > 0)
        bankingConfig.highWatermark = update.highWatermark;
    if (typeof update.lowWatermark === 'number' && update.lowWatermark >= 0)
        bankingConfig.lowWatermark = update.lowWatermark;
    if (typeof update.depositTarget === 'number' && update.depositTarget > 0)
        bankingConfig.depositTarget = update.depositTarget;
    if (typeof update.withdrawTarget === 'number' && update.withdrawTarget > 0)
        bankingConfig.withdrawTarget = update.withdrawTarget;
    if (typeof update.checkIntervalMs === 'number' && update.checkIntervalMs >= 5000)
        bankingConfig.checkIntervalMs = update.checkIntervalMs;
    if (typeof update.timeoutMs === 'number' && update.timeoutMs >= 3000)
        bankingConfig.timeoutMs = update.timeoutMs;
    if (typeof update.maxRetries === 'number' && update.maxRetries >= 0)
        bankingConfig.maxRetries = update.maxRetries;
    if (typeof update.goldOnHand === 'number' && update.goldOnHand >= 0)
        goldOnHand = update.goldOnHand;
    if (typeof update.bankBalance === 'number' && update.bankBalance >= 0)
        bankBalance = update.bankBalance;
    // Manual deposit/withdraw triggers
    if (typeof update.manualDeposit === 'number' && update.manualDeposit > 0) {
        if (bankingState) {
            abortBanking('manual deposit requested');
        }
        initiateBanking('deposit', update.manualDeposit);
    }
    if (typeof update.manualWithdraw === 'number' && update.manualWithdraw > 0) {
        if (bankingState) {
            abortBanking('manual withdraw requested');
        }
        initiateBanking('withdraw', update.manualWithdraw);
    }
    saveSlots();
    startBankingCheckLoop(); // restart loop with new interval
    emitUpdate();
    return { ...bankingConfig, bankBalance, goldOnHand };
}
// ── Admin Actions ────────────────────────────────────────────────
function forceEndSession() {
    if (!spinningPlayer) {
        return { success: false, message: 'No one is spinning.' };
    }
    const name = spinningPlayer;
    spinningPlayer = null;
    spinQueue = [];
    spinCallback = null;
    pendingCashout = null;
    activeExchange = null;
    if (sendWhisperFn) {
        sendWhisperFn(name, 'Spin cancelled by admin. Your balance is saved.');
    }
    emitUpdate();
    return { success: true, message: 'Spin ended for ' + name };
}
function forceClearQueue() {
    const count = waitingQueue.length;
    for (const entry of waitingQueue) {
        if (entry.idleTimer)
            clearTimeout(entry.idleTimer);
        if (sendWhisperFn) {
            sendWhisperFn(entry.playerName, 'Queue cleared by admin. Your balance is saved.');
        }
    }
    waitingQueue = [];
    emitUpdate();
    return { success: true, message: 'Cleared ' + count + ' players from queue.' };
}
const TICKET_TIERS = {
    bronze: {
        cost: 10_000,
        prizes: [
            { symbol: 'nothing', amount: 0, weight: 55 },
            { symbol: '5k', amount: 5_000, weight: 24 },
            { symbol: '10k', amount: 10_000, weight: 14 },
            { symbol: '25k', amount: 25_000, weight: 5.5 },
            { symbol: '100k', amount: 100_000, weight: 1.2 },
            { symbol: '500k', amount: 500_000, weight: 0.3 },
        ],
    },
    silver: {
        cost: 100_000,
        prizes: [
            { symbol: 'nothing', amount: 0, weight: 55 },
            { symbol: '50k', amount: 50_000, weight: 23 },
            { symbol: '100k', amount: 100_000, weight: 14 },
            { symbol: '250k', amount: 250_000, weight: 6 },
            { symbol: '1m', amount: 1_000_000, weight: 1.5 },
            { symbol: '2.5m', amount: 2_500_000, weight: 0.5 },
        ],
    },
    gold: {
        cost: 1_000_000,
        prizes: [
            { symbol: 'nothing', amount: 0, weight: 55 },
            { symbol: '500k', amount: 500_000, weight: 22 },
            { symbol: '1m', amount: 1_000_000, weight: 14 },
            { symbol: '2.5m', amount: 2_500_000, weight: 7 },
            { symbol: '10m', amount: 10_000_000, weight: 1.8 },
            { symbol: '25m', amount: 25_000_000, weight: 0.2 },
        ],
    },
};
let ticketHistory = [];
const MAX_TICKET_HISTORY = 200;
const TICKETS_FILE = path_1.default.join(DATA_DIR, 'tickets.json');
function loadTickets() {
    try {
        if (fs_1.default.existsSync(TICKETS_FILE)) {
            const raw = JSON.parse(fs_1.default.readFileSync(TICKETS_FILE, 'utf8'));
            if (raw.history)
                ticketHistory = raw.history;
            console.log('[Tickets] Loaded ' + ticketHistory.length + ' history entries');
        }
    }
    catch (e) {
        console.log('[Tickets] Failed to load: ' + e.message);
    }
}
function saveTickets() {
    try {
        if (!fs_1.default.existsSync(DATA_DIR))
            fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
        fs_1.default.writeFileSync(TICKETS_FILE, JSON.stringify({ history: ticketHistory.slice(-MAX_TICKET_HISTORY) }, null, 2));
    }
    catch (e) {
        console.log('[Tickets] Failed to save: ' + e.message);
    }
}
let lastJackpotDate = ''; // YYYY-MM-DD of last top-prize hit — max 1 per day
function pickTicketPrize(tier) {
    const today = new Date().toISOString().slice(0, 10);
    const jackpotCapped = lastJackpotDate === today;
    // If 50m already hit today, remove it from the pool
    const prizes = jackpotCapped
        ? tier.prizes.filter(p => p.amount !== 25_000_000)
        : tier.prizes;
    const totalWeight = prizes.reduce((sum, p) => sum + p.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const prize of prizes) {
        roll -= prize.weight;
        if (roll <= 0) {
            if (prize.amount === 25_000_000) {
                lastJackpotDate = today;
                console.log('[Tickets] 25M JACKPOT HIT — capped for rest of ' + today);
            }
            return { symbol: prize.symbol, amount: prize.amount };
        }
    }
    return prizes[0]; // fallback: nothing
}
function buildTicketGrid(winSymbol, isWin, tierPrizes) {
    const grid = new Array(9);
    if (isWin) {
        // Place 3 matching symbols in random positions
        const positions = [0, 1, 2, 3, 4, 5, 6, 7, 8];
        for (let i = positions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [positions[i], positions[j]] = [positions[j], positions[i]];
        }
        const matchPositions = positions.slice(0, 3);
        for (const pos of matchPositions) {
            grid[pos] = winSymbol;
        }
        // Fill remaining with non-matching symbols (no symbol can appear 3+ times)
        const otherSymbols = tierPrizes
            .filter(p => p.symbol !== winSymbol && p.symbol !== 'nothing')
            .map(p => p.symbol);
        const counts = {};
        for (let i = 0; i < 9; i++) {
            if (grid[i])
                continue;
            // Pick a random non-matching symbol that hasn't appeared twice yet
            const available = otherSymbols.filter(s => (counts[s] || 0) < 2);
            if (available.length === 0) {
                grid[i] = 'nothing';
            }
            else {
                const pick = available[Math.floor(Math.random() * available.length)];
                grid[i] = pick;
                counts[pick] = (counts[pick] || 0) + 1;
            }
        }
    }
    else {
        // No symbol can appear 3+ times
        const allSymbols = tierPrizes.map(p => p.symbol);
        const counts = {};
        for (let i = 0; i < 9; i++) {
            const available = allSymbols.filter(s => (counts[s] || 0) < 2);
            const pick = available[Math.floor(Math.random() * available.length)];
            grid[i] = pick;
            counts[pick] = (counts[pick] || 0) + 1;
        }
    }
    // Convert flat array to 3x3
    return [grid.slice(0, 3), grid.slice(3, 6), grid.slice(6, 9)];
}
function generateTicketId() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}
function buyTicket(playerName, tier) {
    const tierConfig = TICKET_TIERS[tier];
    if (!tierConfig)
        return { error: 'Invalid tier.' };
    if (!slotConfig.enabled)
        return { error: 'Games are currently disabled.' };
    const player = getOrCreatePlayer(playerName);
    if (player.balance < tierConfig.cost) {
        return { error: 'Insufficient balance. Need ' + tierConfig.cost + ' gold, have ' + player.balance + '.' };
    }
    // Solvency check: can bot cover max prize after accounting for outstanding balances?
    const maxPrize = Math.max(...tierConfig.prizes.map(p => p.amount));
    const totalOutstanding = getTotalOutstandingBalance();
    const totalAssets = goldOnHand + bankBalance;
    const availableForPrizes = totalAssets - totalOutstanding;
    if (availableForPrizes < maxPrize) {
        return { error: 'Scratch tickets temporarily unavailable (insufficient reserves).' };
    }
    if (goldOnHand < MIN_BOT_BALANCE) {
        return { error: 'Scratch tickets temporarily closed for maintenance.' };
    }
    // Deduct cost
    player.balance -= tierConfig.cost;
    player.lastActive = Date.now();
    // Pick outcome
    const prizeResult = pickTicketPrize(tierConfig);
    const isWin = prizeResult.amount > 0;
    const grid = buildTicketGrid(prizeResult.symbol, isWin, tierConfig.prizes);
    // Find matched positions
    const matchedPositions = [];
    if (isWin) {
        const flat = grid.flat();
        for (let i = 0; i < flat.length; i++) {
            if (flat[i] === prizeResult.symbol)
                matchedPositions.push(i);
        }
    }
    // Credit winnings
    player.balance += prizeResult.amount;
    // Update player stats for ticket activity
    player.totalDeposited += tierConfig.cost;
    player.totalSpins += 1;
    if (isWin) {
        player.totalWon += 1;
    }
    else {
        player.totalLost += 1;
    }
    const ticketId = generateTicketId();
    // Record history
    ticketHistory.push({
        ticketId, playerName, tier, cost: tierConfig.cost,
        outcome: isWin ? 'win' : 'lose',
        prize: prizeResult.amount, timestamp: Date.now()
    });
    ledgerRecordSpin(tierConfig.cost, prizeResult.amount);
    if (ticketHistory.length > MAX_TICKET_HISTORY) {
        ticketHistory = ticketHistory.slice(-MAX_TICKET_HISTORY);
    }
    saveSlots();
    saveTickets();
    emitUpdate();
    return {
        ticketId, tier, cost: tierConfig.cost, grid,
        outcome: isWin ? 'win' : 'lose',
        prize: prizeResult.amount,
        matchedSymbol: prizeResult.symbol,
        matchedPositions,
        newBalance: player.balance,
    };
}
function getTicketHistory(playerName) {
    const key = playerName.toLowerCase();
    const history = ticketHistory.filter(t => t.playerName.toLowerCase() === key);
    return {
        history,
        stats: {
            totalTickets: history.length,
            totalSpent: history.reduce((sum, t) => sum + t.cost, 0),
            totalWon: history.reduce((sum, t) => sum + t.prize, 0),
        },
    };
}
// Load ticket history on module init
loadTickets();
//# sourceMappingURL=slot-machine.js.map