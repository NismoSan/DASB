// ── Egg Banker Bot Module ───────────────────────────────────────
// Auto-accepts exchanges from the EggBasketI collector bot and
// absorbs overflow egg items. Ignores all other exchange requests.
//
// Exchange protocol (Dark Ages):
//   0x42 IN  (type 0x00) — Incoming exchange request
//   0x42 IN  (type 0x02) — Item placed in their trade window
//   0x42 IN  (type 0x04) — Exchange cancelled / status
//   0x42 IN  (type 0x05) — Exchange completed
//   0x4B IN             — Exchange slot confirmation
//   0x4A OUT (type 0x05) — Accept exchange request
//   0x4A OUT (type 0x00) — Confirm / agree to trade
//   0x37 IN  (AddItem)   — Item added to our inventory
//   0x38 IN  (RemoveItem)— Item removed from inventory

import Packet from '../core/packet';

// ── Types ────────────────────────────────────────────────────────

type SendPacketFn = (packet: Packet) => void;
type SendWhisperFn = (target: string, message: string) => void;

// ── Constants ────────────────────────────────────────────────────

const COLLECTOR_BOT_NAME = 'EggBasketI';
const EXCHANGE_TIMEOUT_MS = 60 * 1000;
const CONFIRM_DELAY_MS = 2000;

// ── State ────────────────────────────────────────────────────────

let activeExchange: { collectorSerial: number; startedAt: number } | null = null;
let botInventory: Map<number, string> = new Map();

// Dependencies (injected via init)
let sendPacketFn: SendPacketFn | null = null;
let sendWhisperFn: SendWhisperFn | null = null;
let ioRef: any = null;
let getBotSerialFn: (() => number) | null = null;
let getEntityNameFn: ((serial: number) => string | undefined) | null = null;

// ── Init ─────────────────────────────────────────────────────────

export function init(deps: {
  sendPacket: SendPacketFn;
  sendWhisper: SendWhisperFn;
  io: any;
  getBotSerial: () => number;
  getEntityName?: (serial: number) => string | undefined;
}): void {
  sendPacketFn = deps.sendPacket;
  sendWhisperFn = deps.sendWhisper;
  ioRef = deps.io;
  getBotSerialFn = deps.getBotSerial;
  getEntityNameFn = deps.getEntityName || null;
  console.log('[EggBanker] Initialized');
}

// ── Exchange Protocol Handlers ───────────────────────────────────

export function handleExchangeMessage(packet: Packet): void {
  const saved = packet.position;
  try {
    const hexBytes = packet.body.map((b: number) => b.toString(16).padStart(2, '0')).join(' ');
    console.log('[EggBanker] 0x42 raw body (' + packet.body.length + ' bytes): ' + hexBytes);

    const type = packet.readByte();

    if (type === 0x00) {
      // Exchange request: [00] [serial:4] [name:string8]
      const otherSerial = packet.readUInt32();
      const name = packet.readString8();

      let requesterName = name;
      if (!requesterName && getEntityNameFn) {
        requesterName = getEntityNameFn(otherSerial) || '';
      }

      console.log('[EggBanker] Exchange request from "' + requesterName + '" (serial 0x' + otherSerial.toString(16) + ')');

      // Only accept exchanges from the collector bot
      if (requesterName.toLowerCase() !== COLLECTOR_BOT_NAME.toLowerCase()) {
        console.log('[EggBanker] Rejecting exchange from non-collector: ' + requesterName);
        packet.position = saved;
        return;
      }

      // Already in an exchange
      if (activeExchange) {
        console.log('[EggBanker] Already in an exchange, ignoring');
        packet.position = saved;
        return;
      }

      activeExchange = {
        collectorSerial: otherSerial,
        startedAt: Date.now()
      };

      // Accept: 0x4A [05] [serial:4]
      if (sendPacketFn) {
        const accept = new Packet(0x4A);
        accept.writeByte(0x05);
        accept.writeUInt32(otherSerial);
        sendPacketFn(accept);
        console.log('[EggBanker] Accepted exchange from collector');
      }

      // Timeout safety
      setTimeout(() => {
        if (activeExchange && activeExchange.collectorSerial === otherSerial) {
          console.log('[EggBanker] Exchange timed out');
          activeExchange = null;
        }
      }, EXCHANGE_TIMEOUT_MS);

    } else if (type === 0x02) {
      // Item placed by collector
      const slot = packet.readByte();
      const itemSprite = packet.readUInt16();
      const itemColor = packet.readByte();
      const itemName = packet.readString16();
      console.log('[EggBanker] Item placed in slot ' + slot + ': "' + itemName + '"');

    } else if (type === 0x04) {
      // Cancel / status
      packet.readByte();
      const message = packet.readString8();
      console.log('[EggBanker] Exchange status: "' + message + '"');

      if (message.toLowerCase().includes('cancel')) {
        activeExchange = null;
      }

    } else if (type === 0x05) {
      // Exchange completed
      const subtype = packet.readByte();
      const message = packet.readString8();
      console.log('[EggBanker] Exchange complete subtype=' + subtype + ': "' + message + '"');

      if (subtype === 0x00 && activeExchange) {
        // Collector has confirmed — we confirm too
        setTimeout(() => {
          if (activeExchange && sendPacketFn) {
            const agree = new Packet(0x4A);
            agree.writeByte(0x00);
            agree.writeByte(0x00);
            agree.writeUInt32(activeExchange.collectorSerial);
            sendPacketFn(agree);
            console.log('[EggBanker] Sent confirmation to complete banking');
          }
        }, CONFIRM_DELAY_MS);
      }

      if (subtype === 0x01) {
        // Final completion
        console.log('[EggBanker] Banking exchange completed. Inventory: ' + botInventory.size + ' items');
        activeExchange = null;
      }

    } else {
      console.log('[EggBanker] Unhandled 0x42 type: 0x' + ('0' + type.toString(16)).slice(-2));
    }
  } catch (e) {
    console.log('[EggBanker] Error handling 0x42: ' + (e as Error).message);
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
    console.log('[EggBanker] Exchange slot update: type=' + type + ' slot=' + slot);
  } catch (e) {
    console.log('[EggBanker] Error handling 0x4B: ' + (e as Error).message);
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
    console.log('[EggBanker] Inventory add: slot ' + slot + ' = "' + name + '" (total: ' + botInventory.size + ')');
  } catch (e) {
    console.log('[EggBanker] Error handling 0x37: ' + (e as Error).message);
  }
  packet.position = saved;
}

export function handleRemoveItem(packet: Packet): void {
  const saved = packet.position;
  try {
    const slot = packet.readByte();
    const removed = botInventory.get(slot) || '?';
    botInventory.delete(slot);
    console.log('[EggBanker] Inventory remove: slot ' + slot + ' ("' + removed + '") (total: ' + botInventory.size + ')');
  } catch (e) {
    console.log('[EggBanker] Error handling 0x38: ' + (e as Error).message);
  }
  packet.position = saved;
}

// ── Public Getters ──────────────────────────────────────────────

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
