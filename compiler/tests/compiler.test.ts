import test from 'node:test';
import assert from 'node:assert';
import { Lexer, TokenType } from '../src/lexer';
import { Parser } from '../src/parser';
import { CodeGenerator } from '../src/codegen';
import { OpCode } from '../src/opcodes';

// Helper to check if bytecode contains a specific mapped opcode
function hasOpCode(bytecode: Uint8Array, opcodeMap: Uint8Array, op: OpCode): boolean {
    return countOpCode(bytecode, opcodeMap, op) > 0;
}

// Helper to count occurrences of a mapped opcode
function countOpCode(bytecode: Uint8Array, opcodeMap: Uint8Array, op: OpCode): number {
    let count = 0;
    let i = 0;
    while (i < bytecode.length) {
        const rawByte = bytecode[i];
        const decodedOp = opcodeMap[rawByte];
        
        if (decodedOp === op) {
            count++;
        }
        
        switch (decodedOp) {
            case OpCode.PushInt:
            case OpCode.PushBool:
            case OpCode.LoadLocal:
            case OpCode.StoreLocal:
            case OpCode.Jump:
            case OpCode.JumpIf:
            case OpCode.JumpIfNot:
            case OpCode.JumpAndMul:
                i += 5;
                break;
            case OpCode.PushFloat:
            case OpCode.Call:
            case OpCode.CallNative:
                i += 9;
                break;
            case OpCode.PushString: {
                if (i + 8 < bytecode.length) {
                    const len = bytecode[i + 5] |
                                (bytecode[i + 6] << 8) |
                                (bytecode[i + 7] << 16) |
                                (bytecode[i + 8] << 24);
                    i += 9 + len;
                } else {
                    i = bytecode.length;
                }
                break;
            }
            default:
                i += 1;
                break;
        }
    }
    return count;
}


// original tests
test('Lexer: basic tokenization', () => {
    const lexer = new Lexer('let x = 5 + 10;');
    const tokens = [];
    let token = lexer.nextToken();
    while (token.type !== TokenType.EOF) {
        tokens.push(token);
        token = lexer.nextToken();
    }
    tokens.push(token); // EOF
    
    assert.strictEqual(tokens[0].type, TokenType.Let);
    assert.strictEqual(tokens[1].type, TokenType.Identifier);
    assert.strictEqual(tokens[1].value, 'x');
    assert.strictEqual(tokens[2].type, TokenType.Eq);
    assert.strictEqual(tokens[3].type, TokenType.Number);
    assert.strictEqual(tokens[3].value, '5');
    assert.strictEqual(tokens[4].type, TokenType.Plus);
    assert.strictEqual(tokens[5].type, TokenType.Number);
    assert.strictEqual(tokens[5].value, '10');
    assert.strictEqual(tokens[6].type, TokenType.Semi);
    assert.strictEqual(tokens[7].type, TokenType.EOF);
});

test('Lexer: strings and identifiers', () => {
    const lexer = new Lexer('fn myFunc() { return "hello"; }');
    const tokens = [];
    let token = lexer.nextToken();
    while (token.type !== TokenType.EOF) {
        tokens.push(token);
        token = lexer.nextToken();
    }
    tokens.push(token);
    
    assert.strictEqual(tokens[0].type, TokenType.Fn);
    assert.strictEqual(tokens[1].type, TokenType.Identifier);
    assert.strictEqual(tokens[1].value, 'myFunc');
    assert.strictEqual(tokens[2].type, TokenType.LParen);
    assert.strictEqual(tokens[3].type, TokenType.RParen);
    assert.strictEqual(tokens[4].type, TokenType.LBrace);
    assert.strictEqual(tokens[5].type, TokenType.Return);
    assert.strictEqual(tokens[6].type, TokenType.String);
    assert.strictEqual(tokens[6].value, 'hello');
    assert.strictEqual(tokens[7].type, TokenType.Semi);
    assert.strictEqual(tokens[8].type, TokenType.RBrace);
    assert.strictEqual(tokens[9].type, TokenType.EOF);
});

