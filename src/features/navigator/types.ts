export interface Point {
  x: number;
  y: number;
}

export enum Direction {
  Up = 0,
  Right = 1,
  Down = 2,
  Left = 3
}

export const DIRECTION_DELTA: Record<Direction, Point> = {
  [Direction.Up]:    { x: 0, y: -1 },
  [Direction.Right]: { x: 1, y: 0 },
  [Direction.Down]:  { x: 0, y: 1 },
  [Direction.Left]:  { x: -1, y: 0 },
};

export interface MapExit {
  fromMapId: number;
  fromX: number;
  fromY: number;
  toMapId: number;
  toX: number;
  toY: number;
  type: 'walk' | 'warp' | 'worldmap';
  clickX?: number;  // WorldMapClick screen X (for worldmap type exits)
  clickY?: number;  // WorldMapClick screen Y (for worldmap type exits)
}

export interface WorldMapNode {
  name: string;
  checksum: number;
  mapId: number;
  mapX: number;
  mapY: number;
}

export interface MapNode {
  mapId: number;
  mapName: string;
  width: number;
  height: number;
}

export interface NavigationTarget {
  mapId: number;
  x: number;
  y: number;
}

export type NavState = 'idle' | 'walking' | 'waiting_map_load' | 'paused' | 'failed';

export interface NavStatus {
  state: NavState;
  target: NavigationTarget | null;
  currentMapId: number;
  currentX: number;
  currentY: number;
  stepsRemaining: number;
  mapsRemaining: number;
}
