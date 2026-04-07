import type ProxyServer from '../../proxy/proxy-server';
import type ProxySession from '../../proxy/proxy-session';
import type AugmentationEngine from '../../proxy/augmentation/index';
import type NpcInjector from '../../proxy/augmentation/npc-injector';
import type { DialogEvent, VirtualNPC } from '../../proxy/augmentation/npc-injector';
import DialogHandler, { DialogType } from '../../proxy/augmentation/dialog-handler';
import type ChatInjector from '../../proxy/augmentation/chat-injector';
import {
    buildFishingDerbyBiggestFishText,
    buildFishingDerbyClaimStatusText,
    buildFishingDerbyLeadersText,
    buildFishingDerbyStandingsText,
    buildFishingDerbyStatusText,
    claimFishingDerbyRewards,
    initFishingDerby,
    onFishingCatchSaved,
    resolveFishingDerbyConfig,
    type FishingDerbyConfig,
    type ResolvedFishingDerbyConfig,
} from './derby';
import {
    ensureFishingSchema,
    getFishingCatchCountLeaderboard,
    getLargestFishingCatches,
    getPlayerFishingJournal,
    getPlayerSpeciesBestCatch,
    getPlayerFishingTotals,
    getPlayerPersonalBestCatches,
    getSpeciesRecordCatch,
    saveFishingCatch,
    type FishingBestCatch,
} from './db';

type FishSizeClass = 'big' | 'small';
type FishRarity = 'common' | 'uncommon' | 'rare' | 'legendary';
type FishBehavior = 'calm' | 'darting' | 'ancient';
type FishState = 'idle' | 'reserved' | 'fake_bite' | 'true_bite' | 'hooked_wait' | 'struggle_active' | 'exhausted' | 'caught' | 'escaped';

