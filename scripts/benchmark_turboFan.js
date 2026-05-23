const fs = require('fs');
const path = require('path');
const os = require('os');
const { performance } = require('perf_hooks');

// 1. Mock require('env') to intercept WASM imports before importing VM Core
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
    if (id === 'env') {
        return {
            native_call: () => "{}"
        };
    }
    return originalRequire.apply(this, arguments);
};

const { Parser } = require('../compiler/dist/parser.js');
const { CodeGenerator } = require('../compiler/dist/codegen.js');
const { scrambleSessionPayload } = require('../server/scrambler.js');
const vmNode = require('../pkg-node/vm_core.js');

const sourceCode = `
fn benchmarkArithmetic() {
    let x = 100;
    let y = 20;
    let r1 = x + y;
    let r2 = r1 - y;
    let r3 = r1 * r2;
    let r4 = r3 / 2;
    return r4;
}
benchmarkArithmetic();
`;

function compileAndScramble(source, devMode, clientPublicKey) {
    process.env.DEV_MODE = devMode ? 'true' : 'false';
    const parser = new Parser(source);
    const ast = parser.parseProgram();
    const codegen = new CodeGenerator();
    const { code, opcodeMap } = codegen.generate(ast);

    const TEMP_DIR = os.tmpdir();
    const fvbcPath = path.join(TEMP_DIR, `temp_bench_${devMode ? 'dev' : 'prod'}.fvbc`);
    const mapPath = path.join(TEMP_DIR, `temp_bench_${devMode ? 'dev' : 'prod'}.opcodes.json`);

    fs.writeFileSync(fvbcPath, Buffer.from(code));
    fs.writeFileSync(mapPath, JSON.stringify(Array.from(opcodeMap)));

    const { payload, newMap, pngBuffer, handshakeHeader } = scrambleSessionPayload(fvbcPath, mapPath, clientPublicKey);
    
    fs.unlinkSync(fvbcPath);
    fs.unlinkSync(mapPath);

    return {
        payload: new Uint8Array(payload),
        newMap: new Uint8Array(newMap),
        pngBuffer: pngBuffer,
        handshakeHeader: handshakeHeader,
        bytecodeSize: code.length
    };
}

// Ensure clean environment
vmNode.clear_crypto();

// Compile both modes
const devConfig = compileAndScramble(sourceCode, true);
// Initial prod compilation without key for compilation metrics
const prodConfigMetrics = compileAndScramble(sourceCode, false);

console.log("=== Compilation Metrics ===");
console.log(`Dev Bytecode Size:  ${devConfig.bytecodeSize} bytes`);
console.log(`Prod Bytecode Size: ${prodConfigMetrics.bytecodeSize} bytes`);
console.log(`Overhead Ratio:      ${(prodConfigMetrics.bytecodeSize / devConfig.bytecodeSize).toFixed(2)}x\n`);

const RUNS = 10000;

// Benchmark DEV mode
vmNode.clear_crypto();

// Warm-up DEV mode to trigger JIT optimization
for (let i = 0; i < 1000; i++) {
    vmNode.execute(devConfig.payload, devConfig.pngBuffer, '{}', devConfig.newMap);
}

const startDev = performance.now();
for (let i = 0; i < RUNS; i++) {
    vmNode.execute(devConfig.payload, devConfig.pngBuffer, '{}', devConfig.newMap);
}
const endDev = performance.now();
const timeDev = endDev - startDev;

// Benchmark PROD mode
vmNode.clear_crypto();
const clientPublicKey = vmNode.generate_client_keypair();
const prodConfig = compileAndScramble(sourceCode, false, clientPublicKey);

// Warm-up PROD mode to trigger JIT optimization
for (let i = 0; i < 1000; i++) {
    vmNode.execute(prodConfig.payload, prodConfig.handshakeHeader, '{}', prodConfig.newMap);
}

const startProd = performance.now();
for (let i = 0; i < RUNS; i++) {
    vmNode.execute(prodConfig.payload, prodConfig.handshakeHeader, '{}', prodConfig.newMap);
}
const endProd = performance.now();
const timeProd = endProd - startProd;

vmNode.clear_crypto();

console.log("=== Execution Metrics (10,000 iterations) ===");
console.log(`Dev execution time:  ${timeDev.toFixed(2)} ms`);
console.log(`Prod execution time: ${timeProd.toFixed(2)} ms`);
console.log(`Slowdown Factor:     ${(timeProd / timeDev).toFixed(2)}x`);
