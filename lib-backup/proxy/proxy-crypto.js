"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSpecialDecryptOpcode = exports.isSpecialEncryptOpcode = exports.isDecryptOpcode = exports.isEncryptOpcode = void 0;
const crypto_1 = __importStar(require("../core/crypto"));
Object.defineProperty(exports, "isEncryptOpcode", { enumerable: true, get: function () { return crypto_1.isEncryptOpcode; } });
Object.defineProperty(exports, "isDecryptOpcode", { enumerable: true, get: function () { return crypto_1.isDecryptOpcode; } });
Object.defineProperty(exports, "isSpecialEncryptOpcode", { enumerable: true, get: function () { return crypto_1.isSpecialEncryptOpcode; } });
Object.defineProperty(exports, "isSpecialDecryptOpcode", { enumerable: true, get: function () { return crypto_1.isSpecialDecryptOpcode; } });
const datatypes_1 = require("../core/datatypes");
const util_1 = require("../core/util");
/**
 * ProxyCrypto extends the base Crypto class with the two additional operations
 * needed for a MITM proxy:
 *
 * Existing (inherited):
 *   encrypt()  - encrypts client->server packets (adds MD5 + bRand/sRand with 0x7470/0x23)
 *   decrypt()  - decrypts server->client packets (reads bRand/sRand with 0x6474/0x24)
 *
 * New:
 *   decryptClientPacket() - decrypts client->server packets (strips MD5 + bRand/sRand with 0x7470/0x23)
 *   encryptServerPacket() - encrypts server->client packets (adds bRand/sRand with 0x6474/0x24, no MD5)
 */
class ProxyCrypto extends crypto_1.default {
    constructor(seed, key, name) {
        super(seed, key, name);
    }
    /**
     * Decrypt a packet that was encrypted by a game CLIENT (client->server direction).
     * Client packets have:
     *   [sequence:u8] [encrypted_payload...] [md5[13]:u8] [md5[3]:u8] [md5[11]:u8] [md5[7]:u8] [bRandLo^0x70:u8] [sRand^0x23:u8] [bRandHi^0x74:u8]
     *
     * For static-key packets (no hash key):
     *   [sequence:u8] [encrypted_payload...] [md5[13]:u8] [md5[3]:u8] [md5[11]:u8] [md5[7]:u8] [bRandLo^0x70:u8] [sRand^0x23:u8] [bRandHi^0x74:u8]
     *   but bRand/sRand are not used for key generation (static key used instead)
     *
     * For unencrypted opcodes (0x00, 0x10, 0x48): no transformation at all.
     */
    decryptClientPacket(packet) {
        if (!(0, crypto_1.isEncryptOpcode)(packet.opcode)) {
            return;
        }
        // First byte is sequence
        packet.sequence = packet.body.shift();
        const useHashKey = (0, crypto_1.isSpecialEncryptOpcode)(packet.opcode);
        // Last 3 bytes are encoded bRand/sRand (client XOR masks)
        const bRandLo = packet.body[packet.body.length - 3];
        const sRand = packet.body[packet.body.length - 2];
        const bRandHi = packet.body[packet.body.length - 1];
        const a = (0, datatypes_1.uint16)((bRandHi << 8) | bRandLo) ^ 0x7470; // client uses 0x7470
        const b = sRand ^ 0x23; // client uses 0x23
        // Strip bRand/sRand trailer (3 bytes)
        packet.body = packet.body.slice(0, packet.body.length - 3);
        // Strip MD5 checksum (4 bytes before bRand/sRand)
        packet.body = packet.body.slice(0, packet.body.length - 4);
        // Generate the appropriate key
        const key = useHashKey ? this.generateSpecialKey(a, b) : Buffer.from(this.key);
        // XOR transform (same algorithm, self-inverse)
        packet.body = this.transform(packet.body, key, packet.sequence);
        // After decryption, strip the trailing padding
        // Format after transform: [dialog_header?] [payload] [0x00] [opcode?]
        if (useHashKey && packet.body.length >= 2) {
            // Hash-key packets have: [payload...] [0x00] [opcode]
            // Strip trailing opcode byte and 0x00 padding
            packet.body = packet.body.slice(0, packet.body.length - 2);
        }
        else if (packet.body.length >= 1) {
            // Static-key packets have: [payload...] [0x00]
            packet.body = packet.body.slice(0, packet.body.length - 1);
        }
    }
    /**
     * Encrypt a packet to send TO a game CLIENT (server->client direction).
     * Server packets have:
     *   [sequence:u8] [encrypted_payload...] [bRandLo^0x74:u8] [sRand^0x24:u8] [bRandHi^0x64:u8]
     *
     * No MD5 checksum (only client->server has that).
     * No trailing 0x00/opcode padding (only client->server has that).
     */
    encryptServerPacket(packet) {
        if (!(0, crypto_1.isDecryptOpcode)(packet.opcode)) {
            return;
        }
        const useHashKey = (0, crypto_1.isSpecialDecryptOpcode)(packet.opcode);
        // Generate random bRand and sRand
        let a = (0, datatypes_1.uint16)((0, util_1.random)(65534 - 256) + 256); // bRand: 256..65534
        let b = (0, datatypes_1.uint8)((0, util_1.random)(254 - 100) + 100); // sRand: 100..254
        const key = useHashKey ? this.generateSpecialKey(a, b) : Buffer.from(this.key);
        // XOR transform the payload
        packet.body = this.transform(packet.body, key, packet.sequence);
        // Encode bRand/sRand with server XOR masks
        a ^= 0x6474;
        b ^= 0x24;
        // Prepend sequence, append bRand/sRand trailer
        packet.body.unshift(packet.sequence);
        packet.body.push((0, datatypes_1.uint8)(a), b, (0, datatypes_1.uint8)(a >> 8));
    }
}
exports.default = ProxyCrypto;
//# sourceMappingURL=proxy-crypto.js.map