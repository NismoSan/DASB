"use strict";
// ── NPC Leak Scanner ────────────────────────────────────────────
// Spams clicks on an NPC to attempt to trigger a memory overflow
// that leaks player HP/MP data via opcode 0x6A sub 0x33.
// Logs ALL incoming packets during the spam session for analysis.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.init = init;
exports.start = start;
exports.stop = stop;
exports.handleIncomingPacket = handleIncomingPacket;
exports.getStatus = getStatus;
exports.getLog = getLog;
const packet_1 = __importDefault(require("../core/packet"));
const util_1 = require("../core/util");
// ── State ───────────────────────────────────────────────────────
const session = {
    active: false,
    targetSerial: 0,
    targetName: '',
    lookupName: '',
    clickCount: 0,
    maxClicks: 20,
    clickIntervalMs: 500,
    startedAt: 0,
    timer: null,
    log: [],
    leaksFound: []
};
let sendPacketFn = null;
let onLeakFound = null;
let onLogEntry = null;
let onSessionUpdate = null;
// ── Init ────────────────────────────────────────────────────────
function init(opts) {
    sendPacketFn = opts.sendPacket;
    onLeakFound = opts.onLeakFound || null;
    onLogEntry = opts.onLogEntry || null;
    onSessionUpdate = opts.onSessionUpdate || null;
    console.log('[NpcLeak] Initialized');
}
// ── Start / Stop ────────────────────────────────────────────────
function start(opts) {
    if (!sendPacketFn)
        return { ok: false, error: 'Not initialized' };
    if (session.active)
        return { ok: false, error: 'Session already active' };
    if (!opts.serial)
        return { ok: false, error: 'No target serial provided' };
    session.active = true;
    session.targetSerial = opts.serial;
    session.targetName = opts.name || ('Serial_' + opts.serial.toString(16));
    session.lookupName = opts.lookupName || '';
    session.clickCount = 0;
    session.maxClicks = opts.maxClicks || 20;
    session.clickIntervalMs = opts.intervalMs || 500;
    session.startedAt = Date.now();
    session.log = [];
    session.leaksFound = [];
    console.log('[NpcLeak] ═══════════════════════════════════════════════════');
    console.log('[NpcLeak] Session started');
    console.log('[NpcLeak]   Target: ' + session.targetName + ' (serial 0x' + session.targetSerial.toString(16).toUpperCase() + ')');
    if (session.lookupName) {
        console.log('[NpcLeak]   Lookup name: ' + session.lookupName);
    }
    console.log('[NpcLeak]   Max clicks: ' + session.maxClicks);
    console.log('[NpcLeak]   Interval: ' + session.clickIntervalMs + 'ms');
    console.log('[NpcLeak] ═══════════════════════════════════════════════════');
    emitStatus();
    // Send first click immediately, then start interval
    sendNpcClick();
    session.timer = setInterval(function () {
        if (session.clickCount >= session.maxClicks) {
            stop();
            return;
        }
        sendNpcClick();
    }, session.clickIntervalMs);
    return { ok: true };
}
function stop() {
    if (session.timer) {
        clearInterval(session.timer);
        session.timer = null;
    }
    if (session.active) {
        const elapsed = Date.now() - session.startedAt;
        console.log('[NpcLeak] ═══════════════════════════════════════════════════');
        console.log('[NpcLeak] Session ended');
        console.log('[NpcLeak]   Clicks sent: ' + session.clickCount);
        console.log('[NpcLeak]   Duration: ' + (elapsed / 1000).toFixed(1) + 's');
        console.log('[NpcLeak]   Packets logged: ' + session.log.length);
        console.log('[NpcLeak]   Leaks found: ' + session.leaksFound.length);
        if (session.leaksFound.length > 0) {
            console.log('[NpcLeak] ── LEAK DATA ──────────────────────────────────');
            session.leaksFound.forEach(function (leak, i) {
                console.log('[NpcLeak]   #' + (i + 1) + ': ' + leak.parsedName + ' → ' + leak.parsedData);
                console.log('[NpcLeak]        Raw: ' + leak.fullPayload);
            });
        }
        console.log('[NpcLeak] ═══════════════════════════════════════════════════');
    }
    session.active = false;
    emitStatus();
}
// ── NPC Click ───────────────────────────────────────────────────
function sendNpcClick() {
    if (!sendPacketFn)
        return;
    session.clickCount++;
    // 0x43 with subcommand 0x01 = click on entity by serial
    // If lookupName is set, append it as string8 after the serial
    const pkt = new packet_1.default(0x43);
    pkt.writeByte(0x01); // click type
    pkt.writeUInt32(session.targetSerial); // NPC serial
    if (session.lookupName) {
        pkt.writeString8(session.lookupName); // player name to look up
    }
    const elapsed = Date.now() - session.startedAt;
    const nameTag = session.lookupName ? ' [' + session.lookupName + ']' : '';
    console.log('[NpcLeak] ▶ Click #' + session.clickCount + '/' + session.maxClicks +
        ' on 0x' + session.targetSerial.toString(16).toUpperCase() + nameTag +
        ' (elapsed ' + (elapsed / 1000).toFixed(1) + 's)');
    logPacket('sent', 0x43, pkt.body, 'NPC click #' + session.clickCount);
    sendPacketFn(pkt);
    emitStatus();
}
// ── Incoming Packet Handlers ────────────────────────────────────
// Call this for EVERY incoming packet during a session to log it
function handleIncomingPacket(opcode, packet) {
    if (!session.active)
        return;
    const savedPos = packet.position;
    const bodyBytes = packet.body.slice();
    packet.position = savedPos;
    const hexBody = bodyBytes.map(function (b) { return (0, util_1.toHex)(b); }).join(' ');
    const elapsed = Date.now() - session.startedAt;
    // Summarize known opcodes
    let summary = 'opcode 0x' + opcode.toString(16).toUpperCase();
    if (opcode === 0x2F) {
        const dEnd = findDialogEnd(bodyBytes);
        const overflow = dEnd > 0 ? bodyBytes.length - dEnd : 0;
        summary = overflow > 1 ? 'NPC Dialog +' + overflow + 'b OVERFLOW' : 'NPC Dialog response';
    }
    else if (opcode === 0x3A)
        summary = 'HealthBar update';
    else if (opcode === 0x1A)
        summary = 'Animation';
    else if (opcode === 0x0A)
        summary = 'Chat message';
    else if (opcode === 0x0C)
        summary = 'Entity walk';
    else if (opcode === 0x33)
        summary = 'ShowUser';
    else if (opcode === 0x39)
        summary = 'UpdateStats';
    else if (opcode === 0x6A)
        summary = '*** 0x6A PACKET ***';
    logPacket('recv', opcode, bodyBytes, summary);
    // ── Check for 0x6A sub 0x33 (the leak) ─────────────────────
    if (opcode === 0x6A) {
        console.log('[NpcLeak] ★★★ GOT 0x6A PACKET! ★★★');
        console.log('[NpcLeak]   Full body (' + bodyBytes.length + ' bytes): ' + hexBody);
        parse6APacket(bodyBytes, elapsed);
    }
    // ── Check for ANY unexpected opcode ────────────────────────
    // These are opcodes we wouldn't normally expect from NPC clicking
    const expectedOpcodes = [0x2F, 0x1A, 0x3A, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x11, 0x33, 0x39, 0x3B, 0x68];
    if (expectedOpcodes.indexOf(opcode) === -1) {
        console.log('[NpcLeak] ⚠ UNEXPECTED opcode 0x' + opcode.toString(16).toUpperCase() +
            ' (' + bodyBytes.length + ' bytes)');
        console.log('[NpcLeak]   Payload: ' + hexBody);
    }
    // ── Check 0x2F for anomalies ──────────────────────────────
    // Normal NPC dialog is predictable. If we see extra/garbled data, log it.
    if (opcode === 0x2F) {
        packet.position = savedPos;
        analyzeNpcDialog(packet, bodyBytes, elapsed);
        packet.position = savedPos;
    }
}
// ── 0x6A Parser ─────────────────────────────────────────────────
function parse6APacket(body, elapsed) {
    const hexBody = body.map(function (b) { return (0, util_1.toHex)(b); }).join(' ');
    // Look for subcommand 0x33
    if (body.length > 0 && body[0] === 0x33) {
        console.log('[NpcLeak] ★ 0x6A subcommand 0x33 confirmed!');
        // Try to parse: 6A 33 <len> <name> <data>
        let pos = 1;
        if (pos < body.length) {
            const len = body[pos];
            pos++;
            console.log('[NpcLeak]   Name length: ' + len);
            if (pos + len <= body.length) {
                const nameBytes = body.slice(pos, pos + len);
                const name = String.fromCharCode.apply(null, nameBytes);
                pos += len;
                console.log('[NpcLeak]   Name: "' + name + '"');
                // Everything after the name is the leaked data
                const remainingBytes = body.slice(pos);
                const remainingHex = remainingBytes.map(function (b) { return (0, util_1.toHex)(b); }).join(' ');
                console.log('[NpcLeak]   Leaked data (' + remainingBytes.length + ' bytes): ' + remainingHex);
                // Try to interpret as HP/MP values
                let parsedData = 'raw: ' + remainingHex;
                if (remainingBytes.length >= 4) {
                    const val1 = (remainingBytes[0] << 8) | remainingBytes[1];
                    const val2 = (remainingBytes[2] << 8) | remainingBytes[3];
                    parsedData = 'HP=' + val1 + ' MP=' + val2 + ' (speculative) | raw: ' + remainingHex;
                    console.log('[NpcLeak]   Possible HP=' + val1 + ' MP=' + val2);
                }
                if (remainingBytes.length >= 8) {
                    const val1_32 = (remainingBytes[0] << 24) | (remainingBytes[1] << 16) | (remainingBytes[2] << 8) | remainingBytes[3];
                    const val2_32 = (remainingBytes[4] << 24) | (remainingBytes[5] << 16) | (remainingBytes[6] << 8) | remainingBytes[7];
                    console.log('[NpcLeak]   As 32-bit: ' + val1_32 + ' / ' + val2_32);
                }
                const leak = {
                    timestamp: Date.now(),
                    elapsed: elapsed,
                    opcode: 0x6A,
                    subcommand: 0x33,
                    rawHex: hexBody,
                    parsedName: name,
                    parsedData: parsedData,
                    fullPayload: hexBody
                };
                session.leaksFound.push(leak);
                if (onLeakFound)
                    onLeakFound(leak);
            }
        }
    }
    else {
        // Different subcommand — still log everything
        console.log('[NpcLeak] ★ 0x6A subcommand 0x' + (body.length > 0 ? body[0].toString(16).toUpperCase() : '??'));
        console.log('[NpcLeak]   Full payload: ' + hexBody);
        // Scan the entire body for ASCII strings (possible leaked names)
        const frags = extractFragments(body);
        if (frags.strings.length > 0) {
            console.log('[NpcLeak]   Strings in 0x6A: ' + JSON.stringify(frags.strings));
        }
    }
}
// ── 0x2F Overflow Detection ─────────────────────────────────────
// The NPC dialog payload always ends with the last menu option.
// We find the end marker "0D 37" (Daily Token Exchange terminator)
// and everything after that is leaked server memory.
function findDialogEnd(body) {
    // Search for the sequence 0D 37 which terminates the last menu item
    // "Daily Token Exchange" = 14 44 61 69 6C 79 ... 65 0D 37
    // We search backwards from the end for robustness
    for (let i = body.length - 2; i >= 0; i--) {
        if (body[i] === 0x0D && body[i + 1] === 0x37) {
            return i + 2; // position after the 0D 37
        }
    }
    return -1; // not found — might not be a standard dialog
}
function analyzeNpcDialog(_packet, body, elapsed) {
    const dialogEnd = findDialogEnd(body);
    if (dialogEnd === -1)
        return; // can't find end marker
    // Everything after dialogEnd is overflow
    const overflowBytes = body.slice(dialogEnd);
    if (overflowBytes.length <= 1)
        return; // 1 trailing byte is normal (terminator varies)
    const overflowHex = overflowBytes.map(function (b) { return (0, util_1.toHex)(b); }).join(' ');
    console.log('[NpcLeak] ★ 0x2F OVERFLOW! ' + overflowBytes.length + ' leaked bytes');
    console.log('[NpcLeak]   Overflow hex: ' + overflowHex);
    // Extract ASCII strings from overflow
    const fragments = extractFragments(overflowBytes);
    // Log ASCII fragments
    if (fragments.strings.length > 0) {
        console.log('[NpcLeak]   Leaked strings: ' + JSON.stringify(fragments.strings));
    }
    // Build parsed summary
    const parts = [];
    if (fragments.strings.length > 0) {
        parts.push('strings: ' + fragments.strings.join(' | '));
    }
    if (fragments.binaryBlocks.length > 0) {
        parts.push('binary blocks: ' + fragments.binaryBlocks.length);
    }
    const leak = {
        timestamp: Date.now(),
        elapsed: elapsed,
        opcode: 0x2F,
        subcommand: 0,
        rawHex: overflowHex,
        parsedName: fragments.strings.length > 0 ? fragments.strings[0] : '(binary)',
        parsedData: parts.join(' // '),
        fullPayload: overflowHex
    };
    session.leaksFound.push(leak);
    if (onLeakFound)
        onLeakFound(leak);
    emitStatus();
}
// Split overflow into ASCII string runs and binary blocks
function extractFragments(data) {
    const strings = [];
    const binaryBlocks = [];
    let currentStr = '';
    let currentBin = [];
    for (let i = 0; i < data.length; i++) {
        const b = data[i];
        if (b >= 0x20 && b <= 0x7E) {
            // Flush binary block if we had one
            if (currentBin.length > 0) {
                binaryBlocks.push(currentBin);
                currentBin = [];
            }
            currentStr += String.fromCharCode(b);
        }
        else {
            // Flush string if we had one
            if (currentStr.length >= 3) {
                strings.push(currentStr);
            }
            currentStr = '';
            currentBin.push(b);
        }
    }
    if (currentStr.length >= 3)
        strings.push(currentStr);
    if (currentBin.length > 0)
        binaryBlocks.push(currentBin);
    // Filter out known NPC dialog fragments that might bleed into overflow
    const knownStrings = [
        'Celesta', 'Hello', 'What can I do for you', 'Deposit', 'Withdraw',
        'Fix Item', 'Fix All', 'Avid Daydreamer', 'Daily Kill', 'Daily Token',
        'can only take'
    ];
    const filtered = strings.filter(function (s) {
        return !knownStrings.some(function (k) { return s.indexOf(k) !== -1 || k.indexOf(s) !== -1; });
    });
    return { strings: filtered, binaryBlocks: binaryBlocks };
}
// scanForStrings replaced by extractFragments in analyzeNpcDialog
// ── Logging ─────────────────────────────────────────────────────
function logPacket(direction, opcode, body, summary) {
    const elapsed = Date.now() - session.startedAt;
    const entry = {
        timestamp: Date.now(),
        elapsed: elapsed,
        direction: direction,
        opcode: opcode,
        opcodeHex: '0x' + opcode.toString(16).toUpperCase(),
        bodyLength: body.length,
        summary: summary,
        rawHex: body.map(function (b) { return (0, util_1.toHex)(b); }).join(' '),
        payloadHex: body.map(function (b) { return (0, util_1.toHex)(b); }).join(' ')
    };
    session.log.push(entry);
    if (onLogEntry)
        onLogEntry(entry);
}
// ── Status ──────────────────────────────────────────────────────
function emitStatus() {
    if (onSessionUpdate) {
        onSessionUpdate(getStatus());
    }
}
function getStatus() {
    return {
        active: session.active,
        targetName: session.targetName,
        targetSerial: session.active ? '0x' + session.targetSerial.toString(16).toUpperCase() : '',
        clickCount: session.clickCount,
        maxClicks: session.maxClicks,
        packetsLogged: session.log.length,
        leaksFound: session.leaksFound.length,
        elapsed: session.active ? Date.now() - session.startedAt : 0,
        leaks: session.leaksFound
    };
}
function getLog() {
    return session.log;
}
//# sourceMappingURL=npc-leak.js.map