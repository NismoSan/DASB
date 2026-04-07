// ── Lottery Bot Module ───────────────────────────────────────────
// Manages a lottery system where players trade gold bars to a
// designated lottery bot. Each gold bar = 1 ticket. When the
// drawing occurs, all collected gold bars go to the winner.
//
// Exchange protocol (Dark Ages):
//   0x42 IN  (type 0x00) — Incoming exchange request: other player wants to trade
//   0x42 IN  (type 0x02) — Item placed in their trade window (we see it)
//   0x42 IN  (type 0x05) — "You exchanged." — exchange completed
//   0x4B IN             — Exchange slot update (item placed confirmation)
//   0x4A OUT (type 0x05) — Accept exchange request
//   0x4A OUT (type 0x00) — Confirm/agree to trade
//   0x43 OUT (type 0x03) — Final confirmation
//   0x29 OUT             — Initiate exchange with a target serial
//   0x37 IN  (AddItem)   — Item added to our inventory

import Packet from '../core/packet';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// ── Types ────────────────────────────────────────────────────────

interface LotteryTicket {
  ticketNumber: number;
  playerName: string;
  itemName: string;
  inventorySlot: number;
  timestamp: number;
}

interface LotteryAudit {
  lotteryId: string;
  seedInputs: { lotteryId: string; drawnTimestamp: string; entrantHash: string };
  finalSeed: string;
  entrantHash: string;
  entrantSnapshot: { ticketNumber: number; playerName: string }[];
  winningIndex: number;
  algorithmVersion: string;
}

interface LotteryState {
  id: string;
  active: boolean;
  drawingName: string;
  tickets: LotteryTicket[];
  nextTicketNumber: number;
  winner: string | null;
  createdAt: number;
  drawnAt: number | null;
}

interface ActiveExchange {
  playerName: string;
  playerSerial: number;
  itemsOffered: Array<{ slot: number; itemName: string }>;
  startedAt: number;
}

interface PendingPayout {
  winnerName: string;
  winnerSerial: number;
  itemSlots: number[];
  currentSlotIndex: number;
  phase: 'waiting_accept' | 'placing_items' | 'confirming';
}

type SendPacketFn = (packet: Packet) => void;
type SendWhisperFn = (target: string, message: string) => void;
type SendSayFn = (message: string) => void;

// ── Constants ────────────────────────────────────────────────────

const LOTTERY_ITEM = 'Gold Bar';
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const LOTTERY_FILE = path.join(DATA_DIR, 'lottery.json');
const EXCHANGE_TIMEOUT_MS = 60 * 1000;
const ITEM_PLACE_DELAY_MS = 1500;

// ── Provably Fair Helpers ─────────────────────────────────────

const LOTTERY_SECRET = process.env.LOTTERY_SECRET || 'aisling-lottery-default-secret';
const AE_BACKEND_URL = process.env.AE_BACKEND_URL || '';
const AE_INGEST_KEY = process.env.AE_INGEST_KEY || '';

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function pushToAE(event: string, data: object): Promise<void> {
  if (!AE_BACKEND_URL) return;
  try {
    await fetch(AE_BACKEND_URL + '/api/lottery/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ingest-Key': AE_INGEST_KEY,
      },
      body: JSON.stringify({ event, ...data }),
    });
  } catch (e) {
    console.log('[Lottery] Failed to push to AE: ' + (e as Error).message);
  }
}

// ── State ────────────────────────────────────────────────────────

let lottery: LotteryState = {
  id: '',
  active: false,
  drawingName: '',
  tickets: [],
  nextTicketNumber: 1,
  winner: null,
  createdAt: 0,
  drawnAt: null
};

let activeExchange: ActiveExchange | null = null;
let pendingPayout: PendingPayout | null = null;
let botInventory: Map<number, string> = new Map(); // slot -> itemName

// Dependencies (injected via init)
let sendPacketFn: SendPacketFn | null = null;
let sendWhisperFn: SendWhisperFn | null = null;
let sendSayFn: SendSayFn | null = null;
let ioRef: any = null;
let getBotSerialFn: (() => number) | null = null;
let getEntityNameFn: ((serial: number) => string | undefined) | null = null;

// ── Persistence ──────────────────────────────────────────────────

