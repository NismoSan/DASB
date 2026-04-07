import ProxyServer, { ProxyServerConfig } from './proxy-server';
import { PacketInspector, playerStateMiddleware } from './packet-inspector';
import PlayerRegistry from './player-registry';
import AugmentationEngine from './augmentation/index';
import AutomationManager from './automation/index';
import TriggerEngine from './triggers/trigger-engine';
import Packet from '../core/packet';
import { uint16 } from '../core/datatypes';
import type CommandRegistry from './commands/command-registry';
import { getAllNpcPositionOverrides, getNpcPositionOverride, updateNpcOverrideVisualData, type NpcPositionOverride } from './commands/index';

export interface ProxySystem {
    server: ProxyServer;
    inspector: PacketInspector;
    registry: PlayerRegistry;
    augmentation: AugmentationEngine;
    automation: AutomationManager;
    commands: CommandRegistry;
    triggers: TriggerEngine;
}

/**
 * Creates and wires together the full proxy system.
 */
export function createProxySystem(config?: Partial<ProxyServerConfig>): ProxySystem {
    const server = new ProxyServer(config);
    const inspector = new PacketInspector();
    const registry = new PlayerRegistry();
    const augmentation = new AugmentationEngine(server, registry);
    const automation = new AutomationManager(server);
    automation.registry = registry;
    const triggers = new TriggerEngine();

    // Register automation slash commands
    automation.registerCommands(augmentation.commands, augmentation.chat);

    // Wire inspector and registry to server
    server.setInspector(inspector);
    server.registry = registry;

    // Add built-in middlewares
    inspector.use('playerState', playerStateMiddleware());
    inspector.use('registry', registry.createMiddleware());
    // Register/unregister players on session lifecycle
    server.on('session:game', (session) => {
        registry.registerSession(session);
        automation.createSession(session);
        console.log(`[ProxySystem] Player registered: ${session.characterName} (${session.id})`);
    });

    server.on('session:end', (session) => {
        registry.unregisterSession(session.id);
        augmentation.onSessionEnd(session.id);
        automation.destroySession(session.id);
        console.log(`[ProxySystem] Player unregistered: ${session.characterName || session.id}`);
    });

    // NPC visibility: resend NPCs when player changes map
    // Exit markers: send exit animations when player changes map
    server.on('player:mapChange', (session) => {
        console.log(`[ProxySystem] Map change [${session.id}]: map=${session.playerState.mapNumber}`);
        augmentation.npcs.onPlayerMapChange(session);
        augmentation.exitMarker.onPlayerMapChange(session);
    });

    // NPC visibility: resend NPCs after server completes refresh (0x58 MapTransferComplete detected)
    // Exit markers: resend exit animations after refresh
    server.on('player:refreshComplete', (session) => {
        console.log(`[ProxySystem] Refresh complete [${session.id}]: injecting virtual NPCs + exit markers`);
        augmentation.npcs.onPlayerRefresh(session);
        augmentation.exitMarker.onPlayerRefresh(session);
    });

    // NPC visibility: check walk-near when player position updates
    // Exit markers: check for new exits entering viewport
    server.on('player:position', (session) => {
        augmentation.npcs.checkWalkNear(session);
        augmentation.exitMarker.onPlayerPosition(session);
    });

    // NPC visibility: re-inject NPCs after server teleports (charge/ambush/warp)
    // 0x04 MapLocation causes client to rebuild entity list; virtual NPCs need re-sending
    server.on('player:teleport', (session) => {
        augmentation.npcs.onPlayerTeleport(session);
    });

    // Virtual entity interactions (intercepted in passthrough, forwarded here)
    server.on('virtual:interact', (session, entityId) => {
        augmentation.onVirtualInteract(session, entityId);
    });
    server.on('virtual:menuChoice', (session, entityId, pursuitId, slot) => {
        augmentation.onVirtualMenuChoice(session, entityId, pursuitId, slot);
    });
    server.on('virtual:dialogChoice', (session, entityId, pursuitId, stepId) => {
        augmentation.onVirtualDialogChoice(session, entityId, pursuitId, stepId);
    });
    server.on('virtual:textInput', (session, entityId, pursuitId, text) => {
        augmentation.onVirtualTextInput(session, entityId, pursuitId, text);
    });

    // Learn map names from 0x15 packets and persist to map graph
    let mapNameSaveTimer: ReturnType<typeof setTimeout> | null = null;
    server.on('player:mapName', (session, mapId, mapName, width, height) => {
        const mapGraph = automation.getMapGraph();
        const existing = mapGraph.getNode(mapId);
        if (!existing || !existing.mapName || existing.mapName.startsWith('Map ')) {
            mapGraph.setNode(mapId, { mapId, mapName, width, height });
            // Debounced save — wait 10s after last update to batch writes
            if (mapNameSaveTimer)
                clearTimeout(mapNameSaveTimer);
            mapNameSaveTimer = setTimeout(() => {
                mapGraph.save().catch(() => { });
                mapNameSaveTimer = null;
            }, 10000);
        }
    });

    // Automation: forward walk responses and position updates to per-session navigator
    server.on('player:walkResponse', (session, direction, prevX, prevY) => {
        const auto = automation.getSession(session.id);
        if (auto)
            auto.navigator.onWalkResponse(direction, prevX, prevY);
    });

    server.on('player:position', (session) => {
        const auto = automation.getSession(session.id);
        if (auto)
            auto.navigator.onMapLocation(session.playerState.x, session.playerState.y);
    });

    server.on('player:mapChange', (session) => {
        const auto = automation.getSession(session.id);
        if (auto) {
            auto.navigator.onMapChange(session.playerState.mapNumber);
            auto.buffs.clear();
        }
        registry.clearEntities(session.id);
    });

    // Automation: feed live 0x3C tile data to per-session navigator for collision
    server.on('player:tileData', (session, rowY, tileBytes) => {
        const auto = automation.getSession(session.id);
        if (auto)
            auto.navigator.onTileData(rowY, tileBytes);
    });

    // Automation: track entity positions for obstacle avoidance + entity registry
    server.on('entity:add', (session, serial, x, y, image, name, direction, entityType) => {
        const auto = automation.getSession(session.id);
        if (auto)
            auto.navigator.onEntityAdd(serial, x, y);
        // Feed entity data to player registry for combat targeting
        if (image !== undefined) {
            // entityType byte: 0x00=monster/NPC, 0x01=ground item, 0x02=unknown
            if (entityType === 0x01) {
                registry.addGroundItem(session.id, serial, x, y, image, name ?? '');
            }
            else {
                registry.addCreatureEntity(session.id, serial, x, y, image, name ?? '', direction ?? 0, entityType === 0x00 ? 'monster' : 'unknown');
            }
        }
    });

    server.on('entity:show', (session, serial, x, y) => {
        const auto = automation.getSession(session.id);
        if (auto)
            auto.navigator.onEntityAdd(serial, x, y);
    });

    server.on('entity:walk', (session, serial, prevX, prevY, dir) => {
        const auto = automation.getSession(session.id);
        if (auto)
            auto.navigator.onEntityWalk(serial, prevX, prevY, dir);
    });

    server.on('entity:remove', (session, serial) => {
        const auto = automation.getSession(session.id);
        if (auto) {
            auto.navigator.onEntityRemove(serial);
            auto.buffs.removeEntity(serial);
        }
    });

    // Automation: track entity HP bars for targeting
    server.on('entity:hpBar', (session, serial, hpPercent) => {
        registry.updateEntityHp(session.id, serial, hpPercent);
    });

    // Automation: track spell animations for debuff tracking
    server.on('entity:spellAnimation', (session, casterSerial, targetSerial, animationId) => {
        const auto = automation.getSession(session.id);
        if (auto)
            auto.buffs.onSpellAnimation(casterSerial, targetSerial, animationId);
    });

    // Automation: track self buff bar icons
    server.on('player:spellBar', (session, icons) => {
        const auto = automation.getSession(session.id);
        if (auto)
            auto.buffs.onSpellBar(icons);
    });

    // Automation: world map UI (0x2E) for sign post travel
    server.on('player:worldMap', (session, nodes) => {
        const auto = automation.getSession(session.id);
        if (auto)
            auto.navigator.onWorldMapReceived(nodes);
    });

    // Automation: track spell/skill book changes
    server.on('player:addSpell', (session, body) => {
        const auto = automation.getSession(session.id);
        if (auto)
            auto.caster.onAddSpell(body);
    });

    server.on('player:removeSpell', (session, slot) => {
        const auto = automation.getSession(session.id);
        if (auto)
            auto.caster.onRemoveSpell(slot);
    });

    server.on('player:addSkill', (session, body) => {
        const auto = automation.getSession(session.id);
        if (auto)
            auto.caster.onAddSkill(body);
    });

    server.on('player:removeSkill', (session, slot) => {
        const auto = automation.getSession(session.id);
        if (auto)
            auto.caster.onRemoveSkill(slot);
    });

    // Slash command handling (intercepted 0x0E chat starting with '/')
    server.on('player:command', (session, message) => {
        augmentation.onPlayerCommand(session, message);
        triggers.fire('player:command', session, { message });
    });

    // Fire triggers on proxy events
    server.on('session:game', (session) => {
        triggers.fire('session:game', session, {});
    });

    server.on('player:mapChange', (session) => {
        triggers.fire('player:mapChange', session, { mapNumber: session.playerState.mapNumber });
    });

    server.on('player:position', (session) => {
        triggers.fire('player:position', session, { x: session.playerState.x, y: session.playerState.y });
    });

    server.on('npc:click', (session, npc) => {
        triggers.fire('npc:click', session, { npc });
    });

    // Parcel interception: forward 0x3B SendMail events for auction house integration
    server.on('player:sendMail', (session, recipient, subject, boardId) => {
        console.log(`[ProxySystem] SendMail from ${session.characterName} to "${recipient}" subject="${subject}" board=${boardId}`);
    });

    // Virtual board interception: forward 0x3B ViewBoard/ViewPost for virtual boards (>= 0xFF00)
    server.on('virtual:viewBoard', (session, boardId, startPostId) => {
        server.emit('virtualBoard:view', session, boardId, startPostId);
    });

    server.on('virtual:viewPost', (session, boardId, postId, navigation) => {
        server.emit('virtualBoard:viewPost', session, boardId, postId, navigation);
    });

    // ── Override NPC proactive injection ──────────────────────────────
    // Override NPCs are real server entities whose positions we override.
    // We inject them proactively so they appear immediately on map entry,
    // not just when the player walks near the NPC's original server position.
    const VIEW_RANGE = 15;
    const overrideVisible = new Map<string, Set<string>>(); // sessionId -> Set<npcNameKey>

    function sendOverrideAddEntity(session: import('./proxy-session').default, ov: NpcPositionOverride): void {
        if (ov.serial == null || ov.sprite == null) return;
        const pkt = new Packet(0x07);
        pkt.writeUInt16(1);
        pkt.writeUInt16(ov.x);
        pkt.writeUInt16(ov.y);
        pkt.writeUInt32(ov.serial);
        pkt.writeUInt16(uint16(ov.sprite | 0x4000));
        pkt.writeUInt32(0);
        pkt.writeByte(ov.direction ?? 2);
        pkt.writeByte(0);
        pkt.writeByte(2); // Mundane
        pkt.writeString8(ov.name);
        server.sendToClient(session, pkt);
    }

    function injectOverridesForMap(session: import('./proxy-session').default): void {
        const mapNum = session.playerState.mapNumber;
        const px = session.playerState.x;
        const py = session.playerState.y;
        const visible = new Set<string>();
        overrideVisible.set(session.id, visible);
        for (const ov of getAllNpcPositionOverrides()) {
            if (ov.mapNumber == null || ov.sprite == null || ov.serial == null) continue;
            if (ov.mapNumber !== mapNum) continue;
            if (Math.abs(ov.x - px) < VIEW_RANGE && Math.abs(ov.y - py) < VIEW_RANGE) {
                sendOverrideAddEntity(session, ov);
                visible.add(ov.name.toLowerCase());
            }
        }
    }

    function checkOverrideWalkNear(session: import('./proxy-session').default): void {
        const mapNum = session.playerState.mapNumber;
        const px = session.playerState.x;
        const py = session.playerState.y;
        let visible = overrideVisible.get(session.id);
        if (!visible) {
            visible = new Set();
            overrideVisible.set(session.id, visible);
        }
        for (const ov of getAllNpcPositionOverrides()) {
            if (ov.mapNumber == null || ov.sprite == null || ov.serial == null) continue;
            if (ov.mapNumber !== mapNum) continue;
            const key = ov.name.toLowerCase();
            const inRange = Math.abs(ov.x - px) < VIEW_RANGE && Math.abs(ov.y - py) < VIEW_RANGE;
            if (inRange && !visible.has(key)) {
                sendOverrideAddEntity(session, ov);
                visible.add(key);
            } else if (!inRange && visible.has(key)) {
                if (ov.serial != null) {
                    const removePkt = new Packet(0x0E);
                    removePkt.writeUInt32(ov.serial);
                    server.sendToClient(session, removePkt);
                }
                visible.delete(key);
            }
        }
    }

    server.on('player:mapChange', (session) => {
        injectOverridesForMap(session);
    });

    server.on('player:refreshComplete', (session) => {
        injectOverridesForMap(session);
    });

    server.on('player:position', (session) => {
        checkOverrideWalkNear(session);
    });

    server.on('player:teleport', (session) => {
        injectOverridesForMap(session);
    });

    server.on('session:end', (session) => {
        overrideVisible.delete(session.id);
    });

    // When the server sends a real entity matching an override, learn its
    // serial/sprite/map so proactive injection uses current data next time.
    // The in-flight 0x07 modifier already rewrote the coordinates before the
    // packet reached the client, so no remove+re-add is needed here.
    server.on('entity:add', (session, serial, x, y, image, name, direction, entityType) => {
        if (!name || entityType === 0x01) return;
        const ov = getNpcPositionOverride(name);
        if (!ov) return;
        const needsUpdate = ov.sprite == null || ov.serial !== serial || ov.mapNumber == null;
        if (needsUpdate) {
            const oldSerial = ov.serial;
            updateNpcOverrideVisualData(name, {
                sprite: ov.sprite ?? image,
                mapNumber: session.playerState.mapNumber,
                direction: direction ?? ov.direction ?? 2,
                serial,
            });
            if (oldSerial != null && oldSerial !== serial) {
                for (const s of server.sessions.values()) {
                    if (s.phase === 'game' && !s.destroyed) {
                        const removePkt = new Packet(0x0E);
                        removePkt.writeUInt32(oldSerial);
                        server.sendToClient(s, removePkt);
                    }
                }
            }
        }
    });

    return { server, inspector, registry, augmentation, automation, commands: augmentation.commands, triggers };
}

export { ProxyServer, PacketInspector, PlayerRegistry, AugmentationEngine };
export { AutomationManager };
export { TriggerEngine };
export { CommandRegistry } from './commands/index';
export type { ProxyServerConfig } from './proxy-server';
export type { PacketDirection, PacketMiddleware, InspectionResult } from './packet-inspector';
export type { ProxiedPlayer, EntityInfo, EntityType, GroundItem } from './player-registry';
export type { CommandHandler, CommandInfo } from './commands/command-registry';
export type { Trigger, TriggerContext, TriggerCondition, TriggerAction } from './triggers/trigger-engine';