test('Parser: assignment and binary expression', () => {
    const parser = new Parser('let x = 5 + 10;');
    const ast = parser.parseProgram();

    assert.strictEqual(ast.type, 'Program');
    assert.strictEqual(ast.body.length, 1);
    
    const stmt = ast.body[0] as any;
    assert.strictEqual(stmt.type, 'LetStatement');
    assert.strictEqual(stmt.name.name, 'x');
    
    const init = stmt.value;
    assert.strictEqual(init?.type, 'BinaryExpression');
    assert.strictEqual(init.operator, '+');
    assert.strictEqual(init.left?.type, 'Literal');
    assert.strictEqual(init.left?.value, 5);
    assert.strictEqual(init.right?.type, 'Literal');
    assert.strictEqual(init.right?.value, 10);
});

test('Parser: function declaration', () => {
    const parser = new Parser('fn sum(a, b) { return a + b; }');
    const ast = parser.parseProgram();

    const stmt = ast.body[0] as any;
    assert.strictEqual(stmt.type, 'FunctionDeclaration');
    assert.strictEqual(stmt.name.name, 'sum');
    assert.strictEqual(stmt.params?.length, 2);
    assert.strictEqual(stmt.params?.[0].name, 'a');
    assert.strictEqual(stmt.params?.[1].name, 'b');
    
    const body = stmt.body.body;
    assert.strictEqual(body?.[0].type, 'ReturnStatement');
});

test('Code Generation: minimal program', () => {
    const code = 'let x = 42;';
    const parser = new Parser(code);
    const ast = parser.parseProgram();
    
    const codegen = new CodeGenerator();
    const { code: bytecode } = codegen.generate(ast);
    
    assert.ok(bytecode.length > 0);
});


// ==========================================
// GROUP 1: Operator Precedence Edge Cases
// ==========================================

test('Precedence: addition and multiplication precedence (2 + 3 * 4)', () => {
    const parser = new Parser('let val = 2 + 3 * 4;');
    const ast = parser.parseProgram();
    const init = (ast.body[0] as any).value;
    
    assert.strictEqual(init.type, 'BinaryExpression');
    assert.strictEqual(init.operator, '+');
    assert.strictEqual(init.left.type, 'Literal');
    assert.strictEqual(init.left.value, 2);
    assert.strictEqual(init.right.type, 'BinaryExpression');
    assert.strictEqual(init.right.operator, '*');
});

test('Precedence: multiplication and addition precedence (2 * 3 + 4)', () => {
    const parser = new Parser('let val = 2 * 3 + 4;');
    const ast = parser.parseProgram();
    const init = (ast.body[0] as any).value;
    
    assert.strictEqual(init.type, 'BinaryExpression');
    assert.strictEqual(init.operator, '+');
    assert.strictEqual(init.left.type, 'BinaryExpression');
    assert.strictEqual(init.left.operator, '*');
    assert.strictEqual(init.right.type, 'Literal');
    assert.strictEqual(init.right.value, 4);
});

test('Precedence: nested parenthesized precedence ((2 + 3) * 4)', () => {
    const parser = new Parser('let val = (2 + 3) * 4;');
    const ast = parser.parseProgram();
    const init = (ast.body[0] as any).value;
    
    assert.strictEqual(init.type, 'BinaryExpression');
    assert.strictEqual(init.operator, '*');
    assert.strictEqual(init.left.type, 'BinaryExpression');
    assert.strictEqual(init.left.operator, '+');
    assert.strictEqual(init.right.type, 'Literal');
    assert.strictEqual(init.right.value, 4);
});

test('Precedence: logical operators OR / AND (a || b && c)', () => {
    const parser = new Parser('let res = a || b && c;');
    const ast = parser.parseProgram();
    const init = (ast.body[0] as any).value;
    
    assert.strictEqual(init.type, 'BinaryExpression');
    assert.strictEqual(init.operator, '||');
    assert.strictEqual(init.right.type, 'BinaryExpression');
    assert.strictEqual(init.right.operator, '&&');
});

