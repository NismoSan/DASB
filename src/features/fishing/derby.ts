import type ProxyServer from '../../proxy/proxy-server';
import type ProxySession from '../../proxy/proxy-session';
import { pool } from '../database';
import {
    ensureProxyEventSchema,
    ensureActiveProxyEventSeason,
    getMostRecentCompletedProxyEventSeason,
    getTimeZoneParts,
    getCurrentWindowStart,
    type ProxyEventSeason,
} from '../proxy-events';
import { grantProxyReward, type ProxyFeatureReward } from '../proxy-rewards';

interface DerbySeasonRow {
    id: number;
    proxy_season_id: number;
    season_key: string;
    starts_at: Date;
    ends_at: Date;
    spotlight_rotation: string[] | null;
}

interface DerbyDailyResultRow {
    derby_day: number;
    owner_name: string;
    species_id: string;
    weight: number;
    caught_at: Date;
    rank: number;
    points_awarded: number;
}

interface DerbyPointRow {
    owner_name: string;
    total_points: number;
    win_days: number;
    podium_days: number;
}

interface FishingCatchRow {
    id: number;
    owner_name: string;
    species_id: string;
    species_name: string;
    zone_id: string;
    weight: number;
    caught_at: Date;
}

interface FishingDerbySeason {
    id: number;
    proxySeasonId: number;
    seasonKey: string;
    startsAt: Date;
    endsAt: Date;
}

interface ResolvedFishingDerbyRewardTier {
    maxRank: number;
    rewards: ProxyFeatureReward[];
}

export interface FishingDerbyConfig {
    enabled?: boolean;
    seasonLengthDays?: number;
    dailyResetHour?: number;
    timezone?: string;
    eligibleZoneIds?: string[];
    spotlightSpeciesRotation?: string[];
    pointsTable?: number[];
    leaderboardSize?: number;
    rewardTiers?: Array<{
        maxRank: number;
        rewards: ProxyFeatureReward[];
    }>;
}

export interface ResolvedFishingDerbyConfig {
    enabled: boolean;
    seasonLengthDays: number;
    dailyResetHour: number;
    timezone: string;
    eligibleZoneIds: string[];
    spotlightSpeciesRotation: string[];
    pointsTable: number[];
    leaderboardSize: number;
    rewardTiers: ResolvedFishingDerbyRewardTier[];
}

export interface FishingDerbyPanelState {
    enabled: boolean;
    activeSeason: {
        id: number;
        seasonKey: string;
        startsAt: string;
        endsAt: string;
        spotlightSpeciesId: string | null;
        currentDay: number;
    } | null;
    dailyLeaders: Array<{
        rank: number;
        ownerName: string;
        speciesId: string;
        weight: number;
        pointsAwarded: number;
    }>;
    seasonStandings: Array<{
        rank: number;
        ownerName: string;
        totalPoints: number;
        winDays: number;
        podiumDays: number;
    }>;
    biggestFish: Array<{
        ownerName: string;
        speciesName: string;
        weight: number;
        caughtAt: string;
    }>;
}

const FEATURE_KEY = 'fishing_derby';
const DEFAULT_POINTS = [10, 7, 5, 3, 2, 1];

let _proxy: ProxyServer | null = null;
let _config: ResolvedFishingDerbyConfig | null = null;
let _schemaReady: Promise<void> | null = null;
let _rebuildPromise: Promise<void> | null = null;

export async function initFishingDerby(
    proxy: ProxyServer,
    config: ResolvedFishingDerbyConfig,
): Promise<void> {
    _proxy = proxy;
    _config = config;
    if (!_config.enabled) {
        return;
    }

    await ensureFishingDerbySchema();
    await rebuildActiveFishingDerbyState();
}

