const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { runTestSuite } = require('./runner');
const { transpile } = require('../../compiler/dist/js-transpiler.js');
const { Parser } = require('../../compiler/dist/parser.js');
const { CodeGenerator } = require('../../compiler/dist/codegen.js');
const { stdlibSource } = require('../../compiler/dist/stdlib.js');

function compileAndLoad(jsCode, functionName) {
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

    global.__fortress_bytecode = new Uint8Array(code);
    global.__fortress_opcodeMap = Array.from(opcodeMap);

    const tempFile = path.join(__dirname, `temp_${functionName}.js`);
    fs.writeFileSync(tempFile, jsWrapper);
    
    delete require.cache[require.resolve(tempFile)];
    const loadedFn = require(tempFile);
    
    return {
        loadedFn,
        cleanup: () => {
            try {
                fs.unlinkSync(tempFile);
            } catch (e) {}
            delete global.__fortress_bytecode;
            delete global.__fortress_opcodeMap;
            delete global.__fortress_latest_bytecode;
            delete global.__fortress_latest_opcodeMap;
        }
    };
}

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

runTestSuite('Milestone 3: Challenger 2 Empirical Robustness Tests', {
    'Proxy circular reference robustness test': async () => {
        const jsCode = `
            function testProxyCirc() {
                let target = { name: "target" };
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
        const { loadedFn, cleanup } = compileAndLoad(jsCode, 'testProxyCirc');
        try {
            const proxyObj = loadedFn();
            
            // Create circular relationship: proxyObj has circular reference
            proxyObj.self = proxyObj;
            
            // Accessing properties should not cause stack overflow or crash
            assert.strictEqual(proxyObj.name, "target");
            assert.strictEqual(proxyObj.self, '[Circular]');
            
            // Also test target circular reference directly
            const target2 = { name: "target2" };
            target2.self = target2;
            const proxyObj2 = new Proxy(target2, {
                get(t, prop) { return t[prop]; }
            });
            // Calling a proxy with circular target shouldn't crash
            assert.strictEqual(proxyObj2.name, "target2");
            assert.strictEqual(proxyObj2.self, target2);
        } finally {
            cleanup();
        }
    },

    'Nested eval() should throw TypeError': async () => {
        const jsCode1 = `
            function testNestedEval1() {
                function nested() {
                    eval("1 + 1");
                }
                return nested();
            }
        `;
        assert.throws(() => {
            transpile(jsCode1, {
                functionName: 'testNestedEval1',
                filePath: 'test.js',
                verifyEquivalence: false
            });
        }, TypeError, /Nested eval\(\) is not supported/);

        const jsCode2 = `
            function testNestedEval2() {
                const f = () => {
                    eval("1 + 1");
                };
                return f();
            }
        `;
        assert.throws(() => {
            transpile(jsCode2, {
                functionName: 'testNestedEval2',
                filePath: 'test.js',
                verifyEquivalence: false
            });
        }, TypeError, /Nested eval\(\) is not supported/);
    },

    'Dynamic eval circular reference robustness test (mock client)': async () => {
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

        const tempFile = path.join(__dirname, 'temp_eval_circular_real.js');
        const wrapperWithMock = jsWrapper.replace(
            "const { FortressClient } = require('../../client.js');",
            "const FortressClient = { init: async () => ({ execute: async (payload) => 'mocked_success' }) };"
        );
        
        fs.writeFileSync(tempFile, wrapperWithMock + `
            const obj = { name: "test" };
            obj.self = obj;
            module.exports("let dummy = 1;", obj).then(res => {
                console.log("SUCCESS");
                process.exit(0);
            }).catch(err => {
                console.error("FAIL:", err.message);
                process.exit(1);
            });
        `);
        
        const { spawnProcess } = require('./runner');
        const runRes = await spawnProcess('node', [tempFile]);
        try {
            fs.unlinkSync(tempFile);
        } catch(e) {}
        
        assert.ok(runRes.stdout.includes("SUCCESS"), `Circular reference in eval caused crash: ${runRes.stderr}`);
    }
});
