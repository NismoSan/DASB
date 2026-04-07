import Packet from '../../core/packet';
import type ProxyServer from '../../proxy/proxy-server';
import type ProxySession from '../../proxy/proxy-session';
import type NpcInjector from '../../proxy/augmentation/npc-injector';
import type ChatInjector from '../../proxy/augmentation/chat-injector';
import type PlayerRegistry from '../../proxy/player-registry';
import type ProxyCollision from '../../proxy/automation/proxy-collision';
import type { WildEncounter, MonsterCaptureConfig } from './types';
import {
    calculateHp,
    calculateStat,
    calculateXpToNext,
    getMovesForLevel,
    getRandomNature,
    getRandomSpecies,
} from './species-data';
import { getMonsterCount, saveMonster } from './monster-db';
import { monsterDanger, monsterNotice, monsterSuccess } from './message-style';

const activeEncounters = new Map<string, WildEncounter>();
const ENCOUNTER_VIEW_RANGE = 15;

let _proxy: ProxyServer | undefined;

export function setProxy(proxy: ProxyServer): void {
    _proxy = proxy;
}

export function getActiveEncounter(sessionId: string): WildEncounter | undefined {
    return activeEncounters.get(sessionId);
}

export function isEncounterNearby(session: ProxySession, encounter: WildEncounter): boolean {
    return isEncounterVisibleToSession(session, encounter);
}

export function clearEncounter(sessionId: string, npcInjector: NpcInjector): void {
    const encounter = activeEncounters.get(sessionId);
    if (!encounter) {
        return;
    }

    clearTimeout(encounter.despawnTimer);
    npcInjector.removeNPC(encounter.serial);
    activeEncounters.delete(sessionId);
}

export function onPlayerStep(
    session: ProxySession,
    config: MonsterCaptureConfig,
    proxy: ProxyServer,
    npcInjector: NpcInjector,
    chat: ChatInjector,
    registry: PlayerRegistry,
    collision?: ProxyCollision,
): void {
    void proxy;
    void registry;

    if (session.playerState.mapNumber !== config.encounterMapNumber) {
        return;
    }

    if (activeEncounters.has(session.id)) {
        return;
    }

    const playerX = session.playerState.x;
    const playerY = session.playerState.y;

    if (config.grassRegions.length > 0) {
        const inGrass = config.grassRegions.some(region =>
            playerX >= region.x1
            && playerX <= region.x2
            && playerY >= region.y1
            && playerY <= region.y2,
        );

        if (!inGrass) {
            return;
        }
    }

    if (Math.random() > config.encounterRate) {
        return;
    }

    spawnWildEncounter(session, config, npcInjector, chat, collision);
}

