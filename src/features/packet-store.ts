// ── Local SQLite packet capture store ────────────────────────────
// Used for local dev when Postgres is not available.
// Both the main server and MCP server use this module.

import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.PACKET_DB_PATH || path.join(__dirname, '..', '..', 'data', 'packets.db');

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS packet_captures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        character_name TEXT,
        direction TEXT NOT NULL,
        opcode INTEGER NOT NULL,
        opcode_name TEXT,
        body_length INTEGER NOT NULL,
        hex_body TEXT,
        decoded_fields TEXT,
        captured_at TEXT DEFAULT (datetime('now'))
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_pkt_opcode ON packet_captures(opcode)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_pkt_direction ON packet_captures(direction)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_pkt_captured_at ON packet_captures(captured_at)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_pkt_session ON packet_captures(session_id)');
  }
  return db;
}

export function persistPacketCapture(
  sessionId: string, characterName: string, direction: string,
  opcode: number, opcodeName: string, bodyLength: number, hexBody: string
): void {
  try {
    getDb().prepare(
      'INSERT INTO packet_captures (session_id, character_name, direction, opcode, opcode_name, body_length, hex_body) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(sessionId, characterName, direction, opcode, opcodeName, bodyLength, hexBody);
  } catch (err: any) {
    console.error('[PacketStore] Persist error:', err.message);
  }
}

export function searchPacketCaptures(filters: {
  opcode?: number;
  direction?: string;
  character?: string;
  since?: string;
  limit?: number;
}): any[] {
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.opcode !== undefined) {
    conditions.push('opcode = ?');
    params.push(filters.opcode);
  }
  if (filters.direction) {
    conditions.push('direction = ?');
    params.push(filters.direction);
  }
  if (filters.character) {
    conditions.push('LOWER(character_name) = ?');
    params.push(filters.character.toLowerCase());
  }
  if (filters.since) {
    conditions.push('captured_at >= ?');
    params.push(filters.since);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const limit = Math.min(filters.limit || 50, 200);
  params.push(limit);

  return getDb().prepare(
    'SELECT * FROM packet_captures ' + where + ' ORDER BY captured_at DESC LIMIT ?'
  ).all(...params);
}

export function getPacketStats(since?: string): { totalPackets: number; byOpcode: any[] } {
  const params: any[] = [];
  const where = since ? 'WHERE captured_at >= ?' : '';
  if (since) params.push(since);

  const rows = getDb().prepare(
    'SELECT opcode, opcode_name, direction, COUNT(*) as count, AVG(body_length) as avg_length ' +
    'FROM packet_captures ' + where + ' ' +
    'GROUP BY opcode, opcode_name, direction ORDER BY count DESC'
  ).all(...params) as any[];

  return {
    totalPackets: rows.reduce((sum: number, r: any) => sum + parseInt(r.count), 0),
    byOpcode: rows.map(function (r: any) {
      return {
        opcode: r.opcode,
        opcodeName: r.opcode_name,
        direction: r.direction,
        count: parseInt(r.count),
        avgLength: Math.round(parseFloat(r.avg_length))
      };
    })
  };
}

export function pruneOldPacketCaptures(daysOld?: number): void {
  try {
    getDb().prepare(
      "DELETE FROM packet_captures WHERE captured_at < datetime('now', ?)"
    ).run('-' + (daysOld || 7) + ' days');
  } catch (err: any) {
    console.error('[PacketStore] Prune error:', err.message);
  }
}
