import type { MonsterSpecies, Move, MonsterType, Nature, NatureModifier, SpeciesDataConfig } from './types';

// ── Type Effectiveness Chart ─────────────────────────────────────

const TYPE_CHART: Record<MonsterType, Partial<Record<MonsterType, number>>> = {
    Fire: { Ice: 1.5, Earth: 0.67, Fire: 0.67, Wind: 1.5, Dark: 1.0 },
    Ice: { Wind: 1.5, Fire: 0.67, Earth: 1.5, Ice: 0.67, Arcane: 0.67 },
    Wind: { Earth: 1.5, Ice: 0.67, Fire: 0.67, Dark: 1.5, Light: 0.67 },
    Earth: { Fire: 1.5, Wind: 0.67, Light: 1.5, Ice: 0.67, Arcane: 0.67 },
    Dark: { Light: 1.5, Arcane: 1.5, Dark: 0.67, Earth: 0.67 },
    Light: { Dark: 1.5, Arcane: 0.67, Wind: 1.5, Light: 0.67 },
    Arcane: { Normal: 1.5, Dark: 0.67, Light: 1.5, Arcane: 0.67 },
    Normal: {},
};

export function getTypeEffectiveness(attackType: MonsterType, defendType: MonsterType): number {
    return TYPE_CHART[attackType]?.[defendType] ?? 1.0;
}

// ── Runtime Data (mutable, loaded from config) ───────────────────

let _moves: Record<string, Move> = {};
let _species: MonsterSpecies[] = [];
let _evolvedSpecies: MonsterSpecies[] = [];
let _moveAliases: Record<string, string> = {};

// ── Default Data ─────────────────────────────────────────────────

const DEFAULT_MOVES: Record<string, Move> = {
    Tackle: { name: 'Tackle', type: 'Normal', power: 40, accuracy: 100, category: 'physical', animationId: 1, sourceAnimationId: 1, soundId: 1 },
    Bite: { name: 'Bite', type: 'Normal', power: 50, accuracy: 100, category: 'physical', animationId: 2, sourceAnimationId: 2, soundId: 2 },
    Howl: { name: 'Howl', type: 'Normal', power: 0, accuracy: 100, category: 'status', animationId: 6, sourceAnimationId: 3, targetsSelf: true },
    'Fang Strike': { name: 'Fang Strike', type: 'Normal', power: 70, accuracy: 90, category: 'physical', animationId: 134, sourceAnimationId: 4 },
    Ember: { name: 'Ember', type: 'Fire', power: 45, accuracy: 100, category: 'special', animationId: 135, sourceAnimationId: 5 },
    'Flame Claw': { name: 'Flame Claw', type: 'Fire', power: 60, accuracy: 95, category: 'physical', animationId: 139, sourceAnimationId: 6 },
    'Flame Breath': { name: 'Flame Breath', type: 'Fire', power: 75, accuracy: 90, category: 'special', animationId: 137, sourceAnimationId: 7 },
    Inferno: { name: 'Inferno', type: 'Fire', power: 100, accuracy: 75, category: 'special', animationId: 142, sourceAnimationId: 8 },
    'Mud Slap': { name: 'Mud Slap', type: 'Earth', power: 35, accuracy: 100, category: 'special', animationId: 128, sourceAnimationId: 9 },
    'Rock Throw': { name: 'Rock Throw', type: 'Earth', power: 55, accuracy: 90, category: 'physical', animationId: 129, sourceAnimationId: 10 },
    'Earth Slam': { name: 'Earth Slam', type: 'Earth', power: 80, accuracy: 85, category: 'physical', animationId: 141, sourceAnimationId: 11 },
    Spark: { name: 'Spark', type: 'Arcane', power: 40, accuracy: 100, category: 'special', animationId: 136, sourceAnimationId: 12 },
    Flash: { name: 'Flash', type: 'Arcane', power: 0, accuracy: 100, category: 'status', animationId: 143, sourceAnimationId: 13, targetsSelf: false },
    'Arcane Bolt': { name: 'Arcane Bolt', type: 'Arcane', power: 65, accuracy: 95, category: 'special', animationId: 138, sourceAnimationId: 14 },
    'Mind Blast': { name: 'Mind Blast', type: 'Arcane', power: 85, accuracy: 85, category: 'special', animationId: 144, sourceAnimationId: 15 },
    'Poison Sting': { name: 'Poison Sting', type: 'Dark', power: 40, accuracy: 100, category: 'physical', animationId: 133, sourceAnimationId: 16 },
    'Web Trap': { name: 'Web Trap', type: 'Dark', power: 0, accuracy: 90, category: 'status', animationId: 127, sourceAnimationId: 17, targetsSelf: false },
    'Venom Fang': { name: 'Venom Fang', type: 'Dark', power: 70, accuracy: 90, category: 'physical', animationId: 132, sourceAnimationId: 18 },
    'Heal Pulse': { name: 'Heal Pulse', type: 'Light', power: 0, accuracy: 100, category: 'status', heals: 30, animationId: 145, sourceAnimationId: 19 },
    'Ice Shard': { name: 'Ice Shard', type: 'Ice', power: 50, accuracy: 100, category: 'physical', priority: 1, animationId: 131, sourceAnimationId: 20 },
    'Frost Bite': { name: 'Frost Bite', type: 'Ice', power: 60, accuracy: 95, category: 'special', animationId: 130, sourceAnimationId: 21 },
    Gust: { name: 'Gust', type: 'Wind', power: 45, accuracy: 100, category: 'special', animationId: 125, sourceAnimationId: 22 },
    Cyclone: { name: 'Cyclone', type: 'Wind', power: 75, accuracy: 85, category: 'special', animationId: 126, sourceAnimationId: 23 },
};

