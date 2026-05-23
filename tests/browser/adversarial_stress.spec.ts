import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
// @ts-ignore
import { Parser } from '../../compiler/dist/parser.js';
// @ts-ignore
import { CodeGenerator } from '../../compiler/dist/codegen.js';
// @ts-ignore
import { scrambleSessionPayload } from '../../server/scrambler.js';

function compileAndScramble(sourceCode: string, devMode: boolean, clientPublicKey?: Uint8Array) {
  const parser = new Parser(sourceCode);
  const ast = parser.parseProgram();
  const codegen = new CodeGenerator();
  const { code, opcodeMap } = codegen.generate(ast);

  const tempDir = os.tmpdir();
  const randId = crypto.randomBytes(8).toString('hex');
  const fvbcPath = path.join(tempDir, `temp_${randId}.fvbc`);
  const mapPath = path.join(tempDir, `temp_${randId}.opcodes.json`);

  fs.writeFileSync(fvbcPath, Buffer.from(code));
  fs.writeFileSync(mapPath, JSON.stringify(Array.from(opcodeMap)));

  try {
    const oldDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = devMode ? 'true' : 'false';

    const scrambled = scrambleSessionPayload(fvbcPath, mapPath, clientPublicKey);

    if (oldDevMode !== undefined) {
      process.env.DEV_MODE = oldDevMode;
    } else {
      delete process.env.DEV_MODE;
    }

    return {
      payload: Array.from(scrambled.payload),
      newMap: scrambled.newMap,
      handshakeHeader: Array.from(scrambled.handshakeHeader),
      pngBuffer: Array.from(scrambled.pngBuffer)
    };
  } finally {
    try {
      fs.unlinkSync(fvbcPath);
      fs.unlinkSync(mapPath);
    } catch (e) {}
  }
}

