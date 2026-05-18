# Security Model

This document provides a highly transparent, honest assessment of what Fortress WASM protects against, what its limitations are, and the exact threat model it was engineered for. In software security, overclaiming is worse than underclaiming. This engine is built to maximize the cost of reverse engineering, not to provide mathematical impossibility.

## What This Protects Against

**Linear Mixed Boolean-Arithmetic Solvers (Cryptic Bytes, 2024)**
Early obfuscation heavily relied on linear MBA substitutions for `Add` and `Sub` operations. We upgraded the system to Polynomial MBA, which expands the mathematical domain using pseudo-data dependencies, defeating linear solvers like Z3.

**ML AST Classification (WasmWalker, 2024)**
Machine learning classifiers fingerprint WebAssembly binaries by analyzing the frequency of AST paths. Naive "junk code" (like pushing and popping variables) creates a glaring statistical anomaly. We defeat this via AST Path Distribution Pollution, injecting context-aware, semantically valid operations that mimic real algorithmic flow into dead code blocks, permanently poisoning the classifier's frequency dataset.

**VPC-Sensitive Symbolic Emulation (PUSHAN, 2026)**
State-of-the-art trace-free deobfuscators like PUSHAN require a stable Virtual Program Counter (VPC) to symbolically emulate execution paths. We defeat this by fragmenting the program counter into `pc_base ^ pc_offset`, mutating the offset non-deterministically during execution to break emulation stability.

**Polynomial MBA Reduction (MBA-Blast, 2021; SiMBA, 2022; gMBA, 2025)**
Advanced academic solvers are built to tear down polynomial MBA. We defeat them by binding dummy variables—drawn uniformly at random from a diverse array of initialized local slots—into the mathematical expansion (`(z * z + z) & 1 == 0`). Because these variables are linked to disparate memory locations, they create artificial data dependencies that the solver cannot statically reduce without corrupting the taint graph.

**Program Synthesis (Loki, 2022)**
Synthesis attacks work by isolating standard instruction handlers (e.g., Load, then Add) and generating templates. We defeat this by fusing semantically unrelated stack and control-flow operations into mathematically opaque Superoperators (e.g., `JumpAndMul`), effectively neutralizing SMT-based synthesis lifting.

**Neurosymbolic Decompilation (StackSight, 2024)**
Emerging attacks use LLMs to infer logic based on static stack depth profiling. We defeat this via LLM Stack Poisoning. By injecting phantom `Swap`, `Rotate`, and `Drop2` opcodes into dead control flow blocks, we generate massive, non-monotonic spikes in the stack trace, severely corrupting the LLM's chain-of-thought variable mapping.

**Static VM Structure Detection (Static VM Detection, 2026)**
Static LLVM IR analysis easily identifies virtual machines by locating the central `switch` block with the highest number of successors. We defeat this by flattening the dispatcher into a native Function Pointer Array trampoline. The central switch block no longer exists.

**Payload Caching & Diffing (Code Renewability, 2020)**
Attackers frequently diff payloads across sessions to isolate dynamic variables. The `scramblePayload()` module generates a mathematically distinct payload per-request, featuring a fresh 256-byte translation map, a rolling 32-byte session key, and a randomized LSB image stride. Differential analysis yields zero usable data.

## What This Does NOT Protect Against

**Full Polynomial Substitution on All Operations**
While `Add` and `Sub` are protected by full non-linear polynomial MBA domain expansion, `Mul` and `Div` are currently only protected by a structural, pseudo-data-dependent linear MBA pass (`val + (dummy - dummy)`). While this successfully pollutes the static data flow graph by linking to random local slots, an advanced attacker explicitly targeting multiply-heavy logic could potentially isolate this linear pattern.

**Algorithmic Obscurity of LSB Steganography**
The 32-byte cryptographic session key is delivered via LSB steganography in a PNG pixel buffer. While we utilize a dynamic extraction stride generated from the `R` channel of the first pixel to defeat simple linear statistical scraping, the safety of this key relies partially on the attacker's ignorance of the specific extraction algorithm. If the attacker perfectly reverse-engineers the VM's extraction loop, the session key is compromised.

**White-Box Cryptography Limitations**
Software-only protection cannot achieve the security of hardware enclaves. We rely on the JIT sliding decryption window to mitigate memory scraping, but as of 2026, there are no unbroken, practical white-box implementations of standard symmetric encryption. Given unlimited time, a dedicated nation-state or hyper-resourced attacker can physically step through the execution and dump memory page by page. 

## Threat Model Assumptions

**Capabilities we assume the attacker HAS:**
- Full, unrestricted access to the browser's developer tools and the client environment.
- The ability to intercept, log, and manipulate all HTTP traffic and WebAssembly initialization arguments.
- Access to modern automated static and dynamic analysis frameworks (e.g., WABT, Z3, angr, specialized Wasm lifters).
- The ability to read raw memory dumps of the Wasm linear memory during execution.

**Capabilities we assume the attacker DOES NOT HAVE:**
- The ability to compromise the backend server that generates the randomized `scramblePayload()` responses.
- An infinite time horizon. (Our goal is to make the economic and temporal cost of reverse-engineering the binary exceed the value of the proprietary logic inside it).

**Why these assumptions are reasonable:**
This system was built to protect high-value business logic in a client-facing web application. In commercial espionage or IP theft, attackers are economically motivated. They seek to use automated tooling to extract logic quickly and cheaply. By mathematically neutralizing the automated tools (solvers, classifiers, symbolic executors) and forcing the attacker into manual, step-by-step memory scraping across heavily obfuscated, continually renewing code, we drastically alter the economics of the attack.
