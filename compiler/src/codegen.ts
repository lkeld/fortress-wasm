import { Program, Statement, Expression, Node } from './parser';

export enum OpCode {
    Push        = 0x01,
    Pop         = 0x02,
    Dup         = 0x03,
    LoadLocal   = 0x10,
    StoreLocal  = 0x11,
    Add         = 0x20,
    Sub         = 0x21,
    Mul         = 0x22,
    Div         = 0x23,
    Eq          = 0x30,
    Neq         = 0x31,
    Lt          = 0x32,
    Gt          = 0x33,
    Lte         = 0x34,
    Gte         = 0x35,
    And         = 0x40,
    Or          = 0x41,
    Not         = 0x42,
    Jump        = 0x50,
    JumpIf      = 0x51,
    JumpIfNot   = 0x52,
    NewObject   = 0x60,
    SetField    = 0x61,
    GetField    = 0x62,
    NewList     = 0x63,
    ListPush    = 0x64,
    GetMember   = 0x65,
    SetMember   = 0x66,
    Length      = 0x67,
    Hash256     = 0x68,
    EncryptAES  = 0x69,
    JSONStringify = 0x6A,
    Call        = 0x70,
    Return      = 0x71,
    CallNative  = 0x80,
    Halt        = 0xFF,
}

export class CodeGenerator {
    private code: number[] = [];
    private constants: any[] = [];
    private locals: Map<string, number> = new Map();
    private functions: Map<string, number> = new Map();
    private functionBodies: Statement[] = [];
    private unresolvedCalls: { offset: number, name: string }[] = [];
    private opcodeMap: Uint8Array = new Uint8Array(256);
    private invertedMap: Uint8Array = new Uint8Array(256);

    public generate(program: Program): { code: Uint8Array, constants: string, opcodeMap: Uint8Array } {
        // Generate random OpCode mapping
        for (let i = 0; i < 256; i++) {
            this.opcodeMap[i] = i;
        }
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const temp = this.opcodeMap[i];
            this.opcodeMap[i] = this.opcodeMap[j];
            this.opcodeMap[j] = temp;
        }
        for (let i = 0; i < 256; i++) {
            this.invertedMap[this.opcodeMap[i]] = i;
        }

        for (const stmt of program.body) {
            if (stmt.type === 'FunctionDeclaration') {
                this.functionBodies.push(stmt);
                // Pre-assign a dummy address, will be overwritten when emitting
                this.functions.set(stmt.name.name, 0); 
            } else {
                this.visitStatement(stmt);
            }
        }
        
        this.emit(OpCode.Halt);
        
        // Emit functions after the main program
        for (const funcStmt of this.functionBodies) {
            this.visitStatement(funcStmt);
        }
        
        // Patch all unresolved function calls
        for (const call of this.unresolvedCalls) {
            const target = this.functions.get(call.name);
            if (target === undefined || target === 0) { // 0 is dummy
                throw new Error(`Function ${call.name} not found`);
            }
            this.patchJump(call.offset, target);
        }
        
        const constantsJsonStr = JSON.stringify(this.constants);
        const xorKey = Math.floor(Math.random() * 256);
        const obfuscatedConstants = Array.from(constantsJsonStr)
            .map(char => (char.charCodeAt(0) ^ xorKey).toString(16).padStart(2, '0'))
            .join('');
            
        const finalPayload = xorKey.toString(16).padStart(2, '0') + obfuscatedConstants;
            
