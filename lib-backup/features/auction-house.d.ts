import Packet from '../core/packet';
import type ProxyServer from '../proxy/proxy-server';
import type ProxySession from '../proxy/proxy-session';
import type NpcInjector from '../proxy/augmentation/npc-injector';
import type { VirtualNPC } from '../proxy/augmentation/npc-injector';
import type DialogHandler from '../proxy/augmentation/dialog-handler';
type SendPacketFn = (packet: Packet) => void;
type SendWhisperFn = (target: string, message: string) => void;
type GetSerialByNameFn = (name: string) => number | undefined;
interface AuctionDeps {
    proxy: ProxyServer;
    npcInjector: NpcInjector;
    dialogHandler: DialogHandler;
    sendPacket: SendPacketFn;
    sendWhisper: SendWhisperFn;
    getSerialByName?: GetSerialByNameFn;
    getBotSerial: () => number;
    botCharacterName: string;
    /** Map number where the Auctioneer NPC is placed */
    npcMapNumber: number;
    npcX: number;
    npcY: number;
    npcSprite: number;
}
export declare const VIRTUAL_BOARD_ID = 65280;
export declare function init(d: AuctionDeps): void;
/**
 * Handle 0x3B ViewBoard for the virtual auction board.
 * Called from proxy event system when client requests board listing.
 */
export declare function handleViewBoard(session: ProxySession, boardId: number, startPostId: number): Promise<void>;
/**
 * Handle 0x3B ViewPost for the virtual auction board.
 * Called from proxy event system when client clicks a board post.
 */
export declare function handleViewPost(session: ProxySession, boardId: number, postId: number, _navigation: number): Promise<void>;
/**
 * Handle 0x42 Exchange packet on the bot session.
 * Subtypes: 0x00=Started, 0x02=ItemAdded, 0x03=GoldAdded, 0x04=Cancelled, 0x05=Accepted
 */
export declare function handleExchangeMessage(packet: Packet): void;
/**
 * Record a pending parcel intake. Called when a player sends a parcel to the bot.
 */
export declare function onParcelSent(senderName: string, subject: string): void;
/**
 * Handle 0x37 AddItem on the bot session. If there's a pending intake, create a listing.
 */
export declare function handleBotAddItem(packet: Packet): Promise<void>;
/**
 * Handle 0x38 RemoveItem on the bot session.
 */
export declare function handleBotRemoveItem(packet: Packet): void;
export declare function handleWhisper(senderName: string, message: string): Promise<void>;
export declare function onSessionEnd(sessionId: string): void;
export declare function handleAuctionCommand(session: ProxySession, _args: string[]): Promise<void>;
export declare function getAuctionNpcSerial(): number;
export declare function getNpc(): VirtualNPC | null;
/** Get all NPC serials currently assigned as auctioneers */
export declare function getAuctionNpcSerials(): number[];
/**
 * Check if a given NPC serial is an auctioneer.
 */
export declare function isAuctionNpc(serial: number): boolean;
/**
 * Attach the auction handler to an existing virtual NPC.
 * Supports multiple NPCs — each one becomes an independent auctioneer.
 */
export declare function assignToNpc(npc: VirtualNPC): void;
/**
 * Remove auction handler from an NPC.
 */
export declare function unassignFromNpc(serial: number): void;
export declare function isInitialized(): boolean;
export {};
