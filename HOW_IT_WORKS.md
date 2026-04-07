# da.js (darkages) — How It All Works

A Dark Ages MMORPG client library for Node.js. This library lets you build automated bot clients and tools that connect to the Dark Ages game servers using the game's proprietary binary protocol.

- **npm package:** `darkages` (v1.0.4)
- **Author:** Eric Valadas
- **License:** ISC

---

## Project Structure

```
da.js-master/
├── index.js              # Entry point — exports Client and Packet
├── package.json          # npm manifest
├── .babelrc              # Babel config (ES6 → CommonJS)
├── .eslintrc             # Linter config
└── src/
    ├── client.js         # Main Client class (connection, send/receive, events)
    ├── packet.js          # Packet class (read/write binary data)
    ├── crypto.js          # XOR encryption/decryption engine
    ├── packet-handlers.js # Built-in protocol handlers (handshake, login, pings)
    ├── server.js          # Server address registry
    ├── crc.js             # CRC16 checksum tables and calculation
    ├── datatypes.js       # Fixed-width integer helpers (uint8, int16, etc.)
    └── util.js            # random() and toHex() helpers
```

The `src/` files are ES6 modules. Running `npm run build` transpiles them to `lib/` (CommonJS) via Babel. The published npm package only includes `lib/`.

---

## Public API

Only two classes are exported:

```js
const { Client, Packet } = require('darkages');
```

---

## Client

### Creating and Connecting

```js
const client = new Client('username', 'password');
client.connect(); // connects to the Login Server by default
```

### Key Properties

| Property | Default | Description |
|----------|---------|-------------|
| `appVersion` | `741` | DA client version sent during handshake |
| `username` | — | Login username |
| `password` | — | Login password |
| `crypto` | `new Crypto()` | Encryption engine instance |
| `logOutgoing` | `false` | Log all outgoing packets as hex |
| `logIncoming` | `false` | Log all incoming packets as hex |
| `events` | `EventEmitter` | Event bus for packet handlers |

### Key Methods

| Method | Description |
|--------|-------------|
| `connect(address?, port?)` | Opens a TCP connection (defaults to Login Server). Returns a Promise. |
| `disconnect(socket?)` | Destroys the TCP socket. |
| `reconnect(address?, port?)` | Tears down and re-establishes connection, resets encryption state. |
| `send(packet)` | Encrypts and writes a Packet to the socket. |
| `receive(data)` | Internal — buffers TCP data, parses frames, decrypts, and emits events. |
| `logIn()` | Sends credentials to the server (called automatically during the login flow). |
| `confirmIdentity(id)` | Sends identity confirmation after a server redirect (called automatically). |
| `tickCount()` | Returns milliseconds elapsed since client creation. |

### Event System

The client uses a standard Node.js `EventEmitter`. Packet opcodes (numbers) are used as event names. You can listen for any opcode:

```js
client.events.on(0x0A, (packet, client) => {
  // handle incoming opcode 0x0A
});
```

The library registers its own internal handlers for protocol-level opcodes (handshake, login, pings). Your handlers run alongside them.

---

## Packet

Represents a single game protocol packet. Used for both building outgoing packets and reading incoming ones.

### Creating Packets

```js
// Outgoing — specify the opcode
const packet = new Packet(0x19);
packet.writeString8('PlayerName');
packet.writeString8('Hello!');
client.send(packet);

// Incoming — parsed from raw bytes (handled internally by client.receive)
```

### Write Methods (building outgoing packets)

| Method | Description |
|--------|-------------|
| `writeByte(value)` | 1 byte (uint8) |
| `writeInt16(value)` | 2 bytes, signed, big-endian |
| `writeUInt16(value)` | 2 bytes, unsigned, big-endian |
| `writeInt32(value)` | 4 bytes, signed, big-endian |
| `writeUInt32(value)` | 4 bytes, unsigned, big-endian |
| `writeString(value)` | Raw string bytes (no length prefix) |
| `writeString8(value)` | 1-byte length prefix + string |
| `writeString16(value)` | 2-byte length prefix + string |
| `write(buffer)` | Raw byte array |

### Read Methods (consuming incoming packets)

Each read advances an internal position cursor.

| Method | Description |
|--------|-------------|
| `readByte()` | 1 unsigned byte |
| `readInt16()` | 2-byte signed big-endian integer |
| `readUInt16()` | 2-byte unsigned big-endian integer |
| `readInt32()` | 4-byte signed big-endian integer |
| `readUInt32()` | 4-byte unsigned big-endian integer |
| `readString8()` | 1-byte length-prefixed string |
| `readString16()` | 2-byte length-prefixed string |
| `read(length)` | Raw byte slice |

### Other Methods

| Method | Description |
|--------|-------------|
| `header()` | Returns the 4-byte header: `[0xAA, lenHi, lenLo, opcode]` |
| `bodyWithHeader()` | Returns the complete packet as a flat array |
| `buffer()` | Returns a Node.js `Buffer` of the full packet (for socket writes) |
| `toString()` | Hex dump string like `"AA 00 05 0A ..."` |

---

## Wire Protocol

### Packet Framing

Every packet on the wire follows this format:

