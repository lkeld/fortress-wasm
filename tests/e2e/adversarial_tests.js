const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

// Mock require('env') before loading the VM Node module to intercept native calls
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
    if (id === 'env') {
        return {
            native_call: function (nativeId, argsJsonStr) {
                return "{}";
            }
        };
    }
    return originalRequire.apply(this, arguments);
};

// Import compiler and VM modules
const { Parser } = require('../../compiler/dist/parser.js');
const { CodeGenerator } = require('../../compiler/dist/codegen.js');
const { scrambleSessionPayload } = require('../../server/scrambler.js');
const vmNode = require('../../pkg-node/vm_core.js');
const { OpCode } = require('../../compiler/dist/opcodes.js');

const TEMP_DIR = os.tmpdir();

// Detect DEV mode dynamically from the VM build
let isDevMode = false;
try {
    vmNode.set_payload_hash(new Uint8Array(32)); // Set all-zero fake hash
    const testDevResult = JSON.parse(vmNode.execute(new Uint8Array([0]), new Uint8Array(1024), "{}", new Uint8Array(256)));
    if (testDevResult.error === "Dev mode VirtSC hash mismatch") {
        isDevMode = true;
    }
} catch (e) {}


function compileAndExecute(source, inputs = [], devMode = false) {
    vmNode.clear_crypto();
    const parser = new Parser(source);
    const ast = parser.parseProgram();
    const codegen = new CodeGenerator();
    const { code, opcodeMap } = codegen.generate(ast);

    const fvbcPath = path.join(TEMP_DIR, `temp_adv.fvbc`);
    const mapPath = path.join(TEMP_DIR, `temp_adv.opcodes.json`);
    fs.writeFileSync(fvbcPath, Buffer.from(code));
    fs.writeFileSync(mapPath, JSON.stringify(Array.from(opcodeMap)));

    process.env.DEV_MODE = devMode ? 'true' : 'false';

    try {
        let clientPublicKey;
        if (!devMode) {
            clientPublicKey = vmNode.generate_client_keypair();
        }

        const { payload, newMap, pngBuffer, handshakeHeader } = scrambleSessionPayload(fvbcPath, mapPath, clientPublicKey);
        const mapUint8 = new Uint8Array(newMap);

        // Prepend 7 nulls to offset the dummy variables in vm.locals
        const paddedInputs = Array(7).fill(null).concat(inputs);
        const inputJsonStr = JSON.stringify(paddedInputs);

        if (devMode) {
            const crypto = require('crypto');
            const hashBytes = crypto.createHash('sha256').update(payload).digest();
            vmNode.set_payload_hash(new Uint8Array(hashBytes));
        }

        const header = !devMode ? handshakeHeader : pngBuffer;
        const resultJsonStr = vmNode.execute(payload, header, inputJsonStr, mapUint8);
        return JSON.parse(resultJsonStr);
    } finally {
        if (!devMode) {
            vmNode.clear_crypto();
        }
        try {
            fs.unlinkSync(fvbcPath);
            fs.unlinkSync(mapPath);
        } catch (e) {}
    }
}

console.log("==========================================");
// console.log("   FORTRESS-WASM ADVERSARIAL STRESS TESTS ");
console.log("==========================================");

// Case 1: Scope Isolation and Nested Function Codegen Crash/Mismatch
try {
    console.log("Test 1: Scope Isolation & Nested Function Execution...");
    const source = `
        fn outer() {
            let a = 42;
            fn inner() {
                return a;
            }
            return inner();
        }
        return outer();
    `;
    const res = compileAndExecute(source, [], isDevMode);
    console.log("  Result:", res);
    // If it works correctly under lexical scope or hoists/jumps, it would return 42.
    // If it returns null/crashes, it fails or exhibits the early return / uninitialized local bug.
    if (res === 42) {
        console.log("  => PASS (Lexical scope / nested function supported)");
    } else {
        console.log(`  => FAIL (Expected 42, got ${JSON.stringify(res)})`);
    }
} catch (e) {
    console.log("  => CRASH/FAIL:", e.message);
}

