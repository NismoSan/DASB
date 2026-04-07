"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const datatypes_1 = require("./datatypes");
const util_1 = require("./util");
const iconv_lite_1 = __importDefault(require("iconv-lite"));
class Packet {
    opcode;
    sequence;
    position;
    body;
    constructor(arg) {
        if (typeof arg === 'number') {
            this.opcode = arg;
            this.sequence = 0;
            this.position = 0;
            this.body = [];
        }
        else {
            this.opcode = arg[3];
            this.sequence = 0;
            this.position = 0;
            this.body = Array.from(arg.slice(4));
        }
    }
    header() {
        const packetLength = this.body.length + 4;
        return [
            0xAA,
            (0, datatypes_1.uint8)((packetLength - 3) >> 8),
            (0, datatypes_1.uint8)(packetLength - 3),
            this.opcode
        ];
    }
    bodyWithHeader() {
        return this.header().concat(this.body);
    }
    buffer() {
        return Buffer.from(this.bodyWithHeader());
    }
    toString() {
        return this.bodyWithHeader()
            .map(byte => (0, util_1.toHex)(byte))
            .join(' ');
    }
    remainder() {
        return this.body.length - this.position;
    }
    read(length) {
        if (this.position + length > this.body.length) {
            return 0;
        }
        const buffer = this.body.slice(this.position, this.position + length);
        this.position += length;
        return buffer;
    }
    readByte() {
        if (this.position + 1 > this.body.length) {
            return 0;
        }
        const value = this.body[this.position];
        this.position += 1;
        return value;
    }
    readInt16() {
        if (this.position + 2 > this.body.length) {
            return 0;
        }
        const value = this.body[this.position] << 8 | this.body[this.position + 1];
        this.position += 2;
        return value;
    }
    peekInt16() {
        if (this.position + 2 > this.body.length) {
            return 0;
        }
        const value = this.body[this.position] << 8 | this.body[this.position + 1];
        return value;
    }
    readUInt16() {
        if (this.position + 2 > this.body.length) {
            return 0;
        }
        const value = this.body[this.position] << 8 | this.body[this.position + 1];
        this.position += 2;
        return value;
    }
    readInt32() {
        if (this.position + 4 > this.body.length) {
            return 0;
        }
        const value = (this.body[this.position] << 24 |
            this.body[this.position + 1] << 16 |
            this.body[this.position + 2] << 8 |
            this.body[this.position + 3]);
        this.position += 4;
        return (0, datatypes_1.int32)(value);
    }
    readUInt32() {
        if (this.position + 4 > this.body.length) {
            return 0;
        }
        const value = (this.body[this.position] << 24 |
            this.body[this.position + 1] << 16 |
            this.body[this.position + 2] << 8 |
            this.body[this.position + 3]);
        this.position += 4;
        return value;
    }
    readString8() {
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
        return iconv_lite_1.default.decode(Buffer.from(buffer), 'win1252');
    }
    readString16() {
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
        return iconv_lite_1.default.decode(Buffer.from(buffer), 'win1252');
    }
    write(buffer) {
        this.body = this.body.concat(buffer);
    }
    writeByte(value) {
        this.body.push((0, datatypes_1.uint8)(value));
    }
    writeInt16(value) {
        value = (0, datatypes_1.int16)(value);
        this.body.push((value >> 8) & 0xFF);
        this.body.push(value & 0xFF);
    }
    writeUInt16(value) {
        value = (0, datatypes_1.uint16)(value);
        this.body.push((value >> 8) & 0xFF);
        this.body.push(value & 0xFF);
    }
    writeInt32(value) {
        value = (0, datatypes_1.int32)(value);
        this.body.push((value >> 24) & 0xFF);
        this.body.push((value >> 16) & 0xFF);
        this.body.push((value >> 8) & 0xFF);
        this.body.push(value & 0xFF);
    }
    writeUInt32(value) {
        value = (0, datatypes_1.uint32)(value);
        this.body.push((value >> 24) & 0xFF);
        this.body.push((value >> 16) & 0xFF);
        this.body.push((value >> 8) & 0xFF);
        this.body.push(value & 0xFF);
    }
    writeString(value) {
        const buffer = Array.from(iconv_lite_1.default.encode(value, 'win1252'));
        this.body = this.body.concat(buffer);
        this.position += buffer.length;
    }
    writeString8(value) {
        const buffer = Array.from(iconv_lite_1.default.encode(value, 'win1252'));
        this.body.push(buffer.length);
        this.body = this.body.concat(buffer);
        this.position += buffer.length + 1;
    }
    writeString16(value) {
        const buffer = Array.from(iconv_lite_1.default.encode(value, 'win1252'));
        this.body.push((buffer.length >> 8) & 0xFF);
        this.body.push(buffer.length & 0xFF);
        this.body = this.body.concat(buffer);
        this.position += buffer.length + 2;
    }
}
exports.default = Packet;
//# sourceMappingURL=packet.js.map