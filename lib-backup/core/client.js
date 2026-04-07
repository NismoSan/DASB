"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const net_1 = __importDefault(require("net"));
const events_1 = __importDefault(require("events"));
const server_1 = require("./server");
const crypto_1 = __importStar(require("./crypto"));
const datatypes_1 = require("./datatypes");
const crc_1 = require("./crc");
const util_1 = require("./util");
const packet_1 = __importDefault(require("./packet"));
const packet_handlers_1 = __importDefault(require("./packet-handlers"));
class Client {
    appVersion;
    username;
    password;
    crypto;
    startTime;
    encryptSequence;
    didSendVersion;
    logOutgoing;
    logIncoming;
    incomingBuffers;
    autoReconnect;
    _reconnecting;
    _reconnectAttempt;
    _reconnectTimer;
    _intentionalReconnect;
    _stopped;
    _lastAddress;
    _lastPort;
    events;
    socket;
    server;
    map;
    constructor(username, password) {
        this.appVersion = 741;
        this.username = username;
        this.password = password;
        this.crypto = new crypto_1.default();
        this.startTime = new Date().getTime();
        this.encryptSequence = 0;
        this.didSendVersion = false;
        this.logOutgoing = false;
        this.logIncoming = false;
        this.incomingBuffers = [];
        this.autoReconnect = true;
        this._reconnecting = false;
        this._reconnectAttempt = 0;
        this._reconnectTimer = null;
        this._intentionalReconnect = false;
        this._stopped = false;
        this.events = new events_1.default();
        this.events.on(0x00, packet_handlers_1.default.encryption);
        this.events.on(0x02, packet_handlers_1.default.loginMessage);
        this.events.on(0x03, packet_handlers_1.default.redirect);
        this.events.on(0x05, packet_handlers_1.default.userId);
        this.events.on(0x15, packet_handlers_1.default.mapData);
        this.events.on(0x3B, packet_handlers_1.default.pingA);
        this.events.on(0x4C, packet_handlers_1.default.endingSignal);
        this.events.on(0x68, packet_handlers_1.default.pingB);
        this.events.on(0x7E, packet_handlers_1.default.welcome);
    }
    tickCount() {
        return new Date().getTime() - this.startTime;
    }
    connect(address, port) {
        if (!address) {
            address = server_1.LoginServer.address;
            port = server_1.LoginServer.port;
        }
        this._lastAddress = address;
        this._lastPort = port;
        this.server = (0, server_1.getServerFromAddress)(address, port);
        console.log(`Connecting to ${this.server.name}...`);
        const socket = new net_1.default.Socket();
        socket.on('data', this.receive.bind(this));
        socket.on('close', () => {
            if (socket !== this.socket)
                return;
            if (this._intentionalReconnect || this._stopped)
                return;
            this._scheduleAutoReconnect();
        });
        socket.on('error', (err) => {
            console.log(`Socket error: ${err.message}`);
        });
        return new Promise((resolve, reject) => {
            const onError = (err) => {
                socket.removeListener('error', onError);
                reject(err);
            };
            socket.on('error', onError);
            socket.connect(port, address, () => {
                socket.removeListener('error', onError);
                this.socket = socket;
                this._reconnecting = false;
                this._reconnectAttempt = 0;
                this._intentionalReconnect = false;
                resolve();
            });
        });
    }
    disconnect(socket = this.socket) {
        if (socket)
            socket.destroy();
    }
    stop() {
        this._stopped = true;
        this._cancelAutoReconnect();
        this.disconnect();
    }
    reconnect(address, port) {
        this._intentionalReconnect = true;
        this._cancelAutoReconnect();
        this.disconnect();
        this.encryptSequence = 0;
        this.didSendVersion = false;
        return this.connect(address, port);
    }
    _getReconnectDelay() {
        const delays = [5000, 10000, 20000, 30000];
        return delays[Math.min(this._reconnectAttempt, delays.length - 1)];
    }
    _cancelAutoReconnect() {
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        this._reconnecting = false;
    }
    _scheduleAutoReconnect() {
        if (this._stopped)
            return;
        if (!this.autoReconnect) {
            console.log('Auto-reconnect is disabled.');
            this.events.emit('autoReconnectDisabled');
            return;
        }
        if (this._reconnecting)
            return;
        this._reconnecting = true;
        this._reconnectAttempt++;
        const delay = this._getReconnectDelay();
        console.log(`Auto-reconnect attempt ${this._reconnectAttempt} in ${delay / 1000}s...`);
        this.events.emit('reconnecting', { attempt: this._reconnectAttempt, delay });
        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
            this._reconnecting = false;
            this.encryptSequence = 0;
            this.didSendVersion = false;
            this.connect(server_1.LoginServer.address, server_1.LoginServer.port).then(() => {
                console.log('Reconnected successfully.');
            }).catch((err) => {
                console.log(`Reconnect failed: ${err.message}`);
                this._scheduleAutoReconnect();
            });
        }, delay);
    }
    confirmIdentity(id) {
        const x10 = new packet_1.default(0x10);
        x10.writeByte(this.crypto.seed);
        x10.writeString8(this.crypto.key);
        x10.writeString8(this.crypto.name);
        x10.writeUInt32(id);
        x10.writeByte(0x00);
        this.send(x10);
    }
    logIn() {
        console.log(`Logging in as ${this.username}...`);
        const key1 = (0, util_1.random)(0xFF);
        const key2 = (0, util_1.random)(0xFF);
        let clientId = (0, util_1.random)(0xFFFFFFFF);
        const clientIdKey = (0, datatypes_1.uint8)(key2 + 138);
        const clientIdArray = [
            clientId & 0x0FF,
            (clientId >> 8) & 0x0FF,
            (clientId >> 16) & 0x0FF,
            (clientId >> 24) & 0x0FF
        ];
        const hash = (0, crc_1.calculateCRC16)(clientIdArray, 0, 4);
        let clientIdChecksum = (0, datatypes_1.uint16)(hash);
        const clientIdChecksumKey = (0, datatypes_1.uint8)(key2 + 0x5E);
        clientIdChecksum ^= (0, datatypes_1.uint16)(clientIdChecksumKey | ((clientIdChecksumKey + 1) << 8));
        clientId ^= (0, datatypes_1.uint32)(clientIdKey |
            ((clientIdKey + 1) << 8) |
            ((clientIdKey + 2) << 16) |
            ((clientIdKey + 3) << 24));
        let randomValue = (0, util_1.random)(0xFFFF);
        const randomValueKey = (0, datatypes_1.uint8)(key2 + 115);
        randomValue ^= (0, datatypes_1.uint32)(randomValueKey |
            ((randomValueKey + 1) << 8) |
            ((randomValueKey + 2) << 16) |
            ((randomValueKey + 3) << 24));
        const x03 = new packet_1.default(0x03);
        x03.writeString8(this.username);
        x03.writeString8(this.password);
        x03.writeByte(key1);
        x03.writeByte((0, datatypes_1.uint8)(key2 ^ (key1 + 59)));
        x03.writeUInt32(clientId);
        x03.writeUInt16(clientIdChecksum);
        x03.writeUInt32(randomValue);
        let crc = (0, crc_1.calculateCRC16)(x03.body, this.username.length + this.password.length + 2, 12);
        const crcKey = (0, datatypes_1.uint8)(key2 + 165);
        crc ^= (0, datatypes_1.uint16)(crcKey | (crcKey + 1) << 8);
        x03.writeUInt16(crc);
        x03.writeUInt16(0x0100);
        this.send(x03);
    }
    send(packet) {
        if ((0, crypto_1.isEncryptOpcode)(packet.opcode)) {
            packet.sequence = this.encryptSequence;
            this.encryptSequence = (0, datatypes_1.uint8)(this.encryptSequence + 1);
        }
        if (this.logOutgoing) {
            console.log(`Sent: ${packet.toString()}`);
        }
        this.crypto.encrypt(packet);
        this.socket.write(packet.buffer());
    }
    sendDialog(packet) {
        // Apply dialog sub-encryption header before standard send.
        // Required for opcodes 0x39 and 0x3A.
        const payload = packet.body.slice();
        const x = Math.floor(Math.random() * 256);
        const xPrime = Math.floor(Math.random() * 256);
        const y = (0, datatypes_1.uint8)(x + 0x72);
        const z = (0, datatypes_1.uint8)(x + 0x28);
        // Nexon CRC16 of payload
        const crc = (0, crc_1.calculateCRC16)(payload);
        // Plaintext: [CRC16_hi, CRC16_lo] + payload
        const plain = [(crc >> 8) & 0xFF, crc & 0xFF, ...payload];
        const dataLength = plain.length;
        // Encrypt CRC + payload with (z + i)
        const encrypted = plain.map((b, i) => (0, datatypes_1.uint8)(b ^ (0, datatypes_1.uint8)((z + i) & 0xFF)));
        // Encrypt length with y
        const lenHi = (0, datatypes_1.uint8)((dataLength >> 8) ^ y);
        const lenLo = (0, datatypes_1.uint8)((dataLength & 0xFF) ^ (0, datatypes_1.uint8)((y + 1) & 0xFF));
        // Encode header bytes
        const b0 = (0, datatypes_1.uint8)(xPrime + 0x2D);
        const b1 = (0, datatypes_1.uint8)(x ^ xPrime);
        // Replace body with dialog-encrypted version
        packet.body = [b0, b1, lenHi, lenLo, ...encrypted];
        this.send(packet);
    }
    receive(data) {
        this.incomingBuffers.push(data);
        let buffer = Buffer.concat(this.incomingBuffers.splice(0));
        while (buffer.length > 3 && buffer[0] === 0xAA) {
            const length = (buffer[1] << 8 | buffer[2]) + 3;
            if (length > buffer.length) {
                this.incomingBuffers.push(buffer);
                break;
            }
            const packetBuffer = Array.from(buffer.slice(0, length));
            const packet = new packet_1.default(packetBuffer);
            this.crypto.decrypt(packet);
            if (this.logIncoming) {
                console.log(`Received: ${packet.toString()}`);
            }
            this.events.emit(packet.opcode, packet, this);
            buffer = buffer.slice(length);
        }
    }
}
exports.default = Client;
//# sourceMappingURL=client.js.map