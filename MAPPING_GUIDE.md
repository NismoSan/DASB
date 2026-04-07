# da.js — Mapping Guide

## Overview

The mapping system lets your bot track its position, know what map it's on, receive map tile data, and **walk to specific locations or maps**. Map data is automatically captured when the server sends it — you just need to listen to the right events and send the right packets.

---

## Key Opcodes

| Opcode | Direction | Name | What It Does |
|--------|-----------|------|-------------|
| `0x06` | Client→Server | Walk | Move one tile in a direction |
| `0x11` | Client→Server | Turn | Face a direction without moving |
| `0x05` | Client→Server | RequestMapData | Ask the server for map tile data |
| `0x04` | Server→Client | MapLocation | Server tells you your current X, Y position |
| `0x15` | Server→Client | MapInfo | Server sends map tile data (auto-captured on `client.map`) |
| `0x0B` | Server→Client | WalkResponse | Server confirms your walk succeeded or failed |
| `0x3C` | Server→Client | MapTransfer | You've entered a new map |
| `0x67` | Server→Client | MapChanging | A map change is about to happen |
| `0x58` | Server→Client | MapTransferComplete | Map transfer finished |

### Directions

Used for Walk (`0x06`) and Turn (`0x11`):

| Value | Direction |
|-------|-----------|
| `0` | North (up) |
| `1` | East (right) |
| `2` | South (down) |
| `3` | West (left) |

---

## Tracking Your Position

The server sends `0x04` (MapLocation) to tell you where you are. This fires when you log in, after walking, and after map transfers.

```js
const { Client, Packet } = require('./');

const client = new Client('YourUsername', 'YourPassword');

let myX = 0;
let myY = 0;
let myMapNumber = 0;

// Track position updates
client.events.on(0x04, function(packet) {
  myX = packet.readUInt16();
  myY = packet.readUInt16();
  console.log(`Position: (${myX}, ${myY})`);
});

// Track map changes
client.events.on(0x15, function(packet) {
  // The built-in handler already captures tile data on client.map
  // But we can also read the map index ourselves
  var pos = packet.position; // save position
  myMapNumber = packet.readUInt16();
  packet.position = pos;     // reset so the built-in handler can read it too
  console.log(`On map #${myMapNumber}`);
});

client.connect();
```

---

## Walking

To walk, send opcode `0x06` with a single byte for direction.

```js
function walk(direction) {
  const packet = new Packet(0x06);
  packet.writeByte(direction);
  client.send(packet);
}

// Walk north
walk(0);

// Walk east
walk(1);

// Walk south
walk(2);

// Walk west
walk(3);
```

The server will respond with `0x0B` (WalkResponse) and then `0x04` (MapLocation) with your new position.

---

## Walking to a Specific Tile

To walk to a specific (x, y) coordinate on the current map, you need to take steps one at a time. The simplest approach is to walk in a straight line — move horizontally first, then vertically (or vice versa).

```js
const { Client, Packet } = require('./');

const client = new Client('YourUsername', 'YourPassword');

let myX = 0;
let myY = 0;
let targetX = -1;
let targetY = -1;
let walkTimer = null;

// Track position
client.events.on(0x04, function(packet) {
  myX = packet.readUInt16();
  myY = packet.readUInt16();
});

function walk(direction) {
  const packet = new Packet(0x06);
  packet.writeByte(direction);
  client.send(packet);
}

function walkTo(x, y) {
  targetX = x;
  targetY = y;

  // Walk one step every 300ms (adjust speed as needed)
  // Too fast and the server may ignore your walks
  if (walkTimer) clearInterval(walkTimer);

  walkTimer = setInterval(function() {
    if (myX === targetX && myY === targetY) {
      console.log('Arrived!');
      clearInterval(walkTimer);
      walkTimer = null;
      return;
    }

    // Move horizontally first
    if (myX < targetX) {
      walk(1); // east
    } else if (myX > targetX) {
      walk(3); // west
    }
    // Then vertically
    else if (myY < targetY) {
      walk(2); // south
    } else if (myY > targetY) {
      walk(0); // north
    }
  }, 300);
}

