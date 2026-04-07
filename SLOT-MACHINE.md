# Slot Machine Bot

## Overview

The slot machine is a fully automated gambling bot for Dark Ages. A designated bot character ("Baron") stands near an NPC banker and accepts gold deposits from players via the in-game exchange system. Players can then spin the slot machine by whispering commands. The bot physically equips different balloon items to simulate a spinning reel, and pays out winnings via gold exchange.

## How It Works

### The Game Loop

1. **Deposit** — A player trades gold coins to the bot via the in-game exchange window. Their balance is credited automatically.
2. **Spin** — The player whispers `spin`. The bot picks a random symbol based on weighted odds, then rapidly equips balloons in sequence (the visual "spin" animation). The final balloon shown is the result.
3. **Payout** — Winnings are added to the player's balance. Losses are deducted.
4. **Cashout** — The player whispers `cashout`. The bot initiates a reverse exchange to return their balance as gold coins.

### The Reel Animation

The bot holds 4 balloon items in inventory: Red Polyp Puppet, Yellow Polyp Puppet, Green Polyp Puppet, and Polyp Bunch. During a spin, it sends 0x1C (equip) packets to rapidly swap through balloons. Each swap is 600ms apart, with an 800ms pause on the final result. To other players on the map, it looks like the bot is cycling through items — a physical slot machine.

---

## Symbols & Odds

| Symbol | Weight | Probability | Multiplier | Outcome |
|---|---|---|---|---|
| Red Polyp Puppet | 48 | 48% | 0x | Lose (bet lost) |
| Yellow Polyp Puppet | 30 | 30% | 1x | Push (bet returned) |
| Green Polyp Puppet | 16 | 16% | 2x | Win (double bet) |
| Polyp Bunch | 6 | 6% | 5x | Jackpot (5x bet) |

**Return to Player (RTP):** 92% — calculated as (0.30 + 0.32 + 0.30) = 0.92
**House Edge:** 8%

### Jackpot Cooldown

To prevent streak abuse, the bot tracks recent jackpots per player. If a player hits 3+ jackpots within 10 minutes, the lose weight is boosted by +10 (48 → 58 out of 110 total = ~53% lose rate) until the window expires.

---

## Player Commands (Whisper)

| Command | Description |
|---|---|
| `help` or `slots` | Show available commands |
| `spin` | Spin the slot machine (or join queue if someone is spinning) |
| `balance` or `bal` | Show your balance, bet, total spins, and win/loss record |
| `bet <amount>` | Set your bet per spin (must be ≤ your balance) |
| `cashout` | Initiate withdrawal of your full balance |
| `leave` or `quit` | Leave the queue and save your balance |

---

## Exchange Protocol

The bot uses Dark Ages' built-in exchange (trade) system for all gold transfers.

### Player Deposit Flow
1. Player initiates trade with the bot
2. Bot receives 0x42 type 0x00 (exchange request) and sends 0x4A type 0x05 (accept)
3. Player places gold → bot receives 0x42 type 0x03 (gold offered)
4. Exchange completes via 0x42 type 0x05 → player balance credited

### Player Cashout Flow
1. Player whispers `cashout`
2. Bot whispers back the amount and a 1-coin fee notice
3. Player initiates trade and places 1 gold coin
4. Bot places the cashout amount (0x4A type 0x03) and confirms (0x4A type 0x00, 0x4A type 0x05)
5. Player balance zeroed, gold transferred

### Timeouts
- Exchange timeout: 60 seconds — if a trade isn't completed, it's cancelled
- Idle queue timeout: 5 minutes — players removed from queue if inactive

---

## Queue System

Only one player can spin at a time. Additional players are queued:

- When a player whispers `spin` while another is spinning, they join the queue
- Queue position is whispered back: "You're #2 in the queue"
- After each spin completes, the next player in queue is auto-processed
- Players idle for 5+ minutes are removed with their balance saved
- Admins can force-clear the queue via the web panel

---

## Banking System

The bot automatically manages its gold reserves by depositing excess gold to and withdrawing from an NPC banker (Celesta).

### How It Works

A background check runs every 30 seconds:
- **If gold on hand > 90M** → deposit down to 50M target
- **If gold on hand < 5M** → withdraw up to 30M target (if bank has funds)
- Bank cap: 100M, hand cap: 99M

### NPC Dialog Protocol

Banking requires a multi-step NPC interaction:

1. **Approach** — Send 0x43 type 0x03 with the NPC's tile position (x, y)
2. **Click** — Send 0x43 type 0x01 with the NPC's serial
3. **Menu** — Receive 0x2F type 0x00, parse menu options dynamically, send 0x39 with the selected option ID
4. **Amount** — Receive 0x2F type 0x02, send 0x39 with the amount as a string
5. **Confirm** — Listen for 0x0D public message from the banker confirming the transaction

