"use strict";
// ── DA Monsters: Companion System ─────────────────────────────────
// Active monster follows the player and auto-casts spells during PvE.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initCompanion = initCompanion;
exports.toggleCompanion = toggleCompanion;
exports.getCompanion = getCompanion;
exports.onPlayerMove = onPlayerMove;
exports.onPlayerMapChange = onPlayerMapChange;
exports.onPlayerCombat = onPlayerCombat;
exports.refreshCompanion = refreshCompanion;
exports.onSessionEnd = onSessionEnd;
const packet_1 = __importDefault(require("../../core/packet"));
const monster_db_1 = require("./monster-db");
const species_data_1 = require("./species-data");
/**
 * Get the live sprite for a captured monster by looking up current species data.
 * Falls back to the DB-stored sprite if species not found.
 */
function getLiveSprite(mon) {
    const species = (0, species_data_1.getSpeciesByName)(mon.speciesName);
    return species ? species.sprite : mon.sprite;
}
// ── Per-session companion state ──────────────────────────────────
const companions = new Map();
// Module refs
let _proxy;
let _npcInjector;
let _chat;
let _automation;
let _config;
function initCompanion(proxy, npcInjector, chat, automation, config) {
    _proxy = proxy;
    _npcInjector = npcInjector;
    _chat = chat;
    _automation = automation;
    _config = config;
}
// ── Toggle Companion ─────────────────────────────────────────────
async function toggleCompanion(session) {
    const existing = companions.get(session.id);
    if (existing) {
        despawnCompanion(session.id);
        _chat.systemMessage(session, `${existing.monster.nickname} returned.`);
        return;
    }
    const monster = await (0, monster_db_1.getActiveMonster)(session.characterName);
    if (!monster) {
        _chat.systemMessage(session, 'You have no active monster! Set one with /active <slot> or at the Monster Keeper.');
        return;
    }
    spawnCompanion(session, monster);
    _chat.systemMessage(session, `${monster.nickname} is now following you!`);
}
function getCompanion(sessionId) {
    return companions.get(sessionId);
}
// ── Position Helpers ─────────────────────────────────────────────
/**
 * Get the ideal companion position: to the LEFT side of the player
 * relative to their facing direction, so it stays out of the walking path.
 *
 * Direction 0 (Up)    → companion to the LEFT  (x-1, y)
 * Direction 1 (Right) → companion to the LEFT  (x, y-1) — above
 * Direction 2 (Down)  → companion to the RIGHT (x+1, y)
 * Direction 3 (Left)  → companion to the RIGHT (x, y+1) — below
 *
 * If the side tile is blocked, try the opposite side, then behind.
 */
function getSidePosition(px, py, dir) {
    // Side offsets: for each direction, the left-side offset
    const sideOffsets = {
        0: [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], // Up: left, right, behind
        1: [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }], // Right: above, below, behind
        2: [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }], // Down: right, left, behind
        3: [{ x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 0 }], // Left: below, above, behind
    };
    const offsets = sideOffsets[dir] || sideOffsets[0];
    // Return first choice (side); collision checking happens in the move logic
    return { x: px + offsets[0].x, y: py + offsets[0].y };
}
// ── Spawn / Despawn ──────────────────────────────────────────────
function spawnCompanion(session, monster) {
    // Spawn to the side of the player
    const dir = session.playerState.direction;
    const side = getSidePosition(session.playerState.x, session.playerState.y, dir);
    const cx = side.x;
    const cy = side.y;
    const serial = _npcInjector.placeNPC({
        name: monster.nickname,
        sprite: getLiveSprite(monster),
        x: cx,
        y: cy,
        mapNumber: session.playerState.mapNumber,
        direction: dir,
        creatureType: 0, // Monster (looks like a real mob)
    });
    companions.set(session.id, {
        serial,
        monster,
        mapNumber: session.playerState.mapNumber,
        x: cx,
        y: cy,
        enabled: true,
        lastAttackTime: 0,
        mapChangeRespawnTimer: null,
    });
    console.log(`[Companion] ${monster.nickname} spawned for ${session.characterName} at (${cx},${cy})`);
}
function clearMapChangeRespawnTimer(comp) {
    if (comp.mapChangeRespawnTimer) {
        clearTimeout(comp.mapChangeRespawnTimer);
        comp.mapChangeRespawnTimer = null;
    }
}
function despawnCompanion(sessionId) {
    const comp = companions.get(sessionId);
    if (comp) {
        clearMapChangeRespawnTimer(comp);
        _npcInjector.removeNPC(comp.serial);
        companions.delete(sessionId);
    }
}
// ── Following Behavior ───────────────────────────────────────────
function onPlayerMove(session) {
    const comp = companions.get(session.id);
    if (!comp || !comp.enabled)
        return;
    // Don't move companion during battles
    const { isInBattle } = require('./battle-engine');
    if (isInBattle(session.id))
        return;
    const px = session.playerState.x;
    const py = session.playerState.y;
    const dir = session.playerState.direction;
    const distToPlayer = Math.abs(comp.x - px) + Math.abs(comp.y - py);
    // Target: the side position next to the player
    const target = getSidePosition(px, py, dir);
    const distToTarget = Math.abs(comp.x - target.x) + Math.abs(comp.y - target.y);
    // Already at the target
    if (distToTarget === 0)
        return;
    // If only 1 tile off, walk there normally
    if (distToTarget === 1 && distToPlayer <= 2) {
        _npcInjector.moveNPC(comp.serial, target.x, target.y);
        comp.x = target.x;
        comp.y = target.y;
        return;
    }
    // More than 1 tile off or too far — teleport directly to side position
    // This keeps the companion locked to the player's side without lagging behind
    _npcInjector.removeNPC(comp.serial);
    const serial = _npcInjector.placeNPC({
        name: comp.monster.nickname,
        sprite: getLiveSprite(comp.monster),
        x: target.x,
        y: target.y,
        mapNumber: session.playerState.mapNumber,
        direction: dir,
        creatureType: 0,
    });
    comp.serial = serial;
    comp.x = target.x;
    comp.y = target.y;
}
function onPlayerMapChange(session) {
    const comp = companions.get(session.id);
    if (!comp)
        return;
    clearMapChangeRespawnTimer(comp);
    // Remove from old map
    _npcInjector.removeNPC(comp.serial);
    comp.mapNumber = session.playerState.mapNumber;
    comp.mapChangeRespawnTimer = setTimeout(() => {
        comp.mapChangeRespawnTimer = null;
        if (!companions.has(session.id))
            return; // companion was toggled off
        if (session.destroyed)
            return;
        const cur = companions.get(session.id);
        if (cur !== comp)
            return;
        const mon = comp.monster;
        const dir = session.playerState.direction;
        const side = getSidePosition(session.playerState.x, session.playerState.y, dir);
        const cx = side.x;
        const cy = side.y;
        _npcInjector.removeNPC(comp.serial);
        const serial = _npcInjector.placeNPC({
            name: mon.nickname,
            sprite: getLiveSprite(mon),
            x: cx,
            y: cy,
            mapNumber: session.playerState.mapNumber,
            direction: dir,
            creatureType: 0,
        });
        comp.serial = serial;
        comp.mapNumber = session.playerState.mapNumber;
        comp.x = cx;
        comp.y = cy;
    }, 1500);
}
// ── PvE Auto-Cast ────────────────────────────────────────────────
/**
 * Called when the proxy detects the player's HP changed (0x08 stats update).
 * If HP went down, the player is probably in combat — companion auto-attacks.
 */
