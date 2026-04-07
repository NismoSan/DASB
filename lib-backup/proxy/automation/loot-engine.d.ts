import type ProxyServer from '../proxy-server';
import type ProxySession from '../proxy-session';
import type PlayerRegistry from '../player-registry';
export interface LootConfig {
    enabled: boolean;
    maxWalkDistance: number;
    onlyWhenNotMobbed: boolean;
    filterMode: 'allowlist' | 'denylist';
    itemFilter: Set<string>;
    imageFilter: Set<number>;
    mapFilters: Map<number, Set<string>>;
    antiSteal: boolean;
    antiStealRadius: number;
    lootDelay: [number, number];
    walkToLoot: boolean;
}
export declare const DEFAULT_LOOT_CONFIG: LootConfig;
/**
 * Automated loot engine — picks up ground items after kills.
 *
 * Flow:
 * 1. Monitor ground items from entity tracking (0x07 type=0x01)
 * 2. Filter items based on allow/deny list
 * 3. Walk to item if needed
 * 4. Send pickup packet
 * 5. Check inventory capacity
 */
export default class LootEngine {
    private proxy;
    private session;
    private registry;
    private humanizer;
    config: LootConfig;
    private pickupCooldown;
    /** External mob check — set by CombatEngine when wired. */
    isMobbed: (() => boolean) | null;
    constructor(proxy: ProxyServer, session: ProxySession, registry: PlayerRegistry, config?: Partial<LootConfig>);
    /**
     * Try to loot nearby items. Called after a kill or periodically.
     * Returns true if looting was performed.
     */
    tryLoot(): Promise<boolean>;
    private shouldLoot;
    private isOtherPlayerNear;
    private walkToItem;
    /**
     * Send pickup packet (0x07 client-to-server).
     * Format from Slowpoke: [slot:u8] [x:u16] [y:u16] [padding]
     */
    private pickup;
}
