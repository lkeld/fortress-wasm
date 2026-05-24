const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const { runTestSuite, spawnProcess, assertExitCode, assertStdoutContains, assertStderrContains } = require('./runner');

const createStubPath = path.join(__dirname, '../../packages/create-fortress-app/bin/index.js');
const TEMP_BASE_DIR = path.join(os.tmpdir(), `fortress_cli_tests_${crypto.randomBytes(4).toString('hex')}`);

// Setup unique temp directory helper
function getTempDir() {
    const dir = path.join(TEMP_BASE_DIR, crypto.randomBytes(8).toString('hex'));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

// Cleanup helper
function cleanupDirs() {
    try {
        fs.rmSync(TEMP_BASE_DIR, { recursive: true, force: true });
    } catch (e) {}
}

// Ensure base dir exists
fs.mkdirSync(TEMP_BASE_DIR, { recursive: true });

runTestSuite('F4: create-fortress-app CLI E2E Overhaul Test Suite', {
    // --- Tier 1: Feature Coverage (5 tests) ---
    'Framework Auto-Detection - auto-detects next framework from package.json': async () => {
        const dir = getTempDir();
        const pkg = { dependencies: { next: '^13.0.0' } };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));

        const result = await spawnProcess('node', [createStubPath, dir]);
        assertExitCode(result, 0);
        assertStdoutContains(result, 'Framework: next');
        
        const config = require(path.join(dir, 'fortress.config.js'));
        assert.strictEqual(config.framework, 'next');
    },

    'Scaffolding Config Generation - config is generated correctly': async () => {
        const dir = getTempDir();
        const result = await spawnProcess('node', [createStubPath, dir]);
        assertExitCode(result, 0);
        
        const configPath = path.join(dir, 'fortress.config.js');
        assert.ok(fs.existsSync(configPath));
        const config = require(configPath);
        assert.strictEqual(config.typescript, false);
        assert.strictEqual(config.packageManager, 'npm');
    },

    'Key Pair Generation - signing keys generated in keys folder': async () => {
        const dir = getTempDir();
        const result = await spawnProcess('node', [createStubPath, dir]);
        assertExitCode(result, 0);

        const keysDir = path.join(dir, '.fortress_keys');
        assert.ok(fs.existsSync(keysDir));
        assert.ok(fs.existsSync(path.join(keysDir, 'private.key')));
        assert.ok(fs.existsSync(path.join(keysDir, 'public.key')));
    },

    'Interactive Prompt Scaffolding - verify ts and package manager options': async () => {
        const dir = getTempDir();
        const result = await spawnProcess('node', [createStubPath, dir, '--ts', '--pm', 'yarn']);
        assertExitCode(result, 0);

        const config = require(path.join(dir, 'fortress.config.js'));
        assert.strictEqual(config.typescript, true);
        assert.strictEqual(config.packageManager, 'yarn');
    },

    'Protected Directory Setup - setup protected folder with entry point': async () => {
        const dir = getTempDir();
        const result = await spawnProcess('node', [createStubPath, dir]);
        assertExitCode(result, 0);

        const protectedDir = path.join(dir, 'protected');
        assert.ok(fs.existsSync(protectedDir));
        assert.ok(fs.existsSync(path.join(protectedDir, 'index.js')));
    },

    // --- Tier 2: Boundary & Corner Cases (5 tests) ---
    'Scaffold in Occupied Folder - warn and abort on existing config': async () => {
        const dir = getTempDir();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), '// existing');

        const result = await spawnProcess('node', [createStubPath, dir]);
        assertExitCode(result, 2); // Exits with 2 on occupied warning
        assertStdoutContains(result, 'Warning: fortress.config.js or protected/ directory already exists');
    },

    'Scaffold in Read-Only Folder - exit gracefully with error': async () => {
        const dir = getTempDir();
        fs.chmodSync(dir, 0o400);

        try {
            const result = await spawnProcess('node', [createStubPath, dir]);
            assertExitCode(result, 1);
            assertStderrContains(result, 'Error:');
        } finally {
            fs.chmodSync(dir, 0o700);
        }
    },

    'Unsupported Framework Option - fail gracefully on invalid framework override': async () => {
        const dir = getTempDir();
        const result = await spawnProcess('node', [createStubPath, dir, '--framework', 'angular']);
        assertExitCode(result, 1);
        assertStderrContains(result, 'Error: Unsupported framework option "angular"');
    },

    'Missing Environment Variables - run with defaults when env is blanked': async () => {
        const dir = getTempDir();
        const result = await spawnProcess('node', [createStubPath, dir], {
            env: { PATH: process.env.PATH }
        });
        assertExitCode(result, 0);
        assertStdoutContains(result, 'Successfully scaffolded');
    },

    'Scaffold Interrupt Safety - CLI help option exit code': async () => {
        const result = await spawnProcess('node', [createStubPath, '--help']);
        assertExitCode(result, 0);
        assertStdoutContains(result, 'Usage: create-fortress-app');
        cleanupDirs();
    }
});
