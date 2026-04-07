import Packet from '../../core/packet';
import type ProxyServer from '../proxy-server';
import type ProxySession from '../proxy-session';
import type { VirtualNPC } from './npc-injector';

/**
 * Dialog types for 0x30 ShowDialog packet.
 * Per Arbiter: ServerShowDialogMessage / ServerShowDialogMenuMessage
 */
export enum DialogType {
    Popup = 0,
    Menu = 2,
    TextInput = 4,
    Speak = 5,
    CloseDialog = 10,
}

export interface DialogOption {
    text: string;
    /** Action to take when this option is selected */
    action?: 'close' | 'goto';
    /** Step index to go to (for 'goto' action) */
    gotoStep?: number;
}

export interface DialogStep {
    type: 'popup' | 'menu';
    text: string;
    options?: DialogOption[];
    /** Automatically close after this step (no next button) */
    autoClose?: boolean;
}

export interface DialogConfig {
    greeting: string;
    steps: DialogStep[];
}

interface ActiveDialog {
    npcSerial: number;
    currentStep: number;
    pursuitId: number;
    reachedViaGoto: boolean;
}

/**
 * Handles dialog state for virtual NPC interactions.
 * Tracks per-session dialog state and builds 0x30 packets.
 */
export default class DialogHandler {
    private proxy: ProxyServer;
    private activeDialogs: Map<string, ActiveDialog>; // sessionId -> active dialog

    constructor(proxy: ProxyServer) {
        this.proxy = proxy;
        this.activeDialogs = new Map();
    }

    /**
     * Called when a player clicks a virtual NPC (0x43 interact).
     * Opens the NPC's greeting dialog.
     */
    onNpcClick(session: ProxySession, npc: VirtualNPC): void {
        const config = npc.dialog;
        if (!config) {
            // No dialog configured - send a simple popup with NPC name
            this.sendDialog(session, {
                type: DialogType.Popup,
                entityId: npc.serial,
                sprite: npc.sprite,
                name: npc.name,
                text: `${npc.name} has nothing to say.`,
                pursuitId: 0,
                stepId: 0,
                hasPrevious: false,
                hasNext: false,
            });
            return;
        }
        // Start dialog from step 0
        this.activeDialogs.set(session.id, {
            npcSerial: npc.serial,
            currentStep: 0,
            pursuitId: 1,
            reachedViaGoto: false,
        });
        this._sendStep(session, npc, 0);
    }

    /**
     * Called when a player picks a menu option (0x39 DialogMenuChoice).
     */
    onMenuChoice(session: ProxySession, npc: VirtualNPC, slot: number): void {
        const active = this.activeDialogs.get(session.id);
        if (!active || active.npcSerial !== npc.serial)
            return;
        const config = npc.dialog;
        if (!config)
            return;
        const step = config.steps[active.currentStep];
        if (!step || step.type !== 'menu' || !step.options)
            return;
        const option = step.options[slot];
        if (!option)
            return;
        if (option.action === 'close' || (!option.action && option.gotoStep === undefined)) {
            // Close dialog
            this.sendCloseDialog(session, npc);
            this.activeDialogs.delete(session.id);
        }
        else if (option.action === 'goto' && option.gotoStep !== undefined) {
            const nextStep = option.gotoStep;
            if (nextStep >= 0 && nextStep < config.steps.length) {
                active.currentStep = nextStep;
                active.reachedViaGoto = true;
                this._sendStep(session, npc, nextStep);
            }
            else {
                this.sendCloseDialog(session, npc);
                this.activeDialogs.delete(session.id);
            }
        }
    }

    /**
     * Called when a player clicks next/previous in a dialog (0x3A DialogChoice).
     */
    onDialogChoice(session: ProxySession, npc: VirtualNPC, stepId: number): void {
        const active = this.activeDialogs.get(session.id);
        if (!active || active.npcSerial !== npc.serial)
            return;
        const config = npc.dialog;
        if (!config)
            return;
        // If this step was reached via goto, don't auto-advance linearly — close instead
        if (active.reachedViaGoto) {
            this.sendCloseDialog(session, npc);
            this.activeDialogs.delete(session.id);
            return;
        }
        // Advance to the next step (linear navigation)
        const nextStep = active.currentStep + 1;
        if (nextStep >= config.steps.length) {
            // End of dialog
            this.sendCloseDialog(session, npc);
            this.activeDialogs.delete(session.id);
            return;
        }
        active.currentStep = nextStep;
        active.reachedViaGoto = false;
        this._sendStep(session, npc, nextStep);
    }

    /**
     * Clear dialog state for a session (on disconnect/map change).
     */
    clearSession(sessionId: string): void {
        this.activeDialogs.delete(sessionId);
    }

