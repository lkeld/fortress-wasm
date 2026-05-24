import initCore, { execute, init_crypto, init_crypto_with_key, sign_request, generate_client_keypair, set_client_private_key } from '../../pkg-web/vm_core.js';
import { nativeCallRouter } from './router.js';

declare var process: any;
declare var require: any;
declare var __dirname: any;

const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

if (isNode) {
    const Module = require('module');
    const originalRequire = Module.prototype.require;
    Module.prototype.require = function(id: string) {
        if (id === 'env') {
            return {
                native_call: function() { return "{}"; }
            };
        }
        return originalRequire.apply(this, arguments as any);
    };

    let vmNode: any = null;
    try {
        if (typeof __dirname !== 'undefined') {
            const path = require('path');
            const fs = require('fs');
            const possiblePaths = [
                path.join(__dirname, '../../pkg-node/vm_core.js'),
                path.join(__dirname, '../pkg-node/vm_core.js'),
                path.join(__dirname, './pkg-node/vm_core.js'),
                path.join(process.cwd(), 'pkg-node/vm_core.js')
            ];
            for (const p of possiblePaths) {
                if (fs.existsSync(p)) {
                    vmNode = require(p);
                    break;
                }
            }
        }
    } catch (e) {}

    if (!vmNode) {
        try {
            vmNode = require('./pkg-node/vm_core.js');
        } catch (e) {
            try {
                vmNode = require('../../pkg-node/vm_core.js');
            } catch (err) {
                try {
                    vmNode = require('../pkg-node/vm_core.js');
                } catch (err2) {
                    const path = require('path');
                    vmNode = require(path.join(process.cwd(), 'pkg-node/vm_core.js'));
                }
            }
        }
    }

    const { parentPort } = require('worker_threads');

    let isReadyNode = false;
    let storedBytecode: Uint8Array | null = null;
    let storedHandshakeHeader: Uint8Array | null = null;
    let storedOpcodeMap: Uint8Array | null = null;

    parentPort.on('message', async (data: any) => {
        const { id, type, payload } = data;
        if (type === 'INIT') {
            storedBytecode = payload.bytecode;
            storedHandshakeHeader = payload.handshakeHeader;
            storedOpcodeMap = payload.opcodeMap;

            const handshakeArr = storedHandshakeHeader ? new Uint8Array(storedHandshakeHeader) : null;
            if (handshakeArr && handshakeArr.length === 154 && handshakeArr.every(b => b === 0)) {
                vmNode.init_crypto_with_key(new Uint8Array(32), new Uint8Array(32), new Uint8Array(32), 0);
            } else if (payload.clientPrivateKey) {
                vmNode.set_client_private_key(new Uint8Array(payload.clientPrivateKey));
            }

            isReadyNode = true;
            parentPort.postMessage({ id, type: 'INIT_SUCCESS' });
        } else if (type === 'EXECUTE') {
            if (!isReadyNode) {
                parentPort.postMessage({ id, type: 'ERROR', error: 'VM not initialized' });
                return;
            }
            try {
                const { input } = payload;
                if (process.env.DEV_MODE === 'true' && storedBytecode) {
                    const crypto = require('crypto');
                    const hashBytes = crypto.createHash('sha256').update(new Uint8Array(storedBytecode)).digest();
                    vmNode.set_payload_hash(new Uint8Array(hashBytes));
                }
                const result = vmNode.execute(
                    new Uint8Array(storedBytecode!),
                    new Uint8Array(storedHandshakeHeader!),
                    JSON.stringify(Array.isArray(input) ? input : [input]),
                    new Uint8Array(storedOpcodeMap!)
                );
                parentPort.postMessage({ id, type: 'EXECUTE_SUCCESS', result });
            } catch (err: any) {
                parentPort.postMessage({ id, type: 'ERROR', error: err.message });
            }
        } else if (type === 'GENERATE_KEYPAIR') {
            try {
                const pubKey = vmNode.generate_client_keypair();
                parentPort.postMessage({ id, type: 'KEYPAIR_SUCCESS', publicKey: Array.from(pubKey) });
            } catch (err: any) {
                parentPort.postMessage({ id, type: 'KEYPAIR_ERROR', error: err.message });
            }
        } else if (type === 'SIGN_REQUEST') {
            if (!isReadyNode) {
                parentPort.postMessage({ id, type: 'SIGN_ERROR', error: 'VM not initialized' });
                return;
            }
            try {
                const { method, url, bodyStr, timestamp } = payload;
                const signatureHex = vmNode.sign_request(method, url, bodyStr || '', timestamp);
                if (signatureHex === 'uninitialized') {
                    throw new Error("WASM crypto not properly initialized");
                }
                parentPort.postMessage({ id, type: 'SIGN_SUCCESS', signature: signatureHex, timestamp });
            } catch (err: any) {
                parentPort.postMessage({ id, type: 'SIGN_ERROR', error: err.message });
            }
        }
    });

    parentPort.postMessage({ type: 'READY' });
}

