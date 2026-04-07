import EventEmitter from 'events';
import Packet from '../../core/packet';
import ProxyCollision from './proxy-collision';
import MapGraph from '../../features/navigator/map-graph';
import ProxyMovementController from './proxy-movement';
import { Direction, DIRECTION_DELTA } from '../../features/navigator/types';
import type { NavigationTarget, WorldMapNode, MapExit } from '../../features/navigator/types';
import type ProxyServer from '../proxy-server';
import type ProxySession from '../proxy-session';

export type ProxyNavState = 'idle' | 'walking' | 'waiting_map_load' | 'paused' | 'failed';

export interface ProxyNavStatus {
  state: ProxyNavState;
  target: NavigationTarget | null;
  currentMapId: number;
  currentX: number;
  currentY: number;
  mapsRemaining: number;
}

type ExitResult =
  | 'cancelled'
  | 'arrived_target_map'
  | 'transition_ok'
  | 'unexpected_map'
  | 'walk_failed'
  | 'transition_failed';

const MAX_REPATH_ATTEMPTS = 8;
const MAX_REROUTE_ATTEMPTS = 25;
const REFRESH_WAIT_MS = 400;
const MAP_LOAD_TIMEOUT_MS = 4000;
const EXIT_TRIGGER_TIMEOUT_MS = 2500;

const DIRECTIONS = [Direction.Up, Direction.Right, Direction.Down, Direction.Left];

function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * A* pathfinding using ProxyCollision (live server tile data).
 */
function findPath(
  collision: ProxyCollision,
  mapId: number,
  start: { x: number; y: number },
  end: { x: number; y: number },
  width: number,
  height: number,
  extraBlocked?: Set<number>
): Direction[] | null {
  if (start.x === end.x && start.y === end.y) return [];

  const toKey = (x: number, y: number) => y * width + x;
  const closed = new Set<number>();
  const gScores = new Map<number, number>();

  interface Node { x: number; y: number; g: number; f: number; parent: Node | null; direction: Direction | -1 }
  const heap: Node[] = [];

  const push = (n: Node) => {
    heap.push(n);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[i].f < heap[p].f) { [heap[i], heap[p]] = [heap[p], heap[i]]; i = p; } else break;
    }
  };

  const pop = (): Node | undefined => {
    if (!heap.length) return undefined;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      const len = heap.length;
      while (true) {
        let s = i;
        const l = 2 * i + 1, r = 2 * i + 2;
        if (l < len && heap[l].f < heap[s].f) s = l;
        if (r < len && heap[r].f < heap[s].f) s = r;
        if (s !== i) { [heap[i], heap[s]] = [heap[s], heap[i]]; i = s; } else break;
      }
    }
    return top;
  };

  push({ x: start.x, y: start.y, g: 0, f: manhattan(start, end), parent: null, direction: -1 });
  gScores.set(toKey(start.x, start.y), 0);

  while (heap.length > 0) {
    const current = pop()!;
    const currentKey = toKey(current.x, current.y);

    if (current.x === end.x && current.y === end.y) {
      const dirs: Direction[] = [];
      let node: Node | null = current;
      while (node && node.direction !== -1) { dirs.push(node.direction as Direction); node = node.parent; }
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
      push({ x: nx, y: ny, g: tentativeG, f: tentativeG + manhattan({ x: nx, y: ny }, end), parent: current, direction: dir });
    }
  }
  return null;
}

/**
 * Proxy-side navigator. Provides single-map walkTo and cross-map navigateTo
 * for proxy sessions. Combines live tile collision, entity avoidance,
 * robust exit handling (wall exits, worldmap, threshold wall-hops), and
 * exit auto-discovery.
 */
export default class ProxyNavigator extends EventEmitter {
  private proxy: ProxyServer;
  private session: ProxySession;
  movement: ProxyMovementController;
  private collision: ProxyCollision;
  private mapGraph: MapGraph;
  private state: ProxyNavState = 'idle';
  private currentTarget: NavigationTarget | null = null;
  private cancelled = false;
  private repathAttempts = 0;
  private currentRoute: MapExit[] | null = null;
  private mapLoadResolve: (() => void) | null = null;
  private positionResolve: ((pos: { x: number; y: number }) => void) | null = null;

  /** Tracked entity positions on current map (serial -> {x,y}) for obstacle avoidance */
  entities: Map<number, { x: number; y: number }> = new Map();

  /** World map destination nodes from the most recent 0x2E packet */
  private worldMapNodes: WorldMapNode[] = [];
  private worldMapResolve: (() => void) | null = null;

