import { FieldDef } from '../core/opcodes';
export interface DecodedField {
    name: string;
    type: string;
    value: any;
    hex: string;
    offset: number;
    length: number;
}
export declare function hexToBytes(hex: string): number[];
export declare function bytesToHex(bytes: number[]): string;
export declare function decodePacket(hexDump: string, fieldDefs: FieldDef[]): DecodedField[];
