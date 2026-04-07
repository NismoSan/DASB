import type CollisionMap from './collision';
import { Direction, DIRECTION_DELTA, type Point } from './types';

interface Node {
  x: number;
  y: number;
  g: number;
  f: number;
  parent: Node | null;
  direction: Direction | -1;
}

// Binary min-heap keyed on f-score
class MinHeap {
  private data: Node[] = [];

  get size(): number { return this.data.length; }

  push(node: Node): void {
    this.data.push(node);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): Node | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.data[i].f < this.data[parent].f) {
        [this.data[i], this.data[parent]] = [this.data[parent], this.data[i]];
        i = parent;
      } else break;
    }
  }

  private sinkDown(i: number): void {
    const len = this.data.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < len && this.data[left].f < this.data[smallest].f) smallest = left;
      if (right < len && this.data[right].f < this.data[smallest].f) smallest = right;
      if (smallest !== i) {
        [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
        i = smallest;
      } else break;
    }
  }
}

function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

const DIRECTIONS = [Direction.Up, Direction.Right, Direction.Down, Direction.Left];

export function findPath(
  collision: CollisionMap,
  mapId: number,
  start: Point,
  end: Point,
  width: number,
  height: number,
  extraBlocked?: Set<number>
): Direction[] | null {
  if (start.x === end.x && start.y === end.y) return [];

  const toKey = (x: number, y: number) => y * width + x;
  const closed = new Set<number>();
  const gScores = new Map<number, number>();
  const open = new MinHeap();

  const startNode: Node = {
    x: start.x, y: start.y,
    g: 0, f: manhattan(start, end),
    parent: null, direction: -1
  };

  open.push(startNode);
  gScores.set(toKey(start.x, start.y), 0);

  while (open.size > 0) {
    const current = open.pop()!;
    const currentKey = toKey(current.x, current.y);

    if (current.x === end.x && current.y === end.y) {
      // Reconstruct path as directions
      const dirs: Direction[] = [];
      let node: Node | null = current;
      while (node && node.direction !== -1) {
        dirs.push(node.direction);
        node = node.parent;
      }
      dirs.reverse();
      return dirs;
    }

    if (closed.has(currentKey)) continue;
    closed.add(currentKey);

    for (const dir of DIRECTIONS) {
      const delta = DIRECTION_DELTA[dir];
      const nx = current.x + delta.x;
      const ny = current.y + delta.y;

      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

      const nKey = toKey(nx, ny);
      if (closed.has(nKey)) continue;

      const isEnd = (nx === end.x && ny === end.y);
      if (!isEnd && !collision.isWalkable(mapId, nx, ny)) continue;
      if (!isEnd && extraBlocked && extraBlocked.has(nKey)) continue;

      const tentativeG = current.g + 1;
      const prevG = gScores.get(nKey);
      if (prevG !== undefined && tentativeG >= prevG) continue;

      gScores.set(nKey, tentativeG);
      const neighbor: Node = {
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
