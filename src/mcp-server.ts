// @ts-nocheck
import 'dotenv/config';

var { Server } = require('@modelcontextprotocol/sdk/server/index.js');
var { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
var { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
var fs = require('fs');
var path = require('path');
var { decodePacket, hexToBytes } = require('./mcp/packet-decoder');
var { analyzePacket, comparePackets } = require('./mcp/pattern-analyzer');
var opcodes = require('./core/opcodes');
var packetStore = require('./features/packet-store');

var PROJECT_ROOT = path.join(__dirname, '..');

// ── Tool definitions (raw JSON Schema, no Zod) ──────────────────

var tools = [
  {
    name: 'list_opcodes',
    description: 'List all known Dark Ages network opcodes with their names, directions, and field definitions. Reloads from XML first to get latest.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['in', 'out'], description: 'Filter by direction: in = server-to-client, out = client-to-server' }
      }
    }
  },
  {
    name: 'decode_packet',
    description: 'Decode a packet hex dump using known field definitions from the opcode XML. Returns structured field-by-field breakdown.',
    inputSchema: {
      type: 'object',
      properties: {
        opcode: { type: 'number', description: 'Packet opcode (decimal, e.g. 4 for 0x04)' },
        direction: { type: 'string', enum: ['in', 'out'], description: 'Packet direction: in = server-to-client, out = client-to-server' },
        hex: { type: 'string', description: 'Hex dump of packet body (space-separated bytes, e.g. "00 0A 05 48 65 6C 6C 6F")' }
      },
      required: ['opcode', 'direction', 'hex']
    }
  },
  {
    name: 'analyze_packet',
    description: 'Heuristically analyze an unknown packet hex dump. Detects String8 patterns, UInt16/32 values, coordinates, entity serials. Useful for reverse-engineering undocumented opcodes.',
    inputSchema: {
      type: 'object',
      properties: {
        hex: { type: 'string', description: 'Hex dump of packet body (space-separated bytes)' },
        opcode: { type: 'number', description: 'Opcode if known (decimal)' },
        direction: { type: 'string', enum: ['in', 'out'], description: 'Direction if known' }
      },
      required: ['hex']
    }
  },
  {
    name: 'search_packets',
    description: 'Search captured packets from the proxy system stored in the database. Filter by opcode, direction, character name, or time range.',
    inputSchema: {
      type: 'object',
      properties: {
        opcode: { type: 'number', description: 'Filter by opcode (decimal)' },
        direction: { type: 'string', enum: ['client-to-server', 'server-to-client'], description: 'Filter by direction' },
        character: { type: 'string', description: 'Filter by character name' },
        since: { type: 'string', description: 'ISO timestamp for start of time range (e.g. "2025-01-15T00:00:00Z")' },
        limit: { type: 'number', description: 'Max results (default 50, max 200)' }
      }
    }
  },
  {
    name: 'get_packet_stats',
    description: 'Get statistics about captured packets: frequency by opcode, unknown opcodes, average sizes. Useful for identifying which opcodes need documentation.',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'string', description: 'ISO timestamp for start of time range' }
      }
    }
  },
  {
    name: 'save_opcode_definition',
    description: 'Add or update an opcode definition in the protocol XML file. The XML will be hot-reloaded automatically after saving.',
    inputSchema: {
      type: 'object',
      properties: {
        opcode: { type: 'number', description: 'Opcode number (decimal, e.g. 4 for 0x04)' },
        direction: { type: 'string', enum: ['in', 'out'], description: 'Direction: in = server-to-client, out = client-to-server' },
        name: { type: 'string', description: 'Human-readable name for the opcode (e.g. "MapLocation")' },
        fields: {
          type: 'array',
          description: 'Field definitions for packet body parsing',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Field name' },
              type: { type: 'string', enum: ['Byte', 'UInt16', 'UInt32', 'Int16', 'Int32', 'String8', 'String16', 'Bool', 'IPv4', 'Bytes'], description: 'Field type' },
              length: { type: 'string', description: 'Fixed length for Bytes type' },
              description: { type: 'string', description: 'Field description' }
            }
          }
        }
      },
      required: ['opcode', 'direction', 'name']
    }
  },
  {
    name: 'compare_packets',
    description: 'Compare multiple packet hex dumps of the same opcode to identify fixed vs variable byte positions. Useful for reverse-engineering packet structure.',
    inputSchema: {
      type: 'object',
      properties: {
        hex_dumps: { type: 'array', items: { type: 'string' }, description: 'Array of hex dump strings to compare (minimum 2)' },
        opcode: { type: 'number', description: 'Opcode if known (decimal)' },
        direction: { type: 'string', enum: ['in', 'out'], description: 'Direction if known' }
      },
      required: ['hex_dumps']
    }
  }
];

