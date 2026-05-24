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
const { scanFile } = require('../../compiler/dist/scanner.js');
const vmNode = require('../../pkg-node/vm_core.js');

// Detect DEV mode dynamically
let isDevMode = false;
try {
    vmNode.set_payload_hash(new Uint8Array(32));
    const testDevResult = JSON.parse(vmNode.execute(new Uint8Array([0]), new Uint8Array(1024), "{}", new Uint8Array(256)));
    if (testDevResult.error === "Dev mode VirtSC hash mismatch") {
        isDevMode = true;
    }
} catch (e) {}

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

const findings = [];

function runTestCase(area, name, jsSource, functionName, inputs, expectedMatch = true, expectFvmError = null) {
    const testDesc = `[${area}] ${name}`;
    console.log(`\n--- Test: ${testDesc} ---`);
    let v8Res = null;
    let v8Error = null;
    try {
        v8Res = executeJsInV8(jsSource, functionName, inputs);
    } catch (e) {
        v8Error = e.message;
    }

    let fvmRes = null;
    let fvmError = null;
    let transpilationFailed = false;

    try {
        fvmRes = executeJsInFvm(jsSource, functionName, inputs);
    } catch (e) {
        fvmError = e.message;
        if (e.message.includes("Transpilation failed") || e.message.includes("parse")) {
            transpilationFailed = true;
        }
    }

    console.log(`  Inputs: ${JSON.stringify(inputs)}`);
    console.log(`  V8 Result:  ${v8Error ? `ERROR: ${v8Error}` : JSON.stringify(v8Res)}`);
    console.log(`  FVM Result: ${fvmError ? `ERROR: ${fvmError}` : JSON.stringify(fvmRes)}`);

    const resultRecord = {
        area,
        name,
        inputs,
        v8: v8Error ? { error: v8Error } : { value: v8Res },
        fvm: fvmError ? { error: fvmError } : { value: fvmRes },
        status: "PASS",
        details: ""
    };

    if (expectFvmError) {
        if (fvmError && fvmError.includes(expectFvmError)) {
            resultRecord.status = "PASS";
            resultRecord.details = `Expected FVM error matched: ${fvmError}`;
        } else {
            resultRecord.status = "FAIL";
            resultRecord.details = `Expected FVM error "${expectFvmError}" but got: ${fvmError || JSON.stringify(fvmRes)}`;
        }
    } else if (v8Error || fvmError) {
        if (v8Error && fvmError) {
            resultRecord.status = "PASS";
            resultRecord.details = "Both V8 and FVM threw errors as expected.";
        } else {
            resultRecord.status = "FAIL";
            resultRecord.details = `Unmatched error. V8 Error: ${v8Error}, FVM Error: ${fvmError}`;
        }
    } else {
        const v8Str = JSON.stringify(v8Res);
        const fvmStr = JSON.stringify(fvmRes);
        if (v8Str === fvmStr) {
            if (expectedMatch) {
                resultRecord.status = "PASS";
                resultRecord.details = "Output matches exactly.";
            } else {
                resultRecord.status = "FAIL";
                resultRecord.details = "Expected discrepancy but outputs matched.";
            }
        } else {
            if (expectedMatch) {
                resultRecord.status = "FAIL";
                resultRecord.details = `Discrepancy: V8 returned ${v8Str}, FVM returned ${fvmStr}`;
            } else {
                resultRecord.status = "PASS";
                resultRecord.details = `Expected discrepancy verified: V8 returned ${v8Str}, FVM returned ${fvmStr}`;
            }
        }
    }

    findings.push(resultRecord);
    console.log(`  Result: ${resultRecord.status} (${resultRecord.details})`);
}

// ============================================================================
// AREA 1: Scanner Block Extraction
// ============================================================================
console.log("\n==================================================");
console.log("   AREA 1: Scanner Block Extraction               ");
console.log("==================================================");

