interface ArchiveEntry {
    name: string;
    offset: number;
    size: number;
}
interface Archive {
    buf: Buffer;
    entries: ArchiveEntry[];
    count: number;
    nameMap: Record<string, ArchiveEntry>;
}
interface EpfFrame {
    top: number;
    left: number;
    bottom: number;
    right: number;
    width: number;
    height: number;
    pixelOffset: number;
    dataSize: number;
}
interface Epf {
    frameCount: number;
    frames: (EpfFrame | null)[];
    data: Buffer;
}
interface PaletteColor {
    r: number;
    g: number;
    b: number;
    _id?: string;
}
type Palette = PaletteColor[];
interface PalTable {
    overrides: Record<number, number>;
    maleOverrides: Record<number, number>;
    femaleOverrides: Record<number, number>;
    entries: Record<number, number>;
}
export declare class SpriteRenderer {
    daPath: string;
    khanArchives: Archive[];
    khanpal: Archive | null;
    palTables: Record<string, PalTable>;
    paletteCache: Record<string, Palette>;
    epfCache: Record<string, Epf | null>;
    colorTable: Map<number, PaletteColor[]> | null;
    palmPalettes: Record<number, Palette>;
    initialized: boolean;
    renderCache: Record<string, Buffer>;
    constructor(daPath?: string);
    init(): boolean;
    findEpf(fileName: string): Epf | null;
    findEpfByPrefixId(prefix: string, id: number, suffix: string): Epf | null;
    loadPalette(letter: string, idx: number): Palette | null;
    getPaletteForSprite(letter: string, spriteId: number, isFemale: boolean): Palette | null;
    applySkinColor(basePalette: Palette, skinColor: number): Palette;
    fixPalmBlueIndices(palmPalette: Palette, skinColor: number): Palette;
    isDyeIndex(paletteIndex: number): boolean;
    drawFrame(canvasData: Buffer, epf: Epf, frameIdx: number, palette: Palette, dyeColor?: number, offsetX?: number, offsetY?: number, noDyeSkip?: boolean): void;
    renderCharacter(appearance: any): Buffer | null;
    clearRenderCache(): void;
    getStats(): {
        khanArchives: number;
        palTables: number;
        cachedPalettes: number;
        cachedEpfs: number;
        cachedRenders: number;
    } | null;
}
export declare function getSpriteRenderer(): SpriteRenderer;
export {};
