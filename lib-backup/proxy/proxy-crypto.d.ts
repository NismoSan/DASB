import Crypto, { isEncryptOpcode, isDecryptOpcode, isSpecialEncryptOpcode, isSpecialDecryptOpcode } from '../core/crypto';
import Packet from '../core/packet';
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
    constructor(seed?: number, key?: string, name?: string);
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
    decryptClientPacket(packet: Packet): void;
    /**
     * Encrypt a packet to send TO a game CLIENT (server->client direction).
     * Server packets have:
     *   [sequence:u8] [encrypted_payload...] [bRandLo^0x74:u8] [sRand^0x24:u8] [bRandHi^0x64:u8]
     *
     * No MD5 checksum (only client->server has that).
     * No trailing 0x00/opcode padding (only client->server has that).
     */
    encryptServerPacket(packet: Packet): void;
}
export { isEncryptOpcode, isDecryptOpcode, isSpecialEncryptOpcode, isSpecialDecryptOpcode };
