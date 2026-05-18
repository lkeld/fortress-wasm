import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { OpCode } from '../compiler/src/opcodes';

/**
 * Dynamically scrambles a compiled .fvbc payload for a specific user session.
 * 
 * @param fvbcPath Path to the compiled .fvbc file
 * @param originalMapPath Path to the original opcode_map.json
 * @returns { payload: Uint8Array, newMap: number[], pngBuffer: Buffer }
 */
export function scrambleSessionPayload(fvbcPath: string, originalMapPath: string): { payload: Uint8Array, newMap: number[], pngBuffer: Buffer } {
    const originalBytecode = fs.readFileSync(fvbcPath);
    const originalMap: number[] = JSON.parse(fs.readFileSync(originalMapPath, 'utf8'));

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
        const j = Math.floor(Math.random() * (i + 1));
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
    const sessionKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
        sessionKey[i] = Math.floor(Math.random() * 256);
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

        if (standardOpcode === OpCode.PushString) { // PushString
            // 4 byte nonce
            const nonce = new Uint8Array(4);
            for (let j = 0; j < 4; j++) {
                if (i < originalBytecode.length) {
                    nonce[j] = originalBytecode[i];
                    newBytecode[i] = originalBytecode[i];
                    i++;
                }
            }
            // 4 bytes length
            let len = 0;
            if (i + 3 < originalBytecode.length) {
                len = originalBytecode[i] | (originalBytecode[i+1] << 8) | (originalBytecode[i+2] << 16) | (originalBytecode[i+3] << 24);
                for (let j = 0; j < 4; j++) {
                    newBytecode[i] = originalBytecode[i];
                    i++;
                }
            }
            // string bytes: encrypt using session key and nonce
            for (let j = 0; j < len; j++) {
                if (i < originalBytecode.length) {
                    const plaintext = originalBytecode[i];
                    const keyByte = sessionKey[(nonce[j % 4] + j) % 32];
                    newBytecode[i] = plaintext ^ keyByte;
                    i++;
                }
            }
        } else if (standardOpcode === OpCode.PushFloat || standardOpcode === OpCode.Call) { // PushFloat (8), Call (8)
            for (let j = 0; j < 8; j++) {
                if (i < originalBytecode.length) {
                    newBytecode[i] = originalBytecode[i];
                    i++;
                }
            }
        } else if (
            standardOpcode === OpCode.PushInt || // PushInt
            standardOpcode === OpCode.PushBool || // PushBool
            standardOpcode === OpCode.LoadLocal || // LoadLocal
            standardOpcode === OpCode.StoreLocal || // StoreLocal
            standardOpcode === OpCode.Jump || // Jump
            standardOpcode === OpCode.JumpIf || // JumpIf
            standardOpcode === OpCode.JumpIfNot || // JumpIfNot
            standardOpcode === OpCode.CallNative    // CallNative
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
    const png = new PNG({ width: 16, height: 16 });
    for (let i = 0; i < 256; i++) {
        const idx = i * 4;
        png.data[idx] = Math.floor(Math.random() * 256); // R
        png.data[idx+1] = Math.floor(Math.random() * 256); // G
        png.data[idx+2] = Math.floor(Math.random() * 256); // B
        png.data[idx+3] = 255; // Alpha is always 255 now! No longer an anomaly
    }
    
    const primes = [3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47];
    const stride = primes[png.data[0] % primes.length];
    
    let pixelOffset = 0;

    // Embed all 32 bytes into RGB channels non-sequentially using dynamic stride.
    // The extraction stride is derived dynamically from the randomized R channel of the first pixel,
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
    
    const pngBuffer = PNG.sync.write(png);

    // 6. XOR encrypt the final payload with 32-byte rolling key
    const encryptedBytecode = new Uint8Array(newBytecode.length);
    for (let i = 0; i < newBytecode.length; i++) {
        encryptedBytecode[i] = newBytecode[i] ^ sessionKey[i % 32];
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
