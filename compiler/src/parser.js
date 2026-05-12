import { Lexer, Token, TokenType } from './lexer';
export class Parser {
    lexer;
    currentToken;
    peekToken;
    constructor(source) {
        this.lexer = new Lexer(source);
        this.currentToken = this.lexer.nextToken();
        this.peekToken = this.lexer.nextToken();
    }
    nextToken() {
        this.currentToken = this.peekToken;
        this.peekToken = this.lexer.nextToken();
    }
    expect(type) {
        if (this.currentToken.type === type) {
            this.nextToken();
            return true;
        }
        throw new Error(`Expected token type ${type}, got ${this.currentToken.type} at line ${this.currentToken.line}`);
    }
    parseProgram() {
        const body = [];
        while (this.currentToken.type !== TokenType.EOF) {
            body.push(this.parseStatement());
        }
        return { type: 'Program', body };
    }
    parseStatement() {
        switch (this.currentToken.type) {
            case TokenType.Let: return this.parseLetStatement();
            case TokenType.Return: return this.parseReturnStatement();
            case TokenType.Fn: return this.parseFunctionDeclaration();
            case TokenType.If: return this.parseIfStatement();
            case TokenType.LBrace: return this.parseBlockStatement();
            default: return this.parseExpressionStatement();
        }
    }
    parseLetStatement() {
        this.expect(TokenType.Let);
        const name = { type: 'Identifier', name: this.currentToken.value };
        this.expect(TokenType.Identifier);
        this.expect(TokenType.Eq);
        const value = this.parseExpression(0);
        this.expect(TokenType.Semi);
        return { type: 'LetStatement', name, value };
    }
    parseReturnStatement() {
        this.expect(TokenType.Return);
        if (this.currentToken.type === TokenType.Semi) {
            this.expect(TokenType.Semi);
            return { type: 'ReturnStatement', value: null };
        }
        const value = this.parseExpression(0);
        this.expect(TokenType.Semi);
        return { type: 'ReturnStatement', value };
    }
    parseFunctionDeclaration() {
        this.expect(TokenType.Fn);
        const name = { type: 'Identifier', name: this.currentToken.value };
        this.expect(TokenType.Identifier);
        this.expect(TokenType.LParen);
        const params = [];
        if (this.currentToken.type !== TokenType.RParen) {
            params.push({ type: 'Identifier', name: this.currentToken.value });
            this.expect(TokenType.Identifier);
            while (this.currentToken.type === TokenType.Comma) {
                this.expect(TokenType.Comma);
                params.push({ type: 'Identifier', name: this.currentToken.value });
                this.expect(TokenType.Identifier);
            }
        }
        this.expect(TokenType.RParen);
        const body = this.parseBlockStatement();
        return { type: 'FunctionDeclaration', name, params, body };
    }
    parseIfStatement() {
        this.expect(TokenType.If);
        this.expect(TokenType.LParen);
        const condition = this.parseExpression(0);
        this.expect(TokenType.RParen);
        const consequent = this.parseBlockStatement();
        let alternate = null;
        if (this.currentToken.type === TokenType.Else) {
            this.expect(TokenType.Else);
            alternate = this.parseBlockStatement();
        }
        return { type: 'IfStatement', condition, consequent, alternate };
    }
    parseBlockStatement() {
        this.expect(TokenType.LBrace);
        const body = [];
        while (this.currentToken.type !== TokenType.RBrace && this.currentToken.type !== TokenType.EOF) {
            body.push(this.parseStatement());
        }
        this.expect(TokenType.RBrace);
        return { type: 'BlockStatement', body };
    }
    parseExpressionStatement() {
        const expression = this.parseExpression(0);
        this.expect(TokenType.Semi);
        return { type: 'ExpressionStatement', expression };
    }
    getPrecedence(type) {
        switch (type) {
            case TokenType.EqEq: return 1;
            case TokenType.Lt:
            case TokenType.Gt: return 2;
            case TokenType.Plus:
            case TokenType.Minus: return 3;
            case TokenType.Star:
            case TokenType.Slash: return 4;
            case TokenType.LParen: return 5;
            default: return 0;
        }
    }
    parseExpression(precedence) {
        let left = this.parsePrefix();
        while (this.currentToken.type !== TokenType.Semi && this.currentToken.type !== TokenType.EOF && precedence < this.getPrecedence(this.currentToken.type)) {
            left = this.parseInfix(left);
        }
        return left;
    }
    parsePrefix() {
        const token = this.currentToken;
        switch (token.type) {
            case TokenType.Identifier:
                this.nextToken();
                return { type: 'Identifier', name: token.value };
            case TokenType.Number:
                this.nextToken();
                return { type: 'Literal', value: parseFloat(token.value), raw: token.value };
            case TokenType.String:
                this.nextToken();
                return { type: 'Literal', value: token.value, raw: `"${token.value}"` };
            case TokenType.True:
                this.nextToken();
                return { type: 'Literal', value: true, raw: 'true' };
            case TokenType.False:
                this.nextToken();
                return { type: 'Literal', value: false, raw: 'false' };
            case TokenType.Null:
                this.nextToken();
                return { type: 'Literal', value: null, raw: 'null' };
            default:
                throw new Error(`Unexpected prefix token ${token.type} at line ${token.line}`);
        }
    }
    parseInfix(left) {
        const token = this.currentToken;
        if (token.type === TokenType.LParen) {
            this.nextToken();
            const args = [];
            if (this.currentToken.type !== TokenType.RParen) {
                args.push(this.parseExpression(0));
                while (this.currentToken.type === TokenType.Comma) {
                    this.expect(TokenType.Comma);
                    args.push(this.parseExpression(0));
                }
            }
            this.expect(TokenType.RParen);
            return { type: 'CallExpression', callee: left, arguments: args };
        }
        const precedence = this.getPrecedence(token.type);
        this.nextToken();
        const right = this.parseExpression(precedence);
        return { type: 'BinaryExpression', operator: token.value, left, right };
    }
}
//# sourceMappingURL=parser.js.map