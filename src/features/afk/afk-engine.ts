/**
 * AFK Engine — integrates all AFK subsystems (world, monsters, combat, loot,
 * inventory, progression, effects, groups) and wires them to proxy events.
 *
 * This is initialized from the existing initAfkMode in afk-mode.js and adds
 * the full Dark Ages server simulation layer on top.
 */

import Packet from '../../core/packet';
import { ShadowWorld } from './shadow-world';
import { ShadowMonster, ShadowGroundItem, ShadowCreature, ActiveEffect, ShadowMonsterTemplate } from './shadow-entity';
import { loadMonsterTemplates, getMonsterTemplate } from './monsters/monster-templates';
import { MonsterSpawner } from './monsters/monster-spawner';
import { updateMonsterAi, AiTarget, AiCallbacks } from './monsters/monster-ai';
import {
    calculatePhysicalDamage, calculateMagicalDamage, calculateHealing,
    calculateMonsterAssailDamage, calculateCritChance
} from './combat/damage-calc';
import { loadLootTables, loadItemTemplates, rollLoot, getItemTemplate, getLootTable } from './loot/loot-tables';
import {
    ShadowInventoryState, createShadowInventoryState, sendShadowView,
    sendRealView, toggleInventoryView, restoreRealInventory,
    addItemToShadowInventory, removeItemFromShadowInventory,
    buildAddItemPacket, buildRemoveItemPacket,
    serializeShadowItems, deserializeShadowItems,
    clearSpellsAndSkills, restoreRealSpellsAndSkills,
    serializeSpellsSnapshot, serializeSkillsSnapshot,
    deserializeSpellsSnapshot, deserializeSkillsSnapshot,
    TOME_SLOT
} from './inventory/shadow-inventory';
import { loadMerchants } from './npcs/shadow-merchants';
import {
    ShadowPlayerState, loadLevelTable, checkLevelUp, raiseStat,
    createDefaultShadowPlayerState, shadowStatsToJSON, shadowStatsFromJSON,
    StatName
} from './progression/shadow-stats';
import * as db from '../database';
import { loadMapConfigs, findWarpAt, getMapConfig, getAllMapConfigs, getWarpsForMap } from './world/map-config';
import { initBuiltinEffects, applyEffect, getEffectDefinition } from './effects/effect-engine';
import {
    splitExpAmongGroup, getPlayerGroup, createGroup, addToGroup,
    removeFromGroup, getGroupMembers
} from './social/shadow-groups';

const VIEW_RANGE = 15;

const BodyAnimation = {
    None: 0, Assail: 1, HandsUp: 6, Death: 1,
    PriestCast: 128, TwoHandAtk: 129, WizardCast: 136,
};

export interface AfkEngineConfig {
    afkMapNumber: number;
    spawnX: number;
    spawnY: number;
}

export class AfkEngine {
    private _proxy: any;
    private _augmentation: any;
    private _automation: any;
    private _config: AfkEngineConfig;

    world: ShadowWorld;
    spawner: MonsterSpawner;

    private _inventories: Map<string, ShadowInventoryState>;
    private _playerStates: Map<string, ShadowPlayerState>;
    private _pendingRespawns: Map<number, { template: ShadowMonsterTemplate; mapId: number; x: number; y: number; at: number }>;
    private _spawnerTickTimer: ReturnType<typeof setInterval> | null;
    private _autoSaveTimer: ReturnType<typeof setInterval> | null;
    private _initialized: boolean;
    private _dirtyPlayers: Set<string>;
    private _sessionCharMap: Map<string, string>;

    constructor(proxy: any, augmentation: any, automation: any, config: AfkEngineConfig) {
        this._proxy = proxy;
        this._augmentation = augmentation;
        this._automation = automation;
        this._config = config;

        this._inventories = new Map();
        this._playerStates = new Map();
        this._pendingRespawns = new Map();
        this._spawnerTickTimer = null;
        this._autoSaveTimer = null;
        this._initialized = false;
        this._dirtyPlayers = new Set();
        this._sessionCharMap = new Map();

        this.world = new ShadowWorld({
            onMonsterUpdate: (mapId, monster) => this._onMonsterTick(mapId, monster),
            onGroundItemDespawn: (mapId, item) => this._onGroundItemDespawn(mapId, item),
            onEffectTick: (creature, effect) => this._onEffectTick(creature, effect),
            onEffectExpire: (creature, effect) => this._onEffectExpire(creature, effect),
        });

        this.spawner = new MonsterSpawner(
            this.world,
            () => this._proxy.registry.allocateVirtualSerial(),
            (mapId: number, x: number, y: number) => this._isWalkable(mapId, x, y),
            (mapId: number, monster: ShadowMonster) => this._broadcastMonsterSpawn(mapId, monster)
        );
    }

    initialize(): void {
        if (this._initialized) return;
        this._initialized = true;

        loadMonsterTemplates();
        loadLootTables();
        loadItemTemplates();
        loadMerchants();
        loadLevelTable();
        loadMapConfigs();
        initBuiltinEffects();

        this._initializeMapInstances();
        this.spawner.loadMapSpawns();

        this.world.start();

        this._spawnerTickTimer = setInterval(() => {
            this.spawner.tick();
            this._processRespawns();
        }, 2000);

        this._registerEvents();

        this._autoSaveTimer = setInterval(() => this._flushDirtyPlayers(), 60000);

        console.log('[AfkEngine] Initialized — world simulation running');
    }

    shutdown(): void {
        if (this._autoSaveTimer) {
            clearInterval(this._autoSaveTimer);
            this._autoSaveTimer = null;
        }

        for (const [sessionId, charName] of this._sessionCharMap) {
            this._savePlayerProgress(sessionId, charName);
        }

        this.world.stop();
        if (this._spawnerTickTimer) {
            clearInterval(this._spawnerTickTimer);
            this._spawnerTickTimer = null;
        }
    }

    // ─── Session lifecycle ────────────────────────────────────────

