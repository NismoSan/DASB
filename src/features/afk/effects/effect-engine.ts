/**
 * Buff/Effect Engine — timed buffs and debuffs with stat modifiers and periodic ticks.
 */

import { ShadowCreature, ActiveEffect, ShadowStats } from '../shadow-entity';

export interface EffectDefinition {
    key: string;
    name: string;
    durationMs: number;
    statModifiers?: Partial<ShadowStats> & { ac?: number };
    periodicDamage?: number;
    periodicHeal?: number;
    tickIntervalMs?: number;
    effectAnimation?: number;
    stacks?: boolean;
}

const effectDefinitions: Map<string, EffectDefinition> = new Map();

export function registerEffect(def: EffectDefinition): void {
    effectDefinitions.set(def.key, def);
}

export function getEffectDefinition(key: string): EffectDefinition | undefined {
    return effectDefinitions.get(key);
}

export function applyEffect(creature: ShadowCreature, def: EffectDefinition): ActiveEffect {
    if (!def.stacks) {
        creature.effects = creature.effects.filter(e => e.key !== def.key);
    }

    const now = Date.now();
    const effect: ActiveEffect = {
        key: def.key,
        name: def.name,
        durationMs: def.durationMs,
        appliedAt: now,
        statModifiers: { ...def.statModifiers },
        periodicDamage: def.periodicDamage,
        periodicHeal: def.periodicHeal,
        tickIntervalMs: def.tickIntervalMs,
        lastTickAt: def.tickIntervalMs ? now : undefined,
        effectAnimation: def.effectAnimation,
    };

    creature.effects.push(effect);
    return effect;
}

export function removeEffect(creature: ShadowCreature, key: string): boolean {
    const idx = creature.effects.findIndex(e => e.key === key);
    if (idx === -1) return false;
    creature.effects.splice(idx, 1);
    return true;
}

export function hasEffect(creature: ShadowCreature, key: string): boolean {
    return creature.effects.some(e => e.key === key);
}

export function initBuiltinEffects(): void {
    registerEffect({
        key: 'armachd',
        name: 'Armachd',
        durationMs: 120000,
        statModifiers: { ac: -20 },
        effectAnimation: 20,
    });
    registerEffect({
        key: 'beag_cradh',
        name: 'Beag Cradh',
        durationMs: 60000,
        statModifiers: { ac: 10 },
        effectAnimation: 259,
    });
    registerEffect({
        key: 'cradh',
        name: 'Cradh',
        durationMs: 90000,
        statModifiers: { ac: 20 },
        effectAnimation: 258,
    });
    registerEffect({
        key: 'mor_cradh',
        name: 'Mor Cradh',
        durationMs: 120000,
        statModifiers: { ac: 35 },
        effectAnimation: 243,
    });
    registerEffect({
        key: 'ard_cradh',
        name: 'Ard Cradh',
        durationMs: 180000,
        statModifiers: { ac: 50 },
        effectAnimation: 257,
    });
    registerEffect({
        key: 'poison',
        name: 'Poison',
        durationMs: 30000,
        periodicDamage: 50,
        tickIntervalMs: 3000,
        effectAnimation: 25,
        stacks: false,
    });
    registerEffect({
        key: 'regen',
        name: 'Regeneration',
        durationMs: 60000,
        periodicHeal: 100,
        tickIntervalMs: 5000,
        effectAnimation: 187,
        stacks: false,
    });
    registerEffect({
        key: 'dion',
        name: 'Dion',
        durationMs: 30000,
        statModifiers: { ac: -50 },
        effectAnimation: 244,
    });
    registerEffect({
        key: 'creag_neart',
        name: 'Creag Neart',
        durationMs: 120000,
        statModifiers: { str: 10 },
        effectAnimation: 6,
    });
}
