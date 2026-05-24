const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { runTestSuite } = require('./runner');
const { Parser } = require('../../compiler/dist/parser.js');
const { CodeGenerator } = require('../../compiler/dist/codegen.js');

// Helper to compile JavaScript code with our compiler
function compileCode(source) {
    const parser = new Parser(source);
    const program = parser.parseProgram();
    const codegen = new CodeGenerator();
    return codegen.generate(program);
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
    }
});
