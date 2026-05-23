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
  const fvbcPath = path.join(tempDir, `temp_stress_${randId}.fvbc`);
  const mapPath = path.join(tempDir, `temp_stress_${randId}.opcodes.json`);

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

test.describe('Challenger Empirical Robustness & Concurrency Stress Tests', () => {

  test('Stress Test 1: Concurrency stress testing - 50 concurrent Web Workers running simultaneously', async ({ page }) => {
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

      const runWorker = (vmCore) => {
        return new Promise((resolve, reject) => {
          const worker = new Worker('/dist/fortress-worker.js');
          
          const timeoutId = setTimeout(() => {
            worker.terminate();
            reject(new Error('Worker timeout / deadlock detected'));
          }, 15000);

          worker.onmessage = async (e) => {
            const { type, error, result: execResult, publicKey } = e.data;
            if (type === 'INIT_SUCCESS') {
              if (!isDev) {
                worker.postMessage({ type: 'GENERATE_KEYPAIR' });
              } else {
                const sc = await (window as any).compileAndScramble('return 12345;', isDev);
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
              const sc = await (window as any).compileAndScramble('return 12345;', isDev, publicKey);
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
              stegoImageBytes: new Uint8Array(0),
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
        workerPromises.push(runWorker(vmCoreBytes.slice(0)));
      }

      return Promise.all(workerPromises);
    }, {
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

    const testRobustness = async (scenarioType: 'empty' | 'truncated' | 'tiny' | 'magic' | 'garbage' | 'seed_len' | 'seed_chars') => {
      return await page.evaluate(async ({ isDev, scenarioTypeVal }) => {
        const wasmResponse = await fetch('/pkg-web/vm_core_bg.wasm');
        const vmCoreBytes = await wasmResponse.arrayBuffer();

        return new Promise<any>((resolve) => {
          const worker = new Worker('/dist/fortress-worker.js');
          let initSucceeded = false;
          let savedResult: any = null;
          
          const timeoutId = setTimeout(() => {
            worker.terminate();
            resolve({ status: false, error: 'Worker timeout' });
          }, 3000);

          worker.onmessage = async (e) => {
            const { type, error, result: execResult, signature, publicKey } = e.data;
            if (type === 'INIT_SUCCESS') {
              initSucceeded = true;
              if (!isDev) {
                worker.postMessage({ type: 'GENERATE_KEYPAIR' });
              } else {
                const sc = await (window as any).compileAndScramble('return 999;', isDev);
                let carrier = sc.pngBuffer;
                if (scenarioTypeVal === 'empty') carrier = [];
                else if (scenarioTypeVal === 'truncated') carrier = carrier.slice(0, Math.floor(carrier.length / 2));
                else if (scenarioTypeVal === 'tiny') carrier = carrier.slice(0, 10);
                else if (scenarioTypeVal === 'magic') { carrier = [...carrier]; carrier[0] = 0; carrier[1] = 0; }
                else if (scenarioTypeVal === 'garbage') { carrier = Array.from({length: carrier.length}, () => Math.floor(Math.random() * 256)); }
                
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
              const sc = await (window as any).compileAndScramble('return 999;', isDev, publicKey);
              let carrier = sc.handshakeHeader;
              if (scenarioTypeVal === 'empty') carrier = [];
              else if (scenarioTypeVal === 'truncated') carrier = carrier.slice(0, Math.floor(carrier.length / 2));
              else if (scenarioTypeVal === 'tiny') carrier = carrier.slice(0, 10);
              else if (scenarioTypeVal === 'magic') { carrier = [...carrier]; carrier[0] = 0; carrier[1] = 0; }
              else if (scenarioTypeVal === 'garbage') { carrier = Array.from({length: carrier.length}, () => Math.floor(Math.random() * 256)); }

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
              clearTimeout(timeoutId);
              worker.terminate();
              resolve({ status: false, error: 'INIT_ERROR: ' + error });
            } else if (type === 'EXECUTE_SUCCESS') {
              savedResult = execResult;
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

          let seedHex = '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff';
          if (scenarioTypeVal === 'seed_len') seedHex = seedHex.slice(0, 10);
          else if (scenarioTypeVal === 'seed_chars') seedHex = seedHex.replace(/1/g, 'z');

          worker.postMessage({
            type: 'INIT',
            payload: {
              vmCoreBytes,
              stegoImageBytes: new Uint8Array(0),
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
        isDev: isWasmDevMode,
        scenarioTypeVal: scenarioType
      });
    };

    const scenarios = [
      { name: 'Empty Stego Image', type: 'image', param: 'empty' as const },
      { name: 'Truncated PNG (half size)', type: 'image', param: 'truncated' as const },
      { name: 'Tiny PNG (10 bytes)', type: 'image', param: 'tiny' as const },
      { name: 'Corrupt Magic Bytes', type: 'image', param: 'magic' as const },
      { name: 'Random PNG garbage', type: 'image', param: 'garbage' as const },
      { name: 'Corrupt Seed length', type: 'key', param: 'seed_len' as const },
      { name: 'Invalid seed hex chars', type: 'key', param: 'seed_chars' as const }
    ];

    for (const scenario of scenarios) {
      const executionResult = await testRobustness(scenario.param);
      console.log(`Scenario [${scenario.name}] Result:`, executionResult);

      if (!isWasmDevMode) {
        if (scenario.type === 'image') {
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
        worker.onmessage = async (e) => {
          const { type, error, result: execResult, publicKey } = e.data;
          if (type === 'INIT_SUCCESS') {
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
