// @ts-nocheck
import { DYE_COLORS, SKIN_COLORS } from './appearance-reference';

type AssetMapUiDeps = {
  navLinks: any,
};

export function createAssetMapUi(deps: AssetMapUiDeps) {
  var navLinks = deps.navLinks;

  var AM_LAYERS = [
    { z: 0,  prefix: 'g',   name: 'Accessories 2 (behind body)', field: 'acc1/2/3Sprite', palLetter: 'c', palNote: 'remapped from g', dyeable: true, dyeField: 'accColor', archive: 'khanm/wad.dat', offset: 'X: -27' },
    { z: 1,  prefix: 'f',   name: 'Head 3 (behind body)',        field: 'armorSprite',     palLetter: 'f', palNote: '',               dyeable: false, dyeField: '',          archive: 'khanm/weh.dat', offset: '—',      note: 'New armor system only; skipped if headSprite set or overcoat equipped' },
    { z: 2,  prefix: 'b',   name: 'Body 1 (base)',               field: 'bodySprite',      palLetter: 'b', palNote: '',               dyeable: false, dyeField: '',          archive: 'khanm/wad.dat', offset: '—',      note: 'Always ID 1' },
    { z: 3,  prefix: 'l',   name: 'Boots',                       field: 'bootsSprite',     palLetter: 'l', palNote: '',               dyeable: true,  dyeField: 'bootsColor', archive: 'khanm/wim.dat', offset: '—' },
    { z: 4,  prefix: 'u',   name: 'Armor 1 (undergarment)',      field: 'armorSprite',     palLetter: 'u', palNote: '',               dyeable: false, dyeField: '',          archive: 'khanm/wtz.dat', offset: '—',      note: 'Skipped when overcoat is equipped' },
    { z: 5,  prefix: 'i/e', name: 'Armor 2 overlay / Overcoat',  field: 'armorSprite or overcoatSprite', palLetter: 'i or e', palNote: 'i=old armor, e=new armor', dyeable: true, dyeField: 'overcoatColor', archive: 'khanm/wim.dat or khanm/weh.dat', offset: '—', note: 'Overcoat replaces armor entirely; IDs 1000+ need offset subtraction (-1000 or -999)' },
    { z: 6,  prefix: 'a',   name: 'Arms 1',                      field: 'armsSprite',      palLetter: 'b', palNote: 'remapped from a', dyeable: false, dyeField: '',          archive: 'khanm/wad.dat', offset: '—' },
    { z: 7,  prefix: 'o',   name: 'Faces',                       field: 'faceShape',       palLetter: 'palm[skinColor]', palNote: 'direct lookup, no table', dyeable: false, dyeField: '', archive: 'khanm/wns.dat', offset: '—', note: 'Uses palm palettes indexed by skinColor; magenta (255,0,255) = transparent' },
    { z: 8,  prefix: 's',   name: 'Shields',                     field: 'shieldSprite',    palLetter: 'p', palNote: 'remapped from s', dyeable: false, dyeField: '',          archive: 'khanm/wns.dat', offset: '—',      note: 'Value 255 (0xFF) = no shield sentinel' },
    { z: 9,  prefix: 'h',   name: 'Head 2 / Hair',               field: 'headSprite',      palLetter: 'h', palNote: '',               dyeable: true,  dyeField: 'hairColor', archive: 'khanm/weh.dat', offset: '—' },
    { z: 10, prefix: 'c',   name: 'Accessories 1 (front)',       field: 'acc1/2/3Sprite',  palLetter: 'c', palNote: '',               dyeable: true,  dyeField: 'accColor',  archive: 'khanm/wad.dat', offset: 'X: -27', note: 'Same IDs as layer 0 (g) but drawn in front' },
    { z: 11, prefix: 'w',   name: 'Weapons 1',                   field: 'weaponSprite',    palLetter: 'w', palNote: '',               dyeable: false, dyeField: '',          archive: 'khanm/wtz.dat', offset: 'X: -27' }
  ];

  var AM_EQUIPMENT = [
    { field: 'bodySprite',    type: 'b',   name: 'Body',        palLetter: 'b', archive: 'khanm/wad.dat', dyeable: false, dyeField: '—',            filePattern: '[g]b001[suffix].epf',       notes: 'Always ID 1. Values: 16=Male (0x10), 32=Female (0x20), 64=Other (0x40). Gender prefix: m or w.' },
    { field: 'armorSprite',   type: 'u/i/e', name: 'Armor',     palLetter: 'u, i, e', archive: 'khanm/wtz + khanm/wim + khanm/weh', dyeable: false, dyeField: '—', filePattern: '[g]u[ID][suffix].epf + [g]i/e[ID][suffix].epf', notes: 'u = undergarment, i = old overlay, e = new overlay. New armor IDs have me###.epf files. Armor also triggers f (behind-body head) layer.' },
    { field: 'armsSprite',    type: 'a',   name: 'Arms',        palLetter: 'b (remapped)', archive: 'khanm/wad.dat', dyeable: false, dyeField: '—', filePattern: '[g]a[ID][suffix].epf', notes: 'Palette letter remaps a → b.' },
    { field: 'bootsSprite',   type: 'l',   name: 'Boots',       palLetter: 'l', archive: 'khanm/wim.dat', dyeable: true, dyeField: 'bootsColor',    filePattern: '[g]l[ID][suffix].epf',      notes: '' },
    { field: 'weaponSprite',  type: 'w',   name: 'Weapon',      palLetter: 'w', archive: 'khanm/wtz.dat', dyeable: false, dyeField: '—',            filePattern: '[g]w[ID][suffix].epf',      notes: 'Draw offset X: -27. Also has type p (casting) variant.' },
    { field: 'shieldSprite',  type: 's',   name: 'Shield',      palLetter: 'p (remapped)', archive: 'khanm/wns.dat', dyeable: false, dyeField: '—', filePattern: '[g]s[ID][suffix].epf', notes: 'Palette letter remaps s → p. Value 255 = no shield.' },
    { field: 'headSprite',    type: 'h',   name: 'Hair/Head',   palLetter: 'h', archive: 'khanm/weh.dat', dyeable: true, dyeField: 'hairColor',     filePattern: '[g]h[ID][suffix].epf',      notes: 'When set, suppresses armor head layers (e, f).' },
    { field: 'faceShape',     type: 'o',   name: 'Face',        palLetter: 'palm[skinColor]', archive: 'khanm/wns.dat', dyeable: false, dyeField: '—', filePattern: '[g]o[ID][suffix].epf', notes: 'Direct palm palette lookup (no .tbl). Palette remaps o → m. Magenta pixels = transparent placeholder.' },
    { field: 'overcoatSprite', type: 'u/i/e', name: 'Overcoat', palLetter: 'u, i, e', archive: 'khanm/wtz + khanm/wim + khanm/weh', dyeable: true, dyeField: 'overcoatColor', filePattern: '[g]u/i/e[ID][suffix].epf', notes: 'Replaces armor entirely. IDs 1000+ need offset subtraction (-1000 or -999) to find actual EPF.' },
    { field: 'acc1Sprite',    type: 'c/g', name: 'Accessory 1', palLetter: 'c', archive: 'khanm/wad.dat', dyeable: true, dyeField: 'acc1Color',     filePattern: '[g]c[ID][suffix].epf',      notes: 'Rendered in both front (c, z10) and behind-body (g, z0) layers. Draw offset X: -27.' },
    { field: 'acc2Sprite',    type: 'c/g', name: 'Accessory 2', palLetter: 'c', archive: 'khanm/wad.dat', dyeable: true, dyeField: 'acc2Color',     filePattern: '[g]c[ID][suffix].epf',      notes: 'Same as acc1Sprite — separate slot, same file lookup.' },
    { field: 'acc3Sprite',    type: 'c/g', name: 'Accessory 3', palLetter: 'c', archive: 'khanm/wad.dat', dyeable: true, dyeField: 'acc3Color',     filePattern: '[g]c[ID][suffix].epf',      notes: 'Same as acc1Sprite — separate slot, same file lookup.' }
  ];

  var AM_ARCHIVES = [
    { name: 'khanmad.dat', gender: 'Male',   range: 'a–d', types: 'Arms 1 (a), Body 1 (b), Accessories 1 (c), (d unused)' },
    { name: 'khanmeh.dat', gender: 'Male',   range: 'e–h', types: 'Head 1/front (e), Head 3/behind (f), Accessories 2/behind (g), Head 2/hair (h)' },
    { name: 'khanmim.dat', gender: 'Male',   range: 'i–m', types: 'Armor 2 overlay (i), Arms 2 (j), Boots (l), Body 2 (m)' },
    { name: 'khanmns.dat', gender: 'Male',   range: 'n–s', types: 'Pants (n), Faces (o), Weapons 2/casting (p), (q/r unused), Shields (s)' },
    { name: 'khanmtz.dat', gender: 'Male',   range: 't–z', types: 'Armor 1/undergarment (u), (v/x/y unused), Weapons 1 (w)' },
    { name: 'khanwad.dat', gender: 'Female', range: 'a–d', types: '(same as male)' },
    { name: 'khanweh.dat', gender: 'Female', range: 'e–h', types: '(same as male)' },
    { name: 'khanwim.dat', gender: 'Female', range: 'i–m', types: '(same as male)' },
    { name: 'khanwns.dat', gender: 'Female', range: 'n–s', types: '(same as male)' },
    { name: 'khanwtz.dat', gender: 'Female', range: 't–z', types: '(same as male)' },
    { name: 'khanpal.dat', gender: 'Both',   range: '—',   types: 'All palettes: palb, palc, pale, palf, palh, pali, pall, palp, palu, palw, palm0–palm9' }
  ];

  var AM_ANIMATIONS = [
    { suffix: '(none)', desc: 'Base / idle frame', frames: 'Varies' },
    { suffix: '01',     desc: 'Walk / Idle',       frames: '10: [0]=N idle, [1-4]=N walk, [5]=S idle, [6-9]=S walk' },
    { suffix: '02',     desc: 'Assail / Attack',    frames: '4: [0-1]=N assail, [2-3]=S assail' },
    { suffix: '03',     desc: 'Emote',              frames: 'Varies per emote type' },
    { suffix: '04',     desc: 'Idle Animation',     frames: 'Varies' },
    { suffix: 'b',      desc: 'Priest Cast',        frames: '14: various priest/bard animations' },
    { suffix: 'c',      desc: 'Warrior',            frames: '30: two-handed, jump, swipe attacks' },
    { suffix: 'd',      desc: 'Monk',               frames: '18: kick, punch, heavy kick' },
    { suffix: 'e',      desc: 'Rogue',              frames: '36: stab, double stab, bow, volley' },
    { suffix: 'f',      desc: 'Wizard',             frames: '12: wizard cast, summoner cast' }
  ];

  var AM_PAL_REMAP = [
    { from: 'a (Arms 1)',          to: 'b', note: 'Arms use body palettes' },
    { from: 'g (Accessories 2)',   to: 'c', note: 'Behind-body accessories use front accessory palettes' },
    { from: 'j (Arms 2)',          to: 'c', note: 'Secondary arms use accessory palettes' },
    { from: 'o (Faces)',           to: 'palm[skinColor]', note: 'Direct palm palette lookup, no table; indexed by skinColor 0-9' },
    { from: 's (Shields)',         to: 'p', note: 'Shields use weapon-casting palettes' }
  ];

  var AM_OVERRIDE_FIELDS = [
    { key: 'bodySprite',     label: 'Body',        palHint: 'b' },
    { key: 'headSprite',     label: 'Hair/Head',    palHint: 'h' },
    { key: 'faceShape',      label: 'Face',         palHint: 'palm' },
    { key: 'armorSprite',    label: 'Armor',        palHint: 'u/i/e' },
    { key: 'armsSprite',     label: 'Arms',         palHint: 'b' },
    { key: 'bootsSprite',    label: 'Boots',        palHint: 'l' },
    { key: 'weaponSprite',   label: 'Weapon',       palHint: 'w' },
    { key: 'shieldSprite',   label: 'Shield',       palHint: 'p' },
    { key: 'overcoatSprite', label: 'Overcoat',     palHint: 'i/e' },
    { key: 'acc1Sprite',     label: 'Accessory 1',  palHint: 'c' },
    { key: 'acc2Sprite',     label: 'Accessory 2',  palHint: 'c' },
    { key: 'acc3Sprite',     label: 'Accessory 3',  palHint: 'c' },
    { key: 'hairColor',      label: 'Hair Color',   palHint: 'dye' },
    { key: 'skinColor',      label: 'Skin Color',   palHint: '0-9' },
    { key: 'bootsColor',     label: 'Boots Color',  palHint: 'dye' },
    { key: 'overcoatColor',  label: 'Overcoat Color', palHint: 'dye' },
    { key: 'acc1Color',      label: 'Acc1 Color',   palHint: 'dye' },
    { key: 'acc2Color',      label: 'Acc2 Color',   palHint: 'dye' },
    { key: 'acc3Color',      label: 'Acc3 Color',   palHint: 'dye' },
    { key: 'pantsColor',     label: 'Pants Color',  palHint: 'dye' }
  ];

  function renderAmLayers() { /* placeholder replaced below */ }
  function renderAmEquipment() { /* placeholder replaced below */ }
  function renderAmArchives() { /* placeholder replaced below */ }
  function renderAmPalettes() { /* placeholder replaced below */ }
  function renderAmAnimations() { /* placeholder replaced below */ }
  function renderAmBody() { /* placeholder replaced below */ }
  function renderAmDyes() { /* placeholder replaced below */ }
  function renderAmSkin() { /* placeholder replaced below */ }

  renderAmLayers = function () {
    var el = document.getElementById('am-layers');
    var html = '<h3>Rendering Layer Order (back → front)</h3>';
    html += '<p>The sprite renderer composites these layers in order. Layer 0 is drawn first (behind everything), layer 11 is drawn last (on top).</p>';
    html += '<div class="am-layer-stack">';
    for (var i = AM_LAYERS.length - 1; i >= 0; i--) {
      var L = AM_LAYERS[i];
      html += '<div class="am-layer-bar">';
      html += '<span class="am-z">' + L.z + '</span>';
      html += '<span class="am-prefix">' + L.prefix + '</span>';
      html += '<span class="am-name">' + L.name + '</span>';
      if (L.dyeable) html += '<span class="am-dye-tag">dyeable</span>';
      html += '<span class="am-field">' + L.field + '</span>';
      html += '</div>';
    }
    html += '</div>';
    html += '<h4>Detailed Layer Reference</h4>';
    html += '<div style="overflow-x:auto"><table class="am-table"><thead><tr>';
    html += '<th>Z</th><th>Prefix</th><th>Layer</th><th>Appearance Field</th><th>Palette</th><th>Dyeable</th><th>Offset</th><th>Notes</th>';
    html += '</tr></thead><tbody>';
    for (var j = 0; j < AM_LAYERS.length; j++) {
      var R = AM_LAYERS[j];
      html += '<tr><td><code>' + R.z + '</code></td><td><code>' + R.prefix + '</code></td>';
      html += '<td>' + R.name + '</td><td><code>' + R.field + '</code></td>';
      html += '<td><code>' + R.palLetter + '</code>' + (R.palNote ? ' <span class="note">(' + R.palNote + ')</span>' : '') + '</td>';
      html += '<td>' + (R.dyeable ? '<span class="am-dye-tag">Yes</span> <code>' + R.dyeField + '</code>' : '—') + '</td>';
      html += '<td><code>' + R.offset + '</code></td>';
      html += '<td>' + (R.note || '') + '</td></tr>';
    }
    html += '</tbody></table></div>';
    html += '<h4>Key Notes</h4><ul>';
    html += '<li>Accessories render in <strong>both</strong> behind-body (g, z0) and front (c, z10) layers</li>';
    html += '<li>Overcoat replaces armor entirely — skips u (undergarment) and armor overlay layers</li>';
    html += '<li>New armor system: IDs with <code>me###01.epf</code> files use <code>e/f</code> prefixes instead of <code>i</code></li>';
    html += '<li>Shield value <code>255</code> (0xFF) is a sentinel for "no shield"</li>';
    html += '<li>Overcoat IDs 1000+ need offset subtraction (try -1000, then -999) to locate the actual EPF file</li>';
    html += '<li>Renderer uses walk suffix <code>01</code> frame 5 (south idle) for display, falls back to assail suffix <code>02</code> frame 2</li>';
    html += '</ul>';
    el.innerHTML = html;
  };

  renderAmEquipment = function () {
    var el = document.getElementById('am-equipment');
    var html = '<h3>Equipment Slot Mapping</h3>';
    html += '<p>Maps each <code>appearance</code> field (from 0x33 ShowUser packets) to ChaosAssetManager type letters, archive files, and rendering details.</p>';
    html += '<div style="overflow-x:auto"><table class="am-table"><thead><tr>';
    html += '<th>Field</th><th>Type</th><th>Name</th><th>Palette</th><th>Archive(s)</th><th>Dyeable</th><th>Dye Field</th><th>File Pattern</th><th>Notes</th>';
    html += '</tr></thead><tbody>';
    for (var i = 0; i < AM_EQUIPMENT.length; i++) {
      var E = AM_EQUIPMENT[i];
      html += '<tr><td><code>' + E.field + '</code></td><td><code>' + E.type + '</code></td>';
      html += '<td>' + E.name + '</td><td><code>' + E.palLetter + '</code></td>';
      html += '<td><code>' + E.archive + '</code></td>';
      html += '<td>' + (E.dyeable ? '<span class="am-dye-tag">Yes</span>' : '—') + '</td>';
      html += '<td>' + (E.dyeable ? '<code>' + E.dyeField + '</code>' : '—') + '</td>';
      html += '<td><code>' + E.filePattern + '</code></td>';
      html += '<td>' + E.notes + '</td></tr>';
    }
    html += '</tbody></table></div>';
    html += '<h4>File Naming Convention</h4><ul>';
    html += '<li>Pattern: <code>[gender][type][ID:3digits][animSuffix].epf</code></li>';
    html += '<li>Gender prefix: <code>m</code> = Male, <code>w</code> = Female</li>';
    html += '<li>ID: Zero-padded 3 digits (001–999)</li>';
    html += '<li>Example: <code>mu025</code> = Male Armor undergarment ID 25, <code>wa003b</code> = Female Arms ID 3, Priest animation</li>';
    html += '</ul>';
    el.innerHTML = html;
  };

  renderAmArchives = function () {
    var el = document.getElementById('am-archives');
    var html = '<h3>Archive File Reference</h3>';
    html += '<p>Dark Ages stores sprites in <code>.dat</code> archive files. Each archive contains EPF sprite files and is organized by equipment type letter range and gender.</p>';
    html += '<table class="am-table"><thead><tr>';
    html += '<th>Archive</th><th>Gender</th><th>Letter Range</th><th>Equipment Types Contained</th>';
    html += '</tr></thead><tbody>';
    for (var i = 0; i < AM_ARCHIVES.length; i++) {
      var A = AM_ARCHIVES[i];
      html += '<tr><td><code>' + A.name + '</code></td><td>' + A.gender + '</td>';
      html += '<td><code>' + A.range + '</code></td><td>' + A.types + '</td></tr>';
    }
    html += '</tbody></table>';
    html += '<h4>Archive Path</h4>';
    html += '<p>Archives are read from <code>DA_PATH</code> env var (default: <code>C:/Program Files (x86)/KRU/Dark Ages</code>)</p>';
    html += '<h4>Archive Format</h4><ul>';
    html += '<li>Header: <code>UInt32LE</code> entry count</li>';
    html += '<li>Each entry: <code>UInt32LE</code> offset + 13-byte null-terminated ASCII name</li>';
    html += '<li>Entry data starts at the recorded offset; size = next offset - current offset</li>';
    html += '</ul>';
    el.innerHTML = html;
  };

  renderAmPalettes = function () {
    var el = document.getElementById('am-palettes');
    var html = '<h3>Palette System</h3>';
    html += '<h4>Palette Letter Remapping</h4>';
    html += '<p>Some equipment types use palettes from a different letter. The renderer looks up <code>pal[letter]</code> in <code>khanpal.dat</code>.</p>';
    html += '<table class="am-table"><thead><tr><th>Equipment Type</th><th>Uses Palette</th><th>Reason</th></tr></thead><tbody>';
    for (var i = 0; i < AM_PAL_REMAP.length; i++) {
      var P = AM_PAL_REMAP[i];
      html += '<tr><td><code>' + P.from + '</code></td><td><code>' + P.to + '</code></td><td>' + P.note + '</td></tr>';
    }
    html += '</tbody></table>';
    html += '<h4>Palette File Format (.pal)</h4><ul>';
    html += '<li>256 RGB color entries = 768 bytes per palette</li>';
    html += '<li>Each entry: 3 bytes (R, G, B), index 0-255</li>';
    html += '<li>Stored inside <code>khanpal.dat</code> as entries named <code>pal[letter][number].pal</code></li>';
    html += '</ul>';
    html += '<h4>Palette Table Format (.tbl)</h4><ul>';
    html += '<li>Text format, one mapping per line</li>';
    html += '<li>2-column: <code>spriteId paletteNum</code> — maps sprite ID to palette number</li>';
    html += '<li>3-column: <code>spriteId paletteNum genderOverride</code> — gender: <code>-1</code> = male only, <code>-2</code> = female only</li>';
    html += '<li>Range: <code>minId maxId paletteNum</code> — applies palette to all IDs in range</li>';
    html += '<li>Stored in <code>khanpal.dat</code> as <code>pal[letter].tbl</code></li>';
    html += '</ul>';
    html += '<h4>Dye System</h4><ul>';
    html += '<li>Palette indices <strong>98–103</strong> are the 6 dye color slots</li>';
    html += '<li><code>color0.tbl</code> from <code>legend.dat</code> maps a <code>dyeColor</code> byte (0–70) to 6 RGB values</li>';
    html += '<li>When rendering, the dye replaces palette indices 98–103 with the 6 colors from the dye table</li>';
    html += '<li>Dyeable equipment: Boots (bootsColor), Hair (hairColor), Overcoat (overcoatColor), Accessories (accColor), Pants (pantsColor 0–15)</li>';
    html += '</ul>';
    html += '<h4>Palm Palettes (Skin/Face)</h4><ul>';
    html += '<li>Faces use <code>palm[skinColor].pal</code> — direct lookup by skin color ID (0–9), no table</li>';
    html += '<li>Magenta pixels (R:255, G:0, B:255) in palm palettes are transparent placeholders for face layer compositing</li>';
    html += '</ul>';
    el.innerHTML = html;
  };

  renderAmAnimations = function () {
    var el = document.getElementById('am-animations');
    var html = '<h3>Animation Reference</h3>';
    html += '<h4>EPF Animation Suffixes</h4>';
    html += '<p>Each equipment ID can have multiple EPF files with different suffixes for different animations.</p>';
    html += '<table class="am-table"><thead><tr><th>Suffix</th><th>Animation</th><th>Frame Layout</th></tr></thead><tbody>';
    for (var i = 0; i < AM_ANIMATIONS.length; i++) {
      var A = AM_ANIMATIONS[i];
      html += '<tr><td><code>' + A.suffix + '</code></td><td>' + A.desc + '</td><td>' + A.frames + '</td></tr>';
    }
    html += '</tbody></table>';
    html += '<h4>Direction System</h4><ul>';
    html += '<li>4 directions: Up (North), Right (East), Down (South), Left (West)</li>';
    html += '<li>Up/Left share animation frames; Right/Down share frames (horizontally flipped)</li>';
    html += '<li>Walk files (suffix 01): frames 0-4 = North, frames 5-9 = South</li>';
    html += '<li>Assail files (suffix 02): frames 0-1 = North, frames 2-3 = South</li>';
    html += '</ul>';
    html += '<h4>Renderer Display Frame</h4><ul>';
    html += '<li>Primary: Walk suffix <code>01</code>, frame index <strong>5</strong> (south-facing idle)</li>';
    html += '<li>Fallback: Assail suffix <code>02</code>, frame index <strong>2</strong> (south-facing assail)</li>';
    html += '<li>Last resort: frame index <strong>0</strong></li>';
    html += '</ul>';
    html += '<h4>EPF File Format</h4><ul>';
    html += '<li>Header: <code>UInt16LE</code> frame count + padding + <code>UInt32LE</code> TOC address</li>';
    html += '<li>Pixel data starts at byte 12</li>';
    html += '<li>TOC (Table of Contents): 16 bytes per frame — top, left, bottom, right (Int16LE), startAddress, endAddress (UInt32LE)</li>';
    html += '<li>Frame dimensions: width = right - left, height = bottom - top</li>';
    html += '<li>Each pixel is a palette index (1 byte)</li>';
    html += '</ul>';
    el.innerHTML = html;
  };

  renderAmBody = function () {
    var el = document.getElementById('am-body');
    var html = '<h3>Body & Gender Reference</h3>';
    html += '<h4>Body Sprite Values</h4>';
    html += '<table class="am-table"><thead><tr><th>Value</th><th>Hex</th><th>Gender</th><th>File Prefix</th><th>Body EPF</th></tr></thead><tbody>';
    html += '<tr><td><code>16</code></td><td><code>0x10</code></td><td>Male</td><td><code>m</code></td><td><code>mb001[suffix].epf</code></td></tr>';
    html += '<tr><td><code>32</code></td><td><code>0x20</code></td><td>Female</td><td><code>w</code></td><td><code>wb001[suffix].epf</code></td></tr>';
    html += '<tr><td><code>64</code></td><td><code>0x40</code></td><td>Other</td><td><code>w</code></td><td><code>wb001[suffix].epf</code> (treated as female)</td></tr>';
    html += '</tbody></table>';
    html += '<h4>Gender Determination in Renderer</h4><ul>';
    html += '<li>Code: <code>const isFemale = appearance.bodySprite === 32 || appearance.bodySprite === 64</code></li>';
    html += '<li>Gender prefix <code>g</code> = <code>isFemale ? "w" : "m"</code></li>';
    html += '<li>All equipment EPF lookups use this prefix: <code>[g][type][ID][suffix].epf</code></li>';
    html += '</ul>';
    html += '<h4>Canvas Dimensions</h4><ul>';
    html += '<li>Render canvas: <strong>111 × 85</strong> pixels</li>';
    html += '<li>Output is auto-cropped to content bounds with 1px padding</li>';
    html += '<li>Result is PNG-compressed</li>';
    html += '</ul>';
    html += '<h4>Transparency</h4><ul>';
    html += '<li>Magenta (R:255, G:0, B:255) in palm/body palettes = transparent</li>';
    html += '<li>Used as placeholder for face layer compositing in body sprites</li>';
    html += '<li><code>isTranslucent</code> field exists in appearance data but is not currently rendered differently</li>';
    html += '</ul>';
    el.innerHTML = html;
  };

  renderAmDyes = function () {
    var el = document.getElementById('am-dyes');
    var html = '<h3>Dye Color Table</h3>';
    html += '<p>71 dye colors (IDs 0–70). These map to palette indices 98–103 via <code>color0.tbl</code> in <code>legend.dat</code>.</p>';
    html += '<div class="am-dye-grid">';
    for (var id = 0; id <= 70; id++) {
      var c = DYE_COLORS[id];
      if (!c) continue;
      html += '<div class="am-dye-chip">';
      html += '<div class="am-dye-swatch" style="background:' + c.hex + '"></div>';
      html += '<span class="am-dye-id">' + id + '</span>';
      html += '<span class="am-dye-name">' + c.name + '</span>';
      html += '<span class="am-dye-hex">' + c.hex + '</span>';
      html += '</div>';
    }
    html += '</div>';
    html += '<h4>Dye Application</h4><ul>';
    html += '<li>Equipment with a dye field (bootsColor, hairColor, overcoatColor, accColor, pantsColor) uses palette index remapping</li>';
    html += '<li>Palette indices 98–103 are replaced with the 6 RGB colors looked up from <code>color0.tbl</code> by dye ID</li>';
    html += '<li>Pants (pantsColor) only supports IDs 0–15 to avoid interfering with body shape</li>';
    html += '</ul>';
    el.innerHTML = html;
  };

  renderAmSkin = function () {
    var el = document.getElementById('am-skin');
    var html = '<h3>Skin, Hair & Face Reference</h3>';
    html += '<h4>Skin Colors (skinColor: 0–9)</h4>';
    html += '<p>The <code>skinColor</code> value selects which <code>palm[N].pal</code> palette is used for the face layer.</p>';
    html += '<div class="am-skin-grid">';
    for (var id = 0; id <= 9; id++) {
      var name = SKIN_COLORS[id] || 'Unknown';
      html += '<div class="am-dye-chip"><span class="am-dye-id">' + id + '</span><span class="am-dye-name">' + name + '</span></div>';
    }
    html += '</div>';
    html += '<h4>Hair (headSprite + hairColor)</h4><ul>';
    html += '<li>Hair sprite: <code>[g]h[headSprite][suffix].epf</code></li>';
    html += '<li>Hair color: dye applied via <code>hairColor</code> (0–70, see Dye Colors tab)</li>';
    html += '<li>Palette letter: <code>h</code> (uses <code>palh.tbl</code> for palette lookup)</li>';
    html += '<li>When <code>headSprite</code> is set, it suppresses armor head layers (e, f)</li>';
    html += '</ul>';
    html += '<h4>Face (faceShape + skinColor)</h4><ul>';
    html += '<li>Face sprite: <code>[g]o[faceShape][suffix].epf</code></li>';
    html += '<li>Palette: <code>palm[skinColor].pal</code> — direct lookup, no table file</li>';
    html += '<li>Palette letter remaps: o → m (but uses palm direct lookup, not palm.tbl)</li>';
    html += '<li>Magenta pixels (255,0,255) in palm palettes are transparent placeholders</li>';
    html += '</ul>';
    html += '<h4>Appearance Data Types</h4>';
    html += '<table class="am-table"><thead><tr><th>Field</th><th>Type</th><th>Range</th><th>Notes</th></tr></thead><tbody>';
    html += '<tr><td><code>headSprite</code></td><td>number</td><td>0–999+</td><td>0 = no hair/head</td></tr>';
    html += '<tr><td><code>faceShape</code></td><td>byte</td><td>0–255</td><td>Face sprite ID</td></tr>';
    html += '<tr><td><code>skinColor</code></td><td>byte</td><td>0–9</td><td>Indexes palm palette</td></tr>';
    html += '<tr><td><code>hairColor</code></td><td>byte</td><td>0–70</td><td>Dye color ID</td></tr>';
    html += '<tr><td><code>armorSprite</code></td><td>UInt16</td><td>0–65535</td><td>Armor sprite ID</td></tr>';
    html += '<tr><td><code>armsSprite</code></td><td>UInt16</td><td>0–65535</td><td>Arms sprite ID</td></tr>';
    html += '<tr><td><code>bootsSprite</code></td><td>UInt16</td><td>0–65535</td><td>Boots sprite ID</td></tr>';
    html += '<tr><td><code>weaponSprite</code></td><td>UInt16</td><td>0–65535</td><td>Weapon sprite ID</td></tr>';
    html += '<tr><td><code>shieldSprite</code></td><td>byte</td><td>0–255</td><td>255 = no shield</td></tr>';
    html += '<tr><td><code>overcoatSprite</code></td><td>UInt16</td><td>0–65535</td><td>1000+ needs offset</td></tr>';
    html += '<tr><td><code>acc1/2/3Sprite</code></td><td>UInt16</td><td>0–65535</td><td>Accessory sprite IDs</td></tr>';
    html += '<tr><td><code>pantsColor</code></td><td>byte</td><td>0–15</td><td>Limited range for pants</td></tr>';
    html += '</tbody></table>';
    el.innerHTML = html;
  };

  var amOverrideAppearance = null;
  var amOverrideOriginal = null;
  var amOverrideDebounceTimer = null;

  function renderAmOverride() {
    var el = document.getElementById('am-override');
    var html = '<h3>Sprite Override Tester</h3>';
    html += '<p>Load a player\'s appearance, modify individual sprite IDs, and preview the result. Useful for testing "what if this armor showed sprite X?"</p>';
    html += '<div class="am-override-load">';
    html += '<input type="text" id="am-override-name" placeholder="Player name...">';
    html += '<button class="btn" id="am-override-load-btn">Load</button>';
    html += '</div>';
    html += '<div class="am-override-wrap">';
    html += '<div class="am-override-form" id="am-override-fields"></div>';
    html += '<div class="am-override-preview" id="am-override-preview"><p style="color:var(--text-muted);font-size:0.8rem;">Load a player to begin</p></div>';
    html += '</div>';
    el.innerHTML = html;

    document.getElementById('am-override-load-btn').addEventListener('click', function () {
      var name = document.getElementById('am-override-name').value.trim();
      if (!name) return;
      fetch('/api/appearance/' + encodeURIComponent(name))
        .then(function (r) { return r.ok ? r.json() : Promise.reject('Player not found'); })
        .then(function (app) {
          amOverrideOriginal = JSON.parse(JSON.stringify(app));
          amOverrideAppearance = app;
          renderOverrideFields();
          renderOverridePreview();
        })
        .catch(function (err) {
          document.getElementById('am-override-fields').innerHTML = '<p style="color:#ff6666;">Could not load player: ' + err + '</p>';
        });
    });

    document.getElementById('am-override-name').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') document.getElementById('am-override-load-btn').click();
    });
  }

  function readOverrideFieldsIntoAppearance() {
    var el = document.getElementById('am-override-fields');
    if (!el || !amOverrideAppearance) return;
    var inputs = el.querySelectorAll('input[data-key]');
    for (var j = 0; j < inputs.length; j++) {
      amOverrideAppearance[inputs[j].getAttribute('data-key')] = parseInt(inputs[j].value, 10) || 0;
    }
  }

  function triggerLivePreview() {
    readOverrideFieldsIntoAppearance();
    if (amOverrideDebounceTimer) clearTimeout(amOverrideDebounceTimer);
    amOverrideDebounceTimer = setTimeout(function () {
      renderOverridePreview();
    }, 300);
  }

  function renderOverrideFields() {
    var el = document.getElementById('am-override-fields');
    var html = '';
    for (var i = 0; i < AM_OVERRIDE_FIELDS.length; i++) {
      var F = AM_OVERRIDE_FIELDS[i];
      var val = amOverrideAppearance[F.key] || 0;
      html += '<div class="am-override-row">';
      html += '<label>' + F.label + '</label>';
      html += '<input type="number" data-key="' + F.key + '" value="' + val + '" min="0">';
      if (F.key === 'headSprite') {
        html += '<button type="button" class="btn am-browse-btn" id="am-browse-head" onclick="window.__openSpriteBrowser(\'head\')" title="Browse all hair/head sprites">Browse</button>';
      }
      if (F.key === 'armorSprite') {
        html += '<button type="button" class="btn am-browse-btn" id="am-browse-armor" onclick="window.__openSpriteBrowser(\'armor\')" title="Browse all armor sprites">Browse</button>';
      }
      html += '<span class="am-pal-hint">pal: ' + F.palHint + '</span>';
      html += '</div>';
    }
    html += '<div class="am-override-btns">';
    html += '<button class="btn" id="am-override-render-btn">Render Preview</button>';
    html += '<button class="btn" id="am-override-reset-btn">Reset</button>';
    html += '<button class="btn am-override-save-btn" id="am-override-save-btn">Save Override</button>';
    html += '<button class="btn am-override-delete-btn" id="am-override-delete-btn">Delete Override</button>';
    html += '</div>';
    html += '<div id="am-override-status" class="am-override-status"></div>';
    el.innerHTML = html;

    var inputs = el.querySelectorAll('input[data-key]');
    for (var j = 0; j < inputs.length; j++) {
      inputs[j].addEventListener('input', triggerLivePreview);
    }

    document.getElementById('am-override-render-btn').addEventListener('click', function () {
      readOverrideFieldsIntoAppearance();
      renderOverridePreview();
    });

    document.getElementById('am-override-reset-btn').addEventListener('click', function () {
      if (amOverrideOriginal) {
        amOverrideAppearance = JSON.parse(JSON.stringify(amOverrideOriginal));
        renderOverrideFields();
        renderOverridePreview();
      }
    });

    document.getElementById('am-override-save-btn').addEventListener('click', function () {
      var name = document.getElementById('am-override-name').value.trim();
      if (!name || !amOverrideAppearance || !amOverrideOriginal) return;
      readOverrideFieldsIntoAppearance();

      var diff = {};
      for (var k = 0; k < AM_OVERRIDE_FIELDS.length; k++) {
        var key = AM_OVERRIDE_FIELDS[k].key;
        var cur = amOverrideAppearance[key] || 0;
        var orig = amOverrideOriginal[key] || 0;
        if (cur !== orig) {
          diff[key] = cur;
        }
      }

      if (Object.keys(diff).length === 0) {
        showOverrideStatus('No changes to save', 'warn');
        return;
      }

      fetch('/api/sprite-overrides/' + encodeURIComponent(name), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(diff)
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.ok) {
            showOverrideStatus('Override saved for ' + name + ' (' + Object.keys(diff).join(', ') + ')', 'ok');
          } else {
            showOverrideStatus('Error: ' + (data.error || 'unknown'), 'err');
          }
        })
        .catch(function (err) { showOverrideStatus('Save failed: ' + err, 'err'); });
    });

    document.getElementById('am-override-delete-btn').addEventListener('click', function () {
      var name = document.getElementById('am-override-name').value.trim();
      if (!name) return;
      fetch('/api/sprite-overrides/' + encodeURIComponent(name), { method: 'DELETE' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.ok) {
            showOverrideStatus('Override deleted for ' + name, 'ok');
          } else {
            showOverrideStatus(data.error || 'No override found', 'warn');
          }
        })
        .catch(function (err) { showOverrideStatus('Delete failed: ' + err, 'err'); });
    });

    window.__openSpriteBrowser = function (type) {
      console.log('[Browse] Button clicked for', type, 'amOverrideAppearance=', !!amOverrideAppearance);
      if (amOverrideAppearance) openSpriteBrowser(type);
      else console.warn('[Browse] No player loaded yet');
    };

    checkExistingOverride();
  }

  var BROWSE_CONFIG = {
    head: {
      title: 'Hair / Head Browser',
      idsEndpoint: '/api/sprite/head-ids/',
      previewEndpoint: '/api/sprite/head-preview/',
      fieldKey: 'headSprite',
      overrideKey: 'headSprite'
    },
    armor: {
      title: 'Armor / Overcoat Browser',
      idsEndpoint: '/api/sprite/armor-ids/',
      previewEndpoint: '/api/sprite/armor-preview/',
      fieldKey: 'armorSprite',
      overrideKey: 'armorSprite',
      isOvercoatAware: true
    }
  };

  function openSpriteBrowser(type) {
    var config = BROWSE_CONFIG[type];
    if (!config) { console.error('[Browse] Unknown type:', type); return; }
    console.log('[Browse] Opening', type, 'browser');

    var genderParam = (amOverrideAppearance.bodySprite === 32 || amOverrideAppearance.bodySprite === 64 || amOverrideAppearance.bodySprite === 144) ? 'f' : 'm';
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
    var modal = document.createElement('div');
    modal.style.cssText = 'background:#1e1e2e;border:1px solid #333;border-radius:8px;width:90vw;max-width:900px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;';
    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:1rem;padding:0.75rem 1rem;border-bottom:1px solid #333;';
    header.innerHTML = '<h3 style="margin:0;font-size:1rem;flex:1;color:#eee;">' + config.title + '</h3><span style="color:#888;font-size:0.8rem;">Click to select</span>';
    var closeBtn = document.createElement('button');
    closeBtn.textContent = '\u00D7';
    closeBtn.style.cssText = 'background:none;border:none;color:#ccc;font-size:1.4rem;cursor:pointer;padding:0 0.3rem;';
    closeBtn.onclick = function () { document.body.removeChild(overlay); };
    header.appendChild(closeBtn);
    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:6px;padding:1rem;overflow-y:auto;';
    grid.innerHTML = '<p style="color:#888">Loading sprites...</p>';
    modal.appendChild(header);
    modal.appendChild(grid);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    overlay.onclick = function (e) { if (e.target === overlay) document.body.removeChild(overlay); };

    var url = config.idsEndpoint + genderParam;
    console.log('[Browse] Fetching', url);

    fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        console.log('[Browse] Got', data.ids ? data.ids.length : 0, 'sprite IDs');
        if (!data.ids || data.ids.length === 0) {
          grid.innerHTML = '<p style="color:#f66">No sprites found</p>';
          return;
        }

        var minApp = {
          bodySprite: amOverrideAppearance.bodySprite || 0,
          headSprite: amOverrideAppearance.headSprite || 0,
          skinColor: amOverrideAppearance.skinColor || 0,
          faceShape: amOverrideAppearance.faceShape || 0,
          hairColor: amOverrideAppearance.hairColor || 0
        };
        var baseParam = encodeURIComponent(JSON.stringify(minApp));
        var currentVal = amOverrideAppearance[config.fieldKey] || 0;
        var html = '';

        for (var i = 0; i < data.ids.length; i++) {
          var sid = data.ids[i];
          var borderColor = (sid === currentVal) ? '#6fc' : 'transparent';
          html += '<div class="am-sprite-pick" data-sid="' + sid + '" style="display:flex;flex-direction:column;align-items:center;padding:4px;border:2px solid ' + borderColor + ';border-radius:6px;cursor:pointer;background:#111;">';
          html += '<img src="' + config.previewEndpoint + sid + '.png?base=' + baseParam + '" loading="lazy" style="width:64px;height:64px;object-fit:contain;image-rendering:pixelated;" alt="' + sid + '">';
          html += '<span style="font-size:0.7rem;color:#888;margin-top:2px;">' + sid + '</span>';
          html += '</div>';
        }
        grid.innerHTML = html;

        var items = grid.querySelectorAll('.am-sprite-pick');
        for (var j = 0; j < items.length; j++) {
          (function (item) {
            item.onclick = function () {
              var spriteId = parseInt(item.getAttribute('data-sid'), 10);
              console.log('[Browse] Selected', type, spriteId, 'fieldKey=', config.fieldKey);
              var input = document.querySelector('input[data-key="' + config.fieldKey + '"]');
              console.log('[Browse] Input element found:', !!input);
              if (input) {
                if (config.isOvercoatAware && spriteId > 999) {
                  amOverrideAppearance.overcoatSprite = spriteId;
                  amOverrideAppearance.armorSprite = 0;
                  var ocInput = document.querySelector('input[data-key="overcoatSprite"]');
                  var arInput = document.querySelector('input[data-key="armorSprite"]');
                  if (ocInput) ocInput.value = spriteId;
                  if (arInput) arInput.value = 0;
                  console.log('[Browse] Set overcoatSprite =', spriteId, ', armorSprite = 0');
                  showOverrideStatus('Selected overcoat ' + spriteId, 'ok');
                } else if (config.isOvercoatAware) {
                  amOverrideAppearance.armorSprite = spriteId;
                  amOverrideAppearance.overcoatSprite = 0;
                  var ocInput2 = document.querySelector('input[data-key="overcoatSprite"]');
                  var arInput2 = document.querySelector('input[data-key="armorSprite"]');
                  if (arInput2) arInput2.value = spriteId;
                  if (ocInput2) ocInput2.value = 0;
                  console.log('[Browse] Set armorSprite =', spriteId, ', overcoatSprite = 0');
                  showOverrideStatus('Selected armor ' + spriteId, 'ok');
                } else {
                  input.value = spriteId;
                  amOverrideAppearance[config.fieldKey] = spriteId;
                  console.log('[Browse] Set', config.fieldKey, '=', spriteId);
                }
                renderOverridePreview();
              }
              for (var k = 0; k < items.length; k++) items[k].style.borderColor = 'transparent';
              item.style.borderColor = '#6fc';
              setTimeout(function () {
                if (overlay.parentNode) document.body.removeChild(overlay);
              }, 300);
            };
          })(items[j]);
        }
      })
      .catch(function (err) {
        console.error('[Browse] Error:', err);
        grid.innerHTML = '<p style="color:#f66">Failed to load: ' + err + '</p>';
      });
  }

  function showOverrideStatus(msg, type) {
    var el = document.getElementById('am-override-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'am-override-status am-override-status-' + (type || 'ok');
    clearTimeout(el._timer);
    el._timer = setTimeout(function () { el.textContent = ''; }, 4000);
  }

  function checkExistingOverride() {
    var name = document.getElementById('am-override-name').value.trim();
    if (!name) return;
    fetch('/api/sprite-overrides/' + encodeURIComponent(name))
      .then(function (r) {
        if (r.ok) return r.json();
        return null;
      })
      .then(function (ov) {
        if (ov) {
          var fields = Object.keys(ov).filter(function (k) { return k !== '_name'; });
          showOverrideStatus('Has saved override: ' + fields.join(', '), 'ok');
        }
      })
      .catch(function () {});
  }

  function renderOverridePreview() {
    var el = document.getElementById('am-override-preview');
    if (!amOverrideAppearance) {
      el.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;">Load a player to begin</p>';
      return;
    }
    console.log('[Preview] Rendering with appearance:', JSON.stringify(amOverrideAppearance));
    el.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;">Rendering...</p>';
    fetch('/api/sprite/render-custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(amOverrideAppearance)
    })
      .then(function (r) {
        console.log('[Preview] Response status:', r.status);
        if (!r.ok) throw new Error('Render failed: ' + r.status);
        return r.blob();
      })
      .then(function (blob) {
        console.log('[Preview] Got blob, size:', blob.size);
        var url = URL.createObjectURL(blob);
        el.innerHTML = '<img src="' + url + '" alt="Override preview" title="Custom render" style="image-rendering:pixelated;">';
      })
      .catch(function (err) {
        console.error('[Preview] Error:', err);
        el.innerHTML = '<p style="color:#ff6666;font-size:0.8rem;">Could not render sprite</p>';
      });
  }

  var amInitialized = false;

  document.querySelectorAll('.am-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.am-tab').forEach(function (t) { t.classList.remove('active'); });
      document.querySelectorAll('.am-section').forEach(function (s) { s.classList.remove('active'); });
      tab.classList.add('active');
      document.getElementById(tab.getAttribute('data-section')).classList.add('active');
    });
  });

  for (var ami = 0; ami < navLinks.length; ami++) {
    if (navLinks[ami].getAttribute('data-panel') === 'assetmap') {
      navLinks[ami].addEventListener('click', function () {
        if (!amInitialized) {
          renderAmLayers();
          renderAmEquipment();
          renderAmArchives();
          renderAmPalettes();
          renderAmAnimations();
          renderAmBody();
          renderAmDyes();
          renderAmSkin();
          renderAmOverride();
          amInitialized = true;
        }
      });
    }
  }
}
