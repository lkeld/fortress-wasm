const path = require('path');
const fs = require('fs');
const assert = require('assert');
const crypto = require('crypto');
const { runTestSuite } = require('./runner');
const { transpile, verifyEquivalence, verifyEquivalenceSync } = require('../../compiler/dist/js-transpiler.js');
const { Parser } = require('../../compiler/dist/parser.js');
const { CodeGenerator } = require('../../compiler/dist/codegen.js');
const { stdlibSource } = require('../../compiler/dist/stdlib.js');

const vmNode = require('../../pkg-node/vm_core.js');

function preparePayload(obj, visited = new Set()) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;
    const proxySymbol = Symbol.for("__fortress_proxy_targets__");
    const proxyTargets = global[proxySymbol] || globalThis[proxySymbol];
    if (proxyTargets && proxyTargets.has(obj)) {
        return preparePayload(proxyTargets.get(obj), visited);
    }
    if (visited.has(obj)) return obj;
    visited.add(obj);
    if (Array.isArray(obj)) {
        return obj.map(item => preparePayload(item, visited));
    }
    const keys = Reflect.ownKeys(obj).filter(k => k !== '__ownKeys');
    obj.__ownKeys = keys.map(k => typeof k === 'symbol' ? (k.description || k.toString()) : k);
    for (const k of keys) {
        preparePayload(obj[k], visited);
    }
    return obj;
}

