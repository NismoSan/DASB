// ── PostgreSQL Database Module ────────────────────────────────────
// All persistence is handled through PostgreSQL.
// In-memory state is authoritative for reads, DB writes happen alongside
// in-memory updates. On startup, memory is populated from DB.

import { Pool } from 'pg';

export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT as string, 10) || 5432,
  database: process.env.DB_NAME || 'dasb',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: parseInt(process.env.DB_MAX_CONNECTIONS as string, 10) || 20
});

pool.on('error', function (err: Error) {
  console.error('[DB] Unexpected pool error:', err.message);
});

// ── Schema Creation ──────────────────────────────────────────────

export function init(): Promise<void> {
  return pool.query([
    // Players table
    'CREATE TABLE IF NOT EXISTS players (',
    '  id SERIAL PRIMARY KEY,',
    '  name VARCHAR(50) NOT NULL,',
    '  name_lower VARCHAR(50) UNIQUE NOT NULL,',
    '  class_name VARCHAR(50) DEFAULT \'\',',
    '  class_id INTEGER DEFAULT -1,',
    '  title VARCHAR(100) DEFAULT \'\',',
    '  is_master BOOLEAN DEFAULT FALSE,',
    '  first_seen TIMESTAMPTZ,',
    '  last_seen TIMESTAMPTZ,',
    '  source VARCHAR(20) DEFAULT \'sighting\',',
    '  legend_class_name VARCHAR(50) DEFAULT \'\',',
    '  group_name VARCHAR(100) DEFAULT \'\',',
    '  last_legend_update TIMESTAMPTZ',
    ')'
  ].join('\n'))
  .then(function () {
    return pool.query([
      'CREATE TABLE IF NOT EXISTS player_sightings (',
      '  id SERIAL PRIMARY KEY,',
      '  player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,',
      '  timestamp TIMESTAMPTZ NOT NULL,',
      '  source VARCHAR(20) DEFAULT \'sighting\'',
      ')'
    ].join('\n'));
  })
  .then(function () {
    return pool.query([
      'CREATE TABLE IF NOT EXISTS player_legends (',
      '  id SERIAL PRIMARY KEY,',
      '  player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,',
      '  icon SMALLINT,',
      '  color SMALLINT,',
      '  legend_key VARCHAR(255),',
      '  legend_text TEXT',
      ')'
    ].join('\n'));
  })
  .then(function () {
    return pool.query([
      'CREATE TABLE IF NOT EXISTS player_legend_history (',
      '  id SERIAL PRIMARY KEY,',
      '  player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,',
      '  timestamp TIMESTAMPTZ NOT NULL,',
      '  legends JSONB NOT NULL',
      ')'
    ].join('\n'));
  })
  .then(function () {
    return pool.query([
      'CREATE TABLE IF NOT EXISTS chat_logs (',
      '  id SERIAL PRIMARY KEY,',
      '  bot_id VARCHAR(50),',
      '  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
      '  channel SMALLINT,',
      '  channel_name VARCHAR(50),',
      '  sender VARCHAR(50),',
      '  message TEXT,',
      '  raw TEXT,',
      '  mentions TEXT[] DEFAULT \'{}\'',
      ')'
    ].join('\n'));
  })
  .then(function () {
    return pool.query([
      'CREATE TABLE IF NOT EXISTS bot_config (',
      '  id INTEGER PRIMARY KEY DEFAULT 1,',
      '  config JSONB NOT NULL,',
      '  updated_at TIMESTAMPTZ DEFAULT NOW()',
      ')'
    ].join('\n'));
  })
  .then(function () {
    return pool.query([
      'CREATE TABLE IF NOT EXISTS discord_rules (',
      '  id VARCHAR(50) PRIMARY KEY,',
      '  name VARCHAR(100),',
      '  enabled BOOLEAN DEFAULT TRUE,',
      '  webhook_url TEXT,',
      '  message_types TEXT[] DEFAULT \'{}\',',
      '  pattern TEXT,',
      '  bot_name VARCHAR(100),',
      '  bot_avatar TEXT',
      ')'
    ].join('\n'));
  })
  .then(function () {
    return pool.query([
      'CREATE TABLE IF NOT EXISTS scheduled_messages (',
      '  id VARCHAR(50) PRIMARY KEY,',
      '  name VARCHAR(100),',
      '  enabled BOOLEAN DEFAULT TRUE,',
      '  type VARCHAR(20),',
      '  interval_minutes INTEGER,',
      '  daily_time VARCHAR(10),',
      '  onetime_at TIMESTAMPTZ,',
      '  message TEXT,',
      '  bot_id VARCHAR(50),',
      '  message_type VARCHAR(20),',
      '  whisper_target VARCHAR(50),',
      '  last_fired BIGINT,',
      '  last_success BOOLEAN',
      ')'
    ].join('\n'));
  })
  .then(function () {
    return pool.query([
      'CREATE TABLE IF NOT EXISTS player_sessions (',
      '  id SERIAL PRIMARY KEY,',
      '  player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,',
      '  appeared TIMESTAMPTZ NOT NULL,',
      '  disappeared TIMESTAMPTZ',
      ')'
    ].join('\n'));
  })
  .then(function () {
    return pool.query([
      'CREATE TABLE IF NOT EXISTS player_appearances (',
      '  id SERIAL PRIMARY KEY,',
      '  player_id INTEGER REFERENCES players(id) ON DELETE CASCADE,',
      '  appearance JSONB NOT NULL,',
      '  updated_at TIMESTAMPTZ DEFAULT NOW(),',
      '  UNIQUE(player_id)',
      ')'
    ].join('\n'));
  })
  .then(function () {
    return pool.query([
      'CREATE TABLE IF NOT EXISTS game_leaderboard (',
      '  id SERIAL PRIMARY KEY,',
      '  name VARCHAR(50) NOT NULL,',
      '  name_lower VARCHAR(50) UNIQUE NOT NULL,',
      '  wins INTEGER DEFAULT 0,',
      '  played INTEGER DEFAULT 0,',
      '  current_streak INTEGER DEFAULT 0,',
      '  best_streak INTEGER DEFAULT 0,',
      '  by_game JSONB DEFAULT \'{}\'',
      ')'
    ].join('\n'));
  })
  .then(function () {
    return pool.query([
      'CREATE TABLE IF NOT EXISTS ai_conversations (',
      '  id SERIAL PRIMARY KEY,',
      '  player_name VARCHAR(50) NOT NULL,',
      '  player_lower VARCHAR(50) NOT NULL,',
      '  role VARCHAR(10) NOT NULL,',
      '  content TEXT NOT NULL,',
      '  timestamp TIMESTAMPTZ DEFAULT NOW()',
      ')'
    ].join('\n'));
  })
  .then(function () {
    return pool.query([
      'CREATE TABLE IF NOT EXISTS knowledge_base (',
      '  id SERIAL PRIMARY KEY,',
      '  category VARCHAR(50) NOT NULL,',
      '  title VARCHAR(200) NOT NULL,',
      '  content TEXT NOT NULL,',
      '  created_at TIMESTAMPTZ DEFAULT NOW(),',
      '  updated_at TIMESTAMPTZ DEFAULT NOW()',
      ')'
    ].join('\n'));
  })
  // Create indexes
  .then(function () {
    return pool.query('CREATE INDEX IF NOT EXISTS idx_ai_conv_player ON ai_conversations(player_lower, timestamp DESC)');
  })
  .then(function () {
    return pool.query('CREATE INDEX IF NOT EXISTS idx_sightings_player_ts ON player_sightings(player_id, timestamp DESC)');
  })
  .then(function () {
    return pool.query('CREATE INDEX IF NOT EXISTS idx_sightings_ts ON player_sightings(timestamp DESC)');
  })
  .then(function () {
    return pool.query('CREATE INDEX IF NOT EXISTS idx_legends_player ON player_legends(player_id)');
  })
  .then(function () {
    return pool.query('CREATE INDEX IF NOT EXISTS idx_legend_hist_player ON player_legend_history(player_id, timestamp DESC)');
  })
  .then(function () {
    return pool.query('CREATE INDEX IF NOT EXISTS idx_chat_sender ON chat_logs(sender, timestamp DESC)');
  })
  .then(function () {
    return pool.query('CREATE INDEX IF NOT EXISTS idx_chat_ts ON chat_logs(timestamp DESC)');
  })
  .then(function () {
    return pool.query('CREATE INDEX IF NOT EXISTS idx_chat_channel ON chat_logs(channel_name)');
  })
  .then(function () {
    return pool.query('CREATE INDEX IF NOT EXISTS idx_sessions_player ON player_sessions(player_id, appeared DESC)');
  })
  .then(function () {
    return pool.query('CREATE INDEX IF NOT EXISTS idx_kb_category ON knowledge_base(category)');
  })
  .then(function () {
    return pool.query([
      'CREATE TABLE IF NOT EXISTS packet_captures (',
      '  id SERIAL PRIMARY KEY,',
      '  session_id VARCHAR(50),',
      '  character_name VARCHAR(50),',
      '  direction VARCHAR(20) NOT NULL,',
      '  opcode INTEGER NOT NULL,',
      '  opcode_name VARCHAR(100),',
      '  body_length INTEGER NOT NULL,',
      '  hex_body TEXT,',
      '  decoded_fields JSONB,',
      '  captured_at TIMESTAMPTZ DEFAULT NOW()',
      ')'
    ].join('\n'));
  })
  .then(function () {
    return pool.query('CREATE INDEX IF NOT EXISTS idx_pkt_opcode ON packet_captures(opcode)');
  })
  .then(function () {
    return pool.query('CREATE INDEX IF NOT EXISTS idx_pkt_direction ON packet_captures(direction)');
  })
  .then(function () {
    return pool.query('CREATE INDEX IF NOT EXISTS idx_pkt_captured_at ON packet_captures(captured_at)');
  })
  .then(function () {
    return pool.query('CREATE INDEX IF NOT EXISTS idx_pkt_session ON packet_captures(session_id)');
  })
  .then(function () {
    return pool.query([
      'CREATE TABLE IF NOT EXISTS attendance_events (',
      '  id SERIAL PRIMARY KEY,',
      '  event_name VARCHAR(200) NOT NULL,',
      '  started_at BIGINT NOT NULL,',
      '  stopped_at BIGINT,',
      '  active BOOLEAN DEFAULT TRUE,',
      '  total_count INTEGER DEFAULT 0',
      ')'
    ].join('\n'));
  })
  .then(function () {
    return pool.query([
      'CREATE TABLE IF NOT EXISTS attendance_records (',
      '  id SERIAL PRIMARY KEY,',
      '  event_id INTEGER REFERENCES attendance_events(id) ON DELETE CASCADE,',
      '  name VARCHAR(50) NOT NULL,',
      '  name_lower VARCHAR(50) NOT NULL,',
      '  first_seen BIGINT NOT NULL,',
      '  last_seen BIGINT NOT NULL,',
      '  sightings INTEGER DEFAULT 1,',
      '  UNIQUE(event_id, name_lower)',
      ')'
    ].join('\n'));
  })
  .then(function () {
    return pool.query('CREATE INDEX IF NOT EXISTS idx_attendance_records_event ON attendance_records(event_id)');
  })
  .then(function () {
    return pool.query([
      'CREATE TABLE IF NOT EXISTS afk_shadow_progress (',
      '  id SERIAL PRIMARY KEY,',
      '  character_name VARCHAR(50) NOT NULL,',
      '  character_name_lower VARCHAR(50) UNIQUE NOT NULL,',
      '  shadow_stats JSONB NOT NULL,',
      '  updated_at TIMESTAMPTZ DEFAULT NOW()',
      ')'
    ].join('\n'));
  })
  .then(function () {
    return pool.query([
      'CREATE TABLE IF NOT EXISTS afk_shadow_inventory (',
      '  id SERIAL PRIMARY KEY,',
      '  character_name_lower VARCHAR(50) NOT NULL REFERENCES afk_shadow_progress(character_name_lower) ON DELETE CASCADE,',
      '  slot INTEGER NOT NULL,',
      '  template_key VARCHAR(100) NOT NULL,',
      '  name VARCHAR(100) NOT NULL,',
      '  sprite INTEGER NOT NULL,',
      '  color INTEGER DEFAULT 0,',
      '  quantity INTEGER DEFAULT 1,',
      '  stackable BOOLEAN DEFAULT FALSE,',
      '  max_durability INTEGER DEFAULT 100,',
      '  durability INTEGER DEFAULT 100,',
      '  UNIQUE(character_name_lower, slot)',
      ')'
    ].join('\n'));
  })
  .then(function () {
    return pool.query('CREATE INDEX IF NOT EXISTS idx_afk_inv_char ON afk_shadow_inventory(character_name_lower)');
  })
  .then(function () {
    return pool.query([
      'CREATE TABLE IF NOT EXISTS afk_shadow_spells (',
      '  id SERIAL PRIMARY KEY,',
      '  character_name_lower VARCHAR(50) NOT NULL REFERENCES afk_shadow_progress(character_name_lower) ON DELETE CASCADE,',
      '  kind VARCHAR(5) NOT NULL,',
      '  slot INTEGER NOT NULL,',
      '  icon INTEGER NOT NULL,',
      '  name VARCHAR(100) NOT NULL,',
      '  spell_type INTEGER DEFAULT 0,',
      '  prompt VARCHAR(200) DEFAULT \'\',',
      '  cast_lines INTEGER DEFAULT 0,',
      '  UNIQUE(character_name_lower, kind, slot)',
      ')'
    ].join('\n'));
  })
  .then(function () {
    return pool.query('CREATE INDEX IF NOT EXISTS idx_afk_spells_char ON afk_shadow_spells(character_name_lower)');
  })
  .then(function () {
    return pool.query('CREATE INDEX IF NOT EXISTS idx_chat_bot ON chat_logs(bot_id)');
  })
  .then(function () {
    return pool.query('CREATE INDEX IF NOT EXISTS idx_chat_channel_ts ON chat_logs(channel_name, timestamp DESC)');
  })
  .then(function () {
    return pool.query('CREATE INDEX IF NOT EXISTS idx_sched_bot ON scheduled_messages(bot_id)');
  })
  .then(function () {
    console.log('[DB] Schema initialized');
  })
  .catch(function (err: Error) {
    console.error('[DB] Schema init failed:', err.message);
    throw err;
  });
}

