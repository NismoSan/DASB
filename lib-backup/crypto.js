"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;
exports.isDecryptOpcode = isDecryptOpcode;
exports.isEncryptOpcode = isEncryptOpcode;
exports.isSpecialDecryptOpcode = isSpecialDecryptOpcode;
exports.isSpecialEncryptOpcode = isSpecialEncryptOpcode;
var _md = _interopRequireDefault(require("md5"));
var _datatypes = require("./datatypes");
var _util = require("./util");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { "default": e }; }
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }
function _defineProperties(e, r) { for (var t = 0; t < r.length; t++) { var o = r[t]; o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o); } }
function _createClass(e, r, t) { return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function isSpecialEncryptOpcode(opcode) {
  switch (opcode) {
    case 0x00:
    case 0x10:
    case 0x48:
    case 0x02:
    case 0x03:
    case 0x04:
    case 0x0B:
    case 0x26:
    case 0x2D:
    case 0x3A:
    case 0x42:
    case 0x43:
    case 0x4B:
    case 0x57:
    case 0x62:
    case 0x68:
    case 0x71:
    case 0x73:
    case 0x7B:
      return false;
  }
  return true;
}
function isSpecialDecryptOpcode(opcode) {
  switch (opcode) {
    case 0x00:
    case 0x03:
    case 0x40:
    case 0x7E:
    case 0x01:
    case 0x02:
    case 0x0A:
    case 0x56:
    case 0x60:
    case 0x62:
    case 0x66:
    case 0x6F:
      return false;
  }
  return true;
}
function isEncryptOpcode(opcode) {
  switch (opcode) {
    case 0x00:
    case 0x10:
    case 0x48:
      return false;
  }
  return true;
}
function isDecryptOpcode(opcode) {
  switch (opcode) {
    case 0x00:
    case 0x03:
    case 0x40:
    case 0x7E:
      return false;
  }
  return true;
}
var Crypto = /*#__PURE__*/function () {
  function Crypto(seed, key, name) {
    _classCallCheck(this, Crypto);
    this.seed = seed || 0;
    this.key = key || 'UrkcnItnI';
    this.name = name;
    this.generateSalt();
    this.generateSpecialKeyTable();
  }
  return _createClass(Crypto, [{
    key: "encrypt",
    value: function encrypt(packet) {
      if (!isEncryptOpcode(packet.opcode)) {
        return;
      }
      var specialKeySeed = (0, _util.random)(0xFFFF);
      var specialEncrypt = isSpecialEncryptOpcode(packet.opcode);
      var a = (0, _datatypes.uint16)((0, _datatypes.uint16)(specialKeySeed) % 65277 + 256);
      var b = (0, _datatypes.uint8)(((specialKeySeed & 0xFF0000) >> 16) % 155 + 100);
      var key = specialEncrypt ? this.generateSpecialKey(a, b) : Buffer.from(this.key);
      packet.body.push(0);
      if (specialEncrypt) {
        packet.body.push(packet.opcode);
      }
      packet.body = this.transform(packet.body, key, packet.sequence);
      var hash = (0, _md["default"])([packet.opcode, packet.sequence].concat(packet.body));
      hash = Buffer.from(hash, 'hex');
      packet.body.push(hash[13], hash[3], hash[11], hash[7]);
      a ^= 0x7470;
      b ^= 0x23;
      packet.body.push((0, _datatypes.uint8)(a), b, (0, _datatypes.uint8)(a >> 8));
      packet.body.unshift(packet.sequence);
    }
  }, {
    key: "decrypt",
    value: function decrypt(packet) {
      if (!isDecryptOpcode(packet.opcode)) {
        return;
      }
      packet.sequence = packet.body.shift();
      var specialEncrypt = isSpecialDecryptOpcode(packet.opcode);
      var a = (0, _datatypes.uint16)(packet.body[packet.body.length - 1] << 8 | packet.body[packet.body.length - 3]) ^ 0x6474;
      var b = packet.body[packet.body.length - 2] ^ 0x24;
      var key = specialEncrypt ? this.generateSpecialKey(a, b) : Buffer.from(this.key);
      packet.body = packet.body.slice(0, packet.body.length - 3);
      packet.body = this.transform(packet.body, key, packet.sequence);
    }
  }, {
    key: "transform",
    value: function transform(buffer, key, sequence) {
      var _this = this;
      return buffer.map(function (_byte, i) {
        _byte ^= _this.salt[sequence] ^ key[i % key.length];
        var saltIndex = (0, _datatypes.int32)(i / key.length) % _this.salt.length;
        if (saltIndex !== sequence) {
          _byte ^= _this.salt[saltIndex];
        }
        return _byte;
      });
    }
  }, {
    key: "generateSalt",
    value: function generateSalt() {
      var _this2 = this;
      this.salt = new Array(256).fill().map(function (v, i) {
        var saltByte;
        switch (_this2.seed) {
          case 0:
            saltByte = i;
            break;
          case 1:
            saltByte = (i % 2 !== 0 ? -1 : 1) * ((i + 1) / 2) + 128;
            break;
          case 2:
            saltByte = 255 - i;
            break;
          case 3:
            saltByte = (i % 2 !== 0 ? -1 : 1) * ((255 - i) / 2) + 128;
            break;
          case 4:
            saltByte = (0, _datatypes.uint8)(i / 16) * (0, _datatypes.uint8)(i / 16);
            break;
          case 5:
            saltByte = 2 * i % 256;
            break;
          case 6:
            saltByte = 255 - 2 * i % 256;
            break;
          case 7:
            saltByte = i > 127 ? 2 * i - 256 : 255 - 2 * i;
            break;
          case 8:
            saltByte = i > 127 ? 511 - 2 * i : 2 * i;
            break;
          case 9:
            saltByte = (0, _datatypes.uint8)(255 - (0, _datatypes.uint8)((i - 128) / 8) * (0, _datatypes.uint8)((i - 128) / 8) % 256);
            break;
        }
        return (0, _datatypes.uint8)(saltByte | saltByte << 8 | (saltByte | saltByte << 8) << 16);
      });
    }
  }, {
    key: "generateSpecialKey",
    value: function generateSpecialKey(a, b) {
      var _this3 = this;
      return new Array(this.key.length).fill().map(function (v, i) {
        var index = (i * (_this3.key.length * i + b * b) + a) % _this3.specialKeyTable.length;
        return _this3.specialKeyTable[index];
      });
    }
  }, {
    key: "generateSpecialKeyTable",
    value: function generateSpecialKeyTable() {
      if (this.name) {
        var keyTable = (0, _md["default"])((0, _md["default"])(this.name));
        for (var i = 0; i < 31; i++) {
          keyTable += (0, _md["default"])(keyTable);
        }
        this.specialKeyTable = Buffer.from(keyTable);
      }
    }
  }]);
}();
var _default = exports["default"] = Crypto;