"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;
var _datatypes = require("./datatypes");
var _util = require("./util");
var _iconvLite = _interopRequireDefault(require("iconv-lite"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { "default": e }; }
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }
function _defineProperties(e, r) { for (var t = 0; t < r.length; t++) { var o = r[t]; o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o); } }
function _createClass(e, r, t) { return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
var _default = exports["default"] = /*#__PURE__*/function () {
  function _default(arg) {
    _classCallCheck(this, _default);
    if (arg.constructor === Number) {
      this.opcode = arg;
      this.sequence = 0;
      this.position = 0;
      this.body = [];
    } else {
      this.opcode = arg[3];
      this.sequence = 0;
      this.position = 0;
      this.body = Array.from(arg.slice(4));
    }
  }
  return _createClass(_default, [{
    key: "header",
    value: function header() {
      var packetLength = this.body.length + 4;
      return [0xAA, (0, _datatypes.uint8)(packetLength - 3 >> 8), (0, _datatypes.uint8)(packetLength - 3), this.opcode];
    }
  }, {
    key: "bodyWithHeader",
    value: function bodyWithHeader() {
      return this.header().concat(this.body);
    }
  }, {
    key: "buffer",
    value: function buffer() {
      return Buffer.from(this.bodyWithHeader());
    }
  }, {
    key: "toString",
    value: function toString() {
      return this.bodyWithHeader().map(function (_byte) {
        return (0, _util.toHex)(_byte);
      }).join(' ');
    }
  }, {
    key: "remainder",
    value: function remainder() {
      return this.body.length - this.position;
    }
  }, {
    key: "read",
    value: function read(length) {
      if (this.position + length > this.body.length) {
        return 0;
      }
      var buffer = this.body.slice(this.position, this.position + length);
      this.position += length;
      return buffer;
    }
  }, {
    key: "readByte",
    value: function readByte() {
      if (this.position + 1 > this.body.length) {
        return 0;
      }
      var value = this.body[this.position];
      this.position += 1;
      return value;
    }
  }, {
    key: "readInt16",
    value: function readInt16() {
      if (this.position + 2 > this.body.length) {
        return 0;
      }
      var value = this.body[this.position] << 8 | this.body[this.position + 1];
      this.position += 2;
      return value;
    }
  }, {
    key: "peekInt16",
    value: function peekInt16() {
      if (this.position + 2 > this.body.length) {
        return 0;
      }
      var value = this.body[this.position] << 8 | this.body[this.position + 1];
      return value;
    }
  }, {
    key: "readUInt16",
    value: function readUInt16() {
      if (this.position + 2 > this.body.length) {
        return 0;
      }
      var value = this.body[this.position] << 8 | this.body[this.position + 1];
      this.position += 2;
      return value;
    }
  }, {
    key: "readInt32",
    value: function readInt32() {
      if (this.position + 4 > this.body.length) {
        return 0;
      }
      var value = this.body[this.position] << 24 | this.body[this.position + 1] << 16 | this.body[this.position + 2] << 8 | this.body[this.position + 3];
      this.position += 4;
      return (0, _datatypes.int32)(value);
    }
  }, {
    key: "readUInt32",
    value: function readUInt32() {
      if (this.position + 4 > this.body.length) {
        return 0;
      }
      var value = this.body[this.position] << 24 | this.body[this.position + 1] << 16 | this.body[this.position + 2] << 8 | this.body[this.position + 3];
      this.position += 4;
      return value;
    }
  }, {
    key: "readString8",
    value: function readString8() {
      if (this.position + 1 > this.body.length) {
        return '';
      }
      var length = this.body[this.position];
      var position = this.position + 1;
      if (position + length > this.body.length) {
        return '';
      }
      var buffer = this.body.slice(position, position + length);
      this.position += length + 1;
      return _iconvLite["default"].decode(Buffer.from(buffer), 'win1252');
    }
  }, {
    key: "readString16",
    value: function readString16() {
      if (this.position + 2 > this.body.length) {
        return '';
      }
      var length = this.body[this.position] << 8 | this.body[this.position + 1];
      var position = this.position + 2;
      if (position + length > this.body.length) {
        return '';
      }
      var buffer = this.body.slice(position, position + length);
      this.position += length + 2;
      return _iconvLite["default"].decode(Buffer.from(buffer), 'win1252');
    }
  }, {
    key: "write",
    value: function write(buffer) {
      this.body = this.body.concat(buffer);
    }
  }, {
    key: "writeByte",
    value: function writeByte(value) {
      this.body.push((0, _datatypes.uint8)(value));
    }
  }, {
    key: "writeInt16",
    value: function writeInt16(value) {
      value = (0, _datatypes.int16)(value);
      this.body.push(value >> 8 & 0xFF);
      this.body.push(value & 0xFF);
    }
  }, {
    key: "writeUInt16",
    value: function writeUInt16(value) {
      value = (0, _datatypes.uint16)(value);
      this.body.push(value >> 8 & 0xFF);
      this.body.push(value & 0xFF);
    }
  }, {
    key: "writeInt32",
    value: function writeInt32(value) {
      value = (0, _datatypes.int32)(value);
      this.body.push(value >> 24 & 0xFF);
      this.body.push(value >> 16 & 0xFF);
      this.body.push(value >> 8 & 0xFF);
      this.body.push(value & 0xFF);
    }
  }, {
    key: "writeUInt32",
    value: function writeUInt32(value) {
      value = (0, _datatypes.uint32)(value);
      this.body.push(value >> 24 & 0xFF);
      this.body.push(value >> 16 & 0xFF);
      this.body.push(value >> 8 & 0xFF);
      this.body.push(value & 0xFF);
    }
  }, {
    key: "writeString",
    value: function writeString(value) {
      var buffer = Array.from(_iconvLite["default"].encode(value, 'win1252'));
      this.body = this.body.concat(buffer);
      this.position += buffer.length;
    }
  }, {
    key: "writeString8",
    value: function writeString8(value) {
      var buffer = Array.from(_iconvLite["default"].encode(value, 'win1252'));
      this.body.push(buffer.length);
      this.body = this.body.concat(buffer);
      this.position += buffer.length + 1;
    }
  }, {
    key: "writeString16",
    value: function writeString16(value) {
      var buffer = Array.from(_iconvLite["default"].encode(value, 'win1252'));
      this.body.push(buffer.length >> 8 & 0xFF);
      this.body.push(buffer.length & 0xFF);
      this.body = this.body.concat(buffer);
      this.position += buffer.length + 2;
    }
  }]);
}();