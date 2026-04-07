import { FieldDef } from '../core/opcodes';

export interface DecodedField {
  name: string;
  type: string;
  value: any;
  hex: string;
  offset: number;
  length: number;
}

function toHexByte(b: number): string {
  return ('0' + (b & 0xFF).toString(16).toUpperCase()).slice(-2);
}

export function hexToBytes(hex: string): number[] {
  return hex.trim().split(/\s+/).map(function (b) { return parseInt(b, 16); });
}

export function bytesToHex(bytes: number[]): string {
  return bytes.map(toHexByte).join(' ');
}

export function decodePacket(hexDump: string, fieldDefs: FieldDef[]): DecodedField[] {
  const bytes = hexToBytes(hexDump);
  let pos = 0;
  const result: DecodedField[] = [];

  for (const field of fieldDefs) {
    if (pos >= bytes.length) break;

    const offset = pos;

    switch (field.type) {
      case 'Byte': {
        const val = bytes[pos];
        result.push({ name: field.name, type: 'Byte', value: val, hex: toHexByte(val), offset, length: 1 });
        pos += 1;
        break;
      }
      case 'Bool': {
        const val = bytes[pos] !== 0;
        result.push({ name: field.name, type: 'Bool', value: val, hex: toHexByte(bytes[pos]), offset, length: 1 });
        pos += 1;
        break;
      }
      case 'UInt16': {
        if (pos + 1 >= bytes.length) break;
        const val = (bytes[pos] << 8) | bytes[pos + 1];
        result.push({ name: field.name, type: 'UInt16', value: val, hex: toHexByte(bytes[pos]) + ' ' + toHexByte(bytes[pos + 1]), offset, length: 2 });
        pos += 2;
        break;
      }
      case 'Int16': {
        if (pos + 1 >= bytes.length) break;
        let val = (bytes[pos] << 8) | bytes[pos + 1];
        if (val >= 0x8000) val -= 0x10000;
        result.push({ name: field.name, type: 'Int16', value: val, hex: toHexByte(bytes[pos]) + ' ' + toHexByte(bytes[pos + 1]), offset, length: 2 });
        pos += 2;
        break;
      }
      case 'UInt32': {
        if (pos + 3 >= bytes.length) break;
        const val = ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0;
        const hex = [bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]].map(toHexByte).join(' ');
        result.push({ name: field.name, type: 'UInt32', value: val, hex, offset, length: 4 });
        pos += 4;
        break;
      }
      case 'Int32': {
        if (pos + 3 >= bytes.length) break;
        const val = (bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
        const hex = [bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]].map(toHexByte).join(' ');
        result.push({ name: field.name, type: 'Int32', value: val, hex, offset, length: 4 });
        pos += 4;
        break;
      }
      case 'String8': {
        const len = bytes[pos];
        if (pos + 1 + len > bytes.length) {
          result.push({ name: field.name, type: 'String8', value: '(truncated)', hex: toHexByte(len), offset, length: 1 });
          pos = bytes.length;
          break;
        }
        const strBytes = bytes.slice(pos + 1, pos + 1 + len);
        const str = Buffer.from(strBytes).toString('latin1');
        const hex = bytes.slice(pos, pos + 1 + len).map(toHexByte).join(' ');
        result.push({ name: field.name, type: 'String8', value: str, hex, offset, length: 1 + len });
        pos += 1 + len;
        break;
      }
      case 'String16': {
        if (pos + 1 >= bytes.length) break;
        const len = (bytes[pos] << 8) | bytes[pos + 1];
        if (pos + 2 + len > bytes.length) {
          result.push({ name: field.name, type: 'String16', value: '(truncated)', hex: toHexByte(bytes[pos]) + ' ' + toHexByte(bytes[pos + 1]), offset, length: 2 });
          pos = bytes.length;
          break;
        }
        const strBytes = bytes.slice(pos + 2, pos + 2 + len);
        const str = Buffer.from(strBytes).toString('latin1');
        const hex = bytes.slice(pos, pos + 2 + len).map(toHexByte).join(' ');
        result.push({ name: field.name, type: 'String16', value: str, hex, offset, length: 2 + len });
        pos += 2 + len;
        break;
      }
      case 'IPv4': {
        if (pos + 3 >= bytes.length) break;
        const ip = `${bytes[pos]}.${bytes[pos + 1]}.${bytes[pos + 2]}.${bytes[pos + 3]}`;
        const hex = bytes.slice(pos, pos + 4).map(toHexByte).join(' ');
        result.push({ name: field.name, type: 'IPv4', value: ip, hex, offset, length: 4 });
        pos += 4;
        break;
      }
      case 'Bytes': {
        const len = field.length ? parseInt(field.length, 10) : (bytes.length - pos);
        const actual = Math.min(len, bytes.length - pos);
        const slice = bytes.slice(pos, pos + actual);
        const hex = slice.map(toHexByte).join(' ');
        result.push({ name: field.name, type: 'Bytes', value: slice, hex, offset, length: actual });
        pos += actual;
        break;
      }
      default: {
        // Unknown field type, consume one byte
        result.push({ name: field.name, type: field.type, value: bytes[pos], hex: toHexByte(bytes[pos]), offset, length: 1 });
        pos += 1;
      }
    }
  }

  // Append any remaining undecoded bytes
  if (pos < bytes.length) {
    const remainder = bytes.slice(pos);
    result.push({
      name: '_remainder',
      type: 'raw',
      value: remainder,
      hex: remainder.map(toHexByte).join(' '),
      offset: pos,
      length: remainder.length
    });
  }

  return result;
}