test('Precedence: comparisons and logicals (x < y && y > z)', () => {
    const parser = new Parser('let res = x < y && y > z;');
    const ast = parser.parseProgram();
    const init = (ast.body[0] as any).value;
    
    assert.strictEqual(init.type, 'BinaryExpression');
    assert.strictEqual(init.operator, '&&');
    assert.strictEqual(init.left.operator, '<');
    assert.strictEqual(init.right.operator, '>');
});

test('Precedence: equality and logicals (x == y || a != b)', () => {
    const parser = new Parser('let res = x == y || a != b;');
    const ast = parser.parseProgram();
    const init = (ast.body[0] as any).value;
    
    assert.strictEqual(init.type, 'BinaryExpression');
    assert.strictEqual(init.operator, '||');
    assert.strictEqual(init.left.operator, '==');
    assert.strictEqual(init.right.operator, '!=');
});

test('Precedence: complex precedence mix (1 + 2 * 3 == 7 && 4 > 2)', () => {
    const parser = new Parser('let res = 1 + 2 * 3 == 7 && 4 > 2;');
    const ast = parser.parseProgram();
    const init = (ast.body[0] as any).value;
    
    assert.strictEqual(init.type, 'BinaryExpression');
    assert.strictEqual(init.operator, '&&');
    assert.strictEqual(init.left.operator, '==');
    assert.strictEqual(init.left.left.operator, '+');
    assert.strictEqual(init.right.operator, '>');
});

test('Precedence: member access and arithmetic (obj.val + 2 * arr[0])', () => {
    const parser = new Parser('let res = obj.val + 2 * arr[0];');
    const ast = parser.parseProgram();
    const init = (ast.body[0] as any).value;
    
    assert.strictEqual(init.type, 'BinaryExpression');
    assert.strictEqual(init.operator, '+');
    assert.strictEqual(init.left.type, 'MemberExpression');
    assert.strictEqual(init.right.type, 'BinaryExpression');
    assert.strictEqual(init.right.operator, '*');
});


// ==========================================
// GROUP 2: Scope Isolation & Shadowing Cases
// ==========================================

test('Scope: local variables isolation across multiple function frames', () => {
    // We compile two separate functions. Both declare a local variable `v` and use it.
    // They must not interfere with each other's slot mappings or with the main program's slot mappings.
    const source = `
        fn first() {
            let v = 10;
            return v;
        }
        fn second() {
            let v = 20;
            return v;
        }
        let v = 30;
    `;
    const parser = new Parser(source);
    const ast = parser.parseProgram();
    
    const codegen = new CodeGenerator();
    const { code, opcodeMap } = codegen.generate(ast);
    
    // Check that code generation succeeds
    assert.ok(code.length > 0);
});

test('Scope: parameter shadowing inside function', () => {
    // Parameter `x` is shadowed by local variable `x`
    const source = `
        fn shadow(x) {
            let x = 5;
            return x;
        }
    `;
    const parser = new Parser(source);
    const ast = parser.parseProgram();
    
    const codegen = new CodeGenerator();
    const { code, opcodeMap } = codegen.generate(ast);
    assert.ok(code.length > 0);
});

test('Scope: globals shadowed by parameters', () => {
    // Global variable `val` shadowed by parameter `val` in function `test`
    const source = `
        let val = 100;
        fn test(val) {
            return val + 1;
        }
    `;
    const parser = new Parser(source);
    const ast = parser.parseProgram();
    
    const codegen = new CodeGenerator();
    const { code, opcodeMap } = codegen.generate(ast);
    assert.ok(code.length > 0);
});

test('Scope: parameter slots don\'t overwrite dummy variable slots', () => {
    // A function with 3 parameters. Dummy variables must start from slot 3.
    const source = `
        fn test(a, b, c) {
            return a + b + c;
        }
    `;
    const parser = new Parser(source);
    const ast = parser.parseProgram();
    
    const codegen = new CodeGenerator();
    const { code, opcodeMap } = codegen.generate(ast);
    
    assert.ok(code.length > 0);
});

