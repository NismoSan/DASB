// @ts-nocheck
"use strict";
// ── Item Trade Module ─────────────────────────────────────────────
// Allows the bot to act as an item-for-item escrow.  An operator
// creates "trade offers" via the panel — each offer says:
//   "If a player gives me <wantItem>, I will give them <giveItem>."
//
// When a player opens an exchange with the bot and places the wanted
// item, the bot places the matching give-item from its inventory and
// confirms the trade automatically.
//
// Exchange protocol (Dark Ages):
//   0x42 IN  (type 0x00) — Incoming exchange request
//   0x42 IN  (type 0x02) — Item placed in their trade window
//   0x42 IN  (type 0x04) — Exchange cancelled / status
//   0x42 IN  (type 0x05) — Exchange completed
//   0x4B IN             — Exchange slot confirmation
//   0x4A OUT (type 0x05) — Accept exchange request
//   0x4A OUT (type 0x01) — Place item from inventory into trade
//   0x4A OUT (type 0x00) — Confirm / agree to trade
//   0x37 IN  (AddItem)   — Item added to our inventory
//   0x38 IN  (RemoveItem)— Item removed from inventory
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.init = init;
exports.handleExchangeMessage = handleExchangeMessage;
exports.handleExchangeSlot = handleExchangeSlot;
exports.handleAddItem = handleAddItem;
exports.handleRemoveItem = handleRemoveItem;
exports.handleWhisper = handleWhisper;
exports.addOffer = addOffer;
exports.removeOffer = removeOffer;
exports.toggleOffer = toggleOffer;
exports.getOffers = getOffers;
exports.getTradeLog = getTradeLog;
exports.getInventory = getInventory;
exports.hasActiveExchange = hasActiveExchange;
const packet_1 = __importDefault(require("../core/packet"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// ── Constants ────────────────────────────────────────────────────
const DATA_DIR = path_1.default.join(__dirname, '..', '..', 'data');
const OFFERS_FILE = path_1.default.join(DATA_DIR, 'trade-offers.json');
const LOG_FILE = path_1.default.join(DATA_DIR, 'trade-log.json');
const EXCHANGE_TIMEOUT_MS = 60 * 1000;
const ITEM_PLACE_DELAY_MS = 1000;
const CONFIRM_DELAY_MS = 1500;
// ── State ────────────────────────────────────────────────────────
let offers = [];
let tradeLog = [];
let activeExchange = null;
let botInventory = new Map(); // slot → itemName
// Dependencies (injected via init)
let sendPacketFn = null;
let sendWhisperFn = null;
let ioRef = null;
// ── Persistence ──────────────────────────────────────────────────
function saveOffers() {
    try {
        if (!fs_1.default.existsSync(DATA_DIR))
            fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
        fs_1.default.writeFileSync(OFFERS_FILE, JSON.stringify(offers, null, 2));
    }
    catch (e) {
        console.log('[ItemTrade] Failed to save offers: ' + e.message);
    }
}
function loadOffers() {
    try {
        if (fs_1.default.existsSync(OFFERS_FILE)) {
            offers = JSON.parse(fs_1.default.readFileSync(OFFERS_FILE, 'utf8'));
            console.log('[ItemTrade] Loaded ' + offers.length + ' trade offers');
        }
    }
    catch (e) {
        console.log('[ItemTrade] Failed to load offers: ' + e.message);
    }
}
function appendLog(entry) {
    tradeLog.push(entry);
    // Keep last 500 entries in memory
    if (tradeLog.length > 500)
        tradeLog = tradeLog.slice(-500);
    try {
        if (!fs_1.default.existsSync(DATA_DIR))
            fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
        // Append to file
        let existing = [];
        if (fs_1.default.existsSync(LOG_FILE)) {
            try {
                existing = JSON.parse(fs_1.default.readFileSync(LOG_FILE, 'utf8'));
            }
            catch (_) { /* ignore */ }
        }
        existing.push(entry);
        // Keep last 1000 on disk
        if (existing.length > 1000)
            existing = existing.slice(-1000);
        fs_1.default.writeFileSync(LOG_FILE, JSON.stringify(existing, null, 2));
    }
    catch (e) {
        console.log('[ItemTrade] Failed to write log: ' + e.message);
    }
}
// ── Helpers ──────────────────────────────────────────────────────
function generateId() {
    return 'to_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function normalizeItemName(name) {
    return name.trim().toLowerCase();
}
/** Find the first enabled offer whose wantItem matches the given item name */
function findMatchingOffer(itemName) {
    const norm = normalizeItemName(itemName);
    for (const offer of offers) {
        if (!offer.enabled)
            continue;
        if (normalizeItemName(offer.wantItem) === norm)
            return offer;
    }
    return null;
}
/** Find an inventory slot containing the given item name */
function findInventorySlot(itemName) {
    const norm = normalizeItemName(itemName);
    for (const [slot, name] of botInventory) {
        if (normalizeItemName(name) === norm)
            return slot;
    }
    return null;
}
// ── Init ─────────────────────────────────────────────────────────
function init(deps) {
    sendPacketFn = deps.sendPacket;
    sendWhisperFn = deps.sendWhisper;
    ioRef = deps.io;
    loadOffers();
    console.log('[ItemTrade] Initialized');
}
// ── Exchange Protocol Handlers ───────────────────────────────────
/**
 * Handle incoming 0x42 packet (Exchange messages)
 */
function handleExchangeMessage(packet) {
    const saved = packet.position;
    try {
        const type = packet.readByte();
        if (type === 0x00) {
            // ── Exchange request from a player ──
            const otherSerial = packet.readUInt32();
            const name = packet.readString8();
            console.log('[ItemTrade] Exchange request from "' + name + '" (serial 0x' + otherSerial.toString(16) + ')');
            // Only allow one exchange at a time
            if (activeExchange) {
                console.log('[ItemTrade] Already in an exchange, ignoring');
                packet.position = saved;
                return;
            }
            activeExchange = {
                playerName: name,
                playerSerial: otherSerial,
                itemsOffered: [],
                matchedOffer: null,
                botItemPlaced: false,
                startedAt: Date.now()
            };
            // Accept the exchange request: 0x4A [05] [serial:4]
            if (sendPacketFn) {
                const accept = new packet_1.default(0x4A);
                accept.writeByte(0x05);
                accept.writeUInt32(otherSerial);
                sendPacketFn(accept);
                console.log('[ItemTrade] Accepted exchange from ' + name);
            }
            // Timeout safety
            const capturedSerial = otherSerial;
            setTimeout(() => {
                if (activeExchange && activeExchange.playerSerial === capturedSerial) {
                    console.log('[ItemTrade] Exchange with ' + name + ' timed out');
                    activeExchange = null;
                }
            }, EXCHANGE_TIMEOUT_MS);
        }
        else if (type === 0x02) {
            // ── Item placed by the other player ──
            const slot = packet.readByte();
            const itemSprite = packet.readUInt16();
            const itemColor = packet.readByte();
            const itemName = packet.readString16();
            console.log('[ItemTrade] Item offered in slot ' + slot + ': "' + itemName + '"');
            if (!activeExchange) {
                packet.position = saved;
                return;
            }
            activeExchange.itemsOffered.push({ slot, itemName, sprite: itemSprite, color: itemColor });
            // Try to match against our trade offers
            const offer = findMatchingOffer(itemName);
            if (offer) {
                // Check if we have the give-item in inventory
                const giveSlot = findInventorySlot(offer.giveItem);
                if (giveSlot !== null) {
                    activeExchange.matchedOffer = offer;
                    console.log('[ItemTrade] Matched offer: "' + itemName + '" → "' + offer.giveItem + '" (inv slot ' + giveSlot + ')');
                    // Place our item after a short delay
                    setTimeout(() => {
                        if (!activeExchange || activeExchange.botItemPlaced)
                            return;
                        if (!sendPacketFn)
                            return;
                        const currentGiveSlot = findInventorySlot(offer.giveItem);
                        if (currentGiveSlot === null) {
                            console.log('[ItemTrade] Give item no longer in inventory!');
                            if (sendWhisperFn && activeExchange) {
                                sendWhisperFn(activeExchange.playerName, 'Sorry, I no longer have ' + offer.giveItem + ' to trade.');
                            }
                            return;
                        }
                        // Place item: 0x4A [01] [00] [serial:4] [slot:1]
                        const placeItem = new packet_1.default(0x4A);
                        placeItem.writeByte(0x01);
                        placeItem.writeByte(0x00);
                        placeItem.writeUInt32(activeExchange.playerSerial);
                        placeItem.writeByte(currentGiveSlot);
                        sendPacketFn(placeItem);
                        activeExchange.botItemPlaced = true;
                        console.log('[ItemTrade] Placed "' + offer.giveItem + '" from slot ' + currentGiveSlot);
                        // Now confirm the trade after another delay
                        setTimeout(() => {
                            if (!activeExchange || !sendPacketFn)
                                return;
                            // 0x4A [00] [00] [serial:4] — agree to trade
                            const agree = new packet_1.default(0x4A);
                            agree.writeByte(0x00);
                            agree.writeByte(0x00);
                            agree.writeUInt32(activeExchange.playerSerial);
                            sendPacketFn(agree);
                            console.log('[ItemTrade] Sent trade confirmation');
                        }, CONFIRM_DELAY_MS);
                    }, ITEM_PLACE_DELAY_MS);
                }
                else {
                    console.log('[ItemTrade] Matched offer but don\'t have "' + offer.giveItem + '" in inventory');
                    if (sendWhisperFn) {
                        sendWhisperFn(activeExchange.playerName, 'I want your ' + itemName + ' but I\'m out of ' + offer.giveItem + ' right now. Try again later!');
                    }
                }
            }
            else {
                console.log('[ItemTrade] No matching offer for "' + itemName + '"');
                if (sendWhisperFn) {
                    sendWhisperFn(activeExchange.playerName, 'I don\'t have a trade offer for ' + itemName + '. Whisper me "trades" to see available trades.');
                }
            }
        }
        else if (type === 0x04) {
            // ── Cancel / status message ──
            packet.readByte(); // unknown
            const message = packet.readString8();
            console.log('[ItemTrade] Exchange status: "' + message + '"');
            if (message.toLowerCase().includes('cancel')) {
                activeExchange = null;
            }
        }
        else if (type === 0x05) {
            // ── Exchange completed ──
            const subtype = packet.readByte();
            const message = packet.readString8();
            console.log('[ItemTrade] Exchange complete subtype=' + subtype + ': "' + message + '"');
            if (subtype === 0x01 && activeExchange) {
                // Final confirmation — log the trade
                if (activeExchange.matchedOffer) {
                    const offer = activeExchange.matchedOffer;
                    offer.totalTrades++;
                    saveOffers();
                    appendLog({
                        timestamp: Date.now(),
                        playerName: activeExchange.playerName,
                        offerId: offer.id,
                        wantItem: offer.wantItem,
                        giveItem: offer.giveItem
                    });
                    if (sendWhisperFn) {
                        sendWhisperFn(activeExchange.playerName, 'Trade complete! You gave me ' + offer.wantItem + ' and received ' + offer.giveItem + '.');
                    }
                    console.log('[ItemTrade] Trade completed: ' + activeExchange.playerName + ' gave "' + offer.wantItem + '" got "' + offer.giveItem + '"');
                    emitUpdate();
                }
                activeExchange = null;
            }
        }
    }
    catch (e) {
        console.log('[ItemTrade] Error handling 0x42: ' + e.message);
    }
    packet.position = saved;
}
/**
 * Handle incoming 0x4B packet (Exchange slot confirmation)
 */
function handleExchangeSlot(packet) {
    const saved = packet.position;
    try {
        const type = packet.readByte();
        const slotInfo = packet.readByte();
        const unknown = packet.readByte();
        const slot = packet.readByte();
        console.log('[ItemTrade] Exchange slot update: type=' + type + ' slot=' + slot);
    }
    catch (e) {
        console.log('[ItemTrade] Error handling 0x4B: ' + e.message);
    }
    packet.position = saved;
}
/**
 * Handle incoming 0x37 packet (AddItem) — track inventory
 */
function handleAddItem(packet) {
    const saved = packet.position;
    try {
        const slot = packet.readByte();
        const sprite = packet.readUInt16();
        const color = packet.readByte();
        const name = packet.readString8();
        botInventory.set(slot, name);
        console.log('[ItemTrade] Inventory add: slot ' + slot + ' = "' + name + '"');
    }
    catch (e) {
        console.log('[ItemTrade] Error handling 0x37: ' + e.message);
    }
    packet.position = saved;
}
/**
 * Handle incoming 0x38 packet (RemoveItem) — track inventory
 */
function handleRemoveItem(packet) {
    const saved = packet.position;
    try {
        const slot = packet.readByte();
        const removed = botInventory.get(slot) || '?';
        botInventory.delete(slot);
        console.log('[ItemTrade] Inventory remove: slot ' + slot + ' ("' + removed + '")');
    }
    catch (e) {
        console.log('[ItemTrade] Error handling 0x38: ' + e.message);
    }
    packet.position = saved;
}
/**
 * Handle whisper commands to the trade bot
 */
function handleWhisper(senderName, message) {
    const trimmed = message.trim().toLowerCase();
    if (trimmed === 'trades' || trimmed === 'trade' || trimmed === 'list') {
        const enabled = offers.filter(o => o.enabled);
        if (enabled.length === 0) {
            if (sendWhisperFn)
                sendWhisperFn(senderName, 'No trade offers available right now.');
        }
        else {
            // Send list, one per whisper (max 64 chars per whisper)
            for (const offer of enabled) {
                const giveSlot = findInventorySlot(offer.giveItem);
                const stock = giveSlot !== null ? 'In Stock' : 'Out of Stock';
                const msg = offer.wantItem + ' → ' + offer.giveItem + ' [' + stock + ']';
                if (sendWhisperFn)
                    sendWhisperFn(senderName, msg);
            }
        }
        return true;
    }
    return false;
}
// ── Offer Management (called from panel API) ─────────────────────
function addOffer(wantItem, giveItem) {
    if (!wantItem || !giveItem) {
        return { success: false, message: 'Both wantItem and giveItem are required.' };
    }
    // Check for duplicate
    const existingDupe = offers.find(o => normalizeItemName(o.wantItem) === normalizeItemName(wantItem) &&
        normalizeItemName(o.giveItem) === normalizeItemName(giveItem));
    if (existingDupe) {
        return { success: false, message: 'A trade offer for "' + wantItem + '" → "' + giveItem + '" already exists.' };
    }
    const offer = {
        id: generateId(),
        wantItem: wantItem.trim(),
        giveItem: giveItem.trim(),
        enabled: true,
        totalTrades: 0,
        createdAt: Date.now()
    };
    offers.push(offer);
    saveOffers();
    emitUpdate();
    console.log('[ItemTrade] Added offer: "' + wantItem + '" → "' + giveItem + '"');
    return { success: true, message: 'Trade offer created.', offer };
}
function removeOffer(offerId) {
    const index = offers.findIndex(o => o.id === offerId);
    if (index === -1) {
        return { success: false, message: 'Trade offer not found.' };
    }
    const removed = offers.splice(index, 1)[0];
    saveOffers();
    emitUpdate();
    console.log('[ItemTrade] Removed offer: "' + removed.wantItem + '" → "' + removed.giveItem + '"');
    return { success: true, message: 'Trade offer removed.' };
}
function toggleOffer(offerId) {
    const offer = offers.find(o => o.id === offerId);
    if (!offer) {
        return { success: false, message: 'Trade offer not found.' };
    }
    offer.enabled = !offer.enabled;
    saveOffers();
    emitUpdate();
    console.log('[ItemTrade] Toggled offer "' + offer.wantItem + '" → "' + offer.giveItem + '": ' + (offer.enabled ? 'enabled' : 'disabled'));
    return { success: true, message: 'Trade offer ' + (offer.enabled ? 'enabled' : 'disabled') + '.', enabled: offer.enabled };
}
function getOffers() {
    return offers;
}
function getTradeLog() {
    return tradeLog;
}
function getInventory() {
    const items = [];
    botInventory.forEach((name, slot) => {
        items.push({ slot, name });
    });
    items.sort((a, b) => a.slot - b.slot);
    return items;
}
function hasActiveExchange() {
    return activeExchange !== null;
}
// ── Socket.IO Updates ────────────────────────────────────────────
function emitUpdate() {
    if (ioRef) {
        ioRef.emit('itemTrade:update', {
            offers: offers,
            inventory: getInventory()
        });
    }
}
//# sourceMappingURL=item-trade.js.map