"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_GRIND_CONFIG = void 0;
const packet_1 = __importDefault(require("../../core/packet"));
const target_selector_1 = __importDefault(require("./target-selector"));
const humanizer_1 = __importDefault(require("./humanizer"));
exports.DEFAULT_GRIND_CONFIG = {
    targetMode: 'nearest',
    clusterMode: false,
    clusterRadius: 3,
    monsterConfigs: new Map(),
    imageExcludeList: new Set(),
    nameIgnoreList: new Set(),
    primaryAttack: '',
    secondaryAttack: undefined,
    secondaryCooldownMs: 10000,
    curse: undefined,
    fasSpell: undefined,
    pramhSpell: undefined,
    pramhSpam: false,
    attackAfterPramh: true,
    pramhOnly: false,
    pramhBeforeCurse: false,
    curseMode: 'currentOnly',
    fasamancrystals: false,
    assailEnabled: true,
    assailBetweenSpells: true,
    useAmbush: false,
    useCrash: false,
    insectAssail: false,
    skillCombos: [],
    engagementMode: 'noLure',
    attackRange: 1,
    minMpPercent: 10,
    castCooldownMs: 800,
    halfCast: false,
    newTargetDelay: [200, 600],
    switchTargetDelay: [100, 400],
    mobSize: 3,
    mobDistance: 3,
    noLongerMobbedDelay: 2000,
    onlyInGroup: false,
    minGroupSize: 1,
    onlyLargestGroup: false,
    onlyWithDebuff: undefined,
    walkSpeed: 275,
    fastwalk: false,
    walkCloseByOnly: false,
    haltWalkNonFriends: false,
};
/**
 * Automated combat engine implementing Slowpoke's spell priority chain.
 *
 * Priority order per cycle:
 * 1. Heal check (delegates to HealEngine if wired)
 * 2. Secondary attack (Cursed Tune) with cooldown
 * 3. Per-monster custom targeting
 * 4. Pramh/stun-lock on best cluster
 * 5. Fas/Cradh curse phase
 * 6. Primary attack
 * 7. Assail/melee between spell cooldowns
 *
 * After EACH phase: heal check + check if target died → next target.
 */
