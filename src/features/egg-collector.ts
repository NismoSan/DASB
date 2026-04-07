// ── Egg Collector Bot Module ────────────────────────────────────
// Accepts Easter eggs from players via exchange, announces findings,
// tracks per-player counts, and auto-banks overflow inventory to
// the EggBasketII banker bot when inventory gets full.
//
// Exchange protocol (Dark Ages):
//   0x42 IN  (type 0x00) — Incoming exchange request
//   0x42 IN  (type 0x02) — Item placed in their trade window
//   0x42 IN  (type 0x04) — Exchange cancelled / status
//   0x42 IN  (type 0x05) — Exchange completed
//   0x4B IN             — Exchange slot confirmation
//   0x4A OUT (type 0x05) — Accept exchange request
//   0x4A OUT (type 0x01) — Place item from inventory into trade
//   0x4A OUT (type 0x00) — Confirm / agree to trade
//   0x29 OUT             — Initiate exchange with a target serial
//   0x37 IN  (AddItem)   — Item added to our inventory
//   0x38 IN  (RemoveItem)— Item removed from inventory

import Packet from '../core/packet';
import fs from 'fs';
import path from 'path';

// ── Types ────────────────────────────────────────────────────────

interface PlayerEggCounts {
  [playerName: string]: {
    [eggType: string]: number;
  };
}

interface ActiveExchange {
  playerName: string;
  playerSerial: number;
  itemsOffered: Array<{ slot: number; itemName: string; sprite: number; color: number }>;
  startedAt: number;
}

interface BankingState {
  phase: 'initiating' | 'waiting_accept' | 'placing_items' | 'confirming';
  bankerSerial: number;
  itemSlots: number[];
  currentSlotIndex: number;
}

type SendPacketFn = (packet: Packet) => void;
type SendWhisperFn = (target: string, message: string) => void;
type SendSayFn = (message: string) => void;

// ── Constants ────────────────────────────────────────────────────

const EGG_TYPES: Record<string, number> = {
  'Golden Egg': 0x85F1,
  'Magenta Egg': 0x85F2,
  'Lime Egg': 0x85F3,
  'Purple Egg': 0x85F4,
  'White Egg': 0x85F5,
};

const EGG_NAMES_LOWER = new Map<string, string>();
for (const name of Object.keys(EGG_TYPES)) {
  EGG_NAMES_LOWER.set(name.toLowerCase(), name);
}

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const EGGS_FILE = path.join(DATA_DIR, 'egg-counts.json');
const EXCHANGE_TIMEOUT_MS = 60 * 1000;
const ITEM_PLACE_DELAY_MS = 1500;
const CONFIRM_DELAY_MS = 1500;
const BANKING_THRESHOLD = 50;
const BANKING_OFFLOAD_COUNT = 45;
const BANKER_BOT_NAME = 'EggBasketII';

// ── State ────────────────────────────────────────────────────────

let playerEggs: PlayerEggCounts = {};
let activeExchange: ActiveExchange | null = null;
let bankingState: BankingState | null = null;
let botInventory: Map<number, string> = new Map();

// Dependencies (injected via init)
let sendPacketFn: SendPacketFn | null = null;
let sendWhisperFn: SendWhisperFn | null = null;
let sendSayFn: SendSayFn | null = null;
let ioRef: any = null;
let getBotSerialFn: (() => number) | null = null;
let getEntityNameFn: ((serial: number) => string | undefined) | null = null;
let getSerialByNameFn: ((name: string) => number) | null = null;

// ── Persistence ──────────────────────────────────────────────────

function saveEggCounts(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(EGGS_FILE, JSON.stringify(playerEggs, null, 2));
  } catch (e) {
    console.log('[EggCollector] Failed to save egg counts: ' + (e as Error).message);
  }
}

