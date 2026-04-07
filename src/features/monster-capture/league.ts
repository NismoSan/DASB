import fs from 'fs';
import path from 'path';
import type ProxyServer from '../../proxy/proxy-server';
import type ProxySession from '../../proxy/proxy-session';
import type AugmentationEngine from '../../proxy/augmentation/index';
import type NpcInjector from '../../proxy/augmentation/npc-injector';
import type { DialogEvent, VirtualNPC } from '../../proxy/augmentation/npc-injector';
import DialogHandler, { DialogType } from '../../proxy/augmentation/dialog-handler';
import type ChatInjector from '../../proxy/augmentation/chat-injector';
import { pool } from '../database';
import {
    ensureProxyEventSchema,
    ensureActiveProxyEventSeason,
    getMostRecentCompletedProxyEventSeason,
    type ProxyEventSeason,
} from '../proxy-events';
import { grantProxyReward, type ProxyFeatureReward } from '../proxy-rewards';
import { startTrainerBattle } from './battle-ui';
import { getActiveMonster, healMonstersByOwner, updateMonster } from './monster-db';
import {
    calculateHp,
    calculateStat,
    calculateXpToNext,
    getMovesForLevel,
    getRandomNature,
    getSpeciesByName,
} from './species-data';
import { refreshCompanion } from './companion';
import { monsterDanger, monsterNotice, monsterSuccess } from './message-style';
import type {
    BattleEndReason,
    BattleMetadata,
    BattleSide,
    BattleState,
    CapturedMonster,
    ChampionTrainerConfig,
    GymTrainerConfig,
    LeagueContentConfig,
    MonsterCaptureConfig,
    MonsterLeagueConfig,
    RewardConfig,
    RankingRewardTier,
} from './types';

interface LeagueSeasonRow {
    id: number;
    proxy_season_id: number;
    season_key: string;
    starts_at: Date;
    ends_at: Date;
}

interface LeagueRegistrationRow {
    id: number;
    season_id: number;
    owner_name: string;
    rating: number;
    wins: number;
    losses: number;
    draws: number;
    registered_at: Date;
    last_match_at: Date | null;
}

interface GymProgressRow {
    season_id: number;
    owner_name: string;
    gym_id: string;
    cleared_at: Date | null;
    badge_claimed_at: Date | null;
    champion_cleared_at: Date | null;
}

interface MonsterLeagueSeason {
    id: number;
    proxySeasonId: number;
    seasonKey: string;
    startsAt: Date;
    endsAt: Date;
}

interface MonsterLeagueRegistration {
    ownerName: string;
    rating: number;
    wins: number;
    losses: number;
    draws: number;
    registeredAt: Date;
    lastMatchAt: Date | null;
}

interface LeagueStanding extends MonsterLeagueRegistration {
    rank: number;
    division: string;
}

interface LeagueGymProgress {
    gymId: string;
    clearedAt: Date | null;
    badgeClaimedAt: Date | null;
    championClearedAt: Date | null;
}

interface LeagueDialogState {
    entityId: number;
    role:
        | 'entry'
        | 'gym_guide'
        | 'league_clerk'
        | 'healer'
        | 'hub_exit'
        | 'standings_keeper'
        | 'hall_registrar'
        | 'hall_exit';
}

interface ResolvedLeagueConfig {
    enabled: boolean;
    seasonDurationDays: number;
    dailyResetHour: number;
    timezone: string;
    leaderboardSize: number;
    contentFile: string;
    entryNpc: {
        mapNumber: number;
        x: number;
        y: number;
        direction: number;
        sprite: number;
        name: string;
    };
    rankRewards: RankingRewardTier[];
}

export interface MonsterLeaguePanelState {
    enabled: boolean;
    activeSeason: {
        id: number;
        seasonKey: string;
        startsAt: string;
        endsAt: string;
    } | null;
    registrations: number;
    standings: Array<{
        rank: number;
        ownerName: string;
        rating: number;
        wins: number;
        losses: number;
        division: string;
    }>;
    gymClears: Array<{
        ownerName: string;
        gymId: string;
        clearedAt: string;
        seasonId: number;
    }>;
}

const FEATURE_KEY = 'monster_league';
const DEFAULT_CONTENT_FILE = 'data/monster-league/league-content.json';
const DEFAULT_RATING = 1000;
const ELO_K = 32;

let _proxy: ProxyServer | null = null;
let _augmentation: AugmentationEngine | null = null;
let _npcs: NpcInjector | null = null;
let _dialogs: DialogHandler | null = null;
let _chat: ChatInjector | null = null;
let _config: ResolvedLeagueConfig | null = null;
let _content: LeagueContentConfig | null = null;
let _schemaReady: Promise<void> | null = null;
let _initialized = false;
let _entryNpcSerial = 0;
const _dialogStates = new Map<string, LeagueDialogState>();

export async function initLeague(
    proxy: ProxyServer,
    augmentation: AugmentationEngine,
    config?: MonsterLeagueConfig,
): Promise<void> {
    if (_initialized) {
        return;
    }

    _proxy = proxy;
    _augmentation = augmentation;
    _npcs = augmentation.npcs;
    _dialogs = augmentation.dialogs;
    _chat = augmentation.chat;
    _config = resolveLeagueConfig(config);
    if (!_config.enabled) {
        return;
    }

    _content = loadLeagueContent(_config.contentFile, _config.rankRewards);

    await ensureLeagueSchema();
    await ensureActiveLeagueSeason();

    placeLeagueEntryNpc();
    placeLeagueAfkNpcs();
    registerLeagueCommands();
    registerLeagueLifecycleHandlers();

    _initialized = true;
    console.log(`[MonsterLeague] Initialized with hub map ${_content.hubMapNumber} and ${_content.gyms.length} gym(s)`);
}

export async function getLeaguePvpMetadata(
    challenger: ProxySession,
    target: ProxySession,
): Promise<BattleMetadata | null> {
    if (!_config || !_content) {
        return null;
    }

    if (!challenger.afkState?.active || !target.afkState?.active) {
        return null;
    }

    if (challenger.afkState.afkMapNumber !== _content.hallMapNumber || target.afkState.afkMapNumber !== _content.hallMapNumber) {
        return null;
    }

    const season = await ensureActiveLeagueSeason();
    const [challengerReg, targetReg] = await Promise.all([
        getLeagueRegistration(season.id, challenger.characterName),
        getLeagueRegistration(season.id, target.characterName),
    ]);

    if (!challengerReg || !targetReg) {
        return null;
    }

    return {
        mode: 'ranked',
        rankedSeasonId: season.id,
        rankedSeasonKey: season.seasonKey,
        challengerName: challenger.characterName,
        targetName: target.characterName,
        persistA: true,
        persistB: true,
    };
}

export async function onBattleFinalized(
    battle: BattleState,
    winner: BattleSide,
    reason: BattleEndReason,
    result: {
        sessionA: ProxySession | null | undefined;
        sessionB: ProxySession | null | undefined;
        winnerName: string;
        loserName: string;
    },
): Promise<void> {
    if (!_config || !_content) {
        return;
    }

    if (battle.metadata?.mode === 'ranked' && battle.type === 'pvp') {
        await finalizeRankedBattle(battle, winner, reason, result.sessionA, result.sessionB);
        return;
    }

    if (battle.metadata?.mode === 'trainer' && battle.type === 'trainer') {
        await finalizeTrainerBattle(battle, winner, result.sessionA);
    }
}