client.connect();

// After logging in, walk to tile (15, 20)
client.events.on(0x05, function(packet) {
  setTimeout(function() {
    walkTo(15, 20);
  }, 2000); // wait 2 seconds after login to start walking
});
```

### Walk Speed

The server has a minimum delay between walk commands. If you send them too fast, it'll ignore some. **300ms** is a safe interval. You can try going faster (200ms) but you might get walks dropped. Slower is safer.

---

## Traveling to a Different Map

There's no direct "teleport to map X" packet. To get to a different map, you have to **walk there through map exits** — just like a real player would. Map edges and doors are transitions to other maps.

Here's how to detect when you've changed maps:

```js
// Fires when a map transfer starts
client.events.on(0x67, function(packet) {
  console.log('Map is changing...');
});

// Fires when transfer completes — you're on the new map now
client.events.on(0x58, function(packet) {
  console.log('Map transfer complete');
});

// 0x15 fires with the new map's tile data
client.events.on(0x15, function(packet) {
  var pos = packet.position;
  var mapIndex = packet.readUInt16();
  packet.position = pos;
  console.log('Now on map #' + mapIndex);
});
```

### Building a Route System

To travel to a specific map number, you need to know the path — which tiles are exits and which maps they lead to. The fastest approach is to build a route table:

```js
const { Client, Packet } = require('./');

const client = new Client('YourUsername', 'YourPassword');

let myX = 0;
let myY = 0;
let currentMap = 0;
let walkTimer = null;

// Define routes: each entry is [mapNumber, exitX, exitY, nextMap]
// These are examples — you need to fill in real coordinates
const routes = {
  // From map 500, walk to (23, 0) to reach map 501
  '500->501': { exitX: 23, exitY: 0 },
  // From map 501, walk to (10, 37) to reach map 510
  '501->510': { exitX: 10, exitY: 37 },
};

client.events.on(0x04, function(packet) {
  myX = packet.readUInt16();
  myY = packet.readUInt16();
});

client.events.on(0x15, function(packet) {
  var pos = packet.position;
  currentMap = packet.readUInt16();
  packet.position = pos;
});

function walk(direction) {
  const packet = new Packet(0x06);
  packet.writeByte(direction);
  client.send(packet);
}

function walkTo(x, y, callback) {
  if (walkTimer) clearInterval(walkTimer);

  walkTimer = setInterval(function() {
    if (myX === x && myY === y) {
      clearInterval(walkTimer);
      walkTimer = null;
      if (callback) callback();
      return;
    }

    if (myX < x) walk(1);
    else if (myX > x) walk(3);
    else if (myY < y) walk(2);
    else if (myY > y) walk(0);
  }, 300);
}

// Travel from current map to a target map through a chain of exits
function travelTo(targetMap, path) {
  // path = ['500->501', '501->510'] — a list of route keys in order
  var step = 0;

  function nextStep() {
    if (step >= path.length) {
      console.log('Arrived at map #' + targetMap);
      return;
    }

    var route = routes[path[step]];
    console.log('Walking to exit at (' + route.exitX + ', ' + route.exitY + ')...');

    walkTo(route.exitX, route.exitY, function() {
      // After reaching the exit tile, the server will transfer us
      // Wait for the map transfer to complete before taking the next step
      step++;
      if (step < path.length) {
        // Wait a moment for the map transfer
        setTimeout(nextStep, 1500);
      } else {
        console.log('Arrived at map #' + targetMap);
      }
    });
  }

  nextStep();
}

