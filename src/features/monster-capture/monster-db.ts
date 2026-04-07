import { pool } from '../database';
import type { CapturedMonster, LeaderboardEntry } from './types';

type MonsterRow = {
    id: number;
    owner_name: string;
    species_name: string;
    sprite: number;
    nickname: string;
    level: number;
    xp: number;
    xp_to_next: number;
    hp: number;
    max_hp: number;
    atk: number;
    def: number;
    spd: number;
    sp_atk: number;
    sp_def: number;
    nature: CapturedMonster['nature'];
    move_1: string | null;
    move_2: string | null;
    move_3: string | null;
    move_4: string | null;
    wins: number;
    losses: number;
    is_active: boolean;
    companion_out: boolean | null;
    captured_at: Date | string;
};

// ── Schema ───────────────────────────────────────────────────────

export async function initMonsterSchema(): Promise<void> {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS monster_captures (
      id SERIAL PRIMARY KEY,
      owner_name VARCHAR(50) NOT NULL,
      species_name VARCHAR(50) NOT NULL,
      sprite INTEGER NOT NULL,
      nickname VARCHAR(50) NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      xp INTEGER NOT NULL DEFAULT 0,
      xp_to_next INTEGER NOT NULL DEFAULT 50,
      hp INTEGER NOT NULL,
      max_hp INTEGER NOT NULL,
      atk INTEGER NOT NULL,
      def INTEGER NOT NULL,
      spd INTEGER NOT NULL,
      sp_atk INTEGER NOT NULL,
      sp_def INTEGER NOT NULL,
      nature VARCHAR(20) NOT NULL,
      move_1 VARCHAR(50),
      move_2 VARCHAR(50),
      move_3 VARCHAR(50),
      move_4 VARCHAR(50),
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT FALSE,
      captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

    await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_monster_captures_owner ON monster_captures (owner_name)
  `);

    await pool.query(`
    ALTER TABLE monster_captures ADD COLUMN IF NOT EXISTS companion_out BOOLEAN NOT NULL DEFAULT FALSE
  `);

    console.log('[MonsterDB] Schema initialized');
}

// ── CRUD Operations ──────────────────────────────────────────────

function rowToMonster(row: MonsterRow): CapturedMonster {
    return {
        id: row.id,
        ownerName: row.owner_name,
        speciesName: row.species_name,
        sprite: row.sprite,
        nickname: row.nickname,
        level: row.level,
        xp: row.xp,
        xpToNext: row.xp_to_next,
        hp: row.hp,
        maxHp: row.max_hp,
        atk: row.atk,
        def: row.def,
        spd: row.spd,
        spAtk: row.sp_atk,
        spDef: row.sp_def,
        nature: row.nature,
        moves: [row.move_1, row.move_2, row.move_3, row.move_4],
        wins: row.wins,
        losses: row.losses,
        isActive: row.is_active,
        companionOut: row.companion_out ?? false,
        capturedAt: row.captured_at instanceof Date ? row.captured_at : new Date(row.captured_at),
    };
}

export async function saveMonster(mon: CapturedMonster): Promise<number> {
    const result = await pool.query<{ id: number }>(`
    INSERT INTO monster_captures (
      owner_name, species_name, sprite, nickname, level, xp, xp_to_next,
      hp, max_hp, atk, def, spd, sp_atk, sp_def,
      nature, move_1, move_2, move_3, move_4, wins, losses, is_active, captured_at, companion_out
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
    RETURNING id
  `, [
        mon.ownerName, mon.speciesName, mon.sprite, mon.nickname, mon.level, mon.xp, mon.xpToNext,
        mon.hp, mon.maxHp, mon.atk, mon.def, mon.spd, mon.spAtk, mon.spDef,
        mon.nature, mon.moves[0], mon.moves[1], mon.moves[2], mon.moves[3],
        mon.wins, mon.losses, mon.isActive, mon.capturedAt, mon.companionOut ?? false,
    ]);
    return result.rows[0].id;
}

export async function updateMonster(mon: CapturedMonster): Promise<void> {
    await pool.query(`
    UPDATE monster_captures SET
      species_name=$1, sprite=$2, nickname=$3, level=$4, xp=$5, xp_to_next=$6,
      hp=$7, max_hp=$8, atk=$9, def=$10, spd=$11, sp_atk=$12, sp_def=$13,
      nature=$14, move_1=$15, move_2=$16, move_3=$17, move_4=$18,
      wins=$19, losses=$20, is_active=$21, companion_out=$22
    WHERE id=$23
  `, [
        mon.speciesName, mon.sprite, mon.nickname, mon.level, mon.xp, mon.xpToNext,
        mon.hp, mon.maxHp, mon.atk, mon.def, mon.spd, mon.spAtk, mon.spDef,
        mon.nature, mon.moves[0], mon.moves[1], mon.moves[2], mon.moves[3],
        mon.wins, mon.losses, mon.isActive, mon.companionOut ?? false, mon.id,
    ]);
}

export async function getMonstersByOwner(ownerName: string): Promise<CapturedMonster[]> {
    const result = await pool.query<MonsterRow>('SELECT * FROM monster_captures WHERE owner_name = $1 ORDER BY id', [ownerName]);
    return result.rows.map(rowToMonster);
}

export async function getActiveMonster(ownerName: string): Promise<CapturedMonster | null> {
    const result = await pool.query<MonsterRow>('SELECT * FROM monster_captures WHERE owner_name = $1 AND is_active = TRUE LIMIT 1', [ownerName]);
    return result.rows.length > 0 ? rowToMonster(result.rows[0]) : null;
}

export async function setActiveMonster(ownerName: string, monsterId: number): Promise<boolean> {
    await pool.query('UPDATE monster_captures SET is_active = FALSE WHERE owner_name = $1', [ownerName]);
    const result = await pool.query('UPDATE monster_captures SET is_active = TRUE WHERE id = $1 AND owner_name = $2', [monsterId, ownerName]);
    return (result.rowCount ?? 0) > 0;
}

export async function deleteMonster(monsterId: number, ownerName: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM monster_captures WHERE id = $1 AND owner_name = $2', [monsterId, ownerName]);
    return (result.rowCount ?? 0) > 0;
}

export async function getMonsterCount(ownerName: string): Promise<number> {
    const result = await pool.query<{ count: string }>('SELECT COUNT(*) as count FROM monster_captures WHERE owner_name = $1', [ownerName]);
    return parseInt(result.rows[0].count, 10);
}

export async function getMonsterById(monsterId: number): Promise<CapturedMonster | null> {
    const result = await pool.query<MonsterRow>('SELECT * FROM monster_captures WHERE id = $1', [monsterId]);
    return result.rows.length > 0 ? rowToMonster(result.rows[0]) : null;
}

export async function renameMonster(monsterId: number, ownerName: string, nickname: string): Promise<boolean> {
    const result = await pool.query('UPDATE monster_captures SET nickname = $1 WHERE id = $2 AND owner_name = $3', [nickname, monsterId, ownerName]);
    return (result.rowCount ?? 0) > 0;
}

export async function healMonstersByOwner(ownerName: string): Promise<number> {
    const result = await pool.query(
        'UPDATE monster_captures SET hp = max_hp WHERE owner_name = $1',
        [ownerName],
    );
    return result.rowCount ?? 0;
}

// ── Companion Persistence ────────────────────────────────────────

export async function setCompanionOut(ownerName: string, out: boolean): Promise<void> {
    await pool.query('UPDATE monster_captures SET companion_out = $1 WHERE owner_name = $2 AND is_active = TRUE', [out, ownerName]);
}

export async function isCompanionOut(ownerName: string): Promise<boolean> {
    const result = await pool.query<{ companion_out: boolean }>(
        'SELECT companion_out FROM monster_captures WHERE owner_name = $1 AND is_active = TRUE LIMIT 1',
        [ownerName],
    );
    return result.rows.length > 0 && result.rows[0].companion_out === true;
}

// ── Leaderboard ──────────────────────────────────────────────────

export async function getLeaderboard(limit = 10): Promise<LeaderboardEntry[]> {
    const result = await pool.query<{
        owner_name: string;
        nickname: string;
        species_name: string;
        level: number;
        wins: number;
        losses: number;
    }>(`
    SELECT owner_name, nickname, species_name, level, wins, losses
    FROM monster_captures
    WHERE wins > 0
    ORDER BY wins DESC, level DESC
    LIMIT $1
  `, [limit]);

    return result.rows.map(row => ({
        ownerName: row.owner_name,
        nickname: row.nickname,
        speciesName: row.species_name,
        level: row.level,
        wins: row.wins,
        losses: row.losses,
    }));
}
