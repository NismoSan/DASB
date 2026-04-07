"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;
var _fs = _interopRequireDefault(require("fs"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { "default": e }; }
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }
function _defineProperties(e, r) { for (var t = 0; t < r.length; t++) { var o = r[t]; o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o); } }
function _createClass(e, r, t) { return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
var Map = exports["default"] = /*#__PURE__*/function () {
  function Map(width, height) {
    _classCallCheck(this, Map);
    this.Width = width || 0;
    this.Height = height || 0;
    this.mapData_ = {};
  }
  return _createClass(Map, [{
    key: "addMapData",
    value: function addMapData(mapData) {
      this.mapData_[mapData.index] = mapData;
    }
  }, {
    key: "getMapData",
    value: function getMapData(index) {
      return this.mapData_[index];
    }

    // Parse MapData from a server packet (opcode 0x15)
    // Received in big-endian (Packet read methods handle this)
    // bg = readUInt16, xfg = peekInt16 (signed view), uxfg = readUInt16 (unsigned, advances),
    // yfg = peekInt16 (signed view), uyfg = readUInt16 (unsigned, advances)
    // Each tile is 3 x uint16 on the wire = 6 bytes, with signed/unsigned dual views
  }, {
    key: "fromBuffer",
    value:
    // Load map from a little-endian buffer (disk format)
    // Stored as 3 x uint16LE per tile = 6 bytes (bg, xfg/uxfg, yfg/uyfg)
    function fromBuffer(buffer) {
      var offset = -2;
      for (var y = 0; y < this.Height; ++y) {
        var tiles = [];
        for (var x = 0; x < this.Width; ++x) {
          var bg = buffer.readUInt16LE(offset += 2);
          var xfg = buffer.readInt16LE(offset += 2);
          var uxfg = buffer.readUInt16LE(offset);
          var yfg = buffer.readInt16LE(offset += 2);
          var uyfg = buffer.readUInt16LE(offset);
          tiles.push({
            bg: bg,
            xfg: xfg,
            uxfg: uxfg,
            yfg: yfg,
            uyfg: uyfg
          });
        }
        this.addMapData({
          index: y,
          tiles: tiles
        });
      }
    }

    // Serialize map to a little-endian buffer (disk format)
    // Only writes bg, xfg, yfg (3 x uint16LE = 6 bytes per tile)
    // uxfg/uyfg are just unsigned views of xfg/yfg, not stored separately
  }, {
    key: "toBuffer",
    value: function toBuffer() {
      var buffer = Buffer.alloc(this.Width * this.Height * 6);
      var offset = 0;
      for (var y in this.mapData_) {
        for (var x in this.mapData_[y].tiles) {
          offset = buffer.writeUInt16LE(this.mapData_[y].tiles[x].bg, offset);
          offset = buffer.writeUInt16LE(this.mapData_[y].tiles[x].xfg, offset);
          offset = buffer.writeUInt16LE(this.mapData_[y].tiles[x].yfg, offset);
        }
      }
      return buffer;
    }

    // Save map to file (little-endian disk format)
  }, {
    key: "save",
    value: function save(filePath) {
      var buffer = this.toBuffer();
      return _fs["default"].promises.writeFile(filePath, buffer);
    }

    // Load map from file (little-endian disk format)
  }, {
    key: "load",
    value: function load(filePath) {
      var self = this;
      return _fs["default"].promises.readFile(filePath).then(function (buffer) {
        self.fromBuffer(buffer);
      });
    }
  }], [{
    key: "fromPacket",
    value: function fromPacket(packet) {
      var index = packet.readUInt16();
      var tiles = [];
      var length = Math.floor(packet.remainder() / 6);
      for (var x = 0; x < length; ++x) {
        var bg = packet.readUInt16();
        var xfg = packet.peekInt16();
        var uxfg = packet.readUInt16();
        var yfg = packet.peekInt16();
        var uyfg = packet.readUInt16();
        tiles.push({
          bg: bg,
          xfg: xfg,
          uxfg: uxfg,
          yfg: yfg,
          uyfg: uyfg
        });
      }
      return {
        index: index,
        tiles: tiles
      };
    }
  }]);
}();