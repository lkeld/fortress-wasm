# Project: Fortress WASM CLI and Compiler Scanner Hardening

## Architecture
- **create-fortress-app**: Scaffolding and setup CLI tool under `packages/create-fortress-app`.
- **fortress build**: Code scanning and compiler driver under `compiler/src/scanner.ts` and `bin/index.js`.
- **classifyFile**: Source code classifier module under `packages/create-fortress-app/lib/classify-file.js` analyzing files into CLIENT, SERVER, AMBIGUOUS, TYPES_ONLY, or UNKNOWN.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Sub-package Version Sync | Sync `create-fortress-app` version, implement `sync-versions.js`, add preversion hook | none | DONE (345a8b23-d22d-4e6b-945c-16d7f027c8ba) |
| 2 | AST Parser Upgrades & Exit Codes | Configure Babel parser plugins in `scanner.ts`, replace `extractBlock` with AST extraction, correct exit codes on scan failure | none | DONE (4c80b324-58da-4620-85a3-97e1a901eadb) |
| 3 | File Picker & Classification | Implement `classify-file.js`, integrate with file picker, add warning badges and import graph traversal | M1 | PLANNED |
| 4 | CLI UX, isolated-vm, Circular Dep & Auto-protect | Update post-scaffold next steps, remove isolated-vm prompt, remove root self-dependency, protect auto-detection enhancements | M2, M3 | PLANNED |
| 5 | Full Verification Gate | Run cargo unit tests and npm verification suites | M4 | PLANNED |

## Interface Contracts
- **`sync-versions` CLI tool**: Validates and updates version mappings between root package.json and packages.json in monorepo directories.
- **`classifyFile` API**: Receives file path and project root, returns classification string (`CLIENT` | `SERVER` | `AMBIGUOUS` | `TYPES_ONLY` | `UNKNOWN`).
