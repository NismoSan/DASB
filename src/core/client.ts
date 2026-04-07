import net from 'net';
import EventEmitter from 'events';
import { getServerFromAddress, LoginServer, Server } from './server';
import Crypto, { isEncryptOpcode } from './crypto';
import { uint8, uint16, uint32 } from './datatypes';
import { calculateCRC16 } from './crc';
import { random } from './util';
import Packet from './packet';
import packetHandlers from './packet-handlers';
import type GameMap from './map';

export default class Client {
  appVersion: number;
  username: string;
  password: string;
  crypto: Crypto;
  startTime: number;
  encryptSequence: number;
  didSendVersion: boolean;
  logOutgoing: boolean;
  logIncoming: boolean;
  incomingBuffers: Buffer[];
  autoReconnect: boolean;
  _reconnecting: boolean;
  _reconnectAttempt: number;
  _reconnectTimer: ReturnType<typeof setTimeout> | null;
  _intentionalReconnect: boolean;
  _stopped: boolean;
  _lastAddress?: string;
  _lastPort?: number;
  events: EventEmitter;
  socket!: net.Socket;
  server?: Server;
  map?: GameMap;

  constructor(username: string, password: string) {
    this.appVersion = 741;
    this.username = username;
    this.password = password;
    this.crypto = new Crypto();
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
    this.events = new EventEmitter();
    this.events.on(0x00 as any, packetHandlers.encryption);
    this.events.on(0x02 as any, packetHandlers.loginMessage);
    this.events.on(0x03 as any, packetHandlers.redirect);
    this.events.on(0x05 as any, packetHandlers.userId);
    this.events.on(0x15 as any, packetHandlers.mapData);
    this.events.on(0x3B as any, packetHandlers.pingA);
    this.events.on(0x4C as any, packetHandlers.endingSignal);
    this.events.on(0x68 as any, packetHandlers.pingB);
    this.events.on(0x7E as any, packetHandlers.welcome);
  }

  tickCount(): number {
    return new Date().getTime() - this.startTime;
  }

