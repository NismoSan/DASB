import type ProxyServer from '../../proxy/proxy-server';
import type NpcInjector from '../../proxy/augmentation/npc-injector';
import type DialogHandler from '../../proxy/augmentation/dialog-handler';
import type ChatInjector from '../../proxy/augmentation/chat-injector';
import type { MonsterCaptureConfig } from './types';
export declare function initKeeper(proxy: ProxyServer, npcInjector: NpcInjector, dialogHandler: DialogHandler, chat: ChatInjector, config: MonsterCaptureConfig): number;
export declare function onSessionEnd(sessionId: string): void;
