const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const TEMP_DIR = os.tmpdir();

// Setup the mock for require('env') BEFORE importing the VM Node module
let activeNativeHandler = null;

const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
    if (id === 'env') {
        return {
            native_call: function (nativeId, argsJsonStr) {
                try {
                    if (activeNativeHandler) {
                        return activeNativeHandler(nativeId, argsJsonStr);
                    }
                    return "";
                } catch (err) {
                    return JSON.stringify({ error: "HandlerError", message: err.message || String(err) });
                }
            }
        };
    }
    return originalRequire.apply(this, arguments);
};

// Now import the compiler and VM
const vmNode = require('../pkg-node/vm_core.js');

// Detect DEV mode dynamically from the VM build
let isDevMode = false;
try {
    vmNode.set_payload_hash(new Uint8Array(32)); // Set all-zero fake hash
    const testDevResult = JSON.parse(vmNode.execute(new Uint8Array([0]), new Uint8Array(0), "{}", new Uint8Array(256)));
    if (testDevResult.error === "Dev mode VirtSC hash mismatch") {
        isDevMode = true;
    }
} catch (e) {}

process.env.DEV_MODE = isDevMode ? 'true' : 'false';

const { Parser } = require('../compiler/dist/parser.js');
const { CodeGenerator } = require('../compiler/dist/codegen.js');
const { scrambleSessionPayload } = require('../server/scrambler.js');
const { InMemoryNonceStore } = require('../server/nonce-store.js');

// Save the worker initialization time
const workerInitTime = performance.now();

const { nativeCallRouter } = require('../js-runtime/dist/router.js');

const testCachedNativeData = {
    webgl: "MockWebGLRenderer ~ Apple GPU",
    canvas: "mock_canvas_fingerprint_hash_value_12345",
    automation: { webdriver: false },
    screen: { width: 1920, height: 1080 }
};

function localNativeCallRouter(id, argsJson) {
    return nativeCallRouter(id, argsJson, testCachedNativeData, workerInitTime);
}

// Helper to compile and run VM code
async function runVmCode(source, input = []) {
    vmNode.clear_crypto();
    
    const parser = new Parser(source);
    const ast = parser.parseProgram();
    const codegen = new CodeGenerator();
    const { code, opcodeMap } = codegen.generate(ast);
    
    const fvbcPath = path.join(TEMP_DIR, 'test_native.fvbc');
    const mapPath = path.join(TEMP_DIR, 'test_native.opcodes.json');
    fs.writeFileSync(fvbcPath, Buffer.from(code));
    fs.writeFileSync(mapPath, JSON.stringify(Array.from(opcodeMap)));
    
    try {
        let clientPublicKey;
        if (!isDevMode) {
            clientPublicKey = vmNode.generate_client_keypair();
        }

        const nonceStore = new InMemoryNonceStore();
        const { payload, newMap, pngBuffer, handshakeHeader } = await scrambleSessionPayload(fvbcPath, mapPath, clientPublicKey, nonceStore);
        const mapUint8 = new Uint8Array(newMap);
        
        let inputJsonStr = '{}';
        if (input && input.length > 0) {
            const paddedInputs = Array(7).fill(null).concat(input);
            inputJsonStr = JSON.stringify(paddedInputs);
        }
        
        // Handle DEV_MODE hash setting
        if (isDevMode) {
            const hashBytes = crypto.createHash('sha256').update(payload).digest();
            vmNode.set_payload_hash(new Uint8Array(hashBytes));
        }

        const header = !isDevMode ? handshakeHeader : pngBuffer;
        // Execute the compiled VM payload
        const resultJsonStr = vmNode.execute(payload, header, inputJsonStr, mapUint8);
        return JSON.parse(resultJsonStr);
    } finally {
        if (!isDevMode) {
            vmNode.clear_crypto();
        }
        try {
            fs.unlinkSync(fvbcPath);
            fs.unlinkSync(mapPath);
        } catch (e) {}
    }
}

test('ID 1001 (get_environment) returns correct structure and types', async () => {
    activeNativeHandler = localNativeCallRouter;
    const res = await runVmCode('return __native_call(1001);');
    assert.ok(res !== null && typeof res === 'object', 'Should return an object');
    assert.strictEqual(typeof res.webdriver, 'boolean');
    assert.strictEqual(typeof res.hardwareConcurrency, 'number');
    assert.strictEqual(typeof res.deviceMemory, 'number');
    assert.ok(Array.isArray(res.languages));
    assert.strictEqual(typeof res.plugins_count, 'number');
});