export async function claimLeagueRewards(session: ProxySession): Promise<string[]> {
    if (!_config || !_content || !_proxy) {
        return ['The league is not initialized yet.'];
    }

    const lines: string[] = [];
    const activeSeason = await ensureActiveLeagueSeason();
    const pendingGymRewards = await claimGymRewards(session, activeSeason.id);
    lines.push(...pendingGymRewards);

    const completedSeason = await getMostRecentCompletedLeagueSeason();
    if (completedSeason) {
        const rankedRewards = await claimRankingRewards(session, completedSeason);
        lines.push(...rankedRewards);
    }

    return lines.length > 0 ? lines : ['No league rewards are available to claim right now.'];
}

export async function getLeaguePanelState(limit = 10): Promise<MonsterLeaguePanelState> {
    if (!_config || !_content) {
        return {
            enabled: false,
            activeSeason: null,
            registrations: 0,
            standings: [],
            gymClears: [],
        };
    }

    const season = await ensureActiveLeagueSeason();
    const standings = await getLeagueStandings(season.id, limit);
    const registrationCount = await countLeagueRegistrations(season.id);
    const gymClears = await listRecentGymClears(season.id, limit);

    return {
        enabled: true,
        activeSeason: {
            id: season.id,
            seasonKey: season.seasonKey,
            startsAt: season.startsAt.toISOString(),
            endsAt: season.endsAt.toISOString(),
        },
        registrations: registrationCount,
        standings: standings.map(entry => ({
            rank: entry.rank,
            ownerName: entry.ownerName,
            rating: entry.rating,
            wins: entry.wins,
            losses: entry.losses,
            division: entry.division,
        })),
        gymClears,
    };
}

function registerLeagueLifecycleHandlers(): void {
    if (!_proxy) {
        return;
    }

    _proxy.on('session:end', session => {
        _dialogStates.delete(session.id);
    });
}

function registerLeagueCommands(): void {
    if (!_augmentation) {
        return;
    }

    _augmentation.commands.register('league', async (session, args) => {
        const action = (args[0] || '').toLowerCase();
        switch (action) {
            case 'enter':
            case 'hub':
                await enterLeagueHub(session);
                return;
            case 'register':
                await registerLeaguePlayer(session);
                return;
            case 'hall':
                await enterLeagueHall(session);
                return;
            case 'standings':
                await sendStandingsToChat(session);
                return;
            default:
                await sendLeagueSummaryToChat(session);
                return;
        }
    }, 'League registration, standings, and AFK hall travel', '[enter|register|hall|standings]');

    _augmentation.commands.register('gym', async (session, args) => {
        const target = (args[0] || '').toLowerCase();
        if (!target || target === 'status') {
            await sendGymSummaryToChat(session);
            return;
        }
        if (target === 'enter' || target === 'hub') {
            await enterLeagueHub(session);
            return;
        }
        await travelToGymTarget(session, target);
    }, 'View gym progress or travel to a gym room', '[status|enter|<gymId>|champion]');
}

function placeLeagueEntryNpc(): void {
    if (!_config || !_npcs) {
        return;
    }

    const serial = _npcs.placeNPC({
        name: _config.entryNpc.name,
        sprite: _config.entryNpc.sprite,
        x: _config.entryNpc.x,
        y: _config.entryNpc.y,
        mapNumber: _config.entryNpc.mapNumber,
        direction: _config.entryNpc.direction,
        creatureType: 2,
        persistent: false,
    });

    const npc = _npcs.getNPC(serial);
    if (npc) {
        npc.onInteract = (session, event) => {
            void handleLeagueNpcInteract(session, event, 'entry');
        };
    }
    _entryNpcSerial = serial;
}

function placeLeagueAfkNpcs(): void {
    if (!_content || !_npcs) {
        return;
    }

    placeLeagueNpc(_content.hubNpcs.gymGuide, 'Gym Guide', _content.hubMapNumber, 'gym_guide');
    placeLeagueNpc(_content.hubNpcs.leagueClerk, 'League Clerk', _content.hubMapNumber, 'league_clerk');
    placeLeagueNpc(_content.hubNpcs.healer, 'League Healer', _content.hubMapNumber, 'healer');
    placeLeagueNpc(_content.hubNpcs.exitKeeper, 'Return Keeper', _content.hubMapNumber, 'hub_exit');
    placeLeagueNpc(_content.hallNpcs?.standingsKeeper, 'Standings Keeper', _content.hallMapNumber, 'standings_keeper');
    placeLeagueNpc(_content.hallNpcs?.registrar, 'Hall Registrar', _content.hallMapNumber, 'hall_registrar');
    placeLeagueNpc(_content.hallNpcs?.exitKeeper, 'Hall Guide', _content.hallMapNumber, 'hall_exit');

    for (const gym of _content.gyms) {
        placeTrainerNpc(gym);
    }

    placeChampionNpc(_content.champion);
}

function placeLeagueNpc(
    source: LeagueContentConfig['hubNpcs']['gymGuide'] | undefined,
    fallbackName: string,
    fallbackMapNumber: number,
    role: LeagueDialogState['role'],
): void {
    if (!_npcs) {
        return;
    }

    const mapNumber = source?.mapNumber ?? fallbackMapNumber;
    const serial = _npcs.placeNPC({
        name: source?.name || fallbackName,
        sprite: source?.sprite || 1,
        x: source?.x ?? 34,
        y: source?.y ?? 35,
        mapNumber,
        direction: source?.direction ?? 2,
        creatureType: 2,
        persistent: false,
        worldScope: 'afk',
    });

    const npc = _npcs.getNPC(serial);
    if (npc) {
        npc.onInteract = (session, event) => {
            void handleLeagueNpcInteract(session, event, role);
        };
    }
}

function placeTrainerNpc(gym: GymTrainerConfig): void {
    if (!_npcs) {
        return;
    }

    const serial = _npcs.placeNPC({
        name: gym.trainerNpc.name || gym.name,
        sprite: gym.trainerNpc.sprite || 1,
        x: gym.trainerNpc.x,
        y: gym.trainerNpc.y,
        mapNumber: gym.trainerNpc.mapNumber || gym.mapNumber,
        direction: gym.trainerNpc.direction ?? 2,
        creatureType: 2,
        persistent: false,
        worldScope: 'afk',
    });

    const npc = _npcs.getNPC(serial);
    if (npc) {
        npc.onInteract = (session, event) => {
            if (event.type === 'click') {
                void startGymBattle(session, gym, npc);
            }
        };
    }
}

function placeChampionNpc(champion: ChampionTrainerConfig): void {
    if (!_npcs) {
        return;
    }

    const serial = _npcs.placeNPC({
        name: champion.trainerNpc.name || champion.name,
        sprite: champion.trainerNpc.sprite || 1,
        x: champion.trainerNpc.x,
        y: champion.trainerNpc.y,
        mapNumber: champion.trainerNpc.mapNumber || champion.mapNumber,
        direction: champion.trainerNpc.direction ?? 2,
        creatureType: 2,
        persistent: false,
        worldScope: 'afk',
    });

    const npc = _npcs.getNPC(serial);
    if (npc) {
        npc.onInteract = (session, event) => {
            if (event.type === 'click') {
                void startChampionBattle(session, champion, npc);
            }
        };
    }
}

