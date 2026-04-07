"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Event-driven trigger engine for the proxy.
 * Triggers fire when specific proxy events occur and conditions are met.
 *
 * Supported events:
 *   player:command, player:mapChange, player:position,
 *   player:chat, npc:click, session:game, session:end
 */
class TriggerEngine {
    triggers = new Map();
    cooldowns = new Map(); // triggerId -> last fire time
    _nextId = 1;
    /**
     * Register a trigger. Returns its ID.
     */
    add(opts) {
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
    remove(id) {
        this.cooldowns.delete(id);
        return this.triggers.delete(id);
    }
    /**
     * Enable or disable a trigger.
     */
    setEnabled(id, enabled) {
        const trigger = this.triggers.get(id);
        if (trigger)
            trigger.enabled = enabled;
    }
    /**
     * Get all triggers, optionally filtered by event name.
     */
    getAll(event) {
        const all = Array.from(this.triggers.values());
        return event ? all.filter(t => t.event === event) : all;
    }
    /**
     * Fire an event, executing all matching triggers whose conditions pass.
     */
    async fire(event, session, data = {}) {
        const now = Date.now();
        const ctx = { session, event, data };
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
    clear() {
        this.triggers.clear();
        this.cooldowns.clear();
    }
}
exports.default = TriggerEngine;
//# sourceMappingURL=trigger-engine.js.map