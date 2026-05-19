import { Lexer, Token, TokenType } from './lexer';

export type Node = Program | Statement | Expression;

export interface Program {
    type: 'Program';
    body: Statement[];
}

export type Statement = 
    | LetStatement
    | AssignStatement
    | ReturnStatement
    | ExpressionStatement
    | FunctionDeclaration
    | IfStatement
    | BlockStatement
    | WhileStatement
    | ForStatement;

export interface LetStatement {
    type: 'LetStatement';
    name: Identifier;
    value: Expression;
}

export interface AssignStatement {
    type: 'AssignStatement';
    left: Identifier | MemberExpression;
    value: Expression;
}

export interface ReturnStatement {
    type: 'ReturnStatement';
    value: Expression | null;
}

export interface ExpressionStatement {
    type: 'ExpressionStatement';
    expression: Expression;
}

export interface FunctionDeclaration {
    type: 'FunctionDeclaration';
    name: Identifier;
    params: Identifier[];
    body: BlockStatement;
}

export interface IfStatement {
    type: 'IfStatement';
    condition: Expression;
    consequent: BlockStatement;
    alternate: BlockStatement | null;
}

export interface BlockStatement {
    type: 'BlockStatement';
    body: Statement[];
}

export interface WhileStatement {
    type: 'WhileStatement';
    condition: Expression;
    body: BlockStatement;
}

export interface ForStatement {
    type: 'ForStatement';
    init: Statement | null;
    condition: Expression | null;
    update: Expression | null;
    body: BlockStatement;
}

export type Expression = 
    | BinaryExpression
    | Literal
    | Identifier
    | CallExpression
    | ArrayExpression
    | ObjectExpression
    | MemberExpression
    | UpdateExpression;

export interface BinaryExpression {
    type: 'BinaryExpression';
    operator: string;
    left: Expression;
    right: Expression;
}

export interface Literal {
    type: 'Literal';
    value: any;
    raw: string;
}

export interface ArrayExpression {
    type: 'ArrayExpression';
    elements: Expression[];
}

export interface ObjectExpression {
    type: 'ObjectExpression';
    properties: Property[];
}

export interface Property {
    type: 'Property';
    key: Identifier | Literal;
    value: Expression;
}

export interface Identifier {
    type: 'Identifier';
    name: string;
}

export interface CallExpression {
    type: 'CallExpression';
    callee: Expression;
    arguments: Expression[];
}

export interface MemberExpression {
    type: 'MemberExpression';
    object: Expression;
    property: Expression;
    computed: boolean;
}

export interface UpdateExpression {
    type: 'UpdateExpression';
    operator: string;
    argument: Expression;
}

export class Parser {
    private lexer: Lexer;
    private currentToken: Token;
    private peekToken: Token;

    constructor(source: string) {
        this.lexer = new Lexer(source);
        this.currentToken = this.lexer.nextToken();
        this.peekToken = this.lexer.nextToken();
    }

    private nextToken() {
        this.currentToken = this.peekToken;
        this.peekToken = this.lexer.nextToken();
    }

    private expect(type: TokenType): boolean {
        if (this.currentToken.type === type) {
            this.nextToken();
            return true;
        }
        throw new Error(`Expected token type ${type}, got ${this.currentToken.type} at line ${this.currentToken.line}`);
    }

    public parseProgram(): Program {
        const body: Statement[] = [];
        while (this.currentToken.type !== TokenType.EOF) {
            body.push(this.parseStatement());
        }
        return { type: 'Program', body };
    }

    private parseStatement(): Statement {
        switch (this.currentToken.type) {
            case TokenType.Let: return this.parseLetStatement();
            case TokenType.Return: return this.parseReturnStatement();
            case TokenType.Fn: return this.parseFunctionDeclaration();
            case TokenType.If: return this.parseIfStatement();
            case TokenType.While: return this.parseWhileStatement();
            case TokenType.For: return this.parseForStatement();
            case TokenType.LBrace: return this.parseBlockStatement();
            default: return this.parseExpressionOrAssignStatement();
        }
    }

