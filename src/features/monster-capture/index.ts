import type ProxyServer from '../../proxy/proxy-server';
import type PlayerRegistry from '../../proxy/player-registry';
import type AugmentationEngine from '../../proxy/augmentation/index';
import type AutomationManager from '../../proxy/automation/index';
import { initMonsterSchema, getActiveMonster, getMonstersByOwner, renameMonster, setActiveMonster, updateMonster } from './monster-db';
import { attemptCapture, onPlayerMapChange as onEncounterMapChange, onPlayerStep, onSessionEnd as onEncounterSessionEnd, setProxy } from './encounter';
import { initKeeper, onSessionEnd as onKeeperSessionEnd } from './keeper-npc';
import {
    autoSpawnCompanion,
    initCompanion,
    onPlayerCombat,
    onPlayerMapChange as onCompanionMapChange,
    onPlayerMove,
    onPlayerTeleport as onCompanionTeleport,
    onSessionEnd as onCompanionSessionEnd,
    refreshCompanion,
    toggleCompanion,
} from './companion';
import {
    acceptChallenge,
    challengePlayer,
    declineChallenge,
    handleForfeit,
    initBattleUI,
    onPlayerMapChange as onBattleMapChange,
    onPlayerTeleport as onBattleTeleport,
    onSessionEnd as onBattleSessionEnd,
    startWildBattle,
} from './battle-ui';
import { isInBattle } from './battle-engine';
import { initLeague } from './league';
import { calculateXpToNext, getAllEvolvedSpecies, getAllMoves, getAllSpecies, loadSpeciesData } from './species-data';
import type { MonsterCaptureConfig } from './types';
import { monsterDanger, monsterNotice, monsterSuccess } from './message-style';
import { initTraining, toggleTraining, onTrainingSessionEnd } from './training';

const DEFAULT_CONFIG: MonsterCaptureConfig = {
    encounterMapNumber: 449,
    encounterRate: 0.15,
    grassRegions: [],
    wildDespawnMs: 60_000,
    maxMonsters: 6,
    companionCastCooldownMs: 6_000,
    keeperNpc: {
        mapNumber: 449,
        x: 5,
        y: 5,
        direction: 2,
        sprite: 0x4001,
        name: 'Monster Keeper',
    },
};

