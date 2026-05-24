const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const { runTestSuite, spawnProcess, assertExitCode, assertStdoutContains } = require('./runner');

const cliPath = path.join(__dirname, '../../bin/index.js');
const TEMP_BASE = path.join(os.tmpdir(), `fortress_verify_tests_${crypto.randomBytes(4).toString('hex')}`);

function getTempReportPath() {
    return path.join(TEMP_BASE, `report_${crypto.randomBytes(8).toString('hex')}.json`);
}

fs.mkdirSync(TEMP_BASE, { recursive: true });

function cleanup() {
    try {
        fs.rmSync(TEMP_BASE, { recursive: true, force: true });
    } catch (e) {}
}

runTestSuite('F9: Verify Command E2E Overhaul Test Suite', {
    // --- Tier 1: Feature Coverage (5 tests) ---
    'Verify Command Run - executes verify against default options successfully': async () => {
        const reportFile = getTempReportPath();
        const result = await spawnProcess('node', [cliPath, 'verify', '--output', reportFile]);
        assertExitCode(result, 0);
        assertStdoutContains(result, 'Fortress WASM — Security Verification');
        assertStdoutContains(result, 'Score: 100/100');
    },

    '100/100 Audit Score Assertion - reports perfect score on pristine build': async () => {
        const reportFile = getTempReportPath();
        await spawnProcess('node', [cliPath, 'verify', '--output', reportFile]);
        
        const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
        assert.strictEqual(report.score, 100);
        assert.strictEqual(report.status, 'PASS');
    },

    'Audit JSON Report Generation - verify report file is written correctly': async () => {
        const reportFile = getTempReportPath();
        await spawnProcess('node', [cliPath, 'verify', '--output', reportFile]);
        
        assert.ok(fs.existsSync(reportFile));
        const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
        assert.ok(report.timestamp);
        assert.strictEqual(typeof report.score, 'number');
    },

    'Verify Help Output - lists command options': async () => {
        const result = await spawnProcess('node', [cliPath, 'verify', '--help']);
        assertExitCode(result, 0);
        assertStdoutContains(result, 'Usage: fortress-wasm verify');
        assertStdoutContains(result, '--endpoint');
        assertStdoutContains(result, '--output');
    },

    'Dev Mode Warning - warns user when running in dev mode': async () => {
        const reportFile = getTempReportPath();
        const result = await spawnProcess('node', [cliPath, 'verify', '--output', reportFile], {
            env: { ...process.env, DEV_MODE: 'true' }
        });
        assertExitCode(result, 0);
        assert.ok(result.stderr.includes('Warning: DEV mode is active. Hardening phases are disabled.'));
    },

    // --- Tier 2: Boundary & Corner Cases (5 tests) ---
    'Tampered Handshake Signature - reports signature failure and deducts score': async () => {
        const reportFile = getTempReportPath();
        const result = await spawnProcess('node', [cliPath, 'verify', '--output', reportFile, '--tamper-signature']);
        assertExitCode(result, 1);
        
        const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
        assert.strictEqual(report.score, 80);
        assert.strictEqual(report.status, 'FAIL');
        assert.ok(report.failures.includes('Signature verification failed'));
    },

    'Replayed Session Nonce - reports replayed nonces and deducts score': async () => {
        const reportFile = getTempReportPath();
        const result = await spawnProcess('node', [cliPath, 'verify', '--output', reportFile, '--replay-nonce']);
        assertExitCode(result, 1);

        const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
        assert.strictEqual(report.score, 80);
        assert.ok(report.failures.includes('Replayed nonce detected'));
    },

    'Expired Handshake Timestamp - reports expired handshake and deducts score': async () => {
        const reportFile = getTempReportPath();
        const result = await spawnProcess('node', [cliPath, 'verify', '--output', reportFile, '--expired-timestamp']);
        assertExitCode(result, 1);

        const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
        assert.strictEqual(report.score, 80);
        assert.ok(report.failures.includes('Handshake expired'));
    },

    'Malformed Handshake Length - reports malformed header format': async () => {
        const reportFile = getTempReportPath();
        const result = await spawnProcess('node', [cliPath, 'verify', '--output', reportFile, '--malformed-handshake']);
        assertExitCode(result, 1);

        const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
        assert.strictEqual(report.score, 80);
        assert.ok(report.failures.includes('Malformed handshake header length'));
    },

    'Integrity Fail Low Score - combined failures yield low score and exit 1': async () => {
        const reportFile = getTempReportPath();
        const result = await spawnProcess('node', [
            cliPath, 'verify', '--output', reportFile,
            '--tamper-signature', '--replay-nonce', '--expired-timestamp', '--malformed-handshake'
        ]);
        assertExitCode(result, 1);

        const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
        assert.strictEqual(report.score, 20);
        assert.strictEqual(report.status, 'FAIL');
        assert.strictEqual(report.failures.length, 4);
        cleanup();
    }
});