async function handleLeagueNpcInteract(
    session: ProxySession,
    event: DialogEvent,
    role: LeagueDialogState['role'],
): Promise<void> {
    if (!_dialogs || !_chat) {
        return;
    }

    if (event.type === 'click') {
        _dialogStates.set(session.id, { entityId: event.entityId, role });
        switch (role) {
            case 'entry':
                showEntryMenu(session, event.entityId);
                return;
            case 'gym_guide':
                await showGymGuideMenu(session, event.entityId);
                return;
            case 'league_clerk':
            case 'hall_registrar':
                await showLeagueClerkMenu(session, event.entityId);
                return;
            case 'healer':
                await healLeagueMonsters(session, event.entityId);
                return;
            case 'hub_exit':
                showExitMenu(session, event.entityId, 'Return to the live world?');
                return;
            case 'standings_keeper':
                await showStandingsPopup(session, event.entityId);
                return;
            case 'hall_exit':
                showExitMenu(session, event.entityId, 'Travel back to the hub?');
                return;
        }
    }

    const state = _dialogStates.get(session.id);
    if (!state) {
        return;
    }

    if (event.type === 'menuChoice') {
        const choice = event.pursuitId > 0 ? event.pursuitId : event.slot + 1;
        await handleLeagueMenuChoice(session, state, choice);
        return;
    }

    if (event.type === 'dialogChoice') {
        _dialogStates.delete(session.id);
    }
}

async function handleLeagueMenuChoice(
    session: ProxySession,
    state: LeagueDialogState,
    choice: number,
): Promise<void> {
    switch (state.role) {
        case 'entry':
            await handleEntryChoice(session, state.entityId, choice);
            return;
        case 'gym_guide':
            await handleGymGuideChoice(session, choice);
            return;
        case 'league_clerk':
        case 'hall_registrar':
            await handleLeagueClerkChoice(session, state.entityId, choice);
            return;
        case 'hub_exit':
            if (choice === 1) {
                await exitLeagueWorld(session);
            }
            _dialogStates.delete(session.id);
            return;
        case 'hall_exit':
            if (choice === 1) {
                await enterLeagueHub(session);
            }
            _dialogStates.delete(session.id);
            return;
        default:
            _dialogStates.delete(session.id);
    }
}

function showEntryMenu(session: ProxySession, entityId: number): void {
    const target = getDialogTarget(entityId, 'League Registrar');
    if (!_dialogs) {
        return;
    }

    _dialogs.sendDialogMenu(session, {
        menuType: 0,
        entityId: target.entityId,
        sprite: target.sprite,
        name: target.name,
        text: 'Welcome to the Proxy Monster League. What do you need?',
        menuOptions: [
            { text: 'Enter League Hub', pursuitId: 1 },
            { text: 'Register For Current Season', pursuitId: 2 },
            { text: 'Season Standings', pursuitId: 3 },
            { text: 'My Division', pursuitId: 4 },
            { text: 'Claim League Rewards', pursuitId: 5 },
            { text: 'Goodbye', pursuitId: 6 },
        ],
    });
}

async function showGymGuideMenu(session: ProxySession, entityId: number): Promise<void> {
    if (!_dialogs || !_content) {
        return;
    }

    const target = getDialogTarget(entityId, 'Gym Guide');
    const progress = await getGymProgressSummary(session.characterName);
    const options = _content.gyms.map((gym, index) => ({
        text: `${gym.name}${progress.clearedGymIds.has(gym.id) ? ' [CLEARED]' : ''}`,
        pursuitId: index + 1,
    }));

    options.push({
        text: progress.allGymsCleared ? `${_content.champion.name} Chamber` : `${_content.champion.name} Chamber [LOCKED]`,
        pursuitId: 90,
    });
    options.push({ text: 'Ranked Hall', pursuitId: 91 });
    options.push({ text: 'Close', pursuitId: 99 });

    _dialogs.sendDialogMenu(session, {
        menuType: 0,
        entityId: target.entityId,
        sprite: target.sprite,
        name: target.name,
        text: 'Pick a room and I will send you there.',
        menuOptions: options,
    });
}

async function showLeagueClerkMenu(session: ProxySession, entityId: number): Promise<void> {
    const target = getDialogTarget(entityId, 'League Clerk');
    if (!_dialogs) {
        return;
    }

    _dialogs.sendDialogMenu(session, {
        menuType: 0,
        entityId: target.entityId,
        sprite: target.sprite,
        name: target.name,
        text: 'I manage registrations, standings, and rewards.',
        menuOptions: [
            { text: 'Register For Current Season', pursuitId: 1 },
            { text: 'Show Standings', pursuitId: 2 },
            { text: 'Show My Division', pursuitId: 3 },
            { text: 'Claim League Rewards', pursuitId: 4 },
            { text: 'Close', pursuitId: 5 },
        ],
    });
}

function showExitMenu(session: ProxySession, entityId: number, text: string): void {
    const target = getDialogTarget(entityId, 'Guide');
    if (!_dialogs) {
        return;
    }

    _dialogs.sendDialogMenu(session, {
        menuType: 0,
        entityId: target.entityId,
        sprite: target.sprite,
        name: target.name,
        text,
        menuOptions: [
            { text: 'Yes', pursuitId: 1 },
            { text: 'No', pursuitId: 2 },
        ],
    });
}

async function handleEntryChoice(session: ProxySession, entityId: number, choice: number): Promise<void> {
    switch (choice) {
        case 1:
            await enterLeagueHub(session);
            break;
        case 2:
            await registerLeaguePlayer(session);
            break;
        case 3:
            await showStandingsPopup(session, entityId);
            break;
        case 4:
            await showDivisionPopup(session, entityId);
            break;
        case 5:
            await showClaimPopup(session, entityId);
            break;
        default:
            break;
    }
}

async function handleGymGuideChoice(session: ProxySession, choice: number): Promise<void> {
    if (!_content) {
        return;
    }

    if (choice >= 1 && choice <= _content.gyms.length) {
        const gym = _content.gyms[choice - 1];
        await travelToGymRoom(session, gym);
        return;
    }

    if (choice === 90) {
        await travelToChampionRoom(session);
        return;
    }

    if (choice === 91) {
        await enterLeagueHall(session);
        return;
    }
}

async function handleLeagueClerkChoice(session: ProxySession, entityId: number, choice: number): Promise<void> {
    switch (choice) {
        case 1:
            await registerLeaguePlayer(session);
            break;
        case 2:
            await showStandingsPopup(session, entityId);
            break;
        case 3:
            await showDivisionPopup(session, entityId);
            break;
        case 4:
            await showClaimPopup(session, entityId);
            break;
        default:
            break;
    }
}

