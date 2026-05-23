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
exports.generateHandshake = generateHandshake;
exports.scrambleSessionPayload = scrambleSessionPayload;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const argon2 = __importStar(require("argon2"));
// @ts-ignore
const opcodes_js_1 = require("../compiler/dist/opcodes.js");
const nonce_store_1 = require("./nonce-store");
let cachedSigningKey = null;
// Load server signing key dynamically using Argon2id key derivation
async function loadServerSigningKey() {
    if (cachedSigningKey) {
        return cachedSigningKey;
    }
    const password = process.env.FORTRESS_SIGNING_PASSWORD;
    if (!password) {
        throw new Error("Missing FORTRESS_SIGNING_PASSWORD environment variable");
    }
    const paramsPath = path.join(__dirname, '.signing_params');
    let salt;
    let isColdStart = false;
    if (fs.existsSync(paramsPath)) {
        salt = fs.readFileSync(paramsPath);
        if (salt.length !== 32) {
            throw new Error(`Invalid salt length in ${paramsPath}. Expected 32 bytes.`);
        }
    }
    else {
        salt = crypto.randomBytes(32);
        fs.writeFileSync(paramsPath, salt);
        isColdStart = true;
    }
    // Derive seed using Argon2id (memoryCost: 65536, timeCost: 3, parallelism: 1, hashLength: 32)
    const seed = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 1,
        hashLength: 32,
        salt: salt,
        raw: true
    });
    // Wrap the derived 32-byte seed in the PKCS#8 DER header 302e020100300506032b657004220420
    const derHeader = Buffer.from('302e020100300506032b657004220420', 'hex');
    const privateKeyDer = Buffer.concat([derHeader, seed]);
    const signingKey = crypto.createPrivateKey({
        key: privateKeyDer,
        format: 'der',
        type: 'pkcs8'
    });
    if (isColdStart) {
        const publicKeyObject = crypto.createPublicKey(signingKey);
        const pubKeyDer = publicKeyObject.export({ type: 'spki', format: 'der' });
        const pubKeyBytes = pubKeyDer.subarray(pubKeyDer.length - 32);
        const rustArray = "[" + Array.from(pubKeyBytes).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(', ') + "]";
        console.log(`Cold Start: Derived public key bytes (Rust array):`);
        console.log(rustArray);
    }
    cachedSigningKey = signingKey;
    return signingKey;
}
/**
 * Exposes generateHandshake returning a base64-encoded header value containing the concatenated raw fields
 */
