"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAY_MAX = exports.WHISPER_MAX = void 0;
exports.splitMessage = splitMessage;
exports.WHISPER_MAX = 64;
exports.SAY_MAX = 64;
function splitMessage(text, maxLen) {
    if (!maxLen)
        maxLen = exports.WHISPER_MAX;
    if (text.length <= maxLen)
        return [text];
    const chunks = [];
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
        }
        else {
            chunks.push(slice);
            text = text.substring(maxLen);
        }
    }
    return chunks;
}
//# sourceMappingURL=message-utils.js.map