```
Byte 0:       0xAA          (magic/start byte)
Bytes 1-2:    uint16 BE     (length = body_length + 1)
Byte 3:       opcode        (command identifier)
Bytes 4+:     body          (payload, encrypted for most opcodes)
```

The `receive()` method handles TCP fragmentation — it buffers incoming data and only processes complete frames.

### Encryption

The game uses a custom XOR-based encryption scheme:

1. **Salt generation** — A 256-byte salt array is generated deterministically from a seed value (0–9), sent by the server during handshake.
2. **Key selection** — Packets are classified as "standard" or "special":
   - **Standard:** Uses the base key string (`'UrkcnItnI'`).
   - **Special:** Derives a key from the character name using chained MD5 hashing (md5 of md5, repeated 32 times → 512-byte key table).
3. **XOR transform** — Each body byte is XOR'd against the salt and key in a rolling pattern.
4. **Integrity** — An MD5 hash of `[opcode, sequence, ...body]` is computed; 4 specific bytes from the hash are appended.
5. **Sequence tracking** — A rolling sequence counter prevents replay attacks.

Opcodes `0x00`, `0x10`, and `0x48` are never encrypted. The crypto engine handles all of this automatically.

---

## Connection Lifecycle

Here's the full login flow, handled automatically by the built-in packet handlers:

```
1. client.connect()
   └─ TCP connect to Login Server (52.88.55.94:2610)

2. Server sends 0x7E (welcome)
   └─ Client responds with 0x62 (magic bytes) + 0x00 (version announcement)

3. Server sends 0x00 (encryption handshake)
   └─ Client initializes Crypto with server-provided seed/key
   └─ Client sends 0x57 (acknowledgment)
   └─ If version mismatch: adjusts appVersion and reconnects

4. Server sends 0x03 (redirect to game server)
   └─ Client reconnects to the game server (Temuair or Medenia)
   └─ Client sends 0x10 (confirmIdentity) with new crypto params
   └─ Client sends 0x03 (login credentials)

5. Server sends 0x02 (login result)
   └─ Code 0 = success
   └─ Codes 3/14/15 = auth failure → disconnect

6. Server sends 0x05 (userId confirmed)
   └─ Client sends 0x2D (enter world)
   └─ Game session is now active
```

### Auto-Reconnect

- On socket error: retries after 5 seconds.
- On socket close: retries after 1 second.
- Version negotiation is automatic — the `encryption` handler adjusts `appVersion` up or down based on server feedback and reconnects until accepted.

---

## Built-in Packet Handlers

These handle the protocol-level communication automatically:

| Opcode | Name | What It Does |
|--------|------|-------------|
| `0x00` | encryption | Processes server handshake, initializes crypto, handles version negotiation |
| `0x02` | loginMessage | Handles login success/failure responses |
| `0x03` | redirect | Reconnects to a new server with updated crypto params |
| `0x05` | userId | Confirms login, sends "enter world" packet |
| `0x3B` | pingA | Responds to server ping (byte-swap pong) |
| `0x4C` | endingSignal | Responds to session signal |
| `0x68` | pingB | Responds to timestamp-based ping with tickCount |
| `0x7E` | welcome | Sends version info on initial connection |

---

## Server Registry

Three known game servers, all at `52.88.55.94`:

| Server | Port | Description |
|--------|------|-------------|
| Login | 2610 | Authentication server (default connection target) |
| Temuair | 2611 | Main game world |
| Medenia | 2612 | Expansion game world |

---

## Supporting Modules

### `crc.js`
Two pre-computed 256-entry CRC lookup tables (`dialogCRCTable`, `nexonCRC16Table`) and a `calculateCRC16()` function. Used during login to compute checksums over the client identity payload.

### `datatypes.js`
Fixed-width integer helpers that mask JavaScript numbers to prevent sign/overflow bugs:
- `uint8`, `int8`, `uint16`, `int16`, `uint32`, `int32`

### `util.js`
- `random(max)` — Random integer from 0 to max (inclusive).
- `toHex(number)` — Zero-padded uppercase hex string.

---

## Usage Example

A simple whisper-back bot that responds "pong" to anyone who whispers "ping":

```js
const { Client, Packet } = require('darkages');

const client = new Client('username', 'password');

client.events.on(0x0A, (packet) => {
  const channel = packet.readByte();
  const message = packet.readString16();
  const [name, whisper] = message.split('" ');

  if (whisper === 'ping') {
    const response = new Packet(0x19);
    response.writeString8(name);
    response.writeString8('pong');
    client.send(response);
  }
});

client.connect();
```

### Enabling Packet Logging

```js
client.logOutgoing = true;  // hex dump every sent packet
client.logIncoming = true;  // hex dump every received packet
```

---

## Build and Development

```bash
npm install          # install dependencies
npm run lint         # run ESLint on src/
npm run build        # transpile src/ → lib/ via Babel
npm run prepare      # lint + build (runs automatically on npm publish)
```

### Dependencies

- **Runtime:** `md5` — used for packet integrity hashing and special key generation.
- **Dev:** `babel-cli`, `babel-core`, `babel-preset-env` (Babel 6), `eslint`.
