import fs from 'fs';
import type Packet from './packet';
import type { TileData, MapData } from '../types';

export default class GameMap {
  Width: number;
  Height: number;
  mapData_: Record<number, MapData>;

  constructor(width?: number, height?: number) {
    this.Width = width || 0;
    this.Height = height || 0;
    this.mapData_ = {};
  }

  addMapData(mapData: MapData): void {
    this.mapData_[mapData.index] = mapData;
  }

  getMapData(index: number): MapData | undefined {
    return this.mapData_[index];
  }

  static fromPacket(packet: Packet): MapData {
    const index = packet.readUInt16();
    const tiles: TileData[] = [];
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

  fromBuffer(buffer: Buffer): void {
    let offset = -2;

    for (let y = 0; y < this.Height; ++y) {
      const tiles: TileData[] = [];

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

  toBuffer(): Buffer {
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

  save(filePath: string): Promise<void> {
    const buffer = this.toBuffer();
    return fs.promises.writeFile(filePath, buffer);
  }

  load(filePath: string): Promise<void> {
    return fs.promises.readFile(filePath).then((buffer) => {
      this.fromBuffer(buffer);
    });
  }
}
