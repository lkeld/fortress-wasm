# Contributing to Fortress WASM

This is a highly specialised piece of defensive engineering. If you're contributing, you need to understand the architecture deeply. Read `RESEARCH.md` and `ARCHITECTURE.md` before touching the compiler or the VM.

## Build Pipeline Dependencies

The pipeline strictly separates canonical opcode generation from compilation and scrambling. You must build the components in the correct order.

**Prerequisites:**
- Node.js (v18+)
- Rust (stable)
- `wasm-pack`

## Building

Do not try to build individual components manually unless you are debugging a specific phase. Use the primary build script.

```bash
npm install
npm run build
```

What this actually does:
1. `build:isa`: Runs `scripts/generate_isa.js`. This is the most critical step. It performs a Fisher-Yates shuffle to generate a randomised canonical ISA and dynamically writes the Enums into the TypeScript compiler and the Rust VM, and builds the Function Pointer Array for `dispatch_table.rs`.
2. `build:compiler`: Compiles the TypeScript compiler (`tsc`).
3. `build:server`: Compiles the Node.js scrambler module (`tsc`).
4. `build:wasm-node` & `build:wasm-web`: Uses `wasm-pack` to build the Rust interpreter into Node and Web targets.

## Running Tests

The test suite validates the bitwise operations, the cryptographic thunks, and the renewability logic.

```bash
# Run the Rust unit tests and integration tests
npm test
```

## Making Changes

If you modify the VM logic (`crates/vm-core/src/vm.rs` or `handlers.rs`), ensure you are not re-introducing switch blocks or static patterns that can be fingerprinted by LLVM passes.

If you modify the Compiler (`compiler/src/codegen.ts`), ensure any new dummy variable allocations for Taint Analysis Resistance are properly appended to the `dummyVariables` array to maintain non-linear data dependency scattering.
