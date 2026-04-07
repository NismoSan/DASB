/**
 * Shadow Entity hierarchy for the AFK Dark Ages world simulation.
 * Lightweight mirrors of Chaos Server entity types, managed entirely proxy-side.
 */

export interface ShadowStats {
    str: number;
    int: number;
    wis: number;
    con: number;
    dex: number;
}

export interface ActiveEffect {
    key: string;
    name: string;
    durationMs: number;
    appliedAt: number;
    statModifiers: Partial<ShadowStats> & { ac?: number };
    periodicDamage?: number;
    periodicHeal?: number;
    tickIntervalMs?: number;
    lastTickAt?: number;
    effectAnimation?: number;
}

export class ShadowEntity {
    serial: number;
    x: number;
    y: number;
    mapId: number;
    direction: number;
    sprite: number;

    constructor(serial: number, x: number, y: number, mapId: number, sprite: number) {
        this.serial = serial;
        this.x = x;
        this.y = y;
        this.mapId = mapId;
        this.direction = 0;
        this.sprite = sprite;
    }
}

export class ShadowCreature extends ShadowEntity {
    hp: number;
    maxHp: number;
    mp: number;
    maxMp: number;
    stats: ShadowStats;
    level: number;
    ac: number;
    effects: ActiveEffect[];
    alive: boolean;

    constructor(
        serial: number, x: number, y: number, mapId: number, sprite: number,
        maxHp: number, maxMp: number, level: number, stats: ShadowStats, ac: number
    ) {
        super(serial, x, y, mapId, sprite);
        this.hp = maxHp;
        this.maxHp = maxHp;
        this.mp = maxMp;
        this.maxMp = maxMp;
        this.stats = { ...stats };
        this.level = level;
        this.ac = ac;
        this.effects = [];
        this.alive = true;
    }

    getEffectiveAc(): number {
        let ac = this.ac;
        for (const e of this.effects) {
            if (e.statModifiers.ac !== undefined) ac += e.statModifiers.ac;
        }
        return ac;
    }

    getEffectiveStat(stat: keyof ShadowStats): number {
        let val = this.stats[stat];
        for (const e of this.effects) {
            const mod = e.statModifiers[stat];
            if (mod !== undefined) val += mod;
        }
        return Math.max(1, val);
    }
}

export type MonsterAiState = 'idle' | 'wander' | 'aggro' | 'chase' | 'attack' | 'cast' | 'death' | 'returning';

export interface AggroEntry {
    serial: number;
    threat: number;
}

export class ShadowMonster extends ShadowCreature {
    templateKey: string;
    name: string;
    aiState: MonsterAiState;
    aggroTable: AggroEntry[];
    lootTableKey: string;
    expReward: number;
    goldDrop: { min: number; max: number };
    skills: string[];
    spells: string[];
    aggroRange: number;
    moveIntervalMs: number;
    assailIntervalMs: number;
    skillIntervalMs: number;
    spellIntervalMs: number;
    wanderIntervalMs: number;
    spawnX: number;
    spawnY: number;
    maxLeashRange: number;

    lastMoveTime: number;
    lastAssailTime: number;
    lastSkillTime: number;
    lastSpellTime: number;
    lastWanderTime: number;
    deathTime: number;
    respawnMs: number;

    constructor(
        serial: number, x: number, y: number, mapId: number,
        template: ShadowMonsterTemplate
    ) {
        super(serial, x, y, mapId, template.sprite,
            template.maxHp, template.maxMp, template.level,
            { ...template.stats }, template.ac);
        this.templateKey = template.templateKey;
        this.name = template.name;
        this.aiState = 'idle';
        this.aggroTable = [];
        this.lootTableKey = template.lootTableKey;
        this.expReward = template.expReward;
        this.goldDrop = { ...template.goldDrop };
        this.skills = [...template.skills];
        this.spells = [...template.spells];
        this.aggroRange = template.aggroRange;
        this.moveIntervalMs = template.moveIntervalMs;
        this.assailIntervalMs = template.assailIntervalMs;
        this.skillIntervalMs = template.skillIntervalMs;
        this.spellIntervalMs = template.spellIntervalMs;
        this.wanderIntervalMs = template.wanderIntervalMs;
        this.spawnX = x;
        this.spawnY = y;
        this.maxLeashRange = template.aggroRange * 3;

        this.lastMoveTime = 0;
        this.lastAssailTime = 0;
        this.lastSkillTime = 0;
        this.lastSpellTime = 0;
        this.lastWanderTime = 0;
        this.deathTime = 0;
        this.respawnMs = template.respawnMs ?? 30000;
    }

    getHighestThreat(): AggroEntry | undefined {
        if (this.aggroTable.length === 0) return undefined;
        return this.aggroTable.reduce((a, b) => a.threat >= b.threat ? a : b);
    }

    addThreat(serial: number, amount: number): void {
        const existing = this.aggroTable.find(e => e.serial === serial);
        if (existing) {
            existing.threat += amount;
        } else {
            this.aggroTable.push({ serial, threat: amount });
        }
    }

    removeThreat(serial: number): void {
        this.aggroTable = this.aggroTable.filter(e => e.serial !== serial);
    }

    clearAggro(): void {
        this.aggroTable = [];
        this.aiState = 'idle';
    }
}

export interface ShadowMonsterTemplate {
    templateKey: string;
    name: string;
    sprite: number;
    level: number;
    maxHp: number;
    maxMp: number;
    stats: ShadowStats;
    ac: number;
    aggroRange: number;
    moveIntervalMs: number;
    assailIntervalMs: number;
    skillIntervalMs: number;
    spellIntervalMs: number;
    wanderIntervalMs: number;
    expReward: number;
    goldDrop: { min: number; max: number };
    lootTableKey: string;
    skills: string[];
    spells: string[];
    respawnMs?: number;
}

export interface ShadowItemTemplate {
    templateKey: string;
    name: string;
    sprite: number;
    color: number;
    stackable: boolean;
    maxStack: number;
    type: 'consumable' | 'equipment' | 'misc';
    equipSlot?: string;
    healHp?: number;
    healMp?: number;
    statBonuses?: Partial<ShadowStats> & { ac?: number };
    levelRequirement?: number;
    classRequirement?: string;
    sellValue?: number;
    buyValue?: number;
}

export class ShadowGroundItem extends ShadowEntity {
    templateKey: string;
    name: string;
    color: number;
    quantity: number;
    despawnAt: number;
    ownerSerial: number | null;
    isGold: boolean;

    constructor(
        serial: number, x: number, y: number, mapId: number,
        sprite: number, templateKey: string, name: string, color: number,
        quantity: number, despawnMs: number, ownerSerial: number | null,
        isGold = false
    ) {
        super(serial, x, y, mapId, sprite);
        this.templateKey = templateKey;
        this.name = name;
        this.color = color;
        this.quantity = quantity;
        this.despawnAt = Date.now() + despawnMs;
        this.ownerSerial = ownerSerial;
        this.isGold = isGold;
    }
}
