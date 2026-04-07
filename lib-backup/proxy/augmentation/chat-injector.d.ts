import type ProxyServer from '../proxy-server';
import type ProxySession from '../proxy-session';
/**
 * Chat channels for injection.
 *
 * Per Arbiter, server 0x0A WorldMessage types:
 *   0=Whisper, 1=BarMessage2, 2=BarMessage3, 3=BarMessage (system),
 *   5=WorldShout, 11=GroupChat, 12=GuildChat
 *
 * Server 0x0D PublicMessage types:
 *   0=Say, 1=Shout, 2=Chant
 */
export type ChatChannel = 'say' | 'shout' | 'chant' | 'system' | 'whisper' | 'world' | 'group' | 'guild';
export default class ChatInjector {
    private proxy;
    constructor(proxy: ProxyServer);
    /**
     * Send a chat message to a specific player.
     */
    sendChat(session: ProxySession, opts: {
        channel: ChatChannel;
        sender?: string;
        message: string;
    }): void;
    /**
     * Broadcast a chat message to all connected proxy sessions.
     */
    broadcast(opts: {
        channel: ChatChannel;
        sender?: string;
        message: string;
        broadcast?: boolean;
        mapNumber?: number;
    }): void;
    /**
     * Send a system bar message to a player.
     */
    systemMessage(session: ProxySession, message: string): void;
    /**
     * Broadcast a system message to all connected players.
     */
    systemBroadcast(message: string): void;
    /**
     * Send a 0x0A WorldMessage packet.
     *
     * Per Arbiter: ServerWorldMessageMessage
     *   [Type: Byte] [Message: String16]
     *
     * Types: 0=Whisper, 3=BarMessage(system), 5=WorldShout, 11=GroupChat, 12=GuildChat
     */
    private _sendWorldMessage;
    /**
     * Send a 0x0D PublicMessage packet.
     *
     * Per Arbiter: ServerPublicMessageMessage
     *   [Type: Byte] [SenderEntityId: UInt32] [Message: String8]
     *
     * Types: 0=Say, 1=Shout, 2=Chant
     */
    private _sendPublicMessage;
}
