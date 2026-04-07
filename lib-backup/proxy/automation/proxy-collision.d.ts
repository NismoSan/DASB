declare const UNKNOWN = 0;
declare const WALKABLE = 1;
declare const BLOCKED = 2;
/**
 * Server-accurate collision system for the proxy.
 *
 * Builds collision grids from two sources:
 * 1. LIVE 0x3C MapTransfer packets (same tile data the real game client receives)
 * 2. Local .map files as fallback (when client has map cached and server skips 0x3C)
 *
 * Collision logic matches the real DA server exactly:
 *   tile is blocked if isTileSolid(xfg) || isTileSolid(yfg)
 *   where isTileSolid(id) = id > 0 && sotp[(id-1) >> 3] & (1 << ((id-1) & 7))
 */
export default class ProxyCollision {
    private sotp;
    private grids;
    private dimensions;
    private pendingRows;
    private mapsDir;
    /**
     * Load SOTP (Solid Tile Property) data — the same BitArray the server uses.
     * Bit N means foreground tile ID (N+1) is solid.
     */
    loadSotp(filePath: string): Promise<boolean>;
    /**
     * Check if a foreground tile ID is solid according to SOTP data.
     * This is identical to how the real DA server checks walkability.
     */
    isTileSolid(tileId: number): boolean;
    /**
     * Set the directory containing local lod*.map files for fallback collision loading.
     */
    setMapsDir(dir: string): void;
    /**
     * Called when proxy intercepts 0x15 MapInfo — sets up dimensions for tile data collection.
     * Also attempts to load collision from a local .map file as fallback
     * (the server often skips 0x3C when the client has the map cached).
     */
    onMapInfo(mapId: number, width: number, height: number): void;
    /**
     * Called when proxy intercepts a 0x3C MapTransfer row.
     * Tile data bytes: each tile is 6 bytes in network byte order (big-endian):
     *   [bg:u16] [xfg:u16] [yfg:u16]
     *
     * Note: Packet.readUInt16() reads big-endian. The intercepted body is the
     * post-decrypt packet body after the rowY field.
     */
    onTileDataRow(mapId: number, rowY: number, tileBytes: number[]): void;
    /**
     * Build the collision grid from collected 0x3C tile rows.
     * Can also be called manually to build from partial data.
     */
    buildFromPendingRows(mapId: number): void;
    /**
     * Force-build whatever rows we have so far (for maps where not all rows arrive).
     */
    finalizePending(mapId: number): void;
    /**
     * Build collision grid from a local .map file (raw tile data: 6 bytes per tile, LE).
     * Format per tile: bg(u16LE) + xfg(u16LE) + yfg(u16LE), row-major order.
     * Used as fallback when the server doesn't send 0x3C tile data.
     */
    buildFromMapFile(mapId: number, width: number, height: number): boolean;
    /**
     * Mark known map exit tiles as walkable, regardless of SOTP.
     * Door/warp tiles are "solid" in SOTP (decorative sprites) but the server
     * treats them as walkable — transitions are triggered by overlap, not blockage.
     */
    markExitsWalkable(mapId: number, exits: {
        x: number;
        y: number;
    }[]): void;
    hasGrid(mapId: number): boolean;
    getDimensions(mapId: number): {
        width: number;
        height: number;
    } | undefined;
    get(mapId: number, x: number, y: number): number;
    isWalkable(mapId: number, x: number, y: number): boolean;
    setDimensions(mapId: number, width: number, height: number): void;
    markBlocked(mapId: number, x: number, y: number): void;
    markWalkable(mapId: number, x: number, y: number): void;
}
export { UNKNOWN, WALKABLE, BLOCKED };