function saveLottery(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(LOTTERY_FILE, JSON.stringify(lottery, null, 2));
  } catch (e) {
    console.log('[Lottery] Failed to save state: ' + (e as Error).message);
  }
}

function loadLottery(): void {
  try {
    if (fs.existsSync(LOTTERY_FILE)) {
      const data = JSON.parse(fs.readFileSync(LOTTERY_FILE, 'utf8'));
      lottery = { ...lottery, ...data };
      console.log('[Lottery] Loaded state: ' + lottery.tickets.length + ' tickets, active=' + lottery.active);
    }
  } catch (e) {
    console.log('[Lottery] Failed to load state: ' + (e as Error).message);
  }
}

// ── Init ─────────────────────────────────────────────────────────

export function init(deps: {
  sendPacket: SendPacketFn;
  sendWhisper: SendWhisperFn;
  sendSay: SendSayFn;
  io: any;
  getBotSerial: () => number;
  getEntityName?: (serial: number) => string | undefined;
}): void {
  sendPacketFn = deps.sendPacket;
  sendWhisperFn = deps.sendWhisper;
  sendSayFn = deps.sendSay;
  ioRef = deps.io;
  getBotSerialFn = deps.getBotSerial;
  getEntityNameFn = deps.getEntityName || null;
  loadLottery();
  console.log('[Lottery] Initialized');
}

// ── Exchange Protocol Handlers ───────────────────────────────────

/**
 * Handle incoming 0x42 packet (Exchange messages)
 * type=0x00: Exchange request from another player
 * type=0x02: Item placed in their trade window
 * type=0x05: "You exchanged." — completed
 */
