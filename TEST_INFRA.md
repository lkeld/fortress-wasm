# E2E Test Infra: fortress-wasm

## Test Philosophy
- Opaque-box, requirement-driven. No dependency on implementation design.
- Methodology: Category-Partition + Boundary Value Analysis (BVA) + Pairwise Combinatorial Testing + Real-World Workload Testing.

## Feature Inventory
| # | Feature | Source (requirement) | Tier 1 | Tier 2 | Tier 3 |
|---|---------|---------------------|:------:|:------:|:------:|
| 1 | F1: Arithmetic & Variables | R1, R5 | 5 | 5 | ✓ |
| 2 | F2: Control Flow | R3 | 5 | 5 | ✓ |
| 3 | F3: Data Structures & Builtins | R1 | 5 | 5 | ✓ |
| 4 | F4: Cryptography & Security | R2, R3, R4 | 5 | 5 | ✓ |

## Test Architecture
- **Test Runner**: Located in `tests/e2e/runner.js`. Invoked via `node tests/e2e/runner.js`.
- **Test Cases**: Defined as JSON-like or JS objects containing `source` (.fvm code), `inputs` (argument array), `expected` (value or error code), and `devOnly` / `prodOnly` flags.
- **Pass/Fail Semantics**: The runner compiles the source, scrambles it (in both DEV_MODE=true and DEV_MODE=false contexts where applicable), feeds inputs to the VM, and asserts that the returned value matches the expected output or matches the expected error code.
- **Layout**:
  - `tests/e2e/runner.js` - Test harness & runner logic.
  - `tests/e2e/cases.js` - List of test definitions (Tiers 1-4).

## Test Case Detailed Design

### Tier 1 - Feature Coverage (5 per feature, 20 total)
- **F1.1: Simple Integer Addition**: Compiles and executes `return 15 + 27;`, checks return is `42`.
- **F1.2: Simple Integer Subtraction**: Compiles and executes `return 50 - 8;`, checks return is `42`.
- **F1.3: Simple Integer Multiplication**: Compiles and executes `return 6 * 7;`, checks return is `42`.
- **F1.4: Simple Integer Division**: Compiles and executes `return 84 / 2;`, checks return is `42`.
- **F1.5: Variable Binding**: Compiles `let x = 10; let y = 20; return x + y;`, checks return is `30`.
- **F2.1: If Consequent**: `if (true) { return 1; } else { return 0; }`, checks return is `1`.
- **F2.2: If Alternate**: `if (false) { return 1; } else { return 0; }`, checks return is `0`.
- **F2.3: While Loop Counter**: `let i = 0; while (i < 5) { i = i + 1; } return i;`, checks return is `5`.
- **F2.4: For Loop Counter**: `let sum = 0; for (let i = 0; i < 5; i++) { sum = sum + i; } return sum;`, checks return is `10`.
- **F2.5: Comparison Operations**: `return (5 > 3) && (2 < 4) && (3 == 3) && (3 != 4) && (3 <= 3) && (3 >= 3);`, checks return is `true`.
- **F3.1: List Creation & Push**: `let l = [1, 2]; return l;`, checks return is `[1, 2]`.
- **F3.2: Object Creation & Member Access**: `let o = { a: 1, b: 2 }; return o.a + o.b;`, checks return is `3`.
- **F3.3: Length Operator**: `let l = [1, 2, 3]; return len(l) + len("hello");`, checks return is `8`.
- **F3.4: String Concat**: `return concat("foo", "bar");`, checks return is `"foobar"`.
- **F3.5: JSON Stringify**: `let o = { val: 42 }; return json_stringify(o);`, checks return is `"{\"val\":42}"`.
- **F4.1: SHA-256 Hashing**: `return hash256("test");`, checks return is SHA-256 hash of "test".
- **F4.2: AES-GCM Encryption**: `return encrypt_aes("hello", "secretkey1234567secretkey1234567");`, checks return is valid hex string.
- **F4.3: WebGL Fingerprint Call**: `return __native_call(1);`, checks return matches expected.
- **F4.4: Canvas Fingerprint Call**: `return __native_call(2);`, checks return matches expected.
- **F4.5: Automation Check Call**: `return __native_call(3);`, checks return matches expected.

