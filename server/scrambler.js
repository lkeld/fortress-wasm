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
exports.scrambleSessionPayload = scrambleSessionPayload;
const fs = __importStar(require("fs"));
const pngjs_1 = require("pngjs");
const crypto = __importStar(require("crypto"));
// @ts-ignore
const opcodes_js_1 = require("../compiler/dist/opcodes.js");
/**
 * Dynamically scrambles a compiled .fvbc payload for a specific user session.
 *
 * @param fvbcPath Path to the compiled .fvbc file
 * @param originalMapPath Path to the original opcode_map.json
 * @returns { payload: Uint8Array, newMap: number[], pngBuffer: Buffer }
 */
function scrambleSessionPayload(fvbcPath, originalMapPath, providedSessionKey) {
    const originalBytecode = fs.readFileSync(fvbcPath);
    const originalMap = JSON.parse(fs.readFileSync(originalMapPath, 'utf8'));
    // 1. In original mapping, the array exported from compiler represents opcodeMap.
    // However, the JSON array IS the opcodeMap, not the inverse. Wait, compiler exports invertedMap?
    // Let's check: compiler exports this.opcodeMap or this.invertedMap?
    // In compiler/src/codegen.ts, generate returns opcodeMap: this.opcodeMap.
    // The VM uses: instruction = opcode_map[raw_instruction];
    // So the VM's map maps encoded -> standard.
    // This means the compiler exports `invertedMap`! Let's assume the JSON array is what the VM uses: 
    // encoded -> standard.
    // originalMap maps: encodedByte -> standardOpcode.
    // So to decode: standardOpcode = originalMap[encodedByte]
    // Phase 12: Per-Request Code Renewability
    // By generating a fresh, mathematically distinct translation map (standardOpcode -> newEncodedByte) for every single invocation,
    // we render signature-based analysis, caching attacks, and payload diffing structurally impossible.
    // See Code Renewability for Native Software Protection, arxiv.org/abs/2003.00916.
    const newMap = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
        const j = crypto.randomBytes(4).readUInt32LE(0) % (i + 1);
        const temp = newMap[i];
        newMap[i] = newMap[j];
        newMap[j] = temp;
    }
    // 3. Build the new map for the VM (newEncodedByte -> standardOpcode)
    const newInverseMap = new Array(256);
    for (let i = 0; i < 256; i++) {
        newInverseMap[newMap[i]] = i;
    }
    // 3.5. Generate 32-byte Session Key early so it can be used for string encryption
    let sessionKey = new Uint8Array(32);
    if (providedSessionKey) {
        for (let i = 0; i < 32; i++) {
            sessionKey[i] = providedSessionKey[i];
        }
    }
    else {
        sessionKey = new Uint8Array(crypto.randomBytes(32));
    }
    // 4. Translate the payload
    const newBytecode = new Uint8Array(originalBytecode.length);
    let i = 0;
    while (i < originalBytecode.length) {
        const currentByte = originalBytecode[i];
        const standardOpcode = originalMap[currentByte];
        const newByte = newMap[standardOpcode];
        newBytecode[i] = newByte;
        i++;
        if (standardOpcode === opcodes_js_1.OpCode.PushString) { // PushString
            // 4 byte nonce
            const nonce = new Uint8Array(crypto.randomBytes(4));
            for (let j = 0; j < 4; j++) {
                if (i < originalBytecode.length) {
                    newBytecode[i] = nonce[j];
                    i++;
                }
            }
            // 4 bytes length
            let len = 0;
            if (i + 3 < originalBytecode.length) {
                len = originalBytecode[i] | (originalBytecode[i + 1] << 8) | (originalBytecode[i + 2] << 16) | (originalBytecode[i + 3] << 24);
                for (let j = 0; j < 4; j++) {
                    newBytecode[i] = originalBytecode[i];
                    i++;
                }
            }
            // Generate keystream of length `len` using SHA-256
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
            // string bytes: encrypt using SHA-256 keystream
            for (let j = 0; j < len; j++) {
                if (i < originalBytecode.length) {
                    const plaintext = originalBytecode[i];
                    newBytecode[i] = plaintext ^ keystream[j];
                    i++;
                }
            }
        }
        else if (standardOpcode === opcodes_js_1.OpCode.PushFloat || standardOpcode === opcodes_js_1.OpCode.CallNative || standardOpcode === opcodes_js_1.OpCode.Call) { // PushFloat (8), CallNative (8), Call (8)
            for (let j = 0; j < 8; j++) {
                if (i < originalBytecode.length) {
                    newBytecode[i] = originalBytecode[i];
                    i++;
                }
            }
        }
        else if (standardOpcode === opcodes_js_1.OpCode.PushInt || // PushInt
            standardOpcode === opcodes_js_1.OpCode.PushBool || // PushBool
            standardOpcode === opcodes_js_1.OpCode.LoadLocal || // LoadLocal
            standardOpcode === opcodes_js_1.OpCode.StoreLocal || // StoreLocal
            standardOpcode === opcodes_js_1.OpCode.Jump || // Jump
            standardOpcode === opcodes_js_1.OpCode.JumpIf || // JumpIf
            standardOpcode === opcodes_js_1.OpCode.JumpIfNot || // JumpIfNot
            standardOpcode === opcodes_js_1.OpCode.JumpAndMul // JumpAndMul
        ) {
            for (let j = 0; j < 4; j++) {
                if (i < originalBytecode.length) {
                    newBytecode[i] = originalBytecode[i];
                    i++;
                }
            }
        }
    }
    // Phase 4: LSB Steganographic Key Delivery
    // We encode the 32-byte session key into the PNG's Least Significant Bits.
    const png = new pngjs_1.PNG({ width: 16, height: 16 });
    const padding = crypto.randomBytes(256 * 3);
    for (let i = 0; i < 256; i++) {
        const idx = i * 4;
        png.data[idx] = padding[i * 3]; // R
        png.data[idx + 1] = padding[i * 3 + 1]; // G
        png.data[idx + 2] = padding[i * 3 + 2]; // B
        png.data[idx + 3] = 255; // Alpha is always 255 now! No longer an anomaly
    }
    const primes = [3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47];
    const stride = primes[png.data[0] % primes.length];
    let pixelOffset = 0;
    // Embed all 32 bytes into RGB channels non-sequentially using dynamic stride.
    // The extraction stride is derived dynamically from the randomised R channel of the first pixel,
    // removing any fixed mathematical anchor for an attacker.
    for (let i = 0; i < 32; i++) {
        for (let bit = 0; bit < 8; bit++) {
            pixelOffset = (pixelOffset + stride) % 256;
            const channel = (i + bit) % 3;
            const dataIdx = pixelOffset * 4 + channel;
            const bitValue = (sessionKey[i] >> bit) & 1;
            png.data[dataIdx] = (png.data[dataIdx] & ~1) | bitValue;
        }
    }
    console.log("Scrambler Session Key:", sessionKey);
    const pngBuffer = pngjs_1.PNG.sync.write(png);
    // 6. XOR encrypt the final payload with 32-byte rolling key (unless DEV_MODE)
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
        newMap: newInverseMap, // This is what gets sent to the client as opcode_map
        pngBuffer
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
    fs.writeFileSync(`${outBase}.key.png`, pngBuffer);
    console.log(`Successfully generated dynamic session payload to ${outBase}.fvbc and key image to ${outBase}.key.png`);
}
//# sourceMappingURL=scrambler.js.map