// Case 2: Local Slot Boundary Overflow (Slot index >= 256)
try {
    console.log("\nTest 2: Local Slot Boundary Overflow (130 additions)...");
    let additionStr = "1";
    for (let i = 0; i < 130; i++) {
        additionStr += " + 1";
    }
    const source = `
        fn overflow() {
            let x = ${additionStr};
            return x;
        }
        return overflow();
    `;
    const res = compileAndExecute(source, [], isDevMode);
    console.log("  Result:", res);
    if (res === 131) {
        console.log("  => PASS (Successfully handled 130 additions)");
    } else {
        console.log(`  => FAIL (Expected 131, got ${JSON.stringify(res)})`);
    }
} catch (e) {
    console.log("  => CRASH/FAIL:", e.message);
}

// Case 3: Floating-Point TypeError under Production Mode
try {
    console.log("\nTest 3: Floating-Point TypeError (Parameter + Integer) in PROD mode...");
    const source = `
        fn addFloat(x) {
            return x + 1;
        }
        return addFloat(1.5);
    `;
    const res = compileAndExecute(source, [1.5], isDevMode);
    console.log("  Result:", res);
    if (res === 2.5) {
        console.log("  => PASS (Float parameter arithmetic succeeded)");
    } else {
        console.log(`  => FAIL (Expected 2.5, got ${JSON.stringify(res)})`);
    }
} catch (e) {
    console.log("  => CRASH/FAIL:", e.message);
}

// Case 4: Cross-Function return bug simulation
try {
    console.log("\nTest 4: Cross-Function Return Bug (Shared code index check)...");
    const source = `
        fn f1() {
            return 1;
        }
        fn f2() {
        }
    `;
    const parser = new Parser(source);
    const ast = parser.parseProgram();
    
    let bugTriggered = false;
    let attempts = 0;
    
    // We run the compiler repeatedly until we hit a random seed where opcodeMap[Return] === 0x92 (Return opcode raw value)
    // Return raw code is 0x92 (146).
    for (let i = 0; i < 1000; i++) {
        const codegen = new CodeGenerator();
        const { code, opcodeMap } = codegen.generate(ast);
        attempts++;
        
        // Find mapped code for Return
        const mappedReturn = opcodeMap[OpCode.Return];
        // Check if f2 has Return.
        // We know that f1's start is set in codegen.functions.
        // We can inspect the bytecode between functions.
        // Or simply check if the bytecode has any Return instruction at all.
        // If the bug triggers, f2 has NO Return instruction, so the count of Return opcodes in the entire bytecode will be 2 (one for main program Halt/Return?, wait, main ends with Halt, f1 ends with Return. f2 would normally end with Return. If f2 doesn't, we have only 1 Return opcode in the entire program!)
        // Let's count how many Return opcodes are in the bytecode.
        let returnCount = 0;
        for (let j = 0; j < code.length; j++) {
            if (opcodeMap[code[j]] === OpCode.Return) {
                returnCount++;
            }
        }
        
        if (mappedReturn === 0x92) {
            // This is the trigger condition
            if (returnCount < 2) {
                bugTriggered = true;
                console.log(`  Bug triggered on attempt ${attempts}!`);
                console.log(`  Mapped Return opcode byte: 0x${mappedReturn.toString(16)} (Matches raw OpCode.Return value 0x92)`);
                console.log(`  Total Return instructions in compiled program: ${returnCount} (Expected: 2)`);
                break;
            }
        }
    }
    
    if (bugTriggered) {
        console.log("  => FAIL (Return statement for f2 was omitted due to shared index check and scrambled comparison)");
    } else {
        console.log(`  => PASS (Return bug not triggered after ${attempts} attempts)`);
    }
} catch (e) {
    console.log("  => CRASH/FAIL:", e.message);
}
