import type ProxyServer from '../../proxy/proxy-server';
import type ProxySession from '../../proxy/proxy-session';
import type NpcInjector from '../../proxy/augmentation/npc-injector';
import type ChatInjector from '../../proxy/augmentation/chat-injector';
import type PlayerRegistry from '../../proxy/player-registry';
import type ProxyCollision from '../../proxy/automation/proxy-collision';
import type { WildEncounter, MonsterCaptureConfig } from './types';
export declare function getActiveEncounter(sessionId: string): WildEncounter | undefined;
export declare function clearEncounter(sessionId: string, npcInjector: NpcInjector): void;
/**
 * Called on every player:position event. If the player is on the encounter map
 * and on a grass tile, roll for a wild encounter.
 */
export declare function onPlayerStep(session: ProxySession, config: MonsterCaptureConfig, proxy: ProxyServer, npcInjector: NpcInjector, chat: ChatInjector, registry: PlayerRegistry, collision?: ProxyCollision): void;
/**
 * Player used /capture — attempt to catch the wild monster.
 */
export declare function attemptCapture(session: ProxySession, config: MonsterCaptureConfig, npcInjector: NpcInjector, chat: ChatInjector): Promise<void>;
/**
 * Reduce a wild encounter's HP (from /fight wild battle).
 * Returns true if the monster fainted.
 */
export declare function damageWildMonster(sessionId: string, damage: number, proxy: ProxyServer, session: ProxySession, npcInjector: NpcInjector, chat: ChatInjector): boolean;
/**
 * Called when player leaves the encounter map — clear their encounter.
 */
export declare function onPlayerMapChange(sessionId: string, npcInjector: NpcInjector): void;
export declare function onSessionEnd(sessionId: string, npcInjector: NpcInjector): void;
export declare function setProxy(proxy: ProxyServer): void;