export function resolveFishingDerbyConfig(
    config: FishingDerbyConfig | undefined,
    speciesIds: string[],
    zoneIds: string[],
): ResolvedFishingDerbyConfig {
    const normalizedSpecies = normalizeStringArray(config?.spotlightSpeciesRotation, speciesIds);
    const normalizedZones = normalizeStringArray(config?.eligibleZoneIds, zoneIds);
    const rewardTiers = normalizeRewardTiers(config?.rewardTiers);

    return {
        enabled: config?.enabled !== false,
        seasonLengthDays: Math.max(1, Math.floor(config?.seasonLengthDays ?? 7)),
        dailyResetHour: clampInt(config?.dailyResetHour ?? 0, 0, 23),
        timezone: normalizeText(config?.timezone, 'America/Chicago'),
        eligibleZoneIds: normalizedZones.length > 0 ? normalizedZones : zoneIds,
        spotlightSpeciesRotation: normalizedSpecies.length > 0 ? normalizedSpecies : speciesIds,
        pointsTable: normalizePointsTable(config?.pointsTable),
        leaderboardSize: Math.max(3, Math.floor(config?.leaderboardSize ?? 8)),
        rewardTiers,
    };
}

export async function onFishingCatchSaved(): Promise<void> {
    if (!_config?.enabled) {
        return;
    }
    await rebuildActiveFishingDerbyState();
}

export async function buildFishingDerbyStatusText(ownerName: string): Promise<string> {
    if (!_config?.enabled) {
        return 'The fishing derby is disabled.';
    }

    const season = await ensureActiveFishingDerbySeason();
    const dayIndex = getDerbyDayIndex(season.startsAt, new Date(), _config.timezone, _config.dailyResetHour);
    const spotlight = getSpotlightSpeciesId(dayIndex);
    const standings = await getSeasonStandings(season.id, _config.leaderboardSize);
    const myRank = standings.findIndex(entry => entry.ownerName === ownerName) + 1;
    const myEntry = standings.find(entry => entry.ownerName === ownerName) || null;

    return [
        `Season ${season.seasonKey}`,
        '',
        `Today's spotlight: ${spotlight || 'Unavailable'}`,
        `Day ${dayIndex + 1} of ${_config.seasonLengthDays}`,
        myEntry
            ? `Your standing: #${myRank} with ${myEntry.totalPoints} points (${myEntry.winDays} wins)`
            : 'Your standing: no derby points yet.',
    ].join('\n');
}

export async function buildFishingDerbyLeadersText(): Promise<string> {
    if (!_config?.enabled) {
        return 'The fishing derby is disabled.';
    }

    const season = await ensureActiveFishingDerbySeason();
    const leaders = await getCurrentDayLeaders(season.id, _config.leaderboardSize);
    const lines = ['Today\'s Derby Leaders', ''];

    if (leaders.length === 0) {
        lines.push('No eligible catches have landed yet.');
        return lines.join('\n');
    }

    for (const leader of leaders) {
        lines.push(`#${leader.rank} ${leader.ownerName}: ${formatWeight(leader.weight)} (${leader.pointsAwarded} pts)`);
    }

    return lines.join('\n');
}

export async function buildFishingDerbyStandingsText(): Promise<string> {
    if (!_config?.enabled) {
        return 'The fishing derby is disabled.';
    }

    const season = await ensureActiveFishingDerbySeason();
    const standings = await getSeasonStandings(season.id, _config.leaderboardSize);
    const lines = ['Season Standings', ''];

    if (standings.length === 0) {
        lines.push('No players have scored yet.');
        return lines.join('\n');
    }

    for (const entry of standings) {
        lines.push(`#${entry.rank} ${entry.ownerName}: ${entry.totalPoints} pts | ${entry.winDays} wins | ${entry.podiumDays} podiums`);
    }

    return lines.join('\n');
}

export async function buildFishingDerbyBiggestFishText(): Promise<string> {
    if (!_config?.enabled) {
        return 'The fishing derby is disabled.';
    }

    const season = await ensureActiveFishingDerbySeason();
    const catches = await getSeasonBiggestFish(season.id, _config.leaderboardSize);
    const lines = ['Biggest Derby Fish', ''];

    if (catches.length === 0) {
        lines.push('No derby catches have been recorded yet.');
        return lines.join('\n');
    }

    for (const catchRow of catches) {
        lines.push(`${catchRow.ownerName}: ${catchRow.speciesName} ${formatWeight(catchRow.weight)}`);
    }

    return lines.join('\n');
}

export async function buildFishingDerbyClaimStatusText(ownerName: string): Promise<string> {
    const lines = await claimFishingDerbyRewardsByOwner(ownerName);
    return lines.join('\n');
}

