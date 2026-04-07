"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpriteRenderer = void 0;
exports.getSpriteRenderer = getSpriteRenderer;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const pngjs_1 = require("pngjs");
const DA_PATH = process.env.DA_PATH || 'C:/Program Files (x86)/KRU/Dark Ages';
const CANVAS_W = 111;
const CANVAS_H = 85;
function readArchive(datPath) {
    const buf = fs_1.default.readFileSync(datPath);
    const count = buf.readUInt32LE(0);
    const entries = [];
    let pos = 4;
    for (let i = 0; i < count; i++) {
        const offset = buf.readUInt32LE(pos);
        pos += 4;
        const nameBytes = buf.slice(pos, pos + 13);
        pos += 13;
        const nullIdx = nameBytes.indexOf(0);
        const name = nameBytes.slice(0, nullIdx === -1 ? 13 : nullIdx).toString('ascii');
        entries.push({ name, offset, size: 0 });
    }
    for (let i = 0; i < entries.length - 1; i++) {
        entries[i].size = entries[i + 1].offset - entries[i].offset;
    }
    if (entries.length > 0) {
        entries[entries.length - 1].size = buf.length - entries[entries.length - 1].offset;
    }
    // Build name lookup map for fast access
    const nameMap = {};
    for (const entry of entries) {
        nameMap[entry.name] = entry;
        nameMap[entry.name.toLowerCase()] = entry;
    }
    return { buf, entries, count, nameMap };
}
function getEntryData(archive, entryName) {
    const entry = archive.nameMap[entryName] || archive.nameMap[entryName.toLowerCase()];
    if (!entry)
        return null;
    return archive.buf.slice(entry.offset, entry.offset + entry.size);
}
// --- EPF File Reader ---
function readEpf(data) {
    if (!data || data.length < 12)
        return null;
    const frameCount = data.readUInt16LE(0);
    const tocAddress = data.readUInt32LE(8);
    const tocStart = 12 + tocAddress;
    const frames = [];
    for (let i = 0; i < frameCount; i++) {
        const o = tocStart + i * 16;
        if (o + 16 > data.length)
            break;
        const top = data.readInt16LE(o);
        const left = data.readInt16LE(o + 2);
        const bottom = data.readInt16LE(o + 4);
        const right = data.readInt16LE(o + 6);
        const width = right - left;
        const height = bottom - top;
        const startAddress = data.readUInt32LE(o + 8);
        const endAddress = data.readUInt32LE(o + 12);
        if (width <= 0 || height <= 0) {
            frames.push(null); // preserve frame index for position-based access
            continue;
        }
        // DALib: if endAddress - startAddress != width * height, read tocAddress - startAddress bytes
        const expectedSize = width * height;
        const dataSize = (endAddress - startAddress) === expectedSize
            ? expectedSize
            : Math.min(tocAddress - startAddress, expectedSize);
        const pixelOffset = 12 + startAddress;
        if (pixelOffset + dataSize > data.length) {
            frames.push(null); // corrupt
            continue;
        }
        frames.push({ top, left, bottom, right, width, height, pixelOffset, dataSize });
    }
    return { frameCount, frames, data };
}
// --- Palette Reader ---
function readPalette(data) {
    if (!data || data.length < 768)
        return null;
    const colors = [];
    for (let i = 0; i < 256; i++) {
        colors.push({ r: data[i * 3], g: data[i * 3 + 1], b: data[i * 3 + 2] });
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
    if (!data)
        return { overrides: {}, maleOverrides: {}, femaleOverrides: {}, entries: {} };
    const text = data.toString('ascii');
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const overrides = {};
    const maleOverrides = {};
    const femaleOverrides = {};
    const entries = {}; // range entries expanded to individual IDs (matches DALib)
    for (const line of lines) {
        const parts = line.trim().split(/\s+/).map(Number);
        if (parts.some(isNaN))
            continue;
        if (parts.length === 2) {
            overrides[parts[0]] = parts[1];
        }
        else if (parts.length >= 3) {
            if (parts[2] === -1) {
                maleOverrides[parts[0]] = parts[1];
            }
            else if (parts[2] === -2) {
                femaleOverrides[parts[0]] = parts[1];
            }
            else {
                // Range: expand min..max into individual entries (DALib behavior)
                for (let i = parts[0]; i <= parts[1]; i++) {
                    entries[i] = parts[2];
                }
            }
        }
    }
    return { overrides, maleOverrides, femaleOverrides, entries };
}
// Look up palette number for a sprite ID with gender support
// Priority: gender override > general override > range > default 0
function findPaletteIdx(table, spriteId, isFemale) {
    if (!table)
        return 0;
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
    if (!table)
        return false;
    if (isFemale && table.femaleOverrides && table.femaleOverrides[spriteId] !== undefined)
        return true;
    if (!isFemale && table.maleOverrides && table.maleOverrides[spriteId] !== undefined)
        return true;
    if (table.overrides && table.overrides[spriteId] !== undefined)
        return true;
    if (table.entries && table.entries[spriteId] !== undefined)
        return true;
    return false;
}
// --- Color Table Reader ---
// Parse color table (.tbl) files from legend.dat (e.g. color0.tbl)
// Format per DALib ColorTable.cs:
//   Line 1: colorsPerEntry (typically 6)
//   Then repeating blocks: colorIndex line, followed by colorsPerEntry "R,G,B" lines
//   Each entry maps a dye byte value to an array of RGB colors for palette indices 98-103
function readColorTable(data) {
    if (!data)
        return null;
    const text = data.toString('ascii');
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0)
        return null;
    const colorsPerEntry = parseInt(lines[0], 10);
    if (isNaN(colorsPerEntry) || colorsPerEntry <= 0)
        return null;
    const table = new Map();
    let i = 1;
    while (i < lines.length) {
        const colorIndex = parseInt(lines[i], 10);
        if (isNaN(colorIndex))
            break;
        i++;
        const colors = [];
        for (let c = 0; c < colorsPerEntry && i < lines.length; c++, i++) {
            const parts = lines[i].split(',').map((v) => parseInt(v, 10));
            if (parts.length === 3 && parts.every((v) => !isNaN(v))) {
                colors.push({ r: parts[0] % 256, g: parts[1] % 256, b: parts[2] % 256 });
            }
            else {
                colors.push({ r: 0, g: 0, b: 0 });
            }
        }
        table.set(colorIndex, colors);
    }
    return table.size > 0 ? table : null;
}
// --- Character Sprite Renderer ---
class SpriteRenderer {
    daPath;
    khanArchives;
    khanpal;
    palTables;
    paletteCache;
    epfCache;
    colorTable;
    palmPalettes;
    initialized;
    renderCache;
    constructor(daPath) {
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
    init() {
        if (this.initialized)
            return true;
        try {
            // Load khan character sprite archives (male + female) plus supplemental archives
            // that may contain newer sprites not yet merged into the main khan files
            const khanFiles = [
                'khanmad.dat', 'khanmeh.dat', 'khanmim.dat', 'khanmns.dat', 'khanmtz.dat',
                'khanwad.dat', 'khanweh.dat', 'khanwim.dat', 'khanwns.dat', 'khanwtz.dat',
                'ia.dat', 'seo.dat', 'setoa.dat', 'hades.dat', 'national.dat', 'cious.dat', 'roh.dat'
            ];
            for (const file of khanFiles) {
                const filePath = path_1.default.join(this.daPath, file);
                if (fs_1.default.existsSync(filePath)) {
                    this.khanArchives.push(readArchive(filePath));
                }
            }
            if (this.khanArchives.length === 0) {
                console.log('[SpriteRenderer] No khan archives found at', this.daPath);
                return false;
            }
            console.log('[SpriteRenderer] Loaded', this.khanArchives.length, 'khan archives');
            // Load palette archive
            const palPath = path_1.default.join(this.daPath, 'khanpal.dat');
            if (fs_1.default.existsSync(palPath)) {
                this.khanpal = readArchive(palPath);
                console.log('[SpriteRenderer] Loaded khanpal.dat:', this.khanpal.count, 'entries');
            }
            // Load palette tables for each slot letter
            for (const letter of ['b', 'c', 'e', 'f', 'h', 'i', 'l', 'p', 'u', 'w']) {
                const data = this.khanpal ? getEntryData(this.khanpal, 'pal' + letter + '.tbl') : null;
                if (data) {
                    this.palTables[letter] = readPalTable(data);
                }
            }
            // Load palm palettes from khanpal.dat (body/skin palettes — no table, direct index)
            if (this.khanpal) {
                for (const entry of this.khanpal.entries) {
                    const match = entry.name.match(/^palm(\d+)\.pal$/i);
                    if (match) {
                        const idx = parseInt(match[1], 10);
                        const data = getEntryData(this.khanpal, entry.name);
                        if (data) {
                            const pal = readPalette(data);
                            if (pal)
                                this.palmPalettes[idx] = pal;
                        }
                    }
                }
                console.log('[SpriteRenderer] Loaded', Object.keys(this.palmPalettes).length, 'palm (body/skin) palettes');
            }
            // Load color table from legend.dat (dye byte → RGB color mapping)
            const legendPath = path_1.default.join(this.daPath, 'legend.dat');
            if (fs_1.default.existsSync(legendPath)) {
                try {
                    const legend = readArchive(legendPath);
                    const colorData = getEntryData(legend, 'color0.tbl');
                    this.colorTable = readColorTable(colorData);
                    if (this.colorTable) {
                        console.log('[SpriteRenderer] Loaded legend.dat color table:', this.colorTable.size, 'dye entries');
                    }
                    else {
                        console.log('[SpriteRenderer] color0.tbl not found or empty in legend.dat');
                    }
                }
                catch (err) {
                    console.error('[SpriteRenderer] Error loading legend.dat:', err.message);
                }
            }
            else {
                console.log('[SpriteRenderer] legend.dat not found at', legendPath, '— dye colors will not be applied');
            }
            this.initialized = true;
            console.log('[SpriteRenderer] Initialized successfully');
            return true;
        }
        catch (err) {
            console.error('[SpriteRenderer] Init error:', err.message);
            return false;
        }
    }
    // Find an EPF file across all khan archives
    findEpf(fileName) {
        if (this.epfCache[fileName] !== undefined)
            return this.epfCache[fileName];
        for (const arch of this.khanArchives) {
            const data = getEntryData(arch, fileName);
            if (data) {
                const epf = readEpf(data);
                this.epfCache[fileName] = epf;
                return epf;
            }
        }
        this.epfCache[fileName] = null;
        return null;
    }
    // Find an EPF by prefix and sprite ID, trying different zero-padding
    findEpfByPrefixId(prefix, id, suffix) {
        const raw = prefix + String(id) + suffix + '.epf';
        const pad3 = prefix + String(id).padStart(3, '0') + suffix + '.epf';
        const pad5 = prefix + String(id).padStart(5, '0') + suffix + '.epf';
        return this.findEpf(pad3) || this.findEpf(raw) || this.findEpf(pad5);
    }
    // Load a palette from khanpal.dat (tries 3-digit, 2-digit, and raw padding)
    loadPalette(letter, idx) {
        const cacheKey = letter + ':' + idx;
        if (this.paletteCache[cacheKey])
            return this.paletteCache[cacheKey];
        if (!this.khanpal)
            return null;
        const names = [
            'pal' + letter + String(idx).padStart(3, '0') + '.pal',
            'pal' + letter + String(idx).padStart(2, '0') + '.pal',
            'pal' + letter + String(idx) + '.pal'
        ];
        for (const name of names) {
            const data = getEntryData(this.khanpal, name);
            if (data) {
                const palette = readPalette(data);
                if (palette) {
                    this.paletteCache[cacheKey] = palette;
                    return palette;
                }
            }
        }
        return null;
    }
    // Get the correct palette for a given slot letter, sprite ID, and gender
    getPaletteForSprite(letter, spriteId, isFemale) {
        const table = this.palTables[letter];
        let palIdx = table ? findPaletteIdx(table, spriteId, isFemale) : 0;
        // DALib: palette numbers >= 1000 trigger luminance blending (subtract 1000 for actual index)
        if (palIdx >= 1000)
            palIdx -= 1000;
        return this.loadPalette(letter, palIdx);
    }
    // Apply skin color to a palette by overlaying palm[skinColor] values.
    // Equipment palettes (palb, palu, etc.) use:
    //   - Indices 16-31: grayscale skin ramp → replaced with palm skin tones
    //   - Indices 61-63, 160-171: arm/leg/outline skin tones → scaled by skin darkening ratio
    //   - Indices 48-49, 60: underwear highlights → left unchanged
    //   - Indices 10-15: shadows → left unchanged
    applySkinColor(basePalette, skinColor) {
        if (!basePalette)
            return basePalette;
        const skinPal = this.palmPalettes[skinColor] || this.palmPalettes[0];
        const baseSkinPal = this.palmPalettes[0];
        if (!skinPal)
            return basePalette;
        const cacheKey = 'skin:' + skinColor + ':' + basePalette._id;
        if (basePalette._id && this.paletteCache[cacheKey])
            return this.paletteCache[cacheKey];
        const merged = new Array(basePalette.length);
        for (let i = 0; i < basePalette.length; i++) {
            merged[i] = basePalette[i];
        }
        // Overlay skin tone ramp from palm (16-31)
        for (let i = 16; i <= 31; i++) {
            if (skinPal[i])
                merged[i] = skinPal[i];
        }
        // Scale arm/leg/outline indices (61-63, 160-171) by the skin darkening ratio.
        // These indices in palb are hardcoded to palm0 (light skin) values.
        // We compute the average ratio between palm[skinColor] and palm0 at the skin ramp,
        // then apply that ratio to darken/lighten these indices proportionally.
        // Indices 48-49, 60 (underwear) and 10-15 (shadows) are left unchanged.
        if (baseSkinPal && skinColor !== 0) {
            // Compute average darkening ratio from palm0 → palm[skinColor] at skin ramp
            let rr = 0, rg = 0, rb = 0, cnt = 0;
            for (let i = 17; i <= 30; i++) {
                const p0 = baseSkinPal[i], ps = skinPal[i];
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
                const scaleIndices = [61, 62, 63, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171];
                for (const idx of scaleIndices) {
                    const c = basePalette[idx];
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
        if (!basePalette._id)
            basePalette._id = Math.random().toString(36).slice(2);
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
    fixPalmBlueIndices(palmPalette, skinColor) {
        if (!palmPalette)
            return palmPalette;
        const cacheKey = 'palmfix:' + skinColor;
        if (this.paletteCache[cacheKey])
            return this.paletteCache[cacheKey];
        const merged = new Array(palmPalette.length);
        for (let i = 0; i < palmPalette.length; i++) {
            merged[i] = palmPalette[i];
        }
        // Remap body fill indices: EPF index -> palm index with correct skin color
        const skinIndexMap = {
            61: 22, 62: 24, 63: 26,
            160: 27, 161: 28, 162: 29, 163: 30,
            164: 32, 165: 33, 166: 34, 167: 35,
            168: 37, 169: 38, 170: 39, 171: 40
        };
        for (const [dstIdx, srcIdx] of Object.entries(skinIndexMap)) {
            if (palmPalette[srcIdx]) {
                merged[Number(dstIdx)] = palmPalette[srcIdx];
            }
        }
        // Copy fixed colors that should not change with skin tone:
        //   10-15: foot shadows (magenta in palm, need gray/brown from palb)
        //   48: underwear (must be white — some palm palettes have gray here)
        //   49-54: shadow detail (some palm palettes vary; use palm0 as canonical source)
        const palbPalette = this.getPaletteForSprite('b', 1, false);
        if (palbPalette) {
            for (let i = 10; i <= 15; i++) {
                if (palbPalette[i])
                    merged[i] = palbPalette[i];
            }
        }
        // Underwear must always be white
        merged[48] = { r: 255, g: 255, b: 255 };
        // Shadow detail indices 49-54: use palm0 values (consistent across most palettes)
        const palm0 = this.palmPalettes[0];
        if (palm0) {
            for (let i = 49; i <= 54; i++) {
                if (palm0[i])
                    merged[i] = palm0[i];
            }
        }
        this.paletteCache[cacheKey] = merged;
        return merged;
    }
    // Check if a palette index is a dye slot that should show the dye color instead.
    // DALib: dye colors replace palette indices starting at PALETTE_DYE_INDEX_START (98).
    // When no dye is applied, those indices may show placeholder colors — skip them.
    // Index 0 is always transparent.
    isDyeIndex(paletteIndex) {
        return paletteIndex >= 98 && paletteIndex <= 103;
    }
    // Draw an EPF frame onto a canvas buffer
    // dyeColor: if provided, replaces palette indices 98-103 with dye colors
    // offsetX/offsetY: pixel offset for compositing (from ChaosAssetManager GetEquipmentDrawOffset)
    drawFrame(canvasData, epf, frameIdx, palette, dyeColor, offsetX, offsetY, noDyeSkip) {
        if (!epf || frameIdx >= epf.frames.length)
            return;
        const frame = epf.frames[frameIdx];
        if (!frame || frame.width <= 0 || frame.height <= 0)
            return;
        const ox = offsetX || 0;
        const oy = offsetY || 0;
        for (let y = 0; y < frame.height; y++) {
            for (let x = 0; x < frame.width; x++) {
                const dataIdx = y * frame.width + x;
                if (dataIdx >= frame.dataSize)
                    continue; // beyond valid pixel data
                const pi = epf.data[frame.pixelOffset + dataIdx];
                if (pi === 0)
                    continue; // transparent
                // Dye system: palette indices 98-103 are dye slots
                // When dyeColor is provided, look up the 6 RGB colors from color0.tbl
                // When no dye, skip those indices (they're placeholders)
                let color;
                if (this.isDyeIndex(pi) && !noDyeSkip) {
                    if (dyeColor == null || !this.colorTable)
                        continue;
                    const entry = this.colorTable.get(dyeColor);
                    if (!entry)
                        continue;
                    const dyeIdx = pi - 98;
                    if (dyeIdx < 0 || dyeIdx >= entry.length)
                        continue;
                    color = entry[dyeIdx];
                }
                else {
                    color = palette[pi];
                }
                if (!color)
                    continue;
                // Skip magenta (255,0,255) — used as transparent marker in palm/body palettes
                // for facial feature placeholders (indices 10-15) meant to be overwritten by face layer
                if (color.r === 255 && color.g === 0 && color.b === 255)
                    continue;
                const cx = frame.left + x + ox;
                const cy = frame.top + y + oy;
                if (cx < 0 || cx >= CANVAS_W || cy < 0 || cy >= CANVAS_H)
                    continue;
                const off = (cy * CANVAS_W + cx) * 4;
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
    renderCharacter(appearance) {
        if (!this.initialized || !appearance)
            return null;
        if (appearance.isMonster)
            return null; // monsters use different sprite system
        // Check cache
        const cacheKey = JSON.stringify(appearance);
        if (this.renderCache[cacheKey])
            return this.renderCache[cacheKey];
        // Determine gender prefix: m=male, w=female
        // bodySprite: 16=male, 32=female, 128=male mount, 144=female mount
        const isFemale = appearance.bodySprite === 32 || appearance.bodySprite === 64 || appearance.bodySprite === 144;
        const g = isFemale ? 'w' : 'm';
        const canvasData = Buffer.alloc(CANVAS_W * CANVAS_H * 4, 0);
        const layers = [];
        // Per Dender — correct south-facing layer order (bottom to top):
        //   Head: F → Accessory: G → Body: B/M → Pants: N → Face: O → Boots: L →
        //   Head: H → Armor: U/I → Head: E → Weapon: W → Arms: A/J → Weapon: P →
        //   Shield: S → Accessory: C
        //
        // EPF file classification (from Dender):
        //   a=Arms1, j=Arms2, u=Armor1, i=Armor2, b=Body1, m=Body2,
        //   c=Accessory1, g=Accessory2, h=Head1, e=Head2, f=Head3,
        //   l=Boots, n=Underwear/Pants, o=Face, s=Shield, w=Weapon1, p=Weapon2
        //
        // Per Dender: i, j, g files use palette 0 instead of table lookup.
        // Per Dender: armor values > 999 use i/j files (subtract 999 for actual ID).
        //   IF ArmorId > 999 THEN {Type: 'i', Id: ArmorId - 999} ELSE {Type: 'u', Id: ArmorId}
        //   Same for arms: > 999 uses 'j' else 'a'
        // Draw offset for accessories and weapons (applies to all acc/weapon layers incl G, C, W, P)
        const ACC_OFFSET_X = -27;
        // Skin color index
        const skinIdx = appearance.skinColor || 0;
        // Per Dender: head 103 (Jester face) uses male sprites always
        const headGender = (isFemale && appearance.headSprite === 103) ? 'm' : g;
        // Per Dender: weapons 130/131 (Gold Kindjal, Nunchacku) use male sprites always
        const weaponGender = (isFemale && (appearance.weaponSprite === 130 || appearance.weaponSprite === 131)) ? 'm' : g;
        // Per Dender: body 128 (male) or 144 (female) = mount, use body sprite 5 instead of 1
        const isMount = appearance.bodySprite === 128 || appearance.bodySprite === 144;
        const bodyId = isMount ? 5 : 1;
        // Resolve armor type: > 999 means use i/j files with ID - 999, else u/a files
        const armorId = appearance.armorSprite || 0;
        const isHighArmor = armorId > 999;
        const resolvedArmorId = isHighArmor ? armorId - 1000 : armorId;
        const armorPrefix = isHighArmor ? 'i' : 'u';
        const armsPrefix = isHighArmor ? 'j' : 'a';
        // Resolve overcoat — same > 999 logic
        let resolvedOvercoat = 0;
        let overcoatType = 'u';
        if (appearance.overcoatSprite) {
            const rawOc = appearance.overcoatSprite;
            if (rawOc > 999) {
                resolvedOvercoat = rawOc - 1000;
                overcoatType = 'i';
            }
            else {
                resolvedOvercoat = rawOc;
                overcoatType = 'u';
            }
        }
        // ============================================================
        // Layer order (per Dender, south-facing, bottom to top):
        // ============================================================
        // 1. Head: F (Head3 — behind body)
        if (appearance.headSprite) {
            layers.push({ prefix: headGender + 'f', palLetter: 'h', id: appearance.headSprite, dyeColor: appearance.hairColor });
        }
        // 2. Accessory: G (Accessory2 — behind body)
        // Per Dender: G files use palette 0 instead of table lookup
        if (appearance.acc1Sprite) {
            layers.push({ prefix: g + 'g', id: appearance.acc1Sprite, dyeColor: appearance.acc1Color, ox: ACC_OFFSET_X });
        }
        if (appearance.acc2Sprite) {
            layers.push({ prefix: g + 'g', id: appearance.acc2Sprite, dyeColor: appearance.acc2Color, ox: ACC_OFFSET_X });
        }
        if (appearance.acc3Sprite) {
            layers.push({ prefix: g + 'g', id: appearance.acc3Sprite, dyeColor: appearance.acc3Color, ox: ACC_OFFSET_X });
        }
        // 3. Body: B/M — uses palm palette with blue index fix
        // noDyeSkip: render dye-range indices (98-103) as normal palette colors in body data
        layers.push({ prefix: g + 'm', palmIdx: skinIdx, id: bodyId, fixBlueIndices: true, noDyeSkip: true });
        // 4. Pants: N
        if (appearance.pantsColor) {
            layers.push({ prefix: g + 'n', palLetter: 'b', id: 1, dyeColor: appearance.pantsColor });
        }
        // 5. Face: O — uses palm palettes directly
        if (appearance.faceShape) {
            layers.push({ prefix: g + 'o', palmIdx: skinIdx, id: appearance.faceShape });
        }
        // 6. Boots: L
        if (appearance.bootsSprite) {
            layers.push({ prefix: g + 'l', palLetter: 'l', id: appearance.bootsSprite, dyeColor: appearance.bootsColor });
        }
        // 7. Head: H (Head1 — main hair/helmet layer)
        if (appearance.headSprite) {
            layers.push({ prefix: headGender + 'h', palLetter: 'h', id: appearance.headSprite, dyeColor: appearance.hairColor });
        }
        // 8. Armor: U/I
        if (resolvedOvercoat) {
            // Overcoat replaces armor
            // Per Dender: i files use palette 0 (no palLetter), u files use palLetter 'u'
            if (overcoatType === 'i') {
                layers.push({ prefix: g + 'i', id: resolvedOvercoat, dyeColor: appearance.overcoatColor });
            }
            else {
                layers.push({ prefix: g + 'u', palLetter: 'u', id: resolvedOvercoat, dyeColor: appearance.overcoatColor });
            }
        }
        else if (armorId) {
            // Per Dender: I files use palette 0 instead of table lookup
            if (isHighArmor) {
                layers.push({ prefix: g + 'i', id: resolvedArmorId });
            }
            else {
                layers.push({ prefix: g + 'u', palLetter: 'u', id: resolvedArmorId });
            }
        }
        // 9. Head: E (Head2 — front overlay, e.g. helmet visor)
        if (appearance.headSprite) {
            layers.push({ prefix: headGender + 'e', palLetter: 'e', id: appearance.headSprite, dyeColor: appearance.hairColor });
        }
        // 10. Weapon: W (Weapon1) — offset applies
        if (appearance.weaponSprite) {
            layers.push({ prefix: weaponGender + 'w', palLetter: 'w', id: appearance.weaponSprite, ox: ACC_OFFSET_X });
        }
        // 11. Arms: A/J — uses palm palette with blue index fix
        // Per Dender: J files use palette 0 instead of table lookup
        if (appearance.armsSprite) {
            if (isHighArmor) {
                layers.push({ prefix: g + 'j', palmIdx: skinIdx, id: appearance.armsSprite, fixBlueIndices: true });
            }
            else {
                layers.push({ prefix: g + 'a', palmIdx: skinIdx, id: appearance.armsSprite, fixBlueIndices: true });
            }
        }
        // 12. Weapon: P (Weapon2 — casting effects, e.g. burning weapon effect)
        // Uses same weapon sprite ID but P suffix files (e.g. mw26804.epf → mp268xx.epf)
        if (appearance.weaponSprite) {
            layers.push({ prefix: weaponGender + 'p', palLetter: 'w', id: appearance.weaponSprite, ox: ACC_OFFSET_X });
        }
        // 13. Shield: S — per Dender: shields use male sprites for both genders
        if (appearance.shieldSprite && appearance.shieldSprite !== 255) {
            layers.push({ prefix: 'ms', palLetter: 'p', id: appearance.shieldSprite });
        }
        // 14. Accessory: C (Accessory1 — front)
        if (appearance.acc1Sprite) {
            layers.push({ prefix: g + 'c', palLetter: 'c', id: appearance.acc1Sprite, dyeColor: appearance.acc1Color, ox: ACC_OFFSET_X });
        }
        if (appearance.acc2Sprite) {
            layers.push({ prefix: g + 'c', palLetter: 'c', id: appearance.acc2Sprite, dyeColor: appearance.acc2Color, ox: ACC_OFFSET_X });
        }
        if (appearance.acc3Sprite) {
            layers.push({ prefix: g + 'c', palLetter: 'c', id: appearance.acc3Sprite, dyeColor: appearance.acc3Color, ox: ACC_OFFSET_X });
        }
        let hasContent = false;
        // EPF suffix layout (from ChaosAssetManager EpfEquipmentEditorControl):
        //   '01' suffix = Walk, 10 frames: 0=north idle, 1-4=north walk, 5=south idle, 6-9=south walk
        //   '02' suffix = Assail, 4 frames: 0-1=north, 2-3=south
        //   'b'  suffix = Priest Cast (NOT walk!), 'c' = Warrior, 'd' = Monk, 'e' = Rogue, 'f' = Wizard
        // Use '01' suffix frame 5 (south-facing idle) for display.
        // Fall back to '02' suffix frame 2 (south-facing assail) if no walk file exists.
        const WALK_SOUTH_IDLE = 5; // in '01' suffix files — standing idle facing south
        const ASSAIL_SOUTH_FRAME = 2; // in '02' suffix files — south-facing assail
        for (const layer of layers) {
            // Try walk file first ('01' suffix) — frame 5 is south-facing idle
            let epf = this.findEpfByPrefixId(layer.prefix, layer.id, '01');
            let frameIdx = WALK_SOUTH_IDLE;
            // Fall back if walk file missing or frame is null/out of bounds
            if (!epf || frameIdx >= epf.frames.length || !epf.frames[frameIdx]) {
                epf = this.findEpfByPrefixId(layer.prefix, layer.id, '02');
                frameIdx = ASSAIL_SOUTH_FRAME;
                // If south-facing assail is also invalid, try frame 0
                if (epf && (frameIdx >= epf.frames.length || !epf.frames[frameIdx])) {
                    frameIdx = 0;
                }
            }
            if (!epf)
                continue;
            if (frameIdx >= epf.frames.length || !epf.frames[frameIdx])
                continue;
            // Palette resolution:
            //   palmIdx → direct palm palette (body, arms, face)
            //   palLetter → standard palette table lookup
            //   no palLetter → palette 0 (per Dender: i, j, g files use palette 0)
            let palette;
            if (layer.palmIdx !== undefined) {
                palette = this.palmPalettes[layer.palmIdx] || this.palmPalettes[0] || null;
            }
            else if (layer.palLetter) {
                palette = this.getPaletteForSprite(layer.palLetter, layer.id, isFemale);
            }
            else {
                // Files without a palLetter (g, i, j) use palette 0
                // Extract the layer letter from the prefix (2nd char) for loading the right pal file
                const layerLetter = layer.prefix.charAt(1);
                const palLookupLetter = layerLetter === 'g' ? 'c' : layerLetter === 'j' ? 'c' : layerLetter;
                palette = this.loadPalette(palLookupLetter, 0);
            }
            if (!palette)
                continue;
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
        if (!hasContent)
            return null;
        // Crop to content bounds
        let minX = CANVAS_W, minY = CANVAS_H, maxX = 0, maxY = 0;
        for (let y = 0; y < CANVAS_H; y++) {
            for (let x = 0; x < CANVAS_W; x++) {
                if (canvasData[(y * CANVAS_W + x) * 4 + 3] > 0) {
                    if (x < minX)
                        minX = x;
                    if (x > maxX)
                        maxX = x;
                    if (y < minY)
                        minY = y;
                    if (y > maxY)
                        maxY = y;
                }
            }
        }
        if (maxX < minX)
            return null;
        // Add 1px padding
        minX = Math.max(0, minX - 1);
        minY = Math.max(0, minY - 1);
        maxX = Math.min(CANVAS_W - 1, maxX + 1);
        maxY = Math.min(CANVAS_H - 1, maxY + 1);
        const cropW = maxX - minX + 1;
        const cropH = maxY - minY + 1;
        const png = new pngjs_1.PNG({ width: cropW, height: cropH });
        for (let y = 0; y < cropH; y++) {
            for (let x = 0; x < cropW; x++) {
                const srcOff = ((y + minY) * CANVAS_W + (x + minX)) * 4;
                const dstOff = (y * cropW + x) * 4;
                png.data[dstOff] = canvasData[srcOff];
                png.data[dstOff + 1] = canvasData[srcOff + 1];
                png.data[dstOff + 2] = canvasData[srcOff + 2];
                png.data[dstOff + 3] = canvasData[srcOff + 3];
            }
        }
        const result = pngjs_1.PNG.sync.write(png);
        // Cache the result (limit cache size)
        if (Object.keys(this.renderCache).length > 500) {
            const keys = Object.keys(this.renderCache);
            for (let i = 0; i < 100; i++)
                delete this.renderCache[keys[i]];
        }
        this.renderCache[cacheKey] = result;
        return result;
    }
    clearRenderCache() {
        this.renderCache = {};
        console.log('[SpriteRenderer] Render cache cleared');
    }
    getStats() {
        if (!this.initialized)
            return null;
        return {
            khanArchives: this.khanArchives.length,
            palTables: Object.keys(this.palTables).length,
            cachedPalettes: Object.keys(this.paletteCache).length,
            cachedEpfs: Object.keys(this.epfCache).length,
            cachedRenders: Object.keys(this.renderCache).length
        };
    }
}
exports.SpriteRenderer = SpriteRenderer;
let rendererInstance = null;
function getSpriteRenderer() {
    if (!rendererInstance) {
        rendererInstance = new SpriteRenderer();
    }
    return rendererInstance;
}
//# sourceMappingURL=sprite-renderer.js.map