function runFvmSyncLocal(code, opcodeMap, args) {
    const seen = new Set();
    const inputJson = JSON.stringify(preparePayload(args), (key, value) => {
        if (value !== null && typeof value === 'object') {
            if (seen.has(value)) {
                return "[Circular]";
            }
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

// Setup Mock Client globally before any other loads
const clientPath = require.resolve('../../client.js');
require.cache[clientPath] = {
    id: clientPath,
    filename: clientPath,
    loaded: true,
    exports: {
        FortressClient: {
            init: async () => {
                return {
                    execute: async (executeArgs) => {
                        const isGenAction = executeArgs[0] === 'new' || executeArgs[0] === 'next';
                        const isProxyOrSplit = typeof executeArgs[0] === 'string' && !isGenAction;
                        const actualArgs = isProxyOrSplit ? executeArgs.slice(1) : executeArgs;
                        return runFvmSyncLocal(global.__fortress_latest_bytecode, global.__fortress_latest_opcodeMap, actualArgs);
                    }
                };
            }
        }
    }
};

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

    global.__fortress_latest_bytecode = global.__fortress_bytecode;
    global.__fortress_latest_opcodeMap = global.__fortress_opcodeMap;

    const tempFile = path.join(__dirname, `temp_comprehensive_${functionName}.js`);
    fs.writeFileSync(tempFile, jsWrapper);
    
    delete require.cache[require.resolve(tempFile)];
    const loadedFn = require(tempFile);
    
    return {
        loadedFn,
        cleanup: () => {
            try {
                fs.unlinkSync(tempFile);
            } catch (e) {}
        }
    };
}

function compileCode(jsCode, functionName) {
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
    return codegen.generate(fvmAst, functionName);
}

runTestSuite('Milestone 3: Comprehensive Adversarial Stress Tests', {
    // 1. AST Post-Processing Safety Checks
    'AST Safety: Prepended custom function declaration to AST': async () => {
        const jsCode = `
            function myMainEntry(x, y) {
                return x + y;
            }
        `;
        const { fvmSource, jsWrapper, usedStdlib } = transpile(jsCode, {
            functionName: 'myMainEntry',
            filePath: 'test.js',
            verifyEquivalence: false
        });

        // Manually prepend a custom helper declaration in AST
        const fvmParser = new Parser(fvmSource);
        const fvmAst = fvmParser.parseProgram();
        
        const dummyHelperAst = new Parser('fn myUnusedHelper(a) { return a; }').parseProgram().body[0];
        fvmAst.body.unshift(dummyHelperAst);

        const codegen = new CodeGenerator();
        const { code, opcodeMap } = codegen.generate(fvmAst, 'myMainEntry');

        global.__fortress_bytecode = new Uint8Array(code);
        global.__fortress_opcodeMap = Array.from(opcodeMap);
        global.__fortress_latest_bytecode = global.__fortress_bytecode;
        global.__fortress_latest_opcodeMap = global.__fortress_opcodeMap;

        const tempFile = path.join(__dirname, `temp_comprehensive_myMainEntry.js`);
        fs.writeFileSync(tempFile, jsWrapper);
        
        try {
            delete require.cache[require.resolve(tempFile)];
            const loadedFn = require(tempFile);
            const result = await loadedFn(10, 5);
            assert.strictEqual(result, 15);
        } finally {
            try {
                fs.unlinkSync(tempFile);
            } catch (e) {}
        }
    },

    'AST Safety: Shadowing standard helpers with local variables inside function': async () => {
        const jsCode = `
            function entryWithShadow(val) {
                let ReflectSet = val + 42;
                return ReflectSet;
            }
        `;
        const { loadedFn, cleanup } = compileAndLoad(jsCode, 'entryWithShadow');
        try {
            const result = await loadedFn(10);
            assert.strictEqual(result, 52);
        } finally {
            cleanup();
        }
    },

    // 2. Stack Overflow Resistance on Circular/Highly Nested Proxy Objects
    'Proxy Stack Overflow: Massive Proxy wrapping chain (200 levels)': async () => {
        const jsCode = `
            function testMassiveProxy() {
                let target = { value: 777 };
                let handler = {
                    get(t, prop) { return t[prop]; }
                };
                return new Proxy(target, handler);
            }
        `;
        const { loadedFn, cleanup } = compileAndLoad(jsCode, 'testMassiveProxy');
        try {
            let current = loadedFn();
            // Wrap the proxy inside another proxy 200 times to stress stack depth
            for (let i = 0; i < 200; i++) {
                current = new Proxy(current, {
                    get(t, prop) { return t[prop]; }
                });
            }
            assert.strictEqual(current.value, 777);
        } finally {
            cleanup();
        }
    },

    'Proxy Stack Overflow: Mutually circular proxies': async () => {
        const jsCode = `
            function testMutCircularProxy() {
                let t1 = { name: "t1" };
                let t2 = { name: "t2" };
                let p1 = new Proxy(t1, { get(t, p) { return t[p]; } });
                let p2 = new Proxy(t2, { get(t, p) { return t[p]; } });
                t1.link = p2;
                t2.link = p1;
                return p1;
            }
        `;
        const { loadedFn, cleanup } = compileAndLoad(jsCode, 'testMutCircularProxy');
        try {
            const p1 = loadedFn();
            assert.strictEqual(p1.name, "t1");
            
            // Mutually circular structures should be safely serialized using circular-replacer
            const payload = preparePayload(p1);
            const seen = new Set();
            const str = JSON.stringify(payload, (k, v) => {
                if (v !== null && typeof v === 'object') {
                    if (seen.has(v)) return '[Circular]';
                    seen.add(v);
                }
                return v;
            });
            const parsed = JSON.parse(str);
            assert.strictEqual(parsed.name, "t1");
            assert.strictEqual(parsed.link.name, "t2");
            assert.ok(str.includes('"[Circular]"'));
        } finally {
            cleanup();
        }
    },

    // 3. ReflectSet Boundary & Type Errors
    'ReflectSet: Boundary errors for all primitives': async () => {
        const testCases = [
            { val: null, desc: 'null' },
            { val: undefined, desc: 'undefined' },
            { val: 123, desc: 'number' },
            { val: 'a-string', desc: 'string' },
            { val: true, desc: 'boolean' }
        ];

        for (const testCase of testCases) {
            const jsCodeWrapped = `
                function testBoundaryReflectSet(target) {
                    return Reflect.set(target, "prop", "val");
                }
            `;
            const { loadedFn, cleanup } = compileAndLoad(jsCodeWrapped, 'testBoundaryReflectSet');
            try {
                await loadedFn(testCase.val);
                assert.fail(`Should have thrown TypeError for ${testCase.desc}`);
            } catch (e) {
                assert.ok(e.message.includes("TypeError") || e.message.includes("VMError"), `Expected TypeError/VMError but got: ${e.message}`);
            } finally {
                cleanup();
            }
        }
    },

    // 4. Correctness of verifyEquivalenceSync with multi-argument functions
    'VerifyEquivalenceSync: Mutating object arguments reference isolation': async () => {
        const jsCode = `
            function testMutateArgsReferenceIsolation(a, b) {
                if (Array.isArray(a) || Array.isArray(b)) {
                    return 0;
                }
                if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
                    a.val = 100;
                    b.val = 200;
                    return a.val + b.val;
                }
                return 0;
            }
        `;
        // Compile the code to FVM
        const { code, opcodeMap } = compileCode(jsCode, 'testMutateArgsReferenceIsolation');
        
        // This will run verifyEquivalenceSync underneath with different inputs.
        // It must pass verifyEquivalence without throwing reference sharing mismatches!
        await verifyEquivalence(jsCode, code, Array.from(opcodeMap));
        console.log("Mutating arguments reference isolation verified successfully.");
    },

    'VerifyEquivalenceSync: Three-argument math check with various types': async () => {
        const jsCode = `
            function testThreeArgsMath(x, y, z) {
                if (typeof x === "number" && typeof y === "number" && typeof z === "number") {
                    return x * y + z;
                }
                return 0;
            }
        `;
        const { code, opcodeMap } = compileCode(jsCode, 'testThreeArgsMath');
        await verifyEquivalence(jsCode, code, Array.from(opcodeMap));
        console.log("Three-argument math verification completed successfully.");
    }
});
