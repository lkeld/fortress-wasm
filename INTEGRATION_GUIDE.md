# Fortress WASM: Integration & Deployment Guide

This guide explains how to integrate the Fortress WASM engine into your application to secure your API requests.

## How It Works

Fortress WASM does **not** obfuscate your JavaScript source code directly. Instead, it provides a completely separate, secure execution environment. 

You write your sensitive security logic (e.g., bot detection, token generation, cryptographic signing) in a custom scripting language we've built, saved as a `.fvm` file. You then use the Fortress Compiler to convert that script into an encrypted, polymorphic binary payload (`.fvbc`). 

You deploy this **binary payload** to the browser. The WASM engine executes the binary payload in a protected memory sandbox and returns the final signed API token. **Your source code is never sent to the client.**

---

## Step 1: Write Your Security Logic

Create a new file called `security_logic.fvm`. This language supports standard logic: variables, functions, arithmetic, arrays, objects, and returning values.

```javascript
// security_logic.fvm
fn generate_token(challenge) {
    let timestamp = __native_call(0, 0); // Example native function to get time
    let secret = "my_secure_salt";
    // ... complex proprietary logic ...
    return final_result;
}

let challenge = 12345;
let token = generate_token(challenge);
return token;
```

## Step 2: Compile the Payload

Run the compiler against your script:
```bash
npx fortress-compile security_logic.fvm
```

This will generate two files:
1. `security_logic.fvbc`: The raw, polymorphic WebAssembly bytecode.
2. `security_logic.const.json`: The XOR-obfuscated string and integer constants.

*Note: Every time you run the compiler, the opcodes and encryption keys are randomized. The `.fvbc` file will never have the same binary signature twice, making it impossible for bots to reverse-engineer statically.*

## Step 3: Inject the Master Key

Your master HMAC signing key must be injected into a PNG image using steganography.
```bash
node scripts/inject-steg.js path/to/logo.png "MY_SUPER_SECRET_HMAC_KEY"
```
Serve this modified `logo.png` on your website.

## Step 4: Deploy the WebWorker

In your main web application, initialize the WebWorker provided in `js-runtime/dist/worker.js`. Pass it the compiled `.fvbc` bytes, the `.const.json` payload, and the steganography image data.

```javascript
const worker = new Worker('/worker.js');

// 1. Initialize the engine
worker.postMessage({
    type: 'INIT',
    payload: {
        stegoImageBytes: await fetch('/logo.png').then(r => r.arrayBuffer()),
        sessionSeed: "random_seed_from_your_server",
        fingerprint: "user_browser_fingerprint",
        epochDay: Math.floor(Date.now() / 86400000)
    }
});

// 2. Execute your logic
worker.postMessage({
    type: 'EXECUTE',
    payload: {
        bytecode: await fetch('/security_logic.fvbc').then(r => r.arrayBuffer()),
        constantsJson: await fetch('/security_logic.const.json').then(r => r.text()),
        inputJson: JSON.stringify({ /* inputs for your script */ })
    }
});

// 3. Request a signature for your API call
worker.postMessage({
    type: 'SIGN',
    payload: {
        method: 'POST',
        url: 'https://api.yoursite.com/submit',
        timestamp: Date.now().toString(),
        bodyStr: JSON.stringify({ data: "payload" })
    }
});
```

## Performance Considerations

Fortress WASM is designed for **extreme performance**. 
- Because the engine is written in Rust and compiled to WebAssembly, execution happens at near-native speeds.
- Unlike traditional JavaScript obfuscators (which bloat your JS file size by 10x and severely lag the browser's JIT compiler), the Fortress WASM engine executes a highly optimized, lean binary loop. 
- Memory operations are handled entirely via Rust's zero-cost abstractions (`Rc<RefCell>`), avoiding expensive garbage collection sweeps across the JS boundary.
- The cryptographic operations (SHA-256, HMAC-SHA512) are executed entirely in native WebAssembly, executing in microseconds.
