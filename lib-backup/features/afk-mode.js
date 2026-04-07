"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initAfkMode = initAfkMode;
const packet_1 = __importDefault(require("../core/packet"));
/** Viewport radius — same as Arbiter/NpcInjector (15 tiles) */
const VIEW_RANGE = 15;
// ── BodyAnimation enum values (from Chaos Server / Arbiter) ──────────
const BodyAnimation = {
    None: 0,
    Assail: 1,
    HandsUp: 6,
    PriestCast: 128,
    TwoHandAtk: 129,
    Jump: 130,
    Kick: 131,
    Punch: 132,
    RoundHouseKick: 133,
    Stab: 134,
    DoubleStab: 135,
    WizardCast: 136,
    PlayNotes: 137,
    HandsUp2: 138,
    Swipe: 139,
    HeavySwipe: 140,
    JumpAttack: 141,
    BowShot: 142,
    HeavyBowShot: 143,
    LongBowShot: 144,
    Summon: 145,
};
// ── SpellTargetType enum (from Arbiter SpellTargetType / Chaos SpellType) ──
const SpellTargetType = {
    None: 0,
    Prompt: 1,
    Targeted: 2,
    NoTarget: 5,
};
// ── Throttle intervals (ms) ─────────────────────────────────────────
const WALK_THROTTLE = 150;
const SPELL_THROTTLE = 750;
const SKILL_THROTTLE = 750;
const ASSAIL_THROTTLE = 500;
// ── MP regeneration ─────────────────────────────────────────────────
const MP_REGEN_INTERVAL = 5000; // every 5 seconds
const MP_REGEN_PERCENT = 0.02; // 2% of max MP
/**
 * Spell metadata table: spell name (lowercase) → full metadata.
 * Body animations sourced from Chaos Server BodyAnimation enum.
 * Effect animations sourced from Slowpoke SpellAni data.
 * MP costs are tier-based estimates matching real server behavior.
 */