export function close(): Promise<void> {
  return pool.end();
}

// ── Helper: get or create player ID ──────────────────────────────

export function getOrCreatePlayerId(name: string): Promise<number> {
  const nameLower = name.toLowerCase();
  return pool.query(
    'INSERT INTO players (name, name_lower, first_seen, last_seen) VALUES ($1, $2, NOW(), NOW()) ' +
    'ON CONFLICT (name_lower) DO UPDATE SET name = $1, last_seen = NOW() RETURNING id',
    [name, nameLower]
  ).then(function (res: any) {
    return res.rows[0].id;
  });
}

// ── Players ──────────────────────────────────────────────────────

export function upsertPlayer(name: string, data: any): Promise<any> {
  const nameLower = name.toLowerCase();
  return pool.query(
    'INSERT INTO players (name, name_lower, class_name, class_id, title, is_master, first_seen, last_seen, source, legend_class_name, group_name, last_legend_update) ' +
    'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ' +
    'ON CONFLICT (name_lower) DO UPDATE SET ' +
    'name = $1, ' +
    'class_name = COALESCE(NULLIF($3, \'\'), players.class_name), ' +
    'class_id = CASE WHEN $4 >= 0 THEN $4 ELSE players.class_id END, ' +
    'title = CASE WHEN $5 IS NOT NULL THEN $5 ELSE players.title END, ' +
    'is_master = CASE WHEN $6 IS NOT NULL THEN $6 ELSE players.is_master END, ' +
    'last_seen = COALESCE($8, NOW()), ' +
    'source = COALESCE($9, players.source), ' +
    'legend_class_name = COALESCE(NULLIF($10, \'\'), players.legend_class_name), ' +
    'group_name = COALESCE(NULLIF($11, \'\'), players.group_name), ' +
    'last_legend_update = COALESCE($12, players.last_legend_update)',
    [
      name,
      nameLower,
      data.className || '',
      data.classId !== undefined ? data.classId : -1,
      data.title !== undefined ? data.title : null,
      data.isMaster !== undefined ? data.isMaster : null,
      data.firstSeen || new Date().toISOString(),
      data.lastSeen || new Date().toISOString(),
      data.source || null,
      data.legendClassName || '',
      data.groupName || '',
      data.lastLegendUpdate || null
    ]
  ).catch(function (err: Error) {
    console.error('[DB] upsertPlayer error:', err.message);
  });
}

