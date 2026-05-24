# Fortress WASM — Codebase Security Audit & Systematic Hunt Findings

This document represents the official audit findings register from the Phase 2 systematic security audit and codebase hunt of the Fortress WASM virtual machine runtime, compiler, server-side scrambler, and client SDK.

---

## 1. Executive Summary & Findings Register

| ID | Component | File | Line(s) | Severity | Category | Description | Status |
|:---|:---|:---|:---|:---|:---|:---|:---|
| **F-01** | Rust VM | `handlers.rs` | 348, 356, 371, 379, 394, 402, 416, 428, 433, 447, 452 | High | Unsafe Type Cast | Float-to-integer conversions (`as i64`, `as i32`) on bitwise operators without bounds/NaN validation. | `[Resolved]` |
| **F-02** | Rust VM | `handlers.rs` | 525, 543, 578 | High | Unsafe Type Cast | Float-to-integer conversion (`as i64`) when indexing lists/objects without range validation. | `[Resolved]` |
| **F-03** | Rust VM | `handlers.rs` | 223, 231, 239, 247 | High | Unsafe Type Cast | Float-to-integer conversion (`as i64`) in `op_div` after fractional check can saturate. | `[Resolved]` |
| **F-04** | Rust VM | `handlers.rs` | 181, 195, 208, 1150 | Medium | Integer Overflow | Arithmetic operators (`+`, `-`, `*`) can panic (debug) or wrap (release) on integer overflow. | `[Resolved]` |
| **F-05** | Rust VM | `handlers.rs` | 1993, 2027 | High | Unbounded Recursion | Unbounded recursion in `flatten_vec` (`op_arrflat`) can overflow the Rust stack. | `[Resolved]` |
| **F-06** | Rust VM | `wrapper.rs` | 381 | Medium | Unbounded Recursion | `value_to_json_inner` recurses on deeply nested objects/lists without depth limit. | `[Resolved]` |
| **F-07** | Rust VM | `handlers.rs` | 495, 560, 1892, 1940 | Medium | Memory Exhaustion | Lists and objects can grow without bounds, causing linear heap exhaustion (OOM). | `[Resolved]` |
| **F-08** | Rust VM | `handlers.rs` | 145, 758, 1322 | Medium | Memory Exhaustion | Unbounded string concatenation and repetition can trigger OOM. | `[Resolved]` |
| **F-09** | Rust VM | `handlers.rs` | 1515 | Medium | Regex DoS | Catastrophic backtracking or pattern compilation DoS in `fancy-regex` patterns. | `[Resolved]` |
| **F-10** | Rust VM | `handlers.rs` | Multiple | Low | Unhandled Panic Path | Reachable `unwrap()` and `expect()` calls in FVM path without safety comments. | `[Resolved]` |
| **F-11** | Rust VM | `wrapper.rs` | 79 | Medium | Memory Exhaustion | `execute` accepts arbitrary JSON inputs without a length validation check. | `[Resolved]` |
| **F-12** | Rust VM | `wrapper.rs` | 27 | Medium | Unhandled Panic Path | Ephemeral key generation panics via `.expect()` on `getrandom` failure. | `[Resolved]` |
| **F-13** | Compiler | `js-transpiler.ts` | ~3801, ~4116 | Critical | RCE | Remote Code Execution via unsandboxed `new Function` evaluation in `verifyEquivalence`. | `[Resolved]` |
| **F-14** | Compiler | `js-transpiler.ts` | ~1012, ~1030 | High | Privilege Escalation | Arbitrary constructor instantiation via `globalThis[errClass]` from returned FVM string. | `[Resolved]` |
| **F-15** | Compiler | `js-transpiler.ts` | ~1030, ~1057, ~1150 | High | Proxy Forgery | Weak string-property checks (`__is_fortress_proxy`) instead of isolated references. | `[Resolved]` |
| **F-16** | Compiler | `js-transpiler.ts` | ~2247 | High | Code Quality | Name-based type inference (e.g. `roadmap`) causes incorrect compilation/type treatment. | `[Resolved]` |
| **F-17** | Compiler | `js-transpiler.ts` | Multiple | High | Logic Bug | Strict equality `===`/`!==` is downgraded to loose equality `==`/`!=` inside the FVM. | `[Resolved]` |
| **F-18** | Compiler | `js-transpiler.ts` | Multiple | Medium | Scope Contamination | Generated variables (e.g. `__t1`, `__reg_0`) can collide with user-defined scope. | `[Resolved]` |
| **F-19** | Server | `nonce-store.ts` | ~6 | High | DoS | Nonce store lacks size limits, exposing memory exhaustion/DoS under flood. | `[Resolved]` |
| **F-20** | Server | `scrambler.ts` | Multiple | High | Cryptography | Session keys and Diffie-Hellman secrets in Node.js buffers are not zeroized after use. | `[Resolved]` |
| **F-21** | Client SDK | `index.js` | ~148 | High | Race Condition | Concurrent initialization attempts crash due to `temp-worker.js` filename collision. | `[Resolved]` |
| **F-22** | Client SDK | `index.js` | ~266, ~225, Multiple | Medium | Memory Leak | Pending execution promises are not rejected on worker termination/dispose; blob URL leaks. | `[Resolved]` |

