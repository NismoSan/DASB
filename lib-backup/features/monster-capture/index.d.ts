import type ProxyServer from '../../proxy/proxy-server';
import type PlayerRegistry from '../../proxy/player-registry';
import type AugmentationEngine from '../../proxy/augmentation/index';
import type AutomationManager from '../../proxy/automation/index';
import type { MonsterCaptureConfig } from './types';
import { loadSpeciesData, getAllSpecies, getAllEvolvedSpecies, getAllMoves } from './species-data';
export declare function initMonsterCapture(proxy: ProxyServer, registry: PlayerRegistry, augmentation: AugmentationEngine, automation: AutomationManager, config?: Partial<MonsterCaptureConfig>): Promise<void>;
export { getAllSpecies, getAllEvolvedSpecies, getAllMoves, loadSpeciesData };
export type { MonsterCaptureConfig };