// ── Tool handlers ────────────────────────────────────────────────

var toolHandlers = {
  list_opcodes: async function (args) {
    opcodes.reloadFromXml();
    var all = opcodes.getAllOpcodes();
    if (args.direction) {
      all = all.filter(function (o) { return o.direction === args.direction; });
    }
    var lines = all.map(function (o) {
      var hex = '0x' + o.opcode.toString(16).toUpperCase().padStart(2, '0');
      var dir = o.direction === 'in' ? 'S->C' : 'C->S';
      var fields = o.fields ? o.fields.map(function (f) { return f.name + ':' + f.type; }).join(', ') : '(no fields defined)';
      return hex + ' ' + dir + ' ' + o.name + ' [' + fields + ']';
    });
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },

  decode_packet: async function (args) {
    var fields = opcodes.getFieldDefinitions(args.direction, args.opcode);
    var label = opcodes.getOpcodeLabel(args.direction, args.opcode);
    var hexStr = '0x' + args.opcode.toString(16).toUpperCase().padStart(2, '0');

    if (!fields) {
      return {
        content: [{
          type: 'text',
          text: 'No field definitions found for opcode ' + hexStr + ' (' + label + ') direction=' + args.direction + '.\nUse analyze_packet for heuristic analysis, or save_opcode_definition to add field definitions.'
        }]
      };
    }

    var decoded = decodePacket(args.hex, fields);
    var lines = ['Decoded ' + hexStr + ' ' + label + ' (' + args.direction + '):\n'];
    for (var i = 0; i < decoded.length; i++) {
      var field = decoded[i];
      lines.push('  [offset ' + field.offset + '] ' + field.name + ' (' + field.type + '): ' + JSON.stringify(field.value) + '  |  ' + field.hex);
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },

  analyze_packet: async function (args) {
    var suggestions = analyzePacket(args.hex);
    var header = args.opcode !== undefined
      ? 'Analysis of opcode 0x' + args.opcode.toString(16).toUpperCase().padStart(2, '0') + ' (' + (args.direction || 'unknown dir') + '):'
      : 'Packet analysis:';

    var bytes = hexToBytes(args.hex);
    var lines = [header, 'Total bytes: ' + bytes.length + '\n'];
    for (var i = 0; i < suggestions.length; i++) {
      var s = suggestions[i];
      lines.push('  [offset ' + s.offset + ', ' + s.length + 'B] ' + s.suggestedType + ' "' + s.suggestedName + '" = ' + JSON.stringify(s.value) + ' (' + s.confidence + ') - ' + s.reason);
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },

  search_packets: async function (args) {
    var rows = packetStore.searchPacketCaptures(args);

    if (rows.length === 0) {
      return { content: [{ type: 'text', text: 'No packets found matching filters.' }] };
    }

    var lines = ['Found ' + rows.length + ' packets:\n'];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var hexStr = '0x' + r.opcode.toString(16).toUpperCase().padStart(2, '0');
      var ts = r.captured_at || '?';
      lines.push('[' + ts + '] ' + (r.direction === 'client-to-server' ? 'C->S' : 'S->C') + ' ' + hexStr + ' ' + (r.opcode_name || 'Unknown') + ' (' + r.body_length + 'B) char=' + (r.character_name || '?'));
      if (r.hex_body) {
        lines.push('  hex: ' + r.hex_body);
      }
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },

  get_packet_stats: async function (args) {
    var stats = packetStore.getPacketStats(args.since);

    var lines = ['Total captured packets: ' + stats.totalPackets + '\n', 'Breakdown by opcode:\n'];
    for (var i = 0; i < stats.byOpcode.length; i++) {
      var r = stats.byOpcode[i];
      var hexStr = '0x' + r.opcode.toString(16).toUpperCase().padStart(2, '0');
      var dir = r.direction === 'client-to-server' ? 'C->S' : 'S->C';
      var name = r.opcodeName || 'Unknown';
      var isUnknown = name === 'Unknown';
      lines.push('  ' + hexStr + ' ' + dir + ' ' + name + ' - ' + r.count + ' packets, avg ' + r.avgLength + 'B' + (isUnknown ? ' [UNDOCUMENTED]' : ''));
    }

    var unknownOpcodes = stats.byOpcode.filter(function (r) { return !r.opcodeName || r.opcodeName === 'Unknown'; });
    if (unknownOpcodes.length > 0) {
      lines.push('\nUndocumented opcodes needing analysis:');
      for (var j = 0; j < unknownOpcodes.length; j++) {
        var u = unknownOpcodes[j];
        var uHex = '0x' + u.opcode.toString(16).toUpperCase().padStart(2, '0');
        lines.push('  ' + uHex + ' (' + u.direction + ') - ' + u.count + ' samples available');
      }
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },

  save_opcode_definition: async function (args) {
    var xmlPath = path.join(PROJECT_ROOT, 'data/opcodes.xml');
    var xml = fs.readFileSync(xmlPath, 'utf-8');

    var hexStr = '0x' + args.opcode.toString(16).toUpperCase().padStart(2, '0');
    var dir = args.direction;

    // Build the new opcode XML element
    var opcodeXml = '';
    if (args.fields && args.fields.length > 0) {
      var fieldLines = args.fields.map(function (f) {
        var attrs = 'name="' + f.name + '" type="' + f.type + '"';
        if (f.length) attrs += ' length="' + f.length + '"';
        if (f.description) attrs += ' description="' + f.description + '"';
        return '      <field ' + attrs + ' />';
      });
      opcodeXml = '    <opcode hex="' + hexStr + '" name="' + args.name + '">\n' + fieldLines.join('\n') + '\n    </opcode>';
    } else {
      opcodeXml = '    <opcode hex="' + hexStr + '" name="' + args.name + '" />';
    }

    // Find the right section and check if opcode already exists
    var sectionRegex = new RegExp('(<opcodes direction="' + dir + '">)([\\s\\S]*?)(</opcodes>)');
    var sectionMatch = xml.match(sectionRegex);

    if (!sectionMatch) {
      return { content: [{ type: 'text', text: 'Error: Could not find <opcodes direction="' + dir + '"> section in XML.' }] };
    }

    var existingRegex = new RegExp('\\s*<opcode hex="' + hexStr + '"[^>]*(?:/>|>[\\s\\S]*?</opcode>)');
    var sectionContent = sectionMatch[2];

    var newSectionContent;
    if (existingRegex.test(sectionContent)) {
      newSectionContent = sectionContent.replace(existingRegex, '\n' + opcodeXml);
    } else {
      newSectionContent = sectionContent + opcodeXml + '\n  ';
    }

    xml = xml.replace(sectionRegex, '$1' + newSectionContent + '$3');
    fs.writeFileSync(xmlPath, xml, 'utf-8');

    try {
      opcodes.reloadFromXml();
    } catch (_e) {
      // watcher will catch it
    }

    return {
      content: [{
        type: 'text',
        text: 'Saved opcode ' + hexStr + ' "' + args.name + '" (' + dir + ') with ' + (args.fields ? args.fields.length : 0) + ' field definitions. XML hot-reloaded.'
      }]
    };
  },

  compare_packets: async function (args) {
    var result = comparePackets(args.hex_dumps);
    var lines = [result.summary, ''];

    if (result.variablePositions.length > 0) {
      lines.push('Variable byte offsets (likely data fields): ' + result.variablePositions.join(', '));
    }
    if (result.fixedPositions.length > 0) {
      lines.push('Fixed byte offsets (likely constants/flags): ' + result.fixedPositions.join(', '));
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  }
};

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  var server = new Server(
    { name: 'dasb-protocol', version: '1.0.0' },
    { capabilities: { tools: {}, resources: {} } }
  );

  // Handle tools/list
  server.setRequestHandler(ListToolsRequestSchema, async function () {
    return { tools: tools };
  });

  // Handle tools/call
  server.setRequestHandler(CallToolRequestSchema, async function (request) {
    var name = request.params.name;
    var args = request.params.arguments || {};
    var handler = toolHandlers[name];
    if (!handler) {
      return { content: [{ type: 'text', text: 'Unknown tool: ' + name }], isError: true };
    }
    try {
      return await handler(args);
    } catch (err) {
      return { content: [{ type: 'text', text: 'Error: ' + err.message }], isError: true };
    }
  });

  // Handle resources/list
  var protoDocPath = path.join(PROJECT_ROOT, 'DARKAGES-PROTOCOL.md');
  var hasProtocolDoc = fs.existsSync(protoDocPath);

  server.setRequestHandler(ListResourcesRequestSchema, async function () {
    var resources = [];
    if (hasProtocolDoc) {
      resources.push({
        uri: 'file:///protocol-reference',
        name: 'Dark Ages Protocol Reference',
        mimeType: 'text/markdown'
      });
    }
    return { resources: resources };
  });

  // Handle resources/read
  server.setRequestHandler(ReadResourceRequestSchema, async function (request) {
    if (request.params.uri === 'file:///protocol-reference' && hasProtocolDoc) {
      var content = fs.readFileSync(protoDocPath, 'utf-8');
      return { contents: [{ uri: 'file:///protocol-reference', mimeType: 'text/markdown', text: content }] };
    }
    return { contents: [] };
  });

  // Connect via stdio
  var transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP] dasb-protocol server started on stdio');
}

main().catch(function (err) {
  console.error('[MCP] Fatal error:', err);
  process.exit(1);
});
