export var TokenType;
(function (TokenType) {
    TokenType[TokenType["Identifier"] = 0] = "Identifier";
    TokenType[TokenType["Number"] = 1] = "Number";
    TokenType[TokenType["String"] = 2] = "String";
    TokenType[TokenType["Let"] = 3] = "Let";
    TokenType[TokenType["Fn"] = 4] = "Fn";
    TokenType[TokenType["Return"] = 5] = "Return";
    TokenType[TokenType["If"] = 6] = "If";
    TokenType[TokenType["Else"] = 7] = "Else";
    TokenType[TokenType["True"] = 8] = "True";
    TokenType[TokenType["False"] = 9] = "False";
    TokenType[TokenType["Null"] = 10] = "Null";
    TokenType[TokenType["Plus"] = 11] = "Plus";
    TokenType[TokenType["Minus"] = 12] = "Minus";
    TokenType[TokenType["Star"] = 13] = "Star";
    TokenType[TokenType["Slash"] = 14] = "Slash";
    TokenType[TokenType["EqEq"] = 15] = "EqEq";
    TokenType[TokenType["Eq"] = 16] = "Eq";
    TokenType[TokenType["Lt"] = 17] = "Lt";
    TokenType[TokenType["Gt"] = 18] = "Gt";
    TokenType[TokenType["LParen"] = 19] = "LParen";
    TokenType[TokenType["RParen"] = 20] = "RParen";
    TokenType[TokenType["LBrace"] = 21] = "LBrace";
    TokenType[TokenType["RBrace"] = 22] = "RBrace";
    TokenType[TokenType["Comma"] = 23] = "Comma";
    TokenType[TokenType["Semi"] = 24] = "Semi";
    TokenType[TokenType["EOF"] = 25] = "EOF";
})(TokenType || (TokenType = {}));
export class Lexer {
    source;
    position = 0;
    line = 1;
    constructor(source) {
        this.source = source;
    }
    advance() {
        return this.source[this.position++];
    }
    peek() {
        if (this.isAtEnd())
            return '\0';
        return this.source[this.position];
    }
    isAtEnd() {
        return this.position >= this.source.length;
    }
    skipWhitespace() {
        while (!this.isAtEnd()) {
            const c = this.peek();
            if (c === ' ' || c === '\r' || c === '\t') {
                this.advance();
            }
            else if (c === '\n') {
                this.line++;
                this.advance();
            }
            else if (c === '/' && this.source[this.position + 1] === '/') {
                while (!this.isAtEnd() && this.peek() !== '\n')
                    this.advance();
            }
            else {
                break;
            }
        }
    }
    nextToken() {
        this.skipWhitespace();
        if (this.isAtEnd())
            return { type: TokenType.EOF, value: '', line: this.line };
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
                case 'true': return { type: TokenType.True, value: ident, line: this.line };
                case 'false': return { type: TokenType.False, value: ident, line: this.line };
                case 'null': return { type: TokenType.Null, value: ident, line: this.line };
                default: return { type: TokenType.Identifier, value: ident, line: this.line };
            }
        }
        if (/[0-9]/.test(c)) {
            let num = c;
            while (/[0-9.]/.test(this.peek())) {
                num += this.advance();
            }
            return { type: TokenType.Number, value: num, line: this.line };
        }
        if (c === '"') {
            let str = '';
            while (this.peek() !== '"' && !this.isAtEnd()) {
                str += this.advance();
            }
            this.advance(); // consume closing quote
            return { type: TokenType.String, value: str, line: this.line };
        }
        switch (c) {
            case '+': return { type: TokenType.Plus, value: c, line: this.line };
            case '-': return { type: TokenType.Minus, value: c, line: this.line };
            case '*': return { type: TokenType.Star, value: c, line: this.line };
            case '/': return { type: TokenType.Slash, value: c, line: this.line };
            case '(': return { type: TokenType.LParen, value: c, line: this.line };
            case ')': return { type: TokenType.RParen, value: c, line: this.line };
            case '{': return { type: TokenType.LBrace, value: c, line: this.line };
            case '}': return { type: TokenType.RBrace, value: c, line: this.line };
            case ',': return { type: TokenType.Comma, value: c, line: this.line };
            case ';': return { type: TokenType.Semi, value: c, line: this.line };
            case '=':
                if (this.peek() === '=') {
                    this.advance();
                    return { type: TokenType.EqEq, value: '==', line: this.line };
                }
                return { type: TokenType.Eq, value: c, line: this.line };
            case '<': return { type: TokenType.Lt, value: c, line: this.line };
            case '>': return { type: TokenType.Gt, value: c, line: this.line };
        }
        throw new Error(`Unexpected character '${c}' at line ${this.line}`);
    }
}
//# sourceMappingURL=lexer.js.map