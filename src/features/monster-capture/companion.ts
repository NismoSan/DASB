import Packet from '../../core/packet';
import type ProxyServer from '../../proxy/proxy-server';
import type ProxySession from '../../proxy/proxy-session';
import type NpcInjector from '../../proxy/augmentation/npc-injector';
import type ChatInjector from '../../proxy/augmentation/chat-injector';
import type AutomationManager from '../../proxy/automation/index';
import type { CompanionState, MonsterCaptureConfig, CapturedMonster } from './types';
import { getActiveMonster, isCompanionOut, setCompanionOut } from './monster-db';
import { getSpeciesByName, TYPE_SPELL_PATTERNS } from './species-data';
import { monsterDanger, monsterNotice, monsterSuccess } from './message-style';
import { getSessionWorldDirection, getSessionWorldView } from './world-view';

const companions = new Map<string, CompanionState>();

let _proxy: ProxyServer;
let _npcInjector: NpcInjector;
let _chat: ChatInjector;
let _automation: AutomationManager;
let _config: MonsterCaptureConfig;

export function initCompanion(
    proxy: ProxyServer,
    npcInjector: NpcInjector,
    chat: ChatInjector,
    automation: AutomationManager,
    config: MonsterCaptureConfig,
): void {
    _proxy = proxy;
    _npcInjector = npcInjector;
    _chat = chat;
    _automation = automation;
    _config = config;
}

export async function toggleCompanion(session: ProxySession): Promise<void> {
    const existing = companions.get(session.id);
    if (existing) {
        _chat.sendPublicChatFromEntity(session, {
            channel: 'say',
            entityId: session.playerState.serial,
            message: `${session.characterName}: ${existing.monster.nickname}, return!`,
        });
        sendBodyAnimation(session, existing.serial, 91, 500);
        await new Promise(resolve => setTimeout(resolve, 600));
        despawnCompanion(session.id);
        await setCompanionOut(session.characterName, false);
        _chat.systemMessage(session, monsterNotice(`${existing.monster.nickname} returned.`));
        return;
    }

    const monster = await getActiveMonster(session.characterName);
    if (!monster) {
        _chat.systemMessage(session, monsterDanger('You have no active monster! Set one with /active <slot> or at the Monster Keeper.'));
        return;
    }

    _chat.sendPublicChatFromEntity(session, {
        channel: 'say',
        entityId: session.playerState.serial,
        message: `${session.characterName}: ${monster.nickname}, I choose you!`,
    });
    spawnCompanion(session, monster);
    const spawned = companions.get(session.id);
    if (spawned) {
        await new Promise(resolve => setTimeout(resolve, 100));
        sendBodyAnimation(session, spawned.serial, 91, 500);
    }
    await setCompanionOut(session.characterName, true);
    _chat.systemMessage(session, monsterSuccess(`${monster.nickname} is now following you!`));
}

export async function autoSpawnCompanion(session: ProxySession): Promise<void> {
    if (companions.has(session.id)) {
        return;
    }

    const shouldBeOut = await isCompanionOut(session.characterName);
    if (!shouldBeOut) {
        return;
    }

    const monster = await getActiveMonster(session.characterName);
    if (!monster) {
        return;
    }

    spawnCompanion(session, monster);
    console.log(`[Companion] Auto-spawned ${monster.nickname} for ${session.characterName} on reconnect`);
}

export function getCompanion(sessionId: string): CompanionState | undefined {
    return companions.get(sessionId);
}

export function onPlayerMove(session: ProxySession): void {
    const companion = companions.get(session.id);
    if (!companion || !companion.enabled || companion.transitioning) {
        return;
    }

    const { isInBattle } = require('./battle-engine') as typeof import('./battle-engine');
    if (isInBattle(session.id)) {
        return;
    }

    const view = getSessionWorldView(session);
    const playerX = view.x;
    const playerY = view.y;
    const direction = view.direction;
    const target = getBestSidePosition(playerX, playerY, direction, companion.x, companion.y);

    if (companion.x === playerX && companion.y === playerY) {
        _npcInjector.removeNPC(companion.serial);
        const serial = _npcInjector.placeNPC({
            name: companion.monster.nickname,
            sprite: getLiveSprite(companion.monster),
            x: target.x,
            y: target.y,
            mapNumber: view.mapNumber,
            direction,
            creatureType: 0,
            persistent: false,
            worldScope: view.worldScope,
        });
        companion.serial = serial;
        companion.x = target.x;
        companion.y = target.y;
        companion.mapNumber = view.mapNumber;
        return;
    }

    const distToTarget = Math.abs(companion.x - target.x) + Math.abs(companion.y - target.y);
    if (distToTarget === 0) {
        return;
    }

    const distToPlayer = Math.abs(companion.x - playerX) + Math.abs(companion.y - playerY);
    if (distToPlayer <= 5) {
        walkOneStepAvoidingPlayer(companion, target.x, target.y, playerX, playerY);
        return;
    }

    _npcInjector.removeNPC(companion.serial);
    const serial = _npcInjector.placeNPC({
        name: companion.monster.nickname,
        sprite: getLiveSprite(companion.monster),
        x: target.x,
        y: target.y,
        mapNumber: view.mapNumber,
        direction,
        creatureType: 0,
        persistent: false,
        worldScope: view.worldScope,
    });
    companion.serial = serial;
    companion.x = target.x;
    companion.y = target.y;
    companion.mapNumber = view.mapNumber;
}

