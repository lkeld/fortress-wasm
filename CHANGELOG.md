# Changelog

All notable changes to Fortress WASM will be documented in this file.

## [1.0.2] - 2026-05-19

### Fixed
- **Post-Implementation Functional Correctness Audit**:
  - *ABI Mismatch*: Fixed a critical bug where `worker.ts` passed 3 arguments to the VM instead of the required 4. Fully traced and integrated the dynamic `opcodeMap` into the Web Worker execution payload.
  - *Integer Truncation Vulnerability*: Identified and fixed a 32-bit WASM integer truncation bug where 64-bit array indices larger than `u32::MAX` silently truncated to `0`, bypassing bounds checks. Replaced unsafe `as usize` casts with checked `try_from`, properly propagating `IndexOutOfBounds` errors.
  - *Compiler Edge Cases*: Upgraded the TypeScript `lexer.ts` and `parser.ts` to properly handle unary negative numbers (`-x`), scientific notation (`1e3`), leading-dot floating points (`.5`), and complex string escape sequences (`\"`, `\n`).
  - *Panic Hardening*: Hardened `vm.rs` against silent JS environment crashes by replacing `.unwrap()` on the host performance timer with a safe `.and_then()` fallback, and removed `panic!` calls in development bridges.

## [1.0.0] - 2026-05-19

### Added
- **Final Hardening Phases (10-13) Complete**:
  - Implemented mathematical Superoperators (`CompareAndAdd`, `SwapAndMul`, `JumpAndMul`) to fuse disjoint semantics, actively breaking SMT-based synthesis attacks.
  - Deployed LLM Stack Poisoning. Modified `emitJunk()` to inject phantom `Swap`, `Rotate`, and `Drop2` opcodes into dead blocks, intentionally generating massive, non-monotonic stack depth traces to scramble LLM-assisted decompilers like StackSight.
  - Finalised Per-Request Code Renewability. `scrambler.ts` is now a stateless module that dynamically scrambles the `.fvbc` payload with a completely fresh opcode map, rolling session key, and LSB extraction stride per request.
  - Dismantled the monolithic `match` dispatcher in `vm.rs` and replaced it with a native Function Pointer Array and microscopic trampoline loop. Static LLVM IR tools searching for high-successor-count dispatchers will now hit a dead end.

### Fixed
- **LSB Bootstrap Vulnerability Caught in Review**: 
  - *Context*: During the oversight review of Phase 12, I realised that byte 0 of the session key was still being encoded using a hardcoded extraction stride of 17, and only the subsequent 31 bytes used the dynamic stride. This gave an attacker a fixed anchor.
  - *Fix*: Refactored `wrapper.rs` and `scrambler.ts` to derive the extraction stride directly from the randomised R channel of the first pixel (`image_rgba[0]`). No hardcoded anchors remain.
- **Naked Mul and Div Statistical Outliers**:
  - *Context*: The Polynomial MBA domain expansion was only applied to `Add` and `Sub`. `Mul` and `Div` were left completely naked, creating a massive statistical frequency outlier for an attacker to target.
  - *Fix*: Applied a structural linear MBA mapping to both (`x * y -> x * y + (dummy - dummy)`) and hooked it directly into the taint graph diversification array.

## [0.9.0] - 2026-05-18

### Added
- **Polynomial MBA Domain Expansion**:
  - Upgraded the linear MBA to a non-linear polynomial expansion using `(z * z + z) & 1 == 0` identities to break SiMBA and MBA-Blast solvers.

### Fixed
- **The MBA String Concatenation TypeError Nightmare**:
  - *Context*: I pushed the linear MBA substitution logic into the AST traversal for the `+` operator, completely forgetting that JavaScript/TypeScript uses `+` for string concatenation. The Rust VM's `OpCode::Add` handler panicked with a `TypeError` because it was receiving two String types, trying to run bitwise XORs on them.
  - *Fix*: Implemented a dedicated `Concat` opcode and separated string concatenation from numeric addition in the compiler. `Add` is now exclusively numeric and can safely run full MBA polynomial expansion.
- **The 0x05 Payload Desync Bug**:
  - *Context*: The scrambler was silently destroying string literals. It took three hours to trace why the string bounds were completely desyncing the payload.
  - *Fix*: `scrambler.ts` was hardcoding `0x05` for `PushString` length calculations, which was the legacy un-shuffled value. Because `generate_isa.js` was randomising the ISA on every build, `0x05` was suddenly mapping to random opcodes, meaning the scrambler miscalculated string length bounds and corrupted the rolling XOR key offsets. I imported the dynamic `OpCode` enum directly into the scrambler so both ends share the exact mapping.

## [0.1.0] - 2026-05-15

### Added
- Initial proof-of-concept Wasm-in-Wasm interpreter.
- Basic sliding JIT decryption window implemented over a 256-byte page boundary.
- Simple AST traversal compiler generating `.fvbc` format payloads.
- Fisher-Yates `generate_isa.js` script to build dynamic opcodes.
