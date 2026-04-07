/**
 * Shadow World Engine — central simulation manager for the AFK Dark Ages world.
 * Owns per-map state and runs a global game tick loop at ~4 Hz (250ms).
 */

import { ShadowMonster, ShadowGroundItem, ShadowCreature, ActiveEffect } from './shadow-entity';

export interface ShadowMapInstance {
    mapId: number;
    name: string;
    width: number;
    height: number;
    monsters: Map<number, ShadowMonster>;
    groundItems: Map<number, ShadowGroundItem>;
    activePlayers: Set<string>;
}

export type WorldEventHandler = {
    onMonsterDeath?: (mapId: number, monster: ShadowMonster) => void;
    onMonsterSpawn?: (mapId: number, monster: ShadowMonster) => void;
    onGroundItemDespawn?: (mapId: number, item: ShadowGroundItem) => void;
    onEffectTick?: (creature: ShadowCreature, effect: ActiveEffect) => void;
    onEffectExpire?: (creature: ShadowCreature, effect: ActiveEffect) => void;
    onMonsterUpdate?: (mapId: number, monster: ShadowMonster) => void;
};

const TICK_INTERVAL_MS = 250;

export class ShadowWorld {
    maps: Map<number, ShadowMapInstance>;
    private _tickTimer: ReturnType<typeof setInterval> | null;
    private _handlers: WorldEventHandler;

    constructor(handlers: WorldEventHandler = {}) {
        this.maps = new Map();
        this._tickTimer = null;
        this._handlers = handlers;
    }

    getOrCreateMapInstance(mapId: number, name: string, width: number, height: number): ShadowMapInstance {
        let instance = this.maps.get(mapId);
        if (!instance) {
            instance = {
                mapId,
                name,
                width,
                height,
                monsters: new Map(),
                groundItems: new Map(),
                activePlayers: new Set(),
            };
            this.maps.set(mapId, instance);
        }
        return instance;
    }

    getMapInstance(mapId: number): ShadowMapInstance | undefined {
        return this.maps.get(mapId);
    }

    addPlayerToMap(mapId: number, sessionId: string): void {
        const instance = this.maps.get(mapId);
        if (instance) {
            instance.activePlayers.add(sessionId);
        }
    }

    removePlayerFromMap(mapId: number, sessionId: string): void {
        const instance = this.maps.get(mapId);
        if (instance) {
            instance.activePlayers.delete(sessionId);
        }
    }

    addMonster(mapId: number, monster: ShadowMonster): void {
        const instance = this.maps.get(mapId);
        if (instance) {
            instance.monsters.set(monster.serial, monster);
        }
    }

    removeMonster(mapId: number, serial: number): void {
        const instance = this.maps.get(mapId);
        if (instance) {
            instance.monsters.delete(serial);
        }
    }

    addGroundItem(mapId: number, item: ShadowGroundItem): void {
        const instance = this.maps.get(mapId);
        if (instance) {
            instance.groundItems.set(item.serial, item);
        }
    }

    removeGroundItem(mapId: number, serial: number): void {
        const instance = this.maps.get(mapId);
        if (instance) {
            instance.groundItems.delete(serial);
        }
    }

    getMonsterBySerial(serial: number): ShadowMonster | undefined {
        for (const instance of this.maps.values()) {
            const monster = instance.monsters.get(serial);
            if (monster) return monster;
        }
        return undefined;
    }

    getGroundItemBySerial(serial: number): ShadowGroundItem | undefined {
        for (const instance of this.maps.values()) {
            const item = instance.groundItems.get(serial);
            if (item) return item;
        }
        return undefined;
    }

    getMonstersAt(mapId: number, x: number, y: number): ShadowMonster[] {
        const instance = this.maps.get(mapId);
        if (!instance) return [];
        const results: ShadowMonster[] = [];
        for (const m of instance.monsters.values()) {
            if (m.alive && m.x === x && m.y === y) results.push(m);
        }
        return results;
    }

    getMonstersInRange(mapId: number, x: number, y: number, range: number): ShadowMonster[] {
        const instance = this.maps.get(mapId);
        if (!instance) return [];
        const results: ShadowMonster[] = [];
        for (const m of instance.monsters.values()) {
            if (m.alive && Math.abs(m.x - x) <= range && Math.abs(m.y - y) <= range) {
                results.push(m);
            }
        }
        return results;
    }

    isOccupiedByMonster(mapId: number, x: number, y: number): boolean {
        const instance = this.maps.get(mapId);
        if (!instance) return false;
        for (const m of instance.monsters.values()) {
            if (m.alive && m.x === x && m.y === y) return true;
        }
        return false;
    }

    start(): void {
        if (this._tickTimer) return;
        this._tickTimer = setInterval(() => this._tick(), TICK_INTERVAL_MS);
        console.log('[ShadowWorld] Game tick started (250ms)');
    }

    stop(): void {
        if (this._tickTimer) {
            clearInterval(this._tickTimer);
            this._tickTimer = null;
        }
    }

    private _tick(): void {
        const now = Date.now();

        for (const instance of this.maps.values()) {
            if (instance.activePlayers.size === 0) continue;

            // Tick monsters
            for (const monster of instance.monsters.values()) {
                if (!monster.alive) continue;
                if (this._handlers.onMonsterUpdate) {
                    this._handlers.onMonsterUpdate(instance.mapId, monster);
                }
            }

            // Tick ground item despawns
            for (const [serial, item] of instance.groundItems) {
                if (now >= item.despawnAt) {
                    instance.groundItems.delete(serial);
                    if (this._handlers.onGroundItemDespawn) {
                        this._handlers.onGroundItemDespawn(instance.mapId, item);
                    }
                }
            }

            // Tick effects on monsters
            for (const monster of instance.monsters.values()) {
                if (!monster.alive) continue;
                this._tickEffects(monster, now);
            }
        }
    }

    private _tickEffects(creature: ShadowCreature, now: number): void {
        const expired: ActiveEffect[] = [];

        for (const effect of creature.effects) {
            if (now >= effect.appliedAt + effect.durationMs) {
                expired.push(effect);
                continue;
            }
            if (effect.tickIntervalMs && effect.lastTickAt !== undefined) {
                if (now - effect.lastTickAt >= effect.tickIntervalMs) {
                    effect.lastTickAt = now;
                    if (this._handlers.onEffectTick) {
                        this._handlers.onEffectTick(creature, effect);
                    }
                }
            }
        }

        for (const effect of expired) {
            creature.effects = creature.effects.filter(e => e !== effect);
            if (this._handlers.onEffectExpire) {
                this._handlers.onEffectExpire(creature, effect);
            }
        }
    }
}
