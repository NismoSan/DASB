import type ProxyServer from '../../proxy/proxy-server';
import type ProxySession from '../../proxy/proxy-session';
import type NpcInjector from '../../proxy/augmentation/npc-injector';
import type ChatInjector from '../../proxy/augmentation/chat-injector';
import type AutomationManager from '../../proxy/automation/index';
import type { CompanionState, MonsterCaptureConfig } from './types';
export declare function initCompanion(proxy: ProxyServer, npcInjector: NpcInjector, chat: ChatInjector, automation: AutomationManager, config: MonsterCaptureConfig): void;
export declare function toggleCompanion(session: ProxySession): Promise<void>;
export declare function getCompanion(sessionId: string): CompanionState | undefined;
export declare function onPlayerMove(session: ProxySession): void;
export declare function onPlayerMapChange(session: ProxySession): void;
/**
 * Called when the proxy detects the player's HP changed (0x08 stats update).
 * If HP went down, the player is probably in combat — companion auto-attacks.
 */
export declare function onPlayerCombat(session: ProxySession, prevHp: number, currentHp: number): void;
export declare function refreshCompanion(session: ProxySession): Promise<void>;
export declare function onSessionEnd(sessionId: string): void;
