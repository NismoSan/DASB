"use strict";
// ── DA Monsters: Battle UI ────────────────────────────────────────
// Renders battle state to players via dialogs, health bars, animations, chat.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initBattleUI = initBattleUI;
exports.challengePlayer = challengePlayer;
exports.acceptChallenge = acceptChallenge;
exports.declineChallenge = declineChallenge;
exports.startWildBattle = startWildBattle;
exports.handleForfeit = handleForfeit;
exports.onSessionEnd = onSessionEnd;
const packet_1 = __importDefault(require("../../core/packet"));
const battle_engine_1 = require("./battle-engine");
const monster_db_1 = require("./monster-db");
const species_data_1 = require("./species-data");
function getLiveSprite(mon) {
    const species = (0, species_data_1.getSpeciesByName)(mon.speciesName);
    return species ? species.sprite : mon.sprite;
}
const species_data_2 = require("./species-data");
const encounter_1 = require("./encounter");
const companion_1 = require("./companion");
// ── Module refs ──────────────────────────────────────────────────
let _proxy;
let _npcInjector;
let _dialogHandler;
let _chat;
let _registry;
let _config;
// Pending PvP challenges
const challenges = new Map(); // targetSessionId → challenge
function initBattleUI(proxy, npcInjector, dialogHandler, chat, registry, config) {
    _proxy = proxy;
    _npcInjector = npcInjector;
    _dialogHandler = dialogHandler;
    _chat = chat;
    _registry = registry;
    _config = config;
}
// ── PvP Challenge Flow ───────────────────────────────────────────
async function challengePlayer(session, targetName) {
    if ((0, battle_engine_1.isInBattle)(session.id)) {
        _chat.systemMessage(session, 'You are already in a battle!');
        return;
    }
    const myMonster = await (0, monster_db_1.getActiveMonster)(session.characterName);
    if (!myMonster) {
        _chat.systemMessage(session, 'You need an active monster to battle! Use /active <slot> first.');
        return;
    }
    // Find target session
    const targetPlayer = _registry.getAllPlayers().find(p => p.characterName.toLowerCase() === targetName.toLowerCase());
    if (!targetPlayer) {
        _chat.systemMessage(session, `Player "${targetName}" not found on proxy.`);
        return;
    }
    const targetSession = _proxy.sessions.get(targetPlayer.sessionId);
    if (!targetSession) {
        _chat.systemMessage(session, `Player "${targetName}" session not found.`);
        return;
    }
    if ((0, battle_engine_1.isInBattle)(targetPlayer.sessionId)) {
        _chat.systemMessage(session, `${targetName} is already in a battle!`);
        return;
    }
    // Send challenge
    challenges.set(targetPlayer.sessionId, {
        challengerSessionId: session.id,
        challengerName: session.characterName,
        targetSessionId: targetPlayer.sessionId,
        targetName: targetPlayer.characterName,
        timestamp: Date.now(),
    });
    _chat.systemMessage(session, `Challenge sent to ${targetName}!`);
    _chat.systemMessage(targetSession, `${session.characterName} challenges you to a monster battle! Type /accept or /decline`);
    // Auto-expire after 60 seconds
    setTimeout(() => {
        const pending = challenges.get(targetPlayer.sessionId);
        if (pending && pending.challengerSessionId === session.id) {
            challenges.delete(targetPlayer.sessionId);
            _chat.systemMessage(session, `Challenge to ${targetName} expired.`);
        }
    }, 60000);
}
async function acceptChallenge(session) {
    const challenge = challenges.get(session.id);
    if (!challenge) {
        _chat.systemMessage(session, 'No pending battle challenge.');
        return;
    }
    challenges.delete(session.id);
    const myMonster = await (0, monster_db_1.getActiveMonster)(session.characterName);
    if (!myMonster) {
        _chat.systemMessage(session, 'You need an active monster! Use /active <slot> first.');
        return;
    }
    const challengerSession = _proxy.sessions.get(challenge.challengerSessionId);
    if (!challengerSession || challengerSession.destroyed) {
        _chat.systemMessage(session, 'Challenger is no longer connected.');
        return;
    }
    const challengerMonster = await (0, monster_db_1.getActiveMonster)(challenge.challengerName);
    if (!challengerMonster) {
        _chat.systemMessage(session, 'Challenger no longer has an active monster.');
        return;
    }
    // Reuse companion entities if they're out, otherwise spawn new ones
    const compA = (0, companion_1.getCompanion)(challenge.challengerSessionId);
    let monASerial, monAX, monAY;
    if (compA) {
        monASerial = compA.serial;
        monAX = compA.x;
        monAY = compA.y;
    }
    else {
        monAX = challengerSession.playerState.x + 2;
        monAY = challengerSession.playerState.y;
        monASerial = _npcInjector.placeNPC({
            name: `${challengerMonster.nickname} Lv.${challengerMonster.level}`,
            sprite: getLiveSprite(challengerMonster),
            x: monAX, y: monAY,
            mapNumber: challengerSession.playerState.mapNumber,
            direction: 1, creatureType: 0,
        });
    }
    const compB = (0, companion_1.getCompanion)(session.id);
    let monBSerial, monBX, monBY;
    if (compB) {
        monBSerial = compB.serial;
        monBX = compB.x;
        monBY = compB.y;
    }
    else {
        monBX = session.playerState.x + 2;
        monBY = session.playerState.y;
        monBSerial = _npcInjector.placeNPC({
            name: `${myMonster.nickname} Lv.${myMonster.level}`,
            sprite: getLiveSprite(myMonster),
            x: monBX, y: monBY,
            mapNumber: session.playerState.mapNumber,
            direction: 3, creatureType: 0,
        });
    }
    const battle = (0, battle_engine_1.createPvpBattle)(challenge.challengerSessionId, challengerMonster, monASerial, monAX, monAY, session.id, myMonster, monBSerial, monBX, monBY);
    // Show health bars
    sendHealthBar(challengerSession, monASerial, 100);
    sendHealthBar(challengerSession, monBSerial, 100);
    sendHealthBar(session, monASerial, 100);
    sendHealthBar(session, monBSerial, 100);
    _chat.systemMessage(challengerSession, `Battle started! ${challengerMonster.nickname} vs ${myMonster.nickname}`);
    _chat.systemMessage(session, `Battle started! ${myMonster.nickname} vs ${challengerMonster.nickname}`);
    // Prompt first moves
    promptMoveSelection(challengerSession, battle, 'a');
    promptMoveSelection(session, battle, 'b');
}
function declineChallenge(session) {
    const challenge = challenges.get(session.id);
    if (!challenge) {
        _chat.systemMessage(session, 'No pending battle challenge.');
        return;
    }
    challenges.delete(session.id);
    _chat.systemMessage(session, 'Challenge declined.');
    const challengerSession = _proxy.sessions.get(challenge.challengerSessionId);
    if (challengerSession) {
        _chat.systemMessage(challengerSession, `${session.characterName} declined your challenge.`);
    }
}
// ── Wild Battle ──────────────────────────────────────────────────
async function startWildBattle(session) {
    if ((0, battle_engine_1.isInBattle)(session.id)) {
        _chat.systemMessage(session, 'You are already in a battle!');
        return;
    }
    const encounter = (0, encounter_1.getActiveEncounter)(session.id);
    if (!encounter) {
        _chat.systemMessage(session, 'No wild monster nearby to fight!');
        return;
    }
    const myMonster = await (0, monster_db_1.getActiveMonster)(session.characterName);
    if (!myMonster) {
        _chat.systemMessage(session, 'You need an active monster! Use /active <slot> first.');
        return;
    }
    // Use existing companion entity if it's out, otherwise spawn a new one
    const comp = (0, companion_1.getCompanion)(session.id);
    let monSerial;
    let monX;
    let monY;
    if (comp) {
        // Reuse the companion — it's already on screen
        monSerial = comp.serial;
        monX = comp.x;
        monY = comp.y;
    }
    else {
        // No companion out — spawn a battle entity
        monX = session.playerState.x - 1;
        monY = session.playerState.y;
        monSerial = _npcInjector.placeNPC({
            name: `${myMonster.nickname} Lv.${myMonster.level}`,
            sprite: getLiveSprite(myMonster),
            x: monX,
            y: monY,
            mapNumber: session.playerState.mapNumber,
            direction: 1,
            creatureType: 0,
        });
    }
    const battle = (0, battle_engine_1.createWildBattle)(session.id, myMonster, monSerial, monX, monY, encounter);
    // Show health bars
    sendHealthBar(session, monSerial, 100);
    sendHealthBar(session, encounter.serial, Math.round((encounter.hp / encounter.maxHp) * 100));
    _chat.systemMessage(session, `Go, ${myMonster.nickname}! Battle against wild ${encounter.species.name}!`);
    promptMoveSelection(session, battle, 'a');
}
// ── Move Selection Dialog ────────────────────────────────────────
function promptMoveSelection(session, battle, side) {
    const mon = side === 'a' ? battle.monA.monster : (battle.monB?.monster || battle.monA.monster);
    const options = [];
    for (let i = 0; i < 4; i++) {
        const moveName = mon.moves[i];
        if (moveName) {
            const move = (0, species_data_2.getMove)(moveName);
            options.push({
                text: `${moveName} [${move?.type || '?'}] PWR:${move?.power || 0}`,
                pursuitId: i + 1,
            });
        }
    }
    options.push({ text: 'Forfeit', pursuitId: 99 });
    // Use a temporary virtual NPC for the dialog (the player's battle monster)
    const monSerial = side === 'a' ? battle.monA.serial : (battle.monB?.serial || battle.monA.serial);
    const npc = _npcInjector.getNPC(monSerial);
    const sprite = npc?.sprite || mon.sprite;
    _dialogHandler.sendDialogMenu(session, {
        menuType: 0,
        entityId: monSerial,
        sprite: sprite,
        name: mon.nickname,
        text: `${mon.nickname} (HP: ${side === 'a' ? battle.monA.currentHp : (battle.monB?.currentHp || 0)}/${mon.maxHp}) — Choose your move:`,
        menuOptions: options,
    });
    // Register the NPC's onInteract to handle the menu choice
    if (npc) {
        npc.onInteract = (_sess, event) => {
            if (event.type === 'menuChoice') {
                handleBattleMenuChoice(session, battle, side, event.slot);
            }
        };
    }
}
async function handleBattleMenuChoice(session, battle, side, slot) {
    if (!battle.active)
        return;
    const mon = side === 'a' ? battle.monA.monster : (battle.monB?.monster || battle.monA.monster);
    if (slot >= 99 || slot >= mon.moves.filter(m => m).length) {
        // Forfeit
        await handleForfeit(session);
        return;
    }
    const moveName = mon.moves[slot];
    if (!moveName)
        return;
    const result = (0, battle_engine_1.submitMove)(battle.id, side, moveName);
    if (!result) {
        // Waiting for opponent's move
        _chat.systemMessage(session, 'Waiting for opponent...');
        return;
    }
    // Both moves submitted — render the round
    await renderRound(battle, result);
}
// ── Render Round Results ─────────────────────────────────────────
async function renderRound(battle, result) {
    const sessionA = _proxy.sessions.get(battle.trainerA);
    const sessionB = battle.trainerB ? _proxy.sessions.get(battle.trainerB) : null;
    const sessions = [sessionA, sessionB].filter(Boolean);
    for (const turn of result.turnResults) {
        const message = formatTurnMessage(turn);
        for (const s of sessions) {
            _chat.systemMessage(s, message);
            // Play attack animation on the attacker
            sendBodyAnimation(s, turn.attackerSerial, 1, 400);
            // Play effect on the defender
            if (turn.damage > 0) {
                setTimeout(() => {
                    sendEffect(s, turn.defenderSerial, turn.attackerSerial, 100, 0, 300);
                }, 200);
            }
            // Update health bar on defender
            sendHealthBar(s, turn.defenderSerial, turn.defenderHpPercent, turn.damage > 0 ? 1 : 0xFF);
        }
        // Small delay between turns for readability
        await delay(800);
    }
    if (result.battleOver) {
        await handleBattleEnd(battle, result.winner);
    }
    else {
        // Prompt next round
        if (sessionA)
            promptMoveSelection(sessionA, battle, 'a');
        if (sessionB)
            promptMoveSelection(sessionB, battle, 'b');
    }
}
function formatTurnMessage(turn) {
    if (turn.healed) {
        return `${turn.attackerName} used ${turn.moveName}! Healed ${turn.healed} HP!`;
    }
    if (turn.effectiveness === 'miss') {
        return `${turn.attackerName} used ${turn.moveName}... but it missed!`;
    }
    if (turn.effectiveness === 'immune') {
        return `${turn.attackerName} used ${turn.moveName}... but it had no effect!`;
    }
    let msg = `${turn.attackerName} used ${turn.moveName}! ${turn.damage} damage!`;
    if (turn.effectiveness === 'super effective')
        msg += " It's super effective!";
    if (turn.effectiveness === 'not very effective')
        msg += " It's not very effective...";
    if (turn.defenderFainted)
        msg += ` ${turn.defenderName} fainted!`;
    return msg;
}
// ── Battle End ───────────────────────────────────────────────────
async function handleBattleEnd(battle, winner) {
    const { winnerName, loserName } = await (0, battle_engine_1.finishBattle)(battle.id, winner);
    const sessionA = _proxy.sessions.get(battle.trainerA);
    const sessionB = battle.trainerB ? _proxy.sessions.get(battle.trainerB) : null;
    // Announce to participants
    if (sessionA)
        _chat.systemMessage(sessionA, `Battle over! ${winnerName} wins!`);
    if (sessionB)
        _chat.systemMessage(sessionB, `Battle over! ${winnerName} wins!`);
    // Broadcast to all proxy players (PvP only)
    if (battle.type === 'pvp') {
        const ownerA = sessionA?.characterName || '?';
        const ownerB = sessionB?.characterName || '?';
        const winnerOwner = winner === 'a' ? ownerA : ownerB;
        _chat.broadcast({
            channel: 'world',
            sender: 'DA Monsters',
            message: `${winnerOwner}'s ${winnerName} defeated ${loserName} in a monster battle!`,
        });
    }
    // Clean up battle monster entities — but don't remove if it's a companion
    // (companion system will manage those). Only remove entities we spawned for the battle.
    const compA = (0, companion_1.getCompanion)(battle.trainerA);
    if (!compA || compA.serial !== battle.monA.serial) {
        _npcInjector.removeNPC(battle.monA.serial);
    }
    if (battle.monB) {
        const compB = battle.trainerB ? (0, companion_1.getCompanion)(battle.trainerB) : null;
        if (!compB || compB.serial !== battle.monB.serial) {
            _npcInjector.removeNPC(battle.monB.serial);
        }
    }
    (0, battle_engine_1.cleanupBattle)(battle.id);
    // Refresh companions after battle (respawn if they were used as battle entities)
    if (sessionA)
        (0, companion_1.refreshCompanion)(sessionA).catch(() => { });
    if (sessionB)
        (0, companion_1.refreshCompanion)(sessionB).catch(() => { });
}
async function handleForfeit(session) {
    const battle = (0, battle_engine_1.forfeitBattle)(session.id);
    if (!battle) {
        _chat.systemMessage(session, 'You are not in a battle.');
        return;
    }
    const winner = battle.trainerA === session.id ? 'b' : 'a';
    await handleBattleEnd(battle, winner);
}
// ── Session cleanup ──────────────────────────────────────────────
function onSessionEnd(sessionId) {
    challenges.delete(sessionId);
    // Forfeit any active battle
    const battle = (0, battle_engine_1.getBattle)(sessionId);
    if (battle && battle.active) {
        battle.active = false;
        const winner = battle.trainerA === sessionId ? 'b' : 'a';
        handleBattleEnd(battle, winner).catch(() => { });
    }
}
// ── Packet Helpers (Arbiter-confirmed) ───────────────────────────
function sendHealthBar(session, entitySerial, hpPercent, sound = 0xFF) {
    const pkt = new packet_1.default(0x13);
    pkt.writeUInt32(entitySerial);
    pkt.writeByte(0x00);
    pkt.writeByte(Math.max(0, Math.min(100, hpPercent)));
    pkt.writeByte(sound);
    _proxy.sendToClient(session, pkt);
}
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
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
//# sourceMappingURL=battle-ui.js.map