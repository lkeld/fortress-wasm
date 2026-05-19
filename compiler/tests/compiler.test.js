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
