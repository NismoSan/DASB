import type ProxyServer from '../proxy-server';
import type ProxySession from '../proxy-session';
import type { VirtualNPC } from './npc-injector';
/**
 * Dialog types for 0x30 ShowDialog packet.
 * Per Arbiter: ServerShowDialogMessage / ServerShowDialogMenuMessage
 */
export declare enum DialogType {
    Popup = 0,
    Menu = 2,
    TextInput = 4,
    Speak = 5,
    CloseDialog = 10
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
/**
 * Handles dialog state for virtual NPC interactions.
 * Tracks per-session dialog state and builds 0x30 packets.
 */
export default class DialogHandler {
    private proxy;
    private activeDialogs;
    constructor(proxy: ProxyServer);
    /**
     * Called when a player clicks a virtual NPC (0x43 interact).
     * Opens the NPC's greeting dialog.
     */
    onNpcClick(session: ProxySession, npc: VirtualNPC): void;
    /**
     * Called when a player picks a menu option (0x39 DialogMenuChoice).
     */
    onMenuChoice(session: ProxySession, npc: VirtualNPC, slot: number): void;
    /**
     * Called when a player clicks next/previous in a dialog (0x3A DialogChoice).
     */
    onDialogChoice(session: ProxySession, npc: VirtualNPC, stepId: number): void;
    /**
     * Clear dialog state for a session (on disconnect/map change).
     */
    clearSession(sessionId: string): void;
    /**
     * Send a specific dialog step to the client.
     */
    private _sendStep;
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
    }): void;
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
    }): void;
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
    }): void;
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
    }): void;
    /**
     * Send a close dialog packet (0x30 type 0x0A).
     */
    sendCloseDialog(session: ProxySession, npc: VirtualNPC): void;
}
