import Packet from '../../core/packet';
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
    private proxy: ProxyServer;
    private session: ProxySession;
    spells: Map<number, SpellInfo> = new Map(); // slot -> SpellInfo
    skills: Map<number, SkillInfo> = new Map(); // slot -> SkillInfo

    constructor(proxy: ProxyServer, session: ProxySession) {
        this.proxy = proxy;
        this.session = session;
    }

    // --- Spell Book Tracking ---

    /**
     * Called when proxy decrypts 0x17 AddSpell from server.
     * Format: [Slot:u8] [Icon:u16] [Type:u8] [Name:String8] [Prompt:String8] [CastLines:u8]
     */
    onAddSpell(body: number[]): void {
        if (body.length < 5) return;
        const pkt = new Packet(0x17);
        pkt.body = [...body];
        pkt.position = 0;
        const slot = pkt.readByte();
        const icon = pkt.readUInt16();
        const spellType = pkt.readByte();
        const name = pkt.readString8();
        const _prompt = pkt.readString8();
        const castLines = pkt.readByte();
        this.spells.set(slot, { slot, name, icon, castLines, spellType });
        console.log(`[SpellCaster] ${this.session.characterName} spell added: slot=${slot} "${name}" type=${spellType} lines=${castLines}`);
    }

    /**
     * Called when proxy decrypts 0x18 RemoveSpell from server.
     * Format: [Slot:u8]
     */
    onRemoveSpell(slot: number): void {
        const spell = this.spells.get(slot);
        if (spell) {
            console.log(`[SpellCaster] ${this.session.characterName} spell removed: slot=${slot} "${spell.name}"`);
            this.spells.delete(slot);
        }
    }

    // --- Skill Book Tracking ---

    /**
     * Called when proxy decrypts 0x2C AddSkill from server.
     * Format: [Slot:u8] [Icon:u16] [Name:String8]
     */
    onAddSkill(body: number[]): void {
        if (body.length < 4) return;
        const pkt = new Packet(0x2C);
        pkt.body = [...body];
        pkt.position = 0;
        const slot = pkt.readByte();
        const icon = pkt.readUInt16();
        const name = pkt.readString8();
        this.skills.set(slot, { slot, name, icon });
        console.log(`[SpellCaster] ${this.session.characterName} skill added: slot=${slot} "${name}"`);
    }

    /**
     * Called when proxy decrypts 0x2D RemoveSkill from server.
     * Format: [Slot:u8]
     */
    onRemoveSkill(slot: number): void {
        const skill = this.skills.get(slot);
        if (skill) {
            console.log(`[SpellCaster] ${this.session.characterName} skill removed: slot=${slot} "${skill.name}"`);
            this.skills.delete(slot);
        }
    }

    // --- Casting ---

    /**
     * Find a spell by name (case-insensitive partial match).
     */
    findSpell(name: string): SpellInfo | undefined {
        const lower = name.toLowerCase();
        for (const spell of this.spells.values()) {
            if (spell.name.toLowerCase() === lower) return spell;
        }
        // Partial match fallback
        for (const spell of this.spells.values()) {
            if (spell.name.toLowerCase().includes(lower)) return spell;
        }
        return undefined;
    }

    /**
     * Find a skill by name (case-insensitive partial match).
     */
    findSkill(name: string): SkillInfo | undefined {
        const lower = name.toLowerCase();
        for (const skill of this.skills.values()) {
            if (skill.name.toLowerCase() === lower) return skill;
        }
        for (const skill of this.skills.values()) {
            if (skill.name.toLowerCase().includes(lower)) return skill;
        }
        return undefined;
    }

    /**
     * Cast a spell by slot number.
     * Sends: 0x4D (BeginChant) -> 0x4E (Chant) per line -> 0x0F (CastSpell)
     */
    castSpellBySlot(slot: number, targetSerial?: number): void {
        const spell = this.spells.get(slot);
        // Begin chant
        if (spell && spell.castLines > 0) {
            const beginPkt = new Packet(0x4D);
            beginPkt.writeByte(spell.castLines);
            this.proxy.sendToServer(this.session, beginPkt);
            // Send empty chant lines
            for (let i = 0; i < spell.castLines; i++) {
                const chantPkt = new Packet(0x4E);
                chantPkt.writeString8('');
                this.proxy.sendToServer(this.session, chantPkt);
            }
        }
        // Cast spell
        const castPkt = new Packet(0x0F);
        castPkt.writeByte(slot);
        if (targetSerial !== undefined) {
            castPkt.writeUInt32(targetSerial);
        }
        this.proxy.sendToServer(this.session, castPkt);
    }

    /**
     * Cast a spell by name.
     */
    castSpell(name: string, targetSerial?: number): boolean {
        const spell = this.findSpell(name);
        if (!spell) return false;
        this.castSpellBySlot(spell.slot, targetSerial);
        return true;
    }

    /**
     * Use a skill by slot number.
     * Sends: 0x3E (UseSkill)
     */
    useSkillBySlot(slot: number): void {
        const pkt = new Packet(0x3E);
        pkt.writeByte(slot);
        this.proxy.sendToServer(this.session, pkt);
    }

    /**
     * Use a skill by name.
     */
    useSkill(name: string): boolean {
        const skill = this.findSkill(name);
        if (!skill) return false;
        this.useSkillBySlot(skill.slot);
        return true;
    }

    /**
     * List all known spells.
     */
    listSpells(): SpellInfo[] {
        return Array.from(this.spells.values()).sort((a, b) => a.slot - b.slot);
    }

    /**
     * List all known skills.
     */
    listSkills(): SkillInfo[] {
        return Array.from(this.skills.values()).sort((a, b) => a.slot - b.slot);
    }

    /**
     * Clear all tracked spells and skills (on disconnect/map change if needed).
     */
    clear(): void {
        this.spells.clear();
        this.skills.clear();
    }
}
