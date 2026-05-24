# Security Model & Hardening

Fortress WASM is designed under a zero-trust model regarding the client host. It assumes the browser execution environment is fully compromised, and the host has access to local variables, debugger hooks, and memory dumps.

## Cryptographic Key Exchange

To prevent static extraction of bytecode and mappings, Fortress WASM coordinates an active key exchange:

1. **X25519 Ephemeral Key Exchange**: The server and client generate a shared session key on demand.
2. **Ed25519 Handshake Signature**: The server signs the handshake header using a private key derived from `FORTRESS_SIGNING_PASSWORD` via Argon2id. This guarantees that only authentic, untampered payloads run.
3. **LSB Steganographic Carrier**: The cryptographic session key is embedded into a PNG image using a dynamically computed prime stride, preventing standard static analysis scripts from extracting the key.

## Execution Isolation

- **Rolling XOR Cipher**: Payload bytes are encrypted on the server with a rolling XOR key.
- **JIT Sliding Decryption**: Instead of decrypting the entire binary into memory at startup, the FVM interpreter decrypts instructions in a small rolling sliding window directly preceding execution, minimizing the lifetime of plaintext bytecode in browser memory.
- **Randomized ISA**: The FVM maps instructions to completely different, randomized opcode numbers on every build, defeating static decompiler signatures.

## Defending Against the Academic Literature

Fortress WASM contains explicit, named countermeasures for 13 distinct academic attack methodologies:

1. **WASMixer constant pool elimination**: Replaces constant pools with on-demand decrypted inline values.
2. **Linear MBA Solvers evasion**: Employs Mixed Boolean-Arithmetic expressions to obscure arithmetic.
3. **Symbolic execution path explosion**: Injects opaque control-flow predicates.
4. **Static key extraction**: Employs ephemeral key exchange.
5. **VPC emulation detection**: Program counter base fragmentation.
6. **SMT Solver simplification**: Polynomial non-linear MBA and domain expansion.
7. **ML AST fingerprinting**: AST Path Distribution Pollution (valid dead blocks).
8. **Monolithic dispatcher profiling**: Decentralizes interpreters and duplicates handlers.
9. **String brute-force scrapers**: Integrates 4-byte nonces with 32-byte keys.
10. **Automated synthesis (Loki)**: Merges stack and control-flow logic.
11. **LLM Chain-of-Thought (StackSight)**: Poisoning stack profiles with phantom spikes.
12. **Differential payload audits**: Automatically renews maps, keys, and strides per-request.
13. **Dispatcher LLVM switch profilers**: Eliminates main switches in favor of function pointer trampolines.
