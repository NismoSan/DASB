"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OUTGOING_LABELS = exports.INCOMING_LABELS = exports.CLASS_NAMES = exports.opcodeEvents = void 0;
exports.reloadFromXml = reloadFromXml;
exports.getOpcodeLabel = getOpcodeLabel;
exports.getChatChannelName = getChatChannelName;
exports.getPublicMessageTypeName = getPublicMessageTypeName;
exports.getFieldDefinitions = getFieldDefinitions;
exports.getAllOpcodes = getAllOpcodes;
exports.toHex = toHex;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const events_1 = __importDefault(require("events"));
const fast_xml_parser_1 = require("fast-xml-parser");
const XML_PATH = path_1.default.join(__dirname, '../../data/opcodes.xml');
exports.opcodeEvents = new events_1.default();
// These MUST remain the same object references across reloads
// so all require() consumers see updated values without re-importing
const INCOMING_LABELS = {};
exports.INCOMING_LABELS = INCOMING_LABELS;
const OUTGOING_LABELS = {};
exports.OUTGOING_LABELS = OUTGOING_LABELS;
const FIELD_DEFS = new Map();
function parseOpcodeHex(hex) {
    return parseInt(hex, 16);
}
function loadFromXml() {
    const xml = fs_1.default.readFileSync(XML_PATH, 'utf-8');
    const parser = new fast_xml_parser_1.XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '',
        isArray: (name) => name === 'opcode' || name === 'field' || name === 'opcodes'
    });
    const doc = parser.parse(xml);
    // Clear existing keys (mutate in place so cached require() refs stay valid)
    for (const key of Object.keys(INCOMING_LABELS))
        delete INCOMING_LABELS[key];
    for (const key of Object.keys(OUTGOING_LABELS))
        delete OUTGOING_LABELS[key];
    FIELD_DEFS.clear();
    const opcodeSections = doc.protocol.opcodes;
    if (!opcodeSections)
        return;
    for (const section of opcodeSections) {
        const direction = section.direction;
        const target = direction === 'in' ? INCOMING_LABELS : OUTGOING_LABELS;
        const entries = section.opcode;
        if (!entries)
            continue;
        for (const entry of entries) {
            const code = parseOpcodeHex(entry.hex);
            target[code] = entry.name;
            if (entry.field) {
                const fields = entry.field.map((f) => ({
                    name: f.name,
                    type: f.type,
                    length: f.length || undefined,
                    description: f.description || undefined
                }));
                FIELD_DEFS.set(`${direction}:${code}`, fields);
            }
        }
    }
    console.log(`[Opcodes] Loaded ${Object.keys(INCOMING_LABELS).length} incoming, ${Object.keys(OUTGOING_LABELS).length} outgoing from XML`);
}
// Exported so panel.js can trigger a manual reload
function reloadFromXml() {
    loadFromXml();
    exports.opcodeEvents.emit('reload');
    console.log('[Opcodes] Hot-reloaded from XML');
}
// Initial load
try {
    loadFromXml();
}
catch (e) {
    console.error(`[Opcodes] Failed to load XML: ${e.message}`);
}
// File watcher with debounce
let reloadTimer = null;
try {
    fs_1.default.watch(XML_PATH, (_eventType) => {
        if (reloadTimer)
            return;
        reloadTimer = setTimeout(() => {
            reloadTimer = null;
            try {
                loadFromXml();
                exports.opcodeEvents.emit('reload');
                console.log('[Opcodes] Hot-reloaded from XML');
            }
            catch (e) {
                console.error(`[Opcodes] Hot-reload failed: ${e.message}`);
            }
        }, 300);
    });
}
catch (e) {
    console.error(`[Opcodes] Could not watch XML file: ${e.message}`);
}
// ── Existing API (unchanged signatures) ──────────────────────────
function getOpcodeLabel(direction, opcode) {
    const table = direction === 'in' ? INCOMING_LABELS : OUTGOING_LABELS;
    return table[opcode] || 'Unknown';
}
function getChatChannelName(byte) {
    switch (byte) {
        case 0: return 'Whisper';
        case 3: return 'System';
        case 5: return 'World Shout';
        case 11: return 'Group';
        case 12: return 'Guild';
        default: return 'Ch' + byte;
    }
}
function getPublicMessageTypeName(byte) {
    switch (byte) {
        case 0: return 'Say';
        case 1: return 'Shout';
        case 2: return 'Chant';
        default: return 'Public';
    }
}
function toHex(value) {
    return '0x' + ('0' + value.toString(16).toUpperCase()).slice(-2);
}
exports.CLASS_NAMES = { 0: 'Peasant', 1: 'Warrior', 2: 'Rogue', 3: 'Wizard', 4: 'Priest', 5: 'Monk' };
// ── New API for MCP / packet analysis ────────────────────────────
function getFieldDefinitions(direction, opcode) {
    return FIELD_DEFS.get(`${direction}:${opcode}`);
}
function getAllOpcodes() {
    const result = [];
    for (const [code, name] of Object.entries(INCOMING_LABELS)) {
        const opcode = Number(code);
        result.push({ direction: 'in', opcode, name, fields: FIELD_DEFS.get(`in:${opcode}`) });
    }
    for (const [code, name] of Object.entries(OUTGOING_LABELS)) {
        const opcode = Number(code);
        result.push({ direction: 'out', opcode, name, fields: FIELD_DEFS.get(`out:${opcode}`) });
    }
    return result;
}
//# sourceMappingURL=opcodes.js.map