export async function initMonsterCapture(
    proxy: ProxyServer,
    registry: PlayerRegistry,
    augmentation: AugmentationEngine,
    automation: AutomationManager,
    config?: Partial<MonsterCaptureConfig>,
): Promise<void> {
    const cfg: MonsterCaptureConfig = { ...DEFAULT_CONFIG, ...config };
    if (config?.keeperNpc) {
        cfg.keeperNpc = { ...DEFAULT_CONFIG.keeperNpc, ...config.keeperNpc };
    }

    loadSpeciesData(config?.speciesData);
    await initMonsterSchema();

    setProxy(proxy);
    initKeeper(proxy, augmentation.npcs, augmentation.dialogs, augmentation.chat, cfg);
    initCompanion(proxy, augmentation.npcs, augmentation.chat, automation, cfg);
    initTraining(proxy, augmentation.chat);
    initBattleUI(proxy, augmentation.npcs, augmentation.dialogs, augmentation.chat, registry, cfg);
    await initLeague(proxy, augmentation, cfg.league);

    registerCommands(augmentation, proxy, registry, cfg);

    const prevHpMap = new Map<string, number>();
    proxy.on('player:stats', session => {
        const prevHp = prevHpMap.get(session.id) || session.playerState.hp;
        if (session.playerState.hp < prevHp) {
            onPlayerCombat(session, prevHp, session.playerState.hp);
        }
        prevHpMap.set(session.id, session.playerState.hp);
    });

    const collision = automation.getCollision();
    proxy.on('player:position', session => {
        if (!isInBattle(session.id)) {
            onPlayerStep(session, cfg, proxy, augmentation.npcs, augmentation.chat, registry, collision);
        }
        onPlayerMove(session);
    });

    proxy.on('player:walkResponse', session => {
        onPlayerMove(session);
    });

    proxy.on('player:turn', session => {
        onPlayerMove(session);
    });

    proxy.on('player:mapChange', session => {
        void onBattleMapChange(session).catch(() => undefined);
        onEncounterMapChange(session.id, augmentation.npcs);
        onCompanionMapChange(session);
    });

    proxy.on('player:teleport', session => {
        void onBattleTeleport(session).catch(() => undefined);
        onCompanionTeleport(session);
    });

    proxy.on('session:game', session => {
        setTimeout(() => {
            if (!session.destroyed) {
                void autoSpawnCompanion(session);
            }
        }, 2000);
    });

    proxy.on('afk:entered', session => {
        setTimeout(() => {
            if (!session.destroyed) {
                void refreshCompanion(session).catch(() => undefined);
            }
        }, 200);
    });

    proxy.on('afk:mapChanged', session => {
        void onBattleMapChange(session).catch(() => undefined);
        onCompanionMapChange(session);
        setTimeout(() => {
            if (!session.destroyed) {
                void refreshCompanion(session).catch(() => undefined);
            }
        }, 50);
    });

    proxy.on('afk:refreshed', session => {
        setTimeout(() => {
            if (!session.destroyed) {
                void refreshCompanion(session).catch(() => undefined);
            }
        }, 50);
    });

    proxy.on('afk:walk', session => {
        setTimeout(() => {
            if (!session.destroyed) {
                onPlayerMove(session);
            }
        }, 0);
    });

    proxy.on('afk:turn', session => {
        setTimeout(() => {
            if (!session.destroyed) {
                onPlayerMove(session);
            }
        }, 0);
    });

    proxy.on('afk:exited', session => {
        void onBattleTeleport(session).catch(() => undefined);
        setTimeout(() => {
            if (!session.destroyed) {
                void refreshCompanion(session).catch(() => undefined);
            }
        }, 300);
    });

    proxy.on('session:end', session => {
        void onBattleSessionEnd(session.id).catch(() => undefined);
        onEncounterSessionEnd(session.id, augmentation.npcs);
        onTrainingSessionEnd(session.id);
        onCompanionSessionEnd(session.id);
        onKeeperSessionEnd(session.id);
        prevHpMap.delete(session.id);
    });

    console.log('[Monster] DA Monsters system initialized!');
    console.log(`[Monster] Encounter map: ${cfg.encounterMapNumber}, Rate: ${(cfg.encounterRate * 100).toFixed(0)}%`);
    console.log(`[Monster] Keeper NPC: map ${cfg.keeperNpc.mapNumber} (${cfg.keeperNpc.x},${cfg.keeperNpc.y})`);
}

export { getAllSpecies, getAllEvolvedSpecies, getAllMoves, loadSpeciesData };
export type { MonsterCaptureConfig };

