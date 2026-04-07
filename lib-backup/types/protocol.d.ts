export interface TileData {
    bg: number;
    xfg: number;
    uxfg: number;
    yfg: number;
    uyfg: number;
}
export interface MapData {
    index: number;
    tiles: TileData[];
}
export interface ServerInfo {
    address: string;
    port: number;
    name: string;
}
