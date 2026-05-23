# Security Model

This document provides a highly transparent, honest assessment of what Fortress WASM protects against, what its limitations are, and the exact threat model it was engineered for. In software security, overclaiming is worse than underclaiming. This engine is built to maximise the cost of reverse engineering, not to provide mathematical impossibility.

*Note: Following the final security hardening phases, a comprehensive functional correctness audit was conducted (May 2026). This audit systematically verified that the advanced obfuscation layers do not compromise the underlying runtime stability. All core architectural integration paths, 32-bit WASM integer boundary constraints, and edge-case syntax parsers have been fully hardened. This ensures the system is not only highly resistant to automated deobfuscation but also entirely production-ready and semantically reliable under heavy execution loads.*

---

## What This Protects Against

**Linear Mixed Boolean-Arithmetic Solvers (Cryptic Bytes, 2024)**
Early obfuscation heavily relied on linear MBA substitutions for `Add` and `Sub` operations. We upgraded the system to Polynomial MBA, which expands the mathematical domain using pseudo-data dependencies, defeating linear solvers like Z3.

**ML AST Classification (WasmWalker, 2024)**
Machine learning classifiers fingerprint WebAssembly binaries by analysing the frequency of AST paths. Naive "junk code" (like pushing and popping variables) creates a glaring statistical anomaly. We defeat this via AST Path Distribution Pollution, injecting context-aware, semantically valid operations that mimic real algorithmic flow into dead code blocks, permanently poisoning the classifier's frequency dataset.

**VPC-Sensitive Symbolic Emulation (PUSHAN, 2026)**
State-of-the-art trace-free deobfuscators like PUSHAN require a stable Virtual Program Counter (VPC) to symbolically emulate execution paths. We defeat this by fragmenting the program counter into `pc_base ^ pc_offset`, mutating the offset non-deterministically during execution to break emulation stability.

**Polynomial MBA Reduction (MBA-Blast, 2021; SiMBA, 2022; gMBA, 2025)**
Advanced academic solvers are built to tear down polynomial MBA. We defeat them by binding dummy variables—drawn uniformly at random from a diverse array of initialised local slots—into the mathematical expansion (`(z * z + z) & 1 == 0`). Because these variables are linked to disparate memory locations, they create artificial data dependencies that the solver cannot statically reduce without corrupting the taint graph.

**Program Synthesis (Loki, 2022)**
Synthesis attacks work by isolating standard instruction handlers (e.g., Load, then Add) and generating templates. We defeat this by fusing semantically unrelated stack and control-flow operations into mathematically opaque Superoperators (e.g., `JumpAndMul`), effectively neutralising SMT-based synthesis lifting.

**Neurosymbolic Decompilation (StackSight, 2024)**
Emerging attacks use LLMs to infer logic based on static stack depth profiling. We defeat this via LLM Stack Poisoning. By injecting phantom `Swap`, `Rotate`, and `Drop2` opcodes into dead control flow blocks, we generate massive, non-monotonic spikes in the stack trace, severely corrupting the LLM's chain-of-thought variable mapping.

**Static VM Structure Detection (Static VM Detection, 2026)**
Static LLVM IR analysis easily identifies virtual machines by locating the central `switch` block with the highest number of successors. We defeat this by flattening the dispatcher into a native Function Pointer Array trampoline. The central switch block no longer exists.

**Payload Caching & Diffing (Code Renewability, 2020)**
Attackers frequently diff payloads across sessions to isolate dynamic variables. The scrambler generates a mathematically distinct payload per-request, featuring a fresh 256-byte translation map, a rolling 32-byte session key derived via Ephemeral Authenticated Key Exchange (EAKE), and a randomised handshake header. Differential analysis yields zero usable data.

**Ephemeral Authenticated Key Exchange (EAKE)**
Fortress WASM negotiates ephemeral session keys via X25519 and verifies them with Ed25519 signatures, preventing Man-in-the-Middle (MITM) attacks and passive eavesdropping. Ed25519 signing keys are derived server-side via Argon2id from `FORTRESS_SIGNING_PASSWORD` and salt in `server/.signing_params` using memoryCost: 65536, timeCost: 3, parallelism: 1.

**NonceStore & Replay Protection**
The server scrambler checks nonces against an in-memory or Redis-backed NonceStore. This enforces a strict 5-minute replay window on timestamp validation, preventing replay attacks where old headers are reused to execute the VM.

**VM Constant-Time Signature Verification**
The VM uses the `subtle` crate and constant-time comparison loops to verify the handshake signature and timestamp. This prevents side-channel timing leaks that would otherwise reveal portions of cryptographic signatures or secrets.

**Branchless Bounds Decryption**
During JIT page decoding, all conditional jumps/branches for boundary checks are eliminated. We use a bitwise bounds mask (`mask = (in_bounds as u8).wrapping_neg()`), which ensures constant-time decoding execution and prevents branch-prediction side channels.