    onPlayerEnterAfk(session: any): void {
        const mapId = session.afkState?.afkMapNumber ?? this._config.afkMapNumber;
        const charName = session.characterName ?? 'unknown';

        this._sessionCharMap.set(session.id, charName);

        const mapCfg = getMapConfig(mapId);
        this.world.getOrCreateMapInstance(
            mapId,
            mapCfg?.name ?? `Shadow Map ${mapId}`,
            session.afkState?.afkMapWidth ?? 70,
            session.afkState?.afkMapHeight ?? 70
        );

        this.world.addPlayerToMap(mapId, session.id);

        // Snapshot real spells/skills from the automation caster
        const autoSession = this._automation.getSession?.(session.id);
        const realSpells = autoSession?.caster?.spells ?? new Map();
        const realSkills = autoSession?.caster?.skills ?? new Map();

        const inv = createShadowInventoryState(session.playerState.inventory, realSpells, realSkills);
        this._inventories.set(session.id, inv);

        db.loadAfkProgress(charName).then((saved) => {
            if (session.destroyed || !session.afkState?.active) return;

            let ps: ShadowPlayerState;
            if (saved) {
                ps = shadowStatsFromJSON(saved.stats);
                if (saved.inventory.length > 0) {
                    inv.shadowItems = deserializeShadowItems(saved.inventory);
                }
                if (saved.spells.length > 0) {
                    inv.realSpellsSnapshot = deserializeSpellsSnapshot(saved.spells);
                }
                if (saved.skills.length > 0) {
                    inv.realSkillsSnapshot = deserializeSkillsSnapshot(saved.skills);
                }
                console.log(`[AfkEngine] Restored saved progress for ${charName} (level ${ps.shadowLevel})`);
            } else {
                ps = createDefaultShadowPlayerState(
                    session.playerState.level,
                    session.playerState.className
                );
                console.log(`[AfkEngine] New shadow character for ${charName}`);
            }
            this._playerStates.set(session.id, ps);

            session.afkState.shadowHp = ps.shadowMaxHp;
            session.afkState.shadowMp = ps.shadowMaxMp;
            session.afkState.shadowMaxHp = ps.shadowMaxHp;
            session.afkState.shadowMaxMp = ps.shadowMaxMp;

            setTimeout(() => {
                if (session.destroyed || !session.afkState?.active) return;

                sendShadowView((pkt: Packet) => this._proxy.sendToClient(session, pkt), inv);
                clearSpellsAndSkills((pkt: Packet) => this._proxy.sendToClient(session, pkt));
                this._sendShadowSkillBar(session);
                this._sendExistingEntities(session, mapId);
                this._sendFullStats(session);
            }, 1500);
        }).catch((err) => {
            console.error(`[AfkEngine] Failed to load progress for ${charName}:`, err);
            const ps = createDefaultShadowPlayerState(
                session.playerState.level,
                session.playerState.className
            );
            this._playerStates.set(session.id, ps);
            session.afkState.shadowHp = ps.shadowMaxHp;
            session.afkState.shadowMp = ps.shadowMaxMp;
            session.afkState.shadowMaxHp = ps.shadowMaxHp;
            session.afkState.shadowMaxMp = ps.shadowMaxMp;

            setTimeout(() => {
                if (session.destroyed || !session.afkState?.active) return;
                sendShadowView((pkt: Packet) => this._proxy.sendToClient(session, pkt), inv);
                clearSpellsAndSkills((pkt: Packet) => this._proxy.sendToClient(session, pkt));
                this._sendShadowSkillBar(session);
                this._sendExistingEntities(session, mapId);
                this._sendFullStats(session);
            }, 1500);
        });
    }

    onPlayerExitAfk(session: any): void {
        const charName = this._sessionCharMap.get(session.id) ?? session.characterName ?? 'unknown';
        this._savePlayerProgress(session.id, charName);
        this._dirtyPlayers.delete(session.id);
        this._sessionCharMap.delete(session.id);

        const mapId = session.afkState?.afkMapNumber;
        if (mapId !== undefined) {
            this.world.removePlayerFromMap(mapId, session.id);
        }

        const inv = this._inventories.get(session.id);
        if (inv) {
            restoreRealInventory((pkt: Packet) => this._proxy.sendToClient(session, pkt), inv);
            restoreRealSpellsAndSkills((pkt: Packet) => this._proxy.sendToClient(session, pkt), inv);
            this._inventories.delete(session.id);
        }

        // Restore real stats so the client doesn't retain shadow HP/MP/level values.
        // playerState is kept up-to-date by the proxy even during AFK (0x08 is tracked
        // but blocked from the client), so these are the real server values.
        this._restoreRealStats(session);

        this._playerStates.delete(session.id);

        removeFromGroup(session.id);

        for (const instance of this.world.maps.values()) {
            for (const monster of instance.monsters.values()) {
                monster.removeThreat(session.playerState.serial);
            }
        }
    }

    onPlayerMapChange(session: any, oldMapId: number, newMapId: number): void {
        this.world.removePlayerFromMap(oldMapId, session.id);

        const mapCfg = getMapConfig(newMapId);
        this.world.getOrCreateMapInstance(
            newMapId,
            mapCfg?.name ?? `Shadow Map ${newMapId}`,
            session.afkState?.afkMapWidth ?? 70,
            session.afkState?.afkMapHeight ?? 70
        );

        this.world.addPlayerToMap(newMapId, session.id);
        this._sendExistingEntities(session, newMapId);
    }

    onPlayerRefreshAfk(session: any): void {
        if (!session.afkState?.active) return;

        const mapId = session.afkState.afkMapNumber ?? this._config.afkMapNumber;
        const inv = this._inventories.get(session.id);

        setTimeout(() => {
            if (session.destroyed || !session.afkState?.active) return;

            if (inv) {
                sendShadowView((pkt: Packet) => this._proxy.sendToClient(session, pkt), inv);
                clearSpellsAndSkills((pkt: Packet) => this._proxy.sendToClient(session, pkt));
                this._sendShadowSkillBar(session);
            }
            this._sendExistingEntities(session, mapId);
            this._sendFullStats(session);
        }, 500);
    }

    // ─── Combat: player attacks monster ───────────────────────────

    handleSpellOnMonster(session: any, targetSerial: number, spellMeta: any, spellName: string): boolean {
        const monster = this.world.getMonsterBySerial(targetSerial);
        if (!monster || !monster.alive) return false;

        const ps = this._playerStates.get(session.id);
        if (!ps) return false;

        let damage = 0;
        if (spellMeta.type === 'damage' && spellMeta.basePower > 0) {
            damage = calculateMagicalDamage({
                attackerInt: ps.shadowInt + session.playerState.level,
                attackerLevel: ps.shadowLevel,
                basePower: spellMeta.basePower,
            });

            if (calculateCritChance(ps.shadowDex)) {
                damage = Math.floor(damage * 1.5);
            }

            this._applyDamageToMonster(session, monster, damage);
        } else if (spellMeta.type === 'heal') {
            return false; // heal doesn't target monsters
        }

        return true;
    }

