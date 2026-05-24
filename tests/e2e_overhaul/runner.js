const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

/**
 * Spawns a subprocess and returns a promise with the execution result.
 */
function spawnProcess(command, args = [], options = {}) {
    let child;
    const promise = new Promise((resolve, reject) => {
        child = spawn(command, args, {
            cwd: options.cwd || process.cwd(),
            env: { ...process.env, ...options.env },
            ...options
        });

        let stdout = '';
        let stderr = '';

        if (child.stdout) {
            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });
        }

        if (child.stderr) {
            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });
        }

        if (options.input && child.stdin) {
            child.stdin.write(options.input);
            child.stdin.end();
        }

        child.on('close', (code) => {
            resolve({ code, stdout, stderr });
        });

        child.on('error', (err) => {
            reject(err);
        });
    });
    promise.child = child;
    return promise;
}

/**
 * Assertion helpers
 */
function assertExitCode(result, expectedCode) {
    assert.strictEqual(
        result.code, 
        expectedCode, 
        `Expected exit code ${expectedCode}, but got ${result.code}.\nStdout: ${result.stdout}\nStderr: ${result.stderr}`
    );
}

function assertStdoutContains(result, substring) {
    assert.ok(
        result.stdout.includes(substring), 
        `Expected stdout to contain "${substring}", but it did not.\nStdout: ${result.stdout}`
    );
}

/**
 * Asserts stdout matches regex pattern or RegExp object
 */
function assertStdoutMatches(result, regexPattern) {
    const regex = typeof regexPattern === 'string' ? new RegExp(regexPattern) : regexPattern;
    assert.ok(
        regex.test(result.stdout), 
        `Expected stdout to match regex ${regex}, but it did not.\nStdout: ${result.stdout}`
    );
}

function assertStderrContains(result, substring) {
    assert.ok(
        result.stderr.includes(substring), 
        `Expected stderr to contain "${substring}", but it did not.\nStderr: ${result.stderr}`
    );
}

/**
 * Asserts stderr matches regex pattern or RegExp object
 */
function assertStderrMatches(result, regexPattern) {
    const regex = typeof regexPattern === 'string' ? new RegExp(regexPattern) : regexPattern;
    assert.ok(
        regex.test(result.stderr), 
        `Expected stderr to match regex ${regex}, but it did not.\nStderr: ${result.stderr}`
    );
}

function assertFileExists(filePath) {
    assert.ok(
        fs.existsSync(filePath), 
        `Expected file "${filePath}" to exist, but it does not.`
    );
}

function assertFileContains(filePath, substring) {
    assertFileExists(filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(
        content.includes(substring), 
        `Expected file "${filePath}" to contain "${substring}", but it did not.`
    );
}

// Simple test running harness
async function runTestSuite(suiteName, tests) {
    console.log(`==========================================`);
    console.log(`Running Suite: ${suiteName}`);
    console.log(`==========================================`);
    let passed = 0;
    let failed = 0;

    for (const [name, fn] of Object.entries(tests)) {
        console.log(`Test: ${name}...`);
        try {
            await fn();
            console.log(`  => PASS`);
            passed++;
        } catch (err) {
            console.error(`  => FAIL: ${err.message}`);
            if (err.stack) {
                console.error(err.stack);
            }
            failed++;
        }
    }

    console.log(`\nResults for ${suiteName}:`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`==========================================`);

    if (failed > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

module.exports = {
    spawnProcess,
    assertExitCode,
    assertStdoutContains,
    assertStdoutMatches,
    assertStderrContains,
    assertStderrMatches,
    assertFileExists,
    assertFileContains,
    runTestSuite
};
