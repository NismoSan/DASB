import type ProxyServer from '../proxy-server';
import type ProxySession from '../proxy-session';
import type PlayerRegistry from '../player-registry';
import type SpellCaster from './spell-caster';
import type BuffTracker from './buff-tracker';
import type { TargetMode, MonsterTargetConfig } from './target-selector';
export type EngagementMode = 'lureSpells' | 'lureSkills' | 'lureLamh' | 'noLure' | 'waitOnMonsters';
export type CurseMode = 'currentOnly' | 'sequential' | 'fasAllThenCurseAll';
export interface GrindConfig {
    targetMode: TargetMode;
    clusterMode: boolean;
    clusterRadius: number;
    leaderName?: string;
    monsterConfigs: Map<string, MonsterTargetConfig>;
    imageExcludeList: Set<number>;
    nameIgnoreList: Set<string>;
    primaryAttack: string;
    secondaryAttack?: string;
    secondaryCooldownMs: number;
    curse?: string;
    fasSpell?: string;
    pramhSpell?: string;
    pramhSpam: boolean;
    attackAfterPramh: boolean;
    pramhOnly: boolean;
    pramhBeforeCurse: boolean;
    curseMode: CurseMode;
    fasamancrystals: boolean;
    assailEnabled: boolean;
    assailBetweenSpells: boolean;
    useAmbush: boolean;
    useCrash: boolean;
    insectAssail: boolean;
    skillCombos: string[];
    engagementMode: EngagementMode;
    attackRange: number;
    minMpPercent: number;
    castCooldownMs: number;
    halfCast: boolean;
    newTargetDelay: [number, number];
    switchTargetDelay: [number, number];
    mobSize: number;
    mobDistance: number;
    noLongerMobbedDelay: number;
    onlyInGroup: boolean;
    minGroupSize: number;
    onlyLargestGroup: boolean;
    onlyWithDebuff?: string;
    walkSpeed: number;
    fastwalk: boolean;
    walkCloseByOnly: boolean;
    haltWalkNonFriends: boolean;
}
export declare const DEFAULT_GRIND_CONFIG: GrindConfig;
export interface CombatStats {
    kills: number;
    startTime: number;
    lastKillTime: number;
}
/**
 * Automated combat engine implementing Slowpoke's spell priority chain.
 *
 * Priority order per cycle:
 * 1. Heal check (delegates to HealEngine if wired)
 * 2. Secondary attack (Cursed Tune) with cooldown
 * 3. Per-monster custom targeting
 * 4. Pramh/stun-lock on best cluster
 * 5. Fas/Cradh curse phase
 * 6. Primary attack
 * 7. Assail/melee between spell cooldowns
 *
 * After EACH phase: heal check + check if target died → next target.
 */
export default class CombatEngine {
    private proxy;
    private session;
    private registry;
    private caster;
    private buffs;
    private targetSelector;
    private humanizer;
    config: GrindConfig;
    stats: CombatStats;
    private running;
    private abortController;
    private currentTarget;
    private lastSecondaryCast;
    private lastAssailTime;
    /** External heal check — set by HealEngine when wired. */
    healCheck: (() => Promise<boolean>) | null;
    constructor(proxy: ProxyServer, session: ProxySession, registry: PlayerRegistry, caster: SpellCaster, buffs: BuffTracker, config?: Partial<GrindConfig>);
    get isRunning(): boolean;
    start(): void;
    stop(): void;
    private combatLoop;
    private executeSpellChain;
    private trySecondaryAttack;
    private tryMonsterConfig;
    private tryPramhPhase;
    private tryCursePhase;
    private curseTarget;
    private getCurseCandidates;
    private tryPrimaryAttack;
    private doAssail;
    private findTarget;
    private isTargetAlive;
    private distanceTo;
    private castOnTarget;
    private faceTarget;
    private walkToTarget;
    private onTargetDied;
    private doHealCheck;
    isMobbed(): boolean;
    getStatus(): string;
}
