import type { TileData } from '../../types';
declare const UNKNOWN = 0;
declare const WALKABLE = 1;
declare const BLOCKED = 2;
export default class CollisionMap {
    private grids;
    private dimensions;
    readonly dataDir: string;
    private sotp;
    constructor(dataDir?: string);
    loadSotp(filePath: string): Promise<boolean>;
    isTileSolid(tileId: number): boolean;
    buildFromMapFile(mapId: number, width: number, height: number, mapFilePath: string): Promise<boolean>;
    buildFromTileData(mapId: number, width: number, height: number, rows: Record<number, {
        tiles: TileData[];
    }>): void;
    setDimensions(mapId: number, width: number, height: number): void;
    hasGrid(mapId: number): boolean;
    private getGrid;
    private getDims;
    get(mapId: number, x: number, y: number): number;
    isWalkable(mapId: number, x: number, y: number): boolean;
    set(mapId: number, x: number, y: number, walkable: boolean): void;
    markWalkable(mapId: number, x: number, y: number): void;
    markBlocked(mapId: number, x: number, y: number): void;
    clearBlocked(mapId: number, x: number, y: number): void;
    save(mapId: number): Promise<void>;
    load(mapId: number): Promise<boolean>;
    loadAll(): Promise<void>;
}
export { UNKNOWN, WALKABLE, BLOCKED };