    /**
     * Send a specific dialog step to the client.
     */
    private _sendStep(session: ProxySession, npc: VirtualNPC, stepIndex: number): void {
        const config = npc.dialog!;
        const step = config.steps[stepIndex];
        if (!step)
            return;
        const active = this.activeDialogs.get(session.id);
        const reachedViaGoto = active?.reachedViaGoto ?? false;
        const isFirst = stepIndex === 0;
        const isLast = stepIndex === config.steps.length - 1;
        if (step.type === 'menu') {
            this.sendDialog(session, {
                type: DialogType.Menu,
                entityId: npc.serial,
                sprite: npc.sprite,
                name: npc.name,
                text: step.text,
                pursuitId: 1,
                stepId: stepIndex,
                hasPrevious: false,
                hasNext: false,
                options: step.options?.map(o => o.text) || [],
            });
        }
        else {
            // popup — don't show next/prev if this step was reached via goto (branch target)
            this.sendDialog(session, {
                type: DialogType.Popup,
                entityId: npc.serial,
                sprite: npc.sprite,
                name: npc.name,
                text: step.text,
                pursuitId: 1,
                stepId: stepIndex,
                hasPrevious: !reachedViaGoto && !isFirst,
                hasNext: !reachedViaGoto && !isLast && !step.autoClose,
            });
        }
    }

    /**
     * Build and send a 0x30 ShowDialog packet.
     *
     * Per Arbiter ServerShowDialogMessage:
     *   [DialogType: u8]
     *   [EntityType: u8]  (0x01 = Creature)
     *   [EntityId: u32]
     *   [Unknown1: u8 = 0x01]
     *   [Sprite: u16]
     *   [Color: u8 = 0]
     *   [Unknown2: u8 = 0]
     *   [SpriteSecondary: u16 = 0]
     *   [ColorSecondary: u8 = 0]
     *   [ShowGraphic: u8 = 0]  (0=show, 1=hide)
     *   [PursuitId: u16]
     *   [StepId: u16]
     *   [HasPrevious: u8]
     *   [HasNext: u8]
     *   [Name: String8]
     *   [Content: String16]
     *   If Menu: [OptionCount: u8] then [Option: String8] per option
     */
    sendDialog(session: ProxySession, opts: {
        type: DialogType;
        entityId: number;
        sprite: number;
        name: string;
        text: string;
        pursuitId: number;
        stepId: number;
        hasPrevious: boolean;
        hasNext: boolean;
        options?: string[];
    }): void {
        const pkt = new Packet(0x30);
        pkt.writeByte(opts.type); // DialogType
        pkt.writeByte(0x01); // EntityType = Creature
        pkt.writeUInt32(opts.entityId); // EntityId
        pkt.writeByte(0x01); // Unknown1
        pkt.writeUInt16(opts.sprite); // Sprite
        pkt.writeByte(0); // Color
        pkt.writeByte(0); // Unknown2
        pkt.writeUInt16(0); // SpriteSecondary
        pkt.writeByte(0); // ColorSecondary
        pkt.writeUInt16(opts.pursuitId); // PursuitId
        pkt.writeUInt16(opts.stepId); // StepId
        pkt.writeByte(opts.hasPrevious ? 1 : 0); // HasPrevious
        pkt.writeByte(opts.hasNext ? 1 : 0); // HasNext
        pkt.writeByte(0); // ShowGraphic (0 = show)
        pkt.writeString8(opts.name); // Name
        pkt.writeString16(opts.text); // Content
        // Menu options
        if (opts.type === DialogType.Menu && opts.options) {
            pkt.writeByte(opts.options.length);
            for (const option of opts.options) {
                pkt.writeString8(option);
            }
        }
        this.proxy.sendToClient(session, pkt);
        console.log(`[Dialog] Sent 0x30 ${DialogType[opts.type]} to ${session.characterName} (npc=${opts.entityId}): "${opts.text.substring(0, 50)}..."`);
    }