  constructor(
    proxy: ProxyServer,
    session: ProxySession,
    collision: ProxyCollision,
    mapGraph: MapGraph,
    options?: { walkDelay?: number }
  ) {
    super();
    this.proxy = proxy;
    this.session = session;
    this.collision = collision;
    this.mapGraph = mapGraph;
    this.movement = new ProxyMovementController(proxy, session, { walkDelay: options?.walkDelay });

    // Proactive entity avoidance before each step
    this.movement.isTileBlocked = (x, y) => {
      for (const pos of this.entities.values()) {
        if (pos.x === x && pos.y === y) return true;
      }
      return false;
    };

    this.movement.on('step', (data) => {
      this.emit('step', { ...data, mapId: this.session.playerState.mapNumber });
    });
  }

  // --- Accessors ---
  get currentMapId(): number { return this.session.playerState.mapNumber; }
  get currentX(): number { return this.session.playerState.x; }
  get currentY(): number { return this.session.playerState.y; }

  getStatus(): ProxyNavStatus {
    return {
      state: this.state,
      target: this.currentTarget,
      currentMapId: this.currentMapId,
      currentX: this.currentX,
      currentY: this.currentY,
      mapsRemaining: this.currentRoute ? this.currentRoute.length : 0,
    };
  }

  // --- Packet callbacks (called by proxy automation index) ---

  /** Called when proxy detects 0x0B WalkResponse for this session */
  onWalkResponse(direction: Direction, prevX: number, prevY: number): void {
    this.movement.handleWalkResponse(direction, prevX, prevY);
  }

  /** Called when proxy detects 0x04 MapLocation for this session */
  onMapLocation(x: number, y: number): void {
    this.movement.handleMapLocation(x, y);
    if (this.positionResolve) {
      this.positionResolve({ x, y });
      this.positionResolve = null;
    }
  }

  /** Called when proxy detects 0x15 MapInfo for this session */
  onMapChange(mapId: number): void {
    const { mapWidth, mapHeight } = this.session.playerState;
    if (mapWidth > 0 && mapHeight > 0) {
      this.collision.onMapInfo(mapId, mapWidth, mapHeight);
    }
    // Mark known exit tiles as walkable (doors are blocked in SOTP but walkable in-game)
    const exits = this.mapGraph.getExits(mapId);
    if (exits.length > 0) {
      this.collision.markExitsWalkable(mapId, exits.map(e => ({ x: e.fromX, y: e.fromY })));
    }
    // Clear tracked entities on map change
    this.entities.clear();

    if (this.mapLoadResolve) {
      this.mapLoadResolve();
      this.mapLoadResolve = null;
    }
  }

  /** Called when proxy decrypts a 0x3C MapTransfer row for this session */
  onTileData(rowY: number, tileBytes: Buffer): void {
    this.collision.onTileDataRow(this.session.playerState.mapNumber, rowY, tileBytes);
  }

  // --- Entity tracking for dynamic obstacle avoidance ---

  onEntityAdd(serial: number, x: number, y: number): void {
    if (serial === this.session.playerState.serial) return;
    this.entities.set(serial, { x, y });
  }

  onEntityWalk(serial: number, prevX: number, prevY: number, direction: Direction): void {
    if (serial === this.session.playerState.serial) return;
    const delta = DIRECTION_DELTA[direction];
    if (delta) this.entities.set(serial, { x: prevX + delta.x, y: prevY + delta.y });
  }

  onEntityRemove(serial: number): void {
    this.entities.delete(serial);
  }

  /** Build a Set of entity-occupied tile keys for extraBlocked in findPath */
  private getEntityBlockedTiles(): Set<number> {
    const mapWidth = this.session.playerState.mapWidth;
    const blocked = new Set<number>();
    for (const pos of this.entities.values()) {
      blocked.add(pos.y * mapWidth + pos.x);
    }
    return blocked;
  }

  // --- World Map handling ---

  onWorldMapReceived(nodes: WorldMapNode[]): void {
    this.worldMapNodes = nodes;
    if (this.worldMapResolve) {
      this.worldMapResolve();
      this.worldMapResolve = null;
    }
  }

