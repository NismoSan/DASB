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
    private triggers = new Map<string, Trigger>();
    private cooldowns = new Map<string, number>(); // triggerId -> last fire time
    private _nextId = 1;

    /**
     * Register a trigger. Returns its ID.
     */
    add(opts: {
        event: string;
        action: TriggerAction;
        condition?: TriggerCondition;
        cooldownMs?: number;
        id?: string;
    }): string {
        const id = opts.id || `trigger-${this._nextId++}`;
        this.triggers.set(id, {
            id,
            event: opts.event,
            action: opts.action,
            condition: opts.condition,
            cooldownMs: opts.cooldownMs,
            enabled: true,
        });
        return id;
    }

    /**
     * Remove a trigger by ID.
     */
    remove(id: string): boolean {
        this.cooldowns.delete(id);
        return this.triggers.delete(id);
    }

    /**
     * Enable or disable a trigger.
     */
    setEnabled(id: string, enabled: boolean): void {
        const trigger = this.triggers.get(id);
        if (trigger)
            trigger.enabled = enabled;
    }

    /**
     * Get all triggers, optionally filtered by event name.
     */
    getAll(event?: string): Trigger[] {
        const all = Array.from(this.triggers.values());
        return event ? all.filter(t => t.event === event) : all;
    }

    /**
     * Fire an event, executing all matching triggers whose conditions pass.
     */
    async fire(event: string, session: ProxySession, data: Record<string, any> = {}): Promise<void> {
        const now = Date.now();
        const ctx: TriggerContext = { session, event, data };
        for (const trigger of this.triggers.values()) {
            if (!trigger.enabled)
                continue;
            if (trigger.event !== event)
                continue;
            // Check cooldown
            if (trigger.cooldownMs) {
                const lastFire = this.cooldowns.get(trigger.id) || 0;
                if (now - lastFire < trigger.cooldownMs)
                    continue;
            }
            // Check condition
            if (trigger.condition && !trigger.condition(ctx))
                continue;
            // Execute action
            try {
                this.cooldowns.set(trigger.id, now);
                await trigger.action(ctx);
            }
            catch (err) {
                console.error(`[Triggers] Error in trigger ${trigger.id} (${event}): ${err}`);
            }
        }
    }

    /**
     * Remove all triggers.
     */
    clear(): void {
        this.triggers.clear();
        this.cooldowns.clear();
    }
}
