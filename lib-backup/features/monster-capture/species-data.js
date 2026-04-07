"use strict";
// ── DA Monsters: Species, Moves, Type Chart ──────────────────────
// Species and moves can be loaded from config at runtime (panel-managed).
// Hardcoded defaults are used if no config is provided.
Object.defineProperty(exports, "__esModule", { value: true });
exports.TYPE_SPELL_PATTERNS = exports.NATURE_MODIFIERS = void 0;
exports.getTypeEffectiveness = getTypeEffectiveness;
exports.loadSpeciesData = loadSpeciesData;
exports.getAllSpecies = getAllSpecies;
exports.getAllEvolvedSpecies = getAllEvolvedSpecies;
exports.getAllMoves = getAllMoves;
exports.getSpeciesBySprite = getSpeciesBySprite;
exports.getSpeciesByName = getSpeciesByName;
exports.getRandomSpecies = getRandomSpecies;
exports.getMove = getMove;
exports.getRandomNature = getRandomNature;
exports.calculateStat = calculateStat;
exports.calculateHp = calculateHp;
exports.calculateXpToNext = calculateXpToNext;
exports.getMovesForLevel = getMovesForLevel;
// ── Type Effectiveness Chart ─────────────────────────────────────
const TYPE_CHART = {
    Fire: { Ice: 1.5, Earth: 0.67, Fire: 0.67, Wind: 1.5, Dark: 1.0 },
    Ice: { Wind: 1.5, Fire: 0.67, Earth: 1.5, Ice: 0.67, Arcane: 0.67 },
    Wind: { Earth: 1.5, Ice: 0.67, Fire: 0.67, Dark: 1.5, Light: 0.67 },
    Earth: { Fire: 1.5, Wind: 0.67, Light: 1.5, Ice: 0.67, Arcane: 0.67 },
    Dark: { Light: 1.5, Arcane: 1.5, Dark: 0.67, Earth: 0.67 },
    Light: { Dark: 1.5, Arcane: 0.67, Wind: 1.5, Light: 0.67 },
    Arcane: { Normal: 1.5, Dark: 0.67, Light: 1.5, Arcane: 0.67 },
    Normal: {},
};
function getTypeEffectiveness(attackType, defendType) {
    return TYPE_CHART[attackType]?.[defendType] ?? 1.0;
}
// ── Runtime Data (mutable, loaded from config) ───────────────────
let _moves = {};
let _species = [];
let _evolvedSpecies = [];
// ── Default Data ─────────────────────────────────────────────────
const DEFAULT_MOVES = {
    'Tackle': { name: 'Tackle', type: 'Normal', power: 40, accuracy: 100, category: 'physical', animationId: 1, soundId: 1 },
    'Bite': { name: 'Bite', type: 'Normal', power: 50, accuracy: 100, category: 'physical', animationId: 1, soundId: 2 },
    'Howl': { name: 'Howl', type: 'Normal', power: 0, accuracy: 100, category: 'status', animationId: 6 },
    'Fang Strike': { name: 'Fang Strike', type: 'Normal', power: 70, accuracy: 90, category: 'physical', animationId: 134 },
    'Ember': { name: 'Ember', type: 'Fire', power: 45, accuracy: 100, category: 'special', animationId: 136 },
    'Flame Claw': { name: 'Flame Claw', type: 'Fire', power: 60, accuracy: 95, category: 'physical', animationId: 139 },
    'Flame Breath': { name: 'Flame Breath', type: 'Fire', power: 75, accuracy: 90, category: 'special', animationId: 136 },
    'Inferno': { name: 'Inferno', type: 'Fire', power: 100, accuracy: 75, category: 'special', animationId: 136 },
    'Mud Slap': { name: 'Mud Slap', type: 'Earth', power: 35, accuracy: 100, category: 'special', animationId: 128 },
    'Rock Throw': { name: 'Rock Throw', type: 'Earth', power: 55, accuracy: 90, category: 'physical', animationId: 129 },
    'Earth Slam': { name: 'Earth Slam', type: 'Earth', power: 80, accuracy: 85, category: 'physical', animationId: 141 },
    'Spark': { name: 'Spark', type: 'Arcane', power: 40, accuracy: 100, category: 'special', animationId: 136 },
    'Flash': { name: 'Flash', type: 'Arcane', power: 0, accuracy: 100, category: 'status', animationId: 6 },
    'Arcane Bolt': { name: 'Arcane Bolt', type: 'Arcane', power: 65, accuracy: 95, category: 'special', animationId: 136 },
    'Mind Blast': { name: 'Mind Blast', type: 'Arcane', power: 85, accuracy: 85, category: 'special', animationId: 136 },
    'Poison Sting': { name: 'Poison Sting', type: 'Dark', power: 40, accuracy: 100, category: 'physical', animationId: 134 },
    'Web Trap': { name: 'Web Trap', type: 'Dark', power: 0, accuracy: 90, category: 'status', animationId: 128 },
    'Venom Fang': { name: 'Venom Fang', type: 'Dark', power: 70, accuracy: 90, category: 'physical', animationId: 134 },
    'Heal Pulse': { name: 'Heal Pulse', type: 'Light', power: 0, accuracy: 100, category: 'status', heals: 30, animationId: 128 },
    'Ice Shard': { name: 'Ice Shard', type: 'Ice', power: 50, accuracy: 100, category: 'physical', priority: 1, animationId: 136 },
    'Frost Bite': { name: 'Frost Bite', type: 'Ice', power: 60, accuracy: 95, category: 'special', animationId: 136 },
    'Gust': { name: 'Gust', type: 'Wind', power: 45, accuracy: 100, category: 'special', animationId: 136 },
    'Cyclone': { name: 'Cyclone', type: 'Wind', power: 75, accuracy: 85, category: 'special', animationId: 136 },
};
const DEFAULT_SPECIES = [
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
const DEFAULT_EVOLVED = [
    { sprite: 58, name: 'Hobgoblin', type: 'Earth', baseHp: 65, baseAtk: 69, baseDef: 69, baseSpd: 55, baseSpAtk: 50, baseSpDef: 50, moves: { 1: 'Tackle', 5: 'Mud Slap', 10: 'Rock Throw', 15: 'Earth Slam' } },
    { sprite: 46, name: 'Dire Wolf', type: 'Normal', baseHp: 60, baseAtk: 80, baseDef: 55, baseSpd: 80, baseSpAtk: 40, baseSpDef: 55, moves: { 1: 'Tackle', 4: 'Bite', 9: 'Howl', 14: 'Fang Strike' } },
    { sprite: 72, name: 'Phantom', type: 'Arcane', baseHp: 50, baseAtk: 40, baseDef: 45, baseSpd: 85, baseSpAtk: 90, baseSpDef: 65, moves: { 1: 'Spark', 5: 'Flash', 10: 'Arcane Bolt', 15: 'Mind Blast' } },
    { sprite: 53, name: 'Arachnid', type: 'Dark', baseHp: 55, baseAtk: 70, baseDef: 50, baseSpd: 75, baseSpAtk: 55, baseSpDef: 50, moves: { 1: 'Bite', 4: 'Poison Sting', 8: 'Web Trap', 13: 'Venom Fang' } },
    { sprite: 83, name: 'Magma Scorpion', type: 'Fire', baseHp: 70, baseAtk: 75, baseDef: 75, baseSpd: 45, baseSpAtk: 60, baseSpDef: 55, moves: { 1: 'Tackle', 5: 'Ember', 10: 'Flame Claw', 16: 'Inferno' } },
];
// ── Load from config ─────────────────────────────────────────────
function loadSpeciesData(config) {
    if (config?.moves && Object.keys(config.moves).length > 0) {
        _moves = { ...config.moves };
        console.log(`[Monster] Loaded ${Object.keys(_moves).length} moves from config`);
    }
    else {
        _moves = { ...DEFAULT_MOVES };
        console.log(`[Monster] Using ${Object.keys(_moves).length} default moves`);
    }
    if (config?.species && config.species.length > 0) {
        _species = [...config.species];
        console.log(`[Monster] Loaded ${_species.length} species from config`);
    }
    else {
        _species = [...DEFAULT_SPECIES];
        console.log(`[Monster] Using ${_species.length} default species`);
    }
    if (config?.evolvedSpecies && config.evolvedSpecies.length > 0) {
        _evolvedSpecies = [...config.evolvedSpecies];
        console.log(`[Monster] Loaded ${_evolvedSpecies.length} evolved species from config`);
    }
    else {
        _evolvedSpecies = [...DEFAULT_EVOLVED];
        console.log(`[Monster] Using ${_evolvedSpecies.length} default evolved species`);
    }
}
// Initialize with defaults
loadSpeciesData();
// ── Accessors ────────────────────────────────────────────────────
function getAllSpecies() { return _species; }
function getAllEvolvedSpecies() { return _evolvedSpecies; }
function getAllMoves() { return _moves; }
function getSpeciesBySprite(sprite) {
    return _species.find(s => s.sprite === sprite) || _evolvedSpecies.find(s => s.sprite === sprite);
}
function getSpeciesByName(name) {
    const lower = name.toLowerCase();
    return _species.find(s => s.name.toLowerCase() === lower) ||
        _evolvedSpecies.find(s => s.name.toLowerCase() === lower);
}
function getRandomSpecies() {
    return _species[Math.floor(Math.random() * _species.length)];
}
function getMove(name) {
    return _moves[name];
}
// ── Nature Modifiers ─────────────────────────────────────────────
exports.NATURE_MODIFIERS = {
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
const ALL_NATURES = Object.keys(exports.NATURE_MODIFIERS);
function getRandomNature() {
    return ALL_NATURES[Math.floor(Math.random() * ALL_NATURES.length)];
}
// ── Stat Calculation ─────────────────────────────────────────────
function calculateStat(baseStat, level, nature, statKey) {
    const mod = exports.NATURE_MODIFIERS[nature];
    let multiplier = 1.0;
    if (mod.increased === statKey)
        multiplier = 1.1;
    else if (mod.decreased === statKey)
        multiplier = 0.9;
    return Math.floor((baseStat + level * 2) * multiplier);
}
function calculateHp(baseHp, level) {
    return Math.floor(baseHp + level * 3 + 10);
}
function calculateXpToNext(level) {
    return level * level * 50;
}
function getMovesForLevel(species, level) {
    const learned = [];
    const levels = Object.keys(species.moves).map(Number).sort((a, b) => a - b);
    for (const lvl of levels) {
        if (lvl <= level) {
            learned.push(species.moves[lvl]);
        }
    }
    return learned.slice(-4);
}
// ── Spell Mapping for Companion Auto-Cast ────────────────────────
exports.TYPE_SPELL_PATTERNS = {
    Fire: ['mor', 'srad', 'athar'],
    Ice: ['sal', 'creag'],
    Wind: ['athar', 'fas'],
    Earth: ['creag', 'mor'],
    Dark: ['cradh', 'pramh', 'dall'],
    Light: ['ioc', 'ao', 'beag'],
    Arcane: ['mor', 'ard', 'sal'],
    Normal: ['beag', 'mor'],
};
//# sourceMappingURL=species-data.js.map