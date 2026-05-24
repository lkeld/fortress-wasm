"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Parser = void 0;
var lexer_1 = require("./lexer");
var Parser = /** @class */ (function () {
    function Parser(source) {
        this.lexer = new lexer_1.Lexer(source);
        this.currentToken = this.lexer.nextToken();
        this.peekToken = this.lexer.nextToken();
    }
    Parser.prototype.nextToken = function () {
        this.currentToken = this.peekToken;
        this.peekToken = this.lexer.nextToken();
    };
    Parser.prototype.expect = function (type) {
        if (this.currentToken.type === type) {
            this.nextToken();
            return true;
        }
        throw new Error("Expected token type ".concat(type, ", got ").concat(this.currentToken.type, " at line ").concat(this.currentToken.line));
    };
    Parser.prototype.parseProgram = function () {
        var body = [];
        while (this.currentToken.type !== lexer_1.TokenType.EOF) {
            body.push(this.parseStatement());
        }
        return { type: 'Program', body: body };
    };
    Parser.prototype.parseStatement = function () {
        switch (this.currentToken.type) {
            case lexer_1.TokenType.Let: return this.parseLetStatement();
            case lexer_1.TokenType.Return: return this.parseReturnStatement();
            case lexer_1.TokenType.Fn: return this.parseFunctionDeclaration();
            case lexer_1.TokenType.If: return this.parseIfStatement();
            case lexer_1.TokenType.While: return this.parseWhileStatement();
            case lexer_1.TokenType.For: return this.parseForStatement();
            case lexer_1.TokenType.LBrace: return this.parseBlockStatement();
            default: return this.parseExpressionOrAssignStatement();
        }
    };
    Parser.prototype.parseLetStatement = function () {
        this.expect(lexer_1.TokenType.Let);
        var name = { type: 'Identifier', name: this.currentToken.value };
        this.expect(lexer_1.TokenType.Identifier);
        this.expect(lexer_1.TokenType.Eq);
        var value = this.parseExpression(0);
        this.expect(lexer_1.TokenType.Semi);
        return { type: 'LetStatement', name: name, value: value };
    };
    Parser.prototype.parseExpressionOrAssignStatement = function () {
        var expression = this.parseExpression(0);
        if (this.currentToken.type === lexer_1.TokenType.Eq) {
            this.expect(lexer_1.TokenType.Eq);
            var value = this.parseExpression(0);
            this.expect(lexer_1.TokenType.Semi);
            if (expression.type === 'Identifier' || expression.type === 'MemberExpression') {
                return { type: 'AssignStatement', left: expression, value: value };
            }
            throw new Error("Invalid left-hand side in assignment");
        }
        this.expect(lexer_1.TokenType.Semi);
        return { type: 'ExpressionStatement', expression: expression };
    };
    Parser.prototype.parseReturnStatement = function () {
        this.expect(lexer_1.TokenType.Return);
        if (this.currentToken.type === lexer_1.TokenType.Semi) {
            this.expect(lexer_1.TokenType.Semi);
            return { type: 'ReturnStatement', value: null };
        }
        var value = this.parseExpression(0);
        this.expect(lexer_1.TokenType.Semi);
        return { type: 'ReturnStatement', value: value };
    };
    Parser.prototype.parseFunctionDeclaration = function () {
        this.expect(lexer_1.TokenType.Fn);
        var name = { type: 'Identifier', name: this.currentToken.value };
        this.expect(lexer_1.TokenType.Identifier);
        this.expect(lexer_1.TokenType.LParen);
        var params = [];
        if (this.currentToken.type !== lexer_1.TokenType.RParen) {
            params.push({ type: 'Identifier', name: this.currentToken.value });
            this.expect(lexer_1.TokenType.Identifier);
            while (this.currentToken.type === lexer_1.TokenType.Comma) {
                this.expect(lexer_1.TokenType.Comma);
                params.push({ type: 'Identifier', name: this.currentToken.value });
                this.expect(lexer_1.TokenType.Identifier);
            }
        }
        this.expect(lexer_1.TokenType.RParen);
        var body = this.parseBlockStatement();
        return { type: 'FunctionDeclaration', name: name, params: params, body: body };
    };
    Parser.prototype.parseIfStatement = function () {
        this.expect(lexer_1.TokenType.If);
        this.expect(lexer_1.TokenType.LParen);
        var condition = this.parseExpression(0);
        this.expect(lexer_1.TokenType.RParen);
        var consequent = this.parseBlockStatement();
        var alternate = null;
        if (this.currentToken.type === lexer_1.TokenType.Else) {
            this.expect(lexer_1.TokenType.Else);
            alternate = this.parseBlockStatement();
        }
        return { type: 'IfStatement', condition: condition, consequent: consequent, alternate: alternate };
    };
    Parser.prototype.parseWhileStatement = function () {
        this.expect(lexer_1.TokenType.While);
        this.expect(lexer_1.TokenType.LParen);
        var condition = this.parseExpression(0);
        this.expect(lexer_1.TokenType.RParen);
        var body = this.parseBlockStatement();
        return { type: 'WhileStatement', condition: condition, body: body };
    };
    Parser.prototype.parseForStatement = function () {
        this.expect(lexer_1.TokenType.For);
        this.expect(lexer_1.TokenType.LParen);
        var init = null;
        if (this.currentToken.type !== lexer_1.TokenType.Semi) {
            init = this.parseStatement();
        }
        else {
            this.expect(lexer_1.TokenType.Semi);
        }
        var condition = null;
        if (this.currentToken.type !== lexer_1.TokenType.Semi) {
            condition = this.parseExpression(0);
        }
        this.expect(lexer_1.TokenType.Semi);
        var update = null;
        if (this.currentToken.type !== lexer_1.TokenType.RParen) {
            update = this.parseExpression(0);
        }
        this.expect(lexer_1.TokenType.RParen);
        var body = this.parseBlockStatement();
        return { type: 'ForStatement', init: init, condition: condition, update: update, body: body };
    };
    Parser.prototype.parseBlockStatement = function () {
        this.expect(lexer_1.TokenType.LBrace);
        var body = [];
        while (this.currentToken.type !== lexer_1.TokenType.RBrace && this.currentToken.type !== lexer_1.TokenType.EOF) {
            body.push(this.parseStatement());
        }
        this.expect(lexer_1.TokenType.RBrace);
        return { type: 'BlockStatement', body: body };
    };
    Parser.prototype.parseExpressionStatement = function () {
        var expression = this.parseExpression(0);
        this.expect(lexer_1.TokenType.Semi);
        return { type: 'ExpressionStatement', expression: expression };
    };
    Parser.prototype.getPrecedence = function (type) {
        switch (type) {
            case lexer_1.TokenType.OrOr: return 1;
            case lexer_1.TokenType.AndAnd: return 2;
            case lexer_1.TokenType.EqEq:
            case lexer_1.TokenType.NotEq:
            case lexer_1.TokenType.StrictEq:
            case lexer_1.TokenType.StrictNeq: return 3;
            case lexer_1.TokenType.Lt:
            case lexer_1.TokenType.LtEq:
            case lexer_1.TokenType.Gt:
            case lexer_1.TokenType.GtEq: return 4;
            case lexer_1.TokenType.Plus:
            case lexer_1.TokenType.Minus: return 5;
            case lexer_1.TokenType.Star:
            case lexer_1.TokenType.Slash: return 6;
            case lexer_1.TokenType.LParen:
            case lexer_1.TokenType.LBracket:
            case lexer_1.TokenType.Dot: return 7;
            case lexer_1.TokenType.PlusPlus:
            case lexer_1.TokenType.MinusMinus: return 8;
            default: return 0;
        }
    };
    Parser.prototype.parseExpression = function (precedence) {
        var left = this.parsePrefix();
        while (this.currentToken.type !== lexer_1.TokenType.Semi && this.currentToken.type !== lexer_1.TokenType.EOF && precedence < this.getPrecedence(this.currentToken.type)) {
            left = this.parseInfix(left);
        }
        return left;
    };
    Parser.prototype.parsePrefix = function () {
        var token = this.currentToken;
        switch (token.type) {
            case lexer_1.TokenType.Identifier:
                this.nextToken();
                return { type: 'Identifier', name: token.value };
            case lexer_1.TokenType.Number:
                this.nextToken();
                return { type: 'Literal', value: parseFloat(token.value), raw: token.value };
            case lexer_1.TokenType.String:
                this.nextToken();
                return { type: 'Literal', value: token.value, raw: "\"".concat(token.value, "\"") };
            case lexer_1.TokenType.True:
                this.nextToken();
                return { type: 'Literal', value: true, raw: 'true' };
            case lexer_1.TokenType.False:
                this.nextToken();
                return { type: 'Literal', value: false, raw: 'false' };
            case lexer_1.TokenType.Null:
                this.nextToken();
                return { type: 'Literal', value: null, raw: 'null' };
            case lexer_1.TokenType.LBracket:
                this.nextToken();
                var elements = [];
                if (this.currentToken.type !== lexer_1.TokenType.RBracket) {
                    elements.push(this.parseExpression(0));
                    while (this.currentToken.type === lexer_1.TokenType.Comma) {
                        this.expect(lexer_1.TokenType.Comma);
                        elements.push(this.parseExpression(0));
                    }
                }
                this.expect(lexer_1.TokenType.RBracket);
                return { type: 'ArrayExpression', elements: elements };
            case lexer_1.TokenType.LBrace:
                this.nextToken();
                var properties = [];
                while (this.currentToken.type !== lexer_1.TokenType.RBrace && this.currentToken.type !== lexer_1.TokenType.EOF) {
                    var key = void 0;
                    if (this.currentToken.type === lexer_1.TokenType.Identifier) {
                        key = { type: 'Identifier', name: this.currentToken.value };
                        this.nextToken();
                    }
                    else if (this.currentToken.type === lexer_1.TokenType.String) {
                        key = { type: 'Literal', value: this.currentToken.value, raw: "\"".concat(this.currentToken.value, "\"") };
                        this.nextToken();
                    }
                    else {
                        throw new Error("Expected identifier or string as object property key at line ".concat(this.currentToken.line));
                    }
                    var value = void 0;
                    if (this.currentToken.type === lexer_1.TokenType.Colon) {
                        this.expect(lexer_1.TokenType.Colon);
                        value = this.parseExpression(0);
                    }
                    else if (key.type === 'Identifier') {
                        // Shorthand: { x } -> { x: x }
                        value = { type: 'Identifier', name: key.name };
                    }
                    else {
                        throw new Error("Expected ':' after property key at line ".concat(this.currentToken.line));
                    }
                    properties.push({ type: 'Property', key: key, value: value });
                    if (this.currentToken.type !== lexer_1.TokenType.RBrace) {
                        this.expect(lexer_1.TokenType.Comma);
                    }
                }
                this.expect(lexer_1.TokenType.RBrace);
                return { type: 'ObjectExpression', properties: properties };
            case lexer_1.TokenType.Minus:
                this.nextToken();
                return {
                    type: 'BinaryExpression',
                    operator: '-',
                    left: { type: 'Literal', value: 0, raw: '0' },
                    right: this.parseExpression(this.getPrecedence(lexer_1.TokenType.Minus))
                };
            case lexer_1.TokenType.Not:
                this.nextToken();
                return {
                    type: 'UnaryExpression',
                    operator: '!',
                    argument: this.parseExpression(8)
                };
            case lexer_1.TokenType.LParen:
                this.nextToken();
                var expr = this.parseExpression(0);
                this.expect(lexer_1.TokenType.RParen);
                return expr;
            default:
                throw new Error("Unexpected prefix token ".concat(token.type, " (").concat(lexer_1.TokenType[token.type], ") at line ").concat(token.line));
        }
    };
    Parser.prototype.parseInfix = function (left) {
        var token = this.currentToken;
        if (token.type === lexer_1.TokenType.PlusPlus || token.type === lexer_1.TokenType.MinusMinus) {
            this.nextToken();
            return { type: 'UpdateExpression', operator: token.value, argument: left };
        }
        if (token.type === lexer_1.TokenType.LParen) {
            this.nextToken();
            var args = [];
            if (this.currentToken.type !== lexer_1.TokenType.RParen) {
                args.push(this.parseExpression(0));
                while (this.currentToken.type === lexer_1.TokenType.Comma) {
                    this.expect(lexer_1.TokenType.Comma);
                    args.push(this.parseExpression(0));
                }
            }
            this.expect(lexer_1.TokenType.RParen);
            return { type: 'CallExpression', callee: left, arguments: args };
        }
        if (token.type === lexer_1.TokenType.LBracket) {
            this.nextToken();
            var property = this.parseExpression(0);
            this.expect(lexer_1.TokenType.RBracket);
            return { type: 'MemberExpression', object: left, property: property, computed: true };
        }
        if (token.type === lexer_1.TokenType.Dot) {
            this.nextToken();
            var name_1 = this.currentToken.value;
            this.expect(lexer_1.TokenType.Identifier);
            var property = { type: 'Identifier', name: name_1 };
            return { type: 'MemberExpression', object: left, property: property, computed: false };
        }
        var precedence = this.getPrecedence(token.type);
        this.nextToken();
        var right = this.parseExpression(precedence);
        return { type: 'BinaryExpression', operator: token.value, left: left, right: right };
    };
    return Parser;
}());
exports.Parser = Parser;
