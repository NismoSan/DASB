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
    /** Level -> move name learned at that level */
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
    /** Target animation ID for ShowEffect (0x29) first u16 */
    animationId?: number;
    /** Caster/source animation ID for ShowEffect (0x29) second u16 */
    sourceAnimationId?: number;
    /** Body animation byte for AnimateEntity (0x1A); if omitted, derived from category */
    bodyAnimationId?: number;
    /** If true, status move visual plays on the attacker (self buffs). Default false. */
    targetsSelf?: boolean;
    /** Legacy panel field; used as fallback body animation when bodyAnimationId is unset */
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
    companionOut?: boolean;
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

export type BattleType = 'pvp' | 'wild' | 'trainer';
export type BattleSide = 'a' | 'b';
export type BattleEndReason = 'knockout' | 'forfeit' | 'disconnect' | 'mapChange' | 'teleport' | 'cleanup';

export interface BattleMetadata {
    mode?: 'casual' | 'ranked' | 'trainer';
    persistA?: boolean;
    persistB?: boolean;
    rankedSeasonId?: number;
    rankedSeasonKey?: string;
    challengerName?: string;
    targetName?: string;
    trainerKind?: 'gym' | 'champion';
    gymId?: string;
    trainerId?: string;
    trainerName?: string;
    playerName?: string;
    rewardMonsterXp?: number;
}

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

export type BattleAction =
    | { kind: 'move'; moveIndex: number; moveName: string }
    | { kind: 'forfeit' };

export interface BattlePromptState {
    sessionId: string;
    battleId: string;
    side: BattleSide;
    entityId: number;
    roundToken: number;
    promptType: 'move';
    menuActions: BattleAction[];
    menuPursuitIds: number[];
    submitted: boolean;
    chosenAction: BattleAction | null;
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
    turn: BattleSide;
    /** Which side has submitted their move this turn */
    moveA: string | null;
    moveB: string | null;
    /** Is the battle still active */
    active: boolean;
    roundToken: number;
    ending: boolean;
    ended: boolean;
    endReason?: BattleEndReason;
    winner?: BattleSide;
    metadata?: BattleMetadata;
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
    /** True between 0x15 map change and 0x04 / delayed respawn */
    transitioning?: boolean;
    /** Fallback respawn if no MapLocation follows; cleared when 0x04 runs */
    mapChangeRespawnTimer?: ReturnType<typeof setTimeout> | null;
}

export interface SpeciesDataConfig {
    species?: MonsterSpecies[];
    evolvedSpecies?: MonsterSpecies[];
    moves?: Record<string, Move>;
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
        direction: number;
        sprite: number;
        name: string;
        ambientSpeech?: {
            intervalSeconds: number;
            messages: string[];
        };
    };
    /** Runtime species/move data managed from the panel. */
    speciesData?: SpeciesDataConfig;
    league?: MonsterLeagueConfig;
}

export interface RewardConfig {
    kind: 'legend' | 'nametag_style';
    rewardKey: string;
    icon?: number;
    color?: number;
    key?: string;
    text?: string;
    style?: number;
}

export interface RankingRewardTier {
    maxRank: number;
    rewards: RewardConfig[];
}

export interface LeagueNpcConfig {
    mapNumber: number;
    x: number;
    y: number;
    direction?: number;
    sprite?: number;
    name?: string;
}

export interface TrainerMonsterTemplate {
    speciesName: string;
    nickname?: string;
    level: number;
    nature?: Nature;
    moves?: (string | null)[];
}

export interface GymTrainerConfig {
    id: string;
    name: string;
    badgeReward?: RewardConfig;
    mapNumber: number;
    spawnX: number;
    spawnY: number;
    trainerNpc: LeagueNpcConfig;
    monster: TrainerMonsterTemplate;
    rewardMonsterXp?: number;
}

export interface ChampionTrainerConfig {
    id: string;
    name: string;
    mapNumber: number;
    spawnX: number;
    spawnY: number;
    trainerNpc: LeagueNpcConfig;
    monster: TrainerMonsterTemplate;
    rewardMonsterXp?: number;
    clearReward?: RewardConfig;
}

export interface LeagueContentConfig {
    hubMapNumber: number;
    hubSpawnX: number;
    hubSpawnY: number;
    hallMapNumber: number;
    hallSpawnX: number;
    hallSpawnY: number;
    hubNpcs: {
        gymGuide?: LeagueNpcConfig;
        leagueClerk?: LeagueNpcConfig;
        healer?: LeagueNpcConfig;
        exitKeeper?: LeagueNpcConfig;
    };
    hallNpcs?: {
        standingsKeeper?: LeagueNpcConfig;
        registrar?: LeagueNpcConfig;
        exitKeeper?: LeagueNpcConfig;
    };
    gyms: GymTrainerConfig[];
    champion: ChampionTrainerConfig;
    rankRewards?: RankingRewardTier[];
}

export interface MonsterLeagueConfig {
    enabled?: boolean;
    seasonDurationDays?: number;
    dailyResetHour?: number;
    timezone?: string;
    leaderboardSize?: number;
    entryNpc?: LeagueNpcConfig;
    contentFile?: string;
    rankRewards?: RankingRewardTier[];
    championLegendReward?: RewardConfig;
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