**HMAC-SHA256 VirtSC Checksumming**
To ensure payload integrity, Fortress WASM employs keyed HMAC-SHA256 (replacing simple unkeyed SHA-256) using `base_key_material` derived via HKDF-SHA256. If the payload is modified, the signature validation fails immediately.

**Zeroization (Memory Hardening)**
To defend against client memory-scraping, the VM explicitly zeroizes sensitive key materials and memory regions (`base_key_material`, `session_key`, `code`, `ves`, `opcode_map`) immediately upon verification failure or execution completion using the `zeroize` crate.

**Production FFI Execution Shortcutting**
To prevent attackers from bypassing the handshake verification by executing plain canonical payloads directly in the production VM target, the interpreter FFI wrapper strictly checks for the successful derivation of the session key through a valid handshake header when compiled under production (`not(feature = "dev")`) targets, immediately throwing a `MissingSessionKey` error if the key is absent.

**V8 TurboFan JIT Optimisation (Polynomial Parity Locks)**
Optimizing compilers (specifically V8 TurboFan) use aggressive Range Analysis, Type Feedback, Constant Folding, and Strength Reduction to optimize arithmetic structures. To prevent JIT engines from optimizing away our Mixed Boolean-Arithmetic (MBA) obfuscations, we implement Polynomial Parity Locks using non-linear math constraints:
- **Parity Analysis Defeat**: The term `(z * z + z) & 1` is mathematically equivalent to `0` for any integer `z`. However, V8 TurboFan's range analysis only tracks integer boundaries ($[min, max]$) and is incapable of tracking parity properties (congruence modulo 2). Consequently, the compiler cannot statically fold this expression to `0` and is forced to generate native instructions for the multiplication, addition, and bitwise operations.
- **Nesting Depth Expansion**: By nesting these locks to two levels using two distinct dummy variables (`z1` and `z2`), the JIT compiler's Graph of Nodes grows quadratically in complexity, resisting dead node collapsing.
- **Deterministic Dummy Offsets**: Dummy variables are resolved deterministically using modulo index shifts (`z2Idx = (z1Idx + 1) % len`) from the initialized dummy variables array, avoiding runtime rejection sampling and ensuring deterministic execution that prevents test-suite hangs when `Math.random` is mocked.

**Division Polynomial MBA Obfuscation**
Integer division `/` is protected by non-linear polynomial MBA obfuscation. First, a quadratic domain-expansion term `((z * z + z) & 1) * x` is injected to introduce non-linear data dependencies on dummy variables. Second, the division result is XORed with a self-canceling term `result ^ (dummy1 & dummy2) ^ (dummy1 & dummy2)`. This wraps division in a non-linear domain expansion and prevents symbolic solvers or automated deobfuscators from trivially folding or isolating the operation.

---

## What This Does NOT Protect Against

**Active Client Tampering**
EAKE (X25519 & Ed25519) combined with the NonceStore provides strong protection against eavesdropping, MITM, and replay attacks. However, if an attacker has fully compromised the client-side environment, they can intercept the negotiated session key from WebAssembly memory before it is zeroized, or bypass the verification logic entirely by patching the compiled WASM binary.

**White-Box Cryptography Limitations**
Software-only protection cannot achieve the security of hardware enclaves. We rely on the JIT sliding decryption window to mitigate memory scraping, but as of 2026, there are no unbroken, practical white-box implementations of standard symmetric encryption. Given unlimited time, a dedicated nation-state or hyper-resourced attacker can physically step through the execution and dump memory page by page. 

---

## Threat Model Assumptions

**Capabilities we assume the attacker HAS:**
- Full, unrestricted access to the browser's developer tools and the client environment.
- The ability to intercept, log, and manipulate all HTTP traffic and WebAssembly initialisation arguments.
- Access to modern automated static and dynamic analysis frameworks (e.g., WABT, Z3, angr, specialised Wasm lifters).
- The ability to read raw memory dumps of the Wasm linear memory during execution.

**Capabilities we assume the attacker DOES NOT HAVE:**
- The ability to compromise the backend server that generates the randomised `scramblePayload()` responses.
- The ability to compromise the server's private Ed25519 signing key or bypass the NonceStore checks (e.g., by predicting nonces or bypassing the 5-minute replay window).
- The ability to bypass the zeroization process (keys are wiped immediately upon verification failure or execution completion, leaving a minimal window for memory scraping).
- The ability to execute timing side-channel attacks on signature checks due to constant-time execution.
- An infinite time horizon. (Our goal is to make the economic and temporal cost of reverse-engineering the binary exceed the value of the proprietary logic inside it).

**Why these assumptions are reasonable:**
This system was built to protect high-value business logic in a client-facing web application. In commercial espionage or IP theft, attackers are economically motivated. They seek to use automated tooling to extract logic quickly and cheaply. By mathematically neutralising the automated tools (solvers, classifiers, symbolic executors) and forcing the attacker into manual, step-by-step memory scraping across heavily obfuscated, continually renewing code, we drastically alter the economics of the attack.
