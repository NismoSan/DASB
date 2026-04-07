import ProxyServer, { ProxyServerConfig } from './proxy-server';
import { PacketInspector } from './packet-inspector';
import PlayerRegistry from './player-registry';
import AugmentationEngine from './augmentation/index';
import AutomationManager from './automation/index';
import TriggerEngine from './triggers/trigger-engine';
import type CommandRegistry from './commands/command-registry';
export interface ProxySystem {
    server: ProxyServer;
    inspector: PacketInspector;
    registry: PlayerRegistry;
    augmentation: AugmentationEngine;
    automation: AutomationManager;
    commands: CommandRegistry;
    triggers: TriggerEngine;
}
/**
 * Creates and wires together the full proxy system.
 */
export declare function createProxySystem(config?: Partial<ProxyServerConfig>): ProxySystem;
export { ProxyServer, PacketInspector, PlayerRegistry, AugmentationEngine };
export { AutomationManager };
export { TriggerEngine };
export { CommandRegistry } from './commands/index';
export type { ProxyServerConfig } from './proxy-server';
export type { PacketDirection, PacketMiddleware, InspectionResult } from './packet-inspector';
export type { ProxiedPlayer, EntityInfo, EntityType, GroundItem } from './player-registry';
export type { CommandHandler, CommandInfo } from './commands/command-registry';
export type { Trigger, TriggerContext, TriggerCondition, TriggerAction } from './triggers/trigger-engine';
