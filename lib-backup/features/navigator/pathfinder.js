"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findPath = findPath;
const types_1 = require("./types");
// Binary min-heap keyed on f-score
class MinHeap {
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
function manhattan(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
const DIRECTIONS = [types_1.Direction.Up, types_1.Direction.Right, types_1.Direction.Down, types_1.Direction.Left];
function findPath(collision, mapId, start, end, width, height, extraBlocked) {
    if (start.x === end.x && start.y === end.y)
        return [];
    // Destination is blocked - can't path there
    if (!collision.isWalkable(mapId, end.x, end.y))
        return null;
    const toKey = (x, y) => y * width + x;
    const closed = new Set();
    const gScores = new Map();
    const open = new MinHeap();
    const startNode = {
        x: start.x, y: start.y,
        g: 0, f: manhattan(start, end),
        parent: null, direction: -1
    };
    open.push(startNode);
    gScores.set(toKey(start.x, start.y), 0);
    while (open.size > 0) {
        const current = open.pop();
        const currentKey = toKey(current.x, current.y);
        if (current.x === end.x && current.y === end.y) {
            // Reconstruct path as directions
            const dirs = [];
            let node = current;
            while (node && node.direction !== -1) {
                dirs.push(node.direction);
                node = node.parent;
            }
            dirs.reverse();
            return dirs;
        }
        if (closed.has(currentKey))
            continue;
        closed.add(currentKey);
        for (const dir of DIRECTIONS) {
            const delta = types_1.DIRECTION_DELTA[dir];
            const nx = current.x + delta.x;
            const ny = current.y + delta.y;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height)
                continue;
            const nKey = toKey(nx, ny);
            if (closed.has(nKey))
                continue;
            if (!collision.isWalkable(mapId, nx, ny))
                continue;
            if (extraBlocked && extraBlocked.has(nKey))
                continue;
            const tentativeG = current.g + 1;
            const prevG = gScores.get(nKey);
            if (prevG !== undefined && tentativeG >= prevG)
                continue;
            gScores.set(nKey, tentativeG);
            const neighbor = {
                x: nx, y: ny,
                g: tentativeG,
                f: tentativeG + manhattan({ x: nx, y: ny }, end),
                parent: current,
                direction: dir
            };
            open.push(neighbor);
        }
    }
    return null; // no path found
}
//# sourceMappingURL=pathfinder.js.map