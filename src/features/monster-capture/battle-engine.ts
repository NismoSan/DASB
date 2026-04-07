import { getMove, getSpeciesByName, getTypeEffectiveness } from './species-data';
import { updateMonster } from './monster-db';
import type {
    BattleMetadata,
    BattleSide,
    BattleState,
    CapturedMonster,
    MonsterType,
    WildEncounter,
} from './types';

export interface TurnResult {
    attackerName: string;
    defenderName: string;
    moveName: string;
    damage: number;
    effectiveness: 'normal' | 'super effective' | 'not very effective' | 'immune' | 'miss';
    attackerSerial: number;
    defenderSerial: number;
    defenderHpPercent: number;
    defenderFainted: boolean;
    healed?: number;
}

export interface RoundResult {
    turnResults: TurnResult[];
    battleOver: boolean;
    winner: BattleSide | null;
}

const battles = new Map<string, BattleState>();
const playerBattles = new Map<string, string>();
let _nextBattleId = 1;

export function getBattle(sessionId: string): BattleState | undefined {
    const battleId = playerBattles.get(sessionId);
    return battleId ? battles.get(battleId) : undefined;
}

export function isInBattle(sessionId: string): boolean {
    return playerBattles.has(sessionId);
}

export function createPvpBattle(
    trainerASession: string,
    monA: CapturedMonster,
    monASerial: number,
    monAX: number,
    monAY: number,
    trainerBSession: string,
    monB: CapturedMonster,
    monBSerial: number,
    monBX: number,
    monBY: number,
    metadata?: BattleMetadata,
): BattleState {
    const id = `battle-${_nextBattleId++}`;
    const battle: BattleState = {
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
        roundToken: 1,
        ending: false,
        ended: false,
        metadata,
    };

    battles.set(id, battle);
    playerBattles.set(trainerASession, id);
    playerBattles.set(trainerBSession, id);
    return battle;
}

export function createWildBattle(
    trainerSession: string,
    mon: CapturedMonster,
    monSerial: number,
    monX: number,
    monY: number,
    wildEncounter: WildEncounter,
    metadata?: BattleMetadata,
): BattleState {
    const id = `battle-${_nextBattleId++}`;
    const battle: BattleState = {
        id,
        type: 'wild',
        trainerA: trainerSession,
        monA: { monster: mon, currentHp: mon.hp, serial: monSerial, x: monX, y: monY },
        trainerB: null,
        monB: null,
        wildMon: { encounter: wildEncounter, currentHp: wildEncounter.hp },
        turn: 'a',
        moveA: null,
        moveB: null,
        active: true,
        roundToken: 1,
        ending: false,
        ended: false,
        metadata,
    };

    battles.set(id, battle);
    playerBattles.set(trainerSession, id);
    return battle;
}

export function createTrainerBattle(
    trainerSession: string,
    monA: CapturedMonster,
    monASerial: number,
    monAX: number,
    monAY: number,
    trainerName: string,
    monB: CapturedMonster,
    monBSerial: number,
    monBX: number,
    monBY: number,
    metadata?: BattleMetadata,
): BattleState {
    const id = `battle-${_nextBattleId++}`;
    const battle: BattleState = {
        id,
        type: 'trainer',
        trainerA: trainerSession,
        monA: { monster: monA, currentHp: monA.hp, serial: monASerial, x: monAX, y: monAY },
        trainerB: null,
        monB: { monster: monB, currentHp: monB.hp, serial: monBSerial, x: monBX, y: monBY },
        wildMon: null,
        turn: monA.spd >= monB.spd ? 'a' : 'b',
        moveA: null,
        moveB: null,
        active: true,
        roundToken: 1,
        ending: false,
        ended: false,
        metadata: {
            mode: 'trainer',
            persistA: true,
            persistB: false,
            trainerName,
            ...(metadata || {}),
        },
    };

    battles.set(id, battle);
    playerBattles.set(trainerSession, id);
    return battle;
}