const DEFAULT_SPECIES: MonsterSpecies[] = [
    { sprite: 33, name: 'Goblin', type: 'Earth', baseHp: 45, baseAtk: 49, baseDef: 49, baseSpd: 45, baseSpAtk: 35, baseSpDef: 35,
        moves: { 1: 'Tackle', 5: 'Mud Slap', 10: 'Rock Throw', 15: 'Earth Slam' }, evolution: { level: 16, sprite: 58, name: 'Hobgoblin' } },
    { sprite: 17, name: 'Wolf', type: 'Normal', baseHp: 40, baseAtk: 55, baseDef: 40, baseSpd: 60, baseSpAtk: 30, baseSpDef: 40,
        moves: { 1: 'Tackle', 4: 'Bite', 9: 'Howl', 14: 'Fang Strike' }, evolution: { level: 18, sprite: 46, name: 'Dire Wolf' } },
    { sprite: 25, name: 'Wisp', type: 'Arcane', baseHp: 35, baseAtk: 30, baseDef: 30, baseSpd: 65, baseSpAtk: 60, baseSpDef: 45,
        moves: { 1: 'Spark', 5: 'Flash', 10: 'Arcane Bolt', 15: 'Mind Blast' }, evolution: { level: 20, sprite: 72, name: 'Phantom' } },
    { sprite: 4, name: 'Spider', type: 'Dark', baseHp: 40, baseAtk: 50, baseDef: 35, baseSpd: 55, baseSpAtk: 40, baseSpDef: 35,
        moves: { 1: 'Bite', 4: 'Poison Sting', 8: 'Web Trap', 13: 'Venom Fang' }, evolution: { level: 17, sprite: 53, name: 'Arachnid' } },
    { sprite: 38, name: 'Scorpion', type: 'Fire', baseHp: 50, baseAtk: 55, baseDef: 55, baseSpd: 35, baseSpAtk: 40, baseSpDef: 40,
        moves: { 1: 'Tackle', 5: 'Ember', 10: 'Flame Claw', 16: 'Inferno' }, evolution: { level: 22, sprite: 83, name: 'Magma Scorpion' } },
];

