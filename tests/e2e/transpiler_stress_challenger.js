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
console.log("   FORTRESS-WASM TRANSPILER CHALLENGER STRESS     ");
console.log("==================================================");

const results = [];

function deepClone(val) {
    if (val === undefined) return undefined;
    return JSON.parse(JSON.stringify(val));
}

function recordTest(category, name, jsSource, functionName, inputs, expectedBehavior) {
    console.log(`\n[${category}] ${name}`);
    const testRecord = { category, name, status: 'UNKNOWN', error: null, details: {} };
    try {
        // Deep clone inputs to prevent mutations from affecting subsequent runs
        const v8Inputs = deepClone(inputs);
        const fvmInputs = deepClone(inputs);

        let v8Error = null;
        let v8Res = null;
        try {
            v8Res = executeJsInV8(jsSource, functionName, v8Inputs);
        } catch (e) {
            v8Error = e.message;
        }

        let fvmTranspileError = null;
        let fvmExecutionError = null;
        let fvmRes = null;
        let transpiledSource = null;

        try {
            const transResult = transpile(jsSource, {
                functionName,
                filePath: 'test.js',
                verifyEquivalence: false
            });
            transpiledSource = transResult.fvmSource;

            fvmRes = executeJsInFvm(jsSource, functionName, fvmInputs);
        } catch (e) {
            if (transpiledSource === null) {
                fvmTranspileError = e.message;
            } else {
                fvmExecutionError = e.message;
            }
        }

        testRecord.details = {
            v8Res,
            v8Error,
            fvmTranspileError,
            fvmExecutionError,
            fvmRes,
            transpiledSource
        };

        const hasFvmError = fvmTranspileError || fvmExecutionError;
        const errorMsg = fvmTranspileError || fvmExecutionError || "";
        const isParseError = errorMsg.includes("Expected token type") || errorMsg.includes("Parser Error");

        if (expectedBehavior === 'TRANSPILE_FAIL') {
            if (fvmTranspileError || isParseError) {
                testRecord.status = 'PASS';
                console.log(`  => PASS (Correctly failed to transpile/parse: ${errorMsg})`);
            } else {
                testRecord.status = 'FAIL';
                console.log(`  => FAIL (Expected transpilation/parsing failure, but succeeded. FVM output: ${JSON.stringify(fvmRes)})`);
            }
        } else if (expectedBehavior === 'EXECUTION_FAIL') {
            if (fvmExecutionError && !isParseError) {
                testRecord.status = 'PASS';
                console.log(`  => PASS (Correctly failed at execution: ${fvmExecutionError})`);
            } else {
                testRecord.status = 'FAIL';
                console.log(`  => FAIL (Expected execution failure, but got transpile/parse error or success. FVM error: ${fvmExecutionError}, FVM output: ${JSON.stringify(fvmRes)})`);
            }
        } else if (expectedBehavior === 'DISCREPANCY') {
            const v8Str = JSON.stringify(v8Res);
            const fvmStr = JSON.stringify(fvmRes);
            if (v8Error || hasFvmError) {
                testRecord.status = 'PASS';
                console.log(`  => PASS (Discrepancy verified: V8 Error: ${v8Error}, FVM Error: ${errorMsg})`);
            } else if (v8Str !== fvmStr) {
                testRecord.status = 'PASS';
                console.log(`  => PASS (Discrepancy verified: V8: ${v8Str}, FVM: ${fvmStr})`);
            } else {
                testRecord.status = 'FAIL';
                console.log(`  => FAIL (Expected discrepancy but V8 and FVM outputs matched: ${v8Str})`);
            }
        } else { // EQUIVALENT
            const v8Str = JSON.stringify(v8Res);
            const fvmStr = JSON.stringify(fvmRes);
            if (v8Error || hasFvmError) {
                testRecord.status = 'FAIL';
                testRecord.error = `Unexpected error. V8 Err: ${v8Error}, FVM Err: ${errorMsg}`;
                console.log(`  => FAIL (${testRecord.error})`);
            } else if (v8Str === fvmStr) {
                testRecord.status = 'PASS';
                console.log(`  => PASS (Equivalent output: ${v8Str})`);
            } else {
                testRecord.status = 'FAIL';
                testRecord.error = `Output mismatch. V8: ${v8Str}, FVM: ${fvmStr}`;
                console.log(`  => FAIL (${testRecord.error})`);
            }
        }
    } catch (e) {
        testRecord.status = 'CRASH';
        testRecord.error = e.stack;
        console.log(`  => CRASH:`, e.stack);
    }
    results.push(testRecord);
}

// =================================================================
// 1. Destructuring defaults with null vs undefined
// =================================================================

// 1.1 Object destructuring defaults (var level) - Expect compilation failure due to multi-declarator comma.
recordTest(
    "1. Destructuring Defaults",
    "Object destructuring defaults at var level (let { a = 5 } = obj)",
    `function testObjDestruct(obj) {
        let { a = 5 } = obj;
        return a;
    }`,
    "testObjDestruct",
    [{}],
    "DISCREPANCY" // Now transpiles, but default values are not fully supported at runtime
);

// 1.2 Parameter destructuring defaults with null (parameter level)
recordTest(
    "1. Destructuring Defaults",
    "Parameter default value with null (func(a = 5))",
    `function testParamDefaultNull(a = 5) {
        return a;
    }`,
    "testParamDefaultNull",
    [null],
    "DISCREPANCY" // JS yields null, FVM yields 5 due to == null check overwriting null
);

// 1.3 Parameter destructuring defaults with undefined (parameter level)
recordTest(
    "1. Destructuring Defaults",
    "Parameter default value with undefined/missing",
    `function testParamDefaultMissing(a = 5) {
        return a;
    }`,
    "testParamDefaultMissing",
    [],
    "EQUIVALENT" // Both yield 5
);

