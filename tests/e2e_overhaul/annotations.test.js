const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const { runTestSuite, spawnProcess, assertExitCode, assertStdoutContains } = require('./runner');
const { scanFile } = require('../../compiler/dist/scanner.js');

const cliPath = path.join(__dirname, '../../bin/index.js');
const TEMP_BASE = path.join(os.tmpdir(), `fortress_annotation_tests_${crypto.randomBytes(4).toString('hex')}`);

function getTempWorkspace() {
    const dir = path.join(TEMP_BASE, crypto.randomBytes(8).toString('hex'));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function cleanup() {
    try {
        fs.rmSync(TEMP_BASE, { recursive: true, force: true });
    } catch (e) {}
}

fs.mkdirSync(TEMP_BASE, { recursive: true });

runTestSuite('F8: @protect Annotations E2E Overhaul Test Suite', {
    // --- Tier 1: Feature Coverage (5 tests) ---
    '@protect basic function compilation - parses and compiles simple function': async () => {
        const dir = getTempWorkspace();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), `
            module.exports = { output: './protected' };
        `);
        fs.writeFileSync(path.join(dir, 'app.js'), `
            /**
             * @protect
             */
            export function testFunc() {
                let x = 10;
                return x;
            }
        `);

        const result = await spawnProcess('node', [cliPath, 'build'], { cwd: dir });
        assertExitCode(result, 0);
        assertStdoutContains(result, 'Compiled protected function: testFunc');
        assert.ok(fs.existsSync(path.join(dir, 'protected/testFunc.fvbc')));
    },

    '@protect-name custom naming - uses protect-name for output file': async () => {
        const dir = getTempWorkspace();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), `
            module.exports = { output: './protected' };
        `);
        fs.writeFileSync(path.join(dir, 'app.js'), `
            /**
             * @protect
             * @protect-name superCustomName
             */
            export function testFunc() {
                return 42;
            }
        `);

        const result = await spawnProcess('node', [cliPath, 'build'], { cwd: dir });
        assertExitCode(result, 0);
        assertStdoutContains(result, 'Compiled protected function: superCustomName');
        assert.ok(fs.existsSync(path.join(dir, 'protected/superCustomName.fvbc')));
    },

    '@protect-endpoint custom routes - extracts endpoint metadata': async () => {
        const dir = getTempWorkspace();
        const file = path.join(dir, 'app.js');
        fs.writeFileSync(file, `
            /**
             * @protect
             * @protect-endpoint /api/my-custom-route
             */
            export function testFunc() {}
        `);

        const scanned = scanFile(file);
        assert.strictEqual(scanned.length, 1);
        assert.strictEqual(scanned[0].endpoint, '/api/my-custom-route');
    },

    'Parallel Compilation - compiles multiple annotated functions': async () => {
        const dir = getTempWorkspace();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), `
            module.exports = { output: './protected' };
        `);
        fs.writeFileSync(path.join(dir, 'app.js'), `
            /** @protect */
            export function func1() { return 1; }

            /** @protect */
            export function func2() { return 2; }
        `);

        const result = await spawnProcess('node', [cliPath, 'build'], { cwd: dir });
        assertExitCode(result, 0);
        assertStdoutContains(result, 'Compiled protected function: func1');
        assertStdoutContains(result, 'Compiled protected function: func2');
        assert.ok(fs.existsSync(path.join(dir, 'protected/func1.fvbc')));
        assert.ok(fs.existsSync(path.join(dir, 'protected/func2.fvbc')));
    },

    'Scan whole directory structure - scans subdirectories for annotations': async () => {
        const dir = getTempWorkspace();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), `
            module.exports = { output: './protected' };
        `);
        const sub = path.join(dir, 'src/components');
        fs.mkdirSync(sub, { recursive: true });
        fs.writeFileSync(path.join(sub, 'auth.js'), `
            /** @protect */
            export function login() { return true; }
        `);

        const result = await spawnProcess('node', [cliPath, 'build'], { cwd: dir });
        assertExitCode(result, 0);
        assertStdoutContains(result, 'Compiled protected function: login');
        assert.ok(fs.existsSync(path.join(dir, 'protected/login.fvbc')));
    },

    // --- Tier 2: Boundary & Corner Cases (5 tests) ---
    '@protect-name characters validation - error on invalid characters': async () => {
        const dir = getTempWorkspace();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), `
            module.exports = { output: './protected' };
        `);
        fs.writeFileSync(path.join(dir, 'app.js'), `
            /**
             * @protect
             * @protect-name invalid name!
             */
            export function testFunc() {}
        `);

        const result = await spawnProcess('node', [cliPath, 'build'], { cwd: dir });
        assertExitCode(result, 1);
        assert.ok(result.stderr.includes('Invalid characters in protect name'));
    },

    '@protect on unexported function warning - logs warning on unexported annotation': async () => {
        const dir = getTempWorkspace();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), `
            module.exports = { output: './protected' };
        `);
        fs.writeFileSync(path.join(dir, 'app.js'), `
            /**
             * @protect
             */
            function unexportedFunc() {}
        `);

        const result = await spawnProcess('node', [cliPath, 'build'], { cwd: dir });
        assertExitCode(result, 0);
        assert.ok(result.stderr.includes('is annotated with @protect but is not exported'));
    },

    'Multiple tags on same function - last tag overrides previous': async () => {
        const dir = getTempWorkspace();
        const file = path.join(dir, 'app.js');
        fs.writeFileSync(file, `
            /**
             * @protect
             * @protect-name firstName
             * @protect-name finalName
             */
            export function testFunc() {}
        `);

        const scanned = scanFile(file);
        assert.strictEqual(scanned.length, 1);
        assert.strictEqual(scanned[0].customName, 'finalName');
    },

    'Missing protect-name fallback - fallback to original function name': async () => {
        const dir = getTempWorkspace();
        const file = path.join(dir, 'app.js');
        fs.writeFileSync(file, `
            /**
             * @protect
             */
            export function fallbackName() {}
        `);

        const scanned = scanFile(file);
        assert.strictEqual(scanned.length, 1);
        assert.strictEqual(scanned[0].name, 'fallbackName');
        assert.strictEqual(scanned[0].customName, undefined);
    },

    'Class methods compilation - parses function/method correctly': async () => {
        const dir = getTempWorkspace();
        const file = path.join(dir, 'app.js');
        fs.writeFileSync(file, `
            class Controller {
                /**
                 * @protect
                 */
                export function handle() {
                    return 0;
                }
            }
        `);

        // Scanner extracts methods that look like standard function declarations inside class context
        const scanned = scanFile(file);
        assert.strictEqual(scanned.length, 1);
        assert.strictEqual(scanned[0].name, 'handle');
    },

    'AST Parser Upgrades - parses modern syntax features': async () => {
        const dir = getTempWorkspace();
        const file = path.join(dir, 'app.js');
        // Let's write a file using decorators, typescript types, optional chaining, nullish coalescing OUTSIDE the protected function
        fs.writeFileSync(file, `
            /**
             * @protect
             */
            export function basicFunc(arg) {
                const a = 1;
                return a;
            }

            // Modern syntax and TS outside the protected function that requires Babel plugins to parse
            const b: string = window?.location ?? 'localhost';
        `);
        const scanned = scanFile(file);
        assert.strictEqual(scanned.length, 1);
        assert.strictEqual(scanned[0].name, 'basicFunc');
    },

    'AST Parser Upgrades - handles syntax/compilation error and exits with code 1': async () => {
        const dir = getTempWorkspace();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), `
            module.exports = { output: './protected' };
        `);
        fs.writeFileSync(path.join(dir, 'app.js'), `
            /**
             * @protect
             */
            export function brokenFunc() {
                // Syntax error here
                const x = ;
            }
        `);
        const result = await spawnProcess('node', [cliPath, 'build'], { cwd: dir });
        assertExitCode(result, 1);
        assert.ok(result.stderr.includes('Scanner Error') || result.stderr.includes('Build failed due to scanner errors.'));
        cleanup();
    }
});
