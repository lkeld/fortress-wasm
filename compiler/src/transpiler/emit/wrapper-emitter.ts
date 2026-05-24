import { TranspileOptions } from '../types';

const COMMON_PREPARE_PAYLOAD = `
const proxySymbol = Symbol.for("__fortress_proxy_targets__");
if (!globalThis[proxySymbol]) {
    globalThis[proxySymbol] = new WeakMap();
}
const proxyTargets = globalThis[proxySymbol];

function preparePayload(obj, visited = new Map()) {
    if (obj === null || obj === undefined) return obj;
    if (typeof SharedArrayBuffer !== 'undefined' && obj instanceof SharedArrayBuffer) {
        return {
            __is_sab: true,
            buffer: Array.from(new Uint8Array(obj))
        };
    }
    if (obj && obj.__is_sab) {
        return {
            __is_sab: true,
            buffer: preparePayload(obj.buffer, visited)
        };
    }
    if (ArrayBuffer.isView(obj)) {
        obj = Array.from(obj);
    }
    if (typeof obj !== 'object') return obj;
    if (proxyTargets.has(obj)) {
        return preparePayload(proxyTargets.get(obj), visited);
    }
    if (visited.has(obj)) return visited.get(obj);
    if (Array.isArray(obj)) {
        const cloned = [];
        visited.set(obj, cloned);
        for (let i = 0; i < obj.length; i++) {
            cloned.push(preparePayload(obj[i], visited));
        }
        return cloned;
    }
    const keys = Reflect.ownKeys(obj).filter(k => k !== '__ownKeys');
    const cloned = {};
    visited.set(obj, cloned);
    for (const k of keys) {
        cloned[k] = preparePayload(obj[k], visited);
    }
    cloned.__ownKeys = keys.map(k => typeof k === 'symbol' ? (k.description || k.toString()) : k);
    return cloned;
}
`;

export function emitProxyWrapper(
    options: TranspileOptions,
    rewrittenFuncCode: string,
    proxyGetNode: any,
    proxySetNode: any,
    hasSharedArrayBuffer: boolean
): string {
    const getTrap = proxyGetNode ? `
                            if (typeof prop === 'symbol') return t[prop];
                            if (inside) return t[prop];
                            inside = true;
                            try {
                                const allowed = runFvmSync(
                                    globalThis.__fortress_latest_bytecode || globalThis.__fortress_bytecode,
                                    globalThis.__fortress_latest_opcodeMap || globalThis.__fortress_opcodeMap,
                                    ["${options.functionName}_proxy_get", preparePayload(t), prop]
                                );
                                if (typeof allowed === "string" && allowed.indexOf("__fortress_error__:") === 0) {
                                    const parts = allowed.split(":");
                                    const errClass = parts[1];
                                    const msg = parts.slice(2).join(":");
                                    const ErrorConstructor = ERROR_CONSTRUCTORS[errClass] || ERROR_CONSTRUCTORS.Error;
                                    throw new ErrorConstructor(msg);
                                }
                                if (allowed === "__fortress_error__") {
                                    throw new TypeError("Proxy validation failed: get trap returned false");
                                }
                                return allowed;
                            } finally {
                                inside = false;
                            }
` : `
                            if (typeof prop === 'symbol') return t[prop];
                            return t[prop];
`;

    const setTrap = proxySetNode ? `
                            if (typeof prop === 'symbol') {
                                t[prop] = value;
                                return true;
                            }
                            if (inside) {
                                t[prop] = value;
                                return true;
                            }
                            inside = true;
                            try {
                                 let allowed;
                                 try {
                                     allowed = runFvmSync(
                                         globalThis.__fortress_latest_bytecode || globalThis.__fortress_bytecode,
                                         globalThis.__fortress_latest_opcodeMap || globalThis.__fortress_opcodeMap,
                                         ["${options.functionName}_proxy_set", preparePayload(t), prop, preparePayload(value)]
                                     );
                                 } catch (err) {
                                     throw err;
                                 }
                                 if (typeof allowed === "string" && allowed.indexOf("__fortress_error__:") === 0) {
                                     const parts = allowed.split(":");
                                     const errClass = parts[1];
                                     const msg = parts.slice(2).join(":");
                                     const ErrorConstructor = ERROR_CONSTRUCTORS[errClass] || ERROR_CONSTRUCTORS.Error;
                                     throw new ErrorConstructor(msg);
                                 }
                                 if (allowed === "__fortress_error__" || allowed === false) {
                                     throw new TypeError("Proxy validation failed: set trap returned false");
                                 }
                                 t[prop] = value;
                                 return true;
                            } finally {
                                 inside = false;
                            }
` : `
                            if (typeof prop === 'symbol') {
                                t[prop] = value;
                                return true;
                            }
                            t[prop] = value;
                            return true;
`;

    let wrapper = `
const { FortressClient } = require('../../client.js');
let fortressClient;
${COMMON_PREPARED_PAYLOAD_HOLDER(getTrap, setTrap, rewrittenFuncCode, options.functionName)}
`;
    if (hasSharedArrayBuffer) {
        wrapper = `// SharedArrayBuffer usage detected: shared memory is replaced with message-passing equivalent.\n` + wrapper;
    }
    return wrapper;
}

