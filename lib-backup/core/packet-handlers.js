"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const datatypes_1 = require("./datatypes");
const server_1 = require("./server");
const crypto_1 = __importDefault(require("./crypto"));
const packet_1 = __importDefault(require("./packet"));
const handlers = {
    encryption(packet, client) {
        let code = packet.readByte();
        if (code === 1) {
            client.appVersion -= 1;
            console.log(`Invalid DA version, possibly too high. Trying again with ${client.appVersion}.`);
            client.reconnect();
            return;
        }
        else if (code === 2) {
            let version = packet.readInt16();
            packet.readByte();
            packet.readString8();
            client.appVersion = version;
            console.log(`Your DA version is too low. Setting DA version to ${version}.`);
            client.reconnect();
            return;
        }
        packet.readUInt32();
        const seed = packet.readByte();
        const key = packet.readString8();
        client.crypto = new crypto_1.default(seed, key);
        const x57 = new packet_1.default(0x57);
        x57.writeByte(0);
        x57.writeByte(0);
        x57.writeByte(0);
        client.send(x57);
    },
    loginMessage(packet, client) {
        const code = packet.readByte();
        const message = packet.readString8();
        switch (code) {
            case 0:
                break;
            case 3:
            case 14:
            case 15:
                console.log(`${message}.`);
                client.stop();
                break;
            default:
                console.log(message, `(code ${code})`);
                console.log('Log in failed. Retrying...');
                setTimeout(() => client.reconnect(), 1000);
        }
    },
    redirect(packet, client) {
        let address = packet.read(4);
        const port = packet.readUInt16();
        packet.readByte();
        const seed = packet.readByte();
        const key = packet.readString8();
        const name = packet.readString8();
        const id = packet.readUInt32();
        client.crypto = new crypto_1.default(seed, key, name);
        address.reverse();
        address = address.join('.');
        client.reconnect(address, port)
            .then(() => {
            client.confirmIdentity(id);
            if (client.server === server_1.LoginServer) {
                client.logIn();
            }
        });
    },
    userId(packet, client) {
        console.log(`Logged into ${client.server.name} as ${client.username}.`);
        client.send(new packet_1.default(0x2D));
    },
    pingA(packet, client) {
        const hiByte = packet.readByte();
        const loByte = packet.readByte();
        const x45 = new packet_1.default(0x45);
        x45.writeByte(loByte);
        x45.writeByte(hiByte);
        client.send(x45);
    },
    pingB(packet, client) {
        const timestamp = packet.readInt32();
        const x75 = new packet_1.default(0x75);
        x75.writeInt32(timestamp);
        x75.writeInt32((0, datatypes_1.int32)(client.tickCount()));
        client.send(x75);
    },
    endingSignal(_packet, client) {
        const x0B = new packet_1.default(0x0B);
        x0B.writeByte(0x00);
        client.send(x0B);
    },
    mapData(_packet, _client) {
        // Map tile data is loaded from local .map files, not from server packets.
        // The 0x15 packet is the map info header — not tile row data.
    },
    welcome(packet, client) {
        if (client.didSendVersion) {
            return;
        }
        const x62 = new packet_1.default(0x62);
        x62.writeByte(0x34);
        x62.writeByte(0x00);
        x62.writeByte(0x0A);
        x62.writeByte(0x88);
        x62.writeByte(0x6E);
        x62.writeByte(0x59);
        x62.writeByte(0x59);
        x62.writeByte(0x75);
        client.send(x62);
        const x00 = new packet_1.default(0x00);
        x00.writeInt16(client.appVersion);
        x00.writeByte(0x4C);
        x00.writeByte(0x4B);
        x00.writeByte(0x00);
        client.send(x00);
        client.didSendVersion = true;
    }
};
exports.default = handlers;
//# sourceMappingURL=packet-handlers.js.map