const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fortress_scanner_tests_'));
try {
    // 1. Multiple comment blocks, single protected function
    const file1 = path.join(TEMP_DIR, 'file1.js');
    fs.writeFileSync(file1, `
        /** @protect-name funcA */
        /** @protect */
        export function funcA() {
            /* nested comments
             * inside comment
             */
            return 1;
        }
    `);
    const scan1 = scanFile(file1);
    const scannerPassed1 = scan1.length === 1 && scan1[0].customName === 'funcA';
    findings.push({
        area: "1. Scanner",
        name: "Multiple JSDoc Comments and nested comments block extraction",
        status: scannerPassed1 ? "PASS" : "FAIL",
        details: scannerPassed1 ? "Successfully extracted funcA" : `Failed: length=${scan1.length}`
    });

    // 2. Nested braces in regexes
    const file2 = path.join(TEMP_DIR, 'file2.js');
    fs.writeFileSync(file2, `
        /** @protect-name funcRegex */
        /** @protect */
        export function funcRegex() {
            const re = /\\{[a-z]{1,3}\\}/;
            return 42;
        }
    `);
    const scan2 = scanFile(file2);
    const scannerPassed2 = scan2.length === 1 && scan2[0].code.includes("return 42;");
    findings.push({
        area: "1. Scanner",
        name: "Nested braces in regex block extraction",
        status: scannerPassed2 ? "PASS" : "FAIL",
        details: scannerPassed2 ? "Successfully extracted funcRegex" : `Failed: length=${scan2.length}`
    });

    // 3. Division lookalike regex with braces
    const file3 = path.join(TEMP_DIR, 'file3.js');
    fs.writeFileSync(file3, `
        /** @protect-name funcRegexDiv */
        /** @protect */
        export function funcRegexDiv(x) {
            const res = (x) / /{/g.test(x);
            return res;
        }
        function followUp() {
            return 99;
        }
    `);
    const scan3 = scanFile(file3);
    // If the division lookalike regex with braces breaks scanner, it might not find the closing brace of funcRegexDiv
    // or it might scan into followUp.
    const scannerPassed3 = scan3.length === 1 && !scan3[0].code.includes("followUp");
    findings.push({
        area: "1. Scanner",
        name: "Division lookalike regex with braces",
        status: scannerPassed3 ? "PASS" : "FAIL",
        details: scannerPassed3 ? "Successfully isolated funcRegexDiv" : `Failed: scanned code contains followUp or invalid extraction.`
    });

    // 4. Complex string escapes
    const file4 = path.join(TEMP_DIR, 'file4.js');
    fs.writeFileSync(file4, `
        /** @protect-name funcEscapes */
        /** @protect */
        export function funcEscapes() {
            const s1 = "{\\\\\\"";
            const s2 = "{\\\\\\\\";
            const s3 = '{\\\\'';
            const s4 = \`{\\\\\`\`;
            return 100;
        }
        function followUp2() {
            return 99;
        }
    `);
    const scan4 = scanFile(file4);
    const scannerPassed4 = scan4.length === 1 && !scan4[0].code.includes("followUp2");
    findings.push({
        area: "1. Scanner",
        name: "Complex string escapes with braces block extraction",
        status: scannerPassed4 ? "PASS" : "FAIL",
        details: scannerPassed4 ? "Successfully isolated funcEscapes" : `Failed: scanned code contains followUp2 or invalid extraction.`
    });

} catch (e) {
    findings.push({
        area: "1. Scanner",
        name: "Scanner exception",
        status: "FAIL",
        details: e.message
    });
} finally {
    try {
        fs.rmSync(TEMP_DIR, { recursive: true, force: true });
    } catch (e) {}
}

// ============================================================================
// AREA 2: Multi-Declarator Variables
// ============================================================================
console.log("\n==================================================");
console.log("   AREA 2: Multi-Declarator Variables             ");
console.log("==================================================");

runTestCase(
    "2. Multi-Declarator",
    "Nested block multi-declarator",
    `function testNestedMulti() {
        let a = 10;
        {
            let x = 1, y = 2;
            a = x + y;
        }
        return a;
    }`,
    "testNestedMulti",
    []
);