    handleSkillOnMonster(session: any, skillMeta: any): boolean {
        const state = session.afkState;
        if (!state) return false;

        const dir = session.lastSelfShowUser ? session.lastSelfShowUser[4] : 0;
        const dx = dir === 1 ? 1 : dir === 3 ? -1 : 0;
        const dy = dir === 0 ? -1 : dir === 2 ? 1 : 0;
        const targetX = state.shadowX + dx;
        const targetY = state.shadowY + dy;

        const monsters = this.world.getMonstersAt(state.afkMapNumber, targetX, targetY);
        if (monsters.length === 0) return false;

        const monster = monsters[0];
        const ps = this._playerStates.get(session.id);
        if (!ps) return false;

        let damage = 0;
        if (skillMeta.type === 'damage' && skillMeta.basePower > 0) {
            damage = calculatePhysicalDamage({
                attackerStr: ps.shadowStr + session.playerState.level,
                attackerDex: ps.shadowDex,
                attackerLevel: ps.shadowLevel,
                baseDamage: skillMeta.basePower,
                targetAc: monster.getEffectiveAc(),
                targetLevel: monster.level,
            });

            if (calculateCritChance(ps.shadowDex)) {
                damage = Math.floor(damage * 1.5);
            }

            this._applyDamageToMonster(session, monster, damage);
        }

        return true;
    }

    handleAssailOnMonster(session: any): boolean {
        const state = session.afkState;
        if (!state) return false;

        const dir = session.lastSelfShowUser ? session.lastSelfShowUser[4] : 0;
        const dx = dir === 1 ? 1 : dir === 3 ? -1 : 0;
        const dy = dir === 0 ? -1 : dir === 2 ? 1 : 0;
        const targetX = state.shadowX + dx;
        const targetY = state.shadowY + dy;

        const monsters = this.world.getMonstersAt(state.afkMapNumber, targetX, targetY);
        if (monsters.length === 0) return false;

        const monster = monsters[0];
        const ps = this._playerStates.get(session.id);
        if (!ps) return false;

        const damage = calculatePhysicalDamage({
            attackerStr: ps.shadowStr + session.playerState.level,
            attackerDex: ps.shadowDex,
            attackerLevel: ps.shadowLevel,
            baseDamage: 50 + ps.shadowStr * 2,
            targetAc: monster.getEffectiveAc(),
            targetLevel: monster.level,
        });

        this._applyDamageToMonster(session, monster, damage);
        return true;
    }

    // ─── Inventory events ─────────────────────────────────────────

    handlePickup(session: any, x: number, y: number): void {
        const state = session.afkState;
        if (!state) return;

        const instance = this.world.getMapInstance(state.afkMapNumber);
        if (!instance) return;

        for (const [serial, item] of instance.groundItems) {
            if (item.x === x && item.y === y) {
                if (item.isGold) {
                    const inv = this._inventories.get(session.id);
                    const ps = this._playerStates.get(session.id);
                    if (inv && ps) {
                        inv.shadowGold += item.quantity;
                        ps.shadowGold += item.quantity;
                        this._chat(session, `Picked up ${item.quantity} gold.`);
                        this._sendFullStats(session);
                        this._markDirty(session.id);
                    }
                } else {
                    const inv = this._inventories.get(session.id);
                    if (inv) {
                        const template = getItemTemplate(item.templateKey);
                        if (template) {
                            const slot = addItemToShadowInventory(inv, template, item.quantity);
                            if (slot !== null) {
                                if (inv.viewMode === 'shadow') {
                                    const si = inv.shadowItems.get(slot)!;
                                    this._proxy.sendToClient(session, buildAddItemPacket(
                                        slot, si.sprite, si.color, si.name,
                                        si.quantity, si.stackable, si.maxDurability, si.durability
                                    ));
                                }
                                this._markDirty(session.id);
                            } else {
                                this._chat(session, 'Inventory is full.');
                                return;
                            }
                        }
                    }
                }

                // Remove ground item
                instance.groundItems.delete(serial);
                this._broadcastRemoveEntity(state.afkMapNumber, serial);
                return;
            }
        }
    }

    handleUseItem(session: any, slot: number): void {
        if (slot === TOME_SLOT) {
            // Toggle inventory view
            const inv = this._inventories.get(session.id);
            if (inv) {
                toggleInventoryView(
                    (pkt: Packet) => this._proxy.sendToClient(session, pkt),
                    inv
                );
            }
            return;
        }

        const inv = this._inventories.get(session.id);
        if (!inv || inv.viewMode !== 'shadow') return;

        const item = inv.shadowItems.get(slot);
        if (!item) return;

        if (item.template.type === 'consumable') {
            if (item.template.healHp && session.afkState) {
                const psHeal = this._playerStates.get(session.id);
                session.afkState.shadowHp = Math.min(
                    psHeal?.shadowMaxHp ?? 200,
                    session.afkState.shadowHp + item.template.healHp
                );
            }
            if (item.template.healMp && session.afkState) {
                const psHeal = this._playerStates.get(session.id);
                session.afkState.shadowMp = Math.min(
                    psHeal?.shadowMaxMp ?? 100,
                    session.afkState.shadowMp + item.template.healMp
                );
            }

            item.quantity--;
            if (item.quantity <= 0) {
                inv.shadowItems.delete(slot);
                this._proxy.sendToClient(session, buildRemoveItemPacket(slot));
            } else {
                this._proxy.sendToClient(session, buildRemoveItemPacket(slot));
                this._proxy.sendToClient(session, buildAddItemPacket(
                    slot, item.sprite, item.color, item.name,
                    item.quantity, item.stackable, item.maxDurability, item.durability
                ));
            }

            this._sendFullStats(session);
            this._markDirty(session.id);
        }
    }

    handleDropItem(session: any, slot: number): void {
        const inv = this._inventories.get(session.id);
        if (!inv || inv.viewMode !== 'shadow') return;
        if (slot === TOME_SLOT) return; // can't drop the tome

        const item = removeItemFromShadowInventory(inv, slot);
        if (!item) return;

        this._proxy.sendToClient(session, buildRemoveItemPacket(slot));
        this._markDirty(session.id);

        const state = session.afkState;
        if (state) {
            const serial = this._proxy.registry.allocateVirtualSerial();
            const groundItem = new ShadowGroundItem(
                serial, state.shadowX, state.shadowY, state.afkMapNumber,
                item.sprite, item.templateKey, item.name, item.color,
                item.quantity, 60000, session.playerState.serial
            );
            this.world.addGroundItem(state.afkMapNumber, groundItem);
            this._broadcastGroundItemSpawn(state.afkMapNumber, groundItem);
        }
    }

