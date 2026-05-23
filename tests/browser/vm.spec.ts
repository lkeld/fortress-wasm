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
  const fvbcPath = path.join(tempDir, `temp_${randId}.fvbc`);
  const mapPath = path.join(tempDir, `temp_${randId}.opcodes.json`);

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

test('Test 1: Basic payload execution and evaluation in Chrome', async ({ page }) => {
  await page.goto('http://localhost:8080/index.html');
  await page.waitForFunction(() => window.fortress !== undefined);
  await page.evaluate(() => window.fortress.init('/pkg-web/vm_core_bg.wasm?cb=' + Date.now()));

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

  const hashArray = Array.from(
    crypto.createHash('sha256').update(Buffer.from(sc.payload)).digest()
  );

  const result = await page.evaluate(({ payload, pngBuffer, newMap, isDev, hashArr }) => {
    window.fortress.clear_crypto();
    if (isDev) {
      window.fortress.set_payload_hash(new Uint8Array(hashArr));
    }
    return window.fortress.execute(
      new Uint8Array(payload),
      new Uint8Array(pngBuffer),
      '[]',
      new Uint8Array(newMap)
    );
  }, {
    payload: sc.payload,
    pngBuffer: sc.pngBuffer,
    newMap: sc.newMap,
    isDev: isWasmDevMode,
    hashArr: hashArray
  });

  expect(JSON.parse(result)).toBe(42);
});

