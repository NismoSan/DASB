"use strict";
/**
 * Provides randomized timing delays for all automation actions.
 * Prevents detection by making actions look human.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_HUMANIZER_CONFIG = void 0;
exports.DEFAULT_HUMANIZER_CONFIG = {
    walkDelayBase: 275,
    walkDelayVariance: 0.2,
    castCooldownMs: 800,
    halfCast: false,
    newTargetDelay: [200, 600],
    switchTargetDelay: [100, 400],
    reactDelay: [50, 250],
    lootDelay: [200, 500],
    idlePauseChance: 0.02,
    idlePauseRange: [2000, 5000],
    fastwalk: false,
};
/** Known cast times per spell from Slowpoke's SpellList (ms). */
const SPELL_CAST_TIMES = {
    'ard ioc': 600,
    'mor ioc': 500,
    'ioc': 400,
    'mor ioc comlha': 1100,
    'ard ioc comlha': 1200,
    'beag ioc': 300,
    'beag cradh': 400,
    'cradh': 500,
    'mor cradh': 600,
    'ard cradh': 700,
    'dion': 500,
    'mor dion': 600,
    'mor dion comlha': 1100,
    'pramh': 500,
    'suain': 400,
    'dall': 400,
    'mesmerize': 500,
    'fas nadur': 400,
    'mor fas nadur': 500,
    'ard fas nadur': 600,
    'beag fas nadur': 300,
    'cursed tune': 600,
    'ao beag cradh': 300,
    'ao cradh': 300,
    'ao suain': 300,
    'ao puinsein': 300,
    'ao dall': 300,
    'beag naomh aite': 400,
    'naomh aite': 500,
    'mor naomh aite': 600,
    'ard naomh aite': 700,
    'armachd': 500,
    'beannaich': 500,
    'fas deireas': 500,
    'creag neart': 500,
    'counter attack': 400,
    'lyliac plant': 600,
    'lyliac vineyard': 700,
};
class Humanizer {
    config;
    constructor(config) {
        this.config = { ...exports.DEFAULT_HUMANIZER_CONFIG, ...config };
    }
    /** Random integer in [min, max] inclusive. */
    randRange(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    /** Walk delay with variance. */
    walkDelay() {
        if (this.config.fastwalk)
            return 100;
        const base = this.config.walkDelayBase;
        const variance = base * this.config.walkDelayVariance;
        return Math.round(base + (Math.random() * 2 - 1) * variance);
    }
    /** Cast delay for a specific spell. */
    castDelay(spellName) {
        const known = spellName ? SPELL_CAST_TIMES[spellName.toLowerCase()] : undefined;
        const base = known ?? this.config.castCooldownMs;
        const actual = this.config.halfCast ? Math.floor(base * 0.6) : base;
        // Add small random variance (±10%)
        return Math.round(actual + (Math.random() * 0.2 - 0.1) * actual);
    }
    /** Delay before targeting a newly spawned entity. */
    newTargetDelay() {
        return this.randRange(this.config.newTargetDelay[0], this.config.newTargetDelay[1]);
    }
    /** Delay when switching to a different target. */
    switchTargetDelay() {
        return this.randRange(this.config.switchTargetDelay[0], this.config.switchTargetDelay[1]);
    }
    /** Delay before reacting to damage (for healing). */
    reactDelay() {
        return this.randRange(this.config.reactDelay[0], this.config.reactDelay[1]);
    }
    /** Delay before looting. */
    lootDelay() {
        return this.randRange(this.config.lootDelay[0], this.config.lootDelay[1]);
    }
    /** Check if we should do an idle pause this cycle. Returns ms to pause, or 0. */
    idlePause() {
        if (Math.random() < this.config.idlePauseChance) {
            return this.randRange(this.config.idlePauseRange[0], this.config.idlePauseRange[1]);
        }
        return 0;
    }
    /** Minimum time between refresh packets (from Slowpoke). */
    refreshDelay() {
        return this.randRange(1200, 2000);
    }
    /** Sleep helper. */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.default = Humanizer;
//# sourceMappingURL=humanizer.js.map