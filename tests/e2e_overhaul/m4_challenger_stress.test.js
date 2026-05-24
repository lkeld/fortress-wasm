const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { runTestSuite } = require('./runner');
const { Parser } = require('../../compiler/dist/parser.js');
const { CodeGenerator } = require('../../compiler/dist/codegen.js');
const { transpile } = require('../../compiler/dist/js-transpiler.js');
const { stdlibSource } = require('../../compiler/dist/stdlib.js');

// Helper to get a runnable wrapper of the transpiled function mapped to FVM execution
function getRunnableWrapper(jsCode, functionName) {
    const { fvmSource, jsWrapper, usedStdlib } = transpile(jsCode, {
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

    const tempFilePath = path.join(__dirname, `temp_runnable_${functionName}.js`);
    
    const mockClient = `
    const FortressClient = {
        init: async () => {
            return {
                execute: async (payload) => {
                    const vmNode = require('../../pkg-node/vm_core.js');
                    const crypto = require('crypto');
                    let code = Buffer.from("${Buffer.from(code).toString('base64')}", 'base64');
                    const opcodeMap = [${Array.from(opcodeMap).join(',')}];
                    
                    const seen = new Set();
                    const inputJson = JSON.stringify(payload, (key, value) => {
                        if (value !== null && typeof value === 'object') {
                            if (seen.has(value)) return "[Circular]";
                            seen.add(value);
                        }
                        return value;
                    });
                    
                    if (code.length > 0 && code.length % 288 === 0) {
                        const newCode = new Uint8Array(code.length + 1);
                        newCode.set(code);
                        newCode[code.length] = 0;
                        code = newCode;
                    }
                    
                    const hashBytes = crypto.createHash('sha256').update(code).digest();
                    vmNode.set_payload_hash(new Uint8Array(hashBytes));
                    const dummyPng = new Uint8Array(1024);
                    const mapUint8 = new Uint8Array(opcodeMap);
                    
                    vmNode.init_crypto_with_key(new Uint8Array(32), new Uint8Array(32), new Uint8Array(32), 0);
                    try {
                        const resStr = vmNode.execute(code, dummyPng, inputJson, mapUint8);
                        const res = JSON.parse(resStr);
                        if (res && res.error) {
                            throw new Error(res.error);
                        }
                        return res;
                    } finally {
                        vmNode.clear_crypto();
                    }
                }
            };
        }
    };
    `;
    
    const modifiedWrapper = jsWrapper.replace(
        "const { FortressClient } = require('../../client.js');",
        mockClient
    );
    
    fs.writeFileSync(tempFilePath, modifiedWrapper);
    const wrapper = require(tempFilePath);
    
    // Clean up
    fs.unlinkSync(tempFilePath);
    delete require.cache[require.resolve(tempFilePath)];
    
    return wrapper;
}

runTestSuite('Milestone 4: Transpiler & VM Challenger Stress Tests', {
    'SharedArrayBuffer - View Sharing Bug': async () => {
        const jsCode = `
            function testSharedMemory() {
                let sab = new SharedArrayBuffer(4);
                let arr1 = new Uint8Array(sab);
                let arr2 = new Uint8Array(sab);
                arr1[0] = 42;
                return arr2[0];
            }
        `;
        const runFvm = getRunnableWrapper(jsCode, 'testSharedMemory');
        const fvmRes = await runFvm();
        
        console.log("  [SAB Sharing] FVM result:", fvmRes, "Expected standard JS:", 42);
        // FVM result is expected to be 0 due to memory copies instead of shared memory.
        assert.strictEqual(fvmRes, 42, "FVM did not share memory between views of same SharedArrayBuffer!");
    },

    'SharedArrayBuffer - Pre-populated Argument passing Bug': async () => {
        const jsCode = `
            function testSabArgs(sab) {
                let arr = new Uint8Array(sab);
                return arr[0];
            }
        `;
        const runFvm = getRunnableWrapper(jsCode, 'testSabArgs');
        
        const sab = new SharedArrayBuffer(4);
        const arr = new Uint8Array(sab);
        arr[0] = 42;
        
        const fvmRes = await runFvm(sab);
        console.log("  [SAB Argument] FVM result:", fvmRes, "Expected standard JS:", 42);
        // FVM result is expected to be 0 due to ignoring initial data inside TypedArray_new
        assert.strictEqual(fvmRes, 42, "FVM did not preserve pre-populated values from SharedArrayBuffer argument!");
    },

    'TypedArray - Mutability Leakage Bug': async () => {
        const jsCode = `
            function testTypedArraySharing() {
                let arr1 = [1, 2, 3];
                let arr2 = new Uint8Array(arr1);
                arr1[0] = 99;
                return arr2[0];
            }
        `;
        const runFvm = getRunnableWrapper(jsCode, 'testTypedArraySharing');
        const fvmRes = await runFvm();
        console.log("  [TypedArray Mutation] FVM result:", fvmRes, "Expected standard JS:", 1);
        // FVM result is expected to be 99 because TypedArray_new returns the original list
        assert.strictEqual(fvmRes, 1, "FVM returned mutated value from aliased array!");
    },

    'Recursive Register Banking Split Bug': async () => {
        let jsCode = `function testRecursiveSplit() {\n`;
        // Declare 300 variables for Part 1
        for (let i = 0; i <= 300; i++) {
            jsCode += `  let v${i} = ${i};\n`;
        }
        // Force interference in Part 1 by summing them
        jsCode += `  let sum1 = `;
        for (let i = 0; i <= 300; i++) {
            jsCode += `v${i}` + (i === 300 ? ';' : ' + ');
        }
        jsCode += `\n`;
        
        // Declare 150 variables for Part 2
        for (let i = 0; i <= 150; i++) {
            jsCode += `  let w${i} = ${i};\n`;
        }
        // Force interference in Part 2 by summing them
        jsCode += `  let sum2 = `;
        for (let i = 0; i <= 150; i++) {
            jsCode += `w${i}` + (i === 150 ? ';' : ' + ');
        }
        jsCode += `\n`;
        
        // Read v10 from Part 1 in Part 2
        jsCode += `  return sum1 + sum2 + v10;\n}`;
        
        const runFvm = getRunnableWrapper(jsCode, 'testRecursiveSplit');
        const fvmRes = await runFvm();
        console.log("  [Recursive Split] FVM result:", fvmRes, "Expected standard JS:", 45150 + 11325 + 10);
        assert.strictEqual(fvmRes, 56485, "Recursive Register Banking Split failed to propagate live variables!");
    },

    'Compilation performance scaling under stress': async () => {
        const sizes = [10, 50, 100, 200, 300, 400];
        const times = [];
        
        for (const size of sizes) {
            let code = `function perfTest() {\n`;
            for (let i = 0; i < size; i++) {
                code += `  let v${i} = ${i};\n`;
                code += `  if (v${i} < 0) return v${i};\n`;
            }
            code += `  return 42;\n}`;
            
            const start = performance.now();
            transpile(code, {
                functionName: 'perfTest',
                filePath: 'test.js',
                verifyEquivalence: false
            });
            const end = performance.now();
            times.push(end - start);
        }
        
        console.log("  [Performance Scaling] Variable size vs transpilation time (ms):");
        for (let i = 0; i < sizes.length; i++) {
            console.log(`    Size: ${sizes[i]} variables -> ${times[i].toFixed(2)} ms`);
        }
        
        // Check scaling ratio. If scaling is quadratic (O(N^2)), the ratio between sizes[i] and sizes[i-1]
        // will show quadratic growth in time compared to size.
        // Let's assert that transpiling a 400-variable function takes less than 1.5 seconds.
        assert.ok(times[times.length - 1] < 1500, `Transpiler took too long for 400 variables: ${times[times.length - 1]} ms`);
    }
});