export function submitMove(battleId: string, side: BattleSide, moveName: string): RoundResult | null {
    const battle = battles.get(battleId);
    if (!battle || !battle.active || battle.ending || battle.ended || battle.winner) {
        return null;
    }

    if (side === 'a') {
        if (battle.moveA !== null) {
            return null;
        }
        battle.moveA = moveName;
    } else {
        if (battle.moveB !== null) {
            return null;
        }
        battle.moveB = moveName;
    }

    if (battle.type === 'wild' && side === 'a' && battle.wildMon) {
        battle.moveB = pickWildMoveName(battle.wildMon.encounter.moves);
    } else if (battle.type === 'trainer' && side === 'a' && battle.monB) {
        battle.moveB = pickWildMoveName(battle.monB.monster.moves.filter(Boolean) as string[]);
    }

    if (battle.moveA === null || battle.moveB === null) {
        return null;
    }

    const roundResult = resolveRound(battle);
    if (!roundResult.battleOver) {
        battle.roundToken += 1;
    }

    return roundResult;
}

export async function finishBattle(
    battleId: string,
    winner: BattleSide,
): Promise<{ winnerName: string; loserName: string }> {
    const battle = battles.get(battleId);
    if (!battle) {
        return { winnerName: '', loserName: '' };
    }

    battle.active = false;
    battle.winner = winner;

    syncMonsterHpToRecords(battle);

    let winnerMon: CapturedMonster | null = null;
    let loserMon: CapturedMonster | null = null;
    let winnerSide: BattleSide | null = null;
    let loserSide: BattleSide | null = null;
    let wildWon = false;

    if (battle.type === 'wild') {
        if (winner === 'a') {
            winnerMon = battle.monA.monster;
            winnerSide = 'a';
        } else {
            wildWon = true;
            loserMon = battle.monA.monster;
            loserSide = 'a';
        }
    } else {
        winnerMon = winner === 'a' ? battle.monA.monster : battle.monB!.monster;
        loserMon = winner === 'a' ? battle.monB!.monster : battle.monA.monster;
        winnerSide = winner;
        loserSide = winner === 'a' ? 'b' : 'a';
    }

    if (winnerMon && winnerSide && shouldPersistSide(battle, winnerSide)) {
        const winXp = 50 + (loserMon ? loserMon.level * 5 : 10);
        winnerMon.wins += 1;
        winnerMon.xp += winXp;
        await updateMonster(winnerMon);
    }

    if (loserMon && loserSide && shouldPersistSide(battle, loserSide)) {
        const loseXp = wildWon ? 5 : 15;
        loserMon.losses += 1;
        loserMon.xp += loseXp;
        await updateMonster(loserMon);
    }

    cleanupBattle(battleId);
    battle.ended = true;

    return {
        winnerName: winnerMon?.nickname || 'wild monster',
        loserName: loserMon?.nickname || 'wild monster',
    };
}

export function forfeitBattle(sessionId: string): BattleState | undefined {
    const battle = getBattle(sessionId);
    if (!battle || battle.ending || battle.ended || battle.winner) {
        return undefined;
    }

    battle.active = false;
    return battle;
}

export function cleanupBattle(battleId: string): void {
    const battle = battles.get(battleId);
    if (!battle) {
        return;
    }

    battle.active = false;
    playerBattles.delete(battle.trainerA);
    if (battle.trainerB) {
        playerBattles.delete(battle.trainerB);
    }
    battles.delete(battleId);
}