### Dialog Encryption

Dialog response packets (0x39) require a special encryption layer on top of standard encryption. The packet includes a 6-byte dialog header with a random seed, CRC-16 checksum, and XOR-obfuscated length — all encrypted before the standard XOR + MD5 hash pass. This matches the real game client's behavior exactly.

### Configuration

| Field | Default | Description |
|---|---|---|
| `enabled` | false | Enable auto-banking |
| `bankerName` | Celesta | NPC name |
| `bankerSerial` | 0 | NPC serial (auto-detected from entity tracking) |
| `bankerX` | 48 | NPC tile X position (static fallback) |
| `bankerY` | 17 | NPC tile Y position (static fallback) |
| `highWatermark` | 90,000,000 | Deposit trigger threshold |
| `lowWatermark` | 5,000,000 | Withdraw trigger threshold |
| `depositTarget` | 50,000,000 | Target gold after deposit |
| `withdrawTarget` | 30,000,000 | Target gold after withdraw |
| `timeoutMs` | 15,000 | Timeout per banking attempt |
| `maxRetries` | 2 | Max retry count per transaction |

---

## Bankroll Protection

The bot protects itself from going broke:

- **Auto-pause:** If gold on hand drops below 2,000,000, the slot machine closes with "temporarily closed for maintenance"
- **Dynamic max bet:** Maximum bet = floor(goldOnHand / 20) — players can never bet more than 5% of reserves
- **Reserve guard:** If reserves can't cover 5x the bet (worst-case jackpot), the bet is rejected

---

## Inventory Tracking

The bot tracks its full inventory via incoming packets:
- **0x0F (InventoryItem)** — Received on login for each item
- **0x37 (AddItem)** — Item added to inventory
- **0x38 (RemoveItem)** — Item removed from inventory

Balloon items are tracked separately and never removed from local state on 0x38 (they're swapped via equip, not dropped). On login, if exactly one balloon is missing from inventory, the bot infers it's currently equipped.

---

## Gold Tracking

Gold on hand is read from the 0x08 (Stats) packet, type 0x0C (full stats), at byte offset 21 (u32 big-endian). This updates on every stats refresh from the server.

Bank balance is parsed from the NPC dialog text using regex: `/(\d[\d,]*)\s*coins/` — e.g., "You have 53000000 coins."

---

## Persistence

All state is saved to `data/slots.json`:
- Slot config (enabled, spin cost)
- Player states (balances, stats, history)
- Spin history (last 100 spins)
- Bank balance and gold on hand
- Banking config

State is saved after every significant event (spin, deposit, cashout, banking transaction, config change).

---

## Web Panel Integration

The slot machine exposes real-time state via Socket.IO (`slots:update` event) and REST API endpoints:

| Endpoint | Method | Description |
|---|---|---|
| `/api/slots` | GET | Full slot machine state |
| `/api/slots/player/:name` | GET | Individual player state |
| `/api/slots/config` | POST | Update slot config |
| `/api/slots/banking` | GET/POST | Get or update banking config |
| `/api/slots/spin` | POST | Trigger spin from web UI |
| `/api/slots/end-session` | POST | Force end current session |
| `/api/slots/clear-queue` | POST | Clear the queue |

The panel displays: current spinner, queue, spin history log, player balance table, financial summary (total bets, payouts, house profit, edge %), and banking status.

---

## Suppression During Banking

When banking is active, the `slotBankingActive` flag is set to prevent legend profile requests (0x43 type 0x01) from being sent for the slot bot. This avoids interfering with the NPC dialog state. Player trades also abort any active banking attempt — player interactions always take priority.

---

## Entity Position Tracking

The bot tracks NPC positions from 0x33 (ShowUser) packets, storing `{x, y}` keyed by serial. This is used to send the approach packet (0x43 type 0x03) before clicking the banker NPC. If the dynamic position isn't available (entity data cleared on map reload), static config values (`bankerX`, `bankerY`) are used as fallback.

---

## Files

| File | Description |
|---|---|
| `src/features/slot-machine.ts` | Main slot machine module (~1900 lines) |
| `src/core/crypto.ts` | Packet encryption with dialog encryption support |
| `src/core/crc.ts` | CRC-16 for dialog checksums |
| `panel.js` | Server-side wiring, entity tracking, packet handlers |
| `panel/panel.js` | Client-side web UI |
| `data/slots.json` | Persistent state (created at runtime) |
