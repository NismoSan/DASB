import ProxyCollision from './proxy-collision';
import MapGraph from '../../features/navigator/map-graph';
import ProxyNavigator from './proxy-navigator';
import SpellCaster from './spell-caster';
import BuffTracker from './buff-tracker';
import CombatEngine from './combat-engine';
import HealEngine from './heal-engine';
import LootEngine from './loot-engine';
import DesyncMonitor from './desync-monitor';
import type ProxyServer from '../proxy-server';
import type ProxySession from '../proxy-session';
import type PlayerRegistry from '../player-registry';
import type ChatInjector from '../augmentation/chat-injector';
import type CommandRegistry from '../commands/command-registry';
export interface SessionAutomation {
    navigator: ProxyNavigator;
    caster: SpellCaster;
    buffs: BuffTracker;
    combat: CombatEngine;
    heal: HealEngine;
    loot: LootEngine;
    desync: DesyncMonitor;
    followCancel: (() => void) | null;
}
/**
 * Manages per-session automation state and registers slash commands.
 *
 * Collision data is built LIVE from intercepted 0x3C MapTransfer packets —
 * the same tile data the real game client and server use. Only SOTP
 * (Solid Tile Property) data is loaded from disk; everything else comes
 * from the actual game protocol in real-time.
 */
export default class AutomationManager {
    private proxy;
    private collision;
    private mapGraph;
    private sessions;
    registry: PlayerRegistry | null;
    constructor(proxy: ProxyServer);
    init(): Promise<void>;
    getCollision(): ProxyCollision;
    getMapGraph(): MapGraph;
    /**
     * Create automation state for a new session.
     */
    createSession(session: ProxySession): SessionAutomation;
    /**
     * Get automation state for a session.
     */
    getSession(sessionId: string): SessionAutomation | undefined;
    /**
     * Clean up automation state for a disconnected session.
     */
    destroySession(sessionId: string): void;
    /**
     * Register automation-related slash commands.
     */
    registerCommands(commands: CommandRegistry, chat: ChatInjector): void;
    private applyGrindConfig;
    private applyHealConfig;
}
