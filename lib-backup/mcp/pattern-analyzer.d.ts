export interface PatternSuggestion {
    offset: number;
    length: number;
    suggestedType: string;
    suggestedName: string;
    confidence: 'high' | 'medium' | 'low';
    value: any;
    hex: string;
    reason: string;
}
export declare function analyzePacket(hexDump: string): PatternSuggestion[];
export declare function comparePackets(hexDumps: string[]): {
    fixedPositions: number[];
    variablePositions: number[];
    commonLength: boolean;
    lengths: number[];
    summary: string;
};
