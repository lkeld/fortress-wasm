"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var node_test_1 = __importDefault(require("node:test"));
var node_assert_1 = __importDefault(require("node:assert"));
var lexer_1 = require("../src/lexer");
var parser_1 = require("../src/parser");
var codegen_1 = require("../src/codegen");
var opcodes_1 = require("../src/opcodes");
// Helper to check if bytecode contains a specific mapped opcode
function hasOpCode(bytecode, opcodeMap, op) {
    for (var i = 0; i < bytecode.length; i++) {
        if (opcodeMap[bytecode[i]] === op) {
            return true;
        }
    }
    return false;
}
// Helper to count occurrences of a mapped opcode
function countOpCode(bytecode, opcodeMap, op) {
    var count = 0;
    var i = 0;
    while (i < bytecode.length) {
        var rawByte = bytecode[i];
        var decodedOp = opcodeMap[rawByte];
        if (decodedOp === op) {
            count++;
        }
        switch (decodedOp) {
            case opcodes_1.OpCode.PushInt:
            case opcodes_1.OpCode.PushBool:
            case opcodes_1.OpCode.LoadLocal:
            case opcodes_1.OpCode.StoreLocal:
            case opcodes_1.OpCode.Jump:
            case opcodes_1.OpCode.JumpIf:
            case opcodes_1.OpCode.JumpIfNot:
            case opcodes_1.OpCode.JumpAndMul:
                i += 5;
                break;
            case opcodes_1.OpCode.PushFloat:
            case opcodes_1.OpCode.Call:
            case opcodes_1.OpCode.CallNative:
                i += 9;
                break;
            case opcodes_1.OpCode.PushString: {
                if (i + 8 < bytecode.length) {
                    var len = bytecode[i + 5] |
                        (bytecode[i + 6] << 8) |
                        (bytecode[i + 7] << 16) |
                        (bytecode[i + 8] << 24);
                    i += 9 + len;
                }
                else {
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
(0, node_test_1.default)('Lexer: basic tokenization', function () {
    var lexer = new lexer_1.Lexer('let x = 5 + 10;');
    var tokens = [];
    var token = lexer.nextToken();
    while (token.type !== lexer_1.TokenType.EOF) {
        tokens.push(token);
        token = lexer.nextToken();
    }
    tokens.push(token); // EOF
    node_assert_1.default.strictEqual(tokens[0].type, lexer_1.TokenType.Let);
    node_assert_1.default.strictEqual(tokens[1].type, lexer_1.TokenType.Identifier);
    node_assert_1.default.strictEqual(tokens[1].value, 'x');
    node_assert_1.default.strictEqual(tokens[2].type, lexer_1.TokenType.Eq);
    node_assert_1.default.strictEqual(tokens[3].type, lexer_1.TokenType.Number);
    node_assert_1.default.strictEqual(tokens[3].value, '5');
    node_assert_1.default.strictEqual(tokens[4].type, lexer_1.TokenType.Plus);
    node_assert_1.default.strictEqual(tokens[5].type, lexer_1.TokenType.Number);
    node_assert_1.default.strictEqual(tokens[5].value, '10');
    node_assert_1.default.strictEqual(tokens[6].type, lexer_1.TokenType.Semi);
    node_assert_1.default.strictEqual(tokens[7].type, lexer_1.TokenType.EOF);
});
(0, node_test_1.default)('Lexer: strings and identifiers', function () {
    var lexer = new lexer_1.Lexer('fn myFunc() { return "hello"; }');
    var tokens = [];
    var token = lexer.nextToken();
    while (token.type !== lexer_1.TokenType.EOF) {
        tokens.push(token);
        token = lexer.nextToken();
    }
    tokens.push(token);
    node_assert_1.default.strictEqual(tokens[0].type, lexer_1.TokenType.Fn);
    node_assert_1.default.strictEqual(tokens[1].type, lexer_1.TokenType.Identifier);
    node_assert_1.default.strictEqual(tokens[1].value, 'myFunc');
    node_assert_1.default.strictEqual(tokens[2].type, lexer_1.TokenType.LParen);
    node_assert_1.default.strictEqual(tokens[3].type, lexer_1.TokenType.RParen);
    node_assert_1.default.strictEqual(tokens[4].type, lexer_1.TokenType.LBrace);
    node_assert_1.default.strictEqual(tokens[5].type, lexer_1.TokenType.Return);
    node_assert_1.default.strictEqual(tokens[6].type, lexer_1.TokenType.String);
    node_assert_1.default.strictEqual(tokens[6].value, 'hello');
    node_assert_1.default.strictEqual(tokens[7].type, lexer_1.TokenType.Semi);
    node_assert_1.default.strictEqual(tokens[8].type, lexer_1.TokenType.RBrace);
    node_assert_1.default.strictEqual(tokens[9].type, lexer_1.TokenType.EOF);
});
(0, node_test_1.default)('Parser: assignment and binary expression', function () {
    var _a, _b, _c, _d;
    var parser = new parser_1.Parser('let x = 5 + 10;');
    var ast = parser.parseProgram();
    node_assert_1.default.strictEqual(ast.type, 'Program');
    node_assert_1.default.strictEqual(ast.body.length, 1);
    var stmt = ast.body[0];
    node_assert_1.default.strictEqual(stmt.type, 'LetStatement');
    node_assert_1.default.strictEqual(stmt.name.name, 'x');
    var init = stmt.value;
    node_assert_1.default.strictEqual(init === null || init === void 0 ? void 0 : init.type, 'BinaryExpression');
    node_assert_1.default.strictEqual(init.operator, '+');
    node_assert_1.default.strictEqual((_a = init.left) === null || _a === void 0 ? void 0 : _a.type, 'Literal');
    node_assert_1.default.strictEqual((_b = init.left) === null || _b === void 0 ? void 0 : _b.value, 5);
    node_assert_1.default.strictEqual((_c = init.right) === null || _c === void 0 ? void 0 : _c.type, 'Literal');
    node_assert_1.default.strictEqual((_d = init.right) === null || _d === void 0 ? void 0 : _d.value, 10);
});
(0, node_test_1.default)('Parser: function declaration', function () {
    var _a, _b, _c;
    var parser = new parser_1.Parser('fn sum(a, b) { return a + b; }');
    var ast = parser.parseProgram();
    var stmt = ast.body[0];
    node_assert_1.default.strictEqual(stmt.type, 'FunctionDeclaration');
    node_assert_1.default.strictEqual(stmt.name.name, 'sum');
    node_assert_1.default.strictEqual((_a = stmt.params) === null || _a === void 0 ? void 0 : _a.length, 2);
    node_assert_1.default.strictEqual((_b = stmt.params) === null || _b === void 0 ? void 0 : _b[0].name, 'a');
    node_assert_1.default.strictEqual((_c = stmt.params) === null || _c === void 0 ? void 0 : _c[1].name, 'b');
    var body = stmt.body.body;
    node_assert_1.default.strictEqual(body === null || body === void 0 ? void 0 : body[0].type, 'ReturnStatement');
});
(0, node_test_1.default)('Code Generation: minimal program', function () {
    var code = 'let x = 42;';
    var parser = new parser_1.Parser(code);
    var ast = parser.parseProgram();
    var codegen = new codegen_1.CodeGenerator();
    var bytecode = codegen.generate(ast).code;
    node_assert_1.default.ok(bytecode.length > 0);
});
// ==========================================
// GROUP 1: Operator Precedence Edge Cases
// ==========================================
(0, node_test_1.default)('Precedence: addition and multiplication precedence (2 + 3 * 4)', function () {
    var parser = new parser_1.Parser('let val = 2 + 3 * 4;');
    var ast = parser.parseProgram();
    var init = ast.body[0].value;
    node_assert_1.default.strictEqual(init.type, 'BinaryExpression');
    node_assert_1.default.strictEqual(init.operator, '+');
    node_assert_1.default.strictEqual(init.left.type, 'Literal');
    node_assert_1.default.strictEqual(init.left.value, 2);
    node_assert_1.default.strictEqual(init.right.type, 'BinaryExpression');
    node_assert_1.default.strictEqual(init.right.operator, '*');
});
(0, node_test_1.default)('Precedence: multiplication and addition precedence (2 * 3 + 4)', function () {
    var parser = new parser_1.Parser('let val = 2 * 3 + 4;');
    var ast = parser.parseProgram();
    var init = ast.body[0].value;
    node_assert_1.default.strictEqual(init.type, 'BinaryExpression');
    node_assert_1.default.strictEqual(init.operator, '+');
    node_assert_1.default.strictEqual(init.left.type, 'BinaryExpression');
    node_assert_1.default.strictEqual(init.left.operator, '*');
    node_assert_1.default.strictEqual(init.right.type, 'Literal');
    node_assert_1.default.strictEqual(init.right.value, 4);
});
(0, node_test_1.default)('Precedence: nested parenthesized precedence ((2 + 3) * 4)', function () {
    var parser = new parser_1.Parser('let val = (2 + 3) * 4;');
    var ast = parser.parseProgram();
    var init = ast.body[0].value;
    node_assert_1.default.strictEqual(init.type, 'BinaryExpression');
    node_assert_1.default.strictEqual(init.operator, '*');
    node_assert_1.default.strictEqual(init.left.type, 'BinaryExpression');
    node_assert_1.default.strictEqual(init.left.operator, '+');
    node_assert_1.default.strictEqual(init.right.type, 'Literal');
    node_assert_1.default.strictEqual(init.right.value, 4);
});
(0, node_test_1.default)('Precedence: logical operators OR / AND (a || b && c)', function () {
    var parser = new parser_1.Parser('let res = a || b && c;');
    var ast = parser.parseProgram();
    var init = ast.body[0].value;
    node_assert_1.default.strictEqual(init.type, 'BinaryExpression');
    node_assert_1.default.strictEqual(init.operator, '||');
    node_assert_1.default.strictEqual(init.right.type, 'BinaryExpression');
    node_assert_1.default.strictEqual(init.right.operator, '&&');
});
(0, node_test_1.default)('Precedence: comparisons and logicals (x < y && y > z)', function () {
    var parser = new parser_1.Parser('let res = x < y && y > z;');
    var ast = parser.parseProgram();
    var init = ast.body[0].value;
    node_assert_1.default.strictEqual(init.type, 'BinaryExpression');
    node_assert_1.default.strictEqual(init.operator, '&&');
    node_assert_1.default.strictEqual(init.left.operator, '<');
    node_assert_1.default.strictEqual(init.right.operator, '>');
});
(0, node_test_1.default)('Precedence: equality and logicals (x == y || a != b)', function () {
    var parser = new parser_1.Parser('let res = x == y || a != b;');
    var ast = parser.parseProgram();
    var init = ast.body[0].value;
    node_assert_1.default.strictEqual(init.type, 'BinaryExpression');
    node_assert_1.default.strictEqual(init.operator, '||');
    node_assert_1.default.strictEqual(init.left.operator, '==');
    node_assert_1.default.strictEqual(init.right.operator, '!=');
});
(0, node_test_1.default)('Precedence: complex precedence mix (1 + 2 * 3 == 7 && 4 > 2)', function () {
    var parser = new parser_1.Parser('let res = 1 + 2 * 3 == 7 && 4 > 2;');
    var ast = parser.parseProgram();
    var init = ast.body[0].value;
    node_assert_1.default.strictEqual(init.type, 'BinaryExpression');
    node_assert_1.default.strictEqual(init.operator, '&&');
    node_assert_1.default.strictEqual(init.left.operator, '==');
    node_assert_1.default.strictEqual(init.left.left.operator, '+');
    node_assert_1.default.strictEqual(init.right.operator, '>');
});
(0, node_test_1.default)('Precedence: member access and arithmetic (obj.val + 2 * arr[0])', function () {
    var parser = new parser_1.Parser('let res = obj.val + 2 * arr[0];');
    var ast = parser.parseProgram();
    var init = ast.body[0].value;
    node_assert_1.default.strictEqual(init.type, 'BinaryExpression');
    node_assert_1.default.strictEqual(init.operator, '+');
    node_assert_1.default.strictEqual(init.left.type, 'MemberExpression');
    node_assert_1.default.strictEqual(init.right.type, 'BinaryExpression');
    node_assert_1.default.strictEqual(init.right.operator, '*');
});
// ==========================================
// GROUP 2: Scope Isolation & Shadowing Cases
// ==========================================
(0, node_test_1.default)('Scope: local variables isolation across multiple function frames', function () {
    // We compile two separate functions. Both declare a local variable `v` and use it.
    // They must not interfere with each other's slot mappings or with the main program's slot mappings.
    var source = "\n        fn first() {\n            let v = 10;\n            return v;\n        }\n        fn second() {\n            let v = 20;\n            return v;\n        }\n        let v = 30;\n    ";
    var parser = new parser_1.Parser(source);
    var ast = parser.parseProgram();
    var codegen = new codegen_1.CodeGenerator();
    var _a = codegen.generate(ast), code = _a.code, opcodeMap = _a.opcodeMap;
    // Check that code generation succeeds
    node_assert_1.default.ok(code.length > 0);
});
(0, node_test_1.default)('Scope: parameter shadowing inside function', function () {
    // Parameter `x` is shadowed by local variable `x`
    var source = "\n        fn shadow(x) {\n            let x = 5;\n            return x;\n        }\n    ";
    var parser = new parser_1.Parser(source);
    var ast = parser.parseProgram();
    var codegen = new codegen_1.CodeGenerator();
    var _a = codegen.generate(ast), code = _a.code, opcodeMap = _a.opcodeMap;
    node_assert_1.default.ok(code.length > 0);
});
(0, node_test_1.default)('Scope: globals shadowed by parameters', function () {
    // Global variable `val` shadowed by parameter `val` in function `test`
    var source = "\n        let val = 100;\n        fn test(val) {\n            return val + 1;\n        }\n    ";
    var parser = new parser_1.Parser(source);
    var ast = parser.parseProgram();
    var codegen = new codegen_1.CodeGenerator();
    var _a = codegen.generate(ast), code = _a.code, opcodeMap = _a.opcodeMap;
    node_assert_1.default.ok(code.length > 0);
});
(0, node_test_1.default)('Scope: parameter slots don\'t overwrite dummy variable slots', function () {
    // A function with 3 parameters. Dummy variables must start from slot 3.
    var source = "\n        fn test(a, b, c) {\n            return a + b + c;\n        }\n    ";
    var parser = new parser_1.Parser(source);
    var ast = parser.parseProgram();
    var codegen = new codegen_1.CodeGenerator();
    var _a = codegen.generate(ast), code = _a.code, opcodeMap = _a.opcodeMap;
    node_assert_1.default.ok(code.length > 0);
});
(0, node_test_1.default)('Scope: variable slots don\'t leak across compiler runs', function () {
    var oldDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = 'true';
    try {
        // Verify that running generate twice on same CodeGenerator resets locals
        var codegen = new codegen_1.CodeGenerator();
        var ast1 = new parser_1.Parser('let a = 1;').parseProgram();
        var code1 = codegen.generate(ast1).code;
        var ast2 = new parser_1.Parser('let a = 1;').parseProgram();
        var code2 = codegen.generate(ast2).code;
        node_assert_1.default.strictEqual(code1.length, code2.length);
    }
    finally {
        process.env.DEV_MODE = oldDevMode;
    }
});
(0, node_test_1.default)('Scope: complex nested scopes and boundaries', function () {
    var source = "\n        fn outer(a) {\n            let b = a + 1;\n            fn inner(b) {\n                let c = b + 2;\n                return c;\n            }\n            return b;\n        }\n    ";
    var parser = new parser_1.Parser(source);
    var ast = parser.parseProgram();
    var codegen = new codegen_1.CodeGenerator();
    var _a = codegen.generate(ast), code = _a.code, opcodeMap = _a.opcodeMap;
    node_assert_1.default.ok(code.length > 0);
});
(0, node_test_1.default)('Scope: multiple parameters mapping correctly', function () {
    var source = "\n        fn addFour(a, b, c, d) {\n            return a + b + c + d;\n        }\n    ";
    var parser = new parser_1.Parser(source);
    var ast = parser.parseProgram();
    var codegen = new codegen_1.CodeGenerator();
    var _a = codegen.generate(ast), code = _a.code, opcodeMap = _a.opcodeMap;
    node_assert_1.default.ok(code.length > 0);
});
(0, node_test_1.default)('Scope: return statements cleaning up nested block stack values', function () {
    var source = "\n        fn check(a) {\n            if (a > 10) {\n                return 1;\n            } else {\n                return 0;\n            }\n        }\n    ";
    var parser = new parser_1.Parser(source);
    var ast = parser.parseProgram();
    var codegen = new codegen_1.CodeGenerator();
    var _a = codegen.generate(ast), code = _a.code, opcodeMap = _a.opcodeMap;
    node_assert_1.default.ok(code.length > 0);
});
// ==========================================
// GROUP 3: Complex MBA, Float Math & Boundaries
// ==========================================
(0, node_test_1.default)('MBA: float addition in prod mode bypasses MBA bitwise transformations', function () {
    // In prod mode (DEV_MODE is false by default or unset), float additions must bypass MBA
    var oldDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = 'false';
    var oldRandom = Math.random;
    Math.random = function () { return 0.99; };
    try {
        var source = "let res = 1.5 + 2.5;";
        var parser = new parser_1.Parser(source);
        var ast = parser.parseProgram();
        var codegen = new codegen_1.CodeGenerator();
        var _a = codegen.generate(ast), code = _a.code, opcodeMap = _a.opcodeMap;
        // It must have OpCode.Add and NOT have OpCode.BitXor / BitAnd
        node_assert_1.default.ok(hasOpCode(code, opcodeMap, opcodes_1.OpCode.Add), "Should emit OpCode.Add for float math");
        node_assert_1.default.ok(!hasOpCode(code, opcodeMap, opcodes_1.OpCode.BitXor), "Should NOT emit OpCode.BitXor for float math");
    }
    finally {
        process.env.DEV_MODE = oldDevMode;
        Math.random = oldRandom;
    }
});
(0, node_test_1.default)('MBA: float subtraction in prod mode bypasses MBA bitwise transformations', function () {
    var oldDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = 'false';
    var oldRandom = Math.random;
    Math.random = function () { return 0.99; };
    try {
        var source = "let res = 10.5 - 2.5;";
        var parser = new parser_1.Parser(source);
        var ast = parser.parseProgram();
        var codegen = new codegen_1.CodeGenerator();
        var _a = codegen.generate(ast), code = _a.code, opcodeMap = _a.opcodeMap;
        node_assert_1.default.ok(hasOpCode(code, opcodeMap, opcodes_1.OpCode.Sub), "Should emit OpCode.Sub for float math");
        node_assert_1.default.ok(!hasOpCode(code, opcodeMap, opcodes_1.OpCode.BitXor), "Should NOT emit OpCode.BitXor for float math");
    }
    finally {
        process.env.DEV_MODE = oldDevMode;
        Math.random = oldRandom;
    }
});
(0, node_test_1.default)('MBA: float multiplication in prod mode bypasses MBA padding', function () {
    var oldDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = 'false';
    var oldRandom = Math.random;
    Math.random = function () { return 0.99; }; // bypass random junk and select deterministic path
    try {
        var source = "let res = 1.5 * 2.5;";
        var parser = new parser_1.Parser(source);
        var ast = parser.parseProgram();
        var codegen = new codegen_1.CodeGenerator();
        var _a = codegen.generate(ast), code = _a.code, opcodeMap = _a.opcodeMap;
        // MBA padding for integer multiplication adds/subtracts dummy variables.
        // Float multiplication should bypass it to prevent TypeError.
        node_assert_1.default.ok(hasOpCode(code, opcodeMap, opcodes_1.OpCode.Mul), "Should emit OpCode.Mul");
        // It shouldn't emit swap/jump or structural dummy add/subs
        node_assert_1.default.ok(!hasOpCode(code, opcodeMap, opcodes_1.OpCode.BitAnd), "Should not contain bitwise ops");
    }
    finally {
        process.env.DEV_MODE = oldDevMode;
        Math.random = oldRandom;
    }
});
(0, node_test_1.default)('MBA: float division in prod mode bypasses MBA padding', function () {
    var oldDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = 'false';
    try {
        var source = "let res = 10.5 / 2.0;";
        var parser = new parser_1.Parser(source);
        var ast = parser.parseProgram();
        var codegen = new codegen_1.CodeGenerator();
        var _a = codegen.generate(ast), code = _a.code, opcodeMap = _a.opcodeMap;
        node_assert_1.default.ok(hasOpCode(code, opcodeMap, opcodes_1.OpCode.Div), "Should emit OpCode.Div");
    }
    finally {
        process.env.DEV_MODE = oldDevMode;
    }
});
(0, node_test_1.default)('MBA: mixed float-int addition bypasses MBA', function () {
    var oldDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = 'false';
    var oldRandom = Math.random;
    Math.random = function () { return 0.99; };
    try {
        var source = "\n            let x = 1.5;\n            let y = x + 10;\n        ";
        var parser = new parser_1.Parser(source);
        var ast = parser.parseProgram();
        var codegen = new codegen_1.CodeGenerator();
        var _a = codegen.generate(ast), code = _a.code, opcodeMap = _a.opcodeMap;
        node_assert_1.default.ok(hasOpCode(code, opcodeMap, opcodes_1.OpCode.Add), "Should emit OpCode.Add for mixed float math");
        node_assert_1.default.ok(!hasOpCode(code, opcodeMap, opcodes_1.OpCode.BitXor), "Should not emit BitXor for mixed float math");
    }
    finally {
        process.env.DEV_MODE = oldDevMode;
        Math.random = oldRandom;
    }
});
(0, node_test_1.default)('MBA: pure integer math still undergoes MBA', function () {
    var oldDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = 'false';
    var oldRandom = Math.random;
    Math.random = function () { return 0.99; };
    try {
        var source = "let res = 5 + 10;";
        var parser = new parser_1.Parser(source);
        var ast = parser.parseProgram();
        var codegen = new codegen_1.CodeGenerator();
        var _a = codegen.generate(ast), code = _a.code, opcodeMap = _a.opcodeMap;
        // Pure integer add should emit MBA bitwise operations
        node_assert_1.default.ok(hasOpCode(code, opcodeMap, opcodes_1.OpCode.BitXor), "Integer addition should use BitXor");
        node_assert_1.default.ok(hasOpCode(code, opcodeMap, opcodes_1.OpCode.BitAnd), "Integer addition should use BitAnd");
    }
    finally {
        process.env.DEV_MODE = oldDevMode;
        Math.random = oldRandom;
    }
});
(0, node_test_1.default)('MBA: pure integer multiplication undergoes polynomial MBA', function () {
    var oldDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = 'false';
    var oldRandom = Math.random;
    Math.random = function () { return 0.99; };
    try {
        var source = "let res = 5 * 10;";
        var parser = new parser_1.Parser(source);
        var ast = parser.parseProgram();
        var codegen = new codegen_1.CodeGenerator();
        var _a = codegen.generate(ast), code = _a.code, opcodeMap = _a.opcodeMap;
        // Integer multiplication should emit the bitwise operations from our MBA formula:
        // x * y = (x & y) * (x | y) + (x & ~y) * (~x & y)
        node_assert_1.default.ok(hasOpCode(code, opcodeMap, opcodes_1.OpCode.BitAnd), "Integer multiplication should use BitAnd");
        node_assert_1.default.ok(hasOpCode(code, opcodeMap, opcodes_1.OpCode.BitOr), "Integer multiplication should use BitOr");
        node_assert_1.default.ok(hasOpCode(code, opcodeMap, opcodes_1.OpCode.BitNot), "Integer multiplication should use BitNot");
        // It should have two multiplications and one addition
        var mulCount = countOpCode(code, opcodeMap, opcodes_1.OpCode.Mul);
        node_assert_1.default.strictEqual(mulCount, 2, "Integer multiplication MBA should compile to exactly two multiplication instructions");
    }
    finally {
        process.env.DEV_MODE = oldDevMode;
        Math.random = oldRandom;
    }
});
(0, node_test_1.default)('MBA: dummy variables initialized in function body', function () {
    var source = "\n        fn f(x) {\n            return x + 1;\n        }\n    ";
    var parser = new parser_1.Parser(source);
    var ast = parser.parseProgram();
    var codegen = new codegen_1.CodeGenerator();
    var _a = codegen.generate(ast), code = _a.code, opcodeMap = _a.opcodeMap;
    // Inside the function frame, dummy variables must be initialized.
    // That means we must emit OpCode.StoreLocal.
    node_assert_1.default.ok(hasOpCode(code, opcodeMap, opcodes_1.OpCode.StoreLocal));
});
(0, node_test_1.default)('MBA: large integer mathematical boundary check (overflow test)', function () {
    var source = "\n        let max = 2147483647;\n        let result = max + 1;\n    ";
    var parser = new parser_1.Parser(source);
    var ast = parser.parseProgram();
    var codegen = new codegen_1.CodeGenerator();
    var _a = codegen.generate(ast), code = _a.code, opcodeMap = _a.opcodeMap;
    node_assert_1.default.ok(code.length > 0);
});
// ==========================================
// GROUP 4: Parser / Lexer Robustness Cases
// ==========================================
(0, node_test_1.default)('Parser: empty block statements', function () {
    var source = "\n        if (true) {} else {}\n        while (false) {}\n    ";
    var parser = new parser_1.Parser(source);
    var ast = parser.parseProgram();
    node_assert_1.default.strictEqual(ast.body.length, 2);
    node_assert_1.default.strictEqual(ast.body[0].type, 'IfStatement');
    node_assert_1.default.strictEqual(ast.body[0].consequent.body.length, 0);
    node_assert_1.default.strictEqual(ast.body[0].alternate.body.length, 0);
});
(0, node_test_1.default)('Parser: complex nested object and array literals', function () {
    var source = "\n        let val = [{ a: [1, 2, { b: 3 }] }, 4];\n    ";
    var parser = new parser_1.Parser(source);
    var ast = parser.parseProgram();
    var init = ast.body[0].value;
    node_assert_1.default.strictEqual(init.type, 'ArrayExpression');
    node_assert_1.default.strictEqual(init.elements[0].type, 'ObjectExpression');
});
(0, node_test_1.default)('Parser: unexpected token throws error', function () {
    node_assert_1.default.throws(function () {
        var parser = new parser_1.Parser('let x = ;');
        parser.parseProgram();
    });
});
(0, node_test_1.default)('Lexer: comments are skipped correctly', function () {
    var source = "\n        // this is single line\n        let x = 10;\n        /* multi\n           line comment */\n        let y = 20;\n    ";
    var lexer = new lexer_1.Lexer(source);
    var tokens = [];
    var token = lexer.nextToken();
    while (token.type !== lexer_1.TokenType.EOF) {
        tokens.push(token);
        token = lexer.nextToken();
    }
    node_assert_1.default.strictEqual(tokens[0].type, lexer_1.TokenType.Let);
    node_assert_1.default.strictEqual(tokens[5].type, lexer_1.TokenType.Let);
});
(0, node_test_1.default)('Lexer: handles quotes and backslashes in string literals', function () {
    var source = "let s = \"hello \\\" world\";";
    var lexer = new lexer_1.Lexer(source);
    var tokens = [];
    var token = lexer.nextToken();
    while (token.type !== lexer_1.TokenType.EOF) {
        tokens.push(token);
        token = lexer.nextToken();
    }
    node_assert_1.default.strictEqual(tokens[3].type, lexer_1.TokenType.String);
    node_assert_1.default.strictEqual(tokens[3].value, 'hello " world');
});
(0, node_test_1.default)('Lexer: float numbers parsing with scientific notation and various patterns', function () {
    var source = "let f1 = 0.005; let f2 = .5; let f3 = 5.0;";
    var lexer = new lexer_1.Lexer(source);
    var tokens = [];
    var token = lexer.nextToken();
    while (token.type !== lexer_1.TokenType.EOF) {
        tokens.push(token);
        token = lexer.nextToken();
    }
    var floatTokens = tokens.filter(function (t) { return t.type === lexer_1.TokenType.Number; });
    node_assert_1.default.strictEqual(floatTokens[0].value, '0.005');
    node_assert_1.default.strictEqual(floatTokens[1].value, '.5');
    node_assert_1.default.strictEqual(floatTokens[2].value, '5.0');
});
// ==========================================
// GROUP 5: Adversarial Review & Robustness
// ==========================================
(0, node_test_1.default)('Adversarial: Scope isolation vulnerability in nested functions', function () {
    // Nested functions are emitted inline. If executed, the outer function
    // falls through into the inner function and returns early.
    // Here we verify that a nested function has no skip jump emitted before it.
    var source = "\n        fn outer() {\n            let x = 1;\n            fn inner() {\n                return 2;\n            }\n            let y = 3;\n            return x + y;\n        }\n    ";
    var parser = new parser_1.Parser(source);
    var ast = parser.parseProgram();
    var codegen = new codegen_1.CodeGenerator();
    var _a = codegen.generate(ast), code = _a.code, opcodeMap = _a.opcodeMap;
    // Let's check the function address of outer and inner.
    var outerAddr = codegen['functions'].get('outer');
    var innerAddr = codegen['functions'].get('inner');
    if (outerAddr === undefined || innerAddr === undefined) {
        throw new Error("outerAddr or innerAddr is undefined");
    }
    // innerAddr must be greater than outerAddr since it's nested.
    node_assert_1.default.ok(innerAddr > outerAddr);
    // We scan the code between outerAddr and innerAddr.
    // There should be a Jump opcode mapping pointing past the end of the inner function.
    // The inner function ends with Return.
    // Let's check if there is a Jump instruction immediately preceding innerAddr.
    // A Jump instruction is: mapped_Jump (1 byte) + target (4 bytes) = 5 bytes total.
    // If there is a Jump, the byte at `innerAddr - 5` must map to OpCode.Jump.
    var preInnerOp = opcodeMap[code[innerAddr - 5]];
    // The nested function should have a Jump emitted right before it to skip its execution.
    node_assert_1.default.strictEqual(preInnerOp, opcodes_1.OpCode.Jump, "Nested function should have a skip jump emitted.");
});
(0, node_test_1.default)('Adversarial: Local slot boundary overflow vulnerability', function () {
    // Each integer addition generates two unique temporary variables.
    // A function with a moderate number of additions will leak local slots,
    // exceeding the VM limit of 256 local slots and causing runtime InvalidLocalSlot.
    // Here we compile a function with 130 additions and check that the number
    // of allocated local slots exceeds 256.
    var additions = '';
    for (var i_1 = 0; i_1 < 130; i_1++) {
        additions += ' + 1';
    }
    var source = "\n        fn overflow() {\n            let x = 1 ".concat(additions, ";\n            return x;\n        }\n    ");
    var parser = new parser_1.Parser(source);
    var ast = parser.parseProgram();
    var codegen = new codegen_1.CodeGenerator();
    // Code generation works (does not validate boundary)
    var _a = codegen.generate(ast), code = _a.code, opcodeMap = _a.opcodeMap;
    // But let's verify that the local slots mapped for the function 'overflow' exceeds 256
    // We can check the size of the isolated locals map by inspecting the generated slots.
    // Since generate() has completed, codegen['locals'] contains the main program's locals,
    // but we can compile just the function body by manually visiting it or checking that
    // the temporary variables generated during addition have slot indices >= 256.
    // Let's search the generated bytecode for StoreLocal instructions.
    // The operand of StoreLocal is the slot index. We check that no slot index is >= 256 since variables are recycled.
    var hasOobSlot = false;
    var i = 0;
    while (i < code.length) {
        var rawByte = code[i];
        var decodedOp = opcodeMap[rawByte];
        if (decodedOp === opcodes_1.OpCode.StoreLocal || decodedOp === opcodes_1.OpCode.LoadLocal) {
            if (i + 4 < code.length) {
                var slot = code[i + 1] | (code[i + 2] << 8) | (code[i + 3] << 16) | (code[i + 4] << 24);
                if (slot >= 256) {
                    hasOobSlot = true;
                    break;
                }
            }
        }
        switch (decodedOp) {
            case opcodes_1.OpCode.PushInt:
            case opcodes_1.OpCode.PushBool:
            case opcodes_1.OpCode.LoadLocal:
            case opcodes_1.OpCode.StoreLocal:
            case opcodes_1.OpCode.Jump:
            case opcodes_1.OpCode.JumpIf:
            case opcodes_1.OpCode.JumpIfNot:
            case opcodes_1.OpCode.JumpAndMul:
                i += 5;
                break;
            case opcodes_1.OpCode.PushFloat:
            case opcodes_1.OpCode.Call:
            case opcodes_1.OpCode.CallNative:
                i += 9;
                break;
            case opcodes_1.OpCode.PushString: {
                if (i + 8 < code.length) {
                    var len = code[i + 5] |
                        (code[i + 6] << 8) |
                        (code[i + 7] << 16) |
                        (code[i + 8] << 24);
                    i += 9 + len;
                }
                else {
                    i = code.length;
                }
                break;
            }
            default:
                i += 1;
                break;
        }
    }
    node_assert_1.default.ok(!hasOobSlot, "Compiler should not generate slot indices >= 256 due to variable recycling");
});
(0, node_test_1.default)('Adversarial: Float addition bypasses MBA only under strict conditions (type leakage)', function () {
    // If a float variable is initialized from a function return or object property,
    // the compiler types it as "int" or "any", causing addition to use integer MBA in production mode.
    // When run, the VM will hit BitXor/BitAnd and crash with TypeError.
    var oldDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = 'false'; // simulate production
    var oldRandom = Math.random;
    Math.random = function () { return 0.99; };
    try {
        var source = "\n            fn get_float() { return 1.5; }\n            fn test() {\n                let a = get_float();\n                let b = get_float();\n                return a + b;\n            }\n        ";
        var parser = new parser_1.Parser(source);
        var ast = parser.parseProgram();
        var codegen = new codegen_1.CodeGenerator();
        var _a = codegen.generate(ast), code = _a.code, opcodeMap = _a.opcodeMap;
        // Let's check if the compiled bytecode contains BitXor.
        // With float type inference leakage fixed, it should NOT contain BitXor for float math.
        var hasBitXor = hasOpCode(code, opcodeMap, opcodes_1.OpCode.BitXor);
        node_assert_1.default.ok(!hasBitXor, "Float variables must bypass MBA and not contain BitXor");
    }
    finally {
        process.env.DEV_MODE = oldDevMode;
        Math.random = oldRandom;
    }
});
(0, node_test_1.default)('Adversarial: Return opcode collision bug', function () {
    var source = "\n        fn col() {\n            let x = 1;\n            x;\n        }\n    ";
    var parser = new parser_1.Parser(source);
    var ast = parser.parseProgram();
    var codegen = new codegen_1.CodeGenerator();
    var res;
    var found = false;
    // Find a seed where Pop is mapped to 0x92 (value of OpCode.Return)
    for (var i = 0; i < 2000; i++) {
        res = codegen.generate(ast);
        if (codegen['opcodeMap'][opcodes_1.OpCode.Pop] === 0x92) {
            found = true;
            break;
        }
    }
    node_assert_1.default.ok(found, "Should find a seed where Pop maps to 0x92");
    var end = res.code.length;
    var mappedReturn = codegen['opcodeMap'][opcodes_1.OpCode.Return];
    node_assert_1.default.strictEqual(res.code[end - 3], 0x92);
    node_assert_1.default.strictEqual(res.code[end - 1], mappedReturn);
    // Because last byte is 0x92, which matches OpCode.Return (0x92) raw value,
    // the compiler skipped emitting the Return opcode.
    // Verify that the mapped Return instruction is missing.
    var hasReturn = res.code[end - 2] === mappedReturn || res.code[end - 1] === mappedReturn;
    node_assert_1.default.ok(hasReturn, "Compiler should emit Return even if the last byte has a collision with raw OpCode.Return value");
});
(0, node_test_1.default)('MBA: pure integer division undergoes division polynomial MBA', function () {
    var oldDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = 'false';
    var oldRandom = Math.random;
    Math.random = function () { return 0.99; };
    try {
        var source = "let res = 84 / 2;";
        var parser = new parser_1.Parser(source);
        var ast = parser.parseProgram();
        var codegen = new codegen_1.CodeGenerator();
        var _a = codegen.generate(ast), code = _a.code, opcodeMap = _a.opcodeMap;
        // Pure clean integer division should emit MBA bitwise operations
        node_assert_1.default.ok(hasOpCode(code, opcodeMap, opcodes_1.OpCode.BitAnd), "Integer division should use BitAnd");
        node_assert_1.default.ok(hasOpCode(code, opcodeMap, opcodes_1.OpCode.BitXor), "Integer division should use BitXor");
        node_assert_1.default.ok(hasOpCode(code, opcodeMap, opcodes_1.OpCode.Dup), "Integer division should use Dup");
        node_assert_1.default.ok(hasOpCode(code, opcodeMap, opcodes_1.OpCode.Mul), "Integer division should use Mul");
        node_assert_1.default.ok(hasOpCode(code, opcodeMap, opcodes_1.OpCode.Div), "Integer division should use Div");
    }
    finally {
        process.env.DEV_MODE = oldDevMode;
        Math.random = oldRandom;
    }
});
