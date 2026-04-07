/**
 * Shadow Player Progression — XP/leveling, stat allocation, level-up effects.
 */

import fs from 'fs';
import path from 'path';

export interface ShadowPlayerState {
    shadowLevel: number;
    shadowExp: number;
    shadowExpToNext: number;
    shadowGold: number;
    shadowMaxHp: number;
    shadowMaxMp: number;
    shadowStr: number;
    shadowInt: number;
    shadowWis: number;
    shadowCon: number;
    shadowDex: number;
    shadowAc: number;
    shadowClass: string;
    availableStatPoints: number;
    legendMarks: string[];
}

export type StatName = 'str' | 'int' | 'wis' | 'con' | 'dex';

interface LevelEntry {
    level: number;
    expRequired: number;
    hpGain: number;
    mpGain: number;
    statPoints: number;
}

const LEVEL_TABLE_FILE = path.resolve(__dirname, '../../../../data/afk/level-table.json');

let levelTable: LevelEntry[] = [];

export function loadLevelTable(): void {
    levelTable = [];
    if (!fs.existsSync(LEVEL_TABLE_FILE)) {
        levelTable = generateDefaultLevelTable();
        return;
    }
    try {
        const raw = JSON.parse(fs.readFileSync(LEVEL_TABLE_FILE, 'utf-8'));
        levelTable = Array.isArray(raw) ? raw : raw.levels ?? [];
        console.log(`[Progression] Loaded ${levelTable.length} level entries`);
    } catch (e) {
        console.log(`[Progression] Failed to load level table: ${e}`);
        levelTable = generateDefaultLevelTable();
    }
}

function generateDefaultLevelTable(): LevelEntry[] {
    const entries: LevelEntry[] = [];
    for (let lvl = 1; lvl <= 99; lvl++) {
        entries.push({
            level: lvl,
            expRequired: Math.floor(100 * Math.pow(lvl, 2.2)),
            hpGain: 50 + lvl * 10,
            mpGain: 30 + lvl * 8,
            statPoints: 2,
        });
    }
    return entries;
}

export function getExpToNextLevel(level: number): number {
    const entry = levelTable.find(e => e.level === level);
    return entry?.expRequired ?? Math.floor(100 * Math.pow(level, 2.2));
}

export function getLevelEntry(level: number): LevelEntry | undefined {
    return levelTable.find(e => e.level === level);
}

export interface LevelUpResult {
    newLevel: number;
    hpGain: number;
    mpGain: number;
    statPoints: number;
}

export function checkLevelUp(state: ShadowPlayerState): LevelUpResult | null {
    if (state.shadowLevel >= 99) return null;

    const entry = getLevelEntry(state.shadowLevel);
    if (!entry) return null;

    if (state.shadowExp < entry.expRequired) return null;

    state.shadowExp -= entry.expRequired;
    state.shadowLevel++;

    const nextEntry = getLevelEntry(state.shadowLevel);
    state.shadowExpToNext = nextEntry?.expRequired ?? getExpToNextLevel(state.shadowLevel);
    state.availableStatPoints += entry.statPoints;

    return {
        newLevel: state.shadowLevel,
        hpGain: entry.hpGain,
        mpGain: entry.mpGain,
        statPoints: entry.statPoints,
    };
}

export function raiseStat(state: ShadowPlayerState, stat: StatName): boolean {
    if (state.availableStatPoints <= 0) return false;

    switch (stat) {
        case 'str': state.shadowStr++; break;
        case 'int': state.shadowInt++; break;
        case 'wis': state.shadowWis++; break;
        case 'con': state.shadowCon++; break;
        case 'dex': state.shadowDex++; break;
        default: return false;
    }

    state.availableStatPoints--;
    return true;
}

export function createDefaultShadowPlayerState(
    _realLevel: number, className: string
): ShadowPlayerState {
    const startLevel = 1;
    return {
        shadowLevel: startLevel,
        shadowExp: 0,
        shadowExpToNext: getExpToNextLevel(startLevel),
        shadowGold: 0,
        shadowMaxHp: 200,
        shadowMaxMp: 100,
        shadowStr: 5,
        shadowInt: 5,
        shadowWis: 5,
        shadowCon: 5,
        shadowDex: 5,
        shadowAc: 100,
        shadowClass: className,
        availableStatPoints: 0,
        legendMarks: [],
    };
}

export function shadowStatsToJSON(state: ShadowPlayerState): Record<string, any> {
    return {
        shadowLevel: state.shadowLevel,
        shadowExp: state.shadowExp,
        shadowExpToNext: state.shadowExpToNext,
        shadowGold: state.shadowGold,
        shadowMaxHp: state.shadowMaxHp,
        shadowMaxMp: state.shadowMaxMp,
        shadowStr: state.shadowStr,
        shadowInt: state.shadowInt,
        shadowWis: state.shadowWis,
        shadowCon: state.shadowCon,
        shadowDex: state.shadowDex,
        shadowAc: state.shadowAc,
        shadowClass: state.shadowClass,
        availableStatPoints: state.availableStatPoints,
        legendMarks: state.legendMarks,
    };
}

export function shadowStatsFromJSON(json: Record<string, any>): ShadowPlayerState {
    return {
        shadowLevel: json.shadowLevel ?? 1,
        shadowExp: json.shadowExp ?? 0,
        shadowExpToNext: json.shadowExpToNext ?? getExpToNextLevel(json.shadowLevel ?? 1),
        shadowGold: json.shadowGold ?? 0,
        shadowMaxHp: json.shadowMaxHp ?? 200,
        shadowMaxMp: json.shadowMaxMp ?? 100,
        shadowStr: json.shadowStr ?? 5,
        shadowInt: json.shadowInt ?? 5,
        shadowWis: json.shadowWis ?? 5,
        shadowCon: json.shadowCon ?? 5,
        shadowDex: json.shadowDex ?? 5,
        shadowAc: json.shadowAc ?? 100,
        shadowClass: json.shadowClass ?? 'Peasant',
        availableStatPoints: json.availableStatPoints ?? 0,
        legendMarks: Array.isArray(json.legendMarks) ? json.legendMarks : [],
    };
}
