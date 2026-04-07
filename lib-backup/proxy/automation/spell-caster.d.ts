import type ProxyServer from '../proxy-server';
import type ProxySession from '../proxy-session';
export interface SpellInfo {
    slot: number;
    name: string;
    icon: number;
    castLines: number;
    /** SpellTargetType: 0=None, 1=Prompt, 2=Targeted, 5=NoTarget */
    spellType: number;
}
export interface SkillInfo {
    slot: number;
    name: string;
    icon: number;
}
/**
 * Tracks the player's spell/skill books and provides casting by name.
 * Spell book is built from 0x17 AddSpell / 0x18 RemoveSpell packets.
 * Skill book is built from 0x2C AddSkill / 0x2D RemoveSkill packets.
 */
export default class SpellCaster {
    private proxy;
    private session;
    spells: Map<number, SpellInfo>;
    skills: Map<number, SkillInfo>;
    constructor(proxy: ProxyServer, session: ProxySession);
    /**
     * Called when proxy decrypts 0x17 AddSpell from server.
     * Format: [Slot:u8] [Icon:u16] [Type:u8] [Name:String8] [Prompt:String8] [CastLines:u8]
     */
    onAddSpell(body: number[]): void;
    /**
     * Called when proxy decrypts 0x18 RemoveSpell from server.
     * Format: [Slot:u8]
     */
    onRemoveSpell(slot: number): void;
    /**
     * Called when proxy decrypts 0x2C AddSkill from server.
     * Format: [Slot:u8] [Icon:u16] [Name:String8]
     */
    onAddSkill(body: number[]): void;
    /**
     * Called when proxy decrypts 0x2D RemoveSkill from server.
     * Format: [Slot:u8]
     */
    onRemoveSkill(slot: number): void;
    /**
     * Find a spell by name (case-insensitive partial match).
     */
    findSpell(name: string): SpellInfo | undefined;
    /**
     * Find a skill by name (case-insensitive partial match).
     */
    findSkill(name: string): SkillInfo | undefined;
    /**
     * Cast a spell by slot number.
     * Sends: 0x4D (BeginChant) -> 0x4E (Chant) per line -> 0x0F (CastSpell)
     */
    castSpellBySlot(slot: number, targetSerial?: number): void;
    /**
     * Cast a spell by name.
     */
    castSpell(name: string, targetSerial?: number): boolean;
    /**
     * Use a skill by slot number.
     * Sends: 0x3E (UseSkill)
     */
    useSkillBySlot(slot: number): void;
    /**
     * Use a skill by name.
     */
    useSkill(name: string): boolean;
    /**
     * List all known spells.
     */
    listSpells(): SpellInfo[];
    /**
     * List all known skills.
     */
    listSkills(): SkillInfo[];
    /**
     * Clear all tracked spells and skills (on disconnect/map change if needed).
     */
    clear(): void;
}
