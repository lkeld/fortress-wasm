const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const vmNode = require('../pkg-node/vm_core.js');
const { Parser } = require('../compiler/dist/parser.js');
const { CodeGenerator } = require('../compiler/dist/codegen.js');
const { scrambleSessionPayload } = require('../server/scrambler.js');
const { InMemoryNonceStore } = require('../server/nonce-store.js');

const TEMP_DIR = os.tmpdir();

const crypto = require('crypto');

// Detect DEV mode dynamically from the VM build
let isDevMode = false;
try {
    vmNode.set_payload_hash(new Uint8Array(32)); // Set all-zero fake hash
    const testDevResult = JSON.parse(vmNode.execute(new Uint8Array([0]), new Uint8Array(0), "{}", new Uint8Array(256)));
    if (testDevResult.error === "Dev mode VirtSC hash mismatch") {
        isDevMode = true;
    }
} catch (e) {}

process.env.DEV_MODE = isDevMode ? 'true' : 'false';

test('Integration: end-to-end payload compilation, scramble, and execution pipeline', async () => {
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
    
    let clientPublicKey;
    if (!isDevMode) {
        clientPublicKey = vmNode.generate_client_keypair();
    }

    // 2. Scramble
    const nonceStore = new InMemoryNonceStore();
    const { payload, newMap, pngBuffer, handshakeHeader } = await scrambleSessionPayload(fvbcPath, mapPath, clientPublicKey, nonceStore);
    
    // Convert newMap to Uint8Array
    const mapUint8 = new Uint8Array(newMap);
    
    // 3. Execute in Node VM
    const inputJson = JSON.stringify({});
    
    // In Dev mode, we must set the payload hash explicitly to avoid mismatch errors
    if (isDevMode) {
        const hashBytes = crypto.createHash('sha256').update(payload).digest();
        vmNode.set_payload_hash(new Uint8Array(hashBytes));
    }
    
    const header = !isDevMode ? handshakeHeader : pngBuffer;
    const resultJsonStr = vmNode.execute(payload, header, inputJson, mapUint8);
    
    if (!isDevMode) {
        vmNode.clear_crypto();
    }
    
    const result = JSON.parse(resultJsonStr);
    
    assert.strictEqual(result, 42);
    
    // Cleanup
    fs.unlinkSync(fvbcPath);
    fs.unlinkSync(mapPath);
});

test('Integration: Renewability (distinct session keys)', async () => {
    const sourceCode = `return 1;`;
    const parser = new Parser(sourceCode);
    const codegen = new CodeGenerator();
    const { code, opcodeMap } = codegen.generate(parser.parseProgram());
    
    const fvbcPath = path.join(TEMP_DIR, 'test_renew.fvbc');
    const mapPath = path.join(TEMP_DIR, 'test_renew.opcodes.json');
    fs.writeFileSync(fvbcPath, Buffer.from(code));
    fs.writeFileSync(mapPath, JSON.stringify(Array.from(opcodeMap)));
    
    // Scramble twice without passing a session key (should generate random distinct keys)
    const nonceStore = new InMemoryNonceStore();
    const run1 = await scrambleSessionPayload(fvbcPath, mapPath, undefined, nonceStore);
    const run2 = await scrambleSessionPayload(fvbcPath, mapPath, undefined, nonceStore);
    
    // Payload and PNG buffer should differ
    assert.notDeepStrictEqual(run1.payload, run2.payload);
    if (!isDevMode) {
        assert.notDeepStrictEqual(run1.pngBuffer, run2.pngBuffer);
    }
    
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

test('Integration: Scrambler offset-parsing safety test (trailing hash byte maps to PushString)', async () => {
    // Construct a bytecode buffer of length 288 (1 page of 256 bytes + 32 bytes of hash).
    // In our case, the scrambler translates bytecode bytes using originalMap[currentByte].
    // If originalMap[hashByte] === OpCode.PushString (0x7C), the scrambler processes it as a string instruction.
    
    const fvbcPath = path.join(TEMP_DIR, 'test_scrambler_bug.fvbc');
    const mapPath = path.join(TEMP_DIR, 'test_scrambler_bug.opcodes.json');
    
    const bytecode = Buffer.alloc(288, 0);
    // 0x42 at index 256 will map to OpCode.PushString (0x7C).
    bytecode[256] = 0x42;
    // Set bytes 261-264 to 0xFF to cause an invalid typed array length RangeError if parsed.
    bytecode[261] = 0xFF;
    bytecode[262] = 0xFF;
    bytecode[263] = 0xFF;
    bytecode[264] = 0xFF;
    
    // Build the opcode map.
    const map = new Array(256).fill(0xB6); // Default all to OpCode.Halt (0xB6) to avoid other multi-byte opcodes
    map[0x42] = 0x7C; // Map 0x42 to OpCode.PushString (0x7C)
    
    fs.writeFileSync(fvbcPath, bytecode);
    fs.writeFileSync(mapPath, JSON.stringify(map));
    
    const nonceStore = new InMemoryNonceStore();
    let errorOccurred = null;
    try {
        await scrambleSessionPayload(fvbcPath, mapPath, undefined, nonceStore);
    } catch (e) {
        errorOccurred = e;
    } finally {
        fs.unlinkSync(fvbcPath);
        fs.unlinkSync(mapPath);
    }
    
    assert.strictEqual(errorOccurred, null, `Scrambler should not have crashed but got: ${errorOccurred}`);
});

test('Integration: Scrambler key seed environment variable overrides', async () => {
    // Save current environment variables
    const oldPassword = process.env.FORTRESS_SIGNING_PASSWORD;
    const oldSeed = process.env.FORTRESS_SIGNING_SEED;

    try {
        // Set seed directly
        const testSeed = 'a'.repeat(64); // 32 bytes hex
        process.env.FORTRESS_SIGNING_SEED = testSeed;
        delete process.env.FORTRESS_SIGNING_PASSWORD; // Verify password isn't required

        // Run the pipeline
        const sourceCode = `return 1;`;
        const parser = new Parser(sourceCode);
        const codegen = new CodeGenerator();
        const { code, opcodeMap } = codegen.generate(parser.parseProgram());
        
        const fvbcPath = path.join(TEMP_DIR, 'test_env_override.fvbc');
        const mapPath = path.join(TEMP_DIR, 'test_env_override.opcodes.json');
        fs.writeFileSync(fvbcPath, Buffer.from(code));
        fs.writeFileSync(mapPath, JSON.stringify(Array.from(opcodeMap)));
        
        const nonceStore = new InMemoryNonceStore();
        // This should run and derive the signing key successfully from FORTRESS_SIGNING_SEED
        const res = await scrambleSessionPayload(fvbcPath, mapPath, undefined, nonceStore);
        assert.ok(res.payload);
        
        fs.unlinkSync(fvbcPath);
        fs.unlinkSync(mapPath);
    } finally {
        // Restore environment variables
        if (oldPassword) {
            process.env.FORTRESS_SIGNING_PASSWORD = oldPassword;
        } else {
            delete process.env.FORTRESS_SIGNING_PASSWORD;
        }
        if (oldSeed) {
            process.env.FORTRESS_SIGNING_SEED = oldSeed;
        } else {
            delete process.env.FORTRESS_SIGNING_SEED;
        }
    }
});

