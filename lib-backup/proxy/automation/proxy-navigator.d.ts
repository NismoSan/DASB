import EventEmitter from 'events';
import ProxyCollision from './proxy-collision';
import MapGraph from '../../features/navigator/map-graph';
import { Direction } from '../../features/navigator/types';
import type { NavigationTarget, WorldMapNode } from '../../features/navigator/types';
import ProxyMovementController from './proxy-movement';
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
/**
 * Proxy-side navigator. Provides single-map walkTo and cross-map navigateTo
 * for proxy sessions, using the shared collision/map-graph data and
 * per-session ProxyMovementController.
 */
export default class ProxyNavigator extends EventEmitter {
    private proxy;
    private session;
    movement: ProxyMovementController;
    private collision;
    private mapGraph;
    private state;
    private currentTarget;
    private cancelled;
    private repathAttempts;
    private currentRoute;
    private mapLoadResolve;
    private positionResolve;
    /** Tracked entity positions on current map (serial -> {x,y}) for obstacle avoidance */
    entities: Map<number, {
        x: number;
        y: number;
    }>;
    /** World map destination nodes from the most recent 0x2E packet */
    private worldMapNodes;
    private worldMapResolve;
    constructor(proxy: ProxyServer, session: ProxySession, collision: ProxyCollision, mapGraph: MapGraph, options?: {
        walkDelay?: number;
    });
    get currentMapId(): number;
    get currentX(): number;
    get currentY(): number;
    getStatus(): ProxyNavStatus;
    onWalkResponse(direction: Direction, prevX: number, prevY: number): void;
    onMapLocation(x: number, y: number): void;
    onMapChange(mapId: number): void;
    onEntityAdd(serial: number, x: number, y: number): void;
    onEntityWalk(serial: number, prevX: number, prevY: number, direction: number): void;
    onEntityRemove(serial: number): void;
    /** Build a Set of entity-occupied tile keys for use as extraBlocked in findPath */
    private getEntityBlockedTiles;
    onWorldMapReceived(nodes: WorldMapNode[]): void;
    private waitForWorldMap;
    /**
     * Handle a worldmap-type exit: walk near sign post, wait for 0x2E, send 0x3F click.
     * Returns true if map transition succeeded.
     */
    private handleWorldMapExit;
    /**
     * Send 0x3F WorldMapClick to select a destination, then close the UI with 0x11.
     */
    private sendWorldMapClick;
    private findAdjacentWalkable;
    private directionTo;
    onTileData(rowY: number, tileBytes: number[]): void;
    private sendRefresh;
    private syncPosition;
    private waitForMapLoad;
    /**
     * Walk to a tile on the current map.
     */
    walkTo(x: number, y: number): Promise<boolean>;
    private walkToInternal;
    /**
     * Navigate to a tile on any map (cross-map navigation).
     * Process one exit at a time: walk to exit, detect map change, reroute.
     */
    navigateTo(target: NavigationTarget): Promise<boolean>;
    cancel(): void;
    /**
     * Follow a player by tracking their 0x0C EntityWalk packets.
     * Returns a cancel function.
     */
    startFollowing(targetSerial: number, minDistance?: number): () => void;
}