export function handleExchangeMessage(packet: Packet): void {
  const saved = packet.position;
  try {
    // Debug: dump raw packet body
    const hexBytes = packet.body.map((b: number) => b.toString(16).padStart(2, '0')).join(' ');
    console.log('[Lottery] 0x42 raw body (' + packet.body.length + ' bytes, pos=' + packet.position + '): ' + hexBytes);

    const type = packet.readByte();

    if (type === 0x00) {
      // Exchange request: [00] [serial:4] [name:string8]
      const otherSerial = packet.readUInt32();
      const name = packet.readString8();

      console.log('[Lottery] Exchange request from "' + name + '" (serial 0x' + otherSerial.toString(16) + ')');

      // Fallback: look up name from entity tracker if packet name is empty
      let playerName = name;
      if (!playerName && getEntityNameFn) {
        playerName = getEntityNameFn(otherSerial) || '';
        console.log('[Lottery] Name empty in packet, entity lookup => "' + playerName + '"');
      }

      if (!lottery.active) {
        console.log('[Lottery] No active lottery, ignoring exchange from ' + playerName);
        packet.position = saved;
        return;
      }

      // Accept the exchange request
      activeExchange = {
        playerName: playerName,
        playerSerial: otherSerial,
        itemsOffered: [],
        startedAt: Date.now()
      };

      // Send accept packet: 0x4A [05] [serial:4]
      if (sendPacketFn) {
        const accept = new Packet(0x4A);
        accept.writeByte(0x05);
        accept.writeUInt32(otherSerial);
        sendPacketFn(accept);
        console.log('[Lottery] Sent accept (0x4A [05 ' + otherSerial.toString(16) + ']) for ' + playerName);
      }

      // Set timeout to auto-clear stale exchanges
      setTimeout(() => {
        if (activeExchange && activeExchange.playerSerial === otherSerial) {
          console.log('[Lottery] Exchange with ' + playerName + ' timed out');
          activeExchange = null;
        }
      }, EXCHANGE_TIMEOUT_MS);

    } else if (type === 0x02) {
      // Item placed: [02] [slot:1] [sprite:2] [color:1] [name:string16]
      const slot = packet.readByte();
      const itemSprite = packet.readUInt16();
      const itemColor = packet.readByte();
      const itemName = packet.readString16();

      console.log('[Lottery] Item offered in slot ' + slot + ': "' + itemName + '"');

      if (activeExchange) {
        activeExchange.itemsOffered.push({ slot, itemName });

        // Check if it's a gold bar
        if (itemName.toLowerCase().includes('gold bar')) {
          console.log('[Lottery] Gold bar detected from ' + activeExchange.playerName);

          // Bot only needs to accept (already done on type 0x00).
          // The trading player confirms on their end to complete the exchange.
        } else {
          console.log('[Lottery] Non-gold-bar item: ' + itemName + ' from ' + activeExchange.playerName);
          if (sendWhisperFn) {
            sendWhisperFn(activeExchange.playerName, 'Only Gold Bars are accepted for the lottery!');
          }
        }
      }

    } else if (type === 0x04) {
      // type 0x04 = cancel or status message
      packet.readByte(); // unknown byte
      const message = packet.readString8();
      console.log('[Lottery] Exchange type 0x04: "' + message + '"');

      if (message.toLowerCase().includes('cancel')) {
        activeExchange = null;
      }

    } else if (type === 0x05) {
      // "You exchanged." — two of these come: subtype 0x00 first, then 0x01 when truly complete
      const subtype = packet.readByte();
      const message = packet.readString8();
      console.log('[Lottery] Exchange 0x05 subtype=' + subtype + ': "' + message + '"');

      // Only generate tickets on subtype 0x01 (final confirmation)
      if (subtype === 0x01 && activeExchange) {
        const playerName = activeExchange.playerName;
        const goldBars = activeExchange.itemsOffered.filter(
          item => item.itemName.toLowerCase().includes('gold bar')
        );

        if (goldBars.length > 0) {
          const ticketNumbers: number[] = [];
          for (const bar of goldBars) {
            const ticket: LotteryTicket = {
              ticketNumber: lottery.nextTicketNumber,
              playerName: playerName,
              itemName: bar.itemName,
              inventorySlot: -1,
              timestamp: Date.now()
            };
            lottery.tickets.push(ticket);
            ticketNumbers.push(lottery.nextTicketNumber);
            lottery.nextTicketNumber++;
          }

          saveLottery();

          const ticketStr = ticketNumbers.length === 1
            ? 'Ticket #' + ticketNumbers[0]
            : 'Tickets #' + ticketNumbers.join(', #');

          if (sendWhisperFn) {
            sendWhisperFn(playerName,
              'Thank you! You received ' + ticketStr + ' for the ' + lottery.drawingName + ' lottery!'
            );
          }

          if (sendSayFn) {
            sendSayFn(playerName + ' entered the lottery with ' + goldBars.length + ' ticket(s)! (' + lottery.tickets.length + ' total)');
          }

          console.log('[Lottery] ' + playerName + ' got ' + ticketStr);
          emitLotteryUpdate();

          pushToAE('lottery:ticket', {
            lotteryId: lottery.id,
            tickets: goldBars.map((_, i) => ({
              ticketNumber: ticketNumbers[i],
              playerName,
              itemName: goldBars[i].itemName,
              timestamp: Date.now()
            }))
          });
        }

        activeExchange = null;
      }

      // Handle payout completion
      if (pendingPayout) {
        console.log('[Lottery] Payout exchange completed to ' + pendingPayout.winnerName);
        if (sendSayFn) {
          sendSayFn('All prizes have been delivered to ' + pendingPayout.winnerName + '!');
        }
        pendingPayout = null;
      }

    } else {
      console.log('[Lottery] Unhandled 0x42 type: 0x' + ('0' + type.toString(16)).slice(-2));
    }
  } catch (e) {
    console.log('[Lottery] Error handling 0x42: ' + (e as Error).message);
  }
  packet.position = saved;
}

/**
 * Handle incoming 0x4B packet (Exchange slot update)
 * Confirms an item was placed in the exchange window
 */
export function handleExchangeSlot(packet: Packet): void {
  const saved = packet.position;
  try {
    const type = packet.readByte();
    const slotInfo = packet.readByte();
    const unknown = packet.readByte();
    const slot = packet.readByte();
    // Additional bytes may contain serial and item info

    console.log('[Lottery] Exchange slot update: type=' + type + ' slot=' + slot);

    // If we're in payout mode, after the other player sees our item placed,
    // we continue placing the next one
    if (pendingPayout && pendingPayout.phase === 'placing_items') {
      pendingPayout.currentSlotIndex++;
      if (pendingPayout.currentSlotIndex < pendingPayout.itemSlots.length) {
        setTimeout(() => placeNextPayoutItem(), ITEM_PLACE_DELAY_MS);
      } else {
        // All items placed, send final confirmation
        pendingPayout.phase = 'confirming';
        setTimeout(() => confirmPayout(), ITEM_PLACE_DELAY_MS);
      }
    }
  } catch (e) {
    console.log('[Lottery] Error handling 0x4B: ' + (e as Error).message);
  }
  packet.position = saved;
}

