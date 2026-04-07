export function uint8(value: number): number {
  return value & 0xFF;
}

export function int8(value: number): number {
  return (value & 0xFF) << 24 >> 24;
}

export function uint16(value: number): number {
  return value & 0xFFFF;
}

export function int16(value: number): number {
  return (value & 0xFFFF) << 16 >> 16;
}

export function uint32(value: number): number {
  return value >>> 0;
}

export function int32(value: number): number {
  return value | 0;
}
