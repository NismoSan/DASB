"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const packet_1 = __importDefault(require("../../core/packet"));
class ChatInjector {
    proxy;
    constructor(proxy) {
        this.proxy = proxy;
    }
    /**
     * Send a chat message to a specific player.
     */
    sendChat(session, opts) {
        if (opts.channel === 'say' || opts.channel === 'shout' || opts.channel === 'chant') {
            this._sendPublicMessage(session, opts.channel, opts.sender || '', opts.message);
        }
        else {
            this._sendWorldMessage(session, opts.channel, opts.sender || '', opts.message);
        }
    }
    /**
     * Broadcast a chat message to all connected proxy sessions.
     */
    broadcast(opts) {
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
    systemMessage(session, message) {
        this.sendChat(session, { channel: 'system', message });
    }
    /**
     * Broadcast a system message to all connected players.
     */
    systemBroadcast(message) {
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
    _sendWorldMessage(session, channel, sender, message) {
        const typeMap = {
            whisper: 0,
            system: 3,
            world: 5,
            group: 11,
            guild: 12,
        };
        const pkt = new packet_1.default(0x0A);
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
    _sendPublicMessage(session, type, sender, message) {
        const typeMap = {
            say: 0,
            shout: 1,
            chant: 2,
        };
        const pkt = new packet_1.default(0x0D);
        pkt.writeByte(typeMap[type] ?? 0);
        pkt.writeUInt32(0); // sender entity ID (0 = system/anonymous)
        // Per Arbiter, 0x0D body is: [Type:1] [EntityId:4] [Message:String8]
        // The message includes the sender name in the format "Name: message" for say/shout
        const text = sender ? `${sender}: ${message}` : message;
        pkt.writeString8(text);
        this.proxy.sendToClient(session, pkt);
    }
}
exports.default = ChatInjector;
//# sourceMappingURL=chat-injector.js.map