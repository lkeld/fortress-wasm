"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Lexer = exports.TokenType = void 0;
var TokenType;
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
    TokenType[TokenType["While"] = 11] = "While";
    TokenType[TokenType["For"] = 12] = "For";
    TokenType[TokenType["Plus"] = 13] = "Plus";
    TokenType[TokenType["Minus"] = 14] = "Minus";
    TokenType[TokenType["PlusPlus"] = 15] = "PlusPlus";
    TokenType[TokenType["MinusMinus"] = 16] = "MinusMinus";
    TokenType[TokenType["Star"] = 17] = "Star";
    TokenType[TokenType["Slash"] = 18] = "Slash";
    TokenType[TokenType["EqEq"] = 19] = "EqEq";
    TokenType[TokenType["NotEq"] = 20] = "NotEq";
    TokenType[TokenType["Eq"] = 21] = "Eq";
    TokenType[TokenType["Lt"] = 22] = "Lt";
    TokenType[TokenType["LtEq"] = 23] = "LtEq";
    TokenType[TokenType["Gt"] = 24] = "Gt";
    TokenType[TokenType["GtEq"] = 25] = "GtEq";
    TokenType[TokenType["AndAnd"] = 26] = "AndAnd";
    TokenType[TokenType["OrOr"] = 27] = "OrOr";
    TokenType[TokenType["Not"] = 28] = "Not";
    TokenType[TokenType["LParen"] = 29] = "LParen";
    TokenType[TokenType["RParen"] = 30] = "RParen";
    TokenType[TokenType["LBrace"] = 31] = "LBrace";
    TokenType[TokenType["RBrace"] = 32] = "RBrace";
    TokenType[TokenType["Comma"] = 33] = "Comma";
    TokenType[TokenType["Semi"] = 34] = "Semi";
    TokenType[TokenType["Dot"] = 35] = "Dot";
    TokenType[TokenType["Colon"] = 36] = "Colon";
    TokenType[TokenType["LBracket"] = 37] = "LBracket";
    TokenType[TokenType["RBracket"] = 38] = "RBracket";
    TokenType[TokenType["StrictEq"] = 39] = "StrictEq";
    TokenType[TokenType["StrictNeq"] = 40] = "StrictNeq";
    TokenType[TokenType["EOF"] = 41] = "EOF";
})(TokenType || (exports.TokenType = TokenType = {}));
var Lexer = /** @class */ (function () {
    function Lexer(source) {
        this.position = 0;
        this.line = 1;
        this.source = source;
    }
    Lexer.prototype.advance = function () {
        return this.source[this.position++] || '\0';
    };
    Lexer.prototype.peek = function () {
        if (this.isAtEnd())
            return '\0';
        return this.source[this.position] || '\0';
    };
    Lexer.prototype.isAtEnd = function () {
        return this.position >= this.source.length;
    };
    Lexer.prototype.skipWhitespace = function () {
        while (!this.isAtEnd()) {
            var c = this.peek();
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
            else if (c === '/' && this.source[this.position + 1] === '*') {
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
            }
            else {
                break;
            }
        }
    };
    Lexer.prototype.nextToken = function () {
        this.skipWhitespace();
        if (this.isAtEnd())
            return { type: TokenType.EOF, value: '', line: this.line };
        var c = this.advance();
        if (/[a-zA-Z_]/.test(c)) {
            var ident = c;
            while (/[a-zA-Z0-9_]/.test(this.peek())) {
                ident += this.advance();
            }
            switch (ident) {
                case 'let': return { type: TokenType.Let, value: ident, line: this.line };
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
            var num = c;
            while (/[0-9.eE]/.test(this.peek())) {
                var nextChar = this.advance();
                num += nextChar;
                if ((nextChar === 'e' || nextChar === 'E') && (this.peek() === '+' || this.peek() === '-')) {
                    num += this.advance();
                }
            }
            return { type: TokenType.Number, value: num, line: this.line };
        }
        if (c === '"') {
            var str = '';
            while (this.peek() !== '"' && !this.isAtEnd()) {
                var nextChar = this.advance();
                if (nextChar === '\\' && !this.isAtEnd()) {
                    var esc = this.advance();
                    if (esc === 'n')
                        str += '\n';
                    else if (esc === 't')
                        str += '\t';
                    else if (esc === 'r')
                        str += '\r';
                    else
                        str += esc;
                }
                else {
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
                    if (this.peek() === '=') {
                        this.advance();
                        return { type: TokenType.StrictEq, value: '===', line: this.line };
                    }
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
                    if (this.peek() === '=') {
                        this.advance();
                        return { type: TokenType.StrictNeq, value: '!==', line: this.line };
                    }
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
        throw new Error("Unexpected character '".concat(c, "' at line ").concat(this.line));
    };
    return Lexer;
}());
exports.Lexer = Lexer;
