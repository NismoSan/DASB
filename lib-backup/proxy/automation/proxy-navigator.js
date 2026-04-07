"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = __importDefault(require("events"));
const packet_1 = __importDefault(require("../../core/packet"));
const types_1 = require("../../features/navigator/types");
const proxy_movement_1 = __importDefault(require("./proxy-movement"));
const MAX_REPATH_ATTEMPTS = 8;
const MAX_REROUTE_ATTEMPTS = 5;
const REFRESH_WAIT_MS = 400;
const MAP_LOAD_TIMEOUT_MS = 4000;
const DIRECTIONS = [types_1.Direction.Up, types_1.Direction.Right, types_1.Direction.Down, types_1.Direction.Left];
function manhattan(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
/**
 * A* pathfinding using ProxyCollision (live server tile data).
 * Same algorithm as the bot's pathfinder but typed against ProxyCollision.
 */
function findPath(collision, mapId, start, end, width, height, extraBlocked) {
    if (start.x === end.x && start.y === end.y)
        return [];
    const toKey = (x, y) => y * width + x;
    const closed = new Set();
    const gScores = new Map();
    // Binary min-heap on f-score
    const heap = [];
    const push = (n) => { heap.push(n); let i = heap.length - 1; while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[i].f < heap[p].f) {
            [heap[i], heap[p]] = [heap[p], heap[i]];
            i = p;
        }
        else
            break;
    } };
    const pop = () => { if (!heap.length)
        return undefined; const top = heap[0]; const last = heap.pop(); if (heap.length) {
        heap[0] = last;
        let i = 0;
        const len = heap.length;
        while (true) {
            let s = i;
            const l = 2 * i + 1, r = 2 * i + 2;
            if (l < len && heap[l].f < heap[s].f)
                s = l;
            if (r < len && heap[r].f < heap[s].f)
                s = r;
            if (s !== i) {
                [heap[i], heap[s]] = [heap[s], heap[i]];
                i = s;
            }
            else
                break;
        }
    } return top; };
    const startNode = { x: start.x, y: start.y, g: 0, f: manhattan(start, end), parent: null, direction: -1 };
    push(startNode);
    gScores.set(toKey(start.x, start.y), 0);
    while (heap.length > 0) {
        const current = pop();
        const currentKey = toKey(current.x, current.y);
        if (current.x === end.x && current.y === end.y) {
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
            // Allow walking to the end tile even if blocked (wall exits)
            const isEnd = (nx === end.x && ny === end.y);
            if (!isEnd && !collision.isWalkable(mapId, nx, ny))
                continue;
            if (!isEnd && extraBlocked && extraBlocked.has(nKey))
                continue;
            const tentativeG = current.g + 1;
            const prevG = gScores.get(nKey);
            if (prevG !== undefined && tentativeG >= prevG)
                continue;
            gScores.set(nKey, tentativeG);
            push({ x: nx, y: ny, g: tentativeG, f: tentativeG + manhattan({ x: nx, y: ny }, end), parent: current, direction: dir });
        }
    }
    return null;
}
/**
 * Proxy-side navigator. Provides single-map walkTo and cross-map navigateTo
 * for proxy sessions, using the shared collision/map-graph data and
 * per-session ProxyMovementController.
 */
