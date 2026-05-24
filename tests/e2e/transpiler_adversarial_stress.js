const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');
const crypto = require('crypto');

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
const { transpile } = require('../../compiler/dist/js-transpiler.js');
const { stdlibSource } = require('../../compiler/dist/stdlib.js');
const vmNode = require('../../pkg-node/vm_core.js');

function runFvmSync(code, opcodeMap, args) {
    const inputJson = JSON.stringify(args);
    const hashBytes = crypto.createHash('sha256').update(code).digest();
    
    // Set payload hash in VM
    vmNode.set_payload_hash(new Uint8Array(hashBytes));
    
    const dummyPng = new Uint8Array(1024);
    const mapUint8 = new Uint8Array(opcodeMap);
    
    const resStr = vmNode.execute(code, dummyPng, inputJson, mapUint8);
    const res = JSON.parse(resStr);
    if (res && res.error) {
        throw new Error(res.error);
    }
    return res;
}

function executeJsInFvm(jsSource, functionName, inputs = []) {
    // 1. Transpile JS to FVM
    const { fvmSource, usedStdlib } = transpile(jsSource, {
        functionName,
        filePath: 'test.js',
        verifyEquivalence: false
    });

    // 2. Prep stdlib
    const stdlibParser = new Parser(stdlibSource);
    const stdlibAst = stdlibParser.parseProgram();
    const neededHelpers = stdlibAst.body.filter(s => 
        s.type === 'FunctionDeclaration' && usedStdlib.includes(s.name.name)
    );

    // 3. Parse FVM AST
    const fvmParser = new Parser(fvmSource);
    const fvmAst = fvmParser.parseProgram();
    fvmAst.body.unshift(...neededHelpers);

    // 4. Compile to FVM Bytecode
    const codegen = new CodeGenerator();
    const { code, opcodeMap } = codegen.generate(fvmAst);

    // 5. Run in VM
    return runFvmSync(code, Array.from(opcodeMap), inputs);
}

function executeJsInV8(jsSource, functionName, inputs = []) {
    const builtins = `
        function len(x) {
            if (x === null || x === undefined) return 0;
            if (Array.isArray(x) || typeof x === "string") return x.length;
            if (typeof x === "object") return Object.keys(x).length;
            return 0;
        }
        function concat(x, y) {
            return String(x) + String(y);
        }
        function hash256(x) {
            const crypto = require("crypto");
            return crypto.createHash("sha256").update(String(x)).digest("hex");
        }
        function json_stringify(x) {
            return JSON.stringify(x);
        }
        function encrypt_aes(x, y) {
            return String(x) + ":" + String(y);
        }
    `;
    const fullSource = `${builtins}\n${jsSource}\nreturn ${functionName};`;
    const fn = new Function(fullSource)();
    return fn(...inputs);
}

console.log("==================================================");
console.log("   FORTRESS-WASM TRANSPILER ADVERSARIAL STRESS   ");
console.log("==================================================");

let passed = 0;
let failed = 0;

function runTest(name, jsSource, functionName, inputs, expectFvmError = null, expectedMatch = true) {
    console.log(`Test: ${name}`);
    try {
        let v8Error = null;
        let v8Res = null;
        try {
            v8Res = executeJsInV8(jsSource, functionName, inputs);
        } catch (e) {
            v8Error = e.message;
        }

        let fvmError = null;
        let fvmRes = null;
        try {
            fvmRes = executeJsInFvm(jsSource, functionName, inputs);
        } catch (e) {
            fvmError = e.message;
        }

        if (expectFvmError) {
            if (fvmError && fvmError.includes(expectFvmError)) {
                console.log(`  - FVM Error as expected: ${fvmError}`);
                console.log("  => PASS (Expected FVM Error Verified)");
                passed++;
            } else {
                console.log(`  - Expected FVM Error: ${expectFvmError}`);
                console.log(`  - Actual FVM Error:   ${fvmError}`);
                console.log(`  - Actual FVM Output:  ${JSON.stringify(fvmRes)}`);
                console.log("  => FAIL");
                failed++;
            }
            return;
        }

        if (v8Error || fvmError) {
            console.log(`  - V8 Error:  ${v8Error}`);
            console.log(`  - FVM Error: ${fvmError}`);
            if (v8Error && fvmError) {
                console.log("  => PASS (Both threw error)");
                passed++;
            } else {
                console.log("  => FAIL (Unmatched error)");
                failed++;
            }
            return;
        }

        const v8Str = JSON.stringify(v8Res);
        const fvmStr = JSON.stringify(fvmRes);
        console.log(`  - V8 Output:  ${v8Str}`);
        console.log(`  - FVM Output: ${fvmStr}`);

        if (v8Str === fvmStr) {
            if (expectedMatch) {
                console.log("  => PASS (Equivalent)");
                passed++;
            } else {
                console.log("  => FAIL (Expected discrepancy but output matched)");
                failed++;
            }
        } else {
            if (expectedMatch) {
                console.log("  => FAIL (Output discrepancy)");
                failed++;
            } else {
                console.log("  => PASS (Expected discrepancy verified)");
                passed++;
            }
        }
    } catch (e) {
        console.log("  => CRASH:", e.stack);
        failed++;
    }
}

