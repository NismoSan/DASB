/**
 * Known spell bar icon IDs (from Slowpoke).
 * These are the effect icons displayed in the client's spell bar.
 */
export const SPELL_BAR_ICONS = {
    BEAG_CRADH: 5,
    AITE: 11,
    DION: 53,
    CRADH: 82,
    MOR_CRADH: 83,
    ARD_CRADH: 84,
    FAS: 119,
    DARK_SEAL: 133,
    COUNTER_ATTACK: 150,
    DRUID_FORM_1: 183,
    DRUID_FORM_2: 184,
    DRUID_FORM_3: 185,
    POISON_1: 35,
    POISON_2: 141,
    POISON_3: 1,
    HIDE: 10,
    ICE_BOTTLE: 19,
    PYRAMID: 40,
    GRIME_SCENT: 89,
    STATUS_1: 90,
    STATUS_2: 97,
    STATUS_3: 101,
    ABILITY_RUNE: 147,
    XP_MUSHROOM: 148,
} as const;

/** Info about a tracked debuff on an entity. */
export interface DebuffInfo {
    effect: string;
    appliedAt: number;
    durationMs: number;
    casterSerial: number;
}

/**
 * Debuff effect durations in seconds (from Slowpoke).
 */
const DEBUFF_DURATIONS: Record<string, number> = {
    'ard cradh': 240,
    'mor cradh': 210,
    'cradh': 180,
    'beag cradh': 120,
    'pramh': 30,
    'suain': 20,
    'fas': 300,
    'dion': 30,
    'mesmerize': 30,
    'cursed tune': 60,
    'dall': 30,
};

/**
 * Map spell animation IDs to debuff effect names.
 * Built from Slowpoke's SpellAnimation handler (0x29).
 * Multiple animation IDs can map to the same effect.
 */
