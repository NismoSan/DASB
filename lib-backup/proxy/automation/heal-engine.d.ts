import type ProxyServer from '../proxy-server';
import type ProxySession from '../proxy-session';
import type SpellCaster from './spell-caster';
import type BuffTracker from './buff-tracker';
export interface HealConfig {
    enabled: boolean;
    hpPotionThreshold: number;
    hpPotionPriority: string[];
    mpPotionThreshold: number;
    mpPotionPriority: string[];
    healSpells: string[];
    hpSpellThreshold: number;
    mpRecoverySpell?: string;
    mpRecoveryThreshold: number;
    selfBuffs: {
        spell: string;
        icon: number;
    }[];
    counterAttack: boolean;
    druidForm: boolean;
    selfHide: boolean;
    aoCursesSelf: boolean;
    aoSuainSelf: boolean;
    aoPuinseinSelf: boolean;
    dionEnabled: boolean;
    dionType: string;
    dionEnemyThreshold: number;
    dionHpThreshold: number;
    dionAoSith: boolean;
    groupHeal: boolean;
    groupHealSpells: string[];
    groupHpThreshold: number;
    groupBuffs: string[];
    reactDelay: [number, number];
    pollIntervalMs: number;
    consumeBuffItems: boolean;
    destroyTonics: boolean;
}
export declare const DEFAULT_HEAL_CONFIG: HealConfig;
/**
 * Automated heal engine — item-first, spell-second, runs as interrupt throughout combat.
 *
 * Priority chain (from Slowpoke's Heal() method):
 * 1. Emergency MP: fas spiorad if MP below threshold
 * 2. HP potions when HP% <= threshold
 * 3. MP potions when MP% <= threshold
 * 4. Heal spells: ard ioc / mor ioc / ioc based on deficit
 * 5. Self-buff maintenance (aite, fas, counter attack, etc.)
 * 6. Ao cures (remove curses, suain, poison from self)
 * 7. Dion emergency
 */
export default class HealEngine {
    private proxy;
    private session;
    private caster;
    private buffs;
    private humanizer;
    config: HealConfig;
    private lastItemUse;
    private pollTimer;
    constructor(proxy: ProxyServer, session: ProxySession, caster: SpellCaster, buffs: BuffTracker, config?: Partial<HealConfig>);
    /** Start passive heal monitoring (runs on an interval). */
    startMonitor(): void;
    /** Stop passive heal monitoring. */
    stopMonitor(): void;
    /**
     * Run a single heal cycle. Returns true if healing was performed
     * (combat engine should restart its loop).
     */
    healCycle(): Promise<boolean>;
    private tryUsePotion;
    private findInventoryItem;
    private isItemOnCooldown;
    private useItemBySlot;
    private maintainSelfBuffs;
    private aoCures;
    private checkDionEmergency;
    private getVisibleMonsterCount;
    destroy(): void;
}