    private parseLetStatement(): LetStatement {
        this.expect(TokenType.Let);
        const name = { type: 'Identifier' as const, name: this.currentToken.value };
        this.expect(TokenType.Identifier);
        this.expect(TokenType.Eq);
        const value = this.parseExpression(0);
        this.expect(TokenType.Semi);
        return { type: 'LetStatement', name, value };
    }

    private parseExpressionOrAssignStatement(): Statement {
        const expression = this.parseExpression(0);
        if (this.currentToken.type === TokenType.Eq) {
            this.expect(TokenType.Eq);
            const value = this.parseExpression(0);
            this.expect(TokenType.Semi);
            if (expression.type === 'Identifier' || expression.type === 'MemberExpression') {
                return { type: 'AssignStatement', left: expression, value };
            }
            throw new Error("Invalid left-hand side in assignment");
        }
        this.expect(TokenType.Semi);
        return { type: 'ExpressionStatement', expression };
    }

    private parseReturnStatement(): ReturnStatement {
        this.expect(TokenType.Return);
        if (this.currentToken.type === TokenType.Semi) {
            this.expect(TokenType.Semi);
            return { type: 'ReturnStatement', value: null };
        }
        const value = this.parseExpression(0);
        this.expect(TokenType.Semi);
        return { type: 'ReturnStatement', value };
    }