export function getPlayer(name: string): Promise<any> {
  return pool.query(
    'SELECT * FROM players WHERE name_lower = $1',
    [name.toLowerCase()]
  ).then(function (res: any) {
    return res.rows[0] || null;
  });
}

export function getAllPlayers(): Promise<any[]> {
  return pool.query(
    'SELECT p.*, ' +
    '  COALESCE(s.sighting_count, 0) as sighting_count, ' +
    '  COALESCE(s.userlist_count, 0) as userlist_count ' +
    'FROM players p ' +
    'LEFT JOIN ( ' +
    '  SELECT player_id, ' +
    '    COUNT(*) as sighting_count, ' +
    '    COUNT(*) FILTER (WHERE source = \'userlist\') as userlist_count ' +
    '  FROM player_sightings GROUP BY player_id ' +
    ') s ON s.player_id = p.id ' +
    'ORDER BY p.last_seen DESC'
  ).then(function (res: any) {
    return res.rows;
  });
}

// ── Sightings ────────────────────────────────────────────────────

export function addSighting(playerName: string, source?: string): Promise<any> {
  return getOrCreatePlayerId(playerName).then(function (playerId: number) {
    return pool.query(
      'INSERT INTO player_sightings (player_id, timestamp, source) VALUES ($1, NOW(), $2)',
      [playerId, source || 'sighting']
    );
  }).catch(function (err: Error) {
    console.error('[DB] addSighting error:', err.message);
  });
}

export function getSightings(): Promise<any[]> {
  return pool.query(
    'SELECT p.name, p.name_lower, ' +
    '  COUNT(s.id) as count, ' +
    '  MIN(s.timestamp) as first_seen, ' +
    '  MAX(s.timestamp) as last_seen ' +
    'FROM players p ' +
    'LEFT JOIN player_sightings s ON s.player_id = p.id ' +
    'GROUP BY p.id, p.name, p.name_lower ' +
    'ORDER BY last_seen DESC NULLS LAST'
  ).then(function (res: any) {
    return res.rows.map(function (r: any) {
      return {
        name: r.name,
        count: parseInt(r.count) || 0,
        firstSeen: r.first_seen ? r.first_seen.toISOString() : null,
        lastSeen: r.last_seen ? r.last_seen.toISOString() : null
      };
    });
  });
}

export function getPlayerSightings(playerName: string): Promise<string[]> {
  return pool.query(
    'SELECT s.timestamp, s.source FROM player_sightings s ' +
    'JOIN players p ON p.id = s.player_id ' +
    'WHERE p.name_lower = $1 ORDER BY s.timestamp DESC',
    [playerName.toLowerCase()]
  ).then(function (res: any) {
    return res.rows.map(function (r: any) {
      return r.timestamp.toISOString();
    });
  });
}

export function getPlayerUserListSightings(playerName: string): Promise<string[]> {
  return pool.query(
    'SELECT s.timestamp FROM player_sightings s ' +
    'JOIN players p ON p.id = s.player_id ' +
    'WHERE p.name_lower = $1 AND s.source = \'userlist\' ' +
    'ORDER BY s.timestamp DESC LIMIT 500',
    [playerName.toLowerCase()]
  ).then(function (res: any) {
    return res.rows.map(function (r: any) {
      return r.timestamp.toISOString();
    });
  });
}

// ── Legends ──────────────────────────────────────────────────────

export function setPlayerLegends(playerName: string, legends: any[]): Promise<any> {
  return getOrCreatePlayerId(playerName).then(function (playerId: number) {
    return pool.query('DELETE FROM player_legends WHERE player_id = $1', [playerId])
      .then(function () {
        if (!legends || legends.length === 0) return;
        const values: string[] = [];
        const params: any[] = [];
        let idx = 1;
        for (let i = 0; i < legends.length; i++) {
          const l = legends[i];
          values.push('($' + idx + ', $' + (idx+1) + ', $' + (idx+2) + ', $' + (idx+3) + ', $' + (idx+4) + ')');
          params.push(playerId, l.icon, l.color, l.key, l.text);
          idx += 5;
        }
        return pool.query(
          'INSERT INTO player_legends (player_id, icon, color, legend_key, legend_text) VALUES ' + values.join(', '),
          params
        );
      });
  }).catch(function (err: Error) {
    console.error('[DB] setPlayerLegends error:', err.message);
  });
}

