import { Program } from './parser';
export declare enum OpCode {
    Push = 1,
    Pop = 2,
    Dup = 3,
    LoadLocal = 16,
    StoreLocal = 17,
    AddInt = 32,
    SubInt = 33,
    MulInt = 34,
    DivInt = 35,
    AddFloat = 36,
    SubFloat = 37,
    MulFloat = 38,
    DivFloat = 39,
    Eq = 48,
    Neq = 49,
    Lt = 50,
    Gt = 51,
    Lte = 52,
    Gte = 53,
    Jump = 80,
    JumpIf = 81,
    JumpIfNot = 82,
    Call = 112,
    Return = 113,
    CallNative = 128,
    Halt = 255
}
export declare class CodeGenerator {
    private code;
    private constants;
    private locals;
    generate(program: Program): {
        code: Uint8Array;
        constants: string;
    };
    private emit;
    private addConstant;
    private resolveLocal;
    private visitStatement;
    private patchJump;
    private visitExpression;
}
//# sourceMappingURL=codegen.d.ts.map