interface Rect {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

export interface FishingSpeciesConfig {
    id: string;
    name: string;
    sizeClass: FishSizeClass;
    rarity: FishRarity;
    behavior: FishBehavior;
    minWeight: number;
    maxWeight: number;
    spawnWeight?: number;
    hotspotBoost?: number;
}

export interface FishingZoneConfig {
    id: string;
    mapNumber: number;
    playerArea: Rect;
    fishSpawnArea: Rect;
    maxFish?: number;
    table?: {
        speciesId: string;
        weight: number;
    }[];
    speciesIds?: string[];
}

export interface FishingConfig {
    enabled?: boolean;
    rodNames?: string[];
    respawnMs?: number;
    reserveMs?: number;
    hotspotRotationMinutes?: number;
    zones?: FishingZoneConfig[];
    species?: FishingSpeciesConfig[];
    npcMapNumber?: number;
    npcX?: number;
    npcY?: number;
    npcDirection?: number;
    npcSprite?: number;
    npcName?: string;
    npcAmbientSpeech?: {
        intervalSeconds?: number;
        messages?: string[];
    };
    derby?: FishingDerbyConfig;
}

interface BehaviorProfile {
    fakeNibbles: number;
    biteWindowMs: number;
    struggleCount: number;
}

interface ResolvedFishingConfig {
    enabled: boolean;
    rodNames: string[];
    rodNameSet: Set<string>;
    useRodNameHeuristics: boolean;
    respawnMs: number;
    reserveMs: number;
    hotspotRotationMinutes: number;
    fakeNibbleMs: number;
    nibbleGapMs: number;
    struggleGapMs: number;
    struggleWindowMs: number;
    exhaustedWindowMs: number;
    species: FishingSpeciesConfig[];
    zones: FishingZoneConfig[];
    npcMapNumber?: number;
    npcX?: number;
    npcY?: number;
    npcDirection: number;
    npcSprite: number;
    npcName: string;
    npcAmbientSpeech?: {
        intervalSeconds: number;
        messages: string[];
    };
    derby: ResolvedFishingDerbyConfig;
}

interface FishingZoneRuntime {
    config: FishingZoneConfig;
    activeFishSerials: Set<number>;
    hotspotSpeciesId: string | null;
}

interface FishingEncounter {
    serial: number;
    zoneId: string;
    speciesId: string;
    species: FishingSpeciesConfig;
    mapNumber: number;
    x: number;
    y: number;
    weight: number;
    glimmer: boolean;
    state: FishState;
    ownerSessionId: string | null;
    ownerName: string | null;
    fakeNibbleIndex: number;
    remainingStruggles: number;
    perfectCatch: boolean;
    activeWindowStartedAt: number;
    activeWindowDurationMs: number;
    stateTimer: ReturnType<typeof setTimeout> | null;
    wanderTimer: ReturnType<typeof setTimeout> | null;
}

interface FishingDialogState {
    entityId: number;
}

const DEFAULT_SPECIES: FishingSpeciesConfig[] = [
    { id: 'minnow', name: 'Minnow', sizeClass: 'small', rarity: 'common', behavior: 'calm', minWeight: 4, maxWeight: 10, spawnWeight: 80, hotspotBoost: 3 },
    { id: 'silverfin', name: 'Silverfin', sizeClass: 'small', rarity: 'common', behavior: 'darting', minWeight: 8, maxWeight: 16, spawnWeight: 65, hotspotBoost: 3 },
    { id: 'pond-pike', name: 'Pond Pike', sizeClass: 'big', rarity: 'uncommon', behavior: 'calm', minWeight: 18, maxWeight: 32, spawnWeight: 30, hotspotBoost: 4 },
    { id: 'glass-eel', name: 'Glass Eel', sizeClass: 'small', rarity: 'rare', behavior: 'darting', minWeight: 10, maxWeight: 22, spawnWeight: 12, hotspotBoost: 5 },
    { id: 'moon-carp', name: 'Moon Carp', sizeClass: 'big', rarity: 'rare', behavior: 'darting', minWeight: 28, maxWeight: 48, spawnWeight: 14, hotspotBoost: 5 },
    { id: 'ancient-koi', name: 'Ancient Koi', sizeClass: 'big', rarity: 'legendary', behavior: 'ancient', minWeight: 40, maxWeight: 72, spawnWeight: 5, hotspotBoost: 6 },
];

const BIG_FISH_IDLE_SPRITE = 583;
const SMALL_FISH_IDLE_SPRITE = 584;
const BIG_FISH_HOOKED_SPRITE = 228;
const SMALL_FISH_HOOKED_SPRITE = 229;

const BEHAVIOR_PROFILES: Record<FishBehavior, BehaviorProfile> = {
    calm: { fakeNibbles: 1, biteWindowMs: 900, struggleCount: 1 },
    darting: { fakeNibbles: 2, biteWindowMs: 650, struggleCount: 2 },
    ancient: { fakeNibbles: 2, biteWindowMs: 450, struggleCount: 3 },
};

let _proxy: ProxyServer | null = null;
let _npcInjector: NpcInjector | null = null;
let _dialogHandler: DialogHandler | null = null;
let _chat: ChatInjector | null = null;
let _config: ResolvedFishingConfig | null = null;
let _initialized = false;
let _fishingNpcSerial = 0;
let _hotspotTimer: ReturnType<typeof setInterval> | null = null;

const _zones = new Map<string, FishingZoneRuntime>();
const _speciesById = new Map<string, FishingSpeciesConfig>();
const _fishBySerial = new Map<number, FishingEncounter>();
const _dialogStates = new Map<string, FishingDialogState>();

export function isInitialized(): boolean {
    return _initialized;
}

export function getFishingNpcSerial(): number {
    return _fishingNpcSerial;
}

export function isFishingNpc(serial: number): boolean {
    return !!serial && serial === _fishingNpcSerial;
}

export async function initFishing(
    proxy: ProxyServer,
    augmentation: AugmentationEngine,
    config?: Partial<FishingConfig>,
): Promise<void> {
    if (_initialized) {
        return;
    }

    _proxy = proxy;
    _npcInjector = augmentation.npcs;
    _dialogHandler = augmentation.dialogs;
    _chat = augmentation.chat;
    _config = resolveConfig(config);

    await ensureFishingSchema();
    await initFishingDerby(proxy, _config.derby);

    rebuildSpeciesMap(_config.species);
    rebuildZones(_config.zones);
    initFishingNpcFromConfig();
    rotateHotspots();
    spawnInitialFish();
    startHotspotRotation();
    registerLifecycleHandlers(proxy);
    registerFishingCommands(augmentation);

    _initialized = true;
    console.log(`[Fishing] Initialized with ${_zones.size} zone(s) and ${_speciesById.size} species`);
}

export function assignToNpc(npc: VirtualNPC | undefined): number {
    if (!npc || !_npcInjector || !_dialogHandler || !_chat) {
        return 0;
    }

    const previousNpc = _npcInjector.getNPC(_fishingNpcSerial);
    if (previousNpc && previousNpc.serial !== npc.serial) {
        previousNpc.onInteract = undefined;
    }

    npc.onInteract = (session, event) => {
        void handleFishingNpcInteract(session, event);
    };
    _fishingNpcSerial = npc.serial;
    return _fishingNpcSerial;
}

export function unassignFromNpc(serial?: number): boolean {
    if (!_npcInjector || !_fishingNpcSerial) {
        _fishingNpcSerial = 0;
        _dialogStates.clear();
        return false;
    }

    const targetSerial = serial && serial === _fishingNpcSerial ? serial : _fishingNpcSerial;
    const npc = _npcInjector.getNPC(targetSerial);
    _dialogStates.clear();

    if (targetSerial === _fishingNpcSerial) {
        _fishingNpcSerial = 0;
    }

    if (!npc) {
        return false;
    }

    npc.onInteract = undefined;
    return true;
}

function registerLifecycleHandlers(proxy: ProxyServer): void {
    proxy.on('player:mapChange', session => {
        releaseOwnedFish(session.id, 'The fish escaped while you moved away.');
    });

    proxy.on('session:end', session => {
        releaseOwnedFish(session.id, 'The fish got away when the line went slack.');
        _dialogStates.delete(session.id);
    });
}

function resolveConfig(config?: Partial<FishingConfig>): ResolvedFishingConfig {
    const species = normalizeSpecies(config?.species);
    const npcMapNumber = toOptionalInt(config?.npcMapNumber);
    const npcX = toOptionalInt(config?.npcX);
    const npcY = toOptionalInt(config?.npcY);
    let zones = normalizeZones(config?.zones, species);

    if (zones.length === 0 && npcMapNumber !== undefined && npcX !== undefined && npcY !== undefined) {
        zones = [buildFallbackZone(npcMapNumber, npcX, npcY, species)];
    }

    return {
        enabled: config?.enabled !== false,
        rodNames: normalizeRodNames(config?.rodNames),
        rodNameSet: new Set(normalizeRodNames(config?.rodNames).map(name => normalizeEquipmentLabel(name))),
        useRodNameHeuristics: !Array.isArray(config?.rodNames) || config.rodNames.length === 0,
        respawnMs: toInt(config?.respawnMs, 10_000, 2_000),
        reserveMs: toInt(config?.reserveMs, 8_000, 2_000),
        hotspotRotationMinutes: toInt(config?.hotspotRotationMinutes, 15, 1),
        fakeNibbleMs: 650,
        nibbleGapMs: 900,
        struggleGapMs: 850,
        struggleWindowMs: 900,
        exhaustedWindowMs: 1_200,
        species,
        zones,
        npcMapNumber,
        npcX,
        npcY,
        npcDirection: normalizeDirection(config?.npcDirection, 2),
        npcSprite: toInt(config?.npcSprite, 118, 1),
        npcName: normalizeName(config?.npcName, 'Fishing Master'),
        npcAmbientSpeech: normalizeAmbientSpeech(config?.npcAmbientSpeech),
        derby: resolveFishingDerbyConfig(
            config?.derby,
            species.map(entry => entry.id),
            zones.map(entry => entry.id),
        ),
    };
}

function normalizeSpecies(species?: FishingSpeciesConfig[]): FishingSpeciesConfig[] {
    if (!Array.isArray(species) || species.length === 0) {
        return DEFAULT_SPECIES.map(entry => ({ ...entry }));
    }

    const normalized: FishingSpeciesConfig[] = species
        .map(entry => ({
            id: normalizeName(entry?.id, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-') || '',
            name: normalizeName(entry?.name, ''),
            sizeClass: (entry?.sizeClass === 'big' ? 'big' : 'small') as FishSizeClass,
            rarity: normalizeRarity(entry?.rarity),
            behavior: normalizeBehavior(entry?.behavior),
            minWeight: toInt(entry?.minWeight, 5, 1),
            maxWeight: Math.max(toInt(entry?.maxWeight, 12, 1), toInt(entry?.minWeight, 5, 1)),
            spawnWeight: toInt(entry?.spawnWeight, 10, 1),
            hotspotBoost: toInt(entry?.hotspotBoost, 3, 1),
        }))
        .filter(entry => entry.id && entry.name);

    return normalized.length > 0 ? normalized : DEFAULT_SPECIES.map(entry => ({ ...entry }));
}

function normalizeZones(zones: FishingZoneConfig[] | undefined, species: FishingSpeciesConfig[]): FishingZoneConfig[] {
    if (!Array.isArray(zones) || zones.length === 0) {
        return [];
    }

    const speciesIds = new Set(species.map(entry => entry.id));
    return zones
        .map((zone, index) => {
            const id = normalizeName(zone?.id, `zone-${index + 1}`).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
            const mapNumber = toInt(zone?.mapNumber, 449, 1);
            const playerArea = normalizeRect(zone?.playerArea);
            const fishSpawnArea = normalizeRect(zone?.fishSpawnArea ?? zone?.playerArea);
            const table = normalizeZoneTable(zone, speciesIds);

            return {
                id,
                mapNumber,
                playerArea,
                fishSpawnArea,
                maxFish: toInt(zone?.maxFish, 3, 1),
                table,
            };
        })
        .filter(zone => zone.table && zone.table.length > 0);
}

function normalizeZoneTable(zone: FishingZoneConfig, speciesIds: Set<string>): { speciesId: string; weight: number }[] {
    if (Array.isArray(zone?.table) && zone.table.length > 0) {
        const table = zone.table
            .map(entry => ({
                speciesId: normalizeName(entry?.speciesId, '').toLowerCase(),
                weight: toInt(entry?.weight, 1, 1),
            }))
            .filter(entry => entry.speciesId && speciesIds.has(entry.speciesId));

        if (table.length > 0) {
            return table;
        }
    }

    if (Array.isArray(zone?.speciesIds) && zone.speciesIds.length > 0) {
        const table = zone.speciesIds
            .map(speciesId => normalizeName(speciesId, '').toLowerCase())
            .filter(speciesId => speciesIds.has(speciesId))
            .map(speciesId => ({ speciesId, weight: 1 }));

        if (table.length > 0) {
            return table;
        }
    }

    return Array.from(speciesIds).map(speciesId => ({ speciesId, weight: 1 }));
}

function buildFallbackZone(mapNumber: number, npcX: number, npcY: number, species: FishingSpeciesConfig[]): FishingZoneConfig {
    const sharedArea = normalizeRect({
        x1: 10,
        y1: 8,
        x2: 13,
        y2: 15,
    });

    return {
        id: `default-zone-${mapNumber}`,
        mapNumber,
        playerArea: sharedArea,
        fishSpawnArea: sharedArea,
        maxFish: 3,
        table: species.map(entry => ({ speciesId: entry.id, weight: toInt(entry.spawnWeight, 10, 1) })),
    };
}

function rebuildSpeciesMap(species: FishingSpeciesConfig[]): void {
    _speciesById.clear();
    for (const entry of species) {
        _speciesById.set(entry.id, entry);
    }
}

function rebuildZones(zones: FishingZoneConfig[]): void {
    _zones.clear();
    for (const zone of zones) {
        _zones.set(zone.id, {
            config: zone,
            activeFishSerials: new Set<number>(),
            hotspotSpeciesId: null,
        });
    }
}

function initFishingNpcFromConfig(): void {
    if (!_config || !_npcInjector || !_dialogHandler || !_chat) {
        return;
    }

    if (_config.npcMapNumber === undefined || _config.npcX === undefined || _config.npcY === undefined) {
        return;
    }

    const existingNpc = _npcInjector.getAllNPCs().find(npc =>
        npc.mapNumber === _config!.npcMapNumber
        && npc.x === _config!.npcX
        && npc.y === _config!.npcY,
    );

    if (existingNpc) {
        assignToNpc(existingNpc);
        return;
    }

    const serial = _npcInjector.placeNPC({
        name: _config.npcName,
        sprite: _config.npcSprite,
        x: _config.npcX,
        y: _config.npcY,
        mapNumber: _config.npcMapNumber,
        direction: _config.npcDirection,
        creatureType: 2,
        persistent: false,
        ambientSpeech: _config.npcAmbientSpeech,
    });
    const npc = _npcInjector.getNPC(serial);
    assignToNpc(npc);
}

function startHotspotRotation(): void {
    if (!_config || _hotspotTimer) {
        return;
    }

    _hotspotTimer = setInterval(() => {
        rotateHotspots();
    }, _config.hotspotRotationMinutes * 60_000);
}

function rotateHotspots(): void {
    for (const zone of _zones.values()) {
        zone.hotspotSpeciesId = chooseHotspotSpecies(zone.config);
    }
}

function chooseHotspotSpecies(zone: FishingZoneConfig): string | null {
    const options = zone.table ?? [];
    if (options.length === 0) {
        return null;
    }

    const pick = options[Math.floor(Math.random() * options.length)];
    return pick?.speciesId ?? null;
}

function spawnInitialFish(): void {
    for (const zone of _zones.values()) {
        const targetCount = Math.max(1, zone.config.maxFish ?? 3);
        for (let i = 0; i < targetCount; i++) {
            spawnFish(zone.config.id);
        }
    }
}

function spawnFish(zoneId: string): void {
    if (!_config || !_npcInjector) {
        return;
    }

    const zone = _zones.get(zoneId);
    if (!zone) {
        return;
    }

    const species = chooseSpecies(zone);
    if (!species) {
        return;
    }

    const position = chooseSpawnPosition(zone);
    if (!position) {
        return;
    }

    const serial = _npcInjector.placeNPC({
        name: species.name,
        sprite: getIdleSprite(species.sizeClass),
        x: position.x,
        y: position.y,
        mapNumber: zone.config.mapNumber,
        direction: Math.floor(Math.random() * 4),
        creatureType: 0,
        persistent: false,
    });

    const fish: FishingEncounter = {
        serial,
        zoneId,
        speciesId: species.id,
        species,
        mapNumber: zone.config.mapNumber,
        x: position.x,
        y: position.y,
        weight: randomInt(species.minWeight, species.maxWeight),
        glimmer: rollGlimmer(species.rarity),
        state: 'idle',
        ownerSessionId: null,
        ownerName: null,
        fakeNibbleIndex: 0,
        remainingStruggles: 0,
        perfectCatch: true,
        activeWindowStartedAt: 0,
        activeWindowDurationMs: 0,
        stateTimer: null,
        wanderTimer: null,
    };

    _fishBySerial.set(serial, fish);
    zone.activeFishSerials.add(serial);

    const npc = _npcInjector.getNPC(serial);
    if (npc) {
        npc.onInteract = (session, event) => {
            if (event.type === 'click') {
                void handleFishClick(session, serial);
            }
        };
    }

    scheduleFishWander(fish);
}

function chooseSpecies(zone: FishingZoneRuntime): FishingSpeciesConfig | null {
    const options = zone.config.table ?? [];
    if (options.length === 0) {
        return null;
    }

    let totalWeight = 0;
    const weighted = options.map(option => {
        const species = _speciesById.get(option.speciesId);
        if (!species) {
            return { species: null, weight: 0 };
        }
        const baseWeight = Math.max(1, option.weight || species.spawnWeight || 1);
        const hotspotWeight = zone.hotspotSpeciesId === species.id ? Math.max(1, species.hotspotBoost || 3) : 1;
        const weight = baseWeight * hotspotWeight;
        totalWeight += weight;
        return { species, weight };
    }).filter(entry => !!entry.species);

    if (weighted.length === 0 || totalWeight <= 0) {
        return null;
    }

    let roll = Math.random() * totalWeight;
    for (const entry of weighted) {
        roll -= entry.weight;
        if (roll <= 0) {
            return entry.species;
        }
    }

    return weighted[weighted.length - 1].species;
}

function chooseSpawnPosition(zone: FishingZoneRuntime): { x: number; y: number } | null {
    for (let attempt = 0; attempt < 25; attempt++) {
        const x = randomInt(zone.config.fishSpawnArea.x1, zone.config.fishSpawnArea.x2);
        const y = randomInt(zone.config.fishSpawnArea.y1, zone.config.fishSpawnArea.y2);
        const occupied = Array.from(zone.activeFishSerials)
            .map(serial => _fishBySerial.get(serial))
            .some(fish => fish && fish.x === x && fish.y === y);
        if (!occupied) {
            return { x, y };
        }
    }

    return null;
}

function scheduleFishWander(fish: FishingEncounter): void {
    if (!_config || !_npcInjector || fish.state !== 'idle') {
        return;
    }

    clearFishWander(fish);
    fish.wanderTimer = setTimeout(() => {
        const zone = _zones.get(fish.zoneId);
        if (!zone || fish.state !== 'idle' || !_npcInjector) {
            return;
        }

        const nextX = clamp(fish.x + randomInt(-1, 1), zone.config.fishSpawnArea.x1, zone.config.fishSpawnArea.x2);
        const nextY = clamp(fish.y + randomInt(-1, 1), zone.config.fishSpawnArea.y1, zone.config.fishSpawnArea.y2);

        if (nextX !== fish.x || nextY !== fish.y) {
            fish.x = nextX;
            fish.y = nextY;
            _npcInjector.moveNPC(fish.serial, nextX, nextY);
        }

        scheduleFishWander(fish);
    }, randomInt(2_500, 4_500));
}

async function handleFishClick(session: ProxySession, serial: number): Promise<void> {
    const fish = _fishBySerial.get(serial);
    const zone = fish ? _zones.get(fish.zoneId) : null;
    if (!fish || !zone || !_chat) {
        return;
    }

    if (!hasFishingRodEquipped(session)) {
        sendFishingNotice(session, 'You need to equip your Fishing Rod before you can fish.');
        return;
    }

    if (fish.ownerSessionId && fish.ownerSessionId !== session.id) {
        sendFishingNotice(session, 'Someone else already has a line on that fish.');
        return;
    }

    switch (fish.state) {
        case 'idle':
            reserveFish(session, fish);
            return;
        case 'reserved':
        case 'hooked_wait':
            if (fish.ownerSessionId === session.id) {
                fish.perfectCatch = false;
                sendFishingNotice(session, 'Steady. Wait for the fish to really commit.');
            }
            return;
        case 'fake_bite':
            if (fish.ownerSessionId === session.id) {
                fish.perfectCatch = false;
                escapeFish(fish, `${fish.species.name} darted off at the false bite.`);
            }
            return;
        case 'true_bite':
            if (fish.ownerSessionId === session.id) {
                hookFish(session, fish);
            }
            return;
        case 'struggle_active':
            if (fish.ownerSessionId === session.id) {
                resolveStruggleClick(session, fish);
            }
            return;
        case 'exhausted':
            if (fish.ownerSessionId === session.id) {
                await catchFish(session, fish);
            }
            return;
        default:
            return;
    }
}

function reserveFish(session: ProxySession, fish: FishingEncounter): void {
    if (!_config || !_chat) {
        return;
    }

    fish.state = 'reserved';
    fish.ownerSessionId = session.id;
    fish.ownerName = session.characterName;
    fish.fakeNibbleIndex = 0;
    fish.perfectCatch = true;
    clearActiveReactionWindow(fish);
    clearFishWander(fish);
    clearFishStateTimer(fish);

    sendFishingNotice(session, `You cast toward the ${fish.glimmer ? 'glimmering ' : ''}${fish.species.name}. Wait for the real bite.`);

    fish.stateTimer = setTimeout(() => {
        startFakeNibble(fish);
    }, Math.min(_config.reserveMs, _config.nibbleGapMs));
}

function startFakeNibble(fish: FishingEncounter): void {
    if (!_config) {
        return;
    }

    const config = _config;
    const owner = getOwnerSession(fish);
    const profile = BEHAVIOR_PROFILES[fish.species.behavior];
    if (!owner || fish.state !== 'reserved') {
        escapeFish(fish, `${fish.species.name} slipped away.`);
        return;
    }

    if (fish.fakeNibbleIndex >= profile.fakeNibbles) {
        startTrueBite(fish);
        return;
    }

    fish.state = 'fake_bite';
    fish.fakeNibbleIndex += 1;
    fish.stateTimer = setTimeout(() => {
        if (fish.state !== 'fake_bite') {
            return;
        }
        fish.state = 'reserved';
        fish.stateTimer = setTimeout(() => {
            startFakeNibble(fish);
        }, config.nibbleGapMs);
    }, config.fakeNibbleMs);

    if (_chat) {
        sendFishingNotice(owner, 'The line twitches, but it is not a clean bite yet.');
    }
}

function startTrueBite(fish: FishingEncounter): void {
    const owner = getOwnerSession(fish);
    if (!owner || !_chat) {
        escapeFish(fish, `${fish.species.name} slipped away before the hook set.`);
        return;
    }

    const profile = BEHAVIOR_PROFILES[fish.species.behavior];
    fish.state = 'true_bite';
    setActiveReactionWindow(fish, profile.biteWindowMs);
    fish.stateTimer = setTimeout(() => {
        if (fish.state === 'true_bite') {
            fish.perfectCatch = false;
            escapeFish(fish, `${fish.species.name} spat the hook and disappeared.`);
        }
    }, profile.biteWindowMs);

    sendFishingNotice(owner, `{=s${fish.species.name} takes the bait. Click now!`);
}

function hookFish(session: ProxySession, fish: FishingEncounter): void {
    if (!_npcInjector || !_chat) {
        return;
    }

    applyReactionResult(fish);
    clearFishStateTimer(fish);
    fish.state = 'hooked_wait';
    fish.remainingStruggles = BEHAVIOR_PROFILES[fish.species.behavior].struggleCount;
    _npcInjector.changeSpriteNPC(fish.serial, getHookedSprite(fish.species.sizeClass));
    sendFishingNotice(session, `Hooked ${withArticle(fish.species.name)}. Keep the tension when it thrashes.`);
    scheduleNextStruggle(fish);
}

function scheduleNextStruggle(fish: FishingEncounter): void {
    if (!_config) {
        return;
    }

    const config = _config;
    const owner = getOwnerSession(fish);
    if (!owner) {
        escapeFish(fish, `${fish.species.name} tore free from the line.`);
        return;
    }

    if (fish.remainingStruggles <= 0) {
        startExhaustedWindow(fish);
        return;
    }

    fish.state = 'hooked_wait';
    fish.stateTimer = setTimeout(() => {
        if (fish.state !== 'hooked_wait') {
            return;
        }

        fish.state = 'struggle_active';
        setActiveReactionWindow(fish, config.struggleWindowMs);
        fish.stateTimer = setTimeout(() => {
            if (fish.state === 'struggle_active') {
                fish.perfectCatch = false;
                escapeFish(fish, `${fish.species.name} broke the line during the struggle.`);
            }
        }, config.struggleWindowMs);

        if (_chat) {
            sendFishingNotice(owner, `{=s${fish.species.name} thrashes! Click to keep the line tight.`);
        }
    }, config.struggleGapMs);
}

function resolveStruggleClick(session: ProxySession, fish: FishingEncounter): void {
    applyReactionResult(fish);
    clearFishStateTimer(fish);
    fish.remainingStruggles = Math.max(0, fish.remainingStruggles - 1);
    if (_chat) {
        sendFishingNotice(session, 'You hold the line steady.');
    }
    scheduleNextStruggle(fish);
}

function startExhaustedWindow(fish: FishingEncounter): void {
    if (!_config) {
        return;
    }

    const owner = getOwnerSession(fish);
    if (!owner || !_chat) {
        escapeFish(fish, `${fish.species.name} vanished into deeper water.`);
        return;
    }

    fish.state = 'exhausted';
    setActiveReactionWindow(fish, _config.exhaustedWindowMs);
    fish.stateTimer = setTimeout(() => {
        if (fish.state === 'exhausted') {
            fish.perfectCatch = false;
            escapeFish(fish, `${fish.species.name} found one last burst and escaped.`);
        }
    }, _config.exhaustedWindowMs);

    sendFishingNotice(owner, `{=s${fish.species.name} is tiring out. Click once more to land it.`);
}

async function catchFish(session: ProxySession, fish: FishingEncounter): Promise<void> {
    if (!_chat) {
        return;
    }

    clearFishStateTimer(fish);
    clearFishWander(fish);
    fish.state = 'caught';
    applyReactionResult(fish);

    const [previousSpeciesRecord, previousPersonalBest] = await Promise.all([
        getSpeciesRecordCatch(fish.species.id),
        getPlayerSpeciesBestCatch(session.characterName, fish.species.id),
    ]);

    await saveFishingCatch({
        ownerName: session.characterName,
        speciesId: fish.species.id,
        speciesName: fish.species.name,
        zoneId: fish.zoneId,
        mapNumber: fish.mapNumber,
        sizeClass: fish.species.sizeClass,
        rarity: fish.species.rarity,
        weight: fish.weight,
        perfectCatch: fish.perfectCatch,
        glimmer: fish.glimmer,
        caughtAt: new Date(),
    });
    await onFishingCatchSaved();

    const isSpeciesRecord = !previousSpeciesRecord || fish.weight > previousSpeciesRecord.weight;
    const isPersonalBest = !previousPersonalBest || fish.weight > previousPersonalBest.weight;
    const resultParts = [
        `{=qYou land ${withArticle(fish.species.name)}!`,
        `{=c${formatWeight(fish.weight)}.`,
    ];

    if (isPersonalBest) {
        resultParts.push(` {=qNew personal best for ${fish.species.name}!`);
    }
    if (isSpeciesRecord) {
        resultParts.push(` {=qNew ${fish.species.name} record!`);
    }
    if (fish.perfectCatch) {
        resultParts.push(' {=ePerfect catch!');
    }
    if (fish.glimmer) {
        resultParts.push(' {=pGlimmer catch!');
    }

    sendFishingNotice(session, resultParts.join(' '));

    despawnFish(fish, true);
}

function escapeFish(fish: FishingEncounter, message: string): void {
    const owner = getOwnerSession(fish);
    clearFishStateTimer(fish);
    clearFishWander(fish);
    clearActiveReactionWindow(fish);
    fish.state = 'escaped';

    if (owner && _chat) {
        sendFishingNotice(owner, `{=b${message}`);
    }

    despawnFish(fish, false);
}

function despawnFish(fish: FishingEncounter, _caught: boolean): void {
    if (!_npcInjector || !_config) {
        return;
    }

    const zone = _zones.get(fish.zoneId);
    if (zone) {
        zone.activeFishSerials.delete(fish.serial);
    }

    _npcInjector.removeNPC(fish.serial);
    _fishBySerial.delete(fish.serial);

    setTimeout(() => {
        spawnFish(fish.zoneId);
    }, _config.respawnMs);
}

function releaseOwnedFish(sessionId: string, message: string): void {
    for (const fish of _fishBySerial.values()) {
        if (fish.ownerSessionId === sessionId) {
            escapeFish(fish, message);
        }
    }
}

function hasFishingRodEquipped(session: ProxySession): boolean {
    if (!_config) {
        return false;
    }

    const equippedWeapon = session.playerState.equipment.get(1);
    return !!(equippedWeapon && matchesRodName(equippedWeapon.name));
}

async function handleFishingNpcInteract(session: ProxySession, event: DialogEvent): Promise<void> {
    if (event.type === 'click') {
        _dialogStates.set(session.id, { entityId: event.entityId });
        showFishingNpcMainMenu(session, event.entityId);
        return;
    }

    const state = _dialogStates.get(session.id);
    if (!state) {
        return;
    }

    if (event.type === 'menuChoice') {
        const choice = event.pursuitId > 0 ? event.pursuitId : event.slot + 1;
        switch (choice) {
            case 1:
                showHowToFish(session, state.entityId);
                return;
            case 2:
                await showFishingJournal(session, state.entityId);
                return;
            case 3:
                await showPersonalBests(session, state.entityId);
                return;
            case 4:
                showCurrentHotspots(session, state.entityId);
                return;
            case 5:
                await showDerbyStatus(session, state.entityId);
                return;
            case 6:
                await showDerbyLeaders(session, state.entityId);
                return;
            case 7:
                await showDerbyStandings(session, state.entityId);
                return;
            case 8:
                await showLargestFish(session, state.entityId);
                return;
            case 9:
                await showMostCatchesLeaderboard(session, state.entityId);
                return;
            case 10:
                await showDerbyClaims(session, state.entityId);
                return;
            default:
                _dialogStates.delete(session.id);
                return;
        }
    }

    if (event.type === 'dialogChoice') {
        _dialogStates.delete(session.id);
    }
}

function showFishingNpcMainMenu(session: ProxySession, entityId?: number): void {
    const target = getNpcDialogTarget(entityId);
    if (!_dialogHandler) {
        return;
    }

    _dialogHandler.sendDialogMenu(session, {
        menuType: 0,
        entityId: target.entityId,
        sprite: target.sprite,
        name: target.name,
        text: 'The water always tells the truth. What would you like to review?',
        menuOptions: [
            { text: 'Start Fishing / How It Works', pursuitId: 1 },
            { text: 'Fishing Journal', pursuitId: 2 },
            { text: 'Personal Bests', pursuitId: 3 },
            { text: 'Current Hotspots', pursuitId: 4 },
            { text: 'Derby Status', pursuitId: 5 },
            { text: 'Today\'s Derby Leaders', pursuitId: 6 },
            { text: 'Derby Standings', pursuitId: 7 },
            { text: 'Biggest Fish', pursuitId: 8 },
            { text: 'Most Catches', pursuitId: 9 },
            { text: 'Claim Derby Rewards', pursuitId: 10 },
            { text: 'Goodbye', pursuitId: 11 },
        ],
    });
}

function showHowToFish(session: ProxySession, entityId?: number): void {
    sendFishingPopup(
        session,
        entityId,
        [
            'Equip your Fishing Rod in weapon slot 1 before clicking a fish.',
            'First click casts at the fish and reserves it for you.',
            'Ignore the false nibbles. Click only on the real bite.',
            'After the hook sets, click each struggle, then click once more when the fish tires out.',
            'Perfect catches and glimmer catches both count in your journal.',
        ].join('\n'),
    );
}

async function showFishingJournal(session: ProxySession, entityId?: number): Promise<void> {
    const [totals, journal] = await Promise.all([
        getPlayerFishingTotals(session.characterName),
        getPlayerFishingJournal(session.characterName, 8),
    ]);

    const lines = [
        `Total Catches: ${totals.totalCatches}`,
        `Unique Species: ${totals.uniqueSpecies}`,
        `Perfect Catches: ${totals.perfectCatches}`,
        `Glimmer Catches: ${totals.glimmerCatches}`,
        '',
    ];

    if (journal.length === 0) {
        lines.push('You have not landed any fish yet.');
    } else {
        for (const entry of journal) {
            const glimmer = entry.glimmerCount > 0 ? ` | glimmer ${entry.glimmerCount}` : '';
            lines.push(`${entry.speciesName}: ${entry.catches} caught | best ${formatWeight(entry.bestWeight)}${glimmer}`);
        }
    }

    sendFishingPopup(session, entityId, lines.join('\n'));
}

async function showPersonalBests(session: ProxySession, entityId?: number): Promise<void> {
    const bests = await getPlayerPersonalBestCatches(session.characterName, 8);
    const lines = ['Personal Bests', ''];

    if (bests.length === 0) {
        lines.push('No personal bests yet. Catch a few fish first.');
    } else {
        for (const catchRow of bests) {
            const extras = buildCatchExtras(catchRow);
            lines.push(`${catchRow.speciesName}: ${formatWeight(catchRow.weight)}${extras}`);
        }
    }

    sendFishingPopup(session, entityId, lines.join('\n'));
}

function showCurrentHotspots(session: ProxySession, entityId?: number): void {
    const lines = ['Current Hotspots', ''];

    if (_zones.size === 0) {
        lines.push('No fishing zones are configured yet.');
    } else {
        for (const zone of _zones.values()) {
            const hotspot = zone.hotspotSpeciesId ? _speciesById.get(zone.hotspotSpeciesId) : null;
            const hotspotText = hotspot ? hotspot.name : 'No hotspot';
            lines.push(`${zone.config.id} on map ${zone.config.mapNumber}: ${hotspotText}`);
        }
    }

    sendFishingPopup(session, entityId, lines.join('\n'));
}

async function showDerbyStatus(session: ProxySession, entityId?: number): Promise<void> {
    sendFishingPopup(session, entityId, await buildFishingDerbyStatusText(session.characterName));
}

async function showDerbyLeaders(session: ProxySession, entityId?: number): Promise<void> {
    sendFishingPopup(session, entityId, await buildFishingDerbyLeadersText());
}

async function showDerbyStandings(session: ProxySession, entityId?: number): Promise<void> {
    sendFishingPopup(session, entityId, await buildFishingDerbyStandingsText());
}

async function showDerbyClaims(session: ProxySession, entityId?: number): Promise<void> {
    sendFishingPopup(session, entityId, await buildFishingDerbyClaimStatusText(session.characterName));
}

async function showLargestFish(session: ProxySession, entityId?: number): Promise<void> {
    const catches = await getLargestFishingCatches(8);
    const derbyText = await buildFishingDerbyBiggestFishText();
    const lines = ['Biggest Fish', '', derbyText, '', 'All-Time Species Records', ''];

    if (catches.length === 0) {
        lines.push('No fish have been landed yet.');
    } else {
        for (const catchRow of catches) {
            const extras = buildCatchExtras(catchRow);
            lines.push(`${catchRow.ownerName}: ${catchRow.speciesName} ${formatWeight(catchRow.weight)}${extras}`);
        }
    }

    sendFishingPopup(session, entityId, lines.join('\n'));
}

async function showMostCatchesLeaderboard(session: ProxySession, entityId?: number): Promise<void> {
    const leaders = await getFishingCatchCountLeaderboard(8);
    const lines = ['Most Catches', ''];

    if (leaders.length === 0) {
        lines.push('No fish have been landed yet.');
    } else {
        for (const leader of leaders) {
            lines.push(
                `${leader.ownerName}: ${leader.totalCatches} catches | ${leader.uniqueSpecies} species | best ${formatWeight(leader.bestWeight)}`,
            );
        }
    }

    sendFishingPopup(session, entityId, lines.join('\n'));
}

function sendFishingPopup(session: ProxySession, entityId: number | undefined, text: string): void {
    const target = getNpcDialogTarget(entityId);
    if (!_dialogHandler) {
        return;
    }

    _dialogHandler.sendDialog(session, {
        type: DialogType.Popup,
        entityId: target.entityId,
        sprite: target.sprite,
        name: target.name,
        text,
        pursuitId: 1,
        stepId: 0,
        hasPrevious: false,
        hasNext: false,
    });
}

function registerFishingCommands(augmentation: AugmentationEngine): void {
    augmentation.commands.register('derby', async session => {
        const lines = [
            await buildFishingDerbyStatusText(session.characterName),
            await buildFishingDerbyLeadersText(),
            await buildFishingDerbyStandingsText(),
        ]
            .join('\n\n')
            .split('\n');

        for (const line of lines) {
            if (line.trim()) {
                _chat?.systemMessage(session, line);
            }
        }
    }, 'Show fishing derby status, leaders, and standings');

    augmentation.commands.register('claim', async (session, args) => {
        const target = (args[0] || '').toLowerCase();
        if (!target) {
            _chat?.systemMessage(session, 'Usage: /claim derby | /claim league');
            return;
        }

        if (target === 'derby') {
            const lines = await claimFishingDerbyRewards(session);
            for (const line of lines) {
                if (line.trim()) {
                    _chat?.systemMessage(session, line);
                }
            }
            return;
        }

        if (target === 'league') {
            const league = getMonsterLeagueModule();
            if (!league?.claimLeagueRewards) {
                _chat?.systemMessage(session, 'The monster league reward system is not available right now.');
                return;
            }
            const lines = await league.claimLeagueRewards(session);
            for (const line of lines) {
                if (line.trim()) {
                    _chat?.systemMessage(session, line);
                }
            }
            return;
        }

        _chat?.systemMessage(session, `Unknown claim target "${target}". Try /claim derby or /claim league.`);
    }, 'Claim derby or league rewards', '<derby|league>');
}

function getMonsterLeagueModule(): {
    claimLeagueRewards?: (session: ProxySession) => Promise<string[]>;
} | null {
    try {
        return require('../monster-capture/league') as typeof import('../monster-capture/league');
    } catch (_err) {
        return null;
    }
}

function getNpcDialogTarget(entityId?: number): { entityId: number; sprite: number; name: string } {
    const npc = getFishingNpc(entityId);
    return {
        entityId: npc ? npc.serial : (entityId || _fishingNpcSerial),
        sprite: npc ? npc.sprite : (_config?.npcSprite || 1),
        name: npc ? npc.name : (_config?.npcName || 'Fishing Master'),
    };
}

function getFishingNpc(entityId?: number): VirtualNPC | undefined {
    if (!_npcInjector) {
        return undefined;
    }
    if (entityId) {
        const clickedNpc = _npcInjector.getNPC(entityId);
        if (clickedNpc) {
            return clickedNpc;
        }
    }
    return _npcInjector.getNPC(_fishingNpcSerial);
}

function getOwnerSession(fish: FishingEncounter): ProxySession | null {
    if (!_proxy || !fish.ownerSessionId) {
        return null;
    }

    const session = _proxy.sessions.get(fish.ownerSessionId);
    return session && !session.destroyed ? session : null;
}

function clearFishStateTimer(fish: FishingEncounter): void {
    if (fish.stateTimer) {
        clearTimeout(fish.stateTimer);
        fish.stateTimer = null;
    }
}

function clearFishWander(fish: FishingEncounter): void {
    if (fish.wanderTimer) {
        clearTimeout(fish.wanderTimer);
        fish.wanderTimer = null;
    }
}

function sendFishingNotice(session: ProxySession, message: string): void {
    if (!_chat) {
        return;
    }

    _chat.sendChat(session, {
        channel: 'whisper',
        message,
    });
}

function setActiveReactionWindow(fish: FishingEncounter, durationMs: number): void {
    fish.activeWindowStartedAt = Date.now();
    fish.activeWindowDurationMs = Math.max(1, durationMs);
}

function clearActiveReactionWindow(fish: FishingEncounter): void {
    fish.activeWindowStartedAt = 0;
    fish.activeWindowDurationMs = 0;
}

function applyReactionResult(fish: FishingEncounter): void {
    if (fish.activeWindowStartedAt > 0 && fish.activeWindowDurationMs > 0) {
        const elapsed = Date.now() - fish.activeWindowStartedAt;
        if (elapsed > Math.floor(fish.activeWindowDurationMs * 0.4)) {
            fish.perfectCatch = false;
        }
    }
    clearActiveReactionWindow(fish);
}

function getIdleSprite(sizeClass: FishSizeClass): number {
    return sizeClass === 'big' ? BIG_FISH_IDLE_SPRITE : SMALL_FISH_IDLE_SPRITE;
}

function getHookedSprite(sizeClass: FishSizeClass): number {
    return sizeClass === 'big' ? BIG_FISH_HOOKED_SPRITE : SMALL_FISH_HOOKED_SPRITE;
}

function rollGlimmer(rarity: FishRarity): boolean {
    const chance = {
        common: 0.03,
        uncommon: 0.05,
        rare: 0.08,
        legendary: 0.12,
    }[rarity] ?? 0.03;
    return Math.random() < chance;
}

function normalizeRodNames(rodNames?: string[]): string[] {
    if (!Array.isArray(rodNames) || rodNames.length === 0) {
        return ['Fishing Rod'];
    }

    const names = rodNames.map(name => normalizeName(name, '')).filter(Boolean);
    return names.length > 0 ? names : ['Fishing Rod'];
}

function normalizeAmbientSpeech(ambientSpeech?: { intervalSeconds?: number; messages?: string[] }): { intervalSeconds: number; messages: string[] } | undefined {
    if (!ambientSpeech) {
        return undefined;
    }

    const messages = Array.isArray(ambientSpeech.messages)
        ? ambientSpeech.messages.map(msg => String(msg ?? '').trim()).filter(Boolean)
        : [];
    if (messages.length === 0) {
        return undefined;
    }

    return {
        intervalSeconds: toInt(ambientSpeech.intervalSeconds, 30, 5),
        messages,
    };
}

function normalizeRect(rect?: Rect): Rect {
    const x1 = toInt(rect?.x1, 0, 0);
    const y1 = toInt(rect?.y1, 0, 0);
    const x2 = toInt(rect?.x2, x1, 0);
    const y2 = toInt(rect?.y2, y1, 0);
    return {
        x1: Math.min(x1, x2),
        y1: Math.min(y1, y2),
        x2: Math.max(x1, x2),
        y2: Math.max(y1, y2),
    };
}

function normalizeBehavior(behavior: FishBehavior | undefined): FishBehavior {
    if (behavior === 'ancient' || behavior === 'darting') {
        return behavior;
    }
    return 'calm';
}

function normalizeRarity(rarity: FishRarity | undefined): FishRarity {
    if (rarity === 'legendary' || rarity === 'rare' || rarity === 'uncommon') {
        return rarity;
    }
    return 'common';
}

function normalizeDirection(value: unknown, fallback: number): number {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 3) {
        return fallback;
    }
    return parsed;
}

function toInt(value: unknown, fallback: number, minimum: number): number {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.max(minimum, parsed);
}

function toOptionalInt(value: unknown): number | undefined {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeName(value: unknown, fallback: string): string {
    const text = String(value ?? '').trim();
    return text || fallback;
}

function normalizeEquipmentLabel(value: unknown): string {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

function matchesRodName(value: unknown): boolean {
    if (!_config) {
        return false;
    }

    const normalizedWeaponName = normalizeEquipmentLabel(value);
    if (!normalizedWeaponName) {
        return false;
    }

    if (_config.rodNameSet.has(normalizedWeaponName)) {
        return true;
    }

    if (_config.useRodNameHeuristics) {
        if (normalizedWeaponName.includes('fishingrod') || normalizedWeaponName.includes('fishingpole')) {
            return true;
        }

        if (normalizedWeaponName.includes('rod') || normalizedWeaponName.includes('pole')) {
            return true;
        }
    }

    return false;
}

function randomInt(min: number, max: number): number {
    if (max <= min) {
        return min;
    }
    return min + Math.floor(Math.random() * (max - min + 1));
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function isWithinRect(x: number, y: number, rect: Rect): boolean {
    return x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2;
}

function withArticle(name: string): string {
    return /^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`;
}

function buildCatchExtras(catchRow: FishingBestCatch): string {
    const parts: string[] = [];
    if (catchRow.perfectCatch) {
        parts.push('perfect');
    }
    if (catchRow.glimmer) {
        parts.push('glimmer');
    }
    return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

function formatWeight(weight: number): string {
    return `${weight} lbs`;
}