export function addLegendSnapshot(playerName: string, legends: any[]): Promise<any> {
  return getOrCreatePlayerId(playerName).then(function (playerId: number) {
    return pool.query(
      'INSERT INTO player_legend_history (player_id, timestamp, legends) VALUES ($1, NOW(), $2)',
      [playerId, JSON.stringify(legends)]
    ).then(function () {
      // Keep max 20 history snapshots per player
      return pool.query(
        'DELETE FROM player_legend_history WHERE id IN (' +
        '  SELECT id FROM player_legend_history WHERE player_id = $1 ' +
        '  ORDER BY timestamp DESC OFFSET 20' +
        ')',
        [playerId]
      );
    });
  }).catch(function (err: Error) {
    console.error('[DB] addLegendSnapshot error:', err.message);
  });
}

export function getPlayerLegends(playerName: string): Promise<any[]> {
  return pool.query(
    'SELECT l.icon, l.color, l.legend_key as key, l.legend_text as text FROM player_legends l ' +
    'JOIN players p ON p.id = l.player_id ' +
    'WHERE p.name_lower = $1',
    [playerName.toLowerCase()]
  ).then(function (res: any) {
    return res.rows;
  });
}

export function getLegendHistory(playerName: string): Promise<any[]> {
  return pool.query(
    'SELECT h.timestamp, h.legends FROM player_legend_history h ' +
    'JOIN players p ON p.id = h.player_id ' +
    'WHERE p.name_lower = $1 ORDER BY h.timestamp DESC LIMIT 20',
    [playerName.toLowerCase()]
  ).then(function (res: any) {
    return res.rows.map(function (r: any) {
      return {
        timestamp: r.timestamp.toISOString(),
        legends: r.legends
      };
    });
  });
}

export function getAllUserListSightings(): Promise<Record<string, string[]>> {
  return pool.query(
    'SELECT p.name_lower, s.timestamp FROM player_sightings s ' +
    'JOIN players p ON p.id = s.player_id ' +
    'WHERE s.source = \'userlist\' ' +
    'ORDER BY s.timestamp DESC'
  ).then(function (res: any) {
    const byPlayer: Record<string, string[]> = {};
    for (let i = 0; i < res.rows.length; i++) {
      const r = res.rows[i];
      const key = r.name_lower;
      if (!byPlayer[key]) byPlayer[key] = [];
      byPlayer[key].push(r.timestamp.toISOString());
    }
    return byPlayer;
  });
}

export function getRecentUserListSightings(limit: number): Promise<Record<string, string[]>> {
  return pool.query(
    'SELECT name_lower, timestamp FROM (' +
    '  SELECT p.name_lower, s.timestamp, ' +
    '    ROW_NUMBER() OVER (PARTITION BY p.name_lower ORDER BY s.timestamp DESC) as rn ' +
    '  FROM player_sightings s ' +
    '  JOIN players p ON p.id = s.player_id ' +
    '  WHERE s.source = \'userlist\'' +
    ') sub WHERE rn <= $1',
    [limit]
  ).then(function (res: any) {
    const byPlayer: Record<string, string[]> = {};
    for (let i = 0; i < res.rows.length; i++) {
      const r = res.rows[i];
      const key = r.name_lower;
      if (!byPlayer[key]) byPlayer[key] = [];
      byPlayer[key].push(r.timestamp.toISOString());
    }
    return byPlayer;
  });
}

export function getPlayerUserListSightingsFull(playerName: string, limit: number = 500): Promise<string[]> {
  return pool.query(
    'SELECT s.timestamp FROM player_sightings s ' +
    'JOIN players p ON p.id = s.player_id ' +
    'WHERE p.name_lower = $1 AND s.source = \'userlist\' ' +
    'ORDER BY s.timestamp DESC LIMIT $2',
    [playerName.toLowerCase(), limit]
  ).then(function (res: any) {
    return res.rows.map(function (r: any) { return r.timestamp.toISOString(); });
  });
}

export function getAllPlayerLegends(): Promise<Record<string, any[]>> {
  return pool.query(
    'SELECT p.name_lower, l.icon, l.color, l.legend_key as key, l.legend_text as text ' +
    'FROM player_legends l JOIN players p ON p.id = l.player_id'
  ).then(function (res: any) {
    const byPlayer: Record<string, any[]> = {};
    for (let i = 0; i < res.rows.length; i++) {
      const r = res.rows[i];
      const key = r.name_lower;
      if (!byPlayer[key]) byPlayer[key] = [];
      byPlayer[key].push({ icon: r.icon, color: r.color, key: r.key, text: r.text });
    }
    return byPlayer;
  });
}

export function getAllLegendHistory(): Promise<Record<string, any[]>> {
  return pool.query(
    'SELECT p.name_lower, h.timestamp, h.legends ' +
    'FROM player_legend_history h JOIN players p ON p.id = h.player_id ' +
    'ORDER BY h.timestamp DESC'
  ).then(function (res: any) {
    const byPlayer: Record<string, any[]> = {};
    for (let i = 0; i < res.rows.length; i++) {
      const r = res.rows[i];
      const key = r.name_lower;
      if (!byPlayer[key]) byPlayer[key] = [];
      byPlayer[key].push({
        timestamp: r.timestamp.toISOString(),
        legends: r.legends
      });
    }
    return byPlayer;
  });
}

// ── Player Sessions ──────────────────────────────────────────────

export function addPlayerSession(playerName: string, appeared: string): Promise<any> {
  return getOrCreatePlayerId(playerName).then(function (playerId: number) {
    return pool.query(
      'INSERT INTO player_sessions (player_id, appeared) VALUES ($1, $2) RETURNING id',
      [playerId, appeared]
    ).then(function (res: any) {
      return res.rows[0].id;
    });
  }).catch(function (err: Error) {
    console.error('[DB] addPlayerSession error:', err.message);
  });
}

export function endPlayerSession(playerName: string, disappeared: string): Promise<any> {
  return getOrCreatePlayerId(playerName).then(function (playerId: number) {
    return pool.query(
      'UPDATE player_sessions SET disappeared = $1 WHERE player_id = $2 AND disappeared IS NULL',
      [disappeared, playerId]
    );
  }).catch(function (err: Error) {
    console.error('[DB] endPlayerSession error:', err.message);
  });
}

export function getPlayerSessions(playerName: string): Promise<any[]> {
  return pool.query(
    'SELECT s.appeared, s.disappeared FROM player_sessions s ' +
    'JOIN players p ON p.id = s.player_id ' +
    'WHERE p.name_lower = $1 ORDER BY s.appeared DESC LIMIT 200',
    [playerName.toLowerCase()]
  ).then(function (res: any) {
    return res.rows.map(function (r: any) {
      return {
        appeared: r.appeared ? r.appeared.toISOString() : null,
        disappeared: r.disappeared ? r.disappeared.toISOString() : null
      };
    });
  });
}