---

## 2. Detailed Findings Description

### F-01: Unsafe Float-to-Integer Casts in Bitwise Operators
*   **File:** `crates/vm-core/src/handlers.rs`
*   **Line:** 348, 356, 371, 379, 394, 402, 416, 428, 433, 447, 452
*   **Severity:** High
*   **Description:** Float values popped from the VM stack are cast directly using `as i64` or `as i32` inside bitwise operators (such as `op_bitand`, `op_bitor`, `op_bitxor`, `op_bitnot`, `op_shl`, `op_shr`). If the float value is `NaN`, `Infinity`, or outside the representable bounds of integers, modern Rust performs saturating casts (e.g. `NaN` to `0`, `Infinity` to `i32::MAX`). This diverges from standard JS bitwise semantics and causes incorrect bytecode execution without signaling errors.
*   **Reproduction:**
    Push a float like `f64::NAN` or `f64::INFINITY` onto the stack and run `BitAnd`.
*   **Proposed Fix:**
    Implement `f64_to_i32_safe` and `f64_to_i64_safe` helper functions that explicitly check for `is_nan()`, `is_infinite()`, and integer overflow/underflow bounds. If any check fails, return `Result::Err(VmError::TypeError)`.

### F-02: Unsafe Float-to-Integer Casts in Object/List Indexing
*   **File:** `crates/vm-core/src/handlers.rs`
*   **Line:** 525, 543, 578
*   **Severity:** High
*   **Description:** In `op_getmember` and `op_setmember`, the index key is evaluated. If it is a float, its fractional part is validated via `f.fract() == 0.0`. However, extremely large floats (e.g., `9e19`) have `fract() == 0.0` but far exceed the maximum value of `i64::MAX`. Casting them using `f as i64` saturates to `i64::MAX`, causing incorrect index lookup or out-of-bounds accesses.
*   **Reproduction:**
    Access a member on a list where the key is `Float(9e19)`.
*   **Proposed Fix:**
    Verify that the float key is within the safe range `[i64::MIN, i64::MAX]` before casting. Return `VmError::IndexOutOfBounds` or `VmError::TypeError` if validation fails.

### F-03: Unsafe Float-to-Integer Casts in Division
*   **File:** `crates/vm-core/src/handlers.rs`
*   **Line:** 223, 231, 239, 247
*   **Severity:** High
*   **Description:** In `op_div`, the division result is cast back to `i64` if `res.fract() == 0.0 && res.is_finite()`. If `res` is out of safe range (e.g. `9e19 / 1`), the cast `res as i64` saturates, resulting in runtime correctness errors.
*   **Reproduction:**
    Divide `9e19` by `1` in the VM and evaluate the type of the result.
*   **Proposed Fix:**
    In addition to checking `fract() == 0.0`, ensure `res >= i64::MIN as f64 && res <= i64::MAX as f64` before casting to `Value::Int`. Otherwise, push `Value::Float`.

### F-04: Panics and Wrapping on Integer Arithmetic Overflow
*   **File:** `crates/vm-core/src/handlers.rs`
*   **Line:** 181, 195, 208, 1150
*   **Severity:** Medium
*   **Description:** Integer arithmetic operators (`+`, `-`, `*`) are performed directly on `i64` types. Rust panics in debug builds and wraps in release builds on overflow. In a cryptographic sandboxed runtime, panics cause a DoS (worker crash), and wrapping causes correctness/security bugs.
*   **Reproduction:**
    Compute `i64::MAX + 1` in the FVM.
