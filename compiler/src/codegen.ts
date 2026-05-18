import { Program, Statement, Expression, Node } from './parser';

import { OpCode } from './opcodes';

export class CodeGenerator {
    private code: number[] = [];
    private locals: Map<string, number> = new Map();
    private functions: Map<string, number> = new Map();
    private functionBodies: Statement[] = [];
    private unresolvedCalls: { offset: number, name: string }[] = [];
    private opcodeMap: Uint8Array = new Uint8Array(256);
    private invertedMap: Uint8Array = new Uint8Array(256);
    private currentJunkThreshold: number = 0.3;
    private dummyVariables: string[] = [];

    public generate(program: Program): { code: Uint8Array, opcodeMap: Uint8Array } {
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

        // Initialise array of diversified dummy variables to defeat taint tracking
        for (let i = 0; i < 7; i++) {
            const name = `_mba_dummy_${i}`;
            this.dummyVariables.push(name);
            this.emit(OpCode.PushInt, Math.floor(Math.random() * 256));
            this.emit(OpCode.StoreLocal, this.resolveLocal(name));
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
        
        const finalCode = new Uint8Array(this.code.length);
        finalCode.set(this.code, 0);

        return { code: finalCode, opcodeMap: this.invertedMap };
    }

    private emit(op: OpCode, ...operands: number[]) {
        // Map the internal opcode to the randomised byte
        this.code.push(this.opcodeMap[op]);
        for (const operand of operands) {
            // operand is always 32-bit little endian
            this.code.push(operand & 0xFF);
            this.code.push((operand >> 8) & 0xFF);
            this.code.push((operand >> 16) & 0xFF);
            this.code.push((operand >> 24) & 0xFF);
        }
    }

    private emitFloat(value: number) {
        this.code.push(this.opcodeMap[OpCode.PushFloat]);
        const arr = new Float64Array(1);
        arr[0] = value;
        const bytes = new Uint8Array(arr.buffer);
        for (let i = 0; i < 8; i++) {
            this.code.push(bytes[i]);
        }
    }

    private emitString(value: string) {
        this.code.push(this.opcodeMap[OpCode.PushString]);
        const encoder = new TextEncoder();
        const bytes = encoder.encode(value);
        
        // Emit 4-byte random nonce
        const nonce = new Uint8Array(4);
        for (let i = 0; i < 4; i++) {
            nonce[i] = Math.floor(Math.random() * 256);
            this.code.push(nonce[i]);
        }
        
        this.code.push(bytes.length & 0xFF);
        this.code.push((bytes.length >> 8) & 0xFF);
        this.code.push((bytes.length >> 16) & 0xFF);
        this.code.push((bytes.length >> 24) & 0xFF);
        
        // Write string bytes in plaintext (scrambler.ts will XOR-encrypt them using the 32-byte session key)
        for (let i = 0; i < bytes.length; i++) {
            this.code.push(bytes[i]);
        }
    }

    private resolveLocal(name: string): number {
        if (!this.locals.has(name)) {
            this.locals.set(name, this.locals.size);
        }
        return this.locals.get(name)!;
    }

    private getDummyVariable(): string {
        return this.dummyVariables[Math.floor(Math.random() * this.dummyVariables.length)];
    }

    private emitJunk() {
        if (Math.random() > this.currentJunkThreshold) return; // Randomised chance per function
        
        // AST Path Distribution Pollution
        // Inserting context-aware, semantically valid structures mimicking actual logic 
        // (rather than pure anomaly Push/Pop sequences) poisons ML classifiers that fingerprint WebAssembly binaries based on AST path frequency.
        // See WasmWalker: Path-based Code Representations for Improved WebAssembly Program Analysis, arxiv.org/abs/2410.08517.
        const dummy = this.getDummyVariable();
        
        // Opaque predicate: (x * x + x) & 1 == 0 is always true
        const x = Math.floor(Math.random() * 100);
        this.emit(OpCode.PushInt, x);
        this.emit(OpCode.Dup);
        this.emit(OpCode.Dup);
        
        this.emit(OpCode.Mul);
        this.emit(OpCode.Add);
        this.emit(OpCode.PushInt, 1);
        this.emit(OpCode.BitAnd);
        
        this.emit(OpCode.PushInt, 0);
        this.emit(OpCode.Eq);
        
        const jumpIfOff = this.code.length;
        this.emit(OpCode.JumpIf, 0); // Jump past junk if true (always)
        
        // Dead code block (Context-aware AST path targeting rare opcodes)
        if (dummy) {
            const dummyIdx = this.resolveLocal(dummy);
            this.emit(OpCode.LoadLocal, dummyIdx);
            this.emit(OpCode.PushInt, Math.floor(Math.random() * 256));
            
            // Actively target underrepresented opcodes to flatten the ML distribution profile
            const rareOps = [
                OpCode.BitXor, OpCode.BitOr, OpCode.Shr, OpCode.Shl, 
                OpCode.Gt, OpCode.Lt, OpCode.Eq, OpCode.Neq
            ];
            const rareOp = rareOps[Math.floor(Math.random() * rareOps.length)];
            this.emit(rareOp);
            
            this.emit(OpCode.StoreLocal, dummyIdx); // Fake store back (never executes)
        } else {
            // Fake arithmetic targeting List and hashing ops which are statistically rare
            this.emit(OpCode.NewList);
            this.emit(OpCode.PushInt, 456);
            this.emit(OpCode.ListPush);
            this.emit(OpCode.Hash256);
            this.emit(OpCode.Pop);
        }
        
        this.patchJump(jumpIfOff + 1, this.code.length);
    }

    private visitStatement(stmt: Statement) {
        this.emitJunk();

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
                        this.emitString(propName);
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
                    this.emit(OpCode.PushNull);
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
                // Randomise junk emission rate per function (10% to 50%) to defeat statistical profiling
                this.currentJunkThreshold = 0.1 + Math.random() * 0.4;
                
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
                    this.emit(OpCode.PushNull);
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
                if (typeof expr.value === 'number') {
                    if (Number.isInteger(expr.value)) {
                        this.emit(OpCode.PushInt, expr.value);
                    } else {
                        this.emitFloat(expr.value);
                    }
                } else if (typeof expr.value === 'string') {
                    this.emitString(expr.value);
                } else if (typeof expr.value === 'boolean') {
                    this.emit(OpCode.PushBool, expr.value ? 1 : 0);
                } else if (expr.value === null) {
                    this.emit(OpCode.PushNull);
                }
                break;
            case 'Identifier':
                this.emit(OpCode.LoadLocal, this.resolveLocal(expr.name));
                break;
            case 'BinaryExpression':
                if (expr.operator === '+' || expr.operator === '-') {
                    this.visitExpression(expr.left);
                    this.visitExpression(expr.right);
                    
                    const tmpRight = `_mba_r_${Math.floor(Math.random() * 1000000)}`;
                    const tmpLeft = `_mba_l_${Math.floor(Math.random() * 1000000)}`;
                    
                    this.emit(OpCode.StoreLocal, this.resolveLocal(tmpRight));
                    this.emit(OpCode.StoreLocal, this.resolveLocal(tmpLeft));
                    
                    const dummy = this.getDummyVariable();
                    
                    if (expr.operator === '+') {
                        // Polynomial MBA & Domain Expansion
                        // We upgrade from linear MBA to Polynomial MBA to artificially expand the mathematical domain size via data-dependent dummy variables.
                        // This defeats advanced linear solvers (SiMBA: Efficient Deobfuscation of Linear Mixed Boolean-Arithmetic Expressions, arxiv.org/abs/2209.06335)
                        // and truth-table neural extraction attacks (gMBA: Expression Semantic Guided Mixed Boolean-Arithmetic Deobfuscation Using Transformer Architectures, arxiv.org/abs/2506.23634).
                        
                        // (x ^ y)
                        this.emit(OpCode.LoadLocal, this.resolveLocal(tmpLeft));
                        this.emit(OpCode.LoadLocal, this.resolveLocal(tmpRight));
                        this.emit(OpCode.BitXor);
                        
                        // ((x & y) << 1)
                        this.emit(OpCode.LoadLocal, this.resolveLocal(tmpLeft));
                        this.emit(OpCode.LoadLocal, this.resolveLocal(tmpRight));
                        this.emit(OpCode.BitAnd);
                        this.emit(OpCode.PushInt, 1);
                        this.emit(OpCode.Shl);
                        
                        this.emit(OpCode.Add);
                        
                        if (dummy) {
                            // + ((z * z + z) & 1) * x  ==> Adds 0, but creates polynomial data dependency on 'z'
                            this.emit(OpCode.LoadLocal, this.resolveLocal(dummy));
                            this.emit(OpCode.Dup);
                            this.emit(OpCode.LoadLocal, this.resolveLocal(dummy));
                            this.emit(OpCode.Mul); // z * z
                            this.emit(OpCode.Add); // z * z + z
                            this.emit(OpCode.PushInt, 1);
                            this.emit(OpCode.BitAnd); // (z * z + z) & 1 -> 0
                            
                            this.emit(OpCode.LoadLocal, this.resolveLocal(tmpLeft));
                            this.emit(OpCode.Mul); // 0 * x -> 0
                            this.emit(OpCode.Add); // Add 0 to result
                        }
                    } else if (expr.operator === '-') {
                        // x - y == (x ^ ~y) + 2 * (x & ~y) + 1
                        this.emit(OpCode.LoadLocal, this.resolveLocal(tmpLeft));
                        this.emit(OpCode.LoadLocal, this.resolveLocal(tmpRight));
                        this.emit(OpCode.BitNot);
                        this.emit(OpCode.BitXor);
                        
                        this.emit(OpCode.LoadLocal, this.resolveLocal(tmpLeft));
                        this.emit(OpCode.LoadLocal, this.resolveLocal(tmpRight));
                        this.emit(OpCode.BitNot);
                        this.emit(OpCode.BitAnd);
                        this.emit(OpCode.PushInt, 1);
                        this.emit(OpCode.Shl);
                        
                        this.emit(OpCode.Add);
                        
                        this.emit(OpCode.PushInt, 1);
                        this.emit(OpCode.Add);
                        
                        if (dummy) {
                            // - ((z * z + z) & 1) * y  ==> Subtracts 0, polynomial domain expansion
                            this.emit(OpCode.LoadLocal, this.resolveLocal(dummy));
                            this.emit(OpCode.Dup);
                            this.emit(OpCode.LoadLocal, this.resolveLocal(dummy));
                            this.emit(OpCode.Mul); // z * z
                            this.emit(OpCode.Add); // z * z + z
                            this.emit(OpCode.PushInt, 1);
                            this.emit(OpCode.BitAnd); // 0
                            
                            this.emit(OpCode.LoadLocal, this.resolveLocal(tmpRight));
                            this.emit(OpCode.Mul); // 0 * y -> 0
                            this.emit(OpCode.Sub); // Sub 0 from result
                        }
                    }
                } else {
                    this.visitExpression(expr.left);
                    this.visitExpression(expr.right);
                    switch (expr.operator) {
                        case '*': 
                            if (Math.random() > 0.5) {
                                this.emit(OpCode.SwapAndMul);
                            } else if (Math.random() > 0.5) {
                                this.emit(OpCode.PushInt, 0); // false condition
                                this.emit(OpCode.JumpAndMul, 0); // dummy target
                            } else {
                                this.emit(OpCode.Mul);
                                // Structural Linear MBA Padding
                                // While not a full polynomial substitution, deriving the +0 padding from a randomised dummy slot 
                                // pollutes static taint tracking by artificially linking the operation to a disjoint memory region.
                                const dummy = this.getDummyVariable();
                                this.emit(OpCode.LoadLocal, this.resolveLocal(dummy));
                                this.emit(OpCode.Dup);
                                this.emit(OpCode.Sub); // dummy - dummy = 0
                                this.emit(OpCode.Add); // val + 0
                            }
                            break;
                        case '/': 
                            this.emit(OpCode.Div);
                            // Linear MBA: Add 0
                            const dummyDiv = this.getDummyVariable();
                            this.emit(OpCode.LoadLocal, this.resolveLocal(dummyDiv));
                            this.emit(OpCode.Dup);
                            this.emit(OpCode.Sub);
                            this.emit(OpCode.Add);
                            break;
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
                    } else if (expr.callee.name === 'concat') {
                        // expects 2 arguments
                        this.emit(OpCode.Concat);
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
                    this.emitString(keyName);
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
                    this.emitString(propName);
                }
                this.emit(OpCode.GetMember);
                break;
            case 'UpdateExpression':
                // simple desugaring: fetch, push 1, op, store
                // wait, if it's i++, it modifies i but returns the original value?
                // we'll implement it as ++i semantics (returns new value) for simplicity since we don't have temporary registers
                if (expr.argument.type === 'Identifier') {
                    this.emit(OpCode.LoadLocal, this.resolveLocal(expr.argument.name));
                    this.emit(OpCode.PushInt, 1);
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