test('Scope: variable slots don\'t leak across compiler runs', () => {
    const oldDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = 'true';
    try {
        // Verify that running generate twice on same CodeGenerator resets locals
        const codegen = new CodeGenerator();
        
        const ast1 = new Parser('let a = 1;').parseProgram();
        const { code: code1 } = codegen.generate(ast1);
        
        const ast2 = new Parser('let a = 1;').parseProgram();
        const { code: code2 } = codegen.generate(ast2);
        
        assert.strictEqual(code1.length, code2.length);
    } finally {
        process.env.DEV_MODE = oldDevMode;
    }
});

test('Scope: complex nested scopes and boundaries', () => {
    const source = `
        fn outer(a) {
            let b = a + 1;
            fn inner(b) {
                let c = b + 2;
                return c;
            }
            return b;
        }
    `;
    const parser = new Parser(source);
    const ast = parser.parseProgram();
    
    const codegen = new CodeGenerator();
    const { code, opcodeMap } = codegen.generate(ast);
    assert.ok(code.length > 0);
});

test('Scope: multiple parameters mapping correctly', () => {
    const source = `
        fn addFour(a, b, c, d) {
            return a + b + c + d;
        }
    `;
    const parser = new Parser(source);
    const ast = parser.parseProgram();
    
    const codegen = new CodeGenerator();
    const { code, opcodeMap } = codegen.generate(ast);
    assert.ok(code.length > 0);
});

test('Scope: return statements cleaning up nested block stack values', () => {
    const source = `
        fn check(a) {
            if (a > 10) {
                return 1;
            } else {
                return 0;
            }
        }
    `;
    const parser = new Parser(source);
    const ast = parser.parseProgram();
    
    const codegen = new CodeGenerator();
    const { code, opcodeMap } = codegen.generate(ast);
    assert.ok(code.length > 0);
});


// ==========================================
// GROUP 3: Complex MBA, Float Math & Boundaries
// ==========================================

test('MBA: float addition in prod mode bypasses MBA bitwise transformations', () => {
    // In prod mode (DEV_MODE is false by default or unset), float additions must bypass MBA
    const oldDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = 'false';
    const oldRandom = Math.random;
    Math.random = () => 0.99;
    try {
        const source = `let res = 1.5 + 2.5;`;
        const parser = new Parser(source);
        const ast = parser.parseProgram();
        
        const codegen = new CodeGenerator();
        const { code, opcodeMap } = codegen.generate(ast);
        
        // It must have OpCode.Add and NOT have OpCode.BitXor / BitAnd
        assert.ok(hasOpCode(code, opcodeMap, OpCode.Add), "Should emit OpCode.Add for float math");
        assert.ok(!hasOpCode(code, opcodeMap, OpCode.BitXor), "Should NOT emit OpCode.BitXor for float math");
    } finally {
        process.env.DEV_MODE = oldDevMode;
        Math.random = oldRandom;
    }
});

test('MBA: float subtraction in prod mode bypasses MBA bitwise transformations', () => {
    const oldDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = 'false';
    const oldRandom = Math.random;
    Math.random = () => 0.99;
    try {
        const source = `let res = 10.5 - 2.5;`;
        const parser = new Parser(source);
        const ast = parser.parseProgram();
        
        const codegen = new CodeGenerator();
        const { code, opcodeMap } = codegen.generate(ast);
        
        assert.ok(hasOpCode(code, opcodeMap, OpCode.Sub), "Should emit OpCode.Sub for float math");
        assert.ok(!hasOpCode(code, opcodeMap, OpCode.BitXor), "Should NOT emit OpCode.BitXor for float math");
    } finally {
        process.env.DEV_MODE = oldDevMode;
        Math.random = oldRandom;
    }
});

