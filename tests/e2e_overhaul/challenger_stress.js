const assert = require('assert');
const { transpile, verifyEquivalenceSync, verifyEquivalence } = require('../../compiler/dist/js-transpiler.js');
const { Parser } = require('../../compiler/dist/parser.js');
const { CodeGenerator } = require('../../compiler/dist/codegen.js');
const { stdlibSource } = require('../../compiler/dist/stdlib.js');

async function testEquivalenceLocal(jsCode, functionName) {
    const { fvmSource, usedStdlib } = transpile(jsCode, {
        functionName,
        filePath: 'test.js',
        verifyEquivalence: false
    });

    const stdlibParser = new Parser(stdlibSource);
    const stdlibAst = stdlibParser.parseProgram();
    const neededHelpers = stdlibAst.body.filter(s => 
        s.type === 'FunctionDeclaration' && usedStdlib.includes(s.name.name)
    );

    const fvmParser = new Parser(fvmSource);
    const fvmAst = fvmParser.parseProgram();
    fvmAst.body.unshift(...neededHelpers);

    const codegen = new CodeGenerator();
    const { code, opcodeMap } = codegen.generate(fvmAst, functionName);

    await verifyEquivalence(jsCode, code, Array.from(opcodeMap));
}

async function runStressTests() {
    console.log("==========================================");
    console.log("Starting Challenger Stress Tests...");
    console.log("==========================================");

    // --- Stress Test 1: SAB Memory Sharing inside FVM ---
    console.log("\n[Test 1] SharedArrayBuffer Memory Sharing inside FVM");
    const sabSharingCode = `
        function testSabSharing() {
            let sab = new SharedArrayBuffer(4);
            let arr1 = new Int32Array(sab);
            let arr2 = new Int32Array(sab);
            arr1[0] = 42;
            return arr2[0];
        }
    `;
    try {
        await testEquivalenceLocal(sabSharingCode, 'testSabSharing');
        console.log("SAB Memory Sharing Result: PASS (unexpectedly!)");
    } catch (err) {
        console.log("SAB Memory Sharing Result: FAILED as expected!");
        console.log("Error details:", err.message);
    }

    // --- Stress Test 2: Register Banking Parameter Overflow (Infinite Recursion Check) ---
    console.log("\n[Test 2] Register Banking Parameter Overflow (250 Parameters)");
    let params = [];
    for (let i = 0; i < 250; i++) {
        params.push(`p${i}`);
    }
    const paramOverflowCode = `
        function testParamOverflow(${params.join(', ')}) {
            return p0;
        }
    `;
    try {
        console.log("Transpiling function with 250 parameters...");
        transpile(paramOverflowCode, {
            functionName: 'testParamOverflow',
            filePath: 'test.js',
            verifyEquivalence: false
        });
        console.log("Transpilation: SUCCESS");
    } catch (err) {
        console.log("Transpilation FAILED:");
        if (err.message.includes("Maximum call stack size exceeded")) {
            console.log("Confirmed Bug: Stack Overflow / Infinite Recursion detected in Register Banking!");
        } else {
            console.log(err.stack || err.message);
        }
    }

    // --- Stress Test 3: Large Function Splitting Quadratic Scaling ---
    console.log("\n[Test 3] Large Function Splitting Performance Scaling");
    const statementCounts = [100, 500, 1000, 1100, 1500, 2000];
    for (const count of statementCounts) {
        let funcBody = `function testScale_${count}() {\n  let x = 0;\n`;
        for (let i = 0; i < count; i++) {
            funcBody += `  x = x + 1;\n`;
        }
        funcBody += `  return x;\n}`;

        const start = Date.now();
        try {
            transpile(funcBody, {
                functionName: `testScale_${count}`,
                filePath: 'test.js',
                verifyEquivalence: false
            });
            const duration = Date.now() - start;
            console.log(`Statements: ${count.toString().padStart(4)} | Time: ${duration}ms`);
        } catch (err) {
            console.log(`Statements: ${count} | Failed: ${err.message}`);
        }
    }

    console.log("\n==========================================");
    console.log("Challenger Stress Tests Completed.");
    console.log("==========================================");
}

runStressTests().catch(console.error);
