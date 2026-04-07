"use strict";

// ── Opcode Labels & Helpers ────────────────────────────────────────

var INCOMING_LABELS = {
  0x00: 'Encryption',
  0x02: 'LoginMessage',
  0x03: 'Redirect',
  0x04: 'MapLocation',
  0x05: 'UserId',
  0x07: 'AddEntity',
  0x08: 'RemoveEntity',
  0x0A: 'Chat',
  0x0B: 'WalkResponse',
  0x0C: 'EntityWalk',
  0x0D: 'PublicMessage',
  0x0E: 'RemoveEntity',
  0x11: 'EntityDirection',
  0x15: 'MapData',
  0x17: 'AddSpell',
  0x18: 'RemoveSpell',
  0x1A: 'Animation',
  0x29: 'AnimateEntity',
  0x2C: 'AddSkill',
  0x2D: 'RemoveSkill',
  0x31: 'MapDoor',
  0x33: 'ShowUser',
  0x34: 'PlayerProfile',
  0x37: 'AddItem',
  0x38: 'RemoveItem',
  0x39: 'UpdateStats',
  0x3A: 'HealthBar',
  0x36: 'UserList',
  0x3B: 'PingA',
  0x3C: 'MapTransfer',
  0x4C: 'EndingSignal',
  0x58: 'MapTransferComplete',
  0x67: 'MapChanging',
  0x68: 'PingB',
  0x6F: 'LightLevel',
  0x7E: 'Welcome'
};
var OUTGOING_LABELS = {
  0x00: 'Version',
  0x03: 'Login',
  0x05: 'RequestMapData',
  0x06: 'Walk',
  0x0B: 'EndingResponse',
  0x0E: 'Chat',
  0x10: 'ConfirmIdentity',
  0x11: 'Turn',
  0x18: 'RequestUserList',
  0x19: 'Whisper',
  0x1D: 'Emote',
  0x2D: 'EnterWorld',
  0x38: 'Refresh',
  0x43: 'UseSpell',
  0x45: 'PongA',
  0x57: 'EncryptAck',
  0x62: 'MagicBytes',
  0x75: 'PongB'
};
function getOpcodeLabel(direction, opcode) {
  var table = direction === 'in' ? INCOMING_LABELS : OUTGOING_LABELS;
  return table[opcode] || 'Unknown';
}
function getChatChannelName(_byte) {
  switch (_byte) {
    case 0:
      return 'Whisper';
    case 3:
      return 'System';
    case 5:
      return 'World Shout';
    case 11:
      return 'Group';
    case 12:
      return 'Guild';
    default:
      return 'Ch' + _byte;
  }
}
function getPublicMessageTypeName(_byte2) {
  switch (_byte2) {
    case 0:
      return 'Say';
    case 1:
      return 'Shout';
    case 2:
      return 'Chant';
    default:
      return 'Public';
  }
}
function toHex(value) {
  return '0x' + ('0' + value.toString(16).toUpperCase()).slice(-2);
}
var CLASS_NAMES = {
  0: 'Peasant',
  1: 'Warrior',
  2: 'Rogue',
  3: 'Wizard',
  4: 'Priest',
  5: 'Monk'
};
module.exports = {
  INCOMING_LABELS: INCOMING_LABELS,
  OUTGOING_LABELS: OUTGOING_LABELS,
  getOpcodeLabel: getOpcodeLabel,
  getChatChannelName: getChatChannelName,
  getPublicMessageTypeName: getPublicMessageTypeName,
  toHex: toHex,
  CLASS_NAMES: CLASS_NAMES
};