const ANIMATION_TO_EFFECT: Record<number, string> = {
    // Cradh tiers
    259: 'beag cradh',
    258: 'cradh',
    243: 'mor cradh',
    257: 'ard cradh',
    // Fas
    273: 'fas',
    // Stuns / CC
    19: 'pramh',       // pramh animation
    115: 'suain',      // suain animation
    42: 'dall',        // dall animation
    38: 'mesmerize',   // mesmerize animation
    // Cursed tune
    114: 'cursed tune',
    // Dion
    244: 'dion',
};

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
    selfBuffIcons: Set<number> = new Set();

    /** Per-entity debuff tracking: serial -> (effectName -> DebuffInfo) */
    private entityDebuffs: Map<number, Map<string, DebuffInfo>> = new Map();

    /** Cradh tier hierarchy for comparison (higher index = stronger). */
    private static CRADH_HIERARCHY: string[] = [
        'beag cradh', 'cradh', 'mor cradh', 'ard cradh',
        'dark seal', 'darker seal', 'demise',
    ];

    // --- Self Buff (SpellBar) ---

    /**
     * Called when proxy intercepts 0x3A SpellBar packet from server.
     * Replaces entire self-buff icon set.
     * Format: [count:u16] then [iconId:u16] per icon.
     */
    onSpellBar(iconIds: number[]): void {
        this.selfBuffIcons.clear();
        for (const id of iconIds) {
            this.selfBuffIcons.add(id);
        }
    }

    /** Check if a specific spell bar icon is active on self. */
    hasSpellBarEffect(iconId: number): boolean {
        return this.selfBuffIcons.has(iconId);
    }

    /** Check if any cradh curse is active on self (icons 5, 82, 83, 84). */
    hasSelfCradh(): boolean {
        return this.selfBuffIcons.has(SPELL_BAR_ICONS.BEAG_CRADH) ||
            this.selfBuffIcons.has(SPELL_BAR_ICONS.CRADH) ||
            this.selfBuffIcons.has(SPELL_BAR_ICONS.MOR_CRADH) ||
            this.selfBuffIcons.has(SPELL_BAR_ICONS.ARD_CRADH);
    }

    /** Check if aite buff is active on self. */
    hasSelfAite(): boolean {
        return this.selfBuffIcons.has(SPELL_BAR_ICONS.AITE);
    }

    /** Check if fas buff is active on self. */
    hasSelfFas(): boolean {
        return this.selfBuffIcons.has(SPELL_BAR_ICONS.FAS);
    }

    /** Check if dion is active on self. */
    hasSelfDion(): boolean {
        return this.selfBuffIcons.has(SPELL_BAR_ICONS.DION);
    }

    /** Check if counter attack is active on self. */
    hasSelfCounterAttack(): boolean {
        return this.selfBuffIcons.has(SPELL_BAR_ICONS.COUNTER_ATTACK);
    }

    /** Check if in any druid form. */
    hasSelfDruidForm(): boolean {
        return this.selfBuffIcons.has(SPELL_BAR_ICONS.DRUID_FORM_1) ||
            this.selfBuffIcons.has(SPELL_BAR_ICONS.DRUID_FORM_2) ||
            this.selfBuffIcons.has(SPELL_BAR_ICONS.DRUID_FORM_3);
    }

    /** Check if hidden. */
    hasSelfHide(): boolean {
        return this.selfBuffIcons.has(SPELL_BAR_ICONS.HIDE);
    }

    /** Check if poisoned. */
    hasSelfPoison(): boolean {
        return this.selfBuffIcons.has(SPELL_BAR_ICONS.POISON_1) ||
            this.selfBuffIcons.has(SPELL_BAR_ICONS.POISON_2) ||
            this.selfBuffIcons.has(SPELL_BAR_ICONS.POISON_3);
    }

    // --- Enemy Debuff (Spell Animation) ---

    /**
     * Called when proxy intercepts 0x29 SpellAnimation from server.
     * Records the debuff on the target entity with a timestamp.
     */
    onSpellAnimation(casterSerial: number, targetSerial: number, animationId: number): void {
        const effect = ANIMATION_TO_EFFECT[animationId];
        if (!effect) return; // not a tracked debuff animation

        const durationS = DEBUFF_DURATIONS[effect] ?? 60;

        let debuffs = this.entityDebuffs.get(targetSerial);
        if (!debuffs) {
            debuffs = new Map();
            this.entityDebuffs.set(targetSerial, debuffs);
        }

        // For cradh, replace any existing cradh tier with the new one
        if (effect.includes('cradh')) {
            for (const tier of BuffTracker.CRADH_HIERARCHY) {
                debuffs.delete(tier);
            }
        }

        debuffs.set(effect, {
            effect,
            appliedAt: Date.now(),
            durationMs: durationS * 1000,
            casterSerial,
        });
    }

    /** Check if an effect is currently active on a target (not expired). */
    isActive(serial: number, effect: string): boolean {
        const debuffs = this.entityDebuffs.get(serial);
        if (!debuffs) return false;
        const info = debuffs.get(effect);
        if (!info) return false;

        if (Date.now() - info.appliedAt > info.durationMs) {
            debuffs.delete(effect);
            return false;
        }
        return true;
    }

    /** Check if target has any cradh tier applied. */
    hasCradh(serial: number): boolean {
        return BuffTracker.CRADH_HIERARCHY.some(tier => this.isActive(serial, tier));
    }

    /** Get the specific cradh tier on a target, or null. */
    getCradhTier(serial: number): string | null {
        // Check from strongest to weakest
        for (let i = BuffTracker.CRADH_HIERARCHY.length - 1; i >= 0; i--) {
            if (this.isActive(serial, BuffTracker.CRADH_HIERARCHY[i])) {
                return BuffTracker.CRADH_HIERARCHY[i];
            }
        }
        return null;
    }

    hasFas(serial: number): boolean {
        return this.isActive(serial, 'fas');
    }

    hasPramh(serial: number): boolean {
        return this.isActive(serial, 'pramh');
    }

    hasSuain(serial: number): boolean {
        return this.isActive(serial, 'suain');
    }

    hasDall(serial: number): boolean {
        return this.isActive(serial, 'dall');
    }

    hasMes(serial: number): boolean {
        return this.isActive(serial, 'mesmerize');
    }

    hasCursedTune(serial: number): boolean {
        return this.isActive(serial, 'cursed tune');
    }

    hasDion(serial: number): boolean {
        return this.isActive(serial, 'dion');
    }

    /** Check if target is stunned (pramh, suain, or mesmerize). */
    isStunned(serial: number): boolean {
        return this.hasPramh(serial) || this.hasSuain(serial) || this.hasMes(serial);
    }

    /** Get all active debuffs on a target. */
    getDebuffs(serial: number): DebuffInfo[] {
        const debuffs = this.entityDebuffs.get(serial);
        if (!debuffs) return [];

        const active: DebuffInfo[] = [];
        const now = Date.now();
        for (const [key, info] of debuffs) {
            if (now - info.appliedAt <= info.durationMs) {
                active.push(info);
            } else {
                debuffs.delete(key);
            }
        }
        return active;
    }

    // --- Maintenance ---

    /** Remove all debuff tracking for a specific entity (on death/despawn). */
    removeEntity(serial: number): void {
        this.entityDebuffs.delete(serial);
    }

    /** Purge expired debuffs from all entities. Call periodically. */
    cleanup(): void {
        const now = Date.now();
        for (const [serial, debuffs] of this.entityDebuffs) {
            for (const [effect, info] of debuffs) {
                if (now - info.appliedAt > info.durationMs) {
                    debuffs.delete(effect);
                }
            }
            if (debuffs.size === 0) {
                this.entityDebuffs.delete(serial);
            }
        }
    }

    /** Clear all tracking (on map change). */
    clear(): void {
        this.selfBuffIcons.clear();
        this.entityDebuffs.clear();
    }
}
