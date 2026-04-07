"use strict";
// ── Sense Bot Feature ────────────────────────────────────────────
// Automatically casts the Sense skill on players who walk in front
// of the sense bot, parses HP/MP from the chat response, and stores
// the results in the player database.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.init = init;
exports.updateBotPosition = updateBotPosition;
exports.updateBotDirection = updateBotDirection;
exports.clearEntities = clearEntities;
exports.onEntityAppeared = onEntityAppeared;
exports.onEntityWalk = onEntityWalk;
exports.onEntityRemoved = onEntityRemoved;
exports.handleChatMessage = handleChatMessage;
exports.handleSkillResponse = handleSkillResponse;
exports.getState = getState;
exports.setEnabled = setEnabled;
const packet_1 = __importDefault(require("../core/packet"));
const SENSE_SKILL_SLOT = 0x4A;
const SENSE_COOLDOWN_MS = 16000; // 16 seconds (server says 15, pad slightly)
const SENSE_RESCAN_MS = 5 * 60 * 1000; // don't re-sense same player within 5 minutes
const SENSE_RANGE = 3;
const state = {
    enabled: true,
    botDirection: 2, // default south
    botX: 0,
    botY: 0,
    lastSenseTime: 0,
    pendingTarget: null,
    recentlySensed: new Map(),
    entityPositions: new Map()
};
let sendPacketFn = null;
let onSenseResult = null;
function init(opts) {
    sendPacketFn = opts.sendPacket;
    onSenseResult = opts.onResult;
    console.log('[Sense] Initialized');
}
function updateBotPosition(x, y) {
    state.botX = x;
    state.botY = y;
}
function updateBotDirection(dir) {
    state.botDirection = dir;
}
function clearEntities() {
    state.entityPositions.clear();
    state.pendingTarget = null;
}
// Called when 0x33 (ShowUser) fires — entity appeared on screen
function onEntityAppeared(serial, name, x, y) {
    if (!state.enabled || !name)
        return;
    state.entityPositions.set(serial, { name, x, y });
    tryCast(name, x, y);
}
// Called when 0x0C (EntityWalk) fires — entity moved
function onEntityWalk(serial, x, y) {
    if (!state.enabled)
        return;
    const entity = state.entityPositions.get(serial);
    if (!entity)
        return;
    entity.x = x;
    entity.y = y;
    tryCast(entity.name, x, y);
}
// Called when 0x0E/0x08 (RemoveEntity) fires
function onEntityRemoved(serial) {
    state.entityPositions.delete(serial);
}
// Entity stepped on one of the 3 tiles in front — cast immediately
function tryCast(name, x, y) {
    if (!sendPacketFn)
        return;
    if (!isInFront(x, y))
        return;
    if (state.pendingTarget)
        return;
    const now = Date.now();
    if (now - state.lastSenseTime < SENSE_COOLDOWN_MS)
        return;
    const key = name.toLowerCase();
    const lastSensed = state.recentlySensed.get(key);
    if (lastSensed && now - lastSensed < SENSE_RESCAN_MS)
        return;
    state.pendingTarget = name;
    state.lastSenseTime = now;
    var pkt = new packet_1.default(0x3E);
    pkt.writeByte(SENSE_SKILL_SLOT);
    sendPacketFn(pkt);
    console.log('[Sense] Cast! target=' + name + ' at (' + x + ',' + y + ') dir=' + state.botDirection);
}
// Check if entity is on one of the 3 tiles directly in front of the bot
function isInFront(entityX, entityY) {
    const dx = entityX - state.botX;
    const dy = entityY - state.botY;
    switch (state.botDirection) {
        case 0: return dx === 0 && dy < 0 && dy >= -SENSE_RANGE;
        case 1: return dy === 0 && dx < 0 && dx >= -SENSE_RANGE;
        case 2: return dx === 0 && dy > 0 && dy <= SENSE_RANGE;
        case 3: return dy === 0 && dx > 0 && dx <= SENSE_RANGE;
        default: return false;
    }
}
// Called when 0x0A (Chat) fires on the sense bot — parse sense results
function handleChatMessage(channelByte, message) {
    if (message.indexOf('Sense User') === -1)
        return false;
    const nameMatch = message.match(/Name:\s*(\S+)/);
    const hpMatch = message.match(/HP:\s*(\d+)/);
    const mpMatch = message.match(/MP:\s*(\d+)/);
    if (nameMatch && hpMatch && mpMatch) {
        const name = nameMatch[1];
        const hp = parseInt(hpMatch[1], 10);
        const mp = parseInt(mpMatch[1], 10);
        state.recentlySensed.set(name.toLowerCase(), Date.now());
        state.pendingTarget = null;
        console.log('[Sense] Result: ' + name + ' HP=' + hp + ' MP=' + mp);
        if (onSenseResult) {
            onSenseResult(name, hp, mp);
        }
        // Clean up old entries from recentlySensed
        const cutoff = Date.now() - SENSE_RESCAN_MS;
        state.recentlySensed.forEach(function (ts, key) {
            if (ts < cutoff)
                state.recentlySensed.delete(key);
        });
        return true;
    }
    // If we got a sense message but couldn't parse it, clear pending
    if (state.pendingTarget) {
        console.log('[Sense] Could not parse result, clearing pending');
        state.pendingTarget = null;
    }
    return false;
}
// Called when 0x3F (skill cooldown confirmation) fires
function handleSkillResponse(success, slot) {
    if (slot !== SENSE_SKILL_SLOT)
        return;
    if (success !== 1) {
        console.log('[Sense] Skill failed (code ' + success + '), clearing pending');
        state.pendingTarget = null;
    }
}
function getState() {
    return {
        enabled: state.enabled,
        recentCount: state.recentlySensed.size,
        pending: state.pendingTarget
    };
}
function setEnabled(enabled) {
    state.enabled = enabled;
    console.log('[Sense] ' + (enabled ? 'Enabled' : 'Disabled'));
}
//# sourceMappingURL=sense.js.map