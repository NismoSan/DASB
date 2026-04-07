"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
// Binary min-heap for A* open set
class RouteHeap {
    data = [];
    get size() { return this.data.length; }
    push(node) {
        this.data.push(node);
        this.bubbleUp(this.data.length - 1);
    }
    pop() {
        if (this.data.length === 0)
            return undefined;
        const top = this.data[0];
        const last = this.data.pop();
        if (this.data.length > 0) {
            this.data[0] = last;
            this.sinkDown(0);
        }
        return top;
    }
    bubbleUp(i) {
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.data[i].f < this.data[parent].f) {
                [this.data[i], this.data[parent]] = [this.data[parent], this.data[i]];
                i = parent;
            }
            else
                break;
        }
    }
    sinkDown(i) {
        const len = this.data.length;
        while (true) {
            let smallest = i;
            const left = 2 * i + 1;
            const right = 2 * i + 2;
            if (left < len && this.data[left].f < this.data[smallest].f)
                smallest = left;
            if (right < len && this.data[right].f < this.data[smallest].f)
                smallest = right;
            if (smallest !== i) {
                [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
                i = smallest;
            }
            else
                break;
        }
    }
}
function manhattan(x1, y1, x2, y2) {
    return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}
// Cost to transition between maps (walk to exit + fixed transition penalty)
const TRANSITION_COST = 10;
class MapGraph {
    exits;
    nodes;
    filePath;
    constructor(filePath = './data/map-exits.json') {
        this.exits = new Map();
        this.nodes = new Map();
        this.filePath = filePath;
    }
    addExit(exit) {
        // Avoid duplicates
        const existing = this.exits.get(exit.fromMapId) || [];
        const dupe = existing.find(e => e.fromX === exit.fromX && e.fromY === exit.fromY &&
            e.toMapId === exit.toMapId);
        if (dupe)
            return;
        existing.push(exit);
        this.exits.set(exit.fromMapId, existing);
    }
    getExits(mapId) {
        return this.exits.get(mapId) || [];
    }
    getNode(mapId) {
        return this.nodes.get(mapId);
    }
    setNode(mapId, node) {
        this.nodes.set(mapId, node);
    }
    // Record a transition the bot observed (auto-discovery)
    // Updates landing coordinates on existing exits, or adds a new exit
    recordTransition(fromMapId, fromX, fromY, toMapId, toX, toY) {
        const existing = this.exits.get(fromMapId) || [];
        const match = existing.find(e => e.fromX === fromX && e.fromY === fromY && e.toMapId === toMapId);
        if (match) {
            // Update landing position if it was unknown (0,0) or different
            if ((match.toX === 0 && match.toY === 0) || match.toX !== toX || match.toY !== toY) {
                console.log(`[MapGraph] Updated landing: map ${fromMapId} (${fromX},${fromY}) -> map ${toMapId} was (${match.toX},${match.toY}) now (${toX},${toY})`);
                match.toX = toX;
                match.toY = toY;
            }
        }
        else {
            this.addExit({
                fromMapId, fromX, fromY,
                toMapId, toX, toY,
                type: 'walk'
            });
            console.log(`[MapGraph] Discovered exit: map ${fromMapId} (${fromX},${fromY}) -> map ${toMapId} (${toX},${toY})`);
        }
    }
    // Update an existing exit's destination (when actual transition differs from recorded data)
    updateExit(fromMapId, fromX, fromY, actualToMapId, actualToX, actualToY) {
        const exits = this.exits.get(fromMapId);
        if (!exits)
            return;
        const exit = exits.find(e => e.fromX === fromX && e.fromY === fromY);
        if (exit && exit.toMapId !== actualToMapId) {
            console.log(`[MapGraph] Correcting exit: map ${fromMapId} (${fromX},${fromY}) was -> map ${exit.toMapId}, now -> map ${actualToMapId} (${actualToX},${actualToY})`);
            exit.toMapId = actualToMapId;
            exit.toX = actualToX;
            exit.toY = actualToY;
        }
    }
    /**
     * A* cross-map pathfinding.
     *
     * Cost = Manhattan distance to walk to each exit tile + transition penalty.
     * This finds the route with the fewest total walking steps, not just fewest map hops.
     *
     * @param fromMapId - Starting map
     * @param toMapId - Destination map
     * @param startX - Bot's current X on the starting map (for accurate first-leg cost)
     * @param startY - Bot's current Y on the starting map
     * @param targetX - Final destination X on target map (for heuristic on last leg)
     * @param targetY - Final destination Y on target map
     */
    findRoute(fromMapId, toMapId, startX = 0, startY = 0, targetX = 0, targetY = 0) {
        if (fromMapId === toMapId)
            return [];
        const open = new RouteHeap();
        // Best known g-score per (mapId, entryX, entryY) — keyed as "mapId:x:y"
        const bestG = new Map();
        const startKey = `${fromMapId}:${startX}:${startY}`;
        bestG.set(startKey, 0);
        open.push({
            mapId: fromMapId,
            x: startX,
            y: startY,
            g: 0,
            f: 0, // heuristic is 0 since we don't know map positions globally
            path: [],
            parent: null,
        });
        while (open.size > 0) {
            const current = open.pop();
            // Found destination map
            if (current.mapId === toMapId) {
                console.log(`[MapGraph] A* route found: ${current.path.length} transitions, cost ${current.g} steps`);
                return current.path;
            }
            const nodeKey = `${current.mapId}:${current.x}:${current.y}`;
            const knownG = bestG.get(nodeKey);
            if (knownG !== undefined && current.g > knownG)
                continue;
            const exits = this.getExits(current.mapId);
            for (const exit of exits) {
                // Cost = Manhattan distance from current position on this map to the exit tile
                const walkCost = manhattan(current.x, current.y, exit.fromX, exit.fromY);
                const totalCost = current.g + walkCost + TRANSITION_COST;
                // Where we land on the next map
                const landX = exit.toX;
                const landY = exit.toY;
                const neighborKey = `${exit.toMapId}:${landX}:${landY}`;
                const prevG = bestG.get(neighborKey);
                if (prevG !== undefined && totalCost >= prevG)
                    continue;
                bestG.set(neighborKey, totalCost);
                // Heuristic: if this is the target map, add distance to final destination
                // Otherwise 0 (we don't have global map coordinates for a real heuristic)
                let h = 0;
                if (exit.toMapId === toMapId) {
                    h = manhattan(landX, landY, targetX, targetY);
                }
                const newPath = [...current.path, exit];
                open.push({
                    mapId: exit.toMapId,
                    x: landX,
                    y: landY,
                    g: totalCost,
                    f: totalCost + h,
                    path: newPath,
                    parent: current,
                });
            }
        }
        return null; // no route found
    }
    // Populate from WorldMap packet (0x2E) nodes
    addWorldMapNodes(fieldName, nodes) {
        for (const node of nodes) {
            this.setNode(node.mapId, {
                mapId: node.mapId,
                mapName: node.name,
                width: 0,
                height: 0
            });
        }
    }
    /** Return all known map nodes (id + name) */
    getAllNodes() {
        return Array.from(this.nodes.values());
    }
    /** Return all unique map IDs that appear in the exit graph */
    getReachableMapIds() {
        const ids = new Set();
        this.exits.forEach((exits, fromId) => {
            ids.add(fromId);
            for (const e of exits)
                ids.add(e.toMapId);
        });
        return Array.from(ids).sort((a, b) => a - b);
    }
    get nodesFilePath() {
        const dir = this.filePath.substring(0, this.filePath.lastIndexOf('/'));
        return (dir ? dir + '/' : '') + 'map-nodes.json';
    }
    async save() {
        const data = [];
        this.exits.forEach((exits) => {
            data.push(...exits);
        });
        const dir = this.filePath.substring(0, this.filePath.lastIndexOf('/'));
        if (dir) {
            await fs_1.default.promises.mkdir(dir, { recursive: true });
        }
        await fs_1.default.promises.writeFile(this.filePath, JSON.stringify(data, null, 2));
        // Persist map nodes (names/dimensions)
        const nodeData = Array.from(this.nodes.values());
        if (nodeData.length > 0) {
            await fs_1.default.promises.writeFile(this.nodesFilePath, JSON.stringify(nodeData, null, 2));
        }
    }
    async load() {
        try {
            const raw = await fs_1.default.promises.readFile(this.filePath, 'utf-8');
            const data = JSON.parse(raw);
            for (const exit of data) {
                this.addExit(exit);
            }
            console.log(`[MapGraph] Loaded ${data.length} exits from ${this.filePath}`);
        }
        catch {
            console.log(`[MapGraph] No exit data found at ${this.filePath}, starting empty`);
        }
        // Load persisted map nodes
        try {
            const raw = await fs_1.default.promises.readFile(this.nodesFilePath, 'utf-8');
            const nodes = JSON.parse(raw);
            for (const node of nodes) {
                if (!this.nodes.has(node.mapId)) {
                    this.nodes.set(node.mapId, node);
                }
            }
            console.log(`[MapGraph] Loaded ${nodes.length} map nodes from ${this.nodesFilePath}`);
        }
        catch {
            // No nodes file yet, that's fine
        }
    }
}
exports.default = MapGraph;
//# sourceMappingURL=map-graph.js.map