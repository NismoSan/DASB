// @ts-nocheck
import Packet from '../../core/packet';
import Humanizer from './humanizer';

export const DEFAULT_LOOT_CONFIG = {
    enabled: false,
    maxWalkDistance: 5,
    onlyWhenNotMobbed: false,
    filterMode: 'denylist',
    itemFilter: new Set(),
    imageFilter: new Set(),
    mapFilters: new Map(),
    antiSteal: true,
    antiStealRadius: 1,
    lootDelay: [200, 500],
    walkToLoot: true,
};

/**
 * Automated loot engine - picks up ground items after kills.
 *
 * Flow:
 * 1. Monitor ground items from entity tracking (0x07 type=0x01)
 * 2. Filter items based on allow/deny list
 * 3. Walk to item if needed
 * 4. Send pickup packet
 * 5. Check inventory capacity
 */
export default class LootEngine {
    proxy;
    session;
    registry;
    humanizer;
    config;
    pickupCooldown = 0;
    /** External mob check - set by CombatEngine when wired. */
    isMobbed = null;

    constructor(proxy, session, registry, config) {
        this.proxy = proxy;
        this.session = session;
        this.registry = registry;
        this.config = { ...DEFAULT_LOOT_CONFIG, ...config };
        this.humanizer = new Humanizer({ lootDelay: this.config.lootDelay });
    }

    /**
     * Try to loot nearby items. Called after a kill or periodically.
     * Returns true if looting was performed.
     */
    async tryLoot() {
        if (!this.config.enabled) return false;

        // Cooldown check
        if (Date.now() < this.pickupCooldown) return false;

        // Mob check
        if (this.config.onlyWhenNotMobbed && this.isMobbed?.()) return false;

        // Inventory full check (60 slots)
        if (this.session.playerState.inventory.size >= 60) return false;

        const items = this.registry.getGroundItems(this.session.id);
        if (items.length === 0) return false;

        const px = this.session.playerState.x;
        const py = this.session.playerState.y;

        // Find best lootable item
        const candidates = items
            .filter(item => this.shouldLoot(item))
            .map(item => ({
                item,
                distance: Math.abs(item.x - px) + Math.abs(item.y - py),
            }))
            .filter(c => c.distance <= this.config.maxWalkDistance)
            .sort((a, b) => a.distance - b.distance);

        if (candidates.length === 0) return false;

        const target = candidates[0];

        // Anti-steal check
        if (this.config.antiSteal && this.isOtherPlayerNear(target.item)) {
            return false;
        }

        // Walk to item if needed
        if (target.distance > 0) {
            if (!this.config.walkToLoot) return false;
            await this.walkToItem(target.item);
        }

        // Delay before pickup
        await this.humanizer.sleep(this.humanizer.lootDelay());

        // Pickup
        this.pickup(target.item.x, target.item.y);
        this.pickupCooldown = Date.now() + 1000; // 1s cooldown after pickup
        return true;
    }

    // --- Filtering ---

    shouldLoot(item) {
        const name = item.name.toLowerCase();

        // Per-map filter
        const mapFilter = this.config.mapFilters.get(this.session.playerState.mapNumber);
        if (mapFilter && mapFilter.size > 0) {
            return mapFilter.has(name);
        }

        // Global filter
        if (this.config.filterMode === 'allowlist') {
            return this.config.itemFilter.has(name) || this.config.imageFilter.has(item.image);
        } else {
            // Denylist - loot everything except denied
            return !this.config.itemFilter.has(name) && !this.config.imageFilter.has(item.image);
        }
    }

    // --- Anti-Steal ---

    isOtherPlayerNear(item) {
        const entities = this.registry.entities.get(this.session.id);
        if (!entities) return false;

        for (const entity of entities.values()) {
            if (entity.entityType !== 'player') continue;
            if (entity.serial === this.session.playerState.serial) continue;
            const dist = Math.abs(entity.x - item.x) + Math.abs(entity.y - item.y);
            if (dist <= this.config.antiStealRadius) return true;
        }
        return false;
    }

    // --- Movement ---

    async walkToItem(item) {
        const maxSteps = this.config.maxWalkDistance;
        for (let step = 0; step < maxSteps; step++) {
            const px = this.session.playerState.x;
            const py = this.session.playerState.y;
            if (px === item.x && py === item.y) break;

            const dx = item.x - px;
            const dy = item.y - py;
            let dir;
            if (Math.abs(dx) >= Math.abs(dy)) {
                dir = dx > 0 ? 1 : 3;
            } else {
                dir = dy > 0 ? 2 : 0;
            }

            const pkt = new Packet(0x06);
            pkt.writeByte(dir);
            this.proxy.sendToServer(this.session, pkt);
            await this.humanizer.sleep(this.humanizer.walkDelay());

            // Check if item was picked up by someone else
            const items = this.registry.getGroundItems(this.session.id);
            if (!items.find(i => i.serial === item.serial)) break;
        }
    }

    // --- Pickup ---

    /**
     * Send pickup packet (0x07 client-to-server).
     * Format from Slowpoke: [slot:u8] [x:u16] [y:u16] [padding]
     */
    pickup(x, y) {
        const pkt = new Packet(0x07);
        pkt.writeByte(0); // slot (auto)
        pkt.writeUInt16(x);
        pkt.writeUInt16(y);
        this.proxy.sendToServer(this.session, pkt);
    }
}
