export function random(max: number): number {
  return Math.floor(Math.random() * (max + 1));
}

export function toHex(number: number): string {
  let hex = number.toString(16);
  hex = hex.length % 2 ? '0' + hex : hex;
  return hex.toUpperCase();
}
