# JS-to-FVM Transpiler

The Fortress WASM transpilation pipeline converts a subset of standard JavaScript or TypeScript into a custom, non-standard instruction set architecture (ISA) designed to run inside the secure Fortress Virtual Machine (FVM).

## Architecture Overview

```
[JS/TS Source] ---> [Babel Parser (AST)] ---> [FVM Transpiler] ---> [FVM Bytecode Generator] ---> [Equivalence Verifier]
```

1. **AST Generation**: The source code is parsed using Babel into a structured Abstract Syntax Tree (AST).
2. **FVM Translation**: High-level syntax nodes are mapped to FVM-compatible structures.
3. **Helper Injection**: Reference code utilizes pre-compiled standard library templates (e.g., for custom Map and Set operations).
4. **Bytecode Compilation**: The Code Generator produces the raw `.fvbc` bytes alongside a randomized, session-unique opcode translation map.
5. **Equivalence Verification**: The pipeline validates execution equivalence by running both standard Node.js and FVM executions synchronously on sample values.

## Unsupported Syntax & Errors

FVM implements a strict security boundary. Modern syntax constructs that could lead to runtime leakage or control-flow analysis are rejected at compile time.

The transpiler will immediately fail and report errors for:
- **Array & Object Destructuring**: Prevents stack layout analysis.
- **ES6 Classes with Fields**: State must be managed through standard VM objects.
- **Async/Await Splitting**: FVM executes instructions synchronously to avoid timing attacks.
- **Try/Catch Exception Handling**: Eliminates control-flow hijacking.
- **Comma Operator**: Enforces explicit sequencing of expressions.
- **Atomics**: Blocked to prevent low-level concurrency attacks and shared memory vulnerabilities.

## Advanced Compilation & Memory Features

To handle standard JS workloads, the transpiler supports several emulation layers:
- **SharedArrayBuffer & TypedArrays**: Supported via emulation. Multiple TypedArray views instantiated with the same SharedArrayBuffer reference the same underlying buffer. Changes are synchronized across views on write. Non-SAB arguments are cloned element-by-element (`listPush` loop) to prevent JS-level mutability leakage.
- **Large Function Splitting**: Functions with >1000 statements are split into sequential parts using an optimized O(N) linear statement scan based on prefix writes and suffix reads to identify valid split points without compile-time quadratic degradation.
- **Register Banking & Scope Safety**: High variable count (>256) triggers register allocation via graph coloring. A scope deconfliction pass (`path.scope.rename`) renaming shadowed variables prevents variable collisions across scopes. Recursive function splitting filters parameters to only include those actually read/written in sub-function bodies, preventing parameter count expansion and infinite recursion.

## Standard Library Support

Fortress provides lightweight, secure implementations of common data collections:
- **Map**: Emulates `new Map()`, `get()`, `set()`, `has()`, and `delete()`.
- **Set**: Emulates `new Set()`, `add()`, `has()`, and `delete()`.
- **Merge Sort**: Enforces stable ordering under total comparator rules, handling NaNs and negative zero values securely.