export async function attemptCapture(
    session: ProxySession,
    config: MonsterCaptureConfig,
    npcInjector: NpcInjector,
    chat: ChatInjector,
): Promise<void> {
    const encounter = activeEncounters.get(session.id);
    if (!encounter) {
        chat.systemMessage(session, monsterDanger('No wild monster nearby to capture!'));
        return;
    }

    if (!isEncounterVisibleToSession(session, encounter)) {
        clearEncounter(session.id, npcInjector);
        chat.systemMessage(session, monsterDanger('The wild monster is no longer nearby to capture.'));
        return;
    }

    if (encounter.hp <= 0) {
        clearEncounter(session.id, npcInjector);
        chat.systemMessage(session, monsterDanger(`The wild ${encounter.species.name} has already fainted.`));
        return;
    }

    const count = await getMonsterCount(session.characterName);
    if (count >= config.maxMonsters) {
        chat.systemMessage(session, monsterDanger(`You already have ${config.maxMonsters} monsters! Release one first.`));
        return;
    }

    const hpRatio = encounter.hp / encounter.maxHp;
    const captureChance = 0.6 + (1.0 - hpRatio) * 0.4;
    const roll = Math.random();
    const success = roll < captureChance;

    console.log(
        `[Monster] Capture attempt by ${session.characterName}: chance=${(captureChance * 100).toFixed(0)}% `
        + `roll=${(roll * 100).toFixed(0)}% success=${success}`,
    );

    if (!success) {
        chat.systemMessage(session, monsterDanger(`The ${encounter.species.name} broke free! (${(captureChance * 100).toFixed(0)}% chance)`));
        sendBodyAnimation(session, encounter.serial, 26, 500);
        return;
    }

    const nature = getRandomNature();
    const moves = getMovesForLevel(encounter.species, encounter.level);
    const paddedMoves: (string | null)[] = [...moves];
    while (paddedMoves.length < 4) {
        paddedMoves.push(null);
    }

    const monster = {
        id: 0,
        ownerName: session.characterName,
        speciesName: encounter.species.name,
        sprite: encounter.species.sprite,
        nickname: encounter.species.name,
        level: encounter.level,
        xp: 0,
        xpToNext: calculateXpToNext(encounter.level),
        hp: encounter.maxHp,
        maxHp: encounter.maxHp,
        atk: encounter.atk,
        def: encounter.def,
        spd: encounter.spd,
        spAtk: encounter.spAtk,
        spDef: encounter.spDef,
        nature,
        moves: paddedMoves,
        wins: 0,
        losses: 0,
        isActive: count === 0,
        capturedAt: new Date(),
    };

    const id = await saveMonster(monster);
    monster.id = id;

    clearEncounter(session.id, npcInjector);

    sendEffect(session, encounter.serial, session.playerState.serial, 100, 0, 500);
    chat.systemMessage(session, monsterSuccess(`Caught a level ${encounter.level} ${encounter.species.name}! (${nature} nature)`));
    if (count === 0) {
        chat.systemMessage(session, monsterSuccess(`${encounter.species.name} is now your active monster! Use /companion to toggle following.`));
    }

    console.log(
        `[Monster] ${session.characterName} captured ${encounter.species.name} `
        + `(id=${id}, level=${encounter.level}, nature=${nature})`,
    );
}

export function damageWildMonster(
    sessionId: string,
    damage: number,
    proxy: ProxyServer,
    session: ProxySession,
    npcInjector: NpcInjector,
    chat: ChatInjector,
): boolean {
    void proxy;

    const encounter = activeEncounters.get(sessionId);
    if (!encounter) {
        return false;
    }

    encounter.hp = Math.max(0, encounter.hp - damage);
    const percent = Math.round((encounter.hp / encounter.maxHp) * 100);
    sendHealthBar(session, encounter.serial, percent);

    if (encounter.hp <= 0) {
        chat.systemMessage(session, monsterDanger(`The wild ${encounter.species.name} fainted!`));
        clearEncounter(sessionId, npcInjector);
        return true;
    }

    return false;
}

export function onPlayerMapChange(sessionId: string, npcInjector: NpcInjector): void {
    clearEncounter(sessionId, npcInjector);
}

export function onSessionEnd(sessionId: string, npcInjector: NpcInjector): void {
    clearEncounter(sessionId, npcInjector);
}

function spawnWildEncounter(
    session: ProxySession,
    config: MonsterCaptureConfig,
    npcInjector: NpcInjector,
    chat: ChatInjector,
    collision?: ProxyCollision,
): void {
    const species = getRandomSpecies();
    const playerLevel = session.playerState.level || 1;
    const level = Math.max(1, Math.floor(Math.random() * 5) + 1 + Math.floor(Math.random() * (playerLevel / 3)));
    const nature = getRandomNature();
    const hp = calculateHp(species.baseHp, level);
    const atk = calculateStat(species.baseAtk, level, nature, 'atk');
    const def = calculateStat(species.baseDef, level, nature, 'def');
    const spd = calculateStat(species.baseSpd, level, nature, 'spd');
    const spAtk = calculateStat(species.baseSpAtk, level, nature, 'spAtk');
    const spDef = calculateStat(species.baseSpDef, level, nature, 'spDef');
    const moves = getMovesForLevel(species, level);

    const mapId = session.playerState.mapNumber;
    const playerX = session.playerState.x;
    const playerY = session.playerState.y;
    const spawnPos = findWalkableNearby(playerX, playerY, mapId, collision);
    if (!spawnPos) {
        console.log(`[Monster] No walkable tile near (${playerX},${playerY}) on map ${mapId} - skipping encounter`);
        return;
    }

    const serial = npcInjector.placeNPC({
        name: `${species.name} Lv.${level}`,
        sprite: species.sprite,
        x: spawnPos.x,
        y: spawnPos.y,
        mapNumber: config.encounterMapNumber,
        direction: (session.playerState.direction + 2) % 4,
        creatureType: 0,
        persistent: false,
    });

    const despawnTimer = setTimeout(() => {
        const active = activeEncounters.get(session.id);
        if (!active || active.serial !== serial) {
            return;
        }

        chat.systemMessage(session, monsterDanger(`The wild ${species.name} fled!`));
        npcInjector.removeNPC(serial);
        activeEncounters.delete(session.id);
    }, config.wildDespawnMs);

    activeEncounters.set(session.id, {
        serial,
        species,
        level,
        hp,
        maxHp: hp,
        atk,
        def,
        spd,
        spAtk,
        spDef,
        moves,
        x: spawnPos.x,
        y: spawnPos.y,
        spawnedAt: Date.now(),
        despawnTimer,
    });

    sendHealthBar(session, serial, 100);
    chat.systemMessage(session, monsterNotice(`A wild ${species.name} (Lv.${level}) appeared! Use /capture or /fight`));
    console.log(
        `[Monster] Wild ${species.name} Lv.${level} spawned for ${session.characterName} `
        + `at (${spawnPos.x},${spawnPos.y})`,
    );
}

