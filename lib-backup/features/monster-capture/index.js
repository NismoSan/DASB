"use strict";
// ── DA Monsters: Module Entry Point ───────────────────────────────
// Initializes the monster capture/battle system and registers all commands.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadSpeciesData = exports.getAllMoves = exports.getAllEvolvedSpecies = exports.getAllSpecies = void 0;
exports.initMonsterCapture = initMonsterCapture;
const monster_db_1 = require("./monster-db");
const monster_db_2 = require("./monster-db");
const encounter_1 = require("./encounter");
const keeper_npc_1 = require("./keeper-npc");
const companion_1 = require("./companion");
const battle_ui_1 = require("./battle-ui");
const battle_engine_1 = require("./battle-engine");
const species_data_1 = require("./species-data");
Object.defineProperty(exports, "loadSpeciesData", { enumerable: true, get: function () { return species_data_1.loadSpeciesData; } });
Object.defineProperty(exports, "getAllSpecies", { enumerable: true, get: function () { return species_data_1.getAllSpecies; } });
Object.defineProperty(exports, "getAllEvolvedSpecies", { enumerable: true, get: function () { return species_data_1.getAllEvolvedSpecies; } });
Object.defineProperty(exports, "getAllMoves", { enumerable: true, get: function () { return species_data_1.getAllMoves; } });
// ── Default Config ───────────────────────────────────────────────
const DEFAULT_CONFIG = {
    encounterMapNumber: 449,
    encounterRate: 0.15,
    grassRegions: [], // empty = all tiles are grass (configure with actual grass coords later)
    wildDespawnMs: 60_000,
    maxMonsters: 6,
    companionCastCooldownMs: 6_000,
    keeperNpc: {
        mapNumber: 449,
        x: 5,
        y: 5,
        sprite: 0x4001, // Mundane NPC sprite — adjust to a real DA NPC sprite
        name: 'Monster Keeper',
    },
};
// ── Init ─────────────────────────────────────────────────────────
async function initMonsterCapture(proxy, registry, augmentation, automation, config) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    if (config?.keeperNpc) {
        cfg.keeperNpc = { ...DEFAULT_CONFIG.keeperNpc, ...config.keeperNpc };
    }
    // Load species/moves from config (panel-managed) or use defaults
    (0, species_data_1.loadSpeciesData)(config?.speciesData);
    // Initialize database
    await (0, monster_db_1.initMonsterSchema)();
    // Set module proxy refs
    (0, encounter_1.setProxy)(proxy);
    // Initialize subsystems
    (0, keeper_npc_1.initKeeper)(proxy, augmentation.npcs, augmentation.dialogs, augmentation.chat, cfg);
    (0, companion_1.initCompanion)(proxy, augmentation.npcs, augmentation.chat, automation, cfg);
    (0, battle_ui_1.initBattleUI)(proxy, augmentation.npcs, augmentation.dialogs, augmentation.chat, registry, cfg);
    // Register slash commands
    registerCommands(augmentation.commands, augmentation.chat, augmentation.npcs, proxy, registry, cfg);
    // ── Wire Events ──────────────────────────────────────────────
    // Track HP changes for companion auto-cast
    let prevHpMap = new Map();
    proxy.on('player:stats', (session) => {
        const prevHp = prevHpMap.get(session.id) || session.playerState.hp;
        if (session.playerState.hp < prevHp) {
            (0, companion_1.onPlayerCombat)(session, prevHp, session.playerState.hp);
        }
        prevHpMap.set(session.id, session.playerState.hp);
    });
    // Get collision data for walkable tile checking
    const collision = automation.getCollision();
    // Player movement — encounter checks + companion following
    proxy.on('player:position', (session) => {
        // Wild encounter check
        if (!(0, battle_engine_1.isInBattle)(session.id)) {
            (0, encounter_1.onPlayerStep)(session, cfg, proxy, augmentation.npcs, augmentation.chat, registry, collision);
        }
        // Companion following
        (0, companion_1.onPlayerMove)(session);
    });
    // Also move companion on every walk step (0x0B fires more frequently than 0x04)
    proxy.on('player:walkResponse', (session) => {
        (0, companion_1.onPlayerMove)(session);
    });
    // Map change — clear encounters + respawn companion
    proxy.on('player:mapChange', (session) => {
        (0, encounter_1.onPlayerMapChange)(session.id, augmentation.npcs);
        (0, companion_1.onPlayerMapChange)(session);
    });
    // Session end — cleanup everything
    proxy.on('session:end', (session) => {
        (0, encounter_1.onSessionEnd)(session.id, augmentation.npcs);
        (0, companion_1.onSessionEnd)(session.id);
        (0, keeper_npc_1.onSessionEnd)(session.id);
        (0, battle_ui_1.onSessionEnd)(session.id);
        prevHpMap.delete(session.id);
    });
    console.log('[Monster] DA Monsters system initialized!');
    console.log(`[Monster] Encounter map: ${cfg.encounterMapNumber}, Rate: ${(cfg.encounterRate * 100).toFixed(0)}%`);
    console.log(`[Monster] Keeper NPC: map ${cfg.keeperNpc.mapNumber} (${cfg.keeperNpc.x},${cfg.keeperNpc.y})`);
}
// ── Commands ─────────────────────────────────────────────────────
function registerCommands(commands, chat, npcs, proxy, registry, config) {
    commands.register('capture', async (session) => {
        await (0, encounter_1.attemptCapture)(session, config, npcs, chat);
    }, 'Attempt to capture a wild monster');
    commands.register('fight', async (session) => {
        await (0, battle_ui_1.startWildBattle)(session);
    }, 'Fight a wild monster with your active monster');
    commands.register('monsters', async (session) => {
        const monsters = await (0, monster_db_2.getMonstersByOwner)(session.characterName);
        if (monsters.length === 0) {
            chat.systemMessage(session, 'You have no monsters. Find some in the wild grass!');
            return;
        }
        chat.systemMessage(session, `--- Your Monsters (${monsters.length}/${config.maxMonsters}) ---`);
        monsters.forEach((m, i) => {
            const active = m.isActive ? ' [ACTIVE]' : '';
            chat.systemMessage(session, `${i + 1}. ${m.nickname} Lv.${m.level} (${m.speciesName}) ${m.wins}W/${m.losses}L${active}`);
        });
    }, 'List your captured monsters');
    commands.register('active', async (session, args) => {
        if (args.length === 0) {
            const mon = await (0, monster_db_2.getActiveMonster)(session.characterName);
            if (mon) {
                chat.systemMessage(session, `Active: ${mon.nickname} Lv.${mon.level} (${mon.speciesName}) HP:${mon.hp}/${mon.maxHp}`);
            }
            else {
                chat.systemMessage(session, 'No active monster. Use /active <number> to set one.');
            }
            return;
        }
        const slot = parseInt(args[0], 10);
        const monsters = await (0, monster_db_2.getMonstersByOwner)(session.characterName);
        if (slot < 1 || slot > monsters.length) {
            chat.systemMessage(session, `Invalid slot. You have ${monsters.length} monsters (1-${monsters.length}).`);
            return;
        }
        const target = monsters[slot - 1];
        await (0, monster_db_2.setActiveMonster)(session.characterName, target.id);
        chat.systemMessage(session, `${target.nickname} is now your active monster!`);
        await (0, companion_1.refreshCompanion)(session);
    }, 'Set active monster', '<slot 1-6>');
    commands.register('battle', async (session, args) => {
        if (args.length === 0) {
            chat.systemMessage(session, 'Usage: /battle <playername>');
            return;
        }
        await (0, battle_ui_1.challengePlayer)(session, args.join(' '));
    }, 'Challenge a player to a monster battle', '<playername>');
    commands.register('accept', async (session) => {
        await (0, battle_ui_1.acceptChallenge)(session);
    }, 'Accept a battle challenge');
    commands.register('decline', (session) => {
        (0, battle_ui_1.declineChallenge)(session);
    }, 'Decline a battle challenge');
    commands.register('forfeit', async (session) => {
        await (0, battle_ui_1.handleForfeit)(session);
    }, 'Forfeit current battle');
    commands.register('train', async (session) => {
        const mon = await (0, monster_db_2.getActiveMonster)(session.characterName);
        if (!mon) {
            chat.systemMessage(session, 'No active monster to train.');
            return;
        }
        // Simple passive XP gain with cooldown
        const xpGain = 10 + Math.floor(Math.random() * 10);
        mon.xp += xpGain;
        // Check level up
        let leveled = false;
        while (mon.xp >= mon.xpToNext) {
            mon.xp -= mon.xpToNext;
            mon.level++;
            mon.xpToNext = (0, species_data_1.calculateXpToNext)(mon.level);
            leveled = true;
        }
        const { updateMonster } = await Promise.resolve().then(() => __importStar(require('./monster-db')));
        await updateMonster(mon);
        chat.systemMessage(session, `${mon.nickname} trained! +${xpGain} XP (${mon.xp}/${mon.xpToNext})`);
        if (leveled) {
            chat.systemMessage(session, `${mon.nickname} grew to level ${mon.level}!`);
            await (0, companion_1.refreshCompanion)(session);
        }
    }, 'Train your active monster (passive XP)');
    commands.register('mstats', async (session) => {
        const mon = await (0, monster_db_2.getActiveMonster)(session.characterName);
        if (!mon) {
            chat.systemMessage(session, 'No active monster.');
            return;
        }
        chat.systemMessage(session, `--- ${mon.nickname} (${mon.speciesName}) ---`);
        chat.systemMessage(session, `Lv.${mon.level} ${mon.nature} | XP: ${mon.xp}/${mon.xpToNext}`);
        chat.systemMessage(session, `HP: ${mon.hp}/${mon.maxHp} | ATK: ${mon.atk} DEF: ${mon.def} SPD: ${mon.spd}`);
        chat.systemMessage(session, `SP.ATK: ${mon.spAtk} SP.DEF: ${mon.spDef}`);
        const moveList = mon.moves.filter(m => m).join(', ');
        chat.systemMessage(session, `Moves: ${moveList || 'None'}`);
        chat.systemMessage(session, `Record: ${mon.wins}W / ${mon.losses}L`);
    }, 'Show active monster stats');
    commands.register('nickname', async (session, args) => {
        if (args.length === 0) {
            chat.systemMessage(session, 'Usage: /nickname <name>');
            return;
        }
        const mon = await (0, monster_db_2.getActiveMonster)(session.characterName);
        if (!mon) {
            chat.systemMessage(session, 'No active monster.');
            return;
        }
        const newName = args.join(' ').substring(0, 20);
        await (0, monster_db_2.renameMonster)(mon.id, session.characterName, newName);
        chat.systemMessage(session, `Monster renamed to ${newName}!`);
        await (0, companion_1.refreshCompanion)(session);
    }, 'Rename active monster', '<name>');
    commands.register('companion', async (session) => {
        await (0, companion_1.toggleCompanion)(session);
    }, 'Toggle companion monster following');
}
//# sourceMappingURL=index.js.map