// ── Sense Bot Feature ────────────────────────────────────────────
// Automatically casts the Sense skill on players who walk in front
// of the sense bot, parses HP/MP from the chat response, and stores
// the results in the player database.

import Packet from '../core/packet';

const SENSE_SKILL_SLOT = 0x4A;
const SENSE_COOLDOWN_MS = 16000; // 16 seconds (server says 15, pad slightly)
const SENSE_RESCAN_MS = 5 * 60 * 1000; // don't re-sense same player within 5 minutes
const SENSE_RANGE = 3;

interface SenseState {
  enabled: boolean;
  botDirection: number; // 0=north, 1=west, 2=south, 3=east
  botX: number;
  botY: number;
  lastSenseTime: number;
  pendingTarget: string | null;
  recentlySensed: Map<string, number>; // name.lower → timestamp
  entityPositions: Map<number, { name: string; x: number; y: number }>;
}

const state: SenseState = {
  enabled: true,
  botDirection: 2, // default south
  botX: 0,
  botY: 0,
  lastSenseTime: 0,
  pendingTarget: null,
  recentlySensed: new Map(),
  entityPositions: new Map()
};

let sendPacketFn: ((packet: any) => void) | null = null;
let onSenseResult: ((name: string, hp: number, mp: number) => void) | null = null;

export function init(opts: {
  sendPacket: (packet: any) => void;
  onResult: (name: string, hp: number, mp: number) => void;
}): void {
  sendPacketFn = opts.sendPacket;
  onSenseResult = opts.onResult;
  console.log('[Sense] Initialized');
}

export function updateBotPosition(x: number, y: number): void {
  state.botX = x;
  state.botY = y;
}

export function updateBotDirection(dir: number): void {
  state.botDirection = dir;
}

export function clearEntities(): void {
  state.entityPositions.clear();
  state.pendingTarget = null;
}

// Called when 0x33 (ShowUser) fires — entity appeared on screen
export function onEntityAppeared(serial: number, name: string, x: number, y: number): void {
  if (!state.enabled || !name) return;
  state.entityPositions.set(serial, { name, x, y });
  tryCast(name, x, y);
}

// Called when 0x0C (EntityWalk) fires — entity moved
export function onEntityWalk(serial: number, x: number, y: number): void {
  if (!state.enabled) return;
  const entity = state.entityPositions.get(serial);
  if (!entity) return;
  entity.x = x;
  entity.y = y;
  tryCast(entity.name, x, y);
}

// Called when 0x0E/0x08 (RemoveEntity) fires
export function onEntityRemoved(serial: number): void {
  state.entityPositions.delete(serial);
}

// Entity stepped on one of the 3 tiles in front — cast immediately
function tryCast(name: string, x: number, y: number): void {
  if (!sendPacketFn) return;
  if (!isInFront(x, y)) return;
  if (state.pendingTarget) return;

  const now = Date.now();
  if (now - state.lastSenseTime < SENSE_COOLDOWN_MS) return;

  const key = name.toLowerCase();
  const lastSensed = state.recentlySensed.get(key);
  if (lastSensed && now - lastSensed < SENSE_RESCAN_MS) return;

  state.pendingTarget = name;
  state.lastSenseTime = now;
  var pkt = new Packet(0x3E);
  pkt.writeByte(SENSE_SKILL_SLOT);
  sendPacketFn(pkt);
  console.log('[Sense] Cast! target=' + name + ' at (' + x + ',' + y + ') dir=' + state.botDirection);
}

// Check if entity is on one of the 3 tiles directly in front of the bot
function isInFront(entityX: number, entityY: number): boolean {
  const dx = entityX - state.botX;
  const dy = entityY - state.botY;

  switch (state.botDirection) {
    case 0: return dx === 0 && dy < 0 && dy >= -SENSE_RANGE;
    case 1: return dy === 0 && dx < 0 && dx >= -SENSE_RANGE;
    case 2: return dx === 0 && dy > 0 && dy <= SENSE_RANGE;
    case 3: return dy === 0 && dx > 0 && dx <= SENSE_RANGE;
    default: return false;
  }
}

// Called when 0x0A (Chat) fires on the sense bot — parse sense results
export function handleChatMessage(channelByte: number, message: string): boolean {
  if (message.indexOf('Sense User') === -1) return false;

  const nameMatch = message.match(/Name:\s*(\S+)/);
  const hpMatch = message.match(/HP:\s*(\d+)/);
  const mpMatch = message.match(/MP:\s*(\d+)/);

  if (nameMatch && hpMatch && mpMatch) {
    const name = nameMatch[1];
    const hp = parseInt(hpMatch[1], 10);
    const mp = parseInt(mpMatch[1], 10);

    state.recentlySensed.set(name.toLowerCase(), Date.now());
    state.pendingTarget = null;

    console.log('[Sense] Result: ' + name + ' HP=' + hp + ' MP=' + mp);

    if (onSenseResult) {
      onSenseResult(name, hp, mp);
    }

    // Clean up old entries from recentlySensed
    const cutoff = Date.now() - SENSE_RESCAN_MS;
    state.recentlySensed.forEach(function (ts, key) {
      if (ts < cutoff) state.recentlySensed.delete(key);
    });

    return true;
  }

  // If we got a sense message but couldn't parse it, clear pending
  if (state.pendingTarget) {
    console.log('[Sense] Could not parse result, clearing pending');
    state.pendingTarget = null;
  }
  return false;
}

// Called when 0x3F (skill cooldown confirmation) fires
export function handleSkillResponse(success: number, slot: number): void {
  if (slot !== SENSE_SKILL_SLOT) return;
  if (success !== 1) {
    console.log('[Sense] Skill failed (code ' + success + '), clearing pending');
    state.pendingTarget = null;
  }
}

export function getState(): { enabled: boolean; recentCount: number; pending: string | null } {
  return {
    enabled: state.enabled,
    recentCount: state.recentlySensed.size,
    pending: state.pendingTarget
  };
}

export function setEnabled(enabled: boolean): void {
  state.enabled = enabled;
  console.log('[Sense] ' + (enabled ? 'Enabled' : 'Disabled'));
}
