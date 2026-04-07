/**
 * Loot table system — defines drop chances for monsters, rolls loot on death.
 */

import fs from 'fs';
import path from 'path';
import { ShadowItemTemplate } from '../shadow-entity';

export interface LootTableEntry {
    itemTemplateKey: string;
    dropChance: number;
    minQuantity: number;
    maxQuantity: number;
}

export interface LootTable {
    key: string;
    entries: LootTableEntry[];
}

export interface LootDrop {
    templateKey: string;
    quantity: number;
}

const LOOT_TABLES_FILE = path.resolve(__dirname, '../../../../data/afk/loot-tables.json');
const ITEMS_DIR = path.resolve(__dirname, '../../../../data/afk/items');

const lootTableCache: Map<string, LootTable> = new Map();
const itemTemplateCache: Map<string, ShadowItemTemplate> = new Map();

export function loadLootTables(): void {
    lootTableCache.clear();
    if (!fs.existsSync(LOOT_TABLES_FILE)) return;

    try {
        const raw = JSON.parse(fs.readFileSync(LOOT_TABLES_FILE, 'utf-8'));
        const tables: LootTable[] = Array.isArray(raw) ? raw : raw.tables ?? [];
        for (const table of tables) {
            lootTableCache.set(table.key, table);
        }
        console.log(`[LootTables] Loaded ${lootTableCache.size} loot tables`);
    } catch (e) {
        console.log(`[LootTables] Failed to load: ${e}`);
    }
}

export function loadItemTemplates(): void {
    itemTemplateCache.clear();
    if (!fs.existsSync(ITEMS_DIR)) return;

    for (const file of fs.readdirSync(ITEMS_DIR)) {
        if (!file.endsWith('.json')) continue;
        try {
            const raw = JSON.parse(fs.readFileSync(path.join(ITEMS_DIR, file), 'utf-8'));
            const template = normalizeItemTemplate(raw);
            itemTemplateCache.set(template.templateKey, template);
        } catch (e) {
            console.log(`[ItemTemplates] Failed to load ${file}: ${e}`);
        }
    }
    console.log(`[ItemTemplates] Loaded ${itemTemplateCache.size} item templates`);
}

function normalizeItemTemplate(raw: any): ShadowItemTemplate {
    return {
        templateKey: raw.templateKey ?? raw.name?.toLowerCase().replace(/\s+/g, '_') ?? 'unknown',
        name: raw.name ?? 'Unknown',
        sprite: raw.sprite ?? 0,
        color: raw.color ?? 0,
        stackable: raw.stackable ?? false,
        maxStack: raw.maxStack ?? 1,
        type: raw.type ?? 'misc',
        equipSlot: raw.equipSlot,
        healHp: raw.healHp,
        healMp: raw.healMp,
        statBonuses: raw.statBonuses,
        levelRequirement: raw.levelRequirement,
        classRequirement: raw.classRequirement,
        sellValue: raw.sellValue ?? 0,
        buyValue: raw.buyValue ?? 0,
    };
}

export function getItemTemplate(key: string): ShadowItemTemplate | undefined {
    return itemTemplateCache.get(key);
}

export function getLootTable(key: string): LootTable | undefined {
    return lootTableCache.get(key);
}

export function rollLoot(lootTableKey: string): LootDrop[] {
    const table = lootTableCache.get(lootTableKey);
    if (!table) return [];

    const drops: LootDrop[] = [];
    for (const entry of table.entries) {
        if (Math.random() <= entry.dropChance) {
            const qty = entry.minQuantity +
                Math.floor(Math.random() * (entry.maxQuantity - entry.minQuantity + 1));
            if (qty > 0) {
                drops.push({ templateKey: entry.itemTemplateKey, quantity: qty });
            }
        }
    }
    return drops;
}
