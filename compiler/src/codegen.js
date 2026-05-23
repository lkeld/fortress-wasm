"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodeGenerator = void 0;
var opcodes_1 = require("./opcodes");
var CodeGenerator = /** @class */ (function () {
    function CodeGenerator() {
        this.code = [];
        this.locals = new Map();
        this.localTypes = new Map();
        this.functions = new Map();
        this.functionBodies = [];
        this.unresolvedCalls = [];
        this.opcodeMap = new Uint8Array(256);
        this.invertedMap = new Uint8Array(256);
        this.currentJunkThreshold = 0.3;
        this.dummyVariables = [];
    }
    CodeGenerator.prototype.generate = function (program) {
        this.code = [];
        this.locals = new Map();
        this.localTypes = new Map();
        this.functions = new Map();
        this.functionBodies = [];
        this.unresolvedCalls = [];
        this.dummyVariables = [];
        // Generate random OpCode mapping
        for (var i = 0; i < 256; i++) {
            this.opcodeMap[i] = i;
        }
        for (var i = 255; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var temp = this.opcodeMap[i];
            this.opcodeMap[i] = this.opcodeMap[j];
            this.opcodeMap[j] = temp;
        }
        for (var i = 0; i < 256; i++) {
            this.invertedMap[this.opcodeMap[i]] = i;
        }
        // Initialise array of diversified dummy variables to defeat taint tracking
        for (var i = 0; i < 7; i++) {
            var name_1 = "_mba_dummy_".concat(i);
            this.dummyVariables.push(name_1);
            this.emit(opcodes_1.OpCode.PushInt, Math.floor(Math.random() * 256));
            this.emit(opcodes_1.OpCode.StoreLocal, this.resolveLocal(name_1));
        }
        for (var _i = 0, _a = program.body; _i < _a.length; _i++) {
            var stmt = _a[_i];
            if (stmt.type === 'FunctionDeclaration') {
                this.functionBodies.push(stmt);
                // Pre-assign a dummy address, will be overwritten when emitting
                this.functions.set(stmt.name.name, 0);
            }
            else {
                this.visitStatement(stmt);
            }
        }
        this.emit(opcodes_1.OpCode.Halt);
        // Emit functions after the main program
        for (var _b = 0, _c = this.functionBodies; _b < _c.length; _b++) {
            var funcStmt = _c[_b];
            this.visitStatement(funcStmt);
        }
        // Patch all unresolved function calls
        for (var _d = 0, _e = this.unresolvedCalls; _d < _e.length; _d++) {
            var call = _e[_d];
            var target = this.functions.get(call.name);
            if (target === undefined || target === 0) { // 0 is dummy
                throw new Error("Function ".concat(call.name, " not found"));
            }
            this.patchJump(call.offset, target);
        }
        var finalCode = new Uint8Array(this.code.length);
        finalCode.set(this.code, 0);
        return { code: finalCode, opcodeMap: this.invertedMap };
    };
    CodeGenerator.prototype.emit = function (op) {
        var operands = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            operands[_i - 1] = arguments[_i];
        }
        // Map the internal opcode to the randomised byte
        this.code.push(this.opcodeMap[op]);
        for (var _a = 0, operands_1 = operands; _a < operands_1.length; _a++) {
            var operand = operands_1[_a];
            // operand is always 32-bit little endian
            this.code.push(operand & 0xFF);
            this.code.push((operand >> 8) & 0xFF);
            this.code.push((operand >> 16) & 0xFF);
            this.code.push((operand >> 24) & 0xFF);
        }
    };
    CodeGenerator.prototype.emitFloat = function (value) {
        this.code.push(this.opcodeMap[opcodes_1.OpCode.PushFloat]);
        var arr = new Float64Array(1);
        arr[0] = value;
        var bytes = new Uint8Array(arr.buffer);
        for (var i = 0; i < 8; i++) {
            this.code.push(bytes[i]);
        }
    };
    CodeGenerator.prototype.emitString = function (value) {
        this.code.push(this.opcodeMap[opcodes_1.OpCode.PushString]);
        var encoder = new TextEncoder();
        var bytes = encoder.encode(value);
        // Emit 4-byte random nonce
        var nonce = new Uint8Array(4);
        for (var i = 0; i < 4; i++) {
            nonce[i] = Math.floor(Math.random() * 256);
            this.code.push(nonce[i]);
        }
        this.code.push(bytes.length & 0xFF);
        this.code.push((bytes.length >> 8) & 0xFF);
        this.code.push((bytes.length >> 16) & 0xFF);
        this.code.push((bytes.length >> 24) & 0xFF);
        // Write string bytes in plaintext (scrambler.ts will XOR-encrypt them using the 32-byte session key)
        for (var i = 0; i < bytes.length; i++) {
            this.code.push(bytes[i]);
        }
    };
    CodeGenerator.prototype.resolveLocal = function (name) {
        if (!this.locals.has(name)) {
            this.locals.set(name, this.locals.size);
        }
        return this.locals.get(name);
    };
    CodeGenerator.prototype.isFloatExpression = function (expr) {
        if (!expr)
            return false;
        if (expr.type === 'Literal') {
            return typeof expr.value === 'number' && (expr.raw.includes('.') || !Number.isInteger(expr.value));
        }
        if (expr.type === 'Identifier') {
            var type = this.localTypes.get(expr.name);
            return type === 'float';
        }
        if (expr.type === 'BinaryExpression') {
            return this.isFloatExpression(expr.left) || this.isFloatExpression(expr.right);
        }
        return false;
    };
    CodeGenerator.prototype.isIntExpression = function (expr) {
        var _a;
        if (!expr)
            return false;
        if (expr.type === 'Literal') {
            return typeof expr.value === 'number' && Number.isInteger(expr.value) && !((_a = expr.raw) === null || _a === void 0 ? void 0 : _a.includes('.'));
        }
        if (expr.type === 'Identifier') {
            var type = this.localTypes.get(expr.name);
            return type === 'int';
        }
        if (expr.type === 'BinaryExpression') {
            return this.isIntExpression(expr.left) && this.isIntExpression(expr.right);
        }
        return false;
    };
    CodeGenerator.prototype.getDummyVariable = function () {
        return this.dummyVariables[Math.floor(Math.random() * this.dummyVariables.length)];
    };
    CodeGenerator.prototype.emitJunk = function () {
        if (process.env.DEV_MODE === 'true')
            return;
        if (Math.random() > this.currentJunkThreshold)
            return; // Randomised chance per function
        // AST Path Distribution Pollution
        // Inserting context-aware, semantically valid structures mimicking actual logic 
        // (rather than pure anomaly Push/Pop sequences) poisons ML classifiers that fingerprint WebAssembly binaries based on AST path frequency.
        // See WasmWalker: Path-based Code Representations for Improved WebAssembly Program Analysis, arxiv.org/abs/2410.08517.
        var dummy = this.getDummyVariable();
        // Opaque predicate: (x * x + x) & 1 == 0 is always true
        var x = Math.floor(Math.random() * 100);
        this.emit(opcodes_1.OpCode.PushInt, x);
        this.emit(opcodes_1.OpCode.Dup);
        this.emit(opcodes_1.OpCode.Dup);
        this.emit(opcodes_1.OpCode.Mul);
        this.emit(opcodes_1.OpCode.Add);
        this.emit(opcodes_1.OpCode.PushInt, 1);
        this.emit(opcodes_1.OpCode.BitAnd);
        this.emit(opcodes_1.OpCode.PushInt, 0);
        this.emit(opcodes_1.OpCode.Eq);
        var jumpIfOff = this.code.length;
        this.emit(opcodes_1.OpCode.JumpIf, 0); // Jump past junk if true (always)
        // Dead code block (Context-aware AST path targeting rare opcodes)
        if (dummy) {
            var dummyIdx = this.resolveLocal(dummy);
            this.emit(opcodes_1.OpCode.LoadLocal, dummyIdx);
            this.emit(opcodes_1.OpCode.PushInt, Math.floor(Math.random() * 256));
            // Actively target underrepresented opcodes to flatten the ML distribution profile
            var rareOps = [
                opcodes_1.OpCode.BitXor, opcodes_1.OpCode.BitOr, opcodes_1.OpCode.Shr, opcodes_1.OpCode.Shl,
                opcodes_1.OpCode.Gt, opcodes_1.OpCode.Lt, opcodes_1.OpCode.Eq, opcodes_1.OpCode.Neq
            ];
            var rareOp = rareOps[Math.floor(Math.random() * rareOps.length)];
            this.emit(rareOp);
            this.emit(opcodes_1.OpCode.StoreLocal, dummyIdx); // Fake store back (never executes)
        }
        else {
            // Fake arithmetic targeting List and hashing ops which are statistically rare
            this.emit(opcodes_1.OpCode.NewList);
            this.emit(opcodes_1.OpCode.PushInt, 456);
            this.emit(opcodes_1.OpCode.ListPush);
            this.emit(opcodes_1.OpCode.Hash256);
            this.emit(opcodes_1.OpCode.Pop);
        }
        this.patchJump(jumpIfOff + 1, this.code.length);
    };
    CodeGenerator.prototype.visitStatement = function (stmt) {
        var _this = this;
        this.emitJunk();
        switch (stmt.type) {
            case 'LetStatement':
                this.visitExpression(stmt.value);
                this.localTypes.set(stmt.name.name, this.isFloatExpression(stmt.value) ? 'float' : (this.isIntExpression(stmt.value) ? 'int' : 'any'));
                this.emit(opcodes_1.OpCode.StoreLocal, this.resolveLocal(stmt.name.name));
                break;
            case 'AssignStatement':
                if (stmt.left.type === 'Identifier') {
                    this.visitExpression(stmt.value);
                    this.localTypes.set(stmt.left.name, this.isFloatExpression(stmt.value) ? 'float' : (this.isIntExpression(stmt.value) ? 'int' : 'any'));
                    this.emit(opcodes_1.OpCode.StoreLocal, this.resolveLocal(stmt.left.name));
                }
                else if (stmt.left.type === 'MemberExpression') {
                    this.visitExpression(stmt.left.object);
                    if (stmt.left.computed) {
                        this.visitExpression(stmt.left.property);
                    }
                    else {
                        var propName = stmt.left.property.name;
                        this.emitString(propName);
                    }
                    this.visitExpression(stmt.value);
                    this.emit(opcodes_1.OpCode.SetMember);
                    this.emit(opcodes_1.OpCode.Pop); // SetMember leaves target on stack, statement should clean it up
                }
                break;
            case 'ExpressionStatement':
                this.visitExpression(stmt.expression);
                this.emit(opcodes_1.OpCode.Pop);
                break;
            case 'ReturnStatement':
                if (stmt.value) {
                    this.visitExpression(stmt.value);
                }
                else {
                    this.emit(opcodes_1.OpCode.PushNull);
                }
                this.emit(opcodes_1.OpCode.Return);
                break;
            case 'IfStatement':
                this.visitExpression(stmt.condition);
                // Placeholder jump instruction
                var jumpIfOff = this.code.length;
                this.emit(opcodes_1.OpCode.JumpIfNot, 0); // Jump past consequent if condition is false
                for (var _i = 0, _a = stmt.consequent.body; _i < _a.length; _i++) {
                    var bStmt = _a[_i];
                    this.visitStatement(bStmt);
                }
                var jumpOff = this.code.length;
                if (stmt.alternate) {
                    this.emit(opcodes_1.OpCode.Jump, 0); // Jump past alternate
                }
                // Patch the JumpIfNot
                var consequentEnd = this.code.length;
                this.patchJump(jumpIfOff + 1, consequentEnd);
                if (stmt.alternate) {
                    for (var _b = 0, _c = stmt.alternate.body; _b < _c.length; _b++) {
                        var aStmt = _c[_b];
                        this.visitStatement(aStmt);
                    }
                    this.patchJump(jumpOff + 1, this.code.length);
                }
                break;
            case 'WhileStatement':
                var loopStart = this.code.length;
                this.visitExpression(stmt.condition);
                var jumpOutOff = this.code.length;
                this.emit(opcodes_1.OpCode.JumpIfNot, 0);
                this.visitStatement(stmt.body);
                this.emit(opcodes_1.OpCode.Jump, loopStart);
                this.patchJump(jumpOutOff + 1, this.code.length);
                break;
            case 'ForStatement':
                if (stmt.init)
                    this.visitStatement(stmt.init);
                var forLoopStart = this.code.length;
                var forJumpOutOff = -1;
                if (stmt.condition) {
                    this.visitExpression(stmt.condition);
                    forJumpOutOff = this.code.length;
                    this.emit(opcodes_1.OpCode.JumpIfNot, 0);
                }
                this.visitStatement(stmt.body);
                if (stmt.update) {
                    this.visitExpression(stmt.update);
                    this.emit(opcodes_1.OpCode.Pop); // Update is an expression evaluated for side effects
                }
                this.emit(opcodes_1.OpCode.Jump, forLoopStart);
                if (forJumpOutOff !== -1) {
                    this.patchJump(forJumpOutOff + 1, this.code.length);
                }
                break;
            case 'BlockStatement':
                for (var _d = 0, _e = stmt.body; _d < _e.length; _d++) {
                    var bStmt = _e[_d];
                    this.visitStatement(bStmt);
                }
                break;
            case 'FunctionDeclaration':
                // Emit a Jump past the function body to avoid execution fall-through
                var jumpPastOffset = this.code.length;
                this.emit(opcodes_1.OpCode.Jump, 0);
                // Record the function's start address after the jump
                this.functions.set(stmt.name.name, this.code.length);
                // Randomise junk emission rate per function (10% to 50%) to defeat statistical profiling
                this.currentJunkThreshold = 0.1 + Math.random() * 0.4;
                // Save and isolate scope
                var savedLocals = this.locals;
                var savedLocalTypes = this.localTypes;
                this.locals = new Map();
                this.localTypes = new Map();
                // Assign parameters to locals
                var numParams_1 = stmt.params.length;
                stmt.params.forEach(function (param, index) {
                    _this.locals.set(param.name, index);
                    _this.localTypes.set(param.name, 'any');
                });
                // Map dummy variables starting from numParams to avoid collision and make them local
                this.dummyVariables.forEach(function (name, index) {
                    _this.locals.set(name, numParams_1 + index);
                    _this.localTypes.set(name, 'int');
                });
                // Initialize dummy variables at the beginning of each function declaration frame
                this.dummyVariables.forEach(function (name) {
                    var slot = _this.locals.get(name);
                    _this.emit(opcodes_1.OpCode.PushInt, Math.floor(Math.random() * 256));
                    _this.emit(opcodes_1.OpCode.StoreLocal, slot);
                });
                // We emit the function body
                for (var _f = 0, _g = stmt.body.body; _f < _g.length; _f++) {
                    var bStmt = _g[_f];
                    this.visitStatement(bStmt);
                }
                // Ensure a return at the end of the function if not present
                var hasExplicitReturn = stmt.body.body.length > 0 && stmt.body.body[stmt.body.body.length - 1].type === 'ReturnStatement';
                if (!hasExplicitReturn) {
                    this.emit(opcodes_1.OpCode.PushNull);
                    this.emit(opcodes_1.OpCode.Return);
                }
                // Patch the Jump to point past the entire function body (including its return sequence)
                this.patchJump(jumpPastOffset + 1, this.code.length);
                // Restore scope
                this.locals = savedLocals;
                this.localTypes = savedLocalTypes;
                break;
        }
    };
    CodeGenerator.prototype.patchJump = function (offset, target) {
        this.code[offset] = target & 0xFF;
        this.code[offset + 1] = (target >> 8) & 0xFF;
        this.code[offset + 2] = (target >> 16) & 0xFF;
        this.code[offset + 3] = (target >> 24) & 0xFF;
    };
    CodeGenerator.prototype.visitExpression = function (expr) {
        switch (expr.type) {
            case 'Literal':
                if (typeof expr.value === 'number') {
                    if (Number.isInteger(expr.value)) {
                        this.emit(opcodes_1.OpCode.PushInt, expr.value);
                    }
                    else {
                        this.emitFloat(expr.value);
                    }
                }
                else if (typeof expr.value === 'string') {
                    this.emitString(expr.value);
                }
                else if (typeof expr.value === 'boolean') {
                    this.emit(opcodes_1.OpCode.PushBool, expr.value ? 1 : 0);
                }
                else if (expr.value === null) {
                    this.emit(opcodes_1.OpCode.PushNull);
                }
                break;
            case 'Identifier':
                this.emit(opcodes_1.OpCode.LoadLocal, this.resolveLocal(expr.name));
                break;
            case 'BinaryExpression':
                if (expr.operator === '+' || expr.operator === '-') {
                    this.visitExpression(expr.left);
                    this.visitExpression(expr.right);
                    var isIntMath = this.isIntExpression(expr.left) && this.isIntExpression(expr.right);
                    var useMba = process.env.DEV_MODE !== 'true' && isIntMath;
                    if (!useMba) {
                        this.emit(expr.operator === '+' ? opcodes_1.OpCode.Add : opcodes_1.OpCode.Sub);
                        return;
                    }
                    var tmpRight = "_mba_temp_r";
                    var tmpLeft = "_mba_temp_l";
                    this.emit(opcodes_1.OpCode.StoreLocal, this.resolveLocal(tmpRight));
                    this.emit(opcodes_1.OpCode.StoreLocal, this.resolveLocal(tmpLeft));
                    var dummy = this.getDummyVariable();
                    if (expr.operator === '+') {
                        // Polynomial MBA & Domain Expansion
                        // We upgrade from linear MBA to Polynomial MBA to artificially expand the mathematical domain size via data-dependent dummy variables.
                        // This defeats advanced linear solvers (SiMBA: Efficient Deobfuscation of Linear Mixed Boolean-Arithmetic Expressions, arxiv.org/abs/2209.06335)
                        // and truth-table neural extraction attacks (gMBA: Expression Semantic Guided Mixed Boolean-Arithmetic Deobfuscation Using Transformer Architectures, arxiv.org/abs/2506.23634).
                        // (x ^ y)
                        this.emit(opcodes_1.OpCode.LoadLocal, this.resolveLocal(tmpLeft));
                        this.emit(opcodes_1.OpCode.LoadLocal, this.resolveLocal(tmpRight));
                        this.emit(opcodes_1.OpCode.BitXor);
                        // ((x & y) << 1)
                        this.emit(opcodes_1.OpCode.LoadLocal, this.resolveLocal(tmpLeft));
                        this.emit(opcodes_1.OpCode.LoadLocal, this.resolveLocal(tmpRight));
                        this.emit(opcodes_1.OpCode.BitAnd);
                        this.emit(opcodes_1.OpCode.PushInt, 1);
                        this.emit(opcodes_1.OpCode.Shl);
                        this.emit(opcodes_1.OpCode.Add);
                        if (dummy) {
                            // + ((z * z + z) & 1) * x  ==> Adds 0, but creates polynomial data dependency on 'z'
                            this.emit(opcodes_1.OpCode.LoadLocal, this.resolveLocal(dummy));
                            this.emit(opcodes_1.OpCode.Dup);
                            this.emit(opcodes_1.OpCode.LoadLocal, this.resolveLocal(dummy));
                            this.emit(opcodes_1.OpCode.Mul); // z * z
                            this.emit(opcodes_1.OpCode.Add); // z * z + z
                            this.emit(opcodes_1.OpCode.PushInt, 1);
                            this.emit(opcodes_1.OpCode.BitAnd); // (z * z + z) & 1 -> 0
                            this.emit(opcodes_1.OpCode.LoadLocal, this.resolveLocal(tmpLeft));
                            this.emit(opcodes_1.OpCode.Mul); // 0 * x -> 0
                            this.emit(opcodes_1.OpCode.Add); // Add 0 to result
                        }
                    }
                    else if (expr.operator === '-') {
                        // x - y == (x ^ ~y) + 2 * (x & ~y) + 1
                        this.emit(opcodes_1.OpCode.LoadLocal, this.resolveLocal(tmpLeft));
                        this.emit(opcodes_1.OpCode.LoadLocal, this.resolveLocal(tmpRight));
                        this.emit(opcodes_1.OpCode.BitNot);
                        this.emit(opcodes_1.OpCode.BitXor);
                        this.emit(opcodes_1.OpCode.LoadLocal, this.resolveLocal(tmpLeft));
                        this.emit(opcodes_1.OpCode.LoadLocal, this.resolveLocal(tmpRight));
                        this.emit(opcodes_1.OpCode.BitNot);
                        this.emit(opcodes_1.OpCode.BitAnd);
                        this.emit(opcodes_1.OpCode.PushInt, 1);
                        this.emit(opcodes_1.OpCode.Shl);
                        this.emit(opcodes_1.OpCode.Add);
                        this.emit(opcodes_1.OpCode.PushInt, 1);
                        this.emit(opcodes_1.OpCode.Add);
                        if (dummy) {
                            // - ((z * z + z) & 1) * y  ==> Subtracts 0, polynomial domain expansion
                            this.emit(opcodes_1.OpCode.LoadLocal, this.resolveLocal(dummy));
                            this.emit(opcodes_1.OpCode.Dup);
                            this.emit(opcodes_1.OpCode.LoadLocal, this.resolveLocal(dummy));
                            this.emit(opcodes_1.OpCode.Mul); // z * z
                            this.emit(opcodes_1.OpCode.Add); // z * z + z
                            this.emit(opcodes_1.OpCode.PushInt, 1);
                            this.emit(opcodes_1.OpCode.BitAnd); // 0
                            this.emit(opcodes_1.OpCode.LoadLocal, this.resolveLocal(tmpRight));
                            this.emit(opcodes_1.OpCode.Mul); // 0 * y -> 0
                            this.emit(opcodes_1.OpCode.Sub); // Sub 0 from result
                        }
                    }
                }
                else {
                    this.visitExpression(expr.left);
                    this.visitExpression(expr.right);
                    var isFloatMath = this.isFloatExpression(expr.left) || this.isFloatExpression(expr.right);
                    switch (expr.operator) {
                        case '*':
                            if (process.env.DEV_MODE === 'true' || isFloatMath) {
                                this.emit(opcodes_1.OpCode.Mul);
                            }
                            else {
                                /*
                                 * Mathematical Equivalence Proof:
                                 *
                                 * We prove that:
                                 * x * y = (x & y) * (x | y) + (x & ~y) * (~x & y)
                                 *
                                 * For any two bitwise integers x and y, we can partition x and y into bitwise disjoint components:
                                 * x = (x & y) + (x & ~y)
                                 * y = (x & y) + (~x & y)
                                 *
                                 * Substituting these into the product x * y:
                                 * x * y = ((x & y) + (x & ~y)) * ((x & y) + (~x & y))
                                 *
                                 * Expanding the terms algebraically:
                                 * x * y = (x & y)*(x & y) + (x & y)*(~x & y) + (x & ~y)*(x & y) + (x & ~y)*(~x & y)
                                 *
                                 * Factorizing (x & y) from the first three terms:
                                 * x * y = (x & y) * [(x & y) + (~x & y) + (x & ~y)] + (x & ~y)*(~x & y)
                                 *
                                 * Since (x & y), (~x & y), and (x & ~y) are pairwise bitwise disjoint:
                                 * (x & y) + (~x & y) + (x & ~y) = (x & y) | (~x & y) | (x & ~y) = x | y
                                 *
                                 * Substituting this back:
                                 * x * y = (x & y) * (x | y) + (x & ~y) * (~x & y)
                                 *
                                 * This completes the proof.
                                 */
                                var tmpRight = "_mba_temp_r";
                                var tmpLeft = "_mba_temp_l";
                                this.emit(opcodes_1.OpCode.StoreLocal, this.resolveLocal(tmpRight));
                                this.emit(opcodes_1.OpCode.StoreLocal, this.resolveLocal(tmpLeft));
                                // (x & y)
                                this.emit(opcodes_1.OpCode.LoadLocal, this.resolveLocal(tmpLeft));
                                this.emit(opcodes_1.OpCode.LoadLocal, this.resolveLocal(tmpRight));
                                this.emit(opcodes_1.OpCode.BitAnd);
                                // (x | y)
                                this.emit(opcodes_1.OpCode.LoadLocal, this.resolveLocal(tmpLeft));
                                this.emit(opcodes_1.OpCode.LoadLocal, this.resolveLocal(tmpRight));
                                this.emit(opcodes_1.OpCode.BitOr);
                                this.emit(opcodes_1.OpCode.Mul);
                                // (x & ~y)
                                this.emit(opcodes_1.OpCode.LoadLocal, this.resolveLocal(tmpLeft));
                                this.emit(opcodes_1.OpCode.LoadLocal, this.resolveLocal(tmpRight));
                                this.emit(opcodes_1.OpCode.BitNot);
                                this.emit(opcodes_1.OpCode.BitAnd);
                                // (~x & y)
                                this.emit(opcodes_1.OpCode.LoadLocal, this.resolveLocal(tmpLeft));
                                this.emit(opcodes_1.OpCode.BitNot);
                                this.emit(opcodes_1.OpCode.LoadLocal, this.resolveLocal(tmpRight));
                                this.emit(opcodes_1.OpCode.BitAnd);
                                this.emit(opcodes_1.OpCode.Mul);
                                this.emit(opcodes_1.OpCode.Add);
                            }
                            break;
                        case '/':
                            this.emit(opcodes_1.OpCode.Div);
                            if (process.env.DEV_MODE !== 'true' && !isFloatMath) {
                                /*
                                 * Proposing a Polynomial MBA Model for Division:
                                 *
                                 * 1. Mathematical Limitations:
                                 *    Unlike addition, subtraction, and multiplication, integer division (x / y)
                                 *    cannot be cleanly distributed or partitioned over bitwise components.
                                 *    Specifically, division is non-distributive over bitwise partitioning:
                                 *      (a & b) / c !== (a / c) & (b / c)
                                 *    and it does not associate or commute with bitwise operators.
                                 *    Furthermore, division is not a polynomial mapping over the ring Z/2^nZ.
                                 *    Only odd elements in Z/2^nZ have multiplicative inverses (making division by
                                 *    an odd element equivalent to multiplication by its modular inverse),
                                 *    whereas division by even integers cannot be inverted or represented algebraically
                                 *    in this ring without loss of information.
                                 *
                                 * 2. Newton-Raphson Approximation Model:
                                 *    For divisions by an odd divisor y, we can compute the modular inverse y^-1
                                 *    using the Newton-Raphson division iteration:
                                 *      z_{k+1} = z_k * (2 - y * z_k) (mod 2^n)
                                 *    Starting with a simple initial guess z_0 (e.g., matching the lower bits),
                                 *    this iteration quadratically converges to the modular inverse y^-1 in n/2 steps.
                                 *    For 32-bit integers, 5 iterations are sufficient to get the exact inverse.
                                 *    Since the iterations involve only subtraction and multiplication, they can
                                 *    be obfuscated using standard linear and polynomial MBA identities.
                                 *    For even divisors, we can factorize the divisor into y = d * 2^s, where d is
                                 *    odd, compute the modular inverse of d, multiply, and shift right:
                                 *      x / y = (x * d^-1) >> s
                                 *    This decomposes division into multiplication, modular inversion (obfuscated via
                                 *    Newton-Raphson), and bitwise shifts, enabling a robust polynomial MBA representation.
                                 */
                                // Linear MBA: Add 0
                                var dummyDiv = this.getDummyVariable();
                                this.emit(opcodes_1.OpCode.LoadLocal, this.resolveLocal(dummyDiv));
                                this.emit(opcodes_1.OpCode.Dup);
                                this.emit(opcodes_1.OpCode.Sub);
                                this.emit(opcodes_1.OpCode.Add);
                            }
                            break;
                        case '==':
                            this.emit(opcodes_1.OpCode.Eq);
                            break;
                        case '<':
                            this.emit(opcodes_1.OpCode.Lt);
                            break;
                        case '>':
                            this.emit(opcodes_1.OpCode.Gt);
                            break;
                        case '<=':
                            this.emit(opcodes_1.OpCode.Lte);
                            break;
                        case '>=':
                            this.emit(opcodes_1.OpCode.Gte);
                            break;
                        case '!=':
                            this.emit(opcodes_1.OpCode.Neq);
                            break;
                        case '&&':
                            this.emit(opcodes_1.OpCode.And);
                            break;
                        case '||':
                            this.emit(opcodes_1.OpCode.Or);
                            break;
                        default: throw new Error("Unsupported operator ".concat(expr.operator));
                    }
                }
                break;
            case 'CallExpression':
                if (expr.callee.type === 'Identifier') {
                    if (expr.callee.name === '__native_call') {
                        // expects id, arg_count inline. First argument is id (must be Literal).
                        var idNode = expr.arguments[0];
                        if (idNode.type !== 'Literal' || typeof idNode.value !== 'number') {
                            throw new Error('__native_call expects a numeric literal ID as the first argument');
                        }
                        var nativeId = idNode.value;
                        var nativeArgs = expr.arguments.slice(1);
                        for (var _i = 0, nativeArgs_1 = nativeArgs; _i < nativeArgs_1.length; _i++) {
                            var arg = nativeArgs_1[_i];
                            this.visitExpression(arg);
                        }
                        this.emit(opcodes_1.OpCode.CallNative, nativeId);
                        var patchOffset = this.code.length;
                        this.code.push(nativeArgs.length & 0xFF);
                        this.code.push((nativeArgs.length >> 8) & 0xFF);
                        this.code.push((nativeArgs.length >> 16) & 0xFF);
                        this.code.push((nativeArgs.length >> 24) & 0xFF);
                        break;
                    }
                }
                // Simple implementation: args are pushed to the stack
                for (var _a = 0, _b = expr.arguments; _a < _b.length; _a++) {
                    var arg = _b[_a];
                    this.visitExpression(arg);
                }
                if (expr.callee.type === 'Identifier') {
                    if (expr.callee.name === 'len') {
                        // expects 1 argument
                        this.emit(opcodes_1.OpCode.Length);
                    }
                    else if (expr.callee.name === 'hash256') {
                        // expects 1 argument
                        this.emit(opcodes_1.OpCode.Hash256);
                    }
                    else if (expr.callee.name === 'concat') {
                        // expects 2 arguments
                        this.emit(opcodes_1.OpCode.Concat);
                    }
                    else if (expr.callee.name === 'encrypt_aes') {
                        // expects 2 arguments
                        this.emit(opcodes_1.OpCode.EncryptAES);
                    }
                    else if (expr.callee.name === 'json_stringify') {
                        // expects 1 argument
                        this.emit(opcodes_1.OpCode.JSONStringify);
                    }
                    else {
                        // We emit the Call instruction with a dummy 0 target, and remember to patch it later
                        this.emit(opcodes_1.OpCode.Call, 0);
                        var patchOffset = this.code.length - 4; // The target operand is the last 4 bytes
                        this.unresolvedCalls.push({ offset: patchOffset, name: expr.callee.name });
                        // Operand 2: arg count
                        this.code.push(expr.arguments.length & 0xFF);
                        this.code.push((expr.arguments.length >> 8) & 0xFF);
                        this.code.push((expr.arguments.length >> 16) & 0xFF);
                        this.code.push((expr.arguments.length >> 24) & 0xFF);
                    }
                }
                else {
                    throw new Error("Only direct function calls are supported");
                }
                break;
            case 'ArrayExpression':
                this.emit(opcodes_1.OpCode.NewList);
                for (var _c = 0, _d = expr.elements; _c < _d.length; _c++) {
                    var element = _d[_c];
                    this.visitExpression(element);
                    this.emit(opcodes_1.OpCode.ListPush);
                }
                break;
            case 'ObjectExpression':
                this.emit(opcodes_1.OpCode.NewObject);
                for (var _e = 0, _f = expr.properties; _e < _f.length; _e++) {
                    var prop = _f[_e];
                    var keyName = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
                    this.emitString(keyName);
                    this.visitExpression(prop.value);
                    this.emit(opcodes_1.OpCode.SetMember);
                }
                break;
            case 'MemberExpression':
                this.visitExpression(expr.object);
                if (expr.computed) {
                    this.visitExpression(expr.property);
                }
                else {
                    var propName = expr.property.name;
                    this.emitString(propName);
                }
                this.emit(opcodes_1.OpCode.GetMember);
                break;
            case 'UpdateExpression':
                // simple desugaring: fetch, push 1, op, store
                // wait, if it's i++, it modifies i but returns the original value?
                // we'll implement it as ++i semantics (returns new value) for simplicity since we don't have temporary registers
                if (expr.argument.type === 'Identifier') {
                    this.emit(opcodes_1.OpCode.LoadLocal, this.resolveLocal(expr.argument.name));
                    this.emit(opcodes_1.OpCode.PushInt, 1);
                    this.emit(expr.operator === '++' ? opcodes_1.OpCode.Add : opcodes_1.OpCode.Sub);
                    this.emit(opcodes_1.OpCode.Dup); // keep value on stack
                    this.emit(opcodes_1.OpCode.StoreLocal, this.resolveLocal(expr.argument.name));
                }
                else if (expr.argument.type === 'MemberExpression') {
                    // This is much harder to desugar properly without duplicating evaluation of the object/property.
                    // For now, we evaluate obj and prop, get member, add 1, then we have to set member which needs obj and prop again!
                    // This is too complex for this simple compiler without duping deep stack. We'll leave it as unsupported or partial support for locals only.
                    throw new Error("Update expressions on members are currently unsupported.");
                }
                else {
                    throw new Error("Invalid left-hand side expression in update operation");
                }
                break;
            case 'UnaryExpression':
                if (expr.operator === '!') {
                    this.visitExpression(expr.argument);
                    this.emit(opcodes_1.OpCode.Not);
                }
                else {
                    throw new Error("Unsupported unary operator ".concat(expr.operator));
                }
                break;
        }
    };
    return CodeGenerator;
}());
exports.CodeGenerator = CodeGenerator;