test('MBA: float multiplication in prod mode bypasses MBA padding', () => {
    const oldDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = 'false';
    const oldRandom = Math.random;
    Math.random = () => 0.99; // bypass random junk and select deterministic path
    try {
        const source = `let res = 1.5 * 2.5;`;
        const parser = new Parser(source);
        const ast = parser.parseProgram();
        
        const codegen = new CodeGenerator();
        const { code, opcodeMap } = codegen.generate(ast);
        
        // MBA padding for integer multiplication adds/subtracts dummy variables.
        // Float multiplication should bypass it to prevent TypeError.
        assert.ok(hasOpCode(code, opcodeMap, OpCode.Mul), "Should emit OpCode.Mul");
        // It shouldn't emit swap/jump or structural dummy add/subs
        assert.ok(!hasOpCode(code, opcodeMap, OpCode.BitAnd), "Should not contain bitwise ops");
    } finally {
        process.env.DEV_MODE = oldDevMode;
        Math.random = oldRandom;
    }
});

test('MBA: float division in prod mode bypasses MBA padding', () => {
    const oldDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = 'false';
    try {
        const source = `let res = 10.5 / 2.0;`;
        const parser = new Parser(source);
        const ast = parser.parseProgram();
        
        const codegen = new CodeGenerator();
        const { code, opcodeMap } = codegen.generate(ast);
        
        assert.ok(hasOpCode(code, opcodeMap, OpCode.Div), "Should emit OpCode.Div");
    } finally {
        process.env.DEV_MODE = oldDevMode;
    }
});

test('MBA: mixed float-int addition bypasses MBA', () => {
    const oldDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = 'false';
    const oldRandom = Math.random;
    Math.random = () => 0.99;
    try {
        const source = `
            let x = 1.5;
            let y = x + 10;
        `;
        const parser = new Parser(source);
        const ast = parser.parseProgram();
        
        const codegen = new CodeGenerator();
        const { code, opcodeMap } = codegen.generate(ast);
        
        assert.ok(hasOpCode(code, opcodeMap, OpCode.Add), "Should emit OpCode.Add for mixed float math");
        assert.ok(!hasOpCode(code, opcodeMap, OpCode.BitXor), "Should not emit BitXor for mixed float math");
    } finally {
        process.env.DEV_MODE = oldDevMode;
        Math.random = oldRandom;
    }
});

test('MBA: pure integer math still undergoes MBA', () => {
    const oldDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = 'false';
    const oldRandom = Math.random;
    Math.random = () => 0.99;
    try {
        const source = `let res = 5 + 10;`;
        const parser = new Parser(source);
        const ast = parser.parseProgram();
        
        const codegen = new CodeGenerator();
        const { code, opcodeMap } = codegen.generate(ast);
        
        // Pure integer add should emit MBA bitwise operations
        assert.ok(hasOpCode(code, opcodeMap, OpCode.BitXor), "Integer addition should use BitXor");
        assert.ok(hasOpCode(code, opcodeMap, OpCode.BitAnd), "Integer addition should use BitAnd");
    } finally {
        process.env.DEV_MODE = oldDevMode;
        Math.random = oldRandom;
    }
});

test('MBA: pure integer multiplication undergoes polynomial MBA', () => {
    const oldDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = 'false';
    const oldRandom = Math.random;
    Math.random = () => 0.99;
    try {
        const source = `let res = 5 * 10;`;
        const parser = new Parser(source);
        const ast = parser.parseProgram();
        
        const codegen = new CodeGenerator();
        const { code, opcodeMap } = codegen.generate(ast);
        
        // Integer multiplication should emit the bitwise operations from our MBA formula:
        // x * y = (x & y) * (x | y) + (x & ~y) * (~x & y)
        assert.ok(hasOpCode(code, opcodeMap, OpCode.BitAnd), "Integer multiplication should use BitAnd");
        assert.ok(hasOpCode(code, opcodeMap, OpCode.BitOr), "Integer multiplication should use BitOr");
        assert.ok(hasOpCode(code, opcodeMap, OpCode.BitNot), "Integer multiplication should use BitNot");
        // It should have two multiplications and one addition
        const mulCount = countOpCode(code, opcodeMap, OpCode.Mul);
        assert.strictEqual(mulCount, 2, "Integer multiplication MBA should compile to exactly two multiplication instructions");
    } finally {
        process.env.DEV_MODE = oldDevMode;
        Math.random = oldRandom;
    }
});

