/**
 * Provides randomized timing delays for all automation actions.
 * Prevents detection by making actions look human.
 */
export interface HumanizerConfig {
    walkDelayBase: number;
    walkDelayVariance: number;
    castCooldownMs: number;
    halfCast: boolean;
    newTargetDelay: [number, number];
    switchTargetDelay: [number, number];
    reactDelay: [number, number];
    lootDelay: [number, number];
    idlePauseChance: number;
    idlePauseRange: [number, number];
    fastwalk: boolean;
}
export declare const DEFAULT_HUMANIZER_CONFIG: HumanizerConfig;
export default class Humanizer {
    config: HumanizerConfig;
    constructor(config?: Partial<HumanizerConfig>);
    /** Random integer in [min, max] inclusive. */
    private randRange;
    /** Walk delay with variance. */
    walkDelay(): number;
    /** Cast delay for a specific spell. */
    castDelay(spellName?: string): number;
    /** Delay before targeting a newly spawned entity. */
    newTargetDelay(): number;
    /** Delay when switching to a different target. */
    switchTargetDelay(): number;
    /** Delay before reacting to damage (for healing). */
    reactDelay(): number;
    /** Delay before looting. */
    lootDelay(): number;
    /** Check if we should do an idle pause this cycle. Returns ms to pause, or 0. */
    idlePause(): number;
    /** Minimum time between refresh packets (from Slowpoke). */
    refreshDelay(): number;
    /** Sleep helper. */
    sleep(ms: number): Promise<void>;
}
