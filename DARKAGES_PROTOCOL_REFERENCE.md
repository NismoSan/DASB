# Dark Ages Protocol Reference

> Derived from Arbiter-1.8.1 source code. This document is the authoritative reference for the Dark Ages MMORPG network protocol, covering every packet, enum, data structure, and game system.

---

## Table of Contents

1. [Packet Format](#1-packet-format)
2. [Data Types](#2-data-types)
3. [Encryption](#3-encryption)
4. [Protocol Flow](#4-protocol-flow)
5. [Client-to-Server Opcodes](#5-client-to-server-opcodes)
6. [Server-to-Client Opcodes](#6-server-to-client-opcodes)
7. [Enums Reference](#7-enums-reference)
8. [Composite Data Structures](#8-composite-data-structures)
9. [Game System Constants](#9-game-system-constants)

---

## 1. Packet Format

Every packet on the wire follows this structure:

```
[0xAA] [Size Hi] [Size Lo] [Command] [Data...]
```

| Field | Size | Description |
|-------|------|-------------|
| Marker | 1 byte | Always `0xAA` |
| Size | 2 bytes (big-endian) | Length of Data + 1 (includes the Command byte) |
| Command | 1 byte | Opcode identifying the packet type |
| Data | variable | Payload bytes, structure depends on Command |

- **Header size**: 4 bytes total (marker + 2 size bytes + command)
- **Byte order**: All multi-byte integers are **big-endian** unless noted
- Minimum packet size: 4 bytes (header only, no data)

---

## 2. Data Types

All payload fields use these serialization types:

| Type | Size | Description |
|------|------|-------------|
| `byte` | 1 | Unsigned 8-bit integer (0-255) |
| `sbyte` | 1 | Signed 8-bit integer (-128 to 127) |
| `bool` | 1 | `0x00` = false, any non-zero = true |
| `uint16` | 2 | Unsigned 16-bit big-endian |
| `int16` | 2 | Signed 16-bit big-endian |
| `uint32` | 4 | Unsigned 32-bit big-endian |
| `int32` | 4 | Signed 32-bit big-endian |
| `uint64` | 8 | Unsigned 64-bit big-endian |
| `int64` | 8 | Signed 64-bit big-endian |
| `String8` | 1 + N | 1-byte length prefix + N ASCII bytes (max 255) |
| `String16` | 2 + N | 2-byte length prefix + N ASCII bytes (max 65535) |
| `NullTerminatedString` | N + 1 | ASCII bytes + `0x00` terminator |
| `Line` | N + 1 | ASCII bytes + `0x0A` (newline) terminator |
| `IPv4Address` | 4 | 4 bytes read in **reverse** order (D.C.B.A) |

---

## 3. Encryption

### 3.1 Constants

| Constant | Value |
|----------|-------|
| Default private key | `"UrkcnItnI"` (9 bytes: `0x55 0x72 0x6B 0x63 0x6E 0x49 0x74 0x6E 0x49`) |
| Key length | 9 |
| Key table size | 1024 bytes |
| Salt table size | 256 bytes |
| Salt table count | 4 (seeds 0-3) |

### 3.2 Salt Tables

Four predefined 256-byte salt tables exist, selected by seed (0-3):

- **Seed 0**: Identity (0x00, 0x01, 0x02, ..., 0xFF)
- **Seed 1**: Interleaved from center (0x80, 0x7F, 0x81, 0x7E, ...)
- **Seed 2**: Reverse (0xFF, 0xFE, 0xFD, ..., 0x00)
- **Seed 3**: Interleaved from center reversed

### 3.3 Key Table Generation

Generated per-character from the character name:

```
1. hash = MD5(name) as hex string
2. hash = MD5(hash) as hex string
3. table = hash
4. Repeat 31 times:
     hash = MD5(table)
     table = table + hash
5. Key table = ASCII bytes of table (1024 bytes)
```

### 3.4 Hash Key Generation

Per-packet key derived from bRand, sRand, and the key table:

```
for i in 0..8:
    index = (i * (9 * i + sRand * sRand) + bRand) % 1024
    key[i] = keyTable[index]
```

### 3.5 Client Packet Encryption

**Unencrypted opcodes** (sent plaintext): `0x00`, `0x10`, `0x48`

**Static key opcodes** (use default private key): `0x02`, `0x03`, `0x04`, `0x0B`, `0x26`, `0x2D`, `0x3A`, `0x42`, `0x43`, `0x4B`, `0x57`, `0x62`, `0x68`, `0x71`, `0x73`, `0x7B`

**Hash key opcodes**: All other encrypted commands (use per-packet generated key)

**Dialog opcodes** (additional sub-encryption): `0x39`, `0x3A`

#### Encrypted Client Packet Layout

```
[Sequence:1] [Dialog Header:6?] [Payload:N] [0x00] [Command:1?] [Checksum:4] [bRand Lo:1] [sRand:1] [bRand Hi:1]
```

- Sequence: 1 byte, used in decryption XOR
- Dialog Header (only for opcodes 0x39/0x3A): 6 bytes `[xPrime] [x] [Length:2] [CRC16:2]`
- Command byte is duplicated after payload **only** for hash-key packets
- Checksum: MD5 of entire buffer, bytes at indices [13], [3], [11], [7]

#### bRand/sRand Encoding (Client)

```
buffer[-3] = (bRand & 0xFF) ^ 0x70
buffer[-2] = sRand ^ 0x23
buffer[-1] = ((bRand >> 8) & 0xFF) ^ 0x74
```

Decoding: `sRand = buffer[-2] ^ 0x23`, `bRand = (buffer[-1] << 8 | buffer[-3]) ^ 0x7470`

#### Dialog Sub-Encryption (Client, opcodes 0x39/0x3A)

After standard decryption, the first 6 bytes of the payload are a dialog header:

```
xPrime = decrypted[0] - 0x2D
x = decrypted[1] ^ xPrime
y = x + 0x72
z = x + 0x28

// Decrypt length field
decrypted[2] ^= y
decrypted[3] ^= (y + 1) & 0xFF
length = (decrypted[2] << 8) | decrypted[3]

// Decrypt CRC16 + payload
for i in 0..length:
    decrypted[4 + i] ^= (z + i) & 0xFF

// Discard 6-byte header; remaining = actual payload
```

### 3.6 Server Packet Encryption

**Unencrypted opcodes**: `0x00`, `0x03`, `0x40`, `0x7E`

**Static key opcodes**: `0x01`, `0x02`, `0x0A`, `0x56`, `0x60`, `0x62`, `0x66`, `0x6F`

**Hash key opcodes**: All other encrypted commands

#### Encrypted Server Packet Layout

```
[Sequence:1] [Payload:N] [bRand Lo:1] [sRand:1] [bRand Hi:1]
```

#### bRand/sRand Encoding (Server)

```
buffer[-3] = (bRand & 0xFF) ^ 0x74
buffer[-2] = sRand ^ 0x24
buffer[-1] = ((bRand >> 8) & 0xFF) ^ 0x64
```

Decoding: `sRand = buffer[-2] ^ 0x24`, `bRand = (buffer[-1] << 8 | buffer[-3]) ^ 0x6474`

### 3.7 XOR Decryption Algorithm (Both Client and Server)

```pseudocode
for i in 0..payloadLength:
    data[i] ^= privateKey[i % 9]
    data[i] ^= saltTable[i / 9 % 256]
    if (i / 9 % 256) != sequence:
        data[i] ^= saltTable[sequence]
```

Where:
- `privateKey` = static default key OR generated hash key (9 bytes)
- `saltTable` = 256-byte table selected by seed
- `sequence` = first byte of encrypted data

---

## 4. Protocol Flow

### 4.1 Login Server Connection

```
Client                          Login Server
  |                                  |
  |<---- 0x7E Hello (welcome msg) ---|
  |---- 0x00 Version (ver+crc) ---->|
  |<---- 0x00 ServerList (key) -----|
  |---- 0x57 RequestServerTable --->|
  |<---- 0x56 ServerTable ----------|
  |---- 0x4B RequestLoginNotice --->|
  |<---- 0x60 LoginNotice ----------|
  |                                  |
  | [Character Creation OR Login]    |
  |---- 0x02 CreateCharacterName -->|  (if new character)
  |---- 0x04 CreateCharAppearance ->|  (if new character)
  |---- 0x03 Login (name+pass) ---->|  (if existing)
  |<---- 0x02 LoginResult ----------|
  |<---- 0x03 Redirect (to world) --|
```

### 4.2 World Server Connection

```
Client                          World Server
  |                                  |
  |<---- 0x7E Hello ----------------|
  |---- 0x10 Authenticate --------->|
  |<---- 0x05 UserId ---------------|
  |<---- 0x15 MapInfo ---------------|
  |<---- 0x04 MapLocation ----------|
  |<---- 0x67 MapChanging ----------|
  |<---- 0x3C MapTransfer (rows) ---|  (repeated per row)
  |<---- 0x58 MapTransferComplete --|
  |<---- 0x07 AddEntity ------------|  (visible entities)
  |<---- 0x33 ShowUser -------------|  (player appearance)
  |<---- 0x08 UpdateStats ----------|  (player stats)
  |<---- 0x0F AddItem --------------|  (inventory items, repeated)
  |<---- 0x17 AddSpell -------------|  (spells, repeated)
  |<---- 0x2C AddSkill -------------|  (skills, repeated)
  |<---- 0x37 SetEquipment ---------|  (equipment, repeated)
  |<---- 0x22 RefreshComplete ------|
```

### 4.3 Gameplay Loop

```
Client                          World Server
  |                                  |
  |---- 0x06 Walk ----------------->|
  |<---- 0x0B WalkResponse ---------|
  |<---- 0x0C EntityWalk -----------|  (other players see you)
  |                                  |
  |---- 0x13 Assail --------------->|  (attack)
  |<---- 0x1A AnimateEntity --------|
  |<---- 0x13 HealthBar ------------|
  |                                  |
  |---- 0x0F CastSpell ------------>|
  |<---- 0x29 ShowEffect -----------|
  |<---- 0x3F Cooldown -------------|
  |                                  |
  |---- 0x45 Heartbeat ------------>|
  |<---- 0x3B Heartbeat ------------|
  |                                  |
  |---- 0x75 SyncTicks ------------>|
  |<---- 0x68 SyncTicks ------------|
```

### 4.4 Logout

```
Client                          World Server
  |---- 0x0B RequestExit ---------->|
  |<---- 0x4C ExitResponse ---------|
```

---

## 5. Client-to-Server Opcodes

### 5.1 Opcode Summary

| Opcode | Name | Description |
|--------|------|-------------|
| `0x00` | Version | Client version info |
| `0x02` | CreateCharacterName | Character creation - name/password/email |
| `0x03` | Login | Login with credentials |
| `0x04` | CreateCharacterAppearance | Character creation - appearance |
| `0x05` | RequestMapData | Request map tile data |
| `0x06` | Walk | Player movement |
| `0x07` | PickupItem | Pick up ground item |
| `0x08` | DropItem | Drop inventory item |
| `0x09` | LookAhead | Look in current direction |
| `0x0A` | LookTile | Look at specific tile |
| `0x0B` | RequestExit | Request logout |
| `0x0C` | RequestEntity | Request entity details |
| `0x0D` | IgnoreUser | Manage ignore list |
| `0x0E` | Say | Public chat message |
| `0x0F` | CastSpell | Cast a spell |
| `0x10` | Authenticate | Authenticate after redirect |
| `0x11` | Turn | Change facing direction |
| `0x13` | Assail | Physical melee attack |
| `0x18` | RequestWorldList | Request online player list |
| `0x19` | Whisper | Private message |
| `0x1A` | EatItem | Consume item |
| `0x1B` | ToggleSetting | Toggle UI option |
| `0x1C` | UseItem | Use inventory item |
| `0x1D` | Emote | Display emote animation |
| `0x23` | EditNotepad | Edit notepad content |
| `0x24` | DropGold | Drop gold on ground |
| `0x26` | ChangePassword | Change account password |
| `0x29` | GiveItem | Give item to another player |
| `0x2A` | GiveGold | Give gold to another player |
| `0x2D` | RequestProfile | Request own profile |
| `0x2E` | GroupInvite | Group/party invite and recruitment |
| `0x2F` | ToggleGroup | Toggle group membership |
| `0x30` | SwapSlot | Swap inventory/spell/skill slots |
| `0x38` | Refresh | Request full refresh |
| `0x39` | DialogMenuChoice | NPC dialog menu response |
| `0x3A` | DialogChoice | NPC dialog choice response |
| `0x3B` | BoardAction | Message board action |
| `0x3E` | UseSkill | Use a skill ability |
| `0x3F` | WorldMapClick | Click world map location |
| `0x41` | DismissParcel | Dismiss/delete mail parcel |
| `0x42` | Exception | Report client error |
| `0x43` | Interact | Interact with entity or tile |
| `0x44` | UnequipItem | Remove equipped item |
| `0x45` | Heartbeat | Keep-alive ping |
| `0x47` | RaiseStat | Spend stat point |
| `0x4A` | ExchangeAction | Trade/exchange action |
| `0x4B` | RequestLoginNotice | Get login notice/MOTD |
| `0x4D` | BeginSpellCast | Start casting animation |
| `0x4E` | SpellChant | Chant spell line |
| `0x4F` | UserPortrait | Send portrait data |
| `0x55` | Manufacture | Crafting action |
| `0x56` | RequestUserId | Request own user ID |
| `0x57` | RequestServerTable | Request server table |
| `0x62` | RequestSequence | Request packet sequence |
| `0x68` | RequestHomepage | Request homepage URL |
| `0x75` | SyncTicks | Synchronize game ticks |
| `0x79` | SetStatus | Set social status |
| `0x7B` | RequestMetadata | Request game metadata |
| `0xFF` | Unknown | Unknown/unhandled |

### 5.2 Detailed Packet Structures

#### 0x00 - Version
```
uint16  Version
uint16  Checksum          // 0x4C4B on client 7.41
```

#### 0x02 - CreateCharacterName
```
String8 Name
String8 Password
String8 Email
```

#### 0x03 - Login
```
String8 Name
String8 Password
byte    Key1              // random
byte    Key2              // random
uint32  ClientId          // XOR-encoded with Key1/Key2
uint16  Checksum          // XOR-encoded with Key1/Key2
```

**ClientId encoding**:
```
compoundKey = Key2 ^ ((Key1 + 0x3B) & 0xFF)
clientIdKey = (compoundKey + 0x8A) & 0xFF
mask = clientIdKey | (clientIdKey+1)<<8 | (clientIdKey+2)<<16 | (clientIdKey+3)<<24
EncodedClientId = ClientId ^ mask
```

**Checksum encoding**:
```
compoundKey = Key2 ^ ((Key1 + 0x3B) & 0xFF)
checksumKey = (compoundKey + 0x5E) & 0xFF
mask = checksumKey | (checksumKey+1)<<8
EncodedChecksum = Checksum ^ mask
```

#### 0x04 - CreateCharacterAppearance
```
byte    HairStyle
byte    Gender            // GenderFlags enum
byte    HairColor         // DyeColor enum
```

#### 0x05 - RequestMapData
```
(no payload)
```

#### 0x06 - Walk
```
byte    Direction         // WorldDirection enum
byte    StepCount
```

#### 0x07 - PickupItem
```
byte    Slot
uint16  X
uint16  Y
```

#### 0x08 - DropItem
```
byte    Slot
uint16  X
uint16  Y
uint32  Quantity
```

#### 0x09 - LookAhead
```
(no payload)
```

#### 0x0A - LookTile
```
uint16  X
uint16  Y
```

#### 0x0B - RequestExit
```
(no payload)
```

#### 0x0C - RequestEntity
```
uint32  EntityId
```

#### 0x0D - IgnoreUser
```
byte    Action            // IgnoreUserAction enum
String8 Name              // only if Action is AddUser or RemoveUser
```

#### 0x0E - Say
```
byte    MessageType       // PublicMessageType enum
String8 Content
```

#### 0x0F - CastSpell
```
byte    Slot
// Optional arguments (determined by remaining bytes):
//   If 8+ bytes remain:
uint32  TargetId
uint16  TargetX
uint16  TargetY
//   OR text input:
NullTerminatedString TextInput
//   OR numeric inputs:
uint16[] NumericInputs    // read until end of packet
```
Note: The same raw bytes are parsed as all three interpretations simultaneously. The server determines which to use based on the spell's SpellTargetType.

#### 0x10 - Authenticate
```
byte    Seed
byte    KeyLength
byte[]  PrivateKey        // KeyLength bytes
String8 Name
uint32  ConnectionId
```

#### 0x11 - Turn
```
byte    Direction         // WorldDirection enum
```

#### 0x13 - Assail
```
(no payload)
```

#### 0x18 - RequestWorldList
```
(no payload)
```

#### 0x19 - Whisper
```
String8 Target
String8 Content
```

#### 0x1A - EatItem
```
byte    Slot
```

#### 0x1B - ToggleSetting
```
byte    OptionIndex
```

#### 0x1C - UseItem
```
byte    Slot
```

#### 0x1D - Emote
```
byte    EmoteType         // Emote enum
```

#### 0x23 - EditNotepad
```
(content depends on notepad implementation)
```

#### 0x24 - DropGold
```
uint16  X
uint16  Y
uint32  Amount
```

#### 0x26 - ChangePassword
```
String8 OldPassword
String8 NewPassword
```

#### 0x29 - GiveItem
```
uint32  TargetId
byte    Slot
byte    Quantity
```

#### 0x2A - GiveGold
```
uint32  TargetId
uint32  Amount
```

#### 0x2D - RequestProfile
```
(no payload)
```

#### 0x2E - GroupInvite
```
byte    Action            // ClientGroupAction enum
String8 TargetName
// If Action == RecruitStart (4):
String8 GroupName
String8 GroupNote
byte    MinLevel
byte    MaxLevel
byte    MaxWarriors
byte    MaxWizards
byte    MaxRogues
byte    MaxPriests
byte    MaxMonks
```

#### 0x2F - ToggleGroup
```
(no payload)
```

#### 0x30 - SwapSlot
```
byte    Pane              // ClientSlotSwapType enum (0=Inventory, 1=Spells, 2=Skills)
byte    SourceSlot
byte    TargetSlot
```

#### 0x38 - Refresh
```
(no payload)
```

#### 0x39 - DialogMenuChoice
```
byte    EntityType        // EntityTypeFlags enum
uint32  EntityId
uint16  PursuitId
// If 1 byte remaining:
byte    Slot
// Else:
String8[] Arguments       // read String8s until end of packet
```

#### 0x3A - DialogChoice
```
byte    EntityType        // EntityTypeFlags enum
uint32  EntityId
uint16  PursuitId
uint16  StepId
// If more data:
byte    ArgsType          // DialogArgsType enum
// If ArgsType == MenuChoice (0x01):
byte    MenuChoice
// If ArgsType == TextInput (0x02):
String8[] TextInputs      // read String8s until end of packet
```

#### 0x3B - BoardAction
```
byte    Action            // MessageBoardAction enum
// Payload varies by Action:
```

| Action | Payload |
|--------|---------|
| ViewBoard (2) | `uint16 BoardId`, `int16 StartPostId`, `byte Unknown` |
| ViewPost (3) | `uint16 BoardId`, `int16 PostId`, `sbyte Navigation` |
| CreatePost (4) | `uint16 BoardId`, `String8 Subject`, `String16 Body` |
| DeletePost (5) | `uint16 BoardId`, `int16 PostId` |
| SendMail (6) | `uint16 BoardId`, `String8 Recipient`, `String8 Subject`, `String16 Body` |
| HighlightPost (7) | `uint16 BoardId`, `int16 PostId` |

#### 0x3E - UseSkill
```
byte    Slot
```

#### 0x3F - WorldMapClick
```
uint16  MapId
```

#### 0x41 - DismissParcel
```
(no payload)
```

#### 0x42 - Exception
```
String8 ExceptionText
```

#### 0x43 - Interact
```
byte    InteractionType   // InteractionType enum
// If Entity (1):
uint32  TargetId
// If Tile (3):
uint16  TargetX
uint16  TargetY
```

#### 0x44 - UnequipItem
```
byte    Slot              // EquipmentSlot enum
```

#### 0x45 - Heartbeat
```
uint16  Reply
```

#### 0x47 - RaiseStat
```
byte    Stat              // CharacterStatFlags enum value
```

#### 0x4A - ExchangeAction
```
byte    Action            // ExchangeClientActionType enum
uint32  TargetId
// If AddItem (1) or AddStackableItem (2):
byte    Slot
byte    Quantity          // only for AddStackableItem
// If SetGold (3):
uint32  GoldAmount
```

#### 0x4B - RequestLoginNotice
```
(no payload)
```

#### 0x4D - BeginSpellCast
```
byte    LineCount
```

#### 0x4E - SpellChant
```
byte    LineIndex
String8 ChantLine
```

#### 0x4F - UserPortrait
```
(portrait byte data)
```

#### 0x55 - Manufacture
```
uint16  ManufactureId
byte    MessageType       // ClientManufactureType enum
// If RequestRecipe (0x00):
byte    RecipeIndex
// If CraftRecipe (0x01):
String8 RecipeName
byte    0x00              // trailing zero
```

#### 0x56 - RequestUserId
```
(no payload)
```

#### 0x57 - RequestServerTable
```
(no payload)
```

#### 0x62 - RequestSequence
```
(no payload)
```

#### 0x68 - RequestHomepage
```
(no payload)
```

#### 0x75 - SyncTicks
```
uint32  ClientTicks
```

#### 0x79 - SetStatus
```
byte    Status            // SocialStatus enum
```

#### 0x7B - RequestMetadata
```
byte    RequestType       // MetadataRequestType enum
// If GetMetadata (0):
String8 Name
```

---

## 6. Server-to-Client Opcodes

### 6.1 Opcode Summary

| Opcode | Name | Description |
|--------|------|-------------|
| `0x00` | ServerList | Login server list with encryption key |
| `0x02` | LoginResult | Login success/failure |
| `0x03` | Redirect | Redirect to world server |
| `0x04` | MapLocation | Player position on map |
| `0x05` | UserId | Player ID and initial state |
| `0x07` | AddEntity | Add entities to viewport |
| `0x08` | UpdateStats | Update player stats |
| `0x0A` | WorldMessage | World/system message |
| `0x0B` | WalkResponse | Confirm player walk |
| `0x0C` | EntityWalk | Other entity moved |
| `0x0D` | PublicMessage | Public chat from entity |
| `0x0E` | RemoveEntity | Remove entity from view |
| `0x0F` | AddItem | Add item to inventory |
| `0x10` | RemoveItem | Remove item from inventory |
| `0x11` | EntityTurn | Other entity turned |
| `0x13` | HealthBar | Entity health indicator |
| `0x15` | MapInfo | Map metadata |
| `0x17` | AddSpell | Add spell to spellbook |
| `0x18` | RemoveSpell | Remove spell from spellbook |
| `0x19` | PlaySound | Play sound effect |
| `0x1A` | AnimateEntity | Play body animation |
| `0x1B` | ShowNotepad | Display notepad dialog |
| `0x1E` | ChangeDay | Day/night phase change |
| `0x1F` | MapChanged | Map change result |
| `0x20` | LightLevel | Ambient light level |
| `0x22` | RefreshComplete | Full refresh done |
| `0x29` | ShowEffect | Visual spell/skill effect |
| `0x2C` | AddSkill | Add skill to skillbook |
| `0x2D` | RemoveSkill | Remove skill from skillbook |
| `0x2E` | WorldMap | World map data |
| `0x2F` | ShowDialogMenu | NPC dialog with menu |
| `0x30` | ShowDialog | NPC dialog |
| `0x31` | BoardResult | Message board result |
| `0x32` | MapDoor | Door state updates |
| `0x33` | ShowUser | Player visual appearance |
| `0x34` | UserProfile | Other player's profile |
| `0x36` | WorldList | Online player list |
| `0x37` | SetEquipment | Equip item |
| `0x38` | RemoveEquipment | Unequip item |
| `0x39` | SelfProfile | Own character profile |
| `0x3A` | StatusEffect | Apply status effect icon |
| `0x3B` | Heartbeat | Keep-alive pong |
| `0x3C` | MapTransfer | Map tile row data |
| `0x3E` | SwitchPane | Switch UI pane |
| `0x3F` | Cooldown | Spell/skill cooldown |
| `0x42` | Exchange | Trade/exchange event |
| `0x48` | CancelCast | Cancel spell casting |
| `0x49` | RequestUserPortrait | Request portrait from client |
| `0x4B` | ForcePacket | Force client to process packet |
| `0x4C` | ExitResponse | Logout confirmation |
| `0x50` | Manufacture | Crafting result |
| `0x51` | ShowSpinner | Display progress spinner |
| `0x52` | UserIdResponse | User ID lookup result |
| `0x56` | ServerTable | Server table (compressed) |
| `0x58` | MapTransferComplete | Map transfer finished |
| `0x60` | LoginNotice | Login MOTD |
| `0x63` | Group | Group/party update |
| `0x66` | ServerInfo | Server info (homepage, etc) |
| `0x67` | MapChanging | Map change starting |
| `0x68` | SyncTicks | Server tick sync |
| `0x6B` | ShowMapHelp | Map help text |
| `0x6F` | Metadata | Game metadata |
| `0x7E` | Hello | Server welcome |
| `0xFF` | Unknown | Unknown/unhandled |

### 6.2 Detailed Packet Structures

#### 0x00 - ServerList
```
byte    Unknown           // always 0
uint32  Checksum
byte    Seed
byte    KeyLength
byte[]  PrivateKey        // KeyLength bytes
```

#### 0x02 - LoginResult
```
byte    Result            // LoginResult enum
String8 Message
```

#### 0x03 - Redirect
```
IPv4    Address           // 4 bytes, reversed
uint16  Port
byte    RemainingCount    // length of remaining data
byte    Seed
byte    KeyLength
byte[]  PrivateKey        // KeyLength bytes
String8 Name
uint32  ConnectionId
```

#### 0x04 - MapLocation
```
uint16  X
uint16  Y
uint16  UnknownX
uint16  UnknownY
```

#### 0x05 - UserId
```
uint32  UserId
byte    Direction         // WorldDirection enum
bool    HasGuild
byte    Class             // CharacterClass enum
byte    CanMove           // (value & 1) == 0 means can move
```

#### 0x07 - AddEntity
```
uint16  EntityCount
// Repeated EntityCount times:
uint16  X
uint16  Y
uint32  Id
uint16  Sprite            // has flag bits: 0x4000=creature, 0x8000=item
// If creature (sprite & 0x4000):
uint32  Unknown
byte    Direction         // WorldDirection enum
byte    Unknown2
byte    CreatureType      // CreatureType enum
String8 Name              // ONLY if CreatureType == Mundane (2)
// If item (sprite & 0x8000):
byte    Color             // DyeColor enum
uint16  Unknown
```

#### 0x08 - UpdateStats
```
byte    Fields            // StatsFieldFlags (bitmask)
// Fields present based on flags:
```

| Flag | Bit | Fields (in order) |
|------|-----|-------------------|
| Stats (0x20) | `byte[3]` (skip: 0x01,0x00,0x00), `byte Level`, `byte AbilityLevel`, `uint32 MaxHealth`, `uint32 MaxMana`, `byte STR`, `byte INT`, `byte WIS`, `byte CON`, `byte DEX`, `bool HasStatPoints`, `byte StatPoints`, `uint16 MaxWeight`, `uint16 Weight`, `uint32 Unknown` |
| Vitals (0x10) | `uint32 Health`, `uint32 Mana` |
| ExperienceGold (0x08) | `uint32 TotalExp`, `uint32 ToNextLevel`, `uint32 TotalAbility`, `uint32 ToNextAbility`, `uint32 GamePoints`, `uint32 Gold` |
| Modifiers (0x04) | `byte` (skip 0x00), `byte Blinded` (0x08=blinded), `byte[3]` (skip), `byte MailFlags`, `byte AttackElement`, `byte DefenseElement`, `byte MagicResist`, `bool CanMove`, `sbyte ArmorClass`, `byte DamageModifier`, `byte HitModifier` |
| GameMasterA (0x40) | Indicates admin if set without GameMasterB |
| GameMasterB (0x80) | Combined with GameMasterA (0xC0) = Swimming |

#### 0x0A - WorldMessage
```
byte    MessageType       // WorldMessageType enum
String16 Message
```

#### 0x0B - WalkResponse
```
byte    Direction
uint16  PreviousX
uint16  PreviousY
uint16  UnknownX
uint16  UnknownY
byte    Unknown
```

#### 0x0C - EntityWalk
```
uint32  EntityId
uint16  OriginX
uint16  OriginY
byte    Direction         // WorldDirection enum
byte    Unknown
```

#### 0x0D - PublicMessage
```
byte    MessageType       // PublicMessageType enum
uint32  SenderId
String8 Message
```

#### 0x0E - RemoveEntity
```
uint32  EntityId
```

#### 0x0F - AddItem
```
byte    Slot
uint16  Sprite            // with item flag 0x8000
byte    Color             // DyeColor enum
String8 Name
uint32  Quantity
bool    IsStackable
uint32  MaxDurability
uint32  Durability
```

#### 0x10 - RemoveItem
```
byte    Slot
```

#### 0x11 - EntityTurn
```
uint32  EntityId
byte    Direction         // WorldDirection enum
```

#### 0x13 - HealthBar
```
uint32  EntityId
byte    HealthPercent
byte    Sound
```

#### 0x15 - MapInfo
```
uint16  MapId
byte    WidthLo           // Width & 0xFF
byte    HeightLo          // Height & 0xFF
byte    Flags             // MapFlags enum
byte    WidthHi           // Width >> 8
byte    HeightHi          // Height >> 8
uint16  Checksum
String8 Name
```
Width = `(WidthHi << 8) | WidthLo`, Height = `(HeightHi << 8) | HeightLo`

#### 0x17 - AddSpell
```
byte    Slot
uint16  Icon
byte    TargetType        // SpellTargetType enum
String8 Name
String8 Prompt
byte    CastLines
```

#### 0x18 - RemoveSpell
```
byte    Slot
```

#### 0x19 - PlaySound
```
byte    SoundId
```

#### 0x1A - AnimateEntity
```
uint32  EntityId
byte    Animation         // BodyAnimation enum
uint16  Duration          // milliseconds
byte    Sound
```

#### 0x1B - ShowNotepad
```
byte    Slot
byte    Style             // NotepadStyle enum
byte    Height
byte    Width
String16 Content
```

#### 0x1E - ChangeDay
```
byte    DayPhase
```

#### 0x1F - MapChanged
```
uint16  Result
```

#### 0x20 - LightLevel
```
byte    LightLevel
```

#### 0x22 - RefreshComplete
```
(no payload)
```

#### 0x29 - ShowEffect
```
uint32  TargetId
// If TargetId == 0 (ground effect):
uint16  TargetAnimation
uint16  AnimationDuration
uint16  TargetX
uint16  TargetY
// If TargetId != 0 (entity effect):
uint32  SourceId
uint16  TargetAnimation
uint16  SourceAnimation
uint16  AnimationDuration
```

#### 0x2C - AddSkill
```
byte    Slot
uint16  Icon
String8 Name
```

#### 0x2D - RemoveSkill
```
byte    Slot
```

#### 0x2E - WorldMap
```
String8 FieldName
byte    NodeCount
byte    FieldIndex
// Repeated NodeCount times:
uint16  ScreenX
uint16  ScreenY
String8 Name
uint16  Checksum
uint16  MapId
uint16  MapX
uint16  MapY
```

#### 0x2F - ShowDialogMenu
```
byte    MenuType          // DialogMenuType enum
byte    EntityType        // EntityTypeFlags enum
uint32  EntityId
byte    Unknown1          // usually 0x01
uint16  Sprite            // with flag bits
byte    Color
byte    Unknown2          // usually 0x01
uint16  SpriteSecondary
byte    ColorSecondary
bool    ShowGraphicInverted  // false = show, true = hide (inverted!)
String8 Name
String16 Content
```

**Menu-type-specific trailing data:**

| MenuType | Trailing Data |
|----------|---------------|
| Menu (0) | `byte ChoiceCount`, then `[String8 Text, uint16 PursuitId]` per choice |
| MenuWithArgs (1) | `String8 Prompt`, `byte ChoiceCount`, then `[String8 Text, uint16 PursuitId]` per choice |
| TextInput (2) | `uint16 PursuitId` |
| TextInputWithArgs (3) | `String8 Prompt`, `uint16 PursuitId` |
| ItemChoices (4) | `uint16 PursuitId`, `uint16 ItemCount`, then `[uint16 Sprite, byte Color, uint32 Price, String8 Name, String8 Description]` per item |
| UserInventory (5) | `uint16 PursuitId`, `byte SlotCount`, then `byte Slot` per slot |
| SpellChoices (6) | `uint16 PursuitId`, `uint16 SpellCount`, then `[byte SpriteType, uint16 Sprite, byte Color, String8 Name]` per spell |
| SkillChoices (7) | `uint16 PursuitId`, `uint16 SkillCount`, then `[byte SpriteType, uint16 Sprite, byte Color, String8 Name]` per skill |
| UserSpells (8) | `uint16 PursuitId` |
| UserSkills (9) | `uint16 PursuitId` |

#### 0x30 - ShowDialog
```
byte    DialogType        // DialogType enum
// If CloseDialog (0x0A):
byte    0x00
// Else:
byte    EntityType        // EntityTypeFlags enum
uint32  EntityId
byte    Unknown1          // usually 0x01
uint16  Sprite            // with flag bits
byte    Color
byte    Unknown2          // usually 0x01
uint16  SpriteSecondary
byte    ColorSecondary
uint16  PursuitId
uint16  StepId
bool    HasPreviousButton
bool    HasNextButton
bool    ShowGraphicInverted  // inverted: false=show, true=hide
String8 Name
String16 Content
// If Menu (0x02) or CreatureMenu (0x06):
byte    ChoiceCount
String8[] MenuChoices     // ChoiceCount strings
// If TextInput (0x04):
String8 InputPrompt
byte    InputMaxLength
String8 InputDescription
```

#### 0x31 - BoardResult
```
byte    ResultType        // MessageBoardResult enum
```

| ResultType | Payload |
|------------|---------|
| BoardList (1) | `uint16 BoardCount`, then `[uint16 Id, String8 Name]` per board |
| Board (2) / Mailbox (4) | `byte BoardType`, `uint16 BoardId`, `String8 BoardName`, `byte PostCount`, then `[bool IsHighlighted, int16 Id, String8 Author, byte Month, byte Day, String8 Subject]` per post |
| Post (3) / MailLetter (5) | `bool CanNavigatePrev`, `bool IsHighlighted`, `int16 Id`, `String8 Author`, `byte Month`, `byte Day`, `String8 Subject`, `String16 Body` |
| PostSubmitted (6) / PostDeleted (7) / PostHighlighted (8) | `bool Success`, `String8 Message` |

#### 0x32 - MapDoor
```
byte    DoorCount
// Repeated DoorCount times:
byte    X
byte    Y
byte    State             // DoorState enum
byte    Direction         // DoorDirection enum
```

#### 0x33 - ShowUser
```
uint16  X
uint16  Y
byte    Direction         // WorldDirection enum
uint32  EntityId
uint16  HeadSprite
```

**If HeadSprite == 0xFFFF** (monster form):
```
uint16  MonsterSprite     // with creature flag 0x4000
byte    HairColor         // DyeColor
byte    BootsColor        // DyeColor
byte[6] Unknown
```

**If HeadSprite != 0xFFFF** (normal form):
```
byte    BodySpriteWithPants  // BodySprite enum + PantsColor in low nibble
uint16  ArmsSprite
byte    BootsSprite
uint16  ArmorSprite
byte    ShieldSprite
uint16  WeaponSprite
byte    HairColor         // DyeColor
byte    BootsColor        // DyeColor
byte    Accessory1Color   // DyeColor
uint16  Accessory1Sprite
byte    Accessory2Color   // DyeColor
uint16  Accessory2Sprite
byte    Accessory3Color   // DyeColor
uint16  Accessory3Sprite
byte    Lantern           // LanternSize enum
byte    RestPosition      // RestPosition enum
uint16  OvercoatSprite
byte    OvercoatColor     // DyeColor
byte    SkinColor         // SkinColor enum
bool    IsTranslucent
byte    FaceShape
```

**Common trailer** (both forms):
```
byte    NameStyle         // NameTagStyle enum
String8 Name
String8 GroupBox
```

Note: `BodySpriteWithPants` encodes both body type and pants color. `PantsColor = value % 16` (if non-zero), `BodySprite = value - PantsColor`.

#### 0x34 - UserProfile
```
uint32  EntityId
// 18 equipment slots in specific order (not enum order):
// Weapon, Armor, Shield, Helmet, Earrings, Necklace, LeftRing, RightRing,
// LeftGauntlet, RightGauntlet, Belt, Greaves, Accessory1, Boots,
// Overcoat, OverHelm, Accessory2, Accessory3
// Each slot:
uint16  Sprite            // with item flag 0x8000
byte    Color             // DyeColor

byte    Status            // SocialStatus enum
String8 Name
byte    Nation            // NationFlag enum
String8 Title
bool    IsGroupOpen
String8 GuildRank
String8 DisplayClass
String8 Guild
byte    LegendMarkCount
// Repeated LegendMarkCount times:
byte    Icon              // LegendMarkIcon enum
byte    Color             // LegendMarkColor enum
String8 Key
String8 Text
// Optional portrait/bio section:
uint16  RemainingLength   // if < 4, no portrait/bio follows
uint16  PortraitLength
byte[]  Portrait          // PortraitLength bytes
String16 Bio
```

#### 0x36 - WorldList
```
uint16  WorldCount
uint16  CountryCount
// Repeated CountryCount times:
byte    ClassWithFlags    // Class = value & 0x07, Flags = value & 0xF8
byte    Color             // WorldListColor enum
byte    Status            // SocialStatus enum
String8 Title
bool    IsMaster
String8 Name
```

#### 0x37 - SetEquipment
```
byte    Slot              // EquipmentSlot enum
uint16  Sprite            // with item flag 0x8000
byte    Color             // DyeColor
String8 Name
byte    Unknown           // always 0
uint32  MaxDurability
uint32  Durability
```

#### 0x38 - RemoveEquipment
```
byte    Slot              // EquipmentSlot enum
```

#### 0x39 - SelfProfile
```
byte    Nation            // NationFlag enum
String8 GuildRank
String8 Title
String8 GroupMembers
bool    IsGroupOpen
bool    IsRecruiting
// If IsRecruiting:
String8 Leader
String8 GroupName
String8 GroupNote
byte    MinLevel
byte    MaxLevel
byte    MaxWarriors
byte    CurrentWarriors
byte    MaxWizards
byte    CurrentWizards
byte    MaxMonks
byte    CurrentRogues     // NOTE: field order is intentionally swapped
byte    MaxPriests
byte    CurrentPriests
byte    MaxRogues         // NOTE: swapped with Monks
byte    CurrentMonks
// End if
byte    Class             // CharacterClass enum
bool    ShowAbilityMetadata
bool    ShowMasterMetadata
String8 DisplayClass
String8 Guild
byte    LegendMarkCount
// Repeated LegendMarkCount times:
byte    Icon              // LegendMarkIcon enum
byte    Color             // LegendMarkColor enum
String8 Key
String8 Text
```

**Important**: The GroupBox field ordering for Monks/Rogues/Priests is intentionally swapped compared to what you might expect. This is confirmed in the source code comments.

#### 0x3A - StatusEffect
```
uint16  Icon
byte    Duration          // StatusEffectDuration enum
```

#### 0x3B - Heartbeat
```
uint16  Request
```

#### 0x3C - MapTransfer
```
uint16  RowY
byte[]  Data              // remaining bytes = row tile data
```

#### 0x3E - SwitchPane
```
byte    PaneType          // InterfacePane enum
```

#### 0x3F - Cooldown
```
byte    AbilityType       // AbilityType enum (0=Spell, 1=Skill)
byte    Slot
uint32  Seconds
```

#### 0x42 - Exchange
```
byte    Event             // ExchangeServerEventType enum
```

| Event | Payload |
|-------|---------|
| Started (0) | `uint32 TargetId`, `String8 TargetName` |
| QuantityPrompt (1) | `byte Slot` |
| ItemAdded (2) | `byte Party`, `byte ItemIndex`, `uint16 ItemSprite` (with flag), `byte ItemColor`, `String8 ItemName` |
| GoldAdded (3) | `byte Party`, `uint32 GoldAmount` |
| Cancelled (4) | `byte Party`, `String8 Message` |
| Accepted (5) | `byte Party`, `String8 Message` |

#### 0x48 - CancelCast
```
(no payload)
```

#### 0x49 - RequestUserPortrait
```
(portrait request data)
```

#### 0x4B - ForcePacket
```
byte[]  RawPacketData     // arbitrary packet data for client to process
```

#### 0x4C - ExitResponse
```
(no payload or single byte result)
```

#### 0x50 - Manufacture
```
uint16  ManufactureId
byte    MessageType       // ServerManufactureType enum
// If RecipeCount (0x00):
byte    RecipeCount
// If Recipe (0x01):
byte    RecipeIndex
uint16  Sprite            // with item flag 0x8000
String8 RecipeName
String16 RecipeDescription
String16 Ingredients
byte    0x01              // trailing
byte    0x00              // trailing
```

#### 0x51 - ShowSpinner
```
String8 Message
```

#### 0x52 - UserIdResponse
```
uint32  UserId
String8 CharacterName
```

#### 0x56 - ServerTable
```
uint16  ContentLength
byte[]  CompressedData    // zlib-compressed server table
```

Decompressed format:
```
byte    ServerCount
// Repeated ServerCount times:
byte    ServerId
IPv4    Address
uint16  Port
NullTerminatedString Name
```

#### 0x58 - MapTransferComplete
```
(no payload)
```

#### 0x60 - LoginNotice
```
String16 NoticeText
```

#### 0x63 - Group
```
byte    Action            // ServerGroupAction enum
// If RecruitInfo (4):
String8 Leader
String8 GroupName
String8 GroupNote
byte    MinLevel
byte    MaxLevel
byte    MaxWarriors
byte    CurrentWarriors
byte    MaxWizards
byte    CurrentWizards
byte    MaxMonks
byte    CurrentRogues     // intentionally swapped
byte    MaxPriests
byte    CurrentPriests
byte    MaxRogues         // intentionally swapped
byte    CurrentMonks
// Else:
String8 Name
```

#### 0x66 - ServerInfo
```
byte    DataType          // ServerInfoType enum
String8 Value
```

#### 0x67 - MapChanging
```
byte    ChangeType
uint32  Unknown
```

#### 0x68 - SyncTicks
```
uint32  ServerTicks
```

#### 0x6B - ShowMapHelp
```
String8 HelpText
```

#### 0x6F - Metadata
```
byte    ResponseType      // MetadataResponseType enum
// If Metadata (0):
String8 Name
uint32  Checksum
uint16  ContentSize
byte[]  Data              // ContentSize bytes
// If Listing (1):
uint16  FileCount
// Repeated FileCount times:
String8 Name
uint32  Checksum
```

#### 0x7E - Hello
```
byte    Unknown           // always 0
Line    Message           // newline-terminated string
```

---

## 7. Enums Reference

### 7.1 Character

#### CharacterClass
| Value | Name |
|-------|------|
| 0 | Peasant |
| 1 | Warrior |
| 2 | Rogue |
| 3 | Wizard |
| 4 | Priest |
| 5 | Monk |
| 0xFF | None |

#### GenderFlags [Flags]
| Value | Name |
|-------|------|
| 0 | None |
| 1 | Male |
| 2 | Female |
| 3 | Unisex (Male \| Female) |

#### CharacterStatFlags [Flags]
| Value | Name |
|-------|------|
| 0x00 | None |
| 0x01 | Strength |
| 0x02 | Dexterity |
| 0x04 | Intelligence |
| 0x08 | Wisdom |
| 0x10 | Constitution |

#### BodySprite
| Value | Name |
|-------|------|
| 0 | None |
| 16 (0x10) | Male |
| 32 (0x20) | Female |
| 48 (0x30) | MaleGhost |
| 64 (0x40) | FemaleGhost |
| 80 (0x50) | MaleInvisible |
| 96 (0x60) | FemaleInvisible |
| 112 (0x70) | MaleJester |
| 128 (0x80) | MaleHead |
| 144 (0x90) | FemaleHead |
| 160 (0xA0) | MaleBlank |
| 176 (0xB0) | FemaleBlank |

#### SkinColor
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

### 7.2 Direction & Movement

#### WorldDirection
| Value | Name |
|-------|------|
| 0 | Up |
| 1 | Right |
| 2 | Down |
| 3 | Left |
| 4 | All |
| 0xFF | None |

#### RestPosition
| Value | Name |
|-------|------|
| 0 | None |
| 1 | Kneeling |
| 2 | Laying |
| 3 | Sprawling |

### 7.3 Elements

#### ElementModifier
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

### 7.4 Equipment

#### EquipmentSlot
| Value | Name |
|-------|------|
| 0 | None |
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

**UserProfile equipment transmission order** (differs from enum values):
Weapon, Armor, Shield, Helmet, Earrings, Necklace, LeftRing, RightRing, LeftGauntlet, RightGauntlet, Belt, Greaves, Accessory1, Boots, Overcoat, OverHelm, Accessory2, Accessory3

### 7.5 Colors

#### DyeColor (sequential from 0)
| Value | Name | Value | Name |
|-------|------|-------|------|
| 0 | Default | 36 | Scarlet |
| 1 | Black | 37 | Forest |
| 2 | Apple | 38 | Scarlet2 |
| 3 | Carrot | 39 | YaleBlue |
| 4 | Yellow | 40 | Tangerine |
| 5 | Teal | 41 | DirtyBlonde |
| 6 | Blue | 42 | Sage |
| 7 | Violet | 43 | Grass |
| 8 | Olive | 44 | Cobalt |
| 9 | Green | 45 | Blush |
| 10 | Pumpkin | 46 | Glitch |
| 11 | Brown | 47 | Aqua |
| 12 | Gray | 48 | Lime |
| 13 | Navy | 49 | Purple |
| 14 | Tan | 50 | NeonRed |
| 15 | White | 51 | NeonYellow |
| 16 | Pink | 52 | PalePink |
| 17 | Chartreuse | 53 | Peach |
| 18 | Orange | 54 | Crimson |
| 19 | LightBlonde | 55 | Mustard |
| 20 | Midnight | 56 | Silver |
| 21 | Sky | 57 | Fire |
| 22 | Mauve | 58 | Ice |
| 23 | Orchid | 59 | Magenta |
| 24 | BubbleGum | 60 | PaleGreen |
| 25 | LightBlue | 61 | BabyBlue |
| 26 | HotPink | 62 | Void |
| 27 | Cyan | 63 | GhostBlue |
| 28 | Lilac | 64 | Mint |
| 29 | Salmon | 65 | Fern |
| 30 | NeonBlue | 66 | GhostPink |
| 31 | NeonGreen | 67 | Flamingo |
| 32 | PastelGreen | 68 | Turquoise |
| 33 | Blonde | 69 | MatteBlack |
| 34 | RoyalBlue | 70 | Taffy |
| 35 | Leather | 71 | NeonPurple |

### 7.6 Animations & Emotes

#### BodyAnimation
| Value | Name | Value | Name |
|-------|------|-------|------|
| 0 | None | 29 | Pleasure |
| 1 | Assail | 30 | Love |
| 6 | HandsUp | 31 | SweatDrop |
| 9 | Smile | 32 | Whistle |
| 10 | Cry | 33 | Annoyed |
| 11 | Frown | 34 | Silly |
| 12 | Wink | 35 | Cute |
| 13 | Surprise | 36 | Yelling |
| 14 | Tongue | 37 | Mischievous |
| 15 | Pleasant | 38 | Evil |
| 16 | Snore | 39 | Horror |
| 17 | Mouth | 40 | PuppyDog |
| 21 | BlowKiss | 41 | StoneFaced |
| 22 | Wave | 42 | Tears |
| 23 | RockOn | 43 | FiredUp |
| 24 | Peace | 44 | Confused |
| 25 | Stop | 128 | PriestCast |
| 26 | Ouch | 129 | TwoHandAttack |
| 27 | Impatient | 130 | Jump |
| 28 | Shock | 131 | Kick |
| 132 | Punch | 139 | HeavySwipe |
| 133 | RoundHouseKick | 140 | JumpAttack |
| 134 | Stab | 141 | BowShot |
| 135 | DoubleStab | 142 | HeavyBowShot |
| 136 | WizardCast | 143 | LongBowShot |
| 137 | PlayNotes | 144 | Summon |
| 138 | HandsUp2 | 145 | Summon |

#### Emote (sequential from 0, skips 9-11)
| Value | Name | Value | Name |
|-------|------|-------|------|
| 0 | Smile | 18 | Shock |
| 1 | Cry | 19 | Pleasure |
| 2 | Frown | 20 | Love |
| 3 | Wink | 21 | SweatDrop |
| 4 | Surprise | 22 | Whistle |
| 5 | Tongue | 23 | Annoyed |
| 6 | Pleasant | 24 | Silly |
| 7 | Snore | 25 | Cute |
| 8 | Mouth | 26 | Yelling |
| 12 | BlowKiss | 27 | Mischievous |
| 13 | Wave | 28 | Evil |
| 14 | RockOn | 29 | Horror |
| 15 | Peace | 30 | PuppyDog |
| 16 | Stop | 31 | StoneFaced |
| 17 | Ouch | 32 | Tears |
| | | 33 | FiredUp |
| | | 34 | Confused |
| | | 35 | Confused |

### 7.7 Entities & Creatures

#### CreatureType
| Value | Name | Description |
|-------|------|-------------|
| 0 | Monster | Hostile creature |
| 1 | Passable | Walk-through entity |
| 2 | Mundane | NPC (has name) |
| 3 | Solid | Blocking entity |
| 4 | Aisling | Player character |

#### EntityTypeFlags [Flags]
| Value | Name |
|-------|------|
| 0 | None |
| 0x01 | Creature |
| 0x02 | Item |
| 0x04 | Reactor |

#### SpriteType
| Value | Name |
|-------|------|
| 0 | None |
| 1 | Item |
| 2 | Spell |
| 3 | Skill |
| 4 | Monster |

#### SpriteFlags (constants)
| Value | Name | Description |
|-------|------|-------------|
| 0x4000 | Creature | OR'd into sprite uint16 for creatures |
| 0x8000 | Item | OR'd into sprite uint16 for items |

### 7.8 Abilities

#### SpellTargetType
| Value | Name |
|-------|------|
| 0 | None |
| 1 | Prompt |
| 2 | Target |
| 3 | PromptFourNumbers |
| 4 | PromptThreeNumbers |
| 5 | NoTarget |
| 6 | PromptTwoNumbers |
| 7 | PromptOneNumber |

#### AbilityType
| Value | Name |
|-------|------|
| 0 | Spell |
| 1 | Skill |

#### StatusEffectDuration
| Value | Name | Description |
|-------|------|-------------|
| 0 | None | No effect |
| 1 | Blue | Long duration remaining |
| 2 | Green | Medium-long |
| 3 | Yellow | Medium |
| 4 | Orange | Medium-short |
| 5 | Red | Short duration remaining |
| 6 | White | Very short / permanent |

### 7.9 Dialog System

#### DialogType
| Value | Name |
|-------|------|
| 0x00 | Popup |
| 0x02 | Menu |
| 0x04 | TextInput |
| 0x05 | Speak |
| 0x06 | CreatureMenu |
| 0x09 | Protected |
| 0x0A | CloseDialog |

#### DialogMenuType
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

#### DialogArgsType
| Value | Name |
|-------|------|
| 0x00 | None |
| 0x01 | MenuChoice |
| 0x02 | TextInput |

#### DialogResult
| Value | Name |
|-------|------|
| -1 | Previous |
| 0 | Close |
| 1 | Next |

### 7.10 Exchange/Trading

#### ExchangeClientActionType
| Value | Name |
|-------|------|
| 0 | BeginExchange |
| 1 | AddItem |
| 2 | AddStackableItem |
| 3 | SetGold |
| 4 | Cancel |
| 5 | Accept |

#### ExchangeServerEventType
| Value | Name |
|-------|------|
| 0 | Started |
| 1 | QuantityPrompt |
| 2 | ItemAdded |
| 3 | GoldAdded |
| 4 | Cancelled |
| 5 | Accepted |

#### ExchangeParty
| Value | Name |
|-------|------|
| 0 | You |
| 1 | Them |

### 7.11 Chat & Messages

#### PublicMessageType
| Value | Name |
|-------|------|
| 0 | Say |
| 1 | Shout |
| 2 | Chant |

#### WorldMessageType
| Value | Name |
|-------|------|
| 0 | Whisper |
| 1 | BarMessage2 |
| 2 | BarMessage3 |
| 3 | BarMessage |
| 4 | BarMessage4 |
| 5 | WorldShout |
| 6 | BarMessageNoHistory |
| 7 | UserSettings |
| 8 | ScrollablePopup |
| 9 | Popup |
| 10 | SignPost |
| 11 | GroupChat |
| 12 | GuildChat |
| 17 | ClosePopup |
| 18 | FloatingMessage |

### 7.12 Message Board

#### MessageBoardAction
| Value | Name |
|-------|------|
| 1 | ListBoards |
| 2 | ViewBoard |
| 3 | ViewPost |
| 4 | CreatePost |
| 5 | DeletePost |
| 6 | SendMail |
| 7 | HighlightPost |

#### MessageBoardResult
| Value | Name |
|-------|------|
| 1 | BoardList |
| 2 | Board |
| 3 | Post |
| 4 | Mailbox |
| 5 | MailLetter |
| 6 | PostSubmitted |
| 7 | PostDeleted |
| 8 | PostHighlighted |

#### MessageBoardType
| Value | Name |
|-------|------|
| 1 | Global |
| 2 | Clicked |

#### MessageBoardNavigation
| Value | Name |
|-------|------|
| -1 | NextPage |
| 0 | ThisPost |
| 1 | PreviousPage |

### 7.13 Map & World

#### MapFlags [Flags]
| Value | Name |
|-------|------|
| 0x00 | None |
| 0x01 | Snow |
| 0x02 | Rain |
| 0x03 | Darkness (Snow \| Rain) |
| 0x40 | NoMap |
| 0x80 | Winter |

#### DoorState
| Value | Name |
|-------|------|
| 0 | Open |
| 1 | Closed |

#### DoorDirection
| Value | Name |
|-------|------|
| 0 | Left |
| 1 | Right |

### 7.14 Groups

#### ClientGroupAction
| Value | Name |
|-------|------|
| 1 | Invite |
| 2 | Request |
| 3 | Accept |
| 4 | RecruitStart |
| 5 | RecruitView |
| 6 | RecruitStop |
| 7 | RecruitJoin |

#### ServerGroupAction
| Value | Name |
|-------|------|
| 1 | Ask |
| 2 | Members |
| 4 | RecruitInfo |
| 5 | RecruitJoin |

### 7.15 Social

#### SocialStatus
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

### 7.16 UI & Display

#### InterfacePane
| Value | Name |
|-------|------|
| 0 | Inventory |
| 1 | Skills |
| 2 | Spells |
| 3 | Chat |
| 4 | Stats |

#### LanternSize
| Value | Name |
|-------|------|
| 0 | None |
| 1 | Small |
| 2 | Large |

#### NameTagStyle
| Value | Name |
|-------|------|
| 0 | NeutralHover |
| 0x01 | Hostile |
| 0x02 | FriendlyHover |
| 0x03 | Neutral |

#### NotepadStyle
| Value | Name |
|-------|------|
| 0 | Brown |
| 1 | Blue |
| 2 | Blue2 |
| 3 | Orange |
| 4 | White |

### 7.17 Account & Login

#### LoginResult
| Value | Name |
|-------|------|
| 0 | Success |
| 3 | InvalidName |
| 4 | NameTaken |
| 5 | InvalidPassword |
| 14 | CharacterNotFound |
| 15 | IncorrectPassword |

#### NationFlag
| Value | Name |
|-------|------|
| 0 | None |
| 1 | Suomi |
| 2 | Unknown1 |
| 3 | Loures |
| 4 | Mileth |
| 5 | Tagor |
| 6 | Rucesion |
| 7 | Noes |
| 8 | Unknown2 |
| 9 | Piet |
| 10 | Unknown3 |
| 11 | Abel |
| 12 | Undine |
| 13 | Unknown4 |

#### ClientExitReason
| Value | Name |
|-------|------|
| 0 | None |
| 1 | UserRequested |

### 7.18 Mail & Ignore

#### MailFlags [Flags]
| Value | Name |
|-------|------|
| 0x00 | None |
| 0x01 | Parcel |
| 0x10 | Mail |

#### IgnoreUserAction
| Value | Name |
|-------|------|
| 1 | ListUsers |
| 2 | AddUser |
| 3 | RemoveUser |

### 7.19 Legend Marks

#### LegendMarkIcon
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

#### LegendMarkColor
| Value | Name |
|-------|------|
| 0 | None |
| 1 | Cyan |
| 2 | BrightRed |
| 3 | GrayTan |
| 4 | LightGray |
| 5 | Gray |
| 13 | OffWhite |
| 14 | DarkGray |
| 16 | White |
| 17 | BrightGray |
| 20 | GrayGreen |
| 32 | LightPink |
| 50 | LightOrange |
| 53 | DarkBrown |
| 64 | LightYellow |
| 68 | Yellow |
| 75 | LightGreen |
| 88 | Blue |
| 96 | LightPurple |
| 100 | DarkPurple |
| 105 | Pink |
| 125 | DarkGreen |
| 128 | Green |
| 152 | Orange |
| 160 | Brown |
| 248 | Red |

#### WorldListColor
| Value | Name |
|-------|------|
| 84 | Guild |
| 151 | SimilarLevel |
| 255 | Default |

### 7.20 Metadata & Server Info

#### MetadataRequestType
| Value | Name |
|-------|------|
| 0 | GetMetadata |
| 1 | Listing |

#### MetadataResponseType
| Value | Name |
|-------|------|
| 0 | Metadata |
| 1 | Listing |

#### ServerInfoType
| Value | Name |
|-------|------|
| 0 | None |
| 3 | Homepage |

### 7.21 Stats

#### StatsFieldFlags [Flags]
| Value | Name | Description |
|-------|------|-------------|
| 0x00 | None | No stats |
| 0x01 | UnreadMail | Mail indicator |
| 0x02 | Unknown | Unknown flag |
| 0x04 | Modifiers | AC, MR, elements, etc. |
| 0x08 | ExperienceGold | XP, ability XP, gold, GP |
| 0x10 | Vitals | Current HP/MP |
| 0x20 | Stats | Level, base stats, weight |
| 0x40 | GameMasterA | Admin flag (alone) |
| 0x80 | GameMasterB | Combined with A = Swimming |
| 0xC0 | Swimming | GameMasterA \| GameMasterB |
| 0x3C | Full | Stats \| Vitals \| ExperienceGold \| Modifiers |

### 7.22 Interaction

#### InteractionType
| Value | Name |
|-------|------|
| 1 | Entity |
| 3 | Tile |

### 7.23 Manufacturing

#### ClientManufactureType
| Value | Name |
|-------|------|
| 0x00 | RequestRecipe |
| 0x01 | CraftRecipe |

#### ServerManufactureType
| Value | Name |
|-------|------|
| 0x00 | RecipeCount |
| 0x01 | Recipe |

### 7.24 Slot Swap

#### ClientSlotSwapType
| Value | Name |
|-------|------|
| 0 | Inventory |
| 1 | Spells |
| 2 | Skills |

### 7.25 Network

#### NetworkDirection
| Value | Name |
|-------|------|
| 0 | None |
| 1 | Receive |
| 2 | Send |

#### NetworkPriority
| Value | Name |
|-------|------|
| 0 | Normal |
| 1 | High |

---

## 8. Composite Data Structures

### ServerEntityObject (base)
Used in AddEntity (0x07):
```
uint16  X
uint16  Y
uint32  Id
uint16  Sprite            // with flag bits
```

### ServerCreatureEntity (extends EntityObject)
```
uint32  Unknown
byte    Direction         // WorldDirection
byte    Unknown2
byte    CreatureType      // CreatureType enum
String8 Name              // only if Mundane
```

### ServerItemEntity (extends EntityObject)
```
byte    Color             // DyeColor
uint16  Unknown
```

### ServerEquipmentInfo
Used in UserProfile (0x34):
```
byte    Slot              // EquipmentSlot
uint16  Sprite
byte    Color             // DyeColor
```

### ServerLegendMark
Used in SelfProfile (0x39), UserProfile (0x34):
```
byte    Icon              // LegendMarkIcon
byte    Color             // LegendMarkColor
String8 Key
String8 Text
```

### ServerGroupBox
Used in SelfProfile (0x39), Group (0x63):
```
String8 Leader
String8 Name
String8 Note
byte    MinLevel
byte    MaxLevel
byte    MaxWarriors
byte    CurrentWarriors
byte    MaxWizards
byte    CurrentWizards
byte    MaxMonks          // NOTE: intentionally swapped with Rogues
byte    CurrentRogues
byte    MaxPriests
byte    CurrentPriests
byte    MaxRogues
byte    CurrentMonks
```

### ClientGroupBox
Used in GroupInvite (0x2E):
```
String8 Name
String8 Note
byte    MinLevel
byte    MaxLevel
byte    MaxWarriors
byte    MaxWizards
byte    MaxRogues
byte    MaxPriests
byte    MaxMonks
```
Note: Client group box does NOT include leader or current counts, and the field order differs from server group box.

### ServerWorldListUser
Used in WorldList (0x36):
```
byte    ClassWithFlags    // Class = & 0x07, Flags = & 0xF8
byte    Color             // WorldListColor
byte    Status            // SocialStatus
String8 Title
bool    IsMaster
String8 Name
```

### ServerWorldMapNode
Used in WorldMap (0x2E):
```
uint16  ScreenX
uint16  ScreenY
String8 Name
uint16  Checksum
uint16  MapId
uint16  MapX
uint16  MapY
```

### ServerDialogMenuChoice
Used in ShowDialogMenu (0x2F):
```
String8 Text
uint16  PursuitId
```

### ServerItemMenuChoice
Used in ShowDialogMenu (0x2F) with ItemChoices:
```
uint16  Sprite            // with item flag
byte    Color             // DyeColor
uint32  Price
String8 Name
String8 Description
```

### ServerSpellMenuChoice / ServerSkillMenuChoice
Used in ShowDialogMenu (0x2F) with SpellChoices/SkillChoices:
```
byte    SpriteType        // SpriteType enum
uint16  Sprite
byte    Color             // DyeColor
String8 Name
```

### ServerMessageBoardInfo
Used in BoardResult (0x31) with BoardList:
```
uint16  Id
String8 Name
```

### ServerMessageBoardPostListing
Used in BoardResult (0x31) with Board/Mailbox:
```
bool    IsHighlighted
int16   Id
String8 Author
byte    Month
byte    Day
String8 Subject
```

### ServerMessageBoardPost
Used in BoardResult (0x31) with Post/MailLetter:
```
bool    IsHighlighted
int16   Id
String8 Author
byte    Month
byte    Day
String8 Subject
String16 Body
```

### ServerMetadataEntry
Used in Metadata (0x6F) with Listing:
```
String8 Name
uint32  Checksum
```

### ServerTableEntry
Used in ServerTable (0x56) after zlib decompression:
```
byte    Id
IPv4    Address
uint16  Port
NullTerminatedString Name
```

### ServerMapDoor
Used in MapDoor (0x32):
```
byte    X
byte    Y
byte    State             // DoorState
byte    Direction         // DoorDirection
```

---

## 9. Game System Constants

### Slot Limits

| System | Max Slots | Index Type |
|--------|-----------|------------|
| Inventory | 60 | byte (1-60) |
| Temuair Skills | 36 | byte |
| Medenia Skills | 36 | byte |
| World Skills | 18 | byte |
| **Total Skills** | **90** | byte |
| Temuair Spells | 36 | byte |
| Medenia Spells | 36 | byte |
| World Spells | 18 | byte |
| **Total Spells** | **90** | byte |
| Equipment | 18 | EquipmentSlot (1-18) |

### Numeric Limits

| Field | Type | Range |
|-------|------|-------|
| Entity ID | uint32 | 0 - 4,294,967,295 |
| Map coordinates | uint16 | 0 - 65,535 |
| Health / Mana | uint32 | 0 - 4,294,967,295 |
| Gold | uint32 | 0 - 4,294,967,295 |
| Game Points | uint32 | 0 - 4,294,967,295 |
| Experience | uint32 | 0 - 4,294,967,295 |
| Level | byte | 0 - 255 |
| Ability Level | byte | 0 - 255 |
| Base stats (STR/INT/WIS/CON/DEX) | byte | 0 - 255 |
| Armor Class | sbyte | -128 to 127 (negative = better) |
| Magic Resist | byte | 0 - 255 |
| Damage Modifier | byte | 0 - 255 |
| Hit Modifier | byte | 0 - 255 |
| Weight / MaxWeight | uint16 | 0 - 65,535 |
| Durability | uint32 | 0 - 4,294,967,295 |
| Map ID | uint16 | 0 - 65,535 |

### Sprite Flag Bits

| Bit | Hex | Meaning | Usage |
|-----|-----|---------|-------|
| 14 | 0x4000 | Creature | Set on creature sprites in AddEntity, ShowUser monster form |
| 15 | 0x8000 | Item | Set on item sprites in AddEntity, AddItem, SetEquipment, dialogs |

To extract the actual sprite ID: `sprite & 0x3FFF`

To set creature flag: `sprite | 0x4000`

To set item flag: `sprite | 0x8000`

### Packet Marker
| Constant | Value |
|----------|-------|
| Packet marker byte | `0xAA` |
| Header size | 4 bytes |

---

*End of Dark Ages Protocol Reference*
*Source: Arbiter-1.8.1 by Jinori*