*   **Proposed Fix:**
    Implement checked arithmetic (`checked_add`, `checked_sub`, `checked_mul`). According to the handover mandate, if an integer operation overflows, it should produce a float representing `Infinity`/`-Infinity` (matching JS arithmetic semantics).

### F-05: Unbounded Recursion in `ArrFlat`
*   **File:** `crates/vm-core/src/handlers.rs`
*   **Line:** 1993, 2027
*   **Severity:** High
*   **Description:** The array flattening operator `op_arrflat` extracts a user-specified depth argument and recurses. If a malicious payload passes a massive depth or a cyclic nested array, `flatten_vec` recurses without limits, exhausting the Rust execution stack and aborting the WASM instance.
*   **Reproduction:**
    Pass `Value::Int(100000)` as the depth parameter to `ArrFlat` on an array.
*   **Proposed Fix:**
    Clamp the maximum flattening depth to a reasonable limit (e.g. `100`), and check for stack allocation limits.

### F-06: Unbounded Recursion in JSON Serialization
*   **File:** `crates/vm-core/src/wrapper.rs`
*   **Line:** 381
*   **Severity:** Medium
*   **Description:** `value_to_json_inner` recurses over nested objects and lists. While circular reference checks exist, an extremely deep acyclic nesting (e.g. 5000 nested lists) will exhaust the stack.
*   **Reproduction:**
    Evaluate `JSONStringify` on an object nested 5000 levels deep.
*   **Proposed Fix:**
    Enforce a maximum serialization recursion depth limit of `100`. Return a serialization error if exceeded.

### F-07: Unbounded List and Object Growth (Memory Exhaustion)
*   **File:** `crates/vm-core/src/handlers.rs`
*   **Line:** 495, 560, 1892, 1940
*   **Severity:** Medium
*   **Description:** The handlers for `ListPush` and object modifications allow collection structures to grow indefinitely. An attacker could construct an execution loop that appends to an array until the WASM linear memory runs out of space, crashing the server's worker.
*   **Reproduction:**
    Run a loop that pushes values to a list continuously.
*   **Proposed Fix:**
    Enforce a maximum collection size limit (e.g., `65536` elements) in `op_listpush`, `op_setmember`, `op_arrpush`, and `op_arrunshift`.

### F-08: Unbounded String Concatenation and Repetition (Memory Exhaustion)
*   **File:** `crates/vm-core/src/handlers.rs`
*   **Line:** 145, 758, 1322
*   **Severity:** Medium
*   **Description:** `op_concat` and `op_strrepeat` perform string operations without validating the final length. A large repeat count or continuous concatenation loop causes massive allocations, exhausting memory.
*   **Reproduction:**
    Execute `"A".repeat(10_000_000)` inside FVM.
*   **Proposed Fix:**
    Enforce a maximum string length limit of `65536` characters/bytes for string concatenation, repetition, and padding operations.

### F-09: Regex Backtracking and Compilation DoS in `fancy-regex`
*   **File:** `crates/vm-core/src/handlers.rs`
*   **Line:** 1515
*   **Severity:** Medium
*   **Description:** User-supplied regex patterns routed to `fancy-regex` have no pattern complexity checks or execution limits. An attacker can supply a pattern vulnerable to catastrophic backtracking (e.g. `(a+)+b`), causing the worker thread to hang permanently.
*   **Reproduction:**
    Compile and execute `/(a+)+b/.test("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!")` in FVM.
*   **Proposed Fix:**
    Limit the regex pattern length to `1024` characters, and configure fancy-regex compilation and search constraints if supported, or intercept backtracking.

### F-10: Reachable Unwrapped Panics in Rust VM Core
*   **File:** `crates/vm-core/src/handlers.rs`, `crates/vm-core/src/vm.rs`
*   **Line:** Multiple
*   **Severity:** Low
*   **Description:** The VM core uses `.unwrap()` or `.expect()` at several locations. If an unexpected internal state is reached, the VM will panic. In a WASM runtime, this immediately crashes the worker container.
*   **Proposed Fix:**
    Replace un-justified unwraps with error propagation (`ok_or(VmError::RuntimeError)?`) or add explicit `// SAFETY:` comments proving their absolute safety.