function resolveRound(battle: BattleState): RoundResult {
    const moveA = getMove(battle.moveA || 'Tackle') || getMove('Tackle');
    const moveB = getMove(battle.moveB || 'Tackle') || getMove('Tackle');
    if (!moveA || !moveB) {
        throw new Error('Battle could not resolve because fallback move data is missing.');
    }

    const spdA = battle.monA.monster.spd;
    const spdB = battle.type === 'pvp' || battle.type === 'trainer'
        ? battle.monB!.monster.spd
        : battle.wildMon!.encounter.spd;
    const priorityA = moveA.priority || 0;
    const priorityB = moveB.priority || 0;

    let firstSide: BattleSide;
    if (priorityA !== priorityB) {
        firstSide = priorityA > priorityB ? 'a' : 'b';
    } else {
        firstSide = spdA >= spdB ? 'a' : 'b';
    }

    const turnResults: TurnResult[] = [];
    let winner: BattleSide | null = null;

    const firstTurn = executeAttack(battle, firstSide, firstSide === 'a' ? moveA : moveB);
    turnResults.push(firstTurn);
    if (firstTurn.defenderFainted) {
        winner = firstSide;
    }

    if (!winner) {
        const secondSide: BattleSide = firstSide === 'a' ? 'b' : 'a';
        const secondTurn = executeAttack(battle, secondSide, secondSide === 'a' ? moveA : moveB);
        turnResults.push(secondTurn);
        if (secondTurn.defenderFainted) {
            winner = secondSide;
        }
    }

    battle.moveA = null;
    battle.moveB = null;

    if (winner) {
        battle.active = false;
        battle.winner = winner;
    }

    return {
        turnResults,
        battleOver: winner !== null,
        winner,
    };
}

function executeAttack(
    battle: BattleState,
    attackerSide: BattleSide,
    move: NonNullable<ReturnType<typeof getMove>>,
): TurnResult {
    const defenderSide = attackerSide === 'a' ? 'b' : 'a';

    const attacker = getSideInfo(battle, attackerSide);
    const defender = getSideInfo(battle, defenderSide);

    if (move.category === 'status' && move.heals) {
        const healAmount = Math.floor(attacker.maxHp * (move.heals / 100));
        const healedHp = Math.min(attacker.maxHp, attacker.currentHp + healAmount);
        const actualHealed = healedHp - attacker.currentHp;
        setSideCurrentHp(battle, attackerSide, healedHp);

        return {
            attackerName: attacker.name,
            defenderName: defender.name,
            moveName: move.name,
            damage: 0,
            effectiveness: 'normal',
            attackerSerial: attacker.serial,
            defenderSerial: defender.serial,
            defenderHpPercent: getHpPercent(healedHp, attacker.maxHp),
            defenderFainted: false,
            healed: actualHealed,
        };
    }

    if (move.category === 'status') {
        return {
            attackerName: attacker.name,
            defenderName: defender.name,
            moveName: move.name,
            damage: 0,
            effectiveness: 'normal',
            attackerSerial: attacker.serial,
            defenderSerial: defender.serial,
            defenderHpPercent: getHpPercent(defender.currentHp, defender.maxHp),
            defenderFainted: false,
        };
    }

    if (Math.random() * 100 > move.accuracy) {
        return {
            attackerName: attacker.name,
            defenderName: defender.name,
            moveName: move.name,
            damage: 0,
            effectiveness: 'miss',
            attackerSerial: attacker.serial,
            defenderSerial: defender.serial,
            defenderHpPercent: getHpPercent(defender.currentHp, defender.maxHp),
            defenderFainted: false,
        };
    }

    const attackStat = move.category === 'physical' ? attacker.atk : attacker.spAtk;
    const defenseStat = Math.max(1, move.category === 'physical' ? defender.def : defender.spDef);
    const typeMultiplier = getTypeEffectiveness(move.type, defender.speciesType);
    const stab = attacker.speciesType === move.type ? 1.3 : 1.0;
    const variance = 0.85 + Math.random() * 0.15;

    let damage = Math.floor(
        ((((2 * attacker.level) / 5 + 2) * move.power * attackStat / defenseStat) / 50 + 2)
        * stab
        * typeMultiplier
        * variance,
    );
    damage = Math.max(1, damage);

    let effectiveness: TurnResult['effectiveness'] = 'normal';
    if (typeMultiplier > 1) {
        effectiveness = 'super effective';
    } else if (typeMultiplier > 0 && typeMultiplier < 1) {
        effectiveness = 'not very effective';
    } else if (typeMultiplier === 0) {
        damage = 0;
        effectiveness = 'immune';
    }

    const remainingHp = Math.max(0, defender.currentHp - damage);
    setSideCurrentHp(battle, defenderSide, remainingHp);

    return {
        attackerName: attacker.name,
        defenderName: defender.name,
        moveName: move.name,
        damage,
        effectiveness,
        attackerSerial: attacker.serial,
        defenderSerial: defender.serial,
        defenderHpPercent: getHpPercent(remainingHp, defender.maxHp),
        defenderFainted: remainingHp <= 0,
    };
}

