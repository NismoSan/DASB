import EventEmitter from 'events';
export declare const opcodeEvents: EventEmitter<any>;
declare const INCOMING_LABELS: Record<number, string>;
declare const OUTGOING_LABELS: Record<number, string>;
export interface FieldDef {
    name: string;
    type: string;
    length?: string;
    description?: string;
}
export declare function reloadFromXml(): void;
export declare function getOpcodeLabel(direction: 'in' | 'out', opcode: number): string;
export declare function getChatChannelName(byte: number): string;
export declare function getPublicMessageTypeName(byte: number): string;
declare function toHex(value: number): string;
export declare const CLASS_NAMES: Record<number, string>;
export declare function getFieldDefinitions(direction: 'in' | 'out', opcode: number): FieldDef[] | undefined;
export declare function getAllOpcodes(): {
    direction: string;
    opcode: number;
    name: string;
    fields?: FieldDef[];
}[];
export { INCOMING_LABELS, OUTGOING_LABELS, toHex };