if (!isNode && typeof self !== 'undefined') {
    const workerInitTime = performance.now();
    let isReady = false;
    let globalStegoImage: Uint8Array | null = null;
    let cachedNativeData: any = null;

    (self as any).native_call = (id: number, argsJson: string): string => {
        return nativeCallRouter(id, argsJson, cachedNativeData, workerInitTime);
    };

    const randomHex = (len: number) => {
        let hex = '';
        const chars = '0123456789abcdef';
        for (let i = 0; i < len; i++) {
            hex += chars[Math.floor(Math.random() * 16)];
        }
        return hex;
    };

    self.onmessage = async (e: MessageEvent) => {
        const { type, payload } = e.data;

        if (type === 'INIT') {
            try {
                let { vmCoreBytes, stegoImageBytes, imageWidth, imageHeight, sessionSeedHex, fingerprintHex, epochDay, devMode, websocketUrl, websocketAuth, nativeData, clientPrivateKey } = payload;
                
                const t0 = performance.now();
                
                const vmCoreBytesArray = vmCoreBytes instanceof Uint8Array ? vmCoreBytes : (ArrayBuffer.isView(vmCoreBytes) ? new Uint8Array(vmCoreBytes.buffer, vmCoreBytes.byteOffset, vmCoreBytes.byteLength) : new Uint8Array(vmCoreBytes));
                const stegoImageBytesArray = stegoImageBytes instanceof Uint8Array ? stegoImageBytes : (ArrayBuffer.isView(stegoImageBytes) ? new Uint8Array(stegoImageBytes.buffer, stegoImageBytes.byteOffset, stegoImageBytes.byteLength) : new Uint8Array(stegoImageBytes));

                const checkTiming = () => {
                    const delta = performance.now() - t0;
                    if (devMode !== true && delta > 50) {
                        try {
                            const first = vmCoreBytesArray[0];
                            if (vmCoreBytesArray.length > 0 && first !== undefined) {
                                vmCoreBytesArray[0] = first ^ 0xFF;
                            }
                        } catch (err) {}
                        try {
                            const first = stegoImageBytesArray[0];
                            if (stegoImageBytesArray.length > 0 && first !== undefined) {
                                stegoImageBytesArray[0] = first ^ 0xFF;
                            }
                        } catch (err) {}
                        sessionSeedHex = randomHex(64);
                        fingerprintHex = randomHex(64);
                        return true;
                    }
                    return false;
                };

                checkTiming();

                // Initialize Core Module
                await initCore({ module_or_path: vmCoreBytesArray });
                
                checkTiming();

                // Convert hex keys to Uint8Array so WASM can take ownership of the bytes and securely zeroize them
                const hexToBytes = (hex: string) => new Uint8Array((hex.match(/.{1,2}/g) || []).map(byte => parseInt(byte, 16)));
                
                let seedBytes = hexToBytes(sessionSeedHex);
                let fpBytes = hexToBytes(fingerprintHex);
                let stegoBytes = stegoImageBytesArray;

                if (checkTiming()) {
                    seedBytes = hexToBytes(sessionSeedHex);
                    fpBytes = hexToBytes(fingerprintHex);
                    stegoBytes = stegoImageBytesArray;
                }

                if (websocketUrl) {
                    const ws = new WebSocket(websocketUrl);
                    ws.binaryType = 'arraybuffer';
                    
                    let wsErrorSent = false;
                    
                    ws.onopen = () => {
                        if (websocketAuth) {
                            ws.send(websocketAuth);
                        }
                    };
                    
                    ws.onmessage = (event: MessageEvent) => {
                        try {
                            const keyBuffer = new Uint8Array(event.data as ArrayBuffer);
                            if (keyBuffer.length !== 32) {
                                throw new Error(`Invalid key length: ${keyBuffer.length}`);
                            }
                            
                            init_crypto_with_key(
                                keyBuffer,
                                seedBytes,
                                fpBytes,
                                epochDay
                            );
                            
                            globalStegoImage = stegoBytes;
                            isReady = true;
                            cachedNativeData = nativeData;
                            self.postMessage({ type: 'INIT_SUCCESS' });
                            ws.close();
                        } catch (err: any) {
                            if (!wsErrorSent) {
                                wsErrorSent = true;
                                self.postMessage({ type: 'INIT_ERROR', error: err.message });
                            }
                            ws.close();
                        }
                    };
                    
                    ws.onerror = (err) => {
                        if (!wsErrorSent) {
                            wsErrorSent = true;
                            self.postMessage({ type: 'INIT_ERROR', error: 'WebSocket connection failed' });
                        }
                    };
                    
                    ws.onclose = () => {
                        if (!isReady && !wsErrorSent) {
                            wsErrorSent = true;
                            self.postMessage({ type: 'INIT_ERROR', error: 'WebSocket closed prematurely' });
                        }
                    };
                } else {
                    // Initialize crypto within the WASM memory (key never leaves WASM)
                    init_crypto(
                        stegoBytes,
                        imageWidth,
                        imageHeight,
                        seedBytes, 
                        fpBytes, 
                        epochDay
                    );
                    
                    if (clientPrivateKey) {
                        set_client_private_key(new Uint8Array(clientPrivateKey));
                    }

                    globalStegoImage = stegoBytes;
                    isReady = true;
                    cachedNativeData = nativeData;
                    
                    self.postMessage({ type: 'INIT_SUCCESS' });
                }
            } catch (err: any) {
                self.postMessage({ type: 'INIT_ERROR', error: err.message });
            }
        } 
        else if (type === 'EXECUTE') {
            if (!isReady) {
                self.postMessage({ type: 'EXECUTE_ERROR', error: 'VM not initialized' });
                return;
            }
            try {
                const { bytecode, opcodeMap, handshakeHeader, input } = payload;
                
                const handshakeBytes = handshakeHeader ? new Uint8Array(handshakeHeader) : (globalStegoImage || new Uint8Array(0));
                
                const resultJson = execute(
                    new Uint8Array(bytecode), 
                    handshakeBytes,
                    JSON.stringify(Array.isArray(input) ? input : [input]),
                    new Uint8Array(opcodeMap)
                );
                self.postMessage({ type: 'EXECUTE_SUCCESS', result: resultJson });
            } catch (err: any) {
                self.postMessage({ type: 'EXECUTE_ERROR', error: err.message });
            }
        }
        else if (type === 'GENERATE_KEYPAIR') {
            try {
                const pubKey = generate_client_keypair();
                self.postMessage({ type: 'KEYPAIR_SUCCESS', publicKey: Array.from(pubKey) });
            } catch (err: any) {
                self.postMessage({ type: 'KEYPAIR_ERROR', error: err.message });
            }
        }
        else if (type === 'SIGN_REQUEST') {
            if (!isReady) {
                self.postMessage({ type: 'SIGN_ERROR', error: 'VM not initialized' });
                return;
            }
            
            try {
                const { method, url, bodyStr, timestamp } = payload;
                
                // Delegate signing entirely to WASM. 
                // We do not read the key or use crypto.subtle.
                const signatureHex = sign_request(method, url, bodyStr || '', timestamp);
                
                if (signatureHex === 'uninitialized') {
                    throw new Error("WASM crypto not properly initialized");
                }
                
                self.postMessage({ type: 'SIGN_SUCCESS', signature: signatureHex, timestamp });
            } catch (err: any) {
                self.postMessage({ type: 'SIGN_ERROR', error: err.message });
            }
        }
    };

    self.postMessage({ type: 'READY' });
}
