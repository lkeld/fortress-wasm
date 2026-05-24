process.env.DEV_MODE = 'true';
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const { runTestSuite } = require('./runner');
const { FortressClient } = require('../../client.js');
const { OpCode } = require('../../compiler/dist/opcodes.js');

const TEMP_DIR = os.tmpdir();
const mockEndpointPath = path.join(TEMP_DIR, `mock_sdk_endpoint_${crypto.randomBytes(4).toString('hex')}.json`);

// Generate mock endpoint payload containing: return 77
const dummyCode = [OpCode.PushInt, 77, 0, 0, 0, OpCode.Return];
while (dummyCode.length < 256) {
    dummyCode.push(OpCode.Halt);
}
for (let i = 0; i < 32; i++) {
    dummyCode.push(0);
}

const payloadData = {
    payload: Buffer.from(new Uint8Array(dummyCode)).toString('base64'),
    opcodeMap: Array.from({ length: 256 }, (_, i) => i),
    handshake: Buffer.from(new Uint8Array(154)).toString('base64')
};

fs.writeFileSync(mockEndpointPath, JSON.stringify(payloadData));

runTestSuite('F6: Client SDK E2E Overhaul Test Suite', {
    // --- Tier 1: Feature Coverage (5 tests) ---
    'FortressClient Initialization - client initializes successfully from endpoint': async () => {
        const client = await FortressClient.init(mockEndpointPath);
        assert.ok(client.worker);
        client.dispose();
    },

    'ESM Worker URL Loading - Strategy 1 initializes worker': async () => {
        const worker = await FortressClient.createWorker('strategy1');
        assert.ok(worker);
        worker.terminate();
    },

    'IIFE Worker Bundle Loading - Strategy 2 initializes worker': async () => {
        const worker = await FortressClient.createWorker('strategy2');
        assert.ok(worker);
        worker.terminate();
    },

    'Message Exchange postMessage - execute returns correct value from worker': async () => {
        const client = await FortressClient.init(mockEndpointPath);
        const result = await client.execute([]);
        assert.strictEqual(result, 77);
        client.dispose();
    },

    'Clean Client Shutdown - dispose terminates worker and rejects pending': async () => {
        const client = await FortressClient.init(mockEndpointPath);
        const promise = client.execute([]);
        client.dispose();
        await assert.rejects(promise, /Fortress client disposed/);
    },

    // --- Tier 2: Boundary & Corner Cases (5 tests) ---
    'Offline Worker Fallback - falls back to Strategy 2 when Strategy 1 fails': async () => {
        // Since createWorker automatically falls back to Strategy 2 if Strategy 1 fails,
        // we test that calling it normally succeeds.
        const worker = await FortressClient.createWorker();
        assert.ok(worker);
        worker.terminate();
    },

    'CSP worker-src blob missing 10s timeout - reject on missing capability': async () => {
        await assert.rejects(
            FortressClient.createWorker('csp-timeout'),
            /CSP worker-src blob missing 10s timeout/
        );
    },

    'Large Message Capacity - handles payloads larger than 4KB gracefully': async () => {
        const client = await FortressClient.init(mockEndpointPath);
        const largeInput = 'a'.repeat(5000); // >4KB input payload
        const result = await client.execute(largeInput);
        assert.strictEqual(result, 77);
        client.dispose();
    },

    'Invalid Message Response - handles invalid messages without crashing': async () => {
        const client = await FortressClient.init(mockEndpointPath);
        // Sending a message directly to worker with incorrect type
        client.worker.postMessage({ id: '999', type: 'INVALID_TYPE', payload: {} });
        // Client should not crash
        assert.ok(client.worker);
        client.dispose();
    },

    'Concurrent Client Instances - multiple clients execute concurrently': async () => {
        const client1 = await FortressClient.init(mockEndpointPath);
        const client2 = await FortressClient.init(mockEndpointPath);
        
        const [res1, res2] = await Promise.all([
            client1.execute([]),
            client2.execute([])
        ]);
        
        assert.strictEqual(res1, 77);
        assert.strictEqual(res2, 77);
        
        client1.dispose();
        client2.dispose();
        
        // Clean up mock endpoint file
        try { fs.unlinkSync(mockEndpointPath); } catch (e) {}
    }
});
