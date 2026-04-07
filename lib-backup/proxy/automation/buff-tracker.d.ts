/**
 * Known spell bar icon IDs (from Slowpoke).
 * These are the effect icons displayed in the client's spell bar.
 */
export declare const SPELL_BAR_ICONS: {
    readonly BEAG_CRADH: 5;
    readonly AITE: 11;
    readonly DION: 53;
    readonly CRADH: 82;
    readonly MOR_CRADH: 83;
    readonly ARD_CRADH: 84;
    readonly FAS: 119;
    readonly DARK_SEAL: 133;
    readonly COUNTER_ATTACK: 150;
    readonly DRUID_FORM_1: 183;
    readonly DRUID_FORM_2: 184;
    readonly DRUID_FORM_3: 185;
    readonly POISON_1: 35;
    readonly POISON_2: 141;
    readonly POISON_3: 1;
    readonly HIDE: 10;
    readonly ICE_BOTTLE: 19;
    readonly PYRAMID: 40;
    readonly GRIME_SCENT: 89;
    readonly STATUS_1: 90;
    readonly STATUS_2: 97;
    readonly STATUS_3: 101;
    readonly ABILITY_RUNE: 147;
    readonly XP_MUSHROOM: 148;
};
/** Info about a tracked debuff on an entity. */
export interface DebuffInfo {
    effect: string;
    appliedAt: number;
    durationMs: number;
    casterSerial: number;
}
/**
 * Tracks self-buffs (via spell bar icons) and enemy debuffs (via spell animations).
 *
 * **Self buffs**: The server sends 0x3A SpellBar packets with a set of active
 * effect icon IDs. We store those as a `Set<number>`.
 *
 * **Enemy debuffs**: The server sends 0x29 SpellAnimation packets with
 * casterSerial, targetSerial, animationId. We map the animation to a named
 * debuff and track it with a timestamp for duration-based expiry.
 */
export default class BuffTracker {
    /** Active spell bar icon IDs on self. Updated from 0x3A packets. */
    selfBuffIcons: Set<number>;
    /** Per-entity debuff tracking: serial -> (effectName -> DebuffInfo) */
    private entityDebuffs;
    /** Cradh tier hierarchy for comparison (higher index = stronger). */
    private static CRADH_HIERARCHY;
    /**
     * Called when proxy intercepts 0x3A SpellBar packet from server.
     * Replaces entire self-buff icon set.
     * Format: [count:u16] then [iconId:u16] per icon.
     */
    onSpellBar(iconIds: number[]): void;
    /** Check if a specific spell bar icon is active on self. */
    hasSpellBarEffect(iconId: number): boolean;
    /** Check if any cradh curse is active on self (icons 5, 82, 83, 84). */
    hasSelfCradh(): boolean;
    /** Check if aite buff is active on self. */
    hasSelfAite(): boolean;
    /** Check if fas buff is active on self. */
    hasSelfFas(): boolean;
    /** Check if dion is active on self. */
    hasSelfDion(): boolean;
    /** Check if counter attack is active on self. */
    hasSelfCounterAttack(): boolean;
    /** Check if in any druid form. */
    hasSelfDruidForm(): boolean;
    /** Check if hidden. */
    hasSelfHide(): boolean;
    /** Check if poisoned. */
    hasSelfPoison(): boolean;
    /**
     * Called when proxy intercepts 0x29 SpellAnimation from server.
     * Records the debuff on the target entity with a timestamp.
     */
    onSpellAnimation(casterSerial: number, targetSerial: number, animationId: number): void;
    /** Check if an effect is currently active on a target (not expired). */
    isActive(serial: number, effect: string): boolean;
    /** Check if target has any cradh tier applied. */
    hasCradh(serial: number): boolean;
    /** Get the specific cradh tier on a target, or null. */
    getCradhTier(serial: number): string | null;
    hasFas(serial: number): boolean;
    hasPramh(serial: number): boolean;
    hasSuain(serial: number): boolean;
    hasDall(serial: number): boolean;
    hasMes(serial: number): boolean;
    hasCursedTune(serial: number): boolean;
    hasDion(serial: number): boolean;
    /** Check if target is stunned (pramh, suain, or mesmerize). */
    isStunned(serial: number): boolean;
    /** Get all active debuffs on a target. */
    getDebuffs(serial: number): DebuffInfo[];
    /** Remove all debuff tracking for a specific entity (on death/despawn). */
    removeEntity(serial: number): void;
    /** Purge expired debuffs from all entities. Call periodically. */
    cleanup(): void;
    /** Clear all tracking (on map change). */
    clear(): void;
}
