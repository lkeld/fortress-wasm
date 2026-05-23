const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');

// Mock require('env') before loading the VM Node module to intercept native calls
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
    if (id === 'env') {
        return {
            native_call: function (nativeId, argsJsonStr) {
                let args = [];
                try {
                    args = JSON.parse(argsJsonStr);
                } catch (e) {}
                switch (nativeId) {
                    case 1: // WebGL Fingerprint
                        return "MockWebGLRenderer ~ Apple GPU";
                    case 2: // Canvas Fingerprint
                        return "mock_canvas_fingerprint_hash_value_12345";
                    case 3: // Automation Check
                        return JSON.stringify({
                            webdriver: false,
                            cdc_adoQpoasnfa76pfcZLmcfl: false,
                            document_selenium: false,
                            phantom: false,
                            nightmare: false,
                            domAutomation: false,
                            languages_match: true,
                            plugins_empty: false,
                            hardwareConcurrency: 8,
                            deviceMemory: 16,
                            prototype_tampered: false
                        });
                    case 4: // Screen Metrics
                        if (args && args.length >= 2) {
                            return JSON.stringify({
                                width: args[0],
                                height: args[1],
                                availWidth: args[0],
                                availHeight: args[1],
                                colorDepth: 24,
                                pixelRatio: 1
                            });
                        }
                        return JSON.stringify({
                            width: 1920,
                            height: 1080,
                            availWidth: 1920,
                            availHeight: 1080,
                            colorDepth: 24,
                            pixelRatio: 1
                        });
                    default:
                        return JSON.stringify({ error: "Unknown native call ID" });
                }
            }
        };
    }
    return originalRequire.apply(this, arguments);
};

// Import modules
const cases = require('./cases.js');
const { Parser } = require('../../compiler/dist/parser.js');
const { CodeGenerator } = require('../../compiler/dist/codegen.js');
const { scrambleSessionPayload } = require('../../server/scrambler.js');
const { InMemoryNonceStore } = require('../../server/nonce-store.js');
const vmNode = require('../../pkg-node/vm_core.js');

// Detect DEV mode dynamically from the VM build
let isDevMode = false;
try {
    vmNode.set_payload_hash(new Uint8Array(32)); // Set all-zero fake hash
    const testDevResult = JSON.parse(vmNode.execute(new Uint8Array([0]), new Uint8Array(0), "{}", new Uint8Array(256)));
    if (testDevResult.error === "Dev mode VirtSC hash mismatch") {
        isDevMode = true;
    }
} catch (e) {}

const TEMP_DIR = os.tmpdir();

let totalRun = 0;
let passed = 0;
let failed = 0;

console.log("==========================================");
console.log("      FORTRESS-WASM E2E TEST RUNNER       ");
console.log("==========================================");

const runTestCase = async (testCase, devMode) => {
    // Clear dynamic keys and payload hash from previous runs
    vmNode.clear_crypto();

    // 1. Compile source code
    const parser = new Parser(testCase.source);
    const ast = parser.parseProgram();
    const codegen = new CodeGenerator();
    const { code, opcodeMap } = codegen.generate(ast);

    // Save to temp files
    const fvbcPath = path.join(TEMP_DIR, `temp_${testCase.id}.fvbc`);
    const mapPath = path.join(TEMP_DIR, `temp_${testCase.id}.opcodes.json`);
    fs.writeFileSync(fvbcPath, Buffer.from(code));
    fs.writeFileSync(mapPath, JSON.stringify(Array.from(opcodeMap)));

    let runResult = null;
    let runError = null;

    try {
        // Set env variable DEV_MODE
        process.env.DEV_MODE = devMode ? 'true' : 'false';

        let clientPublicKey;
        if (!devMode) {
            clientPublicKey = vmNode.generate_client_keypair();
        }

        // 2. Scramble
        const nonceStore = new InMemoryNonceStore();
        const { payload, newMap, pngBuffer, handshakeHeader } = await scrambleSessionPayload(fvbcPath, mapPath, clientPublicKey, nonceStore);
        const mapUint8 = new Uint8Array(newMap);

        // Prepare final payload
        let finalPayload = payload;
        if (testCase.antiTamper) {
            finalPayload = new Uint8Array(payload);
            // Corrupt a byte in the bytecode payload (e.g. index 20)
            if (finalPayload.length > 20) {
                finalPayload[20] ^= 0xFF;
            } else {
                finalPayload[0] ^= 0xFF;
            }
        }

        // Prepare inputs
        let inputJsonStr = '{}';
        if (testCase.inputs && testCase.inputs.length > 0) {
            // Prepend 7 nulls to offset the dummy variables in vm.locals
            const paddedInputs = Array(7).fill(null).concat(testCase.inputs);
            inputJsonStr = JSON.stringify(paddedInputs);
        }

        // Handle DEV_MODE hash setting
        if (isDevMode && devMode) {
            // Dev mode expects PAYLOAD_HASH to match the original uncorrupted payload hash
            const hashBytes = crypto.createHash('sha256').update(payload).digest();
            vmNode.set_payload_hash(new Uint8Array(hashBytes));
        }

        const header = !devMode ? handshakeHeader : pngBuffer;
        // 3. Execute
        const resultJsonStr = vmNode.execute(finalPayload, header, inputJsonStr, mapUint8);
        
        // Parse results
        runResult = JSON.parse(resultJsonStr);
    } catch (e) {
        runError = e;
    } finally {
        if (!devMode) {
            vmNode.clear_crypto();
        }
        // Cleanup temp files
        try {
            fs.unlinkSync(fvbcPath);
            fs.unlinkSync(mapPath);
        } catch (e) {}
    }

    if (runError) {
        throw runError;
    }

    return runResult;
};