export async function claimFishingDerbyRewards(session: ProxySession): Promise<string[]> {
    return claimFishingDerbyRewardsByOwner(session.characterName);
}

export async function getFishingDerbyPanelState(): Promise<FishingDerbyPanelState> {
    if (!_config?.enabled) {
        return {
            enabled: false,
            activeSeason: null,
            dailyLeaders: [],
            seasonStandings: [],
            biggestFish: [],
        };
    }

    const season = await ensureActiveFishingDerbySeason();
    const dayIndex = getDerbyDayIndex(season.startsAt, new Date(), _config.timezone, _config.dailyResetHour);
    const dailyLeaders = await getCurrentDayLeaders(season.id, _config.leaderboardSize);
    const standings = await getSeasonStandings(season.id, _config.leaderboardSize);
    const biggestFish = await getSeasonBiggestFish(season.id, _config.leaderboardSize);

    return {
        enabled: true,
        activeSeason: {
            id: season.id,
            seasonKey: season.seasonKey,
            startsAt: season.startsAt.toISOString(),
            endsAt: season.endsAt.toISOString(),
            spotlightSpeciesId: getSpotlightSpeciesId(dayIndex),
            currentDay: dayIndex + 1,
        },
        dailyLeaders: dailyLeaders.map(entry => ({
            rank: entry.rank,
            ownerName: entry.ownerName,
            speciesId: entry.speciesId,
            weight: entry.weight,
            pointsAwarded: entry.pointsAwarded,
        })),
        seasonStandings: standings.map(entry => ({
            rank: entry.rank,
            ownerName: entry.ownerName,
            totalPoints: entry.totalPoints,
            winDays: entry.winDays,
            podiumDays: entry.podiumDays,
        })),
        biggestFish: biggestFish.map(entry => ({
            ownerName: entry.ownerName,
            speciesName: entry.speciesName,
            weight: entry.weight,
            caughtAt: entry.caughtAt.toISOString(),
        })),
    };
}

async function claimFishingDerbyRewardsByOwner(ownerName: string): Promise<string[]> {
    if (!_config?.enabled || !_proxy) {
        return ['The fishing derby is not initialized yet.'];
    }

    const completedSeason = await getMostRecentCompletedFishingDerbySeason();
    if (!completedSeason) {
        return ['No completed derby season has rewards ready yet.'];
    }

    const standings = await getSeasonStandings(completedSeason.id, 250);
    const rank = standings.findIndex(entry => entry.ownerName === ownerName) + 1;
    if (rank <= 0) {
        return ['You did not place in the most recent completed derby season.'];
    }

    const tier = _config.rewardTiers.find(entry => rank <= entry.maxRank);
    if (!tier) {
        return [`Season ${completedSeason.seasonKey}: no configured reward tier for rank #${rank}.`];
    }

    const lines: string[] = [];
    for (const reward of tier.rewards) {
        const result = await grantProxyReward(
            _proxy,
            FEATURE_KEY,
            ownerName,
            withScopedRewardKey(reward, `season:${completedSeason.id}:rank:${rank}`),
            completedSeason.id,
        );
        lines.push(`Season ${completedSeason.seasonKey} rank #${rank}: ${result.summary}`);
    }

    return lines.length > 0 ? lines : ['No derby rewards were available.'];
}