    handleDropGold(session: any, amount: number): void {
        const inv = this._inventories.get(session.id);
        const ps = this._playerStates.get(session.id);
        if (!inv || !ps) return;

        if (amount <= 0 || amount > inv.shadowGold) return;

        inv.shadowGold -= amount;
        ps.shadowGold -= amount;
        this._markDirty(session.id);

        const state = session.afkState;
        if (state) {
            const serial = this._proxy.registry.allocateVirtualSerial();
            const goldItem = new ShadowGroundItem(
                serial, state.shadowX, state.shadowY, state.afkMapNumber,
                0x8000, 'gold', `${amount} Gold`, 0,
                amount, 60000, session.playerState.serial, true
            );
            this.world.addGroundItem(state.afkMapNumber, goldItem);
            this._broadcastGroundItemSpawn(state.afkMapNumber, goldItem);
        }

        this._sendFullStats(session);
    }

    // ─── Stat raise ──────────────────────────────────────────────

    handleRaiseStat(session: any, statId: number): void {
        const ps = this._playerStates.get(session.id);
        if (!ps) return;

        const statMap: Record<number, StatName> = {
            0x01: 'str', 0x02: 'dex', 0x04: 'int', 0x08: 'wis', 0x10: 'con'
        };
        const stat = statMap[statId];
        if (!stat) return;

        if (raiseStat(ps, stat)) {
            this._sendFullStats(session);
            this._markDirty(session.id);
        }
    }

    // ─── Group commands ──────────────────────────────────────────

    handleGroupInvite(session: any, targetName: string): void {
        let targetSession: any = null;
        for (const [, s] of this._proxy.sessions) {
            if (s.destroyed || !s.afkState?.active) continue;
            if (s.characterName?.toLowerCase() === targetName.toLowerCase()) {
                targetSession = s;
                break;
            }
        }

        if (!targetSession) {
            this._chat(session, `${targetName} is not in AFK mode.`);
            return;
        }

        let group = getPlayerGroup(session.id);
        if (!group) {
            group = createGroup(session.id);
        }

        if (addToGroup(group.id, targetSession.id)) {
            this._chat(session, `${targetSession.characterName} joined your group.`);
            this._chat(targetSession, `You joined ${session.characterName}'s group.`);
        } else {
            this._chat(session, 'Could not add player to group.');
        }
    }

    // ─── Warp check ──────────────────────────────────────────────

    checkWarpReactor(session: any): boolean {
        const state = session.afkState;
        if (!state?.active) return false;

        const warp = findWarpAt(state.afkMapNumber, state.shadowX, state.shadowY);
        if (!warp) return false;

        this._proxy.emit('afk:teleportToMap', session,
            warp.targetMapId, warp.targetX, warp.targetY, warp.label);
        return true;
    }

    // ─── Internal: monster damage/death ──────────────────────────

    private _applyDamageToMonster(session: any, monster: ShadowMonster, damage: number): void {
        monster.hp = Math.max(0, monster.hp - damage);
        monster.addThreat(session.playerState.serial, damage);

        if (monster.aiState === 'idle' || monster.aiState === 'wander') {
            monster.aiState = 'chase';
        }

        const hpPercent = (monster.hp / monster.maxHp) * 100;
        this._broadcastHpBar(monster.mapId, monster.serial, hpPercent, 1);

        if (monster.hp <= 0) {
            this._killMonster(session, monster);
        }
    }

    private _killMonster(killerSession: any, monster: ShadowMonster): void {
        monster.alive = false;
        monster.aiState = 'death';
        monster.deathTime = Date.now();

        // Death animation
        this._broadcastAnimation(monster.mapId, monster.serial, BodyAnimation.Death, 0x78, 1);

        // Remove entity after brief delay for animation
        setTimeout(() => {
            this._broadcastRemoveEntity(monster.mapId, monster.serial);
            this.world.removeMonster(monster.mapId, monster.serial);
        }, 1000);

        // Drop loot
        this._dropMonsterLoot(monster, killerSession);

        // Award XP
        this._awardExp(killerSession, monster);

        // Queue respawn
        const template = getMonsterTemplate(monster.templateKey);
        if (template) {
            const respawnId = monster.serial;
            this._pendingRespawns.set(respawnId, {
                template,
                mapId: monster.mapId,
                x: monster.spawnX,
                y: monster.spawnY,
                at: Date.now() + monster.respawnMs,
            });
        }
    }

    private _dropMonsterLoot(monster: ShadowMonster, killerSession: any): void {
        const mapId = monster.mapId;

        // Gold drop
        if (monster.goldDrop.max > 0) {
            const goldAmount = monster.goldDrop.min +
                Math.floor(Math.random() * (monster.goldDrop.max - monster.goldDrop.min + 1));
            if (goldAmount > 0) {
                const serial = this._proxy.registry.allocateVirtualSerial();
                const goldItem = new ShadowGroundItem(
                    serial, monster.x, monster.y, mapId,
                    137, 'gold', `${goldAmount} Gold`, 3,
                    goldAmount, 60000, killerSession.playerState.serial, true
                );
                this.world.addGroundItem(mapId, goldItem);
                this._broadcastGroundItemSpawn(mapId, goldItem);
            }
        }

        // Loot table drops
        if (monster.lootTableKey) {
            const drops = rollLoot(monster.lootTableKey);
            for (const drop of drops) {
                const template = getItemTemplate(drop.templateKey);
                if (!template) continue;

                const serial = this._proxy.registry.allocateVirtualSerial();
                const groundItem = new ShadowGroundItem(
                    serial, monster.x, monster.y, mapId,
                    template.sprite, template.templateKey, template.name, template.color,
                    drop.quantity, 60000, killerSession.playerState.serial
                );
                this.world.addGroundItem(mapId, groundItem);
                this._broadcastGroundItemSpawn(mapId, groundItem);
            }
        }
    }

