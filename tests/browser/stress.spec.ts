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

function compileAndScramble(sourceCode: string, devMode: boolean, providedSessionKey?: Uint8Array) {
  const parser = new Parser(sourceCode);
  const ast = parser.parseProgram();
  const codegen = new CodeGenerator();
  const { code, opcodeMap } = codegen.generate(ast);

  const tempDir = os.tmpdir();
  const randId = crypto.randomBytes(8).toString('hex');
  const fvbcPath = path.join(tempDir, `temp_stress_${randId}.fvbc`);
  const mapPath = path.join(tempDir, `temp_stress_${randId}.opcodes.json`);

  fs.writeFileSync(fvbcPath, Buffer.from(code));
  fs.writeFileSync(mapPath, JSON.stringify(Array.from(opcodeMap)));

  try {
    const oldDevMode = process.env.DEV_MODE;
    process.env.DEV_MODE = devMode ? 'true' : 'false';

    const scrambled = scrambleSessionPayload(fvbcPath, mapPath, providedSessionKey);

    if (oldDevMode !== undefined) {
      process.env.DEV_MODE = oldDevMode;
    } else {
      delete process.env.DEV_MODE;
    }

    return {
      payload: Array.from(scrambled.payload),
      newMap: scrambled.newMap,
      pngBuffer: Array.from(scrambled.pngBuffer)
    };
  } finally {
    try {
      fs.unlinkSync(fvbcPath);
      fs.unlinkSync(mapPath);
    } catch (e) {}
  }
}

