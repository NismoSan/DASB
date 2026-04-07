"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;
var _datatypes = require("./datatypes");
var _server = require("./server");
var _crypto = _interopRequireDefault(require("./crypto"));
var _packet = _interopRequireDefault(require("./packet"));
var _map = _interopRequireDefault(require("./map"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { "default": e }; }
var _default = exports["default"] = {
  encryption: function encryption(packet, client) {
    var code = packet.readByte();
    if (code === 1) {
      client.appVersion -= 1;
      console.log("Invalid DA version, possibly too high. Trying again with ".concat(client.appVersion, "."));
      client.reconnect();
      return;
    } else if (code === 2) {
      var version = packet.readInt16();
      packet.readByte();
      packet.readString8(); // patch url
      client.appVersion = version;
      console.log("Your DA version is too low. Setting DA version to ".concat(version, "."));
      client.reconnect();
      return;
    }
    packet.readUInt32(); // server table crc
    var seed = packet.readByte();
    var key = packet.readString8();
    client.crypto = new _crypto["default"](seed, key);
    var x57 = new _packet["default"](0x57);
    x57.writeByte(0);
    x57.writeByte(0);
    x57.writeByte(0);
    client.send(x57);
  },
  loginMessage: function loginMessage(packet, client) {
    var code = packet.readByte();
    var message = packet.readString8();
    switch (code) {
      case 0:
        // Success
        break;
      case 3: // Invalid name or password
      case 14: // Name does not exist
      case 15:
        // Incorrect password
        console.log("".concat(message, "."));
        client.stop();
        break;
      default:
        console.log(message, "(code ".concat(code, ")"));
        console.log('Log in failed. Retrying...');
        setTimeout(function () {
          return client.reconnect();
        }, 1000);
    }
  },
  redirect: function redirect(packet, client) {
    var address = packet.read(4);
    var port = packet.readUInt16();
    packet.readByte(); // remaining
    var seed = packet.readByte();
    var key = packet.readString8();
    var name = packet.readString8();
    var id = packet.readUInt32();
    client.crypto = new _crypto["default"](seed, key, name);
    address.reverse();
    address = address.join('.');
    client.reconnect(address, port).then(function () {
      client.confirmIdentity(id);
      if (client.server === _server.LoginServer) {
        client.logIn();
      }
    });
  },
  userId: function userId(packet, client) {
    console.log("Logged into ".concat(client.server.name, " as ").concat(client.username, "."));
    client.send(new _packet["default"](0x2D));
  },
  pingA: function pingA(packet, client) {
    var hiByte = packet.readByte();
    var loByte = packet.readByte();
    var x45 = new _packet["default"](0x45);
    x45.writeByte(loByte);
    x45.writeByte(hiByte);
    client.send(x45);
  },
  pingB: function pingB(packet, client) {
    var timestamp = packet.readInt32();
    var x75 = new _packet["default"](0x75);
    x75.writeInt32(timestamp);
    x75.writeInt32((0, _datatypes.int32)(client.tickCount()));
    client.send(x75);
  },
  endingSignal: function endingSignal(packet, client) {
    var x0B = new _packet["default"](0x0B);
    x0B.writeByte(0x00);
    client.send(x0B);
  },
  mapData: function mapData(packet, client) {
    var mapData = _map["default"].fromPacket(packet);
    if (!client.map) {
      client.map = new _map["default"]();
    }
    client.map.addMapData(mapData);
  },
  welcome: function welcome(packet, client) {
    if (client.didSendVersion) {
      return;
    }
    var x62 = new _packet["default"](0x62);
    x62.writeByte(0x34);
    x62.writeByte(0x00);
    x62.writeByte(0x0A);
    x62.writeByte(0x88);
    x62.writeByte(0x6E);
    x62.writeByte(0x59);
    x62.writeByte(0x59);
    x62.writeByte(0x75);
    client.send(x62);
    var x00 = new _packet["default"](0x00);
    x00.writeInt16(client.appVersion);
    x00.writeByte(0x4C);
    x00.writeByte(0x4B);
    x00.writeByte(0x00);
    client.send(x00);
    client.didSendVersion = true;
  }
};