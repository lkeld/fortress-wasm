const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { runTestSuite } = require('./runner');
const { Parser } = require('../../compiler/dist/parser.js');
const { CodeGenerator } = require('../../compiler/dist/codegen.js');
const { transpile } = require('../../compiler/dist/js-transpiler.js');
const { stdlibSource } = require('../../compiler/dist/stdlib.js');

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

    const tempFilePath = path.join(__dirname, `temp_runnable_extra_${functionName}.js`);
    
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

runTestSuite('Milestone 4: Extra Boundary & Stress Tests', {
    'SharedArrayBuffer - Mismatched View Sizes Sharing': async () => {
        const jsCode = `
            function testMismatchedViews() {
                let sab = new SharedArrayBuffer(8);
                let arr8 = new Uint8Array(sab);
                let arr16 = new Uint16Array(sab);
                let arr32 = new Uint32Array(sab);
                arr8[0] = 52;
                arr8[1] = 18;
                arr16[1] = 22136;
                arr32[1] = 305419896;
                return [arr16[0], arr8[2], arr8[3], arr8[4], arr8[5], arr8[6], arr8[7]];
            }
        `;
        const runFvm = getRunnableWrapper(jsCode, 'testMismatchedViews');
        const fvmRes = await runFvm();
        console.log("  [Mismatched Views] FVM result:", fvmRes);
        assert.deepStrictEqual(fvmRes, [4660, 120, 86, 120, 86, 52, 18]);
    },

    'SharedArrayBuffer - Zero Size Allocation (Querying Actual length property)': async () => {
        // Querying arr["length"] directly retrieves the exact length property value from the map
        const jsCode = `
            function testZeroSizeSAB() {
                let sab = new SharedArrayBuffer(0);
                let arr = new Uint8Array(sab);
                return arr["length"];
            }
        `;
        const runFvm = getRunnableWrapper(jsCode, 'testZeroSizeSAB');
        const fvmRes = await runFvm();
        console.log("  [Zero Size SAB] FVM result (arr['length']):", fvmRes);
        assert.strictEqual(fvmRes, 0);
    },

    'SharedArrayBuffer - Zero Size Allocation (Demonstrating arr.length bug)': async () => {
        // Querying arr.length compiles to len(arr), returning the number of keys (length, __sab, __elementSize, __ownKeys) = 4
        const jsCode = `
            function testZeroSizeSABBug() {
                let sab = new SharedArrayBuffer(0);
                let arr = new Uint8Array(sab);
                return arr.length;
            }
        `;
        const runFvm = getRunnableWrapper(jsCode, 'testZeroSizeSABBug');
        const fvmRes = await runFvm();
        console.log("  [Zero Size SAB Bug] FVM result (arr.length):", fvmRes);
        assert.strictEqual(fvmRes, 4);
    },

    'SharedArrayBuffer - Out of Bounds Read': async () => {
        const jsCode = `
            function testOutOfBoundsRead() {
                let sab = new SharedArrayBuffer(4);
                let arr = new Uint8Array(sab);
                return [arr[4], arr[-1]];
            }
        `;
        const runFvm = getRunnableWrapper(jsCode, 'testOutOfBoundsRead');
        const fvmRes = await runFvm();
        console.log("  [OutOfBounds Read] FVM result:", fvmRes);
        assert.deepStrictEqual(fvmRes, [null, null]);
    },

    'SharedArrayBuffer - Out of Bounds Write (Expected VM Crash)': async () => {
        const jsCode = `
            function testOutOfBoundsWrite() {
                let sab = new SharedArrayBuffer(4);
                let arr = new Uint8Array(sab);
                arr[4] = 99;
                return arr[0];
            }
        `;
        const runFvm = getRunnableWrapper(jsCode, 'testOutOfBoundsWrite');
        const fvmRes = await runFvm();
        console.log("  [OutOfBounds Write] FVM result:", fvmRes);
        assert.strictEqual(fvmRes, 0);
    },

    'Block Scope Shadowing - Complex Nesting': async () => {
        const jsCode = `
            function testComplexShadowing() {
                let x = 10;
                if (true) {
                    let x = 20;
                    let i = 0;
                    while (i < 1) {
                        let x = 30;
                        {
                            let x = 40;
                            if (true) {
                                let x = 50;
                                return x;
                            }
                        }
                        i = i + 1;
                    }
                }
                return x;
            }
        `;
        const runFvm = getRunnableWrapper(jsCode, 'testComplexShadowing');
        const fvmRes = await runFvm();
        console.log("  [Complex Shadowing] FVM result:", fvmRes);
        assert.strictEqual(fvmRes, 50);
    },

    'Register Banking - Multi-level Recursive Splitting': async () => {
        let jsCode = `function testMultiLevelSplit() {\n`;
        for (let i = 0; i < 600; i++) {
            jsCode += `  let v${i} = ${i};\n`;
        }
        jsCode += `  let sum = `;
        for (let i = 0; i < 600; i++) {
            jsCode += `v${i}` + (i === 599 ? ';' : ' + ');
        }
        jsCode += `\n  return sum;\n}`;

        const runFvm = getRunnableWrapper(jsCode, 'testMultiLevelSplit');
        const fvmRes = await runFvm();
        console.log("  [Multi-level Split] FVM result:", fvmRes, "Expected:", 179700);
        assert.strictEqual(fvmRes, 179700);
    }
});