    private parseFunctionDeclaration(): FunctionDeclaration {
        this.expect(TokenType.Fn);
        const name = { type: 'Identifier' as const, name: this.currentToken.value };
        this.expect(TokenType.Identifier);
        this.expect(TokenType.LParen);
        const params: Identifier[] = [];
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

    private parseIfStatement(): IfStatement {
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

    private parseWhileStatement(): WhileStatement {
        this.expect(TokenType.While);
        this.expect(TokenType.LParen);
        const condition = this.parseExpression(0);
        this.expect(TokenType.RParen);
        const body = this.parseBlockStatement();
        return { type: 'WhileStatement', condition, body };
    }

    private parseForStatement(): ForStatement {
        this.expect(TokenType.For);
        this.expect(TokenType.LParen);
        let init: Statement | null = null;
        if (this.currentToken.type !== TokenType.Semi) {
            init = this.parseStatement();
        } else {
            this.expect(TokenType.Semi);
        }
        
        let condition: Expression | null = null;
        if (this.currentToken.type !== TokenType.Semi) {
            condition = this.parseExpression(0);
        }
        this.expect(TokenType.Semi);
        
        let update: Expression | null = null;
        if (this.currentToken.type !== TokenType.RParen) {
            update = this.parseExpression(0);
        }
        this.expect(TokenType.RParen);
        
        const body = this.parseBlockStatement();
        return { type: 'ForStatement', init, condition, update, body };
    }

    private parseBlockStatement(): BlockStatement {
        this.expect(TokenType.LBrace);
        const body: Statement[] = [];
        while (this.currentToken.type !== TokenType.RBrace && this.currentToken.type !== TokenType.EOF) {
            body.push(this.parseStatement());
        }
        this.expect(TokenType.RBrace);
        return { type: 'BlockStatement', body };
    }

    private parseExpressionStatement(): ExpressionStatement {
        const expression = this.parseExpression(0);
        this.expect(TokenType.Semi);
        return { type: 'ExpressionStatement', expression };
    }

    private getPrecedence(type: TokenType): number {
        switch (type) {
            case TokenType.OrOr: return 1;
            case TokenType.AndAnd: return 2;
            case TokenType.EqEq:
            case TokenType.NotEq: return 3;
            case TokenType.Lt:
            case TokenType.LtEq:
            case TokenType.Gt:
            case TokenType.GtEq: return 4;
            case TokenType.Plus:
            case TokenType.Minus: return 5;
            case TokenType.Star:
            case TokenType.Slash: return 6;
            case TokenType.LParen: 
            case TokenType.LBracket:
            case TokenType.Dot: return 7;
            case TokenType.PlusPlus:
            case TokenType.MinusMinus: return 8;
            default: return 0;
        }
    }

    private parseExpression(precedence: number): Expression {
        let left = this.parsePrefix();

        while (this.currentToken.type !== TokenType.Semi && this.currentToken.type !== TokenType.EOF && precedence < this.getPrecedence(this.currentToken.type)) {
            left = this.parseInfix(left);
        }

        return left;
    }

    private parsePrefix(): Expression {
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
            case TokenType.LBracket:
                this.nextToken();
                const elements: Expression[] = [];
                if (this.currentToken.type !== TokenType.RBracket) {
                    elements.push(this.parseExpression(0));
                    while (this.currentToken.type === TokenType.Comma) {
                        this.expect(TokenType.Comma);
                        elements.push(this.parseExpression(0));
                    }
                }
                this.expect(TokenType.RBracket);
                return { type: 'ArrayExpression', elements };
            case TokenType.LBrace:
                this.nextToken();
                const properties: Property[] = [];
                while (this.currentToken.type !== TokenType.RBrace && this.currentToken.type !== TokenType.EOF) {
                    let key: Identifier | Literal;
                    if (this.currentToken.type === TokenType.Identifier) {
                        key = { type: 'Identifier', name: this.currentToken.value };
                        this.nextToken();
                    } else if (this.currentToken.type === TokenType.String) {
                        key = { type: 'Literal', value: this.currentToken.value, raw: `"${this.currentToken.value}"` };
                        this.nextToken();
                    } else {
                        throw new Error(`Expected identifier or string as object property key at line ${this.currentToken.line}`);
                    }
                    
                    let value: Expression;
                    if ((this.currentToken.type as any) === TokenType.Colon) {
                        this.expect(TokenType.Colon);
                        value = this.parseExpression(0);
                    } else if (key.type === 'Identifier') {
                        // Shorthand: { x } -> { x: x }
                        value = { type: 'Identifier', name: key.name };
                    } else {
                        throw new Error(`Expected ':' after property key at line ${this.currentToken.line}`);
                    }
                    
                    properties.push({ type: 'Property', key, value });
                    
                    if ((this.currentToken.type as any) !== TokenType.RBrace) {
                        this.expect(TokenType.Comma);
                    }
                }
                this.expect(TokenType.RBrace);
                return { type: 'ObjectExpression', properties };
            case TokenType.Minus:
                this.nextToken();
                return { 
                    type: 'BinaryExpression', 
                    operator: '-', 
                    left: { type: 'Literal', value: 0, raw: '0' }, 
                    right: this.parseExpression(this.getPrecedence(TokenType.Minus))
                };
            default:
                throw new Error(`Unexpected prefix token ${token.type} (${TokenType[token.type]}) at line ${token.line}`);
        }
    }

    private parseInfix(left: Expression): Expression {
        const token = this.currentToken;
        
        if (token.type === TokenType.PlusPlus || token.type === TokenType.MinusMinus) {
            this.nextToken();
            return { type: 'UpdateExpression', operator: token.value, argument: left };
        }

        if (token.type === TokenType.LParen) {
            this.nextToken();
            const args: Expression[] = [];
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
        
        if (token.type === TokenType.LBracket) {
            this.nextToken();
            const property = this.parseExpression(0);
            this.expect(TokenType.RBracket);
            return { type: 'MemberExpression', object: left, property, computed: true };
        }

        if (token.type === TokenType.Dot) {
            this.nextToken();
            const name = this.currentToken.value;
            this.expect(TokenType.Identifier);
            const property = { type: 'Identifier' as const, name };
            return { type: 'MemberExpression', object: left, property, computed: false };
        }

        const precedence = this.getPrecedence(token.type);
        this.nextToken();
        const right = this.parseExpression(precedence);
        return { type: 'BinaryExpression', operator: token.value, left, right };
    }
}