export function onPlayerTeleport(session: ProxySession): void {
    const companion = companions.get(session.id);
    if (!companion || !companion.enabled) {
        return;
    }

    const { isInBattle } = require('./battle-engine') as typeof import('./battle-engine');
    if (isInBattle(session.id)) {
        return;
    }

    clearMapChangeRespawnTimer(companion);

    const view = getSessionWorldView(session);
    const playerX = view.x;
    const playerY = view.y;
    const direction = view.direction;
    const target = getBestSidePosition(playerX, playerY, direction, companion.x, companion.y);

    _npcInjector.removeNPC(companion.serial);
    const serial = _npcInjector.placeNPC({
        name: companion.monster.nickname,
        sprite: getLiveSprite(companion.monster),
        x: target.x,
        y: target.y,
        mapNumber: view.mapNumber,
        direction,
        creatureType: 0,
        persistent: false,
        worldScope: view.worldScope,
    });

    companion.serial = serial;
    companion.x = target.x;
    companion.y = target.y;
    companion.mapNumber = view.mapNumber;
    companion.transitioning = false;
}

export function onPlayerMapChange(session: ProxySession): void {
    const companion = companions.get(session.id);
    if (!companion) {
        return;
    }

    clearMapChangeRespawnTimer(companion);
    _npcInjector.removeNPC(companion.serial);
    companion.mapNumber = getSessionWorldView(session).mapNumber;
    companion.transitioning = true;

    companion.mapChangeRespawnTimer = setTimeout(() => {
        companion.mapChangeRespawnTimer = null;

        if (!companions.has(session.id) || session.destroyed) {
            return;
        }

        const current = companions.get(session.id);
        if (current !== companion) {
            return;
        }

        const view = getSessionWorldView(session);
        const direction = getSessionWorldDirection(session);
        const playerX = view.x;
        const playerY = view.y;
        const side = getBestSidePosition(playerX, playerY, direction, playerX, playerY);

        _npcInjector.removeNPC(companion.serial);
        const serial = _npcInjector.placeNPC({
            name: companion.monster.nickname,
            sprite: getLiveSprite(companion.monster),
            x: side.x,
            y: side.y,
            mapNumber: view.mapNumber,
            direction,
            creatureType: 0,
            persistent: false,
            worldScope: view.worldScope,
        });

        companion.serial = serial;
        companion.mapNumber = view.mapNumber;
        companion.x = side.x;
        companion.y = side.y;
        companion.transitioning = false;
    }, 1500);
}

export function onPlayerCombat(session: ProxySession, prevHp: number, currentHp: number): void {
    if (currentHp >= prevHp) {
        return;
    }

    const companion = companions.get(session.id);
    if (!companion || !companion.enabled) {
        return;
    }

    const now = Date.now();
    if (now - companion.lastAttackTime < _config.companionCastCooldownMs) {
        return;
    }

    const autoSession = _automation.getSession(session.id);
    if (!autoSession) {
        return;
    }

    const caster = autoSession.caster;
    const monType = getSpeciesByName(companion.monster.speciesName)?.type || 'Normal';
    const patterns = TYPE_SPELL_PATTERNS[monType] || ['beag'];

    let castSuccess = false;
    for (const pattern of patterns) {
        const spell = caster.findSpell(pattern);
        if (!spell) {
            continue;
        }

        caster.castSpellBySlot(spell.slot);
        castSuccess = true;
        _chat.systemMessage(session, monsterNotice(`${companion.monster.nickname} used ${spell.name}!`));
        sendBodyAnimation(session, companion.serial, 136, 500);
        companion.lastAttackTime = now;
        console.log(`[Companion] ${companion.monster.nickname} auto-cast ${spell.name} for ${session.characterName}`);
        break;
    }

    if (!castSuccess) {
        _chat.systemMessage(session, monsterNotice(`${companion.monster.nickname} attacks!`));
        sendBodyAnimation(session, companion.serial, 1, 300);
        companion.lastAttackTime = now;
    }
}

