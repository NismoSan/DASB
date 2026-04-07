"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = __importDefault(require("events"));
const path_1 = __importDefault(require("path"));
const packet_1 = __importDefault(require("../../core/packet"));
const collision_1 = __importDefault(require("./collision"));
const movement_1 = __importDefault(require("./movement"));
const map_graph_1 = __importDefault(require("./map-graph"));
const pathfinder_1 = require("./pathfinder");
const types_1 = require("./types");
const MAX_REPATH_ATTEMPTS = 8;
const MAX_REROUTE_ATTEMPTS = 5;
const REFRESH_WAIT_MS = 400;
const MAP_LOAD_TIMEOUT_MS = 4000;
const EXIT_TRIGGER_TIMEOUT_MS = 2500;
class Navigator extends events_1.default {
    client;
    movement;
    collision;
    mapGraph;
    mapsDir;
    // Server-authoritative state — updated only from packet handlers
    currentMapId;
    currentX;
    currentY;
    mapWidth;
    mapHeight;
    // Navigation state
    state;
    currentTarget;
    cancelled;
    repathAttempts;
    currentRoute;
    mapLoadResolve;
    positionResolve;
    worldMapResolve;
    worldMapNodes;
    constructor(client, options) {
        super();
        this.client = client;
        this.collision = new collision_1.default(options?.dataDir ? options.dataDir + '/collision' : './data/collision');
        this.movement = new movement_1.default(client, { walkDelay: options?.walkDelay });
        this.mapGraph = new map_graph_1.default(options?.dataDir ? options.dataDir + '/map-exits.json' : './data/map-exits.json');
        this.mapsDir = options?.mapsDir || './src/features/navigator/maps';
        this.state = 'idle';
        this.currentTarget = null;
        this.currentMapId = 0;
        this.currentX = 0;
        this.currentY = 0;
        this.mapWidth = 0;
        this.mapHeight = 0;
        this.cancelled = false;
        this.repathAttempts = 0;
        this.currentRoute = null;
        this.mapLoadResolve = null;
        this.positionResolve = null;
        this.worldMapResolve = null;
        this.worldMapNodes = [];
        // Forward movement events
        this.movement.on('step', (data) => {
            this.emit('step', { ...data, mapId: this.currentMapId });
        });
    }
    async init() {
        // Load SOTP data for tile-based collision detection
        const sotpPath = this.collision.dataDir.replace(/[/\\]collision$/, '') + '/sotp.bin';
        await this.collision.loadSotp(sotpPath);
        await this.collision.loadAll();
        await this.mapGraph.load();
    }
    // Build collision grid — tries local .map file first, falls back to server tile data.
    async buildCollision(mapId, width, height, mapData) {
        const mapFile = path_1.default.join(this.mapsDir, `lod${mapId}.map`);
        const loaded = await this.collision.buildFromMapFile(mapId, width, height, mapFile);
        if (loaded) {
            this.saveCollision(mapId);
            return;
        }
        // Fallback to server tile data if map file not available
        if (mapData) {
            this.collision.buildFromTileData(mapId, width, height, mapData);
            this.saveCollision(mapId);
        }
    }
    // Called from 0x04 handler — this is the SERVER's authoritative position
    updatePosition(x, y) {
        const oldX = this.currentX;
        const oldY = this.currentY;
        this.currentX = x;
        this.currentY = y;
        // Always sync movement controller to server position
        this.movement.updatePosition(x, y);
        // Resolve any pending position wait
        if (this.positionResolve) {
            this.positionResolve({ x, y });
            this.positionResolve = null;
        }
        // Log significant position jumps (teleports, GM moves, etc.)
        if (Math.abs(x - oldX) > 2 || Math.abs(y - oldY) > 2) {
            console.log(`[Nav] Position jump: (${oldX},${oldY}) -> (${x},${y})`);
        }
    }
    // Called from 0x15 handler — map info from server
    updateMap(mapId, mapName, width, height) {
        const oldMapId = this.currentMapId;
        this.currentMapId = mapId;
        this.mapWidth = width;
        this.mapHeight = height;
        this.collision.setDimensions(mapId, width, height);
        this.mapGraph.setNode(mapId, { mapId, mapName, width, height });
        console.log(`[Nav] Map updated: ${mapName} (${mapId}) ${width}x${height}`);
        // Record transition for auto-discovery if map changed
        if (oldMapId !== 0 && oldMapId !== mapId) {
            console.log(`[Nav] Map transition detected: ${oldMapId} -> ${mapId}`);
        }
        // Resolve any pending map load wait
        if (this.mapLoadResolve) {
            this.mapLoadResolve();
            this.mapLoadResolve = null;
        }
    }
    // Called from 0x3C handler — early map change signal (arrives before 0x15)
    onMapTransfer(mapId) {
        const oldMapId = this.currentMapId;
        if (mapId !== oldMapId && mapId > 0) {
            this.currentMapId = mapId;
            console.log(`[Nav] 0x3C map transfer: ${oldMapId} -> ${mapId}`);
            // Resolve any pending map load wait immediately
            if (this.mapLoadResolve) {
                this.mapLoadResolve();
                this.mapLoadResolve = null;
            }
        }
    }
    // Called from 0x58 handler
    onMapLoadComplete() {
        if (this.mapLoadResolve) {
            this.mapLoadResolve();
            this.mapLoadResolve = null;
        }
    }
    getStatus() {
        return {
            state: this.state,
            target: this.currentTarget,
            currentMapId: this.currentMapId,
            currentX: this.currentX,
            currentY: this.currentY,
            stepsRemaining: 0,
            mapsRemaining: this.currentRoute ? this.currentRoute.length : 0
        };
    }
    // Send 0x38 refresh to get authoritative position from server
    sendRefresh() {
        const packet = new packet_1.default(0x38);
        this.client.send(packet);
    }
    // Wait for server to confirm position via 0x04 after a refresh
    async syncPosition() {
        this.sendRefresh();
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.positionResolve = null;
                // Return current position if no response
                resolve({ x: this.currentX, y: this.currentY });
            }, REFRESH_WAIT_MS);
            this.positionResolve = (pos) => {
                clearTimeout(timer);
                resolve(pos);
            };
        });
    }
    // Walk to a tile on the CURRENT map with full position verification
    async walkTo(x, y) {
        // Get authoritative position from server first
        const pos = await this.syncPosition();
        console.log(`[Nav] walkTo(${x},${y}) — server says we're at (${pos.x},${pos.y}) on map ${this.currentMapId} (${this.mapWidth}x${this.mapHeight})`);
        this.cancelled = false;
        this.repathAttempts = 0;
        this.state = 'walking';
        this.currentTarget = { mapId: this.currentMapId, x, y };
        this.emit('status', this.getStatus());
        const result = await this.walkToInternal(x, y);
        // walkToInternal returns false if map changed or path failed.
        // Check if we're actually at the destination (or close enough).
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
    async walkToInternal(targetX, targetY) {
        const startingMap = this.currentMapId;
        // Temporary blocked tiles for this walk attempt — these are dynamic obstacles
        // (players, NPCs) that shouldn't permanently corrupt the SOTP-based collision grid.
        const tempBlocked = new Set();
        const toKey = (x, y) => y * this.mapWidth + x;
        while (this.repathAttempts < MAX_REPATH_ATTEMPTS) {
            if (this.cancelled)
                return false;
            // If map changed during walk, the caller needs to handle it
            if (this.currentMapId !== startingMap) {
                console.log(`[Nav] Map changed during walkToInternal: ${startingMap} -> ${this.currentMapId}`);
                return false;
            }
            // Only sync position from server on repath attempts (first attempt uses
            // the position already synced by the caller to avoid redundant refresh packets)
            if (this.repathAttempts > 0) {
                const pos = await this.syncPosition();
                console.log(`[Nav] Repath sync: (${pos.x},${pos.y}) on map ${this.currentMapId}, target: (${targetX},${targetY})`);
                if (this.currentMapId !== startingMap) {
                    console.log(`[Nav] Map changed during sync: ${startingMap} -> ${this.currentMapId}`);
                    return false;
                }
            }
            // Check if we're already there
            if (this.currentX === targetX && this.currentY === targetY) {
                console.log(`[Nav] Already at destination (${targetX},${targetY})`);
                return true;
            }
            // Pathfind from current position, avoiding both permanent and temp-blocked tiles
            const dirs = (0, pathfinder_1.findPath)(this.collision, this.currentMapId, { x: this.currentX, y: this.currentY }, { x: targetX, y: targetY }, this.mapWidth, this.mapHeight, tempBlocked.size > 0 ? tempBlocked : undefined);
            if (!dirs) {
                console.log(`[Nav] No path from (${this.currentX},${this.currentY}) to (${targetX},${targetY}) on map ${this.currentMapId}`);
                // Threshold map handling: some maps (e.g., 3079, 3081) have walls splitting
                // them in half. Walking west triggers the server to "wall hop" you to the
                // other side, then you can path to the exit.
                if (this.repathAttempts < 3) {
                    const teleported = await this.tryWalkToTriggerTeleport(startingMap);
                    if (teleported) {
                        this.repathAttempts++;
                        continue; // retry pathfinding from new position
                    }
                }
                return false;
            }
            if (dirs.length === 0) {
                console.log(`[Nav] Already at destination`);
                return true;
            }
            console.log(`[Nav] Path: ${dirs.length} steps from (${this.currentX},${this.currentY}) to (${targetX},${targetY})${tempBlocked.size > 0 ? ' (avoiding ' + tempBlocked.size + ' temp-blocked)' : ''}`);
            // Walk the path
            const mapBeforeWalk = this.currentMapId;
            await this.movement.walkPath(dirs);
            // Sync navigator position from the movement controller — it tracks
            // the authoritative position from 0x0B walk responses during the walk
            this.currentX = this.movement.currentX;
            this.currentY = this.movement.currentY;
            // Check if map changed during the walk (exit tile triggered transition)
            if (this.currentMapId !== mapBeforeWalk) {
                console.log(`[Nav] Map changed during walk: ${mapBeforeWalk} -> ${this.currentMapId}`);
                return false; // caller (followNextExit) will detect and handle the transition
            }
            // After walk, use the position tracked from walk responses (no extra refresh)
            console.log(`[Nav] After walk — position: (${this.currentX},${this.currentY}), target: (${targetX},${targetY})`);
            // Check if we actually arrived
            if (this.currentX === targetX && this.currentY === targetY) {
                return true;
            }
            if (this.cancelled)
                return false;
            // Didn't arrive — figure out what tile blocked us and add it as a
            // temporary obstacle so the next repath avoids it. We don't permanently
            // mark the collision grid because the blocker is likely a player/NPC.
            const nextDelta = types_1.DIRECTION_DELTA[dirs[0]];
            if (nextDelta) {
                // The first step of the path we just tried to walk points at the obstacle
                // But we may have walked partway — recalculate from current position
                const testDirs = (0, pathfinder_1.findPath)(this.collision, this.currentMapId, { x: this.currentX, y: this.currentY }, { x: targetX, y: targetY }, this.mapWidth, this.mapHeight);
                if (testDirs && testDirs.length > 0) {
                    const delta = types_1.DIRECTION_DELTA[testDirs[0]];
                    const blockedX = this.currentX + delta.x;
                    const blockedY = this.currentY + delta.y;
                    // Don't block the target tile — it might be an exit
                    if (blockedX !== targetX || blockedY !== targetY) {
                        tempBlocked.add(toKey(blockedX, blockedY));
                        console.log(`[Nav] Temp-blocked tile (${blockedX},${blockedY}) — repath ${this.repathAttempts + 1}/${MAX_REPATH_ATTEMPTS}`);
                    }
                }
            }
            this.repathAttempts++;
        }
        console.log(`[Nav] Exhausted repath attempts`);
        return false;
    }
    // Navigate to a tile on ANY map (cross-map navigation)
    async navigateTo(target) {
        // Get authoritative position from server
        const pos = await this.syncPosition();
        console.log(`[Nav] navigateTo(map ${target.mapId}, ${target.x},${target.y}) — currently at (${pos.x},${pos.y}) on map ${this.currentMapId}`);
        this.cancelled = false;
        this.currentTarget = target;
        this.state = 'walking';
        this.emit('status', this.getStatus());
        let rerouteAttempts = 0;
        while (rerouteAttempts < MAX_REROUTE_ATTEMPTS) {
            if (this.cancelled) {
                this.state = 'idle';
                this.emit('status', this.getStatus());
                return false;
            }
            // Already on target map? Walk to tile if specified, otherwise we're done.
            if (this.currentMapId === target.mapId) {
                if (target.x < 0 || target.y < 0) {
                    console.log(`[Nav] Arrived on target map ${target.mapId} (no tile target)`);
                    this.state = 'idle';
                    this.currentTarget = null;
                    this.emit('arrived', { mapId: this.currentMapId, x: this.currentX, y: this.currentY });
                    this.emit('status', this.getStatus());
                    return true;
                }
                console.log(`[Nav] On target map ${target.mapId}, walking to (${target.x},${target.y})`);
                const result = await this.walkTo(target.x, target.y);
                return result;
            }
            // A* route from current position to target — weighs total walking distance
            this.currentRoute = this.mapGraph.findRoute(this.currentMapId, target.mapId, this.currentX, this.currentY, target.x, target.y);
            if (!this.currentRoute || this.currentRoute.length === 0) {
                console.log(`[Nav] No route from map ${this.currentMapId} to map ${target.mapId} — trying to discover exits`);
                // No known route — try to discover exits by exploring map edges
                const discovered = await this.exploreForExits();
                if (this.cancelled) {
                    this.state = 'idle';
                    this.emit('status', this.getStatus());
                    return false;
                }
                if (discovered) {
                    console.log(`[Nav] Discovered exits, recalculating route...`);
                    rerouteAttempts++;
                    continue; // retry with newly discovered exits
                }
                console.log(`[Nav] No route and no exits discovered from map ${this.currentMapId}`);
                this.state = 'failed';
                this.emit('failed', { reason: `No route from map ${this.currentMapId} to map ${target.mapId}` });
                this.emit('status', this.getStatus());
                return false;
            }
            console.log(`[Nav] Route: ${this.currentRoute.length} map transitions from map ${this.currentMapId} to map ${target.mapId}`);
            this.emit('status', this.getStatus());
            // Try to follow the route one exit at a time
            const exitResult = await this.followNextExit();
            if (exitResult === 'cancelled') {
                this.state = 'idle';
                this.emit('status', this.getStatus());
                return false;
            }
            if (exitResult === 'arrived_target_map') {
                // We're on the target map now, loop back to walk to destination
                continue;
            }
            if (exitResult === 'transition_ok') {
                // Successfully transitioned to the expected map, recalculate and continue
                console.log(`[Nav] Transition successful, now on map ${this.currentMapId}. Recalculating route...`);
                continue;
            }
            if (exitResult === 'unexpected_map') {
                // Ended up on a different map than expected — that's fine, just reroute
                rerouteAttempts++;
                console.log(`[Nav] Unexpected map ${this.currentMapId} — rerouting (attempt ${rerouteAttempts}/${MAX_REROUTE_ATTEMPTS})`);
                continue;
            }
            if (exitResult === 'walk_failed') {
                // Couldn't reach the exit tile
                rerouteAttempts++;
                console.log(`[Nav] Couldn't reach exit tile — rerouting (attempt ${rerouteAttempts}/${MAX_REROUTE_ATTEMPTS})`);
                continue;
            }
            if (exitResult === 'transition_failed') {
                // Reached exit tile but map didn't change
                rerouteAttempts++;
                console.log(`[Nav] Map transition didn't trigger — rerouting (attempt ${rerouteAttempts}/${MAX_REROUTE_ATTEMPTS})`);
                continue;
            }
        }
        console.log(`[Nav] Exhausted reroute attempts (${MAX_REROUTE_ATTEMPTS})`);
        this.state = 'failed';
        this.emit('failed', { reason: 'Exhausted reroute attempts', mapId: this.currentMapId });
        this.emit('status', this.getStatus());
        return false;
    }
    // Follow the next exit in the current route
    async followNextExit() {
        if (!this.currentRoute || this.currentRoute.length === 0) {
            return 'arrived_target_map';
        }
        const nextExit = this.currentRoute[0];
        const mapBeforeWalk = this.currentMapId;
        const expectedNextMap = nextExit.toMapId;
        console.log(`[Nav] Walking to exit at (${nextExit.fromX},${nextExit.fromY}) on map ${this.currentMapId} -> expected map ${expectedNextMap}`);
        if (this.cancelled)
            return 'cancelled';
        // Ensure collision grid is built for this map before checking walkability
        if (!this.collision.hasGrid(this.currentMapId) && this.mapWidth > 0 && this.mapHeight > 0) {
            console.log(`[Nav] No collision grid for map ${this.currentMapId} — building now`);
            await this.buildCollision(this.currentMapId, this.mapWidth, this.mapHeight);
        }
        // Worldmap exits: walk near the sign post then send the 0x3F click packet.
        // The bot doesn't need to stand on the sign post tile — just be nearby.
        if (nextExit.type === 'worldmap' && nextExit.clickX && nextExit.clickY) {
            return await this.handleWorldMapExit(nextExit, mapBeforeWalk, expectedNextMap);
        }
        // Check if exit tile is a wall (blocked in collision grid).
        // In DA, many exits are wall tiles — you trigger the transition by stepping INTO them.
        const exitIsBlocked = !this.collision.isWalkable(this.currentMapId, nextExit.fromX, nextExit.fromY);
        if (exitIsBlocked) {
            return await this.handleWallExit(nextExit, mapBeforeWalk, expectedNextMap);
        }
        // Exit tile is walkable — walk directly to it
        this.repathAttempts = 0;
        const reachedExit = await this.walkToInternal(nextExit.fromX, nextExit.fromY);
        // Check if map already changed during the walk (exit tile triggered transition)
        const transResult = this.checkMapTransition(mapBeforeWalk, nextExit, expectedNextMap);
        if (transResult)
            return transResult;
        if (!reachedExit) {
            // Re-check if the exit tile is actually a wall (collision may have loaded after initial check)
            if (!this.collision.isWalkable(this.currentMapId, nextExit.fromX, nextExit.fromY)) {
                console.log(`[Nav] Exit (${nextExit.fromX},${nextExit.fromY}) is actually a wall — switching to wall-exit approach`);
                return await this.handleWallExit(nextExit, mapBeforeWalk, expectedNextMap);
            }
            // Threshold map wall-hop: if we can't path to the exit, try walking west
            // to trigger the server wall-hop, then retry walking to the exit.
            if (this.currentMapId === mapBeforeWalk) {
                console.log(`[Nav] Can't reach exit (${nextExit.fromX},${nextExit.fromY}) — trying wall-hop`);
                const hopped = await this.tryWalkToTriggerTeleport(mapBeforeWalk);
                if (hopped && this.currentMapId === mapBeforeWalk) {
                    // Retry walking to the exit after the hop
                    this.repathAttempts = 0;
                    const retryResult = await this.walkToInternal(nextExit.fromX, nextExit.fromY);
                    const retryTrans = this.checkMapTransition(mapBeforeWalk, nextExit, expectedNextMap);
                    if (retryTrans)
                        return retryTrans;
                    if (retryResult) {
                        // Reached exit tile after hop — wait for transition
                        this.state = 'waiting_map_load';
                        this.emit('status', this.getStatus());
                        await this.waitForMapLoad(MAP_LOAD_TIMEOUT_MS);
                        const waitResult = this.checkMapTransition(mapBeforeWalk, nextExit, expectedNextMap);
                        if (waitResult)
                            return waitResult;
                        return await this.tryStepAllDirections(mapBeforeWalk, nextExit, expectedNextMap);
                    }
                }
            }
            console.log(`[Nav] Could not reach exit tile (${nextExit.fromX},${nextExit.fromY}) on map ${this.currentMapId}`);
            return 'walk_failed';
        }
        if (this.cancelled)
            return 'cancelled';
        // We're on the exit tile but map hasn't changed yet
        // Wait for map load, then try stepping to trigger the transition
        this.state = 'waiting_map_load';
        this.emit('status', this.getStatus());
        await this.waitForMapLoad(MAP_LOAD_TIMEOUT_MS);
        const waitResult = this.checkMapTransition(mapBeforeWalk, nextExit, expectedNextMap);
        if (waitResult)
            return waitResult;
        // Try stepping in each direction to trigger the exit
        return await this.tryStepAllDirections(mapBeforeWalk, nextExit, expectedNextMap);
    }
    // Explore map edges to discover exits when we're on an unknown map
    // Walks to edge tiles and tries stepping off the map to trigger transitions
    async exploreForExits() {
        const mapBefore = this.currentMapId;
        const w = this.mapWidth;
        const h = this.mapHeight;
        let discovered = false;
        console.log(`[Nav] Exploring map ${mapBefore} (${w}x${h}) for exits...`);
        // Strategy: try common exit locations for DA maps
        // 1. Bottom-center (most common for building doors)
        // 2. Bottom edge tiles
        // 3. Top edge tiles
        // 4. Left/right edges
        const candidates = [];
        // Bottom center area (doors)
        const centerX = Math.floor(w / 2);
        for (let dx = -2; dx <= 2; dx++) {
            const cx = centerX + dx;
            if (cx >= 0 && cx < w) {
                candidates.push({ x: cx, y: h - 1, dirs: [types_1.Direction.Down] });
            }
        }
        // Bottom edge
        for (let x = 0; x < w; x += 3) {
            candidates.push({ x, y: h - 1, dirs: [types_1.Direction.Down] });
        }
        // Top edge
        for (let x = 0; x < w; x += 3) {
            candidates.push({ x, y: 0, dirs: [types_1.Direction.Up] });
        }
        // Right edge
        for (let y = 0; y < h; y += 3) {
            candidates.push({ x: w - 1, y, dirs: [types_1.Direction.Right] });
        }
        // Left edge
        for (let y = 0; y < h; y += 3) {
            candidates.push({ x: 0, y, dirs: [types_1.Direction.Left] });
        }
        for (const candidate of candidates) {
            if (this.cancelled)
                return discovered;
            if (this.currentMapId !== mapBefore) {
                // Already transitioned — record it
                discovered = true;
                break;
            }
            // Try to walk to this edge tile
            this.repathAttempts = 0;
            const reached = await this.walkToInternal(candidate.x, candidate.y);
            if (this.currentMapId !== mapBefore) {
                // Transitioned while walking to edge
                this.mapGraph.recordTransition(mapBefore, candidate.x, candidate.y, this.currentMapId, this.currentX, this.currentY);
                this.saveMapGraph();
                discovered = true;
                break;
            }
            if (!reached)
                continue;
            // We're on the edge tile — try stepping off the map
            for (const dir of candidate.dirs) {
                if (this.cancelled)
                    return discovered;
                await this.movement.step(dir);
                if (this.currentMapId !== mapBefore) {
                    this.mapGraph.recordTransition(mapBefore, candidate.x, candidate.y, this.currentMapId, this.currentX, this.currentY);
                    this.saveMapGraph();
                    discovered = true;
                    break;
                }
                // Wait briefly for map load
                const loaded = await this.waitForMapLoad(2000);
                if (loaded || this.currentMapId !== mapBefore) {
                    this.mapGraph.recordTransition(mapBefore, candidate.x, candidate.y, this.currentMapId, this.currentX, this.currentY);
                    this.saveMapGraph();
                    discovered = true;
                    break;
                }
            }
            if (discovered)
                break;
        }
        if (discovered) {
            console.log(`[Nav] Discovered exit from map ${mapBefore} -> map ${this.currentMapId} at (${this.currentX},${this.currentY})`);
        }
        else {
            console.log(`[Nav] No exits found on map ${mapBefore}`);
        }
        return discovered;
    }
    // Handle a wall exit: walk to an adjacent walkable tile, then step into the wall
    // Handle a worldmap sign post exit: walk to adjacent tile, step onto sign post, send 0x3F.
    // If the sign post is blocked (player on it), send 0x3F anyway from adjacent tile.
    async handleWorldMapExit(nextExit, mapBeforeWalk, expectedNextMap) {
        console.log(`[Nav] Worldmap exit at (${nextExit.fromX},${nextExit.fromY}) — walking to sign post then sending 0x3F`);
        // Clear any stale nodes so we can detect a fresh 0x2E
        this.worldMapNodes = [];
        // Set up the world map listener BEFORE walking — the 0x2E can arrive
        // during the walk if we pass near the sign post, and we need to catch it.
        const worldMapPromise = this.waitForWorldMap(15000);
        // First walk to an adjacent tile near the sign post
        const adjacent = this.findAdjacentWalkable(nextExit.fromX, nextExit.fromY);
        const walkTarget = adjacent || { x: nextExit.fromX, y: nextExit.fromY };
        this.repathAttempts = 0;
        await this.walkToInternal(walkTarget.x, walkTarget.y);
        const transResult = this.checkMapTransition(mapBeforeWalk, nextExit, expectedNextMap);
        if (transResult)
            return transResult;
        if (this.cancelled)
            return 'cancelled';
        // Check if 0x2E already arrived during the walk (sign post triggered early)
        if (this.worldMapNodes.length > 0) {
            console.log(`[Nav] World map already opened during walk — sending 0x3F click...`);
            const wmResult = await this.handleWorldMapClick(nextExit, mapBeforeWalk, expectedNextMap);
            if (wmResult)
                return wmResult;
            return 'transition_failed';
        }
        // Try stepping onto the sign post tile (single attempt — don't loop if blocked)
        const stepDir = this.directionTo(this.currentX, this.currentY, nextExit.fromX, nextExit.fromY);
        if (stepDir !== null) {
            console.log(`[Nav] Stepping onto sign post at (${nextExit.fromX},${nextExit.fromY})`);
            await this.movement.step(stepDir);
            const stepResult = this.checkMapTransition(mapBeforeWalk, nextExit, expectedNextMap);
            if (stepResult)
                return stepResult;
        }
        if (this.cancelled)
            return 'cancelled';
        // Check again if 0x2E arrived during the step
        if (this.worldMapNodes.length > 0) {
            console.log(`[Nav] World map opened during step — sending 0x3F click...`);
            const wmResult = await this.handleWorldMapClick(nextExit, mapBeforeWalk, expectedNextMap);
            if (wmResult)
                return wmResult;
            return 'transition_failed';
        }
        // Wait for the world map UI to open (0x2E packet from server)
        console.log(`[Nav] Waiting for world map UI (0x2E)...`);
        const gotWorldMap = await worldMapPromise;
        if (!gotWorldMap) {
            console.log(`[Nav] World map UI did not open — 0x2E not received`);
            return 'transition_failed';
        }
        // 0x2E received — send 0x3F immediately (no waiting for 0x58 first).
        // The real client sends 0x3F right after 0x2E; 0x58 arrives AFTER as the
        // map transition response.
        console.log(`[Nav] World map opened — sending 0x3F click...`);
        const wmResult = await this.handleWorldMapClick(nextExit, mapBeforeWalk, expectedNextMap);
        if (wmResult)
            return wmResult;
        return 'transition_failed';
    }
    async handleWallExit(nextExit, mapBeforeWalk, expectedNextMap) {
        const adjacent = this.findAdjacentWalkable(nextExit.fromX, nextExit.fromY);
        if (!adjacent) {
            console.log(`[Nav] No walkable tile adjacent to blocked exit (${nextExit.fromX},${nextExit.fromY})`);
            return 'walk_failed';
        }
        console.log(`[Nav] Exit (${nextExit.fromX},${nextExit.fromY}) is a wall — walking to adjacent (${adjacent.x},${adjacent.y}) then stepping into it`);
        this.repathAttempts = 0;
        const reachedAdj = await this.walkToInternal(adjacent.x, adjacent.y);
        // Check if map changed during walk
        const transResult = this.checkMapTransition(mapBeforeWalk, nextExit, expectedNextMap);
        if (transResult)
            return transResult;
        if (!reachedAdj) {
            console.log(`[Nav] Could not reach adjacent tile (${adjacent.x},${adjacent.y}) for exit`);
            return 'walk_failed';
        }
        if (this.cancelled)
            return 'cancelled';
        // Step into the wall tile to trigger the exit
        const stepDir = this.directionTo(this.currentX, this.currentY, nextExit.fromX, nextExit.fromY);
        if (stepDir !== null) {
            await this.movement.step(stepDir);
            // Wait for map transition
            await this.waitForMapLoad(EXIT_TRIGGER_TIMEOUT_MS);
        }
        const transResult2 = this.checkMapTransition(mapBeforeWalk, nextExit, expectedNextMap);
        if (transResult2)
            return transResult2;
        // For worldmap exits, wait for 0x2E then send the WorldMapClick packet
        if (nextExit.type === 'worldmap' && nextExit.clickX && nextExit.clickY) {
            const wmResult = await this.handleWorldMapClick(nextExit, mapBeforeWalk, expectedNextMap);
            if (wmResult)
                return wmResult;
        }
        // Didn't transition — try all directions
        return await this.tryStepAllDirections(mapBeforeWalk, nextExit, expectedNextMap);
    }
    // Find a walkable tile adjacent to the given position (for stepping into wall exits)
    findAdjacentWalkable(x, y) {
        for (const dir of [types_1.Direction.Up, types_1.Direction.Right, types_1.Direction.Down, types_1.Direction.Left]) {
            const delta = types_1.DIRECTION_DELTA[dir];
            const nx = x + delta.x;
            const ny = y + delta.y;
            if (nx >= 0 && ny >= 0 && nx < this.mapWidth && ny < this.mapHeight &&
                this.collision.isWalkable(this.currentMapId, nx, ny)) {
                return { x: nx, y: ny };
            }
        }
        return null;
    }
    // Get the direction from (fx,fy) to an adjacent tile (tx,ty)
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
    // Check if a map transition happened and return the appropriate result
    checkMapTransition(mapBeforeWalk, nextExit, expectedNextMap) {
        if (this.currentMapId === mapBeforeWalk)
            return null;
        this.mapGraph.recordTransition(mapBeforeWalk, nextExit.fromX, nextExit.fromY, this.currentMapId, this.currentX, this.currentY);
        this.saveMapGraph();
        if (this.currentMapId === expectedNextMap) {
            console.log(`[Nav] Map changed to expected map ${this.currentMapId}`);
            return 'transition_ok';
        }
        if (this.currentMapId === this.currentTarget?.mapId) {
            console.log(`[Nav] Map changed — landed on target map ${this.currentMapId}!`);
            return 'arrived_target_map';
        }
        console.log(`[Nav] Map changed to UNEXPECTED map ${this.currentMapId} (expected ${expectedNextMap})`);
        this.mapGraph.updateExit(mapBeforeWalk, nextExit.fromX, nextExit.fromY, this.currentMapId, this.currentX, this.currentY);
        this.saveMapGraph();
        return 'unexpected_map';
    }
    // Called from 0x2E handler when the world map UI opens.
    // Stores the parsed nodes so handleWorldMapClick can look up the correct one.
    onWorldMapReceived(nodes) {
        if (nodes && nodes.length > 0) {
            this.worldMapNodes = nodes;
        }
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
    async handleWorldMapClick(nextExit, mapBeforeWalk, expectedNextMap) {
        // Find the best 0x2E node to click.
        // The toMapId in map-exits.json often doesn't match the 0x2E node mapIds,
        // so we try: exact match first, then find whichever node routes closest
        // to our final navigation target.
        let node = this.worldMapNodes.find(n => n.mapId === expectedNextMap);
        if (!node && this.worldMapNodes.length > 0 && this.currentTarget) {
            // No exact match — pick the node that gives the best route to our target
            let bestNode;
            let bestCost = Infinity;
            for (const candidate of this.worldMapNodes) {
                if (candidate.mapId === this.currentTarget.mapId) {
                    // Direct hit — this node lands on our target map
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
                console.log(`[Nav] Matched 0x2E node "${bestNode.name}" (mapId=${bestNode.mapId}) — best route to target (${bestCost} transitions)`);
                node = bestNode;
            }
        }
        if (node) {
            // 0x3F format: checksum(u16) + mapId(u16) + mapX(u16) + mapY(u16)
            console.log(`[Nav] Sending WorldMapClick — node "${node.name}" checksum=${node.checksum} mapId=${node.mapId} mapX=${node.mapX} mapY=${node.mapY}`);
            const packet = new packet_1.default(0x3F);
            packet.writeUInt16(node.checksum);
            packet.writeUInt16(node.mapId);
            packet.writeUInt16(node.mapX);
            packet.writeUInt16(node.mapY);
            this.client.send(packet);
        }
        else {
            // Fallback: use clickX/clickY from map-exits.json as screen coordinates
            console.log(`[Nav] No 0x2E node for map ${expectedNextMap} — falling back to clickX/clickY (${nextExit.clickX},${nextExit.clickY})`);
            const packet = new packet_1.default(0x3F);
            packet.writeUInt16(nextExit.clickX);
            packet.writeUInt16(nextExit.clickY);
            this.client.send(packet);
        }
        // Wait for map transition after sending the click.
        // If we picked a different node than expected, update expectedNextMap so
        // checkMapTransition recognizes it as a successful transition.
        const actualExpected = node ? node.mapId : expectedNextMap;
        await this.waitForMapLoad(MAP_LOAD_TIMEOUT_MS);
        // Close the world map dialog (0x11 with payload 0x00).
        // The server blocks all movement until this is sent.
        const closePacket = new packet_1.default(0x11);
        closePacket.writeByte(0x00);
        this.client.send(closePacket);
        console.log(`[Nav] Sent world map close (0x11)`);
        return this.checkMapTransition(mapBeforeWalk, nextExit, actualExpected);
    }
    // Threshold map wall-hop: on maps like 3079/3081 (14x7 with wall at y=3-4),
    // the bot lands on the bottom half (y=5-6) but the exit is on the top half (y=0-2).
    // Walking WEST triggers the server to teleport you to the other side.
    // Only applies to small maps that look like threshold maps.
    isThresholdMap() {
        return this.mapWidth <= 20 && this.mapHeight <= 10;
    }
    async tryWalkToTriggerTeleport(expectedMap) {
        if (!this.isThresholdMap()) {
            return false;
        }
        const beforeX = this.currentX;
        const beforeY = this.currentY;
        console.log(`[Nav] Threshold wall-hop: map ${this.currentMapId} (${this.mapWidth}x${this.mapHeight}) from (${beforeX},${beforeY})`);
        if (this.cancelled)
            return false;
        if (this.currentMapId !== expectedMap)
            return false;
        // Walking DOWN/SOUTH triggers the wall-hop on threshold maps.
        // From the bottom half (y=5-6), walk south toward/off the bottom edge.
        // The server hops you to the top half, then walking south again exits.
        console.log(`[Nav] Walking south to trigger wall-hop from (${beforeX},${beforeY})`);
        for (let i = 0; i < 3; i++) {
            if (this.cancelled)
                return false;
            if (this.currentMapId !== expectedMap)
                return false;
            await this.movement.step(types_1.Direction.Down);
            this.currentX = this.movement.currentX;
            this.currentY = this.movement.currentY;
            await new Promise(r => setTimeout(r, 400));
            // Check if map changed (walked off edge)
            if (this.currentMapId !== expectedMap) {
                console.log(`[Nav] Map changed during wall-hop: now on map ${this.currentMapId}`);
                return true;
            }
        }
        // Sync to get authoritative position — server may have teleported us
        await new Promise(r => setTimeout(r, 500));
        const pos = await this.syncPosition();
        console.log(`[Nav] Post wall-hop sync: was (${beforeX},${beforeY}), now (${pos.x},${pos.y}) on map ${this.currentMapId}`);
        if (this.currentMapId !== expectedMap) {
            return true;
        }
        // Check if Y changed (hopped to other side of wall)
        if (pos.y !== beforeY) {
            console.log(`[Nav] Wall-hop succeeded! Y: ${beforeY} -> ${pos.y}`);
            return true;
        }
        console.log(`[Nav] No wall-hop triggered`);
        return false;
    }
    // Try stepping in each direction to trigger an exit transition
    async tryStepAllDirections(mapBeforeWalk, nextExit, expectedNextMap) {
        for (const dir of [types_1.Direction.Up, types_1.Direction.Right, types_1.Direction.Down, types_1.Direction.Left]) {
            if (this.cancelled)
                return 'cancelled';
            await this.movement.step(dir);
            if (this.currentMapId !== mapBeforeWalk) {
                const result = this.checkMapTransition(mapBeforeWalk, nextExit, expectedNextMap);
                if (result)
                    return result;
            }
            const loaded = await this.waitForMapLoad(EXIT_TRIGGER_TIMEOUT_MS);
            if (loaded || this.currentMapId !== mapBeforeWalk) {
                const result = this.checkMapTransition(mapBeforeWalk, nextExit, expectedNextMap);
                if (result)
                    return result;
            }
        }
        console.log(`[Nav] Map transition did not trigger near (${nextExit.fromX},${nextExit.fromY}) on map ${this.currentMapId}`);
        return 'transition_failed';
    }
    waitForMapLoad(timeoutMs) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.mapLoadResolve = null;
                resolve(false);
            }, timeoutMs);
            this.mapLoadResolve = () => {
                clearTimeout(timer);
                resolve(true);
            };
        });
    }
    // Save map graph in background (fire-and-forget)
    saveMapGraph() {
        this.mapGraph.save().catch(err => {
            console.log(`[Nav] Failed to save map graph: ${err.message}`);
        });
    }
    // Save collision data for a map in background (fire-and-forget)
    saveCollision(mapId) {
        this.collision.save(mapId).catch(err => {
            console.log(`[Nav] Failed to save collision for map ${mapId}: ${err.message}`);
        });
    }
    stop() {
        this.cancelled = true;
        this.movement.cancel();
        this.currentTarget = null;
        this.currentRoute = null;
        this.state = 'idle';
        if (this.mapLoadResolve) {
            this.mapLoadResolve();
            this.mapLoadResolve = null;
        }
        if (this.positionResolve) {
            this.positionResolve({ x: this.currentX, y: this.currentY });
            this.positionResolve = null;
        }
        if (this.worldMapResolve) {
            this.worldMapResolve();
            this.worldMapResolve = null;
        }
        this.emit('status', this.getStatus());
    }
    pause() {
        if (this.state === 'walking') {
            this.movement.cancel();
            this.state = 'paused';
            this.emit('status', this.getStatus());
        }
    }
    resume() {
        if (this.state === 'paused' && this.currentTarget) {
            if (this.currentMapId === this.currentTarget.mapId) {
                this.walkTo(this.currentTarget.x, this.currentTarget.y);
            }
            else {
                this.navigateTo(this.currentTarget);
            }
        }
    }
}
exports.default = Navigator;
//# sourceMappingURL=navigator.js.map