async function ensureFishingDerbySchema(): Promise<void> {
    if (_schemaReady) {
        return _schemaReady;
    }

    _schemaReady = (async () => {
        await ensureProxyEventSchema();
        await pool.query([
            'CREATE TABLE IF NOT EXISTS fishing_derby_seasons (',
            '  id SERIAL PRIMARY KEY,',
            '  proxy_season_id INTEGER NOT NULL UNIQUE REFERENCES proxy_event_seasons(id) ON DELETE CASCADE,',
            '  season_key VARCHAR(120) NOT NULL UNIQUE,',
            '  starts_at TIMESTAMPTZ NOT NULL,',
            '  ends_at TIMESTAMPTZ NOT NULL,',
            '  spotlight_rotation JSONB NOT NULL DEFAULT \'[]\'::jsonb,',
            '  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
            '  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
            ')',
        ].join('\n'));

        await pool.query([
            'CREATE TABLE IF NOT EXISTS fishing_derby_daily_results (',
            '  id SERIAL PRIMARY KEY,',
            '  season_id INTEGER NOT NULL REFERENCES fishing_derby_seasons(id) ON DELETE CASCADE,',
            '  derby_day INTEGER NOT NULL,',
            '  window_start TIMESTAMPTZ NOT NULL,',
            '  window_end TIMESTAMPTZ NOT NULL,',
            '  species_id VARCHAR(80) NOT NULL,',
            '  owner_name VARCHAR(50) NOT NULL,',
            '  catch_id INTEGER NOT NULL REFERENCES fishing_catches(id) ON DELETE CASCADE,',
            '  weight INTEGER NOT NULL,',
            '  caught_at TIMESTAMPTZ NOT NULL,',
            '  rank INTEGER NOT NULL,',
            '  points_awarded INTEGER NOT NULL DEFAULT 0,',
            '  UNIQUE(season_id, derby_day, owner_name),',
            '  UNIQUE(season_id, derby_day, rank)',
            ')',
        ].join('\n'));

        await pool.query([
            'CREATE TABLE IF NOT EXISTS fishing_derby_points (',
            '  id SERIAL PRIMARY KEY,',
            '  season_id INTEGER NOT NULL REFERENCES fishing_derby_seasons(id) ON DELETE CASCADE,',
            '  owner_name VARCHAR(50) NOT NULL,',
            '  total_points INTEGER NOT NULL DEFAULT 0,',
            '  win_days INTEGER NOT NULL DEFAULT 0,',
            '  podium_days INTEGER NOT NULL DEFAULT 0,',
            '  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
            '  UNIQUE(season_id, owner_name)',
            ')',
        ].join('\n'));

        await pool.query('CREATE INDEX IF NOT EXISTS idx_fishing_derby_daily ON fishing_derby_daily_results(season_id, derby_day, rank)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_fishing_derby_points ON fishing_derby_points(season_id, total_points DESC, win_days DESC)');
    })().catch((err: Error) => {
        _schemaReady = null;
        throw err;
    });

    return _schemaReady;
}

async function rebuildActiveFishingDerbyState(): Promise<void> {
    if (_rebuildPromise) {
        await _rebuildPromise;
        return;
    }

    _rebuildPromise = (async () => {
        if (!_config) {
            return;
        }

        await ensureFishingDerbySchema();
        const season = await ensureActiveFishingDerbySeason();
        const catches = await loadSeasonEligibleCatches(season);
        const dailyWinners = computeDailyWinners(catches, season);

        await pool.query('DELETE FROM fishing_derby_daily_results WHERE season_id = $1', [season.id]);
        await pool.query('DELETE FROM fishing_derby_points WHERE season_id = $1', [season.id]);

        for (const entry of dailyWinners) {
            await pool.query(
                'INSERT INTO fishing_derby_daily_results ' +
                '(season_id, derby_day, window_start, window_end, species_id, owner_name, catch_id, weight, caught_at, rank, points_awarded) ' +
                'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
                [
                    season.id,
                    entry.derbyDay,
                    entry.windowStart,
                    entry.windowEnd,
                    entry.speciesId,
                    entry.ownerName,
                    entry.catchId,
                    entry.weight,
                    entry.caughtAt,
                    entry.rank,
                    entry.pointsAwarded,
                ],
            );
        }

        const aggregated = aggregateSeasonPoints(dailyWinners);
        for (const entry of aggregated) {
            await pool.query(
                'INSERT INTO fishing_derby_points (season_id, owner_name, total_points, win_days, podium_days, updated_at) ' +
                'VALUES ($1, $2, $3, $4, $5, NOW())',
                [season.id, entry.ownerName, entry.totalPoints, entry.winDays, entry.podiumDays],
            );
        }
    })().finally(() => {
        _rebuildPromise = null;
    });

    await _rebuildPromise;
}

