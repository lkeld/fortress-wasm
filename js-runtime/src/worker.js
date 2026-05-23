import initCore, { execute, init_crypto, init_crypto_with_key, sign_request, generate_client_keypair, clear_crypto } from '../../pkg/vm-core/vm_core.js';
let isReady = false;
let globalStegoImage = null;
let cachedNativeData = null;
self.native_call = (id, argsJson) => {
    if (!cachedNativeData) {
        return "";
    }
    switch (id) {
        case 1:
            return cachedNativeData.webgl || "";
        case 2:
            return cachedNativeData.canvas || "";
        case 3:
            return JSON.stringify(cachedNativeData.automation || {});
        case 4: {
            let screenData = { ...(cachedNativeData.screen || {}) };
            try {
                const args = JSON.parse(argsJson);
                if (Array.isArray(args) && args.length >= 2) {
                    if (typeof args[0] === 'number') {
                        screenData.width = args[0];
                        screenData.availWidth = args[0];
                    }
                    if (typeof args[1] === 'number') {
                        screenData.height = args[1];
                        screenData.availHeight = args[1];
                    }
                }
            }
            catch (e) { }
            return JSON.stringify(screenData);
        }
        default:
            return "";
    }
};
const randomHex = (len) => {
    let hex = '';
    const chars = '0123456789abcdef';
    for (let i = 0; i < len; i++) {
        hex += chars[Math.floor(Math.random() * 16)];
    }
    return hex;
};
self.onmessage = async (e) => {
    const { type, payload } = e.data;
    if (type === 'INIT') {
        try {
            let { vmCoreBytes, stegoImageBytes, imageWidth, imageHeight, sessionSeedHex, fingerprintHex, epochDay, devMode, websocketUrl, websocketAuth, nativeData } = payload;
            const t0 = performance.now();
            const checkTiming = () => {
                const delta = performance.now() - t0;
                if (devMode !== true && delta > 50) {
                    try {
                        const arr = new Uint8Array(vmCoreBytes);
                        const first = arr[0];
                        if (arr.length > 0 && first !== undefined) {
                            arr[0] = first ^ 0xFF;
                        }
                    }
                    catch (err) { }
                    try {
                        const arr = new Uint8Array(stegoImageBytes);
                        const first = arr[0];
                        if (arr.length > 0 && first !== undefined) {
                            arr[0] = first ^ 0xFF;
                        }
                    }
                    catch (err) { }
                    sessionSeedHex = randomHex(64);
                    fingerprintHex = randomHex(64);
                    return true;
                }
                return false;
            };
            checkTiming();
            // Initialize Core Module
            await initCore({ module_or_path: new Uint8Array(vmCoreBytes) });
            checkTiming();
            // Convert hex keys to Uint8Array so WASM can take ownership of the bytes and securely zeroize them
            const hexToBytes = (hex) => new Uint8Array((hex.match(/.{1,2}/g) || []).map(byte => parseInt(byte, 16)));
            let seedBytes = hexToBytes(sessionSeedHex);
            let fpBytes = hexToBytes(fingerprintHex);
            let stegoBytes = new Uint8Array(stegoImageBytes);
            if (checkTiming()) {
                seedBytes = hexToBytes(sessionSeedHex);
                fpBytes = hexToBytes(fingerprintHex);
                stegoBytes = new Uint8Array(stegoImageBytes);
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
                ws.onmessage = (event) => {
                    try {
                        const keyBuffer = new Uint8Array(event.data);
                        if (keyBuffer.length !== 32) {
                            throw new Error(`Invalid key length: ${keyBuffer.length}`);
                        }
                        init_crypto_with_key(keyBuffer, seedBytes, fpBytes, epochDay);
                        globalStegoImage = stegoBytes;
                        isReady = true;
                        cachedNativeData = nativeData;
                        self.postMessage({ type: 'INIT_SUCCESS' });
                        ws.close();
                    }
                    catch (err) {
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
            }
            else {
                // Initialize crypto within the WASM memory (key never leaves WASM)
                init_crypto(stegoBytes, imageWidth, imageHeight, seedBytes, fpBytes, epochDay);
                globalStegoImage = stegoBytes;
                isReady = true;
                cachedNativeData = nativeData;
                self.postMessage({ type: 'INIT_SUCCESS' });
            }
        }
        catch (err) {
            self.postMessage({ type: 'INIT_ERROR', error: err.message });
        }
    }
    else if (type === 'EXECUTE') {
        if (!isReady) {
            self.postMessage({ type: 'EXECUTE_ERROR', error: 'VM not initialized' });
            return;
        }
        try {
            const { bytecode, opcodeMap, input, handshakeHeader } = payload;
            const header = handshakeHeader ? new Uint8Array(handshakeHeader) : globalStegoImage;
            const resultJson = execute(new Uint8Array(bytecode), header, JSON.stringify(input || []), new Uint8Array(opcodeMap));
            self.postMessage({ type: 'EXECUTE_SUCCESS', result: resultJson });
        }
        catch (err) {
            self.postMessage({ type: 'EXECUTE_ERROR', error: err.message });
        }
    }
    else if (type === 'GENERATE_KEYPAIR') {
        try {
            const publicKey = generate_client_keypair();
            self.postMessage({ type: 'KEYPAIR_SUCCESS', publicKey: Array.from(publicKey) });
        }
        catch (err) {
            self.postMessage({ type: 'KEYPAIR_ERROR', error: err.message });
        }
    }
    else if (type === 'CLEAR_CRYPTO') {
        try {
            clear_crypto();
            self.postMessage({ type: 'CLEAR_CRYPTO_SUCCESS' });
        }
        catch (err) {
            self.postMessage({ type: 'CLEAR_CRYPTO_ERROR', error: err.message });
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
        }
        catch (err) {
            self.postMessage({ type: 'SIGN_ERROR', error: err.message });
        }
    }
};
//# sourceMappingURL=worker.js.map