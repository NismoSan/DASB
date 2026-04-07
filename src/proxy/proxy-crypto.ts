import Crypto, { isEncryptOpcode, isDecryptOpcode, isSpecialEncryptOpcode, isSpecialDecryptOpcode } from '../core/crypto';
import Packet from '../core/packet';
import { uint8, uint16 } from '../core/datatypes';
import { random } from '../core/util';

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
export default class ProxyCrypto extends Crypto {
    constructor(seed?: number, key?: string, name?: string) {
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
    decryptClientPacket(packet: Packet): void {
        if (!isEncryptOpcode(packet.opcode)) {
            return;
        }

        // First byte is sequence
        packet.sequence = packet.body.shift()!;

        const useHashKey = isSpecialEncryptOpcode(packet.opcode);

        // Last 3 bytes are encoded bRand/sRand (client XOR masks)
        const bRandLo = packet.body[packet.body.length - 3];
        const sRand = packet.body[packet.body.length - 2];
        const bRandHi = packet.body[packet.body.length - 1];
        const a = uint16((bRandHi << 8) | bRandLo) ^ 0x7470; // client uses 0x7470
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
        } else if (packet.body.length >= 1) {
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
    encryptServerPacket(packet: Packet): void {
        if (!isDecryptOpcode(packet.opcode)) {
            return;
        }

        const useHashKey = isSpecialDecryptOpcode(packet.opcode);

        // Generate random bRand and sRand
        let a = uint16(random(65534 - 256) + 256); // bRand: 256..65534
        let b = uint8(random(254 - 100) + 100);    // sRand: 100..254

        const key = useHashKey ? this.generateSpecialKey(a, b) : Buffer.from(this.key);

        // XOR transform the payload
        packet.body = this.transform(packet.body, key, packet.sequence);

        // Encode bRand/sRand with server XOR masks
        a ^= 0x6474;
        b ^= 0x24;

        // Prepend sequence, append bRand/sRand trailer
        packet.body.unshift(packet.sequence);
        packet.body.push(uint8(a), b, uint8(a >> 8));
    }
}

export { isEncryptOpcode, isDecryptOpcode, isSpecialEncryptOpcode, isSpecialDecryptOpcode };
