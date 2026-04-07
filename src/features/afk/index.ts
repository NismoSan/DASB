/**
 * AFK Dark Ages Shadow Server — entry point.
 * Exports the AfkEngine for initialization from panel.js alongside the existing initAfkMode.
 */

export { AfkEngine, AfkEngineConfig } from './afk-engine';
export { ShadowWorld } from './shadow-world';
export { ShadowEntity, ShadowCreature, ShadowMonster, ShadowGroundItem } from './shadow-entity';
