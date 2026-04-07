"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const proxy_collision_1 = __importDefault(require("./proxy-collision"));
const map_graph_1 = __importDefault(require("../../features/navigator/map-graph"));
const proxy_navigator_1 = __importDefault(require("./proxy-navigator"));
const spell_caster_1 = __importDefault(require("./spell-caster"));
const buff_tracker_1 = __importDefault(require("./buff-tracker"));
const combat_engine_1 = __importDefault(require("./combat-engine"));
const heal_engine_1 = __importDefault(require("./heal-engine"));
const loot_engine_1 = __importDefault(require("./loot-engine"));
const desync_monitor_1 = __importDefault(require("./desync-monitor"));
const types_1 = require("../../features/navigator/types");
/**
 * Manages per-session automation state and registers slash commands.
 *
 * Collision data is built LIVE from intercepted 0x3C MapTransfer packets —
 * the same tile data the real game client and server use. Only SOTP
 * (Solid Tile Property) data is loaded from disk; everything else comes
 * from the actual game protocol in real-time.
 */
class AutomationManager {
    proxy;
    collision;
    mapGraph;
    sessions = new Map();
    registry = null;
    constructor(proxy) {
        this.proxy = proxy;
        this.collision = new proxy_collision_1.default();
        this.mapGraph = new map_graph_1.default('./data/map-exits.json');
    }
    async init() {
        const sotpPath = './data/sotp.bin';
        await this.collision.loadSotp(sotpPath);
        await this.mapGraph.load();
        console.log('[Automation] SOTP + map graph loaded (collision grids built live from 0x3C tile data)');
    }
    getCollision() { return this.collision; }
    getMapGraph() { return this.mapGraph; }
    /**
     * Create automation state for a new session.
     */
    createSession(session) {
        const navigator = new proxy_navigator_1.default(this.proxy, session, this.collision, this.mapGraph);
        const caster = new spell_caster_1.default(this.proxy, session);
        const buffs = new buff_tracker_1.default();
        // Combat engine needs registry — use placeholder if not yet wired
        const registry = this.registry;
        const combat = new combat_engine_1.default(this.proxy, session, registry, caster, buffs);
        const heal = new heal_engine_1.default(this.proxy, session, caster, buffs);
        const loot = new loot_engine_1.default(this.proxy, session, registry);
        const desync = new desync_monitor_1.default(this.proxy, session);
        // Wire heal engine as combat interrupt
        combat.healCheck = () => heal.healCycle();
        // Wire mob detection for loot engine
        loot.isMobbed = () => combat.isMobbed();
        const auto = {
            navigator, caster, buffs, combat, heal, loot, desync,
            followCancel: null,
        };
        this.sessions.set(session.id, auto);
        return auto;
    }
    /**
     * Get automation state for a session.
     */
    getSession(sessionId) {
        return this.sessions.get(sessionId);
    }
    /**
     * Clean up automation state for a disconnected session.
     */
    destroySession(sessionId) {
        const auto = this.sessions.get(sessionId);
        if (auto) {
            auto.navigator.cancel();
            auto.combat.stop();
            auto.heal.destroy();
            auto.loot.config.enabled = false;
            auto.desync.destroy();
            if (auto.followCancel)
                auto.followCancel();
            this.sessions.delete(sessionId);
        }
    }
    /**
     * Register automation-related slash commands.
     */
    registerCommands(commands, chat) {
        const DIR_MAP = {
            up: types_1.Direction.Up, north: types_1.Direction.Up, n: types_1.Direction.Up, u: types_1.Direction.Up,
            right: types_1.Direction.Right, east: types_1.Direction.Right, e: types_1.Direction.Right, r: types_1.Direction.Right,
            down: types_1.Direction.Down, south: types_1.Direction.Down, s: types_1.Direction.Down, d: types_1.Direction.Down,
            left: types_1.Direction.Left, west: types_1.Direction.Left, w: types_1.Direction.Left, l: types_1.Direction.Left,
        };
        commands.register('goto', async (session, args) => {
            if (args.length < 2) {
                chat.systemMessage(session, 'Usage: /goto <x> <y>');
                return;
            }
            const x = parseInt(args[0], 10);
            const y = parseInt(args[1], 10);
            if (isNaN(x) || isNaN(y)) {
                chat.systemMessage(session, 'Invalid coordinates.');
                return;
            }
            const auto = this.getSession(session.id);
            if (!auto) {
                chat.systemMessage(session, 'Automation not available.');
                return;
            }
            chat.systemMessage(session, `Walking to (${x}, ${y})...`);
            const result = await auto.navigator.walkTo(x, y);
            chat.systemMessage(session, result ? `Arrived at (${x}, ${y}).` : `Failed to reach (${x}, ${y}).`);
        }, 'Walk to coordinates on current map', '<x> <y>');
        commands.register('nav', async (session, args) => {
            if (args.length < 1) {
                chat.systemMessage(session, 'Usage: /nav <mapId> [x] [y]');
                return;
            }
            const mapId = parseInt(args[0], 10);
            const x = args.length >= 3 ? parseInt(args[1], 10) : -1;
            const y = args.length >= 3 ? parseInt(args[2], 10) : -1;
            if (isNaN(mapId)) {
                chat.systemMessage(session, 'Invalid map ID.');
                return;
            }
            const auto = this.getSession(session.id);
            if (!auto) {
                chat.systemMessage(session, 'Automation not available.');
                return;
            }
            chat.systemMessage(session, `Navigating to map ${mapId}${x >= 0 ? ` (${x},${y})` : ''}...`);
            const result = await auto.navigator.navigateTo({ mapId, x, y });
            chat.systemMessage(session, result ? `Arrived on map ${mapId}.` : `Failed to navigate to map ${mapId}.`);
        }, 'Navigate to a map (cross-map)', '<mapId> [x] [y]');
        commands.register('walk', async (session, args) => {
            if (args.length < 1) {
                chat.systemMessage(session, 'Usage: /walk <direction> [steps]');
                return;
            }
            const dir = DIR_MAP[args[0].toLowerCase()];
            if (dir === undefined) {
                chat.systemMessage(session, 'Invalid direction. Use: up/down/left/right (or n/s/e/w)');
                return;
            }
            const steps = args.length >= 2 ? parseInt(args[1], 10) : 1;
            if (isNaN(steps) || steps < 1) {
                chat.systemMessage(session, 'Invalid step count.');
                return;
            }
            const auto = this.getSession(session.id);
            if (!auto) {
                chat.systemMessage(session, 'Automation not available.');
                return;
            }
            const dirs = new Array(steps).fill(dir);
            const result = await auto.navigator.movement.walkPath(dirs);
            const { x, y } = session.playerState;
            chat.systemMessage(session, result ? `Walked ${steps} steps. Now at (${x},${y}).` : `Blocked after some steps. Now at (${x},${y}).`);
        }, 'Walk in a direction', '<dir> [steps]');
        commands.register('stop', (session) => {
            const auto = this.getSession(session.id);
            if (!auto)
                return;
            auto.navigator.cancel();
            auto.combat.stop();
            auto.heal.stopMonitor();
            auto.desync.stop();
            if (auto.followCancel) {
                auto.followCancel();
                auto.followCancel = null;
            }
            chat.systemMessage(session, 'Stopped all automation.');
        }, 'Stop all movement, combat, and automation');
        commands.register('follow', (session, args) => {
            if (args.length < 1) {
                chat.systemMessage(session, 'Usage: /follow <playerName>');
                return;
            }
            const targetName = args.join(' ');
            const auto = this.getSession(session.id);
            if (!auto) {
                chat.systemMessage(session, 'Automation not available.');
                return;
            }
            // Stop existing follow
            if (auto.followCancel) {
                auto.followCancel();
                auto.followCancel = null;
            }
            // Find target serial from nearby entities tracked by the proxy
            // For now, emit an event that the system can hook into
            chat.systemMessage(session, `Following "${targetName}" (tracking by entity walk events).`);
            // Store the follow target name - entity:walk events will resolve the serial
            session._followTarget = targetName.toLowerCase();
        }, 'Follow a player by name', '<name>');
        commands.register('cast', (session, args) => {
            if (args.length < 1) {
                chat.systemMessage(session, 'Usage: /cast <spellName> [targetSerial]');
                return;
            }
            const auto = this.getSession(session.id);
            if (!auto) {
                chat.systemMessage(session, 'Automation not available.');
                return;
            }
            const targetSerial = args.length >= 2 ? parseInt(args[args.length - 1], 10) : undefined;
            const spellName = (targetSerial !== undefined && !isNaN(targetSerial))
                ? args.slice(0, -1).join(' ')
                : args.join(' ');
            const found = auto.caster.castSpell(spellName, targetSerial);
            if (found) {
                chat.systemMessage(session, `Casting "${spellName}"...`);
            }
            else {
                chat.systemMessage(session, `Spell "${spellName}" not found. Use /spells to list.`);
            }
        }, 'Cast a spell by name', '<spell> [target]');
        commands.register('skill', (session, args) => {
            if (args.length < 1) {
                chat.systemMessage(session, 'Usage: /skill <skillName>');
                return;
            }
            const auto = this.getSession(session.id);
            if (!auto) {
                chat.systemMessage(session, 'Automation not available.');
                return;
            }
            const skillName = args.join(' ');
            const found = auto.caster.useSkill(skillName);
            if (found) {
                chat.systemMessage(session, `Using "${skillName}"...`);
            }
            else {
                chat.systemMessage(session, `Skill "${skillName}" not found. Use /skills to list.`);
            }
        }, 'Use a skill by name', '<skill>');
        commands.register('spells', (session) => {
            const auto = this.getSession(session.id);
            if (!auto) {
                chat.systemMessage(session, 'Automation not available.');
                return;
            }
            const spells = auto.caster.listSpells();
            if (spells.length === 0) {
                chat.systemMessage(session, 'No spells tracked yet. (Spells are learned as the server sends them.)');
                return;
            }
            chat.systemMessage(session, `--- Spells (${spells.length}) ---`);
            for (const s of spells) {
                chat.systemMessage(session, `[${s.slot}] ${s.name} (lines=${s.castLines})`);
            }
        }, 'List tracked spells');
        commands.register('skills', (session) => {
            const auto = this.getSession(session.id);
            if (!auto) {
                chat.systemMessage(session, 'Automation not available.');
                return;
            }
            const skills = auto.caster.listSkills();
            if (skills.length === 0) {
                chat.systemMessage(session, 'No skills tracked yet. (Skills are learned as the server sends them.)');
                return;
            }
            chat.systemMessage(session, `--- Skills (${skills.length}) ---`);
            for (const s of skills) {
                chat.systemMessage(session, `[${s.slot}] ${s.name}`);
            }
        }, 'List tracked skills');
        // ─── Grind (Combat) Commands ─────────────────────────────
        commands.register('grind', async (session, args) => {
            const auto = this.getSession(session.id);
            if (!auto) {
                chat.systemMessage(session, 'Automation not available.');
                return;
            }
            const sub = args[0]?.toLowerCase();
            if (sub === 'start') {
                if (auto.combat.isRunning) {
                    chat.systemMessage(session, 'Grind already running.');
                    return;
                }
                auto.combat.start();
                auto.heal.startMonitor();
                auto.desync.start();
                chat.systemMessage(session, 'Grind started.');
            }
            else if (sub === 'stop') {
                auto.combat.stop();
                auto.heal.stopMonitor();
                auto.desync.stop();
                chat.systemMessage(session, 'Grind stopped.');
            }
            else if (sub === 'status') {
                chat.systemMessage(session, auto.combat.getStatus());
            }
            else if (sub === 'config') {
                if (args.length < 3) {
                    chat.systemMessage(session, 'Usage: /grind config <key> <value>');
                    return;
                }
                const key = args[1];
                const value = args.slice(2).join(' ');
                this.applyGrindConfig(auto, key, value, chat, session);
            }
            else if (sub === 'target') {
                if (args.length < 2) {
                    chat.systemMessage(session, `Target mode: ${auto.combat.config.targetMode}. Options: nearest, highestHp, lowestHp, farthest`);
                    return;
                }
                const mode = args[1].toLowerCase();
                if (['nearest', 'highesthp', 'lowesthp', 'farthest'].includes(mode)) {
                    auto.combat.config.targetMode = mode;
                    chat.systemMessage(session, `Target mode set to: ${mode}`);
                }
                else {
                    chat.systemMessage(session, 'Invalid mode. Options: nearest, highestHp, lowestHp, farthest');
                }
            }
            else if (sub === 'ignore') {
                if (args.length < 3) {
                    chat.systemMessage(session, 'Usage: /grind ignore add|remove <name|imageId>');
                    return;
                }
                const action = args[1].toLowerCase();
                const target = args.slice(2).join(' ');
                const asNum = parseInt(target, 10);
                if (action === 'add') {
                    if (!isNaN(asNum)) {
                        auto.combat.config.imageExcludeList.add(asNum);
                        chat.systemMessage(session, `Added image ${asNum} to exclude list.`);
                    }
                    else {
                        auto.combat.config.nameIgnoreList.add(target.toLowerCase());
                        chat.systemMessage(session, `Added "${target}" to ignore list.`);
                    }
                }
                else if (action === 'remove') {
                    if (!isNaN(asNum)) {
                        auto.combat.config.imageExcludeList.delete(asNum);
                        chat.systemMessage(session, `Removed image ${asNum} from exclude list.`);
                    }
                    else {
                        auto.combat.config.nameIgnoreList.delete(target.toLowerCase());
                        chat.systemMessage(session, `Removed "${target}" from ignore list.`);
                    }
                }
            }
            else if (sub === 'lure') {
                if (args.length < 2) {
                    chat.systemMessage(session, `Lure mode: ${auto.combat.config.engagementMode}. Options: spells, skills, lamh, nolure, wait`);
                    return;
                }
                const modeMap = {
                    spells: 'lureSpells', skills: 'lureSkills', lamh: 'lureLamh',
                    nolure: 'noLure', wait: 'waitOnMonsters',
                };
                const mode = modeMap[args[1].toLowerCase()];
                if (mode) {
                    auto.combat.config.engagementMode = mode;
                    chat.systemMessage(session, `Engagement mode: ${mode}`);
                }
                else {
                    chat.systemMessage(session, 'Invalid mode. Options: spells, skills, lamh, nolure, wait');
                }
            }
            else {
                chat.systemMessage(session, 'Usage: /grind start|stop|status|config|target|ignore|lure');
            }
        }, 'Combat grinding automation', 'start|stop|status|config|target|ignore|lure');
        // ─── Heal Commands ───────────────────────────────────────
        commands.register('heal', (session, args) => {
            const auto = this.getSession(session.id);
            if (!auto) {
                chat.systemMessage(session, 'Automation not available.');
                return;
            }
            const sub = args[0]?.toLowerCase();
            if (sub === 'on') {
                auto.heal.config.enabled = true;
                auto.heal.startMonitor();
                chat.systemMessage(session, 'Heal engine enabled.');
            }
            else if (sub === 'off') {
                auto.heal.config.enabled = false;
                auto.heal.stopMonitor();
                chat.systemMessage(session, 'Heal engine disabled.');
            }
            else if (sub === 'config') {
                if (args.length < 3) {
                    chat.systemMessage(session, 'Usage: /heal config <key> <value>');
                    return;
                }
                const key = args[1];
                const value = args.slice(2).join(' ');
                this.applyHealConfig(auto, key, value, chat, session);
            }
            else {
                const ps = session.playerState;
                const hpPct = ps.maxHp > 0 ? Math.round((ps.hp / ps.maxHp) * 100) : 0;
                const mpPct = ps.maxMp > 0 ? Math.round((ps.mp / ps.maxMp) * 100) : 0;
                chat.systemMessage(session, `[Heal] ${auto.heal.config.enabled ? 'ON' : 'OFF'} | HP: ${ps.hp}/${ps.maxHp} (${hpPct}%) | MP: ${ps.mp}/${ps.maxMp} (${mpPct}%)`);
            }
        }, 'Heal engine control', 'on|off|config|status');
        // ─── Loot Commands ───────────────────────────────────────
        commands.register('loot', (session, args) => {
            const auto = this.getSession(session.id);
            if (!auto) {
                chat.systemMessage(session, 'Automation not available.');
                return;
            }
            const sub = args[0]?.toLowerCase();
            if (sub === 'on') {
                auto.loot.config.enabled = true;
                chat.systemMessage(session, 'Loot engine enabled.');
            }
            else if (sub === 'off') {
                auto.loot.config.enabled = false;
                chat.systemMessage(session, 'Loot engine disabled.');
            }
            else if (sub === 'allow') {
                const item = args.slice(1).join(' ').toLowerCase();
                if (item) {
                    auto.loot.config.filterMode = 'allowlist';
                    auto.loot.config.itemFilter.add(item);
                    chat.systemMessage(session, `Added "${item}" to loot allowlist.`);
                }
            }
            else if (sub === 'deny') {
                const item = args.slice(1).join(' ').toLowerCase();
                if (item) {
                    auto.loot.config.filterMode = 'denylist';
                    auto.loot.config.itemFilter.add(item);
                    chat.systemMessage(session, `Added "${item}" to loot denylist.`);
                }
            }
            else {
                chat.systemMessage(session, `[Loot] ${auto.loot.config.enabled ? 'ON' : 'OFF'} | Mode: ${auto.loot.config.filterMode} | Filter: ${auto.loot.config.itemFilter.size} items`);
            }
        }, 'Loot engine control', 'on|off|allow|deny');
        // ─── Buff Status ─────────────────────────────────────────
        commands.register('buffs', (session) => {
            const auto = this.getSession(session.id);
            if (!auto) {
                chat.systemMessage(session, 'Automation not available.');
                return;
            }
            const icons = Array.from(auto.buffs.selfBuffIcons);
            if (icons.length === 0) {
                chat.systemMessage(session, 'No active spell bar effects tracked.');
                return;
            }
            chat.systemMessage(session, `--- Active Buffs (${icons.length} icons) ---`);
            chat.systemMessage(session, `Icons: ${icons.join(', ')}`);
            // Named buffs
            const named = [];
            if (auto.buffs.hasSelfAite())
                named.push('Aite');
            if (auto.buffs.hasSelfFas())
                named.push('Fas');
            if (auto.buffs.hasSelfDion())
                named.push('Dion');
            if (auto.buffs.hasSelfCounterAttack())
                named.push('Counter Attack');
            if (auto.buffs.hasSelfCradh())
                named.push('Cradh (CURSED)');
            if (auto.buffs.hasSelfPoison())
                named.push('Poison');
            if (auto.buffs.hasSelfHide())
                named.push('Hide');
            if (auto.buffs.hasSelfDruidForm())
                named.push('Druid Form');
            if (named.length > 0) {
                chat.systemMessage(session, `Status: ${named.join(', ')}`);
            }
        }, 'Show active buff status');
        // ─── Inventory ───────────────────────────────────────────
        commands.register('inventory', (session) => {
            const inv = session.playerState.inventory;
            if (inv.size === 0) {
                chat.systemMessage(session, 'Inventory empty (or not yet tracked).');
                return;
            }
            chat.systemMessage(session, `--- Inventory (${inv.size}/60) ---`);
            for (const [slot, item] of inv) {
                const qty = item.quantity > 1 ? ` x${item.quantity}` : '';
                chat.systemMessage(session, `[${slot}] ${item.name}${qty}`);
            }
        }, 'Show tracked inventory');
    }
    // ─── Config Helpers ────────────────────────────────────
    applyGrindConfig(auto, key, value, chat, session) {
        const c = auto.combat.config;
        switch (key.toLowerCase()) {
            case 'attack':
            case 'primaryattack':
                c.primaryAttack = value;
                chat.systemMessage(session, `Primary attack: ${value}`);
                break;
            case 'secondary':
            case 'secondaryattack':
                c.secondaryAttack = value || undefined;
                chat.systemMessage(session, `Secondary attack: ${value || 'none'}`);
                break;
            case 'curse':
                c.curse = value || undefined;
                chat.systemMessage(session, `Curse: ${value || 'none'}`);
                break;
            case 'fas':
                c.fasSpell = value || undefined;
                chat.systemMessage(session, `Fas spell: ${value || 'none'}`);
                break;
            case 'pramh':
                c.pramhSpell = value || undefined;
                chat.systemMessage(session, `Pramh spell: ${value || 'none'}`);
                break;
            case 'assail':
                c.assailEnabled = value.toLowerCase() !== 'off' && value !== '0';
                chat.systemMessage(session, `Assail: ${c.assailEnabled ? 'on' : 'off'}`);
                break;
            case 'range':
            case 'attackrange':
                c.attackRange = parseInt(value, 10) || 1;
                chat.systemMessage(session, `Attack range: ${c.attackRange}`);
                break;
            case 'cursemode':
                if (['currentonly', 'sequential', 'fasallthenurseall'].includes(value.toLowerCase())) {
                    c.curseMode = value;
                    chat.systemMessage(session, `Curse mode: ${value}`);
                }
                else {
                    chat.systemMessage(session, 'Curse modes: currentOnly, sequential, fasAllThenCurseAll');
                }
                break;
            case 'halfcast':
                c.halfCast = value.toLowerCase() !== 'off' && value !== '0';
                chat.systemMessage(session, `Half-cast: ${c.halfCast ? 'on' : 'off'}`);
                break;
            case 'pramhspam':
                c.pramhSpam = value.toLowerCase() !== 'off' && value !== '0';
                chat.systemMessage(session, `Pramh spam: ${c.pramhSpam ? 'on' : 'off'}`);
                break;
            case 'mobsize':
                c.mobSize = parseInt(value, 10) || 3;
                chat.systemMessage(session, `Mob size: ${c.mobSize}`);
                break;
            case 'ambush':
                c.useAmbush = value.toLowerCase() !== 'off' && value !== '0';
                chat.systemMessage(session, `Ambush: ${c.useAmbush ? 'on' : 'off'}`);
                break;
            case 'crash':
                c.useCrash = value.toLowerCase() !== 'off' && value !== '0';
                chat.systemMessage(session, `Crash: ${c.useCrash ? 'on' : 'off'}`);
                break;
            default:
                chat.systemMessage(session, `Unknown config key: ${key}. Keys: attack, secondary, curse, fas, pramh, assail, range, cursemode, halfcast, pramhspam, mobsize, ambush, crash`);
        }
    }
    applyHealConfig(auto, key, value, chat, session) {
        const c = auto.heal.config;
        switch (key.toLowerCase()) {
            case 'hppot':
            case 'hppotionthreshold':
                c.hpPotionThreshold = parseInt(value, 10) || 70;
                chat.systemMessage(session, `HP potion threshold: ${c.hpPotionThreshold}%`);
                break;
            case 'mppot':
            case 'mppotionthreshold':
                c.mpPotionThreshold = parseInt(value, 10) || 50;
                chat.systemMessage(session, `MP potion threshold: ${c.mpPotionThreshold}%`);
                break;
            case 'hpspell':
            case 'hpspellthreshold':
                c.hpSpellThreshold = parseInt(value, 10) || 80;
                chat.systemMessage(session, `HP spell threshold: ${c.hpSpellThreshold}%`);
                break;
            case 'mprecovery':
                c.mpRecoverySpell = value || undefined;
                chat.systemMessage(session, `MP recovery spell: ${value || 'none'}`);
                break;
            case 'dion':
                c.dionEnabled = value.toLowerCase() !== 'off' && value !== '0';
                chat.systemMessage(session, `Dion emergency: ${c.dionEnabled ? 'on' : 'off'}`);
                break;
            case 'diontype':
                c.dionType = value;
                chat.systemMessage(session, `Dion type: ${value}`);
                break;
            case 'aocurses':
                c.aoCursesSelf = value.toLowerCase() !== 'off' && value !== '0';
                chat.systemMessage(session, `Ao curses self: ${c.aoCursesSelf ? 'on' : 'off'}`);
                break;
            case 'counterattack':
                c.counterAttack = value.toLowerCase() !== 'off' && value !== '0';
                chat.systemMessage(session, `Counter Attack: ${c.counterAttack ? 'on' : 'off'}`);
                break;
            default:
                chat.systemMessage(session, `Unknown config key: ${key}. Keys: hppot, mppot, hpspell, mprecovery, dion, diontype, aocurses, counterattack`);
        }
    }
}
exports.default = AutomationManager;
//# sourceMappingURL=index.js.map