test('MBA: dummy variables initialized in function body', () => {
    const source = `
        fn f(x) {
            return x + 1;
        }
    `;
    const parser = new Parser(source);
    const ast = parser.parseProgram();
    
    const codegen = new CodeGenerator();
    const { code, opcodeMap } = codegen.generate(ast);
    
    // Inside the function frame, dummy variables must be initialized.
    // That means we must emit OpCode.StoreLocal.
    assert.ok(hasOpCode(code, opcodeMap, OpCode.StoreLocal));
});

test('MBA: large integer mathematical boundary check (overflow test)', () => {
    const source = `
        let max = 2147483647;
        let result = max + 1;
    `;
    const parser = new Parser(source);
    const ast = parser.parseProgram();
    
    const codegen = new CodeGenerator();
    const { code, opcodeMap } = codegen.generate(ast);
    assert.ok(code.length > 0);
});


// ==========================================
// GROUP 4: Parser / Lexer Robustness Cases
// ==========================================

test('Parser: empty block statements', () => {
    const source = `
        if (true) {} else {}
        while (false) {}
    `;
    const parser = new Parser(source);
    const ast = parser.parseProgram();
    
    assert.strictEqual(ast.body.length, 2);
    assert.strictEqual(ast.body[0].type, 'IfStatement');
    assert.strictEqual((ast.body[0] as any).consequent.body.length, 0);
    assert.strictEqual((ast.body[0] as any).alternate.body.length, 0);
});

test('Parser: complex nested object and array literals', () => {
    const source = `
        let val = [{ a: [1, 2, { b: 3 }] }, 4];
    `;
    const parser = new Parser(source);
    const ast = parser.parseProgram();
    
    const init = (ast.body[0] as any).value;
    assert.strictEqual(init.type, 'ArrayExpression');
    assert.strictEqual(init.elements[0].type, 'ObjectExpression');
});

test('Parser: unexpected token throws error', () => {
    assert.throws(() => {
        const parser = new Parser('let x = ;');
        parser.parseProgram();
    });
});

test('Lexer: comments are skipped correctly', () => {
    const source = `
        // this is single line
        let x = 10;
        /* multi
           line comment */
        let y = 20;
    `;
    const lexer = new Lexer(source);
    const tokens = [];
    let token = lexer.nextToken();
    while (token.type !== TokenType.EOF) {
        tokens.push(token);
        token = lexer.nextToken();
    }
    
    assert.strictEqual(tokens[0].type, TokenType.Let);
    assert.strictEqual(tokens[5].type, TokenType.Let);
});

test('Lexer: handles quotes and backslashes in string literals', () => {
    const source = `let s = "hello \\" world";`;
    const lexer = new Lexer(source);
    const tokens = [];
    let token = lexer.nextToken();
    while (token.type !== TokenType.EOF) {
        tokens.push(token);
        token = lexer.nextToken();
    }
    
    assert.strictEqual(tokens[3].type, TokenType.String);
    assert.strictEqual(tokens[3].value, 'hello " world');
});

test('Lexer: float numbers parsing with scientific notation and various patterns', () => {
    const source = `let f1 = 0.005; let f2 = .5; let f3 = 5.0;`;
    const lexer = new Lexer(source);
    const tokens = [];
    let token = lexer.nextToken();
    while (token.type !== TokenType.EOF) {
        tokens.push(token);
        token = lexer.nextToken();
    }
    
    const floatTokens = tokens.filter(t => t.type === TokenType.Number);
    assert.strictEqual(floatTokens[0].value, '0.005');
    assert.strictEqual(floatTokens[1].value, '.5');
    assert.strictEqual(floatTokens[2].value, '5.0');
});

// ==========================================
// GROUP 5: Adversarial Review & Robustness
// ==========================================