async function generateHandshake(clientPublicKey, nonceStore) {
    const serverPrivateKey = await loadServerSigningKey();
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
    const nonceHex = nonce.toString('hex');
    const consumed = await nonceStore.consume(nonceHex, timestamp);
    if (!consumed) {
        throw new Error('HandshakeNonceRejected — nonce already consumed or timestamp expired');
    }
    const sessionKey = crypto.hkdfSync('sha256', sharedSecret, nonce, Buffer.from(sessionId, 'utf8'), 32);
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
 * @param nonceStore NonceStore to validate handshakes
 * @returns { payload: Uint8Array, newMap: number[], pngBuffer: Buffer, handshakeHeader: Buffer }
 */
async function scrambleSessionPayload(fvbcPath, originalMapPath, clientPublicKeyOrSessionKey, nonceStore) {
    const originalBytecode = fs.readFileSync(fvbcPath);
    const originalMap = JSON.parse(fs.readFileSync(originalMapPath, 'utf8'));
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
    }
    else if (clientPublicKeyOrSessionKey && clientPublicKeyOrSessionKey.length === 32) {
        // Check if it matches a valid DH handshake public key or legacy manual key
        try {
            const handshake = await generateHandshake(clientPublicKeyOrSessionKey, nonceStore);
            sessionKey = handshake.sessionKey;
            handshakeHeaderBytes = Buffer.from(handshake.handshakeHeader, 'base64');
        }
        catch (error) {
            const e = error;
            const isCritical = e && (e.message?.includes('Missing FORTRESS_SIGNING_PASSWORD') ||
                e.message?.includes('HandshakeNonceRejected') ||
                e.message?.includes('Invalid salt length'));
            const isDerivationOrKeyError = e && (e.code === 'ERR_OSSL_FAILED_DURING_DERIVATION' ||
                e.code === 'ERR_CRYPTO_PUBLIC_KEY_IDENTIFIER_INVALID' ||
                e.message?.includes('failed during derivation'));
            if (isCritical || !isDerivationOrKeyError) {
                throw error;
            }
            // Legacy manual key fallback if key parsing failed
            for (let i = 0; i < 32; i++) {
                sessionKey[i] = clientPublicKeyOrSessionKey[i];
            }
        }
    }
    else {
        // Generate random client key pair for DH derivation
        const dummyClient = crypto.generateKeyPairSync('x25519');
        const dummyClientPublic = dummyClient.publicKey.export({ type: 'spki', format: 'der' }).subarray(12);
        const handshake = await generateHandshake(dummyClientPublic, nonceStore);
        sessionKey = handshake.sessionKey;
        handshakeHeaderBytes = Buffer.from(handshake.handshakeHeader, 'base64');
    }
    const newBytecode = new Uint8Array(originalBytecode.length);
    let i = 0;
    const limit = (originalBytecode.length % 288 === 0 && originalBytecode.length > 0)
        ? (originalBytecode.length / 288) * 256
        : originalBytecode.length;
    while (i < limit) {
        const currentByte = originalBytecode[i];
        const standardOpcode = originalMap[currentByte];
        const newByte = newMap[standardOpcode];
        newBytecode[i] = newByte;
        i++;
        if (standardOpcode === opcodes_js_1.OpCode.PushString) {
            const nonce = new Uint8Array(crypto.randomBytes(4));
            for (let j = 0; j < 4; j++) {
                if (i < originalBytecode.length) {
                    newBytecode[i] = nonce[j];
                    i++;
                }
            }
            let len = 0;
            if (i + 3 < originalBytecode.length) {
                len = originalBytecode[i] | (originalBytecode[i + 1] << 8) | (originalBytecode[i + 2] << 16) | (originalBytecode[i + 3] << 24);
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
        }
        else if (standardOpcode === opcodes_js_1.OpCode.PushFloat || standardOpcode === opcodes_js_1.OpCode.CallNative || standardOpcode === opcodes_js_1.OpCode.Call) {
            for (let j = 0; j < 8; j++) {
                if (i < originalBytecode.length) {
                    newBytecode[i] = originalBytecode[i];
                    i++;
                }
            }
        }
        else if (standardOpcode === opcodes_js_1.OpCode.PushInt ||
            standardOpcode === opcodes_js_1.OpCode.PushBool ||
            standardOpcode === opcodes_js_1.OpCode.LoadLocal ||
            standardOpcode === opcodes_js_1.OpCode.StoreLocal ||
            standardOpcode === opcodes_js_1.OpCode.Jump ||
            standardOpcode === opcodes_js_1.OpCode.JumpIf ||
            standardOpcode === opcodes_js_1.OpCode.JumpIfNot ||
            standardOpcode === opcodes_js_1.OpCode.JumpAndMul) {
            for (let j = 0; j < 4; j++) {
                if (i < originalBytecode.length) {
                    newBytecode[i] = originalBytecode[i];
                    i++;
                }
            }
        }
    }
    // Recompute page hashes over the scrambled bytecode pages
    if (originalBytecode.length % 288 === 0 && originalBytecode.length > 0) {
        const numPages = originalBytecode.length / 288;
        const hashStart = numPages * 256;
        for (let p = 0; p < numPages; p++) {
            const pageData = newBytecode.subarray(p * 256, (p + 1) * 256);
            const hash = crypto.createHash('sha256').update(pageData).digest();
            for (let b = 0; b < 32; b++) {
                newBytecode[hashStart + p * 32 + b] = hash[b];
            }
        }
    }
    // XOR encrypt the final payload with 32-byte rolling key (unless DEV_MODE)
    const encryptedBytecode = new Uint8Array(newBytecode.length);
    if (process.env.DEV_MODE === 'true') {
        for (let i = 0; i < newBytecode.length; i++) {
            encryptedBytecode[i] = newBytecode[i];
        }
    }
    else {
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
    (async () => {
        const args = process.argv.slice(2);
        if (args.length < 2) {
            console.error("Usage: node scrambler.js <file.fvbc> <file.opcodes.json>");
            process.exit(1);
        }
        const defaultNonceStore = new nonce_store_1.InMemoryNonceStore();
        const { payload, newMap, pngBuffer } = await scrambleSessionPayload(args[0], args[1], undefined, defaultNonceStore);
        const outBase = args[0].replace(/\.fvbc$/, '') + '.scrambled';
        fs.writeFileSync(`${outBase}.fvbc`, payload);
        fs.writeFileSync(`${outBase}.opcodes.json`, JSON.stringify(newMap));
        fs.writeFileSync(`${outBase}.key.bin`, pngBuffer);
        console.log(`Successfully generated dynamic session payload to ${outBase}.fvbc and handshake header to ${outBase}.key.bin`);
    })().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
//# sourceMappingURL=scrambler.js.map