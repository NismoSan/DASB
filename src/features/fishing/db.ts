import { pool } from '../database';

export interface FishingCatchRow {
    id?: number;
    ownerName: string;
    speciesId: string;
    speciesName: string;
    zoneId: string;
    mapNumber: number;
    sizeClass: 'big' | 'small';
    rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
    weight: number;
    perfectCatch: boolean;
    glimmer: boolean;
    caughtAt: Date;
}

export interface FishingJournalEntry {
    speciesId: string;
    speciesName: string;
    sizeClass: 'big' | 'small';
    rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
    catches: number;
    bestWeight: number;
    glimmerCount: number;
}

export interface FishingBestCatch {
    ownerName: string;
    speciesId: string;
    speciesName: string;
    sizeClass: 'big' | 'small';
    rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
    weight: number;
    perfectCatch: boolean;
    glimmer: boolean;
    caughtAt: Date;
}

export interface FishingCatchLeaderboardEntry {
    ownerName: string;
    totalCatches: number;
    uniqueSpecies: number;
    bestWeight: number;
    lastCaughtAt: Date;
}

let schemaReady: Promise<void> | null = null;

export function ensureFishingSchema(): Promise<void> {
    if (schemaReady) {
        return schemaReady;
    }

    schemaReady = pool.query([
        'CREATE TABLE IF NOT EXISTS fishing_catches (',
        '  id SERIAL PRIMARY KEY,',
        '  owner_name VARCHAR(50) NOT NULL,',
        '  species_id VARCHAR(80) NOT NULL,',
        '  species_name VARCHAR(100) NOT NULL,',
        '  zone_id VARCHAR(80) NOT NULL,',
        '  map_number INTEGER NOT NULL,',
        '  size_class VARCHAR(10) NOT NULL,',
        '  rarity VARCHAR(20) NOT NULL,',
        '  weight INTEGER NOT NULL,',
        '  perfect_catch BOOLEAN NOT NULL DEFAULT FALSE,',
        '  glimmer BOOLEAN NOT NULL DEFAULT FALSE,',
        '  caught_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
        ')',
    ].join('\n'))
        .then(() => pool.query('CREATE INDEX IF NOT EXISTS idx_fishing_owner ON fishing_catches(owner_name, caught_at DESC)'))
        .then(() => pool.query('CREATE INDEX IF NOT EXISTS idx_fishing_species ON fishing_catches(species_id, caught_at DESC)'))
        .then(() => pool.query('CREATE INDEX IF NOT EXISTS idx_fishing_weight ON fishing_catches(weight DESC, caught_at DESC)'))
        .then(() => undefined)
        .catch((err: Error) => {
            schemaReady = null;
            console.error('[Fishing] Schema init error:', err.message);
            throw err;
        });

    return schemaReady;
}

export async function saveFishingCatch(catchRow: FishingCatchRow): Promise<number> {
    await ensureFishingSchema();

    const result = await pool.query<{ id: number }>(
        'INSERT INTO fishing_catches ' +
        '(owner_name, species_id, species_name, zone_id, map_number, size_class, rarity, weight, perfect_catch, glimmer, caught_at) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id',
        [
            catchRow.ownerName,
            catchRow.speciesId,
            catchRow.speciesName,
            catchRow.zoneId,
            catchRow.mapNumber,
            catchRow.sizeClass,
            catchRow.rarity,
            catchRow.weight,
            catchRow.perfectCatch,
            catchRow.glimmer,
            catchRow.caughtAt,
        ],
    );

    return result.rows[0]?.id ?? 0;
}

