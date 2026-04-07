import type { EntityInfo } from '../player-registry';
import type BuffTracker from './buff-tracker';
export type TargetMode = 'nearest' | 'highestHp' | 'lowestHp' | 'farthest';
export interface MonsterTargetConfig {
    name: string;
    fas?: string;
    curse?: string;
    attack?: string;
    pramhFirst?: boolean;
    ignore?: boolean;
}
export interface TargetSelectorConfig {
    mode: TargetMode;
    maxRange: number;
    imageExcludeList: Set<number>;
    nameIgnoreList: Set<string>;
    monsterConfigs: Map<string, MonsterTargetConfig>;
    newTargetDelay: [number, number];
    switchTargetDelay: [number, number];
    leaderName?: string;
    leaderMaxRange: number;
    clusterMode: boolean;
    clusterRadius: number;
}
export declare const DEFAULT_TARGET_CONFIG: TargetSelectorConfig;
export default class TargetSelector {
    config: TargetSelectorConfig;
    lastTargetSerial: number;
    private lastTargetTime;
    constructor(config?: Partial<TargetSelectorConfig>);
    /**
     * Select the best target from visible entities.
     * @param entities All entities visible to the session
     * @param playerX Player's current X position
     * @param playerY Player's current Y position
     * @param buffs BuffTracker for checking debuff state
     * @param groupPositions Array of {x, y} for group member positions (for adjacency)
     */
    selectTarget(entities: EntityInfo[], playerX: number, playerY: number, buffs: BuffTracker, groupPositions?: {
        x: number;
        y: number;
    }[]): EntityInfo | null;
    /**
     * Select targets for AoE/cluster attack.
     * Returns the best single target + all monsters within clusterRadius of it.
     */
    selectCluster(entities: EntityInfo[], playerX: number, playerY: number, buffs: BuffTracker): EntityInfo[];
    /** Mark a monster as having infinite MR (from failed spell attempts). */
    markInfiniteMr(serial: number): void;
    /** Check if monster has infinite MR. */
    hasInfiniteMr(serial: number): boolean;
    /** Get per-monster config if one exists. */
    getMonsterConfig(name: string): MonsterTargetConfig | undefined;
    private filterCandidates;
    /**
     * Slowpoke's multi-pass nearest selection:
     * 1. Adjacent priority (distance <= 1 to player or group)
     * 2. Cupping bonus (already damaged)
     * 3. Last target memory (prefer lastTargetSerial if alive)
     * 4. All remaining sorted by distance
     */
    private selectNearest;
    private selectByHp;
    private selectFarthest;
}
