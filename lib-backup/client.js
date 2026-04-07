"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;
var _net = _interopRequireDefault(require("net"));
var _events = _interopRequireDefault(require("events"));
var _server = require("./server");
var _crypto = _interopRequireWildcard(require("./crypto"));
var _datatypes = require("./datatypes");
var _crc = require("./crc");
var _util = require("./util");
var _packet = _interopRequireDefault(require("./packet"));
var _packetHandlers = _interopRequireDefault(require("./packet-handlers"));
function _interopRequireWildcard(e, t) { if ("function" == typeof WeakMap) var r = new WeakMap(), n = new WeakMap(); return (_interopRequireWildcard = function _interopRequireWildcard(e, t) { if (!t && e && e.__esModule) return e; var o, i, f = { __proto__: null, "default": e }; if (null === e || "object" != _typeof(e) && "function" != typeof e) return f; if (o = t ? n : r) { if (o.has(e)) return o.get(e); o.set(e, f); } for (var _t in e) "default" !== _t && {}.hasOwnProperty.call(e, _t) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e, _t)) && (i.get || i.set) ? o(f, _t, i) : f[_t] = e[_t]); return f; })(e, t); }
function _interopRequireDefault(e) { return e && e.__esModule ? e : { "default": e }; }
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }
function _defineProperties(e, r) { for (var t = 0; t < r.length; t++) { var o = r[t]; o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o); } }
function _createClass(e, r, t) { return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
var _default = exports["default"] = /*#__PURE__*/function () {
  function _default(username, password) {
    _classCallCheck(this, _default);
    this.appVersion = 741;
    this.username = username;
    this.password = password;
    this.crypto = new _crypto["default"]();
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
    this.events = new _events["default"]();
    this.events.on(0x00, _packetHandlers["default"].encryption);
    this.events.on(0x02, _packetHandlers["default"].loginMessage);
    this.events.on(0x03, _packetHandlers["default"].redirect);
    this.events.on(0x05, _packetHandlers["default"].userId);
    this.events.on(0x15, _packetHandlers["default"].mapData);
    this.events.on(0x3B, _packetHandlers["default"].pingA);
    this.events.on(0x4C, _packetHandlers["default"].endingSignal);
    this.events.on(0x68, _packetHandlers["default"].pingB);
    this.events.on(0x7E, _packetHandlers["default"].welcome);
  }
  return _createClass(_default, [{
    key: "tickCount",
    value: function tickCount() {
      return new Date().getTime() - this.startTime;
    }
  }, {
    key: "connect",
    value: function connect(address, port) {
      var _this = this;
      if (!address) {
        address = _server.LoginServer.address;
        port = _server.LoginServer.port;
      }
      this._lastAddress = address;
      this._lastPort = port;
      this.server = (0, _server.getServerFromAddress)(address, port);
      console.log("Connecting to ".concat(this.server.name, "..."));
      var socket = new _net["default"].Socket();
      socket.on('data', this.receive.bind(this));
      socket.on('close', function () {
        // Only auto-reconnect if this was an unexpected disconnect
        if (socket !== _this.socket) return;
        if (_this._intentionalReconnect || _this._stopped) return;
        _this._scheduleAutoReconnect();
      });
      socket.on('error', function (err) {
        console.log("Socket error: ".concat(err.message));
        // error is always followed by close, so auto-reconnect is handled there
      });
      return new Promise(function (resolve, reject) {
        var _onError = function onError(err) {
          socket.removeListener('error', _onError);
          reject(err);
        };
        socket.on('error', _onError);
        socket.connect(port, address, function () {
          socket.removeListener('error', _onError);
          _this.socket = socket;
          _this._reconnecting = false;
          _this._reconnectAttempt = 0;
          _this._intentionalReconnect = false;
          resolve();
        });
      });
    }
  }, {
    key: "disconnect",
    value: function disconnect() {
      var socket = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : this.socket;
      if (socket) socket.destroy();
    }
  }, {
    key: "stop",
    value: function stop() {
      this._stopped = true;
      this._cancelAutoReconnect();
      this.disconnect();
    }
  }, {
    key: "reconnect",
    value: function reconnect(address, port) {
      // Intentional reconnect (redirect, version negotiation) — no backoff
      this._intentionalReconnect = true;
      this._cancelAutoReconnect();
      this.disconnect();
      this.encryptSequence = 0;
      this.didSendVersion = false;
      // Note: _intentionalReconnect is cleared in connect() after the new
      // socket is established, so the old socket's async 'close' event
      // won't trigger auto-reconnect.
      return this.connect(address, port);
    }
  }, {
    key: "_getReconnectDelay",
    value: function _getReconnectDelay() {
      // Exponential backoff: 5s, 10s, 20s, 30s, 30s, 30s...
      var delays = [5000, 10000, 20000, 30000];
      return delays[Math.min(this._reconnectAttempt, delays.length - 1)];
    }
  }, {
    key: "_cancelAutoReconnect",
    value: function _cancelAutoReconnect() {
      if (this._reconnectTimer) {
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
      }
      this._reconnecting = false;
    }
  }, {
    key: "_scheduleAutoReconnect",
    value: function _scheduleAutoReconnect() {
      var _this2 = this;
      if (this._stopped) return;
      if (!this.autoReconnect) {
        console.log('Auto-reconnect is disabled.');
        this.events.emit('autoReconnectDisabled');
        return;
      }
      if (this._reconnecting) return; // already scheduled

      this._reconnecting = true;
      this._reconnectAttempt++;
      var delay = this._getReconnectDelay();
      console.log("Auto-reconnect attempt ".concat(this._reconnectAttempt, " in ").concat(delay / 1000, "s..."));
      this.events.emit('reconnecting', {
        attempt: this._reconnectAttempt,
        delay: delay
      });
      this._reconnectTimer = setTimeout(function () {
        _this2._reconnectTimer = null;
        _this2._reconnecting = false;
        _this2.encryptSequence = 0;
        _this2.didSendVersion = false;

        // Reconnect to the login server (full fresh login)
        _this2.connect(_server.LoginServer.address, _server.LoginServer.port).then(function () {
          console.log('Reconnected successfully.');
        })["catch"](function (err) {
          console.log("Reconnect failed: ".concat(err.message));
          // Schedule next attempt — the close event will also fire, but
          // we guard against double-scheduling with the _reconnecting flag
          _this2._scheduleAutoReconnect();
        });
      }, delay);
    }
  }, {
    key: "confirmIdentity",
    value: function confirmIdentity(id) {
      var x10 = new _packet["default"](0x10);
      x10.writeByte(this.crypto.seed);
      x10.writeString8(this.crypto.key);
      x10.writeString8(this.crypto.name);
      x10.writeUInt32(id);
      x10.writeByte(0x00);
      this.send(x10);
    }
  }, {
    key: "logIn",
    value: function logIn() {
      console.log("Logging in as ".concat(this.username, "..."));
      var key1 = (0, _util.random)(0xFF);
      var key2 = (0, _util.random)(0xFF);
      var clientId = (0, _util.random)(0xFFFFFFFF);
      var clientIdKey = (0, _datatypes.uint8)(key2 + 138);
      var clientIdArray = [clientId & 0x0FF, clientId >> 8 & 0x0FF, clientId >> 16 & 0x0FF, clientId >> 24 & 0x0FF];
      var hash = (0, _crc.calculateCRC16)(clientIdArray, 0, 4);
      var clientIdChecksum = (0, _datatypes.uint16)(hash);
      var clientIdChecksumKey = (0, _datatypes.uint8)(key2 + 0x5E);
      clientIdChecksum ^= (0, _datatypes.uint16)(clientIdChecksumKey | clientIdChecksumKey + 1 << 8);
      clientId ^= (0, _datatypes.uint32)(clientIdKey | clientIdKey + 1 << 8 | clientIdKey + 2 << 16 | clientIdKey + 3 << 24);
      var randomValue = (0, _util.random)(0xFFFF);
      var randomValueKey = (0, _datatypes.uint8)(key2 + 115);
      randomValue ^= (0, _datatypes.uint32)(randomValueKey | randomValueKey + 1 << 8 | randomValueKey + 2 << 16 | randomValueKey + 3 << 24);
      var x03 = new _packet["default"](0x03);
      x03.writeString8(this.username);
      x03.writeString8(this.password);
      x03.writeByte(key1);
      x03.writeByte((0, _datatypes.uint8)(key2 ^ key1 + 59));
      x03.writeUInt32(clientId);
      x03.writeUInt16(clientIdChecksum);
      x03.writeUInt32(randomValue);
      var crc = (0, _crc.calculateCRC16)(x03.body, this.username.length + this.password.length + 2, 12);
      var crcKey = (0, _datatypes.uint8)(key2 + 165);
      crc ^= (0, _datatypes.uint16)(crcKey | crcKey + 1 << 8);
      x03.writeUInt16(crc);
      x03.writeUInt16(0x0100);
      this.send(x03);
    }
  }, {
    key: "send",
    value: function send(packet) {
      if ((0, _crypto.isEncryptOpcode)(packet.opcode)) {
        packet.sequence = this.encryptSequence;
        this.encryptSequence = (0, _datatypes.uint8)(this.encryptSequence + 1);
      }
      if (this.logOutgoing) {
        console.log("Sent: ".concat(packet.toString()));
      }
      this.crypto.encrypt(packet);
      this.socket.write(packet.buffer());
    }
  }, {
    key: "sendDialog",
    value: function sendDialog(packet) {
      var payload = packet.body.slice();
      var x = Math.floor(Math.random() * 256);
      var xPrime = Math.floor(Math.random() * 256);
      var y = (0, _datatypes.uint8)(x + 0x72);
      var z = (0, _datatypes.uint8)(x + 0x28);
      var crc = (0, _crc.calculateCRC16)(payload);
      var plain = [(crc >> 8) & 0xFF, crc & 0xFF].concat(payload);
      var dataLength = plain.length;
      var encrypted = [];
      for (var j = 0; j < plain.length; j++) {
        encrypted.push((0, _datatypes.uint8)(plain[j] ^ (0, _datatypes.uint8)((z + j) & 0xFF)));
      }
      var lenHi = (0, _datatypes.uint8)((dataLength >> 8) ^ y);
      var lenLo = (0, _datatypes.uint8)((dataLength & 0xFF) ^ (0, _datatypes.uint8)((y + 1) & 0xFF));
      var b0 = (0, _datatypes.uint8)(xPrime + 0x2D);
      var b1 = (0, _datatypes.uint8)(x ^ xPrime);
      packet.body = [b0, b1, lenHi, lenLo].concat(encrypted);
      this.send(packet);
    }
  }, {
    key: "receive",
    value: function receive(data) {
      this.incomingBuffers.push(data);
      var buffer = Buffer.concat(this.incomingBuffers.splice(0));
      while (buffer.length > 3 && buffer[0] === 0xAA) {
        var length = (buffer[1] << 8 | buffer[2]) + 3;
        if (length > buffer.length) {
          this.incomingBuffers.push(buffer);
          break;
        }
        var packetBuffer = Array.from(buffer.slice(0, length));
        var packet = new _packet["default"](packetBuffer);
        this.crypto.decrypt(packet);
        if (this.logIncoming) {
          console.log("Received: ".concat(packet.toString()));
        }
        this.events.emit(packet.opcode, packet, this);
        buffer = buffer.slice(length);
      }
    }
  }]);
}();