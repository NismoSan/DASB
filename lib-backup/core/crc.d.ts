declare const dialogCRCTable: number[];
declare const nexonCRC16Table: number[];
declare function calculateCRC16(buffer: number[], index?: number, length?: number): number;
export { dialogCRCTable, nexonCRC16Table, calculateCRC16 };