test('Test 2: Web Worker concurrent message lifecycle', async ({ page }) => {
  await page.goto('http://localhost:8080/index.html');
  await page.waitForFunction(() => window.fortress !== undefined);
  await page.evaluate(() => window.fortress.init('/pkg-web/vm_core_bg.wasm?cb=' + Date.now()));

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

  const sc = compileAndScramble('return 100;', isWasmDevMode);

  const result = await page.evaluate(async ({ payload, pngBuffer, newMap, isDev }) => {
    const wasmResponse = await fetch('/pkg-web/vm_core_bg.wasm');
    const vmCoreBytes = await wasmResponse.arrayBuffer();

    const runWorker = (vmCore, stego, pay, map) => {
      return new Promise((resolve, reject) => {
        const worker = new Worker('/dist/fortress-worker.js');
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
            worker.terminate();
            reject(new Error('INIT_ERROR: ' + error));
          } else if (type === 'EXECUTE_SUCCESS') {
            worker.terminate();
            resolve(JSON.parse(execResult));
          } else if (type === 'EXECUTE_ERROR') {
            worker.terminate();
            reject(new Error('EXECUTE_ERROR: ' + error));
          }
        };
        worker.onerror = (err) => {
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

    return Promise.all([
      runWorker(vmCoreBytes.slice(0), new Uint8Array(pngBuffer), payload, newMap),
      runWorker(vmCoreBytes.slice(0), new Uint8Array(pngBuffer), payload, newMap),
      runWorker(vmCoreBytes.slice(0), new Uint8Array(pngBuffer), payload, newMap)
    ]);
  }, {
    payload: sc.payload,
    pngBuffer: sc.pngBuffer,
    newMap: sc.newMap,
    isDev: isWasmDevMode
  });

  expect(result).toEqual([100, 100, 100]);
});

test('Test 3: Timing API availability and validation - triggers anti-debugging in production mode', async ({ page }) => {
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  await page.goto('http://localhost:8080/index.html');
  await page.waitForFunction(() => window.fortress !== undefined);
  await page.evaluate(() => window.fortress.init('/pkg-web/vm_core_bg.wasm?cb=' + Date.now()));

  const isWasmDevMode = await page.evaluate(() => {
    try {
      window.fortress.clear_crypto();
      window.fortress.set_payload_hash(new Uint8Array(32));
      const raw = window.fortress.execute(new Uint8Array([0]), new Uint8Array(1024), "[]", new Uint8Array(256));
      console.log("isWasmDevMode raw output:", raw);
      const res = JSON.parse(raw);
      return res.error === "Dev mode VirtSC hash mismatch";
    } catch (e) {
      console.error("isWasmDevMode catch error:", e);
      return false;
    }
  });

  const sc = compileAndScramble('return 42;', isWasmDevMode);
  console.log("isWasmDevMode is:", isWasmDevMode);
  console.log("sc.payload length is:", sc.payload.length);
  console.log("sc.payload first 10 bytes:", sc.payload.slice(0, 10));
  console.log("newMap[51] (maps encoded 51 to standard) is:", sc.newMap[51]);
  console.log("newMap[10] (maps encoded 10 to standard) is:", sc.newMap[10]);

  const result = await page.evaluate(async ({ payload, pngBuffer, newMap, isDev }) => {
    const wasmResponse = await fetch('/pkg-web/vm_core_bg.wasm');
    const vmCoreBytes = await wasmResponse.arrayBuffer();

    const workerRes = await fetch('/dist/fortress-worker.js');
    const workerCode = await workerRes.text();

    const mockPrefix = `
      let calls = 0;
      self.performance = self.performance || {};
      self.performance.now = () => {
        calls++;
        if (calls <= 2) {
          return 0;
        }
        return 100;
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
          resolve({ status: false, error });
        } else if (type === 'EXECUTE_SUCCESS') {
          worker.terminate();
          try {
            const parsed = JSON.parse(execResult);
            resolve(parsed);
          } catch (e) {
            resolve({ status: false, error: 'Failed to parse execute result: ' + execResult });
          }
        } else if (type === 'EXECUTE_ERROR') {
          worker.terminate();
          resolve({ status: false, error });
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

  console.log("TEST 3 RESULT IS:", JSON.stringify(result));
  if (isWasmDevMode) {
    expect(result).toBe(42);
  } else {
    expect(result.status).toBe(false);
    expect(result.error).toBeDefined();
  }
});

test('Test 4: Timing API availability and validation - bypassed in dev mode', async ({ page }) => {
  await page.goto('http://localhost:8080/index.html');
  await page.waitForFunction(() => window.fortress !== undefined);
  await page.evaluate(() => window.fortress.init('/pkg-web/vm_core_bg.wasm?cb=' + Date.now()));

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

  const result = await page.evaluate(async ({ payload, pngBuffer, newMap }) => {
    const wasmResponse = await fetch('/pkg-web/vm_core_bg.wasm');
    const vmCoreBytes = await wasmResponse.arrayBuffer();

    const workerRes = await fetch('/dist/fortress-worker.js');
    const workerCode = await workerRes.text();

    const mockPrefix = `
      self.performance = self.performance || {};
      self.performance.now = () => 0;
    `;

    const blob = new Blob([mockPrefix + workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
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
          reject(new Error('INIT_ERROR: ' + error));
        } else if (type === 'EXECUTE_SUCCESS') {
          worker.terminate();
          resolve(JSON.parse(execResult));
        } else if (type === 'EXECUTE_ERROR') {
          worker.terminate();
          reject(new Error('EXECUTE_ERROR: ' + error));
        }
      };
      worker.onerror = (err) => {
        worker.terminate();
        reject(err);
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
          devMode: true,
          websocketUrl: null,
          websocketAuth: null,
          nativeData: {}
        }
      });
    });
  }, {
    payload: sc.payload,
    pngBuffer: sc.pngBuffer,
    newMap: sc.newMap
  });

  expect(result).toBe(42);
});

test('Test 5: dev-mode payload execution safety under prod-mode configuration', async ({ page }) => {
  await page.goto('http://localhost:8080/index.html');
  await page.waitForFunction(() => window.fortress !== undefined);
  await page.evaluate(() => window.fortress.init('/pkg-web/vm_core_bg.wasm?cb=' + Date.now()));

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

  const result = await page.evaluate(async ({ payload, newMap }) => {
    const wasmResponse = await fetch('/pkg-web/vm_core_bg.wasm');
    const vmCoreBytes = await wasmResponse.arrayBuffer();

    return new Promise((resolve) => {
      const worker = new Worker('/dist/fortress-worker.js');
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
          resolve({ status: false, error });
        } else if (type === 'EXECUTE_SUCCESS') {
          worker.terminate();
          try {
            const parsed = JSON.parse(execResult);
            resolve(parsed);
          } catch (e) {
            resolve({ status: false, error: 'Failed to parse execute result: ' + execResult });
          }
        } else if (type === 'EXECUTE_ERROR') {
          worker.terminate();
          resolve({ status: false, error });
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
          devMode: false,
          websocketUrl: null,
          websocketAuth: null,
          nativeData: {}
        }
      });
    });
  }, {
    payload: sc.payload,
    newMap: sc.newMap
  });

  if (isWasmDevMode) {
    expect(result).toBe(42);
  } else {
    expect(result.status).toBe(false);
    expect(result.error).toBeDefined();
  }
});
