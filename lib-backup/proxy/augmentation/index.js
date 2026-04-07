"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const npc_injector_1 = __importDefault(require("./npc-injector"));
const chat_injector_1 = __importDefault(require("./chat-injector"));
const dialog_handler_1 = __importDefault(require("./dialog-handler"));
const exit_marker_1 = __importDefault(require("./exit-marker"));
const custom_doors_1 = __importDefault(require("./custom-doors"));
const command_registry_1 = __importDefault(require("../commands/command-registry"));
const index_1 = require("../commands/index");
/**
 * AugmentationEngine coordinates all augmentation features:
 * - NPC injection + visibility management
 * - Chat injection
 * - Virtual entity dialog system
 * - Slash command system
 * - Intercepts client interactions with virtual entities
 */
class AugmentationEngine {
    proxy;
    registry;
    npcs;
    chat;
    dialogs;
    exitMarker;
    customDoors;
    commands;
    constructor(proxy, registry) {
        this.proxy = proxy;
        this.registry = registry;
        this.npcs = new npc_injector_1.default(proxy, registry);
        this.chat = new chat_injector_1.default(proxy);
        this.dialogs = new dialog_handler_1.default(proxy);
        this.exitMarker = new exit_marker_1.default(proxy, registry);
        this.customDoors = new custom_doors_1.default(proxy, this.npcs, this.chat, this.dialogs);
        this.commands = new command_registry_1.default();
        // Register built-in commands
        (0, index_1.registerBuiltinCommands)(this.commands, {
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
    onVirtualInteract(session, entityId) {
        const npc = this.npcs.getNPC(entityId);
        if (!npc) {
            console.log(`[Augment] Virtual interact on unknown entity 0x${entityId.toString(16)}`);
            return;
        }
        console.log(`[Augment] ${session.characterName} clicked virtual NPC "${npc.name}" (0x${entityId.toString(16)})`);
        if (npc.onInteract) {
            npc.onInteract(session, { type: 'click' });
            this.proxy.emit('npc:click', session, npc);
            return;
        }
        this.dialogs.onNpcClick(session, npc);
        this.proxy.emit('npc:click', session, npc);
    }
    /**
     * Handle a virtual entity menu choice (0x39).
     */
    onVirtualMenuChoice(session, entityId, pursuitId, slot) {
        const npc = this.npcs.getNPC(entityId);
        if (!npc)
            return;
        console.log(`[Augment] ${session.characterName} menu choice slot=${slot} on "${npc.name}"`);
        if (npc.onInteract) {
            npc.onInteract(session, { type: 'menuChoice', slot, pursuitId });
            return;
        }
        this.dialogs.onMenuChoice(session, npc, slot);
    }
    /**
     * Handle a virtual entity dialog choice (0x3A next/prev).
     */
    onVirtualDialogChoice(session, entityId, pursuitId, stepId) {
        const npc = this.npcs.getNPC(entityId);
        if (!npc)
            return;
        console.log(`[Augment] ${session.characterName} dialog choice step=${stepId} on "${npc.name}"`);
        if (npc.onInteract) {
            npc.onInteract(session, { type: 'dialogChoice', stepId, pursuitId });
            return;
        }
        this.dialogs.onDialogChoice(session, npc, stepId);
    }
    /**
     * Handle a virtual entity text input (0x3A with ArgsType=2).
     */
    onVirtualTextInput(session, entityId, pursuitId, text) {
        const npc = this.npcs.getNPC(entityId);
        if (!npc)
            return;
        console.log(`[Augment] ${session.characterName} text input "${text}" on "${npc.name}"`);
        if (npc.onInteract) {
            npc.onInteract(session, { type: 'textInput', text, pursuitId });
            return;
        }
    }
    /**
     * Handle a slash command from a player (0x0E chat starting with '/').
     */
    async onPlayerCommand(session, message) {
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
    onSessionEnd(sessionId) {
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
    createMiddleware() {
        return (_packet, _direction, _session) => {
            // NPC injection on map change is handled by the player:mapChange event in index.ts.
            // NPC injection on refresh is handled by the player:refreshComplete event in index.ts.
            return null; // pass through
        };
    }
}
exports.default = AugmentationEngine;
//# sourceMappingURL=index.js.map