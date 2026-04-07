"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.int16 = int16;
exports.int32 = int32;
exports.int8 = int8;
exports.uint16 = uint16;
exports.uint32 = uint32;
exports.uint8 = uint8;
function uint8(value) {
  return value & 0xFF;
}
function int8(value) {
  return (value & 0xFF) << 24 >> 24;
}
function uint16(value) {
  return value & 0xFFFF;
}
function int16(value) {
  return (value & 0xFFFF) << 16 >> 16;
}
function uint32(value) {
  return value >>> 0;
}
function int32(value) {
  return value | 0;
}