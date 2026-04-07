import type CollisionMap from './collision';
import { Direction, type Point } from './types';
export declare function findPath(collision: CollisionMap, mapId: number, start: Point, end: Point, width: number, height: number, extraBlocked?: Set<number>): Direction[] | null;
