/**
 * Monster AI — composable behaviors for wander/aggro/chase/attack/cast/death.
 * Uses simple directional movement (no A*) for performance at scale.
 */

import { ShadowMonster } from '../shadow-entity';

export interface AiTarget {
    serial: number;
    x: number;
    y: number;
    mapId: number;
}

export interface AiCallbacks {
    getPlayersOnMap: (mapId: number) => AiTarget[];
    isWalkable: (mapId: number, x: number, y: number) => boolean;
    isOccupied: (mapId: number, x: number, y: number) => boolean;
    onMonsterMove: (monster: ShadowMonster, prevX: number, prevY: number, direction: number) => void;
    onMonsterTurn: (monster: ShadowMonster, direction: number) => void;
    onMonsterAssail: (monster: ShadowMonster, target: AiTarget) => void;
    onMonsterCast: (monster: ShadowMonster, target: AiTarget, spellName: string) => void;
    onMonsterUseSkill: (monster: ShadowMonster, target: AiTarget, skillName: string) => void;
}

const DIRECTION_OFFSETS: [number, number][] = [
    [0, -1],  // 0: up
    [1, 0],   // 1: right
    [0, 1],   // 2: down
    [-1, 0],  // 3: left
];

function distance(x1: number, y1: number, x2: number, y2: number): number {
    return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
}

function directionTo(fromX: number, fromY: number, toX: number, toY: number): number {
    const dx = toX - fromX;
    const dy = toY - fromY;
    if (Math.abs(dx) >= Math.abs(dy)) {
        return dx > 0 ? 1 : 3; // right or left
    }
    return dy > 0 ? 2 : 0; // down or up
}

export function updateMonsterAi(monster: ShadowMonster, cb: AiCallbacks): void {
    if (!monster.alive) return;
    const now = Date.now();

    switch (monster.aiState) {
        case 'idle':
        case 'wander':
            handleIdleWander(monster, cb, now);
            break;
        case 'aggro':
        case 'chase':
            handleChase(monster, cb, now);
            break;
        case 'attack':
            handleAttack(monster, cb, now);
            break;
        case 'returning':
            handleReturn(monster, cb, now);
            break;
    }
}

function handleIdleWander(monster: ShadowMonster, cb: AiCallbacks, now: number): void {
    // Scan for aggro targets
    const players = cb.getPlayersOnMap(monster.mapId);
    for (const p of players) {
        const dist = distance(monster.x, monster.y, p.x, p.y);
        if (dist <= monster.aggroRange) {
            monster.addThreat(p.serial, 1);
            monster.aiState = 'chase';
            return;
        }
    }

    // Wander randomly
    if (now - monster.lastWanderTime >= monster.wanderIntervalMs) {
        monster.lastWanderTime = now;
        const dir = Math.floor(Math.random() * 4);
        tryMove(monster, dir, cb, now);
    }
}

function handleChase(monster: ShadowMonster, cb: AiCallbacks, now: number): void {
    const topThreat = monster.getHighestThreat();
    if (!topThreat) {
        monster.aiState = 'idle';
        return;
    }

    const players = cb.getPlayersOnMap(monster.mapId);
    const target = players.find(p => p.serial === topThreat.serial);
    if (!target) {
        monster.removeThreat(topThreat.serial);
        if (monster.aggroTable.length === 0) {
            monster.aiState = 'returning';
        }
        return;
    }

    const dist = distance(monster.x, monster.y, target.x, target.y);

    // Leash check
    if (distance(monster.x, monster.y, monster.spawnX, monster.spawnY) > monster.maxLeashRange) {
        monster.clearAggro();
        monster.aiState = 'returning';
        return;
    }

    // Adjacent — switch to attack
    if (dist <= 1) {
        monster.aiState = 'attack';
        handleAttack(monster, cb, now);
        return;
    }

    // Try casting a spell at range
    if (monster.spells.length > 0 && dist <= monster.aggroRange &&
        now - monster.lastSpellTime >= monster.spellIntervalMs) {
        const spell = monster.spells[Math.floor(Math.random() * monster.spells.length)];
        monster.lastSpellTime = now;
        const dir = directionTo(monster.x, monster.y, target.x, target.y);
        if (monster.direction !== dir) {
            monster.direction = dir;
            cb.onMonsterTurn(monster, dir);
        }
        cb.onMonsterCast(monster, target, spell);
        return;
    }

    // Move toward target
    if (now - monster.lastMoveTime >= monster.moveIntervalMs) {
        const dir = directionTo(monster.x, monster.y, target.x, target.y);
        tryMove(monster, dir, cb, now);
    }
}