    private _awardExp(killerSession: any, monster: ShadowMonster): void {
        const expShares = splitExpAmongGroup(
            killerSession.id,
            monster.expReward,
            (sessionId: string) => {
                for (const [, s] of this._proxy.sessions) {
                    if (s.id === sessionId && s.afkState?.active) {
                        return s.afkState.afkMapNumber;
                    }
                }
                return null;
            }
        );

        for (const [sessionId, exp] of expShares) {
            const ps = this._playerStates.get(sessionId);
            if (!ps) continue;

            ps.shadowExp += exp;
            this._markDirty(sessionId);

            let targetSession: any = null;
            for (const [, s] of this._proxy.sessions) {
                if (s.id === sessionId && s.afkState?.active) {
                    targetSession = s;
                    break;
                }
            }

            if (targetSession) {
                this._chat(targetSession, `+${exp} exp (${ps.shadowExp}/${ps.shadowExpToNext})`);

                // Check level up
                const levelUp = checkLevelUp(ps);
                if (levelUp) {
                    ps.shadowMaxHp += levelUp.hpGain;
                    ps.shadowMaxMp += levelUp.mpGain;
                    targetSession.afkState.shadowHp = ps.shadowMaxHp;
                    targetSession.afkState.shadowMp = ps.shadowMaxMp;
                    targetSession.afkState.shadowMaxHp = ps.shadowMaxHp;
                    targetSession.afkState.shadowMaxMp = ps.shadowMaxMp;

                    this._chat(targetSession, `Level up! You are now level ${levelUp.newLevel}! (+${levelUp.hpGain} HP, +${levelUp.mpGain} MP, +${levelUp.statPoints} stat points)`);

                    // Level-up effect animation
                    this._broadcastShowEffect(
                        targetSession.afkState.afkMapNumber,
                        targetSession.playerState.serial,
                        targetSession.playerState.serial,
                        232
                    );

                    this._sendFullStats(targetSession);
                }
            }
        }
    }

    // ─── Internal: monster AI tick ────────────────────────────────

    private _onMonsterTick(mapId: number, monster: ShadowMonster): void {
        const callbacks: AiCallbacks = {
            getPlayersOnMap: (mid: number) => this._getAfkPlayersOnMap(mid),
            isWalkable: (mid: number, x: number, y: number) => this._isWalkable(mid, x, y),
            isOccupied: (mid: number, x: number, y: number) => this._isOccupied(mid, x, y),
            onMonsterMove: (m, prevX, prevY, dir) => this._broadcastMonsterMove(m, prevX, prevY, dir),
            onMonsterTurn: (m, dir) => this._broadcastMonsterTurn(m, dir),
            onMonsterAssail: (m, target) => this._monsterAssailPlayer(m, target),
            onMonsterCast: (m, target, spell) => this._monsterCastAtPlayer(m, target, spell),
            onMonsterUseSkill: (m, target, skill) => this._monsterUseSkillOnPlayer(m, target, skill),
        };

        updateMonsterAi(monster, callbacks);
    }

    private _monsterAssailPlayer(monster: ShadowMonster, target: AiTarget): void {
        const session = this._findSessionBySerial(target.serial);
        if (!session || !session.afkState?.active) return;

        const damage = calculateMonsterAssailDamage(
            monster.stats.str, monster.level,
            100 // player base AC
        );

        this._broadcastAnimation(monster.mapId, monster.serial, BodyAnimation.Assail, 0x14, 1);
        this._applyDamageToPlayer(session, damage);
    }

    private _monsterCastAtPlayer(monster: ShadowMonster, target: AiTarget, spellName: string): void {
        const session = this._findSessionBySerial(target.serial);
        if (!session || !session.afkState?.active) return;

        const damage = calculateMagicalDamage({
            attackerInt: monster.stats.int,
            attackerLevel: monster.level,
            basePower: 100 + monster.level * 10,
        });

        this._broadcastAnimation(monster.mapId, monster.serial, BodyAnimation.WizardCast, 0x28, 0);
        this._broadcastShowEffect(monster.mapId, target.serial, monster.serial, 234);
        this._applyDamageToPlayer(session, damage);
    }

    private _monsterUseSkillOnPlayer(monster: ShadowMonster, target: AiTarget, skillName: string): void {
        const session = this._findSessionBySerial(target.serial);
        if (!session || !session.afkState?.active) return;

        const damage = calculatePhysicalDamage({
            attackerStr: monster.stats.str,
            attackerDex: monster.stats.dex,
            attackerLevel: monster.level,
            baseDamage: 200 + monster.level * 5,
            targetAc: 100,
            targetLevel: session.playerState.level,
        });

        this._broadcastAnimation(monster.mapId, monster.serial, BodyAnimation.TwoHandAtk, 0x14, 1);
        this._applyDamageToPlayer(session, damage);
    }

    private _applyDamageToPlayer(session: any, damage: number): void {
        if (!session.afkState) return;

        session.afkState.shadowHp = Math.max(0, session.afkState.shadowHp - damage);
        const ps = this._playerStates.get(session.id);
        const maxHp = ps?.shadowMaxHp ?? 200;
        const hpPercent = (session.afkState.shadowHp / maxHp) * 100;

        this._broadcastHpBar(session.afkState.afkMapNumber, session.playerState.serial, hpPercent, 1);
        this._sendStatsUpdate(session);

        if (session.afkState.shadowHp <= 0) {
            this._playerDeath(session);
        }
    }

    private _playerDeath(session: any): void {
        const state = session.afkState;
        if (!state) return;

        // Death animation
        this._broadcastAnimation(state.afkMapNumber, session.playerState.serial, BodyAnimation.Death, 0x78, 1);

        this._chat(session, 'You have died! Respawning...');

        // Remove monster aggro on this player
        const instance = this.world.getMapInstance(state.afkMapNumber);
        if (instance) {
            for (const monster of instance.monsters.values()) {
                monster.removeThreat(session.playerState.serial);
            }
        }

        // Respawn after 3 seconds
        setTimeout(() => {
            if (!session.afkState?.active) return;

            // Get the map's spawn point, or use default config
            const mapCfg = getMapConfig(state.afkMapNumber);
            const spawnX = mapCfg?.spawnX ?? this._config.spawnX;
            const spawnY = mapCfg?.spawnY ?? this._config.spawnY;

            const ps = this._playerStates.get(session.id);
            state.shadowHp = ps?.shadowMaxHp ?? 200;
            state.shadowMp = ps?.shadowMaxMp ?? 100;
            state.shadowX = spawnX;
            state.shadowY = spawnY;

            // Teleport to spawn
            const posPacket = new Packet(0x04);
            posPacket.writeUInt16(spawnX);
            posPacket.writeUInt16(spawnY);
            this._proxy.sendToClient(session, posPacket);

            if (session.lastSelfShowUser) {
                const showPkt = new Packet(0x33);
                showPkt.body = [...session.lastSelfShowUser];
                showPkt.body[0] = (spawnX >> 8) & 0xFF;
                showPkt.body[1] = spawnX & 0xFF;
                showPkt.body[2] = (spawnY >> 8) & 0xFF;
                showPkt.body[3] = spawnY & 0xFF;
                this._proxy.sendToClient(session, showPkt);
            }

            this._sendStatsUpdate(session);
            this._sendFullStats(session);
            this._chat(session, 'You have been revived.');
        }, 3000);
    }