export function getAllPlayerSessions(): Promise<Record<string, any[]>> {
  return pool.query(
    'SELECT p.name_lower, s.appeared, s.disappeared FROM player_sessions s ' +
    'JOIN players p ON p.id = s.player_id ' +
    'ORDER BY s.appeared DESC'
  ).then(function (res: any) {
    const byPlayer: Record<string, any[]> = {};
    for (let i = 0; i < res.rows.length; i++) {
      const r = res.rows[i];
      const key = r.name_lower;
      if (!byPlayer[key]) byPlayer[key] = [];
      byPlayer[key].push({
        appeared: r.appeared ? r.appeared.toISOString() : null,
        disappeared: r.disappeared ? r.disappeared.toISOString() : null
      });
    }
    return byPlayer;
  });
}

export function getRecentPlayerSessions(limit: number): Promise<Record<string, any[]>> {
  return pool.query(
    'SELECT name_lower, appeared, disappeared FROM (' +
    '  SELECT p.name_lower, s.appeared, s.disappeared, ' +
    '    ROW_NUMBER() OVER (PARTITION BY p.name_lower ORDER BY s.appeared DESC) as rn ' +
    '  FROM player_sessions s ' +
    '  JOIN players p ON p.id = s.player_id' +
    ') sub WHERE rn <= $1',
    [limit]
  ).then(function (res: any) {
    const byPlayer: Record<string, any[]> = {};
    for (let i = 0; i < res.rows.length; i++) {
      const r = res.rows[i];
      const key = r.name_lower;
      if (!byPlayer[key]) byPlayer[key] = [];
      byPlayer[key].push({
        appeared: r.appeared ? r.appeared.toISOString() : null,
        disappeared: r.disappeared ? r.disappeared.toISOString() : null
      });
    }
    return byPlayer;
  });
}

// ── Chat Logs ────────────────────────────────────────────────────

export function insertChatLog(entry: any): Promise<any> {
  const ts = entry.timestamp ? new Date(entry.timestamp).toISOString() : new Date().toISOString();
  const botId = (entry.botId || '').slice(0, 50) || null;
  const channelName = (entry.channelName || '').slice(0, 50);
  const sender = (entry.sender || '').slice(0, 50);
  return pool.query(
    'INSERT INTO chat_logs (bot_id, timestamp, channel, channel_name, sender, message, raw, mentions) ' +
    'VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [
      botId,
      ts,
      entry.channel || 0,
      channelName,
      sender,
      entry.message || '',
      entry.raw || '',
      entry.mentions || []
    ]
  ).catch(function (err: Error) {
    console.error('[DB] insertChatLog error:', err.message);
  });
}

export function getChatLogsForPlayer(name: string, limit?: number): Promise<string[]> {
  return pool.query(
    'SELECT timestamp, channel_name, sender, message FROM chat_logs ' +
    'WHERE LOWER(sender) = $1 ORDER BY timestamp DESC LIMIT $2',
    [name.toLowerCase(), limit || 200]
  ).then(function (res: any) {
    // Return in chronological order (oldest first) to match old file behavior
    return res.rows.reverse().map(function (r: any) {
      const ts = r.timestamp ? new Date(r.timestamp).toLocaleString('en-US', { timeZone: 'America/Chicago' }) : '';
      return '[' + ts + '] [' + r.channel_name + '] ' + r.sender + ': ' + r.message;
    });
  });
}

export function getRecentChatHistory(limit?: number): Promise<any[]> {
  return pool.query(
    'SELECT bot_id, timestamp, channel, channel_name, raw, sender, message, mentions ' +
    'FROM chat_logs ORDER BY timestamp DESC LIMIT $1',
    [limit || 200]
  ).then(function (res: any) {
    // Return in chronological order
    return res.rows.reverse().map(function (r: any) {
      return {
        botId: r.bot_id,
        timestamp: r.timestamp ? new Date(r.timestamp).getTime() : Date.now(),
        channel: r.channel,
        channelName: r.channel_name,
        raw: r.raw,
        sender: r.sender,
        message: r.message,
        mentions: r.mentions || []
      };
    });
  });
}

// ── Config ───────────────────────────────────────────────────────

export function loadConfig(): Promise<any> {
  return pool.query('SELECT config FROM bot_config WHERE id = 1')
    .then(function (res: any) {
      if (res.rows.length > 0) {
        return res.rows[0].config;
      }
      return null;
    });
}

export function saveConfig(config: any): Promise<any> {
  return pool.query(
    'INSERT INTO bot_config (id, config, updated_at) VALUES (1, $1, NOW()) ' +
    'ON CONFLICT (id) DO UPDATE SET config = $1, updated_at = NOW()',
    [JSON.stringify(config)]
  ).catch(function (err: Error) {
    console.error('[DB] saveConfig error:', err.message);
  });
}

// ── Discord Rules ────────────────────────────────────────────────

export function loadDiscordRules(): Promise<any[]> {
  return pool.query('SELECT * FROM discord_rules ORDER BY name')
    .then(function (res: any) {
      return res.rows.map(function (r: any) {
        return {
          id: r.id,
          name: r.name,
          enabled: r.enabled,
          webhookUrl: r.webhook_url,
          messageTypes: r.message_types || [],
          pattern: r.pattern || null,
          botName: r.bot_name || '',
          botAvatar: r.bot_avatar || null
        };
      });
    });
}

export function saveDiscordRule(rule: any): Promise<any> {
  return pool.query(
    'INSERT INTO discord_rules (id, name, enabled, webhook_url, message_types, pattern, bot_name, bot_avatar) ' +
    'VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ' +
    'ON CONFLICT (id) DO UPDATE SET ' +
    'name = $2, enabled = $3, webhook_url = $4, message_types = $5, pattern = $6, bot_name = $7, bot_avatar = $8',
    [
      rule.id,
      rule.name || '',
      rule.enabled !== false,
      rule.webhookUrl || '',
      rule.messageTypes || [],
      rule.pattern || null,
      rule.botName || '',
      rule.botAvatar || null
    ]
  ).catch(function (err: Error) {
    console.error('[DB] saveDiscordRule error:', err.message);
  });
}

export function deleteDiscordRule(id: string): Promise<any> {
  return pool.query('DELETE FROM discord_rules WHERE id = $1', [id])
    .catch(function (err: Error) {
      console.error('[DB] deleteDiscordRule error:', err.message);
    });
}

// ── Scheduled Messages ───────────────────────────────────────────

export function loadScheduledMessages(): Promise<any[]> {
  return pool.query('SELECT * FROM scheduled_messages ORDER BY name')
    .then(function (res: any) {
      return res.rows.map(function (r: any) {
        return {
          id: r.id,
          name: r.name || '',
          enabled: r.enabled !== false,
          type: r.type || 'interval',
          interval: r.interval_minutes || 30,
          dailyTime: r.daily_time || '08:00',
          onetimeAt: r.onetime_at ? r.onetime_at.toISOString() : null,
          message: r.message || '',
          botId: r.bot_id || 'primary',
          messageType: r.message_type || 'say',
          whisperTarget: r.whisper_target || '',
          lastFired: r.last_fired ? parseInt(r.last_fired) : undefined,
          lastSuccess: r.last_success
        };
      });
    });
}

