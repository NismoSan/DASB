"use strict";

// ── Shared Message Splitting Utility ──────────────────────────────

var WHISPER_MAX = 64;
var SAY_MAX = 64;
function splitMessage(text, maxLen) {
  if (!maxLen) maxLen = WHISPER_MAX;
  if (text.length <= maxLen) return [text];
  var chunks = [];
  while (text.length > 0) {
    if (text.length <= maxLen) {
      chunks.push(text);
      break;
    }
    var slice = text.substring(0, maxLen);
    var lastSpace = slice.lastIndexOf(' ');
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
module.exports = {
  splitMessage: splitMessage,
  WHISPER_MAX: WHISPER_MAX,
  SAY_MAX: SAY_MAX
};