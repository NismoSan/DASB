import fs from 'fs';
import path from 'path';
import EventEmitter from 'events';
import { XMLParser } from 'fast-xml-parser';

const XML_PATH = path.join(__dirname, '../../data/opcodes.xml');

export const opcodeEvents = new EventEmitter();

// These MUST remain the same object references across reloads
// so all require() consumers see updated values without re-importing
const INCOMING_LABELS: Record<number, string> = {};
const OUTGOING_LABELS: Record<number, string> = {};

export interface FieldDef {
  name: string;
  type: string;
  length?: string;
  description?: string;
}

const FIELD_DEFS: Map<string, FieldDef[]> = new Map();

function parseOpcodeHex(hex: string): number {
  return parseInt(hex, 16);
}

function loadFromXml(): void {
  const xml = fs.readFileSync(XML_PATH, 'utf-8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    isArray: (name) => name === 'opcode' || name === 'field' || name === 'opcodes'
  });
  const doc = parser.parse(xml);

  // Clear existing keys (mutate in place so cached require() refs stay valid)
  for (const key of Object.keys(INCOMING_LABELS)) delete (INCOMING_LABELS as any)[key];
  for (const key of Object.keys(OUTGOING_LABELS)) delete (OUTGOING_LABELS as any)[key];
  FIELD_DEFS.clear();

  const opcodeSections = doc.protocol.opcodes;
  if (!opcodeSections) return;

  for (const section of opcodeSections) {
    const direction = section.direction;
    const target = direction === 'in' ? INCOMING_LABELS : OUTGOING_LABELS;
    const entries = section.opcode;
    if (!entries) continue;

    for (const entry of entries) {
      const code = parseOpcodeHex(entry.hex);
      target[code] = entry.name;

      if (entry.field) {
        const fields: FieldDef[] = entry.field.map((f: any) => ({
          name: f.name,
          type: f.type,
          length: f.length || undefined,
          description: f.description || undefined
        }));
        FIELD_DEFS.set(`${direction}:${code}`, fields);
      }
    }
  }

  console.error(`[Opcodes] Loaded ${Object.keys(INCOMING_LABELS).length} incoming, ${Object.keys(OUTGOING_LABELS).length} outgoing from XML`);
}

// Exported so panel.js can trigger a manual reload
export function reloadFromXml(): void {
  loadFromXml();
  opcodeEvents.emit('reload');
  console.error('[Opcodes] Hot-reloaded from XML');
}

// Initial load
try {
  loadFromXml();
} catch (e: any) {
  console.error(`[Opcodes] Failed to load XML: ${e.message}`);
}

// File watcher with debounce
let reloadTimer: ReturnType<typeof setTimeout> | null = null;

try {
  fs.watch(XML_PATH, (_eventType) => {
    if (reloadTimer) return;
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      try {
        loadFromXml();
        opcodeEvents.emit('reload');
        console.error('[Opcodes] Hot-reloaded from XML');
      } catch (e: any) {
        console.error(`[Opcodes] Hot-reload failed: ${e.message}`);
      }
    }, 300);
  });
} catch (e: any) {
  console.error(`[Opcodes] Could not watch XML file: ${e.message}`);
}

// ── Existing API (unchanged signatures) ──────────────────────────

export function getOpcodeLabel(direction: 'in' | 'out', opcode: number): string {
  const table = direction === 'in' ? INCOMING_LABELS : OUTGOING_LABELS;
  return table[opcode] || 'Unknown';
}

export function getChatChannelName(byte: number): string {
  switch (byte) {
    case 0: return 'Whisper';
    case 3: return 'System';
    case 5: return 'World Shout';
    case 11: return 'Group';
    case 12: return 'Guild';
    default: return 'Ch' + byte;
  }
}

export function getPublicMessageTypeName(byte: number): string {
  switch (byte) {
    case 0: return 'Say';
    case 1: return 'Shout';
    case 2: return 'Chant';
    default: return 'Public';
  }
}

function toHex(value: number): string {
  return '0x' + ('0' + value.toString(16).toUpperCase()).slice(-2);
}

export const CLASS_NAMES: Record<number, string> = { 0: 'Peasant', 1: 'Warrior', 2: 'Rogue', 3: 'Wizard', 4: 'Priest', 5: 'Monk' };

// ── New API for MCP / packet analysis ────────────────────────────

export function getFieldDefinitions(direction: 'in' | 'out', opcode: number): FieldDef[] | undefined {
  return FIELD_DEFS.get(`${direction}:${opcode}`);
}

export function getAllOpcodes(): { direction: string; opcode: number; name: string; fields?: FieldDef[] }[] {
  const result: { direction: string; opcode: number; name: string; fields?: FieldDef[] }[] = [];
  for (const [code, name] of Object.entries(INCOMING_LABELS)) {
    const opcode = Number(code);
    result.push({ direction: 'in', opcode, name, fields: FIELD_DEFS.get(`in:${opcode}`) });
  }
  for (const [code, name] of Object.entries(OUTGOING_LABELS)) {
    const opcode = Number(code);
    result.push({ direction: 'out', opcode, name, fields: FIELD_DEFS.get(`out:${opcode}`) });
  }
  return result;
}

export { INCOMING_LABELS, OUTGOING_LABELS, toHex };