export function saveScheduledMessage(sched: any): Promise<any> {
  return pool.query(
    'INSERT INTO scheduled_messages (id, name, enabled, type, interval_minutes, daily_time, onetime_at, message, bot_id, message_type, whisper_target, last_fired, last_success) ' +
    'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ' +
    'ON CONFLICT (id) DO UPDATE SET ' +
    'name = $2, enabled = $3, type = $4, interval_minutes = $5, daily_time = $6, onetime_at = $7, ' +
    'message = $8, bot_id = $9, message_type = $10, whisper_target = $11, last_fired = $12, last_success = $13',
    [
      sched.id,
      sched.name || '',
      sched.enabled !== false,
      sched.type || 'interval',
      sched.interval || 30,
      sched.dailyTime || '08:00',
      sched.onetimeAt || null,
      sched.message || '',
      sched.botId || 'primary',
      sched.messageType || 'say',
      sched.whisperTarget || '',
      sched.lastFired || null,
      sched.lastSuccess !== undefined ? sched.lastSuccess : null
    ]
  ).catch(function (err: Error) {
    console.error('[DB] saveScheduledMessage error:', err.message);
  });
}

export function deleteScheduledMessage(id: string): Promise<any> {
  return pool.query('DELETE FROM scheduled_messages WHERE id = $1', [id])
    .catch(function (err: Error) {
      console.error('[DB] deleteScheduledMessage error:', err.message);
    });
}

export function updateScheduleFired(id: string, lastFired: number, success: boolean): Promise<any> {
  return pool.query(
    'UPDATE scheduled_messages SET last_fired = $2, last_success = $3 WHERE id = $1',
    [id, lastFired, success]
  ).catch(function (err: Error) {
    console.error('[DB] updateScheduleFired error:', err.message);
  });
}

// ── Leaderboard ──────────────────────────────────────────────────

export function loadLeaderboard(): Promise<{ scoreboard: Map<string, any>; totalGamesPlayed: number }> {
  return pool.query('SELECT * FROM game_leaderboard ORDER BY wins DESC')
    .then(function (res: any) {
      const map = new Map<string, any>();
      let total = 0;
      for (let i = 0; i < res.rows.length; i++) {
        const r = res.rows[i];
        const entry = {
          name: r.name,
          wins: r.wins || 0,
          played: r.played || 0,
          currentStreak: r.current_streak || 0,
          bestStreak: r.best_streak || 0,
          byGame: r.by_game || {}
        };
        map.set(r.name_lower, entry);
        total += entry.played;
      }
      return { scoreboard: map, totalGamesPlayed: total };
    });
}

export function savePlayerScore(name: string, data: any): Promise<any> {
  const nameLower = name.toLowerCase();
  return pool.query(
    'INSERT INTO game_leaderboard (name, name_lower, wins, played, current_streak, best_streak, by_game) ' +
    'VALUES ($1, $2, $3, $4, $5, $6, $7) ' +
    'ON CONFLICT (name_lower) DO UPDATE SET ' +
    'name = $1, wins = $3, played = $4, current_streak = $5, best_streak = $6, by_game = $7',
    [
      data.name || name,
      nameLower,
      data.wins || 0,
      data.played || 0,
      data.currentStreak || 0,
      data.bestStreak || 0,
      JSON.stringify(data.byGame || {})
    ]
  ).catch(function (err: Error) {
    console.error('[DB] savePlayerScore error:', err.message);
  });
}

export function clearLeaderboard(): Promise<any> {
  return pool.query('DELETE FROM game_leaderboard')
    .catch(function (err: Error) {
      console.error('[DB] clearLeaderboard error:', err.message);
    });
}

// ── Clear All Player Data ────────────────────────────────────────

export function clearAllPlayerData(): Promise<void> {
  return pool.query('DELETE FROM player_legend_history')
    .then(function () { return pool.query('DELETE FROM player_legends'); })
    .then(function () { return pool.query('DELETE FROM player_appearances'); })
    .then(function () { return pool.query('DELETE FROM player_sightings'); })
    .then(function () { return pool.query('DELETE FROM player_sessions'); })
    .then(function () { return pool.query('DELETE FROM chat_logs'); })
    .then(function () { return pool.query('DELETE FROM players'); })
    .then(function () {
      console.log('[DB] All player data cleared');
    })
    .catch(function (err: Error) {
      console.error('[DB] clearAllPlayerData error:', err.message);
    });
}


// ── Knowledge Base ───────────────────────────────────────────────

export function getAllKnowledge(): Promise<any[]> {
  return pool.query('SELECT * FROM knowledge_base ORDER BY category, title')
    .then(function (res: any) {
      return res.rows.map(function (r: any) {
        return {
          id: r.id,
          category: r.category,
          title: r.title,
          content: r.content,
          createdAt: r.created_at ? r.created_at.toISOString() : null,
          updatedAt: r.updated_at ? r.updated_at.toISOString() : null
        };
      });
    });
}

export function getKnowledgeByCategory(category: string): Promise<any[]> {
  return pool.query('SELECT * FROM knowledge_base WHERE category = $1 ORDER BY title', [category])
    .then(function (res: any) {
      return res.rows.map(function (r: any) {
        return {
          id: r.id,
          category: r.category,
          title: r.title,
          content: r.content,
          createdAt: r.created_at ? r.created_at.toISOString() : null,
          updatedAt: r.updated_at ? r.updated_at.toISOString() : null
        };
      });
    });
}

export function saveKnowledge(entry: any): Promise<any> {
  if (entry.id) {
    return pool.query(
      'UPDATE knowledge_base SET category = $1, title = $2, content = $3, updated_at = NOW() WHERE id = $4 RETURNING *',
      [entry.category, entry.title, entry.content, entry.id]
    ).then(function (res: any) {
      return res.rows[0];
    });
  }
  return pool.query(
    'INSERT INTO knowledge_base (category, title, content) VALUES ($1, $2, $3) RETURNING *',
    [entry.category, entry.title, entry.content]
  ).then(function (res: any) {
    return res.rows[0];
  });
}

export function deleteKnowledge(id: number): Promise<any> {
  return pool.query('DELETE FROM knowledge_base WHERE id = $1', [id]);
}

// ── Player Appearances ──────────────────────────────────────────

export function upsertPlayerAppearance(name: string, appearance: any): Promise<any> {
  return getOrCreatePlayerId(name).then(function (playerId: number) {
    return pool.query(
      'INSERT INTO player_appearances (player_id, appearance, updated_at) VALUES ($1, $2, NOW()) ' +
      'ON CONFLICT (player_id) DO UPDATE SET appearance = $2, updated_at = NOW()',
      [playerId, JSON.stringify(appearance)]
    );
  }).catch(function (err: Error) {
    console.error('[DB] upsertPlayerAppearance error:', err.message);
  });
}

