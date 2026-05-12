export declare enum TokenType {
    Identifier = 0,
    Number = 1,
    String = 2,
    Let = 3,
    Fn = 4,
    Return = 5,
    If = 6,
    Else = 7,
    True = 8,
    False = 9,
    Null = 10,
    Plus = 11,
    Minus = 12,
    Star = 13,
    Slash = 14,
    EqEq = 15,
    Eq = 16,
    Lt = 17,
    Gt = 18,
    LParen = 19,
    RParen = 20,
    LBrace = 21,
    RBrace = 22,
    Comma = 23,
    Semi = 24,
    EOF = 25
}
export interface Token {
    type: TokenType;
    value: string;
    line: number;
}
export declare class Lexer {
    private source;
    private position;
    private line;
    constructor(source: string);
    private advance;
    private peek;
    private isAtEnd;
    private skipWhitespace;
    nextToken(): Token;
}
//# sourceMappingURL=lexer.d.ts.map