const DEFAULT_EVOLVED: MonsterSpecies[] = [
    { sprite: 58, name: 'Hobgoblin', type: 'Earth', baseHp: 65, baseAtk: 69, baseDef: 69, baseSpd: 55, baseSpAtk: 50, baseSpDef: 50, moves: { 1: 'Tackle', 5: 'Mud Slap', 10: 'Rock Throw', 15: 'Earth Slam' } },
    { sprite: 46, name: 'Dire Wolf', type: 'Normal', baseHp: 60, baseAtk: 80, baseDef: 55, baseSpd: 80, baseSpAtk: 40, baseSpDef: 55, moves: { 1: 'Tackle', 4: 'Bite', 9: 'Howl', 14: 'Fang Strike' } },
    { sprite: 72, name: 'Phantom', type: 'Arcane', baseHp: 50, baseAtk: 40, baseDef: 45, baseSpd: 85, baseSpAtk: 90, baseSpDef: 65, moves: { 1: 'Spark', 5: 'Flash', 10: 'Arcane Bolt', 15: 'Mind Blast' } },
    { sprite: 53, name: 'Arachnid', type: 'Dark', baseHp: 55, baseAtk: 70, baseDef: 50, baseSpd: 75, baseSpAtk: 55, baseSpDef: 50, moves: { 1: 'Bite', 4: 'Poison Sting', 8: 'Web Trap', 13: 'Venom Fang' } },
    { sprite: 83, name: 'Magma Scorpion', type: 'Fire', baseHp: 70, baseAtk: 75, baseDef: 75, baseSpd: 45, baseSpAtk: 60, baseSpDef: 55, moves: { 1: 'Tackle', 5: 'Ember', 10: 'Flame Claw', 16: 'Inferno' } },
];

// ── Load from config ─────────────────────────────────────────────

export function loadSpeciesData(config?: SpeciesDataConfig): void {
    if (config?.moves && Object.keys(config.moves).length > 0) {
        _moves = normalizeMoves(config.moves);
        console.log(`[Monster] Loaded ${Object.keys(_moves).length} moves from config`);
    } else {
        _moves = normalizeMoves(DEFAULT_MOVES);
        console.log(`[Monster] Using ${Object.keys(_moves).length} default moves`);
    }

    if (config?.species && config.species.length > 0) {
        _species = [...config.species];
        console.log(`[Monster] Loaded ${_species.length} species from config`);
    } else {
        _species = [...DEFAULT_SPECIES];
        console.log(`[Monster] Using ${_species.length} default species`);
    }

    if (config?.evolvedSpecies && config.evolvedSpecies.length > 0) {
        _evolvedSpecies = [...config.evolvedSpecies];
        console.log(`[Monster] Loaded ${_evolvedSpecies.length} evolved species from config`);
    } else {
        _evolvedSpecies = [...DEFAULT_EVOLVED];
        console.log(`[Monster] Using ${_evolvedSpecies.length} default evolved species`);
    }
}

// Initialize with defaults
loadSpeciesData();

// ── Accessors ────────────────────────────────────────────────────

export function getAllSpecies(): MonsterSpecies[] { return _species; }
export function getAllEvolvedSpecies(): MonsterSpecies[] { return _evolvedSpecies; }
export function getAllMoves(): Record<string, Move> { return _moves; }

export function getSpeciesBySprite(sprite: number): MonsterSpecies | undefined {
    return _species.find(s => s.sprite === sprite) || _evolvedSpecies.find(s => s.sprite === sprite);
}

export function getSpeciesByName(name: string): MonsterSpecies | undefined {
    const lower = name.toLowerCase();
    return _species.find(s => s.name.toLowerCase() === lower)
        || _evolvedSpecies.find(s => s.name.toLowerCase() === lower);
}

export function getRandomSpecies(): MonsterSpecies {
    return _species[Math.floor(Math.random() * _species.length)];
}

export function getMove(name: string): Move | undefined {
    const direct = _moves[name];
    if (direct) {
        return direct;
    }

    const normalized = normalizeMoveName(name);
    const alias = _moveAliases[normalized];
    return alias ? _moves[alias] : undefined;
}

// ── Nature Modifiers ─────────────────────────────────────────────

export const NATURE_MODIFIERS: Record<Nature, NatureModifier> = {
    Brave: { increased: 'atk', decreased: 'spd' },
    Bold: { increased: 'def', decreased: 'atk' },
    Timid: { increased: 'spd', decreased: 'atk' },
    Modest: { increased: 'spAtk', decreased: 'atk' },
    Calm: { increased: 'spDef', decreased: 'atk' },
    Adamant: { increased: 'atk', decreased: 'spAtk' },
    Jolly: { increased: 'spd', decreased: 'spAtk' },
    Hasty: { increased: 'spd', decreased: 'def' },
    Quiet: { increased: 'spAtk', decreased: 'spd' },
};

const ALL_NATURES = Object.keys(NATURE_MODIFIERS) as Nature[];

export function getRandomNature(): Nature {
    return ALL_NATURES[Math.floor(Math.random() * ALL_NATURES.length)];
}

