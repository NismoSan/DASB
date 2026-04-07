import CommandRegistry from './command-registry';
import type ChatInjector from '../augmentation/chat-injector';
import type PlayerRegistry from '../player-registry';
import type NpcInjector from '../augmentation/npc-injector';
import type ProxyServer from '../proxy-server';
/**
 * Registers built-in slash commands on the given registry.
 */
export declare function registerBuiltinCommands(registry: CommandRegistry, opts: {
    proxy: ProxyServer;
    chat: ChatInjector;
    players: PlayerRegistry;
    npcs: NpcInjector;
}): void;
export { default as CommandRegistry } from './command-registry';
export type { CommandHandler, CommandInfo } from './command-registry';
