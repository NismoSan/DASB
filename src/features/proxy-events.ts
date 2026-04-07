import { pool } from './database';

export type ProxyRewardKind = 'legend' | 'nametag_style' | 'hall_record' | 'monster_xp';

export interface ProxyEventSeason {
    id: number;
    featureKey: string;
    seasonKey: string;
    startsAt: Date;
    endsAt: Date;
    metadata: Record<string, unknown>;
}

export interface ProxyRewardGrant {
    id: number;
    featureKey: string;
    rewardKey: string;
    ownerName: string;
    seasonId: number | null;
    rewardKind: ProxyRewardKind;
    payload: Record<string, unknown>;
    grantedAt: Date;
}

interface EventSeasonRow {
    id: number;
    feature_key: string;
    season_key: string;
    starts_at: Date;
    ends_at: Date;
    metadata: Record<string, unknown> | null;
}

interface RewardGrantRow {
    id: number;
    feature_key: string;
    reward_key: string;
    owner_name: string;
    season_id: number | null;
    reward_kind: ProxyRewardKind;
    payload: Record<string, unknown> | null;
    granted_at: Date;
}

export interface EnsureActiveSeasonOptions {
    featureKey: string;
    durationDays: number;
    timezone: string;
    resetHour: number;
    now?: Date;
    metadata?: Record<string, unknown>;
}

let schemaReady: Promise<void> | null = null;

export function ensureProxyEventSchema(): Promise<void> {
    if (schemaReady) {
        return schemaReady;
    }

    schemaReady = pool.query([
        'CREATE TABLE IF NOT EXISTS proxy_event_seasons (',
        '  id SERIAL PRIMARY KEY,',
        '  feature_key VARCHAR(100) NOT NULL,',
        '  season_key VARCHAR(120) NOT NULL,',
        '  starts_at TIMESTAMPTZ NOT NULL,',
        '  ends_at TIMESTAMPTZ NOT NULL,',
        '  metadata JSONB NOT NULL DEFAULT \'{}\'::jsonb,',
        '  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
        '  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
        '  UNIQUE(feature_key, season_key)',
        ')',
    ].join('\n'))
        .then(() => pool.query('CREATE INDEX IF NOT EXISTS idx_proxy_event_seasons_active ON proxy_event_seasons(feature_key, starts_at DESC, ends_at DESC)'))
        .then(() => pool.query([
            'CREATE TABLE IF NOT EXISTS proxy_reward_grants (',
            '  id SERIAL PRIMARY KEY,',
            '  feature_key VARCHAR(100) NOT NULL,',
            '  reward_key VARCHAR(150) NOT NULL,',
            '  owner_name VARCHAR(50) NOT NULL,',
            '  season_id INTEGER REFERENCES proxy_event_seasons(id) ON DELETE CASCADE,',
            '  reward_kind VARCHAR(40) NOT NULL,',
            '  payload JSONB NOT NULL DEFAULT \'{}\'::jsonb,',
            '  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
            '  UNIQUE(feature_key, reward_key, owner_name, season_id)',
            ')',
        ].join('\n')))
        .then(() => pool.query('CREATE INDEX IF NOT EXISTS idx_proxy_reward_grants_owner ON proxy_reward_grants(owner_name, granted_at DESC)'))
        .then(() => undefined)
        .catch((err: Error) => {
            schemaReady = null;
            console.error('[ProxyEvents] Schema init error:', err.message);
            throw err;
        });

    return schemaReady;
}

export async function getActiveProxyEventSeason(featureKey: string, now = new Date()): Promise<ProxyEventSeason | null> {
    await ensureProxyEventSchema();

    const result = await pool.query<EventSeasonRow>(
        'SELECT * FROM proxy_event_seasons WHERE feature_key = $1 AND starts_at <= $2 AND ends_at > $2 ORDER BY starts_at DESC LIMIT 1',
        [featureKey, now],
    );

    return result.rows[0] ? mapSeasonRow(result.rows[0]) : null;
}

