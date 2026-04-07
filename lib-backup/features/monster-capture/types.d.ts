export type MonsterType = 'Normal' | 'Fire' | 'Ice' | 'Wind' | 'Earth' | 'Dark' | 'Light' | 'Arcane';
export type MoveCategory = 'physical' | 'special' | 'status';
export type Nature = 'Brave' | 'Bold' | 'Timid' | 'Modest' | 'Calm' | 'Adamant' | 'Jolly' | 'Hasty' | 'Quiet';
export interface MonsterSpecies {
    sprite: number;
    name: string;
    type: MonsterType;
    baseHp: number;
    baseAtk: number;
    baseDef: number;
    baseSpd: number;
    baseSpAtk: number;
    baseSpDef: number;
    /** Level → move name learned at that level */
    moves: Record<number, string>;
    evolution?: {
        level: number;
        sprite: number;
        name: string;
    };
}
export interface Move {
    name: string;
    type: MonsterType;
    power: number;
    accuracy: number;
    category: MoveCategory;
    /** Priority bracket (higher goes first, default 0) */
    priority?: number;
    /** For status moves: % of maxHp healed */
    heals?: number;
    /** Animation ID for ShowEffect (0x29) */
    animationId?: number;
    /** Sound byte for AnimateEntity */
    soundId?: number;
}
export interface CapturedMonster {
    id: number;
    ownerName: string;
    speciesName: string;
    sprite: number;
    nickname: string;
    level: number;
    xp: number;
    xpToNext: number;
    hp: number;
    maxHp: number;
    atk: number;
    def: number;
    spd: number;
    spAtk: number;
    spDef: number;
    nature: Nature;
    moves: (string | null)[];
    wins: number;
    losses: number;
    isActive: boolean;
    capturedAt: Date;
}
export interface WildEncounter {
    serial: number;
    species: MonsterSpecies;
    level: number;
    hp: number;
    maxHp: number;
    atk: number;
    def: number;
    spd: number;
    spAtk: number;
    spDef: number;
    moves: string[];
    x: number;
    y: number;
    spawnedAt: number;
    despawnTimer: ReturnType<typeof setTimeout>;
}
export type BattleType = 'pvp' | 'wild';
export interface BattleMon {
    monster: CapturedMonster;
    currentHp: number;
    serial: number;
    x: number;
    y: number;
}
export interface WildBattleMon {
    encounter: WildEncounter;
    currentHp: number;
}
export interface BattleState {
    id: string;
    type: BattleType;
    /** Trainer A session ID */
    trainerA: string;
    monA: BattleMon;
    /** Trainer B session ID (PvP) or null (wild) */
    trainerB: string | null;
    monB: BattleMon | null;
    wildMon: WildBattleMon | null;
    turn: 'a' | 'b';
    /** Which side has submitted their move this turn */
    moveA: string | null;
    moveB: string | null;
    /** Is the battle still active */
    active: boolean;
}
export interface BattleChallenge {
    challengerSessionId: string;
    challengerName: string;
    targetSessionId: string;
    targetName: string;
    timestamp: number;
}
export interface CompanionState {
    serial: number;
    monster: CapturedMonster;
    mapNumber: number;
    x: number;
    y: number;
    enabled: boolean;
    lastAttackTime: number;
}
export interface MonsterCaptureConfig {
    /** Map number where wild encounters happen */
    encounterMapNumber: number;
    /** Encounter rate per step on grass (0-1) */
    encounterRate: number;
    /** Grass tile coordinate ranges on encounter map (if empty, all tiles are grass) */
    grassRegions: {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
    }[];
    /** Wild encounter despawn time in ms */
    wildDespawnMs: number;
    /** Max monsters per player */
    maxMonsters: number;
    /** Companion auto-cast cooldown in ms */
    companionCastCooldownMs: number;
    /** Monster Keeper NPC placement */
    keeperNpc: {
        mapNumber: number;
        x: number;
        y: number;
        sprite: number;
        name: string;
    };
}
export interface NatureModifier {
    increased: keyof Pick<CapturedMonster, 'atk' | 'def' | 'spd' | 'spAtk' | 'spDef'>;
    decreased: keyof Pick<CapturedMonster, 'atk' | 'def' | 'spd' | 'spAtk' | 'spDef'>;
}
export interface LeaderboardEntry {
    ownerName: string;
    nickname: string;
    speciesName: string;
    level: number;
    wins: number;
    losses: number;
}
