import type ProxySession from '../proxy-session';
export type CommandHandler = (session: ProxySession, args: string[], raw: string) => void | Promise<void>;
export interface CommandInfo {
    name: string;
    handler: CommandHandler;
    description: string;
    usage?: string;
}
/**
 * Registry for slash commands intercepted from proxy chat.
 * Commands are parsed from client 0x0E (Chat) packets starting with '/'.
 */
export default class CommandRegistry {
    private commands;
    /**
     * Register a slash command.
     */
    register(name: string, handler: CommandHandler, description: string, usage?: string): void;
    /**
     * Unregister a slash command.
     */
    unregister(name: string): void;
    /**
     * Check if a command exists.
     */
    has(name: string): boolean;
    /**
     * Get a command's info.
     */
    get(name: string): CommandInfo | undefined;
    /**
     * Get all registered commands.
     */
    getAll(): CommandInfo[];
    /**
     * Parse a chat message into command name and args.
     * Returns null if the message is not a command (doesn't start with '/').
     */
    parse(message: string): {
        name: string;
        args: string[];
        raw: string;
    } | null;
    /**
     * Execute a command by name. Returns true if the command was found and executed.
     */
    execute(session: ProxySession, name: string, args: string[], raw: string): Promise<boolean>;
    /**
     * Generate help text listing all commands.
     */
    generateHelp(): string[];
}
