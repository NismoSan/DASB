/**
 * Shadow Inventory with dual-panel switcher.
 * Manages shadow items, real inventory snapshot, and the Shadow Realm Tome toggle.
 */

import Packet from '../../../core/packet';
import { ShadowItemTemplate } from '../shadow-entity';
import { getItemTemplate } from '../loot/loot-tables';

export interface ShadowItem {
    slot: number;
    templateKey: string;
    name: string;
    sprite: number;
    color: number;
    quantity: number;
    stackable: boolean;
    maxDurability: number;
    durability: number;
    template: ShadowItemTemplate;
}

export interface RealInventoryItem {
    slot: number;
    sprite: number;
    color: number;
    name: string;
    quantity: number;
    stackable: boolean;
}

export interface RealSpellSnapshot {
    slot: number;
    icon: number;
    spellType: number;
    name: string;
    prompt: string;
    castLines: number;
}

export interface RealSkillSnapshot {
    slot: number;
    icon: number;
    name: string;
}

export type InventoryViewMode = 'shadow' | 'real';

export interface ShadowInventoryState {
    viewMode: InventoryViewMode;
    realInventorySnapshot: Map<number, RealInventoryItem>;
    shadowItems: Map<number, ShadowItem>;
    shadowGold: number;
    realSpellsSnapshot: Map<number, RealSpellSnapshot>;
    realSkillsSnapshot: Map<number, RealSkillSnapshot>;
}

export const TOME_SLOT = 60;
const TOME_SPRITE = 629; // book sprite
const TOME_COLOR = 0;
const MAX_SLOTS = 60;

export function createShadowInventoryState(
    realInventory: Map<number, any>,
    realSpells?: Map<number, any>,
    realSkills?: Map<number, any>
): ShadowInventoryState {
    const snapshot = new Map<number, RealInventoryItem>();
    for (const [slot, item] of realInventory) {
        const rawSprite = item.sprite ?? 0;
        const baseSprite = rawSprite >= 0x8000 ? rawSprite - 0x8000 : rawSprite;
        snapshot.set(slot, {
            slot: item.slot,
            sprite: baseSprite,
            color: item.color,
            name: item.name,
            quantity: item.quantity,
            stackable: item.stackable ?? false,
        });
    }

    const spellSnap = new Map<number, RealSpellSnapshot>();
    if (realSpells) {
        for (const [slot, sp] of realSpells) {
            spellSnap.set(slot, {
                slot,
                icon: sp.icon ?? 0,
                spellType: sp.spellType ?? 0,
                name: sp.name ?? '',
                prompt: sp.prompt ?? '',
                castLines: sp.castLines ?? 0,
            });
        }
    }

    const skillSnap = new Map<number, RealSkillSnapshot>();
    if (realSkills) {
        for (const [slot, sk] of realSkills) {
            skillSnap.set(slot, {
                slot,
                icon: sk.icon ?? 0,
                name: sk.name ?? '',
            });
        }
    }

    return {
        viewMode: 'shadow',
        realInventorySnapshot: snapshot,
        shadowItems: new Map(),
        shadowGold: 0,
        realSpellsSnapshot: spellSnap,
        realSkillsSnapshot: skillSnap,
    };
}

export function buildAddItemPacket(
    slot: number, sprite: number, color: number, name: string,
    quantity: number, stackable: boolean, maxDurability = 0, durability = 0
): Packet {
    const pkt = new Packet(0x0F);
    pkt.writeByte(slot);
    pkt.writeUInt16(sprite + 0x8000); // sprite + ITEM_SPRITE_OFFSET (32768)
    pkt.writeByte(color);
    pkt.writeString8(name);
    pkt.writeUInt32(quantity);
    pkt.writeByte(stackable ? 1 : 0);
    pkt.writeUInt32(maxDurability);
    pkt.writeUInt32(durability);
    if (stackable) {
        pkt.writeByte(0); // trailing byte for stackable items
    }
    return pkt;
}

export function buildRemoveItemPacket(slot: number): Packet {
    const pkt = new Packet(0x10);
    pkt.writeByte(slot);
    return pkt;
}

function getTomeName(mode: InventoryViewMode): string {
    return mode === 'shadow' ? '[Shadow] Realm Tome' : '[Real] Realm Tome';
}