/**
 * Handle incoming 0x37 packet (AddItem) — tracks items added to our inventory
 */
export function handleAddItem(packet: Packet): void {
  const saved = packet.position;
  try {
    const slot = packet.readByte();
    const sprite = packet.readUInt16();
    const color = packet.readByte();
    const name = packet.readString8();

    botInventory.set(slot, name);
    console.log('[Lottery] Inventory add: slot ' + slot + ' = ' + name);
  } catch (e) {
    console.log('[Lottery] Error handling 0x37: ' + (e as Error).message);
  }
  packet.position = saved;
}

/**
 * Handle incoming 0x38 packet (RemoveItem) — tracks items removed from inventory
 */
export function handleRemoveItem(packet: Packet): void {
  const saved = packet.position;
  try {
    const slot = packet.readByte();
    botInventory.delete(slot);
    console.log('[Lottery] Inventory remove: slot ' + slot);
  } catch (e) {
    console.log('[Lottery] Error handling 0x38: ' + (e as Error).message);
  }
  packet.position = saved;
}

/**
 * Handle whisper commands to the lottery bot
 */
export function handleWhisper(senderName: string, message: string): boolean {
  const trimmed = message.trim().toLowerCase();

  if (trimmed === 'tickets' || trimmed === 'my tickets') {
    const playerTickets = lottery.tickets.filter(
      t => t.playerName.toLowerCase() === senderName.toLowerCase()
    );
    if (playerTickets.length === 0) {
      if (sendWhisperFn) sendWhisperFn(senderName, 'You have no tickets in the current lottery.');
    } else {
      const nums = playerTickets.map(t => '#' + t.ticketNumber).join(', ');
      if (sendWhisperFn) sendWhisperFn(senderName, 'Your tickets: ' + nums + ' (' + playerTickets.length + ' total)');
    }
    return true;
  }

  if (trimmed === 'lottery' || trimmed === 'lottery info') {
    if (!lottery.active) {
      if (sendWhisperFn) sendWhisperFn(senderName, 'No lottery is currently active.');
    } else {
      const uniquePlayers = new Set(lottery.tickets.map(t => t.playerName.toLowerCase())).size;
      if (sendWhisperFn) {
        sendWhisperFn(senderName,
          lottery.drawingName + ' | ' + lottery.tickets.length + ' tickets from ' + uniquePlayers + ' players. Trade me a Gold Bar to enter!'
        );
      }
    }
    return true;
  }

  return false;
}

// ── Payout: Give items to winner ─────────────────────────────────

function placeNextPayoutItem(): void {
  if (!pendingPayout || !sendPacketFn) return;

  const slotIndex = pendingPayout.currentSlotIndex;
  if (slotIndex >= pendingPayout.itemSlots.length) return;

  const inventorySlot = pendingPayout.itemSlots[slotIndex];

  // 0x4A OUT type=0x01 — place item from our inventory into trade
  const placeItem = new Packet(0x4A);
  placeItem.writeByte(0x01);  // place item type
  placeItem.writeByte(0x00);
  placeItem.writeUInt32(pendingPayout.winnerSerial);
  placeItem.writeByte(inventorySlot);
  sendPacketFn(placeItem);

  console.log('[Lottery] Placed item from slot ' + inventorySlot + ' into trade (' + (slotIndex + 1) + '/' + pendingPayout.itemSlots.length + ')');
}

function confirmPayout(): void {
  if (!pendingPayout || !sendPacketFn) return;

  // 0x4A OUT type=0x00 — accept/agree
  const agree = new Packet(0x4A);
  agree.writeByte(0x00);
  agree.writeByte(0x00);
  agree.writeUInt32(pendingPayout.winnerSerial);
  sendPacketFn(agree);

  console.log('[Lottery] Sent trade confirmation for payout to ' + pendingPayout.winnerName);
}

/**
 * Initiate exchange with the winner to deliver prizes.
 * The winner must be nearby (on same map, within exchange range).
 */
