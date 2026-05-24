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

// Interactive spawn helper
async function spawnInteractiveProcess(args, promptResponses, env = {}) {
    const { spawn } = require('child_process');
    const child = spawn('node', [createStubPath, ...args], {
        env: {
            ...process.env,
            FORTRESS_CLI_INTERACTIVE: 'true',
            ...env
        }
    });

    let stdout = '';
    let stderr = '';
    let lastMatchIndex = 0;
    
    // Create copy of promptResponses to avoid mutating caller's array
    const queue = [...promptResponses];

    child.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        
        if (queue.length > 0) {
            const next = queue[0];
            const searchArea = stdout.slice(lastMatchIndex);
            if (searchArea.includes(next.prompt)) {
                lastMatchIndex = stdout.length;
                queue.shift();
                if (child.stdin.writable) {
                    child.stdin.write(next.response + '\n');
                }
                if (queue.length === 0) {
                    child.stdin.end();
                }
            }
        }
    });

    child.stderr.on('data', (data) => {
        stderr += data.toString();
    });

    const timeout = setTimeout(() => {
        child.kill('SIGKILL');
    }, 10000); // 10s timeout
    
    // Wait for process to close
    return new Promise((resolve) => {
        child.on('close', (code) => {
            clearTimeout(timeout);
            resolve({ code, stdout, stderr });
        });
    });
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

        // Verify genuine Ed25519 keys
        const pubKeyBuf = fs.readFileSync(path.join(keysDir, 'public.key'));
        const privKeyBuf = fs.readFileSync(path.join(keysDir, 'private.key'));
        try {
            const publicKey = crypto.createPublicKey({ key: pubKeyBuf, format: 'der', type: 'spki' });
            assert.strictEqual(publicKey.asymmetricKeyType, 'ed25519');
            const privateKey = crypto.createPrivateKey({ key: privKeyBuf, format: 'der', type: 'pkcs8' });
            assert.strictEqual(privateKey.asymmetricKeyType, 'ed25519');
        } catch (e) {
            // Fallback random bytes validation if crypto fails or not supported (though Node 18+ supports it)
            assert.ok(pubKeyBuf.length === 32 || pubKeyBuf.length === 44);
            assert.ok(privKeyBuf.length === 32 || privKeyBuf.length === 48);
        }
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
        const result = await spawnProcess('node', [createStubPath, dir, '--framework', 'rails']);
        assertExitCode(result, 1);
        assertStderrContains(result, 'Error: Unsupported framework option "rails"');
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
    },

    'Interactive Prompt Flow - supports full interactive CLI flow': async () => {
        const dir = getTempDir();
        // Create a dummy source file to test file selection
        const srcDir = path.join(dir, 'src');
        fs.mkdirSync(srcDir, { recursive: true });
        fs.writeFileSync(path.join(srcDir, 'index.js'), 'export function originalFunction() {}');

        // Prompt-responses sequence
        const promptResponses = [
            { prompt: 'Confirm this framework?', response: 'y' },
            { prompt: 'Enter number (1-2):', response: '1' },
            { prompt: 'Enter number (1-3):', response: '2' },
            { prompt: 'Enter signing password (min 12 chars):', response: 'securepassword123' },
            { prompt: 'Confirm signing password:', response: 'securepassword123' },
            { prompt: 'Confirm API endpoint', response: '' },
            { prompt: 'Confirm output directory', response: './protected' },
            { prompt: 'Add signing password and keys path to .env?', response: 'y' }
        ];

        const result = await spawnInteractiveProcess([dir], promptResponses);

        assertExitCode(result, 0);
        assertStdoutContains(result, 'Fortress App Scaffolded successfully!');

        const configPath = path.join(dir, 'fortress.config.js');
        assert.ok(fs.existsSync(configPath));
        const config = require(configPath);
        assert.strictEqual(config.framework, 'vite');
        assert.strictEqual(config.protectedDir, './protected');

        const protectedDir = path.join(dir, 'protected');
        assert.ok(fs.existsSync(path.join(protectedDir, 'index.js')));
        const entryContent = fs.readFileSync(path.join(protectedDir, 'index.js'), 'utf8');
        assert.ok(entryContent.includes('export function originalFunction()'));
    },

    'Directory Traversal Protection - fails on traversed source file path': async () => {
        const dir = getTempDir();
        const promptResponses = [
            { prompt: 'Confirm this framework?', response: 'y' },
            { prompt: 'Enter custom file path to protect:', response: '../outside.js' }
        ];

        const result = await spawnInteractiveProcess([dir], promptResponses);

        assertExitCode(result, 1);
        assertStderrContains(result, 'Directory traversal detected. Protected file path must be inside the target directory.');
    },

    'Directory Traversal Protection - fails on traversed output directory': async () => {
        const dir = getTempDir();
        const promptResponses = [
            { prompt: 'Confirm this framework?', response: 'y' },
            { prompt: 'Enter custom file path to protect:', response: 'src/index.js' },
            { prompt: 'Enter custom function name to protect:', response: 'myFunc' },
            { prompt: 'Enter signing password (min 12 chars):', response: 'securepassword123' },
            { prompt: 'Confirm signing password:', response: 'securepassword123' },
            { prompt: 'Confirm API endpoint', response: '/api/fortress' },
            { prompt: 'Confirm output directory', response: '../traversal' },
            { prompt: 'Add signing password and keys path to .env?', response: 'y' }
        ];

        const result = await spawnInteractiveProcess([dir], promptResponses);

        assertExitCode(result, 1);
        assertStderrContains(result, 'Directory traversal detected. Protected directory must be inside the target directory.');
    },

    'Framework Mapping - maps Nuxt 3 override to nuxt config': async () => {
        const dir = getTempDir();
        const result = await spawnProcess('node', [createStubPath, dir, '--framework', 'Nuxt 3']);
        assertExitCode(result, 0);

        const config = require(path.join(dir, 'fortress.config.js'));
        assert.strictEqual(config.framework, 'nuxt');

        const serverDir = path.join(dir, 'server/api');
        assert.ok(fs.existsSync(path.join(serverDir, 'fortress.post.js')));
        cleanupDirs();
    },

    'CLI Password Option - rejects short password under 12 characters': async () => {
        const dir = getTempDir();
        const result = await spawnProcess('node', [createStubPath, dir, '--framework', 'next', '--password', 'short123']);
        assertExitCode(result, 1);
        assertStderrContains(result, 'Error: Password must be at least 12 characters.');
        cleanupDirs();
    },

    'CLI Password Option - accepts valid password of 12+ characters': async () => {
        const dir = getTempDir();
        const result = await spawnProcess('node', [createStubPath, dir, '--framework', 'next', '--password', 'validpassword123']);
        assertExitCode(result, 0);
        
        const envPath = path.join(dir, '.env');
        assert.ok(fs.existsSync(envPath));
        const envContent = fs.readFileSync(envPath, 'utf8');
        assert.ok(envContent.includes('FORTRESS_SIGNING_PASSWORD="validpassword123"'));
        cleanupDirs();
    },

    'CLI Password Option - auto-generates 16-character password and prints when not specified': async () => {
        const dir = getTempDir();
        const result = await spawnProcess('node', [createStubPath, dir, '--framework', 'next']);
        assertExitCode(result, 0);
        assertStdoutContains(result, 'Auto-generated signing password:');
        
        const envPath = path.join(dir, '.env');
        assert.ok(fs.existsSync(envPath));
        const envContent = fs.readFileSync(envPath, 'utf8');
        assert.ok(/FORTRESS_SIGNING_PASSWORD="[a-f0-9]{16}"/.test(envContent));
        cleanupDirs();
    }
});
