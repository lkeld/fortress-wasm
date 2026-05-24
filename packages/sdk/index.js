const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

let FORTRESS_WORKER_BUNDLE = '';
if (isNode) {
    try {
        FORTRESS_WORKER_BUNDLE = require('./worker-bundle.js').FORTRESS_WORKER_BUNDLE;
    } catch (e) {
        try {
            FORTRESS_WORKER_BUNDLE = require('../../worker-bundle.js').FORTRESS_WORKER_BUNDLE;
        } catch (err) {}
    }
}

const getImportMetaUrl = () => {
    try {
        return Function('return import.meta.url')();
    } catch (e) {
        try {
            return typeof document !== 'undefined' ? (document.currentScript && document.currentScript.src) || window.location.href : '';
        } catch (err) {
            return '';
        }
    }
};

class NodeWorkerWrapper {
    constructor(scriptContent, isPath = false) {
        const { Worker } = require('worker_threads');
        if (isPath) {
            this.worker = new Worker(scriptContent);
        } else {
            this.worker = new Worker(scriptContent, { eval: true });
        }
        this.wrappers = new Map();
        
        this.worker.on('message', (msg) => {
            if (this.onmessage) this.onmessage({ data: msg });
        });
        
        this.worker.on('error', (err) => {
            if (this.onerror) this.onerror(err);
        });
    }
    
    postMessage(data) {
        this.worker.postMessage(data);
    }
    
    terminate() {
        this.worker.terminate();
    }
    
    addEventListener(event, callback, options) {
        const once = options && options.once;
        if (event === 'message') {
            const wrapped = (msg) => {
                if (once) {
                    this.wrappers.delete(callback);
                }
                callback({ data: msg });
            };
            this.wrappers.set(callback, wrapped);
            if (once) {
                this.worker.once('message', wrapped);
            } else {
                this.worker.on('message', wrapped);
            }
        } else if (event === 'error') {
            if (once) {
                this.worker.once('error', callback);
            } else {
                this.worker.on('error', callback);
            }
        }
    }

    removeEventListener(event, callback) {
        if (event === 'message') {
            const wrapped = this.wrappers.get(callback);
            if (wrapped) {
                this.worker.off('message', wrapped);
                this.wrappers.delete(callback);
            }
        } else if (event === 'error') {
            this.worker.off('error', callback);
        }
    }
}

