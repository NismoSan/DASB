import Packet from '../../core/packet';
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
    private proxy: ProxyServer;

    constructor(proxy: ProxyServer) {
        this.proxy = proxy;
    }

    /**
     * Send a chat message to a specific player.
     */
    sendChat(session: ProxySession, opts: {
        channel: ChatChannel;
        sender?: string;
        message: string;
    }): void {
        if (opts.channel === 'say' || opts.channel === 'shout' || opts.channel === 'chant') {
            this._sendPublicMessage(session, opts.channel, 0, opts.sender || '', opts.message);
        }
        else {
            this._sendWorldMessage(session, opts.channel, opts.sender || '', opts.message);
        }
    }

    /**
     * Send a public chat message from an in-world entity such as a virtual NPC.
     */
    sendPublicChatFromEntity(session: ProxySession, opts: {
        channel: 'say' | 'shout' | 'chant';
        entityId: number;
        message: string;
    }): void {
        this._sendPublicMessage(session, opts.channel, opts.entityId, '', opts.message);
    }

    /**
     * Broadcast a chat message to all connected proxy sessions.
     */
    broadcast(opts: {
        channel: ChatChannel;
        sender?: string;
        message: string;
        broadcast?: boolean;
        mapNumber?: number;
    }): void {
        for (const session of this.proxy.sessions.values()) {
            if (session.destroyed)
                continue;
            if (opts.mapNumber !== undefined && session.playerState.mapNumber !== opts.mapNumber)
                continue;
            this.sendChat(session, opts);
        }
    }

    /**
     * Send a system bar message to a player.
     */
    systemMessage(session: ProxySession, message: string): void {
        this.sendChat(session, { channel: 'system', message });
    }

    /**
     * Broadcast a system message to all connected players.
     */
    systemBroadcast(message: string): void {
        this.broadcast({ channel: 'system', message });
    }

    /**
     * Send a 0x0A WorldMessage packet.
     *
     * Per Arbiter: ServerWorldMessageMessage
     *   [Type: Byte] [Message: String16]
     *
     * Types: 0=Whisper, 3=BarMessage(system), 5=WorldShout, 11=GroupChat, 12=GuildChat
     */
    private _sendWorldMessage(session: ProxySession, channel: string, sender: string, message: string): void {
        const typeMap: Record<string, number> = {
            whisper: 0,
            system: 3,
            world: 5,
            group: 11,
            guild: 12,
        };
        const pkt = new Packet(0x0A);
        pkt.writeByte(typeMap[channel] ?? 3);
        // Format message with sender if provided
        const text = sender ? `${sender}: ${message}` : message;
        pkt.writeString16(text);
        this.proxy.sendToClient(session, pkt);
    }

    /**
     * Send a 0x0D PublicMessage packet.
     *
     * Per Arbiter: ServerPublicMessageMessage
     *   [Type: Byte] [SenderEntityId: UInt32] [Message: String8]
     *
     * Types: 0=Say, 1=Shout, 2=Chant
     */
    private _sendPublicMessage(
        session: ProxySession,
        type: string,
        senderEntityId: number,
        sender: string,
        message: string,
    ): void {
        const typeMap: Record<string, number> = {
            say: 0,
            shout: 1,
            chant: 2,
        };
        const pkt = new Packet(0x0D);
        pkt.writeByte(typeMap[type] ?? 0);
        pkt.writeUInt32(senderEntityId);
        // Per Arbiter, 0x0D body is: [Type:1] [EntityId:4] [Message:String8]
        // The message includes the sender name in the format "Name: message" for say/shout
        const text = sender ? `${sender}: ${message}` : message;
        pkt.writeString8(text);
        this.proxy.sendToClient(session, pkt);
    }
}