export function deliverPrize(winnerSerial: number): void {
  if (!sendPacketFn || !lottery.winner) return;

  const itemSlots = lottery.tickets
    .filter(t => t.inventorySlot > 0)
    .map(t => t.inventorySlot);

  if (itemSlots.length === 0) {
    console.log('[Lottery] No items in inventory to deliver');
    return;
  }

  pendingPayout = {
    winnerName: lottery.winner,
    winnerSerial: winnerSerial,
    itemSlots: itemSlots,
    currentSlotIndex: 0,
    phase: 'waiting_accept'
  };

  // 0x29 OUT — Initiate exchange with target
  const initExchange = new Packet(0x29);
  initExchange.writeByte(0x01);  // exchange type
  initExchange.writeUInt32(winnerSerial);
  initExchange.writeUInt32(0x00000000); // no gold
  sendPacketFn(initExchange);

  console.log('[Lottery] Initiated exchange with winner ' + lottery.winner + ' (serial 0x' + winnerSerial.toString(16) + ') to deliver ' + itemSlots.length + ' items');
}

/**
 * When the winner accepts our exchange request, start placing items
 */
export function onPayoutAccepted(): void {
  if (!pendingPayout) return;
  pendingPayout.phase = 'placing_items';
  pendingPayout.currentSlotIndex = 0;
  placeNextPayoutItem();
}

// ── Lottery Management ───────────────────────────────────────────

export function startLottery(drawingName: string): { success: boolean; message: string } {
  if (lottery.active) {
    return { success: false, message: 'A lottery is already active: ' + lottery.drawingName };
  }

  lottery = {
    id: crypto.randomUUID(),
    active: true,
    drawingName: drawingName || 'Lottery',
    tickets: [],
    nextTicketNumber: 1,
    winner: null,
    createdAt: Date.now(),
    drawnAt: null
  };

  saveLottery();
  emitLotteryUpdate();

  if (sendSayFn) {
    sendSayFn('The ' + lottery.drawingName + ' lottery is now open! Trade me a Gold Bar to enter!');
  }

  pushToAE('lottery:started', {
    id: lottery.id,
    drawingName: lottery.drawingName,
    createdAt: lottery.createdAt
  });

  console.log('[Lottery] Started: ' + lottery.drawingName + ' (id: ' + lottery.id + ')');
  return { success: true, message: 'Lottery started: ' + lottery.drawingName };
}

export function drawWinner(): { success: boolean; message: string; winner?: string; audit?: LotteryAudit } {
  if (!lottery.active) {
    return { success: false, message: 'No active lottery.' };
  }

  if (lottery.tickets.length === 0) {
    return { success: false, message: 'No tickets have been purchased.' };
  }

  // ── Provably fair drawing (SHA-256 + Mulberry32 + Fisher-Yates) ──

  // 1. Sort tickets deterministically by ticket number
  const sortedTickets = [...lottery.tickets].sort((a, b) => a.ticketNumber - b.ticketNumber);

  // 2. Create entrant hash from sorted ticket data
  const entrantString = sortedTickets.map(t => t.ticketNumber + ':' + t.playerName).join(',');
  const entrantHash = sha256(entrantString);

  // 3. Build seed from lottery ID, timestamp, entrant hash, and server secret
  const drawnTimestamp = new Date().toISOString();
  const seedInput = lottery.id + ':' + drawnTimestamp + ':' + entrantHash + ':' + LOTTERY_SECRET;
  const finalSeed = sha256(seedInput);
  const numericSeed = parseInt(finalSeed.substring(0, 8), 16);

  // 4. Fisher-Yates shuffle using Mulberry32 PRNG
  const shuffled = [...sortedTickets];
  const rng = mulberry32(numericSeed);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // 5. Winner is first ticket after shuffle
  const winningTicket = shuffled[0];
  const winnerName = winningTicket.playerName;

  lottery.winner = winnerName;
  lottery.active = false;
  lottery.drawnAt = Date.now();

  saveLottery();
  emitLotteryUpdate();

  if (sendSayFn) {
    sendSayFn('The ' + lottery.drawingName + ' winner is ' + winnerName + '! (Ticket #' + winningTicket.ticketNumber + ' out of ' + lottery.tickets.length + ')');
  }

  if (sendWhisperFn) {
    sendWhisperFn(winnerName,
      'Congratulations! You won the ' + lottery.drawingName + ' lottery with Ticket #' + winningTicket.ticketNumber + '! You win ' + lottery.tickets.length + ' Gold Bar(s)!'
    );
  }

  const audit: LotteryAudit = {
    lotteryId: lottery.id,
    seedInputs: { lotteryId: lottery.id, drawnTimestamp, entrantHash },
    finalSeed,
    entrantHash,
    entrantSnapshot: sortedTickets.map(t => ({ ticketNumber: t.ticketNumber, playerName: t.playerName })),
    winningIndex: 0,
    algorithmVersion: 'fisher-yates-sha256-v1',
  };

  pushToAE('lottery:drawn', {
    lotteryId: lottery.id,
    winnerName,
    winningTicketNumber: winningTicket.ticketNumber,
    totalTickets: lottery.tickets.length,
    uniquePlayers: new Set(lottery.tickets.map(t => t.playerName.toLowerCase())).size,
    drawnAt: drawnTimestamp,
    audit
  });

  console.log('[Lottery] Winner drawn: ' + winnerName + ' (ticket #' + winningTicket.ticketNumber + ') — provably fair seed: ' + finalSeed.substring(0, 16) + '...');

  return {
    success: true,
    message: 'Winner: ' + winnerName + ' (Ticket #' + winningTicket.ticketNumber + ')',
    winner: winnerName,
    audit
  };
}