export async function getLatestProxyEventSeason(featureKey: string): Promise<ProxyEventSeason | null> {
    await ensureProxyEventSchema();

    const result = await pool.query<EventSeasonRow>(
        'SELECT * FROM proxy_event_seasons WHERE feature_key = $1 ORDER BY starts_at DESC LIMIT 1',
        [featureKey],
    );

    return result.rows[0] ? mapSeasonRow(result.rows[0]) : null;
}

export async function getMostRecentCompletedProxyEventSeason(featureKey: string, now = new Date()): Promise<ProxyEventSeason | null> {
    await ensureProxyEventSchema();

    const result = await pool.query<EventSeasonRow>(
        'SELECT * FROM proxy_event_seasons WHERE feature_key = $1 AND ends_at <= $2 ORDER BY ends_at DESC LIMIT 1',
        [featureKey, now],
    );

    return result.rows[0] ? mapSeasonRow(result.rows[0]) : null;
}

export async function ensureActiveProxyEventSeason(opts: EnsureActiveSeasonOptions): Promise<ProxyEventSeason> {
    await ensureProxyEventSchema();

    const now = opts.now ?? new Date();
    const active = await getActiveProxyEventSeason(opts.featureKey, now);
    if (active) {
        return active;
    }

    const latest = await getLatestProxyEventSeason(opts.featureKey);
    const durationMs = Math.max(1, opts.durationDays) * 24 * 60 * 60 * 1000;

    let startsAt: Date;
    let endsAt: Date;
    if (latest) {
        startsAt = latest.startsAt;
        endsAt = latest.endsAt;
        while (endsAt <= now) {
            startsAt = endsAt;
            endsAt = new Date(startsAt.getTime() + durationMs);
        }
    } else {
        startsAt = getCurrentWindowStart(opts.timezone, opts.resetHour, now);
        endsAt = new Date(startsAt.getTime() + durationMs);
    }

    const seasonKey = buildSeasonKey(startsAt, opts.timezone);
    const metadata = {
        timezone: opts.timezone,
        resetHour: opts.resetHour,
        durationDays: opts.durationDays,
        ...(opts.metadata || {}),
    };

    const result = await pool.query<EventSeasonRow>(
        'INSERT INTO proxy_event_seasons (feature_key, season_key, starts_at, ends_at, metadata, updated_at) ' +
        'VALUES ($1, $2, $3, $4, $5::jsonb, NOW()) ' +
        'ON CONFLICT (feature_key, season_key) DO UPDATE SET ends_at = EXCLUDED.ends_at, metadata = EXCLUDED.metadata, updated_at = NOW() ' +
        'RETURNING *',
        [opts.featureKey, seasonKey, startsAt, endsAt, JSON.stringify(metadata)],
    );

    return mapSeasonRow(result.rows[0]);
}

export async function listProxyRewardGrants(
    featureKey: string,
    ownerName: string,
    seasonId?: number | null,
): Promise<ProxyRewardGrant[]> {
    await ensureProxyEventSchema();

    const params: Array<string | number | null> = [featureKey, ownerName];
    let sql = 'SELECT * FROM proxy_reward_grants WHERE feature_key = $1 AND owner_name = $2';
    if (seasonId !== undefined) {
        params.push(seasonId);
        sql += ' AND season_id IS NOT DISTINCT FROM $3';
    }
    sql += ' ORDER BY granted_at DESC, id DESC';

    const result = await pool.query<RewardGrantRow>(sql, params);
    return result.rows.map(mapRewardGrantRow);
}

export async function hasProxyRewardGrant(
    featureKey: string,
    rewardKey: string,
    ownerName: string,
    seasonId?: number | null,
): Promise<boolean> {
    await ensureProxyEventSchema();

    const result = await pool.query<{ id: number }>(
        'SELECT id FROM proxy_reward_grants WHERE feature_key = $1 AND reward_key = $2 AND owner_name = $3 AND season_id IS NOT DISTINCT FROM $4 LIMIT 1',
        [featureKey, rewardKey, ownerName, seasonId ?? null],
    );

    return result.rows.length > 0;
}

