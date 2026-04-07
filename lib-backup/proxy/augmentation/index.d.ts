import type ProxyServer from '../proxy-server';
import type PlayerRegistry from '../player-registry';
import NpcInjector from './npc-injector';
import ChatInjector from './chat-injector';
import DialogHandler from './dialog-handler';
import ExitMarker from './exit-marker';
import CustomDoors from './custom-doors';
import CommandRegistry from '../commands/command-registry';
import type ProxySession from '../proxy-session';
import type { PacketMiddleware } from '../packet-inspector';
/**
 * AugmentationEngine coordinates all augmentation features:
 * - NPC injection + visibility management
 * - Chat injection
 * - Virtual entity dialog system
 * - Slash command system
 * - Intercepts client interactions with virtual entities
 */
export default class AugmentationEngine {
    proxy: ProxyServer;
    registry: PlayerRegistry;
    npcs: NpcInjector;
    chat: ChatInjector;
    dialogs: DialogHandler;
    exitMarker: ExitMarker;
    customDoors: CustomDoors;
    commands: CommandRegistry;
    constructor(proxy: ProxyServer, registry: PlayerRegistry);
    /**
     * Handle a virtual entity interact (0x43 click).
     * Called from proxy-server when a blocked 0x43 targets a virtual serial.
     */
    onVirtualInteract(session: ProxySession, entityId: number): void;
    /**
     * Handle a virtual entity menu choice (0x39).
     */
    onVirtualMenuChoice(session: ProxySession, entityId: number, pursuitId: number, slot: number): void;
    /**
     * Handle a virtual entity dialog choice (0x3A next/prev).
     */
    onVirtualDialogChoice(session: ProxySession, entityId: number, pursuitId: number, stepId: number): void;
    /**
     * Handle a virtual entity text input (0x3A with ArgsType=2).
     */
    onVirtualTextInput(session: ProxySession, entityId: number, pursuitId: number, text: string): void;
    /**
     * Handle a slash command from a player (0x0E chat starting with '/').
     */
    onPlayerCommand(session: ProxySession, message: string): Promise<void>;
    /**
     * Clean up session state on disconnect.
     */
    onSessionEnd(sessionId: string): void;
    /**
     * Creates a middleware for the packet inspector.
     * Note: Virtual entity interception for 0x43/0x39/0x3A is now handled
     * directly in proxy-server.ts passthrough (decrypt-copy approach).
     * This middleware handles remaining augmentation needs.
     */
    createMiddleware(): PacketMiddleware;
}