export function cancelLottery(): { success: boolean; message: string } {
  if (!lottery.active) {
    return { success: false, message: 'No active lottery to cancel.' };
  }

  const name = lottery.drawingName;
  const ticketCount = lottery.tickets.length;

  lottery.active = false;
  lottery.drawnAt = Date.now();
  saveLottery();
  emitLotteryUpdate();

  if (sendSayFn) {
    sendSayFn('The ' + name + ' lottery has been cancelled.');
  }

  pushToAE('lottery:cancelled', { lotteryId: lottery.id });

  console.log('[Lottery] Cancelled: ' + name + ' (' + ticketCount + ' tickets)');
  return { success: true, message: 'Lottery cancelled. ' + ticketCount + ' tickets were voided.' };
}

export function resetLottery(): { success: boolean; message: string } {
  lottery.id = '';
  lottery.active = false;
  lottery.drawingName = '';
  lottery.tickets = [];
  lottery.nextTicketNumber = 1;
  lottery.winner = null;
  lottery.createdAt = 0;
  lottery.drawnAt = null;
  activeExchange = null;

  saveLottery();
  emitLotteryUpdate();

  console.log('[Lottery] Reset — all data cleared');
  return { success: true, message: 'Lottery has been reset.' };
}

export function getLotteryState(): {
  id: string;
  active: boolean;
  drawingName: string;
  ticketCount: number;
  uniquePlayers: number;
  tickets: LotteryTicket[];
  winner: string | null;
  createdAt: number;
  drawnAt: number | null;
} {
  return {
    id: lottery.id,
    active: lottery.active,
    drawingName: lottery.drawingName,
    ticketCount: lottery.tickets.length,
    uniquePlayers: new Set(lottery.tickets.map(t => t.playerName.toLowerCase())).size,
    tickets: lottery.tickets,
    winner: lottery.winner,
    createdAt: lottery.createdAt,
    drawnAt: lottery.drawnAt
  };
}

export function getPlayerTickets(playerName: string): LotteryTicket[] {
  return lottery.tickets.filter(
    t => t.playerName.toLowerCase() === playerName.toLowerCase()
  );
}

// ── Socket.IO Updates ────────────────────────────────────────────

function emitLotteryUpdate(): void {
  if (ioRef) {
    ioRef.emit('lottery:update', getLotteryState());
  }
}

// ── Exchange acceptance for payout ───────────────────────────────
// When the lottery bot INITIATES a trade (payout) and the winner
// accepts, this handles the 0x42 type=0x00 that comes back

export function handleExchangeAccepted(serial: number): void {
  if (pendingPayout && pendingPayout.winnerSerial === serial) {
    console.log('[Lottery] Winner accepted payout exchange');
    onPayoutAccepted();
  }
}

export function isLotteryBot(): boolean {
  return true; // This module only gets loaded for lottery bots
}

export function hasActiveExchange(): boolean {
  return activeExchange !== null;
}

export function hasPendingPayout(): boolean {
  return pendingPayout !== null;
}
