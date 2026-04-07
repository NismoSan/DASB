# DASB Project Notes

## Critical: Module Structure

- The **active** Client class is in `lib/core/client.js` (exported via `index.js`).
- `lib/client.js` is a **legacy/unused** copy. Do NOT edit it expecting changes to take effect.
- `panel.js` imports Client from `./` which resolves to `index.js` → `lib/core/client.js`.
- Similarly: `lib/core/packet.js` is the active Packet, `lib/core/crypto.js` is the active Crypto.
- Always verify which file is actually `require()`'d before editing. Check `index.js` exports.

## Running Services

- The main process is `da-server-bot` in pm2 (NOT "baron" or individual bot names).
- Restarting `da-server-bot` disconnects ALL proxy sessions and bots. Warn the user before restarting.
- pm2 error logs accumulate across restarts — old errors may appear in `pm2 logs --err` after a fresh restart.

## Dialog Packets (0x39, 0x3A)

- These opcodes require **dialog sub-encryption** on top of standard client encryption.
- Use `client.sendDialog(packet)` for 0x39/0x3A, NOT `client.send(packet)`.
- `client.send()` only applies standard encryption and will produce packets the server silently ignores.
- The dialog sub-encryption format: `[xPrime_enc, x_enc, lenHi_enc, lenLo_enc, ...encrypted_crc_and_payload]`