async function ensureActiveFishingDerbySeason(now = new Date()): Promise<FishingDerbySeason> {
    await ensureFishingDerbySchema();
    if (!_config) {
        throw new Error('Fishing derby config is not ready.');
    }

    const proxySeason = await ensureActiveProxyEventSeason({
        featureKey: FEATURE_KEY,
        durationDays: _config.seasonLengthDays,
        timezone: _config.timezone,
        resetHour: _config.dailyResetHour,
        now,
        metadata: {
            eligibleZoneIds: _config.eligibleZoneIds,
            spotlightSpeciesRotation: _config.spotlightSpeciesRotation,
            pointsTable: _config.pointsTable,
        },
    });

    const result = await pool.query<DerbySeasonRow>(
        'INSERT INTO fishing_derby_seasons (proxy_season_id, season_key, starts_at, ends_at, spotlight_rotation, updated_at) ' +
        'VALUES ($1, $2, $3, $4, $5::jsonb, NOW()) ' +
        'ON CONFLICT (proxy_season_id) DO UPDATE SET season_key = EXCLUDED.season_key, starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, spotlight_rotation = EXCLUDED.spotlight_rotation, updated_at = NOW() ' +
        'RETURNING *',
        [proxySeason.id, proxySeason.seasonKey, proxySeason.startsAt, proxySeason.endsAt, JSON.stringify(_config.spotlightSpeciesRotation)],
    );

    return mapDerbySeason(result.rows[0]);
}

async function getMostRecentCompletedFishingDerbySeason(): Promise<FishingDerbySeason | null> {
    const proxySeason = await getMostRecentCompletedProxyEventSeason(FEATURE_KEY);
    if (!proxySeason) {
        return null;
    }

    const result = await pool.query<DerbySeasonRow>(
        'SELECT * FROM fishing_derby_seasons WHERE proxy_season_id = $1 LIMIT 1',
        [proxySeason.id],
    );
    if (!result.rows[0]) {
        return null;
    }

    return mapDerbySeason(result.rows[0]);
}

async function loadSeasonEligibleCatches(season: FishingDerbySeason): Promise<FishingCatchRow[]> {
    if (!_config) {
        return [];
    }

    const result = await pool.query<FishingCatchRow>(
        'SELECT id, owner_name, species_id, species_name, zone_id, weight, caught_at ' +
        'FROM fishing_catches ' +
        'WHERE caught_at >= $1 AND caught_at < $2 AND zone_id = ANY($3::varchar[]) ' +
        'ORDER BY caught_at ASC, id ASC',
        [season.startsAt, season.endsAt, _config.eligibleZoneIds],
    );

    return result.rows;
}

function computeDailyWinners(
    catches: FishingCatchRow[],
    season: FishingDerbySeason,
): Array<{
    derbyDay: number;
    windowStart: Date;
    windowEnd: Date;
    speciesId: string;
    ownerName: string;
    catchId: number;
    weight: number;
    caughtAt: Date;
    rank: number;
    pointsAwarded: number;
}> {
    if (!_config) {
        return [];
    }
    const config = _config;

    const byDay = new Map<number, Map<string, FishingCatchRow>>();
    for (const catchRow of catches) {
        const derbyDay = getDerbyDayIndex(season.startsAt, catchRow.caught_at, _config.timezone, _config.dailyResetHour);
        if (derbyDay < 0 || derbyDay >= _config.seasonLengthDays) {
            continue;
        }

        const spotlightSpeciesId = getSpotlightSpeciesId(derbyDay);
        if (!spotlightSpeciesId || catchRow.species_id !== spotlightSpeciesId) {
            continue;
        }

        let dayEntries = byDay.get(derbyDay);
        if (!dayEntries) {
            dayEntries = new Map();
            byDay.set(derbyDay, dayEntries);
        }

        const current = dayEntries.get(catchRow.owner_name);
        if (!current || catchRow.weight > current.weight || (catchRow.weight === current.weight && catchRow.caught_at < current.caught_at)) {
            dayEntries.set(catchRow.owner_name, catchRow);
        }
    }

    const winners: Array<{
        derbyDay: number;
        windowStart: Date;
        windowEnd: Date;
        speciesId: string;
        ownerName: string;
        catchId: number;
        weight: number;
        caughtAt: Date;
        rank: number;
        pointsAwarded: number;
    }> = [];

    for (let derbyDay = 0; derbyDay < config.seasonLengthDays; derbyDay++) {
        const pointsTable = config.pointsTable;
        const spotlightSpeciesId = getSpotlightSpeciesId(derbyDay);
        if (!spotlightSpeciesId) {
            continue;
        }

        const windowStart = new Date(season.startsAt.getTime() + derbyDay * 24 * 60 * 60 * 1000);
        const windowEnd = new Date(windowStart.getTime() + 24 * 60 * 60 * 1000);
        const dayEntries = Array.from(byDay.get(derbyDay)?.values() || [])
            .sort((a, b) => {
                if (b.weight !== a.weight) {
                    return b.weight - a.weight;
                }
                if (a.caught_at.getTime() !== b.caught_at.getTime()) {
                    return a.caught_at.getTime() - b.caught_at.getTime();
                }
                return a.id - b.id;
            });

        dayEntries.forEach((entry, index) => {
            winners.push({
                derbyDay,
                windowStart,
                windowEnd,
                speciesId: spotlightSpeciesId,
                ownerName: entry.owner_name,
                catchId: entry.id,
                weight: entry.weight,
                caughtAt: entry.caught_at,
                rank: index + 1,
                pointsAwarded: pointsTable[index] || 0,
            });
        });
    }

    return winners;
}