const SPELL_META = {
    // ── Wizard attack spells (element families) ──────────────────
    // Fire (srad)
    'beag srad': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 234, mpCost: 50, cooldownMs: 1000, type: 'damage', basePower: 200, sound: 0 },
    'srad': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 234, mpCost: 150, cooldownMs: 1000, type: 'damage', basePower: 500, sound: 0 },
    'mor srad': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 234, mpCost: 400, cooldownMs: 1500, type: 'damage', basePower: 1200, sound: 0 },
    'ard srad': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 234, mpCost: 800, cooldownMs: 2000, type: 'damage', basePower: 2500, sound: 0 },
    'srad lamh': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 234, mpCost: 200, cooldownMs: 1000, type: 'damage', basePower: 600, sound: 0 },
    'beag srad lamh': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 234, mpCost: 100, cooldownMs: 1000, type: 'damage', basePower: 300, sound: 0 },
    'srad meall': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 234, mpCost: 300, cooldownMs: 1500, type: 'damage', basePower: 800, sound: 0 },
    'srad gar': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 234, mpCost: 600, cooldownMs: 2000, type: 'damage', basePower: 2000, sound: 0 },
    // Water (sal)
    'beag sal': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 234, mpCost: 50, cooldownMs: 1000, type: 'damage', basePower: 200, sound: 0 },
    'sal': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 234, mpCost: 150, cooldownMs: 1000, type: 'damage', basePower: 500, sound: 0 },
    'mor sal': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 234, mpCost: 400, cooldownMs: 1500, type: 'damage', basePower: 1200, sound: 0 },
    'ard sal': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 234, mpCost: 800, cooldownMs: 2000, type: 'damage', basePower: 2500, sound: 0 },
    'sal lamh': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 234, mpCost: 200, cooldownMs: 1000, type: 'damage', basePower: 600, sound: 0 },
    'beag sal lamh': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 234, mpCost: 100, cooldownMs: 1000, type: 'damage', basePower: 300, sound: 0 },
    'sal meall': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 234, mpCost: 300, cooldownMs: 1500, type: 'damage', basePower: 800, sound: 0 },
    'sal gar': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 234, mpCost: 600, cooldownMs: 2000, type: 'damage', basePower: 2000, sound: 0 },
    // Earth (creag)
    'beag creag': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 235, mpCost: 50, cooldownMs: 1000, type: 'damage', basePower: 200, sound: 0 },
    'creag': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 235, mpCost: 150, cooldownMs: 1000, type: 'damage', basePower: 500, sound: 0 },
    'mor creag': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 235, mpCost: 400, cooldownMs: 1500, type: 'damage', basePower: 1200, sound: 0 },
    'ard creag': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 235, mpCost: 800, cooldownMs: 2000, type: 'damage', basePower: 2500, sound: 0 },
    'creag lamh': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 235, mpCost: 200, cooldownMs: 1000, type: 'damage', basePower: 600, sound: 0 },
    'beag creag lamh': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 235, mpCost: 100, cooldownMs: 1000, type: 'damage', basePower: 300, sound: 0 },
    'creag meall': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 235, mpCost: 300, cooldownMs: 1500, type: 'damage', basePower: 800, sound: 0 },
    'creag gar': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 235, mpCost: 600, cooldownMs: 2000, type: 'damage', basePower: 2000, sound: 0 },
    // Wind (athar)
    'beag athar': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 237, mpCost: 50, cooldownMs: 1000, type: 'damage', basePower: 200, sound: 0 },
    'athar': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 237, mpCost: 150, cooldownMs: 1000, type: 'damage', basePower: 500, sound: 0 },
    'mor athar': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 237, mpCost: 400, cooldownMs: 1500, type: 'damage', basePower: 1200, sound: 0 },
    'ard athar': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 237, mpCost: 800, cooldownMs: 2000, type: 'damage', basePower: 2500, sound: 0 },
    'athar lamh': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 237, mpCost: 200, cooldownMs: 1000, type: 'damage', basePower: 600, sound: 0 },
    'beag athar lamh': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 237, mpCost: 100, cooldownMs: 1000, type: 'damage', basePower: 300, sound: 0 },
    'athar meall': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 237, mpCost: 300, cooldownMs: 1500, type: 'damage', basePower: 800, sound: 0 },
    'athar gar': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 237, mpCost: 600, cooldownMs: 2000, type: 'damage', basePower: 2000, sound: 0 },
    // ── Priest heals (ioc family) ────────────────────────────────
    'beag ioc': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 232, mpCost: 50, cooldownMs: 1000, type: 'heal', basePower: 500, sound: 8 },
    'ioc': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 232, mpCost: 200, cooldownMs: 1000, type: 'heal', basePower: 2000, sound: 8 },
    'mor ioc': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 232, mpCost: 500, cooldownMs: 1500, type: 'heal', basePower: 5000, sound: 8 },
    'ard ioc': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 232, mpCost: 1000, cooldownMs: 2000, type: 'heal', basePower: 15000, sound: 8 },
    'beag ioc comlha': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 232, mpCost: 100, cooldownMs: 1000, type: 'heal', basePower: 1000, sound: 8 },
    'ioc comlha': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 232, mpCost: 300, cooldownMs: 1000, type: 'heal', basePower: 3000, sound: 8 },
    'mor ioc comlha': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 232, mpCost: 600, cooldownMs: 1500, type: 'heal', basePower: 8000, sound: 8 },
    'ard ioc comlha': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 232, mpCost: 1200, cooldownMs: 2000, type: 'heal', basePower: 20000, sound: 8 },
    // ── Curses ────────────────────────────────────────────────────
    'beag cradh': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 259, mpCost: 100, cooldownMs: 1500, type: 'debuff', basePower: 0, sound: 0 },
    'cradh': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 258, mpCost: 250, cooldownMs: 2000, type: 'debuff', basePower: 0, sound: 0 },
    'mor cradh': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 243, mpCost: 500, cooldownMs: 3000, type: 'debuff', basePower: 0, sound: 0 },
    'ard cradh': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 257, mpCost: 1000, cooldownMs: 4000, type: 'debuff', basePower: 0, sound: 0 },
    // ── Curse removals ────────────────────────────────────────────
    'ao beag cradh': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 245, mpCost: 50, cooldownMs: 1000, type: 'buff', basePower: 0, sound: 8 },
    'ao cradh': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 245, mpCost: 100, cooldownMs: 1000, type: 'buff', basePower: 0, sound: 8 },
    'ao mor cradh': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 245, mpCost: 200, cooldownMs: 1500, type: 'buff', basePower: 0, sound: 8 },
    'ao ard cradh': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 245, mpCost: 400, cooldownMs: 2000, type: 'buff', basePower: 0, sound: 8 },
    // ── Status removals ───────────────────────────────────────────
    'ao dall': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 5, mpCost: 100, cooldownMs: 1000, type: 'buff', basePower: 0, sound: 8 },
    'ao puinsein': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 5, mpCost: 100, cooldownMs: 1000, type: 'buff', basePower: 0, sound: 8 },
    'ao suain': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 5, mpCost: 100, cooldownMs: 1000, type: 'buff', basePower: 0, sound: 8 },
    // ── Buffs ─────────────────────────────────────────────────────
    'armachd': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 20, mpCost: 300, cooldownMs: 2000, type: 'buff', basePower: 0, sound: 8 },
    'dion': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 244, mpCost: 500, cooldownMs: 3000, type: 'buff', basePower: 0, sound: 8 },
    'mor dion': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 244, mpCost: 800, cooldownMs: 4000, type: 'buff', basePower: 0, sound: 8 },
    'mor dion comlha': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 93, mpCost: 1000, cooldownMs: 5000, type: 'buff', basePower: 0, sound: 8 },
    'dion comlha': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 93, mpCost: 700, cooldownMs: 4000, type: 'buff', basePower: 0, sound: 8 },
    'creag neart': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 6, mpCost: 200, cooldownMs: 2000, type: 'buff', basePower: 0, sound: 8 },
    'beannaich': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 280, mpCost: 300, cooldownMs: 2000, type: 'buff', basePower: 0, sound: 8 },
    'mor beannaich': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 280, mpCost: 500, cooldownMs: 3000, type: 'buff', basePower: 0, sound: 8 },
    // ── Fas spells (HandsUp animation per Chaos Server config) ───
    'fas deireas': { bodyAnimation: BodyAnimation.HandsUp, effectAnimation: 6, mpCost: 200, cooldownMs: 2000, type: 'debuff', basePower: 0, sound: 0 },
    'asgall faileas': { bodyAnimation: BodyAnimation.HandsUp, effectAnimation: 66, mpCost: 200, cooldownMs: 2000, type: 'debuff', basePower: 0, sound: 0 },
    'deireas faileas': { bodyAnimation: BodyAnimation.HandsUp, effectAnimation: 66, mpCost: 200, cooldownMs: 2000, type: 'debuff', basePower: 0, sound: 0 },
    'wings of protection': { bodyAnimation: BodyAnimation.HandsUp, effectAnimation: 86, mpCost: 300, cooldownMs: 3000, type: 'buff', basePower: 0, sound: 0 },
    'stone skin': { bodyAnimation: BodyAnimation.HandsUp, effectAnimation: 89, mpCost: 300, cooldownMs: 3000, type: 'buff', basePower: 0, sound: 0 },
    'iron skin': { bodyAnimation: BodyAnimation.HandsUp, effectAnimation: 89, mpCost: 300, cooldownMs: 3000, type: 'buff', basePower: 0, sound: 0 },
    'perfect defense': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 45, mpCost: 500, cooldownMs: 5000, type: 'buff', basePower: 0, sound: 8 },
    'aegis sphere': { bodyAnimation: BodyAnimation.HandsUp, effectAnimation: 64, mpCost: 400, cooldownMs: 4000, type: 'buff', basePower: 0, sound: 8 },
    'aegis': { bodyAnimation: BodyAnimation.HandsUp, effectAnimation: 64, mpCost: 400, cooldownMs: 4000, type: 'buff', basePower: 0, sound: 8 },
    // ── Protection ────────────────────────────────────────────────
    'beag naomh aite': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 231, mpCost: 200, cooldownMs: 2000, type: 'buff', basePower: 0, sound: 8 },
    'naomh aite': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 231, mpCost: 400, cooldownMs: 3000, type: 'buff', basePower: 0, sound: 8 },
    'mor naomh aite': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 231, mpCost: 600, cooldownMs: 4000, type: 'buff', basePower: 0, sound: 8 },
    'ard naomh aite': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 231, mpCost: 800, cooldownMs: 5000, type: 'buff', basePower: 0, sound: 8 },
    // ── Nature (fas nadur) ────────────────────────────────────────
    'beag fas nadur': { bodyAnimation: BodyAnimation.HandsUp, effectAnimation: 273, mpCost: 100, cooldownMs: 1500, type: 'debuff', basePower: 0, sound: 0 },
    'fas nadur': { bodyAnimation: BodyAnimation.HandsUp, effectAnimation: 273, mpCost: 200, cooldownMs: 2000, type: 'debuff', basePower: 0, sound: 0 },
    'mor fas nadur': { bodyAnimation: BodyAnimation.HandsUp, effectAnimation: 273, mpCost: 400, cooldownMs: 2500, type: 'debuff', basePower: 0, sound: 0 },
    'ard fas nadur': { bodyAnimation: BodyAnimation.HandsUp, effectAnimation: 273, mpCost: 600, cooldownMs: 3000, type: 'debuff', basePower: 0, sound: 0 },
    // ── Dark seals ────────────────────────────────────────────────
    'dark seal': { bodyAnimation: BodyAnimation.HandsUp, effectAnimation: 104, mpCost: 500, cooldownMs: 3000, type: 'debuff', basePower: 0, sound: 0 },
    'darker seal': { bodyAnimation: BodyAnimation.HandsUp, effectAnimation: 82, mpCost: 800, cooldownMs: 4000, type: 'debuff', basePower: 0, sound: 0 },
    'demise': { bodyAnimation: BodyAnimation.HandsUp, effectAnimation: 75, mpCost: 1000, cooldownMs: 5000, type: 'debuff', basePower: 0, sound: 0 },
    'demon seal': { bodyAnimation: BodyAnimation.HandsUp, effectAnimation: 76, mpCost: 1200, cooldownMs: 5000, type: 'debuff', basePower: 0, sound: 0 },
    // ── Control (stuns/blinds) ────────────────────────────────────
    'dall': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 42, mpCost: 200, cooldownMs: 2000, type: 'debuff', basePower: 0, sound: 0 },
    'suain': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 40, mpCost: 200, cooldownMs: 2000, type: 'debuff', basePower: 0, sound: 0 },
    'beag suain': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 41, mpCost: 100, cooldownMs: 1500, type: 'debuff', basePower: 0, sound: 0 },
    'pramh': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 32, mpCost: 300, cooldownMs: 3000, type: 'debuff', basePower: 0, sound: 0 },
    'beag pramh': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 32, mpCost: 150, cooldownMs: 2000, type: 'debuff', basePower: 0, sound: 0 },
    'mesmerize': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 117, mpCost: 300, cooldownMs: 3000, type: 'debuff', basePower: 0, sound: 0 },
    'puinsein': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 25, mpCost: 150, cooldownMs: 2000, type: 'debuff', basePower: 0, sound: 0 },
    'beag puinsein': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 25, mpCost: 75, cooldownMs: 1500, type: 'debuff', basePower: 0, sound: 0 },
    // ── Bard spells (PlayNotes animation) ─────────────────────────
    'cursed tune': { bodyAnimation: BodyAnimation.PlayNotes, effectAnimation: 295, mpCost: 200, cooldownMs: 5000, type: 'debuff', basePower: 0, sound: 0 },
    // ── Special / Misc ────────────────────────────────────────────
    'dragon\'s fire': { bodyAnimation: BodyAnimation.HandsUp, effectAnimation: 34, mpCost: 500, cooldownMs: 3000, type: 'damage', basePower: 3000, sound: 0 },
    'draco stance': { bodyAnimation: BodyAnimation.HandsUp, effectAnimation: 34, mpCost: 300, cooldownMs: 2000, type: 'buff', basePower: 0, sound: 0 },
    'draconic stance': { bodyAnimation: BodyAnimation.HandsUp, effectAnimation: 34, mpCost: 300, cooldownMs: 2000, type: 'buff', basePower: 0, sound: 0 },
    'regeneration': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 187, mpCost: 300, cooldownMs: 3000, type: 'buff', basePower: 0, sound: 8 },
    'counter attack': { bodyAnimation: BodyAnimation.HandsUp, effectAnimation: 184, mpCost: 200, cooldownMs: 2000, type: 'buff', basePower: 0, sound: 0 },
    'bubble block': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 247, mpCost: 200, cooldownMs: 2000, type: 'buff', basePower: 0, sound: 8 },
    'bubble shield': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 247, mpCost: 200, cooldownMs: 2000, type: 'buff', basePower: 0, sound: 8 },
    'lyliac plant': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 84, mpCost: 200, cooldownMs: 2000, type: 'heal', basePower: 1000, sound: 8 },
    'lyliac vineyard': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 84, mpCost: 400, cooldownMs: 3000, type: 'heal', basePower: 2000, sound: 8 },
    // ── Deo spells ────────────────────────────────────────────────
    'deo lamh': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 232, mpCost: 200, cooldownMs: 1000, type: 'damage', basePower: 800, sound: 0 },
    'deo saighead': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 232, mpCost: 300, cooldownMs: 1500, type: 'damage', basePower: 1200, sound: 0 },
    'deo searg': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 232, mpCost: 400, cooldownMs: 2000, type: 'damage', basePower: 1800, sound: 0 },
    'ard deo searg': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 232, mpCost: 800, cooldownMs: 3000, type: 'damage', basePower: 3500, sound: 0 },
    'deo searg gar': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 232, mpCost: 600, cooldownMs: 2500, type: 'damage', basePower: 2500, sound: 0 },
    'mor deo searg gar': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 232, mpCost: 1000, cooldownMs: 3000, type: 'damage', basePower: 4000, sound: 0 },
    // ── Misc spells ───────────────────────────────────────────────
    'fas spiorad': { bodyAnimation: BodyAnimation.HandsUp, effectAnimation: 273, mpCost: 200, cooldownMs: 2000, type: 'buff', basePower: 0, sound: 0 },
    'puinneag spiorad': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 232, mpCost: 100, cooldownMs: 1000, type: 'heal', basePower: 500, sound: 8 },
    'beag puinneag spiorad': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 232, mpCost: 50, cooldownMs: 1000, type: 'heal', basePower: 200, sound: 8 },
    'mor puinneag spiorad': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 232, mpCost: 200, cooldownMs: 1500, type: 'heal', basePower: 1000, sound: 8 },
    'ard puinneag spiorad': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 232, mpCost: 400, cooldownMs: 2000, type: 'heal', basePower: 2000, sound: 8 },
    'nuadhaich': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 232, mpCost: 200, cooldownMs: 1500, type: 'heal', basePower: 1500, sound: 8 },
    'nuadhiach le cheile': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 232, mpCost: 400, cooldownMs: 2000, type: 'heal', basePower: 3000, sound: 8 },
    'leigheas': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 232, mpCost: 500, cooldownMs: 2000, type: 'heal', basePower: 5000, sound: 8 },
    'spirit essence': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 232, mpCost: 300, cooldownMs: 2000, type: 'heal', basePower: 2000, sound: 8 },
    'unholy explosion': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 232, mpCost: 500, cooldownMs: 3000, type: 'damage', basePower: 3000, sound: 0 },
    'reflection': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 232, mpCost: 300, cooldownMs: 3000, type: 'buff', basePower: 0, sound: 8 },
    'deception of life': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 232, mpCost: 300, cooldownMs: 3000, type: 'buff', basePower: 0, sound: 8 },
    'disenchanter': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 232, mpCost: 200, cooldownMs: 2000, type: 'utility', basePower: 0, sound: 0 },
    'pian na dion': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 232, mpCost: 300, cooldownMs: 2000, type: 'buff', basePower: 0, sound: 8 },
    'mor pian na dion': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 232, mpCost: 500, cooldownMs: 3000, type: 'buff', basePower: 0, sound: 8 },
    'ard pian na dion': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 232, mpCost: 700, cooldownMs: 4000, type: 'buff', basePower: 0, sound: 8 },
    'mor strioch pian gar': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 254, mpCost: 600, cooldownMs: 3000, type: 'damage', basePower: 2500, sound: 0 },
    'mor strioch bais': { bodyAnimation: BodyAnimation.WizardCast, effectAnimation: 254, mpCost: 800, cooldownMs: 4000, type: 'damage', basePower: 4000, sound: 0 },
};
/**
 * Skill metadata table: skill name (lowercase) → full metadata.
 * Body animations from Chaos Server BodyAnimation enum, matched to skill type.
 */