function handleAttack(monster: ShadowMonster, cb: AiCallbacks, now: number): void {
    const topThreat = monster.getHighestThreat();
    if (!topThreat) {
        monster.aiState = 'idle';
        return;
    }

    const players = cb.getPlayersOnMap(monster.mapId);
    const target = players.find(p => p.serial === topThreat.serial);
    if (!target) {
        monster.removeThreat(topThreat.serial);
        monster.aiState = monster.aggroTable.length > 0 ? 'chase' : 'returning';
        return;
    }

    const dist = distance(monster.x, monster.y, target.x, target.y);
    if (dist > 1) {
        monster.aiState = 'chase';
        return;
    }

    // Face the target
    const dir = directionTo(monster.x, monster.y, target.x, target.y);
    if (monster.direction !== dir) {
        monster.direction = dir;
        cb.onMonsterTurn(monster, dir);
    }

    // Try skill
    if (monster.skills.length > 0 && now - monster.lastSkillTime >= monster.skillIntervalMs) {
        const skill = monster.skills[Math.floor(Math.random() * monster.skills.length)];
        monster.lastSkillTime = now;
        cb.onMonsterUseSkill(monster, target, skill);
        return;
    }

    // Assail
    if (now - monster.lastAssailTime >= monster.assailIntervalMs) {
        monster.lastAssailTime = now;
        cb.onMonsterAssail(monster, target);
    }
}

function handleReturn(monster: ShadowMonster, cb: AiCallbacks, now: number): void {
    if (monster.x === monster.spawnX && monster.y === monster.spawnY) {
        monster.aiState = 'idle';
        monster.hp = monster.maxHp;
        return;
    }

    if (now - monster.lastMoveTime >= monster.moveIntervalMs) {
        const dir = directionTo(monster.x, monster.y, monster.spawnX, monster.spawnY);
        tryMove(monster, dir, cb, now);
    }
}

function tryMove(monster: ShadowMonster, direction: number, cb: AiCallbacks, now: number): void {
    const [dx, dy] = DIRECTION_OFFSETS[direction];
    const newX = monster.x + dx;
    const newY = monster.y + dy;

    if (!cb.isWalkable(monster.mapId, newX, newY) || cb.isOccupied(monster.mapId, newX, newY)) {
        // Try adjacent directions
        const altDirs = [(direction + 1) % 4, (direction + 3) % 4];
        for (const altDir of altDirs) {
            const [adx, ady] = DIRECTION_OFFSETS[altDir];
            const ax = monster.x + adx;
            const ay = monster.y + ady;
            if (cb.isWalkable(monster.mapId, ax, ay) && !cb.isOccupied(monster.mapId, ax, ay)) {
                doMove(monster, altDir, ax, ay, cb, now);
                return;
            }
        }
        return;
    }

    doMove(monster, direction, newX, newY, cb, now);
}

function doMove(monster: ShadowMonster, direction: number, newX: number, newY: number, cb: AiCallbacks, now: number): void {
    const prevX = monster.x;
    const prevY = monster.y;
    monster.direction = direction;
    monster.x = newX;
    monster.y = newY;
    monster.lastMoveTime = now;
    cb.onMonsterMove(monster, prevX, prevY, direction);
}
