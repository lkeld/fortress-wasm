const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { runTestSuite } = require('./runner');
const { Parser } = require('../../compiler/dist/parser.js');
const { CodeGenerator } = require('../../compiler/dist/codegen.js');
const { transpile, verifyEquivalenceSync, verifyEquivalence } = require('../../compiler/dist/js-transpiler.js');
const { stdlibSource } = require('../../compiler/dist/stdlib.js');

// Helper to compile JavaScript code with our compiler and test execution
async function testEquivalence(jsCode, functionName) {
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

runTestSuite('Milestone 3: Transpiler & VM Stress Tests (Challenger)', {
    'Reflect.set Return Value Test': async () => {
        // Reflect.set is expected to return boolean true, but FVM ReflectSet stdlib returns val
        await testEquivalence(`
            function testReflectSetReturn() {
                let obj = { x: 0 };
                let res = Reflect.set(obj, "x", 42);
                if (res === true) {
                    return 1;
                } else {
                    return 0;
                }
            }
        `, 'testReflectSetReturn');
    },

    'Reflect.has with Dynamic Properties Null Value Test': async () => {
        // Reflect.has is expected to return true for properties set to null even on dynamic parameters without __ownKeys
        await testEquivalence(`
            function testReflectHasNullDynamic(obj) {
                obj.y = null;
                let hasY = Reflect.has(obj, "y");
                if (hasY === true) {
                    return 1;
                } else {
                    return 0;
                }
            }
        `, 'testReflectHasNullDynamic');
    },

    'Proxy get trap modifies returned value Test': async () => {
        // Proxy get trap modifies property value. Return the Proxy object itself so the verifier triggers testProxyObject
        await testEquivalence(`
            function testProxyGetModify() {
                let target = { a: 10 };
                let handler = {
                    get(t, prop) {
                        if (prop === "a") {
                            return t[prop] + 5;
                        }
                        return t[prop];
                    }
                };
                return new Proxy(target, handler);
            }
        `, 'testProxyGetModify');
    },

    'Proxy get/set trap closure side-effects Test': async () => {
        // Proxy traps with side-effects using variables outside the handler object (closure)
        // Return the count of side-effects rather than the proxy object
        await testEquivalence(`
            function testProxyClosureSideEffects() {
                let target = { a: 10 };
                let count = 0;
                let handler = {
                    get(t, prop) {
                        let dummy = count;
                        return t[prop];
                    }
                };
                let proxy = new Proxy(target, handler);
                let val1 = proxy.a;
                let val2 = proxy.a;
                return count;
            }
        `, 'testProxyClosureSideEffects');
    },

    'Dynamic Eval circular reference DoS Test': async () => {
        // Check if preparePayload with circular reference causes stack overflow
        const jsCode = `
            function testEvalCircular(code, obj) {
                eval(code);
                return obj.name;
            }
        `;
        
        const { jsWrapper } = transpile(jsCode, {
            functionName: 'testEvalCircular',
            filePath: 'test.js',
            verifyEquivalence: false
        });

        // Write the wrapper to a temp file and run it with circular object
        const tempFile = path.join(__dirname, 'temp_circular_run.js');
        
        // Mocking FortressClient and execute
        const wrapperWithMock = jsWrapper.replace(
            "const { FortressClient } = require('../../client.js');",
            "const FortressClient = { init: async () => ({ execute: async (payload) => 'mocked_success' }) };"
        );
        
        fs.writeFileSync(tempFile, wrapperWithMock + `
            const obj = { name: "test" };
            obj.self = obj;
            module.exports("let dummy = 1;", obj).then(res => {
                console.log("SUCCESS_CIRCULAR");
                process.exit(0);
            }).catch(err => {
                console.error("FAIL_CIRCULAR:", err.message);
                process.exit(1);
            });
        `);
        
        const { spawnProcess } = require('./runner');
        const runRes = await spawnProcess('node', [tempFile]);
        fs.unlinkSync(tempFile);
        
        assert.ok(runRes.stdout.includes("SUCCESS_CIRCULAR"), `Circular reference caused crash: ${runRes.stderr}`);
    }
});