export async function getPlayerFishingTotals(ownerName: string): Promise<{
    totalCatches: number;
    uniqueSpecies: number;
    perfectCatches: number;
    glimmerCatches: number;
}> {
    await ensureFishingSchema();

    const result = await pool.query<{
        total_catches: string;
        unique_species: string;
        perfect_catches: string;
        glimmer_catches: string;
    }>(
        'SELECT COUNT(*) AS total_catches, ' +
        'COUNT(DISTINCT species_id) AS unique_species, ' +
        'COUNT(*) FILTER (WHERE perfect_catch = TRUE) AS perfect_catches, ' +
        'COUNT(*) FILTER (WHERE glimmer = TRUE) AS glimmer_catches ' +
        'FROM fishing_catches WHERE owner_name = $1',
        [ownerName],
    );

    const row = result.rows[0];
    return {
        totalCatches: parseInt(row?.total_catches ?? '0', 10),
        uniqueSpecies: parseInt(row?.unique_species ?? '0', 10),
        perfectCatches: parseInt(row?.perfect_catches ?? '0', 10),
        glimmerCatches: parseInt(row?.glimmer_catches ?? '0', 10),
    };
}

export async function getPlayerFishingJournal(ownerName: string, limit = 10): Promise<FishingJournalEntry[]> {
    await ensureFishingSchema();

    const result = await pool.query<{
        species_id: string;
        species_name: string;
        size_class: 'big' | 'small';
        rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
        catches: string;
        best_weight: string;
        glimmer_count: string;
    }>(
        'SELECT species_id, species_name, size_class, rarity, COUNT(*) AS catches, ' +
        'MAX(weight) AS best_weight, ' +
        'COUNT(*) FILTER (WHERE glimmer = TRUE) AS glimmer_count ' +
        'FROM fishing_catches ' +
        'WHERE owner_name = $1 ' +
        'GROUP BY species_id, species_name, size_class, rarity ' +
        'ORDER BY COUNT(*) DESC, MAX(weight) DESC, species_name ASC ' +
        'LIMIT $2',
        [ownerName, limit],
    );

    return result.rows.map(row => ({
        speciesId: row.species_id,
        speciesName: row.species_name,
        sizeClass: row.size_class,
        rarity: row.rarity,
        catches: parseInt(row.catches, 10),
        bestWeight: parseInt(row.best_weight, 10),
        glimmerCount: parseInt(row.glimmer_count ?? '0', 10),
    }));
}

export async function getPlayerPersonalBestCatches(ownerName: string, limit = 8): Promise<FishingBestCatch[]> {
    await ensureFishingSchema();

    const result = await pool.query<{
        owner_name: string;
        species_id: string;
        species_name: string;
        size_class: 'big' | 'small';
        rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
        weight: number;
        perfect_catch: boolean;
        glimmer: boolean;
        caught_at: Date;
    }>(
        'SELECT DISTINCT ON (species_id) owner_name, species_id, species_name, size_class, rarity, weight, perfect_catch, glimmer, caught_at ' +
        'FROM fishing_catches ' +
        'WHERE owner_name = $1 ' +
        'ORDER BY species_id, weight DESC, caught_at DESC ' +
        'LIMIT $2',
        [ownerName, limit],
    );

    return result.rows.map(row => ({
        ownerName: row.owner_name,
        speciesId: row.species_id,
        speciesName: row.species_name,
        sizeClass: row.size_class,
        rarity: row.rarity,
        weight: row.weight,
        perfectCatch: row.perfect_catch,
        glimmer: row.glimmer,
        caughtAt: row.caught_at,
    }));
}

export async function getPlayerSpeciesBestCatch(ownerName: string, speciesId: string): Promise<FishingBestCatch | null> {
    await ensureFishingSchema();

    const result = await pool.query<{
        owner_name: string;
        species_id: string;
        species_name: string;
        size_class: 'big' | 'small';
        rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
        weight: number;
        perfect_catch: boolean;
        glimmer: boolean;
        caught_at: Date;
    }>(
        'SELECT owner_name, species_id, species_name, size_class, rarity, weight, perfect_catch, glimmer, caught_at ' +
        'FROM fishing_catches ' +
        'WHERE owner_name = $1 AND species_id = $2 ' +
        'ORDER BY weight DESC, caught_at DESC ' +
        'LIMIT 1',
        [ownerName, speciesId],
    );

    const row = result.rows[0];
    if (!row) {
        return null;
    }

    return {
        ownerName: row.owner_name,
        speciesId: row.species_id,
        speciesName: row.species_name,
        sizeClass: row.size_class,
        rarity: row.rarity,
        weight: row.weight,
        perfectCatch: row.perfect_catch,
        glimmer: row.glimmer,
        caughtAt: row.caught_at,
    };
}