// Run E2E pipeline for all test cases
(async () => {
for (const testCase of cases) {
    if (testCase.devOnly && process.env.DEV_MODE === 'false') continue;
    if (testCase.prodOnly && process.env.DEV_MODE === 'true') continue;

    // Test in both DEV_MODE=true and DEV_MODE=false
    const modes = [isDevMode];
    for (const devMode of modes) {
        // Skip modes explicitly restricted by test case definition
        if (devMode && testCase.prodOnly) continue;
        if (!devMode && testCase.devOnly) continue;

        totalRun++;
        const modeLabel = devMode ? "DEV" : "PROD";
        console.log(`Running case [${testCase.id}] - ${testCase.name} (${modeLabel} mode)...`);

        try {
            const runResult = await runTestCase(testCase, devMode);

            // Assertions
            if (testCase.isError) {
                if (testCase.antiTamper) {
                    assert.ok(runResult && runResult.status === false, `Expected error status: false, got: ${JSON.stringify(runResult)}`);
                    if (devMode) {
                        const expectedError = 'Dev mode VirtSC hash mismatch';
                        assert.ok(runResult.error && runResult.error.includes(expectedError), `Expected error containing "${expectedError}", got "${runResult.error}"`);
                    } else {
                        assert.ok(runResult.error && typeof runResult.error === 'string', `Expected some runtime error string, got "${runResult.error}"`);
                    }
                } else {
                    assert.ok(runResult && runResult.status === false, `Expected error status: false, got: ${JSON.stringify(runResult)}`);
                    assert.strictEqual(runResult.error, testCase.expected, `Expected error "${testCase.expected}", got "${runResult.error}"`);
                }
            } else {
                if (testCase.expected === 'CUSTOM_TELEMETRY') {
                    assert.ok(runResult && typeof runResult === 'object', 'Result must be an object');
                    assert.ok(typeof runResult.payload === 'string', 'Payload must be a string');
                    assert.ok(typeof runResult.hash === 'string', 'Hash must be a string');
                    const expectedHash = crypto.createHash('sha256').update(runResult.payload).digest('hex');
                    assert.strictEqual(runResult.hash, expectedHash, 'Telemetry payload hash must match');
                } else if (typeof testCase.expected === 'string' && testCase.expected.startsWith('REGEX:')) {
                    const pattern = testCase.expected.slice(6);
                    const regex = new RegExp(pattern);
                    const resultStr = typeof runResult === 'object' ? JSON.stringify(runResult) : String(runResult);
                    assert.ok(regex.test(resultStr), `Expected value matching ${pattern}, got ${JSON.stringify(runResult)}`);
                } else if (testCase.renewability) {
                    assert.strictEqual(runResult, testCase.expected);
                    
                    // Double check renewability: scramble twice should produce distinct bytes & PNGs
                    const parser = new Parser(testCase.source);
                    const ast = parser.parseProgram();
                    const codegen = new CodeGenerator();
                    const { code, opcodeMap } = codegen.generate(ast);

                    const fvbcPath = path.join(TEMP_DIR, `temp_renew_${testCase.id}.fvbc`);
                    const mapPath = path.join(TEMP_DIR, `temp_renew_${testCase.id}.opcodes.json`);
                    fs.writeFileSync(fvbcPath, Buffer.from(code));
                    fs.writeFileSync(mapPath, JSON.stringify(Array.from(opcodeMap)));
                    
                    try {
                        const nonceStore = new InMemoryNonceStore();
                        const run1 = await scrambleSessionPayload(fvbcPath, mapPath, undefined, nonceStore);
                        const run2 = await scrambleSessionPayload(fvbcPath, mapPath, undefined, nonceStore);
                        
                        assert.notDeepStrictEqual(run1.payload, run2.payload, "Payloads must be distinct for renewals");
                        if (!devMode) {
                            assert.notDeepStrictEqual(run1.pngBuffer, run2.pngBuffer, "Key PNGs must be distinct for renewals");
                        }
                    } finally {
                        try {
                            fs.unlinkSync(fvbcPath);
                            fs.unlinkSync(mapPath);
                        } catch (e) {}
                    }
                } else {
                    assert.deepStrictEqual(runResult, testCase.expected, `Expected: ${JSON.stringify(testCase.expected)}, got: ${JSON.stringify(runResult)}`);
                }
            }

            passed++;
            console.log(`  => PASS`);
        } catch (err) {
            failed++;
            console.error(`  => FAIL:`, err.stack || err.message);
        }
    }
}

console.log("\n==========================================");
console.log("               TEST SUMMARY               ");
console.log("==========================================");
console.log(`Total Run: ${totalRun}`);
console.log(`Passed:    ${passed}`);
console.log(`Failed:    ${failed}`);
console.log("==========================================");

if (failed > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
})().catch(err => {
    console.error(err);
    process.exit(1);
});