class ProxyNavigator extends events_1.default {
    proxy;
    session;
    movement;
    collision;
    mapGraph;
    state = 'idle';
    currentTarget = null;
    cancelled = false;
    repathAttempts = 0;
    currentRoute = null;
    mapLoadResolve = null;
    positionResolve = null;
    /** Tracked entity positions on current map (serial -> {x,y}) for obstacle avoidance */
    entities = new Map();
    /** World map destination nodes from the most recent 0x2E packet */
    worldMapNodes = [];
    worldMapResolve = null;
    constructor(proxy, session, collision, mapGraph, options) {
        super();
        this.proxy = proxy;
        this.session = session;
        this.collision = collision;
        this.mapGraph = mapGraph;
        this.movement = new proxy_movement_1.default(proxy, session, { walkDelay: options?.walkDelay });
        // Proactive entity avoidance: check if target tile has an entity before each step
        this.movement.isTileBlocked = (x, y) => {
            for (const pos of this.entities.values()) {
                if (pos.x === x && pos.y === y)
                    return true;
            }
            return false;
        };
        this.movement.on('step', (data) => {
            this.emit('step', { ...data, mapId: this.session.playerState.mapNumber });
        });
    }
    get currentMapId() { return this.session.playerState.mapNumber; }
    get currentX() { return this.session.playerState.x; }
    get currentY() { return this.session.playerState.y; }
    getStatus() {
        return {
            state: this.state,
            target: this.currentTarget,
            currentMapId: this.currentMapId,
            currentX: this.currentX,
            currentY: this.currentY,
            mapsRemaining: this.currentRoute ? this.currentRoute.length : 0,
        };
    }
    // Called when proxy detects 0x0B WalkResponse for this session
    onWalkResponse(direction, prevX, prevY) {
        this.movement.handleWalkResponse(direction, prevX, prevY);
    }
    // Called when proxy detects 0x04 MapLocation for this session
    onMapLocation(x, y) {
        this.movement.handleMapLocation(x, y);
        if (this.positionResolve) {
            this.positionResolve({ x, y });
            this.positionResolve = null;
        }
    }
    // Called when proxy detects 0x15 MapInfo for this session
    onMapChange(mapId) {
        // Set up collision grid dimensions for incoming 0x3C tile data
        const { mapWidth, mapHeight } = this.session.playerState;
        if (mapWidth > 0 && mapHeight > 0) {
            this.collision.onMapInfo(mapId, mapWidth, mapHeight);
        }
        // Mark known exit tiles as walkable (doors are walkable in DA, not blocked)
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
    // --- Entity tracking for dynamic obstacle avoidance ---
    onEntityAdd(serial, x, y) {
        // Don't track ourselves
        if (serial === this.session.playerState.serial)
            return;
        this.entities.set(serial, { x, y });
    }
    onEntityWalk(serial, prevX, prevY, direction) {
        if (serial === this.session.playerState.serial)
            return;
        const delta = types_1.DIRECTION_DELTA[direction];
        if (delta) {
            this.entities.set(serial, { x: prevX + delta.x, y: prevY + delta.y });
        }
    }
    onEntityRemove(serial) {
        this.entities.delete(serial);
    }
    /** Build a Set of entity-occupied tile keys for use as extraBlocked in findPath */
    getEntityBlockedTiles() {
        const mapWidth = this.session.playerState.mapWidth;
        const blocked = new Set();
        for (const pos of this.entities.values()) {
            blocked.add(pos.y * mapWidth + pos.x);
        }
        return blocked;
    }
    // --- World Map (0x2E/0x3F) handling ---
    onWorldMapReceived(nodes) {
        this.worldMapNodes = nodes;
        if (this.worldMapResolve) {
            this.worldMapResolve();
            this.worldMapResolve = null;
        }
    }
    waitForWorldMap(timeoutMs) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.worldMapResolve = null;
                resolve(false);
            }, timeoutMs);
            this.worldMapResolve = () => {
                clearTimeout(timer);
                resolve(true);
            };
        });
    }
    /**
     * Handle a worldmap-type exit: walk near sign post, wait for 0x2E, send 0x3F click.
     * Returns true if map transition succeeded.
     */
    async handleWorldMapExit(exit) {
        const mapBefore = this.currentMapId;
        console.log(`[ProxyNav] World map exit at (${exit.fromX},${exit.fromY}) -> map ${exit.toMapId}`);
        // Clear stale nodes, set up listener BEFORE walking
        this.worldMapNodes = [];
        const worldMapPromise = this.waitForWorldMap(15000);
        // Walk to adjacent tile near the sign post
        const adjacent = this.findAdjacentWalkable(exit.fromX, exit.fromY);
        const walkTarget = adjacent || { x: exit.fromX, y: exit.fromY };
        this.repathAttempts = 0;
        const mapWidth = this.session.playerState.mapWidth;
        const mapHeight = this.session.playerState.mapHeight;
        await this.walkToInternal(walkTarget.x, walkTarget.y, mapWidth, mapHeight);
        // Check if map changed during walk
        if (this.currentMapId !== mapBefore)
            return true;
        if (this.cancelled)
            return false;
        // If 0x2E arrived during walk, send click immediately
        if (this.worldMapNodes.length > 0) {
            return await this.sendWorldMapClick(exit);
        }
        // Step onto the sign post tile
        const stepDir = this.directionTo(this.currentX, this.currentY, exit.fromX, exit.fromY);
        if (stepDir !== null) {
            console.log(`[ProxyNav] Stepping onto sign post at (${exit.fromX},${exit.fromY})`);
            await this.movement.step(stepDir);
            if (this.currentMapId !== mapBefore)
                return true;
        }
        // Check if 0x2E arrived during step
        if (this.worldMapNodes.length > 0) {
            return await this.sendWorldMapClick(exit);
        }
        // Wait for 0x2E
        console.log(`[ProxyNav] Waiting for world map UI (0x2E)...`);
        const gotWorldMap = await worldMapPromise;
        if (!gotWorldMap) {
            console.log(`[ProxyNav] World map UI did not open — 0x2E not received`);
            return false;
        }
        return await this.sendWorldMapClick(exit);
    }
    /**
     * Send 0x3F WorldMapClick to select a destination, then close the UI with 0x11.
     */
    async sendWorldMapClick(exit) {
        const mapBefore = this.currentMapId;
        const expectedMap = exit.toMapId;
        // Find best node: exact match first, then best route to final target
        let node = this.worldMapNodes.find(n => n.mapId === expectedMap);
        if (!node && this.worldMapNodes.length > 0 && this.currentTarget) {
            let bestNode;
            let bestCost = Infinity;
            for (const candidate of this.worldMapNodes) {
                if (candidate.mapId === this.currentTarget.mapId) {
                    bestNode = candidate;
                    bestCost = 0;
                    break;
                }
                const route = this.mapGraph.findRoute(candidate.mapId, this.currentTarget.mapId, candidate.mapX, candidate.mapY, this.currentTarget.x, this.currentTarget.y);
                if (route && route.length < bestCost) {
                    bestCost = route.length;
                    bestNode = candidate;
                }
            }
            if (bestNode) {
                console.log(`[ProxyNav] Matched world map node "${bestNode.name}" (mapId=${bestNode.mapId}) — ${bestCost} hops to target`);
                node = bestNode;
            }
        }
        // Send 0x3F
        if (node) {
            console.log(`[ProxyNav] Sending WorldMapClick: "${node.name}" checksum=${node.checksum} mapId=${node.mapId}`);
            const pkt = new packet_1.default(0x3F);
            pkt.writeUInt16(node.checksum);
            pkt.writeUInt16(node.mapId);
            pkt.writeUInt16(node.mapX);
            pkt.writeUInt16(node.mapY);
            this.proxy.sendToServer(this.session, pkt);
        }
        else if (exit.clickX && exit.clickY) {
            console.log(`[ProxyNav] No 0x2E node match — fallback to clickX/clickY (${exit.clickX},${exit.clickY})`);
            const pkt = new packet_1.default(0x3F);
            pkt.writeUInt16(exit.clickX);
            pkt.writeUInt16(exit.clickY);
            this.proxy.sendToServer(this.session, pkt);
        }
        else {
            console.log(`[ProxyNav] No world map node and no fallback click coordinates`);
            return false;
        }
        // Wait for map transition
        const loaded = await this.waitForMapLoad();
        // Close the world map UI — server blocks movement until this is sent
        const closePkt = new packet_1.default(0x11);
        closePkt.writeByte(0x00);
        this.proxy.sendToServer(this.session, closePkt);
        console.log(`[ProxyNav] Sent world map close (0x11)`);
        // Small delay for map to settle
        await new Promise(r => setTimeout(r, 300));
        return this.currentMapId !== mapBefore;
    }
    findAdjacentWalkable(x, y) {
        const mapId = this.currentMapId;
        const mapWidth = this.session.playerState.mapWidth;
        const mapHeight = this.session.playerState.mapHeight;
        for (const dir of [types_1.Direction.Up, types_1.Direction.Right, types_1.Direction.Down, types_1.Direction.Left]) {
            const delta = types_1.DIRECTION_DELTA[dir];
            const nx = x + delta.x;
            const ny = y + delta.y;
            if (nx >= 0 && ny >= 0 && nx < mapWidth && ny < mapHeight &&
                this.collision.isWalkable(mapId, nx, ny)) {
                return { x: nx, y: ny };
            }
        }
        return null;
    }
    directionTo(fx, fy, tx, ty) {
        const dx = tx - fx;
        const dy = ty - fy;
        if (dx === 0 && dy === -1)
            return types_1.Direction.Up;
        if (dx === 1 && dy === 0)
            return types_1.Direction.Right;
        if (dx === 0 && dy === 1)
            return types_1.Direction.Down;
        if (dx === -1 && dy === 0)
            return types_1.Direction.Left;
        return null;
    }
    // Called when proxy decrypts a 0x3C MapTransfer row for this session.
    // Feeds live tile data to the collision system.
    onTileData(rowY, tileBytes) {
        const mapId = this.session.playerState.mapNumber;
        this.collision.onTileDataRow(mapId, rowY, tileBytes);
    }
    sendRefresh() {
        const packet = new packet_1.default(0x38);
        this.proxy.sendToServer(this.session, packet);
    }
    async syncPosition() {
        this.sendRefresh();
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.positionResolve = null;
                resolve({ x: this.currentX, y: this.currentY });
            }, REFRESH_WAIT_MS);
            this.positionResolve = (pos) => {
                clearTimeout(timer);
                resolve(pos);
            };
        });
    }
    waitForMapLoad() {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.mapLoadResolve = null;
                resolve(false);
            }, MAP_LOAD_TIMEOUT_MS);
            this.mapLoadResolve = () => {
                clearTimeout(timer);
                resolve(true);
            };
        });
    }
    /**
     * Walk to a tile on the current map.
     */
    async walkTo(x, y) {
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
        }
        else if (!this.cancelled) {
            this.state = 'failed';
            this.emit('failed', { reason: 'Could not reach destination', mapId: this.currentMapId, x, y });
        }
        else {
            this.state = 'idle';
        }
        this.emit('status', this.getStatus());
        return success;
    }
    async walkToInternal(targetX, targetY, mapWidth, mapHeight) {
        const startingMap = this.currentMapId;
        const tempBlocked = new Set();
        const toKey = (x, y) => y * mapWidth + x;
        while (this.repathAttempts < MAX_REPATH_ATTEMPTS) {
            if (this.cancelled)
                return false;
            if (this.currentMapId !== startingMap)
                return false;
            if (this.repathAttempts > 0) {
                await this.syncPosition();
                if (this.currentMapId !== startingMap)
                    return false;
            }
            if (this.currentX === targetX && this.currentY === targetY)
                return true;
            // Merge entity positions + temp-blocked tiles for obstacle avoidance
            const entityBlocked = this.getEntityBlockedTiles();
            const allBlocked = new Set([...tempBlocked, ...entityBlocked]);
            // Try pathfinding with entity avoidance first
            let dirs = findPath(this.collision, this.currentMapId, { x: this.currentX, y: this.currentY }, { x: targetX, y: targetY }, mapWidth, mapHeight, allBlocked.size > 0 ? allBlocked : undefined);
            // If no path with entities blocked, try without (entities may move)
            if (!dirs && entityBlocked.size > 0) {
                console.log(`[ProxyNav] No path avoiding entities, trying without entity blocking`);
                dirs = findPath(this.collision, this.currentMapId, { x: this.currentX, y: this.currentY }, { x: targetX, y: targetY }, mapWidth, mapHeight, tempBlocked.size > 0 ? tempBlocked : undefined);
            }
            if (!dirs) {
                console.log(`[ProxyNav] findPath FAILED from (${this.currentX},${this.currentY}) to (${targetX},${targetY}) on map ${this.currentMapId} (${mapWidth}x${mapHeight})`);
                return false;
            }
            if (dirs.length === 0)
                return true;
            console.log(`[ProxyNav] Path found: ${dirs.length} steps`);
            const mapBeforeWalk = this.currentMapId;
            await this.movement.walkPath(dirs);
            if (this.currentMapId !== mapBeforeWalk)
                return false;
            if (this.currentX === targetX && this.currentY === targetY)
                return true;
            if (this.cancelled)
                return false;
            // Mark the obstacle tile as temporarily blocked and repath
            const testDirs = findPath(this.collision, this.currentMapId, { x: this.currentX, y: this.currentY }, { x: targetX, y: targetY }, mapWidth, mapHeight);
            if (testDirs && testDirs.length > 0) {
                const delta = types_1.DIRECTION_DELTA[testDirs[0]];
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
    /**
     * Navigate to a tile on any map (cross-map navigation).
     * Process one exit at a time: walk to exit, detect map change, reroute.
     */
    async navigateTo(target) {
        await this.syncPosition();
        this.cancelled = false;
        this.currentTarget = target;
        this.state = 'walking';
        this.emit('status', this.getStatus());
        let attempts = 0;
        while (attempts < MAX_REROUTE_ATTEMPTS * 5) {
            if (this.cancelled) {
                this.state = 'idle';
                this.emit('status', this.getStatus());
                return false;
            }
            // Already on target map — walk to final position
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
            // Find route from current position to target
            this.currentRoute = this.mapGraph.findRoute(this.currentMapId, target.mapId, this.currentX, this.currentY, target.x, target.y);
            if (!this.currentRoute || this.currentRoute.length === 0) {
                console.log(`[ProxyNav] No route from map ${this.currentMapId} to map ${target.mapId}`);
                this.state = 'failed';
                this.currentTarget = null;
                this.emit('failed', { reason: `No route from map ${this.currentMapId} to map ${target.mapId}` });
                this.emit('status', this.getStatus());
                return false;
            }
            // Only process the FIRST exit (the one on our current map)
            const exit = this.currentRoute[0];
            console.log(`[ProxyNav] Step ${attempts + 1}: map ${exit.fromMapId} (${exit.fromX},${exit.fromY}) -> map ${exit.toMapId} type=${exit.type} [${this.currentRoute.length} hops remaining]`);
            // Handle worldmap exits differently (sign post + 0x3F click)
            if (exit.type === 'worldmap') {
                const wmResult = await this.handleWorldMapExit(exit);
                if (this.currentMapId !== exit.fromMapId) {
                    this.mapGraph.recordTransition(exit.fromMapId, exit.fromX, exit.fromY, this.currentMapId, this.currentX, this.currentY);
                }
                await new Promise(r => setTimeout(r, 300));
                await this.syncPosition();
                attempts++;
                continue; // Reroute from new position
            }
            // Walk to the exit tile (normal walk/warp exits)
            const mapBefore = this.currentMapId;
            const walkResult = await this.walkTo(exit.fromX, exit.fromY);
            // Check if map changed during the walk (walked through a door/warp on the way)
            if (this.currentMapId !== mapBefore) {
                this.mapGraph.recordTransition(mapBefore, exit.fromX, exit.fromY, this.currentMapId, this.currentX, this.currentY);
                // Wait a moment for the new map to settle
                await new Promise(r => setTimeout(r, 300));
                await this.syncPosition();
                attempts++;
                continue; // Reroute from new position
            }
            if (!walkResult) {
                console.log(`[ProxyNav] Failed to walk to exit (${exit.fromX},${exit.fromY}) on map ${this.currentMapId}`);
                attempts++;
                await this.syncPosition();
                continue; // Reroute
            }
            // We're at the exit tile. The map transition should happen automatically
            // (the server handles TransferArea overlap). Wait briefly for it.
            await new Promise(r => setTimeout(r, 500));
            if (this.currentMapId !== mapBefore) {
                this.mapGraph.recordTransition(mapBefore, exit.fromX, exit.fromY, this.currentMapId, this.currentX, this.currentY);
                await new Promise(r => setTimeout(r, 300));
                await this.syncPosition();
                attempts++;
                continue; // Reroute from new map
            }
            // Map didn't change — the exit tile didn't trigger a transition.
            // This happens with wall exits: you need to step INTO the wall.
            // Try stepping in each direction from the exit tile.
            let triggered = false;
            for (const dir of [types_1.Direction.Up, types_1.Direction.Down, types_1.Direction.Left, types_1.Direction.Right]) {
                if (this.cancelled)
                    break;
                await this.movement.step(dir);
                // Small delay to let map change arrive
                await new Promise(r => setTimeout(r, 200));
                if (this.currentMapId !== mapBefore) {
                    triggered = true;
                    this.mapGraph.recordTransition(mapBefore, exit.fromX, exit.fromY, this.currentMapId, this.currentX, this.currentY);
                    break;
                }
                // Step back if we moved but didn't transition
                if (this.currentX !== exit.fromX || this.currentY !== exit.fromY) {
                    await this.walkTo(exit.fromX, exit.fromY);
                    if (this.currentMapId !== mapBefore) {
                        triggered = true;
                        break;
                    }
                }
            }
            if (!triggered) {
                console.log(`[ProxyNav] Exit at (${exit.fromX},${exit.fromY}) on map ${mapBefore} didn't trigger transition`);
            }
            await new Promise(r => setTimeout(r, 300));
            await this.syncPosition();
            attempts++;
        }
        this.state = 'failed';
        this.currentTarget = null;
        this.emit('failed', { reason: 'Exhausted navigation attempts' });
        this.emit('status', this.getStatus());
        return false;
    }
    cancel() {
        this.cancelled = true;
        this.movement.cancel();
        this.state = 'idle';
        this.currentTarget = null;
        this.currentRoute = null;
        this.emit('status', this.getStatus());
    }
    /**
     * Follow a player by tracking their 0x0C EntityWalk packets.
     * Returns a cancel function.
     */
    startFollowing(targetSerial, minDistance = 1) {
        let following = true;
        let walkPromise = null;
        const onEntityWalk = (session, serial, x, y) => {
            if (!following || serial !== targetSerial)
                return;
            if (session.id !== this.session.id)
                return;
            const dx = Math.abs(this.currentX - x);
            const dy = Math.abs(this.currentY - y);
            const dist = dx + dy;
            if (dist <= minDistance)
                return; // close enough
            // Cancel current walk and repath to target
            if (walkPromise) {
                this.movement.cancel();
            }
            walkPromise = this.walkTo(x, y).then(() => {
                walkPromise = null;
            });
        };
        this.proxy.on('entity:walk', onEntityWalk);
        return () => {
            following = false;
            this.proxy.removeListener('entity:walk', onEntityWalk);
            this.movement.cancel();
        };
    }
}
exports.default = ProxyNavigator;
//# sourceMappingURL=proxy-navigator.js.map