import * as fs from 'fs';
import * as path from 'path';

/**
 * Dynamically scrambles a compiled .fvbc payload for a specific user session.
 * 
 * @param fvbcPath Path to the compiled .fvbc file
 * @param originalMapPath Path to the original opcode_map.json
 * @returns { payload: Uint8Array, newMap: number[] }
 */
export function scrambleSessionPayload(fvbcPath: string, originalMapPath: string): { payload: Uint8Array, newMap: number[] } {
    const originalBytecode = fs.readFileSync(fvbcPath);
    const originalMap: number[] = JSON.parse(fs.readFileSync(originalMapPath, 'utf8'));

    // 1. Build inverse map of the original to get back to standard opcodes
    const inverseOriginalMap = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
        inverseOriginalMap[originalMap[i]] = i;
    }

    // 2. Generate a brand new random mapping for this session
    const newMap = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = newMap[i];
        newMap[i] = newMap[j];
        newMap[j] = temp;
    }

    // 3. Build inverse of the new map (what the VM actually uses to execute)
    const newInverseMap = new Array(256);
    for (let i = 0; i < 256; i++) {
        newInverseMap[newMap[i]] = i;
    }

    // 4. Translate the payload
    const newBytecode = new Uint8Array(originalBytecode.length);
    for (let i = 0; i < originalBytecode.length; i++) {
        const currentByte = originalBytecode[i];
        const standardOpcode = inverseOriginalMap[currentByte];
        const newByte = newMap[standardOpcode];
        newBytecode[i] = newByte;
    }

    return {
        payload: newBytecode,
        newMap: newInverseMap // This is what gets sent to the client as opcode_map
    };
}

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.error("Usage: node scrambler.js <file.fvbc> <file.opcodes.json>");
        process.exit(1);
    }

    const { payload, newMap } = scrambleSessionPayload(args[0], args[1]);
    
    const outBase = args[0].replace(/\.fvbc$/, '') + '.scrambled';
    fs.writeFileSync(`${outBase}.fvbc`, payload);
    fs.writeFileSync(`${outBase}.opcodes.json`, JSON.stringify(newMap));
    
    console.log(`Successfully generated dynamic session payload to ${outBase}.fvbc`);
}
