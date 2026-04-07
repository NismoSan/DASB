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
class CollisionMap {
    grids;
    dimensions;
    dataDir;
    sotp;
    constructor(dataDir = './data/collision') {
        this.grids = new Map();
        this.dimensions = new Map();
        this.dataDir = dataDir;
        this.sotp = null;
    }
    // Load SOTP (Solid Tile Property) data — a BitArray where each bit indicates
    // whether a foreground tile ID is solid/blocked.
    // Format: .NET BitArray serialized as base64 — LSB first within each byte.
    // Tile ID n is solid if bit (n-1) is set.
    async loadSotp(filePath) {
        try {
            this.sotp = await fs_1.default.promises.readFile(filePath);
            console.log(`[Collision] Loaded SOTP: ${this.sotp.length} bytes (${this.sotp.length * 8} tile IDs)`);
            return true;
        }
        catch {
            console.log(`[Collision] No SOTP file at ${filePath}`);
            return false;
        }
    }
    // Check if a foreground tile ID is solid according to SOTP data
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
    // Build collision grid from a local .map file (raw tile data: 6 bytes per tile, LE).
    // Format per tile: bg(u16LE) + xfg(u16LE) + yfg(u16LE), row-major order.
    async buildFromMapFile(mapId, width, height, mapFilePath) {
        if (!this.sotp) {
            console.log(`[Collision] No SOTP data loaded, cannot build collision for map ${mapId}`);
            return false;
        }
        let buf;
        try {
            buf = await fs_1.default.promises.readFile(mapFilePath);
        }
        catch {
            return false;
        }
        const expectedSize = width * height * 6;
        if (buf.length < expectedSize) {
            console.log(`[Collision] Map file ${mapFilePath} too small: ${buf.length} bytes (expected ${expectedSize})`);
            return false;
        }
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
        console.log(`[Collision] Built collision for map ${mapId} (${width}x${height}) from map file: ${blockedCount} blocked tiles`);
        return true;
    }
    // Build collision grid for a map from its tile data using SOTP lookup.
    // A tile is blocked if either its xfg or yfg foreground tile is solid.
    // This matches the DA client's isBlock(xfg, yfg) logic.
    buildFromTileData(mapId, width, height, rows) {
        if (!this.sotp) {
            console.log(`[Collision] No SOTP data loaded, skipping tile-based collision for map ${mapId}`);
            return;
        }
        this.dimensions.set(mapId, { width, height });
        const grid = new Uint8Array(width * height);
        let blockedCount = 0;
        let rowCount = 0;
        let totalTiles = 0;
        let nonZeroFg = 0;
        for (let y = 0; y < height; y++) {
            const row = rows[y];
            if (!row || !row.tiles)
                continue;
            rowCount++;
            for (let x = 0; x < width && x < row.tiles.length; x++) {
                totalTiles++;
                const tile = row.tiles[x];
                const xfg = tile.uxfg || 0;
                const yfg = tile.uyfg || 0;
                if (xfg !== 0 || yfg !== 0)
                    nonZeroFg++;
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
        console.log(`[Collision] Built collision for map ${mapId} (${width}x${height}): ${rowCount} rows, ${totalTiles} tiles, ${nonZeroFg} with foreground, ${blockedCount} blocked`);
    }
    setDimensions(mapId, width, height) {
        const existing = this.dimensions.get(mapId);
        if (existing && existing.width === width && existing.height === height) {
            return; // already initialized with same dimensions
        }
        this.dimensions.set(mapId, { width, height });
        if (!this.grids.has(mapId)) {
            this.grids.set(mapId, new Uint8Array(width * height));
        }
    }
    hasGrid(mapId) {
        return this.grids.has(mapId);
    }
    getGrid(mapId) {
        return this.grids.get(mapId);
    }
    getDims(mapId) {
        return this.dimensions.get(mapId);
    }
    get(mapId, x, y) {
        const dims = this.getDims(mapId);
        const grid = this.getGrid(mapId);
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
    set(mapId, x, y, walkable) {
        const dims = this.getDims(mapId);
        const grid = this.getGrid(mapId);
        if (!dims || !grid)
            return;
        if (x < 0 || y < 0 || x >= dims.width || y >= dims.height)
            return;
        grid[y * dims.width + x] = walkable ? WALKABLE : BLOCKED;
    }
    markWalkable(mapId, x, y) {
        this.set(mapId, x, y, true);
    }
    markBlocked(mapId, x, y) {
        this.set(mapId, x, y, false);
    }
    // Reset a tile back to unknown (removes blocked status)
    clearBlocked(mapId, x, y) {
        const dims = this.getDims(mapId);
        const grid = this.getGrid(mapId);
        if (!dims || !grid)
            return;
        if (x < 0 || y < 0 || x >= dims.width || y >= dims.height)
            return;
        const idx = y * dims.width + x;
        if (grid[idx] === BLOCKED) {
            grid[idx] = UNKNOWN;
        }
    }
    async save(mapId) {
        const grid = this.getGrid(mapId);
        const dims = this.getDims(mapId);
        if (!grid || !dims)
            return;
        await fs_1.default.promises.mkdir(this.dataDir, { recursive: true });
        const filePath = path_1.default.join(this.dataDir, `${mapId}.bin`);
        // Header: 2 bytes width + 2 bytes height + grid data
        const buf = Buffer.alloc(4 + grid.length);
        buf.writeUInt16BE(dims.width, 0);
        buf.writeUInt16BE(dims.height, 2);
        buf.set(grid, 4);
        await fs_1.default.promises.writeFile(filePath, buf);
    }
    async load(mapId) {
        const filePath = path_1.default.join(this.dataDir, `${mapId}.bin`);
        try {
            const buf = await fs_1.default.promises.readFile(filePath);
            if (buf.length < 4)
                return false;
            const width = buf.readUInt16BE(0);
            const height = buf.readUInt16BE(2);
            const gridData = buf.slice(4, 4 + width * height);
            if (gridData.length !== width * height)
                return false;
            this.dimensions.set(mapId, { width, height });
            this.grids.set(mapId, new Uint8Array(gridData));
            return true;
        }
        catch {
            return false;
        }
    }
    async loadAll() {
        try {
            const files = await fs_1.default.promises.readdir(this.dataDir);
            for (const file of files) {
                if (file.endsWith('.bin')) {
                    const mapId = parseInt(file.replace('.bin', ''), 10);
                    if (!isNaN(mapId)) {
                        await this.load(mapId);
                    }
                }
            }
        }
        catch {
            // data dir doesn't exist yet, that's fine
        }
    }
}
exports.default = CollisionMap;
//# sourceMappingURL=collision.js.map