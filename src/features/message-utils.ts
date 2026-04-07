export const WHISPER_MAX = 64;
export const SAY_MAX = 64;

export function splitMessage(text: string, maxLen?: number): string[] {
  if (!maxLen) maxLen = WHISPER_MAX;
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  while (text.length > 0) {
    if (text.length <= maxLen) {
      chunks.push(text);
      break;
    }
    const slice = text.substring(0, maxLen);
    const lastSpace = slice.lastIndexOf(' ');
    if (lastSpace > maxLen * 0.3) {
      chunks.push(text.substring(0, lastSpace));
      text = text.substring(lastSpace + 1);
    } else {
      chunks.push(slice);
      text = text.substring(maxLen);
    }
  }
  return chunks;
}
