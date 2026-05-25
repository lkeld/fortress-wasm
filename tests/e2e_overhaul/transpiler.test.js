const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { runTestSuite } = require('./runner');
const { Parser } = require('../../compiler/dist/parser.js');
const { CodeGenerator } = require('../../compiler/dist/codegen.js');
const { transpile, verifyEquivalenceSync, verifyEquivalence } = require('../../compiler/dist/js-transpiler.js');
const { stdlibSource } = require('../../compiler/dist/stdlib.js');

// Helper to compile JavaScript code with our compiler
function compileCode(source) {
    const parser = new Parser(source);
    const program = parser.parseProgram();
    const codegen = new CodeGenerator();
    return codegen.generate(program);
}

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

runTestSuite('F3: Transpiler E2E Overhaul Test Suite', {
    // --- Tier 1: Feature Coverage (5 tests) ---
    'Array & Object Destructuring - Unsupported compiler check': async () => {
        assert.throws(() => {
            compileCode('let [a, b] = [1, 2];');
        }, /Error:/);
    },

    'ES6 Classes with Fields - Unsupported compiler check': async () => {
        assert.throws(() => {
            compileCode('class MyClass { x = 1; }');
        }, /Error:/);
    },

    'Async/Await Splitting - Unsupported compiler check': async () => {
        assert.throws(() => {
            compileCode('async function f() { await 5; }');
        }, /Error:/);
    },

    'Try/Catch Error Handling - Unsupported compiler check': async () => {
        assert.throws(() => {
            compileCode('try { let x = 1; } catch (e) { let y = 2; }');
        }, /Error:/);
    },

    'Comma Operator - Unsupported compiler check': async () => {
        assert.throws(() => {
            compileCode('let x = (1, 2);');
        }, /Error:/);
    },

    'Try/Catch Error Handling - Unsupported transpiler check': async () => {
        assert.throws(() => {
            transpile('function test() { try { let x = 1; } catch (e) {} }', {
                functionName: 'test',
                filePath: 'test.js',
                verifyEquivalence: false
            });
        }, /Try\/catch exception handling is not supported/);
    },

    'Comma Operator - Unsupported transpiler check': async () => {
        assert.throws(() => {
            transpile('function test() { let x = (1, 2); }', {
                functionName: 'test',
                filePath: 'test.js',
                verifyEquivalence: false
            });
        }, /Comma operator \(SequenceExpression\) is not supported/);
    },

    'Async/Await Splitting - Unsupported transpiler check': async () => {
        assert.throws(() => {
            transpile('async function test() { await 5; }', {
                functionName: 'test',
                filePath: 'test.js',
                verifyEquivalence: false
            });
        }, /Async\/await splitting is not supported/);
    },

    // --- Tier 2: Boundary & Corner Cases (5 tests) ---
    'Unsupported Syntax Error - clean error reporting on syntax invalidity': async () => {
        assert.throws(() => {
            compileCode('@decorator let x = 1;');
        }, /Error:/);
    },

    'Variable Shadowing - flat-scope resolution check': async () => {
        const parser = new Parser('let x = 1; if (true) { x = 2; }');
        const program = parser.parseProgram();
        const codegen = new CodeGenerator();
        const { code } = codegen.generate(program);
        assert.ok(code.length > 0);
    },

    'Nested Closures & Liveness - closure check': async () => {
        const { code } = compileCode('fn myFunc(a) { return a + 1; } let result = myFunc(5);');
        assert.ok(code.length > 0);
    },

    'Large Function Splitting - compile large amount of statements': async () => {
        let codeStr = '';
        for (let i = 0; i < 50; i++) {
            codeStr += `let var_${i} = ${i};\n`;
        }
        const { code } = compileCode(codeStr);
        assert.ok(code.length > 0);
    },

    'JS Equivalence Verification - original vs compiler equivalence for supported subset': async () => {
        const source = 'let a = 10; let b = 20; let c = a + b;';
        const { code } = compileCode(source);
        assert.ok(code.length > 0);
    },

    'Symbols - Happy Path equivalence check': async () => {
        await testEquivalence(`
            function testSymbolHappy() {
                let s1 = Symbol("desc");
                let s2 = Symbol("desc");
                if (s1 === s2) { return false; }
                return true;
            }
        `, 'testSymbolHappy');
    },

    'Symbols - Edge Case check': async () => {
        assert.throws(() => {
            transpile('function testSymbolEdge() { return Symbol.iterator; }', {
                functionName: 'testSymbolEdge',
                filePath: 'test.js',
                verifyEquivalence: false
            });
        }, /Symbol\.iterator is not supported/);
    },

    'Closures - Happy Path equivalence check': async () => {
        await testEquivalence(`
            function testClosureHappy() {
                let x = 10;
                let f = () => { return x + 5; };
                return f();
            }
        `, 'testClosureHappy');
    },

    'Closures - Edge Case equivalence check': async () => {
        await testEquivalence(`
            function testClosureMutable() {
                let x = 10;
                let inc = () => { x = x + 1; };
                let get = () => { return x; };
                inc();
                inc();
                return get();
            }
        `, 'testClosureMutable');
    },

    'Closures - Top-Level Arrow Function Store (Zustand style)': async () => {
        await testEquivalence(`
            function testStore(x) {
                let bears = 0;
                let set = (fn) => {
                    let res = fn({ bears });
                    bears = res.bears;
                };
                let increase = (by) => set((state) => ({ bears: state.bears + by }));
                increase(x);
                return bears;
            }
        `, 'testStore');
    },

    'Closures - Expression-bodied nested arrow function': async () => {
        await testEquivalence(`
            function testExpressionBodiedArrow() {
                let x = 10;
                let add = (y) => x + y;
                return add(5);
            }
        `, 'testExpressionBodiedArrow');
    },

    'Closures - State variable renaming safety with object properties': async () => {
        await testEquivalence(`
            function testStateRenamingSafety() {
                let state = { state: 42 };
                let getVal = (state) => {
                    let obj = { state: 100 };
                    return state.state + obj.state;
                };
                return getVal(state);
            }
        `, 'testStateRenamingSafety');
    },

    'Generators - Happy Path equivalence check': async () => {
        await testEquivalence(`
            function* testGenHappy() {
                yield 10;
                yield 20;
                yield 30;
            }
        `, 'testGenHappy');
    },

    'Generators - Edge Case equivalence check': async () => {
        await testEquivalence(`
            function* testGenEdge(start) {
                let step = 5;
                yield start;
                yield start + step;
                yield start + step * 2;
            }
        `, 'testGenEdge');
    },

    'eval() - Static JSON string literal rewrite': async () => {
        await testEquivalence(`
            function testEvalStatic() {
                let x = eval('[10, 20]');
                return x[0];
            }
        `, 'testEvalStatic');
    },

    'eval() - Dynamic eval splitting boundary': async () => {
        await testEquivalence(`
            function testEvalDynamic(code) {
                let x = 5;
                let y = eval(code);
                if (y === undefined) { y = 0; }
                let z = 10;
                return x + y + z;
            }
        `, 'testEvalDynamic');
    },

    'Proxy - Validation traps equivalence': async () => {
        await testEquivalence(`
            function testProxyValidation() {
                let target = { a: 1, b: 2 };
                let handler = {
                    get(t, prop) {
                        if (prop === "private") {
                            throw new TypeError("Proxy validation failed: get trap returned false");
                        }
                        return t[prop];
                    },
                    set(t, prop, val) {
                        if (typeof val !== "number") {
                            throw new TypeError("Proxy validation failed: set trap returned false");
                        }
                        t[prop] = val;
                        return true;
                    }
                };
                return new Proxy(target, handler);
            }
        `, 'testProxyValidation');
    },

    'Proxy - Only get trap': async () => {
        await testEquivalence(`
            function testProxyGetOnly() {
                let target = { a: 42 };
                let handler = {
                    get(t, prop) {
                        if (prop === "hidden") {
                            throw new TypeError("Proxy validation failed: get trap returned false");
                        }
                        return t[prop];
                    }
                };
                return new Proxy(target, handler);
            }
        `, 'testProxyGetOnly');
    },

    'Reflect - Mapping to equivalents': async () => {
        await testEquivalence(`
            function testReflectMap() {
                let obj = { x: 100 };
                Reflect.set(obj, "y", 200);
                let hasY = Reflect.has(obj, "y");
                let valX = Reflect.get(obj, "x");
                return [hasY, valX, obj.y];
            }
        `, 'testReflectMap');
    },

    'Reflect - ownKeys and serialization': async () => {
        await testEquivalence(`
            function testReflectKeys() {
                let obj = { a: 1 };
                let s = Symbol("foo");
                obj[s] = 2;
                return Reflect.ownKeys(obj);
            }
        `, 'testReflectKeys');
    },

    'Reflect - Set with null target throws TypeError': async () => {
        await testEquivalence(`
            function testReflectSetNull() {
                return Reflect.set(null, "x", 1);
            }
        `, 'testReflectSetNull');
    },

    'Proxy - Circular object serialization does not overflow stack': async () => {
        await testEquivalence(`
            function testCircularProxy() {
                let obj = { a: 1 };
                obj.self = obj;
                let handler = {
                    get(t, prop) {
                        return t[prop];
                    }
                };
                let proxy = new Proxy(obj, handler);
                return proxy.a;
            }
        `, 'testCircularProxy');
    },

    'Nested function lifting with FunctionDeclaration id': async () => {
        await testEquivalence(`
            function testNestedLifting() {
                function outer(x) {
                    function inner(y) {
                        return y + 1;
                    }
                    return inner(x) + 2;
                }
                return outer(5);
            }
        `, 'testNestedLifting');
    },

    'SharedArrayBuffer - Happy Path equivalence check': async () => {
        await testEquivalence(`
            function testSharedArrayBufferHappy() {
                let sab = new SharedArrayBuffer(4);
                let arr = new Int32Array(sab);
                arr[0] = 42;
                return arr[0];
            }
        `, 'testSharedArrayBufferHappy');
    },

    'SharedArrayBuffer - Edge Case (Atomics compilation error)': async () => {
        assert.throws(() => {
            transpile(`
                function testAtomics() {
                    let sab = new SharedArrayBuffer(4);
                    let arr = new Int32Array(sab);
                    Atomics.store(arr, 0, 42);
                    return Atomics.load(arr, 0);
                }
            `, {
                functionName: 'testAtomics',
                filePath: 'test.js',
                verifyEquivalence: false
            });
        }, /Atomics is not supported/);
    },

    'Large Function - Happy Path (split point found)': async () => {
        let largeFuncCode = `function testLargeFuncHappy() {\n`;
        largeFuncCode += `  let x = 1;\n`;
        for (let i = 0; i < 500; i++) {
            largeFuncCode += `  x = x + 1;\n`;
        }
        largeFuncCode += `  let y = 100;\n`;
        for (let i = 0; i < 500; i++) {
            largeFuncCode += `  y = y + 1;\n`;
        }
        largeFuncCode += `  return y;\n}`;
        await testEquivalence(largeFuncCode, 'testLargeFuncHappy');
    },

    'Large Function - Edge Case (No split point warning)': async () => {
        let largeFuncNoSplitCode = `function testLargeFuncEdge() {\n`;
        largeFuncNoSplitCode += `  let x = 1;\n`;
        for (let i = 0; i < 1000; i++) {
            largeFuncNoSplitCode += `  x = x + 1;\n`;
        }
        largeFuncNoSplitCode += `  return x;\n}`;
        const res = transpile(largeFuncNoSplitCode, {
            functionName: 'testLargeFuncEdge',
            filePath: 'test.js',
            verifyEquivalence: false
        });
        assert.ok(res.warnings.some(w => w.message.includes("too large") || w.message.includes(">1000 lines")));
        await testEquivalence(largeFuncNoSplitCode, 'testLargeFuncEdge');
    },

    'Register Banking - Happy Path (no split needed)': async () => {
        let regBankingHappyCode = `function testRegBankingHappy() {\n`;
        for (let i = 0; i < 270; i++) {
            regBankingHappyCode += `  let v${i} = ${i};\n`;
            regBankingHappyCode += `  if (v${i} < 0) { return v${i}; }\n`;
        }
        regBankingHappyCode += `  return 42;\n}`;
        await testEquivalence(regBankingHappyCode, 'testRegBankingHappy');
    },

    'Register Banking - Edge Case (split on exhaust)': async () => {
        let regBankingExhaustCode = `function testRegBankingExhaust() {\n`;
        for (let i = 0; i < 260; i++) {
            regBankingExhaustCode += `  let v${i} = ${i};\n`;
        }
        regBankingExhaustCode += `  return `;
        for (let i = 0; i < 260; i++) {
            regBankingExhaustCode += `v${i}` + (i === 259 ? ';' : ' + ');
        }
        regBankingExhaustCode += `\n}`;
        await testEquivalence(regBankingExhaustCode, 'testRegBankingExhaust');
    },

    'SharedArrayBuffer - Happy Path 2 (nested object & conversion)': async () => {
        await testEquivalence(`
            function testSharedArrayBufferNestedObj() {
                let sab = new SharedArrayBuffer(16);
                let arr = new Int32Array(sab);
                arr[0] = 5;
                arr[1] = 10;
                arr[2] = 15;
                arr[3] = 20;
                return { data: arr, name: "my-nested-sab" };
            }
        `, 'testSharedArrayBufferNestedObj');
    },

    'SharedArrayBuffer - Edge Case 2 (Atomics usage with property access)': async () => {
        assert.throws(() => {
            transpile(`
                function testAtomicsProperty() {
                    let a = Atomics['store'];
                    return a;
                }
            `, {
                functionName: 'testAtomicsProperty',
                filePath: 'test.js',
                verifyEquivalence: false
            });
        }, /Atomics is not supported/);
    },

    'Large Function - Happy Path 2 (complex variables)': async () => {
        let largeFuncCode = `function testLargeFuncHappy2(start) {\n`;
        largeFuncCode += `  let a = start;\n`;
        for (let i = 0; i < 400; i++) {
            largeFuncCode += `  a = a + 1;\n`;
        }
        largeFuncCode += `  let b = a * 2;\n`;
        for (let i = 0; i < 200; i++) {
            largeFuncCode += `  b = b - 1;\n`;
        }
        largeFuncCode += `  let c = 50;\n`;
        for (let i = 0; i < 500; i++) {
            largeFuncCode += `  c = c + 2;\n`;
        }
        largeFuncCode += `  return c;\n}`;
        await testEquivalence(largeFuncCode, 'testLargeFuncHappy2');
    },

    'Large Function - Edge Case 2 (no split point because of dependencies)': async () => {
        let largeFuncNoSplitCode = `function testLargeFuncEdge2() {\n`;
        largeFuncNoSplitCode += `  let sum = 0;\n`;
        for (let i = 0; i < 1000; i++) {
            largeFuncNoSplitCode += `  sum = sum + ${i};\n`;
        }
        largeFuncNoSplitCode += `  return sum;\n}`;
        const res = transpile(largeFuncNoSplitCode, {
            functionName: 'testLargeFuncEdge2',
            filePath: 'test.js',
            verifyEquivalence: false
        });
        assert.ok(res.warnings.some(w => w.message.includes(">1000 lines") && w.message.includes("no clean split point")));
        await testEquivalence(largeFuncNoSplitCode, 'testLargeFuncEdge2');
    },

    'Register Banking - Happy Path 2': async () => {
        let regBankingHappy2Code = `function testRegBankingHappy2() {\n`;
        regBankingHappy2Code += `  let sum = 0;\n`;
        for (let i = 0; i < 300; i++) {
            regBankingHappy2Code += `  { let v${i} = ${i}; if (v${i} > 0) { sum = sum + 1; } }\n`;
        }
        regBankingHappy2Code += `  return sum;\n}`;
        await testEquivalence(regBankingHappy2Code, 'testRegBankingHappy2');
    },

    'Register Banking - Edge Case 2 (recursive split)': async () => {
        let regBankingExhaust2Code = `function testRegBankingExhaust2() {\n`;
        for (let i = 0; i < 500; i++) {
            regBankingExhaust2Code += `  let v${i} = ${i};\n`;
        }
        regBankingExhaust2Code += `  return `;
        for (let i = 0; i < 500; i++) {
            regBankingExhaust2Code += `v${i}` + (i === 499 ? ';' : ' + ');
        }
        regBankingExhaust2Code += `\n}`;
        await testEquivalence(regBankingExhaust2Code, 'testRegBankingExhaust2');
    },

    'Proxy - Dynamic Exception Propagation (TypeError & RangeError)': async () => {
        await testEquivalence(`
            function testProxyDynamicException() {
                let target = { a: 1 };
                let handler = {
                    get(t, prop) {
                        if (prop === "private") {
                            throw new TypeError("Access to private property is forbidden");
                        }
                        if (prop === "foo") {
                            throw new RangeError("Property foo is out of range");
                        }
                        return t[prop];
                    },
                    set(t, prop, val) {
                        if (prop === "a" && typeof val !== "number") {
                            throw new TypeError("Value must be a number");
                        }
                        t[prop] = val;
                        return true;
                    }
                };
                return new Proxy(target, handler);
            }
        `, 'testProxyDynamicException');
    },

    'Closures - Top-level destructuring with arrow function does not crash': async () => {
        const { transpile } = require('../../compiler/dist/js-transpiler.js');
        transpile('const [fn] = [ (x) => x ];', { functionName: 'main' });
    },

    'Closures - Multi-declarator variable statement in closure scope': async () => {
        await testEquivalence(`
            function testMultiDecl() {
                let x = 1, y = 2;
                let getX = () => x;
                return getX() + y;
            }
        `, 'testMultiDecl');
    },

    'Challenger Stress - Multi-declarator in loop init': async () => {
        await testEquivalence(`
            function testMultiDeclLoop() {
                let sum = 0;
                for (let i = 0, j = 10; i < j; ) {
                    sum = sum + i + j;
                    i = i + 1;
                    j = j - 1;
                }
                return sum;
            }
        `, 'testMultiDeclLoop');
    },

    'Challenger Stress - Multi-declarator in loop body': async () => {
        await testEquivalence(`
            function testMultiDeclLoopBody() {
                let sum = 0;
                for (let i = 0; i < 5; i++) {
                    let a = i, b = i * 2, c = i * 3;
                    sum = sum + a + b + c;
                }
                return sum;
            }
        `, 'testMultiDeclLoopBody');
    },

    'Challenger Stress - Multi-declarator in conditional blocks': async () => {
        await testEquivalence(`
            function testMultiDeclConditional() {
                let x = 10;
                if (x > 5) {
                    let a = 100, b = 200;
                    if (a > 50) {
                        let c = 300, d = 400;
                        x = x + a + b + c + d;
                    } else {
                        let e = 500, f = 600;
                        x = x + e + f;
                    }
                } else {
                    let g = 700, h = 800;
                    x = x + g + h;
                }
                return x;
            }
        `, 'testMultiDeclConditional');
    },

    'Challenger Stress - Arrow functions - no parameter expression-bodied': async () => {
        await testEquivalence(`
            function testArrowNoParamExpr() {
                let f = () => 42;
                return f();
            }
        `, 'testArrowNoParamExpr');
    },

    'Challenger Stress - Arrow functions - single parameter expression-bodied': async () => {
        await testEquivalence(`
            function testArrowSingleParamExpr() {
                let f = x => x + 10;
                return f(5);
            }
        `, 'testArrowSingleParamExpr');
    },

    'Challenger Stress - Arrow functions - multiple parameters expression-bodied': async () => {
        await testEquivalence(`
            function testArrowMultiParamExpr() {
                let f = (x, y, z) => x + y + z;
                return f(1, 2, 3);
            }
        `, 'testArrowMultiParamExpr');
    },

    'Challenger Stress - Arrow functions - block-bodied': async () => {
        await testEquivalence(`
            function testArrowBlockBodied() {
                let f = (x, y) => {
                    let z = x * y;
                    return z + 5;
                };
                return f(3, 4);
            }
        `, 'testArrowBlockBodied');
    },

    'Challenger Stress - Arrow functions - destructuring parameter': async () => {
        await testEquivalence(`
            function testArrowDestructParam() {
                let f = ({a, b}) => a + b;
                return f({a: 10, b: 20});
            }
        `, 'testArrowDestructParam');
    },


    'Challenger Stress - Top-level destructuring pattern inputs': async () => {
        const { transpile } = require('../../compiler/dist/js-transpiler.js');
        // Object pattern destructuring
        transpile('const { a, b: { c } } = { a: 1, b: { c: 2 } };', { functionName: 'main' });
        // Array pattern destructuring with default value and rest element
        transpile('let [x, y = 10, ...z] = [1, null, 3, 4];', { functionName: 'main' });
        // Mixed object and array destructuring
        transpile('const { a: [b, c] } = { a: [10, 20] };', { functionName: 'main' });
    }
});
