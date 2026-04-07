/**
 * Shadow Merchants — NPC shops and trainers for the AFK world.
 * Loads merchant placement data from map instance configs.
 */

import fs from 'fs';
import path from 'path';
import { ShadowItemTemplate } from '../shadow-entity';
import { ShadowInventoryState, addItemToShadowInventory } from '../inventory/shadow-inventory';
import { getItemTemplate } from '../loot/loot-tables';

export interface MerchantItem {
    templateKey: string;
    buyPrice: number;
    sellPrice: number;
}

export interface MerchantConfig {
    npcKey: string;
    name: string;
    sprite: number;
    x: number;
    y: number;
    type: 'shop' | 'trainer' | 'bank' | 'inn';
    items?: MerchantItem[];
    trainableSpells?: string[];
    trainableSkills?: string[];
    greeting?: string;
}

export interface MapMerchantData {
    mapId: number;
    merchants: MerchantConfig[];
}

const MAP_INSTANCES_DIR = path.resolve(__dirname, '../../../../data/afk/map-instances');

const merchantCache: Map<number, MerchantConfig[]> = new Map();

export function loadMerchants(): void {
    merchantCache.clear();
    if (!fs.existsSync(MAP_INSTANCES_DIR)) return;

    for (const dir of fs.readdirSync(MAP_INSTANCES_DIR)) {
        const merchFile = path.join(MAP_INSTANCES_DIR, dir, 'merchants.json');
        if (!fs.existsSync(merchFile)) continue;

        try {
            const raw = JSON.parse(fs.readFileSync(merchFile, 'utf-8'));
            const mapId = raw.mapId;
            if (!mapId) continue;

            const merchants: MerchantConfig[] = raw.merchants ?? [];
            merchantCache.set(mapId, merchants);
        } catch (e) {
            console.log(`[Merchants] Failed to load ${dir}/merchants.json: ${e}`);
        }
    }

    let total = 0;
    for (const ms of merchantCache.values()) total += ms.length;
    console.log(`[Merchants] Loaded ${total} merchants across ${merchantCache.size} maps`);
}

export function getMerchantsForMap(mapId: number): MerchantConfig[] {
    return merchantCache.get(mapId) ?? [];
}

export function buyItem(
    inventory: ShadowInventoryState,
    merchantItem: MerchantItem
): { success: boolean; message: string; slot?: number } {
    if (inventory.shadowGold < merchantItem.buyPrice) {
        return { success: false, message: 'Not enough gold.' };
    }

    const template = getItemTemplate(merchantItem.templateKey);
    if (!template) {
        return { success: false, message: 'Item not available.' };
    }

    const slot = addItemToShadowInventory(inventory, template);
    if (slot === null) {
        return { success: false, message: 'Inventory is full.' };
    }

    inventory.shadowGold -= merchantItem.buyPrice;
    return { success: true, message: `Bought ${template.name}.`, slot };
}

export function sellItem(
    inventory: ShadowInventoryState,
    slot: number
): { success: boolean; message: string; gold?: number } {
    const item = inventory.shadowItems.get(slot);
    if (!item) {
        return { success: false, message: 'No item in that slot.' };
    }

    const sellValue = item.template.sellValue ?? 0;
    inventory.shadowItems.delete(slot);
    inventory.shadowGold += sellValue;

    return { success: true, message: `Sold ${item.name} for ${sellValue} gold.`, gold: sellValue };
}