export function sendClearInventory(
    sendToClient: (pkt: Packet) => void,
    occupiedSlots?: Iterable<number>
): void {
    if (occupiedSlots) {
        for (const slot of occupiedSlots) {
            sendToClient(buildRemoveItemPacket(slot));
        }
    } else {
        for (let slot = 1; slot <= MAX_SLOTS; slot++) {
            sendToClient(buildRemoveItemPacket(slot));
        }
    }
}

export function sendTome(sendToClient: (pkt: Packet) => void, mode: InventoryViewMode): void {
    sendToClient(buildAddItemPacket(
        TOME_SLOT, TOME_SPRITE, TOME_COLOR,
        getTomeName(mode), 1, false, 0, 0
    ));
}

export function sendShadowView(
    sendToClient: (pkt: Packet) => void,
    state: ShadowInventoryState
): void {
    sendClearInventory(sendToClient);
    sendTome(sendToClient, 'shadow');
    for (const [slot, item] of state.shadowItems) {
        if (slot === TOME_SLOT) continue;
        sendToClient(buildAddItemPacket(
            slot, item.sprite, item.color, item.name,
            item.quantity, item.stackable, item.maxDurability, item.durability
        ));
    }
    state.viewMode = 'shadow';
}

export function sendRealView(
    sendToClient: (pkt: Packet) => void,
    state: ShadowInventoryState
): void {
    sendClearInventory(sendToClient);
    sendTome(sendToClient, 'real');
    for (const [slot, item] of state.realInventorySnapshot) {
        if (slot === TOME_SLOT) continue;
        sendToClient(buildAddItemPacket(
            slot, item.sprite, item.color, item.name,
            item.quantity, item.stackable, 0, 0
        ));
    }
    state.viewMode = 'real';
}

export function toggleInventoryView(
    sendToClient: (pkt: Packet) => void,
    state: ShadowInventoryState
): void {
    if (state.viewMode === 'shadow') {
        sendRealView(sendToClient, state);
    } else {
        sendShadowView(sendToClient, state);
    }
}

export function restoreRealInventory(
    sendToClient: (pkt: Packet) => void,
    state: ShadowInventoryState
): void {
    sendClearInventory(sendToClient);
    for (const [slot, item] of state.realInventorySnapshot) {
        sendToClient(buildAddItemPacket(
            slot, item.sprite, item.color, item.name,
            item.quantity, item.stackable, 0, 0
        ));
    }
}

export function addItemToShadowInventory(
    state: ShadowInventoryState,
    template: ShadowItemTemplate,
    quantity: number = 1
): number | null {
    // Try to stack
    if (template.stackable) {
        for (const [slot, item] of state.shadowItems) {
            if (item.templateKey === template.templateKey && item.quantity < template.maxStack) {
                const canAdd = Math.min(quantity, template.maxStack - item.quantity);
                item.quantity += canAdd;
                return slot;
            }
        }
    }

    // Find first free slot (1-59, slot 60 is tome)
    for (let slot = 1; slot < MAX_SLOTS; slot++) {
        if (!state.shadowItems.has(slot)) {
            state.shadowItems.set(slot, {
                slot,
                templateKey: template.templateKey,
                name: template.name,
                sprite: template.sprite,
                color: template.color,
                quantity,
                stackable: template.stackable,
                maxDurability: 0,
                durability: 0,
                template,
            });
            return slot;
        }
    }
    return null; // inventory full
}

export function removeItemFromShadowInventory(
    state: ShadowInventoryState,
    slot: number
): ShadowItem | null {
    const item = state.shadowItems.get(slot);
    if (!item) return null;
    state.shadowItems.delete(slot);
    return item;
}

// ─── Spell/Skill packet helpers ──────────────────────────────────

const MAX_SPELL_SLOTS = 90;
const MAX_SKILL_SLOTS = 89;
const INVALID_BOOK_SLOTS = new Set([0, 36, 72]);

function buildRemoveSpellPacket(slot: number): Packet {
    const pkt = new Packet(0x18);
    pkt.writeByte(slot);
    return pkt;
}

function buildRemoveSkillPacket(slot: number): Packet {
    const pkt = new Packet(0x2D);
    pkt.writeByte(slot);
    return pkt;
}

function buildAddSpellPacket(sp: RealSpellSnapshot): Packet {
    const pkt = new Packet(0x17);
    pkt.writeByte(sp.slot);
    pkt.writeUInt16(sp.icon);
    pkt.writeByte(sp.spellType);
    pkt.writeString8(sp.name);
    pkt.writeString8(sp.prompt);
    pkt.writeByte(sp.castLines);
    return pkt;
}