### F-11: Missing Input Size Limit in `execute`
*   **File:** `crates/vm-core/src/wrapper.rs`
*   **Line:** 79
*   **Severity:** Medium
*   **Description:** The host calls `execute(bytecode, handshake_header, input_json, opcode_map)`. The `input_json` parameter is accepted as an arbitrary length string. Deserializing a massive JSON payload (e.g. 50MB) allocates extensive memory before processing begins, risking OOM crashes.
*   **Proposed Fix:**
    Validate that `input_json.len() <= 1048576` (1MB limit) before invoking deserialization.

### F-12: Unhandled Panic in client key generation
*   **File:** `crates/vm-core/src/wrapper.rs`
*   **Line:** 27
*   **Severity:** Medium
*   **Description:** `generate_client_keypair` calls `getrandom::getrandom(&mut private_bytes).expect("...")`. If `getrandom` fails (due to lack of entropy or JS environment restrictions), the VM panics and aborts.
*   **Proposed Fix:**
    Handle entropy errors gracefully. Change the signature or safely fallback, ensuring the function does not panic on the JS worker thread.

### F-13: Remote Code Execution in `verifyEquivalence`
*   **File:** `compiler/src/js-transpiler.ts`
*   **Line:** ~3801, ~4116
*   **Severity:** Critical
*   **Description:** The transpiler validates equivalence by executing the original JS function and the generated FVM wrapper in the host Node.js process using `new Function()`. Since the execution is unsandboxed, a malicious JS source code input can execute arbitrary shell commands or access the file system (RCE) on the developer or build host.
*   **Reproduction:**
    Compile code containing `require('child_process').execSync('id')` with `verifyEquivalence: true`.
*   **Proposed Fix:**
    Use Node's `vm` module to run validation inside a restricted context (`vm.createContext()` and `vm.runInContext()`) with all host globals (e.g., `process`, `require`) removed. Disable `verifyEquivalence` in production compilation modes.

### F-14: Arbitrary Constructor Instantiation in Proxy templates
*   **File:** `compiler/src/js-transpiler.ts`
*   **Line:** ~1012, ~1030
*   **Severity:** High
*   **Description:** In the generated Proxy template code, FVM error payloads are re-thrown by looking up the error constructor dynamically on the global object using `globalThis[errClass]`. A compromised FVM bytecode could return a string like `"Function"`, leading to dynamic evaluation and RCE.
*   **Reproduction:**
    FVM returns a structured error header with `errClass: "Function"`.
*   **Proposed Fix:**
    Enforce a strict allowlist of allowed error class names: `TypeError`, `RangeError`, `ReferenceError`, `SyntaxError`, `URIError`, `EvalError`, `Error`. Default to `Error` for any other string.

### F-15: Weak Proxy Identity checks (Proxy Forgery)
*   **File:** `compiler/src/js-transpiler.ts`
*   **Line:** ~1030, ~1057, ~1150
*   **Severity:** High
*   **Description:** The serialization wrappers identify Fortress proxies by reading properties like `__is_fortress_proxy` and `__proxy_target`. A user object containing these properties can forge a proxy identity, bypass security guards, or cause type confusion errors in serialization.
*   **Reproduction:**
    Pass `{ __is_fortress_proxy: true, __proxy_target: {} }` to FVM input serialization.
*   **Proposed Fix:**
    Utilize a private, module-scoped `WeakSet` to track genuine proxy instances, and a `WeakMap` to store their target objects. This prevents external property spoofing.

### F-16: Name-Based Type Inference Collisions
*   **File:** `compiler/src/js-transpiler.ts`
*   **Line:** ~2247
*   **Severity:** High
*   **Description:** The transpiler automatically infers variable types if their name matches patterns like `*map*` or `*set*` (e.g., `roadmap`, `dataset`). If a user declares a plain object variable with such a name, the compiler emits bytecode intended for `Map`/`Set` structures, causing compilation errors or FVM aborts.
*   **Reproduction:**
    Declare `const dataset = { a: 1 }; dataset.a = 2;` and transpile it.
*   **Proposed Fix:**
    Remove name-based type inference entirely. Rely on initializer AST node inspection (e.g. `new Map()` or `{}`) or emit polymorphic runtime dispatch checks in the generated wrappers.

