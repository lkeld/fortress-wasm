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

The test suite validates the bitwise operations, the cryptographic thunks, the renewability logic, and the end-to-end integration pipeline. The detailed test design, Tier coverage, and test case inventory are documented in [TEST_INFRA.md](TEST_INFRA.md).

```bash
# Run the Rust unit tests, TypeScript compiler tests, and Integration tests
npm run test:full

# Run the E2E integration test suite
npm run test:e2e
```

**CRITICAL RULE:** All tests must pass on BOTH Dev and Prod builds before merging. The test harness verifies `DEV_MODE` isolation. Ensure you run the full suite and E2E tests on both targets:

```bash
# Verify Development Build
npm run build:dev
npm run test:full
npm run test:e2e

# Verify Production Build
npm run build:prod
npm run test:full
npm run test:e2e
```

> [!WARNING]
> **Flaky Adversarial Test Assertion:** The E2E test case `Adversarial: Local slot boundary overflow vulnerability` contains a known statistical flake (false positive) in its verification assertion due to random opcode collisions during naive byte scanning in randomised environments. This is a limitation of the test assertion scanner itself, not an execution or isolation bug in the VM.

## Making Changes

If you modify the VM logic (`crates/vm-core/src/vm.rs` or `handlers.rs`), ensure you are not reintroducing switch blocks or static patterns that can be fingerprinted by LLVM passes.

If you modify the Compiler (`compiler/src/codegen.ts`), ensure any new dummy variable allocations for Taint Analysis Resistance are properly appended to the `dummyVariables` array to maintain non-linear data dependency scattering.

## Reporting Issues

If you find a bug, functional mismatch, or security vulnerability, please open an issue in the official issue tracker at [GitHub Issues](https://github.com/lkeld/fortress-wasm/issues).

When submitting an issue, please ensure you include:
1. A minimal reproducible example (your source `.fvm` script).
2. Environment details (Node.js version, Rust version, and whether it occurs on `DEV` or `PROD` builds).
3. The expected behaviour versus the actual behaviour, including any console logs or stack traces.