  connect(address?: string, port?: number): Promise<void> {
    if (!address) {
      address = LoginServer.address;
      port = LoginServer.port;
    }

    this._lastAddress = address;
    this._lastPort = port;
    this.server = getServerFromAddress(address, port!);
    console.log(`Connecting to ${this.server!.name}...`);

    const socket = new net.Socket();
    socket.on('data', this.receive.bind(this));
    socket.on('close', () => {
      if (socket !== this.socket) return;
      if (this._intentionalReconnect || this._stopped) return;
      this._scheduleAutoReconnect();
    });
    socket.on('error', (err: Error) => {
      console.log(`Socket error: ${err.message}`);
    });

    return new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        socket.removeListener('error', onError);
        reject(err);
      };
      socket.on('error', onError);
      socket.connect(port!, address!, () => {
        socket.removeListener('error', onError);
        this.socket = socket;
        this._reconnecting = false;
        this._reconnectAttempt = 0;
        this._intentionalReconnect = false;
        resolve();
      });
    });
  }

  disconnect(socket: net.Socket = this.socket): void {
    if (socket) socket.destroy();
  }

  stop(): void {
    this._stopped = true;
    this._cancelAutoReconnect();
    this.disconnect();
  }

  reconnect(address?: string, port?: number): Promise<void> {
    this._intentionalReconnect = true;
    this._cancelAutoReconnect();
    this.disconnect();
    this.encryptSequence = 0;
    this.didSendVersion = false;
    return this.connect(address, port);
  }

  _getReconnectDelay(): number {
    const delays = [5000, 10000, 20000, 30000];
    return delays[Math.min(this._reconnectAttempt, delays.length - 1)];
  }

  _cancelAutoReconnect(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._reconnecting = false;
  }

  _scheduleAutoReconnect(): void {
    if (this._stopped) return;
    if (!this.autoReconnect) {
      console.log('Auto-reconnect is disabled.');
      this.events.emit('autoReconnectDisabled');
      return;
    }
    if (this._reconnecting) return;

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

      this.connect(LoginServer.address, LoginServer.port).then(() => {
        console.log('Reconnected successfully.');
      }).catch((err: Error) => {
        console.log(`Reconnect failed: ${err.message}`);
        this._scheduleAutoReconnect();
      });
    }, delay);
  }

  confirmIdentity(id: number): void {
    const x10 = new Packet(0x10);
    x10.writeByte(this.crypto.seed);
    x10.writeString8(this.crypto.key);
    x10.writeString8(this.crypto.name!);
    x10.writeUInt32(id);
    x10.writeByte(0x00);
    this.send(x10);
  }

  logIn(): void {
    console.log(`Logging in as ${this.username}...`);

    const key1 = random(0xFF);
    const key2 = random(0xFF);
    let clientId = random(0xFFFFFFFF);
    const clientIdKey = uint8(key2 + 138);

    const clientIdArray = [
      clientId & 0x0FF,
      (clientId >> 8) & 0x0FF,
      (clientId >> 16) & 0x0FF,
      (clientId >> 24) & 0x0FF
    ];

    const hash = calculateCRC16(clientIdArray, 0, 4);
    let clientIdChecksum = uint16(hash);
    const clientIdChecksumKey = uint8(key2 + 0x5E);

    clientIdChecksum ^= uint16(clientIdChecksumKey | ((clientIdChecksumKey + 1) << 8));
    clientId ^= uint32(
      clientIdKey |
      ((clientIdKey + 1) << 8) |
      ((clientIdKey + 2) << 16) |
      ((clientIdKey + 3) << 24)
    );

    let randomValue = random(0xFFFF);
    const randomValueKey = uint8(key2 + 115);
    randomValue ^= uint32(
      randomValueKey |
      ((randomValueKey + 1) << 8) |
      ((randomValueKey + 2) << 16) |
      ((randomValueKey + 3) << 24)
    );

    const x03 = new Packet(0x03);
    x03.writeString8(this.username);
    x03.writeString8(this.password);
    x03.writeByte(key1);
    x03.writeByte(uint8(key2 ^ (key1 + 59)));
    x03.writeUInt32(clientId);
    x03.writeUInt16(clientIdChecksum);
    x03.writeUInt32(randomValue);

    let crc = calculateCRC16(x03.body, this.username.length + this.password.length + 2, 12);
    const crcKey = uint8(key2 + 165);
    crc ^= uint16(crcKey | (crcKey + 1) << 8);

    x03.writeUInt16(crc);
    x03.writeUInt16(0x0100);
    this.send(x03);
  }

  send(packet: Packet): void {
    if (isEncryptOpcode(packet.opcode)) {
      packet.sequence = this.encryptSequence;
      this.encryptSequence = uint8(this.encryptSequence + 1);
    }

    if (this.logOutgoing) {
      console.log(`Sent: ${packet.toString()}`);
    }

    this.crypto.encrypt(packet);
    this.socket.write(packet.buffer());
  }

  receive(data: Buffer): void {
    this.incomingBuffers.push(data);
    let buffer = Buffer.concat(this.incomingBuffers.splice(0));

    while (buffer.length > 3 && buffer[0] === 0xAA) {
      const length = (buffer[1] << 8 | buffer[2]) + 3;

      if (length > buffer.length) {
        this.incomingBuffers.push(buffer);
        break;
      }

      const packetBuffer = Array.from(buffer.slice(0, length));
      const packet = new Packet(packetBuffer);
      this.crypto.decrypt(packet);

      if (this.logIncoming) {
        console.log(`Received: ${packet.toString()}`);
      }

      this.events.emit(packet.opcode as any, packet, this);

      buffer = buffer.slice(length);
    }
  }
}