function onPlayerCombat(session, prevHp, currentHp) {
    if (currentHp >= prevHp)
        return; // not taking damage
    const comp = companions.get(session.id);
    if (!comp || !comp.enabled)
        return;
    const now = Date.now();
    if (now - comp.lastAttackTime < _config.companionCastCooldownMs)
        return;
    // Find a spell to cast based on the monster's type
    const autoSession = _automation.getSession(session.id);
    if (!autoSession)
        return;
    const caster = autoSession.caster;
    const monType = (0, species_data_1.getSpeciesByName)(comp.monster.speciesName)?.type || 'Normal';
    const patterns = species_data_1.TYPE_SPELL_PATTERNS[monType] || ['beag'];
    // Try each pattern to find a spell in the player's book
    let castSuccess = false;
    for (const pattern of patterns) {
        const spell = caster.findSpell(pattern);
        if (spell) {
            // Find a nearby entity to target (not the player, not virtual)
            // Use the player's serial as fallback (self-buff if no target)
            // For offensive spells, we need a target — use 0 for untargeted
            caster.castSpellBySlot(spell.slot);
            castSuccess = true;
            _chat.systemMessage(session, `${comp.monster.nickname} used ${spell.name}!`);
            // Animate the companion
            sendBodyAnimation(session, comp.serial, 136, 500); // WizardCast animation
            comp.lastAttackTime = now;
            console.log(`[Companion] ${comp.monster.nickname} auto-cast ${spell.name} for ${session.characterName}`);
            break;
        }
    }
    if (!castSuccess) {
        // Fallback: just do an attack animation for flavor
        _chat.systemMessage(session, `${comp.monster.nickname} attacks!`);
        sendBodyAnimation(session, comp.serial, 1, 300); // Assail animation
        comp.lastAttackTime = now;
    }
}
// ── Refresh after active monster change ──────────────────────────
async function refreshCompanion(session) {
    despawnCompanion(session.id);
    const monster = await (0, monster_db_1.getActiveMonster)(session.characterName);
    if (monster) {
        spawnCompanion(session, monster);
    }
}
// ── Session cleanup ──────────────────────────────────────────────
function onSessionEnd(sessionId) {
    despawnCompanion(sessionId);
}
// ── Packet Helpers ───────────────────────────────────────────────
function sendBodyAnimation(session, entitySerial, animation, durationMs) {
    const pkt = new packet_1.default(0x1A);
    pkt.writeUInt32(entitySerial);
    pkt.writeByte(animation);
    pkt.writeUInt16(durationMs);
    pkt.writeByte(0xFF);
    _proxy.sendToClient(session, pkt);
}
function sendEffect(session, targetSerial, sourceSerial, targetAnim, sourceAnim, durationMs) {
    const pkt = new packet_1.default(0x29);
    pkt.writeUInt32(targetSerial);
    pkt.writeUInt32(sourceSerial);
    pkt.writeUInt16(targetAnim);
    pkt.writeUInt16(sourceAnim);
    pkt.writeUInt16(durationMs);
    _proxy.sendToClient(session, pkt);
}
//# sourceMappingURL=companion.js.map