function getSideInfo(battle: BattleState, side: BattleSide): {
    name: string;
    serial: number;
    level: number;
    atk: number;
    def: number;
    spAtk: number;
    spDef: number;
    currentHp: number;
    maxHp: number;
    speciesType: MonsterType;
} {
    if (side === 'a') {
        const species = getSpeciesByName(battle.monA.monster.speciesName);
        return {
            name: battle.monA.monster.nickname,
            serial: battle.monA.serial,
            level: battle.monA.monster.level,
            atk: battle.monA.monster.atk,
            def: battle.monA.monster.def,
            spAtk: battle.monA.monster.spAtk,
            spDef: battle.monA.monster.spDef,
            currentHp: battle.monA.currentHp,
            maxHp: battle.monA.monster.maxHp,
            speciesType: species?.type || 'Normal',
        };
    }

    if (battle.type === 'pvp' || battle.type === 'trainer') {
        const species = getSpeciesByName(battle.monB!.monster.speciesName);
        return {
            name: battle.monB!.monster.nickname,
            serial: battle.monB!.serial,
            level: battle.monB!.monster.level,
            atk: battle.monB!.monster.atk,
            def: battle.monB!.monster.def,
            spAtk: battle.monB!.monster.spAtk,
            spDef: battle.monB!.monster.spDef,
            currentHp: battle.monB!.currentHp,
            maxHp: battle.monB!.monster.maxHp,
            speciesType: species?.type || 'Normal',
        };
    }

    return {
        name: battle.wildMon!.encounter.species.name,
        serial: battle.wildMon!.encounter.serial,
        level: battle.wildMon!.encounter.level,
        atk: battle.wildMon!.encounter.atk,
        def: battle.wildMon!.encounter.def,
        spAtk: battle.wildMon!.encounter.spAtk,
        spDef: battle.wildMon!.encounter.spDef,
        currentHp: battle.wildMon!.currentHp,
        maxHp: battle.wildMon!.encounter.maxHp,
        speciesType: battle.wildMon!.encounter.species.type,
    };
}

function setSideCurrentHp(battle: BattleState, side: BattleSide, hp: number): void {
    if (side === 'a') {
        battle.monA.currentHp = hp;
        return;
    }

    if (battle.type === 'pvp' || battle.type === 'trainer') {
        battle.monB!.currentHp = hp;
        return;
    }

    battle.wildMon!.currentHp = hp;
    battle.wildMon!.encounter.hp = hp;
}

function syncMonsterHpToRecords(battle: BattleState): void {
    battle.monA.currentHp = Math.max(0, Math.min(battle.monA.currentHp, battle.monA.monster.maxHp));
    battle.monA.monster.hp = battle.monA.currentHp;

    if (battle.monB) {
        battle.monB.currentHp = Math.max(0, Math.min(battle.monB.currentHp, battle.monB.monster.maxHp));
        battle.monB.monster.hp = battle.monB.currentHp;
    }
}

function pickWildMoveName(moves: string[]): string {
    if (moves.length === 0) {
        return 'Tackle';
    }

    return moves[Math.floor(Math.random() * moves.length)] || 'Tackle';
}

function shouldPersistSide(battle: BattleState, side: BattleSide): boolean {
    if (side === 'a') {
        return battle.metadata?.persistA !== false;
    }
    if (battle.type === 'pvp') {
        return battle.metadata?.persistB !== false;
    }
    if (battle.type === 'trainer') {
        return battle.metadata?.persistB === true;
    }
    return false;
}

function getHpPercent(currentHp: number, maxHp: number): number {
    if (maxHp <= 0) {
        return 0;
    }

    return Math.round((currentHp / maxHp) * 100);
}
