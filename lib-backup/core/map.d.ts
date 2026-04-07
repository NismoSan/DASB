import type Packet from './packet';
import type { MapData } from '../types';
export default class GameMap {
    Width: number;
    Height: number;
    mapData_: Record<number, MapData>;
    constructor(width?: number, height?: number);
    addMapData(mapData: MapData): void;
    getMapData(index: number): MapData | undefined;
    static fromPacket(packet: Packet): MapData;
    fromBuffer(buffer: Buffer): void;
    toBuffer(): Buffer;
    save(filePath: string): Promise<void>;
    load(filePath: string): Promise<void>;
}
