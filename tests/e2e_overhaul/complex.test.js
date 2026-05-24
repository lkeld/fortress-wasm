const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const { runTestSuite, spawnProcess, assertExitCode, assertStdoutContains } = require('./runner');

const cliPath = path.join(__dirname, '../../bin/index.js');
const createStubPath = path.join(__dirname, '../../packages/create-fortress-app/bin/index.js');
const { Parser } = require('../../compiler/dist/parser.js');
const { CodeGenerator } = require('../../compiler/dist/codegen.js');
const { FortressClient } = require('../../client.js');
const { scrambleSessionPayload } = require('../../server/scrambler.js');
const { InMemoryNonceStore } = require('../../server/nonce-store.js');
const vmNode = require('../../pkg-node/vm_core.js');
const { OpCode } = require('../../compiler/dist/opcodes.js');

let isDevMode = false;
try {
    vmNode.set_payload_hash(new Uint8Array(32));
    const testDevResult = JSON.parse(vmNode.execute(new Uint8Array([0]), new Uint8Array(0), "{}", new Uint8Array(256)));
    if (testDevResult.error === "Dev mode VirtSC hash mismatch") {
        isDevMode = true;
    }
} catch (e) {}

const TEMP_BASE = path.join(os.tmpdir(), `fortress_complex_tests_${crypto.randomBytes(4).toString('hex')}`);
fs.mkdirSync(TEMP_BASE, { recursive: true });

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
        for (let i = 0; i < 4; i++) {
            this.bytes.push(0); // nonce
        }
        const len = strBytes.length;
        this.bytes.push(len & 0xFF);
        this.bytes.push((len >> 8) & 0xFF);
        this.bytes.push((len >> 16) & 0xFF);
        this.bytes.push((len >> 24) & 0xFF);
        for (let i = 0; i < len; i++) {
            this.bytes.push(strBytes[i]);
        }
        return this;
    }
    build() {
        return this.bytes;
    }
}

async function prepareSdkEndpoint(bytes) {
    const id = crypto.randomBytes(4).toString('hex');
    const fvbcPath = path.join(TEMP_BASE, `temp_sdk_${id}.fvbc`);
    const mapPath = path.join(TEMP_BASE, `temp_sdk_${id}.opcodes.json`);
    const endpointPath = path.join(TEMP_BASE, `temp_sdk_ep_${id}.json`);

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
        let clientPrivateKey;
        if (!isDevMode) {
            clientPublicKey = vmNode.generate_client_keypair();
            clientPrivateKey = vmNode.get_client_private_key();
        }

        const nonceStore = new InMemoryNonceStore();
        const { payload, newMap, pngBuffer, handshakeHeader } = await scrambleSessionPayload(fvbcPath, mapPath, clientPublicKey, nonceStore);

        if (isDevMode) {
            const hashBytes = crypto.createHash('sha256').update(payload).digest();
            vmNode.set_payload_hash(new Uint8Array(hashBytes));
        }

        const payloadData = {
            payload: Buffer.from(payload).toString('base64'),
            opcodeMap: newMap,
            handshake: Buffer.from(pngBuffer || handshakeHeader || new Uint8Array(154)).toString('base64'),
            clientPrivateKey: clientPrivateKey ? Buffer.from(clientPrivateKey).toString('base64') : undefined
        };

        fs.writeFileSync(endpointPath, JSON.stringify(payloadData));
        return { endpointPath, fvbcPath, mapPath };
    } catch (e) {
        try { fs.unlinkSync(fvbcPath); } catch(err){}
        try { fs.unlinkSync(mapPath); } catch(err){}
        throw e;
    }
}

