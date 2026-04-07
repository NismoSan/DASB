/**
 * Multi-Map World — map instance configuration and warp reactor loading.
 */

import fs from 'fs';
import path from 'path';

export interface WarpReactor {
    sourceX: number;
    sourceY: number;
    targetMapId: number;
    targetX: number;
    targetY: number;
    label?: string;
}

export interface MapInstanceConfig {
    mapId: number;
    templateKey: string;
    name: string;
    music?: number;
    spawnX: number;
    spawnY: number;
    width?: number;
    height?: number;
}

const MAP_INSTANCES_DIR = path.resolve(__dirname, '../../../../data/afk/map-instances');

const mapConfigCache: Map<number, MapInstanceConfig> = new Map();
const warpCache: Map<number, WarpReactor[]> = new Map();

export function loadMapConfigs(): void {
    mapConfigCache.clear();
    warpCache.clear();
    if (!fs.existsSync(MAP_INSTANCES_DIR)) return;

    for (const dir of fs.readdirSync(MAP_INSTANCES_DIR)) {
        const instFile = path.join(MAP_INSTANCES_DIR, dir, 'instance.json');
        if (!fs.existsSync(instFile)) continue;

        try {
            const raw = JSON.parse(fs.readFileSync(instFile, 'utf-8'));
            const config: MapInstanceConfig = {
                mapId: raw.mapId ?? raw.instanceId,
                templateKey: raw.templateKey ?? dir,
                name: raw.name ?? dir,
                music: raw.music,
                spawnX: raw.spawnX ?? 10,
                spawnY: raw.spawnY ?? 10,
                width: raw.width,
                height: raw.height,
            };
            if (config.mapId) {
                mapConfigCache.set(config.mapId, config);
            }
        } catch (e) {
            console.log(`[MapConfig] Failed to load ${dir}/instance.json: ${e}`);
        }

        // Load reactors (warps)
        const reactorsFile = path.join(MAP_INSTANCES_DIR, dir, 'reactors.json');
        if (fs.existsSync(reactorsFile)) {
            try {
                const raw = JSON.parse(fs.readFileSync(reactorsFile, 'utf-8'));
                const mapId = raw.mapId;
                if (mapId) {
                    const warps: WarpReactor[] = (raw.reactors ?? raw.warps ?? []).map((w: any) => ({
                        sourceX: w.sourceX ?? w.x,
                        sourceY: w.sourceY ?? w.y,
                        targetMapId: w.targetMapId ?? w.targetMap,
                        targetX: w.targetX,
                        targetY: w.targetY,
                        label: w.label,
                    }));
                    warpCache.set(mapId, warps);
                }
            } catch (e) {
                console.log(`[MapConfig] Failed to load ${dir}/reactors.json: ${e}`);
            }
        }
    }

    console.log(`[MapConfig] Loaded ${mapConfigCache.size} map configs, ${warpCache.size} warp sets`);
}

export function getMapConfig(mapId: number): MapInstanceConfig | undefined {
    return mapConfigCache.get(mapId);
}

export function getAllMapConfigs(): Map<number, MapInstanceConfig> {
    return mapConfigCache;
}

export function getWarpsForMap(mapId: number): WarpReactor[] {
    return warpCache.get(mapId) ?? [];
}

export function findWarpAt(mapId: number, x: number, y: number): WarpReactor | undefined {
    const warps = warpCache.get(mapId);
    if (!warps) return undefined;
    return warps.find(w => w.sourceX === x && w.sourceY === y);
}