test.describe('Challenger Empirical Robustness & Concurrency Stress Tests', () => {

  test('Stress Test 1: Concurrency stress testing - 50 concurrent Web Workers running simultaneously', async ({ page }) => {
    await page.goto('http://localhost:8080/index.html');
    await page.waitForFunction(() => window.fortress !== undefined);
    await page.evaluate(() => window.fortress.init());

    const isWasmDevMode = await page.evaluate(() => {
      try {
        window.fortress.clear_crypto();
        window.fortress.set_payload_hash(new Uint8Array(32));
        const res = JSON.parse(window.fortress.execute(new Uint8Array([0]), new Uint8Array(1024), "[]", new Uint8Array(256)));
        return res.error === "Dev mode VirtSC hash mismatch";
      } catch (e) {
        return false;
      }
    });

    const sc = compileAndScramble('return 12345;', isWasmDevMode);

    const result = await page.evaluate(async ({ payload, pngBuffer, newMap, isDev }) => {
      const wasmResponse = await fetch('/pkg-web/vm_core_bg.wasm');
      const vmCoreBytes = await wasmResponse.arrayBuffer();

      const runWorker = (vmCore, stego, pay, map) => {
        return new Promise((resolve, reject) => {
          const worker = new Worker('/dist/fortress-worker.js');
          
          const timeoutId = setTimeout(() => {
            worker.terminate();
            reject(new Error('Worker timeout / deadlock detected'));
          }, 15000);

          worker.onmessage = (e) => {
            const { type, error, result: execResult } = e.data;
            if (type === 'INIT_SUCCESS') {
              worker.postMessage({
                type: 'EXECUTE',
                payload: {
                  bytecode: pay,
                  opcodeMap: map,
                  input: []
                }
              });
            } else if (type === 'INIT_ERROR') {
              clearTimeout(timeoutId);
              worker.terminate();
              reject(new Error('INIT_ERROR: ' + error));
            } else if (type === 'EXECUTE_SUCCESS') {
              clearTimeout(timeoutId);
              worker.terminate();
              resolve(JSON.parse(execResult));
            } else if (type === 'EXECUTE_ERROR') {
              clearTimeout(timeoutId);
              worker.terminate();
              reject(new Error('EXECUTE_ERROR: ' + error));
            }
          };
          worker.onerror = (err) => {
            clearTimeout(timeoutId);
            worker.terminate();
            reject(err);
          };
          worker.postMessage({
            type: 'INIT',
            payload: {
              vmCoreBytes: vmCore,
              stegoImageBytes: stego,
              imageWidth: 16,
              imageHeight: 16,
              sessionSeedHex: '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff',
              fingerprintHex: '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff',
              epochDay: 20000,
              devMode: isDev,
              websocketUrl: null,
              websocketAuth: null,
              nativeData: {
                webgl: 'MockWebGLRenderer ~ Apple GPU',
                canvas: 'mock_canvas_fingerprint_hash_value_12345',
                automation: {},
                screen: { width: 1920, height: 1080 }
              }
            }
          });
        });
      };

      const workerPromises: Promise<any>[] = [];
      const CONCURRENCY_COUNT = 50;
      for (let i = 0; i < CONCURRENCY_COUNT; i++) {
        workerPromises.push(runWorker(vmCoreBytes.slice(0), new Uint8Array(pngBuffer), payload, newMap));
      }

      return Promise.all(workerPromises);
    }, {
      payload: sc.payload,
      pngBuffer: sc.pngBuffer,
      newMap: sc.newMap,
      isDev: isWasmDevMode
    });

    expect(result.length).toBe(50);
    for (const val of result) {
      expect(val).toBe(12345);
    }
  });

  test('Stress Test 2: Steganographic Carrier Robustness under corrupted and truncated session keys/images', async ({ page }) => {
    await page.goto('http://localhost:8080/index.html');
    await page.waitForFunction(() => window.fortress !== undefined);
    await page.evaluate(() => window.fortress.init());

    const isWasmDevMode = await page.evaluate(() => {
      try {
        window.fortress.clear_crypto();
        window.fortress.set_payload_hash(new Uint8Array(32));
        const res = JSON.parse(window.fortress.execute(new Uint8Array([0]), new Uint8Array(1024), "[]", new Uint8Array(256)));
        return res.error === "Dev mode VirtSC hash mismatch";
      } catch (e) {
        return false;
      }
    });

    const sc = compileAndScramble('return 999;', isWasmDevMode);

    const corruptScenarios = [
      { name: 'Empty Stego Image', type: 'image', stegoMod: (buf: number[]) => [] },
      { name: 'Truncated PNG (half size)', type: 'image', stegoMod: (buf: number[]) => buf.slice(0, Math.floor(buf.length / 2)) },
      { name: 'Tiny PNG (10 bytes)', type: 'image', stegoMod: (buf: number[]) => buf.slice(0, 10) },
      { name: 'Corrupt Magic Bytes', type: 'image', stegoMod: (buf: number[]) => { const c = [...buf]; c[0] = 0x00; c[1] = 0x00; return c; } },
      { name: 'Random PNG garbage', type: 'image', stegoMod: (buf: number[]) => Array.from(crypto.randomBytes(buf.length)) },
      { name: 'Corrupt Seed length', type: 'key', seedMod: (s: string) => s.slice(0, 10) },
      { name: 'Invalid seed hex chars', type: 'key', seedMod: (s: string) => s.replace(/1/g, 'z') }
    ];

    for (const scenario of corruptScenarios) {
      const modifiedPng = scenario.stegoMod ? scenario.stegoMod(sc.pngBuffer) : sc.pngBuffer;
      const modifiedSeed = scenario.seedMod ? scenario.seedMod('11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff') : '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff';

      const executionResult = await page.evaluate(async ({ payload, pngBuffer, newMap, isDev, seedHex }) => {
        const wasmResponse = await fetch('/pkg-web/vm_core_bg.wasm');
        const vmCoreBytes = await wasmResponse.arrayBuffer();

        return new Promise<any>((resolve) => {
          const worker = new Worker('/dist/fortress-worker.js');
          let savedResult: any = null;
          
          const timeoutId = setTimeout(() => {
            worker.terminate();
            resolve({ status: false, error: 'Worker timeout' });
          }, 3000);

          worker.onmessage = (e) => {
            const { type, error, result: execResult, signature } = e.data;
            if (type === 'INIT_SUCCESS') {
              worker.postMessage({
                type: 'EXECUTE',
                payload: {
                  bytecode: payload,
                  opcodeMap: newMap,
                  input: []
                }
              });
            } else if (type === 'INIT_ERROR') {
              clearTimeout(timeoutId);
              worker.terminate();
              resolve({ status: false, error: 'INIT_ERROR: ' + error });
            } else if (type === 'EXECUTE_SUCCESS') {
              savedResult = execResult;
              // Now trigger signature generation
              worker.postMessage({
                type: 'SIGN_REQUEST',
                payload: {
                  method: 'GET',
                  url: '/api/v1/resource',
                  bodyStr: '',
                  timestamp: '1600000000'
                }
              });
            } else if (type === 'EXECUTE_ERROR') {
              clearTimeout(timeoutId);
              worker.terminate();
              resolve({ status: false, error: 'EXECUTE_ERROR: ' + error });
            } else if (type === 'SIGN_SUCCESS') {
              clearTimeout(timeoutId);
              worker.terminate();
              resolve({ status: true, result: savedResult, signature });
            } else if (type === 'SIGN_ERROR') {
              clearTimeout(timeoutId);
              worker.terminate();
              resolve({ status: false, error: 'SIGN_ERROR: ' + error });
            }
          };
          worker.onerror = (err) => {
            clearTimeout(timeoutId);
            worker.terminate();
            resolve({ status: false, error: 'Worker onerror triggered: ' + (err.message || String(err)) });
          };

          worker.postMessage({
            type: 'INIT',
            payload: {
              vmCoreBytes,
              stegoImageBytes: new Uint8Array(pngBuffer),
              imageWidth: 16,
              imageHeight: 16,
              sessionSeedHex: seedHex,
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
        payload: sc.payload,
        pngBuffer: modifiedPng,
        newMap: sc.newMap,
        isDev: isWasmDevMode,
        seedHex: modifiedSeed
      });

      console.log(`Scenario [${scenario.name}] Result:`, executionResult);

      if (!isWasmDevMode) {
        if (scenario.type === 'image') {
          // If image is corrupted, payload execution must return failure/error JSON or not match 999
          if (executionResult.status === true) {
            let val;
            try {
              val = JSON.parse(executionResult.result);
            } catch {
              val = executionResult.result;
            }
            expect(val).not.toBe(999);
          }
        } else if (scenario.type === 'key') {
          // If seed/fingerprint is corrupted but image is valid,
          // payload execution still succeeds, but the signature is generated using a different key
          expect(executionResult.status).toBe(true);
          let val;
          try {
            val = JSON.parse(executionResult.result);
          } catch {
            val = executionResult.result;
          }
          expect(val).toBe(999);
          expect(executionResult.signature).toBeDefined();
        }
      }
    }
  });

  test('Stress Test 3: Rust side timing anti-debugging mechanism under mocked performance.now() delta > 50ms', async ({ page }) => {
    await page.goto('http://localhost:8080/index.html');
    await page.waitForFunction(() => window.fortress !== undefined);
    await page.evaluate(() => window.fortress.init());

    const isWasmDevMode = await page.evaluate(() => {
      try {
        window.fortress.clear_crypto();
        window.fortress.set_payload_hash(new Uint8Array(32));
        const res = JSON.parse(window.fortress.execute(new Uint8Array([0]), new Uint8Array(1024), "[]", new Uint8Array(256)));
        return res.error === "Dev mode VirtSC hash mismatch";
      } catch (e) {
        return false;
      }
    });

    const sc = compileAndScramble('return 42;', isWasmDevMode);

    const result = await page.evaluate(async ({ payload, pngBuffer, newMap, isDev }) => {
      const wasmResponse = await fetch('/pkg-web/vm_core_bg.wasm');
      const vmCoreBytes = await wasmResponse.arrayBuffer();

      const workerRes = await fetch('/dist/fortress-worker.js');
      const workerCode = await workerRes.text();

      // Intercept 'EXECUTE' message to only trigger delay during Rust Vm::run
      const mockPrefix = `
        let inExecute = false;
        self.addEventListener('message', (e) => {
          if (e && e.data && e.data.type === 'EXECUTE') {
            inExecute = true;
          }
        });
        let baseTime = 0;
        self.performance = self.performance || {};
        self.performance.now = () => {
          if (!inExecute) {
            return 0;
          }
          baseTime += 60;
          return baseTime;
        };
      `;

      const blob = new Blob([mockPrefix + workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);

      return new Promise((resolve) => {
        const worker = new Worker(workerUrl);
        worker.onmessage = (e) => {
          const { type, error, result: execResult } = e.data;
          if (type === 'INIT_SUCCESS') {
            worker.postMessage({
              type: 'EXECUTE',
              payload: {
                bytecode: payload,
                opcodeMap: newMap,
                input: []
              }
            });
          } else if (type === 'INIT_ERROR') {
            worker.terminate();
            resolve({ status: false, error: 'INIT_ERROR: ' + error });
          } else if (type === 'EXECUTE_SUCCESS') {
            worker.terminate();
            try {
              resolve(JSON.parse(execResult));
            } catch (err) {
              resolve({ status: false, error: 'PARSE_ERROR: ' + execResult });
            }
          } else if (type === 'EXECUTE_ERROR') {
            worker.terminate();
            resolve({ status: false, error: 'EXECUTE_ERROR: ' + error });
          }
        };
        worker.onerror = (err) => {
          worker.terminate();
          resolve({ status: false, error: err.message || 'Worker error' });
        };
        worker.postMessage({
          type: 'INIT',
          payload: {
            vmCoreBytes,
            stegoImageBytes: new Uint8Array(pngBuffer),
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
      payload: sc.payload,
      pngBuffer: sc.pngBuffer,
      newMap: sc.newMap,
      isDev: isWasmDevMode
    });

    console.log("Mocked Rust Performance.now() delay result:", result);

    expect(result).toBeDefined();
    if (typeof result === 'object' && result !== null) {
      expect((result as any).status).toBe(false);
      expect((result as any).error).toBe('timeout');
    } else {
      expect(result).toEqual({ status: false, error: 'timeout' });
    }
  });

});
