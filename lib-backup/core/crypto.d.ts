declare function isSpecialEncryptOpcode(opcode: number): boolean;
declare function isSpecialDecryptOpcode(opcode: number): boolean;
export declare function isEncryptOpcode(opcode: number): boolean;
export declare function isDecryptOpcode(opcode: number): boolean;
export default class Crypto {
    seed: number;
    key: string;
    name: string | undefined;
    salt: number[];
    specialKeyTable: Buffer | undefined;
    constructor(seed?: number, key?: string, name?: string);
    encrypt(packet: {
        opcode: number;
        body: number[];
        sequence: number;
    }): void;
    decrypt(packet: {
        opcode: number;
        body: number[];
        sequence: number;
    }): void;
    transform(buffer: number[], key: Buffer | number[], sequence: number): number[];
    generateSalt(): void;
    generateSpecialKey(a: number, b: number): number[];
    generateSpecialKeyTable(): void;
}
export { isSpecialEncryptOpcode, isSpecialDecryptOpcode };