const SKILL_META = {
    // ── Warrior skills ────────────────────────────────────────────
    'assault': { bodyAnimation: BodyAnimation.Swipe, effectAnimation: 254, cooldownMs: 1500, type: 'damage', basePower: 300, sound: 1 },
    'clobber': { bodyAnimation: BodyAnimation.HeavySwipe, effectAnimation: 254, cooldownMs: 2000, type: 'damage', basePower: 500, sound: 1 },
    'wallop': { bodyAnimation: BodyAnimation.HeavySwipe, effectAnimation: 254, cooldownMs: 2500, type: 'damage', basePower: 700, sound: 1 },
    'wind blade': { bodyAnimation: BodyAnimation.Swipe, effectAnimation: 254, cooldownMs: 2000, type: 'damage', basePower: 400, sound: 1 },
    'long strike': { bodyAnimation: BodyAnimation.HeavySwipe, effectAnimation: 254, cooldownMs: 2000, type: 'damage', basePower: 500, sound: 1 },
    'crasher': { bodyAnimation: BodyAnimation.JumpAttack, effectAnimation: 50, cooldownMs: 3000, type: 'damage', basePower: 1000, sound: 1 },
    'kelberoth strike': { bodyAnimation: BodyAnimation.HeavySwipe, effectAnimation: 48, cooldownMs: 5000, type: 'damage', basePower: 2000, sound: 1 },
    'execute': { bodyAnimation: BodyAnimation.HeavySwipe, effectAnimation: 97, cooldownMs: 5000, type: 'damage', basePower: 3000, sound: 1 },
    // ── Rogue skills ──────────────────────────────────────────────
    'stab': { bodyAnimation: BodyAnimation.Stab, effectAnimation: 254, cooldownMs: 1500, type: 'damage', basePower: 300, sound: 1 },
    'midnight slash': { bodyAnimation: BodyAnimation.DoubleStab, effectAnimation: 254, cooldownMs: 2000, type: 'damage', basePower: 500, sound: 1 },
    'mad soul': { bodyAnimation: BodyAnimation.DoubleStab, effectAnimation: 53, cooldownMs: 3000, type: 'damage', basePower: 800, sound: 1 },
    // ── Monk skills ───────────────────────────────────────────────
    'ambush': { bodyAnimation: BodyAnimation.Jump, effectAnimation: 254, cooldownMs: 15000, type: 'utility', basePower: 0, sound: 1 },
    'double punch': { bodyAnimation: BodyAnimation.Punch, effectAnimation: 254, cooldownMs: 2000, type: 'damage', basePower: 400, sound: 1 },
    'triple kick': { bodyAnimation: BodyAnimation.RoundHouseKick, effectAnimation: 254, cooldownMs: 2500, type: 'damage', basePower: 600, sound: 1 },
    'pounce': { bodyAnimation: BodyAnimation.Jump, effectAnimation: 254, cooldownMs: 2000, type: 'damage', basePower: 400, sound: 1 },
    'thrash': { bodyAnimation: BodyAnimation.RoundHouseKick, effectAnimation: 254, cooldownMs: 3000, type: 'damage', basePower: 800, sound: 1 },
    'throw': { bodyAnimation: BodyAnimation.Punch, effectAnimation: 19, cooldownMs: 15000, type: 'utility', basePower: 0, sound: 1 },
    // ── Warrior stance/utility skills ───────────────────────────────
    'charge': { bodyAnimation: BodyAnimation.Assail, effectAnimation: 254, cooldownMs: 3000, type: 'utility', basePower: 0, sound: 1 },
    'rush': { bodyAnimation: BodyAnimation.Assail, effectAnimation: 254, cooldownMs: 3000, type: 'utility', basePower: 0, sound: 1 },
    'rescue': { bodyAnimation: BodyAnimation.Jump, effectAnimation: 254, cooldownMs: 5000, type: 'utility', basePower: 0, sound: 1 },
    'taunt': { bodyAnimation: BodyAnimation.HandsUp, effectAnimation: 254, cooldownMs: 3000, type: 'utility', basePower: 0, sound: 1 },
    // ── Rogue utility skills ─────────────────────────────────────────
    'peek': { bodyAnimation: BodyAnimation.HandsUp, effectAnimation: 254, cooldownMs: 2000, type: 'utility', basePower: 0, sound: 1 },
    'stab and twist': { bodyAnimation: BodyAnimation.DoubleStab, effectAnimation: 254, cooldownMs: 2000, type: 'damage', basePower: 600, sound: 1 },
    'shadow strike': { bodyAnimation: BodyAnimation.Stab, effectAnimation: 53, cooldownMs: 3000, type: 'damage', basePower: 800, sound: 1 },
    // ── Misc / shared skills ──────────────────────────────────────
    'animal feast': { bodyAnimation: BodyAnimation.Assail, effectAnimation: 254, cooldownMs: 2000, type: 'damage', basePower: 500, sound: 1 },
    'mend': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 84, cooldownMs: 3000, type: 'utility', basePower: 0, sound: 8 },
    'lyliac plant': { bodyAnimation: BodyAnimation.PriestCast, effectAnimation: 84, cooldownMs: 3000, type: 'utility', basePower: 0, sound: 8 },
    'sense': { bodyAnimation: BodyAnimation.HandsUp, effectAnimation: 254, cooldownMs: 2000, type: 'utility', basePower: 0, sound: 1 },
};
/** Default metadata for unknown spells — uses HandsUp animation with generic effect */
const DEFAULT_SPELL_META = {
    bodyAnimation: BodyAnimation.HandsUp, effectAnimation: 232, mpCost: 100, cooldownMs: 1000,
    type: 'utility', basePower: 0, sound: 0,
};
/** Default metadata for unknown skills — uses Assail animation */
const DEFAULT_SKILL_META = {
    bodyAnimation: BodyAnimation.Assail, effectAnimation: 254, cooldownMs: 1000,
    type: 'damage', basePower: 100, sound: 1,
};
function initAfkMode(proxy, augmentation, automation, config) {
    const chat = augmentation.chat;
    const commands = augmentation.commands;
    // ── Viewport tracking ───────────────────────────────────────
    const visiblePlayers = new Map();
    function inRange(ax, ay, bx, by) {
        return Math.abs(ax - bx) < VIEW_RANGE && Math.abs(ay - by) < VIEW_RANGE;
    }
    function getVisibleSet(session) {
        let set = visiblePlayers.get(session.id);
        if (!set) {
            set = new Set();
            visiblePlayers.set(session.id, set);
        }
        return set;
    }
    function getOtherAfkSessions(session) {
        const others = [];
        for (const [, s] of proxy.sessions) {
            if (s === session || s.destroyed || !s.afkState?.active)
                continue;
            others.push(s);
        }
        return others;
    }
    // ── Packet builders ─────────────────────────────────────────
    function sendShowUserTo(target, source) {
        if (!source.lastSelfShowUser || !source.afkState)
            return;
        const pkt = new packet_1.default(0x33);
        pkt.body = [...source.lastSelfShowUser];
        pkt.body[0] = (source.afkState.shadowX >> 8) & 0xFF;
        pkt.body[1] = source.afkState.shadowX & 0xFF;
        pkt.body[2] = (source.afkState.shadowY >> 8) & 0xFF;
        pkt.body[3] = source.afkState.shadowY & 0xFF;
        proxy.sendToClient(target, pkt);
    }
    function sendRemoveEntityTo(target, serial) {
        const pkt = new packet_1.default(0x0E);
        pkt.writeUInt32(serial);
        proxy.sendToClient(target, pkt);
    }
    function sendEntityWalkTo(target, serial, prevX, prevY, direction) {
        const pkt = new packet_1.default(0x0C);
        pkt.writeUInt32(serial);
        pkt.writeUInt16(prevX);
        pkt.writeUInt16(prevY);
        pkt.writeByte(direction);
        proxy.sendToClient(target, pkt);
    }
    function sendAnimateEntity(target, entityId, animation, speed, sound) {
        // 0x1A format from real server: [Serial:4] [AnimationId:1] [0x00:1] [Speed:1] [Sound:1]
        // Speed is an animation-speed byte (lower = faster): 0x14=fast, 0x28=medium, 0x78=slow
        const pkt = new packet_1.default(0x1A);
        pkt.writeUInt32(entityId);
        pkt.writeByte(animation);
        pkt.writeByte(0x00);
        pkt.writeByte(speed);
        pkt.writeByte(sound);
        proxy.sendToClient(target, pkt);
    }
    function sendCooldown(target, abilityType, slot, seconds) {
        // 0x3F format from real server (7 bytes):
        // [Type:1] [Slot:1] [Seconds:4 (UInt32)] [Trailing:1=0x00]
        const pkt = new packet_1.default(0x3F);
        pkt.writeByte(abilityType);
        pkt.writeByte(slot);
        pkt.writeUInt32(seconds);
        pkt.writeByte(0);         // trailing byte
        proxy.sendToClient(target, pkt);
    }
    function sendShowEffect(target, targetId, sourceId, animation) {
        // 0x29 format from real server (15 bytes):
        // [TargetSerial:4] [SourceSerial:4] [Animation:2] [Unknown:2=0x0000] [Speed:2=0x0064] [Trailing:1=0x00]
        const pkt = new packet_1.default(0x29);
        pkt.writeUInt32(targetId);
        pkt.writeUInt32(sourceId);
        pkt.writeUInt16(animation);
        pkt.writeUInt16(0);       // unknown — always 0
        pkt.writeUInt16(100);     // speed — real server always sends 0x0064 (100)
        pkt.writeByte(0);         // trailing byte
        proxy.sendToClient(target, pkt);
    }
    /** Send 0x13 HpBar to a viewer */
    function sendHpBar(target, entitySerial, hpPercent, sound) {
        const pkt = new packet_1.default(0x13);
        pkt.writeUInt32(entitySerial);
        pkt.writeByte(Math.max(0, Math.min(100, Math.floor(hpPercent))));
        pkt.writeByte(sound);
        proxy.sendToClient(target, pkt);
    }
    /**
     * Send 0x08 Attributes (full stat update, flags=1) to update client's HP/MP display.
     * Format matches proxy-server.ts parsing at lines 1113-1128.
     */
    function sendStatsUpdate(session) {
        const ps = session.playerState;
        const afk = session.afkState;
        if (!afk)
            return;
        const pkt = new packet_1.default(0x08);
        pkt.writeByte(1); // flags = 1 (full stat update)
        pkt.writeByte(ps.level); // level
        pkt.writeByte(0); // ability
        pkt.writeUInt32(ps.maxHp); // maxHP
        pkt.writeUInt32(ps.maxMp); // maxMP
        pkt.writeByte(0); // STR
        pkt.writeByte(0); // INT
        pkt.writeByte(0); // WIS
        pkt.writeByte(0); // CON
        pkt.writeByte(0); // DEX
        pkt.writeByte(0); // available stat points
        pkt.writeByte(0); // stat points
        pkt.writeUInt32(afk.shadowHp); // current HP
        pkt.writeUInt32(afk.shadowMp); // current MP
        proxy.sendToClient(session, pkt);
    }
    /**
     * Broadcast a body animation to the caster and all AFK players who can see them.
     */
    function broadcastAnimation(session, animation, speed, sound) {
        const serial = session.playerState.serial;
        sendAnimateEntity(session, serial, animation, speed, sound);
        for (const other of getOtherAfkSessions(session)) {
            const otherVisible = visiblePlayers.get(other.id);
            if (otherVisible?.has(serial)) {
                sendAnimateEntity(other, serial, animation, speed, sound);
            }
        }
    }
    /**
     * Broadcast a spell effect (0x29 ShowEffect) to the caster and all AFK viewers.
     */
    function broadcastShowEffect(session, targetId, sourceId, animation) {
        sendShowEffect(session, targetId, sourceId, animation);
        for (const other of getOtherAfkSessions(session)) {
            const otherVisible = visiblePlayers.get(other.id);
            if (otherVisible?.has(sourceId)) {
                sendShowEffect(other, targetId, sourceId, animation);
            }
        }
    }
    /**
     * Broadcast HP bar update to all AFK players who can see the entity.
     */
    function broadcastHpBar(entitySerial, hpPercent, sound) {
        for (const [, s] of proxy.sessions) {
            if (s.destroyed || !s.afkState?.active)
                continue;
            const visible = visiblePlayers.get(s.id);
            if (visible?.has(entitySerial) || s.playerState.serial === entitySerial) {
                sendHpBar(s, entitySerial, hpPercent, sound);
            }
        }
    }
    /**
     * Find another AFK player by serial number.
     */
    function findAfkSessionBySerial(serial) {
        for (const [, s] of proxy.sessions) {
            if (s.destroyed || !s.afkState?.active)
                continue;
            if (s.playerState.serial === serial)
                return s;
        }
        return undefined;
    }
    /**
     * Find the AFK player standing in the tile directly ahead of the given session.
     */
    function findTargetAhead(session) {
        const state = session.afkState;
        if (!state)
            return undefined;
        // Get the last known direction from the player's cached 0x33 appearance
        // Direction is at byte offset 4 in the ShowUser body
        const dir = session.lastSelfShowUser ? session.lastSelfShowUser[4] : 0;
        const dx = dir === 1 ? 1 : dir === 3 ? -1 : 0;
        const dy = dir === 0 ? -1 : dir === 2 ? 1 : 0;
        const targetX = state.shadowX + dx;
        const targetY = state.shadowY + dy;
        for (const other of getOtherAfkSessions(session)) {
            if (!other.afkState)
                continue;
            if (other.afkState.shadowX === targetX && other.afkState.shadowY === targetY) {
                return other;
            }
        }
        return undefined;
    }
    /**
     * Apply damage to an AFK target (clamped at 1 HP — no death).
     */
    function applyDamage(target, damage, sound) {
        if (!target.afkState)
            return;
        target.afkState.shadowHp = Math.max(1, target.afkState.shadowHp - damage);
        const hpPercent = (target.afkState.shadowHp / target.playerState.maxHp) * 100;
        broadcastHpBar(target.playerState.serial, hpPercent, sound);
        sendStatsUpdate(target);
    }
    /**
     * Apply healing to an AFK target (capped at maxHP).
     */
    function applyHealing(target, amount, sound) {
        if (!target.afkState)
            return;
        target.afkState.shadowHp = Math.min(target.playerState.maxHp, target.afkState.shadowHp + amount);
        const hpPercent = (target.afkState.shadowHp / target.playerState.maxHp) * 100;
        broadcastHpBar(target.playerState.serial, hpPercent, sound);
        sendStatsUpdate(target);
    }
    // ── Visibility system ───────────────────────────────────────
    function refreshViewport(session) {
        if (!session.afkState?.active)
            return;
        const visible = getVisibleSet(session);
        const sx = session.afkState.shadowX;
        const sy = session.afkState.shadowY;
        visible.clear();
        for (const other of getOtherAfkSessions(session)) {
            if (!other.afkState)
                continue;
            if (inRange(sx, sy, other.afkState.shadowX, other.afkState.shadowY)) {
                sendShowUserTo(session, other);
                visible.add(other.playerState.serial);
            }
        }
    }
    function updateViewportAfterWalk(session) {
        if (!session.afkState?.active)
            return;
        const visible = getVisibleSet(session);
        const sx = session.afkState.shadowX;
        const sy = session.afkState.shadowY;
        for (const other of getOtherAfkSessions(session)) {
            if (!other.afkState)
                continue;
            const serial = other.playerState.serial;
            const isInRange = inRange(sx, sy, other.afkState.shadowX, other.afkState.shadowY);
            if (isInRange && !visible.has(serial)) {
                sendShowUserTo(session, other);
                visible.add(serial);
            }
            else if (!isInRange && visible.has(serial)) {
                sendRemoveEntityTo(session, serial);
                visible.delete(serial);
            }
        }
    }
    function removeFromAllViewports(session) {
        const serial = session.playerState.serial;
        for (const other of getOtherAfkSessions(session)) {
            const otherVisible = visiblePlayers.get(other.id);
            if (otherVisible?.has(serial)) {
                sendRemoveEntityTo(other, serial);
                otherVisible.delete(serial);
            }
        }
        visiblePlayers.delete(session.id);
    }
    // ── Helper: determine map dimensions ──────────────────────────
    function getAfkMapDimensions() {
        const mapInfo = proxy.getMapFileInfo(config.afkMapNumber);
        if (!mapInfo) {
            console.log(`[AfkMode] ERROR: Could not load map file for map ${config.afkMapNumber}`);
            return null;
        }
        let width = config.mapWidth || 0;
        let height = config.mapHeight || 0;
        if (!width || !height) {
            const totalTiles = mapInfo.data.length / 6;
            const side = Math.floor(Math.sqrt(totalTiles));
            width = side;
            height = side;
            console.log(`[AfkMode] Auto-detected map ${config.afkMapNumber} dimensions: ${width}x${height} (${totalTiles} tiles)`);
        }
        return { width, height, data: mapInfo.data };
    }
    // ── Enter AFK mode ────────────────────────────────────────────
    function enterAfkMode(session) {
        const mapData = getAfkMapDimensions();
        if (!mapData) {
            chat.systemMessage(session, 'AFK mode failed: could not load map file.');
            return;
        }
        const mapInfo = proxy.getMapFileInfo(config.afkMapNumber);
        // Save real state and initialize AFK state with all new fields
        session.afkState = {
            active: true,
            realX: session.playerState.x,
            realY: session.playerState.y,
            realMapNumber: session.playerState.mapNumber,
            realMapWidth: session.playerState.mapWidth,
            realMapHeight: session.playerState.mapHeight,
            shadowX: config.spawnX,
            shadowY: config.spawnY,
            afkMapNumber: config.afkMapNumber,
            afkMapWidth: mapData.width,
            afkMapHeight: mapData.height,
            chatToServer: true,
            // Throttle timestamps
            lastWalkTime: 0,
            lastSpellTime: 0,
            lastSkillTime: 0,
            lastAssailTime: 0,
            // Cooldown tracking
            spellCooldowns: new Map(),
            skillCooldowns: new Map(),
            // MP regen timer
            mpRegenTimer: null,
            // Shadow vitals (copy from real state)
            shadowHp: session.playerState.hp,
            shadowMp: session.playerState.mp,
        };
        // Start MP regeneration timer
        session.afkState.mpRegenTimer = setInterval(() => {
            if (!session.afkState?.active)
                return;
            const regenAmount = Math.floor(session.playerState.maxMp * MP_REGEN_PERCENT);
            if (regenAmount > 0 && session.afkState.shadowMp < session.playerState.maxMp) {
                session.afkState.shadowMp = Math.min(session.playerState.maxMp, session.afkState.shadowMp + regenAmount);
                sendStatsUpdate(session);
            }
        }, MP_REGEN_INTERVAL);
        // Build collision grid for AFK map
        const collision = automation.getCollision();
        collision.buildFromMapFile(config.afkMapNumber, mapData.width, mapData.height);
        // Build synthetic 0x15 MapInfo packet
        const mapInfoPacket = new packet_1.default(0x15);
        mapInfoPacket.writeUInt16(config.afkMapNumber);
        mapInfoPacket.writeByte(mapData.width & 0xFF);
        mapInfoPacket.writeByte(mapData.height & 0xFF);
        mapInfoPacket.writeByte(0);
        mapInfoPacket.writeByte((mapData.width >> 8) & 0xFF);
        mapInfoPacket.writeByte((mapData.height >> 8) & 0xFF);
        const invalidChecksum = mapInfo.checksum ^ 0xFFFF;
        mapInfoPacket.writeUInt16(invalidChecksum);
        mapInfoPacket.writeString8('Shadow Realm');
        proxy.sendToClient(session, mapInfoPacket);
        // Inject tile data from the map file
        proxy._injectMapTileData(session, mapData.data, mapData.width, mapData.height);
        // Send 0x04 MapLocation to position player at spawn
        const posPacket = new packet_1.default(0x04);
        posPacket.writeUInt16(config.spawnX);
        posPacket.writeUInt16(config.spawnY);
        proxy.sendToClient(session, posPacket);
        // Send 0x33 ShowUser to make player's own character visible
        if (session.lastSelfShowUser) {
            const showUserPacket = new packet_1.default(0x33);
            showUserPacket.body = [...session.lastSelfShowUser];
            showUserPacket.body[0] = (config.spawnX >> 8) & 0xFF;
            showUserPacket.body[1] = config.spawnX & 0xFF;
            showUserPacket.body[2] = (config.spawnY >> 8) & 0xFF;
            showUserPacket.body[3] = config.spawnY & 0xFF;
            proxy.sendToClient(session, showUserPacket);
        }
        // Send initial stats update with shadow HP/MP
        sendStatsUpdate(session);
        // Trigger virtual NPC refresh for the AFK map
        proxy.emit('player:refreshComplete', session);
        // Viewport: show other AFK players in range, and show self to them
        refreshViewport(session);
        for (const other of getOtherAfkSessions(session)) {
            if (!other.afkState)
                continue;
            if (inRange(other.afkState.shadowX, other.afkState.shadowY, config.spawnX, config.spawnY)) {
                sendShowUserTo(other, session);
                getVisibleSet(other).add(session.playerState.serial);
            }
        }
        console.log(`[AfkMode] ${session.characterName} entered AFK mode (real: map ${session.afkState.realMapNumber} @ ${session.afkState.realX},${session.afkState.realY})`);
        chat.systemMessage(session, 'AFK mode enabled. Chat is live.');
        chat.systemMessage(session, 'Type /afkchat to toggle chat mode.');
        chat.systemMessage(session, 'Type /afk to return.');
    }
    // ── Exit AFK mode ─────────────────────────────────────────────
    function exitAfkMode(session) {
        if (!session.afkState)
            return;
        const realMap = session.afkState.realMapNumber;
        // Clear MP regen timer
        if (session.afkState.mpRegenTimer) {
            clearInterval(session.afkState.mpRegenTimer);
            session.afkState.mpRegenTimer = null;
        }
        // Remove from all other AFK players' viewports
        removeFromAllViewports(session);
        session.afkState = null;
        // Clear cached map injection so the proxy re-injects substituted tiles
        // when the server responds with 0x15 after the refresh
        session.lastInjectedMap = null;
        // Flag refreshPending so the proxy fires player:refreshComplete when
        // the server responds with 0x58
        session.refreshPending = true;
        // Send 0x38 refresh to server — causes server to resend real map data
        const refreshPacket = new packet_1.default(0x38);
        proxy.sendToServer(session, refreshPacket);
        console.log(`[AfkMode] ${session.characterName} exited AFK mode (returning to map ${realMap})`);
        chat.systemMessage(session, 'AFK mode disabled. Welcome back.');
    }
    // ── Register /afk command ─────────────────────────────────────
    commands.register('afk', (session) => {
        if (session.afkState?.active) {
            exitAfkMode(session);
        }
        else {
            enterAfkMode(session);
        }
    }, 'Toggle AFK shadow mode');
    // ── Register /afkchat command ─────────────────────────────────
    commands.register('afkchat', (session) => {
        if (!session.afkState?.active) {
            chat.systemMessage(session, 'You are not in AFK mode.');
            return;
        }
        session.afkState.chatToServer = !session.afkState.chatToServer;
        if (session.afkState.chatToServer) {
            chat.systemMessage(session, 'Chat mode: LIVE (messages go to real server)');
        }
        else {
            chat.systemMessage(session, 'Chat mode: SILENT (messages blocked from server)');
        }
    }, 'Toggle AFK chat mode (live/silent)');
    // ── Walk simulation ───────────────────────────────────────────
    proxy.on('afk:walk', (session, direction) => {
        const state = session.afkState;
        if (!state?.active)
            return;
        // Throttle check
        const now = Date.now();
        if (now - state.lastWalkTime < WALK_THROTTLE)
            return;
        state.lastWalkTime = now;
        const prevX = state.shadowX;
        const prevY = state.shadowY;
        // Calculate new position
        const dx = direction === 1 ? 1 : direction === 3 ? -1 : 0;
        const dy = direction === 0 ? -1 : direction === 2 ? 1 : 0;
        const newX = prevX + dx;
        const newY = prevY + dy;
        // Bounds check
        if (newX < 0 || newX >= state.afkMapWidth || newY < 0 || newY >= state.afkMapHeight) {
            return;
        }
        // Collision check using ProxyCollision
        const collision = automation.getCollision();
        if (!collision.isWalkable(state.afkMapNumber, newX, newY)) {
            return;
        }
        // Player-occupancy check (can't walk onto another AFK player's tile)
        for (const other of getOtherAfkSessions(session)) {
            if (other.afkState && other.afkState.shadowX === newX && other.afkState.shadowY === newY) {
                return;
            }
        }
        // Send synthetic 0x0B WalkResponse to the walking player
        const walkResp = new packet_1.default(0x0B);
        walkResp.writeByte(direction);
        walkResp.writeUInt16(prevX);
        walkResp.writeUInt16(prevY);
        proxy.sendToClient(session, walkResp);
        // Update shadow position
        state.shadowX = newX;
        state.shadowY = newY;
        // Send 0x0C EntityWalk to all AFK players who can see this player
        for (const other of getOtherAfkSessions(session)) {
            const otherVisible = visiblePlayers.get(other.id);
            if (otherVisible?.has(session.playerState.serial)) {
                sendEntityWalkTo(other, session.playerState.serial, prevX, prevY, direction);
            }
        }
        // Update viewport for the walking player
        updateViewportAfterWalk(session);
        // Update all other AFK players' viewports relative to the walker
        for (const other of getOtherAfkSessions(session)) {
            if (!other.afkState)
                continue;
            const otherVisible = getVisibleSet(other);
            const isInRange = inRange(other.afkState.shadowX, other.afkState.shadowY, newX, newY);
            const serial = session.playerState.serial;
            if (isInRange && !otherVisible.has(serial)) {
                sendShowUserTo(other, session);
                otherVisible.add(serial);
            }
            else if (!isInRange && otherVisible.has(serial)) {
                sendRemoveEntityTo(other, serial);
                otherVisible.delete(serial);
            }
        }
    });
    // ── Turn simulation ──────────────────────────────────────────
    proxy.on('afk:turn', (session, direction) => {
        if (!session.afkState?.active)
            return;
        const serial = session.playerState.serial;
        // Send 0x11 EntityTurn to the turner
        const selfPkt = new packet_1.default(0x11);
        selfPkt.writeUInt32(serial);
        selfPkt.writeByte(direction);
        proxy.sendToClient(session, selfPkt);
        // Broadcast to all AFK players who can see this player
        for (const other of getOtherAfkSessions(session)) {
            const otherVisible = visiblePlayers.get(other.id);
            if (otherVisible?.has(serial)) {
                const pkt = new packet_1.default(0x11);
                pkt.writeUInt32(serial);
                pkt.writeByte(direction);
                proxy.sendToClient(other, pkt);
            }
        }
    });
    // ── Spell casting simulation ─────────────────────────────────
    proxy.on('afk:castSpell', (session, slot, body) => {
        const state = session.afkState;
        if (!state?.active)
            return;
        const now = Date.now();
        const serial = session.playerState.serial;
        // Global spell throttle
        if (now - state.lastSpellTime < SPELL_THROTTLE)
            return;
        // Look up spell info from spell book
        const auto = automation.getSession(session.id);
        const spell = auto?.caster.spells.get(slot);
        const spellName = spell?.name?.toLowerCase() ?? '';
        const spellType = spell?.spellType ?? SpellTargetType.NoTarget;
        // Look up spell metadata
        const meta = SPELL_META[spellName] ?? DEFAULT_SPELL_META;
        // Per-spell cooldown check
        const cooldownExpiry = state.spellCooldowns.get(slot) ?? 0;
        if (now < cooldownExpiry) {
            return;
        }
        // MP cost check
        if (state.shadowMp < meta.mpCost) {
            chat.systemMessage(session, 'Not enough mana.');
            return;
        }
        // Deduct MP
        state.shadowMp -= meta.mpCost;
        state.lastSpellTime = now;
        // Set cooldown
        state.spellCooldowns.set(slot, now + meta.cooldownMs);
        const cooldownSeconds = Math.ceil(meta.cooldownMs / 1000);
        sendCooldown(session, 0, slot, cooldownSeconds);
        // Send stats update (MP changed)
        sendStatsUpdate(session);
        // Broadcast body animation using the CORRECT per-spell animation
        // Speed 0x28 (40) matches real server spell cast speed
        broadcastAnimation(session, meta.bodyAnimation, 0x28, meta.sound);
        // Parse targeting data based on spell type
        let targetSerial;
        if (spellType === SpellTargetType.Targeted && body && body.length >= 5) {
            // body: [slot:1] [targetId:4] [targetX?:2] [targetY?:2]
            targetSerial = ((body[1] & 0xFF) << 24) | ((body[2] & 0xFF) << 16) |
                ((body[3] & 0xFF) << 8) | (body[4] & 0xFF);
        }
        // Determine the effect target
        const effectTargetId = targetSerial ?? serial;
        // Broadcast spell effect (0x29 ShowEffect)
        broadcastShowEffect(session, effectTargetId, serial, meta.effectAnimation);
        // Apply spell effects
        if (meta.type === 'damage' && meta.basePower > 0 && targetSerial) {
            const target = findAfkSessionBySerial(targetSerial);
            if (target && target.afkState?.active) {
                applyDamage(target, meta.basePower, meta.sound);
            }
        }
        else if (meta.type === 'heal' && meta.basePower > 0) {
            // Healing: if targeted, heal the target; otherwise heal self
            const healTarget = targetSerial ? findAfkSessionBySerial(targetSerial) : session;
            if (healTarget && healTarget.afkState?.active) {
                applyHealing(healTarget, meta.basePower, meta.sound);
            }
        }
    });
    // ── Skill usage simulation ──────────────────────────────────
    proxy.on('afk:useSkill', (session, slot) => {
        const state = session.afkState;
        if (!state?.active)
            return;
        const now = Date.now();
        const serial = session.playerState.serial;
        // Global skill throttle
        if (now - state.lastSkillTime < SKILL_THROTTLE)
            return;
        // Look up skill info
        const auto = automation.getSession(session.id);
        const skill = auto?.caster.skills.get(slot);
        const skillName = skill?.name?.toLowerCase() ?? '';
        // Look up skill metadata
        const meta = SKILL_META[skillName] ?? DEFAULT_SKILL_META;
        // Per-skill cooldown check
        const cooldownExpiry = state.skillCooldowns.get(slot) ?? 0;
        if (now < cooldownExpiry) {
            return;
        }
        state.lastSkillTime = now;
        // Set cooldown
        state.skillCooldowns.set(slot, now + meta.cooldownMs);
        const cooldownSeconds = Math.ceil(meta.cooldownMs / 1000);
        sendCooldown(session, 1, slot, cooldownSeconds);
        // Broadcast body animation using the CORRECT per-skill animation
        // Speed 0x14 (20) matches real server skill speed
        broadcastAnimation(session, meta.bodyAnimation, 0x14, meta.sound);
        // Broadcast skill effect (0x29 ShowEffect)
        broadcastShowEffect(session, serial, serial, meta.effectAnimation);
        // Apply melee damage to target in front
        if (meta.type === 'damage' && meta.basePower > 0) {
            const target = findTargetAhead(session);
            if (target && target.afkState?.active) {
                applyDamage(target, meta.basePower, meta.sound);
            }
        }
    });
    // ── Assail simulation ───────────────────────────────────────
    proxy.on('afk:assail', (session) => {
        const state = session.afkState;
        if (!state?.active)
            return;
        // Throttle
        const now = Date.now();
        if (now - state.lastAssailTime < ASSAIL_THROTTLE)
            return;
        state.lastAssailTime = now;
        // Broadcast Assail body animation — speed 0x14 matches real server assail
        broadcastAnimation(session, BodyAnimation.Assail, 0x14, 1);
        // Apply small melee damage to target ahead
        const target = findTargetAhead(session);
        if (target && target.afkState?.active) {
            applyDamage(target, 50, 1);
        }
    });
    // ── Proxy-only chat relay ─────────────────────────────────────
    proxy.on('afk:chat', (session, message) => {
        const serial = session.playerState.serial;
        const text = `${session.characterName}: ${message}`;
        for (const [, other] of proxy.sessions) {
            if (other.destroyed || other.phase !== 'game')
                continue;
            if (!other.afkState?.active)
                continue;
            const pkt = new packet_1.default(0x0D);
            pkt.writeByte(0);
            pkt.writeUInt32(serial);
            pkt.writeString8(text);
            proxy.sendToClient(other, pkt);
        }
    });
    // ── Server-initiated map change while AFK ─────────────────────
    proxy.on('afk:serverMapChange', (session) => {
        if (!session.afkState?.active)
            return;
        // Clear MP regen timer
        if (session.afkState.mpRegenTimer) {
            clearInterval(session.afkState.mpRegenTimer);
            session.afkState.mpRegenTimer = null;
        }
        console.log(`[AfkMode] ${session.characterName} AFK interrupted by server map change`);
        removeFromAllViewports(session);
        session.afkState = null;
        chat.systemMessage(session, 'AFK mode interrupted by server.');
    });
    // ── Session cleanup ───────────────────────────────────────────
    proxy.on('session:end', (session) => {
        if (session.afkState) {
            if (session.afkState.mpRegenTimer) {
                clearInterval(session.afkState.mpRegenTimer);
                session.afkState.mpRegenTimer = null;
            }
            removeFromAllViewports(session);
            session.afkState = null;
        }
        visiblePlayers.delete(session.id);
    });
    console.log(`[AfkMode] Initialized — map ${config.afkMapNumber}, spawn (${config.spawnX},${config.spawnY})`);
}
//# sourceMappingURL=afk-mode.js.map