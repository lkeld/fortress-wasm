# JS-to-FVM Transpiler Capability Matrix

This document provides a detailed capability matrix for the JS-to-FVM transpilation pipeline, detailing supported language features, compiler transformations, optimizations, and syntax limitations.

## Feature Support Matrix

| Category | JavaScript Feature | Support Level | Implementation details / FVM Mapping |
|---|---|---|---|
| **Memory & Buffers** | `SharedArrayBuffer` | Supported | Emulated via list-based structures in FVM. Pre-compiled mock factory helper (`SharedArrayBuffer_new`) injected. Generated `jsWrapper` includes comment indicating replacement with message-passing equivalent. |
| | TypedArrays | Supported | `Int8Array`, `Uint8Array`, `Uint8ClampedArray`, `Int16Array`, `Uint16Array`, `Int32Array`, `Uint32Array`, `Float32Array`, `Float64Array` are supported and mapped to FVM list-based structures. `preparePayload` converts views using `Array.from`. |
| | `Atomics.*` | **Unsupported** | Blocked at compile-time to enforce security boundaries and prevent concurrent memory access vulnerabilities. |
| **Compiler Transformations** | Large Function Splitting | Supported | Functions containing >1000 statements are analyzed for variable dependencies. If a clean boundary is found (variable write/declaration and read intersection is empty), it is split into `_part1` and `_part2` which return `{ returned: boolean, value: any }` and run sequentially. If no clean boundary is found, it falls back to single compilation with a warning. |
| | Register Banking | Supported | For functions with >256 parameters/locals, a greedy graph-coloring liveness analysis maps variables to virtual registers (`__reg_N`). If allocated registers exceed 256, the function is automatically split at the point of register exhaustion. |
| **Object Model** | `Proxy` | Supported | Supports traps like `get`/`set` validation traps, emulating native proxy behavior in VM. |
| | `Reflect` | Supported | Maps Reflect APIs (e.g. `Reflect.get`, `Reflect.set`, `Reflect.ownKeys`) to VM equivalents. |
| | `Symbol` | Supported | Emulated with unique identifiers to support symbol behavior. |
| **Advanced Control Flow** | Generators | Supported | Transpiled into stateful iterator functions compatible with FVM stack design. |
| | Closures & Scope | Supported | Flat-scope resolution with lifetime checking; supports nested lexical closures. |
| | Dynamic `eval` | Supported | Handles static JSON literal rewrites and dynamic eval boundary splitting. |

## Detailed Capabilities

### 1. SharedArrayBuffer & TypedArrays
When a TypedArray or `SharedArrayBuffer` constructor is detected in the AST traversal:
- The transpiler sets `hasSharedArrayBuffer = true`.
- Emulated helpers (`SharedArrayBuffer_new`, `TypedArray_new`, etc.) are appended to the extra declarations list so they compile down to VM list structures.
- **View Sharing & Synchronization**: SharedArrayBuffer instances return a common buffer. Multiple views referencing the same SharedArrayBuffer share the underlying buffer array. Modifying elements triggers memory synchronization (`syncing` flag and loop) across all active views via custom helper procedures like `ReflectSet`.
- **Pre-populated Arguments & Mutability Isolation**: If a TypedArray is instantiated with a standard JS array or object payload (non-SAB), the data is cloned element-by-element using a new list and a `listPush` loop. This prevents subsequently-mutated JS arrays from leaking changes into the VM memory space.
- A warning/comment is prepended to the generated `jsWrapper` for all return paths:
  `// SharedArrayBuffer usage detected: shared memory is replaced with message-passing equivalent.`
- `Atomics` calls are prohibited at compile time and raise a `TypeError: Atomics is not supported`.
- Payload preprocessing converts TypedArrays into standard arrays using `Array.from(obj)`.

### 2. Large Function Auto-Splitting
Functions that exceed the 1000 statement threshold are automatically analyzed:
- **Linear Performance Splitting**: Rather than performing quadratic nested traversals, the compiler uses a linear O(N) scan using prefix and suffix sets of statements. It calculates the written/declared and read sets for each statement in a single pass, constructs a list of suffix reads, and scans forward checking for empty intersections with the prefix writes in O(N) time.
- If a split point is found, the function splits into `_part1` and `_part2`, coordinated by a master function.
- If no clean split is possible, a compilation warning is generated and it is compiled as one function.

### 3. Register Banking
Functions with high variable count (>256 variables) undergo greedy register allocation:
- **Lexical Block Scope Deconfliction**: Prior to register banking, a scope-deconfliction pass (`deconflictScopes`) crawls nested block scopes and renames variables that shadow/conflict declarations in parent scopes using Babel's `path.scope.rename` to ensure graph-coloring runs safely.
- A liveness analysis constructs an interference graph of local variables.
- A graph coloring algorithm assigns variables to registers starting from `__reg_0`.
- **Recursive Parameter Filtering**: If register allocation exceeds 256, the compiler splits the function and recursively applies register banking. To prevent parameter overflow and infinite recursion, the parameters of the split sub-functions (and matching call arguments) are filtered to include only the parameters actually read/written in their respective bodies.
- If the register pressure exceeds 256, the compiler splits the function at the exhaustion point, propagating variables to the next segment via state wrappers.
