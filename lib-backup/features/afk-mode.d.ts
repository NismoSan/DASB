import type ProxyServer from '../proxy/proxy-server';
import type AugmentationEngine from '../proxy/augmentation/index';
import type AutomationManager from '../proxy/automation/index';
export interface AfkModeConfig {
    afkMapNumber: number;
    spawnX: number;
    spawnY: number;
    mapWidth?: number;
    mapHeight?: number;
}
export declare function initAfkMode(proxy: ProxyServer, augmentation: AugmentationEngine, automation: AutomationManager, config: AfkModeConfig): void;
