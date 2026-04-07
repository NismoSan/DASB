"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_HEAL_CONFIG = void 0;
const packet_1 = __importDefault(require("../../core/packet"));
const buff_tracker_1 = require("./buff-tracker");
const humanizer_1 = __importDefault(require("./humanizer"));
exports.DEFAULT_HEAL_CONFIG = {
    enabled: true,
    hpPotionThreshold: 70,
    hpPotionPriority: [
        'Red Extonic', 'Hydele deum', 'Brown Potion', 'Exkuranum',
        'Rambutan', 'Red Tonic', 'Green Extonic', 'Chicken', 'Beef', 'Apple',
    ],
    mpPotionThreshold: 50,
    mpPotionPriority: [
        'Blue Extonic', 'Blue Hitonic', 'Green Extonic', 'Blue Tonic',
    ],
    healSpells: ['ard ioc', 'mor ioc', 'ioc'],
    hpSpellThreshold: 80,
    mpRecoverySpell: undefined,
    mpRecoveryThreshold: 15,
    selfBuffs: [],
    counterAttack: false,
    druidForm: false,
    selfHide: false,
    aoCursesSelf: true,
    aoSuainSelf: true,
    aoPuinseinSelf: true,
    dionEnabled: false,
    dionType: 'dion',
    dionEnemyThreshold: 5,
    dionHpThreshold: 30,
    dionAoSith: false,
    groupHeal: false,
    groupHealSpells: ['ard ioc comlha', 'mor ioc comlha'],
    groupHpThreshold: 60,
    groupBuffs: [],
    reactDelay: [50, 250],
    pollIntervalMs: 200,
    consumeBuffItems: false,
    destroyTonics: false,
};
/** Item cooldown tracking (from Slowpoke). */
const ITEM_COOLDOWNS = {
    'Lucky Clover': 0, // one-time
    'Golden Starfish': 0, // one-time
    'Bonus Item': 5000,
    'Gem': 30000,
    'Sprint Potion': 16000,
    'Grime Scent': 11000,
    'Damage Scroll': 31000,
    'Combo Scroll': 121000,
    'default': 325,
};
/**
 * Automated heal engine — item-first, spell-second, runs as interrupt throughout combat.
 *
 * Priority chain (from Slowpoke's Heal() method):
 * 1. Emergency MP: fas spiorad if MP below threshold
 * 2. HP potions when HP% <= threshold
 * 3. MP potions when MP% <= threshold
 * 4. Heal spells: ard ioc / mor ioc / ioc based on deficit
 * 5. Self-buff maintenance (aite, fas, counter attack, etc.)
 * 6. Ao cures (remove curses, suain, poison from self)
 * 7. Dion emergency
 */