    /**
     * Build and send a 0x2F ShowDialogMenu packet.
     * Supports MenuType 0 (Menu with pursuit IDs) and MenuType 4 (ItemChoices).
     *
     * For MenuType 0 (Menu), options are { text, pursuitId }.
     * For MenuType 4 (ItemChoices), items are { sprite, color, quantity, name }.
     */
    sendDialogMenu(session: ProxySession, opts: {
        menuType: number;
        entityId: number;
        sprite: number;
        name: string;
        text: string;
        menuOptions?: {
            text: string;
            pursuitId: number;
        }[];
        items?: {
            sprite: number;
            color: number;
            quantity: number;
            name: string;
        }[];
    }): void {
        const pkt = new Packet(0x2F);
        pkt.writeByte(opts.menuType); // MenuType
        pkt.writeByte(0x01); // EntityType = Creature
        pkt.writeUInt32(opts.entityId); // EntityId
        pkt.writeByte(0x01); // Unknown1
        pkt.writeUInt16(opts.sprite); // SpritePrimary
        pkt.writeByte(0); // Color
        pkt.writeByte(0x01); // Unknown2
        pkt.writeUInt16(opts.sprite); // SpriteSecondary (same as primary)
        pkt.writeByte(0); // ColorSecondary
        pkt.writeByte(0); // ShowGraphic (0=show)
        pkt.writeString8(opts.name); // NPC Name
        pkt.writeString16(opts.text); // Content
        if (opts.menuType === 0 && opts.menuOptions) {
            // MenuType 0: Menu with pursuit IDs
            // Format: [count:1] per option: [label:String8] [00] [pursuitId:1]
            pkt.writeByte(opts.menuOptions.length);
            for (const opt of opts.menuOptions) {
                pkt.writeString8(opt.text);
                pkt.writeByte(0x00);
                pkt.writeByte(opt.pursuitId & 0xFF);
            }
        }
        else if (opts.menuType === 4 && opts.items) {
            // MenuType 4: ItemChoices (bank-style item list with sprites)
            // Format: [unknown:2=0x0056?] [itemCount:2]
            // Per item: [sprite:2] [color:1] [pad:3=000000] [quantity:1] [name:String8] [trailing:2=0120]
            pkt.writeUInt16(0x0056); // Unknown section marker (observed in captures)
            pkt.writeUInt16(opts.items.length);
            for (const item of opts.items) {
                pkt.writeUInt16(item.sprite | 0x8000); // Item sprite with 0x8000 flag
                pkt.writeByte(item.color & 0xFF); // Color/dye
                pkt.writeByte(0);
                pkt.writeByte(0);
                pkt.writeByte(0); // Padding
                pkt.writeByte(item.quantity & 0xFF); // Quantity
                pkt.writeString8(item.name); // Item name
                pkt.writeByte(0x01); // Trailing byte 1
                pkt.writeByte(0x20); // Trailing byte 2
            }
        }
        this.proxy.sendToClient(session, pkt);
        console.log(`[Dialog] Sent 0x2F MenuType=${opts.menuType} to ${session.characterName} (npc=0x${opts.entityId.toString(16)}): "${opts.text.substring(0, 50)}..."`);
    }

    /**
     * Build and send a 0x31 BoardResult packet with post listings (ResultType 2).
     * Used for virtual bulletin boards like the Auction House listing board.
     */
    sendBoard(session: ProxySession, opts: {
        boardId: number;
        boardName: string;
        posts: {
            postId: number;
            author: string;
            month: number;
            day: number;
            subject: string;
        }[];
    }): void {
        const pkt = new Packet(0x31);
        pkt.writeByte(0x02); // ResultType = Board
        pkt.writeByte(0x01); // Unknown
        pkt.writeUInt16(opts.boardId);
        pkt.writeString8(opts.boardName);
        pkt.writeByte(opts.posts.length);
        for (const post of opts.posts) {
            pkt.writeByte(0x00); // Flags
            pkt.writeUInt16(post.postId);
            pkt.writeString8(post.author);
            pkt.writeByte(post.month);
            pkt.writeByte(post.day);
            pkt.writeString8(post.subject);
        }
        this.proxy.sendToClient(session, pkt);
        console.log(`[Dialog] Sent 0x31 Board "${opts.boardName}" (${opts.posts.length} posts) to ${session.characterName}`);
    }

    /**
     * Build and send a 0x31 BoardResult packet with post content (ResultType 3).
     */
    sendPost(session: ProxySession, opts: {
        postId: number;
        author: string;
        month: number;
        day: number;
        subject: string;
        body: string;
    }): void {
        const pkt = new Packet(0x31);
        pkt.writeByte(0x03); // ResultType = Post
        pkt.writeByte(0x01); // Unknown
        pkt.writeByte(0x00); // Unknown (flags?)
        pkt.writeUInt16(opts.postId);
        pkt.writeString8(opts.author);
        pkt.writeByte(opts.month);
        pkt.writeByte(opts.day);
        pkt.writeString8(opts.subject);
        pkt.writeString16(opts.body);
        this.proxy.sendToClient(session, pkt);
        console.log(`[Dialog] Sent 0x31 Post #${opts.postId} to ${session.characterName}: "${opts.subject}"`);
    }

    /**
     * Send a close dialog packet (0x30 type 0x0A).
     */
    sendCloseDialog(session: ProxySession, npc: VirtualNPC): void {
        const pkt = new Packet(0x30);
        pkt.writeByte(DialogType.CloseDialog); // CloseDialog
        pkt.writeByte(0x01); // EntityType = Creature
        pkt.writeUInt32(npc.serial);
        pkt.writeByte(0x00);
        this.proxy.sendToClient(session, pkt);
        console.log(`[Dialog] Sent CloseDialog to ${session.characterName}`);
    }
}