async function showStandingsPopup(session: ProxySession, entityId?: number): Promise<void> {
    const season = await ensureActiveLeagueSeason();
    const standings = await getLeagueStandings(season.id, _config?.leaderboardSize || 8);
    const lines = [`Season ${season.seasonKey}`, ''];

    if (standings.length === 0) {
        lines.push('No players are registered yet.');
    } else {
        for (const entry of standings) {
            lines.push(`#${entry.rank} ${entry.ownerName} - ${entry.rating} (${entry.division}) ${entry.wins}W/${entry.losses}L`);
        }
    }

    sendLeaguePopup(session, entityId, lines.join('\n'));
}

async function showDivisionPopup(session: ProxySession, entityId?: number): Promise<void> {
    const season = await ensureActiveLeagueSeason();
    const registration = await getLeagueRegistration(season.id, session.characterName);
    if (!registration) {
        sendLeaguePopup(session, entityId, 'You are not registered for the current season yet.');
        return;
    }

    const rank = await getLeagueRank(season.id, session.characterName);
    sendLeaguePopup(
        session,
        entityId,
        [
            `Season ${season.seasonKey}`,
            '',
            `Rating: ${registration.rating}`,
            `Division: ${getLeagueDivision(registration.rating)}`,
            `Record: ${registration.wins}W / ${registration.losses}L`,
            `Rank: ${rank > 0 ? `#${rank}` : 'Unranked'}`,
        ].join('\n'),
    );
}

async function showClaimPopup(session: ProxySession, entityId?: number): Promise<void> {
    const lines = await claimLeagueRewards(session);
    sendLeaguePopup(session, entityId, lines.join('\n'));
}

async function healLeagueMonsters(session: ProxySession, entityId?: number): Promise<void> {
    const healed = await healMonstersByOwner(session.characterName);
    await refreshCompanion(session).catch(() => undefined);
    sendLeaguePopup(
        session,
        entityId,
        healed > 0
            ? `Your monsters are rested and ready. ${healed} monster${healed === 1 ? '' : 's'} healed.`
            : 'No monsters needed healing.',
    );
}

async function startGymBattle(session: ProxySession, gym: GymTrainerConfig, npc: VirtualNPC): Promise<void> {
    if (!_chat) {
        return;
    }

    const trainerMonster = buildTrainerMonster(gym.name, gym.monster);
    await startTrainerBattle(session, gym.name, trainerMonster, {
        mode: 'trainer',
        trainerKind: 'gym',
        gymId: gym.id,
        trainerId: gym.id,
        trainerName: gym.name,
        playerName: session.characterName,
        rewardMonsterXp: gym.rewardMonsterXp ?? 0,
        persistA: true,
        persistB: false,
    });
}

async function startChampionBattle(session: ProxySession, champion: ChampionTrainerConfig, _npc: VirtualNPC): Promise<void> {
    const progress = await getGymProgressSummary(session.characterName);
    if (!progress.allGymsCleared) {
        _chat?.systemMessage(session, monsterDanger('Clear every gym badge in the current season before facing the champion.'));
        return;
    }

    const trainerMonster = buildTrainerMonster(champion.name, champion.monster);
    await startTrainerBattle(session, champion.name, trainerMonster, {
        mode: 'trainer',
        trainerKind: 'champion',
        gymId: champion.id,
        trainerId: champion.id,
        trainerName: champion.name,
        playerName: session.characterName,
        rewardMonsterXp: champion.rewardMonsterXp ?? 0,
        persistA: true,
        persistB: false,
    });
}

async function finalizeTrainerBattle(
    battle: BattleState,
    winner: BattleSide,
    sessionA: ProxySession | null | undefined,
): Promise<void> {
    if (!_content || !_proxy || !sessionA || winner !== 'a') {
        return;
    }

    const season = await ensureActiveLeagueSeason();
    const ownerName = sessionA.characterName;
    const gymId = battle.metadata?.gymId || battle.metadata?.trainerId || '';
    if (!gymId) {
        return;
    }

    const isChampion = battle.metadata?.trainerKind === 'champion';
    await upsertGymClear(season.id, ownerName, gymId, isChampion);

    if ((battle.metadata?.rewardMonsterXp || 0) > 0) {
        await grantTrainerBattleXp(battle, season.id, ownerName, gymId, battle.metadata?.rewardMonsterXp || 0);
    }

    const rewardConfig = isChampion
        ? _content.champion.clearReward
        : _content.gyms.find(entry => entry.id === gymId)?.badgeReward;
    if (rewardConfig) {
        _chat?.systemMessage(
            sessionA,
            monsterSuccess(`${rewardConfig.kind === 'legend' ? 'A new league reward is ready.' : 'A league reward is ready.'} Use /claim league or speak to the clerk.`),
        );
    } else {
        _chat?.systemMessage(
            sessionA,
            monsterSuccess(isChampion ? 'Champion clear recorded for this season.' : 'Gym clear recorded for this season.'),
        );
    }
}

async function finalizeRankedBattle(
    battle: BattleState,
    winner: BattleSide,
    reason: BattleEndReason,
    sessionA: ProxySession | null | undefined,
    sessionB: ProxySession | null | undefined,
): Promise<void> {
    const seasonId = battle.metadata?.rankedSeasonId;
    if (!seasonId || !sessionA || !sessionB) {
        return;
    }

    const challengerName = battle.metadata?.challengerName || sessionA.characterName;
    const targetName = battle.metadata?.targetName || sessionB.characterName;
    const winnerOwner = winner === 'a' ? sessionA.characterName : sessionB.characterName;
    const loserOwner = winner === 'a' ? sessionB.characterName : sessionA.characterName;
    const ratingChange = await recordLeagueMatch({
        seasonId,
        battleId: battle.id,
        challengerName,
        targetName,
        winnerName: winnerOwner,
        loserName: loserOwner,
        reason,
    });

    if (!ratingChange || !_chat) {
        return;
    }

    _chat.systemMessage(
        sessionA,
        monsterNotice(`Ranked result: ${winnerOwner} +${ratingChange.winnerDelta}, ${loserOwner} ${ratingChange.loserDelta}.`),
    );
    _chat.systemMessage(
        sessionB,
        monsterNotice(`Ranked result: ${winnerOwner} +${ratingChange.winnerDelta}, ${loserOwner} ${ratingChange.loserDelta}.`),
    );
}

async function claimGymRewards(session: ProxySession, seasonId: number): Promise<string[]> {
    if (!_content || !_proxy) {
        return [];
    }
    const content = _content;

    const lines: string[] = [];
    const progressRows = await listGymProgress(seasonId, session.characterName);

    for (const gym of content.gyms) {
        const progress = progressRows.find(row => row.gymId === gym.id);
        if (!progress?.clearedAt || progress.badgeClaimedAt || !gym.badgeReward) {
            continue;
        }

        const reward = toProxyFeatureReward(gym.badgeReward, `season:${seasonId}:gym:${gym.id}`);
        if (!reward) {
            continue;
        }

        const result = await grantProxyReward(
            _proxy,
            FEATURE_KEY,
            session.characterName,
            reward,
            seasonId,
        );
        if (result.status !== 'failed') {
            await markGymRewardClaimed(seasonId, session.characterName, gym.id);
        }
        lines.push(`${gym.name}: ${result.summary}`);
    }

    const championProgress = progressRows.find(row => row.gymId === content.champion.id);
    if (championProgress?.clearedAt && !championProgress.badgeClaimedAt && content.champion.clearReward) {
        const reward = toProxyFeatureReward(
            content.champion.clearReward,
            `season:${seasonId}:champion:${content.champion.id}`,
        );
        if (!reward) {
            return lines;
        }
        const result = await grantProxyReward(
            _proxy,
            FEATURE_KEY,
            session.characterName,
            reward,
            seasonId,
        );
        if (result.status !== 'failed') {
            await markGymRewardClaimed(seasonId, session.characterName, content.champion.id);
        }
        lines.push(`${content.champion.name}: ${result.summary}`);
    }

    return lines;
}

