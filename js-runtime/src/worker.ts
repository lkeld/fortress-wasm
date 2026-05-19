import initCore, { execute, init_crypto, sign_request } from '../../pkg/vm-core/vm_core.js';

let isReady = false;
let globalStegoImage: Uint8Array | null = null;

self.onmessage = async (e: MessageEvent) => {
    const { type, payload } = e.data;

    if (type === 'INIT') {
        try {
            const { vmCoreBytes, stegoImageBytes, imageWidth, imageHeight, sessionSeedHex, fingerprintHex, epochDay } = payload;
            
            // Initialize Core Module
            await initCore({ module_or_path: new Uint8Array(vmCoreBytes) });
            
            // Convert hex keys to Uint8Array so WASM can take ownership of the bytes and securely zeroize them
            const hexToBytes = (hex: string) => new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
            
            // Initialize crypto within the WASM memory (key never leaves WASM)
            init_crypto(
                new Uint8Array(stegoImageBytes),
                imageWidth,
                imageHeight,
                hexToBytes(sessionSeedHex), 
                hexToBytes(fingerprintHex), 
                epochDay
            );
            
            globalStegoImage = new Uint8Array(stegoImageBytes);
            isReady = true;
            
            self.postMessage({ type: 'INIT_SUCCESS' });
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
            const { bytecode, opcodeMap, input } = payload;
            
            const resultJson = execute(
                new Uint8Array(bytecode), 
                globalStegoImage!,
                JSON.stringify(input || []),
                new Uint8Array(opcodeMap)
            );
            self.postMessage({ type: 'EXECUTE_SUCCESS', result: resultJson });
        } catch (err: any) {
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
        } catch (err: any) {
            self.postMessage({ type: 'SIGN_ERROR', error: err.message });
        }
    }
};
