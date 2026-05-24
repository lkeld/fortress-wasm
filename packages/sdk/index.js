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
        if (event === 'message') {
            this.worker.on('message', (msg) => {
                callback({ data: msg });
            });
        } else if (event === 'error') {
            this.worker.on('error', callback);
        }
    }
}

class FortressClient {
    constructor() {
        this.worker = null;
        this.pending = new Map();
        this.messageId = 0;
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

        client.worker = await FortressClient.createWorker();

        client.worker.onmessage = ({ data }) => {
            const { id, type, result, error } = data;
            const pending = client.pending.get(id);
            if (!pending) return;
            clearTimeout(pending.timeout);
            client.pending.delete(id);
            if (type === 'ERROR') pending.reject(new Error(error));
            else pending.resolve(result);
        };

        client.worker.onerror = (err) => {
            for (const p of client.pending.values()) {
                clearTimeout(p.timeout);
                p.reject(new Error(`Worker error: ${err.message}`));
            }
            client.pending.clear();
        };

        const initPayload = { bytecode, handshakeHeader: handshakeBytes, opcodeMap };
        if (clientPrivateKey) {
            initPayload.clientPrivateKey = Array.isArray(clientPrivateKey)
                ? new Uint8Array(clientPrivateKey)
                : Uint8Array.from(Buffer.from(clientPrivateKey, 'base64'));
        }

        await client.send('INIT', initPayload);
        return client;
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
                        finalPath = path.join(__dirname, 'temp-worker.js');
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
            const worker = new Worker(URL.createObjectURL(blob));
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
                reject(new Error('Fortress execution timed out after 10 seconds'));
            }, 10000);
            this.pending.set(id, { resolve, reject, timeout });
            this.worker.postMessage({ id, type, payload });
        });
    }

    dispose() {
        for (const p of this.pending.values()) {
            clearTimeout(p.timeout);
            p.reject(new Error('Fortress client disposed'));
        }
        this.pending.clear();
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }
}

module.exports = { FortressClient };
