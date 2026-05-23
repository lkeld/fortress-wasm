const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const vmNode = require('../pkg-node/vm_core.js');
const { Parser } = require('../compiler/dist/parser.js');
const { CodeGenerator } = require('../compiler/dist/codegen.js');
const { scrambleSessionPayload } = require('../server/scrambler.js');
const { InMemoryNonceStore } = require('../server/nonce-store.js');

const TEMP_DIR = os.tmpdir();

// Detect DEV mode dynamically from the VM build
let isDevMode = false;
try {
    vmNode.set_payload_hash(new Uint8Array(32)); // Set all-zero fake hash
    const testDevResult = JSON.parse(vmNode.execute(new Uint8Array([0]), new Uint8Array(0), "{}", new Uint8Array(256)));
    if (testDevResult.error === "Dev mode VirtSC hash mismatch") {
        isDevMode = true;
    }
} catch (e) {}

console.log("VM target isDevMode:", isDevMode);

// Helper to represent negative/positive numbers as syntactically valid expressions
function toFortressExpr(val) {
    if (val < 0) {
        if (val === -2147483648) {
            return `(0 - 2147483647 - 1)`;
        }
        return `(0 - ${-val})`;
    }
    return `${val}`;
}

// Generate the test cases
const testCases = [
    // Basic positive cases
    [0, 0], [1, 1], [2, 3], [5, 10], [12, 12],
    // Zero cases
    [0, 100], [100, 0], [0, -100], [-100, 0],
    // Small negative cases
    [-1, 1], [1, -1], [-1, -1],
    [-2, 3], [2, -3], [-2, -3],
    [-10, 20], [10, -20], [-10, -20],
    // Odd/Even checks
    [3, 3], [3, 4], [4, 3], [4, 4],
    [-3, -3], [-3, -4], [-4, -3], [-4, -4],
    // Large inputs
    [10000, 10000], [10000, -10000], [-10000, -10000],
    [65536, 65536], [65536, -65536], [-65536, -65536],
    // 32-bit Boundaries & Overflows
    [2147483647, 0], [2147483647, 1], [2147483647, 2],
    [2147483647, -1], [2147483647, -2],
    [-2147483648, 0], [-2147483648, 1], [-2147483648, 2],
    [-2147483648, -1], [-2147483648, -2],
    [2147483647, 2147483647], [-2147483648, -2147483648],
    [2147483647, -2147483648],
    [1073741824, 2], [1073741823, 2], [-1073741824, 2], [-1073741825, 2]
];

// Helper to compute expected 32-bit signed / 64-bit signed multiplication
function computeExpected(x, y) {
    const bigX = BigInt(x);
    const bigY = BigInt(y);
    const result = bigX * bigY;
    return result;
}

// Function to compile, scramble, and run a single test case
async function runTestCase(x, y, useMba) {
    const exprX = toFortressExpr(x);
    const exprY = toFortressExpr(y);
    const sourceCode = `
        let x = ${exprX};
        let y = ${exprY};
        let z = x * y;
        return z;
    `;
    
    // Compile
    // Set process.env.DEV_MODE during compilation to control whether MBA is used
    process.env.DEV_MODE = useMba ? 'false' : 'true';
    
    const parser = new Parser(sourceCode);
    const ast = parser.parseProgram();
    const codegen = new CodeGenerator();
    const { code, opcodeMap } = codegen.generate(ast);
    
    // Write temporary files for the scrambler
    const fvbcPath = path.join(TEMP_DIR, `temp_test_${useMba}.fvbc`);
    const mapPath = path.join(TEMP_DIR, `temp_test_${useMba}.opcodes.json`);
    fs.writeFileSync(fvbcPath, Buffer.from(code));
    fs.writeFileSync(mapPath, JSON.stringify(Array.from(opcodeMap)));
    
    let payload, newMap, pngBuffer, handshakeHeader;
    try {
        // Scramble and encrypt based on whether VM is in dev or prod mode (not based on whether we compiled with MBA!)
        process.env.DEV_MODE = isDevMode ? 'true' : 'false';
        let clientPublicKey;
        if (!isDevMode) {
            clientPublicKey = vmNode.generate_client_keypair();
        }
        const nonceStore = new InMemoryNonceStore();
        const scrambled = await scrambleSessionPayload(fvbcPath, mapPath, clientPublicKey, nonceStore);
        payload = scrambled.payload;
        newMap = scrambled.newMap;
        pngBuffer = scrambled.pngBuffer;
        handshakeHeader = scrambled.handshakeHeader;
    } finally {
        // Clean up temporary files
        try {
            fs.unlinkSync(fvbcPath);
            fs.unlinkSync(mapPath);
        } catch (e) {}
    }
    
    let resultJsonStr;
    try {
        // Execute
        if (isDevMode) {
            const hashBytes = crypto.createHash('sha256').update(payload).digest();
            vmNode.set_payload_hash(new Uint8Array(hashBytes));
        }
        
        const mapUint8 = new Uint8Array(newMap);
        const header = !isDevMode ? handshakeHeader : pngBuffer;
        resultJsonStr = vmNode.execute(payload, header, "{}", mapUint8);
    } finally {
        if (!isDevMode) {
            vmNode.clear_crypto();
        }
    }
    
    let resultObj;
    if (resultJsonStr.startsWith('{')) {
        resultObj = JSON.parse(resultJsonStr);
    } else {
        if (/^-?\d+$/.test(resultJsonStr)) {
            resultObj = BigInt(resultJsonStr);
        } else {
            resultObj = JSON.parse(resultJsonStr);
        }
    }
    
    return resultObj;
}

let passCount = 0;
let failCount = 0;

console.log("\nStarting stress/differential tests for multiplication (x * y)...");

(async () => {
for (const [x, y] of testCases) {
    const expected = computeExpected(x, y);
    
    // Test DEV_MODE=true (no MBA)
    let resTrue;
    try {
        resTrue = await runTestCase(x, y, false);
    } catch (err) {
        resTrue = { error: err.message, status: false };
    }
    const valTrue = (typeof resTrue === 'bigint') ? resTrue : ((resTrue !== null && typeof resTrue === 'number') ? BigInt(resTrue) : null);
    const passTrue = valTrue === expected;
    
    // Test DEV_MODE=false (with MBA)
    let resFalse;
    try {
        resFalse = await runTestCase(x, y, true);
    } catch (err) {
        resFalse = { error: err.message, status: false };
    }
    const valFalse = (typeof resFalse === 'bigint') ? resFalse : ((resFalse !== null && typeof resFalse === 'number') ? BigInt(resFalse) : null);
    const passFalse = valFalse === expected;
    
    if (passTrue && passFalse) {
        passCount++;
    } else {
        failCount++;
        console.log(`FAIL: x=${x}, y=${y}`);
        console.log(`  Expected: ${expected.toString()}`);
        console.log(`  DEV_MODE=true (No MBA):  Result = ${JSON.stringify(resTrue)}, Match = ${passTrue}`);
        console.log(`  DEV_MODE=false (With MBA): Result = ${JSON.stringify(resFalse)}, Match = ${passFalse}`);
    }
}

console.log(`\nTests finished. Passed: ${passCount}, Failed: ${failCount}`);
if (failCount > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
})().catch(err => {
    console.error(err);
    process.exit(1);
});
