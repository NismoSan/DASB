import type ProxyServer from '../proxy-server';
import type ProxySession from '../proxy-session';
import type PlayerRegistry from '../player-registry';
/**
 * Marks all known map exits with entity-targeted animation effects.
 *
 * The DA client only displays one ground-targeted (TargetId=0) 0x29 animation
 * at a time — each new one replaces the previous. To get simultaneous animations
 * on every door tile, we place invisible Monster entities (creatureType=0) on each
 * exit and animate them individually with entity-targeted 0x29.
 */
export default class ExitMarker {
    private proxy;
    private registry;
    /** fromMapId -> list of exit coordinates */
    private exitsByMap;
    /** sessionId -> interval timer for periodic animation refresh */
    private refreshTimers;
    /** sessionId -> set of exit entity serials currently visible */
    private visibleEntities;
    /** All exit marker entities keyed by serial */
    private exitEntities;
    /** mapNumber -> list of exit entity serials on that map */
    private entitiesByMap;
    private static readonly VIEW_RANGE;
    private static readonly ANIMATION_ID;
    private static readonly ANIMATION_SPEED;
    private static readonly REFRESH_INTERVAL_MS;
    /** Creature sprite for the marker entity. Using sprite 1 (smallest basic creature)
     *  with creatureType 0 (Monster) so the client tracks it as a real entity
     *  that can receive animations. The sprite itself will be hidden by the animation. */
    private static readonly MARKER_SPRITE;
    constructor(proxy: ProxyServer, registry: PlayerRegistry);
    private loadExits;
    /**
     * Pre-allocate virtual entity serials for all exit tiles.
     */
    private _createAllEntities;
    onPlayerMapChange(session: ProxySession): void;
    onPlayerRefresh(session: ProxySession): void;
    /**
     * Send exit marker entities + animations for all exits in viewport.
     */
    private _injectExitEntities;
    onPlayerPosition(session: ProxySession): void;
    clearSession(sessionId: string): void;
    /**
     * Send 0x07 AddEntity for a single exit marker.
     * Uses creatureType 0 (Monster) so the client tracks it as a targetable entity.
     */
    private _sendAddEntity;
    /**
     * Send entity-targeted 0x29 animation.
     *
     * Format: [TargetId:u32] [SourceId:u32] [TargetAnimation:u16] [SourceAnimation:u16] [Speed:u16]
     */
    private _sendEntityAnimation;
    private _sendRemoveEntity;
    private _startRefreshTimer;
    private _stopRefreshTimer;
    private _getEntitySerialsForSession;
    private _inRange;
}
