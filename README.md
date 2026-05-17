# Fortress WASM: Architectural Specification

> **Looking for the developer guide?** 
> If you are a developer looking to integrate Fortress WASM into your project to secure your requests, please read the [**Integration & Deployment Guide (`INTEGRATION_GUIDE.md`)**](./INTEGRATION_GUIDE.md).

Fortress WASM is a hardened, standalone bytecode virtual machine implemented in Rust and compiled to WebAssembly. Its primary objective is to facilitate secure, heavily obfuscated execution of application logic and to generate cryptographic request signatures within a protected memory sandbox. This architecture mitigates reverse-engineering, dynamic tampering, and automated bot attacks originating from the JavaScript host environment.

## 1. Compiler Pipeline & Payload Formatting

The TypeScript compiler (`compiler/`) translates a custom Javascript-like AST into a highly obfuscated proprietary bytecode format. The compilation pipeline employs two advanced dynamic mutation strategies to prevent static signature generation.

### 1.1 OpCode Polymorphism
The Instruction Set Architecture (ISA) mapping is strictly dynamic. 
- During compilation, the compiler generates a cryptographically random 256-byte translation map. 
- This map dictates the arbitrary binary byte values representing internal VM opcodes (e.g., `OpCode::Push` may be `0x4A` in build A, but `0xF1` in build B).
- The generated translation map is prepended to the emitted bytecode payload.
- Upon initialization, the WebAssembly engine dynamically inverts this translation map to restore the expected runtime mapping, completely frustrating disassemblers and static analysis.

### 1.2 Constant Pool Obfuscation
String literals and numeric constants are extracted into a serialized JSON constant pool.
- A randomized 1-byte XOR key is generated per compilation.
- The constant pool is fully XOR-obfuscated using this dynamic key.
- The XOR key is prepended to the obfuscated JSON string as a hex-encoded byte, guaranteeing that identical logic will produce wildly differing string payloads across unique builds.

## 2. Virtual Machine Architecture (ISA)

The VM (`crates/vm-core/`) operates as a stack-based machine executing the polymorphic bytecode. 

### 2.1 Execution Bounding & Resilience
To prevent host-induced Denial-of-Service via payload tampering, the engine implements strict execution bounding:
- **Stack Depth Limit:** Hard-capped at 1024 elements. Triggering `StackOverflow` aborts execution gracefully.
- **Recursion Limit:** The `CallFrame` stack is limited to a maximum depth of 64. Triggering `CallStackOverflow` prevents WASM heap exhaustion.
- **Instruction Bounds Checking:** The `read_byte` and `read_u32` internal macros strictly validate `Program Counter (PC)` bounds against the bytecode array length to prevent `panic!` termination during execution of malformed payloads.

### 2.2 Memory Model
Variables and complex types (Lists, Objects) utilize Rust's `Rc<RefCell<...>>` smart pointers. This enables full reference semantics within the VM stack, allowing shared object mutation across localized scope frames without allocating extraneous heap clones.

## 3. Cryptographic Derivation & Steganography

### 3.1 Steganography PRNG Flow
A standalone `crypto-core` crate implements a custom deterministic Pseudo-Random Number Generator to extract the hidden master key from a host image.
- **Algorithm:** Sequential SHA-256 derivation.
- **Flow:** `hash(seed_buf + counter_buf)`. The 32-byte digest provides exactly 8 coordinate pointers (4 bytes each) into the target image's RGBA pixel array before the counter iterates. This provides a cryptographically secure, unguessable sequence mapping the master key offsets.

### 3.2 HKDF Signing Key Derivation
Upon worker initialization, the engine consumes three input vectors: `stego_key`, `session_seed`, and `fingerprint`.
- **Key Passing:** Vectors are transferred across the WASM boundary strictly as `Box<[u8]>`. This transfers memory ownership to Rust and maps directly to the precise heap allocation instantiated by `wasm_bindgen`.
- **Expansion:** HKDF-SHA512 derives a 32-byte master signing key bound to the current `epoch_day`.
- **Cryptographic Zeroization:** Immediately following derivation, the `Box<[u8]>` inputs and the intermediate `ikm` and `salt` buffers are mathematically zeroized using the `zeroize` crate, eradicating the master key vectors from WASM linear memory prior to deallocation.

## 4. Payload Cryptographic Checksumming (Anti-Tamper)

Fortress WASM guarantees the integrity of execution logic by tethering the generated payload to the cryptographic signature.
- During `execute()`, the VM computes a SHA-256 digest of the combined polymorphic bytecode and the obfuscated constants array.
- This digest is stored securely within a thread-local execution context.
- During `sign_request()`, the engine appends the hex-encoded payload hash to the normalized request message body before applying the HMAC-SHA256 cipher.
- **Result:** An attacker modifying a single byte of the execution payload (e.g., swapping a `JumpIf` to a `Jump` to bypass an execution guard) inherently alters the `PAYLOAD_HASH`, thereby generating a mathematically invalid HMAC signature for the backend without terminating the client.

## 5. Build Deployment

```bash
# Compile the secure Rust engine
cd crates/vm-core
wasm-pack build --target web --out-dir ../../pkg/vm-core

# Compile Compiler and JS Boundary
cd ../../compiler
npx tsc
cd ../js-runtime
npx tsc
```