function aggregateSeasonPoints(entries: Array<{
    ownerName: string;
    rank: number;
    pointsAwarded: number;
}>): Array<{
    ownerName: string;
    totalPoints: number;
    winDays: number;
    podiumDays: number;
}> {
    const summary = new Map<string, { ownerName: string; totalPoints: number; winDays: number; podiumDays: number }>();

    for (const entry of entries) {
        let target = summary.get(entry.ownerName);
        if (!target) {
            target = {
                ownerName: entry.ownerName,
                totalPoints: 0,
                winDays: 0,
                podiumDays: 0,
            };
            summary.set(entry.ownerName, target);
        }

        target.totalPoints += entry.pointsAwarded;
        if (entry.rank === 1) {
            target.winDays += 1;
        }
        if (entry.rank <= 3) {
            target.podiumDays += 1;
        }
    }

    return Array.from(summary.values()).sort((a, b) => {
        if (b.totalPoints !== a.totalPoints) {
            return b.totalPoints - a.totalPoints;
        }
        if (b.winDays !== a.winDays) {
            return b.winDays - a.winDays;
        }
        if (b.podiumDays !== a.podiumDays) {
            return b.podiumDays - a.podiumDays;
        }
        return a.ownerName.localeCompare(b.ownerName);
    });
}

async function getCurrentDayLeaders(seasonId: number, limit: number): Promise<Array<{
    rank: number;
    ownerName: string;
    speciesId: string;
    weight: number;
    pointsAwarded: number;
}>> {
    const season = await ensureActiveFishingDerbySeason();
    const dayIndex = getDerbyDayIndex(season.startsAt, new Date(), _config!.timezone, _config!.dailyResetHour);
    const result = await pool.query<DerbyDailyResultRow>(
        'SELECT derby_day, owner_name, species_id, weight, caught_at, rank, points_awarded ' +
        'FROM fishing_derby_daily_results WHERE season_id = $1 AND derby_day = $2 ORDER BY rank ASC LIMIT $3',
        [seasonId, dayIndex, limit],
    );

    return result.rows.map(row => ({
        rank: row.rank,
        ownerName: row.owner_name,
        speciesId: row.species_id,
        weight: row.weight,
        pointsAwarded: row.points_awarded,
    }));
}

async function getSeasonStandings(seasonId: number, limit: number): Promise<Array<{
    rank: number;
    ownerName: string;
    totalPoints: number;
    winDays: number;
    podiumDays: number;
}>> {
    const result = await pool.query<DerbyPointRow>(
        'SELECT owner_name, total_points, win_days, podium_days ' +
        'FROM fishing_derby_points WHERE season_id = $1 ' +
        'ORDER BY total_points DESC, win_days DESC, podium_days DESC, owner_name ASC LIMIT $2',
        [seasonId, limit],
    );

    return result.rows.map((row, index) => ({
        rank: index + 1,
        ownerName: row.owner_name,
        totalPoints: row.total_points,
        winDays: row.win_days,
        podiumDays: row.podium_days,
    }));
}

