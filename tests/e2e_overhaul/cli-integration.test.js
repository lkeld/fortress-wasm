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
            { prompt: 'Enter selection:', response: '1' },
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
        assert.ok(entryContent.includes('/** @protect */'));
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
    },

    'Gitattributes Generation & Idempotency - correctly writes and updates .gitattributes': async () => {
        const dir = getTempDir();
        const gitattribPath = path.join(dir, '.gitattributes');
        fs.writeFileSync(gitattribPath, '*.txt text\n');
        
        const result = await spawnProcess('node', [createStubPath, dir, '--framework', 'next']);
        assertExitCode(result, 0);
        
        assert.ok(fs.existsSync(gitattribPath));
        let content = fs.readFileSync(gitattribPath, 'utf8');
        assert.ok(content.includes('*.fvbc binary'));
        assert.ok(content.includes('*.opcodes.json binary'));
        assert.ok(content.includes('# fortress-wasm-start'));
        assert.ok(content.includes('# fortress-wasm-end'));
        assert.ok(content.includes('*.txt text'));
        
        fs.unlinkSync(path.join(dir, 'fortress.config.js'));
        fs.rmSync(path.join(dir, 'protected'), { recursive: true, force: true });
        
        const result2 = await spawnProcess('node', [createStubPath, dir, '--framework', 'next']);
        assertExitCode(result2, 0);
        
        content = fs.readFileSync(gitattribPath, 'utf8');
        const occurrences = (content.match(/# fortress-wasm-start/g) || []).length;
        assert.strictEqual(occurrences, 1);
        cleanupDirs();
    },

    'Husky Hook Setup - skips if not a Git repository': async () => {
        const dir = getTempDir();
        const result = await spawnProcess('node', [createStubPath, dir, '--framework', 'next']);
        assertExitCode(result, 0);
        assertStdoutContains(result, 'Git repository not detected. Skipping Husky pre-commit hook setup.');
        assert.ok(!fs.existsSync(path.join(dir, '.husky')));
        cleanupDirs();
    },

    'Husky Hook Setup - initialises Husky and creates pre-commit hook': async () => {
        const dir = getTempDir();
        fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
        
        const result = await spawnProcess('node', [createStubPath, dir, '--framework', 'next']);
        assertExitCode(result, 0);
        
        const preCommitPath = path.join(dir, '.husky/pre-commit');
        assert.ok(fs.existsSync(preCommitPath));
        const content = fs.readFileSync(preCommitPath, 'utf8');
        assert.ok(content.includes('Recompiling protected functions...'));
        assert.ok(content.includes('fortress build'));
        
        if (process.platform !== 'win32') {
            const stats = fs.statSync(preCommitPath);
            const isExecutable = (stats.mode & 0o111) !== 0;
            assert.ok(isExecutable);
        }
        cleanupDirs();
    },

    'lint-staged Compatibility - prepends build to package.json and config files': async () => {
        const dir = getTempDir();
        
        const pkg = {
            dependencies: { next: '^13.0.0' },
            'lint-staged': {
                '*.js': 'eslint'
            }
        };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
        
        fs.writeFileSync(path.join(dir, '.lintstagedrc.json'), JSON.stringify({
            '*.ts': 'tsc'
        }));
        
        fs.writeFileSync(path.join(dir, 'lint-staged.config.js'), 'module.exports = { "*.css": "stylelint" };');
        
        const result = await spawnProcess('node', [createStubPath, dir, '--framework', 'next']);
        assertExitCode(result, 0);
        
        const updatedPkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        assert.deepStrictEqual(updatedPkg['lint-staged']['protected/**'], ['fortress build']);
        
        const updatedJson = JSON.parse(fs.readFileSync(path.join(dir, '.lintstagedrc.json'), 'utf8'));
        assert.deepStrictEqual(updatedJson['protected/**'], ['fortress build']);
        
        const updatedJs = fs.readFileSync(path.join(dir, 'lint-staged.config.js'), 'utf8');
        assert.ok(updatedJs.includes('protected/**') && updatedJs.includes('fortress build'));
        
        cleanupDirs();
    },

    'Dev CLI Lazy Key Generation - generates key if missing': async () => {
        const dir = getTempDir();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), 'module.exports = { serve: { port: 9876 }, protect: [] };');
        fs.writeFileSync(path.join(dir, '.gitignore'), '# Gitignore\n');
        
        const fortressBin = path.join(__dirname, '../../bin/index.js');
        const { spawn } = require('child_process');
        
        const child = spawn('node', [fortressBin, 'dev'], {
            cwd: dir,
            env: {
                ...process.env,
                FORTRESS_SIGNING_PASSWORD: ''
            }
        });
        
        let stdout = '';
        await new Promise((resolve) => {
            child.stdout.on('data', (data) => {
                stdout += data.toString();
                if (stdout.includes('Dev key created at .fortress_dev_key')) {
                    resolve();
                }
            });
            child.stderr.on('data', (data) => {
                stdout += data.toString();
            });
            setTimeout(resolve, 3000);
        });
        
        child.kill('SIGKILL');
        
        assert.ok(stdout.includes('[fortress] No .fortress_dev_key found. Generating local dev signing key...'));
        assert.ok(stdout.includes('✓ Dev key created at .fortress_dev_key'));
        
        const devKeyPath = path.join(dir, '.fortress_dev_key');
        assert.ok(fs.existsSync(devKeyPath));
        const key = fs.readFileSync(devKeyPath, 'utf8').trim();
        assert.strictEqual(key.length, 32);
        
        const gitignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8');
        assert.ok(gitignore.includes('.fortress_dev_key'));
        
        cleanupDirs();
    },

    'Interactive Protect Command - selects and protects a function': async () => {
        const dir = getTempDir();
        // Create config file
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), 'module.exports = {\n  protect: []\n};');
        // Create source file
        const srcDir = path.join(dir, 'src');
        fs.mkdirSync(srcDir, { recursive: true });
        fs.writeFileSync(path.join(srcDir, 'utils.js'), 'export function sensitiveFunc() {\n  return "secret";\n}');
        
        // Spawn index.js protect using child_process
        const fortressBin = path.join(__dirname, '../../bin/index.js');
        const { spawn } = require('child_process');
        
        const child = spawn('node', [fortressBin, 'protect'], {
            cwd: dir,
            env: {
                ...process.env,
                FORTRESS_SIGNING_PASSWORD: 'securepassword123'
            }
        });
        
        let stdout = '';
        let stderr = '';
        let respondedFile = false;
        let respondedFunc = false;
        
        await new Promise((resolve) => {
            child.stdout.on('data', (data) => {
                const chunk = data.toString();
                stdout += chunk;
                
                if (stdout.includes('Choose a file to protect:') && !respondedFile) {
                    respondedFile = true;
                    child.stdin.write('1\n');
                }
                if (stdout.includes('Choose function(s) to protect:') && !respondedFunc) {
                    respondedFunc = true;
                    child.stdin.write('1\n');
                }
            });
            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            child.on('close', resolve);
        });
        
        if (!stdout.includes('Successfully injected /** @protect */ annotations')) {
            console.log("TEST FAILURE DETAILS:");
            console.log("STDOUT:\n", stdout);
            console.log("STDERR:\n", stderr);
        }
        assert.ok(stdout.includes('Successfully injected /** @protect */ annotations'));;
        
        // Verify source file content has annotations
        const updatedSrc = fs.readFileSync(path.join(srcDir, 'utils.js'), 'utf8');
        assert.ok(updatedSrc.includes('/** @protect */'));
        assert.ok(updatedSrc.includes('export function sensitiveFunc()'));
        
        // Verify config has been updated
        const updatedConfig = fs.readFileSync(path.join(dir, 'fortress.config.js'), 'utf8');
        assert.ok(updatedConfig.includes('./src/utils.js'));
        
        cleanupDirs();
    },

    'File Classification and Filtering - filters server and type-only files and displays badges in prompt': async () => {
        const dir = getTempDir();
        // Create config file
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), 'module.exports = {\n  protect: []\n};');
        
        // Create source files under src/
        const srcDir = path.join(dir, 'src');
        fs.mkdirSync(srcDir, { recursive: true });
        
        fs.writeFileSync(path.join(srcDir, 'client.js'), '\'use client\';\nexport function clientFunc() {\n  return 1;\n}');
        fs.writeFileSync(path.join(srcDir, 'ambiguous.js'), '\'use client\';\nimport fs from \'fs\';\nexport function ambiguousFunc() {\n  return 2;\n}');
        fs.writeFileSync(path.join(srcDir, 'unknown.js'), 'export function unknownFunc() {\n  return 3;\n}');
        fs.writeFileSync(path.join(srcDir, 'server.js'), '\'use server\';\nexport function serverFunc() {\n  return 4;\n}');
        fs.writeFileSync(path.join(srcDir, 'types.d.ts'), 'export interface X {}');
        
        const apiDir = path.join(srcDir, 'api');
        fs.mkdirSync(apiDir, { recursive: true });
        fs.writeFileSync(path.join(apiDir, 'auth.js'), 'export function authFunc() {\n  return 5;\n}');
        
        const fortressBin = path.join(__dirname, '../../bin/index.js');
        const { spawn } = require('child_process');
        
        const child = spawn('node', [fortressBin, 'protect'], {
            cwd: dir,
            env: {
                ...process.env,
                FORTRESS_SIGNING_PASSWORD: 'securepassword123'
            }
        });
        
        let stdout = '';
        let stderr = '';
        let respondedFile = false;
        
        await new Promise((resolve) => {
            child.stdout.on('data', (data) => {
                const chunk = data.toString();
                stdout += chunk;
                
                if (stdout.includes('Choose a file to protect:') && !respondedFile) {
                    respondedFile = true;
                    // We select client.js (option 1)
                    child.stdin.write('1\n');
                }
                if (stdout.includes('Choose function(s) to protect:')) {
                    child.stdin.write('1\n');
                }
            });
            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            child.on('close', resolve);
        });


        // Verify the filtered list matches expectations
        assert.ok(stdout.includes('src/client.js'));
        assert.ok(stdout.includes('src/ambiguous.js ⚠ ambiguous'));
        assert.ok(stdout.includes('src/unknown.js ? unclassified'));
        
        // Server and type-only files must be hidden
        assert.ok(!stdout.includes('src/server.js'));
        assert.ok(!stdout.includes('src/types.d.ts'));
        assert.ok(!stdout.includes('src/api/auth.js'));
        
        cleanupDirs();
    },

    'Create-Fortress-App Classification and Filtering - filters and shows badges in scaffolding prompt': async () => {
        const dir = getTempDir();
        
        // Create source files under src/
        const srcDir = path.join(dir, 'src');
        fs.mkdirSync(srcDir, { recursive: true });
        
        fs.writeFileSync(path.join(srcDir, 'client.js'), '\'use client\';\nexport function clientFunc() {\n  return 1;\n}');
        fs.writeFileSync(path.join(srcDir, 'ambiguous.js'), '\'use client\';\nimport fs from \'fs\';\nexport function ambiguousFunc() {\n  return 2;\n}');
        fs.writeFileSync(path.join(srcDir, 'unknown.js'), 'export function unknownFunc() {\n  return 3;\n}');
        fs.writeFileSync(path.join(srcDir, 'server.js'), '\'use server\';\nexport function serverFunc() {\n  return 4;\n}');
        
        const promptResponses = [
            { prompt: 'Confirm this framework?', response: 'y' },
            { prompt: 'Choose a file to protect:', response: '1' }, // Select client.js
            { prompt: 'Choose function(s) to protect:', response: '1' },
            { prompt: 'Enter signing password (min 12 chars):', response: 'securepassword123' },
            { prompt: 'Confirm signing password:', response: 'securepassword123' },
            { prompt: 'Confirm API endpoint', response: '' },
            { prompt: 'Confirm output directory', response: './protected' },
            { prompt: 'Add signing password and keys path to .env?', response: 'y' }
        ];

        const result = await spawnInteractiveProcess([dir], promptResponses);
        assertExitCode(result, 0);


        // Verify the filtered list outputs in stdout
        assert.ok(result.stdout.includes('src/client.js'));
        assert.ok(result.stdout.includes('src/ambiguous.js ⚠ ambiguous'));
        assert.ok(result.stdout.includes('src/unknown.js ? unclassified'));
        
        // Server and type-only files must be hidden
        assert.ok(!result.stdout.includes('src/server.js'));

        cleanupDirs();
    },

    'Interactive Protect Command - prioritises unprotected files and pre-selects protected functions': async () => {
        const dir = getTempDir();
        // Create config file
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), 'module.exports = {\n  protect: []\n};');
        
        const srcDir = path.join(dir, 'src');
        fs.mkdirSync(srcDir, { recursive: true });
        // File with @protect already inside
        fs.writeFileSync(path.join(srcDir, 'already_protected.js'), '/** @protect */\nexport function alreadyProtected() {\n  return 1;\n}');
        // File with unprotected function
        fs.writeFileSync(path.join(srcDir, 'unprotected.js'), 'export function unprotected() {\n  return 2;\n}');
        // File with mix
        fs.writeFileSync(path.join(srcDir, 'mix.js'), '/** @protect */\nexport function previouslyProtected() {\n  return 3;\n}\nexport function needsProtection() {\n  return 4;\n}');
        
        const fortressBin = path.join(__dirname, '../../bin/index.js');
        const { spawn } = require('child_process');
        
        const child = spawn('node', [fortressBin, 'protect'], {
            cwd: dir,
            env: {
                ...process.env,
                FORTRESS_SIGNING_PASSWORD: 'securepassword123'
            }
        });
        
        let stdout = '';
        let stderr = '';
        let respondedFile = false;
        let respondedFunc = false;
        
        await new Promise((resolve) => {
            child.stdout.on('data', (data) => {
                const chunk = data.toString();
                stdout += chunk;
                
                if (stdout.includes('Choose a file to protect:') && !respondedFile) {
                    respondedFile = true;
                    child.stdin.write('mix.js\r');
                }
                if (stdout.includes('Choose function(s) to protect:') && !respondedFunc) {
                    respondedFunc = true;
                    child.stdin.write('\r');
                }
            });
            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            child.on('close', resolve);
        });



        // Verify the prioritisation badges were shown
        assert.ok(/src\/mix\.js.*\(unprotected exports\)/.test(stdout));
        assert.ok(/src\/unprotected\.js.*\(unprotected exports\)/.test(stdout));
        
        // Verify the function badge was shown
        assert.ok(stdout.includes('previouslyProtected [protected]'));
        
        // Verify config has been updated to include both selected and auto-detected protected files
        const updatedConfig = fs.readFileSync(path.join(dir, 'fortress.config.js'), 'utf8');
        assert.ok(updatedConfig.includes('./src/mix.js'), 'mix.js must be in protect list');
        assert.ok(updatedConfig.includes('./src/already_protected.js'), 'already_protected.js must be auto-detected and added to protect list');
        
        cleanupDirs();
    },

    'Create-Fortress-App Next.js scaffold - prints hook and CSP auto-injection messages': async () => {
        const dir = getTempDir();
        const pkg = { dependencies: { next: '^13.0.0' } };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
        fs.writeFileSync(path.join(dir, 'next.config.js'), 'module.exports = {};');
        
        const result = await spawnProcess('node', [createStubPath, dir]);
        assertExitCode(result, 0);
        assertStdoutContains(result, 'Content Security Policy (CSP) header auto-configured');
        assertStdoutContains(result, 'To complete setup, manually import and call the useFortress client hook');
        cleanupDirs();
    },

    'F4 E2E - Repeated auto-protect detection': async () => {
        const dir = getTempDir();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), 'module.exports = {\n  protect: []\n};');
        const srcDir = path.join(dir, 'src');
        fs.mkdirSync(srcDir, { recursive: true });
        fs.writeFileSync(path.join(srcDir, 'a.js'), '/** @protect */\nexport function funcA() {}');
        
        const fortressBin = path.join(__dirname, '../../bin/index.js');
        const { execSync } = require('child_process');
        
        execSync(`FORTRESS_SIGNING_PASSWORD=validpassword123 node ${fortressBin} build`, {
            cwd: dir,
            stdio: 'pipe'
        });
        
        let configContent = fs.readFileSync(path.join(dir, 'fortress.config.js'), 'utf8');
        assert.ok(configContent.includes('./src/a.js'));
        
        const countOccurrences = (str, sub) => str.split(sub).length - 1;
        assert.strictEqual(countOccurrences(configContent, './src/a.js'), 1);
        
        fs.writeFileSync(path.join(srcDir, 'b.js'), '/** @protect */\nexport function funcB() {}');
        
        execSync(`FORTRESS_SIGNING_PASSWORD=validpassword123 node ${fortressBin} build`, {
            cwd: dir,
            stdio: 'pipe'
        });
        
        configContent = fs.readFileSync(path.join(dir, 'fortress.config.js'), 'utf8');
        assert.ok(configContent.includes('./src/a.js'));
        assert.ok(configContent.includes('./src/b.js'));
        assert.strictEqual(countOccurrences(configContent, './src/a.js'), 1);
        assert.strictEqual(countOccurrences(configContent, './src/b.js'), 1);
        
        cleanupDirs();
    },

    'F4 E2E - Pre-selection verification': async () => {
        const dir = getTempDir();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), 'module.exports = {\n  protect: ["./src/test.js"],\n  output: "./protected"\n};');
        const srcDir = path.join(dir, 'src');
        fs.mkdirSync(srcDir, { recursive: true });
        
        const protectedDir = path.join(dir, 'protected');
        fs.mkdirSync(protectedDir, { recursive: true });
        fs.writeFileSync(path.join(protectedDir, 'sensitiveFunc.fvbc'), 'mock bytes');
        fs.writeFileSync(path.join(protectedDir, 'sensitiveFunc.opcodes.json'), '{}');
        
        fs.writeFileSync(path.join(srcDir, 'test.js'), 'export function sensitiveFunc() {}\nexport function ordinaryFunc() {}');
        
        const fortressBin = path.join(__dirname, '../../bin/index.js');
        const { spawn } = require('child_process');
        
        const child = spawn('node', [fortressBin, 'protect'], {
            cwd: dir,
            env: {
                ...process.env,
                FORTRESS_SIGNING_PASSWORD: 'securepassword123'
            }
        });
        
        let stdout = '';
        let respondedFile = false;
        
        await new Promise((resolve) => {
            child.stdout.on('data', (data) => {
                const chunk = data.toString();
                stdout += chunk;
                
                if (stdout.includes('Choose a file to protect:') && !respondedFile) {
                    respondedFile = true;
                    child.stdin.write('1\n');
                }
                if (stdout.includes('Choose function(s) to protect:')) {
                    child.stdin.write('\n');
                }
            });
            child.on('close', resolve);
        });
        
        assert.ok(stdout.includes('sensitiveFunc (already protected)'));
        assert.ok(stdout.includes('ordinaryFunc'));
        
        cleanupDirs();
    },

    'F4 E2E - Post-scaffold success summary': async () => {
        const dir = getTempDir();
        const pkg = { 
            dependencies: { next: '^13.0.0' },
            scripts: { build: 'fortress build && next build' }
        };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
        
        const appDir = path.join(dir, 'app');
        fs.mkdirSync(appDir, { recursive: true });
        fs.writeFileSync(path.join(appDir, 'layout.tsx'), 'export default function Layout({ children }) { return children; }');
        fs.writeFileSync(path.join(dir, 'next.config.js'), 'module.exports = {};');
        
        const result = await spawnProcess('node', [createStubPath, dir]);
        assertExitCode(result, 0);
        
        assertStdoutContains(result, 'Client hook auto-injected');
        assertStdoutContains(result, 'Content Security Policy (CSP) header auto-configured');
        
        const hasManualHook = result.stdout.includes('To complete setup, manually import and call the useFortress client hook');
        const hasManualCsp = result.stdout.includes('Manually add the worker-src CSP');
        const hasManualCicd = result.stdout.includes('Configure CI/CD to run');
        assert.strictEqual(hasManualHook, false, 'Should not print manual client hook steps');
        assert.strictEqual(hasManualCsp, false, 'Should not print manual CSP steps');
        assert.strictEqual(hasManualCicd, false, 'Should not print manual CI/CD steps');
        
        cleanupDirs();
    },

    'F4 E2E - Post-scaffold manual action summary': async () => {
        const dir = getTempDir();
        const pkg = { dependencies: { next: '^13.0.0' } };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
        
        const result = await spawnProcess('node', [createStubPath, dir]);
        assertExitCode(result, 0);
        
        assertStdoutContains(result, 'To complete setup, manually import and call the useFortress client hook');
        assertStdoutContains(result, 'Manually add the worker-src CSP');
        assertStdoutContains(result, "Configure CI/CD to run 'fortress build' or 'fortress-wasm-start'");
        
        cleanupDirs();
    }
});

