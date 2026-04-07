import { hexToBytes, bytesToHex } from './packet-decoder';

export interface PatternSuggestion {
  offset: number;
  length: number;
  suggestedType: string;
  suggestedName: string;
  confidence: 'high' | 'medium' | 'low';
  value: any;
  hex: string;
  reason: string;
}

function isPrintable(b: number): boolean {
  return b >= 0x20 && b <= 0x7E;
}

export function analyzePacket(hexDump: string): PatternSuggestion[] {
  const bytes = hexToBytes(hexDump);
  const suggestions: PatternSuggestion[] = [];
  const consumed = new Set<number>();
  let fieldIndex = 1;

  // Pass 1: Detect String8 patterns (length byte followed by N printable chars)
  for (let i = 0; i < bytes.length - 1; i++) {
    if (consumed.has(i)) continue;
    const len = bytes[i];
    if (len >= 2 && len <= 200 && i + 1 + len <= bytes.length) {
      const strBytes = bytes.slice(i + 1, i + 1 + len);
      const printableCount = strBytes.filter(isPrintable).length;
      if (printableCount >= len * 0.8) {
        const str = Buffer.from(strBytes).toString('latin1');
        suggestions.push({
          offset: i,
          length: 1 + len,
          suggestedType: 'String8',
          suggestedName: 'String' + fieldIndex++,
          confidence: printableCount === len ? 'high' : 'medium',
          value: str,
          hex: bytesToHex(bytes.slice(i, i + 1 + len)),
          reason: `Byte at offset ${i} = ${len}, followed by ${printableCount}/${len} printable characters: "${str}"`
        });
        for (let j = i; j < i + 1 + len; j++) consumed.add(j);
      }
    }
  }

  // Pass 2: Detect UInt32 serials (values > 0x10000, common for entity IDs)
  for (let i = 0; i <= bytes.length - 4; i++) {
    if (consumed.has(i) || consumed.has(i + 1) || consumed.has(i + 2) || consumed.has(i + 3)) continue;
    const val = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
    if (val > 0x10000 && val < 0xFFFFFFFF && bytes[i] !== 0x00) {
      suggestions.push({
        offset: i,
        length: 4,
        suggestedType: 'UInt32',
        suggestedName: 'Serial' + fieldIndex++,
        confidence: 'medium',
        value: val,
        hex: bytesToHex(bytes.slice(i, i + 4)),
        reason: `4-byte value 0x${val.toString(16).toUpperCase()} at offset ${i} looks like an entity serial`
      });
      for (let j = i; j < i + 4; j++) consumed.add(j);
    }
  }

  // Pass 3: Detect coordinate-like UInt16 pairs (both values 0-255, common for x,y)
  for (let i = 0; i <= bytes.length - 4; i++) {
    if (consumed.has(i) || consumed.has(i + 1) || consumed.has(i + 2) || consumed.has(i + 3)) continue;
    const v1 = (bytes[i] << 8) | bytes[i + 1];
    const v2 = (bytes[i + 2] << 8) | bytes[i + 3];
    if (v1 <= 255 && v2 <= 255 && (v1 > 0 || v2 > 0)) {
      suggestions.push({
        offset: i,
        length: 4,
        suggestedType: 'UInt16+UInt16',
        suggestedName: 'Coords' + fieldIndex++,
        confidence: 'low',
        value: { x: v1, y: v2 },
        hex: bytesToHex(bytes.slice(i, i + 4)),
        reason: `Two UInt16 values (${v1}, ${v2}) at offset ${i} could be X,Y coordinates`
      });
      for (let j = i; j < i + 4; j++) consumed.add(j);
    }
  }

  // Pass 4: Detect remaining UInt16 values
  for (let i = 0; i <= bytes.length - 2; i++) {
    if (consumed.has(i) || consumed.has(i + 1)) continue;
    const val = (bytes[i] << 8) | bytes[i + 1];
    if (val > 0 && val < 0xFFFF) {
      suggestions.push({
        offset: i,
        length: 2,
        suggestedType: 'UInt16',
        suggestedName: 'Field' + fieldIndex++,
        confidence: 'low',
        value: val,
        hex: bytesToHex(bytes.slice(i, i + 2)),
        reason: `UInt16 value ${val} (0x${val.toString(16).toUpperCase()}) at offset ${i}`
      });
      for (let j = i; j < i + 2; j++) consumed.add(j);
    }
  }

  // Pass 5: Flag remaining unconsumed bytes
  for (let i = 0; i < bytes.length; i++) {
    if (consumed.has(i)) continue;
    suggestions.push({
      offset: i,
      length: 1,
      suggestedType: 'Byte',
      suggestedName: 'Unknown' + fieldIndex++,
      confidence: 'low',
      value: bytes[i],
      hex: bytesToHex([bytes[i]]),
      reason: `Single byte 0x${bytes[i].toString(16).toUpperCase()} at offset ${i}`
    });
  }

  // Sort by offset
  suggestions.sort(function (a, b) { return a.offset - b.offset; });

  return suggestions;
}

export function comparePackets(hexDumps: string[]): {
  fixedPositions: number[];
  variablePositions: number[];
  commonLength: boolean;
  lengths: number[];
  summary: string;
} {
  const allBytes = hexDumps.map(hexToBytes);
  const lengths = allBytes.map(function (b) { return b.length; });
  const minLen = Math.min(...lengths);
  const commonLength = lengths.every(function (l) { return l === lengths[0]; });

  const fixedPositions: number[] = [];
  const variablePositions: number[] = [];

  for (let i = 0; i < minLen; i++) {
    const val = allBytes[0][i];
    const isFixed = allBytes.every(function (b) { return b[i] === val; });
    if (isFixed) {
      fixedPositions.push(i);
    } else {
      variablePositions.push(i);
    }
  }

  const summary = [
    `Compared ${hexDumps.length} packets.`,
    commonLength ? `All packets are ${lengths[0]} bytes.` : `Lengths vary: ${lengths.join(', ')} bytes.`,
    `${fixedPositions.length} fixed byte positions, ${variablePositions.length} variable positions.`,
    variablePositions.length > 0 ? `Variable at offsets: ${variablePositions.join(', ')}` : 'All bytes are identical across samples.'
  ].join(' ');

  return { fixedPositions, variablePositions, commonLength, lengths, summary };
}
