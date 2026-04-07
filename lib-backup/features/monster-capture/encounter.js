"use strict";
// ── DA Monsters: Wild Encounter System ────────────────────────────
// Handles random grass encounters on map 449, capture logic, and wild fights.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActiveEncounter = getActiveEncounter;
exports.clearEncounter = clearEncounter;
exports.onPlayerStep = onPlayerStep;
exports.attemptCapture = attemptCapture;
exports.damageWildMonster = damageWildMonster;
exports.onPlayerMapChange = onPlayerMapChange;
exports.onSessionEnd = onSessionEnd;
exports.setProxy = setProxy;
const packet_1 = __importDefault(require("../../core/packet"));
const species_data_1 = require("./species-data");
const monster_db_1 = require("./monster-db");
// ── Per-session encounter state ──────────────────────────────────
const activeEncounters = new Map(); // sessionId → encounter
// ── Public API ───────────────────────────────────────────────────
function getActiveEncounter(sessionId) {
    return activeEncounters.get(sessionId);
}
function clearEncounter(sessionId, npcInjector) {
    const enc = activeEncounters.get(sessionId);
    if (enc) {
        clearTimeout(enc.despawnTimer);
        npcInjector.removeNPC(enc.serial);
        activeEncounters.delete(sessionId);
    }
}
/**
 * Called on every player:position event. If the player is on the encounter map
 * and on a grass tile, roll for a wild encounter.
 */
function onPlayerStep(session, config, proxy, npcInjector, chat, registry, collision) {
    if (session.playerState.mapNumber !== config.encounterMapNumber)
        return;
    if (activeEncounters.has(session.id))
        return; // already in encounter
    const px = session.playerState.x;
    const py = session.playerState.y;
    // Check grass region
    if (config.grassRegions.length > 0) {
        const inGrass = config.grassRegions.some(r => px >= r.x1 && px <= r.x2 && py >= r.y1 && py <= r.y2);
        if (!inGrass)
            return;
    }
    // Roll encounter chance
    if (Math.random() > config.encounterRate)
        return;
    // Spawn wild monster
    spawnWildEncounter(session, config, proxy, npcInjector, chat, registry, collision);
}
/**
 * Player used /capture — attempt to catch the wild monster.
 */
async function attemptCapture(session, config, npcInjector, chat) {
    const enc = activeEncounters.get(session.id);
    if (!enc) {
        chat.systemMessage(session, 'No wild monster nearby to capture!');
        return;
    }
    // Check party limit
    const count = await (0, monster_db_1.getMonsterCount)(session.characterName);
    if (count >= config.maxMonsters) {
        chat.systemMessage(session, `You already have ${config.maxMonsters} monsters! Release one first.`);
        return;
    }
    // Calculate capture chance: base 60% at full HP, scales to 100% at low HP
    const hpRatio = enc.hp / enc.maxHp;
    const captureChance = 0.6 + (1.0 - hpRatio) * 0.4;
    const roll = Math.random();
    const success = roll < captureChance;
    console.log(`[Monster] Capture attempt by ${session.characterName}: chance=${(captureChance * 100).toFixed(0)}% roll=${(roll * 100).toFixed(0)}% success=${success}`);
    if (!success) {
        chat.systemMessage(session, `The ${enc.species.name} broke free! (${(captureChance * 100).toFixed(0)}% chance)`);
        // Play a shake animation on the wild monster
        sendBodyAnimation(session, enc.serial, 26, 500); // Ouch animation
        return;
    }
    // Capture successful!
    const nature = (0, species_data_1.getRandomNature)();
    const moves = (0, species_data_1.getMovesForLevel)(enc.species, enc.level);
    const paddedMoves = [...moves];
    while (paddedMoves.length < 4)
        paddedMoves.push(null);
    const monster = {
        id: 0, // assigned by DB
        ownerName: session.characterName,
        speciesName: enc.species.name,
        sprite: enc.species.sprite,
        nickname: enc.species.name,
        level: enc.level,
        xp: 0,
        xpToNext: (0, species_data_1.calculateXpToNext)(enc.level),
        hp: enc.maxHp,
        maxHp: enc.maxHp,
        atk: enc.atk,
        def: enc.def,
        spd: enc.spd,
        spAtk: enc.spAtk,
        spDef: enc.spDef,
        nature,
        moves: paddedMoves,
        wins: 0,
        losses: 0,
        isActive: count === 0, // auto-set active if first monster
        capturedAt: new Date(),
    };
    const id = await (0, monster_db_1.saveMonster)(monster);
    monster.id = id;
    // Clean up encounter
    clearEncounter(session.id, npcInjector);
    // Play capture effect
    sendEffect(session, enc.serial, session.playerState.serial, 100, 0, 500);
    chat.systemMessage(session, `Caught a level ${enc.level} ${enc.species.name}! (${nature} nature)`);
    if (count === 0) {
        chat.systemMessage(session, `${enc.species.name} is now your active monster! Use /companion to toggle following.`);
    }
    console.log(`[Monster] ${session.characterName} captured ${enc.species.name} (id=${id}, level=${enc.level}, nature=${nature})`);
}
/**
 * Reduce a wild encounter's HP (from /fight wild battle).
 * Returns true if the monster fainted.
 */