async function claimRankingRewards(session: ProxySession, season: MonsterLeagueSeason): Promise<string[]> {
    if (!_proxy || !_content) {
        return [];
    }

    const rank = await getLeagueRank(season.id, session.characterName);
    if (rank <= 0) {
        return [];
    }

    const rewardTiers = _content.rankRewards && _content.rankRewards.length > 0
        ? _content.rankRewards
        : _config?.rankRewards || [];
    const tier = rewardTiers.find(entry => rank <= entry.maxRank);
    if (!tier) {
        return [];
    }

    const lines: string[] = [];
    for (const reward of tier.rewards) {
        const scopedReward = toProxyFeatureReward(reward, `season:${season.id}:rank:${tier.maxRank}`);
        if (!scopedReward) {
            continue;
        }
        const result = await grantProxyReward(
            _proxy,
            FEATURE_KEY,
            session.characterName,
            scopedReward,
            season.id,
        );
        lines.push(`Season ${season.seasonKey} rank #${rank}: ${result.summary}`);
    }

    return lines;
}

async function grantTrainerBattleXp(
    battle: BattleState,
    seasonId: number,
    ownerName: string,
    gymId: string,
    xp: number,
): Promise<void> {
    if (xp <= 0) {
        return;
    }

    const grant = await pool.query<{ id: number }>(
        'INSERT INTO proxy_reward_grants (feature_key, reward_key, owner_name, season_id, reward_kind, payload) ' +
        'VALUES ($1, $2, $3, $4, $5, $6::jsonb) ' +
        'ON CONFLICT (feature_key, reward_key, owner_name, season_id) DO NOTHING ' +
        'RETURNING id',
        [
            FEATURE_KEY,
            `season:${seasonId}:trainer_xp:${gymId}`,
            ownerName,
            seasonId,
            'monster_xp',
            JSON.stringify({ xp, gymId }),
        ],
    );

    if (grant.rows.length === 0) {
        return;
    }

    const monster = battle.monA.monster;
    let remaining = xp;
    while (remaining > 0) {
        const needed = Math.max(1, monster.xpToNext - monster.xp);
        const spend = Math.min(needed, remaining);
        monster.xp += spend;
        remaining -= spend;

        while (monster.xp >= monster.xpToNext) {
            monster.xp -= monster.xpToNext;
            monster.level += 1;
            monster.xpToNext = calculateXpToNext(monster.level);
        }
    }

    await updateMonster(monster);
    const session = _proxy?.sessions.get(battle.trainerA);
    if (session && !session.destroyed) {
        await refreshCompanion(session).catch(() => undefined);
        _chat?.systemMessage(session, monsterSuccess(`${monster.nickname} gained an extra ${xp} league XP.`));
    }
}

async function registerLeaguePlayer(session: ProxySession): Promise<void> {
    if (!_chat) {
        return;
    }

    const season = await ensureActiveLeagueSeason();
    const result = await pool.query(
        'INSERT INTO monster_league_registrations (season_id, owner_name, rating, wins, losses, draws, registered_at) ' +
        'VALUES ($1, $2, $3, 0, 0, 0, NOW()) ' +
        'ON CONFLICT (season_id, owner_name) DO NOTHING',
        [season.id, session.characterName, DEFAULT_RATING],
    );

    if ((result.rowCount ?? 0) > 0) {
        _chat.systemMessage(session, monsterSuccess(`Registered for season ${season.seasonKey}. Starting rating: ${DEFAULT_RATING}.`));
    } else {
        _chat.systemMessage(session, monsterNotice(`You are already registered for season ${season.seasonKey}.`));
    }
}

