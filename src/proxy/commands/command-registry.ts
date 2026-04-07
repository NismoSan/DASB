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
    private commands = new Map<string, CommandInfo>();

    /**
     * Register a slash command.
     */
    register(name: string, handler: CommandHandler, description: string, usage?: string): void {
        const lower = name.toLowerCase();
        this.commands.set(lower, { name: lower, handler, description, usage });
    }

    /**
     * Unregister a slash command.
     */
    unregister(name: string): void {
        this.commands.delete(name.toLowerCase());
    }

    /**
     * Check if a command exists.
     */
    has(name: string): boolean {
        return this.commands.has(name.toLowerCase());
    }

    /**
     * Get a command's info.
     */
    get(name: string): CommandInfo | undefined {
        return this.commands.get(name.toLowerCase());
    }

    /**
     * Get all registered commands.
     */
    getAll(): CommandInfo[] {
        return Array.from(this.commands.values());
    }

    /**
     * Parse a chat message into command name and args.
     * Returns null if the message is not a command (doesn't start with '/').
     */
    parse(message: string): { name: string; args: string[]; raw: string } | null {
        if (!message.startsWith('/'))
            return null;
        const trimmed = message.slice(1).trim();
        if (!trimmed)
            return null;
        const parts = trimmed.split(/\s+/);
        const name = parts[0].toLowerCase();
        const args = parts.slice(1);
        return { name, args, raw: trimmed };
    }

    /**
     * Execute a command by name. Returns true if the command was found and executed.
     */
    async execute(session: ProxySession, name: string, args: string[], raw: string): Promise<boolean> {
        const cmd = this.commands.get(name.toLowerCase());
        if (!cmd)
            return false;
        try {
            await cmd.handler(session, args, raw);
        }
        catch (err) {
            console.error(`[Commands] Error executing /${name}: ${err}`);
        }
        return true;
    }

    /**
     * Generate help text listing all commands.
     */
    generateHelp(): string[] {
        const lines: string[] = [];
        for (const cmd of this.commands.values()) {
            const usage = cmd.usage ? ` ${cmd.usage}` : '';
            lines.push(`/${cmd.name}${usage} - ${cmd.description}`);
        }
        return lines;
    }
}