// 1.4 Array destructuring defaults (var level) - Expect compilation failure due to multi-declarator comma.
recordTest(
    "1. Destructuring Defaults",
    "Array destructuring defaults at var level (let [a = 3] = arr)",
    `function testArrDestruct(arr) {
        let [a = 3] = arr;
        return a;
    }`,
    "testArrDestruct",
    [[]],
    "DISCREPANCY" // Now transpiles, but default values are not fully supported at runtime
);


// =================================================================
// 2. Async/Await splitting
// =================================================================

// 2.1 Async function with await - Expect compilation failure since parser doesn't support async/await keywords.
recordTest(
    "2. Async/Await Splitting",
    "Simple async/await syntax (async function foo() { await 5; })",
    `async function testSimpleAsync(x) {
        let y = await x;
        return y;
    }`,
    "testSimpleAsync",
    [5],
    "TRANSPILE_FAIL" // Custom FVM parser throws token/syntax error on 'async' and 'await'
);

// 2.2 Nested async calls - Expect compilation failure.
recordTest(
    "2. Async/Await Splitting",
    "Nested async functions",
    `async function outer() {
        async function inner() {
            await 2;
        }
        await inner();
    }`,
    "outer",
    [],
    "TRANSPILE_FAIL"
);


// =================================================================
// 3. Array mutations in-place semantics (reference sharing)
// =================================================================

// 3.1 Reference sharing with list mutation (push)
recordTest(
    "3. Array Mutations",
    "Reference sharing with push",
    `function testRefPush() {
        let a = [1, 2];
        let b = a;
        b.push(3);
        return a;
    }`,
    "testRefPush",
    [],
    "EQUIVALENT" // Both yield [1, 2, 3] due to shared list pointer
);

// 3.2 Splice return value discrepancy - Expect compilation failure due to multi-declarator let
recordTest(
    "3. Array Mutations",
    "Array.prototype.splice return value discrepancy",
    `function testSpliceReturn(arr) {
        let removed = arr.splice(1, 1);
        return removed;
    }`,
    "testSpliceReturn",
    [[10, 20, 30]],
    "DISCREPANCY" // Now transpiles, but return value is mutated arr instead of removed slice
);

// 3.3 VM Boundary - In-place argument mutation is lost to JS host
recordTest(
    "3. Array Mutations",
    "In-place argument mutation across VM boundary",
    `function testArgMutate(arr) {
        arr.push(99);
        return arr;
    }`,
    "testArgMutate",
    [[1, 2]],
    "EQUIVALENT" // Both return [1, 2, 99]. V8 mutated input copy; FVM mutated separate FVM copy. Original input stays [1, 2] in host but the returned arrays match.
);


// =================================================================
// 4. Lexicographical vs numeric sorting behavior
// =================================================================

// 4.1 Default sort - Lexicographical sorting on numeric array
recordTest(
    "4. Sorting Behavior",
    "Default lexicographical sorting on numbers",
    `function testDefaultNumericSort(arr) {
        arr.sort();
        return arr;
    }`,
    "testDefaultNumericSort",
    [[10, 5, 20, 1]],
    "EQUIVALENT" // Both yield [1, 10, 20, 5]
);

// 4.2 Custom numeric sort comparator (arrow expression style) - Fails with TypeError in FVM
recordTest(
    "4. Sorting Behavior",
    "Custom numeric sort comparator via expression-bodied arrow function",
    `function testCustomNumericSortArrow(arr) {
        arr.sort((a, b) => a - b);
        return arr;
    }`,
    "testCustomNumericSortArrow",
    [[10, 5, 20, 1]],
    "EXECUTION_FAIL" // MathFloor returns float, causing TypeError on indexing lo+k
);

// 4.3 Custom numeric sort comparator (block/standard function style) - Fails with transpile error
recordTest(
    "4. Sorting Behavior",
    "Custom numeric sort comparator via standard function (block body)",
    `function testCustomNumericSortBlock(arr) {
        arr.sort(function(a, b) { return a - b; });
        return arr;
    }`,
    "testCustomNumericSortBlock",
    [[10, 5, 20, 1]],
    "TRANSPILE_FAIL" // Transpiler replaceIdentifier crashes when trying to wrap BlockStatement
);

// 4.4 Scientific notation lexicographical sort discrepancy
recordTest(
    "4. Sorting Behavior",
    "Lexicographical sort with floats in scientific notation",
    `function testSciSort(arr) {
        arr.sort();
        return arr;
    }`,
    "testSciSort",
    [[1e-7, 2e-8]],
    "EQUIVALENT" // Fixed: scientific notation float formatting matches JS
);

// Write results summary to console
console.log("\n==================================================");
console.log("                CHALLENGER SUMMARY                ");
console.log("==================================================");
let passedCount = 0;
let failedCount = 0;
for (const r of results) {
    if (r.status === 'PASS') {
        passedCount++;
        console.log(`[PASS] [${r.category}] ${r.name}`);
    } else {
        failedCount++;
        console.log(`[FAIL] [${r.category}] ${r.name} - Status: ${r.status}, Error: ${r.error || 'N/A'}`);
    }
}
console.log("==================================================");
console.log(`Total Run: ${results.length}`);
console.log(`Passed:    ${passedCount}`);
console.log(`Failed:    ${failedCount}`);
console.log("==================================================");

// Write to JSON report in challenger folder
const reportPath = '/Users/luke/Desktop/fortress-wasm/.agents/challenger_m2_transpiler_1/test_run_report.json';
fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
console.log(`Saved detailed JSON report to ${reportPath}`);

if (failedCount > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