test.describe('Adversarial and Stress Tests', () => {

  test('Check 1: Web Worker high concurrency and message loop stress test', async ({ page }) => {
    await page.goto('http://localhost:8080/index.html');
    await page.waitForFunction(() => window.fortress !== undefined);
    await page.evaluate(() => window.fortress.init());

    const isWasmDevMode = await page.evaluate(() => {
      try {
        window.fortress.clear_crypto();
        window.fortress.set_payload_hash(new Uint8Array(32));
        const res = JSON.parse(window.fortress.execute(new Uint8Array([0]), new Uint8Array(0), "[]", new Uint8Array(256)));
        return res.error === "Dev mode VirtSC hash mismatch";
      } catch (e) {
        return false;
      }
    });

    await page.exposeFunction('compileAndScramble', (sourceCode: string, devMode: boolean, clientPublicKey?: number[]) => {
      const pubKeyUint8 = clientPublicKey ? new Uint8Array(clientPublicKey) : undefined;
      return compileAndScramble(sourceCode, devMode, pubKeyUint8);
    });

    const result = await page.evaluate(async ({ isDev }) => {
      const wasmResponse = await fetch('/pkg-web/vm_core_bg.wasm');
      const vmCoreBytes = await wasmResponse.arrayBuffer();

      const runWorkerStress = (id: number) => {
        return new Promise<{ id: number; success: boolean; error?: string }>(async (resolve) => {
          const worker = new Worker('/dist/fortress-worker.js');
          let initialized = false;

          worker.onmessage = async (e) => {
            const { type, error, result: execResult, signature, publicKey } = e.data;
            if (type === 'INIT_SUCCESS') {
              initialized = true;
              if (!isDev) {
                worker.postMessage({ type: 'GENERATE_KEYPAIR' });
              } else {
                const sc = await (window as any).compileAndScramble('return 42;', isDev);
                worker.postMessage({
                  type: 'EXECUTE',
                  payload: {
                    bytecode: sc.payload,
                    opcodeMap: sc.newMap,
                    input: []
                  }
                });
              }
            } else if (type === 'KEYPAIR_SUCCESS') {
              const sc = await (window as any).compileAndScramble('return 42;', isDev, publicKey);
              worker.postMessage({
                type: 'EXECUTE',
                payload: {
                  bytecode: sc.payload,
                  opcodeMap: sc.newMap,
                  handshakeHeader: sc.handshakeHeader,
                  input: []
                }
              });
            } else if (type === 'INIT_ERROR') {
              worker.terminate();
              resolve({ id, success: false, error: 'INIT_ERROR: ' + error });
            } else if (type === 'EXECUTE_SUCCESS') {
              if (JSON.parse(execResult) !== 42) {
                worker.terminate();
                resolve({ id, success: false, error: `Invalid execute result: ${execResult}` });
                return;
              }
              worker.postMessage({
                type: 'SIGN_REQUEST',
                payload: {
                  method: 'POST',
                  url: '/api/test',
                  bodyStr: '{"hello":"world"}',
                  timestamp: '1700000000'
                }
              });
            } else if (type === 'EXECUTE_ERROR') {
              worker.terminate();
              resolve({ id, success: false, error: 'EXECUTE_ERROR: ' + error });
            } else if (type === 'SIGN_SUCCESS') {
              if (!signature || signature.length !== 64) {
                worker.terminate();
                resolve({ id, success: false, error: `Invalid signature: ${signature}` });
              } else {
                worker.terminate();
                resolve({ id, success: true });
              }
            } else if (type === 'SIGN_ERROR') {
              worker.terminate();
              resolve({ id, success: false, error: 'SIGN_ERROR: ' + error });
            }
          };

          worker.onerror = (err) => {
            worker.terminate();
            resolve({ id, success: false, error: err.message || 'Worker onerror triggered' });
          };

          worker.postMessage({
            type: 'INIT',
            payload: {
              vmCoreBytes: vmCoreBytes.slice(0),
              stegoImageBytes: new Uint8Array(0),
              imageWidth: 16,
              imageHeight: 16,
              sessionSeedHex: '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff',
              fingerprintHex: '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff',
              epochDay: 20000,
              devMode: isDev,
              websocketUrl: null,
              websocketAuth: null,
              nativeData: {}
            }
          });
        });
      };

      const workerPromises = Array.from({ length: 25 }, (_, i) => runWorkerStress(i));
      return Promise.all(workerPromises);
    }, {
      isDev: isWasmDevMode
    });

    const failedWorkers = result.filter(r => !r.success);
    expect(failedWorkers.length).toBe(0);
  });

  test('Check 2: Steganographic carrier robustness - corrupted keys and truncated/corrupted images', async ({ page }) => {
    await page.goto('http://localhost:8080/index.html');
    await page.waitForFunction(() => window.fortress !== undefined);
    await page.evaluate(() => window.fortress.init());

    const isWasmDevMode = await page.evaluate(() => {
      try {
        window.fortress.clear_crypto();
        window.fortress.set_payload_hash(new Uint8Array(32));
        const res = JSON.parse(window.fortress.execute(new Uint8Array([0]), new Uint8Array(0), "[]", new Uint8Array(256)));
        return res.error === "Dev mode VirtSC hash mismatch";
      } catch (e) {
        return false;
      }
    });

    await page.exposeFunction('compileAndScramble', (sourceCode: string, devMode: boolean, clientPublicKey?: number[]) => {
      const pubKeyUint8 = clientPublicKey ? new Uint8Array(clientPublicKey) : undefined;
      return compileAndScramble(sourceCode, devMode, pubKeyUint8);
    });

    const testRobustness = async (scenarioType: 'empty' | 'truncated' | 'malformed') => {
      return await page.evaluate(async ({ isDev, scenarioTypeVal }) => {
        const wasmResponse = await fetch('/pkg-web/vm_core_bg.wasm');
        const vmCoreBytes = await wasmResponse.arrayBuffer();

        return new Promise<{ initSuccess: boolean; executeSuccess: boolean; result: any; error?: string }>((resolve) => {
          const worker = new Worker('/dist/fortress-worker.js');
          let initSucceeded = false;

          worker.onmessage = async (e) => {
            const { type, error, result: execResult, publicKey } = e.data;
            if (type === 'INIT_SUCCESS') {
              initSucceeded = true;
              if (!isDev) {
                worker.postMessage({ type: 'GENERATE_KEYPAIR' });
              } else {
                const sc = await (window as any).compileAndScramble('return 42;', isDev);
                let carrier = sc.pngBuffer;
                if (scenarioTypeVal === 'empty') carrier = [];
                else if (scenarioTypeVal === 'truncated') carrier = carrier.slice(0, 10);
                else if (scenarioTypeVal === 'malformed') carrier = Array.from({length: 100}, () => Math.floor(Math.random() * 256));
                
                worker.postMessage({
                  type: 'EXECUTE',
                  payload: {
                    bytecode: sc.payload,
                    opcodeMap: sc.newMap,
                    handshakeHeader: carrier,
                    input: []
                  }
                });
              }
            } else if (type === 'KEYPAIR_SUCCESS') {
              const sc = await (window as any).compileAndScramble('return 42;', isDev, publicKey);
              let carrier = sc.handshakeHeader;
              if (scenarioTypeVal === 'empty') carrier = [];
              else if (scenarioTypeVal === 'truncated') carrier = carrier.slice(0, 10);
              else if (scenarioTypeVal === 'malformed') carrier = Array.from({length: 100}, () => Math.floor(Math.random() * 256));

              worker.postMessage({
                type: 'EXECUTE',
                payload: {
                  bytecode: sc.payload,
                  opcodeMap: sc.newMap,
                  handshakeHeader: carrier,
                  input: []
                }
              });
            } else if (type === 'INIT_ERROR') {
              worker.terminate();
              resolve({ initSuccess: false, executeSuccess: false, result: null, error: error });
            } else if (type === 'EXECUTE_SUCCESS') {
              worker.terminate();
              try {
                const parsed = JSON.parse(execResult);
                resolve({ initSuccess: initSucceeded, executeSuccess: true, result: parsed });
              } catch (e) {
                resolve({ initSuccess: initSucceeded, executeSuccess: true, result: execResult });
              }
            } else if (type === 'EXECUTE_ERROR') {
              worker.terminate();
              resolve({ initSuccess: initSucceeded, executeSuccess: false, result: null, error: error });
            }
          };

          worker.onerror = (err) => {
            worker.terminate();
            resolve({ initSuccess: false, executeSuccess: false, result: null, error: err.message });
          };

          worker.postMessage({
            type: 'INIT',
            payload: {
              vmCoreBytes,
              stegoImageBytes: new Uint8Array(0),
              imageWidth: 16,
              imageHeight: 16,
              sessionSeedHex: '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff',
              fingerprintHex: '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff',
              epochDay: 20000,
              devMode: isDev,
              websocketUrl: null,
              websocketAuth: null,
              nativeData: {}
            }
          });
        });
      }, {
        isDev: isWasmDevMode,
        scenarioTypeVal: scenarioType
      });
    };

    // Scenario A: Empty stegoImageBytes
    const resEmpty = await testRobustness('empty');
    expect(resEmpty.initSuccess).toBe(true); // Should successfully initialize
    if (isWasmDevMode) {
      expect(resEmpty.result).toBe(42);
    } else {
      expect(resEmpty.result).toBeDefined();
      expect(resEmpty.result.status).toBe(false);
    }

    // Scenario B: Truncated PNG
    const resTruncated = await testRobustness('truncated');
    expect(resTruncated.initSuccess).toBe(true);
    if (isWasmDevMode) {
      expect(resTruncated.result).toBe(42);
    } else {
      expect(resTruncated.result).toBeDefined();
      expect(resTruncated.result.status).toBe(false);
    }

    // Scenario C: Malformed/random bytes
    const resMalformed = await testRobustness('malformed');
    expect(resMalformed.initSuccess).toBe(true);
    if (isWasmDevMode) {
      expect(resMalformed.result).toBe(42);
    } else {
      expect(resMalformed.result).toBeDefined();
      expect(resMalformed.result.status).toBe(false);
    }
  });

  test('Check 3: Timing anti-debugging verification under mocked performance.now() delta > 50ms', async ({ page }) => {
    await page.goto('http://localhost:8080/index.html');
    await page.waitForFunction(() => window.fortress !== undefined);
    await page.evaluate(() => window.fortress.init());

    const isWasmDevMode = await page.evaluate(() => {
      try {
        window.fortress.clear_crypto();
        window.fortress.set_payload_hash(new Uint8Array(32));
        const res = JSON.parse(window.fortress.execute(new Uint8Array([0]), new Uint8Array(0), "[]", new Uint8Array(256)));
        return res.error === "Dev mode VirtSC hash mismatch";
      } catch (e) {
        return false;
      }
    });

    await page.exposeFunction('compileAndScramble', (sourceCode: string, devMode: boolean, clientPublicKey?: number[]) => {
      const pubKeyUint8 = clientPublicKey ? new Uint8Array(clientPublicKey) : undefined;
      return compileAndScramble(sourceCode, devMode, pubKeyUint8);
    });

    const testMockedTiming = async (devModeVal: boolean, stepMs: number) => {
      return await page.evaluate(async ({ passedDevModeVal, stepMsVal, isDev }) => {
        const wasmResponse = await fetch('/pkg-web/vm_core_bg.wasm');
        const vmCoreBytes = await wasmResponse.arrayBuffer();

        const workerRes = await fetch('/dist/fortress-worker.js');
        const workerCode = await workerRes.text();

        // Mock performance.now to increment by stepMs on every single call
        const mockPrefix = `
          let time = 0;
          self.performance = self.performance || {};
          self.performance.now = () => {
            const current = time;
            time += ${stepMsVal};
            return current;
          };
        `;

        const blob = new Blob([mockPrefix + workerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);

        return new Promise<{ success: boolean; result: any; error?: string }>((resolve) => {
          const worker = new Worker(workerUrl);
          worker.onmessage = async (e) => {
            const { type, error, result: execResult, publicKey } = e.data;
            if (type === 'INIT_SUCCESS') {
              if (!isDev) {
                worker.postMessage({ type: 'GENERATE_KEYPAIR' });
              } else {
                const sc = await (window as any).compileAndScramble('return 42;', true);
                worker.postMessage({
                  type: 'EXECUTE',
                  payload: {
                    bytecode: sc.payload,
                    opcodeMap: sc.newMap,
                    input: []
                  }
                });
              }
            } else if (type === 'KEYPAIR_SUCCESS') {
              const sc = await (window as any).compileAndScramble('return 42;', false, publicKey);
              worker.postMessage({
                type: 'EXECUTE',
                payload: {
                  bytecode: sc.payload,
                  opcodeMap: sc.newMap,
                  handshakeHeader: sc.handshakeHeader,
                  input: []
                }
              });
            } else if (type === 'INIT_ERROR') {
              worker.terminate();
              resolve({ success: false, result: null, error: error });
            } else if (type === 'EXECUTE_SUCCESS') {
              worker.terminate();
              try {
                resolve({ success: true, result: JSON.parse(execResult) });
              } catch (e) {
                resolve({ success: true, result: execResult });
              }
            } else if (type === 'EXECUTE_ERROR') {
              worker.terminate();
              resolve({ success: false, result: null, error: error });
            }
          };

          worker.onerror = (err) => {
            worker.terminate();
            resolve({ success: false, result: null, error: err.message });
          };

          worker.postMessage({
            type: 'INIT',
            payload: {
              vmCoreBytes: vmCoreBytes.slice(0),
              stegoImageBytes: new Uint8Array(0),
              imageWidth: 16,
              imageHeight: 16,
              sessionSeedHex: '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff',
              fingerprintHex: '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff',
              epochDay: 20000,
              devMode: passedDevModeVal,
              websocketUrl: null,
              websocketAuth: null,
              nativeData: {}
            }
          });
        });
      }, {
        passedDevModeVal: devModeVal,
        stepMsVal: stepMs,
        isDev: isWasmDevMode
      });
    };

    // Scenario A: devMode: false, stepMs: 60ms (delta > 50ms)
    // The timing anti-debugging mechanism in worker.ts should trigger corruption, resulting in execution failure or init failure.
    const resProdSlow = await testMockedTiming(false, 60);
    expect(resProdSlow.success).toBe(false);

    // Scenario B: devMode: true, stepMs: 60ms (delta > 50ms but bypassed in devMode)
    // In dev mode, worker.ts bypasses corruption.
    // However, during Vm::run execution inside WASM, does it trigger the Rust anti-debugging check?
    // Let's see: in Vm::run, there are two calls to performance.now():
    // One at start, one at end. Since stepMs is 60ms, elapsed will be 60ms > 50.0ms.
    // So the Rust Vm::run check WILL trigger and return a timeout!
    // Let's verify this behavior.
    const resDevSlow = await testMockedTiming(true, 60);
    expect(resDevSlow.success).toBe(true);
    // Wait, let's see if the returned result has status: false, error: timeout
    expect(resDevSlow.result).toEqual({ status: false, error: 'timeout' });
  });

});
