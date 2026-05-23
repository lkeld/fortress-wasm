const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const VM_VERIFY_LIB = path.join(ROOT_DIR, 'crates/vm-verify/src/lib.rs');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

console.log('--- Phase 5: Finalizing Build Pipeline ---');

// 1. Compile vm-core
console.log('1. Compiling vm-core');
execSync('cargo build -p vm-core --target wasm32-unknown-unknown --release', { stdio: 'inherit', cwd: ROOT_DIR });

// 2. Generate JS bindings
console.log('2. Generating JS bindings with wasm-bindgen');
execSync('wasm-bindgen target/wasm32-unknown-unknown/release/vm_core.wasm --out-dir js-runtime/pkg/vm-core --target web', { stdio: 'inherit', cwd: ROOT_DIR });

// 3. Bundle WebWorker
console.log('3. Bundling WebWorker with esbuild');
execSync('npx esbuild src/worker.ts --bundle --format=iife --outfile=dist/worker.js', { stdio: 'inherit', cwd: path.join(ROOT_DIR, 'js-runtime') });

// 4. Staging Output
console.log('4. Staging artifacts to dist/');
if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR);

fs.copyFileSync(
    path.join(ROOT_DIR, 'js-runtime/dist/worker.js'),
    path.join(DIST_DIR, 'fortress-worker.js')
);
fs.copyFileSync(
    path.join(ROOT_DIR, 'js-runtime/pkg/vm-core/vm_core_bg.wasm'),
    path.join(DIST_DIR, 'vm_core.wasm')
);

console.log(`Fortress WASM Build Pipeline Complete! Artifacts staged in ${DIST_DIR}`);
