import initCore, { execute, init_crypto, sign_request } from '../../pkg/vm-core/vm_core.js';
let isReady = false;
self.onmessage = async (e) => {
    const { type, payload } = e.data;
    if (type === 'INIT') {
        try {
            const { vmCoreBytes, stegoKeyHex, sessionSeedHex, fingerprintHex, epochDay } = payload;
            // Initialize Core Module
            await initCore({ module_or_path: new Uint8Array(vmCoreBytes) });
            // Initialize crypto within the WASM memory (key never leaves WASM)
            init_crypto(stegoKeyHex, sessionSeedHex, fingerprintHex, epochDay);
            isReady = true;
            self.postMessage({ type: 'INIT_SUCCESS' });
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
            const { bytecode, constants, input } = payload;
            // Format constants as a JSON string and apply basic XOR obfuscation matching the compiler
            const constantsJsonStr = JSON.stringify(constants);
            const obfuscatedConstants = Array.from(constantsJsonStr)
                .map(char => (char.charCodeAt(0) ^ 0x42).toString(16).padStart(2, '0'))
                .join('');
            const resultJson = execute(new Uint8Array(bytecode), obfuscatedConstants, JSON.stringify(input || []));
            self.postMessage({ type: 'EXECUTE_SUCCESS', result: resultJson });
        }
        catch (err) {
            self.postMessage({ type: 'EXECUTE_ERROR', error: err.message });
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