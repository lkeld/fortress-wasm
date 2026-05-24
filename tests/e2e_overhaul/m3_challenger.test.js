const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const { runTestSuite } = require('./runner');
const { transpile } = require('../../compiler/dist/js-transpiler.js');

if (typeof beforeEach === 'function') {
    beforeEach(() => {
        delete global.__fortress_latest_bytecode;
        delete global.__fortress_latest_opcodeMap;
        delete global.__fortress_bytecode;
        delete global.__fortress_opcodeMap;
    });
}
if (typeof before === 'function') {
    before(() => {
        delete global.__fortress_latest_bytecode;
        delete global.__fortress_latest_opcodeMap;
        delete global.__fortress_bytecode;
        delete global.__fortress_opcodeMap;
    });
}
if (typeof afterEach === 'function') {
    afterEach(() => {
        delete global.__fortress_latest_bytecode;
        delete global.__fortress_latest_opcodeMap;
        delete global.__fortress_bytecode;
        delete global.__fortress_opcodeMap;
    });
}
if (typeof after === 'function') {
    after(() => {
        delete global.__fortress_latest_bytecode;
        delete global.__fortress_latest_opcodeMap;
        delete global.__fortress_bytecode;
        delete global.__fortress_opcodeMap;
    });
}

runTestSuite('Milestone 3: Challenger Robustness Tests', {
    // 1. Circular data structures passed to Proxy objects
    'Proxy with circular data structure': async () => {
        const jsCode = `
            function testProxyCircular() {
                let target = { a: 1 };
                let handler = {
                    get(t, prop) {
                        return t[prop];
                    },
                    set(t, prop, val) {
                        t[prop] = val;
                        return true;
                    }
                };
                return new Proxy(target, handler);
            }
        `;
        const { jsWrapper } = transpile(jsCode, {
            functionName: 'testProxyCircular',
            filePath: 'test.js',
            verifyEquivalence: false
        });

        // Test proxy wrapper behavior with circular objects
        const wrapperWithMock = jsWrapper.replace(
            "const { FortressClient } = require('../../client.js');",
            ""
        );

        // We run the wrapper directly and set global bytecode mock
        global.__fortress_latest_bytecode = new Uint8Array(256);
        global.__fortress_latest_opcodeMap = Array.from({ length: 256 }, (_, i) => i);

        // Mock the vm_core module to simulate get/set traps execution dynamically
        const mockRequire = (id) => {
            if (id.includes('vm_core.js')) {
                return {
                    set_payload_hash() {},
                    init_crypto_with_key() {},
                    clear_crypto() {},
                    execute: (code, header, inputJson, map) => {
                        const parsed = JSON.parse(inputJson);
                        const [trap, target, prop, value] = parsed;
                        if (trap.endsWith('_proxy_get')) {
                            return JSON.stringify(target[prop]);
                        }
                        if (trap.endsWith('_proxy_set')) {
                            // Update our local target in the wrapper closure to reflect the set operation
                            target[prop] = value;
                            return JSON.stringify(true);
                        }
                        return JSON.stringify(true);
                    }
                };
            }
            return require(id);
        };

        // Load the module
        const testProxyFunc = new Function('module', 'require', 'global', wrapperWithMock + '\nmodule.exports = testProxyCircular;');
        const moduleObj = { exports: {} };
        testProxyFunc(moduleObj, mockRequire, global);
        const proxy = moduleObj.exports();

        // Create a circular structure
        const circularObj = { name: "circular" };
        circularObj.self = circularObj;

        try {
            // Perform set trap check
            proxy.a = circularObj;
            
            // Retrieve target property via proxy get trap
            const retrieved = proxy.a;
            assert.ok(retrieved);
            assert.strictEqual(retrieved.name, "circular");
            assert.strictEqual(retrieved.self, "[Circular]");
        } finally {
            delete global.__fortress_latest_bytecode;
            delete global.__fortress_latest_opcodeMap;
        }
    },

    // 2. Circular data structures passed to eval
    'Eval with circular data structure': async () => {
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

        const wrapperWithMock = jsWrapper.replace(
            "const { FortressClient } = require('../../client.js');",
            "const FortressClient = { init: async () => ({ execute: async (payload) => payload }) };"
        );

        const testEvalFunc = new Function('module', 'require', 'process', wrapperWithMock);
        const moduleObj = { exports: {} };
        testEvalFunc(moduleObj, require, process);

        const circularObj = { name: "circular" };
        circularObj.self = circularObj;

        const result = await moduleObj.exports("let x = 1;", circularObj);
        assert.ok(result);
    },

    // 3. Test nested eval() calls and verify they throw a TypeError
    'Nested eval() in standard function throws TypeError': async () => {
        const code = `
            function testOuter() {
                function testInner() {
                    eval("x");
                }
            }
        `;
        assert.throws(() => {
            transpile(code, {
                functionName: 'testOuter',
                filePath: 'test.js',
                verifyEquivalence: false
            });
        }, (err) => {
            return err instanceof TypeError && err.message.includes("Nested eval() is not supported");
        });
    },

    'Nested eval() in arrow function throws TypeError': async () => {
        const code = `
            function testOuter() {
                const inner = () => {
                    eval("x");
                };
            }
        `;
        assert.throws(() => {
            transpile(code, {
                functionName: 'testOuter',
                filePath: 'test.js',
                verifyEquivalence: false
            });
        }, (err) => {
            return err instanceof TypeError && err.message.includes("Nested eval() is not supported");
        });
    },

    'Double eval() compiles but is a potential bypass': async () => {
        const code = `
            function testOuter() {
                eval("eval('x')");
            }
        `;
        // Double eval compiles because at compilation, "eval('x')" is just a string parameter to the outer eval.
        // It does not throw TypeError during compilation because the inner eval is not statically visible to Babel AST.
        // But we document this as a potential bypass scenario.
        const res = transpile(code, {
            functionName: 'testOuter',
            filePath: 'test.js',
            verifyEquivalence: false
        });
        assert.ok(res.jsWrapper);
    }
});