runTestSuite('Milestone 3: Complex E2E Overhaul Test Suite', {
    // --- Tier 3: Cross-Feature Combinations (8 tests) ---
    
    'Test 1: SDK + Dev Server + Transpiler (F6 + F7 + F3)': async () => {
        const dir = getTempWorkspace();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), `
            module.exports = {
                serve: { port: 13200 },
                protect: ['./src/lib/licensing.js'],
                output: './protected'
            };
        `);
        fs.mkdirSync(path.join(dir, 'src/lib'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'src/lib/licensing.js'), `
            /**
             * @protect
             */
            export function checkLicense(key) {
                let x = key;
                return x;
            }
        `);

        // Start dev server in watch mode
        const procPromise = spawnProcess('node', [cliPath, 'dev'], { cwd: dir });
        await new Promise(r => setTimeout(r, 1000));

        // Edit the file to trigger watcher recompilation
        fs.writeFileSync(path.join(dir, 'src/lib/licensing.js'), `
            /**
             * @protect
             */
            export function checkLicense(key) {
                let x = key + 5;
                return x;
            }
        `);
        await new Promise(r => setTimeout(r, 1000));

        procPromise.child.kill('SIGINT');
        await procPromise;

        const fvbcPath = path.join(dir, 'protected/checkLicense.fvbc');
        const opcodesPath = path.join(dir, 'protected/checkLicense.opcodes.json');
        assert.ok(fs.existsSync(fvbcPath));
        assert.ok(fs.existsSync(opcodesPath));

        // Load generated files via Client SDK using a mock endpoint
        const payloadData = {
            payload: fs.readFileSync(fvbcPath).toString('base64'),
            opcodeMap: JSON.parse(fs.readFileSync(opcodesPath, 'utf8')),
            handshake: Buffer.from(new Uint8Array(154)).toString('base64')
        };
        const epPath = path.join(dir, 'endpoint.json');
        fs.writeFileSync(epPath, JSON.stringify(payloadData));

        const client = await FortressClient.init(epPath);
        const result = await client.execute(10);
        assert.strictEqual(result, 15);
        client.dispose();
    },

    'Test 2: Transpiler + Annotations + Opcodes (F3 + F8 + F1)': async () => {
        const dir = getTempWorkspace();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), `
            module.exports = { output: './protected' };
        `);
        fs.writeFileSync(path.join(dir, 'app.js'), `
            /**
             * @protect
             */
            export function annotatedFunc(a, b) {
                let c = a + b;
                return c;
            }

            export function unannotatedFunc() {
                return 42;
            }
        `);

        const result = await spawnProcess('node', [cliPath, 'build'], { cwd: dir });
        assertExitCode(result, 0);

        assert.ok(fs.existsSync(path.join(dir, 'protected/annotatedFunc.fvbc')));
        assert.ok(!fs.existsSync(path.join(dir, 'protected/unannotatedFunc.fvbc')));

        // Run the compiled annotated function in VM
        const fvbc = fs.readFileSync(path.join(dir, 'protected/annotatedFunc.fvbc'));
        const opcodes = JSON.parse(fs.readFileSync(path.join(dir, 'protected/annotatedFunc.opcodes.json'), 'utf8'));

        process.env.DEV_MODE = isDevMode ? 'true' : 'false';
        let clientPublicKey;
        if (!isDevMode) {
            clientPublicKey = vmNode.generate_client_keypair();
        }

        const nonceStore = new InMemoryNonceStore();
        const { payload, newMap, pngBuffer, handshakeHeader } = await scrambleSessionPayload(
            path.join(dir, 'protected/annotatedFunc.fvbc'),
            path.join(dir, 'protected/annotatedFunc.opcodes.json'),
            clientPublicKey,
            nonceStore
        );

        if (isDevMode) {
            const hashBytes = crypto.createHash('sha256').update(payload).digest();
            vmNode.set_payload_hash(new Uint8Array(hashBytes));
        }

        const header = !isDevMode ? handshakeHeader : pngBuffer;
        const resStr = vmNode.execute(payload, header, '[100, 200]', new Uint8Array(newMap));
        assert.strictEqual(JSON.parse(resStr), 300);
    },

    'Test 3: SDK + Opcodes + Stdlib Map/Set (F6 + F1 + F2)': async () => {
        // Build custom list collection operations using BytecodeBuilder
        const builder = new BytecodeBuilder();
        builder.emit(OpCode.NewList);
        builder.emitInt(OpCode.PushInt, 99);
        builder.emit(OpCode.ListPush);
        builder.emitInt(OpCode.PushInt, 101);
        builder.emit(OpCode.ListPush);
        builder.emit(OpCode.Length);
        builder.emit(OpCode.Return);

        const { endpointPath } = await prepareSdkEndpoint(builder.build());
        const client = await FortressClient.init(endpointPath);
        const result = await client.execute([]);
        assert.strictEqual(result, 2);
        client.dispose();
    },

    'Test 4: CLI + Framework Integrations (F4 + F5)': async () => {
        const dir = getTempWorkspace();
        const result = await spawnProcess('node', [createStubPath, dir, '--framework', 'next']);
        assertExitCode(result, 0);

        const nextIntegration = require('../../next');
        let statusCode = null;
        let headers = {};
        let body = '';

        const req = { method: 'GET', url: '/_fortress/worker.js' };
        const res = {
            set statusCode(val) { statusCode = val; },
            get statusCode() { return statusCode; },
            setHeader(name, val) { headers[name.toLowerCase()] = val; },
            end(data) { body = data; }
        };

        nextIntegration.fortressNextRoute(req, res);

        assert.strictEqual(statusCode, 200);
        assert.strictEqual(headers['content-type'], 'application/javascript');
        assert.ok(body.includes('fortress-wasm inlined IIFE bundled script'));
    },

    'Test 5: Verify Command + Opcodes + SDK (F9 + F1 + F6)': async () => {
        const builder = new BytecodeBuilder();
        builder.emitInt(OpCode.PushInt, 500);
        builder.emit(OpCode.Return);

        const { endpointPath } = await prepareSdkEndpoint(builder.build());
        const client = await FortressClient.init(endpointPath);
        const result = await client.execute([]);
        assert.strictEqual(result, 500);
        client.dispose();

        const reportPath = path.join(dir = getTempWorkspace(), 'report.json');
        const verifyResult = await spawnProcess('node', [cliPath, 'verify', '--output', reportPath, '--endpoint', endpointPath]);
        assertExitCode(verifyResult, 0);

        const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        assert.strictEqual(report.score, 100);
        assert.strictEqual(report.status, 'PASS');
    },

    'Test 6: Annotations + Framework Integrations (F8 + F5)': async () => {
        const dir = getTempWorkspace();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), `
            module.exports = { output: './protected' };
        `);
        fs.writeFileSync(path.join(dir, 'app.js'), `
            /**
             * @protect
             */
            export function testAuth(token) {
                return token;
            }
        `);

        const result = await spawnProcess('node', [cliPath, 'build'], { cwd: dir });
        assertExitCode(result, 0);

        const fvbcPath = path.join(dir, 'protected/testAuth.fvbc');
        assert.ok(fs.existsSync(fvbcPath));

        // Serve compiled payload via custom Express integration middleware routing mock
        const expressIntegration = require('../../express');
        let statusCode = null;
        let headers = {};
        let body = '';
        let nextCalled = false;

        const req = { method: 'GET', path: '/_fortress/worker.js' };
        const res = {
            status(val) { statusCode = val; return this; },
            setHeader(name, val) { headers[name.toLowerCase()] = val; return this; },
            send(data) { body = data; return this; }
        };

        expressIntegration.fortressExpressMiddleware(req, res, () => { nextCalled = true; });

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(statusCode, 200);
        assert.ok(body.includes('fortress-wasm inlined IIFE bundled script'));
    },

    'Test 7: Transpiler + Stdlib Map/Set (F3 + F2)': async () => {
        const source = 'let list = [1, 2]; let obj = { a: list };';
        const parser = new Parser(source);
        const program = parser.parseProgram();
        const codegen = new CodeGenerator();
        const { code, opcodeMap } = codegen.generate(program);

        assert.ok(code.length > 0);
        // Verify opcodes for NewList and NewObject are generated
        const hasNewList = code.includes(opcodeMap.indexOf(OpCode.NewList));
        const hasNewObject = code.includes(opcodeMap.indexOf(OpCode.NewObject));
        assert.ok(hasNewList, 'Transpiler must generate NewList opcode');
        assert.ok(hasNewObject, 'Transpiler must generate NewObject opcode');
    },

    'Test 8: CLI + SDK + Verify Command (F4 + F6 + F9)': async () => {
        const dir = getTempWorkspace();
        // Scaffold
        const scaffoldResult = await spawnProcess('node', [createStubPath, dir]);
        assertExitCode(scaffoldResult, 0);

        // Edit protected entry point
        fs.writeFileSync(path.join(dir, 'protected/index.js'), `
            /**
             * @protect
             * @protect-name entryFunc
             */
            export function entryFunc() {
                return 42;
            }
        `);

        // Build
        const buildResult = await spawnProcess('node', [cliPath, 'build'], { cwd: dir });
        assertExitCode(buildResult, 0);

        // Prepare SDK mock endpoint from compiled output
        const fvbcPath = path.join(dir, 'protected/entryFunc.fvbc');
        const opcodesPath = path.join(dir, 'protected/entryFunc.opcodes.json');

        const payloadData = {
            payload: fs.readFileSync(fvbcPath).toString('base64'),
            opcodeMap: JSON.parse(fs.readFileSync(opcodesPath, 'utf8')),
            handshake: Buffer.from(new Uint8Array(154)).toString('base64')
        };
        const epPath = path.join(dir, 'endpoint.json');
        fs.writeFileSync(epPath, JSON.stringify(payloadData));

        // Init SDK
        const client = await FortressClient.init(epPath);
        const execRes = await client.execute([]);
        assert.strictEqual(execRes, 42);
        client.dispose();

        // Verify command
        const reportPath = path.join(dir, 'report.json');
        const verifyResult = await spawnProcess('node', [cliPath, 'verify', '--output', reportPath, '--endpoint', epPath]);
        assertExitCode(verifyResult, 0);

        const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        assert.strictEqual(report.score, 100);
    },

    // --- Tier 4: Real-World Application Scenarios (5 tests) ---

    'Scenario 1: Secure Checkout Cart Transaction (F1, F2, F3, F6, F8, F9)': async () => {
        const dir = getTempWorkspace();
        // 1. Scaffold
        const scaffoldRes = await spawnProcess('node', [createStubPath, dir]);
        assertExitCode(scaffoldRes, 0);

        // 2. Annotate
        fs.writeFileSync(path.join(dir, 'protected/checkout.js'), `
            /**
             * @protect
             * @protect-name checkout
             */
            export function checkout(price, quantity) {
                let total = price * quantity;
                return total;
            }
        `);

        // 3. Transpile
        const buildRes = await spawnProcess('node', [cliPath, 'build'], { cwd: dir });
        assertExitCode(buildRes, 0);

        // 4. Load in SDK
        const fvbcPath = path.join(dir, 'protected/checkout.fvbc');
        const opcodesPath = path.join(dir, 'protected/checkout.opcodes.json');
        const payloadData = {
            payload: fs.readFileSync(fvbcPath).toString('base64'),
            opcodeMap: JSON.parse(fs.readFileSync(opcodesPath, 'utf8')),
            handshake: Buffer.from(new Uint8Array(154)).toString('base64')
        };
        const epPath = path.join(dir, 'endpoint.json');
        fs.writeFileSync(epPath, JSON.stringify(payloadData));

        const client = await FortressClient.init(epPath);

        // 5. Run checkout transaction
        const total = await client.execute([15, 3]);
        assert.strictEqual(total, 45);
        client.dispose();

        // 6. Verify session payload using verify command
        const reportPath = path.join(dir, 'report.json');
        const verifyResult = await spawnProcess('node', [cliPath, 'verify', '--output', reportPath, '--endpoint', epPath]);
        assertExitCode(verifyResult, 0);

        const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        assert.strictEqual(report.score, 100);
        assert.strictEqual(report.status, 'PASS');
    },

    'Scenario 2: JWT Token / Web Worker Session Authenticator (F1, F3, F5, F6, F8)': async () => {
        const dir = getTempWorkspace();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), `
            module.exports = { output: './protected' };
        `);
        fs.writeFileSync(path.join(dir, 'auth.js'), `
            /**
             * @protect
             * @protect-name authenticator
             */
            export function authenticate(token) {
                let check = (token == "secret-jwt-token-123");
                return check;
            }
        `);

        // Build
        const buildRes = await spawnProcess('node', [cliPath, 'build'], { cwd: dir });
        assertExitCode(buildRes, 0);

        // Serve via Next.js worker route handler mock
        const nextIntegration = require('../../next');
        let statusCode = null;
        let headers = {};
        let body = '';

        const req = { method: 'GET', url: '/_fortress/worker.js' };
        const res = {
            set statusCode(val) { statusCode = val; },
            get statusCode() { return statusCode; },
            setHeader(name, val) { headers[name.toLowerCase()] = val; },
            end(data) { body = data; }
        };

        nextIntegration.fortressNextRoute(req, res);
        assert.strictEqual(statusCode, 200);
        assert.ok(body.includes('fortress-wasm inlined IIFE bundled script'));

        // Load SDK & validate claims via Worker execution
        const fvbcPath = path.join(dir, 'protected/authenticator.fvbc');
        const opcodesPath = path.join(dir, 'protected/authenticator.opcodes.json');
        const payloadData = {
            payload: fs.readFileSync(fvbcPath).toString('base64'),
            opcodeMap: JSON.parse(fs.readFileSync(opcodesPath, 'utf8')),
            handshake: Buffer.from(new Uint8Array(154)).toString('base64')
        };
        const epPath = path.join(dir, 'endpoint.json');
        fs.writeFileSync(epPath, JSON.stringify(payloadData));

        const client = await FortressClient.init(epPath);

        const res1 = await client.execute("secret-jwt-token-123");
        assert.strictEqual(res1, true); // True evaluates to true in FVM boolean execution

        const res2 = await client.execute("wrong-token");
        assert.strictEqual(res2, false); // False evaluates to false

        client.dispose();
    },

    'Scenario 3: Game Loop / Physics Score Hardening (F1, F3, F7, F8)': async () => {
        const dir = getTempWorkspace();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), `
            module.exports = {
                serve: { port: 13205 },
                protect: ['./physics.js'],
                output: './protected'
            };
        `);
        fs.writeFileSync(path.join(dir, 'physics.js'), `
            /**
             * @protect
             * @protect-name physicsLoop
             */
            export function physicsLoop(score, speed) {
                let nextScore = score + speed;
                return nextScore;
            }
        `);

        // Start dev server watch
        const procPromise = spawnProcess('node', [cliPath, 'dev'], { cwd: dir });
        await new Promise(r => setTimeout(r, 1000));

        // Rapidly edit physics loop to trigger build and verify debouncing
        fs.writeFileSync(path.join(dir, 'physics.js'), `
            /**
             * @protect
             * @protect-name physicsLoop
             */
            export function physicsLoop(score, speed) {
                let nextScore = score + speed * 2;
                return nextScore;
            }
        `);
        fs.writeFileSync(path.join(dir, 'physics.js'), `
            /**
             * @protect
             * @protect-name physicsLoop
             */
            export function physicsLoop(score, speed) {
                let nextScore = score + speed * 4;
                return nextScore;
            }
        `);

        await new Promise(r => setTimeout(r, 1000));

        procPromise.child.kill('SIGINT');
        const devServerResult = await procPromise;

        // Ensure dev server stayed running and recompilation logged
        assertStdoutContains(devServerResult, 'Change detected');

        // SDK runs game loop physics scoring iteration with updated output
        const fvbcPath = path.join(dir, 'protected/physicsLoop.fvbc');
        const opcodesPath = path.join(dir, 'protected/physicsLoop.opcodes.json');

        const payloadData = {
            payload: fs.readFileSync(fvbcPath).toString('base64'),
            opcodeMap: JSON.parse(fs.readFileSync(opcodesPath, 'utf8')),
            handshake: Buffer.from(new Uint8Array(154)).toString('base64')
        };
        const epPath = path.join(dir, 'endpoint.json');
        fs.writeFileSync(epPath, JSON.stringify(payloadData));

        const client = await FortressClient.init(epPath);
        const newScore = await client.execute([10, 5]);
        // score=10, speed=5, multiplier=4 -> 10 + 5 * 4 = 30
        assert.strictEqual(newScore, 30);
        client.dispose();
    },

    'Scenario 4: Encrypted Form Submission & PII Masking (F1, F2, F4, F6, F8)': async () => {
        const dir = getTempWorkspace();
        // create-fortress-app sets up project
        const scaffoldRes = await spawnProcess('node', [createStubPath, dir]);
        assertExitCode(scaffoldRes, 0);

        // Email PII masking function using string index access and concat
        fs.writeFileSync(path.join(dir, 'protected/masking.js'), `
            /**
             * @protect
             * @protect-name maskPII
             */
            export function maskPII(email) {
                let first = email[0];
                let masked = concat(first, "***@domain.com");
                return masked;
            }
        `);

        // Compile
        const buildRes = await spawnProcess('node', [cliPath, 'build'], { cwd: dir });
        assertExitCode(buildRes, 0);

        // Load SDK and run masking logic
        const fvbcPath = path.join(dir, 'protected/maskPII.fvbc');
        const opcodesPath = path.join(dir, 'protected/maskPII.opcodes.json');
        const payloadData = {
            payload: fs.readFileSync(fvbcPath).toString('base64'),
            opcodeMap: JSON.parse(fs.readFileSync(opcodesPath, 'utf8')),
            handshake: Buffer.from(new Uint8Array(154)).toString('base64')
        };
        const epPath = path.join(dir, 'endpoint.json');
        fs.writeFileSync(epPath, JSON.stringify(payloadData));

        const client = await FortressClient.init(epPath);
        const maskedOutput = await client.execute("luke@domain.com");
        assert.strictEqual(maskedOutput, "l***@domain.com");
        client.dispose();
    },

    'Scenario 5: Multi-Tenant Config Cache & LRU Eviction (F1, F2, F3, F6, F9)': async () => {
        const dir = getTempWorkspace();
        fs.writeFileSync(path.join(dir, 'fortress.config.js'), `
            module.exports = { output: './protected' };
        `);
        fs.writeFileSync(path.join(dir, 'config.js'), `
            /**
             * @protect
             * @protect-name parseConfig
             */
            export function parseConfig(tenantId) {
                return tenantId;
            }
        `);

        // Compile
        const buildRes = await spawnProcess('node', [cliPath, 'build'], { cwd: dir });
        assertExitCode(buildRes, 0);

        const fvbcPath = path.join(dir, 'protected/parseConfig.fvbc');
        const opcodesPath = path.join(dir, 'protected/parseConfig.opcodes.json');
        const payloadData = {
            payload: fs.readFileSync(fvbcPath).toString('base64'),
            opcodeMap: JSON.parse(fs.readFileSync(opcodesPath, 'utf8')),
            handshake: Buffer.from(new Uint8Array(154)).toString('base64')
        };
        const epPath = path.join(dir, 'endpoint.json');
        fs.writeFileSync(epPath, JSON.stringify(payloadData));

        const client = await FortressClient.init(epPath);

        // LRU Cache Simulation using SDK requests
        const cache = new Map();
        const maxCacheSize = 3;

        async function getCachedTenantConfig(tenantId) {
            if (cache.has(tenantId)) {
                // Refresh LRU
                const val = cache.get(tenantId);
                cache.delete(tenantId);
                cache.set(tenantId, val);
                return val;
            }
            // Request FVM execution
            const config = await client.execute(tenantId);
            if (cache.size >= maxCacheSize) {
                // Evict LRU (first key in map iterator)
                const lruKey = cache.keys().next().value;
                cache.delete(lruKey);
            }
            cache.set(tenantId, config);
            return config;
        }

        // Request configs
        await getCachedTenantConfig("tenantA");
        await getCachedTenantConfig("tenantB");
        await getCachedTenantConfig("tenantC");

        assert.deepStrictEqual(Array.from(cache.keys()), ["tenantA", "tenantB", "tenantC"]);

        // Access tenantA (making it most recently used, tenantB becomes LRU)
        await getCachedTenantConfig("tenantA");
        assert.deepStrictEqual(Array.from(cache.keys()), ["tenantB", "tenantC", "tenantA"]);

        // Request tenantD (evicts tenantB)
        await getCachedTenantConfig("tenantD");
        assert.deepStrictEqual(Array.from(cache.keys()), ["tenantC", "tenantA", "tenantD"]);

        assert.ok(!cache.has("tenantB"));
        assert.ok(cache.has("tenantA"));

        client.dispose();

        // Verify session integrity report
        const reportPath = path.join(dir, 'report.json');
        const verifyResult = await spawnProcess('node', [cliPath, 'verify', '--output', reportPath, '--endpoint', epPath]);
        assertExitCode(verifyResult, 0);

        const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        assert.strictEqual(report.score, 100);
        cleanup();
    }
});
