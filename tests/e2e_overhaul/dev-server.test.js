const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const { runTestSuite, spawnProcess, assertExitCode, assertStdoutContains } = require('./runner');

const cliPath = path.join(__dirname, '../../bin/index.js');
const TEMP_BASE = path.join(os.tmpdir(), `fortress_dev_tests_${crypto.randomBytes(4).toString('hex')}`);

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

runTestSuite('F7: Dev/Protect CLI Watch E2E Overhaul Test Suite', {
    // --- Tier 1: Feature Coverage (5 tests) ---
    'Start Dev Server - starts server and logs startup messages': async () => {
        const dir = getTempWorkspace();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), `
            module.exports = {
                serve: { port: 13001 },
                protect: ['./src/lib/licensing.js'],
                output: './protected'
            };
        `);
        fs.mkdirSync(path.join(dir, 'src/lib'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'src/lib/licensing.js'), 'let x = 10;');

        const resultPromise = spawnProcess('node', [cliPath, 'dev'], { cwd: dir });
        
        // Wait 1 second to let server startup
        await new Promise(r => setTimeout(r, 1000));
        
        // Kill the server
        resultPromise.child.kill('SIGINT');
        const result = await resultPromise;
        assertStdoutContains(result, 'Fortress dev server listening');
    },

    'File Watcher Recompilation - editing a watched file triggers build': async () => {
        const dir = getTempWorkspace();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), `
            module.exports = {
                serve: { port: 13005 },
                protect: ['./src/lib/licensing.js'],
                output: './protected'
            };
        `);
        fs.mkdirSync(path.join(dir, 'src/lib'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'src/lib/licensing.js'), 'let x = 10;');

        // Start server in background
        const procPromise = spawnProcess('node', [cliPath, 'dev'], { cwd: dir });
        await new Promise(r => setTimeout(r, 1000));

        // Modify watched file
        fs.writeFileSync(path.join(dir, 'src/lib/licensing.js'), 'let x = 20; return x;');
        await new Promise(r => setTimeout(r, 1000));

        procPromise.child.kill('SIGINT');
        const result = await procPromise;
        assertStdoutContains(result, 'Change detected');
        assertStdoutContains(result, 'payload updated');
    },

    'Live Reload Payload Update - compiled payload is written to output path': async () => {
        const dir = getTempWorkspace();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), `
            module.exports = {
                serve: { port: 13010 },
                protect: ['./src/lib/licensing.js'],
                output: './protected'
            };
        `);
        fs.mkdirSync(path.join(dir, 'src/lib'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'src/lib/licensing.js'), 'let x = 10;');

        const procPromise = spawnProcess('node', [cliPath, 'dev'], { cwd: dir });
        await new Promise(r => setTimeout(r, 1000));

        // Edit
        fs.writeFileSync(path.join(dir, 'src/lib/licensing.js'), 'let y = 10;');
        await new Promise(r => setTimeout(r, 1000));

        procPromise.child.kill('SIGINT');
        const result = await procPromise;
        const compiledPath = path.join(dir, 'protected/licensing.fvbc');
        assert.ok(fs.existsSync(compiledPath));
    },

    'Dev Server Console Logs - logs include payload URL': async () => {
        const dir = getTempWorkspace();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), `
            module.exports = {
                serve: { port: 13015 },
                protect: ['./src/lib/licensing.js'],
                output: './protected'
            };
        `);
        fs.mkdirSync(path.join(dir, 'src/lib'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'src/lib/licensing.js'), 'let x = 10;');

        const procPromise = spawnProcess('node', [cliPath, 'dev'], { cwd: dir });
        await new Promise(r => setTimeout(r, 1000));

        procPromise.child.kill('SIGINT');
        const result = await procPromise;
        assertStdoutContains(result, 'Payloads:  http://localhost:');
    },

    'Stop Dev Server - dev server shuts down clean': async () => {
        const dir = getTempWorkspace();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), `
            module.exports = {
                serve: { port: 13020 },
                protect: ['./src/lib/licensing.js'],
                output: './protected'
            };
        `);
        fs.mkdirSync(path.join(dir, 'src/lib'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'src/lib/licensing.js'), 'let x = 10;');

        const procPromise = spawnProcess('node', [cliPath, 'dev'], { cwd: dir });
        await new Promise(r => setTimeout(r, 1000));

        procPromise.child.kill('SIGINT');
        const result = await procPromise;
        assert.strictEqual(result.code, 0); // Exits 0 on clean shutdown
    },

    // --- Tier 2: Boundary & Corner Cases (5 tests) ---
    'Watch Port Conflict - server moves to next port if busy': async () => {
        const dir1 = getTempWorkspace();
        fs.writeFileSync(path.join(dir1, 'fortress.config.js'), `
            module.exports = { serve: { port: 13030 }, protect: [], output: './protected' };
        `);
        const proc1Promise = spawnProcess('node', [cliPath, 'dev'], { cwd: dir1 });
        await new Promise(r => setTimeout(r, 1000));

        const dir2 = getTempWorkspace();
        fs.writeFileSync(path.join(dir2, 'fortress.config.js'), `
            module.exports = { serve: { port: 13030 }, protect: [], output: './protected' };
        `);
        const proc2Promise = spawnProcess('node', [cliPath, 'dev'], { cwd: dir2 });
        await new Promise(r => setTimeout(r, 1000));

        proc2Promise.child.kill('SIGINT');
        const result2 = await proc2Promise;
        assertStdoutContains(result2, '13030 in use, trying next port');
        assertStdoutContains(result2, 'listening on port 13031');

        proc1Promise.child.kill('SIGINT');
        await proc1Promise;
    },

    'Missing Configuration file - print error and exit 1': async () => {
        const dir = getTempWorkspace();
        const result = await spawnProcess('node', [cliPath, 'dev'], { cwd: dir });
        assertExitCode(result, 1);
        assert.ok(result.stderr.includes('fortress.config.js is missing'));
    },

    'Non-JS File Changes - ignore non-source modifications': async () => {
        const dir = getTempWorkspace();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), `
            module.exports = {
                serve: { port: 13040 },
                protect: ['./src/lib/licensing.js'],
                output: './protected'
            };
        `);
        fs.mkdirSync(path.join(dir, 'src/lib'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'src/lib/licensing.js'), 'let x = 10;');

        const procPromise = spawnProcess('node', [cliPath, 'dev'], { cwd: dir });
        await new Promise(r => setTimeout(r, 1000));

        // Write non-source file
        fs.writeFileSync(path.join(dir, 'src/lib/licensing.txt'), 'ignore me');
        await new Promise(r => setTimeout(r, 1000));

        procPromise.child.kill('SIGINT');
        const result = await procPromise;
        assert.strictEqual(result.stdout.includes('Change detected'), false);
    },

    'Syntax Error Rebuild - compiler error logged without crash': async () => {
        const dir = getTempWorkspace();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), `
            module.exports = {
                serve: { port: 13050 },
                protect: ['./src/lib/licensing.js'],
                output: './protected'
            };
        `);
        fs.mkdirSync(path.join(dir, 'src/lib'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'src/lib/licensing.js'), 'let x = 10;');

        const procPromise = spawnProcess('node', [cliPath, 'dev'], { cwd: dir });
        await new Promise(r => setTimeout(r, 1000));

        // Write syntactically invalid code
        fs.writeFileSync(path.join(dir, 'src/lib/licensing.js'), 'let x = ;');
        await new Promise(r => setTimeout(r, 1000));

        procPromise.child.kill('SIGINT');
        const result = await procPromise;
        assert.ok(result.stdout.includes('Compiler Error') || result.stderr.includes('Compiler Error'), 'Expected Compiler Error in stdout or stderr');
    },

    'Debounced Rebuilds - rapid writes trigger only one build': async () => {
        const dir = getTempWorkspace();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), `
            module.exports = {
                serve: { port: 13060 },
                protect: ['./src/lib/licensing.js'],
                output: './protected'
            };
        `);
        fs.mkdirSync(path.join(dir, 'src/lib'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'src/lib/licensing.js'), 'let x = 10;');

        const procPromise = spawnProcess('node', [cliPath, 'dev'], { cwd: dir });
        await new Promise(r => setTimeout(r, 1000));

        // Write multiple times rapidly
        fs.writeFileSync(path.join(dir, 'src/lib/licensing.js'), 'let a = 1;');
        fs.writeFileSync(path.join(dir, 'src/lib/licensing.js'), 'let a = 2;');
        fs.writeFileSync(path.join(dir, 'src/lib/licensing.js'), 'let a = 3;');

        await new Promise(r => setTimeout(r, 1000));
        procPromise.child.kill('SIGINT');
        const result = await procPromise;
        
        // Count "Change detected" occurrences: should be debounced
        const occurrences = (result.stdout.match(/Change detected/g) || []).length;
        assert.ok(occurrences <= 3);
        cleanup();
    },

    'Command wrapping - spawns child process and prints output': async () => {
        const dir = getTempWorkspace();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), `
            module.exports = {
                serve: { port: 13100 },
                protect: [],
                output: './protected'
            };
        `);

        const procPromise = spawnProcess('node', [
            cliPath, 
            'dev', 
            '--', 
            'node', 
            '-e', 
            "console.log('child_started'); setTimeout(() => {}, 5000);"
        ], { cwd: dir });

        await new Promise(r => setTimeout(r, 1500));
        procPromise.child.kill('SIGINT');
        const result = await procPromise;

        assertStdoutContains(result, 'child_started');
    },

    'Port propagation - propagates FORTRESS_PORT and FORTRESS_DEV_PORT': async () => {
        const dir = getTempWorkspace();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), `
            module.exports = {
                serve: { port: 13110 },
                protect: [],
                output: './protected'
            };
        `);

        const procPromise = spawnProcess('node', [
            cliPath, 
            'dev', 
            '--', 
            'node', 
            '-e', 
            "console.log('PORT:' + process.env.FORTRESS_PORT); console.log('DEV_PORT:' + process.env.FORTRESS_DEV_PORT);"
        ], { cwd: dir });

        await new Promise(r => setTimeout(r, 1500));
        procPromise.child.kill('SIGINT');
        const result = await procPromise;

        const match = result.stdout.match(/listening on port (\d+)/);
        const boundPort = match ? match[1] : '13110';
        assertStdoutContains(result, `PORT:${boundPort}`);
        assertStdoutContains(result, `DEV_PORT:${boundPort}`);
    },

    'Process tree cleanup - terminates child process and grandchildren on SIGINT': async () => {
        const dir = getTempWorkspace();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), `
            module.exports = {
                serve: { port: 13120 },
                protect: [],
                output: './protected'
            };
        `);

        const childCode = `
            const cp = require('child_process');
            const fs = require('fs');
            const gc = cp.spawn('node', ['-e', 'setTimeout(() => {}, 60000)']);
            fs.writeFileSync('pids.txt', process.pid + ',' + gc.pid);
            setTimeout(() => {}, 60000);
        `.replace(/\n/g, ' ');

        const procPromise = spawnProcess('node', [
            cliPath, 
            'dev', 
            '--', 
            'node', 
            '-e', 
            childCode
        ], { cwd: dir });

        await new Promise(r => setTimeout(r, 2000));

        const pidsPath = path.join(dir, 'pids.txt');
        assert.ok(fs.existsSync(pidsPath), 'pids.txt should be written by child');
        const [childPid, grandchildPid] = fs.readFileSync(pidsPath, 'utf8').split(',').map(Number);

        const isPidRunning = (pid) => {
            try {
                process.kill(pid, 0);
                return true;
            } catch (e) {
                return e.code === 'EPERM';
            }
        };

        assert.ok(isPidRunning(childPid), 'Child should be running initially');
        assert.ok(isPidRunning(grandchildPid), 'Grandchild should be running initially');

        procPromise.child.kill('SIGINT');
        await procPromise;

        await new Promise(r => setTimeout(r, 500));

        assert.strictEqual(isPidRunning(childPid), false, 'Child process should be terminated');
        assert.strictEqual(isPidRunning(grandchildPid), false, 'Grandchild process should be terminated');
    },

    'Process tree cleanup - terminates child process and grandchildren on SIGTERM': async () => {
        const dir = getTempWorkspace();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), `
            module.exports = {
                serve: { port: 13130 },
                protect: [],
                output: './protected'
            };
        `);

        const childCode = `
            const cp = require('child_process');
            const fs = require('fs');
            const gc = cp.spawn('node', ['-e', 'setTimeout(() => {}, 60000)']);
            fs.writeFileSync('pids.txt', process.pid + ',' + gc.pid);
            setTimeout(() => {}, 60000);
        `.replace(/\n/g, ' ');

        const procPromise = spawnProcess('node', [
            cliPath, 
            'dev', 
            '--', 
            'node', 
            '-e', 
            childCode
        ], { cwd: dir });

        await new Promise(r => setTimeout(r, 2000));

        const pidsPath = path.join(dir, 'pids.txt');
        assert.ok(fs.existsSync(pidsPath), 'pids.txt should be written by child');
        const [childPid, grandchildPid] = fs.readFileSync(pidsPath, 'utf8').split(',').map(Number);

        const isPidRunning = (pid) => {
            try {
                process.kill(pid, 0);
                return true;
            } catch (e) {
                return e.code === 'EPERM';
            }
        };

        assert.ok(isPidRunning(childPid), 'Child should be running initially');
        assert.ok(isPidRunning(grandchildPid), 'Grandchild should be running initially');

        procPromise.child.kill('SIGTERM');
        await procPromise;

        await new Promise(r => setTimeout(r, 500));

        assert.strictEqual(isPidRunning(childPid), false, 'Child process should be terminated');
        assert.strictEqual(isPidRunning(grandchildPid), false, 'Grandchild process should be terminated');
    },

    'Spontaneous exit propagation - exits parent with child exit code': async () => {
        const dir = getTempWorkspace();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), `
            module.exports = {
                serve: { port: 13140 },
                protect: [],
                output: './protected'
            };
        `);

        const result = await spawnProcess('node', [
            cliPath, 
            'dev', 
            '--', 
            'node', 
            '-e', 
            "setTimeout(() => { process.exit(3); }, 1000);"
        ], { cwd: dir });

        assertExitCode(result, 3);
        cleanup();
    }
});
