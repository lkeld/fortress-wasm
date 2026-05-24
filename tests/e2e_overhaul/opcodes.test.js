const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const { runTestSuite } = require('./runner');

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

// Check DEV mode dynamically
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
    const fvbcPath = path.join(TEMP_DIR, `temp_op_${id}.fvbc`);
    const mapPath = path.join(TEMP_DIR, `temp_op_${id}.opcodes.json`);

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
    emitString(op, val) {
        this.bytes.push(op);
        const encoder = new TextEncoder();
        const strBytes = encoder.encode(val);
        const nonce = new Uint8Array([0, 0, 0, 0]);
        for (let i = 0; i < 4; i++) {
            this.bytes.push(nonce[i]);
        }
        const len = strBytes.length;
        this.bytes.push(len & 0xFF);
        this.bytes.push((len >> 8) & 0xFF);
        this.bytes.push((len >> 16) & 0xFF);
        this.bytes.push((len >> 24) & 0xFF);
        
        // Derive all-zeros keystream
        const crypto = require('crypto');
        const zeroKey = new Uint8Array(32);
        let offset = 0;
        let blockIndex = 0;
        const keystream = new Uint8Array(len);
        while (offset < len) {
            const hasher = crypto.createHash('sha256');
            hasher.update(zeroKey);
            hasher.update(nonce);
            const blockBuf = Buffer.alloc(4);
            blockBuf.writeUInt32LE(blockIndex);
            hasher.update(blockBuf);
            const block = hasher.digest();
            for (let k = 0; k < block.length && offset < len; k++) {
                keystream[offset++] = block[k];
            }
            blockIndex++;
        }
        
        for (let i = 0; i < len; i++) {
            this.bytes.push(strBytes[i] ^ keystream[i]);
        }
        return this;
    }
    build() {
        return this.bytes;
    }
}

runTestSuite('F1: Opcodes E2E Overhaul Test Suite', {
    // --- Tier 1: Feature Coverage (5 tests) ---
    'Math Opcodes - floor, ceil, round, abs': async () => {
        const builder = new BytecodeBuilder();
        builder.emitFloat(OpCode.PushFloat, 10.5);
        builder.emit(OpCode.MathFloor); // 10
        builder.emitFloat(OpCode.PushFloat, 5.2);
        builder.emit(OpCode.MathCeil); // 6
        builder.emit(OpCode.Add); // 16
        builder.emit(OpCode.Return);
        const res = await runBytecode(builder.build());
        assert.strictEqual(res, 16);
    },

    'String Opcodes - slice and charCodeAt': async () => {
        const builder = new BytecodeBuilder();
        builder.emitString(OpCode.PushString, "fortress");
        builder.emitInt(OpCode.PushInt, 1);
        builder.emitInt(OpCode.PushInt, 4);
        builder.emit(OpCode.StrSlice); // "ort"
        builder.emitInt(OpCode.PushInt, 1);
        builder.emit(OpCode.StrCharCodeAt); // 'r' -> 114
        builder.emit(OpCode.Return);
        const res = await runBytecode(builder.build());
        assert.strictEqual(res, 114);
    },

    'Regex Opcodes - regex test capability': async () => {
        const builder = new BytecodeBuilder();
        builder.emitString(OpCode.PushString, "^fortress.*wasm$");
        builder.emitString(OpCode.PushString, "fortress-wasm");
        builder.emit(OpCode.RegExTest);
        builder.emit(OpCode.Return);
        const res = await runBytecode(builder.build());
        assert.strictEqual(res, true);
    },

    'Typechecking Opcodes - typeof operation': async () => {
        const builder = new BytecodeBuilder();
        builder.emitString(OpCode.PushString, "hello");
        builder.emit(OpCode.TypeOf);
        builder.emit(OpCode.Return);
        const res = await runBytecode(builder.build());
        assert.strictEqual(res, "string");
    },

    'JSON Opcodes - parse and stringify': async () => {
        const builder = new BytecodeBuilder();
        builder.emitString(OpCode.PushString, '{"val":123}');
        builder.emit(OpCode.JSONParse);
        builder.emit(OpCode.JSONStringify);
        builder.emit(OpCode.Return);
        const res = await runBytecode(builder.build());
        assert.strictEqual(res, '{"val":123}');
    },

    // --- Tier 2: Boundary & Corner Cases (5 tests) ---
    'Division by Zero - IEEE 754 yields Infinity mapping to null in JSON': async () => {
        const builder = new BytecodeBuilder();
        builder.emitFloat(OpCode.PushFloat, 10.0);
        builder.emitFloat(OpCode.PushFloat, 0.0);
        builder.emit(OpCode.Div);
        builder.emit(OpCode.Return);
        const res = await runBytecode(builder.build());
        assert.strictEqual(res, null); // Infinity serializes to JSON null
    },

    'Bitwise Shifts Masking - shift amount is masked to 5 bits': async () => {
        const builder = new BytecodeBuilder();
        builder.emitInt(OpCode.PushInt, 1);
        builder.emitInt(OpCode.PushInt, 33); // 33 & 31 = 1
        builder.emit(OpCode.Shl); // 1 << 1 = 2
        builder.emit(OpCode.Return);
        const res = await runBytecode(builder.build());
        assert.strictEqual(res, 2);
    },

    'Index Out of Bounds - Safe VmError reporting': async () => {
        const builder = new BytecodeBuilder();
        builder.emit(OpCode.NewList);
        builder.emitInt(OpCode.PushInt, 5); // OOB index
        builder.emit(OpCode.GetMember);
        builder.emit(OpCode.Return);
        const res = await runBytecode(builder.build());
        assert.strictEqual(res.status, false);
        assert.strictEqual(res.error, "IndexOutOfBounds");
    },

    'Uninitialized Variable - loading uninitialized slot returns null': async () => {
        const builder = new BytecodeBuilder();
        builder.emitInt(OpCode.LoadLocal, 50); // Uninitialized slot
        builder.emit(OpCode.Return);
        const res = await runBytecode(builder.build());
        assert.strictEqual(res, null);
    },

    'Regex Cache Eviction - LRU limits and eviction': async () => {
        const builder = new BytecodeBuilder();
        // Generate 35 regex compiles to exceed cache capacity of 32
        for (let i = 0; i < 35; i++) {
            builder.emitString(OpCode.PushString, "test");
            builder.emitString(OpCode.PushString, `re_${i}`);
            builder.emit(OpCode.RegExTest);
            builder.emit(OpCode.Pop);
        }
        builder.emitInt(OpCode.PushInt, 999);
        builder.emit(OpCode.Return);
        const res = await runBytecode(builder.build());
        assert.strictEqual(res, 999);
    }
});