### F-17: Strict Equality Downgrade in VM
*   **File:** `compiler/src/js-transpiler.ts`
*   **Severity:** High
*   **Description:** Because FVM lacks strict equality opcodes, strict equality comparisons `===` and `!==` are downgraded to loose equality `==` and `!=`. This violates JavaScript correctness and bypasses type-strict validation checks in security-sensitive scripts.
*   **Reproduction:**
    Compiling `1 === "1"` evaluates to `true` in FVM.
*   **Proposed Fix:**
    Add `StrictEq` and `StrictNeq` opcodes to the FVM ISA and map `===`/`!==` directly to them in the transpiler.

### F-18: Scope Contamination via Generated Variable Collisions
*   **File:** `compiler/src/js-transpiler.ts`
*   **Severity:** Medium
*   **Description:** Transpiler-generated variables use prefixes like `__t`, `__reg_`, and `__scope`. If user code defines a variable with the same name, it collides with compiler-generated code, corrupting execution state.
*   **Reproduction:**
    Compile a function that defines `let __reg_0 = 42;`.
*   **Proposed Fix:**
    Prepend all transpiler-generated variables with a unique random compilation prefix (e.g. `__fvm_a7b2c9_`). Add a validation pass to reject user variables starting with reserved prefixes.

### F-19: Nonce Store Memory Exhaustion (DoS)
*   **File:** `server/nonce-store.ts`
*   **Line:** ~6
*   **Severity:** High
*   **Description:** `InMemoryNonceStore` keeps consumed nonces in a map to prevent replays. However, the store has no entry count limits. An attacker flooding the server with random unique handshakes will grow the map infinitely, causing the Node process to crash from OOM.
*   **Reproduction:**
    Send continuous unique handshake headers.
*   **Proposed Fix:**
    Implement a hard entry limit (e.g. `100,000` nonces) and drop/reject incoming entries or evict the oldest expired entries when the size limit is exceeded.

### F-20: Cryptographic Session Key Zeroization Omission
*   **File:** `server/scrambler.ts`
*   **Severity:** High
*   **Description:** Ephemeral session keys and Diffie-Hellman secrets generated during payload encryption are kept in memory within Node.js `Buffer` objects without zeroization. A core dump or heartbleed-style memory exposure could leak these secrets.
*   **Proposed Fix:**
    Explicitly fill all cryptographic buffers with zeros (`key_buffer.fill(0)`) once payload processing is complete, including in error-handling paths.

### F-21: Concurrent Initialization Race in Client SDK
*   **File:** `packages/sdk/index.js`
*   **Line:** ~148
*   **Severity:** High
*   **Description:** In Node.js, when multiple `FortressClient` instances initialize concurrently, they attempt to write and delete the exact same temporary file `temp-worker.js`. This results in file-locking or file-not-found errors during parallel startup.
*   **Reproduction:**
    Execute `Promise.all([FortressClient.init(), FortressClient.init()])`.
*   **Proposed Fix:**
    Generate unique temporary filenames utilizing random prefixes (e.g., `temp-worker-[rand].js`) or use in-memory stream buffers for worker initialization.

### F-22: Client SDK Memory Leaks and Queue Blockage
*   **File:** `packages/sdk/index.js`
*   **Line:** ~266, ~225, Multiple
*   **Severity:** Medium
*   **Description:** 
    - Calling `dispose()` terminates the worker but leaves pending execution promises dangling in memory with their closures.
    - Fallback worker blob URLs are never revoked.
    - When a worker encounters an execution timeout or crashes, subsequent execution requests queue behind the dead worker and time out.
*   **Proposed Fix:**
    - Reject all pending promises during `dispose()` and clear the promise map.
    - Revoke the blob URL using `URL.revokeObjectURL(url)`.
    - Automatically terminate and rebuild the worker pool on timeout/crash events to restore queue execution.

---

## 3. Cryptographic Implementation Audit

We verified the cryptographic architecture against the threat model:

1.  **Constant-time Operations:**
    - Handshake signature verification uses Ed25519 signatures verified via `ed25519-dalek`, which uses constant-time comparisons.
    - Ephemeral Diffie-Hellman operations use X25519 via `x25519-dalek` which prevents timing attacks.
    - All session-level HMAC or verification checks must use `subtle::ConstantTimeEq` or constant-time comparison helper functions (e.g. `subtle` crate in Rust) to prevent timing-based side-channel leaks.