// ── Stat Calculation ─────────────────────────────────────────────

export function calculateStat(baseStat: number, level: number, nature: Nature, statKey: string): number {
    const mod = NATURE_MODIFIERS[nature];
    let multiplier = 1.0;
    if (mod.increased === statKey) {
        multiplier = 1.1;
    } else if (mod.decreased === statKey) {
        multiplier = 0.9;
    }
    return Math.floor((baseStat + level * 2) * multiplier);
}

export function calculateHp(baseHp: number, level: number): number {
    return Math.floor(baseHp + level * 3 + 10);
}

export function calculateXpToNext(level: number): number {
    return level * level * 50;
}

export function getMovesForLevel(species: MonsterSpecies, level: number): string[] {
    const learned: string[] = [];
    const levels = Object.keys(species.moves).map(Number).sort((a, b) => a - b);
    for (const lvl of levels) {
        if (lvl <= level) {
            learned.push(species.moves[lvl]);
        }
    }
    return learned.slice(-4);
}

// ── Spell Mapping for Companion Auto-Cast ────────────────────────

export const TYPE_SPELL_PATTERNS: Record<MonsterType, string[]> = {
    Fire: ['mor', 'srad', 'athar'],
    Ice: ['sal', 'creag'],
    Wind: ['athar', 'fas'],
    Earth: ['creag', 'mor'],
    Dark: ['cradh', 'pramh', 'dall'],
    Light: ['ioc', 'ao', 'beag'],
    Arcane: ['mor', 'ard', 'sal'],
    Normal: ['beag', 'mor'],
};

function normalizeMoves(moves: Record<string, Move>): Record<string, Move> {
    const normalizedMoves: Record<string, Move> = {};
    _moveAliases = {};

    for (const [key, move] of Object.entries(moves)) {
        const normalizedMove = normalizeMoveDefinition(key, move);
        normalizedMoves[key] = normalizedMove;
        _moveAliases[normalizeMoveName(key)] = key;
        _moveAliases[normalizeMoveName(normalizedMove.name)] = key;
    }

    return normalizedMoves;
}

function normalizeMoveDefinition(key: string, move: Move): Move {
    const rawMove = (move || {}) as Move & Record<string, unknown>;
    const normalized: Move = {
        name: typeof rawMove.name === 'string' && rawMove.name.trim() ? rawMove.name.trim() : key,
        type: rawMove.type as MonsterType,
        power: toNumber(rawMove.power, 0),
        accuracy: toNumber(rawMove.accuracy, 100),
        category: rawMove.category,
    };

    const priority = toOptionalNumber(rawMove.priority);
    if (priority !== undefined) {
        normalized.priority = priority;
    }

    const heals = toOptionalNumber(rawMove.heals);
    if (heals !== undefined) {
        normalized.heals = heals;
    }

    const animationId = toOptionalNumber(rawMove.animationId ?? rawMove.animId ?? rawMove.targetAnimationId);
    if (animationId !== undefined) {
        normalized.animationId = animationId;
    }

    const sourceAnimationId = toOptionalNumber(
        rawMove.sourceAnimationId
        ?? rawMove.sourceAnimId
        ?? rawMove.sourceAnim
        ?? rawMove.casterAnimationId,
    );
    if (sourceAnimationId !== undefined) {
        normalized.sourceAnimationId = sourceAnimationId;
    }

    const bodyAnimationId = toOptionalNumber(rawMove.bodyAnimationId ?? rawMove.bodyAnimId ?? rawMove.bodyAnim);
    if (bodyAnimationId !== undefined) {
        normalized.bodyAnimationId = bodyAnimationId;
    }

    const soundId = toOptionalNumber(rawMove.soundId ?? rawMove.sound ?? rawMove.soundEffectId);
    if (soundId !== undefined) {
        normalized.soundId = soundId;
    }

    if (rawMove.targetsSelf === true) {
        normalized.targetsSelf = true;
    }

    return normalized;
}

function normalizeMoveName(name: string): string {
    return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function toNumber(value: unknown, fallback: number): number {
    const parsed = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function toOptionalNumber(value: unknown): number | undefined {
    if (value === '' || value === null || value === undefined) {
        return undefined;
    }

    const parsed = typeof value === 'number' ? value : parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
}