function loadEggCounts(): void {
  try {
    if (fs.existsSync(EGGS_FILE)) {
      playerEggs = JSON.parse(fs.readFileSync(EGGS_FILE, 'utf8'));
      const totalPlayers = Object.keys(playerEggs).length;
      console.log('[EggCollector] Loaded egg counts for ' + totalPlayers + ' players');
    }
  } catch (e) {
    console.log('[EggCollector] Failed to load egg counts: ' + (e as Error).message);
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function normalizeEggName(itemName: string): string | null {
  return EGG_NAMES_LOWER.get(itemName.toLowerCase()) || null;
}

function isEgg(itemName: string): boolean {
  return EGG_NAMES_LOWER.has(itemName.toLowerCase());
}

function getEggInventorySlots(): number[] {
  const slots: number[] = [];
  for (const [slot, name] of botInventory) {
    if (slot >= 1 && slot <= 59 && isEgg(name)) {
      slots.push(slot);
    }
  }
  return slots;
}

// ── Init ─────────────────────────────────────────────────────────

export function init(deps: {
  sendPacket: SendPacketFn;
  sendWhisper: SendWhisperFn;
  sendSay: SendSayFn;
  io: any;
  getBotSerial: () => number;
  getEntityName?: (serial: number) => string | undefined;
  getSerialByName?: (name: string) => number;
}): void {
  sendPacketFn = deps.sendPacket;
  sendWhisperFn = deps.sendWhisper;
  sendSayFn = deps.sendSay;
  ioRef = deps.io;
  getBotSerialFn = deps.getBotSerial;
  getEntityNameFn = deps.getEntityName || null;
  getSerialByNameFn = deps.getSerialByName || null;
  loadEggCounts();
  console.log('[EggCollector] Initialized');
}

// ── Exchange Protocol Handlers ───────────────────────────────────

export function handleExchangeMessage(packet: Packet): void {
  const saved = packet.position;
  try {
    const hexBytes = packet.body.map((b: number) => b.toString(16).padStart(2, '0')).join(' ');
    console.log('[EggCollector] 0x42 raw body (' + packet.body.length + ' bytes): ' + hexBytes);

    const type = packet.readByte();

    if (type === 0x00) {
      // Exchange request: [00] [serial:4] [name:string8]
      const otherSerial = packet.readUInt32();
      const name = packet.readString8();

      let playerName = name;
      if (!playerName && getEntityNameFn) {
        playerName = getEntityNameFn(otherSerial) || '';
      }

      console.log('[EggCollector] Exchange request from "' + playerName + '" (serial 0x' + otherSerial.toString(16) + ')');

      // Check if this is the banker accepting our banking exchange
      if (bankingState && bankingState.phase === 'waiting_accept' && otherSerial === bankingState.bankerSerial) {
        console.log('[EggCollector] Banker accepted banking exchange');
        bankingState.phase = 'placing_items';
        bankingState.currentSlotIndex = 0;
        setTimeout(() => placeNextBankingItem(), ITEM_PLACE_DELAY_MS);
        packet.position = saved;
        return;
      }

      // Reject if banking is in progress
      if (bankingState) {
        console.log('[EggCollector] Busy banking, rejecting exchange from ' + playerName);
        if (sendWhisperFn && playerName) {
          sendWhisperFn(playerName, 'I\'m busy right now, try again in a moment!');
        }
        packet.position = saved;
        return;
      }

      // Reject if already in an exchange
      if (activeExchange) {
        console.log('[EggCollector] Already in exchange, ignoring ' + playerName);
        packet.position = saved;
        return;
      }

      activeExchange = {
        playerName: playerName,
        playerSerial: otherSerial,
        itemsOffered: [],
        startedAt: Date.now()
      };

      // Accept the exchange: 0x4A [05] [serial:4]
      if (sendPacketFn) {
        const accept = new Packet(0x4A);
        accept.writeByte(0x05);
        accept.writeUInt32(otherSerial);
        sendPacketFn(accept);
        console.log('[EggCollector] Accepted exchange from ' + playerName);
      }

      // Timeout safety
      const capturedSerial = otherSerial;
      setTimeout(() => {
        if (activeExchange && activeExchange.playerSerial === capturedSerial) {
          console.log('[EggCollector] Exchange with ' + playerName + ' timed out');
          activeExchange = null;
        }
      }, EXCHANGE_TIMEOUT_MS);

    } else if (type === 0x02) {
      // Item placed: [02] [slot:1] [sprite:2] [color:1] [name:string16]
      const slot = packet.readByte();
      const itemSprite = packet.readUInt16();
      const itemColor = packet.readByte();
      const itemName = packet.readString16();

      console.log('[EggCollector] Item offered in slot ' + slot + ': "' + itemName + '"');

      if (activeExchange) {
        if (isEgg(itemName)) {
          activeExchange.itemsOffered.push({ slot, itemName, sprite: itemSprite, color: itemColor });
          console.log('[EggCollector] Egg accepted: "' + itemName + '" from ' + activeExchange.playerName);
        } else {
          console.log('[EggCollector] Non-egg item rejected: "' + itemName + '"');
          if (sendWhisperFn) {
            sendWhisperFn(activeExchange.playerName, 'I only accept eggs!');
          }
        }
      }

    } else if (type === 0x04) {
      // Cancel / status
      packet.readByte();
      const message = packet.readString8();
      console.log('[EggCollector] Exchange status: "' + message + '"');

      if (message.toLowerCase().includes('cancel')) {
        activeExchange = null;
      }

    } else if (type === 0x05) {
      // Exchange completed
      const subtype = packet.readByte();
      const message = packet.readString8();
      console.log('[EggCollector] Exchange complete subtype=' + subtype + ': "' + message + '"');

      // Handle banking completion
      if (bankingState && subtype === 0x01) {
        console.log('[EggCollector] Banking exchange completed');
        bankingState = null;
        return;
      }

      // Player exchange final confirmation
      if (subtype === 0x01 && activeExchange) {
        const playerName = activeExchange.playerName;
        const eggsOffered = activeExchange.itemsOffered.filter(item => isEgg(item.itemName));

        if (eggsOffered.length > 0) {
          // Count eggs by type for this exchange
          const exchangeCounts: Record<string, number> = {};
          for (const item of eggsOffered) {
            const canonical = normalizeEggName(item.itemName);
            if (canonical) {
              exchangeCounts[canonical] = (exchangeCounts[canonical] || 0) + 1;
            }
          }

          // Initialize player record if needed
          if (!playerEggs[playerName]) {
            playerEggs[playerName] = {};
          }

          // Announce each egg type and update totals
          for (const [eggType, count] of Object.entries(exchangeCounts)) {
            // Per-exchange announcement
            if (sendSayFn) {
              sendSayFn(playerName + ' has found (' + count + ') ' + eggType + '\'s!');
            }

            // Update running total
            playerEggs[playerName][eggType] = (playerEggs[playerName][eggType] || 0) + count;
            const total = playerEggs[playerName][eggType];

            // Total announcement (delayed slightly so messages don't overlap)
            setTimeout(() => {
              if (sendSayFn) {
                sendSayFn(playerName + ' has found (' + total + ') ' + eggType + '\'s total!');
              }
            }, 800);
          }

          saveEggCounts();
          emitUpdate();

          console.log('[EggCollector] ' + playerName + ' deposited ' + eggsOffered.length + ' egg(s)');
        }

        activeExchange = null;

        // Check if we need to bank
        setTimeout(() => checkBankingNeeded(), 2000);
      }

    } else {
      console.log('[EggCollector] Unhandled 0x42 type: 0x' + ('0' + type.toString(16)).slice(-2));
    }
  } catch (e) {
    console.log('[EggCollector] Error handling 0x42: ' + (e as Error).message);
  }
  packet.position = saved;
}

export function handleExchangeSlot(packet: Packet): void {
  const saved = packet.position;
  try {
    const type = packet.readByte();
    const slotInfo = packet.readByte();
    const unknown = packet.readByte();
    const slot = packet.readByte();

    console.log('[EggCollector] Exchange slot update: type=' + type + ' slot=' + slot);

    // During banking, advance to next item after each placement
    if (bankingState && bankingState.phase === 'placing_items') {
      bankingState.currentSlotIndex++;
      if (bankingState.currentSlotIndex < bankingState.itemSlots.length) {
        setTimeout(() => placeNextBankingItem(), ITEM_PLACE_DELAY_MS);
      } else {
        // All items placed, confirm
        bankingState.phase = 'confirming';
        setTimeout(() => confirmBanking(), CONFIRM_DELAY_MS);
      }
    }
  } catch (e) {
    console.log('[EggCollector] Error handling 0x4B: ' + (e as Error).message);
  }
  packet.position = saved;
}

export function handleAddItem(packet: Packet): void {
  const saved = packet.position;
  try {
    const slot = packet.readByte();
    const sprite = packet.readUInt16();
    const color = packet.readByte();
    const name = packet.readString8();

    botInventory.set(slot, name);
    console.log('[EggCollector] Inventory add: slot ' + slot + ' = "' + name + '" (total: ' + botInventory.size + ')');
  } catch (e) {
    console.log('[EggCollector] Error handling 0x37: ' + (e as Error).message);
  }
  packet.position = saved;
}

export function handleRemoveItem(packet: Packet): void {
  const saved = packet.position;
  try {
    const slot = packet.readByte();
    const removed = botInventory.get(slot) || '?';
    botInventory.delete(slot);
    console.log('[EggCollector] Inventory remove: slot ' + slot + ' ("' + removed + '") (total: ' + botInventory.size + ')');
  } catch (e) {
    console.log('[EggCollector] Error handling 0x38: ' + (e as Error).message);
  }
  packet.position = saved;
}

export function handleWhisper(senderName: string, message: string): boolean {
  const trimmed = message.trim().toLowerCase();

  if (trimmed === 'eggs' || trimmed === 'my eggs') {
    const counts = playerEggs[senderName];
    if (!counts || Object.keys(counts).length === 0) {
      if (sendWhisperFn) sendWhisperFn(senderName, 'You haven\'t turned in any eggs yet!');
    } else {
      for (const [eggType, count] of Object.entries(counts)) {
        if (sendWhisperFn) sendWhisperFn(senderName, eggType + ': ' + count);
      }
    }
    return true;
  }

  if (trimmed === 'leaderboard' || trimmed === 'top') {
    // Build total eggs per player
    const totals: Array<{ name: string; total: number }> = [];
    for (const [name, counts] of Object.entries(playerEggs)) {
      const total = Object.values(counts).reduce((sum, c) => sum + c, 0);
      totals.push({ name, total });
    }
    totals.sort((a, b) => b.total - a.total);

    if (totals.length === 0) {
      if (sendWhisperFn) sendWhisperFn(senderName, 'No eggs collected yet!');
    } else {
      const top5 = totals.slice(0, 5);
      for (let i = 0; i < top5.length; i++) {
        if (sendWhisperFn) sendWhisperFn(senderName, '#' + (i + 1) + ' ' + top5[i].name + ' - ' + top5[i].total + ' eggs');
      }
    }
    return true;
  }

  return false;
}

// ── Banking: Offload eggs to EggBasketII ─────────────────────────

function checkBankingNeeded(): void {
  if (bankingState) return; // already banking
  if (activeExchange) return; // in a player exchange

  if (botInventory.size >= BANKING_THRESHOLD) {
    console.log('[EggCollector] Inventory at ' + botInventory.size + ' slots, starting banking');
    initiateBanking();
  }
}

function initiateBanking(): void {
  if (!sendPacketFn || !getSerialByNameFn) return;

  const bankerSerial = getSerialByNameFn(BANKER_BOT_NAME);
  if (!bankerSerial) {
    console.log('[EggCollector] Cannot find banker bot "' + BANKER_BOT_NAME + '" on map');
    return;
  }

  const eggSlots = getEggInventorySlots();
  if (eggSlots.length === 0) {
    console.log('[EggCollector] No eggs in inventory to bank');
    return;
  }

  const slotsToBank = eggSlots.slice(0, BANKING_OFFLOAD_COUNT);

  bankingState = {
    phase: 'initiating',
    bankerSerial: bankerSerial,
    itemSlots: slotsToBank,
    currentSlotIndex: 0
  };

  // Initiate exchange: 0x29 [01] [serial:4] [00000000]
  const initExchange = new Packet(0x29);
  initExchange.writeByte(0x01);
  initExchange.writeUInt32(bankerSerial);
  initExchange.writeUInt32(0x00000000);
  sendPacketFn(initExchange);

  bankingState.phase = 'waiting_accept';
  console.log('[EggCollector] Initiated banking exchange with ' + BANKER_BOT_NAME + ' (serial 0x' + bankerSerial.toString(16) + '), ' + slotsToBank.length + ' items');

  // Timeout: abort if banker doesn't respond in 30s
  setTimeout(() => {
    if (bankingState && bankingState.phase === 'waiting_accept') {
      console.log('[EggCollector] Banking timed out waiting for banker');
      bankingState = null;
    }
  }, 30000);
}

function placeNextBankingItem(): void {
  if (!bankingState || !sendPacketFn) return;

  const slotIndex = bankingState.currentSlotIndex;
  if (slotIndex >= bankingState.itemSlots.length) return;

  const inventorySlot = bankingState.itemSlots[slotIndex];

  // 0x4A [01] [00] [serial:4] [slot:1]
  const placeItem = new Packet(0x4A);
  placeItem.writeByte(0x01);
  placeItem.writeByte(0x00);
  placeItem.writeUInt32(bankingState.bankerSerial);
  placeItem.writeByte(inventorySlot);
  sendPacketFn(placeItem);

  console.log('[EggCollector] Banking: placed slot ' + inventorySlot + ' (' + (slotIndex + 1) + '/' + bankingState.itemSlots.length + ')');
}

function confirmBanking(): void {
  if (!bankingState || !sendPacketFn) return;

  // 0x4A [00] [00] [serial:4]
  const agree = new Packet(0x4A);
  agree.writeByte(0x00);
  agree.writeByte(0x00);
  agree.writeUInt32(bankingState.bankerSerial);
  sendPacketFn(agree);

  console.log('[EggCollector] Banking: sent trade confirmation');
}

// ── Public Getters ──────────────────────────────────────────────

export function getEggCounts(): PlayerEggCounts {
  return playerEggs;
}

export function getInventory(): Array<{ slot: number; name: string }> {
  const items: Array<{ slot: number; name: string }> = [];
  botInventory.forEach((name, slot) => {
    items.push({ slot, name });
  });
  items.sort((a, b) => a.slot - b.slot);
  return items;
}

export function getInventoryCount(): number {
  return botInventory.size;
}

export function hasActiveExchange(): boolean {
  return activeExchange !== null;
}

export function isBanking(): boolean {
  return bankingState !== null;
}

// ── Socket.IO Updates ────────────────────────────────────────────

function emitUpdate(): void {
  if (ioRef) {
    ioRef.emit('eggCollector:update', {
      eggCounts: playerEggs,
      inventoryCount: botInventory.size
    });
  }
}
