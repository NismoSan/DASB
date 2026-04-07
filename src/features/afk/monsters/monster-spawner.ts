/**
 * Monster Spawner — per-map spawn controller that creates monsters at intervals.
 */

import fs from 'fs';
import path from 'path';
import { ShadowMonster } from '../shadow-entity';
import { ShadowWorld, ShadowMapInstance } from '../shadow-world';
import { getMonsterTemplate } from './monster-templates';

export interface SpawnerConfig {
    monsterTemplateKey: string;
    maxAmount: number;
    maxPerSpawn: number;
    intervalSecs: number;
    spawnArea?: { x1: number; y1: number; x2: number; y2: number };
}

export interface MapSpawnConfig {
    mapId: number;
    spawners: SpawnerConfig[];
}

interface SpawnerState {
    config: SpawnerConfig;
    mapId: number;
    lastSpawnTime: number;
    spawnedSerials: Set<number>;
}

const MAP_INSTANCES_DIR = path.resolve(__dirname, '../../../../data/afk/map-instances');

export class MonsterSpawner {
    private _world: ShadowWorld;
    private _spawnerStates: SpawnerState[];
    private _allocateSerial: () => number;
    private _onSpawn: ((mapId: number, monster: ShadowMonster) => void) | null;
    private _isWalkable: ((mapId: number, x: number, y: number) => boolean) | null;

    constructor(
        world: ShadowWorld,
        allocateSerial: () => number,
        isWalkable: ((mapId: number, x: number, y: number) => boolean) | null = null,
        onSpawn: ((mapId: number, monster: ShadowMonster) => void) | null = null
    ) {
        this._world = world;
        this._spawnerStates = [];
        this._allocateSerial = allocateSerial;
        this._onSpawn = onSpawn;
        this._isWalkable = isWalkable;
    }

    loadMapSpawns(): void {
        this._spawnerStates = [];
        if (!fs.existsSync(MAP_INSTANCES_DIR)) return;

        for (const dir of fs.readdirSync(MAP_INSTANCES_DIR)) {
            const monstersFile = path.join(MAP_INSTANCES_DIR, dir, 'monsters.json');
            if (!fs.existsSync(monstersFile)) continue;

            try {
                const raw = JSON.parse(fs.readFileSync(monstersFile, 'utf-8'));
                const instanceFile = path.join(MAP_INSTANCES_DIR, dir, 'instance.json');
                let mapId = raw.mapId;
                if (!mapId && fs.existsSync(instanceFile)) {
                    const inst = JSON.parse(fs.readFileSync(instanceFile, 'utf-8'));
                    mapId = inst.mapId ?? inst.instanceId;
                }
                if (!mapId) continue;

                const spawners: SpawnerConfig[] = (raw.spawners ?? raw).filter(
                    (s: any) => s.monsterTemplateKey
                );

                for (const sc of spawners) {
                    this._spawnerStates.push({
                        config: {
                            monsterTemplateKey: sc.monsterTemplateKey,
                            maxAmount: sc.maxAmount ?? 3,
                            maxPerSpawn: sc.maxPerSpawn ?? 1,
                            intervalSecs: sc.intervalSecs ?? 30,
                            spawnArea: sc.spawnArea,
                        },
                        mapId,
                        lastSpawnTime: 0,
                        spawnedSerials: new Set(),
                    });
                }
            } catch (e) {
                console.log(`[MonsterSpawner] Failed to load ${dir}/monsters.json: ${e}`);
            }
        }
        console.log(`[MonsterSpawner] Loaded ${this._spawnerStates.length} spawner configs`);
    }

    tick(): void {
        const now = Date.now();

        for (const state of this._spawnerStates) {
            const instance = this._world.getMapInstance(state.mapId);
            if (!instance || instance.activePlayers.size === 0) continue;

            // Clean up dead/removed serials
            for (const serial of state.spawnedSerials) {
                const monster = instance.monsters.get(serial);
                if (!monster || !monster.alive) {
                    state.spawnedSerials.delete(serial);
                }
            }

            if (state.spawnedSerials.size >= state.config.maxAmount) continue;
            if (now - state.lastSpawnTime < state.config.intervalSecs * 1000) continue;

            const template = getMonsterTemplate(state.config.monsterTemplateKey);
            if (!template) continue;

            const toSpawn = Math.min(
                state.config.maxPerSpawn,
                state.config.maxAmount - state.spawnedSerials.size
            );

            for (let i = 0; i < toSpawn; i++) {
                const pos = this._findSpawnPosition(instance, state.config.spawnArea);
                if (!pos) continue;

                const serial = this._allocateSerial();
                const monster = new ShadowMonster(serial, pos.x, pos.y, state.mapId, template);
                this._world.addMonster(state.mapId, monster);
                state.spawnedSerials.add(serial);

                if (this._onSpawn) {
                    this._onSpawn(state.mapId, monster);
                }
            }

            state.lastSpawnTime = now;
        }
    }

    respawnMonster(mapId: number, template: import('../shadow-entity').ShadowMonsterTemplate, originalX: number, originalY: number): void {
        const instance = this._world.getMapInstance(mapId);
        if (!instance) return;

        const pos = this._findSpawnPosition(instance, undefined) ?? { x: originalX, y: originalY };
        const serial = this._allocateSerial();
        const monster = new ShadowMonster(serial, pos.x, pos.y, mapId, template);
        this._world.addMonster(mapId, monster);

        // Re-register with matching spawner states
        for (const state of this._spawnerStates) {
            if (state.mapId === mapId && state.config.monsterTemplateKey === template.templateKey) {
                state.spawnedSerials.add(serial);
                break;
            }
        }

        if (this._onSpawn) {
            this._onSpawn(mapId, monster);
        }
    }

    private _findSpawnPosition(
        instance: ShadowMapInstance,
        area?: { x1: number; y1: number; x2: number; y2: number }
    ): { x: number; y: number } | null {
        const x1 = area?.x1 ?? 1;
        const y1 = area?.y1 ?? 1;
        const x2 = area?.x2 ?? instance.width - 2;
        const y2 = area?.y2 ?? instance.height - 2;

        for (let attempt = 0; attempt < 50; attempt++) {
            const x = x1 + Math.floor(Math.random() * (x2 - x1 + 1));
            const y = y1 + Math.floor(Math.random() * (y2 - y1 + 1));

            if (this._world.isOccupiedByMonster(instance.mapId, x, y)) continue;
            if (this._isWalkable && !this._isWalkable(instance.mapId, x, y)) continue;
            return { x, y };
        }
        return null;
    }
}