export function getAllPlayerAppearances(): Promise<Record<string, any>> {
  return pool.query(
    'SELECT p.name_lower, a.appearance FROM player_appearances a ' +
    'JOIN players p ON p.id = a.player_id'
  ).then(function (res: any) {
    const byPlayer: Record<string, any> = {};
    for (let i = 0; i < res.rows.length; i++) {
      byPlayer[res.rows[i].name_lower] = res.rows[i].appearance;
    }
    return byPlayer;
  });
}

export function clearAllAppearances(): Promise<void> {
  return pool.query('DELETE FROM player_appearances').then(function () {
    console.log('[DB] All player appearances cleared');
  });
}

// ── AI Conversations ─────────────────────────────────────────────

export function saveAIMessage(playerName: string, role: string, content: string): Promise<any> {
  return pool.query(
    'INSERT INTO ai_conversations (player_name, player_lower, role, content) VALUES ($1, $2, $3, $4)',
    [playerName, playerName.toLowerCase(), role, content]
  ).catch(function (err: Error) {
    console.error('[DB] Failed to save AI message:', err.message);
  });
}

export function loadAIConversation(playerName: string, limit?: number): Promise<any[]> {
  return pool.query(
    'SELECT role, content, timestamp FROM ai_conversations WHERE player_lower = $1 ORDER BY timestamp DESC LIMIT $2',
    [playerName.toLowerCase(), limit || 30]
  ).then(function (res: any) {
    return res.rows.reverse();
  }).catch(function (err: Error) {
    console.error('[DB] Failed to load AI conversation:', err.message);
    return [];
  });
}

export function pruneOldAIConversations(daysOld?: number): Promise<any> {
  return pool.query(
    'DELETE FROM ai_conversations WHERE timestamp < NOW() - INTERVAL \'' + (daysOld || 7) + ' days\''
  ).catch(function (err: Error) {
    console.error('[DB] Failed to prune AI conversations:', err.message);
  });
}

// ── Attendance ──────────────────────────────────────────────────

export function createAttendanceEvent(eventName: string, startedAt: number): Promise<number> {
  return pool.query(
    'INSERT INTO attendance_events (event_name, started_at, active, total_count) VALUES ($1, $2, TRUE, 0) RETURNING id',
    [eventName, startedAt]
  ).then(function (res: any) {
    return res.rows[0].id;
  });
}

export function stopAttendanceEvent(eventId: number, stoppedAt: number): Promise<any> {
  return pool.query(
    'UPDATE attendance_events SET active = FALSE, stopped_at = $1 WHERE id = $2',
    [stoppedAt, eventId]
  ).catch(function (err: Error) {
    console.error('[DB] stopAttendanceEvent error:', err.message);
  });
}

export function updateAttendanceEventCount(eventId: number, totalCount: number): Promise<any> {
  return pool.query(
    'UPDATE attendance_events SET total_count = $1 WHERE id = $2',
    [totalCount, eventId]
  ).catch(function (err: Error) {
    console.error('[DB] updateAttendanceEventCount error:', err.message);
  });
}

export function upsertAttendanceRecord(eventId: number, name: string, firstSeen: number, lastSeen: number, sightings: number): Promise<any> {
  return pool.query(
    'INSERT INTO attendance_records (event_id, name, name_lower, first_seen, last_seen, sightings) ' +
    'VALUES ($1, $2, $3, $4, $5, $6) ' +
    'ON CONFLICT (event_id, name_lower) DO UPDATE SET last_seen = $5, sightings = $6',
    [eventId, name, name.toLowerCase(), firstSeen, lastSeen, sightings]
  ).catch(function (err: Error) {
    console.error('[DB] upsertAttendanceRecord error:', err.message);
  });
}

export function clearAttendanceEvent(eventId: number): Promise<any> {
  return pool.query('DELETE FROM attendance_events WHERE id = $1', [eventId])
    .catch(function (err: Error) {
      console.error('[DB] clearAttendanceEvent error:', err.message);
    });
}

export function loadActiveAttendanceEvent(): Promise<any> {
  return pool.query(
    'SELECT * FROM attendance_events WHERE active = TRUE ORDER BY id DESC LIMIT 1'
  ).then(function (res: any) {
    if (res.rows.length === 0) return null;
    return res.rows[0];
  });
}

export function loadLatestAttendanceEvent(): Promise<any> {
  return pool.query(
    'SELECT * FROM attendance_events ORDER BY id DESC LIMIT 1'
  ).then(function (res: any) {
    if (res.rows.length === 0) return null;
    return res.rows[0];
  });
}

export function loadAttendanceRecords(eventId: number): Promise<any[]> {
  return pool.query(
    'SELECT * FROM attendance_records WHERE event_id = $1 ORDER BY first_seen ASC',
    [eventId]
  ).then(function (res: any) {
    return res.rows.map(function (r: any) {
      return {
        name: r.name,
        firstSeen: parseInt(r.first_seen),
        lastSeen: parseInt(r.last_seen),
        sightings: r.sightings
      };
    });
  });
}

export function loadAllAttendanceEvents(): Promise<any[]> {
  return pool.query(
    'SELECT * FROM attendance_events ORDER BY id DESC LIMIT 50'
  ).then(function (res: any) {
    return res.rows.map(function (r: any) {
      return {
        id: r.id,
        eventName: r.event_name,
        startedAt: parseInt(r.started_at),
        stoppedAt: r.stopped_at ? parseInt(r.stopped_at) : null,
        active: r.active,
        totalCount: r.total_count
      };
    });
  });
}

// ── Packet Captures ─────────────────────────────────────────────

export function persistPacketCapture(
  sessionId: string, characterName: string, direction: string,
  opcode: number, opcodeName: string, bodyLength: number, hexBody: string
): void {
  pool.query(
    'INSERT INTO packet_captures (session_id, character_name, direction, opcode, opcode_name, body_length, hex_body) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [sessionId, characterName, direction, opcode, opcodeName, bodyLength, hexBody]
  ).catch(function (err: Error) {
    console.error('[DB] Packet capture persist error:', err.message);
  });
}

