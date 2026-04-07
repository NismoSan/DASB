"use strict";
// ── DA Monsters: Battle Engine ────────────────────────────────────
// Pure game logic for turn-based monster battles (PvP and wild).
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBattle = getBattle;
exports.isInBattle = isInBattle;
exports.createPvpBattle = createPvpBattle;
exports.createWildBattle = createWildBattle;
exports.submitMove = submitMove;
exports.finishBattle = finishBattle;
exports.forfeitBattle = forfeitBattle;
exports.cleanupBattle = cleanupBattle;
const species_data_1 = require("./species-data");
const monster_db_1 = require("./monster-db");
// ── Active Battles ───────────────────────────────────────────────
const battles = new Map(); // battleId → battle
const playerBattles = new Map(); // sessionId → battleId
let _nextBattleId = 1;
function getBattle(sessionId) {
    const battleId = playerBattles.get(sessionId);
    return battleId ? battles.get(battleId) : undefined;
}
function isInBattle(sessionId) {
    return playerBattles.has(sessionId);
}
// ── Create Battle ────────────────────────────────────────────────
function createPvpBattle(trainerASession, monA, monASerial, monAX, monAY, trainerBSession, monB, monBSerial, monBX, monBY) {
    const id = `battle-${_nextBattleId++}`;
    const battle = {
        id,
        type: 'pvp',
        trainerA: trainerASession,
        monA: { monster: monA, currentHp: monA.hp, serial: monASerial, x: monAX, y: monAY },
        trainerB: trainerBSession,
        monB: { monster: monB, currentHp: monB.hp, serial: monBSerial, x: monBX, y: monBY },
        wildMon: null,
        turn: monA.spd >= monB.spd ? 'a' : 'b',
        moveA: null,
        moveB: null,
        active: true,
    };
    battles.set(id, battle);
    playerBattles.set(trainerASession, id);
    playerBattles.set(trainerBSession, id);
    return battle;
}
function createWildBattle(trainerSession, mon, monSerial, monX, monY, wildEncounter) {
    const id = `battle-${_nextBattleId++}`;
    const battle = {
        id,
        type: 'wild',
        trainerA: trainerSession,
        monA: { monster: mon, currentHp: mon.hp, serial: monSerial, x: monX, y: monY },
        trainerB: null,
        monB: null,
        wildMon: { encounter: wildEncounter, currentHp: wildEncounter.hp },
        turn: 'a', // player always goes first in wild battles
        moveA: null,
        moveB: null,
        active: true,
    };
    battles.set(id, battle);
    playerBattles.set(trainerSession, id);
    return battle;
}
/**
 * Submit a move for one side. When both sides have submitted,
 * resolve the round and return results.
 */
