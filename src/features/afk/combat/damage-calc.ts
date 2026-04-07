/**
 * Damage formula engine for the AFK Shadow World.
 * Based on Chaos Server's Formulae system with DA-standard element cycle.
 */

export type Element = 'none' | 'fire' | 'water' | 'wind' | 'earth' | 'light' | 'dark';

const ELEMENT_ADVANTAGE: Record<string, string> = {
    fire: 'wind',
    wind: 'water',
    water: 'earth',
    earth: 'fire',
    light: 'dark',
    dark: 'light',
};

export interface PhysicalDamageInput {
    attackerStr: number;
    attackerDex: number;
    attackerLevel: number;
    baseDamage: number;
    targetAc: number;
    targetLevel: number;
}

export interface MagicalDamageInput {
    attackerInt: number;
    attackerLevel: number;
    basePower: number;
    attackerElement?: Element;
    targetElement?: Element;
}

export interface HealInput {
    casterWis: number;
    casterLevel: number;
    basePower: number;
}

export function calculatePhysicalDamage(input: PhysicalDamageInput): number {
    const strBonus = input.attackerStr * 0.5;
    const levelBonus = input.attackerLevel * 0.25;
    const rawDamage = input.baseDamage + strBonus + levelBonus;

    const acReduction = Math.max(0, (100 - input.targetAc) * 0.5);
    const reducedDamage = rawDamage - acReduction;

    // Variance: +/- 10%
    const variance = 0.9 + Math.random() * 0.2;
    const finalDamage = Math.floor(reducedDamage * variance);

    return Math.max(1, finalDamage);
}

export function calculateCritChance(attackerDex: number): boolean {
    const critChance = Math.min(0.25, attackerDex * 0.005);
    return Math.random() < critChance;
}

export function calculateMagicalDamage(input: MagicalDamageInput): number {
    const intBonus = input.attackerInt * 1.5;
    const levelBonus = input.attackerLevel * 0.5;
    let rawDamage = input.basePower + intBonus + levelBonus;

    // Element advantage
    if (input.attackerElement && input.targetElement &&
        input.attackerElement !== 'none' && input.targetElement !== 'none') {
        if (ELEMENT_ADVANTAGE[input.attackerElement] === input.targetElement) {
            rawDamage *= 1.5;
        } else if (ELEMENT_ADVANTAGE[input.targetElement] === input.attackerElement) {
            rawDamage *= 0.7;
        }
    }

    const variance = 0.9 + Math.random() * 0.2;
    return Math.max(1, Math.floor(rawDamage * variance));
}

export function calculateHealing(input: HealInput): number {
    const wisBonus = input.casterWis * 1.0;
    const levelBonus = input.casterLevel * 0.5;
    const rawHeal = input.basePower + wisBonus + levelBonus;
    const variance = 0.95 + Math.random() * 0.1;
    return Math.max(1, Math.floor(rawHeal * variance));
}

export function calculateMonsterAssailDamage(
    monsterStr: number, monsterLevel: number, targetAc: number
): number {
    const baseDamage = monsterStr * 0.8 + monsterLevel * 2;
    const acReduction = Math.max(0, (100 - targetAc) * 0.3);
    const variance = 0.85 + Math.random() * 0.3;
    return Math.max(1, Math.floor((baseDamage - acReduction) * variance));
}