### Tier 2 - Boundary & Corner Cases (5 per feature, 20 total)
- **F1.6: Complex Operator Precedence**: `return 1 + 2 * 3 - 4 / 2;`, checks return is `5`.
- **F1.7: Float Addition/Subtraction**: `return 1.5 + 2.25;`, checks return is `3.75`.
- **F1.8: Division by Zero**: `return 10 / 0;`, checks returns `DivisionByZero` error.
- **F1.9: Load Uninitialized Variable**: `let x; return x;` or accessing unset variable, checks returns `Null` or fails gracefully.
- **F1.10: Large Integer Bounds**: `let x = 9007199254740991; return x + 1;`, checks VM capability or boundaries.
- **F2.6: Nested If Statements**: `if (true) { if (false) { return 1; } else { return 2; } } else { return 3; }`, checks return is `2`.
- **F2.7: Loop Zero Iterations**: `let i = 0; while (false) { i = i + 1; } return i;`, checks return is `0`.
- **F2.8: Boolean Logic Combinations**: `return true && false || !false;`, checks return is `true`.
- **F2.9: For Loop Empty Components**: `let i = 0; for (; i < 3; ) { i++; } return i;`, checks return is `3`.
- **F2.10: Gas Metering Timeout**: `while (true) {}`, checks returns `ExecutionLimitExceeded` error.
- **F3.6: List Index Out of Bounds**: `let l = [1, 2]; return l[5];`, checks returns `IndexOutOfBounds` error.
- **F3.7: Object Non-existent Member**: `let o = { a: 1 }; return o.b;`, checks returns `Null` (or default value).
- **F3.8: Deeply Nested Structures**: `let o = { a: [1, { b: 3 }] }; return o.a[1].b;`, checks return is `3`.
- **F3.9: String Char Access Indexing**: `let s = "hello"; return s[1];`, checks return is `"e"`.
- **F3.10: Empty String/List Concat**: `return concat("", "");`, checks return is `""`.
- **F4.6: Hash Number/Bool**: `return hash256(123) + hash256(true);`, checks return value matches VM type coercion.
- **F4.7: AES-GCM Key Truncation**: `return encrypt_aes("hello", "shortkey");`, checks return is valid.
- **F4.8: Unknown Native Call ID**: `return __native_call(99);`, checks returns unknown native call error.
- **F4.9: Native Call Multi-arguments**: `return __native_call(4, 1, 2);`, checks return matches expected screen metrics.
- **F4.10: Timing-based Anti-debugging**: (Simulated in runner/worker context to verify breakpoint timing corrupts initialization).

### Tier 3 - Cross-Feature Combinations (4 total)
- **T3.1: Fibonacci (F1 + F2)**: Computes Fibonacci(7) via iteration and variables. Expected: `13`.
- **T3.2: List Processing Loop (F2 + F3)**: Iterate over list `[1, 2, 3, 4]`, doubling values, return new list. Expected: `[2, 4, 6, 8]`.
- **T3.3: Object Hash & Serialization (F3 + F4)**: Stringifies object `{ data: "hello" }` and returns its SHA-256 hash.
- **T3.4: Dynamic Screen Metric Bounds (F1 + F4)**: Queries screen metrics via `__native_call(4)` and verifies aspect ratio is greater than zero using division.

### Tier 4 - Real-World Application Scenarios (5 total)
- **T4.1: Authentication Handshake Challenge**: Simulates generating a payload containing a client ID, random nonce, hashing, encrypting it with a session key, and returning the ciphertext.
- **T4.2: Dashboard Session Metrics Processing**: Process a list of coaching sessions with ratings and status, filtering active sessions, calculating average ratings, and returning a summary report object.
- **T4.3: VM Self-Checksumming & Anti-Tamper**: Runs bytecode, but manually alters a byte of the payload after hashing but before VM execution, verifying the VM key becomes silently corrupted.
- **T4.4: Full Client Telemetry Collection**: Accesses Canvas, WebGL, automation status, and screen metrics, combines into a single payload, stringifies, hashes, and signs it.
- **T4.5: Session Renewability Integrity**: Scrambles the same source code twice, producing different payload bytes and distinct PNG buffers, and verifies both executions in the VM produce identical functional results.

## Coverage Thresholds
- **Tier 1 (Feature Coverage)**: ≥5 per feature (Total: 20)
- **Tier 2 (Boundary & Corner)**: ≥5 per feature (Total: 20)
- **Tier 3 (Cross-Feature Combinations)**: ≥4 combinations (Total: 4)
- **Tier 4 (Real-World Scenarios)**: ≥5 application scenarios (Total: 5)
- **Total Minimum**: 49 tests.
