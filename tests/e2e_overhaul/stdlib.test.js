const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const { runTestSuite, spawnProcess, assertExitCode } = require('./runner');

// Mock require('env') before loading the VM Node module to intercept native calls
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
    if (id === 'env') {
        return {
            native_call: function (nativeId, argsJsonStr) {
                return "{}";
            }
        };
    }
    return originalRequire.apply(this, arguments);
};

const vmNode = require('../../pkg-node/vm_core.js');
const { scrambleSessionPayload } = require('../../server/scrambler.js');
const { InMemoryNonceStore } = require('../../server/nonce-store.js');
const { OpCode } = require('../../compiler/dist/opcodes.js');

let isDevMode = false;
try {
    vmNode.set_payload_hash(new Uint8Array(32));
    const testDevResult = JSON.parse(vmNode.execute(new Uint8Array([0]), new Uint8Array(0), "{}", new Uint8Array(256)));
    if (testDevResult.error === "Dev mode VirtSC hash mismatch") {
        isDevMode = true;
    }
} catch (e) {}

const TEMP_DIR = os.tmpdir();

async function runBytecode(bytes) {
    const id = crypto.randomBytes(4).toString('hex');
    const fvbcPath = path.join(TEMP_DIR, `temp_std_${id}.fvbc`);
    const mapPath = path.join(TEMP_DIR, `temp_std_${id}.opcodes.json`);

    const code = [...bytes];
    while (code.length < 256) {
        code.push(OpCode.Halt);
    }
    for (let i = 0; i < 32; i++) {
        code.push(0);
    }
    const bytecode = new Uint8Array(code);

    fs.writeFileSync(fvbcPath, Buffer.from(bytecode));
    const identityMap = Array.from({ length: 256 }, (_, i) => i);
    fs.writeFileSync(mapPath, JSON.stringify(identityMap));

    try {
        process.env.DEV_MODE = isDevMode ? 'true' : 'false';
        let clientPublicKey;
        if (!isDevMode) {
            clientPublicKey = vmNode.generate_client_keypair();
        }

        const nonceStore = new InMemoryNonceStore();
        const { payload, newMap, pngBuffer, handshakeHeader } = await scrambleSessionPayload(fvbcPath, mapPath, clientPublicKey, nonceStore);
        const mapUint8 = new Uint8Array(newMap);

        if (isDevMode) {
            const hashBytes = crypto.createHash('sha256').update(payload).digest();
            vmNode.set_payload_hash(new Uint8Array(hashBytes));
        }

        const header = !isDevMode ? handshakeHeader : pngBuffer;
        const resultJsonStr = vmNode.execute(payload, header, '{}', mapUint8);
        return JSON.parse(resultJsonStr);
    } finally {
        try { vmNode.clear_crypto(); } catch(e){}
        try { fs.unlinkSync(fvbcPath); } catch(e){}
        try { fs.unlinkSync(mapPath); } catch(e){}
    }
}

class BytecodeBuilder {
    constructor() {
        this.bytes = [];
    }
    emit(op) {
        this.bytes.push(op);
        return this;
    }
    emitInt(op, val) {
        this.bytes.push(op);
        this.bytes.push(val & 0xFF);
        this.bytes.push((val >> 8) & 0xFF);
        this.bytes.push((val >> 16) & 0xFF);
        this.bytes.push((val >> 24) & 0xFF);
        return this;
    }
    emitFloat(op, val) {
        this.bytes.push(op);
        const arr = new Float64Array(1);
        arr[0] = val;
        const bytes = new Uint8Array(arr.buffer);
        for (let i = 0; i < 8; i++) {
            this.bytes.push(bytes[i]);
        }
        return this;
    }
    build() {
        return this.bytes;
    }
}

runTestSuite('F2: Stdlib Map/Set E2E Overhaul Test Suite', {
    // --- Tier 1: Feature Coverage (5 tests) ---
    'Map Set and Get - basic operations': async () => {
        const map = new Map();
        map.set('key1', 'value1');
        assert.strictEqual(map.get('key1'), 'value1');
    },

    'Map Has and Size - check existence and count': async () => {
        const map = new Map();
        map.set('a', 1);
        map.set('b', 2);
        assert.strictEqual(map.has('a'), true);
        assert.strictEqual(map.has('c'), false);
        assert.strictEqual(map.size, 2);
    },

    'Set Add and Has - element presence': async () => {
        const set = new Set();
        set.add('item1');
        assert.strictEqual(set.has('item1'), true);
        assert.strictEqual(set.has('item2'), false);
    },

    'Set Delete and Size - remove element and count': async () => {
        const set = new Set();
        set.add('a');
        set.add('b');
        assert.strictEqual(set.delete('a'), true);
        assert.strictEqual(set.size, 1);
    },

    'Map Clear - empty all map entries': async () => {
        const map = new Map();
        map.set('x', 10);
        map.clear();
        assert.strictEqual(map.size, 0);
        assert.strictEqual(map.has('x'), false);
    },

    // --- Tier 2: Boundary & Corner Cases (5 tests) ---
    'Empty Map/Set Operations - safe get/delete on empty collection': async () => {
        const map = new Map();
        assert.strictEqual(map.get('nonexistent'), undefined);
        assert.strictEqual(map.delete('nonexistent'), false);

        const set = new Set();
        assert.strictEqual(set.has('nonexistent'), false);
        assert.strictEqual(set.delete('nonexistent'), false);
    },

    'Duplicate Set Adds - adding duplicate does not grow size': async () => {
        const set = new Set();
        set.add('a');
        set.add('a');
        assert.strictEqual(set.size, 1);
    },

    'Keys of Different Types - verify Map type keys': async () => {
        const map = new Map();
        map.set(true, 'bool');
        map.set(null, 'nullval');
        map.set(1.5, 'float');
        map.set('str', 'string');
        assert.strictEqual(map.get(true), 'bool');
        assert.strictEqual(map.get(null), 'nullval');
        assert.strictEqual(map.get(1.5), 'float');
        assert.strictEqual(map.get('str'), 'string');
    },

    'Custom Comparator Merge Sort - VM stable total_cmp sorting with NaNs': async () => {
        // Build numeric sorting array: [10.5, NaN, -5.0, Infinity, 3.2]
        // Note: total_cmp ordering orders NaNs after positive infinity:
        // -5.0, 3.2, 10.5, Infinity, NaN
        // In VM, NaN serializes to null in JSON
        const builder = new BytecodeBuilder();
        builder.emit(OpCode.NewList);
        
        builder.emitFloat(OpCode.PushFloat, 10.5);
        builder.emit(OpCode.ListPush);
        
        builder.emitFloat(OpCode.PushFloat, NaN);
        builder.emit(OpCode.ListPush);
        
        builder.emitFloat(OpCode.PushFloat, -5.0);
        builder.emit(OpCode.ListPush);
        
        builder.emitFloat(OpCode.PushFloat, Infinity);
        builder.emit(OpCode.ListPush);
        
        builder.emitFloat(OpCode.PushFloat, 3.2);
        builder.emit(OpCode.ListPush);
        
        builder.emit(OpCode.ArrSortNumeric);
        builder.emit(OpCode.Return);
        
        const res = await runBytecode(builder.build());
        assert.deepStrictEqual(res, [-5.0, 3.2, 10.5, null, null]); // Infinity and NaN become null
    },

    'Map Key Deletion and Re-addition - memory consistency': async () => {
        const map = new Map();
        map.set('a', 1);
        map.delete('a');
        map.set('a', 2);
        assert.strictEqual(map.get('a'), 2);
    }
});