    // ─── Internal: effect ticks ──────────────────────────────────

    private _onEffectTick(creature: ShadowCreature, effect: ActiveEffect): void {
        if (effect.periodicDamage && effect.periodicDamage > 0) {
            creature.hp = Math.max(0, creature.hp - effect.periodicDamage);
            if (effect.effectAnimation) {
                this._broadcastShowEffect(creature.mapId, creature.serial, creature.serial, effect.effectAnimation);
            }
        }
        if (effect.periodicHeal && effect.periodicHeal > 0) {
            creature.hp = Math.min(creature.maxHp, creature.hp + effect.periodicHeal);
        }
    }

    private _onEffectExpire(creature: ShadowCreature, effect: ActiveEffect): void {
        // The effect has already been removed from creature.effects
    }

    // ─── Internal: ground item despawn ───────────────────────────

    private _onGroundItemDespawn(mapId: number, item: ShadowGroundItem): void {
        this._broadcastRemoveEntity(mapId, item.serial);
    }

    // ─── Internal: respawn processing ────────────────────────────

    private _processRespawns(): void {
        const now = Date.now();
        for (const [id, respawn] of this._pendingRespawns) {
            if (now >= respawn.at) {
                this._pendingRespawns.delete(id);
                this.spawner.respawnMonster(respawn.mapId, respawn.template, respawn.x, respawn.y);
            }
        }
    }

    // ─── Internal: packet broadcasting ───────────────────────────

    private _broadcastMonsterSpawn(mapId: number, monster: ShadowMonster): void {
        for (const [, session] of this._proxy.sessions) {
            if (session.destroyed || !session.afkState?.active) continue;
            if (session.afkState.afkMapNumber !== mapId) continue;

            if (this._inViewRange(session, monster.x, monster.y)) {
                this._sendAddCreature(session, monster);
            }
        }
    }

    private _broadcastMonsterMove(monster: ShadowMonster, prevX: number, prevY: number, direction: number): void {
        for (const [, session] of this._proxy.sessions) {
            if (session.destroyed || !session.afkState?.active) continue;
            if (session.afkState.afkMapNumber !== monster.mapId) continue;

            const wasVisible = this._inViewRange(session, prevX, prevY);
            const isVisible = this._inViewRange(session, monster.x, monster.y);

            if (isVisible && wasVisible) {
                const pkt = new Packet(0x0C);
                pkt.writeUInt32(monster.serial);
                pkt.writeUInt16(prevX);
                pkt.writeUInt16(prevY);
                pkt.writeByte(direction);
                pkt.writeByte(0); // trailing padding
                this._proxy.sendToClient(session, pkt);
            } else if (isVisible && !wasVisible) {
                this._sendAddCreature(session, monster);
            } else if (!isVisible && wasVisible) {
                this._sendRemoveEntity(session, monster.serial);
            }
        }
    }

    private _broadcastMonsterTurn(monster: ShadowMonster, direction: number): void {
        for (const [, session] of this._proxy.sessions) {
            if (session.destroyed || !session.afkState?.active) continue;
            if (session.afkState.afkMapNumber !== monster.mapId) continue;
            if (!this._inViewRange(session, monster.x, monster.y)) continue;

            const pkt = new Packet(0x11);
            pkt.writeUInt32(monster.serial);
            pkt.writeByte(direction);
            this._proxy.sendToClient(session, pkt);
        }
    }

    private _broadcastGroundItemSpawn(mapId: number, item: ShadowGroundItem): void {
        for (const [, session] of this._proxy.sessions) {
            if (session.destroyed || !session.afkState?.active) continue;
            if (session.afkState.afkMapNumber !== mapId) continue;
            if (!this._inViewRange(session, item.x, item.y)) continue;

            this._sendAddGroundItem(session, item);
        }
    }

    private _broadcastRemoveEntity(mapId: number, serial: number): void {
        for (const [, session] of this._proxy.sessions) {
            if (session.destroyed || !session.afkState?.active) continue;
            if (session.afkState.afkMapNumber !== mapId) continue;

            this._sendRemoveEntity(session, serial);
        }
    }

    private _broadcastAnimation(mapId: number, serial: number, animation: number, speed: number, sound: number): void {
        for (const [, session] of this._proxy.sessions) {
            if (session.destroyed || !session.afkState?.active) continue;
            if (session.afkState.afkMapNumber !== mapId) continue;
            if (!this._inViewRange(session, this._getEntityX(serial, mapId), this._getEntityY(serial, mapId))) continue;

            const pkt = new Packet(0x1A);
            pkt.writeUInt32(serial);
            pkt.writeByte(animation);
            pkt.writeUInt16(speed); // animationSpeed as UInt16
            pkt.writeByte(sound === 0 ? 0xFF : sound); // 0xFF = no sound
            this._proxy.sendToClient(session, pkt);
        }
    }

    private _broadcastShowEffect(mapId: number, targetId: number, sourceId: number, animation: number): void {
        for (const [, session] of this._proxy.sessions) {
            if (session.destroyed || !session.afkState?.active) continue;
            if (session.afkState.afkMapNumber !== mapId) continue;
            if (!this._inViewRange(session, this._getEntityX(sourceId, mapId), this._getEntityY(sourceId, mapId))) continue;

            const pkt = new Packet(0x29);
            pkt.writeUInt32(targetId);
            pkt.writeUInt32(sourceId);
            pkt.writeUInt16(animation); // targetAnimation
            pkt.writeUInt16(0);         // sourceAnimation
            pkt.writeUInt16(100);       // animationSpeed
            this._proxy.sendToClient(session, pkt);
        }
    }

    private _broadcastHpBar(mapId: number, serial: number, hpPercent: number, sound: number): void {
        for (const [, session] of this._proxy.sessions) {
            if (session.destroyed || !session.afkState?.active) continue;
            if (session.afkState.afkMapNumber !== mapId) continue;
            if (!this._inViewRange(session, this._getEntityX(serial, mapId), this._getEntityY(serial, mapId))) continue;

            const pkt = new Packet(0x13);
            pkt.writeUInt32(serial);
            pkt.writeByte(0); // padding byte per Chaos-Server HealthBarConverter
            pkt.writeByte(Math.max(0, Math.min(100, Math.floor(hpPercent))));
            pkt.writeByte(sound === 0 ? 0xFF : sound); // 0xFF = no sound
            this._proxy.sendToClient(session, pkt);
        }
    }

