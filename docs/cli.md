# Command Line Interface (CLI)

Fortress WASM provides a robust developer-oriented CLI tool to compile, live-watch, and cryptographically audit your application code.

## Commands

### 1. `fortress build`

Scans and compiles annotated functions in parallel.

- **Usage**: `fortress build` or `node bin/index.js build`
- **Behavior**:
  - Automatically loads the local `fortress.config.js` configuration file.
  - Recursively finds all source files under the target paths.
  - Spawns parallel worker threads to scan files for `@protect` annotations.
  - Transpiles JS/TS to custom obfuscated FVM bytecode.
  - Emits `.fvbc` files and randomized translation `.opcodes.json` files to your configured output directory.

---

### 2. `fortress dev`

Starts the developer server in watch mode.

- **Usage**: `fortress dev` or `node bin/index.js dev`
- **Behavior**:
  - Launches an HTTP server serving the compiled Web Worker and payloads.
  - Implements a Port Conflict Solver that automatically increments the port if the configured port is busy (up to 100 attempts).
  - Establishes recursive directory watchers to observe changed files.
  - Leverages config hot-reloading: changes to `fortress.config.js` will tear down existing watchers and reload configurations dynamically.
  - Intercepts directory changes gracefully, resolving the actual modified file before calling the scanner to avoid watcher crashes.

---

### 3. `fortress verify`

Runs a security and integrity audit on a deployed endpoint or a local build.

- **Usage**: `fortress verify [options]` or `node bin/index.js verify [options]`
- **Options**:
  - `--endpoint <url_or_file>`: The HTTP endpoint or local path to payload JSON containing public/private keys and payloads.
  - `--output <path>`: The path where the final audit JSON report will be saved.
- **Behavior**:
  - Tests whether the target endpoint is active/reachable.
  - **Active Mode**: If the endpoint is reachable, it launches a Playwright Chromium headless instance and executes verification tests across 8 security metrics.
  - **Simulation Mode**: If the endpoint is offline or inactive, the command falls back to CLI-driven simulation. It injects mock parameters to verify specific failure scenarios, such as:
    - `--tamper-signature`: Tampers the steganographic handshake signature to verify failure detection.
    - `--replay-nonce`: Replays an expired session nonce to test replay attack protection.
    - `--expired-timestamp`: Generates an expired timestamp to test timing checks.
    - `--malformed-handshake`: Alters the handshake block layout to test parser robust validation.
  - Produces a detailed audit report JSON and prints the final security score to stdout.