export async function refreshCompanion(session: ProxySession): Promise<void> {
    const shouldBeOut = companions.has(session.id) || await isCompanionOut(session.characterName);
    despawnCompanion(session.id);

    if (!shouldBeOut || session.destroyed) {
        return;
    }

    const monster = await getActiveMonster(session.characterName);
    if (!monster) {
        return;
    }

    spawnCompanion(session, monster);
}

export function onSessionEnd(sessionId: string): void {
    despawnCompanion(sessionId);
}

function getLiveSprite(monster: CapturedMonster): number {
    const species = getSpeciesByName(monster.speciesName);
    return species ? species.sprite : monster.sprite;
}

function getBestSidePosition(
    playerX: number,
    playerY: number,
    direction: number,
    companionX: number,
    companionY: number,
): { x: number; y: number } {
    const sideOffsets: Record<number, { x: number; y: number }[]> = {
        0: [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
        1: [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }],
        2: [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }],
        3: [{ x: 0, y: 1 }, { x: 0, y: -1 }, { x: 1, y: 0 }],
    };

    const offsets = sideOffsets[direction] || sideOffsets[0];
    let best = { x: playerX + offsets[0].x, y: playerY + offsets[0].y };
    let bestDistance = Math.abs(best.x - companionX) + Math.abs(best.y - companionY);

    for (let i = 1; i < offsets.length; i++) {
        const offset = offsets[i];
        const candidate = { x: playerX + offset.x, y: playerY + offset.y };
        const distance = Math.abs(candidate.x - companionX) + Math.abs(candidate.y - companionY);
        if (distance < bestDistance) {
            best = candidate;
            bestDistance = distance;
        }
    }

    return best;
}

function spawnCompanion(session: ProxySession, monster: CapturedMonster): void {
    const view = getSessionWorldView(session);
    const direction = view.direction;
    const playerX = view.x;
    const playerY = view.y;
    const side = getBestSidePosition(playerX, playerY, direction, playerX, playerY);

    const serial = _npcInjector.placeNPC({
        name: monster.nickname,
        sprite: getLiveSprite(monster),
        x: side.x,
        y: side.y,
        mapNumber: view.mapNumber,
        direction,
        creatureType: 0,
        persistent: false,
        worldScope: view.worldScope,
    });

    companions.set(session.id, {
        serial,
        monster,
        mapNumber: view.mapNumber,
        x: side.x,
        y: side.y,
        enabled: true,
        lastAttackTime: 0,
        mapChangeRespawnTimer: null,
    });

    console.log(`[Companion] ${monster.nickname} spawned for ${session.characterName} at (${side.x},${side.y})`);
}

function despawnCompanion(sessionId: string): void {
    const companion = companions.get(sessionId);
    if (!companion) {
        return;
    }

    const { stopTraining } = require('./training') as typeof import('./training');
    stopTraining(sessionId, 'companion_gone');

    clearMapChangeRespawnTimer(companion);
    _npcInjector.removeNPC(companion.serial);
    companions.delete(sessionId);
}

function clearMapChangeRespawnTimer(companion: CompanionState): void {
    if (!companion.mapChangeRespawnTimer) {
        return;
    }

    clearTimeout(companion.mapChangeRespawnTimer);
    companion.mapChangeRespawnTimer = null;
}

function pickStepTowardTarget(
    companionX: number,
    companionY: number,
    targetX: number,
    targetY: number,
    playerX: number,
    playerY: number,
): { x: number; y: number } | null {
    const candidates = [
        { x: companionX + 1, y: companionY },
        { x: companionX - 1, y: companionY },
        { x: companionX, y: companionY + 1 },
        { x: companionX, y: companionY - 1 },
    ];

    let best: { x: number; y: number } | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
        if (candidate.x === playerX && candidate.y === playerY) {
            continue;
        }

        const distance = Math.abs(candidate.x - targetX) + Math.abs(candidate.y - targetY);
        if (distance < bestDistance) {
            best = candidate;
            bestDistance = distance;
        }
    }

    return best;
}

function walkOneStepAvoidingPlayer(
    companion: CompanionState,
    targetX: number,
    targetY: number,
    playerX: number,
    playerY: number,
): boolean {
    const step = pickStepTowardTarget(companion.x, companion.y, targetX, targetY, playerX, playerY);
    if (!step) {
        return false;
    }

    _npcInjector.moveNPC(companion.serial, step.x, step.y);
    companion.x = step.x;
    companion.y = step.y;
    return true;
}

function sendBodyAnimation(session: ProxySession, entitySerial: number, animation: number, durationMs: number): void {
    const pkt = new Packet(0x1A);
    pkt.writeUInt32(entitySerial);
    pkt.writeByte(animation);
    pkt.writeUInt16(durationMs);
    pkt.writeByte(0xFF);
    _proxy.sendToClient(session, pkt);
}
