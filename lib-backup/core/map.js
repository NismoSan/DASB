"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
class GameMap {
    Width;
    Height;
    mapData_;
    constructor(width, height) {
        this.Width = width || 0;
        this.Height = height || 0;
        this.mapData_ = {};
    }
    addMapData(mapData) {
        this.mapData_[mapData.index] = mapData;
    }
    getMapData(index) {
        return this.mapData_[index];
    }
    static fromPacket(packet) {
        const index = packet.readUInt16();
        const tiles = [];
        const length = Math.floor(packet.remainder() / 6);
        for (let x = 0; x < length; ++x) {
            const bg = packet.readUInt16();
            const xfg = packet.peekInt16();
            const uxfg = packet.readUInt16();
            const yfg = packet.peekInt16();
            const uyfg = packet.readUInt16();
            tiles.push({ bg, xfg, uxfg, yfg, uyfg });
        }
        return { index, tiles };
    }
    fromBuffer(buffer) {
        let offset = -2;
        for (let y = 0; y < this.Height; ++y) {
            const tiles = [];
            for (let x = 0; x < this.Width; ++x) {
                const bg = buffer.readUInt16LE(offset += 2);
                const xfg = buffer.readInt16LE(offset += 2);
                const uxfg = buffer.readUInt16LE(offset);
                const yfg = buffer.readInt16LE(offset += 2);
                const uyfg = buffer.readUInt16LE(offset);
                tiles.push({ bg, xfg, uxfg, yfg, uyfg });
            }
            this.addMapData({ index: y, tiles });
        }
    }
    toBuffer() {
        const buffer = Buffer.alloc(this.Width * this.Height * 6);
        let offset = 0;
        for (const y in this.mapData_) {
            for (const x in this.mapData_[y].tiles) {
                offset = buffer.writeUInt16LE(this.mapData_[y].tiles[x].bg, offset);
                offset = buffer.writeUInt16LE(this.mapData_[y].tiles[x].xfg, offset);
                offset = buffer.writeUInt16LE(this.mapData_[y].tiles[x].yfg, offset);
            }
        }
        return buffer;
    }
    save(filePath) {
        const buffer = this.toBuffer();
        return fs_1.default.promises.writeFile(filePath, buffer);
    }
    load(filePath) {
        return fs_1.default.promises.readFile(filePath).then((buffer) => {
            this.fromBuffer(buffer);
        });
    }
}
exports.default = GameMap;
//# sourceMappingURL=map.js.map