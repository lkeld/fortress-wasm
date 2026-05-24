const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const VM_VERIFY_LIB = path.join(ROOT_DIR, 'crates/vm-verify/src/lib.rs');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

function bundleWorker() {
    console.log('Bundling WebWorker with esbuild...');
    const jsRuntimeDir = path.join(ROOT_DIR, 'js-runtime');
    const outfile = path.join(jsRuntimeDir, 'dist/worker.js');
    
    // Create js-runtime/dist/ if it doesn't exist
    const jsRuntimeDistDir = path.join(jsRuntimeDir, 'dist');
    if (!fs.existsSync(jsRuntimeDistDir)) {
        fs.mkdirSync(jsRuntimeDistDir, { recursive: true });
    }
    
    // Mark Node.js modules and node-specific VM bindings as external so esbuild leaves them as require() in IIFE output
    execSync('npx esbuild src/worker.ts --bundle --format=iife --outfile=dist/worker.js --external:module --external:worker_threads --external:fs --external:path --external:crypto --external:../../pkg-node/vm_core.js --external:../pkg-node/vm_core.js', { 
        stdio: 'inherit', 
        cwd: jsRuntimeDir 
    });

    if (!fs.existsSync(outfile)) {
        throw new Error(`esbuild failed to produce worker bundle at ${outfile}`);
    }

    const workerCode = fs.readFileSync(outfile, 'utf8');

    // 1. Write worker-bundle.js at root
    const rootBundleContent = `module.exports = { FORTRESS_WORKER_BUNDLE: ${JSON.stringify(workerCode)} };\n`;
    fs.writeFileSync(path.join(ROOT_DIR, 'worker-bundle.js'), rootBundleContent);
    console.log('Written worker-bundle.js at root');

    // 2. Write packages/sdk/worker.js
    const sdkDir = path.join(ROOT_DIR, 'packages/sdk');
    if (!fs.existsSync(sdkDir)) {
        fs.mkdirSync(sdkDir, { recursive: true });
    }
    fs.copyFileSync(outfile, path.join(sdkDir, 'worker.js'));
    console.log('Copied worker.js to packages/sdk/worker.js');

    // 3. Write packages/sdk/worker-bundle.js
    const sdkBundleContent = `module.exports = { FORTRESS_WORKER_BUNDLE: ${JSON.stringify(workerCode)} };\n`;
    fs.writeFileSync(path.join(sdkDir, 'worker-bundle.js'), sdkBundleContent);
    console.log('Written worker-bundle.js to packages/sdk/worker-bundle.js');

    // 4. Write dist/fortress-worker.js
    if (!fs.existsSync(DIST_DIR)) {
        fs.mkdirSync(DIST_DIR, { recursive: true });
    }
    fs.copyFileSync(outfile, path.join(DIST_DIR, 'fortress-worker.js'));
    console.log('Staged worker.js to dist/fortress-worker.js');
}

function generateHashes(requireExists = false) {
    const pkgWebPath = path.join(ROOT_DIR, 'pkg-web/vm_core_bg.wasm');
    const pkgNodePath = path.join(ROOT_DIR, 'pkg-node/vm_core_bg.wasm');

    console.log('Generating SHA-384 hashes...');

    if (requireExists) {
        if (!fs.existsSync(pkgWebPath)) {
            throw new Error(`WASM binary not found at ${pkgWebPath}`);
        }
        if (!fs.existsSync(pkgNodePath)) {
            throw new Error(`WASM binary not found at ${pkgNodePath}`);
        }
    }

    if (fs.existsSync(pkgWebPath)) {
        const hashWeb = crypto.createHash('sha384').update(fs.readFileSync(pkgWebPath)).digest('hex');
        fs.writeFileSync(pkgWebPath + '.sha384', hashWeb);
        console.log(`Generated pkg-web/vm_core_bg.wasm.sha384: ${hashWeb}`);
    } else {
        console.warn(`Warning: Web WASM binary not found at ${pkgWebPath}`);
    }

    if (fs.existsSync(pkgNodePath)) {
        const hashNode = crypto.createHash('sha384').update(fs.readFileSync(pkgNodePath)).digest('hex');
        fs.writeFileSync(pkgNodePath + '.sha384', hashNode);
        console.log(`Generated pkg-node/vm_core_bg.wasm.sha384: ${hashNode}`);
    } else {
        console.warn(`Warning: Node WASM binary not found at ${pkgNodePath}`);
    }
}

const onlyHashes = process.argv.includes('--only-hashes');

if (onlyHashes) {
    bundleWorker();
    generateHashes(true);
} else {
    console.log('--- Phase 5: Finalizing Build Pipeline ---');

    // 1. Compile vm-core
    console.log('1. Compiling vm-core');
    execSync('cargo build -p vm-core --target wasm32-unknown-unknown --release', { stdio: 'inherit', cwd: ROOT_DIR });

    // 2. Generate JS bindings
    console.log('2. Generating JS bindings with wasm-bindgen');
    execSync('wasm-bindgen target/wasm32-unknown-unknown/release/vm_core.wasm --out-dir js-runtime/pkg/vm-core --target web', { stdio: 'inherit', cwd: ROOT_DIR });

    // 3. Bundle WebWorker
    bundleWorker();

    // 4. Staging Output
    console.log('4. Staging artifacts to dist/');
    if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR);

    fs.copyFileSync(
        path.join(ROOT_DIR, 'js-runtime/pkg/vm-core/vm_core_bg.wasm'),
        path.join(DIST_DIR, 'vm_core.wasm')
    );

    console.log(`Fortress WASM Build Pipeline Complete! Artifacts staged in ${DIST_DIR}`);

    // Compute hashes at the end of normal build execution
    generateHashes(false);
}