export function searchPacketCaptures(filters: {
  opcode?: number;
  direction?: string;
  character?: string;
  since?: string;
  limit?: number;
}): Promise<any[]> {
  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (filters.opcode !== undefined) {
    conditions.push('opcode = $' + idx++);
    params.push(filters.opcode);
  }
  if (filters.direction) {
    conditions.push('direction = $' + idx++);
    params.push(filters.direction);
  }
  if (filters.character) {
    conditions.push('LOWER(character_name) = $' + idx++);
    params.push(filters.character.toLowerCase());
  }
  if (filters.since) {
    conditions.push('captured_at >= $' + idx++);
    params.push(filters.since);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const limit = filters.limit || 50;
  params.push(limit);

  return pool.query(
    'SELECT * FROM packet_captures ' + where + ' ORDER BY captured_at DESC LIMIT $' + idx,
    params
  ).then(function (res: any) {
    return res.rows.map(function (r: any) {
      return {
        id: r.id,
        sessionId: r.session_id,
        characterName: r.character_name,
        direction: r.direction,
        opcode: r.opcode,
        opcodeName: r.opcode_name,
        bodyLength: r.body_length,
        hexBody: r.hex_body,
        decodedFields: r.decoded_fields,
        capturedAt: r.captured_at ? r.captured_at.toISOString() : null
      };
    });
  });
}

export function getPacketStats(since?: string): Promise<any> {
  const params: any[] = [];
  const where = since ? 'WHERE captured_at >= $1' : '';
  if (since) params.push(since);

  return pool.query(
    'SELECT opcode, opcode_name, direction, COUNT(*) as count, AVG(body_length) as avg_length ' +
    'FROM packet_captures ' + where + ' ' +
    'GROUP BY opcode, opcode_name, direction ORDER BY count DESC',
    params
  ).then(function (res: any) {
    return {
      totalPackets: res.rows.reduce((sum: number, r: any) => sum + parseInt(r.count), 0),
      byOpcode: res.rows.map(function (r: any) {
        return {
          opcode: r.opcode,
          opcodeName: r.opcode_name,
          direction: r.direction,
          count: parseInt(r.count),
          avgLength: Math.round(parseFloat(r.avg_length))
        };
      })
    };
  });
}

export function pruneOldPacketCaptures(daysOld?: number): Promise<any> {
  return pool.query(
    'DELETE FROM packet_captures WHERE captured_at < NOW() - INTERVAL \'' + (daysOld || 7) + ' days\''
  ).catch(function (err: Error) {
    console.error('[DB] Packet capture prune error:', err.message);
  });
}

// ── AFK Shadow Progress ─────────────────────────────────────────

export function loadAfkProgress(characterName: string): Promise<{ stats: any; inventory: any[]; spells: any[]; skills: any[] } | null> {
  const lower = characterName.toLowerCase();
  return pool.query(
    'SELECT shadow_stats FROM afk_shadow_progress WHERE character_name_lower = $1',
    [lower]
  ).then(function (res: any) {
    if (res.rows.length === 0) return null;
    const stats = res.rows[0].shadow_stats;
    return pool.query(
      'SELECT slot, template_key, name, sprite, color, quantity, stackable, max_durability, durability ' +
      'FROM afk_shadow_inventory WHERE character_name_lower = $1 ORDER BY slot',
      [lower]
    ).then(function (invRes: any) {
      return pool.query(
        'SELECT kind, slot, icon, name, spell_type, prompt, cast_lines ' +
        'FROM afk_shadow_spells WHERE character_name_lower = $1 ORDER BY kind, slot',
        [lower]
      ).then(function (spRes: any) {
        const spells: any[] = [];
        const skills: any[] = [];
        for (let i = 0; i < spRes.rows.length; i++) {
          const r = spRes.rows[i];
          if (r.kind === 'spell') {
            spells.push({ slot: r.slot, icon: r.icon, name: r.name, spellType: r.spell_type, prompt: r.prompt, castLines: r.cast_lines });
          } else {
            skills.push({ slot: r.slot, icon: r.icon, name: r.name });
          }
        }
        return { stats, inventory: invRes.rows, spells, skills };
      });
    });
  }).catch(function (err: Error) {
    console.error('[DB] loadAfkProgress error:', err.message);
    return null;
  });
}

export function saveAfkProgress(characterName: string, stats: any): Promise<any> {
  const lower = characterName.toLowerCase();
  return pool.query(
    'INSERT INTO afk_shadow_progress (character_name, character_name_lower, shadow_stats, updated_at) ' +
    'VALUES ($1, $2, $3, NOW()) ' +
    'ON CONFLICT (character_name_lower) DO UPDATE SET shadow_stats = $3, updated_at = NOW()',
    [characterName, lower, JSON.stringify(stats)]
  ).catch(function (err: Error) {
    console.error('[DB] saveAfkProgress error:', err.message);
  });
}

export function saveAfkInventory(characterName: string, items: any[]): Promise<any> {
  const lower = characterName.toLowerCase();
  return pool.query(
    'DELETE FROM afk_shadow_inventory WHERE character_name_lower = $1',
    [lower]
  ).then(function () {
    if (!items || items.length === 0) return;
    const values: string[] = [];
    const params: any[] = [];
    let idx = 1;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      values.push(
        '($' + idx + ', $' + (idx+1) + ', $' + (idx+2) + ', $' + (idx+3) +
        ', $' + (idx+4) + ', $' + (idx+5) + ', $' + (idx+6) + ', $' + (idx+7) +
        ', $' + (idx+8) + ', $' + (idx+9) + ')'
      );
      params.push(
        lower, it.slot, it.templateKey, it.name,
        it.sprite, it.color ?? 0, it.quantity ?? 1, it.stackable ?? false,
        it.maxDurability ?? 100, it.durability ?? 100
      );
      idx += 10;
    }
    return pool.query(
      'INSERT INTO afk_shadow_inventory ' +
      '(character_name_lower, slot, template_key, name, sprite, color, quantity, stackable, max_durability, durability) ' +
      'VALUES ' + values.join(', '),
      params
    );
  }).catch(function (err: Error) {
    console.error('[DB] saveAfkInventory error:', err.message);
  });
}

export function saveAfkSpellsAndSkills(characterName: string, spells: any[], skills: any[]): Promise<any> {
  const lower = characterName.toLowerCase();
  return pool.query(
    'DELETE FROM afk_shadow_spells WHERE character_name_lower = $1',
    [lower]
  ).then(function () {
    const all = [
      ...spells.map(function (s: any) { return { kind: 'spell', slot: s.slot, icon: s.icon, name: s.name, spellType: s.spellType ?? 0, prompt: s.prompt ?? '', castLines: s.castLines ?? 0 }; }),
      ...skills.map(function (s: any) { return { kind: 'skill', slot: s.slot, icon: s.icon, name: s.name, spellType: 0, prompt: '', castLines: 0 }; })
    ];
    if (all.length === 0) return;
    const values: string[] = [];
    const params: any[] = [];
    let idx = 1;
    for (let i = 0; i < all.length; i++) {
      const it = all[i];
      values.push(
        '($' + idx + ', $' + (idx+1) + ', $' + (idx+2) + ', $' + (idx+3) +
        ', $' + (idx+4) + ', $' + (idx+5) + ', $' + (idx+6) + ', $' + (idx+7) + ')'
      );
      params.push(lower, it.kind, it.slot, it.icon, it.name, it.spellType, it.prompt, it.castLines);
      idx += 8;
    }
    return pool.query(
      'INSERT INTO afk_shadow_spells (character_name_lower, kind, slot, icon, name, spell_type, prompt, cast_lines) VALUES ' +
      values.join(', '),
      params
    );
  }).catch(function (err: Error) {
    console.error('[DB] saveAfkSpellsAndSkills error:', err.message);
  });
}

export function deleteAfkProgress(characterName: string): Promise<any> {
  const lower = characterName.toLowerCase();
  return pool.query(
    'DELETE FROM afk_shadow_progress WHERE character_name_lower = $1',
    [lower]
  ).catch(function (err: Error) {
    console.error('[DB] deleteAfkProgress error:', err.message);
  });
}