class CombatEngine {
    proxy;
    session;
    registry;
    caster;
    buffs;
    targetSelector;
    humanizer;
    config;
    stats;
    running = false;
    abortController = null;
    currentTarget = null;
    lastSecondaryCast = 0;
    lastAssailTime = 0;
    /** External heal check — set by HealEngine when wired. */
    healCheck = null;
    constructor(proxy, session, registry, caster, buffs, config) {
        this.proxy = proxy;
        this.session = session;
        this.registry = registry;
        this.caster = caster;
        this.buffs = buffs;
        this.config = { ...exports.DEFAULT_GRIND_CONFIG, ...config };
        this.targetSelector = new target_selector_1.default({
            mode: this.config.targetMode,
            maxRange: this.config.attackRange > 1 ? 12 : this.config.attackRange,
            imageExcludeList: this.config.imageExcludeList,
            nameIgnoreList: this.config.nameIgnoreList,
            monsterConfigs: this.config.monsterConfigs,
            newTargetDelay: this.config.newTargetDelay,
            switchTargetDelay: this.config.switchTargetDelay,
            clusterMode: this.config.clusterMode,
            clusterRadius: this.config.clusterRadius,
        });
        this.humanizer = new humanizer_1.default({
            walkDelayBase: this.config.walkSpeed,
            castCooldownMs: this.config.castCooldownMs,
            halfCast: this.config.halfCast,
            fastwalk: this.config.fastwalk,
            newTargetDelay: this.config.newTargetDelay,
            switchTargetDelay: this.config.switchTargetDelay,
        });
        this.stats = { kills: 0, startTime: 0, lastKillTime: 0 };
    }
    get isRunning() { return this.running; }
    // ─── Start / Stop ────────────────────────────────────────
    start() {
        if (this.running)
            return;
        this.running = true;
        this.abortController = new AbortController();
        this.stats = { kills: 0, startTime: Date.now(), lastKillTime: 0 };
        this.combatLoop();
    }
    stop() {
        this.running = false;
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.currentTarget = null;
    }
    // ─── Main Combat Loop ───────────────────────────────────
    async combatLoop() {
        while (this.running) {
            try {
                // Idle pause (humanizer)
                const idleMs = this.humanizer.idlePause();
                if (idleMs > 0) {
                    await this.humanizer.sleep(idleMs);
                    if (!this.running)
                        break;
                }
                // Step 0: Heal check
                if (await this.doHealCheck())
                    continue;
                // Step 1: Find target
                const target = this.findTarget();
                if (!target) {
                    // No target — wait and retry
                    await this.humanizer.sleep(500);
                    continue;
                }
                // Check if we switched targets
                if (this.currentTarget && this.currentTarget.serial !== target.serial) {
                    await this.humanizer.sleep(this.humanizer.switchTargetDelay());
                    if (!this.running)
                        break;
                }
                this.currentTarget = target;
                this.targetSelector.lastTargetSerial = target.serial;
                // Step 2: Walk into range if needed
                const dist = this.distanceTo(target);
                if (dist > this.config.attackRange) {
                    if (this.config.engagementMode === 'waitOnMonsters') {
                        await this.humanizer.sleep(300);
                        continue;
                    }
                    await this.walkToTarget(target);
                    if (!this.running)
                        break;
                    if (!this.isTargetAlive(target)) {
                        this.onTargetDied();
                        continue;
                    }
                }
                // Step 3: Face target
                this.faceTarget(target);
                // Step 4: Execute spell priority chain
                await this.executeSpellChain(target);
            }
            catch (e) {
                if (!this.running)
                    break;
                console.error(`[CombatEngine] Error in combat loop: ${e}`);
                await this.humanizer.sleep(1000);
            }
        }
    }
    // ─── Spell Priority Chain ───────────────────────────────
    async executeSpellChain(target) {
        // 1. Secondary attack (Cursed Tune) with cooldown
        if (await this.trySecondaryAttack(target))
            return;
        // 2. Per-monster custom config
        if (await this.tryMonsterConfig(target))
            return;
        // 3. Pramh/stun-lock
        if (await this.tryPramhPhase(target))
            return;
        // 4. Fas/Cradh curse phase
        if (await this.tryCursePhase(target))
            return;
        // 5. Primary attack
        if (await this.tryPrimaryAttack(target))
            return;
        // 6. Assail between spells
        if (this.config.assailEnabled && this.config.assailBetweenSpells) {
            await this.doAssail();
        }
    }
    async trySecondaryAttack(target) {
        if (!this.config.secondaryAttack)
            return false;
        if (!this.running)
            return true;
        const now = Date.now();
        if (now - this.lastSecondaryCast < this.config.secondaryCooldownMs)
            return false;
        // Skip if target already has the debuff (e.g., cursed tune)
        if (this.config.secondaryAttack.toLowerCase().includes('cursed tune') &&
            this.buffs.hasCursedTune(target.serial)) {
            return false;
        }
        if (this.castOnTarget(this.config.secondaryAttack, target.serial)) {
            this.lastSecondaryCast = now;
            await this.humanizer.sleep(this.humanizer.castDelay(this.config.secondaryAttack));
            if (await this.doHealCheck())
                return true;
            return !this.isTargetAlive(target);
        }
        return false;
    }
    async tryMonsterConfig(target) {
        if (!target.name)
            return false;
        const mc = this.targetSelector.getMonsterConfig(target.name);
        if (!mc)
            return false;
        if (!this.running)
            return true;
        // Custom fas
        if (mc.fas && !this.buffs.hasFas(target.serial)) {
            if (this.castOnTarget(mc.fas, target.serial)) {
                await this.humanizer.sleep(this.humanizer.castDelay(mc.fas));
                if (await this.doHealCheck())
                    return true;
            }
        }
        // Custom curse
        if (mc.curse && !this.buffs.hasCradh(target.serial)) {
            if (this.castOnTarget(mc.curse, target.serial)) {
                await this.humanizer.sleep(this.humanizer.castDelay(mc.curse));
                if (await this.doHealCheck())
                    return true;
            }
        }
        // Pramh first
        if (mc.pramhFirst && !this.buffs.isStunned(target.serial)) {
            const spell = this.config.pramhSpell ?? 'pramh';
            if (this.castOnTarget(spell, target.serial)) {
                await this.humanizer.sleep(this.humanizer.castDelay(spell));
                if (await this.doHealCheck())
                    return true;
            }
        }
        // Custom attack
        if (mc.attack) {
            if (this.castOnTarget(mc.attack, target.serial)) {
                await this.humanizer.sleep(this.humanizer.castDelay(mc.attack));
            }
            return !this.isTargetAlive(target);
        }
        return false;
    }
    async tryPramhPhase(target) {
        if (!this.config.pramhSpell)
            return false;
        if (!this.running)
            return true;
        const spell = this.config.pramhSpell;
        // Get cluster for AoE stun
        const monsters = this.registry.getMonsters(this.session.id);
        const cluster = this.targetSelector.selectCluster(monsters, this.session.playerState.x, this.session.playerState.y, this.buffs);
        // Cast pramh on unstunned targets in cluster
        for (const entity of cluster) {
            if (!this.running)
                return true;
            if (this.buffs.isStunned(entity.serial) && !this.config.pramhSpam)
                continue;
            if (this.castOnTarget(spell, entity.serial)) {
                await this.humanizer.sleep(this.humanizer.castDelay(spell));
                if (await this.doHealCheck())
                    return true;
            }
        }
        if (this.config.pramhOnly)
            return true;
        // Attack after pramh if configured
        if (this.config.attackAfterPramh && this.isTargetAlive(target)) {
            if (this.config.primaryAttack) {
                this.castOnTarget(this.config.primaryAttack, target.serial);
                await this.humanizer.sleep(this.humanizer.castDelay(this.config.primaryAttack));
            }
        }
        return !this.isTargetAlive(target);
    }
    async tryCursePhase(target) {
        if (!this.running)
            return true;
        const monsters = this.registry.getMonsters(this.session.id);
        // Pramh before curse if configured
        if (this.config.pramhBeforeCurse && this.config.pramhSpell) {
            if (!this.buffs.isStunned(target.serial)) {
                this.castOnTarget(this.config.pramhSpell, target.serial);
                await this.humanizer.sleep(this.humanizer.castDelay(this.config.pramhSpell));
                if (await this.doHealCheck())
                    return true;
            }
        }
        switch (this.config.curseMode) {
            case 'currentOnly':
                await this.curseTarget(target);
                break;
            case 'sequential':
                for (const entity of this.getCurseCandidates(monsters)) {
                    if (!this.running)
                        return true;
                    await this.curseTarget(entity);
                    if (await this.doHealCheck())
                        return true;
                }
                break;
            case 'fasAllThenCurseAll': {
                // Fas everything first
                if (this.config.fasSpell) {
                    for (const entity of this.getCurseCandidates(monsters)) {
                        if (!this.running)
                            return true;
                        if (!this.buffs.hasFas(entity.serial)) {
                            if (!this.targetSelector.hasInfiniteMr(entity.serial) || this.config.fasamancrystals) {
                                this.castOnTarget(this.config.fasSpell, entity.serial);
                                await this.humanizer.sleep(this.humanizer.castDelay(this.config.fasSpell));
                                if (await this.doHealCheck())
                                    return true;
                            }
                        }
                    }
                }
                // Then curse everything
                if (this.config.curse) {
                    for (const entity of this.getCurseCandidates(monsters)) {
                        if (!this.running)
                            return true;
                        if (!this.buffs.hasCradh(entity.serial)) {
                            this.castOnTarget(this.config.curse, entity.serial);
                            await this.humanizer.sleep(this.humanizer.castDelay(this.config.curse));
                            if (await this.doHealCheck())
                                return true;
                        }
                    }
                }
                break;
            }
        }
        return !this.isTargetAlive(target);
    }
    async curseTarget(entity) {
        if (!this.running)
            return;
        // Fas first
        if (this.config.fasSpell && !this.buffs.hasFas(entity.serial)) {
            if (!this.targetSelector.hasInfiniteMr(entity.serial) || this.config.fasamancrystals) {
                this.castOnTarget(this.config.fasSpell, entity.serial);
                await this.humanizer.sleep(this.humanizer.castDelay(this.config.fasSpell));
            }
        }
        // Then curse
        if (this.config.curse && !this.buffs.hasCradh(entity.serial)) {
            this.castOnTarget(this.config.curse, entity.serial);
            await this.humanizer.sleep(this.humanizer.castDelay(this.config.curse));
        }
    }
    getCurseCandidates(monsters) {
        const px = this.session.playerState.x;
        const py = this.session.playerState.y;
        return monsters.filter(e => e.entityType === 'monster' &&
            !e.isVirtual &&
            Math.abs(e.x - px) + Math.abs(e.y - py) <= 12);
    }
    async tryPrimaryAttack(target) {
        if (!this.config.primaryAttack)
            return false;
        if (!this.running)
            return true;
        // MP check
        const mpPercent = this.session.playerState.maxMp > 0
            ? (this.session.playerState.mp / this.session.playerState.maxMp) * 100
            : 100;
        if (mpPercent < this.config.minMpPercent) {
            // Low MP — assail only
            if (this.config.assailEnabled) {
                await this.doAssail();
            }
            return false;
        }
        if (this.castOnTarget(this.config.primaryAttack, target.serial)) {
            await this.humanizer.sleep(this.humanizer.castDelay(this.config.primaryAttack));
            // Assail between spells
            if (this.config.assailBetweenSpells && this.config.assailEnabled) {
                await this.doAssail();
            }
        }
        if (await this.doHealCheck())
            return true;
        return !this.isTargetAlive(target);
    }
    // ─── Melee ──────────────────────────────────────────────
    async doAssail() {
        if (!this.running)
            return;
        const now = Date.now();
        if (now - this.lastAssailTime < 250)
            return; // min 250ms between assails
        this.lastAssailTime = now;
        // Skill combos
        if (this.config.skillCombos.length > 0) {
            for (const combo of this.config.skillCombos) {
                const skills = combo.split('|');
                for (const skill of skills) {
                    if (!this.running)
                        return;
                    this.caster.useSkill(skill.trim());
                    await this.humanizer.sleep(150);
                }
            }
            return;
        }
        // Ambush (rogue)
        if (this.config.useAmbush) {
            this.caster.useSkill('ambush');
            return;
        }
        // Crash
        if (this.config.useCrash) {
            this.caster.useSkill('crash');
            return;
        }
        // Regular assail — send 0x13 attack packet
        const pkt = new packet_1.default(0x13);
        pkt.writeByte(0x01); // attack type
        this.proxy.sendToServer(this.session, pkt);
    }
    // ─── Helpers ────────────────────────────────────────────
    findTarget() {
        const monsters = this.registry.getMonsters(this.session.id);
        return this.targetSelector.selectTarget(monsters, this.session.playerState.x, this.session.playerState.y, this.buffs);
    }
    isTargetAlive(target) {
        const entity = this.registry.getEntity(this.session.id, target.serial);
        return entity !== undefined;
    }
    distanceTo(target) {
        return Math.abs(target.x - this.session.playerState.x) +
            Math.abs(target.y - this.session.playerState.y);
    }
    castOnTarget(spellName, targetSerial) {
        return this.caster.castSpell(spellName, targetSerial);
    }
    faceTarget(target) {
        const dx = target.x - this.session.playerState.x;
        const dy = target.y - this.session.playerState.y;
        let dir;
        if (Math.abs(dx) >= Math.abs(dy)) {
            dir = dx > 0 ? 1 : 3; // right : left
        }
        else {
            dir = dy > 0 ? 2 : 0; // down : up
        }
        // Send turn packet 0x11
        const pkt = new packet_1.default(0x11);
        pkt.writeByte(dir);
        this.proxy.sendToServer(this.session, pkt);
    }
    async walkToTarget(target) {
        // Simple single-step walk toward target
        const dx = target.x - this.session.playerState.x;
        const dy = target.y - this.session.playerState.y;
        let dir;
        if (Math.abs(dx) >= Math.abs(dy)) {
            dir = dx > 0 ? 1 : 3;
        }
        else {
            dir = dy > 0 ? 2 : 0;
        }
        // Send walk packet 0x06
        const pkt = new packet_1.default(0x06);
        pkt.writeByte(dir);
        this.proxy.sendToServer(this.session, pkt);
        await this.humanizer.sleep(this.humanizer.walkDelay());
    }
    onTargetDied() {
        if (this.currentTarget) {
            this.stats.kills++;
            this.stats.lastKillTime = Date.now();
            this.buffs.removeEntity(this.currentTarget.serial);
        }
        this.currentTarget = null;
    }
    async doHealCheck() {
        if (this.healCheck) {
            return await this.healCheck();
        }
        return false;
    }
    // ─── Mob Detection ──────────────────────────────────────
    isMobbed() {
        const monsters = this.registry.getMonsters(this.session.id);
        const px = this.session.playerState.x;
        const py = this.session.playerState.y;
        let count = 0;
        for (const m of monsters) {
            if (Math.abs(m.x - px) + Math.abs(m.y - py) <= this.config.mobDistance) {
                count++;
            }
        }
        return count >= this.config.mobSize;
    }
    // ─── Status ─────────────────────────────────────────────
    getStatus() {
        const runtime = this.stats.startTime > 0 ? Math.floor((Date.now() - this.stats.startTime) / 1000) : 0;
        const kpm = runtime > 60 ? ((this.stats.kills / runtime) * 60).toFixed(1) : '0.0';
        const target = this.currentTarget ? `${this.currentTarget.name || 'unknown'}(${this.currentTarget.serial})` : 'none';
        return `[Grind] ${this.running ? 'RUNNING' : 'STOPPED'} | Kills: ${this.stats.kills} | KPM: ${kpm} | Runtime: ${runtime}s | Target: ${target}`;
    }
}
exports.default = CombatEngine;
//# sourceMappingURL=combat-engine.js.map