export async function createProxyRewardGrant(opts: {
    featureKey: string;
    rewardKey: string;
    ownerName: string;
    seasonId?: number | null;
    rewardKind: ProxyRewardKind;
    payload?: Record<string, unknown>;
}): Promise<ProxyRewardGrant | null> {
    await ensureProxyEventSchema();

    const result = await pool.query<RewardGrantRow>(
        'INSERT INTO proxy_reward_grants (feature_key, reward_key, owner_name, season_id, reward_kind, payload) ' +
        'VALUES ($1, $2, $3, $4, $5, $6::jsonb) ' +
        'ON CONFLICT (feature_key, reward_key, owner_name, season_id) DO NOTHING ' +
        'RETURNING *',
        [
            opts.featureKey,
            opts.rewardKey,
            opts.ownerName,
            opts.seasonId ?? null,
            opts.rewardKind,
            JSON.stringify(opts.payload || {}),
        ],
    );

    return result.rows[0] ? mapRewardGrantRow(result.rows[0]) : null;
}

export function getTimeZoneParts(date: Date, timeZone: string): {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
} {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    });
    const partMap = formatter.formatToParts(date).reduce<Record<string, string>>((acc, part) => {
        if (part.type !== 'literal') {
            acc[part.type] = part.value;
        }
        return acc;
    }, {});

    return {
        year: parseInt(partMap.year || '1970', 10),
        month: parseInt(partMap.month || '01', 10),
        day: parseInt(partMap.day || '01', 10),
        hour: parseInt(partMap.hour || '00', 10),
        minute: parseInt(partMap.minute || '00', 10),
        second: parseInt(partMap.second || '00', 10),
    };
}

export function zonedTimeToUtc(
    components: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number },
    timeZone: string,
): Date {
    const year = components.year;
    const month = components.month;
    const day = components.day;
    const hour = components.hour ?? 0;
    const minute = components.minute ?? 0;
    const second = components.second ?? 0;

    let guess = Date.UTC(year, month - 1, day, hour, minute, second);
    for (let i = 0; i < 3; i++) {
        const offset = getTimeZoneOffsetMs(new Date(guess), timeZone);
        const next = Date.UTC(year, month - 1, day, hour, minute, second) - offset;
        if (Math.abs(next - guess) < 1000) {
            guess = next;
            break;
        }
        guess = next;
    }

    return new Date(guess);
}

export function getCurrentWindowStart(timeZone: string, resetHour: number, now = new Date()): Date {
    const local = getTimeZoneParts(now, timeZone);
    const anchor = new Date(Date.UTC(local.year, local.month - 1, local.day));
    if (local.hour < resetHour) {
        anchor.setUTCDate(anchor.getUTCDate() - 1);
    }

    return zonedTimeToUtc(
        {
            year: anchor.getUTCFullYear(),
            month: anchor.getUTCMonth() + 1,
            day: anchor.getUTCDate(),
            hour: resetHour,
            minute: 0,
            second: 0,
        },
        timeZone,
    );
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
    const local = getTimeZoneParts(date, timeZone);
    const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    const actualUtc = Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds(),
    );
    return asUtc - actualUtc;
}

function buildSeasonKey(startsAt: Date, timeZone: string): string {
    const local = getTimeZoneParts(startsAt, timeZone);
    return `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
}

function mapSeasonRow(row: EventSeasonRow): ProxyEventSeason {
    return {
        id: row.id,
        featureKey: row.feature_key,
        seasonKey: row.season_key,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        metadata: row.metadata || {},
    };
}

function mapRewardGrantRow(row: RewardGrantRow): ProxyRewardGrant {
    return {
        id: row.id,
        featureKey: row.feature_key,
        rewardKey: row.reward_key,
        ownerName: row.owner_name,
        seasonId: row.season_id,
        rewardKind: row.reward_kind,
        payload: row.payload || {},
        grantedAt: row.granted_at,
    };
}