function COMMON_PREPARED_PAYLOAD_HOLDER(getTrap: string, setTrap: string, rewrittenFuncCode: string, funcName: string) {
    return `
${COMMON_PREPARE_PAYLOAD}

function runFvmSync(code, opcodeMap, args) {
    const crypto = require('crypto');
    const vmNode = require('../../pkg-node/vm_core.js');
    const seen = new Set();
    const inputJson = JSON.stringify(preparePayload(args), (key, value) => {
        if (value !== null && typeof value === 'object') {
            if (seen.has(value)) {
                return "[Circular]";
            }
            seen.add(value);
        }
        return value;
    });
    if (code.length > 0 && code.length % 288 === 0) {
        const newCode = new Uint8Array(code.length + 1);
        newCode.set(code);
        newCode[code.length] = 0;
        code = newCode;
    }
    const hashBytes = crypto.createHash('sha256').update(code).digest();
    vmNode.set_payload_hash(new Uint8Array(hashBytes));
    const dummyPng = new Uint8Array(1024);
    const mapUint8 = new Uint8Array(opcodeMap);
    vmNode.init_crypto_with_key(new Uint8Array(32), new Uint8Array(32), new Uint8Array(32), 0);
    try {
        const resStr = vmNode.execute(code, dummyPng, inputJson, mapUint8);
        let res;
        try {
            res = JSON.parse(resStr);
        } catch (parseErr) {
            console.error("JSON PARSE ERROR on resStr:", resStr);
            throw parseErr;
        }
        if (res && res.error) {
            throw new Error(res.error);
        }
        return res;
    } finally {
        vmNode.clear_crypto();
    }
}

${rewrittenFuncCode}

module.exports = ${funcName};
`;
}

export function emitEvalSplitWrapper(
    options: TranspileOptions,
    paramsCode: string,
    statementsBeforeCode: string,
    liveVars: string[],
    splitFuncName: string,
    liveVarsCode: string,
    hasSharedArrayBuffer: boolean
): string {
    let payloadArgsCheck = '';
    if (liveVars.length > 2) {
        payloadArgsCheck = `payloadArgs = ["${splitFuncName}", { ${liveVars.map(v => `"${v}": ${v}`).join(', ')} }];`;
    } else {
        payloadArgsCheck = `payloadArgs = ["${splitFuncName}", ${liveVarsCode}];`;
    }

    let wrapper = `
const { FortressClient } = require('../../client.js');
let fortressClient;

${COMMON_PREPARE_PAYLOAD}

module.exports = async function(${paramsCode}) {
    ${statementsBeforeCode}
    if (!fortressClient) {
        fortressClient = await FortressClient.init(process.env.FORTRESS_ENDPOINT || './checkLicense.json');
    }
    let payloadArgs;
    ${payloadArgsCheck}
    return await fortressClient.execute(preparePayload(payloadArgs));
};
`;
    if (hasSharedArrayBuffer) {
        wrapper = `// SharedArrayBuffer usage detected: shared memory is replaced with message-passing equivalent.\n` + wrapper;
    }
    return wrapper;
}

export function emitGeneratorWrapper(
    options: TranspileOptions,
    originalParamNames: string[],
    hasSharedArrayBuffer: boolean
): string {
    let payloadArgsCheck = '';
    if (originalParamNames.length > 2) {
        payloadArgsCheck = `payloadArgs = ["new", { ${originalParamNames.map((name, i) => `"${name}": args[${i}]`).join(', ')} }];`;
    } else {
        payloadArgsCheck = `payloadArgs = ["new", ...args];`;
    }

    let wrapper = `
const { FortressClient } = require('../../client.js');
let fortressClient;

${COMMON_PREPARE_PAYLOAD}

module.exports = function(...args) {
    let statePromise = null;
    let initialized = false;
    
    const initClient = async () => {
        if (!fortressClient) {
            fortressClient = await FortressClient.init(process.env.FORTRESS_ENDPOINT || './checkLicense.json');
        }
    };

    const iterator = {
        async next() {
            await initClient();
            if (!initialized) {
                let payloadArgs;
                ${payloadArgsCheck}
                const state = await fortressClient.execute(preparePayload(payloadArgs));
                initialized = true;
                const nextState = await fortressClient.execute(preparePayload(["next", state]));
                statePromise = Promise.resolve(nextState);
                return { value: nextState.value, done: nextState.done };
            } else {
                const currentState = await statePromise;
                if (currentState.done) {
                    return { value: null, done: true };
                }
                const nextState = await fortressClient.execute(preparePayload(["next", currentState]));
                statePromise = Promise.resolve(nextState);
                return { value: nextState.value, done: nextState.done };
            }
        },
        [Symbol.iterator]() {
            return this;
        },
        [Symbol.asyncIterator]() {
            return this;
        }
    };
    return iterator;
};
`;
    if (hasSharedArrayBuffer) {
        wrapper = `// SharedArrayBuffer usage detected: shared memory is replaced with message-passing equivalent.\n` + wrapper;
    }
    return wrapper;
}

export function emitDefaultWrapper(
    options: TranspileOptions,
    hasSharedArrayBuffer: boolean
): string {
    let wrapper = `
const { FortressClient } = require('../../client.js');
let fortressClient;

${COMMON_PREPARE_PAYLOAD}

module.exports = async function(...args) {
    if (!fortressClient) {
        fortressClient = await FortressClient.init(process.env.FORTRESS_ENDPOINT || './checkLicense.json');
    }
    let payloadArgs = args;
    return await fortressClient.execute(preparePayload(payloadArgs));
};
`;
    if (hasSharedArrayBuffer) {
        wrapper = `// SharedArrayBuffer usage detected: shared memory is replaced with message-passing equivalent.\n` + wrapper;
    }
    return wrapper;
}
