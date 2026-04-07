"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BLOCKED = exports.WALKABLE = exports.UNKNOWN = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const UNKNOWN = 0;
exports.UNKNOWN = UNKNOWN;
const WALKABLE = 1;
exports.WALKABLE = WALKABLE;
const BLOCKED = 2;
exports.BLOCKED = BLOCKED;
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
class ProxyCollision {
    sotp = null;
    grids = new Map();
    dimensions = new Map();
    // Track which rows have been received for the current map load
    pendingRows = new Map(); // mapId -> (rowY -> tileBytes)
    mapsDir = './src/features/navigator/maps';
    /**
     * Load SOTP (Solid Tile Property) data — the same BitArray the server uses.
     * Bit N means foreground tile ID (N+1) is solid.
     */
    async loadSotp(filePath) {
        try {
            this.sotp = await fs_1.default.promises.readFile(filePath);
            console.log(`[ProxyCollision] Loaded SOTP: ${this.sotp.length} bytes (${this.sotp.length * 8} tile IDs)`);
            return true;
        }
        catch {
            console.log(`[ProxyCollision] No SOTP file at ${filePath}`);
            return false;
        }
    }
    /**
     * Check if a foreground tile ID is solid according to SOTP data.
     * This is identical to how the real DA server checks walkability.
     */
    isTileSolid(tileId) {
        if (!this.sotp || tileId <= 0)
            return false;
        const idx = tileId - 1;
        const byteIdx = idx >> 3;
        const bitIdx = idx & 7;
        if (byteIdx >= this.sotp.length)
            return false;
        return (this.sotp[byteIdx] & (1 << bitIdx)) !== 0;
    }
    /**
     * Set the directory containing local lod*.map files for fallback collision loading.
     */
    setMapsDir(dir) {
        this.mapsDir = dir;
    }
    /**
     * Called when proxy intercepts 0x15 MapInfo — sets up dimensions for tile data collection.
     * Also attempts to load collision from a local .map file as fallback
     * (the server often skips 0x3C when the client has the map cached).
     */
    onMapInfo(mapId, width, height) {
        this.dimensions.set(mapId, { width, height });
        // Start collecting tile rows for this map
        this.pendingRows.set(mapId, new Map());
        // If we don't already have a grid, try loading from local .map file
        if (!this.grids.has(mapId) || this.grids.get(mapId).every(v => v === UNKNOWN)) {
            this.buildFromMapFile(mapId, width, height);
        }
    }
    /**
     * Called when proxy intercepts a 0x3C MapTransfer row.
     * Tile data bytes: each tile is 6 bytes in network byte order (big-endian):
     *   [bg:u16] [xfg:u16] [yfg:u16]
     *
     * Note: Packet.readUInt16() reads big-endian. The intercepted body is the
     * post-decrypt packet body after the rowY field.
     */
    onTileDataRow(mapId, rowY, tileBytes) {
        const dims = this.dimensions.get(mapId);
        if (!dims)
            return;
        let rows = this.pendingRows.get(mapId);
        if (!rows) {
            rows = new Map();
            this.pendingRows.set(mapId, rows);
        }
        rows.set(rowY, tileBytes);
        // Once we have all rows, build the collision grid
        if (rows.size >= dims.height) {
            this.buildFromPendingRows(mapId);
        }
    }
    /**
     * Build the collision grid from collected 0x3C tile rows.
     * Can also be called manually to build from partial data.
     */
    buildFromPendingRows(mapId) {
        const dims = this.dimensions.get(mapId);
        const rows = this.pendingRows.get(mapId);
        if (!dims || !rows || !this.sotp)
            return;
        const { width, height } = dims;
        const grid = new Uint8Array(width * height);
        let blockedCount = 0;
        let rowsProcessed = 0;
        for (let y = 0; y < height; y++) {
            const tileBytes = rows.get(y);
            if (!tileBytes)
                continue;
            rowsProcessed++;
            // Parse tiles from the row: 6 bytes per tile, big-endian (network byte order)
            // The decrypted packet body uses big-endian readUInt16, so bytes are [hi, lo]
            for (let x = 0; x < width; x++) {
                const offset = x * 6;
                if (offset + 5 >= tileBytes.length)
                    break;
                // bg = tileBytes[offset] << 8 | tileBytes[offset+1]  (skip, not needed for collision)
                const xfg = (tileBytes[offset + 2] << 8) | tileBytes[offset + 3];
                const yfg = (tileBytes[offset + 4] << 8) | tileBytes[offset + 5];
                if (xfg === 0 && yfg === 0) {
                    grid[y * width + x] = WALKABLE;
                }
                else if (this.isTileSolid(xfg) || this.isTileSolid(yfg)) {
                    grid[y * width + x] = BLOCKED;
                    blockedCount++;
                }
                else {
                    grid[y * width + x] = WALKABLE;
                }
            }
        }
        this.grids.set(mapId, grid);
        this.pendingRows.delete(mapId);
        console.log(`[ProxyCollision] Built collision for map ${mapId} (${width}x${height}): ${rowsProcessed} rows, ${blockedCount} blocked tiles`);
    }
    /**
     * Force-build whatever rows we have so far (for maps where not all rows arrive).
     */
    finalizePending(mapId) {
        if (this.pendingRows.has(mapId)) {
            this.buildFromPendingRows(mapId);
        }
    }
    /**
     * Build collision grid from a local .map file (raw tile data: 6 bytes per tile, LE).
     * Format per tile: bg(u16LE) + xfg(u16LE) + yfg(u16LE), row-major order.
     * Used as fallback when the server doesn't send 0x3C tile data.
     */
    buildFromMapFile(mapId, width, height) {
        if (!this.sotp)
            return false;
        const mapFilePath = path_1.default.join(this.mapsDir, `lod${mapId}.map`);
        let buf;
        try {
            buf = fs_1.default.readFileSync(mapFilePath);
        }
        catch {
            return false;
        }
        const expectedSize = width * height * 6;
        if (buf.length < expectedSize)
            return false;
        this.dimensions.set(mapId, { width, height });
        const grid = new Uint8Array(width * height);
        let blockedCount = 0;
        let offset = 0;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const _bg = buf.readUInt16LE(offset);
                const xfg = buf.readUInt16LE(offset + 2);
                const yfg = buf.readUInt16LE(offset + 4);
                offset += 6;
                if (xfg === 0 && yfg === 0) {
                    grid[y * width + x] = WALKABLE;
                }
                else if (this.isTileSolid(xfg) || this.isTileSolid(yfg)) {
                    grid[y * width + x] = BLOCKED;
                    blockedCount++;
                }
                else {
                    grid[y * width + x] = WALKABLE;
                }
            }
        }
        this.grids.set(mapId, grid);
        console.log(`[ProxyCollision] Built collision for map ${mapId} (${width}x${height}) from map file: ${blockedCount} blocked tiles`);
        return true;
    }
    /**
     * Mark known map exit tiles as walkable, regardless of SOTP.
     * Door/warp tiles are "solid" in SOTP (decorative sprites) but the server
     * treats them as walkable — transitions are triggered by overlap, not blockage.
     */
    markExitsWalkable(mapId, exits) {
        const dims = this.dimensions.get(mapId);
        const grid = this.grids.get(mapId);
        if (!dims || !grid)
            return;
        let unmarked = 0;
        for (const exit of exits) {
            if (exit.x >= 0 && exit.x < dims.width && exit.y >= 0 && exit.y < dims.height) {
                const idx = exit.y * dims.width + exit.x;
                if (grid[idx] === BLOCKED) {
                    grid[idx] = WALKABLE;
                    unmarked++;
                }
            }
        }
        if (unmarked > 0) {
            console.log(`[ProxyCollision] Unmarked ${unmarked} exit tiles as walkable on map ${mapId}`);
        }
    }
    // --- Standard collision query interface (matches CollisionMap API) ---
    hasGrid(mapId) {
        return this.grids.has(mapId);
    }
    getDimensions(mapId) {
        return this.dimensions.get(mapId);
    }
    get(mapId, x, y) {
        const dims = this.dimensions.get(mapId);
        const grid = this.grids.get(mapId);
        if (!dims || !grid)
            return UNKNOWN;
        if (x < 0 || y < 0 || x >= dims.width || y >= dims.height)
            return BLOCKED;
        return grid[y * dims.width + x];
    }
    isWalkable(mapId, x, y) {
        const val = this.get(mapId, x, y);
        return val !== BLOCKED; // unknown treated as walkable (optimistic)
    }
    setDimensions(mapId, width, height) {
        const existing = this.dimensions.get(mapId);
        if (existing && existing.width === width && existing.height === height)
            return;
        this.dimensions.set(mapId, { width, height });
        if (!this.grids.has(mapId)) {
            this.grids.set(mapId, new Uint8Array(width * height));
        }
    }
    markBlocked(mapId, x, y) {
        const dims = this.dimensions.get(mapId);
        const grid = this.grids.get(mapId);
        if (!dims || !grid)
            return;
        if (x < 0 || y < 0 || x >= dims.width || y >= dims.height)
            return;
        grid[y * dims.width + x] = BLOCKED;
    }
    markWalkable(mapId, x, y) {
        const dims = this.dimensions.get(mapId);
        const grid = this.grids.get(mapId);
        if (!dims || !grid)
            return;
        if (x < 0 || y < 0 || x >= dims.width || y >= dims.height)
            return;
        grid[y * dims.width + x] = WALKABLE;
    }
}
exports.default = ProxyCollision;
//# sourceMappingURL=proxy-collision.js.map