class HealEngine {
    proxy;
    session;
    caster;
    buffs;
    humanizer;
    config;
    lastItemUse = new Map();
    pollTimer = null;
    constructor(proxy, session, caster, buffs, config) {
        this.proxy = proxy;
        this.session = session;
        this.caster = caster;
        this.buffs = buffs;
        this.config = { ...exports.DEFAULT_HEAL_CONFIG, ...config };
        this.humanizer = new humanizer_1.default({ reactDelay: this.config.reactDelay });
    }
    /** Start passive heal monitoring (runs on an interval). */
    startMonitor() {
        if (this.pollTimer)
            return;
        this.pollTimer = setInterval(() => {
            if (this.config.enabled) {
                this.healCycle().catch(() => { });
            }
        }, this.config.pollIntervalMs);
    }
    /** Stop passive heal monitoring. */
    stopMonitor() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }
    /**
     * Run a single heal cycle. Returns true if healing was performed
     * (combat engine should restart its loop).
     */
    async healCycle() {
        if (!this.config.enabled)
            return false;
        const ps = this.session.playerState;
        const hpPercent = ps.maxHp > 0 ? (ps.hp / ps.maxHp) * 100 : 100;
        const mpPercent = ps.maxMp > 0 ? (ps.mp / ps.maxMp) * 100 : 100;
        let acted = false;
        // 1. Emergency MP recovery
        if (mpPercent < this.config.mpRecoveryThreshold && this.config.mpRecoverySpell) {
            if (this.caster.castSpell(this.config.mpRecoverySpell)) {
                await this.humanizer.sleep(this.humanizer.castDelay(this.config.mpRecoverySpell));
                return true;
            }
        }
        // 2. HP Potions
        if (hpPercent <= this.config.hpPotionThreshold) {
            if (await this.tryUsePotion(this.config.hpPotionPriority)) {
                acted = true;
            }
        }
        // 3. MP Potions
        if (mpPercent <= this.config.mpPotionThreshold) {
            if (await this.tryUsePotion(this.config.mpPotionPriority)) {
                acted = true;
            }
        }
        // 4. Heal Spells
        if (hpPercent <= this.config.hpSpellThreshold) {
            for (const spell of this.config.healSpells) {
                if (this.caster.castSpell(spell)) {
                    await this.humanizer.sleep(this.humanizer.castDelay(spell));
                    return true;
                }
            }
        }
        // 5. Self-buff maintenance
        acted = await this.maintainSelfBuffs() || acted;
        // 6. Ao cures
        acted = await this.aoCures() || acted;
        // 7. Dion emergency
        if (this.config.dionEnabled) {
            acted = await this.checkDionEmergency(hpPercent) || acted;
        }
        return acted;
    }
    // ─── Potions ────────────────────────────────────────────
    async tryUsePotion(priority) {
        for (const potionName of priority) {
            const slot = this.findInventoryItem(potionName);
            if (slot !== undefined) {
                if (this.isItemOnCooldown(potionName))
                    continue;
                this.useItemBySlot(slot);
                this.lastItemUse.set(potionName.toLowerCase(), Date.now());
                await this.humanizer.sleep(this.humanizer.reactDelay());
                return true;
            }
        }
        return false;
    }
    findInventoryItem(name) {
        const lower = name.toLowerCase();
        for (const [slot, item] of this.session.playerState.inventory) {
            if (item.name.toLowerCase().includes(lower)) {
                return slot;
            }
        }
        return undefined;
    }
    isItemOnCooldown(name) {
        const lastUse = this.lastItemUse.get(name.toLowerCase());
        if (!lastUse)
            return false;
        const cooldown = ITEM_COOLDOWNS[name] ?? ITEM_COOLDOWNS['default'];
        return Date.now() - lastUse < cooldown;
    }
    useItemBySlot(slot) {
        const pkt = new packet_1.default(0x1C);
        pkt.writeByte(slot);
        this.proxy.sendToServer(this.session, pkt);
    }
    // ─── Self Buffs ─────────────────────────────────────────
    async maintainSelfBuffs() {
        let acted = false;
        for (const buff of this.config.selfBuffs) {
            if (!this.buffs.hasSpellBarEffect(buff.icon)) {
                if (this.caster.castSpell(buff.spell)) {
                    await this.humanizer.sleep(this.humanizer.castDelay(buff.spell));
                    acted = true;
                }
            }
        }
        // Counter Attack
        if (this.config.counterAttack && !this.buffs.hasSelfCounterAttack()) {
            if (this.caster.castSpell('counter attack')) {
                await this.humanizer.sleep(this.humanizer.castDelay('counter attack'));
                acted = true;
            }
        }
        return acted;
    }
    // ─── Ao Cures ───────────────────────────────────────────
    async aoCures() {
        let acted = false;
        // Remove cradh from self
        if (this.config.aoCursesSelf && this.buffs.hasSelfCradh()) {
            // Try highest tier ao curse first
            const aoCurses = ['ao ard cradh', 'ao mor cradh', 'ao cradh', 'ao beag cradh'];
            for (const spell of aoCurses) {
                if (this.caster.castSpell(spell)) {
                    await this.humanizer.sleep(this.humanizer.castDelay(spell));
                    acted = true;
                    break;
                }
            }
        }
        // Remove suain
        if (this.config.aoSuainSelf) {
            // Check for suain/status icons on spell bar
            if (this.buffs.hasSpellBarEffect(buff_tracker_1.SPELL_BAR_ICONS.STATUS_1) ||
                this.buffs.hasSpellBarEffect(buff_tracker_1.SPELL_BAR_ICONS.STATUS_2)) {
                if (this.caster.castSpell('ao suain')) {
                    await this.humanizer.sleep(this.humanizer.castDelay('ao suain'));
                    acted = true;
                }
            }
        }
        // Remove poison
        if (this.config.aoPuinseinSelf && this.buffs.hasSelfPoison()) {
            if (this.caster.castSpell('ao puinsein')) {
                await this.humanizer.sleep(this.humanizer.castDelay('ao puinsein'));
                acted = true;
            }
        }
        return acted;
    }
    // ─── Dion Emergency ─────────────────────────────────────
    async checkDionEmergency(hpPercent) {
        // Already have dion
        if (this.buffs.hasSelfDion())
            return false;
        let trigger = false;
        // HP threshold
        if (hpPercent <= this.config.dionHpThreshold) {
            trigger = true;
        }
        // Enemy count threshold
        if (!trigger && this.config.dionEnemyThreshold > 0) {
            const monsters = this.getVisibleMonsterCount();
            if (monsters >= this.config.dionEnemyThreshold) {
                trigger = true;
            }
        }
        if (trigger) {
            if (this.caster.castSpell(this.config.dionType)) {
                await this.humanizer.sleep(this.humanizer.castDelay(this.config.dionType));
                // Ao Sith after dion
                if (this.config.dionAoSith) {
                    this.caster.castSpell('ao sith');
                    await this.humanizer.sleep(300);
                }
                return true;
            }
        }
        return false;
    }
    getVisibleMonsterCount() {
        const entities = this.session.playerState;
        // Use a rough count from the registry — not ideal but functional
        // This would be improved with direct access to the registry
        return 0; // Placeholder — will be wired through registry
    }
    // ─── Cleanup ────────────────────────────────────────────
    destroy() {
        this.stopMonitor();
    }
}
exports.default = HealEngine;
//# sourceMappingURL=heal-engine.js.map