test('Adversarial: Scope isolation vulnerability in nested functions', () => {
    // Nested functions are emitted inline. If executed, the outer function
    // falls through into the inner function and returns early.
    // Here we verify that a nested function has no skip jump emitted before it.
    const source = `
        fn outer() {
            let x = 1;
            fn inner() {
                return 2;
            }
            let y = 3;
            return x + y;
        }
    `;
    const parser = new Parser(source);
    const ast = parser.parseProgram();
    const codegen = new CodeGenerator();
    const { code, opcodeMap } = codegen.generate(ast);

    // Let's check the function address of outer and inner.
    const outerAddr = codegen['functions'].get('outer');
    const innerAddr = codegen['functions'].get('inner');
    
    if (outerAddr === undefined || innerAddr === undefined) {
        throw new Error("outerAddr or innerAddr is undefined");
    }
    
    // innerAddr must be greater than outerAddr since it's nested.
    assert.ok(innerAddr > outerAddr);

    // We scan the code between outerAddr and innerAddr.
    // There should be a Jump opcode mapping pointing past the end of the inner function.
    // The inner function ends with Return.
    // Let's check if there is a Jump instruction immediately preceding innerAddr.
    // A Jump instruction is: mapped_Jump (1 byte) + target (4 bytes) = 5 bytes total.
    // If there is a Jump, the byte at `innerAddr - 5` must map to OpCode.Jump.
    const preInnerOp = opcodeMap[code[innerAddr - 5]];
    // The nested function should have a Jump emitted right before it to skip its execution.
    assert.strictEqual(preInnerOp, OpCode.Jump, "Nested function should have a skip jump emitted.");
});

test('Adversarial: Local slot boundary overflow vulnerability', () => {
    // Each integer addition generates two unique temporary variables.
    // A function with a moderate number of additions will leak local slots,
    // exceeding the VM limit of 256 local slots and causing runtime InvalidLocalSlot.
    // Here we compile a function with 130 additions and check that the number
    // of allocated local slots exceeds 256.
    let additions = '';
    for (let i = 0; i < 130; i++) {
        additions += ' + 1';
    }
    const source = `
        fn overflow() {
            let x = 1 ${additions};
            return x;
        }
    `;
    const parser = new Parser(source);
    const ast = parser.parseProgram();
    const codegen = new CodeGenerator();
    
    // Code generation works (does not validate boundary)
    const { code, opcodeMap } = codegen.generate(ast);
    
    // But let's verify that the local slots mapped for the function 'overflow' exceeds 256
    // We can check the size of the isolated locals map by inspecting the generated slots.
    // Since generate() has completed, codegen['locals'] contains the main program's locals,
    // but we can compile just the function body by manually visiting it or checking that
    // the temporary variables generated during addition have slot indices >= 256.
    
    // Let's search the generated bytecode for StoreLocal instructions.
    // The operand of StoreLocal is the slot index. We check that no slot index is >= 256 since variables are recycled.
    let hasOobSlot = false;
    let i = 0;
    while (i < code.length) {
        const rawByte = code[i];
        const decodedOp = opcodeMap[rawByte];
        
        if (decodedOp === OpCode.StoreLocal || decodedOp === OpCode.LoadLocal) {
            if (i + 4 < code.length) {
                const slot = code[i + 1] | (code[i + 2] << 8) | (code[i + 3] << 16) | (code[i + 4] << 24);
                if (slot >= 256) {
                    hasOobSlot = true;
                    break;
                }
            }
        }
        
        switch (decodedOp) {
            case OpCode.PushInt:
            case OpCode.PushBool:
            case OpCode.LoadLocal:
            case OpCode.StoreLocal:
            case OpCode.Jump:
            case OpCode.JumpIf:
            case OpCode.JumpIfNot:
            case OpCode.JumpAndMul:
                i += 5;
                break;
            case OpCode.PushFloat:
            case OpCode.Call:
            case OpCode.CallNative:
                i += 9;
                break;
            case OpCode.PushString: {
                if (i + 8 < code.length) {
                    const len = code[i + 5] |
                                (code[i + 6] << 8) |
                                (code[i + 7] << 16) |
                                (code[i + 8] << 24);
                    i += 9 + len;
                } else {
                    i = code.length;
                }
                break;
            }
            default:
                i += 1;
                break;
        }
    }
    assert.ok(!hasOobSlot, "Compiler should not generate slot indices >= 256 due to variable recycling");
});

