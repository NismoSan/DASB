import type ProxySession from '../proxy-session';
export interface TriggerContext {
    session: ProxySession;
    event: string;
    data: Record<string, any>;
}
export type TriggerCondition = (ctx: TriggerContext) => boolean;
export type TriggerAction = (ctx: TriggerContext) => void | Promise<void>;
export interface Trigger {
    id: string;
    event: string;
    condition?: TriggerCondition;
    action: TriggerAction;
    cooldownMs?: number;
    enabled: boolean;
}
/**
 * Event-driven trigger engine for the proxy.
 * Triggers fire when specific proxy events occur and conditions are met.
 *
 * Supported events:
 *   player:command, player:mapChange, player:position,
 *   player:chat, npc:click, session:game, session:end
 */
export default class TriggerEngine {
    private triggers;
    private cooldowns;
    private _nextId;
    /**
     * Register a trigger. Returns its ID.
     */
    add(opts: {
        event: string;
        action: TriggerAction;
        condition?: TriggerCondition;
        cooldownMs?: number;
        id?: string;
    }): string;
    /**
     * Remove a trigger by ID.
     */
    remove(id: string): boolean;
    /**
     * Enable or disable a trigger.
     */
    setEnabled(id: string, enabled: boolean): void;
    /**
     * Get all triggers, optionally filtered by event name.
     */
    getAll(event?: string): Trigger[];
    /**
     * Fire an event, executing all matching triggers whose conditions pass.
     */
    fire(event: string, session: ProxySession, data?: Record<string, any>): Promise<void>;
    /**
     * Remove all triggers.
     */
    clear(): void;
}
