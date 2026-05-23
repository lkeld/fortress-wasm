export enum TokenType {
    Identifier,
    Number,
    String,
    Let,
    Fn,
    Return,
    If,
    Else,
    True,
    False,
    Null,
    While,
    For,
    Plus,
    Minus,
    PlusPlus,
    MinusMinus,
    Star,
    Slash,
    EqEq,
    NotEq,
    Eq,
    Lt,
    LtEq,
    Gt,
    GtEq,
    AndAnd,
    OrOr,
    Not,
    LParen,
    RParen,
    LBrace,
    RBrace,
    Comma,
    Semi,
    Dot,
    Colon,
    LBracket,
    RBracket,
    EOF,
}

export interface Token {
    type: TokenType;
    value: string;
    line: number;
}

export class Lexer {
    private source: string;
    private position: number = 0;
    private line: number = 1;

    constructor(source: string) {
        this.source = source;
    }

    private advance(): string {
        return this.source[this.position++] || '\0';
    }

    private peek(): string {
        if (this.isAtEnd()) return '\0';
        return this.source[this.position] || '\0';
    }

    private isAtEnd(): boolean {
        return this.position >= this.source.length;
    }

    private skipWhitespace() {
        while (!this.isAtEnd()) {
            const c = this.peek();
            if (c === ' ' || c === '\r' || c === '\t') {
                this.advance();
            } else if (c === '\n') {
                this.line++;
                this.advance();
            } else if (c === '/' && this.source[this.position + 1] === '/') {
                while (!this.isAtEnd() && this.peek() !== '\n') this.advance();
            } else if (c === '/' && this.source[this.position + 1] === '*') {
                this.advance(); // consume '/'
                this.advance(); // consume '*'
                while (!this.isAtEnd()) {
                    if (this.peek() === '*' && this.source[this.position + 1] === '/') {
                        this.advance(); // consume '*'
                        this.advance(); // consume '/'
                        break;
                    }
                    if (this.advance() === '\n') {
                        this.line++;
                    }
                }
            } else {
                break;
            }
        }
    }

    public nextToken(): Token {
        this.skipWhitespace();

        if (this.isAtEnd()) return { type: TokenType.EOF, value: '', line: this.line };

        const c = this.advance();

        if (/[a-zA-Z_]/.test(c)) {
            let ident = c;
            while (/[a-zA-Z0-9_]/.test(this.peek())) {
                ident += this.advance();
            }
            switch (ident) {
                case 'let': return { type: TokenType.Let, value: ident, line: this.line };
                case 'fn': return { type: TokenType.Fn, value: ident, line: this.line };
                case 'return': return { type: TokenType.Return, value: ident, line: this.line };
                case 'if': return { type: TokenType.If, value: ident, line: this.line };
                case 'else': return { type: TokenType.Else, value: ident, line: this.line };
                case 'while': return { type: TokenType.While, value: ident, line: this.line };
                case 'for': return { type: TokenType.For, value: ident, line: this.line };
                case 'true': return { type: TokenType.True, value: ident, line: this.line };
                case 'false': return { type: TokenType.False, value: ident, line: this.line };
                case 'null': return { type: TokenType.Null, value: ident, line: this.line };
                default: return { type: TokenType.Identifier, value: ident, line: this.line };
            }
        }

        if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(this.peek()))) {
            let num = c;
            while (/[0-9.eE]/.test(this.peek())) {
                const nextChar = this.advance();
                num += nextChar;
                if ((nextChar === 'e' || nextChar === 'E') && (this.peek() === '+' || this.peek() === '-')) {
                    num += this.advance();
                }
            }
            return { type: TokenType.Number, value: num, line: this.line };
        }

        if (c === '"') {
            let str = '';
            while (this.peek() !== '"' && !this.isAtEnd()) {
                const nextChar = this.advance();
                if (nextChar === '\\' && !this.isAtEnd()) {
                    const esc = this.advance();
                    if (esc === 'n') str += '\n';
                    else if (esc === 't') str += '\t';
                    else if (esc === 'r') str += '\r';
                    else str += esc;
                } else {
                    str += nextChar;
                }
            }
            this.advance(); // consume closing quote
            return { type: TokenType.String, value: str, line: this.line };
        }

        switch (c) {
            case '+': 
                if (this.peek() === '+') {
                    this.advance();
                    return { type: TokenType.PlusPlus, value: '++', line: this.line };
                }
                return { type: TokenType.Plus, value: c, line: this.line };
            case '-':
                if (this.peek() === '-') {
                    this.advance();
                    return { type: TokenType.MinusMinus, value: '--', line: this.line };
                }
                return { type: TokenType.Minus, value: c, line: this.line };
            case '*': return { type: TokenType.Star, value: c, line: this.line };
            case '/': return { type: TokenType.Slash, value: c, line: this.line };
            case '(': return { type: TokenType.LParen, value: c, line: this.line };
            case ')': return { type: TokenType.RParen, value: c, line: this.line };
            case '{': return { type: TokenType.LBrace, value: c, line: this.line };
            case '}': return { type: TokenType.RBrace, value: c, line: this.line };
            case '[': return { type: TokenType.LBracket, value: c, line: this.line };
            case ']': return { type: TokenType.RBracket, value: c, line: this.line };
            case ',': return { type: TokenType.Comma, value: c, line: this.line };
            case ';': return { type: TokenType.Semi, value: c, line: this.line };
            case ':': return { type: TokenType.Colon, value: c, line: this.line };
            case '.': return { type: TokenType.Dot, value: c, line: this.line };
            case '=':
                if (this.peek() === '=') {
                    this.advance();
                    return { type: TokenType.EqEq, value: '==', line: this.line };
                }
                return { type: TokenType.Eq, value: c, line: this.line };
            case '<':
                if (this.peek() === '=') {
                    this.advance();
                    return { type: TokenType.LtEq, value: '<=', line: this.line };
                }
                return { type: TokenType.Lt, value: c, line: this.line };
            case '>':
                if (this.peek() === '=') {
                    this.advance();
                    return { type: TokenType.GtEq, value: '>=', line: this.line };
                }
                return { type: TokenType.Gt, value: c, line: this.line };
            case '!':
                if (this.peek() === '=') {
                    this.advance();
                    return { type: TokenType.NotEq, value: '!=', line: this.line };
                }
                return { type: TokenType.Not, value: c, line: this.line };
            case '&':
                if (this.peek() === '&') {
                    this.advance();
                    return { type: TokenType.AndAnd, value: '&&', line: this.line };
                }
                break;
            case '|':
                if (this.peek() === '|') {
                    this.advance();
                    return { type: TokenType.OrOr, value: '||', line: this.line };
                }
                break;
        }

        throw new Error(`Unexpected character '${c}' at line ${this.line}`);
    }
}
