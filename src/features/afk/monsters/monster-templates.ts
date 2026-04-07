/**
 * Monster template loader — reads static monster definitions from JSON data files.
 */

import fs from 'fs';
import path from 'path';
import { ShadowMonsterTemplate } from '../shadow-entity';

const MONSTERS_DIR = path.resolve(__dirname, '../../../../data/afk/monsters');

const templateCache: Map<string, ShadowMonsterTemplate> = new Map();

export function loadMonsterTemplates(): void {
    templateCache.clear();
    if (!fs.existsSync(MONSTERS_DIR)) return;

    for (const file of fs.readdirSync(MONSTERS_DIR)) {
        if (!file.endsWith('.json')) continue;
        try {
            const raw = JSON.parse(fs.readFileSync(path.join(MONSTERS_DIR, file), 'utf-8'));
            const template = normalizeTemplate(raw);
            templateCache.set(template.templateKey, template);
        } catch (e) {
            console.log(`[MonsterTemplates] Failed to load ${file}: ${e}`);
        }
    }
    console.log(`[MonsterTemplates] Loaded ${templateCache.size} templates`);
}

function normalizeTemplate(raw: any): ShadowMonsterTemplate {
    return {
        templateKey: raw.templateKey ?? raw.name?.toLowerCase().replace(/\s+/g, '_') ?? 'unknown',
        name: raw.name ?? 'Unknown',
        sprite: raw.sprite ?? 0,
        level: raw.level ?? 1,
        maxHp: raw.maxHp ?? 100,
        maxMp: raw.maxMp ?? 0,
        stats: {
            str: raw.stats?.str ?? 5,
            int: raw.stats?.int ?? 5,
            wis: raw.stats?.wis ?? 5,
            con: raw.stats?.con ?? 5,
            dex: raw.stats?.dex ?? 5,
        },
        ac: raw.ac ?? 100,
        aggroRange: raw.aggroRange ?? 8,
        moveIntervalMs: raw.moveIntervalMs ?? 1000,
        assailIntervalMs: raw.assailIntervalMs ?? 1500,
        skillIntervalMs: raw.skillIntervalMs ?? 5000,
        spellIntervalMs: raw.spellIntervalMs ?? 5000,
        wanderIntervalMs: raw.wanderIntervalMs ?? 3000,
        expReward: raw.expReward ?? 50,
        goldDrop: {
            min: raw.goldDrop?.min ?? 0,
            max: raw.goldDrop?.max ?? 0,
        },
        lootTableKey: raw.lootTableKey ?? '',
        skills: raw.skills ?? [],
        spells: raw.spells ?? [],
        respawnMs: raw.respawnMs ?? 30000,
    };
}

export function getMonsterTemplate(key: string): ShadowMonsterTemplate | undefined {
    return templateCache.get(key);
}

export function getAllMonsterTemplates(): Map<string, ShadowMonsterTemplate> {
    return templateCache;
}
