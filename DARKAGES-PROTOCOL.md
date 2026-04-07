# Dark Ages Network Protocol Reference

> **Source:** Reverse-engineered from [Arbiter 1.8.1](https://github.com/) (C# packet analyzer by Erik Rogers), cross-referenced with [da.js](https://github.com/ericvaladas/da.js) (TypeScript client library by Eric Valadas).
>
> **Purpose:** Comprehensive AI-agent context file for building Dark Ages bots. Every opcode, field, enum, and packet flow is documented at the byte level.
>
> **Game:** Dark Ages (Nexon/KRU Interactive MMORPG, 1999-present)

---

## Table of Contents

1. [Data Type Reference](#1-data-type-reference)
2. [Packet Frame Format](#2-packet-frame-format)
3. [Encryption System](#3-encryption-system)
4. [Connection & Login Flow](#4-connection--login-flow)
5. [Type Enumerations](#5-type-enumerations)
6. [Client Opcodes (Client → Server)](#6-client-opcodes-client--server)
7. [Server Opcodes (Server → Client)](#7-server-opcodes-server--client)
8. [Game Feature Packet Flows](#8-game-feature-packet-flows)
9. [Implementation Notes](#9-implementation-notes)

---

## 1. Data Type Reference

All multi-byte integers are **big-endian** (network byte order) on the wire.

| Type | Width | Description |
|------|-------|-------------|
| `Byte` / `UInt8` | 1 | Unsigned 8-bit integer (0-255) |
| `SByte` / `Int8` | 1 | Signed 8-bit integer (-128 to 127) |
| `Bool` | 1 | Boolean: `0x00` = false, `0x01` = true |
| `UInt16` | 2 | Unsigned 16-bit big-endian integer |
| `Int16` | 2 | Signed 16-bit big-endian integer |
| `UInt32` | 4 | Unsigned 32-bit big-endian integer |
| `Int32` | 4 | Signed 32-bit big-endian integer |
| `UInt64` | 8 | Unsigned 64-bit big-endian integer |
| `Int64` | 8 | Signed 64-bit big-endian integer |
| `String8` | 1 + N | 1-byte length prefix (max 255), then N bytes of Windows-1252 encoded text |
| `String16` | 2 + N | 2-byte BE length prefix (max 65535), then N bytes of Windows-1252 text |
| `NullString` | N + 1 | Null-terminated string (variable length, ends with `0x00`) |
| `Line` | N + 1 | Newline-terminated string (ends with `\n` / `0x0A`) |
| `IPv4` | 4 | IP address as 4 bytes (e.g., `34 58 37 5E` = `52.88.55.94`) |
| `Bytes(N)` | N | Fixed-length raw byte array |
| `ReadToEnd` | * | All remaining bytes in the packet |

### String Encoding

All strings use **Windows-1252** (Western European) encoding, NOT UTF-8. In Node.js, use `iconv-lite` with encoding `'win1252'`.

---

## 2. Packet Frame Format

Every packet on the TCP stream uses this framing:

```
[0xAA] [SizeHi] [SizeLo] [Opcode] [Body...]
```

| Offset | Width | Field | Description |
|--------|-------|-------|-------------|
| 0 | 1 | Marker | Always `0xAA` |
| 1 | 2 | Size | Big-endian `UInt16`. Value = `len(Body) + 1` (includes opcode byte) |
| 3 | 1 | Opcode | Command byte identifying the packet type |
| 4 | * | Body | Payload bytes (may be 0 length) |

**Total packet length** = `Size + 3` bytes (marker + 2 size bytes + size value).

### TCP Stream Buffering

Packets arrive over a TCP stream and may be:
- **Fragmented:** A single packet split across multiple TCP segments
- **Coalesced:** Multiple packets combined in one TCP segment

Implementation must buffer incoming data and scan for `0xAA` markers, reading the 2-byte size to determine packet boundaries. See `NetworkPacketBuffer` in Arbiter for reference.

### Header Size Constant

```
HeaderSize = 4  (0xAA + 2 size bytes + 1 opcode byte)
```

---

## 3. Encryption System

Dark Ages uses a custom XOR-based encryption with two key tiers. Not all packets are encrypted.

### 3.1 Encryption Classification

#### Client Packets (Client → Server)

| Classification | Opcodes | Description |
|---------------|---------|-------------|
| **Not Encrypted** | `0x00`, `0x10`, `0x48` | Version, Authenticate, CancelCast — sent in plaintext |
| **Static Key** | `0x02`, `0x03`, `0x04`, `0x0B`, `0x26`, `0x2D`, `0x3A`, `0x42`, `0x43`, `0x4B`, `0x57`, `0x62`, `0x68`, `0x71`, `0x73`, `0x7B` | Use the fixed 9-byte private key |
| **Hash Key** | All others | Use dynamically generated key from bRand/sRand |
| **Dialog** | `0x39`, `0x3A` | Additional 6-byte dialog sub-encryption on top of standard encryption |

#### Server Packets (Server → Client)

| Classification | Opcodes | Description |
|---------------|---------|-------------|
| **Not Encrypted** | `0x00`, `0x03`, `0x40`, `0x7E` | ServerList, Redirect, Unknown0x40, Hello — sent in plaintext |
| **Static Key** | `0x01`, `0x02`, `0x0A`, `0x56`, `0x60`, `0x62`, `0x66`, `0x6F` | Use the fixed 9-byte private key |
| **Hash Key** | All others | Use dynamically generated key from bRand/sRand |

### 3.2 Encryption Parameters

#### Default Private Key

```
"UrkcnItnI" = [0x55, 0x72, 0x6B, 0x63, 0x6E, 0x49, 0x74, 0x6E, 0x49]
```

Key length: **9 bytes**.

#### Salt Table

A 256-byte lookup table selected by a **seed** value (0-9). The seed is provided by the server during the initial handshake (opcode 0x00 ServerList). There are 10 pre-computed salt tables (seeds 0-9). Each table contains 256 bytes.

**Seed 0:** Identity table `[0x00, 0x01, 0x02, ..., 0xFF]`
**Seed 1:** Interleaved from center `[0x80, 0x7F, 0x81, 0x7E, ...]`
**Seed 2:** Reversed `[0xFF, 0xFE, 0xFD, ..., 0x00]`
**Seed 3:** Alternating high-low `[0xFF, 0x01, 0xFE, 0x02, ...]`
**Seeds 4-9:** Additional pre-computed permutations.

#### Key Table (for Hash Key generation)

Generated from the character's **name** using MD5 chains:

```
step1 = md5_hex(name)                    // 32 hex chars
step2 = md5_hex(step1)                   // 32 hex chars
table = step2
for i in 0..30:
    table += md5_hex(table)              // append md5 of accumulated string
// Result: 1024-byte ASCII hex string
```

The key table is 1024 bytes of ASCII hex characters. Used only after login when the character name is known.

#### Hash Key Generation

Given random values `bRand` (UInt16) and `sRand` (Byte), generate a 9-byte key:

```
for i in 0..8:
    index = (i * (9 * i + sRand * sRand) + bRand) % 1024
    hashKey[i] = keyTable[index]
```

### 3.3 Client Packet Encryption (Client → Server)

#### Encrypted Packet Wire Format

```
[Sequence:u8] [EncryptedPayload...] [0x00] [Command?:u8] [MD5[13]:u8] [MD5[3]:u8] [MD5[11]:u8] [MD5[7]:u8] [bRandLo:u8] [sRand:u8] [bRandHi:u8]
```

- **Sequence**: 1-byte counter (wraps 0-255), used in XOR transform
- **EncryptedPayload**: The XOR-encrypted body (may include 6-byte dialog header)
- **0x00**: Zero separator byte
- **Command** (hash key only): Duplicated opcode byte after the zero separator
- **MD5 Checksum**: 4 bytes selected from MD5 hash of `[Command, Sequence, EncryptedPayload, 0x00, Command?]`
- **bRand/sRand trailer**: 3 bytes encoding the random values used for hash key generation

#### Payload Length Calculation

```
payloadLength = totalDataLength - (useHashKey ? 10 : 9)
// 9 = 1 (sequence) + 1 (zero) + 4 (md5) + 3 (bRand/sRand)
// 10 = above + 1 (duplicated command byte)
```

#### XOR Transform Algorithm

```
for i in 0..payloadLength:
    data[i] ^= privateKey[i % keyLength]
    data[i] ^= saltTable[(i / keyLength) % 256]
    if (i / keyLength) % 256 != sequence:
        data[i] ^= saltTable[sequence]
```

This is the same algorithm for both encryption and decryption (XOR is its own inverse).

#### MD5 Checksum

Computed over the buffer `[Command, Sequence, EncryptedPayload, 0x00, Command?]`:

```
fullMd5 = MD5(buffer_from_command_through_zero_and_optional_command)
checksum = [fullMd5[13], fullMd5[3], fullMd5[11], fullMd5[7]]
```

#### bRand/sRand Encoding (Client)

```
// Writing (encoding):
buffer[end-2] = (bRand & 0xFF) ^ 0x70      // bRand low byte
buffer[end-1] = sRand ^ 0x23               // sRand
buffer[end]   = ((bRand >> 8) & 0xFF) ^ 0x74  // bRand high byte

// Reading (decoding):
sRand = buffer[end-1] ^ 0x23
bRand = ((buffer[end] << 8) | buffer[end-2]) ^ 0x7470
```

### 3.4 Server Packet Encryption (Server → Client)

Server encryption is simpler — no MD5 checksum, no dialog handling.

#### Encrypted Packet Wire Format

```
[Sequence:u8] [EncryptedPayload...] [bRandLo:u8] [sRand:u8] [bRandHi:u8]
```

#### Payload Length

```
payloadLength = totalDataLength - 4
// 4 = 1 (sequence) + 3 (bRand/sRand)
```

#### XOR Transform

Same algorithm as client (Section 3.3).

#### bRand/sRand Encoding (Server)

**Different XOR constants than client!**

```
// Writing (encoding):
buffer[end-2] = (bRand & 0xFF) ^ 0x74      // Note: 0x74 not 0x70
buffer[end-1] = sRand ^ 0x24               // Note: 0x24 not 0x23
buffer[end]   = ((bRand >> 8) & 0xFF) ^ 0x64  // Note: 0x64 not 0x74

// Reading (decoding):
sRand = buffer[end-1] ^ 0x24
bRand = ((buffer[end] << 8) | buffer[end-2]) ^ 0x6474
```

### 3.5 Dialog Packet Encryption (Client Opcodes 0x39, 0x3A)

Dialog packets have an additional 6-byte encrypted header inserted between the sequence byte and the actual payload. This header is encrypted BEFORE the standard XOR transform is applied.

#### Dialog Header Format (before encryption)

```
[RandHi:u8] [RandLo:u8] [Length:u16] [CRC16:u16]
```

- **RandHi/RandLo**: Random 16-bit value split into bytes
- **Length**: `payload_length + 2` (includes the CRC16 bytes)
- **CRC16**: CRC-16 checksum of the original unencrypted payload

#### Dialog Encryption Process

```
xPrime = RandHi - 0x2D
x = RandLo ^ xPrime
y = x + 0x72
z = x + 0x28

// Encrypt length field
header[2] ^= y
header[3] ^= (y + 1) & 0xFF

// Encrypt CRC16 + payload
for i in 0..length:
    data[4 + i] ^= (z + i) & 0xFF
```

#### Dialog Decryption Process

```
xPrime = header[0] - 0x2D
x = header[1] ^ xPrime
y = x + 0x72
z = x + 0x28

// Decrypt length
header[2] ^= y
header[3] ^= (y + 1) & 0xFF
length = (header[2] << 8) | header[3]

// Decrypt CRC16 + payload
for i in 0..length:
    data[4 + i] ^= (z + i) & 0xFF

// Strip 6-byte dialog header, remaining data is the plaintext payload
```

### 3.6 CRC-16

Used for dialog packet integrity and login checksums. Standard CRC-16 with a pre-computed 256-entry lookup table (Nexon variant).

---

## 4. Connection & Login Flow

### Server Addresses

| Server | Address | Port |
|--------|---------|------|
| Login Server | 52.88.55.94 | 2610 |
| Temuair (Game) | 52.88.55.94 | 2611 |
| Medenia (Game) | 52.88.55.94 | 2612 |

### Full Connection Sequence

```
1. TCP Connect to Login Server (52.88.55.94:2610)
2. ← Server 0x7E (Hello)         — welcome message with greeting text
3. → Client 0x62 (RequestSequence) — unknown UInt32
4. → Client 0x00 (Version)        — client version (e.g., 741), checksum
5. ← Server 0x00 (ServerList)     — encryption seed, key length, private key, checksum
6.   [Initialize encryption with received seed + private key]
7. → Client 0x57 (RequestServerTable) — request server list (optional)
8. ← Server 0x56 (ServerTable)    — zlib-compressed server list (optional)
9. → Client 0x03 (Login)          — username, password, CRC checksum
10. ← Server 0x02 (LoginResult)   — success/failure code + message
11.   [If success] ← Server 0x03 (Redirect) — game server IP, port, new encryption params
12.   Disconnect from Login Server
13. TCP Connect to Game Server (from redirect)
14. ← Server 0x7E (Hello)
15. → Client 0x62 (RequestSequence)
16. → Client 0x00 (Version)
17. ← Server 0x00 (ServerList)     — new encryption params for game server
18. → Client 0x10 (Authenticate)   — seed, private key, name, connection ID from redirect
19. → Client 0x03 (Login)          — username, password again
20. ← Server 0x02 (LoginResult)   — success
21. ← Server 0x05 (UserId)        — assigned user ID, direction, class, guild status
22. → Client 0x2D (RequestProfile) — "enter world" signal
23.   [Game session begins — server starts sending map data, entities, stats, etc.]
```

### Redirect Packet Details

The server 0x03 Redirect packet provides:
- New server IP address and port
- `RemainingCount` (byte) — number of remaining redirects
- New encryption `Seed` (byte) and `PrivateKey` (variable length)
- Character `Name` (String8) and `ConnectionId` (UInt32) — used in subsequent Authenticate packet

### Auto-Reconnect Strategy

Recommended exponential backoff: 5s → 10s → 20s → 30s (cap).

---

## 5. Type Enumerations

### WorldDirection

| Value | Name | Description |
|-------|------|-------------|
| 0 | Up | North |
| 1 | Right | East |
| 2 | Down | South |
| 3 | Left | West |
| 4 | All | All directions |
| 0xFF | None | No direction |

### CharacterClass

| Value | Name |
|-------|------|
| 0 | Peasant |
| 1 | Warrior |
| 2 | Rogue |
| 3 | Wizard |
| 4 | Priest |
| 5 | Monk |

### CreatureType

| Value | Name | Description |
|-------|------|-------------|
| 0 | Monster | Hostile NPC |
| 1 | Passable | Walkable entity |
| 2 | Mundane | Friendly NPC (has name) |
| 3 | Solid | Blocking entity |
| 4 | Aisling | Player character |

### PublicMessageType

| Value | Name |
|-------|------|
| 0 | Say |
| 1 | Shout |
| 2 | Chant |

### WorldMessageType

| Value | Name | Description |
|-------|------|-------------|
| 0 | Whisper | Private message |
| 1 | BarMessageTop | Top system bar |
| 2 | BarMessageBottom | Bottom system bar |
| 3 | WorldShout | Global broadcast (!) |
| 4 | UserSettings | Settings notification |
| 5 | ScrollablePopup | Large scrollable text |
| 6 | Popup | Small popup dialog |
| 7 | SignPost | Signpost text display |
| 8 | BarMessageTopRight | Top-right bar message |
| 11 | GroupChat | Group/party message |
| 12 | GuildChat | Guild message |
| 13 | ClosePopup | Close open popup |
| 18 | FloatingMessage | Floating text in world |

### DialogType

| Value | Name | Description |
|-------|------|-------------|
| 0 | Popup | Simple popup |
| 1 | Menu | Option menu |
| 2 | TextInput | Text input prompt |
| 3 | Speak | NPC speech |
| 4 | CreatureMenu | Creature-specific menu |
| 5 | Protected | Protected dialog |
| -1 / 0xFF | CloseDialog | Close current dialog |

### DialogMenuType

| Value | Name |
|-------|------|
| 0 | Menu |
| 1 | MenuWithArgs |
| 2 | TextInput |
| 3 | TextInputWithArgs |
| 4 | ItemChoices |
| 5 | UserInventory |
| 6 | SpellChoices |
| 7 | SkillChoices |
| 8 | UserSpells |
| 9 | UserSkills |

### DialogArgsType

| Value | Name |
|-------|------|
| 0 | None |
| 1 | MenuChoice |
| 2 | TextInput |

### InteractionType

| Value | Name |
|-------|------|
| 1 | Entity |
| 3 | Tile |

### EquipmentSlot

| Value | Name |
|-------|------|
| 1 | Weapon |
| 2 | Armor |
| 3 | Shield |
| 4 | Helmet |
| 5 | Earrings |
| 6 | Necklace |
| 7 | LeftRing |
| 8 | RightRing |
| 9 | LeftGauntlet |
| 10 | RightGauntlet |
| 11 | Belt |
| 12 | Greaves |
| 13 | Boots |
| 14 | Accessory1 |
| 15 | Overcoat |
| 16 | OverHelm |
| 17 | Accessory2 |
| 18 | Accessory3 |

### InterfacePane

| Value | Name |
|-------|------|
| 0 | Inventory |
| 1 | Skills |
| 2 | Spells |
| 3 | Chat |
| 4 | Stats |

### DyeColor (77 values)

| Value | Name | Value | Name | Value | Name |
|-------|------|-------|------|-------|------|
| 0 | Default | 26 | Green | 52 | MidnightBlue |
| 1 | Black | 27 | Spring | 53 | Brass |
| 2 | Apple | 28 | Apple2 | 54 | NeonGreen |
| 3 | Orange | 29 | Leaf | 55 | CottonCandy |
| 4 | Yellow | 30 | Cobalt | 56 | Purple2 |
| 5 | Teal | 31 | Steel | 57 | Mauve |
| 6 | Blue | 32 | Ice | 58 | NeonOrange |
| 7 | Purple | 33 | Earth | 59 | Peach2 |
| 8 | DarkGreen | 34 | Wind | 60 | HotPink |
| 9 | Beige | 35 | Lake | 61 | NeonRed |
| 10 | NightSky | 36 | Fire | 62 | TealGreen |
| 11 | Gray | 37 | Suomi | 63 | Chocolate |
| 12 | Brown | 38 | Beach | 64 | HunterGreen |
| 13 | Cyan | 39 | Ginger | 65 | Tan |
| 14 | Red | 40 | Mustard | 66 | DarkRed |
| 15 | White | 41 | Ruby | 67 | MediumGray |
| 16 | Lavender | 42 | Sapphire | 68 | Crimson |
| 17 | Peach | 43 | Emerald | 69 | BubbleGum |
| 18 | Pink | 44 | Amethyst | 70 | SkyBlue |
| 19 | Magenta | 45 | Amber | 71 | Aqua |
| 20 | HazelNut | 46 | PowderBlue | 72 | Coral |
| 21 | LightBlue | 47 | Rust | 73 | ChartreuseGreen |
| 22 | DeepPurple | 48 | Copper | 74 | DarkPurple |
| 23 | Honey | 49 | Pearl | 75 | SageGreen |
| 24 | Cerulean | 50 | Scarlet | 76 | NeonPurple |
| 25 | Sky | 51 | Pewter | | |

### SkinColor

| Value | Name |
|-------|------|
| 0 | Default |
| 1 | Pale |
| 2 | Brown |
| 3 | Green |
| 4 | Yellow |
| 5 | Tan |
| 6 | Grey |
| 7 | LightBlue |
| 8 | Orange |
| 9 | Purple |

### ElementModifier

| Value | Name |
|-------|------|
| 0 | None |
| 1 | Fire |
| 2 | Water |
| 3 | Wind |
| 4 | Earth |
| 5 | Light |
| 6 | Dark |
| 7 | Wood |
| 8 | Metal |
| 9 | Undead |

### BodyAnimation (45 values)

| Value | Name | Value | Name |
|-------|------|-------|------|
| 0 | None | 23 | Jump |
| 1 | Assail | 24 | PriestCast |
| 2 | HandsUp | 25 | TwoHandSwing |
| 3 | Smile | 26 | JumpAttack |
| 4 | Cry | 27 | MultiSwing |
| 5 | Frown | 28 | Stab |
| 6 | Wink | 29 | DoublePunch |
| 7 | Surprise | 30 | Kick |
| 8 | Tongue | 31 | PunchSlap |
| 9 | Pleasant | 32 | Roundhouse |
| 10 | Snore | 33 | Uppercut |
| 11 | Mouth | 34 | WizardCast |
| 12 | BodyFlex | 35 | DualWield |
| 13 | Blush | 36 | Lunge |
| 14 | Stomp | 37 | Idle1 |
| 15 | StompRight | 38 | Idle2 |
| 16 | Swipe | 39 | Kneel |
| 17 | Combat | 40 | Crouch |
| 18 | Bow | 41 | LookAround |
| 19 | Salute | 42 | PickUp |
| 20 | Scratch | 43 | Sit |
| 21 | Bow2 | 44 | Summon |
| 22 | Rear | | |

### SpellTargetType

| Value | Name | Description |
|-------|------|-------------|
| 0 | None | No targeting |
| 1 | Prompt | Text prompt |
| 2 | Target | Click target entity/tile |
| 3 | PromptFourNumbers | 4 numeric inputs |
| 4 | PromptThreeNumbers | 3 numeric inputs |
| 5 | NoTarget | Self-cast |
| 6 | PromptTwoNumbers | 2 numeric inputs |
| 7 | PromptOneNumber | 1 numeric input |

### AbilityType

| Value | Name |
|-------|------|
| 0 | Spell |
| 1 | Skill |

### SpriteType

| Value | Name |
|-------|------|
| 0 | None |
| 1 | Item |
| 2 | Spell |
| 3 | Skill |
| 4 | Monster |

### BodySprite

| Value | Name |
|-------|------|
| 0 | Male |
| 1 | Female |
| 2 | MaleGhost |
| 3 | FemaleGhost |
| 4 | Invisible |
| 5 | MaleJester |
| 6 | FemaleJester |
| 7 | MaleHead |
| 8 | FemaleHead |
| 9 | Blank |

### RestPosition

| Value | Name |
|-------|------|
| 0 | None |
| 1 | Kneeling |
| 2 | Laying |
| 3 | Sprawling |

### SocialStatus

| Value | Name |
|-------|------|
| 0 | Awake |
| 1 | DoNotDisturb |
| 2 | Daydreaming |
| 3 | NeedGroup |
| 4 | Grouped |
| 5 | LoneHunter |
| 6 | GroupHunting |
| 7 | NeedHelp |

### LanternSize

| Value | Name |
|-------|------|
| 0 | None |
| 1 | Small |
| 2 | Large |

### NationFlag

| Value | Name |
|-------|------|
| 0 | None |
| 1 | Suomi |
| 2 | Unknown2 |
| 3 | Loures |
| 4 | Mileth |
| 5 | Tagor |
| 6 | Rucesion |
| 7 | Noes |
| 8 | Unknown8 |
| 9 | Unknown9 |
| 10 | Unknown10 |
| 11 | Piet |
| 12 | Abel |
| 13 | Undine |

### LoginResult

| Value | Name |
|-------|------|
| 0 | Success |
| 3 | InvalidName |
| 5 | NameTaken |
| 10 | InvalidPassword |
| 14 | CharacterNotFound |
| 15 | IncorrectPassword |

### StatusEffectDuration

| Value | Name |
|-------|------|
| 0 | None |
| 1 | Blue |
| 2 | Green |
| 3 | Yellow |
| 4 | Orange |
| 5 | Red |
| 6 | White |

### NameTagStyle

| Value | Name |
|-------|------|
| 0 | NeutralHover |
| 1 | Hostile |
| 2 | FriendlyHover |
| 3 | Neutral |

### NotepadStyle

| Value | Name |
|-------|------|
| 0 | Brown |
| 1 | Blue |
| 2 | Blue2 |
| 3 | Orange |
| 4 | White |

### WorldListColor

| Value | Name |
|-------|------|
| 0 | Default |
| 1 | Guild |
| 2 | SimilarLevel |

### LegendMarkColor (31 values)

| Value | Name | Value | Name |
|-------|------|-------|------|
| 0 | Cyan | 16 | Turquoise |
| 1 | BrightRed | 17 | PalePink |
| 2 | GrayTan | 18 | Maroon |
| 3 | DarkBlue | 19 | Beige |
| 4 | Purple | 20 | DarkGreen |
| 5 | DarkGray | 21 | Olive |
| 6 | Brown | 22 | DarkOlive |
| 7 | SkyBlue | 23 | Peach |
| 8 | Yellow | 24 | DarkPeach |
| 9 | DeepBlue | 25 | Teal |
| 10 | Coral | 26 | LightGreen |
| 11 | Tan | 27 | LightGray |
| 12 | White | 28 | RustRed |
| 13 | Green | 29 | DarkRed |
| 14 | Orange | 30 | Red |
| 15 | LightPink | | |

### LegendMarkIcon

| Value | Name |
|-------|------|
| 0 | Aisling |
| 1 | Warrior |
| 2 | Rogue |
| 3 | Wizard |
| 4 | Priest |
| 5 | Monk |
| 6 | Heart |
| 7 | Victory |
| 8 | None |

### ExchangeClientActionType

| Value | Name | Description |
|-------|------|-------------|
| 0 | BeginExchange | Start trade with target |
| 1 | AddItem | Place single item |
| 2 | AddStackableItem | Place stackable item with quantity |
| 3 | SetGold | Set gold amount |
| 4 | Cancel | Cancel trade |
| 5 | Accept | Accept/confirm trade |

### ExchangeServerEventType

| Value | Name |
|-------|------|
| 0 | Started |
| 1 | QuantityPrompt |
| 2 | ItemAdded |
| 3 | GoldAdded |
| 4 | Cancelled |
| 5 | Accepted |

### ExchangeParty

| Value | Name |
|-------|------|
| 0 | You |
| 1 | Them |

### ClientGroupAction

| Value | Name |
|-------|------|
| 0 | Invite |
| 1 | Request |
| 2 | Accept |
| 3 | RecruitStart |
| 4 | RecruitView |
| 5 | RecruitStop |
| 6 | RecruitJoin |

### ServerGroupAction

| Value | Name |
|-------|------|
| 0 | Ask |
| 1 | Members |
| 2 | RecruitInfo |
| 3 | RecruitJoin |

### CharacterStatFlags (Bitmask)

| Bit | Name |
|-----|------|
| 0x01 | Strength |
| 0x02 | Dexterity |
| 0x04 | Intelligence |
| 0x08 | Wisdom |
| 0x10 | Constitution |

### StatsFieldFlags (Bitmask)

| Bit | Name | Description |
|-----|------|-------------|
| 0x01 | UnreadMail | Has unread mail |
| 0x02 | Unknown | Unknown |
| 0x04 | Modifiers | Include modifier fields |
| 0x08 | ExperienceGold | Include XP/gold fields |
| 0x10 | Vitals | Include HP/MP current values |
| 0x20 | Stats | Include base stat fields |
| 0x40 | GameMasterA | GM flag A |
| 0x80 | GameMasterB | GM flag B |
| 0xC0 | Swimming | Both GM flags (A+B) |
| 0x3C | Full | Stats + Vitals + ExperienceGold + Modifiers |

### EntityTypeFlags (Bitmask)

| Bit | Name |
|-----|------|
| 0x01 | Creature |
| 0x02 | Item |
| 0x04 | Reactor |

### MapFlags (Bitmask)

| Bit | Name |
|-----|------|
| 0x01 | Snow |
| 0x02 | Rain |
| 0x03 | Darkness (Snow + Rain) |
| 0x04 | NoMap |
| 0x08 | Winter |

### GenderFlags

| Value | Name |
|-------|------|
| 0x01 | Male |
| 0x02 | Female |
| 0x03 | Unisex (Male + Female) |

### MailFlags

| Bit | Name |
|-----|------|
| 0x01 | Parcel |
| 0x02 | Mail |

### DoorDirection

| Value | Name |
|-------|------|
| 0 | Left |
| 1 | Right |

### DoorState

| Value | Name |
|-------|------|
| 0 | Open |
| 1 | Closed |

### IgnoreUserAction

| Value | Name |
|-------|------|
| 0 | ListUsers |
| 1 | AddUser |
| 2 | RemoveUser |

### MessageBoardAction (Client)

| Value | Name |
|-------|------|
| 0 | ListBoards |
| 1 | ViewBoard |
| 2 | ViewPost |
| 3 | CreatePost |
| 4 | DeletePost |
| 5 | SendMail |
| 6 | HighlightPost |

### MessageBoardResult (Server)

| Value | Name |
|-------|------|
| 0 | BoardList |
| 1 | Board |
| 2 | Post |
| 3 | Mailbox |
| 4 | MailLetter |
| 5 | PostSubmitted |
| 6 | PostDeleted |
| 7 | PostHighlighted |

### MessageBoardType

| Value | Name |
|-------|------|
| 0 | Global |
| 1 | Clicked |

### MessageBoardNavigation

| Value | Name |
|-------|------|
| -1 | NextPage |
| 0 | ThisPost |
| 1 | PreviousPage |

### MetadataRequestType

| Value | Name |
|-------|------|
| 0 | GetMetadata |
| 1 | Listing |

### MetadataResponseType

| Value | Name |
|-------|------|
| 0 | Metadata |
| 1 | Listing |

### ServerInfoType

| Value | Name |
|-------|------|
| 0 | None |
| 1 | Homepage |

### ClientExitReason

| Value | Name |
|-------|------|
| 0 | None |
| 1 | UserRequested |

### SpriteFlags (Constants)

| Value | Name | Description |
|-------|------|-------------|
| 0x4000 | Creature | Sprite is a creature (bit 14) |
| 0x8000 | Item | Sprite is an item (bit 15) |

To determine sprite type from a `UInt16` sprite value:
- If `sprite & 0x8000` → Item, actual sprite = `sprite & 0x3FFF`
- If `sprite & 0x4000` → Creature, actual sprite = `sprite & 0x3FFF`
- Otherwise → Player/Aisling

---

## 6. Client Opcodes (Client → Server)

### 0x00 — Version
**Encryption:** None

| Field | Type | Description |
|-------|------|-------------|
| Version | UInt16 | Client version number (e.g., 741) |
| Checksum | UInt16 | Client checksum |

### 0x02 — CreateCharacterName
**Encryption:** Static Key

| Field | Type | Description |
|-------|------|-------------|
| Name | String8 | Desired character name |
| Password | String8 | Account password |
| Email | String8 | Email address |

### 0x03 — Login
**Encryption:** Static Key

| Field | Type | Description |
|-------|------|-------------|
| Name | String8 | Username |
| Password | String8 | Password |
| Key1 | Byte | XOR key byte 1 (for ClientId/Checksum decryption) |
| Key2 | Byte | XOR key byte 2 |
| EncodedClientId | UInt32 | XOR-encrypted client ID |
| EncodedChecksum | UInt16 | XOR-encrypted CRC checksum |

**Note:** The ClientId and Checksum are XOR-encrypted using keys derived from Key1 and Key2. The server decodes them using the same derivation.

### 0x04 — CreateCharacterAppearance
**Encryption:** Static Key

| Field | Type | Description |
|-------|------|-------------|
| HairStyle | Byte | Hair style index |
| Gender | Byte | 0=Male, 1=Female |
| HairColor | Byte | Hair color index |

### 0x05 — RequestMapData
**Encryption:** Hash Key

No body fields. Empty payload.

### 0x06 — Walk
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Direction | Byte | 0=Up, 1=Right, 2=Down, 3=Left |
| StepCount | Byte | Step counter (increments per walk) |

### 0x07 — PickupItem
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Slot | Byte | Inventory slot to pick up into |
| X | UInt16 | Tile X coordinate |
| Y | UInt16 | Tile Y coordinate |

### 0x08 — DropItem
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Slot | Byte | Inventory slot |
| X | UInt16 | Target tile X |
| Y | UInt16 | Target tile Y |
| Quantity | UInt32 | Number of items to drop (for stackables) |

### 0x09 — LookAhead
**Encryption:** Hash Key

No body fields.

### 0x0A — LookTile
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| TileX | UInt16 | Tile X to examine |
| TileY | UInt16 | Tile Y to examine |

### 0x0B — RequestExit
**Encryption:** Static Key

| Field | Type | Description |
|-------|------|-------------|
| Reason | Byte | (Optional) 0=None, 1=UserRequested |

### 0x0C — RequestEntity
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| EntityId | UInt32 | Entity serial to request info for |

### 0x0D — IgnoreUser
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Action | Byte | 0=ListUsers, 1=AddUser, 2=RemoveUser |
| Name | String8 | (Conditional) Target name, only if Action is Add/Remove |

### 0x0E — Say
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| MessageType | Byte | 0=Say, 1=Shout, 2=Chant |
| Content | String8 | Message text |

### 0x0F — CastSpell
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Slot | Byte | Spell book slot (1-based) |

Remaining fields depend on the spell's `SpellTargetType`:
- **Target (2):** `TargetId:UInt32`, `TargetX:UInt16`, `TargetY:UInt16`
- **Prompt (1):** `TextInput:String8`
- **PromptOneNumber (7):** `Value1:UInt16`
- **PromptTwoNumbers (6):** `Value1:UInt16`, `Value2:UInt16`
- **PromptThreeNumbers (4):** `Value1:UInt16`, `Value2:UInt16`, `Value3:UInt16`
- **PromptFourNumbers (3):** `Value1:UInt16`, `Value2:UInt16`, `Value3:UInt16`, `Value4:UInt16`
- **NoTarget (5) / None (0):** No additional fields

### 0x10 — Authenticate
**Encryption:** None

| Field | Type | Description |
|-------|------|-------------|
| Seed | Byte | Encryption seed received from redirect |
| PrivateKey | Bytes | Key length prefix (Byte) + key bytes |
| Name | String8 | Character name |
| ConnectionId | UInt32 | Connection ID from redirect |

### 0x11 — Turn
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Direction | Byte | 0=Up, 1=Right, 2=Down, 3=Left |

### 0x13 — Assail
**Encryption:** Hash Key

No body fields. Triggers auto-attack.

### 0x18 — RequestWorldList
**Encryption:** Hash Key

No body fields.

### 0x19 — Whisper
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Target | String8 | Recipient name |
| Content | String8 | Message text |

### 0x1A — EatItem
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Slot | Byte | Inventory slot of consumable |

### 0x1B — ToggleSetting
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| OptionIndex | Byte | Setting to toggle |

### 0x1C — UseItem
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Slot | Byte | Inventory slot |

### 0x1D — Emote
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Emote | Byte | Emote animation index (see BodyAnimation) |

### 0x23 — EditNotepad
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Slot | Byte | Notepad slot |
| Content | String16 | Notepad text content |

### 0x24 — DropGold
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Amount | UInt32 | Gold amount to drop |
| X | UInt16 | Target tile X |
| Y | UInt16 | Target tile Y |

### 0x26 — ChangePassword
**Encryption:** Static Key

| Field | Type | Description |
|-------|------|-------------|
| Name | String8 | Account name |
| CurrentPassword | String8 | Current password |
| NewPassword | String8 | New password |

### 0x29 — GiveItem
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Slot | Byte | Inventory slot |
| EntityId | UInt32 | Target entity ID |
| Quantity | Byte | Quantity to give |

### 0x2A — GiveGold
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Amount | UInt32 | Gold amount |
| EntityId | UInt32 | Target entity ID |

### 0x2D — RequestProfile
**Encryption:** Static Key

No body fields. Acts as "enter world" signal after login.

### 0x2E — GroupInvite
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Action | Byte | See ClientGroupAction enum |
| TargetName | String8 | Target player name |

If Action == RecruitStart (3), additional GroupBox fields follow:
| Field | Type | Description |
|-------|------|-------------|
| MinLevel | Byte | Minimum level |
| MaxLevel | Byte | Maximum level |
| MaxMembers | Byte | Maximum group members |
| *Additional fields* | ... | Class restrictions, etc. |

### 0x2F — ToggleGroup
**Encryption:** Hash Key

No body fields.

### 0x30 — SwapSlot
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Pane | Byte | 0=Inventory, 1=Skills, 2=Spells |
| SourceSlot | Byte | Source slot index |
| TargetSlot | Byte | Target slot index |

### 0x38 — Refresh
**Encryption:** Hash Key

No body fields. Requests full state refresh.

### 0x39 — DialogMenuChoice
**Encryption:** Dialog (Static Key + Dialog sub-encryption)

| Field | Type | Description |
|-------|------|-------------|
| EntityType | Byte | EntityTypeFlags |
| EntityId | UInt32 | NPC entity serial |
| PursuitId | UInt16 | Pursuit/quest ID |
| Slot | Byte | Selected slot |

If additional data present:
| Field | Type | Description |
|-------|------|-------------|
| Arguments | String8[] | Array of text arguments |

### 0x3A — DialogChoice
**Encryption:** Dialog (Static Key + Dialog sub-encryption)

| Field | Type | Description |
|-------|------|-------------|
| EntityType | Byte | EntityTypeFlags |
| EntityId | UInt32 | NPC entity serial |
| PursuitId | UInt16 | Pursuit/quest ID |
| StepId | UInt16 | Dialog step ID |
| ArgsType | Byte | 0=None, 1=MenuChoice, 2=TextInput |

If ArgsType == 1 (MenuChoice):
| Field | Type | Description |
|-------|------|-------------|
| MenuChoice | Byte | Selected menu option index |

If ArgsType == 2 (TextInput):
| Field | Type | Description |
|-------|------|-------------|
| TextInputs | String8[] | Array of text input values |

### 0x3B — BoardAction
**Encryption:** Static Key

| Field | Type | Description |
|-------|------|-------------|
| Action | Byte | See MessageBoardAction enum |

Conditional fields based on Action:

**ViewBoard (1):** `BoardId:UInt16`, `StartPostId:Int16`, `Unknown:Byte`
**ViewPost (2):** `BoardId:UInt16`, `PostId:Int16`, `Navigation:SByte`
**CreatePost (3):** `BoardId:UInt16`, `Subject:String8`, `Body:String16`
**DeletePost (4):** `BoardId:UInt16`, `PostId:Int16`
**SendMail (5):** `BoardId:UInt16`, `Recipient:String8`, `Subject:String8`, `Body:String16`
**HighlightPost (6):** `BoardId:UInt16`, `PostId:Int16`

### 0x3E — UseSkill
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Slot | Byte | Skill book slot (1-based) |

### 0x3F — WorldMapClick
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Checksum | UInt16 | Map checksum |
| MapId | UInt16 | Target map ID |
| X | UInt16 | Target X coordinate |
| Y | UInt16 | Target Y coordinate |

### 0x41 — DismissParcel
**Encryption:** Hash Key

No body fields documented.

### 0x42 — Exception
**Encryption:** Static Key

| Field | Type | Description |
|-------|------|-------------|
| Message | ReadToEnd | Error message as ASCII bytes |

### 0x43 — Interact
**Encryption:** Static Key

| Field | Type | Description |
|-------|------|-------------|
| InteractionType | Byte | 1=Entity, 3=Tile |

If InteractionType == 1 (Entity):
| Field | Type | Description |
|-------|------|-------------|
| TargetId | UInt32 | Entity serial to interact with |

If InteractionType == 3 (Tile):
| Field | Type | Description |
|-------|------|-------------|
| TargetX | UInt16 | Tile X |
| TargetY | UInt16 | Tile Y |

### 0x44 — UnequipItem
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Slot | Byte | Equipment slot (see EquipmentSlot enum) |

### 0x45 — Heartbeat
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Reply | UInt16 | Echoed value from server's heartbeat request |

### 0x47 — RaiseStat
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Stat | Byte | Stat to raise (see CharacterStatFlags) |

### 0x4A — ExchangeAction
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Action | Byte | See ExchangeClientActionType enum |

Conditional fields based on Action:

**BeginExchange (0):** `TargetId:UInt32`
**AddItem (1):** `Slot:Byte`
**AddStackableItem (2):** `Slot:Byte`, `Quantity:Byte`
**SetGold (3):** `GoldAmount:UInt32`
**Cancel (4):** No additional fields
**Accept (5):** No additional fields

### 0x4B — RequestLoginNotice
**Encryption:** Static Key

No body fields.

### 0x4D — BeginSpellCast
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| LineCount | Byte | Number of chant lines |

### 0x4E — SpellChant
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Content | String8 | Chant text |

### 0x4F — UserPortrait
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| TotalLength | UInt16 | Total data length |
| PortraitLength | UInt16 | Portrait image data length |
| Portrait | Bytes | Portrait image data |
| Bio | String16 | Biography text |

### 0x55 — Manufacture
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| ManufactureId | UInt16 | Crafting station ID |
| MessageType | Byte | Request type |

Conditional fields based on MessageType:
- **Some types:** `RecipeIndex:Byte`
- **Other types:** `RecipeName:String8`
- Trailing `0x00` byte

### 0x56 — RequestUserId
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Nonce | Byte | (Optional) Random nonce |

### 0x57 — RequestServerTable
**Encryption:** Static Key

| Field | Type | Description |
|-------|------|-------------|
| NeedsServerTable | Bool | Whether table is needed |

### 0x62 — RequestSequence
**Encryption:** Static Key

| Field | Type | Description |
|-------|------|-------------|
| Unknown | UInt32 | Purpose unknown |

### 0x68 — RequestHomepage
**Encryption:** Static Key

| Field | Type | Description |
|-------|------|-------------|
| NeedsHomepage | Bool | Whether homepage URL is needed |

### 0x75 — SyncTicks
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| ServerTickCount | UInt32 | Echoed server tick count |
| ClientTickCount | UInt32 | Client's current tick count |

### 0x79 — SetStatus
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Status | Byte | See SocialStatus enum |

### 0x7B — RequestMetadata
**Encryption:** Static Key

| Field | Type | Description |
|-------|------|-------------|
| RequestType | Byte | 0=GetMetadata, 1=Listing |
| Name | String8 | (Conditional) Metadata name, only if RequestType == GetMetadata |

### 0xFF — Unknown
Reserved / unknown client command.

---

## 7. Server Opcodes (Server → Client)

### 0x00 — ServerList
**Encryption:** None

| Field | Type | Description |
|-------|------|-------------|
| Skip | 1 byte | Unknown/padding |
| Checksum | UInt32 | Server checksum |
| Seed | Byte | Encryption seed (0-9) for salt table selection |
| KeyLength | Byte | Length of private key |
| PrivateKey | Bytes(KeyLength) | Encryption private key |

### 0x02 — LoginResult
**Encryption:** Static Key

| Field | Type | Description |
|-------|------|-------------|
| Result | Byte | See LoginResult enum |
| Message | String8 | Result message text |

### 0x03 — Redirect
**Encryption:** None

| Field | Type | Description |
|-------|------|-------------|
| Address | IPv4 | Game server IP address |
| Port | UInt16 | Game server port |
| RemainingCount | Byte | Remaining redirect count |
| Seed | Byte | New encryption seed |
| KeyLength | Byte | New private key length |
| PrivateKey | Bytes(KeyLength) | New private key |
| Name | String8 | Character name |
| ConnectionId | UInt32 | Connection identifier (pass back in Authenticate) |

### 0x04 — MapLocation
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| X | UInt16 | Player X position |
| Y | UInt16 | Player Y position |
| UnknownX | UInt16 | Unknown (possibly viewport offset) |
| UnknownY | UInt16 | Unknown |

### 0x05 — UserId
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| UserId | UInt32 | Assigned entity serial ID |
| Direction | Byte | Facing direction |
| HasGuild | Bool | Whether player has a guild |
| Class | Byte | Character class |
| CanMove | Byte | Movement flags (bitfield) |

### 0x07 — AddEntity
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| EntityCount | UInt16 | Number of entities in this packet |

For each entity:
| Field | Type | Description |
|-------|------|-------------|
| X | UInt16 | Tile X position |
| Y | UInt16 | Tile Y position |
| Id | UInt32 | Entity serial ID |
| Sprite | UInt16 | Sprite with flags (see SpriteFlags) |

**If sprite has Creature flag (0x4000):**
| Field | Type | Description |
|-------|------|-------------|
| Unknown | UInt32 | Unknown 4 bytes |
| Direction | Byte | Facing direction |
| Skip | 1 byte | Padding |
| CreatureType | Byte | See CreatureType enum |
| Name | String8 | (Only if CreatureType == Mundane) NPC name |

**If sprite has Item flag (0x8000):**
| Field | Type | Description |
|-------|------|-------------|
| Color | Byte | Item dye color |
| Unknown | UInt16 | Unknown 2 bytes |

### 0x08 — UpdateStats
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Fields | Byte | StatsFieldFlags bitmask determining which blocks follow |

**If Fields & 0x20 (Stats):**
| Field | Type | Description |
|-------|------|-------------|
| Level | Byte | Character level |
| AbilityLevel | Byte | Ability level |
| MaxHealth | UInt32 | Maximum HP |
| MaxMana | UInt32 | Maximum MP |
| Str | Byte | Strength |
| Int | Byte | Intelligence |
| Wis | Byte | Wisdom |
| Con | Byte | Constitution |
| Dex | Byte | Dexterity |
| StatPoints | Byte | Available stat points |
| Weight | UInt16 | Current weight |
| MaxWeight | UInt16 | Maximum weight |

**If Fields & 0x10 (Vitals):**
| Field | Type | Description |
|-------|------|-------------|
| Health | UInt32 | Current HP |
| Mana | UInt32 | Current MP |

**If Fields & 0x08 (ExperienceGold):**
| Field | Type | Description |
|-------|------|-------------|
| TotalExp | UInt32 | Total experience |
| ToNextLevel | UInt32 | Experience to next level |
| TotalAbility | UInt32 | Total ability experience |
| ToNextAbility | UInt32 | Ability experience to next |
| GamePoints | UInt32 | Game points |
| Gold | UInt32 | Gold held |

**If Fields & 0x04 (Modifiers):**
| Field | Type | Description |
|-------|------|-------------|
| IsBlinded | Bool | Blind status |
| MailFlags | Byte | See MailFlags |
| AttackElement | Byte | Attack element (see ElementModifier) |
| DefenseElement | Byte | Defense element |
| MagicResist | Byte | Magic resistance |
| CanMove | Byte | Movement flags |
| ArmorClass | SByte | Armor class (signed, lower = better) |
| DamageModifier | Byte | Damage bonus |
| HitModifier | Byte | Hit chance bonus |

### 0x0A — WorldMessage
**Encryption:** Static Key

| Field | Type | Description |
|-------|------|-------------|
| MessageType | Byte | See WorldMessageType enum |
| Message | String16 | Message text content |

### 0x0B — WalkResponse
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Direction | Byte | Direction walked |
| PreviousX | UInt16 | Previous X position |
| PreviousY | UInt16 | Previous Y position |
| UnknownX | UInt16 | Unknown |
| UnknownY | UInt16 | Unknown |
| Unknown | Byte | Unknown |

### 0x0C — EntityWalk
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| EntityId | UInt32 | Entity that moved |
| OriginX | UInt16 | Previous X position |
| OriginY | UInt16 | Previous Y position |
| Direction | Byte | Movement direction |
| Unknown | Byte | Unknown |

### 0x0D — PublicMessage
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| MessageType | Byte | See PublicMessageType enum |
| SenderId | UInt32 | Speaker entity ID |
| Message | String8 | Chat message text |

### 0x0E — RemoveEntity
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| EntityId | UInt32 | Entity serial to remove from view |

### 0x0F — AddItem
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Slot | Byte | Inventory slot (1-based) |
| Sprite | UInt16 | Item sprite |
| Color | Byte | Dye color |
| Name | String8 | Item name |
| Quantity | UInt32 | Stack count |
| IsStackable | Bool | Whether item stacks |
| MaxDurability | UInt32 | Maximum durability |
| Durability | UInt32 | Current durability |

### 0x10 — RemoveItem
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Slot | Byte | Inventory slot cleared |

### 0x11 — EntityTurn
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| EntityId | UInt32 | Entity serial |
| Direction | Byte | New facing direction |

### 0x13 — HealthBar
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| EntityId | UInt32 | Target entity |
| Unknown | Byte | Unknown |
| Percent | Byte | Health percentage (0-100) |
| Sound | Byte | Hit sound effect ID |

### 0x15 — MapInfo
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| MapId | UInt16 | Map identifier |
| WidthLo | Byte | Width low byte |
| HeightLo | Byte | Height low byte |
| Flags | Byte | See MapFlags |
| WidthHi | Byte | Width high byte |
| HeightHi | Byte | Height high byte |
| Checksum | UInt16 | Map data checksum |
| Name | String8 | Map display name |

**Full width** = `(WidthHi << 8) | WidthLo`
**Full height** = `(HeightHi << 8) | HeightLo`

### 0x17 — AddSpell
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Slot | Byte | Spell book slot |
| Icon | UInt16 | Spell icon sprite |
| TargetType | Byte | See SpellTargetType enum |
| Name | String8 | Spell name |
| Prompt | String8 | Prompt text (for text-input spells) |
| CastLines | Byte | Number of chant lines |

### 0x18 — RemoveSpell
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Slot | Byte | Spell book slot to clear |

### 0x19 — PlaySound
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Sound | Byte | Sound effect ID |

If Sound == 0xFF (music track):
| Field | Type | Description |
|-------|------|-------------|
| Track | Byte | Music track ID |
| Unknown | UInt16 | Unknown |

### 0x1A — AnimateEntity
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| EntityId | UInt32 | Entity to animate |
| Animation | Byte | Animation ID (see BodyAnimation) |
| Duration | UInt16 | Animation duration in ms |
| Sound | Byte | Accompanying sound effect |

### 0x1B — ShowNotepad
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Slot | Byte | Notepad slot |
| Style | Byte | See NotepadStyle enum |
| Height | Byte | Display height |
| Width | Byte | Display width |
| Content | String16 | Notepad text content |

### 0x1E — ChangeDay
**Encryption:** Hash Key

Day/night cycle progression. Body format TBD.

### 0x1F — MapChanged
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Result | UInt16 | Map change result code |

### 0x20 — LightLevel
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| TimeOfDay | Byte | Current time of day value |
| Lighting | Byte | Ambient light level |

### 0x22 — RefreshComplete
**Encryption:** Hash Key

No body fields. Signals that a refresh cycle is complete.

### 0x29 — ShowEffect
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| TargetId | UInt32 | Target entity (or 0 for tile-targeted) |

**If TargetId == 0 (tile-targeted effect):**
| Field | Type | Description |
|-------|------|-------------|
| TargetAnimation | UInt16 | Animation sprite ID |
| AnimationDuration | UInt16 | Duration in ms |
| TargetX | UInt16 | Tile X |
| TargetY | UInt16 | Tile Y |

**If TargetId != 0 (entity-targeted effect):**
| Field | Type | Description |
|-------|------|-------------|
| SourceId | UInt32 | Source entity (caster) |
| TargetAnimation | UInt16 | Effect on target |
| SourceAnimation | UInt16 | Effect on source |
| AnimationDuration | UInt16 | Duration in ms |

### 0x2C — AddSkill
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Slot | Byte | Skill book slot |
| Icon | UInt16 | Skill icon sprite |
| Name | String8 | Skill name |

### 0x2D — RemoveSkill
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Slot | Byte | Skill book slot to clear |

### 0x2E — WorldMap
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| FieldName | String8 | World map field name |
| NodeCount | Byte | Number of map nodes |
| FieldIndex | Byte | Field index |

For each node:
| Field | Type | Description |
|-------|------|-------------|
| ScreenX | UInt16 | Screen X position |
| ScreenY | UInt16 | Screen Y position |
| Name | String8 | Location name |
| Checksum | UInt16 | Map checksum |
| MapId | UInt16 | Destination map ID |
| MapX | UInt16 | Destination X |
| MapY | UInt16 | Destination Y |

### 0x2F — ShowDialogMenu
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| MenuType | Byte | See DialogMenuType enum |
| EntityType | Byte | EntityTypeFlags |
| EntityId | UInt32 | NPC entity serial |
| Unknown1 | Byte | Unknown |
| SpritePrimary | UInt16 | Primary display sprite |
| Color | Byte | Sprite color |
| Unknown2 | Byte | Unknown |
| SpriteSecondary | UInt16 | Secondary sprite |
| ColorSecondary | Byte | Secondary color |
| ShowGraphic | Bool | Show graphic (inverted: 0=show, 1=hide) |
| Name | String8 | NPC name |
| Content | String16 | Dialog text |

Menu items follow based on MenuType (0=Menu, 2=TextInput, 4=ItemChoices, etc.).

### 0x30 — ShowDialog
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| DialogType | Byte | See DialogType enum |

**If DialogType == CloseDialog (0xFF):**
No additional fields.

**For all other DialogTypes:**
| Field | Type | Description |
|-------|------|-------------|
| EntityType | Byte | EntityTypeFlags |
| EntityId | UInt32 | NPC entity serial |
| Unknown1 | Byte | Unknown |
| SpritePrimary | UInt16 | Primary sprite |
| Color | Byte | Sprite color |
| Unknown2 | Byte | Unknown |
| SpriteSecondary | UInt16 | Secondary sprite |
| ColorSecondary | Byte | Secondary color |
| PursuitId | UInt16 | Pursuit/quest ID |
| StepId | UInt16 | Dialog step number |
| HasPreviousButton | Bool | Show "Previous" button |
| HasNextButton | Bool | Show "Next" button |
| ShowGraphic | Bool | Show NPC graphic (inverted) |
| Name | String8 | NPC name |
| Content | String16 | Dialog text content |

Additional fields for Menu/TextInput dialog types include menu option lists.

### 0x31 — BoardResult
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| ResultType | Byte | See MessageBoardResult enum |

Complex conditional structure based on ResultType — includes board listings, post content, mail messages, etc.

### 0x32 — MapDoor
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| DoorCount | Byte | Number of doors |

For each door:
| Field | Type | Description |
|-------|------|-------------|
| X | Byte | Tile X |
| Y | Byte | Tile Y |
| State | Byte | See DoorState enum |
| Direction | Byte | See DoorDirection enum |

### 0x33 — ShowUser
**Encryption:** Hash Key

Large packet showing a player character's full appearance:

| Field | Type | Description |
|-------|------|-------------|
| X | UInt16 | Tile X |
| Y | UInt16 | Tile Y |
| Direction | Byte | Facing direction |
| EntityId | UInt32 | Player entity serial |
| HeadSprite | UInt16 | Head/hair sprite |
| *...body/equipment/color fields...* | ... | Extensive character appearance data |
| Name | String8 | Character name |

Contains body sprite, armor sprite, armor color, shield sprite, weapon sprite, boots sprite, boots color, head accessory, overcoat, overhelm, face, lantern size, rest position, and more.

### 0x34 — UserProfile
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| EntityId | UInt32 | Player entity serial |
| Equipment | 18x items | 18 equipment entries in slot order |
| Status | Byte | Social status |
| Name | String8 | Character name |
| Nation | Byte | See NationFlag enum |
| Title | String8 | Player title |
| IsGroupOpen | Bool | Group status |
| GuildRank | String8 | Guild rank text |
| DisplayClass | String8 | Displayed class name |
| Guild | String8 | Guild name |
| LegendMarkCount | Byte | Number of legend marks |

For each legend mark:
| Field | Type | Description |
|-------|------|-------------|
| Icon | Byte | See LegendMarkIcon enum |
| Color | Byte | See LegendMarkColor enum |
| Key | String8 | Legend mark key |
| Text | String8 | Legend mark description |

Followed by portrait section with length-prefixed portrait data.

### 0x36 — WorldList
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| WorldCount | UInt16 | Total online count |
| CountryCount | UInt16 | Number of entries |

For each entry:
| Field | Type | Description |
|-------|------|-------------|
| ClassWithFlags | Byte | Lower 3 bits = class, upper 5 bits = flags |
| Color | Byte | Name color |
| Status | Byte | Social status |
| Title | String8 | Player title (byte length prefix, but read as fixed) |
| IsMaster | Bool | Master status |
| Name | String8 | Player name |

### 0x37 — SetEquipment
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Slot | Byte | Equipment slot (see EquipmentSlot) |
| Sprite | UInt16 | Item sprite |
| Color | Byte | Dye color |
| Name | String8 | Item name |
| Skip | 1 byte | Padding |
| MaxDurability | UInt32 | Maximum durability |
| Durability | UInt32 | Current durability |

### 0x38 — RemoveEquipment
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Slot | Byte | Equipment slot to clear |

### 0x39 — SelfProfile
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Nation | Byte | NationFlag |
| GuildRank | String8 | Guild rank |
| Title | String8 | Title text |
| GroupMembers | String8 | Group member list (newline-separated) |
| IsGroupOpen | Bool | Group open status |
| IsRecruiting | Bool | Recruiting status |

If IsRecruiting, GroupBox fields follow (leader name, level restrictions, etc.).

| Field | Type | Description |
|-------|------|-------------|
| Class | Byte | Character class |
| ShowAbilityMetadata | Bool | Show ability metadata |
| ShowMasterMetadata | Bool | Show master metadata |
| DisplayClass | String8 | Displayed class name |
| Guild | String8 | Guild name |
| LegendMarkCount | Byte | Number of legend marks |

For each legend mark: `Icon:Byte`, `Color:Byte`, `Key:String8`, `Text:String8`

### 0x3A — StatusEffect
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Icon | UInt16 | Status effect icon |
| Duration | Byte | See StatusEffectDuration enum |

### 0x3B — Heartbeat
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Request | UInt16 | Value to echo back in client 0x45 |

### 0x3C — MapTransfer
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| RowY | UInt16 | Map row Y index |
| Data | ReadToEnd | Raw map tile data for this row |

### 0x3E — SwitchPane
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Pane | Byte | See InterfacePane enum |

### 0x3F — Cooldown
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| AbilityType | Byte | 0=Spell, 1=Skill |
| Slot | Byte | Ability slot |
| Seconds | UInt32 | Cooldown duration in seconds |

### 0x42 — Exchange
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Event | Byte | See ExchangeServerEventType enum |

**Started (0):**
| Field | Type | Description |
|-------|------|-------------|
| TargetId | UInt32 | Trade partner entity ID |
| TargetName | String8 | Trade partner name |

**QuantityPrompt (1):**
| Field | Type | Description |
|-------|------|-------------|
| Slot | Byte | Item slot requesting quantity |

**ItemAdded (2):**
| Field | Type | Description |
|-------|------|-------------|
| Party | Byte | 0=You, 1=Them |
| ItemIndex | Byte | Index in trade window |
| ItemSprite | UInt16 | Item sprite |
| ItemColor | Byte | Item dye color |
| ItemName | String8 | Item name |

**GoldAdded (3):**
| Field | Type | Description |
|-------|------|-------------|
| Party | Byte | 0=You, 1=Them |
| GoldAmount | UInt32 | Gold amount |

**Cancelled (4) / Accepted (5):**
| Field | Type | Description |
|-------|------|-------------|
| Party | Byte | Which party cancelled/accepted |
| Message | String8 | Status message |

### 0x48 — CancelCast
**Encryption:** None

No body fields. Cancels current spell cast.

### 0x49 — RequestUserPortrait
**Encryption:** Hash Key

No body fields. Server requests the client to send their portrait.

### 0x4B — ForcePacket
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Length | UInt16 | Forced packet data length |
| ClientCommand | Byte | Client opcode to force-send |
| Data | Bytes | Forced packet body |

Forces the client to send a specific packet to the server.

### 0x4C — ExitResponse
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Result | Byte | Exit result code |
| Unknown | UInt16 | Unknown |

### 0x50 — Manufacture
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| ManufactureId | UInt16 | Crafting station ID |
| MessageType | Byte | Response type |

Conditional fields include recipe count, recipe details (index, sprite, name, description, ingredients).

### 0x51 — ShowSpinner
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| IsVisible | Bool | Show/hide loading spinner (inverted: 0=show) |

### 0x52 — UserIdResponse
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| UserId | UInt32 | User ID |
| Nonce | Byte | Echoed nonce from request |

### 0x56 — ServerTable
**Encryption:** Static Key

| Field | Type | Description |
|-------|------|-------------|
| ContentLength | UInt16 | Compressed data length |
| CompressedData | Bytes | Zlib-compressed server list |

**Decompressed format:**
| Field | Type | Description |
|-------|------|-------------|
| ServerCount | Byte | Number of servers |

For each server:
| Field | Type | Description |
|-------|------|-------------|
| ServerId | Byte | Server identifier |
| ServerAddress | IPv4 | Server IP |
| ServerPort | UInt16 | Server port |
| ServerName | NullString | Server display name |

### 0x58 — MapTransferComplete
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Result | Byte | Transfer result code |

### 0x60 — LoginNotice
**Encryption:** Static Key

| Field | Type | Description |
|-------|------|-------------|
| HasContent | Bool | Whether notice content follows |

**If HasContent == true:**
| Field | Type | Description |
|-------|------|-------------|
| ContentLength | UInt16 | Compressed content length |
| CompressedData | Bytes | Zlib-compressed UTF-8 notice text |

**If HasContent == false:**
| Field | Type | Description |
|-------|------|-------------|
| Checksum | UInt32 | Notice checksum (for caching) |

### 0x63 — Group
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| Action | Byte | See ServerGroupAction enum |

Conditional fields based on action — includes group member names, recruitment GroupBox data.

### 0x66 — ServerInfo
**Encryption:** Static Key

| Field | Type | Description |
|-------|------|-------------|
| DataType | Byte | See ServerInfoType enum |
| Value | String8 | Info value (e.g., homepage URL) |

### 0x67 — MapChanging
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| ChangeType | Byte | Type of map change |
| Unknown | UInt32 | Unknown |

### 0x68 — SyncTicks
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| TickCount | UInt32 | Server tick count |

### 0x6B — ShowMapHelp
**Encryption:** Hash Key

| Field | Type | Description |
|-------|------|-------------|
| MapIndex | Byte | Map help page index |

### 0x6F — Metadata
**Encryption:** Static Key

| Field | Type | Description |
|-------|------|-------------|
| ResponseType | Byte | 0=Metadata, 1=Listing |

**If Metadata (0):**
| Field | Type | Description |
|-------|------|-------------|
| Name | String8 | Metadata name |
| Checksum | UInt32 | Data checksum |
| ContentSize | UInt16 | Content byte count |
| Data | Bytes | Raw metadata content |

**If Listing (1):**
| Field | Type | Description |
|-------|------|-------------|
| MetadataCount | UInt16 | Number of metadata entries |

For each entry:
| Field | Type | Description |
|-------|------|-------------|
| Name | String8 | Metadata name |
| Checksum | UInt32 | Checksum |

### 0x7E — Hello
**Encryption:** None

| Field | Type | Description |
|-------|------|-------------|
| Skip | 1 byte | Padding |
| Message | Line | Welcome/greeting text (newline-terminated) |

### 0xFF — Unknown
Reserved / unknown server command.

---

## 8. Game Feature Packet Flows

### 8.1 Walking & Turning

```
Client → 0x06 Walk [Direction:1] [StepCount:1]
Server → 0x0B WalkResponse [Direction:1] [PrevX:2] [PrevY:2] [UnkX:2] [UnkY:2] [Unk:1]
```

Other players see:
```
Server → 0x0C EntityWalk [EntityId:4] [OriginX:2] [OriginY:2] [Direction:1] [Unk:1]
```

Turning only:
```
Client → 0x11 Turn [Direction:1]
Server → 0x11 EntityTurn [EntityId:4] [Direction:1]
```

Position correction (server authority):
```
Server → 0x04 MapLocation [X:2] [Y:2] [UnkX:2] [UnkY:2]
```

### 8.2 Combat

**Basic Attack (Assail):**
```
Client → 0x13 Assail (no body)
Server → 0x1A AnimateEntity [EntityId:4] [Animation:1] [Duration:2] [Sound:1]
Server → 0x13 HealthBar [EntityId:4] [Unk:1] [Percent:1] [Sound:1]
```

**Spell Casting:**
```
Client → 0x4D BeginSpellCast [LineCount:1]
Client → 0x4E SpellChant [Content:String8]     (repeat per line)
Client → 0x0F CastSpell [Slot:1] [Target...]
Server → 0x29 ShowEffect [TargetId:4] [SourceId:4] [TargetAnim:2] [SourceAnim:2] [Duration:2]
Server → 0x3F Cooldown [AbilityType:1] [Slot:1] [Seconds:4]
```

**Skill Usage:**
```
Client → 0x3E UseSkill [Slot:1]
Server → 0x1A AnimateEntity [...]
Server → 0x3F Cooldown [...]
```

### 8.3 Chat

**Public Say/Shout/Chant:**
```
Client → 0x0E Say [Type:1] [Content:String8]
Server → 0x0D PublicMessage [Type:1] [SenderId:4] [Message:String8]    (to nearby players)
```

**Whisper:**
```
Client → 0x19 Whisper [TargetName:String8] [Content:String8]
Server → 0x0A WorldMessage [Type:0(Whisper)] [Message:String16]        (to recipient)
```

**System Messages:**
```
Server → 0x0A WorldMessage [Type:1-18] [Message:String16]
```

### 8.4 NPC Dialog Interaction

```
Client → 0x43 Interact [Type:1(Entity)] [TargetId:4]
Server → 0x2F ShowDialogMenu [...menu data...]
  or
Server → 0x30 ShowDialog [...dialog data...]
Client → 0x39 DialogMenuChoice [EntityType:1] [EntityId:4] [PursuitId:2] [Slot:1] [Args...]
  or
Client → 0x3A DialogChoice [EntityType:1] [EntityId:4] [PursuitId:2] [StepId:2] [ArgsType:1] [Choice...]
Server → 0x30 ShowDialog [...]   (next dialog step)
  ...repeat until...
Server → 0x30 ShowDialog [Type:0xFF(CloseDialog)]
```

### 8.5 Trading / Exchange

**Full trade sequence:**
```
1. Client → 0x4A ExchangeAction [Action:0(Begin)] [TargetId:4]
2. Server → 0x42 Exchange [Event:0(Started)] [TargetId:4] [TargetName:String8]   (to both)
3. Client → 0x4A ExchangeAction [Action:1(AddItem)] [Slot:1]
   Server → 0x42 Exchange [Event:2(ItemAdded)] [Party:0] [Index:1] [Sprite:2] [Color:1] [Name:String8]
   (Other player sees Event:2 with Party:1)
4. Client → 0x4A ExchangeAction [Action:3(SetGold)] [Amount:4]
   Server → 0x42 Exchange [Event:3(GoldAdded)] [Party:0] [Amount:4]
5. Client → 0x4A ExchangeAction [Action:5(Accept)]
   Server → 0x42 Exchange [Event:5(Accepted)] [Party:0] [Message:String8]
6. (Both accept) → Items/gold transferred, inventory updates follow
```

**Cancel:**
```
Client → 0x4A ExchangeAction [Action:4(Cancel)]
Server → 0x42 Exchange [Event:4(Cancelled)] [Party:0] [Message:String8]
```

### 8.6 Inventory Management

**Pick Up Item:**
```
Client → 0x07 PickupItem [Slot:1] [X:2] [Y:2]
Server → 0x0F AddItem [Slot:1] [Sprite:2] [Color:1] [Name:String8] [Qty:4] [Stackable:1] [MaxDur:4] [Dur:4]
```

**Drop Item:**
```
Client → 0x08 DropItem [Slot:1] [X:2] [Y:2] [Qty:4]
Server → 0x10 RemoveItem [Slot:1]
```

**Use/Eat Item:**
```
Client → 0x1C UseItem [Slot:1]
Client → 0x1A EatItem [Slot:1]
```

**Equip/Unequip:**
```
(Equipping is automatic via UseItem)
Server → 0x37 SetEquipment [Slot:1] [Sprite:2] [Color:1] [Name:String8] [Skip:1] [MaxDur:4] [Dur:4]
Client → 0x44 UnequipItem [Slot:1]
Server → 0x38 RemoveEquipment [Slot:1]
```

**Swap Slots:**
```
Client → 0x30 SwapSlot [Pane:1] [Source:1] [Target:1]
```

### 8.7 Map Transitions

```
Server → 0x67 MapChanging [ChangeType:1] [Unk:4]
Server → 0x15 MapInfo [MapId:2] [WidthLo:1] [HeightLo:1] [Flags:1] [WidthHi:1] [HeightHi:1] [Checksum:2] [Name:String8]
Server → 0x3C MapTransfer [RowY:2] [TileData...]    (repeated per row)
Server → 0x58 MapTransferComplete [Result:1]
Server → 0x1F MapChanged [Result:2]
```

### 8.8 Groups

**Invite:**
```
Client → 0x2E GroupInvite [Action:0(Invite)] [Name:String8]
Server → 0x63 Group [Action:0(Ask)] [Name:String8]     (to target)
```

**Accept:**
```
Client → 0x2E GroupInvite [Action:2(Accept)] [Name:String8]
Server → 0x63 Group [Action:1(Members)] [MemberList:String8]   (to all members)
```

### 8.9 Keepalive / Ping-Pong

**Heartbeat (PingA):**
```
Server → 0x3B Heartbeat [Request:2]
Client → 0x45 Heartbeat [Reply:2]     (echo the value back)
```

**Tick Sync (PingB):**
```
Server → 0x68 SyncTicks [ServerTick:4]
Client → 0x75 SyncTicks [ServerTick:4] [ClientTick:4]
```

### 8.10 Stats & Status Effects

**Stats Update (server pushes):**
```
Server → 0x08 UpdateStats [Flags:1] [conditional fields based on flags...]
```

The Flags byte is a bitmask (StatsFieldFlags) that determines which stat blocks are included. Common combinations:
- `0x3C` (Full) = Stats + Vitals + ExperienceGold + Modifiers
- `0x10` (Vitals only) = Just HP/MP update
- `0x08` (XP/Gold only) = After gaining experience or spending gold

**Status Effect Icon:**
```
Server → 0x3A StatusEffect [Icon:2] [Duration:1]
```

### 8.11 Entity Lifecycle

**Entity appears:**
```
Server → 0x07 AddEntity [Count:2] [entities...]
```

**Entity disappears:**
```
Server → 0x0E RemoveEntity [EntityId:4]
```

**Player appears (full appearance):**
```
Server → 0x33 ShowUser [X:2] [Y:2] [Dir:1] [Id:4] [HeadSprite:2] [...appearance...]  [Name:String8]
```

### 8.12 Board / Mail System

**View board:**
```
Client → 0x3B BoardAction [Action:1(ViewBoard)] [BoardId:2] [StartPostId:2] [Unk:1]
Server → 0x31 BoardResult [Type:1(Board)] [board data...]
```

**Read post:**
```
Client → 0x3B BoardAction [Action:2(ViewPost)] [BoardId:2] [PostId:2] [Nav:1]
Server → 0x31 BoardResult [Type:2(Post)] [post data...]
```

**Send mail:**
```
Client → 0x3B BoardAction [Action:5(SendMail)] [BoardId:2] [Recipient:String8] [Subject:String8] [Body:String16]
Server → 0x31 BoardResult [Type:5(PostSubmitted)] [result...]
```

### 8.13 Spell/Skill Learning

```
Server → 0x17 AddSpell [Slot:1] [Icon:2] [TargetType:1] [Name:String8] [Prompt:String8] [CastLines:1]
Server → 0x18 RemoveSpell [Slot:1]
Server → 0x2C AddSkill [Slot:1] [Icon:2] [Name:String8]
Server → 0x2D RemoveSkill [Slot:1]
```

---

## 9. Implementation Notes

### String Encoding
All strings on the wire use **Windows-1252** encoding. In Node.js:
```javascript
const iconv = require('iconv-lite');
const encoded = iconv.encode(text, 'win1252');
const decoded = iconv.decode(buffer, 'win1252');
```

### Byte Order
All multi-byte integers are **big-endian** (network byte order).

### Sequence Counter
The encryption sequence counter is a single `Byte` (0-255) that wraps around. It increments with each encrypted packet sent.

### Map Data
Map tile data is loaded from local `.map` files, not streamed entirely via packets. The server sends map info (0x15) with a checksum — if the client already has matching map data cached, it uses the local copy. Map transfer (0x3C) sends row-by-row tile data only when needed.

### Client Version
Current known working version: **741**. Sent in the Version packet (0x00) during handshake.

### Server Addresses
| Server | Address | Port |
|--------|---------|------|
| Login | 52.88.55.94 | 2610 |
| Temuair | 52.88.55.94 | 2611 |
| Medenia | 52.88.55.94 | 2612 |

### Sprite Flags
When reading a sprite `UInt16` from AddEntity packets:
- Bit 15 set (0x8000) → **Item** on ground
- Bit 14 set (0x4000) → **Creature** (NPC/monster)
- Neither set → **Player** (Aisling)
- Actual sprite index = `value & 0x3FFF`

### Reconnect Strategy
Recommended exponential backoff: **5s → 10s → 20s → 30s** (cap at 30s).

### Packet Buffer Size
Recommended receive buffer: **65535 bytes** (max packet body size).
Recommended queue buffer: **4096 bytes** initial, grow dynamically.

---

*Generated from Arbiter 1.8.1 source code analysis. Cross-referenced with da.js working implementation.*