export async function getLargestFishingCatches(limit = 8): Promise<FishingBestCatch[]> {
    await ensureFishingSchema();

    const result = await pool.query<{
        owner_name: string;
        species_id: string;
        species_name: string;
        size_class: 'big' | 'small';
        rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
        weight: number;
        perfect_catch: boolean;
        glimmer: boolean;
        caught_at: Date;
    }>(
        'SELECT owner_name, species_id, species_name, size_class, rarity, weight, perfect_catch, glimmer, caught_at ' +
        'FROM (' +
        '  SELECT DISTINCT ON (species_id) owner_name, species_id, species_name, size_class, rarity, weight, perfect_catch, glimmer, caught_at ' +
        '  FROM fishing_catches ' +
        '  ORDER BY species_id, weight DESC, caught_at DESC' +
        ') AS species_records ' +
        'ORDER BY weight DESC, caught_at DESC ' +
        'LIMIT $1',
        [limit],
    );

    return result.rows.map(row => ({
        ownerName: row.owner_name,
        speciesId: row.species_id,
        speciesName: row.species_name,
        sizeClass: row.size_class,
        rarity: row.rarity,
        weight: row.weight,
        perfectCatch: row.perfect_catch,
        glimmer: row.glimmer,
        caughtAt: row.caught_at,
    }));
}

export async function getSpeciesRecordCatch(speciesId: string): Promise<FishingBestCatch | null> {
    await ensureFishingSchema();

    const result = await pool.query<{
        owner_name: string;
        species_id: string;
        species_name: string;
        size_class: 'big' | 'small';
        rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
        weight: number;
        perfect_catch: boolean;
        glimmer: boolean;
        caught_at: Date;
    }>(
        'SELECT owner_name, species_id, species_name, size_class, rarity, weight, perfect_catch, glimmer, caught_at ' +
        'FROM fishing_catches ' +
        'WHERE species_id = $1 ' +
        'ORDER BY weight DESC, caught_at DESC ' +
        'LIMIT 1',
        [speciesId],
    );

    const row = result.rows[0];
    if (!row) {
        return null;
    }

    return {
        ownerName: row.owner_name,
        speciesId: row.species_id,
        speciesName: row.species_name,
        sizeClass: row.size_class,
        rarity: row.rarity,
        weight: row.weight,
        perfectCatch: row.perfect_catch,
        glimmer: row.glimmer,
        caughtAt: row.caught_at,
    };
}

export async function getFishingCatchCountLeaderboard(limit = 8): Promise<FishingCatchLeaderboardEntry[]> {
    await ensureFishingSchema();

    const result = await pool.query<{
        owner_name: string;
        total_catches: string;
        unique_species: string;
        best_weight: string;
        last_caught_at: Date;
    }>(
        'SELECT owner_name, ' +
        'COUNT(*) AS total_catches, ' +
        'COUNT(DISTINCT species_id) AS unique_species, ' +
        'MAX(weight) AS best_weight, ' +
        'MAX(caught_at) AS last_caught_at ' +
        'FROM fishing_catches ' +
        'GROUP BY owner_name ' +
        'ORDER BY COUNT(*) DESC, COUNT(DISTINCT species_id) DESC, MAX(weight) DESC, MAX(caught_at) DESC ' +
        'LIMIT $1',
        [limit],
    );

    return result.rows.map(row => ({
        ownerName: row.owner_name,
        totalCatches: parseInt(row.total_catches, 10),
        uniqueSpecies: parseInt(row.unique_species, 10),
        bestWeight: parseInt(row.best_weight, 10),
        lastCaughtAt: row.last_caught_at,
    }));
}
