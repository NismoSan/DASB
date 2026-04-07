# da.js — Plain English Guide

## What Is This?

**Dark Ages** is a 2D online RPG (think old-school MMO). This project — **da.js** — is a tool that lets you connect to the Dark Ages game servers *without* the actual game client. Instead, you write a small script that acts like a player. People use this to build **bots** — programs that can automatically log in, respond to messages, or do other things in the game.

Think of it like a remote control for a Dark Ages character, operated through code instead of clicking around in the game.

---

## What Do I Need to Run This?

You need **Node.js** installed on your computer. Node.js is a program that lets you run JavaScript code outside of a web browser.

### Step 1: Install Node.js

1. Go to https://nodejs.org
2. Download the **LTS** version (the one that says "Recommended for most users")
3. Run the installer — just click Next through everything, the defaults are fine
4. To verify it worked, open a terminal:
   - On Windows: press `Win + R`, type `cmd`, hit Enter
   - On Mac: open the **Terminal** app (search for it in Spotlight)
5. Type this and hit Enter:
   ```
   node --version
   ```
   If you see a version number like `v18.17.0`, you're good.

### Step 2: Install the Project's Dependencies

Open a terminal and navigate to the project folder. If the project is on your Desktop:

```
cd "C:\Users\Third\OneDrive\Desktop\da.js-master\da.js-master"
```

Then run:

```
npm install
```

This downloads all the extra code the project needs to work. You'll see a `node_modules` folder appear — that's normal, don't touch it.

### Step 3: Build the Project

The source code needs to be converted into a format Node.js can run:

```
npm run build
```

This creates a `lib/` folder with the compiled code. You only need to do this once (or again if you change anything in the `src/` folder).

---

## How to Run a Bot

You write a small JavaScript file (your bot script), then run it with Node.

### Step 1: Create Your Bot Script

Create a new file in the project folder called something like `mybot.js`. Open it in any text editor (Notepad works fine) and paste this:

```js
const { Client, Packet } = require('./');

const client = new Client('YourUsername', 'YourPassword');

client.connect();
```

Replace `YourUsername` and `YourPassword` with your actual Dark Ages account credentials.

That's it — this is the simplest possible bot. It will log in to the game and just sit there.

### Step 2: Run It

In your terminal (make sure you're still in the project folder):

```
node mybot.js
```

You should see log messages about connecting and logging in. To stop it, press `Ctrl + C`.

---

## What Happens When You Run It

Here's what the bot does behind the scenes when you call `client.connect()`:

1. **Connects** to the Dark Ages login server over the internet
2. **Shakes hands** with the server — they agree on an encryption method so no one can eavesdrop
3. **Gets redirected** to the actual game server (there's a login server and separate game world servers)
4. **Sends your username and password** (encrypted)
5. **Enters the game world** — your character is now "online"
6. **Stays connected** by automatically responding to the server's "are you still there?" pings

If the connection drops, it automatically tries to reconnect.

---

## Making Your Bot Do Things

The bot can listen for things happening in the game and react to them. The game communicates using numbered message types called **opcodes**. Each opcode means something different (a chat message, a player moving, a spell being cast, etc.).

### Example: Auto-Reply Bot

This bot listens for whispers and replies "pong" to anyone who whispers "ping":

```js
const { Client, Packet } = require('./');

const client = new Client('YourUsername', 'YourPassword');

// Listen for chat/whisper messages (opcode 0x0A)
client.events.on(0x0A, function(packet) {
  var channel = packet.readByte();
  var message = packet.readString16();
  var parts = message.split('" ');
  var name = parts[0];
  var whisper = parts[1];

  if (whisper === 'ping') {
    // Build a whisper-back message (opcode 0x19)
    var response = new Packet(0x19);
    response.writeString8(name);    // who to whisper to
    response.writeString8('pong');  // what to say
    client.send(response);          // send it
  }
});

client.connect();
```

### How Listening Works

```js
client.events.on(OPCODE_NUMBER, function(packet, client) {
  // This code runs every time a message with that opcode arrives
  // Use packet.readByte(), packet.readString8(), etc. to pull data out
});
```

### How Sending Works

```js
var packet = new Packet(OPCODE_NUMBER);      // Create a new message of a certain type
packet.writeString8('some text');             // Put data into it
packet.writeByte(42);                         // More data
client.send(packet);                          // Send it to the server
```

---

## Reading Data from Packets

When the server sends you a packet, you read the data out of it in order, like pulling items out of a tube one at a time:

| Method | What It Reads |
|--------|---------------|
| `packet.readByte()` | A single number (0-255) |
| `packet.readInt16()` | A number (-32768 to 32767) |
| `packet.readUInt16()` | A number (0 to 65535) |
| `packet.readInt32()` | A large number (positive or negative) |
| `packet.readUInt32()` | A large positive number |
| `packet.readString8()` | A short text string |
| `packet.readString16()` | A longer text string |

Each time you call one of these, it moves forward — so the order you read must match the order the server packed the data in.

## Writing Data to Packets

When building a packet to send, you add data in the order the server expects:

| Method | What It Writes |
|--------|----------------|
| `packet.writeByte(value)` | A single number (0-255) |
| `packet.writeInt16(value)` | A number |
| `packet.writeUInt16(value)` | A positive number |
| `packet.writeInt32(value)` | A large number |
| `packet.writeUInt32(value)` | A large positive number |
| `packet.writeString8(text)` | A short text string |
| `packet.writeString16(text)` | A longer text string |

---

## Debugging

If something isn't working and you want to see what's being sent and received, you can turn on packet logging:

```js
client.logOutgoing = true;   // shows everything the bot sends
client.logIncoming = true;   // shows everything the bot receives
```

This will print raw data to your terminal so you can see exactly what's going on.

---

## The Game Servers

The bot connects to these servers automatically:

| Server | What It's For |
|--------|---------------|
| Login Server | Where you log in (connects here first) |
| Temuair | The main game world |
| Medenia | The expansion game world |

You don't need to worry about which server to connect to — the library handles the redirects automatically.

---

## Project Files at a Glance

| File/Folder | What It Is |
|-------------|------------|
| `src/` | The actual source code (you'd modify these if you wanted to change how the library works) |
| `lib/` | Auto-generated from `src/` by the build step — don't edit these directly |
| `node_modules/` | Downloaded dependencies — don't touch this |
| `index.js` | The main entry point that ties everything together |
| `package.json` | Project info and settings |
| `mybot.js` | Your bot script (you create this yourself) |

---

## Quick Reference

```
npm install          Install dependencies (do this first, once)
npm run build        Compile the source code (do this once, or after editing src/)
node mybot.js        Run your bot script
Ctrl + C             Stop the bot
```

---

## Common Issues

**"Cannot find module" error** — You probably forgot to run `npm install` or `npm run build`. Run both and try again.

**Bot connects then immediately disconnects** — Your username or password might be wrong. Double-check them in your script.

**Bot connects but nothing happens** — That's normal if you haven't added any event listeners. The bot is online, just not doing anything. Add `client.events.on(...)` handlers to make it react to things.

**"ECONNREFUSED" error** — The game server might be down, or your internet connection might be blocking the connection. Some networks/firewalls block non-standard ports.
