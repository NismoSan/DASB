import { uint8, uint16, int16, uint32, int32 } from './datatypes';
import { toHex } from './util';
import iconv from 'iconv-lite';

export default class Packet {
  opcode: number;
  sequence: number;
  position: number;
  body: number[];

  constructor(arg: number | number[]) {
    if (typeof arg === 'number') {
      this.opcode = arg;
      this.sequence = 0;
      this.position = 0;
      this.body = [];
    } else {
      this.opcode = arg[3];
      this.sequence = 0;
      this.position = 0;
      this.body = Array.from(arg.slice(4));
    }
  }

  header(): number[] {
    const packetLength = this.body.length + 4;
    return [
      0xAA,
      uint8((packetLength - 3) >> 8),
      uint8(packetLength - 3),
      this.opcode
    ];
  }

  bodyWithHeader(): number[] {
    return this.header().concat(this.body);
  }

  buffer(): Buffer {
    return Buffer.from(this.bodyWithHeader());
  }

  toString(): string {
    return this.bodyWithHeader()
      .map(byte => toHex(byte))
      .join(' ');
  }

  remainder(): number {
    return this.body.length - this.position;
  }

  read(length: number): number[] | 0 {
    if (this.position + length > this.body.length) {
      return 0;
    }
    const buffer = this.body.slice(this.position, this.position + length);
    this.position += length;
    return buffer;
  }

  readByte(): number {
    if (this.position + 1 > this.body.length) {
      return 0;
    }
    const value = this.body[this.position];
    this.position += 1;
    return value;
  }

  readInt16(): number {
    if (this.position + 2 > this.body.length) {
      return 0;
    }
    const value = this.body[this.position] << 8 | this.body[this.position + 1];
    this.position += 2;
    return value;
  }

  peekInt16(): number {
    if (this.position + 2 > this.body.length) {
      return 0;
    }
    const value = this.body[this.position] << 8 | this.body[this.position + 1];
    return value;
  }

  readUInt16(): number {
    if (this.position + 2 > this.body.length) {
      return 0;
    }
    const value = this.body[this.position] << 8 | this.body[this.position + 1];
    this.position += 2;
    return value;
  }

  readInt32(): number {
    if (this.position + 4 > this.body.length) {
      return 0;
    }
    const value = (
      this.body[this.position] << 24 |
      this.body[this.position + 1] << 16 |
      this.body[this.position + 2] << 8 |
      this.body[this.position + 3]
    );
    this.position += 4;
    return int32(value);
  }

  readUInt32(): number {
    if (this.position + 4 > this.body.length) {
      return 0;
    }
    const value = (
      this.body[this.position] << 24 |
      this.body[this.position + 1] << 16 |
      this.body[this.position + 2] << 8 |
      this.body[this.position + 3]
    );
    this.position += 4;
    return value;
  }

  readString8(): string {
    if (this.position + 1 > this.body.length) {
      return '';
    }
    const length = this.body[this.position];
    const position = this.position + 1;
    if (position + length > this.body.length) {
      return '';
    }
    const buffer = this.body.slice(position, position + length);
    this.position += length + 1;
    return iconv.decode(Buffer.from(buffer), 'win1252');
  }

  readString16(): string {
    if (this.position + 2 > this.body.length) {
      return '';
    }
    const length = this.body[this.position] << 8 | this.body[this.position + 1];
    const position = this.position + 2;
    if (position + length > this.body.length) {
      return '';
    }
    const buffer = this.body.slice(position, position + length);
    this.position += length + 2;
    return iconv.decode(Buffer.from(buffer), 'win1252');
  }

  write(buffer: number[]): void {
    this.body = this.body.concat(buffer);
  }

  writeByte(value: number): void {
    this.body.push(uint8(value));
  }

  writeInt16(value: number): void {
    value = int16(value);
    this.body.push((value >> 8) & 0xFF);
    this.body.push(value & 0xFF);
  }

  writeUInt16(value: number): void {
    value = uint16(value);
    this.body.push((value >> 8) & 0xFF);
    this.body.push(value & 0xFF);
  }

  writeInt32(value: number): void {
    value = int32(value);
    this.body.push((value >> 24) & 0xFF);
    this.body.push((value >> 16) & 0xFF);
    this.body.push((value >> 8) & 0xFF);
    this.body.push(value & 0xFF);
  }

  writeUInt32(value: number): void {
    value = uint32(value);
    this.body.push((value >> 24) & 0xFF);
    this.body.push((value >> 16) & 0xFF);
    this.body.push((value >> 8) & 0xFF);
    this.body.push(value & 0xFF);
  }

  writeString(value: string): void {
    const buffer: number[] = Array.from(iconv.encode(value, 'win1252'));
    this.body = this.body.concat(buffer);
    this.position += buffer.length;
  }

  writeString8(value: string): void {
    const buffer: number[] = Array.from(iconv.encode(value, 'win1252'));
    this.body.push(buffer.length);
    this.body = this.body.concat(buffer);
    this.position += buffer.length + 1;
  }

  writeString16(value: string): void {
    const buffer: number[] = Array.from(iconv.encode(value, 'win1252'));
    this.body.push((buffer.length >> 8) & 0xFF);
    this.body.push(buffer.length & 0xFF);
    this.body = this.body.concat(buffer);
    this.position += buffer.length + 2;
  }
}