    // ─── Internal: entity packets ────────────────────────────────

    private _sendAddCreature(session: any, monster: ShadowMonster): void {
        const pkt = new Packet(0x07);
        pkt.writeUInt16(1); // entity count
        pkt.writeUInt16(monster.x);
        pkt.writeUInt16(monster.y);
        pkt.writeUInt32(monster.serial);
        pkt.writeUInt16(monster.sprite + 0x4000); // sprite + CREATURE_SPRITE_OFFSET
        pkt.writeUInt32(0); // 4-byte padding
        pkt.writeByte(monster.direction);
        pkt.writeByte(0); // padding
        pkt.writeByte(0); // CreatureType.Normal — no name written for non-Merchant
        this._proxy.sendToClient(session, pkt);
    }

    private _sendAddGroundItem(session: any, item: ShadowGroundItem): void {
        const pkt = new Packet(0x07);
        pkt.writeUInt16(1); // entity count
        pkt.writeUInt16(item.x);
        pkt.writeUInt16(item.y);
        pkt.writeUInt32(item.serial);
        pkt.writeUInt16(item.sprite + 0x8000); // sprite + ITEM_SPRITE_OFFSET
        pkt.writeByte(item.color);
        pkt.writeByte(0); // 2-byte padding
        pkt.writeByte(0);
        this._proxy.sendToClient(session, pkt);
    }

    private _sendRemoveEntity(session: any, serial: number): void {
        const pkt = new Packet(0x0E);
        pkt.writeUInt32(serial);
        this._proxy.sendToClient(session, pkt);
    }

    private _sendShadowSkillBar(session: any): void {
        // Slot 1: Assail (melee attack)
        const assail = new Packet(0x2C);
        assail.writeByte(1);       // slot
        assail.writeUInt16(1);     // icon (sword icon)
        assail.writeString8('Assail');
        this._proxy.sendToClient(session, assail);
    }

    private _sendStatsUpdate(session: any): void {
        const afk = session.afkState;
        if (!afk) return;

        const ps = this._playerStates.get(session.id);
        const maxHp = ps?.shadowMaxHp ?? afk.shadowHp;
        const maxMp = ps?.shadowMaxMp ?? afk.shadowMp;

        // Cap current HP/MP to shadow max
        afk.shadowHp = Math.min(afk.shadowHp, maxHp);
        afk.shadowMp = Math.min(afk.shadowMp, maxMp);

        // Vitality update (flag 0x10): currentHp + currentMp
        const pkt = new Packet(0x08);
        pkt.writeByte(0x10); // StatUpdateType.Vitality
        pkt.writeUInt32(afk.shadowHp);
        pkt.writeUInt32(afk.shadowMp);
        this._proxy.sendToClient(session, pkt);
    }

    private _sendFullStats(session: any): void {
        const afk = session.afkState;
        if (!afk) return;

        const ps = this._playerStates.get(session.id);
        if (!ps) {
            this._sendStatsUpdate(session);
            return;
        }

        // Cap current HP/MP to shadow max
        afk.shadowHp = Math.min(afk.shadowHp, ps.shadowMaxHp);
        afk.shadowMp = Math.min(afk.shadowMp, ps.shadowMaxMp);

        // Primary (0x20) + Vitality (0x10) + ExpGold (0x08) = 0x38
        const pkt = new Packet(0x08);
        pkt.writeByte(0x38);

        // --- Primary section (0x20) ---
        pkt.writeByte(1);  // 3-byte preamble {1, 0, 0}
        pkt.writeByte(0);
        pkt.writeByte(0);
        pkt.writeByte(ps.shadowLevel);    // level
        pkt.writeByte(0);                 // ability
        pkt.writeUInt32(ps.shadowMaxHp);  // maxHp
        pkt.writeUInt32(ps.shadowMaxMp);  // maxMp
        pkt.writeByte(ps.shadowStr);      // str
        pkt.writeByte(ps.shadowInt);      // int
        pkt.writeByte(ps.shadowWis);      // wis
        pkt.writeByte(ps.shadowCon);      // con
        pkt.writeByte(ps.shadowDex);      // dex
        pkt.writeByte(ps.availableStatPoints > 0 ? 1 : 0); // hasUnspentPoints
        pkt.writeByte(ps.availableStatPoints);              // unspentPoints
        pkt.writeInt16(50);               // maxWeight
        pkt.writeInt16(0);                // currentWeight
        pkt.writeUInt32(0);               // 4-byte tail padding

        // --- Vitality section (0x10) ---
        pkt.writeUInt32(afk.shadowHp);    // currentHp
        pkt.writeUInt32(afk.shadowMp);    // currentMp

        // --- ExpGold section (0x08) ---
        pkt.writeUInt32(ps.shadowExp);        // totalExp
        pkt.writeUInt32(ps.shadowExpToNext);  // toNextLevel
        pkt.writeUInt32(0);                   // totalAbility
        pkt.writeUInt32(0);                   // toNextAbility
        pkt.writeUInt32(0);                   // gamePoints
        pkt.writeUInt32(ps.shadowGold);       // gold

        this._proxy.sendToClient(session, pkt);
    }

    /**
     * Send real playerState stats to the client on AFK exit.
     * Overwrites the shadow stat display so the client shows correct HP/MP
     * before the server refresh response arrives.
     */
    private _restoreRealStats(session: any): void {
        const ps = session.playerState;
        if (!ps) return;

        // Primary (0x20) + Vitality (0x10) = 0x30
        const pkt = new Packet(0x08);
        pkt.writeByte(0x30);

        // --- Primary section (0x20) ---
        pkt.writeByte(1);  // 3-byte preamble {1, 0, 0}
        pkt.writeByte(0);
        pkt.writeByte(0);
        pkt.writeByte(ps.level);      // level
        pkt.writeByte(0);             // ability
        pkt.writeUInt32(ps.maxHp);    // maxHp
        pkt.writeUInt32(ps.maxMp);    // maxMp
        pkt.writeByte(0);             // str (not tracked — server refresh will fill in)
        pkt.writeByte(0);             // int
        pkt.writeByte(0);             // wis
        pkt.writeByte(0);             // con
        pkt.writeByte(0);             // dex
        pkt.writeByte(0);             // hasUnspentPoints
        pkt.writeByte(0);             // unspentPoints
        pkt.writeInt16(0);            // maxWeight
        pkt.writeInt16(0);            // currentWeight
        pkt.writeUInt32(0);           // 4-byte tail padding

        // --- Vitality section (0x10) ---
        pkt.writeUInt32(ps.hp);       // currentHp
        pkt.writeUInt32(ps.mp);       // currentMp

        this._proxy.sendToClient(session, pkt);
    }