        const finalCode = new Uint8Array(this.code.length);
        finalCode.set(this.code, 0);
        return { code: finalCode, constants: finalPayload, opcodeMap: this.invertedMap };
    }

    private emit(op: OpCode, ...operands: number[]) {
        // Map the internal opcode to the randomized byte
        this.code.push(this.opcodeMap[op]);
        for (const operand of operands) {
            // operand is always 32-bit little endian
            this.code.push(operand & 0xFF);
            this.code.push((operand >> 8) & 0xFF);
            this.code.push((operand >> 16) & 0xFF);
            this.code.push((operand >> 24) & 0xFF);
        }
    }

    private addConstant(value: any): number {
        const idx = this.constants.findIndex(c => c === value);
        if (idx !== -1) return idx;
        this.constants.push(value);
        return this.constants.length - 1;
    }

    private resolveLocal(name: string): number {
        if (!this.locals.has(name)) {
            this.locals.set(name, this.locals.size);
        }
        return this.locals.get(name)!;
    }

    private visitStatement(stmt: Statement) {
        switch (stmt.type) {
            case 'LetStatement':
                this.visitExpression(stmt.value);
                this.emit(OpCode.StoreLocal, this.resolveLocal(stmt.name.name));
                break;
            case 'AssignStatement':
                if (stmt.left.type === 'Identifier') {
                    this.visitExpression(stmt.value);
                    this.emit(OpCode.StoreLocal, this.resolveLocal(stmt.left.name));
                } else if (stmt.left.type === 'MemberExpression') {
                    this.visitExpression(stmt.left.object);
                    if (stmt.left.computed) {
                        this.visitExpression(stmt.left.property);
                    } else {
                        const propName = (stmt.left.property as any).name;
                        this.emit(OpCode.Push, this.addConstant(propName));
                    }
                    this.visitExpression(stmt.value);
                    this.emit(OpCode.SetMember);
                    this.emit(OpCode.Pop); // SetMember leaves target on stack, statement should clean it up
                }
                break;
            case 'ExpressionStatement':
                this.visitExpression(stmt.expression);
                this.emit(OpCode.Pop);
                break;
            case 'ReturnStatement':
                if (stmt.value) {
                    this.visitExpression(stmt.value);
                } else {
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
            case 'WhileStatement':
                const loopStart = this.code.length;
                this.visitExpression(stmt.condition);
                const jumpOutOff = this.code.length;
                this.emit(OpCode.JumpIfNot, 0);
                this.visitStatement(stmt.body);
                this.emit(OpCode.Jump, loopStart);
                this.patchJump(jumpOutOff + 1, this.code.length);
                break;
            case 'ForStatement':
                if (stmt.init) this.visitStatement(stmt.init);
                const forLoopStart = this.code.length;
                let forJumpOutOff = -1;
                if (stmt.condition) {
                    this.visitExpression(stmt.condition);
                    forJumpOutOff = this.code.length;
                    this.emit(OpCode.JumpIfNot, 0);
                }
                this.visitStatement(stmt.body);
                if (stmt.update) {
                    this.visitExpression(stmt.update);
                    this.emit(OpCode.Pop); // Update is an expression evaluated for side effects
                }
                this.emit(OpCode.Jump, forLoopStart);
                if (forJumpOutOff !== -1) {
                    this.patchJump(forJumpOutOff + 1, this.code.length);
                }
                break;
            case 'BlockStatement':
                for (const bStmt of stmt.body) {
                    this.visitStatement(bStmt);
                }
                break;
            case 'FunctionDeclaration':
                // Record the function's start address
                this.functions.set(stmt.name.name, this.code.length);
                // Assign parameters to locals
                stmt.params.forEach((param, index) => {
                    this.locals.set(param.name, index);
                });
                
                // We emit the function body
                for (const bStmt of stmt.body.body) {
                    this.visitStatement(bStmt);
                }
                
                // Ensure a return at the end of the function if not present
                if (this.code[this.code.length - 1] !== OpCode.Return) {
                    this.emit(OpCode.Push, this.addConstant(null));
                    this.emit(OpCode.Return);
                }
                break;
        }
    }

    private patchJump(offset: number, target: number) {
        this.code[offset] = target & 0xFF;
        this.code[offset + 1] = (target >> 8) & 0xFF;
        this.code[offset + 2] = (target >> 16) & 0xFF;
        this.code[offset + 3] = (target >> 24) & 0xFF;
    }

    private visitExpression(expr: Expression) {
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
                    case '+': this.emit(OpCode.Add); break;
                    case '-': this.emit(OpCode.Sub); break;
                    case '*': this.emit(OpCode.Mul); break;
                    case '/': this.emit(OpCode.Div); break;
                    case '==': this.emit(OpCode.Eq); break;
                    case '<': this.emit(OpCode.Lt); break;
                    case '>': this.emit(OpCode.Gt); break;
                    case '<=': this.emit(OpCode.Lte); break;
                    case '>=': this.emit(OpCode.Gte); break;
                    case '!=': this.emit(OpCode.Neq); break;
                    case '&&': this.emit(OpCode.And); break;
                    case '||': this.emit(OpCode.Or); break;
                    default: throw new Error(`Unsupported operator ${expr.operator}`);
                }
                break;
            case 'CallExpression':
                // Simple implementation: args are pushed to the stack
                for (const arg of expr.arguments) {
                    this.visitExpression(arg);
                }
                
                if (expr.callee.type === 'Identifier') {
                    if (expr.callee.name === 'len') {
                        // expects 1 argument
                        this.emit(OpCode.Length);
                    } else if (expr.callee.name === 'hash256') {
                        // expects 1 argument
                        this.emit(OpCode.Hash256);
                    } else if (expr.callee.name === 'encrypt_aes') {
                        // expects 2 arguments
                        this.emit(OpCode.EncryptAES);
                    } else if (expr.callee.name === 'json_stringify') {
                        // expects 1 argument
                        this.emit(OpCode.JSONStringify);
                    } else if (expr.callee.name === '__native_call') {
                        // expects id, arg_count
                        this.emit(OpCode.CallNative);
                    } else {
                        // We emit the Call instruction with a dummy 0 target, and remember to patch it later
                        this.emit(OpCode.Call, 0);
                        const patchOffset = this.code.length - 4; // The target operand is the last 4 bytes
                        this.unresolvedCalls.push({ offset: patchOffset, name: expr.callee.name });
                        
                        // Operand 2: arg count
                        this.code.push(expr.arguments.length & 0xFF);
                        this.code.push((expr.arguments.length >> 8) & 0xFF);
                        this.code.push((expr.arguments.length >> 16) & 0xFF);
                        this.code.push((expr.arguments.length >> 24) & 0xFF);
                    }
                } else {
                    throw new Error("Only direct function calls are supported");
                }
                break;
            case 'ArrayExpression':
                this.emit(OpCode.NewList);
                for (const element of expr.elements) {
                    this.visitExpression(element);
                    this.emit(OpCode.ListPush);
                }
                break;
            case 'ObjectExpression':
                this.emit(OpCode.NewObject);
                for (const prop of expr.properties) {
                    const keyName = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
                    this.emit(OpCode.Push, this.addConstant(keyName));
                    this.visitExpression(prop.value);
                    this.emit(OpCode.SetMember);
                }
                break;
            case 'MemberExpression':
                this.visitExpression(expr.object);
                if (expr.computed) {
                    this.visitExpression(expr.property);
                } else {
                    const propName = (expr.property as any).name;
                    this.emit(OpCode.Push, this.addConstant(propName));
                }
                this.emit(OpCode.GetMember);
                break;
            case 'UpdateExpression':
                // simple desugaring: fetch, push 1, op, store
                // wait, if it's i++, it modifies i but returns the original value?
                // we'll implement it as ++i semantics (returns new value) for simplicity since we don't have temporary registers
                if (expr.argument.type === 'Identifier') {
                    this.emit(OpCode.LoadLocal, this.resolveLocal(expr.argument.name));
                    this.emit(OpCode.Push, this.addConstant(1));
                    this.emit(expr.operator === '++' ? OpCode.Add : OpCode.Sub);
                    this.emit(OpCode.Dup); // keep value on stack
                    this.emit(OpCode.StoreLocal, this.resolveLocal(expr.argument.name));
                } else if (expr.argument.type === 'MemberExpression') {
                    // This is much harder to desugar properly without duplicating evaluation of the object/property.
                    // For now, we evaluate obj and prop, get member, add 1, then we have to set member which needs obj and prop again!
                    // This is too complex for this simple compiler without duping deep stack. We'll leave it as unsupported or partial support for locals only.
                    throw new Error("Update expressions on members are currently unsupported.");
                } else {
                    throw new Error("Invalid left-hand side expression in update operation");
                }
                break;
        }
    }
}
