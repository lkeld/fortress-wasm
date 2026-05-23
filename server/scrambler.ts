import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import * as crypto from 'crypto';
// @ts-ignore
import { OpCode } from '../compiler/dist/opcodes.js';

// Load server signing key dynamically
function loadServerSigningKey(): crypto.KeyObject {
    const keyPath = path.join(__dirname, '.signing_key');
    let privateKeyDer: Buffer;
    if (fs.existsSync(keyPath)) {
        privateKeyDer = fs.readFileSync(keyPath);
    } else {
        const pair = crypto.generateKeyPairSync('ed25519', {
            privateKeyEncoding: { format: 'der', type: 'pkcs8' }
        });
        privateKeyDer = pair.privateKey;
        fs.writeFileSync(keyPath, privateKeyDer);
    }
    return crypto.createPrivateKey({
        key: privateKeyDer,
        format: 'der',
        type: 'pkcs8'
    });
}

/**
 * Exposes generateHandshake returning a base64-encoded header value containing the concatenated raw fields
 */
export function generateHandshake(clientPublicKey: Uint8Array | Buffer): { handshakeHeader: string, sessionKey: Uint8Array } {
    const serverPrivateKey = loadServerSigningKey();

    // Generate fresh X25519 ephemeral key pair
    const serverEphemeral = crypto.generateKeyPairSync('x25519');
    const serverEphemeralPublicKeyRaw = serverEphemeral.publicKey.export({ type: 'spki', format: 'der' }).subarray(12);

    const clientPublicKeyObject = crypto.createPublicKey({
        key: Buffer.concat([
            Buffer.from('302a300506032b656e032100', 'hex'),
            Buffer.from(clientPublicKey)
        ]),
        format: 'der',
        type: 'spki'
    });

    const sharedSecret = crypto.diffieHellman({
        privateKey: serverEphemeral.privateKey,
        publicKey: clientPublicKeyObject
    });

    const sessionId = crypto.randomBytes(8).toString('hex'); // 16-byte hex string
    const nonce = crypto.randomBytes(32); // 32-random-byte session nonce
    const timestamp = Math.floor(Date.now() / 1000).toString().padStart(10, '0'); // 10-byte zero-padded timestamp string

    const sessionKey = crypto.hkdfSync(
        'sha256',
        sharedSecret,
        nonce,
        Buffer.from(sessionId, 'utf8'),
        32
    );

    const signBuffer = Buffer.concat([
        Buffer.from(sessionId, 'utf8'),
        serverEphemeralPublicKeyRaw,
        nonce,
        Buffer.from(timestamp, 'utf8')
    ]);
    const signature = crypto.sign(null, signBuffer, serverPrivateKey);

    const handshakeHeader = Buffer.concat([
        Buffer.from(sessionId, 'utf8'),
        nonce,
        Buffer.from(timestamp, 'utf8'),
        serverEphemeralPublicKeyRaw,
        signature
    ]);

    return {
        handshakeHeader: handshakeHeader.toString('base64'),
        sessionKey: new Uint8Array(sessionKey)
    };
}

/**
 * Dynamically scrambles a compiled .fvbc payload for a specific user session.
 * 
 * @param fvbcPath Path to the compiled .fvbc file
 * @param originalMapPath Path to the original opcode_map.json
 * @param clientPublicKeyOrSessionKey Client X25519 public key (32 bytes) or provided session key (legacy)
 * @returns { payload: Uint8Array, newMap: number[], pngBuffer: Buffer, handshakeHeader: Buffer }
 */
