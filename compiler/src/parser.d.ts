export type Node = Program | Statement | Expression;
export interface Program {
    type: 'Program';
    body: Statement[];
}
export type Statement = LetStatement | ReturnStatement | ExpressionStatement | FunctionDeclaration | IfStatement | BlockStatement;
export interface LetStatement {
    type: 'LetStatement';
    name: Identifier;
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
export type Expression = BinaryExpression | Literal | Identifier | CallExpression;
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
export interface Identifier {
    type: 'Identifier';
    name: string;
}
export interface CallExpression {
    type: 'CallExpression';
    callee: Expression;
    arguments: Expression[];
}
export declare class Parser {
    private lexer;
    private currentToken;
    private peekToken;
    constructor(source: string);
    private nextToken;
    private expect;
    parseProgram(): Program;
    private parseStatement;
    private parseLetStatement;
    private parseReturnStatement;
    private parseFunctionDeclaration;
    private parseIfStatement;
    private parseBlockStatement;
    private parseExpressionStatement;
    private getPrecedence;
    private parseExpression;
    private parsePrefix;
    private parseInfix;
}
//# sourceMappingURL=parser.d.ts.map