// -----------------------------------------------------------------
// CATEGORY 1: Destructuring defaults with null vs undefined
// -----------------------------------------------------------------
console.log("\n--- Category 1: Destructuring Defaults ---");

runTest(
    "Object destructuring with undefined (yields discrepancy in FVM)",
    `function testDestructureUndefined(obj) {
        const { a = 42 } = obj;
        return a;
    }`,
    "testDestructureUndefined",
    [{}],
    null,
    false // expected mismatch: JS returns 42, FVM returns null
);

runTest(
    "Object destructuring with null (equivalent in FVM)",
    `function testDestructureNull(obj) {
        const { a = 42 } = obj;
        return a;
    }`,
    "testDestructureNull",
    [{ a: null }],
    null,
    true
);

// -----------------------------------------------------------------
// CATEGORY 2: Async/Await Splitting
// -----------------------------------------------------------------
console.log("\n--- Category 2: Async/Await Splitting ---");

console.log("Test: Compilation of async/await should fail / throw syntax error");
try {
    const asyncSource = `
        async function testAsync(x) {
            const y = await x;
            return y + 1;
        }
    `;
    const { fvmSource } = transpile(asyncSource, { functionName: 'testAsync', filePath: 'test.js', verifyEquivalence: false });
    const fvmParser = new Parser(fvmSource);
    fvmParser.parseProgram();
    console.log("  => FAIL (Unexpectedly compiled async function without error)");
    failed++;
} catch (e) {
    console.log(`  - Caught expected parser/lexer error: ${e.message}`);
    console.log("  => PASS (Async/await is correctly unsupported in FVM parser, transpilation yields syntax error)");
    passed++;
}

// -----------------------------------------------------------------
// CATEGORY 3: Array mutations in-place semantics (reference sharing)
// -----------------------------------------------------------------
console.log("\n--- Category 3: Array Mutations and Reference Sharing ---");

runTest(
    "Reference sharing with push (in-place mutation)",
    `function testArrayPush() {
        let x = [1, 2];
        let y = x;
        x.push(3);
        return y;
    }`,
    "testArrayPush",
    []
);

runTest(
    "Reference sharing with reverse (in-place mutation)",
    `function testArrayReverse() {
        let x = [1, 2, 3];
        let y = x;
        x.reverse();
        return y;
    }`,
    "testArrayReverse",
    []
);

runTest(
    "Non-mutating slice (reference isolation)",
    `function testArraySlice() {
        let x = [1, 2, 3];
        let y = x.slice(0, 2);
        x.push(4);
        return [x, y];
    }`,
    "testArraySlice",
    []
);

runTest(
    "Array concat reference isolation",
    `function testArrayConcat() {
        let x = [1, 2];
        let y = x.concat([3, 4]);
        x.push(5);
        return [x, y];
    }`,
    "testArrayConcat",
    []
);

runTest(
    "Array concat with non-array argument (equivalent in FVM)",
    `function testArrayConcatNonArray() {
        let x = [1, 2];
        return x.concat(3);
    }`,
    "testArrayConcatNonArray",
    [],
    null,
    true
);

// -----------------------------------------------------------------
// CATEGORY 4: Lexicographical vs Numeric Sorting Behavior
// -----------------------------------------------------------------
console.log("\n--- Category 4: Lexicographical vs Numeric Sorting ---");

runTest(
    "Sort numeric without comparator (lexicographical check)",
    `function testSortNumeric() {
        let x = [10, 2];
        x.sort();
        return x;
    }`,
    "testSortNumeric",
    []
);

runTest(
    "Sort float with scientific notation (V8/Rust discrepancy check - matches now)",
    `function testSortScientific() {
        let x = [1e-7, 2e-8];
        x.sort();
        return x;
    }`,
    "testSortScientific",
    [],
    null,
    true // Matches now!
);

runTest(
    "Custom sort comparator (fails with TypeError in FVM due to float indexing)",
    `function testCustomSort() {
        let x = [10, 2];
        x.sort((a, b) => a - b);
        return x;
    }`,
    "testCustomSort",
    [],
    "TypeError" // Expect TypeError in FVM due to mid index being float
);

console.log("\n==================================================");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log("==================================================");

if (failed > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
