import { Program, Statement, Expression, Node } from './parser';
export var OpCode;
(function (OpCode) {
    OpCode[OpCode["Push"] = 1] = "Push";
    OpCode[OpCode["Pop"] = 2] = "Pop";
    OpCode[OpCode["Dup"] = 3] = "Dup";
    OpCode[OpCode["LoadLocal"] = 16] = "LoadLocal";
    OpCode[OpCode["StoreLocal"] = 17] = "StoreLocal";
    OpCode[OpCode["AddInt"] = 32] = "AddInt";
    OpCode[OpCode["SubInt"] = 33] = "SubInt";
    OpCode[OpCode["MulInt"] = 34] = "MulInt";
    OpCode[OpCode["DivInt"] = 35] = "DivInt";
    OpCode[OpCode["AddFloat"] = 36] = "AddFloat";
    OpCode[OpCode["SubFloat"] = 37] = "SubFloat";
    OpCode[OpCode["MulFloat"] = 38] = "MulFloat";
    OpCode[OpCode["DivFloat"] = 39] = "DivFloat";
    OpCode[OpCode["Eq"] = 48] = "Eq";
    OpCode[OpCode["Neq"] = 49] = "Neq";
    OpCode[OpCode["Lt"] = 50] = "Lt";
    OpCode[OpCode["Gt"] = 51] = "Gt";
    OpCode[OpCode["Lte"] = 52] = "Lte";
    OpCode[OpCode["Gte"] = 53] = "Gte";
    OpCode[OpCode["Jump"] = 80] = "Jump";
    OpCode[OpCode["JumpIf"] = 81] = "JumpIf";
    OpCode[OpCode["JumpIfNot"] = 82] = "JumpIfNot";
    OpCode[OpCode["Call"] = 112] = "Call";
    OpCode[OpCode["Return"] = 113] = "Return";
    OpCode[OpCode["CallNative"] = 128] = "CallNative";
    OpCode[OpCode["Halt"] = 255] = "Halt";
})(OpCode || (OpCode = {}));
export class CodeGenerator {
    code = [];
    constants = [];
    locals = new Map();
    generate(program) {
        for (const stmt of program.body) {
            this.visitStatement(stmt);
        }
        this.emit(OpCode.Halt);
        return {
            code: new Uint8Array(this.code),
            constants: JSON.stringify(this.constants)
        };
    }
    emit(opcode, operand) {
        this.code.push(opcode);
        if (operand !== undefined) {
            // operand is always 32-bit little endian
            this.code.push(operand & 0xFF);
            this.code.push((operand >> 8) & 0xFF);
            this.code.push((operand >> 16) & 0xFF);
            this.code.push((operand >> 24) & 0xFF);
        }
    }
    addConstant(value) {
        const idx = this.constants.findIndex(c => c === value);
        if (idx !== -1)
            return idx;
        this.constants.push(value);
        return this.constants.length - 1;
    }
    resolveLocal(name) {
        if (!this.locals.has(name)) {
            this.locals.set(name, this.locals.size);
        }
        return this.locals.get(name);
    }
    visitStatement(stmt) {
        switch (stmt.type) {
            case 'LetStatement':
                this.visitExpression(stmt.value);
                this.emit(OpCode.StoreLocal, this.resolveLocal(stmt.name.name));
                break;
            case 'ExpressionStatement':
                this.visitExpression(stmt.expression);
                this.emit(OpCode.Pop);
                break;
            case 'ReturnStatement':
                if (stmt.value) {
                    this.visitExpression(stmt.value);
                }
                else {
                    this.emit(OpCode.Push, this.addConstant(null));
                }
                this.emit(OpCode.Return);
                break;
            case 'IfStatement':
                this.visitExpression(stmt.condition);
                // Placeholder jump instruction
                const jumpIfOff = this.code.length;
                this.emit(OpCode.JumpIfNot, 0); // Jump past consequent if condition is false
                for (const bStmt of stmt.consequent.body) {
                    this.visitStatement(bStmt);
                }
                const jumpOff = this.code.length;
                if (stmt.alternate) {
                    this.emit(OpCode.Jump, 0); // Jump past alternate
                }
                // Patch the JumpIfNot
                const consequentEnd = this.code.length;
                this.patchJump(jumpIfOff + 1, consequentEnd);
                if (stmt.alternate) {
                    for (const aStmt of stmt.alternate.body) {
                        this.visitStatement(aStmt);
                    }
                    this.patchJump(jumpOff + 1, this.code.length);
                }
                break;
            case 'BlockStatement':
                for (const bStmt of stmt.body) {
                    this.visitStatement(bStmt);
                }
                break;
            case 'FunctionDeclaration':
                // For simplicity in this early version, we don't fully support functions inside the bytecode yet.
                // It requires handling scopes, function tables, etc.
                throw new Error("Functions are not yet implemented in Codegen.");
        }
    }
    patchJump(offset, target) {
        this.code[offset] = target & 0xFF;
        this.code[offset + 1] = (target >> 8) & 0xFF;
        this.code[offset + 2] = (target >> 16) & 0xFF;
        this.code[offset + 3] = (target >> 24) & 0xFF;
    }
    visitExpression(expr) {
        switch (expr.type) {
            case 'Literal':
                const constIdx = this.addConstant(expr.value);
                this.emit(OpCode.Push, constIdx);
                break;
            case 'Identifier':
                this.emit(OpCode.LoadLocal, this.resolveLocal(expr.name));
                break;
            case 'BinaryExpression':
                this.visitExpression(expr.left);
                this.visitExpression(expr.right);
                switch (expr.operator) {
                    case '+':
                        this.emit(OpCode.AddInt);
                        break;
                    case '-':
                        this.emit(OpCode.SubInt);
                        break;
                    case '*':
                        this.emit(OpCode.MulInt);
                        break;
                    case '/':
                        this.emit(OpCode.DivInt);
                        break;
                    case '==':
                        this.emit(OpCode.Eq);
                        break;
                    case '<':
                        this.emit(OpCode.Lt);
                        break;
                    case '>':
                        this.emit(OpCode.Gt);
                        break;
                    default: throw new Error(`Unsupported operator ${expr.operator}`);
                }
                break;
            case 'CallExpression':
                throw new Error("Call is not yet implemented");
        }
    }
}
//# sourceMappingURL=codegen.js.map