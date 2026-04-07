import Packet from './packet';
import type Client from './client';
declare const handlers: {
    encryption(packet: Packet, client: Client): void;
    loginMessage(packet: Packet, client: Client): void;
    redirect(packet: Packet, client: Client): void;
    userId(packet: Packet, client: Client): void;
    pingA(packet: Packet, client: Client): void;
    pingB(packet: Packet, client: Client): void;
    endingSignal(_packet: Packet, client: Client): void;
    mapData(_packet: Packet, _client: Client): void;
    welcome(packet: Packet, client: Client): void;
};
export default handlers;
