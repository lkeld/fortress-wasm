# Fortress WASM Architecture

This document outlines the four primary architectural pillars of the Fortress WASM engine. The system is designed to provide comprehensive defence-in-depth against modern WebAssembly reverse engineering tools, specifically symbolic execution, constraint solvers, and LLM-assisted decompilers.

---

## 1. The Build Pipeline

```mermaid
graph TD
    A[generate_isa.js] -->|Shuffles 0-255| B[Randomized OpCode Enums]
    B -->|Exports to| C(TypeScript Compiler)
    B -->|Exports to| D(Rust VM Core)
    B -->|Generates| E(dispatch_table.rs)
    
    F[Source Logic .fvm] -->|AST Traversal| C
    C -->|Thunk Injection & MBA| G[Base Bytecode .fvbc]
    C -->|Encoded Map| H[opcode_map.json]
    
    I[Scrambler Module] -->|Ingests| G
    I -->|Ingests| H
    I -->|Derives| J[32-Byte Session Key]
    I -->|Rolling XOR| K[Scrambled Payload]
    I -->|Dynamic Modulus LSB| L[key.png]
    I -->|Translation Layer| M[Client opcode_map.json]
```

### Architectural Rationale
The build pipeline enforces **Code Renewability** (Abrath et al., *Code Renewability for Native Software Protection*, arxiv.org/abs/2003.00916). Standard compilers generate a static ISA, allowing attackers to write automated lifters (e.g., mapping `0x20` to `LocalGet`). Fortress WASM breaks this by using a Fisher-Yates shuffle in `generate_isa.js` to randomise the canonical opcode map on every single build. 

Furthermore, the Scrambler generates a secondary translation layer per request. It encrypts the base `.fvbc` payload with a 32-byte rolling XOR key, embeds the key dynamically into a PNG image using LSB steganography, and generates a fresh runtime mapping. This makes caching, signature matching, and payload diffing mathematically impossible.

---

## 2. Runtime Execution Flow

```mermaid
graph TD
    A[Client Request] --> B[Receive scrambled.fvbc, key.png, map.json]
    B --> C[Extract Pixel Buffer]
    C --> D{LSB Steganography Decoder}
    D -->|Read R Channel of Pixel 0| E[Derive Stride Modulus]
    E -->|Extract across RGB| F[Reconstruct 32-Byte Session Key]
    
    F --> G[Initialize VM]
    G --> H[VirtSC Hash Check]
    H -->|Match| I[Enter Trampoline Dispatcher]
    H -->|Mismatch| J[Silent Key Corruption]
```

### Architectural Rationale
The runtime extraction specifically addresses static key extraction vulnerabilities. By deriving the LSB extraction stride dynamically from the randomised `R` channel of the first pixel, the system removes any fixed mathematical anchor for an attacker to bootstrap from. 

The **VirtSC Hash Check** (Ahmadvand et al., *VirtSC: Combining Virtualisation Obfuscation with Self-Checksumming*, arxiv.org/abs/1909.11404) guarantees payload integrity. If an attacker byte-patches the scrambled `.fvbc` file to inject malicious instructions or alter control flow, the pre-execution SHA-256 hash check fails. Rather than throwing an overt error—which an attacker could trace and bypass—it silently corrupts the 32-byte session key. When the JIT decryption window reaches the patched section, it decrypts garbage opcodes, causing a silent and untraceable crash.

---

## 3. JIT Sliding Decryption Window

```mermaid
graph TD
    A[Program Counter Offset] --> B{Crossed 256-Byte Page?}
    B -->|Yes| C[Clear Previous Page Plaintext]
    C --> D[Calculate New XOR Offset]
    D --> E[Decrypt New Page with Session Key]
    E --> F[Execute]
    B -->|No| F
```

### Architectural Rationale
A standard defence against packed or encrypted binaries is a runtime memory dump—waiting until the VM decrypts the payload and scraping the raw memory. To defeat this, Fortress WASM uses a **Sliding Decryption Window**.

The bytecode is conceptually divided into 256-byte pages. As the Virtual Program Counter (VPC) advances, the VM decrypts only the current page in a highly localised buffer using the rolling 32-byte XOR session key. When execution crosses a page boundary, the previous plaintext is explicitly cleared from memory. At any given instant, a maximum of 256 bytes is exposed, rendering bulk memory dumping useless.

---

## 4. Function Pointer Dispatch Table

```mermaid
graph TD
    A[Microscopic Trampoline Loop] --> B[Fetch Encrypted Byte]
    B --> C[Translate via opcode_map]
    C --> D[Index into Function Pointer Array]
    D -->|O(1) Indirect Call| E[Handler Function]
    E -->|Returns bool| A
```

### Architectural Rationale
The traditional `switch-case` or `match` block is the universal structural fingerprint of a virtual machine. Static LLVM IR analysis tools (e.g., Authors of Static VM Detection, *Static Detection of Core Structures in Tigress Virtualisation-Based Obfuscation Using an LLVM Pass*, arxiv.org/abs/2601.12916) easily identify dispatchers by searching for the basic block with the highest number of successors.

To utterly destroy this heuristic, we decentralised the dispatcher. The `generate_isa.js` script dynamically emits a flat, 256-element array of function pointers (`dispatch_table.rs`) mapping every randomised opcode byte to a statically isolated handler. The central loop is reduced to a microscopic trampoline that simply indexes into this array and performs an indirect call. The single, high-successor-count switch block no longer exists in the compiled binary.