function submitMove(battleId, side, moveName) {
    const battle = battles.get(battleId);
    if (!battle || !battle.active)
        return null;
    if (side === 'a')
        battle.moveA = moveName;
    else
        battle.moveB = moveName;
    // For wild battles, auto-pick wild monster's move when player submits
    if (battle.type === 'wild' && side === 'a' && battle.wildMon) {
        const wildMoves = battle.wildMon.encounter.moves;
        battle.moveB = wildMoves[Math.floor(Math.random() * wildMoves.length)] || 'Tackle';
    }
    // Wait until both sides have submitted
    if (battle.moveA === null || battle.moveB === null)
        return null;
    return resolveRound(battle);
}
// ── Resolve Round ────────────────────────────────────────────────
function resolveRound(battle) {
    const moveA = (0, species_data_1.getMove)(battle.moveA) || (0, species_data_1.getMove)('Tackle');
    const moveB = (0, species_data_1.getMove)(battle.moveB) || (0, species_data_1.getMove)('Tackle');
    const monA = battle.monA;
    const monBData = battle.type === 'pvp' ? battle.monB : null;
    const wildData = battle.wildMon;
    // Determine speed order
    const spdA = monA.monster.spd;
    const spdB = battle.type === 'pvp' ? monBData.monster.spd : wildData.encounter.spd;
    const priorityA = moveA.priority || 0;
    const priorityB = moveB.priority || 0;
    let firstSide;
    if (priorityA !== priorityB) {
        firstSide = priorityA > priorityB ? 'a' : 'b';
    }
    else {
        firstSide = spdA >= spdB ? 'a' : 'b';
    }
    const results = [];
    let battleOver = false;
    let winner = null;
    // First attack
    const first = firstSide === 'a'
        ? executeAttack(battle, 'a', moveA)
        : executeAttack(battle, 'b', moveB);
    results.push(first);
    if (first.defenderFainted) {
        battleOver = true;
        winner = firstSide;
    }
    // Second attack (if defender survived)
    if (!battleOver) {
        const secondSide = firstSide === 'a' ? 'b' : 'a';
        const secondMove = secondSide === 'a' ? moveA : moveB;
        const second = executeAttack(battle, secondSide, secondMove);
        results.push(second);
        if (second.defenderFainted) {
            battleOver = true;
            winner = secondSide;
        }
    }
    // Reset moves for next round
    battle.moveA = null;
    battle.moveB = null;
    if (battleOver) {
        battle.active = false;
    }
    return { turnResults: results, battleOver, winner };
}
function executeAttack(battle, attackerSide, move) {
    if (!move)
        move = (0, species_data_1.getMove)('Tackle');
    const isAAttacking = attackerSide === 'a';
    const attacker = battle.monA;
    const isPvp = battle.type === 'pvp';
    let attackerMon;
    let defenderMon;
    if (isAAttacking) {
        attackerMon = { atk: attacker.monster.atk, spAtk: attacker.monster.spAtk, spd: attacker.monster.spd, name: attacker.monster.nickname, serial: attacker.serial };
        if (isPvp) {
            const b = battle.monB;
            defenderMon = { def: b.monster.def, spDef: b.monster.spDef, name: b.monster.nickname, serial: b.serial, currentHp: b.currentHp, maxHp: b.monster.maxHp };
        }
        else {
            const w = battle.wildMon;
            defenderMon = { def: w.encounter.def, spDef: w.encounter.spDef, name: w.encounter.species.name, serial: w.encounter.serial, currentHp: w.currentHp, maxHp: w.encounter.maxHp };
        }
    }
    else {
        // B attacking A
        if (isPvp) {
            const b = battle.monB;
            attackerMon = { atk: b.monster.atk, spAtk: b.monster.spAtk, spd: b.monster.spd, name: b.monster.nickname, serial: b.serial };
        }
        else {
            const w = battle.wildMon;
            attackerMon = { atk: w.encounter.atk, spAtk: w.encounter.spAtk, spd: w.encounter.spd, name: w.encounter.species.name, serial: w.encounter.serial };
        }
        defenderMon = { def: attacker.monster.def, spDef: attacker.monster.spDef, name: attacker.monster.nickname, serial: attacker.serial, currentHp: attacker.currentHp, maxHp: attacker.monster.maxHp };
    }
    // Handle healing moves
    if (move.category === 'status' && move.heals) {
        const healAmount = Math.floor(defenderMon.maxHp * (move.heals / 100));
        // Heal the attacker's side
        if (isAAttacking) {
            battle.monA.currentHp = Math.min(battle.monA.monster.maxHp, battle.monA.currentHp + healAmount);
        }
        else if (isPvp) {
            battle.monB.currentHp = Math.min(battle.monB.monster.maxHp, battle.monB.currentHp + healAmount);
        }
        const hpPct = isAAttacking
            ? Math.round((battle.monA.currentHp / battle.monA.monster.maxHp) * 100)
            : isPvp ? Math.round((battle.monB.currentHp / battle.monB.monster.maxHp) * 100) : 100;
        return {
            attackerName: attackerMon.name, defenderName: defenderMon.name,
            moveName: move.name, damage: 0, effectiveness: 'normal',
            attackerSerial: attackerMon.serial, defenderSerial: defenderMon.serial,
            defenderHpPercent: hpPct, defenderFainted: false, healed: healAmount,
        };
    }
    // Handle status moves with no damage/heal (e.g., Howl, Flash)
    if (move.category === 'status') {
        return {
            attackerName: attackerMon.name, defenderName: defenderMon.name,
            moveName: move.name, damage: 0, effectiveness: 'normal',
            attackerSerial: attackerMon.serial, defenderSerial: defenderMon.serial,
            defenderHpPercent: Math.round((defenderMon.currentHp / defenderMon.maxHp) * 100),
            defenderFainted: false,
        };
    }
    // Accuracy check
    if (Math.random() * 100 > move.accuracy) {
        return {
            attackerName: attackerMon.name, defenderName: defenderMon.name,
            moveName: move.name, damage: 0, effectiveness: 'miss',
            attackerSerial: attackerMon.serial, defenderSerial: defenderMon.serial,
            defenderHpPercent: Math.round((defenderMon.currentHp / defenderMon.maxHp) * 100),
            defenderFainted: false,
        };
    }
    // Damage calculation (simplified Pokemon formula)
    const level = isAAttacking ? battle.monA.monster.level : (isPvp ? battle.monB.monster.level : battle.wildMon.encounter.level);
    const atk = move.category === 'physical' ? attackerMon.atk : attackerMon.spAtk;
    const def = move.category === 'physical' ? defenderMon.def : defenderMon.spDef;
    // Type effectiveness
    const attackerSpecies = isAAttacking
        ? (0, species_data_1.getSpeciesByName)(battle.monA.monster.speciesName)
        : (isPvp ? (0, species_data_1.getSpeciesByName)(battle.monB.monster.speciesName) : battle.wildMon.encounter.species);
    const defenderSpecies = isAAttacking
        ? (isPvp ? (0, species_data_1.getSpeciesByName)(battle.monB.monster.speciesName) : battle.wildMon.encounter.species)
        : (0, species_data_1.getSpeciesByName)(battle.monA.monster.speciesName);
    const typeMultiplier = defenderSpecies
        ? (0, species_data_1.getTypeEffectiveness)(move.type, defenderSpecies.type)
        : 1.0;
    // STAB (Same Type Attack Bonus)
    const stab = (attackerSpecies && attackerSpecies.type === move.type) ? 1.3 : 1.0;
    // Random variance (85-100%)
    const variance = 0.85 + Math.random() * 0.15;
    let damage = Math.floor((((2 * level / 5 + 2) * move.power * atk / def) / 50 + 2) * stab * typeMultiplier * variance);
    damage = Math.max(1, damage);
    let effectiveness = 'normal';
    if (typeMultiplier > 1.0)
        effectiveness = 'super effective';
    else if (typeMultiplier < 1.0 && typeMultiplier > 0)
        effectiveness = 'not very effective';
    else if (typeMultiplier === 0) {
        damage = 0;
        effectiveness = 'immune';
    }
    // Apply damage
    if (isAAttacking) {
        if (isPvp) {
            battle.monB.currentHp = Math.max(0, battle.monB.currentHp - damage);
        }
        else {
            battle.wildMon.currentHp = Math.max(0, battle.wildMon.currentHp - damage);
        }
    }
    else {
        battle.monA.currentHp = Math.max(0, battle.monA.currentHp - damage);
    }
    const defenderCurrentHp = isAAttacking
        ? (isPvp ? battle.monB.currentHp : battle.wildMon.currentHp)
        : battle.monA.currentHp;
    const defenderMaxHp = defenderMon.maxHp;
    const defenderHpPercent = Math.round((defenderCurrentHp / defenderMaxHp) * 100);
    const defenderFainted = defenderCurrentHp <= 0;
    return {
        attackerName: attackerMon.name, defenderName: defenderMon.name,
        moveName: move.name, damage, effectiveness,
        attackerSerial: attackerMon.serial, defenderSerial: defenderMon.serial,
        defenderHpPercent, defenderFainted,
    };
}
// ── Post-Battle ──────────────────────────────────────────────────
async function finishBattle(battleId, winner) {
    const battle = battles.get(battleId);
    if (!battle)
        return { winnerName: '', loserName: '' };
    // Determine winner/loser monsters
    // In wild battles: 'a' = player's monster, 'b' = wild monster
    // In PvP battles: 'a' = challenger, 'b' = acceptor
    let winnerMon = null;
    let loserMon = null;
    let wildWon = false;
    if (battle.type === 'wild') {
        if (winner === 'a') {
            // Player won against wild monster
            winnerMon = battle.monA.monster;
            loserMon = null; // wild monster has no CapturedMonster record
        }
        else {
            // Wild monster won — player's monster lost
            wildWon = true;
            loserMon = battle.monA.monster;
        }
    }
    else {
        // PvP
        winnerMon = winner === 'a' ? battle.monA.monster : battle.monB.monster;
        loserMon = winner === 'a' ? battle.monB.monster : battle.monA.monster;
    }
    // Award XP
    if (winnerMon) {
        const winXp = 50 + (loserMon ? loserMon.level * 5 : 10);
        winnerMon.wins++;
        winnerMon.xp += winXp;
        await (0, monster_db_1.updateMonster)(winnerMon);
    }
    if (loserMon) {
        const loseXp = wildWon ? 5 : 15;
        loserMon.losses++;
        loserMon.xp += loseXp;
        await (0, monster_db_1.updateMonster)(loserMon);
    }
    // Clean up
    playerBattles.delete(battle.trainerA);
    if (battle.trainerB)
        playerBattles.delete(battle.trainerB);
    battles.delete(battleId);
    return {
        winnerName: winnerMon?.nickname || 'wild monster',
        loserName: loserMon?.nickname || 'wild monster',
    };
}
function forfeitBattle(sessionId) {
    const battleId = playerBattles.get(sessionId);
    if (!battleId)
        return undefined;
    const battle = battles.get(battleId);
    if (!battle)
        return undefined;
    battle.active = false;
    return battle;
}
function cleanupBattle(battleId) {
    const battle = battles.get(battleId);
    if (!battle)
        return;
    playerBattles.delete(battle.trainerA);
    if (battle.trainerB)
        playerBattles.delete(battle.trainerB);
    battles.delete(battleId);
}
//# sourceMappingURL=battle-engine.js.map