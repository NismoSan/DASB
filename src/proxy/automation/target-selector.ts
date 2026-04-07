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

/** Default excluded images from Slowpoke. */
const DEFAULT_EXCLUDED_IMAGES = new Set([
    649, 412, 641, 543, 456, 414, 160, 79, 510, 53, 492, 195, 392, 405, 676, 691,
    699, 700, 701,
]);

export const DEFAULT_TARGET_CONFIG: TargetSelectorConfig = {
    mode: 'nearest',
    maxRange: 12,
    imageExcludeList: new Set(DEFAULT_EXCLUDED_IMAGES),
    nameIgnoreList: new Set(),
    monsterConfigs: new Map(),
    newTargetDelay: [200, 600],
    switchTargetDelay: [100, 400],
    leaderName: undefined,
    leaderMaxRange: 7,
    clusterMode: false,
    clusterRadius: 3,
};

interface ScoredTarget {
    entity: EntityInfo;
    distance: number;
    isCupping: boolean;
    isAdjacent: boolean;
}

/** Track monsters that appear to have infinite magic resistance. */
const infiniteMrSet = new Set<number>();

export default class TargetSelector {
    config: TargetSelectorConfig;
    lastTargetSerial: number = 0;
    private lastTargetTime: number = 0;

    constructor(config?: Partial<TargetSelectorConfig>) {
        this.config = { ...DEFAULT_TARGET_CONFIG, ...config };
    }

    /**
     * Select the best target from visible entities.
     * @param entities All entities visible to the session
     * @param playerX Player's current X position
     * @param playerY Player's current Y position
     * @param buffs BuffTracker for checking debuff state
     * @param groupPositions Array of {x, y} for group member positions (for adjacency)
     */
    selectTarget(
        entities: EntityInfo[],
        playerX: number,
        playerY: number,
        buffs: BuffTracker,
        groupPositions?: { x: number; y: number }[],
    ): EntityInfo | null {
        const candidates = this.filterCandidates(entities, playerX, playerY);
        if (candidates.length === 0) return null;

        // Score each candidate
        const scored: ScoredTarget[] = candidates.map(entity => {
            const dx = entity.x - playerX;
            const dy = entity.y - playerY;
            const distance = Math.abs(dx) + Math.abs(dy); // Manhattan distance
            const isCupping = entity.hpPercent < 100;
            let isAdjacent = distance <= 1;

            // Also check adjacent to group members
            if (!isAdjacent && groupPositions) {
                for (const gp of groupPositions) {
                    if (Math.abs(entity.x - gp.x) + Math.abs(entity.y - gp.y) <= 1) {
                        isAdjacent = true;
                        break;
                    }
                }
            }

            return { entity, distance, isCupping, isAdjacent };
        });

        // Apply mode-specific sorting
        switch (this.config.mode) {
            case 'nearest':
                return this.selectNearest(scored);
            case 'highestHp':
                return this.selectByHp(scored, 'desc');
            case 'lowestHp':
                return this.selectByHp(scored, 'asc');
            case 'farthest':
                return this.selectFarthest(scored);
            default:
                return this.selectNearest(scored);
        }
    }

    /**
     * Select targets for AoE/cluster attack.
     * Returns the best single target + all monsters within clusterRadius of it.
     */
    selectCluster(
        entities: EntityInfo[],
        playerX: number,
        playerY: number,
        buffs: BuffTracker,
    ): EntityInfo[] {
        const primary = this.selectTarget(entities, playerX, playerY, buffs);
        if (!primary) return [];
        if (!this.config.clusterMode) return [primary];

        const radius = this.config.clusterRadius;
        const candidates = this.filterCandidates(entities, playerX, playerY);
        return candidates.filter(e =>
            Math.abs(e.x - primary.x) + Math.abs(e.y - primary.y) <= radius
        );
    }

    /** Mark a monster as having infinite MR (from failed spell attempts). */
    markInfiniteMr(serial: number): void {
        infiniteMrSet.add(serial);
    }

    /** Check if monster has infinite MR. */
    hasInfiniteMr(serial: number): boolean {
        return infiniteMrSet.has(serial);
    }

    /** Get per-monster config if one exists. */
    getMonsterConfig(name: string): MonsterTargetConfig | undefined {
        return this.config.monsterConfigs.get(name.toLowerCase());
    }

    // --- Internal ---

    private filterCandidates(entities: EntityInfo[], playerX: number, playerY: number): EntityInfo[] {
        return entities.filter(entity => {
            // Must be a monster
            if (entity.entityType !== 'monster') return false;
            // Exclude virtual entities
            if (entity.isVirtual) return false;
            // Image exclusion
            if (this.config.imageExcludeList.has(entity.image)) return false;
            // Name ignore
            if (entity.name && this.config.nameIgnoreList.has(entity.name.toLowerCase())) return false;
            // Per-monster ignore
            const mc = entity.name ? this.config.monsterConfigs.get(entity.name.toLowerCase()) : undefined;
            if (mc?.ignore) return false;
            // Range check
            const dist = Math.abs(entity.x - playerX) + Math.abs(entity.y - playerY);
            if (dist > this.config.maxRange) return false;
            // Leader range check
            // (leader position would need to be passed in; skip for now if no leader)
            return true;
        });
    }

    /**
     * Slowpoke's multi-pass nearest selection:
     * 1. Adjacent priority (distance <= 1 to player or group)
     * 2. Cupping bonus (already damaged)
     * 3. Last target memory (prefer lastTargetSerial if alive)
     * 4. All remaining sorted by distance
     */
    private selectNearest(scored: ScoredTarget[]): EntityInfo | null {
        // Pass 1: Adjacent monsters
        const adjacent = scored.filter(s => s.isAdjacent);
        if (adjacent.length > 0) {
            // Prefer cupping among adjacent
            const adjCupping = adjacent.filter(s => s.isCupping);
            if (adjCupping.length > 0) return adjCupping[0].entity;
            return adjacent[0].entity;
        }

        // Pass 2: Cupping targets
        const cupping = scored.filter(s => s.isCupping);
        if (cupping.length > 0) {
            cupping.sort((a, b) => a.distance - b.distance);
            return cupping[0].entity;
        }

        // Pass 3: Last target memory
        if (this.lastTargetSerial) {
            const last = scored.find(s => s.entity.serial === this.lastTargetSerial);
            if (last) return last.entity;
        }

        // Pass 4: Nearest by distance
        scored.sort((a, b) => a.distance - b.distance);
        return scored[0]?.entity ?? null;
    }

    private selectByHp(scored: ScoredTarget[], order: 'asc' | 'desc'): EntityInfo | null {
        scored.sort((a, b) => {
            // Cupping bonus: already damaged entities get priority
            if (a.isCupping !== b.isCupping) return a.isCupping ? -1 : 1;
            // HP sort
            const hpDiff = order === 'asc'
                ? a.entity.hpPercent - b.entity.hpPercent
                : b.entity.hpPercent - a.entity.hpPercent;
            if (hpDiff !== 0) return hpDiff;
            // Tiebreak by distance
            return a.distance - b.distance;
        });
        return scored[0]?.entity ?? null;
    }

    private selectFarthest(scored: ScoredTarget[]): EntityInfo | null {
        scored.sort((a, b) => b.distance - a.distance);
        return scored[0]?.entity ?? null;
    }
}