function registerCommands(
    augmentation: AugmentationEngine,
    proxy: ProxyServer,
    registry: PlayerRegistry,
    config: MonsterCaptureConfig,
): void {
    const { commands, chat, npcs } = augmentation;

    commands.register('capture', async session => {
        if (isInBattle(session.id)) {
            chat.systemMessage(session, monsterDanger('You cannot capture a monster during battle.'));
            return;
        }
        await attemptCapture(session, config, npcs, chat);
    }, 'Attempt to capture a wild monster');

    commands.register('fight', async session => {
        await startWildBattle(session);
    }, 'Fight a wild monster with your active monster');

    commands.register('monsters', async session => {
        const monsters = await getMonstersByOwner(session.characterName);
        if (monsters.length === 0) {
            chat.systemMessage(session, monsterDanger('You have no monsters. Find some in the wild grass!'));
            return;
        }

        chat.systemMessage(session, monsterNotice(`--- Your Monsters (${monsters.length}/${config.maxMonsters}) ---`));
        monsters.forEach((monster, index) => {
            const active = monster.isActive ? ' [ACTIVE]' : '';
            chat.systemMessage(
                session,
                monsterNotice(
                    `${index + 1}. ${monster.nickname} Lv.${monster.level} (${monster.speciesName}) `
                    + `${monster.wins}W/${monster.losses}L${active}`,
                ),
            );
        });
    }, 'List your captured monsters');

    commands.register('active', async (session, args) => {
        if (args.length === 0) {
            const monster = await getActiveMonster(session.characterName);
            if (monster) {
                chat.systemMessage(
                    session,
                    monsterNotice(`Active: ${monster.nickname} Lv.${monster.level} (${monster.speciesName}) HP:${monster.hp}/${monster.maxHp}`),
                );
            } else {
                chat.systemMessage(session, monsterDanger('No active monster. Use /active <number> to set one.'));
            }
            return;
        }

        const slot = parseInt(args[0], 10);
        const monsters = await getMonstersByOwner(session.characterName);
        if (slot < 1 || slot > monsters.length) {
            chat.systemMessage(session, monsterDanger(`Invalid slot. You have ${monsters.length} monsters (1-${monsters.length}).`));
            return;
        }

        const target = monsters[slot - 1];
        await setActiveMonster(session.characterName, target.id);
        chat.systemMessage(session, monsterSuccess(`${target.nickname} is now your active monster!`));
        await refreshCompanion(session);
    }, 'Set active monster', '<slot 1-6>');

    commands.register('battle', async (session, args) => {
        if (args.length === 0) {
            chat.systemMessage(session, monsterNotice('Usage: /battle <playername>'));
            return;
        }

        await challengePlayer(session, args.join(' '));
    }, 'Challenge a player to a monster battle', '<playername>');

    commands.register('accept', async session => {
        await acceptChallenge(session);
    }, 'Accept a battle challenge');

    commands.register('decline', session => {
        declineChallenge(session);
    }, 'Decline a battle challenge');

    commands.register('forfeit', async session => {
        await handleForfeit(session);
    }, 'Forfeit current battle');

    commands.register('train', async session => {
        await toggleTraining(session);
    }, 'Toggle AFK training for your active monster');

    commands.register('mstats', async session => {
        const monster = await getActiveMonster(session.characterName);
        if (!monster) {
            chat.systemMessage(session, monsterDanger('No active monster.'));
            return;
        }

        chat.systemMessage(session, monsterNotice(`--- ${monster.nickname} (${monster.speciesName}) ---`));
        chat.systemMessage(session, monsterNotice(`Lv.${monster.level} ${monster.nature} | XP: ${monster.xp}/${monster.xpToNext}`));
        chat.systemMessage(session, monsterNotice(`HP: ${monster.hp}/${monster.maxHp} | ATK: ${monster.atk} DEF: ${monster.def} SPD: ${monster.spd}`));
        chat.systemMessage(session, monsterNotice(`SP.ATK: ${monster.spAtk} SP.DEF: ${monster.spDef}`));
        chat.systemMessage(session, monsterNotice(`Moves: ${monster.moves.filter(Boolean).join(', ') || 'None'}`));
        chat.systemMessage(session, monsterNotice(`Record: ${monster.wins}W / ${monster.losses}L`));
    }, 'Show active monster stats');

    commands.register('nickname', async (session, args) => {
        if (args.length === 0) {
            chat.systemMessage(session, monsterNotice('Usage: /nickname <name>'));
            return;
        }

        const monster = await getActiveMonster(session.characterName);
        if (!monster) {
            chat.systemMessage(session, monsterDanger('No active monster.'));
            return;
        }

        const newName = args.join(' ').substring(0, 20);
        await renameMonster(monster.id, session.characterName, newName);
        chat.systemMessage(session, monsterSuccess(`Monster renamed to ${newName}!`));
        await refreshCompanion(session);
    }, 'Rename active monster', '<name>');

    commands.register('companion', async session => {
        await toggleCompanion(session);
    }, 'Toggle companion monster following');

    void proxy;
    void registry;
}
