"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SPELL_BAR_ICONS = void 0;
/**
 * Known spell bar icon IDs (from Slowpoke).
 * These are the effect icons displayed in the client's spell bar.
 */
exports.SPELL_BAR_ICONS = {
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
};
/**
 * Debuff effect durations in seconds (from Slowpoke).
 */
const DEBUFF_DURATIONS = {
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
const ANIMATION_TO_EFFECT = {
    // Cradh tiers
    259: 'beag cradh',
    258: 'cradh',
    243: 'mor cradh',
    257: 'ard cradh',
    // Fas
    273: 'fas',
    // Stuns / CC
    19: 'pramh', // pramh animation
    115: 'suain', // suain animation
    42: 'dall', // dall animation
    38: 'mesmerize', // mesmerize animation
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
class BuffTracker {
    /** Active spell bar icon IDs on self. Updated from 0x3A packets. */
    selfBuffIcons = new Set();
    /** Per-entity debuff tracking: serial -> (effectName -> DebuffInfo) */
    entityDebuffs = new Map();
    /** Cradh tier hierarchy for comparison (higher index = stronger). */
    static CRADH_HIERARCHY = [
        'beag cradh', 'cradh', 'mor cradh', 'ard cradh',
        'dark seal', 'darker seal', 'demise',
    ];
    // ─── Self Buff (SpellBar) ────────────────────────────────
    /**
     * Called when proxy intercepts 0x3A SpellBar packet from server.
     * Replaces entire self-buff icon set.
     * Format: [count:u16] then [iconId:u16] per icon.
     */
    onSpellBar(iconIds) {
        this.selfBuffIcons.clear();
        for (const id of iconIds) {
            this.selfBuffIcons.add(id);
        }
    }
    /** Check if a specific spell bar icon is active on self. */
    hasSpellBarEffect(iconId) {
        return this.selfBuffIcons.has(iconId);
    }
    /** Check if any cradh curse is active on self (icons 5, 82, 83, 84). */
    hasSelfCradh() {
        return this.selfBuffIcons.has(exports.SPELL_BAR_ICONS.BEAG_CRADH) ||
            this.selfBuffIcons.has(exports.SPELL_BAR_ICONS.CRADH) ||
            this.selfBuffIcons.has(exports.SPELL_BAR_ICONS.MOR_CRADH) ||
            this.selfBuffIcons.has(exports.SPELL_BAR_ICONS.ARD_CRADH);
    }
    /** Check if aite buff is active on self. */
    hasSelfAite() {
        return this.selfBuffIcons.has(exports.SPELL_BAR_ICONS.AITE);
    }
    /** Check if fas buff is active on self. */
    hasSelfFas() {
        return this.selfBuffIcons.has(exports.SPELL_BAR_ICONS.FAS);
    }
    /** Check if dion is active on self. */
    hasSelfDion() {
        return this.selfBuffIcons.has(exports.SPELL_BAR_ICONS.DION);
    }
    /** Check if counter attack is active on self. */
    hasSelfCounterAttack() {
        return this.selfBuffIcons.has(exports.SPELL_BAR_ICONS.COUNTER_ATTACK);
    }
    /** Check if in any druid form. */
    hasSelfDruidForm() {
        return this.selfBuffIcons.has(exports.SPELL_BAR_ICONS.DRUID_FORM_1) ||
            this.selfBuffIcons.has(exports.SPELL_BAR_ICONS.DRUID_FORM_2) ||
            this.selfBuffIcons.has(exports.SPELL_BAR_ICONS.DRUID_FORM_3);
    }
    /** Check if hidden. */
    hasSelfHide() {
        return this.selfBuffIcons.has(exports.SPELL_BAR_ICONS.HIDE);
    }
    /** Check if poisoned. */
    hasSelfPoison() {
        return this.selfBuffIcons.has(exports.SPELL_BAR_ICONS.POISON_1) ||
            this.selfBuffIcons.has(exports.SPELL_BAR_ICONS.POISON_2) ||
            this.selfBuffIcons.has(exports.SPELL_BAR_ICONS.POISON_3);
    }
    // ─── Enemy Debuff (Spell Animation) ─────────────────────
    /**
     * Called when proxy intercepts 0x29 SpellAnimation from server.
     * Records the debuff on the target entity with a timestamp.
     */
    onSpellAnimation(casterSerial, targetSerial, animationId) {
        const effect = ANIMATION_TO_EFFECT[animationId];
        if (!effect)
            return; // not a tracked debuff animation
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
    isActive(serial, effect) {
        const debuffs = this.entityDebuffs.get(serial);
        if (!debuffs)
            return false;
        const info = debuffs.get(effect);
        if (!info)
            return false;
        if (Date.now() - info.appliedAt > info.durationMs) {
            debuffs.delete(effect);
            return false;
        }
        return true;
    }
    /** Check if target has any cradh tier applied. */
    hasCradh(serial) {
        return BuffTracker.CRADH_HIERARCHY.some(tier => this.isActive(serial, tier));
    }
    /** Get the specific cradh tier on a target, or null. */
    getCradhTier(serial) {
        // Check from strongest to weakest
        for (let i = BuffTracker.CRADH_HIERARCHY.length - 1; i >= 0; i--) {
            if (this.isActive(serial, BuffTracker.CRADH_HIERARCHY[i])) {
                return BuffTracker.CRADH_HIERARCHY[i];
            }
        }
        return null;
    }
    hasFas(serial) {
        return this.isActive(serial, 'fas');
    }
    hasPramh(serial) {
        return this.isActive(serial, 'pramh');
    }
    hasSuain(serial) {
        return this.isActive(serial, 'suain');
    }
    hasDall(serial) {
        return this.isActive(serial, 'dall');
    }
    hasMes(serial) {
        return this.isActive(serial, 'mesmerize');
    }
    hasCursedTune(serial) {
        return this.isActive(serial, 'cursed tune');
    }
    hasDion(serial) {
        return this.isActive(serial, 'dion');
    }
    /** Check if target is stunned (pramh, suain, or mesmerize). */
    isStunned(serial) {
        return this.hasPramh(serial) || this.hasSuain(serial) || this.hasMes(serial);
    }
    /** Get all active debuffs on a target. */
    getDebuffs(serial) {
        const debuffs = this.entityDebuffs.get(serial);
        if (!debuffs)
            return [];
        const active = [];
        const now = Date.now();
        for (const [key, info] of debuffs) {
            if (now - info.appliedAt <= info.durationMs) {
                active.push(info);
            }
            else {
                debuffs.delete(key);
            }
        }
        return active;
    }
    // ─── Maintenance ─────────────────────────────────────────
    /** Remove all debuff tracking for a specific entity (on death/despawn). */
    removeEntity(serial) {
        this.entityDebuffs.delete(serial);
    }
    /** Purge expired debuffs from all entities. Call periodically. */
    cleanup() {
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
    clear() {
        this.selfBuffIcons.clear();
        this.entityDebuffs.clear();
    }
}
exports.default = BuffTracker;
//# sourceMappingURL=buff-tracker.js.map