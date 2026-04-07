import NpcInjector from './npc-injector';
import ChatInjector from './chat-injector';
import DialogHandler from './dialog-handler';
import ExitMarker from './exit-marker';
import CustomDoors from './custom-doors';
import CommandRegistry from '../commands/command-registry';
import { registerBuiltinCommands } from '../commands/index';
import type ProxyServer from '../proxy-server';
import type ProxySession from '../proxy-session';
import type PlayerRegistry from '../player-registry';
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

    constructor(proxy: ProxyServer, registry: PlayerRegistry) {
        this.proxy = proxy;
        this.registry = registry;
        this.chat = new ChatInjector(proxy);
        this.npcs = new NpcInjector(proxy, registry, this.chat);
        this.dialogs = new DialogHandler(proxy);
        this.exitMarker = new ExitMarker(proxy, registry);
        this.customDoors = new CustomDoors(proxy, this.npcs, this.chat, this.dialogs);
        this.commands = new CommandRegistry();
        // Register built-in commands
        registerBuiltinCommands(this.commands, {
            proxy,
            chat: this.chat,
            players: registry,
            npcs: this.npcs,
        });
        // Register custom door commands and load persisted doors
        this.customDoors.registerCommands(this.commands);
        this.customDoors.loadDoors();
        // Register exit marker commands
        this.exitMarker.registerCommands(this.commands, this.chat);
    }

    /**
     * Handle a virtual entity interact (0x43 click).
     * Called from proxy-server when a blocked 0x43 targets a virtual serial.
     */
    onVirtualInteract(session: ProxySession, entityId: number): void {
        const npc = this.npcs.getNPC(entityId);
        if (!npc) {
            console.log(`[Augment] Virtual interact on unknown entity 0x${entityId.toString(16)}`);
            return;
        }
        console.log(`[Augment] ${session.characterName} clicked virtual NPC "${npc.name}" (0x${entityId.toString(16)})`);
        if (npc.onInteract) {
            npc.onInteract(session, { type: 'click', entityId });
            this.proxy.emit('npc:click', session, npc);
            return;
        }
        this.dialogs.onNpcClick(session, npc);
        this.proxy.emit('npc:click', session, npc);
    }

    /**
     * Handle a virtual entity menu choice (0x39).
     */
    onVirtualMenuChoice(session: ProxySession, entityId: number, pursuitId: number, slot: number): void {
        const npc = this.npcs.getNPC(entityId);
        if (!npc)
            return;
        console.log(`[Augment] ${session.characterName} menu choice slot=${slot} on "${npc.name}"`);
        if (npc.onInteract) {
            npc.onInteract(session, { type: 'menuChoice', entityId, slot, pursuitId });
            return;
        }
        this.dialogs.onMenuChoice(session, npc, slot);
    }

    /**
     * Handle a virtual entity dialog choice (0x3A next/prev).
     */
    onVirtualDialogChoice(session: ProxySession, entityId: number, pursuitId: number, stepId: number): void {
        const npc = this.npcs.getNPC(entityId);
        if (!npc)
            return;
        console.log(`[Augment] ${session.characterName} dialog choice step=${stepId} on "${npc.name}"`);
        if (npc.onInteract) {
            npc.onInteract(session, { type: 'dialogChoice', entityId, stepId, pursuitId });
            return;
        }
        this.dialogs.onDialogChoice(session, npc, stepId);
    }

    /**
     * Handle a virtual entity text input (0x3A with ArgsType=2).
     */
    onVirtualTextInput(session: ProxySession, entityId: number, pursuitId: number, text: string): void {
        const npc = this.npcs.getNPC(entityId);
        if (!npc)
            return;
        console.log(`[Augment] ${session.characterName} text input "${text}" on "${npc.name}"`);
        if (npc.onInteract) {
            npc.onInteract(session, { type: 'textInput', entityId, text, pursuitId });
            return;
        }
    }

    /**
     * Handle a slash command from a player (0x0E chat starting with '/').
     */
    async onPlayerCommand(session: ProxySession, message: string): Promise<void> {
        const parsed = this.commands.parse(message);
        if (!parsed)
            return;
        const found = await this.commands.execute(session, parsed.name, parsed.args, parsed.raw);
        if (!found) {
            this.chat.systemMessage(session, `Unknown command: /${parsed.name}. Type /help for available commands.`);
        }
    }

    /**
     * Clean up session state on disconnect.
     */
    onSessionEnd(sessionId: string): void {
        this.dialogs.clearSession(sessionId);
        this.npcs.clearSession(sessionId);
        this.exitMarker.clearSession(sessionId);
    }

    /**
     * Creates a middleware for the packet inspector.
     * Note: Virtual entity interception for 0x43/0x39/0x3A is now handled
     * directly in proxy-server.ts passthrough (decrypt-copy approach).
     * This middleware handles remaining augmentation needs.
     */
    createMiddleware(): PacketMiddleware {
        return (_packet, _direction, _session) => {
            // NPC injection on map change is handled by the player:mapChange event in index.ts.
            // NPC injection on refresh is handled by the player:refreshComplete event in index.ts.
            return null; // pass through
        };
    }
}