async function getSeasonBiggestFish(seasonId: number, limit: number): Promise<Array<{
    ownerName: string;
    speciesName: string;
    weight: number;
    caughtAt: Date;
}>> {
    const season = await pool.query<DerbySeasonRow>('SELECT * FROM fishing_derby_seasons WHERE id = $1 LIMIT 1', [seasonId]);
    const target = season.rows[0];
    if (!target || !_config) {
        return [];
    }

    const result = await pool.query<{
        owner_name: string;
        species_name: string;
        weight: number;
        caught_at: Date;
    }>(
        'SELECT owner_name, species_name, weight, caught_at FROM fishing_catches ' +
        'WHERE caught_at >= $1 AND caught_at < $2 AND zone_id = ANY($3::varchar[]) ' +
        'ORDER BY weight DESC, caught_at ASC LIMIT $4',
        [target.starts_at, target.ends_at, _config.eligibleZoneIds, limit],
    );

    return result.rows.map(row => ({
        ownerName: row.owner_name,
        speciesName: row.species_name,
        weight: row.weight,
        caughtAt: row.caught_at,
    }));
}

function getDerbyDayIndex(seasonStart: Date, value: Date, timeZone: string, resetHour: number): number {
    const seasonAnchor = getCurrentWindowStart(timeZone, resetHour, seasonStart);
    const valueAnchor = getCurrentWindowStart(timeZone, resetHour, value);
    return Math.floor((valueAnchor.getTime() - seasonAnchor.getTime()) / (24 * 60 * 60 * 1000));
}

function getSpotlightSpeciesId(dayIndex: number): string | null {
    if (!_config || _config.spotlightSpeciesRotation.length === 0 || dayIndex < 0) {
        return null;
    }

    return _config.spotlightSpeciesRotation[dayIndex % _config.spotlightSpeciesRotation.length] || null;
}

function mapDerbySeason(row: DerbySeasonRow): FishingDerbySeason {
    return {
        id: row.id,
        proxySeasonId: row.proxy_season_id,
        seasonKey: row.season_key,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
    };
}

function withScopedRewardKey(reward: ProxyFeatureReward, scope: string): ProxyFeatureReward {
    return {
        ...reward,
        rewardKey: `${scope}:${reward.rewardKey}`,
    };
}

function normalizeRewardTiers(
    tiers: FishingDerbyConfig['rewardTiers'],
): ResolvedFishingDerbyRewardTier[] {
    if (!Array.isArray(tiers) || tiers.length === 0) {
        return [
            {
                maxRank: 1,
                rewards: [
                    {
                        kind: 'legend',
                        rewardKey: 'champion-angler',
                        icon: 0,
                        color: 7,
                        key: 'Proxy Derby',
                        text: 'Fishing Derby Champion',
                    },
                ],
            },
            {
                maxRank: 3,
                rewards: [
                    {
                        kind: 'legend',
                        rewardKey: 'season-podium',
                        icon: 0,
                        color: 3,
                        key: 'Proxy Derby',
                        text: 'Fishing Derby Podium',
                    },
                ],
            },
        ];
    }

    return tiers
        .map(entry => ({
            maxRank: Math.max(1, Math.floor(entry.maxRank)),
            rewards: Array.isArray(entry.rewards) ? entry.rewards : [],
        }))
        .filter(entry => entry.rewards.length > 0)
        .sort((a, b) => a.maxRank - b.maxRank);
}

function normalizePointsTable(points: number[] | undefined): number[] {
    if (!Array.isArray(points) || points.length === 0) {
        return [...DEFAULT_POINTS];
    }

    const normalized = points
        .map(value => Math.max(0, Math.floor(Number(value) || 0)))
        .filter(value => value >= 0);

    return normalized.length > 0 ? normalized : [...DEFAULT_POINTS];
}

function normalizeStringArray(values: string[] | undefined, fallback: string[]): string[] {
    const normalized = Array.isArray(values)
        ? values.map(value => String(value || '').trim().toLowerCase()).filter(Boolean)
        : [];
    return normalized.length > 0 ? normalized : fallback;
}

function normalizeText(value: unknown, fallback: string): string {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || fallback;
}

function clampInt(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.floor(value)));
}

function formatWeight(weight: number): string {
    return `${weight} st`;
}
