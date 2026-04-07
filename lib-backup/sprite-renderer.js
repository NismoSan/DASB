"use strict";

function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SpriteRenderer = void 0;
exports.getSpriteRenderer = getSpriteRenderer;
var _fs = _interopRequireDefault(require("fs"));
var _path = _interopRequireDefault(require("path"));
var _pngjs = require("pngjs");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { "default": e }; }
function _slicedToArray(r, e) { return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest(); }
function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (null != t) { var e, n, i, u, a = [], f = !0, o = !1; try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return; } finally { if (o) throw n; } } return a; } }
function _arrayWithHoles(r) { if (Array.isArray(r)) return r; }
function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }
function _defineProperties(e, r) { for (var t = 0; t < r.length; t++) { var o = r[t]; o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o); } }
function _createClass(e, r, t) { return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _createForOfIteratorHelper(r, e) { var t = "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (!t) { if (Array.isArray(r) || (t = _unsupportedIterableToArray(r)) || e && r && "number" == typeof r.length) { t && (r = t); var _n = 0, F = function F() {}; return { s: F, n: function n() { return _n >= r.length ? { done: !0 } : { done: !1, value: r[_n++] }; }, e: function e(r) { throw r; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var o, a = !0, u = !1; return { s: function s() { t = t.call(r); }, n: function n() { var r = t.next(); return a = r.done, r; }, e: function e(r) { u = !0, o = r; }, f: function f() { try { a || null == t["return"] || t["return"](); } finally { if (u) throw o; } } }; }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
var DA_PATH = process.env.DA_PATH || 'C:/Program Files (x86)/KRU/Dark Ages';
var CANVAS_W = 111;
var CANVAS_H = 85;

// --- DA Archive Reader ---

function readArchive(datPath) {
  var buf = _fs["default"].readFileSync(datPath);
  var count = buf.readUInt32LE(0);
  var entries = [];
  var pos = 4;
  for (var i = 0; i < count; i++) {
    var offset = buf.readUInt32LE(pos);
    pos += 4;
    var nameBytes = buf.slice(pos, pos + 13);
    pos += 13;
    var nullIdx = nameBytes.indexOf(0);
    var name = nameBytes.slice(0, nullIdx === -1 ? 13 : nullIdx).toString('ascii');
    entries.push({
      name: name,
      offset: offset
    });
  }
  for (var _i = 0; _i < entries.length - 1; _i++) {
    entries[_i].size = entries[_i + 1].offset - entries[_i].offset;
  }
  if (entries.length > 0) {
    entries[entries.length - 1].size = buf.length - entries[entries.length - 1].offset;
  }
  // Build name lookup map for fast access
  var nameMap = {};
  for (var _i2 = 0, _entries = entries; _i2 < _entries.length; _i2++) {
    var entry = _entries[_i2];
    nameMap[entry.name] = entry;
    nameMap[entry.name.toLowerCase()] = entry;
  }
  return {
    buf: buf,
    entries: entries,
    count: count,
    nameMap: nameMap
  };
}
function getEntryData(archive, entryName) {
  var entry = archive.nameMap[entryName] || archive.nameMap[entryName.toLowerCase()];
  if (!entry) return null;
  return archive.buf.slice(entry.offset, entry.offset + entry.size);
}

// --- EPF File Reader ---

function readEpf(data) {
  if (!data || data.length < 12) return null;
  var frameCount = data.readUInt16LE(0);
  var tocAddress = data.readUInt32LE(8);
  var tocStart = 12 + tocAddress;
  var frames = [];
  for (var i = 0; i < frameCount; i++) {
    var o = tocStart + i * 16;
    if (o + 16 > data.length) break;
    var top = data.readInt16LE(o);
    var left = data.readInt16LE(o + 2);
    var bottom = data.readInt16LE(o + 4);
    var right = data.readInt16LE(o + 6);
    var width = right - left;
    var height = bottom - top;
    var startAddress = data.readUInt32LE(o + 8);
    var endAddress = data.readUInt32LE(o + 12);
    if (width <= 0 || height <= 0) {
      frames.push(null); // preserve frame index for position-based access
      continue;
    }

    // DALib: if endAddress - startAddress != width * height, read tocAddress - startAddress bytes
    var expectedSize = width * height;
    var dataSize = endAddress - startAddress === expectedSize ? expectedSize : Math.min(tocAddress - startAddress, expectedSize);
    var pixelOffset = 12 + startAddress;
    if (pixelOffset + dataSize > data.length) {
      frames.push(null); // corrupt
      continue;
    }
    frames.push({
      top: top,
      left: left,
      bottom: bottom,
      right: right,
      width: width,
      height: height,
      pixelOffset: pixelOffset,
      dataSize: dataSize
    });
  }
  return {
    frameCount: frameCount,
    frames: frames,
    data: data
  };
}

// --- Palette Reader ---

function readPalette(data) {
  if (!data || data.length < 768) return null;
  var colors = [];
  for (var i = 0; i < 256; i++) {
    colors.push({
      r: data[i * 3],
      g: data[i * 3 + 1],
      b: data[i * 3 + 2]
    });
  }
  return colors;
}

// --- Palette Table Reader ---
// Parse palette table (.tbl) files
// Format per DALib:
//   2 columns: "id paletteNum" — direct override
//   3 columns: "id paletteNum -1" — male override
//              "id paletteNum -2" — female override
//              "min max paletteNum" — range mapping (3rd value > 0)
function readPalTable(data) {
  if (!data) return {
    overrides: {},
    maleOverrides: {},
    femaleOverrides: {},
    entries: {}
  };
  var text = data.toString('ascii');
  var lines = text.split(/\r?\n/).filter(function (l) {
    return l.trim();
  });
  var overrides = {};
  var maleOverrides = {};
  var femaleOverrides = {};
  var entries = {}; // range entries expanded to individual IDs (matches DALib)
  var _iterator = _createForOfIteratorHelper(lines),
    _step;
  try {
    for (_iterator.s(); !(_step = _iterator.n()).done;) {
      var line = _step.value;
      var parts = line.trim().split(/\s+/).map(Number);
      if (parts.some(isNaN)) continue;
      if (parts.length === 2) {
        overrides[parts[0]] = parts[1];
      } else if (parts.length >= 3) {
        if (parts[2] === -1) {
          maleOverrides[parts[0]] = parts[1];
        } else if (parts[2] === -2) {
          femaleOverrides[parts[0]] = parts[1];
        } else {
          // Range: expand min..max into individual entries (DALib behavior)
          for (var i = parts[0]; i <= parts[1]; i++) {
            entries[i] = parts[2];
          }
        }
      }
    }
  } catch (err) {
    _iterator.e(err);
  } finally {
    _iterator.f();
  }
  return {
    overrides: overrides,
    maleOverrides: maleOverrides,
    femaleOverrides: femaleOverrides,
    entries: entries
  };
}

// Look up palette number for a sprite ID with gender support
// Priority: gender override > general override > range > default 0
function findPaletteIdx(table, spriteId, isFemale) {
  if (!table) return 0;

  // Check gender-specific overrides first
  if (isFemale && table.femaleOverrides && table.femaleOverrides[spriteId] !== undefined) {
    return table.femaleOverrides[spriteId];
  }
  if (!isFemale && table.maleOverrides && table.maleOverrides[spriteId] !== undefined) {
    return table.maleOverrides[spriteId];
  }

  // Check direct overrides
  if (table.overrides && table.overrides[spriteId] !== undefined) {
    return table.overrides[spriteId];
  }

  // Check range entries (expanded to individual IDs)
  if (table.entries && table.entries[spriteId] !== undefined) {
    return table.entries[spriteId];
  }
  return 0;
}

// Check if the palette table has an explicit entry for the given sprite ID
// (as opposed to falling back to default 0)
function hasPalTableEntry(table, spriteId, isFemale) {
  if (!table) return false;
  if (isFemale && table.femaleOverrides && table.femaleOverrides[spriteId] !== undefined) return true;
  if (!isFemale && table.maleOverrides && table.maleOverrides[spriteId] !== undefined) return true;
  if (table.overrides && table.overrides[spriteId] !== undefined) return true;
  if (table.entries && table.entries[spriteId] !== undefined) return true;
  return false;
}

// --- Color Table Reader ---
// Parse color table (.tbl) files from legend.dat (e.g. color0.tbl)
// Format per DALib ColorTable.cs:
//   Line 1: colorsPerEntry (typically 6)
//   Then repeating blocks: colorIndex line, followed by colorsPerEntry "R,G,B" lines
//   Each entry maps a dye byte value to an array of RGB colors for palette indices 98-103
function readColorTable(data) {
  if (!data) return null;
  var text = data.toString('ascii');
  var lines = text.split(/\r?\n/).filter(function (l) {
    return l.trim();
  });
  if (lines.length === 0) return null;
  var colorsPerEntry = parseInt(lines[0], 10);
  if (isNaN(colorsPerEntry) || colorsPerEntry <= 0) return null;
  var table = new Map();
  var i = 1;
  while (i < lines.length) {
    var colorIndex = parseInt(lines[i], 10);
    if (isNaN(colorIndex)) break;
    i++;
    var colors = [];
    for (var c = 0; c < colorsPerEntry && i < lines.length; c++, i++) {
      var parts = lines[i].split(',').map(function (v) {
        return parseInt(v, 10);
      });
      if (parts.length === 3 && parts.every(function (v) {
        return !isNaN(v);
      })) {
        colors.push({
          r: parts[0] % 256,
          g: parts[1] % 256,
          b: parts[2] % 256
        });
      } else {
        colors.push({
          r: 0,
          g: 0,
          b: 0
        });
      }
    }
    table.set(colorIndex, colors);
  }
  return table.size > 0 ? table : null;
}

// --- Character Sprite Renderer ---
var SpriteRenderer = exports.SpriteRenderer = /*#__PURE__*/function () {
  function SpriteRenderer(daPath) {
    _classCallCheck(this, SpriteRenderer);
    this.daPath = daPath || DA_PATH;
    this.khanArchives = [];
    this.khanpal = null;
    this.palTables = {};
    this.paletteCache = {};
    this.epfCache = {};
    this.colorTable = null; // color0.tbl from legend.dat — dye byte → 6 RGB colors
    this.palmPalettes = {}; // palm palettes from khanpal.dat — no table, direct index by skin color
    this.initialized = false;
    this.renderCache = {};
  }
  return _createClass(SpriteRenderer, [{
    key: "init",
    value: function init() {
      if (this.initialized) return true;
      try {
        // Load khan character sprite archives (male + female) plus supplemental archives
        // that may contain newer sprites not yet merged into the main khan files
        var khanFiles = ['khanmad.dat', 'khanmeh.dat', 'khanmim.dat', 'khanmns.dat', 'khanmtz.dat', 'khanwad.dat', 'khanweh.dat', 'khanwim.dat', 'khanwns.dat', 'khanwtz.dat', 'ia.dat', 'seo.dat', 'setoa.dat', 'hades.dat', 'national.dat', 'cious.dat', 'roh.dat'];
        for (var _i3 = 0, _khanFiles = khanFiles; _i3 < _khanFiles.length; _i3++) {
          var file = _khanFiles[_i3];
          var filePath = _path["default"].join(this.daPath, file);
          if (_fs["default"].existsSync(filePath)) {
            this.khanArchives.push(readArchive(filePath));
          }
        }
        if (this.khanArchives.length === 0) {
          console.log('[SpriteRenderer] No khan archives found at', this.daPath);
          return false;
        }
        console.log('[SpriteRenderer] Loaded', this.khanArchives.length, 'khan archives');

        // Load palette archive
        var palPath = _path["default"].join(this.daPath, 'khanpal.dat');
        if (_fs["default"].existsSync(palPath)) {
          this.khanpal = readArchive(palPath);
          console.log('[SpriteRenderer] Loaded khanpal.dat:', this.khanpal.count, 'entries');
        }

        // Load palette tables for each slot letter
        for (var _i4 = 0, _arr = ['b', 'c', 'e', 'f', 'h', 'i', 'l', 'p', 'u', 'w']; _i4 < _arr.length; _i4++) {
          var letter = _arr[_i4];
          var data = this.khanpal ? getEntryData(this.khanpal, 'pal' + letter + '.tbl') : null;
          if (data) {
            this.palTables[letter] = readPalTable(data);
          }
        }

        // Load palm palettes from khanpal.dat (body/skin palettes — no table, direct index)
        if (this.khanpal) {
          var _iterator2 = _createForOfIteratorHelper(this.khanpal.entries),
            _step2;
          try {
            for (_iterator2.s(); !(_step2 = _iterator2.n()).done;) {
              var entry = _step2.value;
              var match = entry.name.match(/^palm(\d+)\.pal$/i);
              if (match) {
                var idx = parseInt(match[1], 10);
                var _data = getEntryData(this.khanpal, entry.name);
                if (_data) {
                  var pal = readPalette(_data);
                  if (pal) this.palmPalettes[idx] = pal;
                }
              }
            }
          } catch (err) {
            _iterator2.e(err);
          } finally {
            _iterator2.f();
          }
          console.log('[SpriteRenderer] Loaded', Object.keys(this.palmPalettes).length, 'palm (body/skin) palettes');
        }

        // Load color table from legend.dat (dye byte → RGB color mapping)
        var legendPath = _path["default"].join(this.daPath, 'legend.dat');
        if (_fs["default"].existsSync(legendPath)) {
          try {
            var legend = readArchive(legendPath);
            var colorData = getEntryData(legend, 'color0.tbl');
            this.colorTable = readColorTable(colorData);
            if (this.colorTable) {
              console.log('[SpriteRenderer] Loaded legend.dat color table:', this.colorTable.size, 'dye entries');
            } else {
              console.log('[SpriteRenderer] color0.tbl not found or empty in legend.dat');
            }
          } catch (err) {
            console.error('[SpriteRenderer] Error loading legend.dat:', err.message);
          }
        } else {
          console.log('[SpriteRenderer] legend.dat not found at', legendPath, '— dye colors will not be applied');
        }
        this.initialized = true;
        console.log('[SpriteRenderer] Initialized successfully');
        return true;
      } catch (err) {
        console.error('[SpriteRenderer] Init error:', err.message);
        return false;
      }
    }

    // Find an EPF file across all khan archives
  }, {
    key: "findEpf",
    value: function findEpf(fileName) {
      if (this.epfCache[fileName] !== undefined) return this.epfCache[fileName];
      var _iterator3 = _createForOfIteratorHelper(this.khanArchives),
        _step3;
      try {
        for (_iterator3.s(); !(_step3 = _iterator3.n()).done;) {
          var arch = _step3.value;
          var data = getEntryData(arch, fileName);
          if (data) {
            var epf = readEpf(data);
            this.epfCache[fileName] = epf;
            return epf;
          }
        }
      } catch (err) {
        _iterator3.e(err);
      } finally {
        _iterator3.f();
      }
      this.epfCache[fileName] = null;
      return null;
    }

    // Find an EPF by prefix and sprite ID, trying different zero-padding
  }, {
    key: "findEpfByPrefixId",
    value: function findEpfByPrefixId(prefix, id, suffix) {
      var raw = prefix + String(id) + suffix + '.epf';
      var pad3 = prefix + String(id).padStart(3, '0') + suffix + '.epf';
      var pad5 = prefix + String(id).padStart(5, '0') + suffix + '.epf';
      return this.findEpf(pad3) || this.findEpf(raw) || this.findEpf(pad5);
    }

    // Load a palette from khanpal.dat (tries 3-digit, 2-digit, and raw padding)
  }, {
    key: "loadPalette",
    value: function loadPalette(letter, idx) {
      var cacheKey = letter + ':' + idx;
      if (this.paletteCache[cacheKey]) return this.paletteCache[cacheKey];
      if (!this.khanpal) return null;
      var names = ['pal' + letter + String(idx).padStart(3, '0') + '.pal', 'pal' + letter + String(idx).padStart(2, '0') + '.pal', 'pal' + letter + String(idx) + '.pal'];
      for (var _i5 = 0, _names = names; _i5 < _names.length; _i5++) {
        var name = _names[_i5];
        var data = getEntryData(this.khanpal, name);
        if (data) {
          var palette = readPalette(data);
          this.paletteCache[cacheKey] = palette;
          return palette;
        }
      }
      return null;
    }

    // Get the correct palette for a given slot letter, sprite ID, and gender
  }, {
    key: "getPaletteForSprite",
    value: function getPaletteForSprite(letter, spriteId, isFemale) {
      var table = this.palTables[letter];
      var palIdx = table ? findPaletteIdx(table, spriteId, isFemale) : 0;
      // DALib: palette numbers >= 1000 trigger luminance blending (subtract 1000 for actual index)
      if (palIdx >= 1000) palIdx -= 1000;
      return this.loadPalette(letter, palIdx);
    }

    // Apply skin color to a palette by overlaying palm[skinColor] values.
    // Equipment palettes (palb, palu, etc.) use:
    //   - Indices 16-31: grayscale skin ramp → replaced with palm skin tones
    //   - Indices 61-63, 160-171: arm/leg/outline skin tones → scaled by skin darkening ratio
    //   - Indices 48-49, 60: underwear highlights → left unchanged
    //   - Indices 10-15: shadows → left unchanged
  }, {
    key: "applySkinColor",
    value: function applySkinColor(basePalette, skinColor) {
      if (!basePalette) return basePalette;
      var skinPal = this.palmPalettes[skinColor] || this.palmPalettes[0];
      var baseSkinPal = this.palmPalettes[0];
      if (!skinPal) return basePalette;
      var cacheKey = 'skin:' + skinColor + ':' + basePalette._id;
      if (basePalette._id && this.paletteCache[cacheKey]) return this.paletteCache[cacheKey];
      var merged = new Array(basePalette.length);
      for (var i = 0; i < basePalette.length; i++) {
        merged[i] = basePalette[i];
      }
      // Overlay skin tone ramp from palm (16-31)
      for (var _i6 = 16; _i6 <= 31; _i6++) {
        if (skinPal[_i6]) merged[_i6] = skinPal[_i6];
      }

      // Scale arm/leg/outline indices (61-63, 160-171) by the skin darkening ratio.
      // These indices in palb are hardcoded to palm0 (light skin) values.
      // We compute the average ratio between palm[skinColor] and palm0 at the skin ramp,
      // then apply that ratio to darken/lighten these indices proportionally.
      // Indices 48-49, 60 (underwear) and 10-15 (shadows) are left unchanged.
      if (baseSkinPal && skinColor !== 0) {
        // Compute average darkening ratio from palm0 → palm[skinColor] at skin ramp
        var rr = 0,
          rg = 0,
          rb = 0,
          cnt = 0;
        for (var _i7 = 17; _i7 <= 30; _i7++) {
          var p0 = baseSkinPal[_i7],
            ps = skinPal[_i7];
          if (p0 && ps && p0.r > 0 && p0.g > 0 && p0.b > 0) {
            rr += ps.r / p0.r;
            rg += ps.g / p0.g;
            rb += ps.b / p0.b;
            cnt++;
          }
        }
        if (cnt > 0) {
          rr /= cnt;
          rg /= cnt;
          rb /= cnt;
          // Apply ratio to arm/leg/outline skin indices
          var scaleIndices = [61, 62, 63, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171];
          for (var _i8 = 0, _scaleIndices = scaleIndices; _i8 < _scaleIndices.length; _i8++) {
            var idx = _scaleIndices[_i8];
            var c = basePalette[idx];
            if (c) {
              merged[idx] = {
                r: Math.min(255, Math.max(0, Math.round(c.r * rr))),
                g: Math.min(255, Math.max(0, Math.round(c.g * rg))),
                b: Math.min(255, Math.max(0, Math.round(c.b * rb)))
              };
            }
          }
        }
      }

      // Tag for caching
      if (!basePalette._id) basePalette._id = Math.random().toString(36).slice(2);
      this.paletteCache[cacheKey] = merged;
      return merged;
    }

    // Fix palm palette for body EPF rendering.
    // Palm palettes have wrong colors at certain indices used by body EPF data:
    //   - Indices 61-63, 160-171: blue/purple (body fill skin tones in EPF data)
    //     These same colors exist at different palm indices (verified exact matches):
    //     61->22, 62->24, 63->26, 160->27, 161->28, 162->29, 163->30,
    //     164->32, 165->33, 166->34, 167->35, 168->37, 169->38, 170->39, 171->40
    //   - Indices 10-15: magenta (foot shadows in EPF data)
    //     These are fixed gray/brown shadow colors that never change with skin tone.
    //     Copied from palb which has the correct shadow colors.
  }, {
    key: "fixPalmBlueIndices",
    value: function fixPalmBlueIndices(palmPalette, skinColor) {
      if (!palmPalette) return palmPalette;
      var cacheKey = 'palmfix:' + skinColor;
      if (this.paletteCache[cacheKey]) return this.paletteCache[cacheKey];
      var merged = new Array(palmPalette.length);
      for (var i = 0; i < palmPalette.length; i++) {
        merged[i] = palmPalette[i];
      }

      // Remap body fill indices: EPF index -> palm index with correct skin color
      var skinIndexMap = {
        61: 22,
        62: 24,
        63: 26,
        160: 27,
        161: 28,
        162: 29,
        163: 30,
        164: 32,
        165: 33,
        166: 34,
        167: 35,
        168: 37,
        169: 38,
        170: 39,
        171: 40
      };
      for (var _i9 = 0, _Object$entries = Object.entries(skinIndexMap); _i9 < _Object$entries.length; _i9++) {
        var _Object$entries$_i = _slicedToArray(_Object$entries[_i9], 2),
          dstIdx = _Object$entries$_i[0],
          srcIdx = _Object$entries$_i[1];
        if (palmPalette[srcIdx]) {
          merged[Number(dstIdx)] = palmPalette[srcIdx];
        }
      }

      // Copy fixed colors that should not change with skin tone:
      //   10-15: foot shadows (magenta in palm, need gray/brown from palb)
      //   48: underwear (must be white — some palm palettes have gray here)
      //   49-54: shadow detail (some palm palettes vary; use palm0 as canonical source)
      var palbPalette = this.getPaletteForSprite('b', 1, false);
      if (palbPalette) {
        for (var _i0 = 10; _i0 <= 15; _i0++) {
          if (palbPalette[_i0]) merged[_i0] = palbPalette[_i0];
        }
      }
      // Underwear must always be white
      merged[48] = {
        r: 255,
        g: 255,
        b: 255
      };
      // Shadow detail indices 49-54: use palm0 values (consistent across most palettes)
      var palm0 = this.palmPalettes[0];
      if (palm0) {
        for (var _i1 = 49; _i1 <= 54; _i1++) {
          if (palm0[_i1]) merged[_i1] = palm0[_i1];
        }
      }
      this.paletteCache[cacheKey] = merged;
      return merged;
    }

    // Check if a palette index is a dye slot that should show the dye color instead.
    // DALib: dye colors replace palette indices starting at PALETTE_DYE_INDEX_START (98).
    // When no dye is applied, those indices may show placeholder colors — skip them.
    // Index 0 is always transparent.
  }, {
    key: "isDyeIndex",
    value: function isDyeIndex(paletteIndex) {
      return paletteIndex >= 98 && paletteIndex <= 103;
    }

    // Draw an EPF frame onto a canvas buffer
    // dyeColor: if provided, replaces palette indices 98-103 with dye colors
    // offsetX/offsetY: pixel offset for compositing (from ChaosAssetManager GetEquipmentDrawOffset)
  }, {
    key: "drawFrame",
    value: function drawFrame(canvasData, epf, frameIdx, palette, dyeColor, offsetX, offsetY, noDyeSkip) {
      if (!epf || frameIdx >= epf.frames.length) return;
      var frame = epf.frames[frameIdx];
      if (!frame || frame.width <= 0 || frame.height <= 0) return;
      var ox = offsetX || 0;
      var oy = offsetY || 0;
      for (var y = 0; y < frame.height; y++) {
        for (var x = 0; x < frame.width; x++) {
          var dataIdx = y * frame.width + x;
          if (dataIdx >= frame.dataSize) continue; // beyond valid pixel data
          var pi = epf.data[frame.pixelOffset + dataIdx];
          if (pi === 0) continue; // transparent

          // Dye system: palette indices 98-103 are dye slots
          // When dyeColor is provided, look up the 6 RGB colors from color0.tbl
          // When no dye, skip those indices (they're placeholders)
          var color = void 0;
          if (this.isDyeIndex(pi) && !noDyeSkip) {
            if (dyeColor == null || !this.colorTable) continue;
            var entry = this.colorTable.get(dyeColor);
            if (!entry) continue;
            var dyeIdx = pi - 98;
            if (dyeIdx < 0 || dyeIdx >= entry.length) continue;
            color = entry[dyeIdx];
          } else {
            color = palette[pi];
          }
          if (!color) continue;

          // Skip magenta (255,0,255) — used as transparent marker in palm/body palettes
          // for facial feature placeholders (indices 10-15) meant to be overwritten by face layer
          if (color.r === 255 && color.g === 0 && color.b === 255) continue;
          var cx = frame.left + x + ox;
          var cy = frame.top + y + oy;
          if (cx < 0 || cx >= CANVAS_W || cy < 0 || cy >= CANVAS_H) continue;
          var off = (cy * CANVAS_W + cx) * 4;
          canvasData[off] = color.r;
          canvasData[off + 1] = color.g;
          canvasData[off + 2] = color.b;
          canvasData[off + 3] = 255;
        }
      }
    }

    // Render a character from 0x33 appearance data to PNG buffer
    // appearance object from player-tracker:
    //   bodySprite, headSprite, armorSprite, armsSprite, bootsSprite,
    //   weaponSprite, shieldSprite, overcoatSprite,
    //   acc1Sprite, acc2Sprite, acc3Sprite,
    //   hairColor, bootsColor, skinColor, pantsColor, faceShape,
    //   acc1Color, acc2Color, acc3Color, overcoatColor
  }, {
    key: "renderCharacter",
    value: function renderCharacter(appearance) {
      var _this = this;
      if (!this.initialized || !appearance) return null;
      if (appearance.isMonster) return null; // monsters use different sprite system

      // Check cache
      var cacheKey = JSON.stringify(appearance);
      if (this.renderCache[cacheKey]) return this.renderCache[cacheKey];

      // Determine gender prefix: m=male, w=female
      // bodySprite: 16=male, 32=female (from Arbiter: BodySprite enum)
      var isFemale = appearance.bodySprite === 32 || appearance.bodySprite === 64;
      var g = isFemale ? 'w' : 'm';
      var canvasData = Buffer.alloc(CANVAS_W * CANVAS_H * 4, 0);
      var layers = [];

      // Layer rendering order (back to front):
      // Prefix mapping (from ChaosAssetManager EquipmentImportControl):
      //   ma = Arms 1,  mb = Body 1,  mc = Accessories 1,  me = Head 1 (front)
      //   mf = Head 3 (behind body),  mg = Accessories 2 (behind body)
      //   mh = Head 2 (behind armor), mi = Armor 2 (+1k), mj = Arms 2
      //   ml = Boots,  mm = Body 2,  mn = Pants,  mo = Faces (overcoat in protocol)
      //   mp = Weapons 2 (casting), ms = Shields, mu = Armor 1, mw = Weapons 1
      //
      // Palette letter remapping (from RenderUtil.Khan.cs lines 35-43):
      //   a => b, g => c, j => c, o => m, s => p (others use same letter)

      // --- Behind-body layers first ---

      // Draw offset for accessories and weapons (from ChaosAssetManager GetEquipmentDrawOffset):
      // Types c, g, w, p all have X offset of -27
      var ACC_OFFSET_X = -27;

      // mg = Accessories 2 (behind body) — same IDs as mc but rendered behind
      // palLetter remaps g => c (uses palc palettes)
      if (appearance.acc1Sprite) {
        layers.push({
          prefix: g + 'g',
          palLetter: 'c',
          id: appearance.acc1Sprite,
          dyeColor: appearance.acc1Color,
          ox: ACC_OFFSET_X
        });
      }
      if (appearance.acc2Sprite) {
        layers.push({
          prefix: g + 'g',
          palLetter: 'c',
          id: appearance.acc2Sprite,
          dyeColor: appearance.acc2Color,
          ox: ACC_OFFSET_X
        });
      }
      if (appearance.acc3Sprite) {
        layers.push({
          prefix: g + 'g',
          palLetter: 'c',
          id: appearance.acc3Sprite,
          dyeColor: appearance.acc3Color,
          ox: ACC_OFFSET_X
        });
      }

      // Helper: detect new armor system — new armors have me### files (IDs 26+)
      // Check for '01' suffix (walk) since that's what we render
      var hasNewArmorFiles = function hasNewArmorFiles(id) {
        return !!_this.findEpfByPrefixId(g + 'e', id, '01');
      };

      // Resolve overcoat sprite ID — protocol sends IDs 1000+ that need offset mapping
      // Try raw ID first, then subtract 999 (most common offset for overcoat IDs)
      var resolvedOvercoat = 0;
      if (appearance.overcoatSprite) {
        var rawOc = appearance.overcoatSprite;
        if (this.findEpfByPrefixId(g + 'u', rawOc, '01') || this.findEpfByPrefixId(g + 'u', rawOc, '02')) {
          resolvedOvercoat = rawOc;
        } else if (rawOc > 999) {
          // Overcoat IDs 1000+ need offset subtraction to find the actual EPF
          // Try -1000 first (most common), then -999
          for (var _i10 = 0, _arr2 = [1000, 999]; _i10 < _arr2.length; _i10++) {
            var offset = _arr2[_i10];
            var adjusted = rawOc - offset;
            if (adjusted > 0 && (this.findEpfByPrefixId(g + 'u', adjusted, '01') || this.findEpfByPrefixId(g + 'u', adjusted, '02'))) {
              resolvedOvercoat = adjusted;
              break;
            }
          }
        }
      }
      var isNewArmor = appearance.armorSprite && hasNewArmorFiles(appearance.armorSprite);

      // --- Body layers ---

      // Skin color index for skin-tone overlay on equipment palettes
      var skinIdx = appearance.skinColor || 0;

      // mm/wm = Body — uses skin ramp indices directly for correct skin tones.
      // mb/wb uses body-fill indices (61-63, 160-171) which require remapping and produce wrong colors.
      // noDyeSkip: render dye-range indices (98-103) as normal palette colors — they contain body pixel data.
      layers.push({
        prefix: g + 'm',
        palmIdx: skinIdx,
        id: 1,
        fixBlueIndices: true,
        noDyeSkip: true
      });

      // mn/wn = Pants — server sends pantsColor in 0x33 packet.
      // pantsColor 0 = no pants. Non-zero = dye color for pants under short armors.
      if (appearance.pantsColor) {
        layers.push({
          prefix: g + 'n',
          palLetter: 'b',
          id: 1,
          dyeColor: appearance.pantsColor
        });
      }

      // ml = Boots (with dye) — drawn before armor so robes/armor cover boots
      if (appearance.bootsSprite) {
        layers.push({
          prefix: g + 'l',
          palLetter: 'l',
          id: appearance.bootsSprite,
          dyeColor: appearance.bootsColor
        });
      }

      // When an overcoat is equipped, it replaces the armor entirely.
      // Render only the overcoat's overlay (mi/me) on top of the plain body.
      if (resolvedOvercoat) {
        // Overcoat replaces armor — render overcoat's undergarment (u) + overlay (i/e)
        layers.push({
          prefix: g + 'u',
          palLetter: 'u',
          id: resolvedOvercoat,
          dyeColor: appearance.overcoatColor
        });
        var isNewOvercoat = hasNewArmorFiles(resolvedOvercoat);
        if (isNewOvercoat) {
          layers.push({
            prefix: g + 'e',
            palLetter: 'e',
            id: resolvedOvercoat,
            dyeColor: appearance.overcoatColor
          });
        } else if (this.findEpfByPrefixId(g + 'i', resolvedOvercoat, '01') || this.findEpfByPrefixId(g + 'i', resolvedOvercoat, '02')) {
          layers.push({
            prefix: g + 'i',
            palLetter: 'i',
            id: resolvedOvercoat,
            dyeColor: appearance.overcoatColor
          });
        }
      } else {
        // No overcoat — render normal armor layers
        if (appearance.armorSprite) {
          var hasMi = !isNewArmor && hasPalTableEntry(this.palTables['i'], appearance.armorSprite, isFemale);
          var hasMe = isNewArmor && hasPalTableEntry(this.palTables['e'], appearance.armorSprite, isFemale);

          // mu/wu = Armor body layer. Always render — most armors have EPF files but no palu table entry.
          // getPaletteForSprite falls back to palette index 0 when no table entry exists.
          layers.push({
            prefix: g + 'u',
            palLetter: 'u',
            id: appearance.armorSprite
          });

          // Armor overlay (mi) — old armor system detail layer on top of mu.
          // me (new armor head front) is deferred to after the head/hair layer so it renders on top.
          if (hasMi) {
            layers.push({
              prefix: g + 'i',
              palLetter: 'i',
              id: appearance.armorSprite
            });
          }
        }
      }

      // ma = Arms 1 — uses palm palette as base with blue index fix (same as body)
      if (appearance.armsSprite) {
        layers.push({
          prefix: g + 'a',
          palmIdx: skinIdx,
          id: appearance.armsSprite,
          fixBlueIndices: true
        });
      }

      // mo = Faces — uses palm palettes (skin color index, no table)
      // ChaosAssetManager: 'o' => 'm' palette letter, which uses direct palm palettes
      // faceShape in the 0x33 packet is already 1-indexed (1 = first face = mo001)
      // Per Arbiter reference: FaceShape byte is used directly as EPF ID
      if (appearance.faceShape) {
        layers.push({
          prefix: g + 'o',
          palmIdx: skinIdx,
          id: appearance.faceShape
        });
      }

      // ms = Shields — palLetter remaps s => p (no draw offset for shields)
      // Shield 255 (0xFF) is a sentinel for "no shield"
      if (appearance.shieldSprite && appearance.shieldSprite !== 255) {
        layers.push({
          prefix: g + 's',
          palLetter: 'p',
          id: appearance.shieldSprite
        });
      }

      // mh/wh = Hair — the server sends a sequential hairstyle index but the EPF files
      // on disk have gaps in their numbering. When the EPF doesn't exist, find the Nth
      // existing EPF file where N = the server's hairstyle index.
      if (appearance.headSprite) {
        var hairId = appearance.headSprite;
        var hairPrefix = g + 'h';
        if (!this.findEpfByPrefixId(hairPrefix, hairId, '01')) {
          // Find the (N+1)th existing hair EPF — server uses 0-based hairstyle indices
          // but EPF files are 1-based, so server index N maps to the (N+1)th existing file.
          var target = hairId + 1;
          var count = 0;
          for (var epfId = 1; epfId <= hairId + 20; epfId++) {
            if (this.findEpfByPrefixId(hairPrefix, epfId, '01')) {
              count++;
              if (count === target) {
                hairId = epfId;
                break;
              }
            }
          }
        }
        layers.push({
          prefix: hairPrefix,
          palLetter: 'h',
          id: hairId,
          dyeColor: appearance.hairColor
        });
      }

      // mc = Accessories 1 (front) — acc1/acc2/acc3 with dye colors — offset applies
      if (appearance.acc1Sprite) {
        layers.push({
          prefix: g + 'c',
          palLetter: 'c',
          id: appearance.acc1Sprite,
          dyeColor: appearance.acc1Color,
          ox: ACC_OFFSET_X
        });
      }
      if (appearance.acc2Sprite) {
        layers.push({
          prefix: g + 'c',
          palLetter: 'c',
          id: appearance.acc2Sprite,
          dyeColor: appearance.acc2Color,
          ox: ACC_OFFSET_X
        });
      }
      if (appearance.acc3Sprite) {
        layers.push({
          prefix: g + 'c',
          palLetter: 'c',
          id: appearance.acc3Sprite,
          dyeColor: appearance.acc3Color,
          ox: ACC_OFFSET_X
        });
      }

      // mw = Weapons 1 — offset applies
      if (appearance.weaponSprite) {
        layers.push({
          prefix: g + 'w',
          palLetter: 'w',
          id: appearance.weaponSprite,
          ox: ACC_OFFSET_X
        });
      }
      var hasContent = false;

      // EPF suffix layout (from ChaosAssetManager EpfEquipmentEditorControl):
      //   '01' suffix = Walk, 10 frames: 0=north idle, 1-4=north walk, 5=south idle, 6-9=south walk
      //   '02' suffix = Assail, 4 frames: 0-1=north, 2-3=south
      //   'b'  suffix = Priest Cast (NOT walk!), 'c' = Warrior, 'd' = Monk, 'e' = Rogue, 'f' = Wizard
      // Use '01' suffix frame 5 (south-facing idle) for display.
      // Fall back to '02' suffix frame 2 (south-facing assail) if no walk file exists.
      var WALK_SOUTH_IDLE = 5; // in '01' suffix files — standing idle facing south
      var ASSAIL_SOUTH_FRAME = 2; // in '02' suffix files — south-facing assail

      for (var _i11 = 0, _layers = layers; _i11 < _layers.length; _i11++) {
        var layer = _layers[_i11];
        // Try walk file first ('01' suffix) — frame 5 is south-facing idle
        var epf = this.findEpfByPrefixId(layer.prefix, layer.id, '01');
        var frameIdx = WALK_SOUTH_IDLE;

        // Fall back if walk file missing or frame is null/out of bounds
        if (!epf || frameIdx >= epf.frames.length || !epf.frames[frameIdx]) {
          epf = this.findEpfByPrefixId(layer.prefix, layer.id, '02');
          frameIdx = ASSAIL_SOUTH_FRAME;
          // If south-facing assail is also invalid, try frame 0
          if (epf && (frameIdx >= epf.frames.length || !epf.frames[frameIdx])) {
            frameIdx = 0;
          }
        }
        if (!epf) continue;
        if (frameIdx >= epf.frames.length || !epf.frames[frameIdx]) continue;

        // Palette resolution: palmIdx uses direct palm palette,
        // palLetter uses standard palette table lookup
        var palette = void 0;
        if (layer.palmIdx !== undefined) {
          palette = this.palmPalettes[layer.palmIdx] || this.palmPalettes[0] || null;
        } else {
          palette = this.getPaletteForSprite(layer.palLetter, layer.id, isFemale);
        }
        if (!palette) continue;

        // Fix blue indices in palm palettes: replace blue/purple at 61-63, 160-171 with
        // palb-sourced skin tones, ratio-scaled for the current skin color
        if (layer.fixBlueIndices) {
          palette = this.fixPalmBlueIndices(palette, layer.palmIdx || 0);
        }

        // Apply skin color overlay to equipment palettes (palu) — modifies indices 16-31, 61-63, 160-171
        if (layer.skinColor !== undefined) {
          palette = this.applySkinColor(palette, layer.skinColor);
        }
        this.drawFrame(canvasData, epf, frameIdx, palette, layer.dyeColor, layer.ox || 0, layer.oy || 0, layer.noDyeSkip);
        hasContent = true;
      }
      if (!hasContent) return null;

      // Crop to content bounds
      var minX = CANVAS_W,
        minY = CANVAS_H,
        maxX = 0,
        maxY = 0;
      for (var y = 0; y < CANVAS_H; y++) {
        for (var x = 0; x < CANVAS_W; x++) {
          if (canvasData[(y * CANVAS_W + x) * 4 + 3] > 0) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < minX) return null;

      // Add 1px padding
      minX = Math.max(0, minX - 1);
      minY = Math.max(0, minY - 1);
      maxX = Math.min(CANVAS_W - 1, maxX + 1);
      maxY = Math.min(CANVAS_H - 1, maxY + 1);
      var cropW = maxX - minX + 1;
      var cropH = maxY - minY + 1;
      var png = new _pngjs.PNG({
        width: cropW,
        height: cropH
      });
      for (var _y = 0; _y < cropH; _y++) {
        for (var _x = 0; _x < cropW; _x++) {
          var srcOff = ((_y + minY) * CANVAS_W + (_x + minX)) * 4;
          var dstOff = (_y * cropW + _x) * 4;
          png.data[dstOff] = canvasData[srcOff];
          png.data[dstOff + 1] = canvasData[srcOff + 1];
          png.data[dstOff + 2] = canvasData[srcOff + 2];
          png.data[dstOff + 3] = canvasData[srcOff + 3];
        }
      }
      var result = _pngjs.PNG.sync.write(png);

      // Cache the result (limit cache size)
      if (Object.keys(this.renderCache).length > 500) {
        var keys = Object.keys(this.renderCache);
        for (var i = 0; i < 100; i++) delete this.renderCache[keys[i]];
      }
      this.renderCache[cacheKey] = result;
      return result;
    }
  }, {
    key: "clearRenderCache",
    value: function clearRenderCache() {
      this.renderCache = {};
      console.log('[SpriteRenderer] Render cache cleared');
    }
  }, {
    key: "getStats",
    value: function getStats() {
      if (!this.initialized) return null;
      return {
        khanArchives: this.khanArchives.length,
        palTables: Object.keys(this.palTables).length,
        cachedPalettes: Object.keys(this.paletteCache).length,
        cachedEpfs: Object.keys(this.epfCache).length,
        cachedRenders: Object.keys(this.renderCache).length
      };
    }
  }]);
}();
var rendererInstance = null;
function getSpriteRenderer() {
  if (!rendererInstance) {
    rendererInstance = new SpriteRenderer();
  }
  return rendererInstance;
}