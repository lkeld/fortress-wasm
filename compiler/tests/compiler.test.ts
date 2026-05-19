import test from 'node:test';
import assert from 'node:assert';
import { Lexer, TokenType } from '../src/lexer';
import { Parser } from '../src/parser';
import { CodeGenerator } from '../src/codegen';

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