export function scrambleSessionPayload(
    fvbcPath: string, 
    originalMapPath: string, 
    clientPublicKeyOrSessionKey?: Uint8Array | Buffer
): { payload: Uint8Array, newMap: number[], pngBuffer: Buffer, handshakeHeader: Buffer } {
    const originalBytecode = fs.readFileSync(fvbcPath);
    const originalMap: number[] = JSON.parse(fs.readFileSync(originalMapPath, 'utf8'));

    const newMap = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
        const j = crypto.randomBytes(4).readUInt32LE(0) % (i + 1);
        const temp = newMap[i];
        newMap[i] = newMap[j];
        newMap[j] = temp;
    }

    const newInverseMap = new Array(256);
    for (let i = 0; i < 256; i++) {
        newInverseMap[newMap[i]] = i;
    }

    let sessionKey = new Uint8Array(32);
    let handshakeHeaderBytes = Buffer.alloc(0);

    if (process.env.DEV_MODE === 'true') {
        // In dev mode, keep sessionKey as all zeros to match the VM's default/uninitialized state
        handshakeHeaderBytes = Buffer.alloc(0);
    } else if (clientPublicKeyOrSessionKey && clientPublicKeyOrSessionKey.length === 32) {
        // Check if it matches a valid DH handshake public key or legacy manual key
        try {
            const handshake = generateHandshake(clientPublicKeyOrSessionKey);
            sessionKey = handshake.sessionKey as any;
            handshakeHeaderBytes = Buffer.from(handshake.handshakeHeader, 'base64');
        } catch (e) {
            // Legacy manual key fallback if key parsing failed
            for (let i = 0; i < 32; i++) {
                sessionKey[i] = clientPublicKeyOrSessionKey[i];
            }
        }
    } else {
        // Generate random client key pair for DH derivation
        const dummyClient = crypto.generateKeyPairSync('x25519');
        const dummyClientPublic = dummyClient.publicKey.export({ type: 'spki', format: 'der' }).subarray(12);
        const handshake = generateHandshake(dummyClientPublic);
        sessionKey = handshake.sessionKey as any;
        handshakeHeaderBytes = Buffer.from(handshake.handshakeHeader, 'base64');
    }

    const newBytecode = new Uint8Array(originalBytecode.length);
    let i = 0;
    while (i < originalBytecode.length) {
        const currentByte = originalBytecode[i];
        const standardOpcode = originalMap[currentByte];
        const newByte = newMap[standardOpcode];
        newBytecode[i] = newByte;
        i++;

        if (standardOpcode === OpCode.PushString) {
            const nonce = new Uint8Array(crypto.randomBytes(4));
            for (let j = 0; j < 4; j++) {
                if (i < originalBytecode.length) {
                    newBytecode[i] = nonce[j];
                    i++;
                }
            }
            let len = 0;
            if (i + 3 < originalBytecode.length) {
                len = originalBytecode[i] | (originalBytecode[i+1] << 8) | (originalBytecode[i+2] << 16) | (originalBytecode[i+3] << 24);
                for (let j = 0; j < 4; j++) {
                    newBytecode[i] = originalBytecode[i];
                    i++;
                }
            }
            const keystream = new Uint8Array(len);
            {
                let offset = 0;
                let blockIndex = 0;
                while (offset < len) {
                    const hasher = crypto.createHash('sha256');
                    hasher.update(sessionKey);
                    hasher.update(nonce);
                    const blockBuf = Buffer.alloc(4);
                    blockBuf.writeUInt32LE(blockIndex);
                    hasher.update(blockBuf);
                    const block = hasher.digest();
                    for (let k = 0; k < block.length && offset < len; k++) {
                        keystream[offset++] = block[k];
                    }
                    blockIndex++;
                }
            }
            for (let j = 0; j < len; j++) {
                if (i < originalBytecode.length) {
                    const plaintext = originalBytecode[i];
                    newBytecode[i] = plaintext ^ keystream[j];
                    i++;
                }
            }
        } else if (standardOpcode === OpCode.PushFloat || standardOpcode === OpCode.CallNative || standardOpcode === OpCode.Call) {
            for (let j = 0; j < 8; j++) {
                if (i < originalBytecode.length) {
                    newBytecode[i] = originalBytecode[i];
                    i++;
                }
            }
        } else if (
            standardOpcode === OpCode.PushInt ||
            standardOpcode === OpCode.PushBool ||
            standardOpcode === OpCode.LoadLocal ||
            standardOpcode === OpCode.StoreLocal ||
            standardOpcode === OpCode.Jump ||
            standardOpcode === OpCode.JumpIf ||
            standardOpcode === OpCode.JumpIfNot ||
            standardOpcode === OpCode.JumpAndMul
        ) {
            for (let j = 0; j < 4; j++) {
                if (i < originalBytecode.length) {
                    newBytecode[i] = originalBytecode[i];
                    i++;
                }
            }
        }
    }

    // XOR encrypt the final payload with 32-byte rolling key (unless DEV_MODE)
    const encryptedBytecode = new Uint8Array(newBytecode.length);
    if (process.env.DEV_MODE === 'true') {
        for (let i = 0; i < newBytecode.length; i++) {
            encryptedBytecode[i] = newBytecode[i];
        }
    } else {
        for (let i = 0; i < newBytecode.length; i++) {
            encryptedBytecode[i] = newBytecode[i] ^ sessionKey[i % 32];
        }
    }

    return {
        payload: encryptedBytecode,
        newMap: newInverseMap,
        pngBuffer: handshakeHeaderBytes,
        handshakeHeader: handshakeHeaderBytes
    };
}

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.error("Usage: node scrambler.js <file.fvbc> <file.opcodes.json>");
        process.exit(1);
    }

    const { payload, newMap, pngBuffer } = scrambleSessionPayload(args[0], args[1]);
    
    const outBase = args[0].replace(/\.fvbc$/, '') + '.scrambled';
    fs.writeFileSync(`${outBase}.fvbc`, payload);
    fs.writeFileSync(`${outBase}.opcodes.json`, JSON.stringify(newMap));
    fs.writeFileSync(`${outBase}.key.bin`, pngBuffer);
    
    console.log(`Successfully generated dynamic session payload to ${outBase}.fvbc and handshake header to ${outBase}.key.bin`);
}
