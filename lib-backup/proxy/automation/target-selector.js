"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_TARGET_CONFIG = void 0;
/** Default excluded images from Slowpoke. */
const DEFAULT_EXCLUDED_IMAGES = new Set([
    649, 412, 641, 543, 456, 414, 160, 79, 510, 53, 492, 195, 392, 405, 676, 691,
    699, 700, 701,
]);
exports.DEFAULT_TARGET_CONFIG = {
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
/** Track monsters that appear to have infinite magic resistance. */
const infiniteMrSet = new Set();
class TargetSelector {
    config;
    lastTargetSerial = 0;
    lastTargetTime = 0;
    constructor(config) {
        this.config = { ...exports.DEFAULT_TARGET_CONFIG, ...config };
    }
    /**
     * Select the best target from visible entities.
     * @param entities All entities visible to the session
     * @param playerX Player's current X position
     * @param playerY Player's current Y position
     * @param buffs BuffTracker for checking debuff state
     * @param groupPositions Array of {x, y} for group member positions (for adjacency)
     */
    selectTarget(entities, playerX, playerY, buffs, groupPositions) {
        const candidates = this.filterCandidates(entities, playerX, playerY);
        if (candidates.length === 0)
            return null;
        // Score each candidate
        const scored = candidates.map(entity => {
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
    selectCluster(entities, playerX, playerY, buffs) {
        const primary = this.selectTarget(entities, playerX, playerY, buffs);
        if (!primary)
            return [];
        if (!this.config.clusterMode)
            return [primary];
        const radius = this.config.clusterRadius;
        const candidates = this.filterCandidates(entities, playerX, playerY);
        return candidates.filter(e => Math.abs(e.x - primary.x) + Math.abs(e.y - primary.y) <= radius);
    }
    /** Mark a monster as having infinite MR (from failed spell attempts). */
    markInfiniteMr(serial) {
        infiniteMrSet.add(serial);
    }
    /** Check if monster has infinite MR. */
    hasInfiniteMr(serial) {
        return infiniteMrSet.has(serial);
    }
    /** Get per-monster config if one exists. */
    getMonsterConfig(name) {
        return this.config.monsterConfigs.get(name.toLowerCase());
    }
    // ─── Internal ────────────────────────────────────────────
    filterCandidates(entities, playerX, playerY) {
        return entities.filter(entity => {
            // Must be a monster
            if (entity.entityType !== 'monster')
                return false;
            // Exclude virtual entities
            if (entity.isVirtual)
                return false;
            // Image exclusion
            if (this.config.imageExcludeList.has(entity.image))
                return false;
            // Name ignore
            if (entity.name && this.config.nameIgnoreList.has(entity.name.toLowerCase()))
                return false;
            // Per-monster ignore
            const mc = entity.name ? this.config.monsterConfigs.get(entity.name.toLowerCase()) : undefined;
            if (mc?.ignore)
                return false;
            // Range check
            const dist = Math.abs(entity.x - playerX) + Math.abs(entity.y - playerY);
            if (dist > this.config.maxRange)
                return false;
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
    selectNearest(scored) {
        // Pass 1: Adjacent monsters
        const adjacent = scored.filter(s => s.isAdjacent);
        if (adjacent.length > 0) {
            // Prefer cupping among adjacent
            const adjCupping = adjacent.filter(s => s.isCupping);
            if (adjCupping.length > 0)
                return adjCupping[0].entity;
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
            if (last)
                return last.entity;
        }
        // Pass 4: Nearest by distance
        scored.sort((a, b) => a.distance - b.distance);
        return scored[0]?.entity ?? null;
    }
    selectByHp(scored, order) {
        scored.sort((a, b) => {
            // Cupping bonus: already damaged entities get priority
            if (a.isCupping !== b.isCupping)
                return a.isCupping ? -1 : 1;
            // HP sort
            const hpDiff = order === 'asc'
                ? a.entity.hpPercent - b.entity.hpPercent
                : b.entity.hpPercent - a.entity.hpPercent;
            if (hpDiff !== 0)
                return hpDiff;
            // Tiebreak by distance
            return a.distance - b.distance;
        });
        return scored[0]?.entity ?? null;
    }
    selectFarthest(scored) {
        scored.sort((a, b) => b.distance - a.distance);
        return scored[0]?.entity ?? null;
    }
}
exports.default = TargetSelector;
//# sourceMappingURL=target-selector.js.map