runTestCase(
    "2. Multi-Declarator",
    "For loop initializer multi-declarator",
    `function testLoopMulti() {
        let sum = 0;
        for (let i = 0, j = 5; i < j; i++) {
            sum += i;
        }
        return sum;
    }`,
    "testLoopMulti",
    []
);

runTestCase(
    "2. Multi-Declarator",
    "For loop initializer destructuring with defaults",
    `function testLoopDestruct() {
        let sum = 0;
        for (let [i = 1, j] = [0, 5]; i < j; i++) {
            sum += i;
        }
        return sum;
    }`,
    "testLoopDestruct",
    []
);

// ============================================================================
// AREA 3: Destructuring Null / Undefined
// ============================================================================
console.log("\n==================================================");
console.log("   AREA 3: Destructuring Null / Undefined         ");
console.log("==================================================");

runTestCase(
    "3. Destructuring Null/Undefined",
    "Destructuring null object",
    `function testDestructNull() {
        let obj = null;
        let { a } = obj;
        return a;
    }`,
    "testDestructNull",
    [],
    true // Both should throw TypeError
);

runTestCase(
    "3. Destructuring Null/Undefined",
    "Destructuring undefined object",
    `function testDestructUndefined() {
        let obj;
        let { a } = obj;
        return a;
    }`,
    "testDestructUndefined",
    [],
    true // Both should throw TypeError
);

runTestCase(
    "3. Destructuring Null/Undefined",
    "Destructuring valid array (checks for unintended TypeErrors on valid arrays)",
    `function testDestructArrayValid() {
        let arr = [42];
        let [ a ] = arr;
        return a;
    }`,
    "testDestructArrayValid",
    []
);

// ============================================================================
// AREA 4: Array.isArray and Concat
// ============================================================================
console.log("\n==================================================");
console.log("   AREA 4: Array.isArray and Concat               ");
console.log("==================================================");

runTestCase(
    "4. Array.isArray & Concat",
    "Array.isArray double evaluation side-effects",
    `let counter = 0;
    function getArray() {
        counter = counter + 1;
        return [1, 2];
    }
    function testIsArraySideEffect() {
        counter = 0;
        let res = Array.isArray(getArray());
        return [res, counter];
    }`,
    "testIsArraySideEffect",
    []
);

runTestCase(
    "4. Array.isArray & Concat",
    "Array.isArray type check - array",
    `function testIsArray1(x) { return Array.isArray(x); }`,
    "testIsArray1",
    [[1, 2]]
);

runTestCase(
    "4. Array.isArray & Concat",
    "Array.isArray type check - object",
    `function testIsArray2(x) { return Array.isArray(x); }`,
    "testIsArray2",
    [{}]
);

runTestCase(
    "4. Array.isArray & Concat",
    "Array.isArray type check - null",
    `function testIsArray3(x) { return Array.isArray(x); }`,
    "testIsArray3",
    [null]
);

runTestCase(
    "4. Array.isArray & Concat",
    "Array.isArray type check - string starting with bracket",
    `function testIsArray4(x) { return Array.isArray(x); }`,
    "testIsArray4",
    ["[1,2]"]
);

runTestCase(
    "4. Array.isArray & Concat",
    "Array concat non-array value",
    `function testConcatVal(arr, val) {
        return arr.concat(val);
    }`,
    "testConcatVal",
    [[1, 2], 3]
);

runTestCase(
    "4. Array.isArray & Concat",
    "Array concat array value",
    `function testConcatArr(arr, val) {
        return arr.concat(val);
    }`,
    "testConcatArr",
    [[1, 2], [3, 4]]
);

runTestCase(
    "4. Array.isArray & Concat",
    "Array concat null value",
    `function testConcatNull(arr, val) {
        return arr.concat(val);
    }`,
    "testConcatNull",
    [[1, 2], null]
);