async function verifyWasmSRI() {
    let wasmBytes = null;
    let expectedHash = 'b0af87a20779f263e471b5bfcc6af471a19a40d69b2e87f57ee5e87bef1f8dc3235f22875f71142502ae8497e4e1d4ef';

    // 1. Try to read expected hash from WASM_INTEGRITY.txt
    if (isNode) {
        try {
            const fs = require('fs');
            const path = require('path');
            const possibleIntegrityPaths = [
                path.join(process.cwd(), 'WASM_INTEGRITY.txt'),
                path.join(__dirname, 'WASM_INTEGRITY.txt'),
                path.join(__dirname, '../WASM_INTEGRITY.txt'),
                path.join(__dirname, '../../WASM_INTEGRITY.txt'),
                path.join(__dirname, '../../../WASM_INTEGRITY.txt')
            ];
            for (const p of possibleIntegrityPaths) {
                if (fs.existsSync(p)) {
                    expectedHash = fs.readFileSync(p, 'utf8').trim();
                    break;
                }
            }
        } catch (e) {}
    } else {
        try {
            const response = await fetch('/WASM_INTEGRITY.txt');
            if (response.ok) {
                expectedHash = (await response.text()).trim();
            }
        } catch (e) {
            try {
                const response = await fetch('WASM_INTEGRITY.txt');
                if (response.ok) {
                    expectedHash = (await response.text()).trim();
                }
            } catch (err) {}
        }
    }

    // 2. Read vm_core_bg.wasm
    if (isNode) {
        const fs = require('fs');
        const path = require('path');
        const possibleWasmPaths = [
            path.join(__dirname, '../../pkg-node/vm_core_bg.wasm'),
            path.join(__dirname, '../pkg-node/vm_core_bg.wasm'),
            path.join(__dirname, './pkg-node/vm_core_bg.wasm'),
            path.join(__dirname, '../../pkg-web/vm_core_bg.wasm'),
            path.join(__dirname, '../pkg-web/vm_core_bg.wasm'),
            path.join(__dirname, './pkg-web/vm_core_bg.wasm'),
            path.join(process.cwd(), 'pkg-node/vm_core_bg.wasm'),
            path.join(process.cwd(), 'pkg-web/vm_core_bg.wasm'),
            path.join(process.cwd(), 'vm_core_bg.wasm')
        ];
        for (const p of possibleWasmPaths) {
            if (fs.existsSync(p)) {
                wasmBytes = new Uint8Array(fs.readFileSync(p));
                break;
            }
        }
        if (!wasmBytes) {
            throw new Error('vm_core_bg.wasm not found on disk');
        }
    } else {
        const metaUrl = getImportMetaUrl();
        const wasmUrl = new URL('vm_core_bg.wasm', metaUrl);
        try {
            const response = await fetch(wasmUrl);
            if (!response.ok) throw new Error(`Status ${response.status}`);
            const ab = await response.arrayBuffer();
            wasmBytes = new Uint8Array(ab);
        } catch (e) {
            try {
                const response = await fetch('/vm_core_bg.wasm');
                if (!response.ok) throw new Error(`Status ${response.status}`);
                const ab = await response.arrayBuffer();
                wasmBytes = new Uint8Array(ab);
            } catch (err) {
                throw new Error('Failed to fetch vm_core_bg.wasm: ' + e.message);
            }
        }
    }

    // 3. Compute SHA-384 hash of wasmBytes
    let computedHash = '';
    if (isNode) {
        const crypto = require('crypto');
        computedHash = crypto.createHash('sha384').update(wasmBytes).digest('hex');
    } else {
        const hashBuffer = await crypto.subtle.digest('SHA-384', wasmBytes);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        computedHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // 4. Compare
    if (computedHash !== expectedHash) {
        throw new Error(`Subresource Integrity (SRI) verification failed for vm_core_bg.wasm. Expected: ${expectedHash}, Computed: ${computedHash}`);
    }

    return wasmBytes;
}

class FortressClient {
    constructor() {
        this.worker = null;
        this.pending = new Map();
        this.messageId = 0;
        this.initParams = null;
        this.workerPromise = null;
    }

    static async init(endpoint) {
        const client = new FortressClient();

        let responseData;
        if (typeof fetch !== 'undefined' && (endpoint.startsWith('http://') || endpoint.startsWith('https://'))) {
            const response = await fetch(endpoint, { cache: 'no-store', headers: { 'Accept': 'application/json' } });
            if (!response.ok) throw new Error(`Fortress endpoint returned ${response.status}: ${response.statusText}`);
            responseData = await response.json();
        } else {
            if (isNode) {
                const fs = require('fs');
                if (fs.existsSync(endpoint)) {
                    responseData = JSON.parse(fs.readFileSync(endpoint, 'utf8'));
                } else {
                    throw new Error(`Fetch not supported for URL "${endpoint}" and local mock file not found.`);
                }
            } else {
                throw new Error(`Fetch not supported for URL "${endpoint}".`);
            }
        }

        const { payload, opcodeMap, handshake, clientPrivateKey } = responseData;
        const bytecode = Array.isArray(payload) ? new Uint8Array(payload) : Uint8Array.from(Buffer.from(payload, 'base64'));
        const handshakeBytes = Array.isArray(handshake) ? new Uint8Array(handshake) : Uint8Array.from(Buffer.from(handshake, 'base64'));

        if (typeof global !== 'undefined') {
            global.__fortress_latest_bytecode = bytecode;
            global.__fortress_latest_opcodeMap = opcodeMap;
        }
        if (typeof window !== 'undefined') {
            window.__fortress_latest_bytecode = bytecode;
            window.__fortress_latest_opcodeMap = opcodeMap;
        }

        const vmCoreBytes = await verifyWasmSRI();
        const initPayload = { bytecode, handshakeHeader: handshakeBytes, opcodeMap, vmCoreBytes };
        if (clientPrivateKey) {
            initPayload.clientPrivateKey = Array.isArray(clientPrivateKey)
                ? new Uint8Array(clientPrivateKey)
                : Uint8Array.from(Buffer.from(clientPrivateKey, 'base64'));
        }

        client.initParams = initPayload;
        await client.ensureWorker();
        return client;
    }

    async ensureWorker() {
        if (this.worker) {
            return;
        }
        if (this.workerPromise) {
            return this.workerPromise;
        }
        this.workerPromise = (async () => {
            const worker = await FortressClient.createWorker();

            worker.onmessage = ({ data }) => {
                const { id, type, result, error } = data;
                const pending = this.pending.get(id);
                if (!pending) return;
                clearTimeout(pending.timeout);
                this.pending.delete(id);
                if (type === 'ERROR') pending.reject(new Error(error));
                else pending.resolve(result);
            };

            worker.onerror = (err) => {
                this.handleWorkerCrash(err);
            };

            this.worker = worker;
            this.workerPromise = null;

            await this._sendRaw('INIT', this.initParams);
        })();

        try {
            await this.workerPromise;
        } catch (err) {
            this.workerPromise = null;
            throw err;
        }
    }

    handleWorkerCrash(err) {
        this.workerPromise = null;
        for (const p of this.pending.values()) {
            clearTimeout(p.timeout);
            p.reject(new Error(`Worker error: ${err.message}`));
        }
        this.pending.clear();
        if (this.worker) {
            this.worker.onmessage = null;
            this.worker.onerror = null;
            try { this.worker.terminate(); } catch (e) {}
            this.worker = null;
        }
    }

    static async createWorker(forceStrategy = null) {
        if (forceStrategy === 'csp-timeout') {
            return new Promise((_, reject) => {
                setTimeout(() => reject(new Error('CSP worker-src blob missing 10s timeout')), 10);
            });
        }

        if (isNode) {
            // Node environment worker loading
            if (forceStrategy === 'strategy1' || (!forceStrategy)) {
                try {
                    const fs = require('fs');
                    const path = require('path');
                    const workerFilePath = path.join(__dirname, 'worker.js');
                    let finalPath = workerFilePath;
                    let tempCreated = false;
                    if (!fs.existsSync(workerFilePath)) {
                        const rand = Math.random().toString(36).substring(2, 10);
                        finalPath = path.join(__dirname, `temp-worker-${rand}.js`);
                        fs.writeFileSync(finalPath, FORTRESS_WORKER_BUNDLE);
                        tempCreated = true;
                    }
                    
                    const worker = new NodeWorkerWrapper(finalPath, true);
                    await new Promise((resolve, reject) => {
                        const t = setTimeout(() => {
                            if (tempCreated) { try { fs.unlinkSync(finalPath); } catch (e) {} }
                            reject(new Error('timeout'));
                        }, 2000);
                        worker.addEventListener('message', ({ data }) => {
                            if (data.type === 'READY') {
                                clearTimeout(t);
                                if (tempCreated) { try { fs.unlinkSync(finalPath); } catch (e) {} }
                                resolve();
                            }
                        }, { once: true });
                        worker.addEventListener('error', (err) => {
                            if (tempCreated) { try { fs.unlinkSync(finalPath); } catch (e) {} }
                            reject(err);
                        }, { once: true });
                    });
                    return worker;
                } catch (e) {
                    if (forceStrategy === 'strategy1') throw e;
                }
            }

            const worker = new NodeWorkerWrapper(FORTRESS_WORKER_BUNDLE, false);
            await new Promise((resolve, reject) => {
                const t = setTimeout(() => reject(new Error('timeout')), 2000);
                worker.addEventListener('message', ({ data }) => {
                    if (data.type === 'READY') {
                        clearTimeout(t);
                        resolve();
                    }
                }, { once: true });
                worker.addEventListener('error', reject, { once: true });
            });
            return worker;
        } else {
            // Browser environment worker loading
            if (forceStrategy === 'strategy1' || (!forceStrategy)) {
                try {
                    const metaUrl = getImportMetaUrl();
                    const worker = new Worker(new URL('./worker.js', metaUrl));
                    await new Promise((resolve, reject) => {
                        const t = setTimeout(() => reject(new Error('timeout')), 2000);
                        const onMsg = ({ data }) => {
                            if (data.type === 'READY') {
                                clearTimeout(t);
                                worker.removeEventListener('message', onMsg);
                                worker.removeEventListener('error', onErr);
                                resolve();
                            }
                        };
                        const onErr = (err) => {
                            clearTimeout(t);
                            worker.removeEventListener('message', onMsg);
                            worker.removeEventListener('error', onErr);
                            reject(err);
                        };
                        worker.addEventListener('message', onMsg);
                        worker.addEventListener('error', onErr);
                    });
                    return worker;
                } catch (e) {
                    if (forceStrategy === 'strategy1') throw e;
                }
            }

            const blob = new Blob([FORTRESS_WORKER_BUNDLE || window.FORTRESS_WORKER_BUNDLE || self.FORTRESS_WORKER_BUNDLE || ''], { type: 'application/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            const worker = new Worker(blobUrl);
            await new Promise((resolve, reject) => {
                const t = setTimeout(() => {
                    URL.revokeObjectURL(blobUrl);
                    reject(new Error('timeout'));
                }, 2000);
                const onMsg = ({ data }) => {
                    if (data.type === 'READY') {
                        clearTimeout(t);
                        URL.revokeObjectURL(blobUrl);
                        worker.removeEventListener('message', onMsg);
                        worker.removeEventListener('error', onErr);
                        resolve();
                    }
                };
                const onErr = (err) => {
                    clearTimeout(t);
                    URL.revokeObjectURL(blobUrl);
                    worker.removeEventListener('message', onMsg);
                    worker.removeEventListener('error', onErr);
                    reject(err);
                };
                worker.addEventListener('message', onMsg);
                worker.addEventListener('error', onErr);
            });
            return worker;
        }
    }

    async execute(input) {
        const result = await this.send('EXECUTE', { input });
        return typeof result === 'string' ? JSON.parse(result) : result;
    }

    send(type, payload) {
        return new Promise((resolve, reject) => {
            const id = String(this.messageId++);
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                this.handleWorkerCrash(new Error('Fortress execution timed out after 10 seconds'));
                reject(new Error('Fortress execution timed out after 10 seconds'));
            }, 10000);
            this.pending.set(id, { resolve, reject, timeout });

            this.ensureWorker().then(() => {
                if (!this.worker) {
                    if (this.pending.has(id)) {
                        this.pending.delete(id);
                        clearTimeout(timeout);
                        reject(new Error('Fortress client worker has been terminated or not initialized'));
                    }
                    return;
                }
                if (!this.pending.has(id)) {
                    // Already rejected by dispose or crash
                    return;
                }
                this.worker.postMessage({ id, type, payload });
            }).catch((err) => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    clearTimeout(timeout);
                    reject(err);
                }
            });
        });
    }

    _sendRaw(type, payload) {
        return new Promise((resolve, reject) => {
            if (!this.worker) {
                return reject(new Error('Fortress client worker has been terminated or not initialized'));
            }
            const id = String(this.messageId++);
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                this.handleWorkerCrash(new Error('Fortress execution timed out after 10 seconds'));
                reject(new Error('Fortress execution timed out after 10 seconds'));
            }, 10000);
            this.pending.set(id, { resolve, reject, timeout });
            this.worker.postMessage({ id, type, payload });
        });
    }

    dispose() {
        this.workerPromise = null;
        for (const p of this.pending.values()) {
            clearTimeout(p.timeout);
            p.reject(new Error('Fortress client disposed'));
        }
        this.pending.clear();
        if (this.worker) {
            this.worker.onmessage = null;
            this.worker.onerror = null;
            try { this.worker.terminate(); } catch (e) {}
            this.worker = null;
        }
    }
}

module.exports = { FortressClient };
