const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const vmNode = require('../pkg-node/vm_core.js');
const { Parser } = require('../compiler/dist/parser.js');
const { CodeGenerator } = require('../compiler/dist/codegen.js');
const { scrambleSessionPayload } = require('../server/scrambler.js');

const TEMP_DIR = os.tmpdir();

const crypto = require('crypto');

// Detect DEV mode dynamically from the VM build
let isDevMode = false;
try {
    vmNode.set_payload_hash(new Uint8Array(32)); // Set all-zero fake hash
    const testDevResult = JSON.parse(vmNode.execute(new Uint8Array([0]), new Uint8Array(1024), "{}", new Uint8Array(256)));
    if (testDevResult.error === "Dev mode VirtSC hash mismatch") {
        isDevMode = true;
    }
} catch (e) {}

process.env.DEV_MODE = isDevMode ? 'true' : 'false';

test('Integration: end-to-end payload compilation, scramble, and execution pipeline', () => {
    // 1. Compile simple Fortress code
    const sourceCode = `
        let x = 10;
        let y = 32;
        let z = x + y;
        return z;
    `;
    const parser = new Parser(sourceCode);
    const ast = parser.parseProgram();
    
    const codegen = new CodeGenerator();
    const { code, opcodeMap } = codegen.generate(ast);
    
    const fvbcPath = path.join(TEMP_DIR, 'test_e2e.fvbc');
    const mapPath = path.join(TEMP_DIR, 'test_e2e.opcodes.json');
    fs.writeFileSync(fvbcPath, Buffer.from(code));
    fs.writeFileSync(mapPath, JSON.stringify(Array.from(opcodeMap)));
    
    // 2. Scramble
    const { payload, newMap, pngBuffer } = scrambleSessionPayload(fvbcPath, mapPath);
    
    // Convert newMap to Uint8Array
    const mapUint8 = new Uint8Array(newMap);
    
    // 3. Execute in Node VM
    const inputJson = JSON.stringify({});
    
    // In Dev mode, we must set the payload hash explicitly to avoid mismatch errors
    if (isDevMode) {
        const hashBytes = crypto.createHash('sha256').update(payload).digest();
        vmNode.set_payload_hash(new Uint8Array(hashBytes));
    }
    
    const resultJsonStr = vmNode.execute(payload, pngBuffer, inputJson, mapUint8);
    const result = JSON.parse(resultJsonStr);
    
    assert.strictEqual(result, 42);
    
    // Cleanup
    fs.unlinkSync(fvbcPath);
    fs.unlinkSync(mapPath);
});

test('Integration: Renewability (distinct session keys)', () => {
    const sourceCode = `return 1;`;
    const parser = new Parser(sourceCode);
    const codegen = new CodeGenerator();
    const { code, opcodeMap } = codegen.generate(parser.parseProgram());
    
    const fvbcPath = path.join(TEMP_DIR, 'test_renew.fvbc');
    const mapPath = path.join(TEMP_DIR, 'test_renew.opcodes.json');
    fs.writeFileSync(fvbcPath, Buffer.from(code));
    fs.writeFileSync(mapPath, JSON.stringify(Array.from(opcodeMap)));
    
    // Scramble twice without passing a session key (should generate random distinct keys)
    const run1 = scrambleSessionPayload(fvbcPath, mapPath);
    const run2 = scrambleSessionPayload(fvbcPath, mapPath);
    
    // Payload and PNG buffer should differ
    assert.notDeepStrictEqual(run1.payload, run2.payload);
    assert.notDeepStrictEqual(run1.pngBuffer, run2.pngBuffer);
    
    // Cleanup
    fs.unlinkSync(fvbcPath);
    fs.unlinkSync(mapPath);
});

test('Integration: Environment Compatibility (Dev vs Prod)', () => {
    // If we're testing the PROD VM build, a DEV payload (unscrambled) should fail.
    // How do we generate a DEV payload? We bypass the scrambler and use identity map!
    
    const sourceCode = `return 42;`;
    const parser = new Parser(sourceCode);
    const codegen = new CodeGenerator();
    const { code } = codegen.generate(parser.parseProgram());
    
    // A DEV environment uses unencrypted bytecode (session key zero, or feature dev enabled).
    // And an identity opcode map, or at least the non-scrambled map.
    // If we pass an unscrambled payload with no PNG buffer, it should fail parsing the PNG or validating checksum.
    
    // Passing random dummy PNG that isn't a valid stegano payload
    const dummyPng = Buffer.alloc(1024, 0); 
    
    // Identity map
    const identityMap = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
        identityMap[i] = i;
    }
    
    if (isDevMode) {
        const hashBytes = crypto.createHash('sha256').update(code).digest();
        vmNode.set_payload_hash(new Uint8Array(hashBytes));
    }
    
    const resultJsonStr = vmNode.execute(code, dummyPng, "{}", identityMap);
    const result = JSON.parse(resultJsonStr);
    
    // The prod VM should return a structured error, not a panic.
    assert.strictEqual(result.status, false);
    // It should be either a PNG error, missing key error, or InvalidOpCode due to virtsc checksum mismatch.
    assert.ok(result.error !== undefined);
});