2.  **Signature Verification Order:**
    - Handshake headers are parsed and signatures verified *prior* to deriving the session key. This prevents attackers from driving key derivation blocks with unauthenticated inputs.
3.  **Key Material in Memory:**
    - Rust key material is correctly held in types implementing `Zeroize` and wrapped in guards to zeroize on drop.
    - Node.js key material needs zeroization fixes (as noted in F-20).
4.  **HKDF Domain Separation:**
    - The HKDF context string utilizes static distinct domains (e.g. `"fortress-wasm-session-key"`, `"fortress-wasm-payload-key"`). No user-controlled fields (such as client headers or page IDs) are interpolated into the derivation path without sanitization.
5.  **Random Number Quality:**
    - Ephemeral keys and scrambler nonces are generated via `getrandom::getrandom`. The `js` feature links with `crypto.getRandomValues` in browser/worker environments, assuring high entropy.

---

## 4. Information Disclosure Audit

1.  **Error Messages:**
    - Rust `VmError` strings are caught at the WASM boundary. The external output will be normalized to generic message structures, preventing internal stack traces or bytecode formats from leaking to HTTP clients.
2.  **Timing Info:**
    - Response padding is recommended to neutralize timing side channels on execution complexity.
3.  **HTTP Headers:**
    - Server headers are checked to ensure no framework fingerprinting (`X-Powered-By`, etc.) occurs.
4.  **SRI Hash Verification:**
    - Client-side code is verified to ensure it actively validates the WASM binary SRI hash against the predefined value before compiling.

---

## 5. Denial of Service Audit

1.  **Malformed Payload Sizes:**
    - Request sizes are limited at the Node server gateway to prevent memory allocation of huge payloads.
2.  **Deeply Nested FVM Objects:**
    - Hard serialization recursion limits (F-06) prevent nested stack crashes.
3.  **Instruction Amplification:**
    - Instruction execution limits (`MAX_INSTRUCTIONS = 10_000_000`) prevent CPU starvation.
4.  **Worker Thread Exhaustion:**
    - Rate limits and concurrency caps are placed on worker execution pools.

---

## 6. Dependency Audit (Cargo.lock & package-lock.json)

| Dependency (Rust) | Version | Status | Notes |
|:---|:---|:---|:---|
| `regex` | `1.12.3` | Pinned / Secure | Safe against catastrophic backtracking. |
| `fancy-regex` | `0.13.0` | Pinned / Secure | Catastrophic backtracking risk managed via pattern checks. |
| `serde_json` | `1.0.149` | Pinned / Secure | Configured with depth limit. |
| `getrandom` | `0.2.17` | Pinned / Secure | Correctly uses JS Web Crypto API. |
| `x25519-dalek` | `2.0.1` | Pinned / Secure | Cryptographically sound, implements Zeroize. |
| `ed25519-dalek` | `2.2.0` | Pinned / Secure | Signature verification secure. |
| `hkdf` | `0.12.4` | Pinned / Secure | Standard RFC 5869 implementation. |
| `sha2` | `0.10.9` | Pinned / Secure | Standard SHA-256 implementation. |
| `hmac` | `0.12.1` | Pinned / Secure | Verified constant-time verification. |
| `zeroize` | `1.8.2` | Pinned / Secure | Zeroization on drop validated. |

No dependencies in `package-lock.json` have critical/high CVEs under `npm audit --audit-level=moderate`.

---

## 7. Test Coverage Gap Analysis

The following gaps in existing test suites have been identified:
1.  **New Opcodes:** Missing tests for the boundary behavior of `ArrPush`, `ArrPop`, `ArrShift`, `ArrUnshift`, `StrictEq`, `StrictNeq`, `MathRandom`.
2.  **VM Errors:** Lack of propagation tests for `IndexOutOfBounds`, `StackOverflow`, `ExecutionLimitExceeded`.
3.  **SDK Errors:** Missing assertions for concurrent init, worker crash recovery, and execution timeout.
4.  **Security Tests:** Replay attacks, invalid signatures, expired handshakes.

These gaps will be addressed by custom adversarial tests in Phase 3.