client.connect();
```

---

## Map Tile Data

When the server sends `0x15`, the tile data is automatically parsed and stored on `client.map`. Each tile has:

| Field | Type | What It Is |
|-------|------|-----------|
| `bg` | uint16 | Background tile number (floor, ground) |
| `xfg` | int16 | Foreground X tile (walls, objects) — signed |
| `uxfg` | uint16 | Same as xfg but unsigned |
| `yfg` | int16 | Foreground Y tile — signed |
| `uyfg` | uint16 | Same as yfg but unsigned |

`xfg`/`uxfg` and `yfg`/`uyfg` are the same 2 bytes read as signed vs unsigned. This matters for checking if a tile is "empty" (negative values typically mean no foreground).

### Reading Tile Data

```js
// After connecting, map data accumulates on client.map
// Access tiles for a given row:
var row = client.map.getMapData(0); // row 0
if (row) {
  console.log('First tile bg:', row.tiles[0].bg);
  console.log('First tile foreground:', row.tiles[0].xfg, row.tiles[0].yfg);
}
```

### Checking If a Tile Is Walkable

A quick heuristic — tiles with foreground values often indicate walls or obstacles:

```js
function isWalkable(row, col) {
  var data = client.map.getMapData(row);
  if (!data || !data.tiles[col]) return false;
  var tile = data.tiles[col];
  // Tiles with no foreground (negative xfg) are usually walkable
  return tile.xfg <= 0 && tile.yfg <= 0;
}
```

This is an approximation. The real walkability depends on the game's tile definitions, which are in the game's data files.

---

## Saving and Loading Maps

You can save captured map data to disk (little-endian format) and reload it later:

```js
const { Map } = require('./');

// Save current map to a file
client.map.Width = 100;   // set dimensions first
client.map.Height = 100;
client.map.save('map500.dat');

// Load a map from file
const map = new Map(100, 100);
map.load('map500.dat');

// Check a tile
var row = map.getMapData(5);
console.log(row.tiles[10].bg);
```

**Important:** Maps are stored on disk in **little-endian** format but received from the server in **big-endian**. The library handles this conversion automatically — `fromPacket()` reads big-endian from the network, `fromBuffer()`/`toBuffer()` use little-endian for files.

---

## Requesting Map Data

If you need to force the server to re-send map data (e.g. after a map change), send opcode `0x05`:

```js
function requestMapData() {
  client.send(new Packet(0x05));
}
```

---

## Full Example: Walk-to-Coordinate Bot

A complete bot that logs in and walks to a target coordinate:

```js
const { Client, Packet } = require('./');

const client = new Client('YourUsername', 'YourPassword');

let myX = 0;
let myY = 0;

client.events.on(0x04, function(packet) {
  myX = packet.readUInt16();
  myY = packet.readUInt16();
  console.log('Position: (' + myX + ', ' + myY + ')');
});

function walk(dir) {
  const p = new Packet(0x06);
  p.writeByte(dir);
  client.send(p);
}

function walkTo(x, y) {
  const timer = setInterval(function() {
    if (myX === x && myY === y) {
      console.log('Arrived at (' + x + ', ' + y + ')');
      clearInterval(timer);
      return;
    }
    if (myX < x) walk(1);
    else if (myX > x) walk(3);
    else if (myY < y) walk(2);
    else if (myY > y) walk(0);
  }, 300);
}

// After fully logged in, walk to (25, 30)
client.events.on(0x05, function() {
  setTimeout(function() { walkTo(25, 30); }, 2000);
});

client.connect();
```

---

## Tips for Fast Travel

1. **Walk speed:** 300ms between steps is safe. Going below 200ms risks dropped walks.
2. **Straight-line first:** Walk one axis at a time (all X, then all Y). This avoids diagonal collision issues.
3. **Map exits are at edges:** Most map transitions happen when you walk to row 0 (north edge), the last row (south edge), column 0 (west edge), or last column (east edge). Doors are exceptions.
4. **Wait after map transfers:** After stepping through a map exit, wait for `0x58` (MapTransferComplete) before walking again. If you walk too early the server will ignore it.
5. **Build route tables:** The fastest way to navigate is to pre-map the exit coordinates between maps and chain them together using the route system shown above.
6. **Use map data for pathfinding:** The tile data on `client.map` tells you which tiles have walls. You can build a proper A* pathfinder around obstacles instead of walking in straight lines.
