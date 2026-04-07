import type { MapExit, MapNode } from './types';
export default class MapGraph {
    private exits;
    private nodes;
    private filePath;
    constructor(filePath?: string);
    addExit(exit: MapExit): void;
    getExits(mapId: number): MapExit[];
    getNode(mapId: number): MapNode | undefined;
    setNode(mapId: number, node: MapNode): void;
    recordTransition(fromMapId: number, fromX: number, fromY: number, toMapId: number, toX: number, toY: number): void;
    updateExit(fromMapId: number, fromX: number, fromY: number, actualToMapId: number, actualToX: number, actualToY: number): void;
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
    findRoute(fromMapId: number, toMapId: number, startX?: number, startY?: number, targetX?: number, targetY?: number): MapExit[] | null;
    addWorldMapNodes(fieldName: string, nodes: {
        name: string;
        checksum: number;
        mapId: number;
        mapX: number;
        mapY: number;
    }[]): void;
    /** Return all known map nodes (id + name) */
    getAllNodes(): MapNode[];
    /** Return all unique map IDs that appear in the exit graph */
    getReachableMapIds(): number[];
    private get nodesFilePath();
    save(): Promise<void>;
    load(): Promise<void>;
}