    // ─── Internal: send existing entities ────────────────────────

    private _sendExistingEntities(session: any, mapId: number): void {
        const instance = this.world.getMapInstance(mapId);
        if (!instance) return;

        for (const monster of instance.monsters.values()) {
            if (!monster.alive) continue;
            if (this._inViewRange(session, monster.x, monster.y)) {
                this._sendAddCreature(session, monster);
            }
        }

        for (const item of instance.groundItems.values()) {
            if (this._inViewRange(session, item.x, item.y)) {
                this._sendAddGroundItem(session, item);
            }
        }
    }

    // ─── Internal: map initialization ────────────────────────────

    private _initializeMapInstances(): void {
        for (const [mapId, config] of getAllMapConfigs()) {
            this.world.getOrCreateMapInstance(
                mapId, config.name,
                config.width ?? 70,
                config.height ?? 70
            );
        }

        // Always ensure the default AFK map exists
        this.world.getOrCreateMapInstance(
            this._config.afkMapNumber,
            'Shadow Realm',
            70, 70
        );
    }

    // ─── Internal: helpers ───────────────────────────────────────

    private _getAfkPlayersOnMap(mapId: number): AiTarget[] {
        const targets: AiTarget[] = [];
        for (const [, session] of this._proxy.sessions) {
            if (session.destroyed || !session.afkState?.active) continue;
            if (session.afkState.afkMapNumber !== mapId) continue;
            targets.push({
                serial: session.playerState.serial,
                x: session.afkState.shadowX,
                y: session.afkState.shadowY,
                mapId,
            });
        }
        return targets;
    }

    private _isWalkable(mapId: number, x: number, y: number): boolean {
        try {
            const collision = this._automation.getCollision();
            return collision.isWalkable(mapId, x, y);
        } catch {
            return true;
        }
    }

    private _isOccupied(mapId: number, x: number, y: number): boolean {
        if (this.world.isOccupiedByMonster(mapId, x, y)) return true;

        for (const [, session] of this._proxy.sessions) {
            if (session.destroyed || !session.afkState?.active) continue;
            if (session.afkState.afkMapNumber !== mapId) continue;
            if (session.afkState.shadowX === x && session.afkState.shadowY === y) return true;
        }
        return false;
    }

    private _inViewRange(session: any, x: number, y: number): boolean {
        if (!session.afkState) return false;
        return Math.abs(session.afkState.shadowX - x) < VIEW_RANGE &&
               Math.abs(session.afkState.shadowY - y) < VIEW_RANGE;
    }

    private _getEntityX(serial: number, mapId: number): number {
        const monster = this.world.getMonsterBySerial(serial);
        if (monster) return monster.x;
        const session = this._findSessionBySerial(serial);
        if (session?.afkState) return session.afkState.shadowX;
        return 0;
    }

    private _getEntityY(serial: number, mapId: number): number {
        const monster = this.world.getMonsterBySerial(serial);
        if (monster) return monster.y;
        const session = this._findSessionBySerial(serial);
        if (session?.afkState) return session.afkState.shadowY;
        return 0;
    }

    private _findSessionBySerial(serial: number): any | undefined {
        for (const [, s] of this._proxy.sessions) {
            if (s.destroyed || !s.afkState?.active) continue;
            if (s.playerState.serial === serial) return s;
        }
        return undefined;
    }

    private _chat(session: any, message: string): void {
        this._augmentation.chat.systemMessage(session, message);
    }

    // ─── Persistence ─────────────────────────────────────────────

    private _markDirty(sessionId: string): void {
        this._dirtyPlayers.add(sessionId);
    }

    private _savePlayerProgress(sessionId: string, charName: string): void {
        const ps = this._playerStates.get(sessionId);
        const inv = this._inventories.get(sessionId);
        if (!ps) return;

        const statsJson = shadowStatsToJSON(ps);
        const itemsArr = inv ? serializeShadowItems(inv.shadowItems) : [];
        const spellsArr = inv ? serializeSpellsSnapshot(inv.realSpellsSnapshot) : [];
        const skillsArr = inv ? serializeSkillsSnapshot(inv.realSkillsSnapshot) : [];

        db.saveAfkProgress(charName, statsJson).then(() => {
            return db.saveAfkInventory(charName, itemsArr);
        }).then(() => {
            return db.saveAfkSpellsAndSkills(charName, spellsArr, skillsArr);
        }).catch((err) => {
            console.error(`[AfkEngine] Failed to save progress for ${charName}:`, err);
        });
    }

    private _flushDirtyPlayers(): void {
        if (this._dirtyPlayers.size === 0) return;

        for (const sessionId of this._dirtyPlayers) {
            const charName = this._sessionCharMap.get(sessionId);
            if (!charName) continue;
            this._savePlayerProgress(sessionId, charName);
        }

        this._dirtyPlayers.clear();
    }

    // ─── Event registration ──────────────────────────────────────

    private _registerEvents(): void {
        // Walk warp check — listen for walk events to trigger warp reactors
        this._proxy.on('afk:walk:complete', (session: any) => {
            this.checkWarpReactor(session);
        });

        // Pickup event
        this._proxy.on('afk:pickup', (session: any, x: number, y: number) => {
            this.handlePickup(session, x, y);
        });

        // UseItem event
        this._proxy.on('afk:useItem', (session: any, slot: number) => {
            this.handleUseItem(session, slot);
        });

        // DropItem event
        this._proxy.on('afk:dropItem', (session: any, slot: number) => {
            this.handleDropItem(session, slot);
        });

        // DropGold event
        this._proxy.on('afk:dropGold', (session: any, amount: number) => {
            this.handleDropGold(session, amount);
        });

        // RaiseStat event
        this._proxy.on('afk:raiseStat', (session: any, statId: number) => {
            this.handleRaiseStat(session, statId);
        });

        // Group invite
        this._proxy.on('afk:groupInvite', (session: any, name: string) => {
            this.handleGroupInvite(session, name);
        });
    }

    // ─── Monster viewport updates after player walk ──────────────

    updateMonsterViewportForPlayer(session: any): void {
        // No-op: monsters are sent on spawn via _broadcastMonsterSpawn and
        // movements via _broadcastMonsterMove. The initial set is sent via
        // _sendExistingEntities on enter/mapChange. No per-walk refresh needed.
    }
}