function buildAddSkillPacket(sk: RealSkillSnapshot): Packet {
    const pkt = new Packet(0x2C);
    pkt.writeByte(sk.slot);
    pkt.writeUInt16(sk.icon);
    pkt.writeString8(sk.name);
    return pkt;
}

export function clearSpellsAndSkills(sendToClient: (pkt: Packet) => void): void {
    for (let slot = 1; slot <= MAX_SPELL_SLOTS; slot++) {
        if (INVALID_BOOK_SLOTS.has(slot)) continue;
        sendToClient(buildRemoveSpellPacket(slot));
    }
    for (let slot = 1; slot <= MAX_SKILL_SLOTS; slot++) {
        if (INVALID_BOOK_SLOTS.has(slot)) continue;
        sendToClient(buildRemoveSkillPacket(slot));
    }
}

export function restoreRealSpellsAndSkills(
    sendToClient: (pkt: Packet) => void,
    state: ShadowInventoryState
): void {
    for (let slot = 1; slot <= MAX_SPELL_SLOTS; slot++) {
        if (INVALID_BOOK_SLOTS.has(slot)) continue;
        sendToClient(buildRemoveSpellPacket(slot));
    }
    for (let slot = 1; slot <= MAX_SKILL_SLOTS; slot++) {
        if (INVALID_BOOK_SLOTS.has(slot)) continue;
        sendToClient(buildRemoveSkillPacket(slot));
    }
    for (const sp of state.realSpellsSnapshot.values()) {
        sendToClient(buildAddSpellPacket(sp));
    }
    for (const sk of state.realSkillsSnapshot.values()) {
        sendToClient(buildAddSkillPacket(sk));
    }
}

export function serializeSpellsSnapshot(spells: Map<number, RealSpellSnapshot>): any[] {
    const result: any[] = [];
    for (const sp of spells.values()) {
        result.push({
            slot: sp.slot,
            icon: sp.icon,
            spellType: sp.spellType,
            name: sp.name,
            prompt: sp.prompt,
            castLines: sp.castLines,
        });
    }
    return result;
}

export function serializeSkillsSnapshot(skills: Map<number, RealSkillSnapshot>): any[] {
    const result: any[] = [];
    for (const sk of skills.values()) {
        result.push({
            slot: sk.slot,
            icon: sk.icon,
            name: sk.name,
        });
    }
    return result;
}

export function deserializeSpellsSnapshot(rows: any[]): Map<number, RealSpellSnapshot> {
    const map = new Map<number, RealSpellSnapshot>();
    for (const r of rows) {
        map.set(r.slot, {
            slot: r.slot,
            icon: r.icon,
            spellType: r.spellType ?? r.spell_type ?? 0,
            name: r.name,
            prompt: r.prompt ?? '',
            castLines: r.castLines ?? r.cast_lines ?? 0,
        });
    }
    return map;
}

export function deserializeSkillsSnapshot(rows: any[]): Map<number, RealSkillSnapshot> {
    const map = new Map<number, RealSkillSnapshot>();
    for (const r of rows) {
        map.set(r.slot, {
            slot: r.slot,
            icon: r.icon,
            name: r.name,
        });
    }
    return map;
}

// ─── Serialization ──────────────────────────────────────────────

export function serializeShadowItems(items: Map<number, ShadowItem>): any[] {
    const result: any[] = [];
    for (const [_slot, item] of items) {
        result.push({
            slot: item.slot,
            templateKey: item.templateKey,
            name: item.name,
            sprite: item.sprite,
            color: item.color,
            quantity: item.quantity,
            stackable: item.stackable,
            maxDurability: item.maxDurability,
            durability: item.durability,
        });
    }
    return result;
}

export function deserializeShadowItems(rows: any[]): Map<number, ShadowItem> {
    const items = new Map<number, ShadowItem>();
    for (const row of rows) {
        const templateKey = row.template_key ?? row.templateKey;
        const template = getItemTemplate(templateKey);
        if (!template) {
            console.log(`[ShadowInventory] Skipping unknown item template '${templateKey}' in slot ${row.slot}`);
            continue;
        }
        items.set(row.slot, {
            slot: row.slot,
            templateKey,
            name: row.name,
            sprite: row.sprite,
            color: row.color ?? 0,
            quantity: row.quantity ?? 1,
            stackable: row.stackable ?? false,
            maxDurability: row.max_durability ?? row.maxDurability ?? 100,
            durability: row.durability ?? 100,
            template,
        });
    }
    return items;
}