async function sendLeagueSummaryToChat(session: ProxySession): Promise<void> {
    if (!_chat) {
        return;
    }

    const season = await ensureActiveLeagueSeason();
    const registration = await getLeagueRegistration(season.id, session.characterName);
    const rank = registration ? await getLeagueRank(season.id, session.characterName) : 0;
    const standings = await getLeagueStandings(season.id, 5);

    _chat.systemMessage(session, monsterNotice(`Season ${season.seasonKey} ends ${season.endsAt.toISOString()}`));
    if (registration) {
        _chat.systemMessage(
            session,
            monsterNotice(`You are registered: ${registration.rating} rating (${getLeagueDivision(registration.rating)}) ${registration.wins}W/${registration.losses}L rank ${rank > 0 ? `#${rank}` : 'n/a'}`),
        );
    } else {
        _chat.systemMessage(session, monsterDanger('You are not registered yet. Use /league register or speak to the registrar.'));
    }

    if (standings.length > 0) {
        _chat.systemMessage(session, monsterNotice('Top standings:'));
        for (const entry of standings) {
            _chat.systemMessage(
                session,
                monsterNotice(`#${entry.rank} ${entry.ownerName} ${entry.rating} (${entry.division}) ${entry.wins}W/${entry.losses}L`),
            );
        }
    }

    _chat.systemMessage(session, monsterNotice('Use /league enter for the hub or /league hall for ranked battles.'));
}

async function sendGymSummaryToChat(session: ProxySession): Promise<void> {
    if (!_chat || !_content) {
        return;
    }

    const progress = await getGymProgressSummary(session.characterName);
    _chat.systemMessage(session, monsterNotice(`Gym progress for season ${progress.season.seasonKey}:`));
    for (const gym of _content.gyms) {
        const cleared = progress.clearedGymIds.has(gym.id) ? 'CLEARED' : 'OPEN';
        _chat.systemMessage(session, monsterNotice(`${gym.id}: ${gym.name} - ${cleared}`));
    }
    _chat.systemMessage(
        session,
        monsterNotice(`${_content.champion.id}: ${_content.champion.name} - ${progress.allGymsCleared ? 'UNLOCKED' : 'LOCKED'}`),
    );
}

async function sendStandingsToChat(session: ProxySession): Promise<void> {
    if (!_chat) {
        return;
    }

    const season = await ensureActiveLeagueSeason();
    const standings = await getLeagueStandings(season.id, _config?.leaderboardSize || 8);
    if (standings.length === 0) {
        _chat.systemMessage(session, monsterDanger('No players are registered for the current season yet.'));
        return;
    }

    _chat.systemMessage(session, monsterNotice(`Season ${season.seasonKey} standings:`));
    for (const entry of standings) {
        _chat.systemMessage(
            session,
            monsterNotice(`#${entry.rank} ${entry.ownerName} ${entry.rating} (${entry.division}) ${entry.wins}W/${entry.losses}L`),
        );
    }
}

async function travelToGymTarget(session: ProxySession, target: string): Promise<void> {
    if (!_content) {
        return;
    }

    if (target === 'champion') {
        await travelToChampionRoom(session);
        return;
    }

    const gym = _content.gyms.find(entry => entry.id.toLowerCase() === target || entry.name.toLowerCase() === target);
    if (!gym) {
        _chat?.systemMessage(session, monsterDanger(`Unknown gym "${target}".`));
        return;
    }

    await travelToGymRoom(session, gym);
}

async function travelToGymRoom(session: ProxySession, gym: GymTrainerConfig): Promise<void> {
    await ensureLeagueTeleport(session, gym.mapNumber, gym.spawnX, gym.spawnY, gym.name);
}

async function travelToChampionRoom(session: ProxySession): Promise<void> {
    if (!_content) {
        return;
    }

    const progress = await getGymProgressSummary(session.characterName);
    if (!progress.allGymsCleared) {
        _chat?.systemMessage(session, monsterDanger('You must clear all gyms in the current season first.'));
        return;
    }

    await ensureLeagueTeleport(
        session,
        _content.champion.mapNumber,
        _content.champion.spawnX,
        _content.champion.spawnY,
        _content.champion.name,
    );
}

async function enterLeagueHub(session: ProxySession): Promise<void> {
    if (!_content) {
        return;
    }

    await ensureLeagueTeleport(session, _content.hubMapNumber, _content.hubSpawnX, _content.hubSpawnY, 'League Hub');
}

async function enterLeagueHall(session: ProxySession): Promise<void> {
    if (!_content) {
        return;
    }

    await ensureLeagueTeleport(session, _content.hallMapNumber, _content.hallSpawnX, _content.hallSpawnY, 'Ranked Hall');
}

async function exitLeagueWorld(session: ProxySession): Promise<void> {
    if (!_augmentation || !_chat) {
        return;
    }

    if (!session.afkState?.active) {
        _chat.systemMessage(session, monsterNotice('You are already in the live world.'));
        return;
    }

    await _augmentation.commands.execute(session, 'afk', [], 'afk');
}

async function ensureLeagueTeleport(
    session: ProxySession,
    mapNumber: number,
    x: number,
    y: number,
    label: string,
): Promise<void> {
    if (!_proxy || !_augmentation || !_chat) {
        return;
    }

    if (session.afkState?.active) {
        _proxy.emit('afk:teleportToMap', session, mapNumber, x, y, label);
        return;
    }

    await _augmentation.commands.execute(session, 'afk', [], 'afk');
    setTimeout(() => {
        if (session.afkState?.active && _proxy) {
            _proxy.emit('afk:teleportToMap', session, mapNumber, x, y, label);
        }
    }, 200);
}

function sendLeaguePopup(session: ProxySession, entityId: number | undefined, text: string): void {
    const target = getDialogTarget(entityId, 'League Clerk');
    if (!_dialogs) {
        return;
    }

    _dialogs.sendDialog(session, {
        type: DialogType.Popup,
        entityId: target.entityId,
        sprite: target.sprite,
        name: target.name,
        text,
        pursuitId: 1,
        stepId: 0,
        hasPrevious: false,
        hasNext: false,
    });
}

function getDialogTarget(entityId: number | undefined, fallbackName: string): { entityId: number; sprite: number; name: string } {
    const npc = entityId && _npcs ? _npcs.getNPC(entityId) : undefined;
    return {
        entityId: npc ? npc.serial : (entityId || _entryNpcSerial),
        sprite: npc ? npc.sprite : 1,
        name: npc ? npc.name : fallbackName,
    };
}

function resolveLeagueConfig(config?: MonsterLeagueConfig): ResolvedLeagueConfig {
    return {
        enabled: config?.enabled !== false,
        seasonDurationDays: Math.max(1, Math.floor(config?.seasonDurationDays ?? 7)),
        dailyResetHour: clampInt(config?.dailyResetHour ?? 0, 0, 23),
        timezone: normalizeText(config?.timezone, 'America/Chicago'),
        leaderboardSize: Math.max(3, Math.floor(config?.leaderboardSize ?? 8)),
        contentFile: normalizeText(config?.contentFile, DEFAULT_CONTENT_FILE),
        entryNpc: {
            mapNumber: Math.max(1, Math.floor(config?.entryNpc?.mapNumber ?? 3006)),
            x: Math.max(1, Math.floor(config?.entryNpc?.x ?? 8)),
            y: Math.max(1, Math.floor(config?.entryNpc?.y ?? 11)),
            direction: clampInt(config?.entryNpc?.direction ?? 2, 0, 3),
            sprite: Math.max(1, Math.floor(config?.entryNpc?.sprite ?? 1)),
            name: normalizeText(config?.entryNpc?.name, 'League Registrar'),
        },
        rankRewards: Array.isArray(config?.rankRewards) ? config!.rankRewards : [],
    };
}

function loadLeagueContent(filePath: string, fallbackRankRewards: RankingRewardTier[]): LeagueContentConfig {
    const resolved = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(process.cwd(), filePath);
    const raw = JSON.parse(fs.readFileSync(resolved, 'utf8')) as LeagueContentConfig;

    return {
        ...raw,
        rankRewards: Array.isArray(raw.rankRewards) && raw.rankRewards.length > 0 ? raw.rankRewards : fallbackRankRewards,
    };
}

function buildTrainerMonster(ownerName: string, template: GymTrainerConfig['monster']): CapturedMonster {
    const species = getSpeciesByName(template.speciesName);
    if (!species) {
        throw new Error(`[MonsterLeague] Unknown species "${template.speciesName}" in league content.`);
    }

    const level = Math.max(1, Math.floor(template.level));
    const nature = template.nature || getRandomNature();
    const moves = (template.moves && template.moves.length > 0 ? template.moves : getMovesForLevel(species, level)).slice(0, 4);
    while (moves.length < 4) {
        moves.push(null);
    }

    const hp = calculateHp(species.baseHp, level);
    return {
        id: 0,
        ownerName,
        speciesName: species.name,
        sprite: species.sprite,
        nickname: template.nickname || species.name,
        level,
        xp: 0,
        xpToNext: calculateXpToNext(level),
        hp,
        maxHp: hp,
        atk: calculateStat(species.baseAtk, level, nature, 'atk'),
        def: calculateStat(species.baseDef, level, nature, 'def'),
        spd: calculateStat(species.baseSpd, level, nature, 'spd'),
        spAtk: calculateStat(species.baseSpAtk, level, nature, 'spAtk'),
        spDef: calculateStat(species.baseSpDef, level, nature, 'spDef'),
        nature,
        moves,
        wins: 0,
        losses: 0,
        isActive: false,
        companionOut: false,
        capturedAt: new Date(),
    };
}

async function getGymProgressSummary(ownerName: string): Promise<{
    season: MonsterLeagueSeason;
    progress: LeagueGymProgress[];
    clearedGymIds: Set<string>;
    allGymsCleared: boolean;
}> {
    const season = await ensureActiveLeagueSeason();
    const progress = await listGymProgress(season.id, ownerName);
    const clearedGymIds = new Set(
        progress
            .filter(entry => entry.clearedAt && _content?.gyms.some(gym => gym.id === entry.gymId))
            .map(entry => entry.gymId),
    );

    return {
        season,
        progress,
        clearedGymIds,
        allGymsCleared: (_content?.gyms || []).every(gym => clearedGymIds.has(gym.id)),
    };
}

async function ensureLeagueSchema(): Promise<void> {
    if (_schemaReady) {
        return _schemaReady;
    }

    _schemaReady = (async () => {
        await ensureProxyEventSchema();
        await pool.query([
            'CREATE TABLE IF NOT EXISTS monster_league_seasons (',
            '  id SERIAL PRIMARY KEY,',
            '  proxy_season_id INTEGER NOT NULL UNIQUE REFERENCES proxy_event_seasons(id) ON DELETE CASCADE,',
            '  season_key VARCHAR(120) NOT NULL UNIQUE,',
            '  starts_at TIMESTAMPTZ NOT NULL,',
            '  ends_at TIMESTAMPTZ NOT NULL,',
            '  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
            '  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
            ')',
        ].join('\n'));

        await pool.query([
            'CREATE TABLE IF NOT EXISTS monster_league_registrations (',
            '  id SERIAL PRIMARY KEY,',
            '  season_id INTEGER NOT NULL REFERENCES monster_league_seasons(id) ON DELETE CASCADE,',
            '  owner_name VARCHAR(50) NOT NULL,',
            '  rating INTEGER NOT NULL DEFAULT 1000,',
            '  wins INTEGER NOT NULL DEFAULT 0,',
            '  losses INTEGER NOT NULL DEFAULT 0,',
            '  draws INTEGER NOT NULL DEFAULT 0,',
            '  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
            '  last_match_at TIMESTAMPTZ,',
            '  reward_claimed_at TIMESTAMPTZ,',
            '  UNIQUE(season_id, owner_name)',
            ')',
        ].join('\n'));

        await pool.query([
            'CREATE TABLE IF NOT EXISTS monster_league_matches (',
            '  id SERIAL PRIMARY KEY,',
            '  season_id INTEGER NOT NULL REFERENCES monster_league_seasons(id) ON DELETE CASCADE,',
            '  battle_id VARCHAR(80) NOT NULL,',
            '  challenger_name VARCHAR(50) NOT NULL,',
            '  target_name VARCHAR(50) NOT NULL,',
            '  winner_name VARCHAR(50) NOT NULL,',
            '  loser_name VARCHAR(50) NOT NULL,',
            '  winner_rating_before INTEGER NOT NULL,',
            '  winner_rating_after INTEGER NOT NULL,',
            '  loser_rating_before INTEGER NOT NULL,',
            '  loser_rating_after INTEGER NOT NULL,',
            '  result_reason VARCHAR(30) NOT NULL,',
            '  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
            '  UNIQUE(season_id, battle_id)',
            ')',
        ].join('\n'));

        await pool.query([
            'CREATE TABLE IF NOT EXISTS monster_gym_progress (',
            '  id SERIAL PRIMARY KEY,',
            '  season_id INTEGER NOT NULL REFERENCES monster_league_seasons(id) ON DELETE CASCADE,',
            '  owner_name VARCHAR(50) NOT NULL,',
            '  gym_id VARCHAR(60) NOT NULL,',
            '  cleared_at TIMESTAMPTZ,',
            '  badge_claimed_at TIMESTAMPTZ,',
            '  champion_cleared_at TIMESTAMPTZ,',
            '  UNIQUE(season_id, owner_name, gym_id)',
            ')',
        ].join('\n'));

        await pool.query('CREATE INDEX IF NOT EXISTS idx_monster_league_registrations_rating ON monster_league_registrations(season_id, rating DESC, wins DESC, losses ASC)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_monster_league_matches_season ON monster_league_matches(season_id, completed_at DESC)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_monster_gym_progress_player ON monster_gym_progress(season_id, owner_name)');
    })().catch((err: Error) => {
        _schemaReady = null;
        throw err;
    });

    return _schemaReady;
}

async function ensureActiveLeagueSeason(now = new Date()): Promise<MonsterLeagueSeason> {
    await ensureLeagueSchema();
    if (!_config) {
        throw new Error('Monster league config is not ready.');
    }

    const proxySeason = await ensureActiveProxyEventSeason({
        featureKey: FEATURE_KEY,
        durationDays: _config.seasonDurationDays,
        timezone: _config.timezone,
        resetHour: _config.dailyResetHour,
        now,
    });

    return upsertLeagueSeason(proxySeason);
}

async function upsertLeagueSeason(proxySeason: ProxyEventSeason): Promise<MonsterLeagueSeason> {
    const result = await pool.query<LeagueSeasonRow>(
        'INSERT INTO monster_league_seasons (proxy_season_id, season_key, starts_at, ends_at, updated_at) ' +
        'VALUES ($1, $2, $3, $4, NOW()) ' +
        'ON CONFLICT (proxy_season_id) DO UPDATE SET season_key = EXCLUDED.season_key, starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, updated_at = NOW() ' +
        'RETURNING *',
        [proxySeason.id, proxySeason.seasonKey, proxySeason.startsAt, proxySeason.endsAt],
    );

    return mapLeagueSeason(result.rows[0]);
}

async function getMostRecentCompletedLeagueSeason(): Promise<MonsterLeagueSeason | null> {
    if (!_config) {
        return null;
    }

    const proxySeason = await getMostRecentCompletedProxyEventSeason(FEATURE_KEY);
    if (!proxySeason) {
        return null;
    }

    const result = await pool.query<LeagueSeasonRow>(
        'SELECT * FROM monster_league_seasons WHERE proxy_season_id = $1 LIMIT 1',
        [proxySeason.id],
    );

    if (result.rows[0]) {
        return mapLeagueSeason(result.rows[0]);
    }

    return upsertLeagueSeason(proxySeason);
}

async function getLeagueRegistration(seasonId: number, ownerName: string): Promise<MonsterLeagueRegistration | null> {
    const result = await pool.query<LeagueRegistrationRow>(
        'SELECT * FROM monster_league_registrations WHERE season_id = $1 AND owner_name = $2 LIMIT 1',
        [seasonId, ownerName],
    );

    return result.rows[0] ? mapLeagueRegistration(result.rows[0]) : null;
}

async function getLeagueStandings(seasonId: number, limit: number): Promise<LeagueStanding[]> {
    const result = await pool.query<LeagueRegistrationRow>(
        'SELECT * FROM monster_league_registrations WHERE season_id = $1 ORDER BY rating DESC, wins DESC, losses ASC, registered_at ASC LIMIT $2',
        [seasonId, limit],
    );

    return result.rows.map((row, index) => ({
        ...mapLeagueRegistration(row),
        rank: index + 1,
        division: getLeagueDivision(row.rating),
    }));
}

async function getLeagueRank(seasonId: number, ownerName: string): Promise<number> {
    const result = await pool.query<{ owner_name: string; rank: string }>(
        'SELECT owner_name, rank FROM (' +
        '  SELECT owner_name, ROW_NUMBER() OVER (ORDER BY rating DESC, wins DESC, losses ASC, registered_at ASC) AS rank ' +
        '  FROM monster_league_registrations WHERE season_id = $1' +
        ') ranked WHERE owner_name = $2 LIMIT 1',
        [seasonId, ownerName],
    );

    return result.rows[0] ? parseInt(result.rows[0].rank, 10) : 0;
}

async function countLeagueRegistrations(seasonId: number): Promise<number> {
    const result = await pool.query<{ count: string }>(
        'SELECT COUNT(*) AS count FROM monster_league_registrations WHERE season_id = $1',
        [seasonId],
    );
    return parseInt(result.rows[0]?.count || '0', 10);
}

async function listGymProgress(seasonId: number, ownerName: string): Promise<LeagueGymProgress[]> {
    const result = await pool.query<GymProgressRow>(
        'SELECT season_id, owner_name, gym_id, cleared_at, badge_claimed_at, champion_cleared_at ' +
        'FROM monster_gym_progress WHERE season_id = $1 AND owner_name = $2 ORDER BY gym_id ASC',
        [seasonId, ownerName],
    );

    return result.rows.map(row => ({
        gymId: row.gym_id,
        clearedAt: row.cleared_at,
        badgeClaimedAt: row.badge_claimed_at,
        championClearedAt: row.champion_cleared_at,
    }));
}

async function listRecentGymClears(seasonId: number, limit: number): Promise<Array<{
    ownerName: string;
    gymId: string;
    clearedAt: string;
    seasonId: number;
}>> {
    const result = await pool.query<{
        owner_name: string;
        gym_id: string;
        cleared_at: Date;
        season_id: number;
    }>(
        'SELECT owner_name, gym_id, cleared_at, season_id FROM monster_gym_progress ' +
        'WHERE season_id = $1 AND cleared_at IS NOT NULL ORDER BY cleared_at DESC LIMIT $2',
        [seasonId, limit],
    );

    return result.rows.map(row => ({
        ownerName: row.owner_name,
        gymId: row.gym_id,
        clearedAt: row.cleared_at.toISOString(),
        seasonId: row.season_id,
    }));
}

async function upsertGymClear(seasonId: number, ownerName: string, gymId: string, isChampion: boolean): Promise<void> {
    await pool.query(
        'INSERT INTO monster_gym_progress (season_id, owner_name, gym_id, cleared_at, champion_cleared_at) ' +
        'VALUES ($1, $2, $3, NOW(), $4) ' +
        'ON CONFLICT (season_id, owner_name, gym_id) DO UPDATE SET ' +
        '  cleared_at = COALESCE(monster_gym_progress.cleared_at, EXCLUDED.cleared_at), ' +
        '  champion_cleared_at = COALESCE(monster_gym_progress.champion_cleared_at, EXCLUDED.champion_cleared_at)',
        [seasonId, ownerName, gymId, isChampion ? new Date() : null],
    );
}

async function markGymRewardClaimed(seasonId: number, ownerName: string, gymId: string): Promise<void> {
    await pool.query(
        'UPDATE monster_gym_progress SET badge_claimed_at = COALESCE(badge_claimed_at, NOW()) WHERE season_id = $1 AND owner_name = $2 AND gym_id = $3',
        [seasonId, ownerName, gymId],
    );
}

async function recordLeagueMatch(opts: {
    seasonId: number;
    battleId: string;
    challengerName: string;
    targetName: string;
    winnerName: string;
    loserName: string;
    reason: BattleEndReason;
}): Promise<{ winnerDelta: number; loserDelta: number } | null> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const existing = await client.query<{ id: number }>(
            'SELECT id FROM monster_league_matches WHERE season_id = $1 AND battle_id = $2 LIMIT 1',
            [opts.seasonId, opts.battleId],
        );
        if (existing.rows.length > 0) {
            await client.query('ROLLBACK');
            return null;
        }

        const regs = await client.query<LeagueRegistrationRow>(
            'SELECT * FROM monster_league_registrations WHERE season_id = $1 AND owner_name = ANY($2::varchar[]) FOR UPDATE',
            [opts.seasonId, [opts.winnerName, opts.loserName]],
        );

        const winner = regs.rows.find(row => row.owner_name === opts.winnerName);
        const loser = regs.rows.find(row => row.owner_name === opts.loserName);
        if (!winner || !loser) {
            await client.query('ROLLBACK');
            return null;
        }

        const expectedWinner = 1 / (1 + Math.pow(10, (loser.rating - winner.rating) / 400));
        const expectedLoser = 1 / (1 + Math.pow(10, (winner.rating - loser.rating) / 400));
        const nextWinnerRating = Math.round(winner.rating + ELO_K * (1 - expectedWinner));
        const nextLoserRating = Math.round(loser.rating + ELO_K * (0 - expectedLoser));
        const winnerDelta = nextWinnerRating - winner.rating;
        const loserDelta = nextLoserRating - loser.rating;

        await client.query(
            'UPDATE monster_league_registrations SET rating = $3, wins = wins + 1, last_match_at = NOW() WHERE season_id = $1 AND owner_name = $2',
            [opts.seasonId, opts.winnerName, nextWinnerRating],
        );
        await client.query(
            'UPDATE monster_league_registrations SET rating = $3, losses = losses + 1, last_match_at = NOW() WHERE season_id = $1 AND owner_name = $2',
            [opts.seasonId, opts.loserName, nextLoserRating],
        );

        await client.query(
            'INSERT INTO monster_league_matches ' +
            '(season_id, battle_id, challenger_name, target_name, winner_name, loser_name, winner_rating_before, winner_rating_after, loser_rating_before, loser_rating_after, result_reason) ' +
            'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
            [
                opts.seasonId,
                opts.battleId,
                opts.challengerName,
                opts.targetName,
                opts.winnerName,
                opts.loserName,
                winner.rating,
                nextWinnerRating,
                loser.rating,
                nextLoserRating,
                opts.reason,
            ],
        );

        await client.query('COMMIT');
        return { winnerDelta, loserDelta };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

function toProxyFeatureReward(reward: RewardConfig, scope: string): ProxyFeatureReward | null {
    if (reward.kind === 'legend') {
        return {
            kind: 'legend',
            rewardKey: `${scope}:${reward.rewardKey}`,
            icon: reward.icon ?? 0,
            color: reward.color ?? 0,
            key: reward.key || 'Proxy League',
            text: reward.text || reward.rewardKey,
        };
    }

    if (reward.kind === 'nametag_style') {
        if (typeof reward.style !== 'number') {
            return null;
        }
        return {
            kind: 'nametag_style',
            rewardKey: `${scope}:${reward.rewardKey}`,
            style: reward.style,
        };
    }

    return null;
}

function getLeagueDivision(rating: number): string {
    if (rating >= 1400) {
        return 'Platinum';
    }
    if (rating >= 1200) {
        return 'Gold';
    }
    if (rating >= 1000) {
        return 'Silver';
    }
    return 'Bronze';
}

function mapLeagueSeason(row: LeagueSeasonRow): MonsterLeagueSeason {
    return {
        id: row.id,
        proxySeasonId: row.proxy_season_id,
        seasonKey: row.season_key,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
    };
}

function mapLeagueRegistration(row: LeagueRegistrationRow): MonsterLeagueRegistration {
    return {
        ownerName: row.owner_name,
        rating: row.rating,
        wins: row.wins,
        losses: row.losses,
        draws: row.draws,
        registeredAt: row.registered_at,
        lastMatchAt: row.last_match_at,
    };
}

function normalizeText(value: unknown, fallback: string): string {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || fallback;
}

function clampInt(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.floor(value)));
}