test('ID 1002 (get_timing_delta) returns positive timing delta', async () => {
    activeNativeHandler = localNativeCallRouter;
    const start = Date.now();
    while (Date.now() - start < 5) {}
    const res = await runVmCode('return __native_call(1002);');
    assert.ok(res !== null && typeof res === 'object', 'Should return an object');
    assert.strictEqual(typeof res.delta_ms, 'number');
    assert.ok(res.delta_ms >= 0);
});

test('ID 1003 (get_webgl_info) handles supported and unsupported cases', async () => {
    activeNativeHandler = localNativeCallRouter;
    
    // 1. OffscreenCanvas undefined
    const res1 = await runVmCode('return __native_call(1003);');
    assert.deepStrictEqual(res1, { supported: false });
    
    // 2. Mock OffscreenCanvas
    global.OffscreenCanvas = class {
        constructor(width, height) {
            this.width = width;
            this.height = height;
        }
        getContext(type) {
            if (type === 'webgl' || type === 'experimental-webgl') {
                return {
                    getExtension(ext) {
                        if (ext === 'WEBGL_debug_renderer_info') {
                            return {
                                UNMASKED_VENDOR_WEBGL: 0x9245,
                                UNMASKED_RENDERER_WEBGL: 0x9246
                            };
                        }
                        return null;
                    },
                    getParameter(param) {
                        if (param === 0x9245) return "Mock Vendor";
                        if (param === 0x9246) return "Mock Renderer";
                        if (param === 0x1f02) return "WebGL 1.0 Mock"; // VENDOR
                        if (param === 0x1f01) return "Mock WebGL Renderer"; // RENDERER
                        if (param === 0x1f00) return "Mock OpenGL ES 2.0"; // VERSION
                        if (param === 0x8b8c) return "Mock GLSL ES 1.0"; // SHADING_LANGUAGE_VERSION
                        return "mock_param";
                    },
                    VENDOR: 0x1f02,
                    RENDERER: 0x1f01,
                    VERSION: 0x1f00,
                    SHADING_LANGUAGE_VERSION: 0x8b8c
                };
            }
            return null;
        }
    };
    
    try {
        const res2 = await runVmCode('return __native_call(1003);');
        assert.ok(res2.supported, 'WebGL should be supported in mock');
        assert.strictEqual(res2.vendor, 'Mock Vendor');
        assert.strictEqual(res2.renderer, 'Mock Renderer');
        assert.strictEqual(res2.version, 'Mock OpenGL ES 2.0');
        assert.strictEqual(res2.shadingLanguageVersion, 'Mock GLSL ES 1.0');
    } finally {
        delete global.OffscreenCanvas;
    }
});

test('ID 1004 (get_screen_metrics) returns screen metrics', async () => {
    activeNativeHandler = localNativeCallRouter;
    const res = await runVmCode('return __native_call(1004);');
    assert.ok(res !== null && typeof res === 'object', 'Should return an object');
    assert.strictEqual(typeof res.width, 'number');
    assert.strictEqual(typeof res.height, 'number');
    assert.strictEqual(typeof res.colorDepth, 'number');
    assert.strictEqual(typeof res.pixelRatio, 'number');
});

test('ID 9999 (ping) returns status and timestamp', async () => {
    activeNativeHandler = localNativeCallRouter;
    const res = await runVmCode('return __native_call(9999);');
    assert.deepStrictEqual(res.status, 'ok');
    assert.strictEqual(typeof res.timestamp, 'number');
    assert.ok(res.timestamp > 0);
});

test('Exceptions in native call handler are caught and wrapped', async () => {
    activeNativeHandler = () => {
        throw new Error("Something went wrong");
    };
    const res = await runVmCode('return __native_call(9999);');
    assert.strictEqual(res.error, "HandlerError");
    assert.strictEqual(res.message, "Something went wrong");
});

test('Arguments to native call exceeding 4096 bytes return PayloadTooLarge', async () => {
    activeNativeHandler = localNativeCallRouter;
    const source = `
        let s = "1234567890123456";
        s = s + s;
        s = s + s;
        s = s + s;
        s = s + s;
        s = s + s;
        s = s + s;
        s = s + s;
        s = s + s;
        s = s + s;
        return __native_call(9999, s);
    `;
    const res = await runVmCode(source);
    assert.deepStrictEqual(res, { error: "PayloadTooLarge" });
});

test('Returned string from native call exceeding 4096 bytes returns PayloadTooLarge string', async () => {
    activeNativeHandler = () => {
        return "A".repeat(4097);
    };
    const res = await runVmCode('return __native_call(9999);');
    assert.strictEqual(res, "PayloadTooLarge");
});