function damageWildMonster(sessionId, damage, proxy, session, npcInjector, chat) {
    const enc = activeEncounters.get(sessionId);
    if (!enc)
        return false;
    enc.hp = Math.max(0, enc.hp - damage);
    const percent = Math.round((enc.hp / enc.maxHp) * 100);
    // Update health bar
    sendHealthBar(session, enc.serial, percent);
    if (enc.hp <= 0) {
        chat.systemMessage(session, `The wild ${enc.species.name} fainted!`);
        clearEncounter(sessionId, npcInjector);
        return true;
    }
    return false;
}
/**
 * Called when player leaves the encounter map — clear their encounter.
 */
function onPlayerMapChange(sessionId, npcInjector) {
    clearEncounter(sessionId, npcInjector);
}
function onSessionEnd(sessionId, npcInjector) {
    clearEncounter(sessionId, npcInjector);
}
// ── Internal ─────────────────────────────────────────────────────
function spawnWildEncounter(session, config, proxy, npcInjector, chat, registry, collision) {
    const species = (0, species_data_1.getRandomSpecies)();
    const playerLevel = session.playerState.level || 1;
    const level = Math.max(1, Math.floor(Math.random() * 5) + 1 + Math.floor(Math.random() * (playerLevel / 3)));
    const nature = (0, species_data_1.getRandomNature)();
    const hp = (0, species_data_1.calculateHp)(species.baseHp, level);
    const atk = (0, species_data_1.calculateStat)(species.baseAtk, level, nature, 'atk');
    const def = (0, species_data_1.calculateStat)(species.baseDef, level, nature, 'def');
    const spd = (0, species_data_1.calculateStat)(species.baseSpd, level, nature, 'spd');
    const spAtk = (0, species_data_1.calculateStat)(species.baseSpAtk, level, nature, 'spAtk');
    const spDef = (0, species_data_1.calculateStat)(species.baseSpDef, level, nature, 'spDef');
    const moves = (0, species_data_1.getMovesForLevel)(species, level);
    // Find a walkable tile near the player to spawn the monster
    const mapId = session.playerState.mapNumber;
    const px = session.playerState.x;
    const py = session.playerState.y;
    const spawnPos = findWalkableNearby(px, py, mapId, collision);
    if (!spawnPos) {
        // No walkable tile found — skip this encounter silently
        console.log(`[Monster] No walkable tile near (${px},${py}) on map ${mapId} — skipping encounter`);
        return;
    }
    const spawnX = spawnPos.x;
    const spawnY = spawnPos.y;
    const playerDir = session.playerState.direction;
    const serial = npcInjector.placeNPC({
        name: `${species.name} Lv.${level}`,
        sprite: species.sprite,
        x: spawnX,
        y: spawnY,
        mapNumber: config.encounterMapNumber,
        direction: (playerDir + 2) % 4, // face toward player
        creatureType: 0, // Monster type
    });
    // Set up despawn timer
    const despawnTimer = setTimeout(() => {
        const enc = activeEncounters.get(session.id);
        if (enc && enc.serial === serial) {
            chat.systemMessage(session, `The wild ${species.name} fled!`);
            npcInjector.removeNPC(serial);
            activeEncounters.delete(session.id);
        }
    }, config.wildDespawnMs);
    const encounter = {
        serial, species, level,
        hp, maxHp: hp, atk, def, spd, spAtk, spDef,
        moves, x: spawnX, y: spawnY,
        spawnedAt: Date.now(),
        despawnTimer,
    };
    activeEncounters.set(session.id, encounter);
    // Show health bar at 100%
    sendHealthBar(session, serial, 100);
    chat.systemMessage(session, `A wild ${species.name} (Lv.${level}) appeared! Use /capture or /fight`);
    console.log(`[Monster] Wild ${species.name} Lv.${level} spawned for ${session.characterName} at (${spawnX},${spawnY})`);
}
// ── Walkable Tile Finder ─────────────────────────────────────────
/**
 * Find a walkable tile near the given position.
 * Searches in a spiral pattern around the origin, checking collision.
 * Returns null if no walkable tile found within range.
 */