function isEncounterVisibleToSession(session: ProxySession, encounter: WildEncounter): boolean {
    return Math.abs(encounter.x - session.playerState.x) < ENCOUNTER_VIEW_RANGE
        && Math.abs(encounter.y - session.playerState.y) < ENCOUNTER_VIEW_RANGE;
}

function findWalkableNearby(
    originX: number,
    originY: number,
    mapId: number,
    collision?: ProxyCollision,
): { x: number; y: number } | null {
    const offsets = [
        { x: 0, y: -2 }, { x: 2, y: 0 }, { x: 0, y: 2 }, { x: -2, y: 0 },
        { x: 2, y: -2 }, { x: 2, y: 2 }, { x: -2, y: 2 }, { x: -2, y: -2 },
        { x: 0, y: -3 }, { x: 3, y: 0 }, { x: 0, y: 3 }, { x: -3, y: 0 },
        { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
        { x: 3, y: -3 }, { x: 3, y: 3 }, { x: -3, y: 3 }, { x: -3, y: -3 },
        { x: 0, y: -4 }, { x: 4, y: 0 }, { x: 0, y: 4 }, { x: -4, y: 0 },
    ];

    for (let i = 3; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [offsets[i], offsets[j]] = [offsets[j], offsets[i]];
    }

    for (const offset of offsets) {
        const tileX = originX + offset.x;
        const tileY = originY + offset.y;
        if (tileX < 0 || tileY < 0) {
            continue;
        }

        if (collision && !collision.isWalkable(mapId, tileX, tileY)) {
            continue;
        }

        return { x: tileX, y: tileY };
    }

    return null;
}

function sendHealthBar(session: ProxySession, entitySerial: number, hpPercent: number): void {
    const pkt = new Packet(0x13);
    pkt.writeUInt32(entitySerial);
    pkt.writeByte(0x00);
    pkt.writeByte(hpPercent);
    pkt.writeByte(0xFF);
    _proxy?.sendToClient(session, pkt);
}

function sendBodyAnimation(session: ProxySession, entitySerial: number, animation: number, durationMs: number): void {
    const pkt = new Packet(0x1A);
    pkt.writeUInt32(entitySerial);
    pkt.writeByte(animation);
    pkt.writeUInt16(durationMs);
    pkt.writeByte(0xFF);
    _proxy?.sendToClient(session, pkt);
}

function sendEffect(
    session: ProxySession,
    targetSerial: number,
    sourceSerial: number,
    targetAnim: number,
    sourceAnim: number,
    durationMs: number,
): void {
    const pkt = new Packet(0x29);
    pkt.writeUInt32(targetSerial);
    pkt.writeUInt32(sourceSerial);
    pkt.writeUInt16(targetAnim);
    pkt.writeUInt16(sourceAnim);
    pkt.writeUInt16(durationMs);
    _proxy?.sendToClient(session, pkt);
}