test('Adversarial: Float addition bypasses MBA only under strict conditions (type leakage)', () => {
    // If a float variable is initialized from a function return or object property,
    // the compiler types it as "int" or "any", causing addition to use integer MBA in production mode.
    // When run, the VM will hit BitXor/BitAnd and crash with TypeError.
    const oldDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = 'false'; // simulate production
    const oldRandom = Math.random;
    Math.random = () => 0.99;
    try {
        const source = `
            fn get_float() { return 1.5; }
            fn test() {
                let a = get_float();
                let b = get_float();
                return a + b;
            }
        `;
        const parser = new Parser(source);
        const ast = parser.parseProgram();
        const codegen = new CodeGenerator();
        const { code, opcodeMap } = codegen.generate(ast);
        
        // Let's check if the compiled bytecode contains BitXor.
        // With float type inference leakage fixed, it should NOT contain BitXor for float math.
        const hasBitXor = hasOpCode(code, opcodeMap, OpCode.BitXor);
        assert.ok(!hasBitXor, "Float variables must bypass MBA and not contain BitXor");
    } finally {
        process.env.DEV_MODE = oldDevMode;
        Math.random = oldRandom;
    }
});

test('Adversarial: Return opcode collision bug', () => {
    const source = `
        fn col() {
            let x = 1;
            x;
        }
    `;
    const parser = new Parser(source);
    const ast = parser.parseProgram();
    
    let codegen = new CodeGenerator();
    let res;
    let found = false;
    // Find a seed where Pop is mapped to 0x92 (value of OpCode.Return)
    for (let i = 0; i < 2000; i++) {
        res = codegen.generate(ast);
        if (codegen['opcodeMap'][OpCode.Pop] === 0x92) {
            found = true;
            break;
        }
    }
    
    assert.ok(found, "Should find a seed where Pop maps to 0x92");
    
    const end = res.code.length;
    const mappedReturn = codegen['opcodeMap'][OpCode.Return];
    assert.strictEqual(res.code[end - 3], 0x92);
    assert.strictEqual(res.code[end - 1], mappedReturn);
    
    // Because last byte is 0x92, which matches OpCode.Return (0x92) raw value,
    // the compiler skipped emitting the Return opcode.
    // Verify that the mapped Return instruction is missing.
    const hasReturn = res.code[end - 2] === mappedReturn || res.code[end - 1] === mappedReturn;
    assert.ok(hasReturn, "Compiler should emit Return even if the last byte has a collision with raw OpCode.Return value");
});

test('MBA: pure integer division undergoes division polynomial MBA', () => {
    const oldDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = 'false';
    const oldRandom = Math.random;
    Math.random = () => 0.99;
    try {
        const source = `let res = 84 / 2;`;
        const parser = new Parser(source);
        const ast = parser.parseProgram();
        
        const codegen = new CodeGenerator();
        const { code, opcodeMap } = codegen.generate(ast);
        
        // Pure clean integer division should emit MBA bitwise operations
        assert.ok(hasOpCode(code, opcodeMap, OpCode.BitAnd), "Integer division should use BitAnd");
        assert.ok(hasOpCode(code, opcodeMap, OpCode.BitXor), "Integer division should use BitXor");
        assert.ok(hasOpCode(code, opcodeMap, OpCode.Dup), "Integer division should use Dup");
        assert.ok(hasOpCode(code, opcodeMap, OpCode.Mul), "Integer division should use Mul");
        assert.ok(hasOpCode(code, opcodeMap, OpCode.Div), "Integer division should use Div");
    } finally {
        process.env.DEV_MODE = oldDevMode;
        Math.random = oldRandom;
    }
});