function findWalkableNearby(originX, originY, mapId, collision) {
    // Candidate offsets: prioritize tiles 2-3 away from the player in cardinal directions,
    // then expand to a wider search. Avoids (0,0) since that's the player's tile.
    const offsets = [
        // 2 tiles away (cardinal)
        { x: 0, y: -2 }, { x: 2, y: 0 }, { x: 0, y: 2 }, { x: -2, y: 0 },
        // 2 tiles away (diagonal)
        { x: 2, y: -2 }, { x: 2, y: 2 }, { x: -2, y: 2 }, { x: -2, y: -2 },
        // 3 tiles away (cardinal)
        { x: 0, y: -3 }, { x: 3, y: 0 }, { x: 0, y: 3 }, { x: -3, y: 0 },
        // 1 tile away (fallback, very close)
        { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
        // 3 tiles away (diagonal)
        { x: 3, y: -3 }, { x: 3, y: 3 }, { x: -3, y: 3 }, { x: -3, y: -3 },
        // 4 tiles away
        { x: 0, y: -4 }, { x: 4, y: 0 }, { x: 0, y: 4 }, { x: -4, y: 0 },
    ];
    // Shuffle the first 4 (cardinal 2-away) so monsters don't always appear in the same spot
    for (let i = 3; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [offsets[i], offsets[j]] = [offsets[j], offsets[i]];
    }
    for (const off of offsets) {
        const tx = originX + off.x;
        const ty = originY + off.y;
        if (tx < 0 || ty < 0)
            continue;
        // If we have collision data, check walkability
        if (collision) {
            if (!collision.isWalkable(mapId, tx, ty))
                continue;
        }
        return { x: tx, y: ty };
    }
    // Absolute fallback: no collision data and all candidates failed
    return null;
}
// ── Packet Helpers (Arbiter-confirmed formats) ───────────────────
function sendHealthBar(session, entitySerial, hpPercent) {
    const pkt = new packet_1.default(0x13);
    pkt.writeUInt32(entitySerial);
    pkt.writeByte(0x00); // Unknown
    pkt.writeByte(hpPercent); // Percent (0-100)
    pkt.writeByte(0xFF); // Sound (0xFF = none)
    // sendToClient is called through the proxy reference we need to pass
    // We'll use the proxy import from the caller — but for now store on module
    _proxy?.sendToClient(session, pkt);
}
function sendBodyAnimation(session, entitySerial, animation, durationMs) {
    const pkt = new packet_1.default(0x1A);
    pkt.writeUInt32(entitySerial);
    pkt.writeByte(animation);
    pkt.writeUInt16(durationMs);
    pkt.writeByte(0xFF);
    _proxy?.sendToClient(session, pkt);
}
function sendEffect(session, targetSerial, sourceSerial, targetAnim, sourceAnim, durationMs) {
    const pkt = new packet_1.default(0x29);
    pkt.writeUInt32(targetSerial);
    pkt.writeUInt32(sourceSerial);
    pkt.writeUInt16(targetAnim);
    pkt.writeUInt16(sourceAnim);
    pkt.writeUInt16(durationMs);
    _proxy?.sendToClient(session, pkt);
}
// Module-level proxy reference (set during init)
let _proxy = null;
function setProxy(proxy) {
    _proxy = proxy;
}
//# sourceMappingURL=encounter.js.map