  private waitForWorldMap(timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { this.worldMapResolve = null; resolve(false); }, timeoutMs);
      this.worldMapResolve = () => { clearTimeout(timer); resolve(true); };
    });
  }

  // --- Position sync ---

  private sendRefresh(): void {
    const packet = new Packet(0x38);
    this.proxy.sendToServer(this.session, packet);
  }

  private async syncPosition(): Promise<{ x: number; y: number }> {
    this.sendRefresh();
    return new Promise<{ x: number; y: number }>((resolve) => {
      const timer = setTimeout(() => {
        this.positionResolve = null;
        resolve({ x: this.currentX, y: this.currentY });
      }, REFRESH_WAIT_MS);
      this.positionResolve = (pos) => { clearTimeout(timer); resolve(pos); };
    });
  }

  private waitForMapLoad(timeoutMs = MAP_LOAD_TIMEOUT_MS): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { this.mapLoadResolve = null; resolve(false); }, timeoutMs);
      this.mapLoadResolve = () => { clearTimeout(timer); resolve(true); };
    });
  }

  // --- Utility helpers ---

  private isThresholdMap(): boolean {
    return this.session.playerState.mapWidth <= 20 && this.session.playerState.mapHeight <= 10;
  }

  private findAdjacentWalkable(x: number, y: number): { x: number; y: number } | null {
    const mapId = this.currentMapId;
    const mapWidth = this.session.playerState.mapWidth;
    const mapHeight = this.session.playerState.mapHeight;
    for (const dir of DIRECTIONS) {
      const delta = DIRECTION_DELTA[dir];
      const nx = x + delta.x;
      const ny = y + delta.y;
      if (nx >= 0 && ny >= 0 && nx < mapWidth && ny < mapHeight && this.collision.isWalkable(mapId, nx, ny)) {
        return { x: nx, y: ny };
      }
    }
    return null;
  }

  private directionTo(fx: number, fy: number, tx: number, ty: number): Direction | null {
    const dx = tx - fx;
    const dy = ty - fy;
    if (dx === 0 && dy === -1) return Direction.Up;
    if (dx === 1 && dy === 0) return Direction.Right;
    if (dx === 0 && dy === 1) return Direction.Down;
    if (dx === -1 && dy === 0) return Direction.Left;
    return null;
  }

  /** Check if a map transition occurred and classify the result */
  private checkMapTransition(mapBefore: number, exit: MapExit, expectedNextMap: number): ExitResult | null {
    if (this.currentMapId === mapBefore) return null;

    this.mapGraph.recordTransition(
      mapBefore, exit.fromX, exit.fromY,
      this.currentMapId, this.currentX, this.currentY
    );
    this.saveMapGraph();

    if (this.currentMapId === expectedNextMap) {
      console.log(`[ProxyNav] Transition to expected map ${this.currentMapId}`);
      return 'transition_ok';
    }
    if (this.currentMapId === this.currentTarget?.mapId) {
      console.log(`[ProxyNav] Landed directly on target map ${this.currentMapId}!`);
      return 'arrived_target_map';
    }
    console.log(`[ProxyNav] Unexpected map ${this.currentMapId} (expected ${expectedNextMap}) — rerouting`);
    this.mapGraph.updateExit(mapBefore, exit.fromX, exit.fromY, this.currentMapId, this.currentX, this.currentY);
    this.saveMapGraph();
    return 'unexpected_map';
  }

  private saveMapGraph(): void {
    this.mapGraph.save().catch((err: Error) => console.log(`[ProxyNav] Save map graph error: ${err.message}`));
  }

  // --- Core walking ---

  /** Walk to a tile on the current map. Public entry point. */
  async walkTo(x: number, y: number): Promise<boolean> {
    const pos = await this.syncPosition();
    const mapWidth = this.session.playerState.mapWidth;
    const mapHeight = this.session.playerState.mapHeight;
    console.log(`[ProxyNav] walkTo(${x},${y}) from (${pos.x},${pos.y}) map=${this.currentMapId} dims=${mapWidth}x${mapHeight} hasGrid=${this.collision.hasGrid(this.currentMapId)}`);

    this.cancelled = false;
    this.repathAttempts = 0;
    this.state = 'walking';
    this.currentTarget = { mapId: this.currentMapId, x, y };
    this.emit('status', this.getStatus());

    const result = await this.walkToInternal(x, y, mapWidth, mapHeight);
    const atDest = (this.currentX === x && this.currentY === y);
    const success = result || atDest;

    if (success) {
      this.state = 'idle';
      this.currentTarget = null;
      this.emit('arrived', { mapId: this.currentMapId, x: this.currentX, y: this.currentY });
    } else if (!this.cancelled) {
      this.state = 'failed';
      this.emit('failed', { reason: 'Could not reach destination', mapId: this.currentMapId, x, y });
    } else {
      this.state = 'idle';
    }
    this.emit('status', this.getStatus());
    return success;
  }

  private async walkToInternal(targetX: number, targetY: number, mapWidth: number, mapHeight: number): Promise<boolean> {
    const startingMap = this.currentMapId;
    const tempBlocked = new Set<number>();
    const toKey = (x: number, y: number) => y * mapWidth + x;

    while (this.repathAttempts < MAX_REPATH_ATTEMPTS) {
      if (this.cancelled) return false;
      if (this.currentMapId !== startingMap) return false;

      if (this.repathAttempts > 0) {
        await this.syncPosition();
        if (this.currentMapId !== startingMap) return false;
      }

      if (this.currentX === targetX && this.currentY === targetY) return true;

      // Merge entity + temp-blocked for avoidance
      const entityBlocked = this.getEntityBlockedTiles();
      const allBlocked = new Set<number>([...tempBlocked, ...entityBlocked]);

      let dirs = findPath(
        this.collision, this.currentMapId,
        { x: this.currentX, y: this.currentY }, { x: targetX, y: targetY },
        mapWidth, mapHeight,
        allBlocked.size > 0 ? allBlocked : undefined
      );

      // If blocked by entities, retry without entity blocking
      if (!dirs && entityBlocked.size > 0) {
        dirs = findPath(
          this.collision, this.currentMapId,
          { x: this.currentX, y: this.currentY }, { x: targetX, y: targetY },
          mapWidth, mapHeight,
          tempBlocked.size > 0 ? tempBlocked : undefined
        );
      }

      if (!dirs) {
        // Threshold wall-hop: try walking south to trigger server teleport
        if (this.repathAttempts < 3 && this.isThresholdMap()) {
          const hopped = await this.tryWalkToTriggerTeleport(startingMap);
          if (hopped) { this.repathAttempts++; continue; }
        }
        console.log(`[ProxyNav] No path from (${this.currentX},${this.currentY}) to (${targetX},${targetY}) on map ${this.currentMapId}`);
        return false;
      }
      if (dirs.length === 0) return true;

      console.log(`[ProxyNav] Path: ${dirs.length} steps`);
      const mapBeforeWalk = this.currentMapId;
      await this.movement.walkPath(dirs);
      if (this.currentMapId !== mapBeforeWalk) return false;
      if (this.currentX === targetX && this.currentY === targetY) return true;
      if (this.cancelled) return false;

      // Mark obstacle tile as temp-blocked and repath
      const testDirs = findPath(
        this.collision, this.currentMapId,
        { x: this.currentX, y: this.currentY }, { x: targetX, y: targetY },
        mapWidth, mapHeight
      );
      if (testDirs && testDirs.length > 0) {
        const delta = DIRECTION_DELTA[testDirs[0]];
        const blockedX = this.currentX + delta.x;
        const blockedY = this.currentY + delta.y;
        if (blockedX !== targetX || blockedY !== targetY) {
          tempBlocked.add(toKey(blockedX, blockedY));
        }
      }
      this.repathAttempts++;
    }
    return false;
  }

  // --- Threshold wall-hop ---

  private async tryWalkToTriggerTeleport(expectedMap: number): Promise<boolean> {
    if (!this.isThresholdMap()) return false;
    const beforeX = this.currentX;
    const beforeY = this.currentY;
    console.log(`[ProxyNav] Threshold wall-hop attempt from (${beforeX},${beforeY}) on map ${this.currentMapId}`);

    for (let i = 0; i < 3; i++) {
      if (this.cancelled || this.currentMapId !== expectedMap) break;
      await this.movement.step(Direction.Down);
      await new Promise(r => setTimeout(r, 400));
      if (this.currentMapId !== expectedMap) return true;
    }

    await new Promise(r => setTimeout(r, 500));
    const pos = await this.syncPosition();
    if (this.currentMapId !== expectedMap) return true;
    if (pos.y !== beforeY) { console.log(`[ProxyNav] Wall-hop: Y changed ${beforeY} -> ${pos.y}`); return true; }
    return false;
  }

  // --- Exit handling ---

  /** Handle a wall exit: walk adjacent, step into wall */
  private async handleWallExit(exit: MapExit, mapBefore: number, expectedNextMap: number): Promise<ExitResult> {
    const adjacent = this.findAdjacentWalkable(exit.fromX, exit.fromY);
    if (!adjacent) {
      console.log(`[ProxyNav] No adjacent walkable tile for wall exit (${exit.fromX},${exit.fromY})`);
      return 'walk_failed';
    }

    console.log(`[ProxyNav] Wall exit (${exit.fromX},${exit.fromY}) — walking to adjacent (${adjacent.x},${adjacent.y}) then stepping`);
    this.repathAttempts = 0;
    const mapWidth = this.session.playerState.mapWidth;
    const mapHeight = this.session.playerState.mapHeight;
    await this.walkToInternal(adjacent.x, adjacent.y, mapWidth, mapHeight);

    const transResult = this.checkMapTransition(mapBefore, exit, expectedNextMap);
    if (transResult) return transResult;
    if (this.cancelled) return 'cancelled';

    const stepDir = this.directionTo(this.currentX, this.currentY, exit.fromX, exit.fromY);
    if (stepDir !== null) {
      await this.movement.step(stepDir);
      await this.waitForMapLoad(EXIT_TRIGGER_TIMEOUT_MS);
    }

    const transResult2 = this.checkMapTransition(mapBefore, exit, expectedNextMap);
    if (transResult2) return transResult2;

    return await this.tryStepAllDirections(mapBefore, exit, expectedNextMap);
  }

  /** Handle a worldmap sign post exit */
  private async handleWorldMapExit(exit: MapExit, mapBefore: number, expectedNextMap: number): Promise<ExitResult> {
    console.log(`[ProxyNav] World map exit at (${exit.fromX},${exit.fromY}) -> map ${exit.toMapId}`);

    this.worldMapNodes = [];
    const worldMapPromise = this.waitForWorldMap(15000);

    const adjacent = this.findAdjacentWalkable(exit.fromX, exit.fromY);
    const walkTarget = adjacent || { x: exit.fromX, y: exit.fromY };

    this.repathAttempts = 0;
    const mapWidth = this.session.playerState.mapWidth;
    const mapHeight = this.session.playerState.mapHeight;
    await this.walkToInternal(walkTarget.x, walkTarget.y, mapWidth, mapHeight);

    const transResult = this.checkMapTransition(mapBefore, exit, expectedNextMap);
    if (transResult) return transResult;
    if (this.cancelled) return 'cancelled';

    if (this.worldMapNodes.length > 0) {
      console.log(`[ProxyNav] World map already opened during walk — sending 0x3F click...`);
      return await this.sendWorldMapClick(exit, mapBefore, expectedNextMap);
    }

    const stepDir = this.directionTo(this.currentX, this.currentY, exit.fromX, exit.fromY);
    if (stepDir !== null) {
      console.log(`[ProxyNav] Stepping onto sign post at (${exit.fromX},${exit.fromY})`);
      await this.movement.step(stepDir);

      const stepResult = this.checkMapTransition(mapBefore, exit, expectedNextMap);
      if (stepResult) return stepResult;
    }

    if (this.cancelled) return 'cancelled';

    if (this.worldMapNodes.length > 0) {
      console.log(`[ProxyNav] World map opened during step — sending 0x3F click...`);
      return await this.sendWorldMapClick(exit, mapBefore, expectedNextMap);
    }

    console.log(`[ProxyNav] Waiting for world map UI (0x2E)...`);
    const gotWorldMap = await worldMapPromise;
    if (!gotWorldMap) {
      console.log(`[ProxyNav] World map UI did not open — 0x2E not received`);
      return 'transition_failed';
    }

    console.log(`[ProxyNav] World map opened — sending 0x3F click...`);
    return await this.sendWorldMapClick(exit, mapBefore, expectedNextMap);
  }

  private async sendWorldMapClick(exit: MapExit, mapBefore: number, expectedNextMap: number): Promise<ExitResult> {
    let node: WorldMapNode | undefined = this.worldMapNodes.find(n => n.mapId === expectedNextMap);
    if (!node && this.worldMapNodes.length > 0 && this.currentTarget) {
      let bestNode: WorldMapNode | undefined;
      let bestCost = Infinity;
      for (const candidate of this.worldMapNodes) {
        if (candidate.mapId === this.currentTarget.mapId) { bestNode = candidate; bestCost = 0; break; }
        const route = this.mapGraph.findRoute(
          candidate.mapId, this.currentTarget.mapId,
          candidate.mapX, candidate.mapY,
          this.currentTarget.x, this.currentTarget.y
        );
        if (route && route.length < bestCost) { bestCost = route.length; bestNode = candidate; }
      }
      if (bestNode) {
        console.log(`[ProxyNav] World map node: "${bestNode.name}" (map=${bestNode.mapId}) — ${bestCost} hops`);
        node = bestNode;
      }
    }

    if (node) {
      console.log(`[ProxyNav] Sending WorldMapClick — node "${node.name}" checksum=${node.checksum} mapId=${node.mapId} mapX=${node.mapX} mapY=${node.mapY}`);
      const pkt = new Packet(0x3F);
      pkt.writeUInt16(node.checksum);
      pkt.writeUInt16(node.mapId);
      pkt.writeUInt16(node.mapX);
      pkt.writeUInt16(node.mapY);
      this.proxy.sendToServer(this.session, pkt);
    } else if (exit.clickX && exit.clickY) {
      console.log(`[ProxyNav] No 0x2E node for map ${expectedNextMap} — falling back to clickX/clickY (${exit.clickX},${exit.clickY})`);
      const pkt = new Packet(0x3F);
      pkt.writeUInt16(exit.clickX);
      pkt.writeUInt16(exit.clickY);
      this.proxy.sendToServer(this.session, pkt);
    } else {
      console.log(`[ProxyNav] No world map node and no fallback coords`);
      return 'transition_failed';
    }

    const actualExpected = node ? node.mapId : expectedNextMap;
    await this.waitForMapLoad();

    const closePkt = new Packet(0x11);
    closePkt.writeByte(0x00);
    this.proxy.sendToServer(this.session, closePkt);
    console.log(`[ProxyNav] Sent world map close (0x11)`);
    await new Promise(r => setTimeout(r, 300));

    const result = this.checkMapTransition(mapBefore, exit, actualExpected);
    return result || 'transition_failed';
  }

  /** Try stepping in all 4 directions to trigger an exit */
  private async tryStepAllDirections(mapBefore: number, exit: MapExit, expectedNextMap: number): Promise<ExitResult> {
    for (const dir of DIRECTIONS) {
      if (this.cancelled) return 'cancelled';
      await this.movement.step(dir);

      const res = this.checkMapTransition(mapBefore, exit, expectedNextMap);
      if (res) return res;

      const loaded = await this.waitForMapLoad(EXIT_TRIGGER_TIMEOUT_MS);
      if (loaded || this.currentMapId !== mapBefore) {
        const res2 = this.checkMapTransition(mapBefore, exit, expectedNextMap);
        if (res2) return res2;
      }
    }
    return 'transition_failed';
  }

  // --- Exit auto-discovery ---

  /** Walk map edges and try stepping off to discover unknown exits */
  private async exploreForExits(): Promise<boolean> {
    const mapBefore = this.currentMapId;
    const w = this.session.playerState.mapWidth;
    const h = this.session.playerState.mapHeight;
    console.log(`[ProxyNav] Exploring map ${mapBefore} (${w}x${h}) for exits...`);

    const candidates: { x: number; y: number; dirs: Direction[] }[] = [];
    const centerX = Math.floor(w / 2);

    // Bottom center (most common doors)
    for (let dx = -2; dx <= 2; dx++) {
      const cx = centerX + dx;
      if (cx >= 0 && cx < w) candidates.push({ x: cx, y: h - 1, dirs: [Direction.Down] });
    }
    // All edges
    for (let x = 0; x < w; x += 3) {
      candidates.push({ x, y: h - 1, dirs: [Direction.Down] });
      candidates.push({ x, y: 0, dirs: [Direction.Up] });
    }
    for (let y = 0; y < h; y += 3) {
      candidates.push({ x: w - 1, y, dirs: [Direction.Right] });
      candidates.push({ x: 0, y, dirs: [Direction.Left] });
    }

    const mapWidth = this.session.playerState.mapWidth;
    const mapHeight = this.session.playerState.mapHeight;

    for (const candidate of candidates) {
      if (this.cancelled) return false;
      if (this.currentMapId !== mapBefore) break;

      this.repathAttempts = 0;
      const reached = await this.walkToInternal(candidate.x, candidate.y, mapWidth, mapHeight);

      if (this.currentMapId !== mapBefore) {
        this.mapGraph.recordTransition(mapBefore, candidate.x, candidate.y, this.currentMapId, this.currentX, this.currentY);
        this.saveMapGraph();
        return true;
      }

      if (!reached) continue;

      for (const dir of candidate.dirs) {
        if (this.cancelled) return false;
        await this.movement.step(dir);
        if (this.currentMapId !== mapBefore) {
          this.mapGraph.recordTransition(mapBefore, candidate.x, candidate.y, this.currentMapId, this.currentX, this.currentY);
          this.saveMapGraph();
          return true;
        }
        const loaded = await this.waitForMapLoad(2000);
        if (loaded || this.currentMapId !== mapBefore) {
          this.mapGraph.recordTransition(mapBefore, candidate.x, candidate.y, this.currentMapId, this.currentX, this.currentY);
          this.saveMapGraph();
          return true;
        }
      }
    }
    return false;
  }

  // --- Cross-map navigation ---

  /** Follow the next exit in currentRoute, returning a typed result */
  private async followNextExit(): Promise<ExitResult> {
    if (!this.currentRoute || this.currentRoute.length === 0) return 'arrived_target_map';

    const nextExit = this.currentRoute[0];
    const mapBefore = this.currentMapId;
    const expectedNextMap = nextExit.toMapId;
    const mapWidth = this.session.playerState.mapWidth;
    const mapHeight = this.session.playerState.mapHeight;

    console.log(`[ProxyNav] followNextExit: map ${mapBefore} (${nextExit.fromX},${nextExit.fromY}) -> map ${expectedNextMap} type=${nextExit.type}`);

    if (this.cancelled) return 'cancelled';

    // Ensure collision grid is built for this map before checking walkability
    if (!this.collision.hasGrid(this.currentMapId) && mapWidth > 0 && mapHeight > 0) {
      console.log(`[ProxyNav] No collision grid for map ${this.currentMapId} — building now`);
      this.collision.onMapInfo(this.currentMapId, mapWidth, mapHeight);
    }

    // Worldmap sign post exit
    if (nextExit.type === 'worldmap') {
      return await this.handleWorldMapExit(nextExit, mapBefore, expectedNextMap);
    }

    // Wall exit (blocked tile)
    const exitIsBlocked = !this.collision.isWalkable(this.currentMapId, nextExit.fromX, nextExit.fromY);
    if (exitIsBlocked) {
      return await this.handleWallExit(nextExit, mapBefore, expectedNextMap);
    }

    // Walkable exit tile — walk to it
    this.repathAttempts = 0;
    const reachedExit = await this.walkToInternal(nextExit.fromX, nextExit.fromY, mapWidth, mapHeight);

    const transResult = this.checkMapTransition(mapBefore, nextExit, expectedNextMap);
    if (transResult) return transResult;

    if (!reachedExit) {
      // Collision may have updated — re-check if it's actually a wall
      if (!this.collision.isWalkable(this.currentMapId, nextExit.fromX, nextExit.fromY)) {
        return await this.handleWallExit(nextExit, mapBefore, expectedNextMap);
      }
      // Try threshold wall-hop
      if (this.isThresholdMap()) {
        const hopped = await this.tryWalkToTriggerTeleport(mapBefore);
        if (hopped && this.currentMapId === mapBefore) {
          this.repathAttempts = 0;
          const retryResult = await this.walkToInternal(nextExit.fromX, nextExit.fromY, mapWidth, mapHeight);
          const retryTrans = this.checkMapTransition(mapBefore, nextExit, expectedNextMap);
          if (retryTrans) return retryTrans;
          if (retryResult) {
            this.state = 'waiting_map_load';
            await this.waitForMapLoad();
            const waitTrans = this.checkMapTransition(mapBefore, nextExit, expectedNextMap);
            if (waitTrans) return waitTrans;
            return await this.tryStepAllDirections(mapBefore, nextExit, expectedNextMap);
          }
        }
      }
      return 'walk_failed';
    }

    if (this.cancelled) return 'cancelled';

    // On exit tile, wait for map load then try stepping
    this.state = 'waiting_map_load';
    this.emit('status', this.getStatus());
    await this.waitForMapLoad();

    const waitTrans = this.checkMapTransition(mapBefore, nextExit, expectedNextMap);
    if (waitTrans) return waitTrans;

    return await this.tryStepAllDirections(mapBefore, nextExit, expectedNextMap);
  }

  /**
   * Navigate to a tile on any map (cross-map navigation).
   */
  async navigateTo(target: NavigationTarget): Promise<boolean> {
    await this.syncPosition();
    this.cancelled = false;
    this.currentTarget = target;
    this.state = 'walking';
    this.emit('status', this.getStatus());

    let attempts = 0;

    while (attempts < MAX_REROUTE_ATTEMPTS) {
      if (this.cancelled) {
        this.state = 'idle';
        this.emit('status', this.getStatus());
        return false;
      }

      // Already on target map
      if (this.currentMapId === target.mapId) {
        if (target.x < 0 || target.y < 0) {
          this.state = 'idle';
          this.currentTarget = null;
          this.emit('arrived', { mapId: this.currentMapId, x: this.currentX, y: this.currentY });
          this.emit('status', this.getStatus());
          return true;
        }
        const result = await this.walkTo(target.x, target.y);
        return result;
      }

      // Find route to target
      this.currentRoute = this.mapGraph.findRoute(
        this.currentMapId, target.mapId,
        this.currentX, this.currentY,
        target.x, target.y
      );

      if (!this.currentRoute || this.currentRoute.length === 0) {
        console.log(`[ProxyNav] No route from map ${this.currentMapId} to map ${target.mapId} — exploring`);
        const discovered = await this.exploreForExits();
        if (this.cancelled) { this.state = 'idle'; this.emit('status', this.getStatus()); return false; }

        if (discovered) {
          console.log(`[ProxyNav] Discovered exits, rerouting...`);
          attempts++;
          continue;
        }

        this.state = 'failed';
        this.currentTarget = null;
        this.emit('failed', { reason: `No route from map ${this.currentMapId} to map ${target.mapId}` });
        this.emit('status', this.getStatus());
        return false;
      }

      console.log(`[ProxyNav] Route: ${this.currentRoute.length} hops to map ${target.mapId}`);
      this.emit('status', this.getStatus());

      const exitResult = await this.followNextExit();

      if (exitResult === 'cancelled') {
        this.state = 'idle';
        this.emit('status', this.getStatus());
        return false;
      }

      if (exitResult === 'arrived_target_map') {
        await new Promise(r => setTimeout(r, 300));
        await this.syncPosition();
        continue;
      }

      if (exitResult === 'transition_ok') {
        console.log(`[ProxyNav] Transition successful, now on map ${this.currentMapId}. Recalculating route...`);
        await new Promise(r => setTimeout(r, 300));
        await this.syncPosition();
        continue;
      }

      if (exitResult === 'unexpected_map') {
        attempts++;
        console.log(`[ProxyNav] Unexpected map ${this.currentMapId} — rerouting (attempt ${attempts}/${MAX_REROUTE_ATTEMPTS})`);
        await this.syncPosition();
        continue;
      }

      if (exitResult === 'walk_failed') {
        attempts++;
        console.log(`[ProxyNav] Couldn't reach exit tile — rerouting (attempt ${attempts}/${MAX_REROUTE_ATTEMPTS})`);
        await this.syncPosition();
        continue;
      }

      if (exitResult === 'transition_failed') {
        attempts++;
        console.log(`[ProxyNav] Map transition didn't trigger — rerouting (attempt ${attempts}/${MAX_REROUTE_ATTEMPTS})`);
        await this.syncPosition();
        continue;
      }
    }

    this.state = 'failed';
    this.currentTarget = null;
    this.emit('failed', { reason: 'Exhausted navigation attempts' });
    this.emit('status', this.getStatus());
    return false;
  }

  cancel(): void {
    this.cancelled = true;
    this.movement.cancel();
    this.state = 'idle';
    this.currentTarget = null;
    this.currentRoute = null;
    if (this.mapLoadResolve) { this.mapLoadResolve(); this.mapLoadResolve = null; }
    if (this.positionResolve) { this.positionResolve({ x: this.currentX, y: this.currentY }); this.positionResolve = null; }
    if (this.worldMapResolve) { this.worldMapResolve(); this.worldMapResolve = null; }
    this.emit('status', this.getStatus());
  }

  /**
   * Follow a player by reacting to their entity walk events.
   * Returns a cancel function.
   */
  startFollowing(targetSerial: number, minDistance = 1): () => void {
    let following = true;
    let walkPromise: Promise<boolean> | null = null;

    const onEntityWalk = (session: ProxySession, serial: number, x: number, y: number) => {
      if (!following || serial !== targetSerial) return;
      if (session.id !== this.session.id) return;
      const dist = Math.abs(this.currentX - x) + Math.abs(this.currentY - y);
      if (dist <= minDistance) return;
      if (walkPromise) this.movement.cancel();
      walkPromise = this.walkTo(x, y).then(() => { walkPromise = null; return true; });
    };

    this.proxy.on('entity:walk', onEntityWalk);
    return () => {
      following = false;
      this.proxy.removeListener('entity:walk', onEntityWalk);
      this.movement.cancel();
    };
  }
}