runTestCase(
    "4. Array.isArray & Concat",
    "Array concat string starting with bracket",
    `function testConcatStr(arr, val) {
        return arr.concat(val);
    }`,
    "testConcatStr",
    [[1, 2], "[3,4]"]
);

// ============================================================================
// AREA 5: Integral vs Non-Integral Float Indexing
// ============================================================================
console.log("\n==================================================");
console.log("   AREA 5: Integral vs Non-Integral Float Indexing");
console.log("==================================================");

runTestCase(
    "5. Float Indexing",
    "List get integral float key",
    `function testListGetIntegral() {
        let arr = [10, 20, 30];
        let idx = 1.0;
        return arr[idx];
    }`,
    "testListGetIntegral",
    []
);

runTestCase(
    "5. Float Indexing",
    "List get non-integral float key",
    `function testListGetNonIntegral() {
        let arr = [10, 20, 30];
        let idx = 1.5;
        return arr[idx];
    }`,
    "testListGetNonIntegral",
    [],
    false // Expected mismatch: V8 returns undefined, FVM throws TypeError
);

runTestCase(
    "5. Float Indexing",
    "List set integral float key",
    `function testListSetIntegral() {
        let arr = [10, 20, 30];
        let idx = 1.0;
        arr[idx] = 99;
        return arr[1];
    }`,
    "testListSetIntegral",
    []
);

runTestCase(
    "5. Float Indexing",
    "List set non-integral float key",
    `function testListSetNonIntegral() {
        let arr = [10, 20, 30];
        let idx = 1.5;
        arr[idx] = 99;
        return arr[1];
    }`,
    "testListSetNonIntegral",
    [],
    false // Expected mismatch: V8 returns 20 (assigns property "1.5"), FVM throws TypeError
);

runTestCase(
    "5. Float Indexing",
    "String get integral float key",
    `function testStrGetIntegral() {
        let s = "hello";
        let idx = 1.0;
        return s[idx];
    }`,
    "testStrGetIntegral",
    []
);

runTestCase(
    "5. Float Indexing",
    "String get non-integral float key",
    `function testStrGetNonIntegral() {
        let s = "hello";
        let idx = 1.5;
        return s[idx];
    }`,
    "testStrGetNonIntegral",
    [],
    false // Expected mismatch: V8 returns undefined, FVM throws TypeError
);

// ============================================================================
// AREA 6: Scientific Notation Boundary Formatting
// ============================================================================
console.log("\n==================================================");
console.log("   AREA 6: Scientific Notation Boundary Formatting");
console.log("==================================================");

const floatsToTest = [
    0.000001,
    0.0000001,
    -0.000001,
    -0.0000001,
    1e20,
    1e21,
    -1e20,
    -1e21,
    1.2345e-6,
    1.2345e-7,
    1.2345e20,
    1.2345e21
];

for (const f of floatsToTest) {
    runTestCase(
        "6. Float Formatting",
        `Format boundary float ${f}`,
        `function testFloatFormat() {
            let val = ${f};
            return [val].join("");
        }`,
        "testFloatFormat",
        []
    );
}

// ============================================================================
// Summary & Reporting
// ============================================================================
console.log("\n==================================================");
console.log("   ADVERSARIAL STRESS TEST SUMMARY                ");
console.log("==================================================");

let totalPassed = 0;
let totalFailed = 0;

for (const r of findings) {
    if (r.status === "PASS") totalPassed++;
    else totalFailed++;
    console.log(`[${r.status}] [${r.area}] ${r.name} - ${r.details}`);
}

console.log("\n==================================================");
console.log(`Passed: ${totalPassed}`);
console.log(`Failed: ${totalFailed}`);
console.log("==================================================");

// Write results to a JSON file for independent verification/readability
const resultSummaryPath = path.join(__dirname, 'adversarial_stress_results.json');
fs.writeFileSync(resultSummaryPath, JSON.stringify(findings, null, 2));
console.log(`Detailed results written to ${resultSummaryPath}`);

if (totalFailed > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
