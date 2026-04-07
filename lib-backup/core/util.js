"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.random = random;
exports.toHex = toHex;
function random(max) {
    return Math.floor(Math.random() * (max + 1));
}
function toHex(number) {
    let hex = number.toString(16);
    hex = hex.length % 2 ? '0' + hex : hex;
    return hex.toUpperCase();
}
//# sourceMappingURL=util.js.map