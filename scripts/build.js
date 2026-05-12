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

const vmCorePath = path.join(ROOT_DIR, 'target/wasm32-unknown-unknown/release/vm_core.wasm');
const vmCoreBytes = fs.readFileSync(vmCorePath);

// 2. Compute SHA-256 of vm-core.wasm
const hash = crypto.createHash('sha256').update(vmCoreBytes).digest();
const hashArrayStr = Array.from(hash).join(', ');

// 3. Patch vm-verify/src/lib.rs
console.log('2. Patching vm-verify/src/lib.rs with the computed hash');
let verifySource = fs.readFileSync(VM_VERIFY_LIB, 'utf8');
verifySource = verifySource.replace(
    /static VM_CORE_HASH: \[u8; 32\] = \[.*?\];/s,
    `static VM_CORE_HASH: [u8; 32] = [${hashArrayStr}];`
);
fs.writeFileSync(VM_VERIFY_LIB, verifySource);

// 4. Compile vm-verify
console.log('3. Compiling vm-verify');
execSync('cargo build -p vm-verify --target wasm32-unknown-unknown --release', { stdio: 'inherit', cwd: ROOT_DIR });

// 5. Generate JS bindings
console.log('4. Generating JS bindings with wasm-bindgen');
execSync('wasm-bindgen target/wasm32-unknown-unknown/release/vm_core.wasm --out-dir js-runtime/pkg/vm-core --target web', { stdio: 'inherit', cwd: ROOT_DIR });
execSync('wasm-bindgen target/wasm32-unknown-unknown/release/vm_verify.wasm --out-dir js-runtime/pkg/vm-verify --target web', { stdio: 'inherit', cwd: ROOT_DIR });

// 6. Bundle WebWorker
console.log('5. Bundling WebWorker with esbuild');
execSync('npx esbuild src/worker.ts --bundle --format=iife --outfile=dist/worker.js', { stdio: 'inherit', cwd: path.join(ROOT_DIR, 'js-runtime') });

// 7. Obfuscate WebWorker
console.log('6. Obfuscating WebWorker JS');
execSync('npx javascript-obfuscator dist/worker.js --output dist/worker.obfuscated.js', { stdio: 'inherit', cwd: path.join(ROOT_DIR, 'js-runtime') });

// 8. Staging Output
console.log('7. Staging artifacts to dist/');
if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR);

fs.copyFileSync(
    path.join(ROOT_DIR, 'js-runtime/dist/worker.obfuscated.js'),
    path.join(DIST_DIR, 'fortress-worker.js')
);
fs.copyFileSync(
    path.join(ROOT_DIR, 'js-runtime/pkg/vm-core/vm_core_bg.wasm'),
    path.join(DIST_DIR, 'vm_core.wasm')
);
fs.copyFileSync(
    path.join(ROOT_DIR, 'js-runtime/pkg/vm-verify/vm_verify_bg.wasm'),
    path.join(DIST_DIR, 'vm_verify.wasm')
);

console.log(`Fortress WASM Build Pipeline Complete! Artifacts staged in ${DIST_DIR}`);
