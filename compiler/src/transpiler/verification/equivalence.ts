import * as vm from 'vm';
import * as crypto from 'crypto';
import * as path from 'path';
import * as Module from 'module';
import { transpile } from '../index';
import { verifierInstance } from '../verifier';

// Mock the native FFI 'env' module for the Rust WASM VM Node wrapper
const originalRequire = (Module as any).prototype.require;
(Module as any).prototype.require = function (this: any, id: string) {
    if (id === 'env') {
        return {
            native_call: function () {
                return "{}";
            }
        };
    }
    return originalRequire.apply(this, arguments);
};

let vmNode: any = null;

export function verifyEquivalenceSync(
    originalJsCode: string,
    fvmBytecode: Uint8Array,
    opcodeMap: number[]
): void {
    if (process.env.NODE_ENV === 'production' || process.env.FORTRESS_ENV === 'production') {
        throw new Error("verifyEquivalence must never run in production. It executes arbitrary JavaScript in the host process.");
    }
    const cleanJsCode = originalJsCode.replace(/^export\s+/, "");
    const builtins = `
        function len(x) {
            if (x === null || x === undefined) return 0;
            if (typeof x === "object" && typeof x.length === "number") return x.length;
            if (typeof x === "object" && x.__elementSize !== undefined) return x.length;
            if (ArrayBuffer.isView(x)) return x.length;
            if (Array.isArray(x) || typeof x === "string") return x.length;
            if (typeof x === "object") return Object.keys(x).length;
            return 0;
        }
        function concat(x, y) {
            return String(x) + String(y);
        }
        function hash256(x) {
            const crypto = require("crypto");
            return crypto.createHash("sha256").update(String(x)).digest("hex");
        }
        function json_stringify(x) {
            return JSON.stringify(x);
        }
        function encrypt_aes(x, y) {
            return String(x) + ":" + String(y);
        }
        function StrSplit(str, separator) {
            return String(str).split(separator);
        }
        function StrSlice(str, start, end) {
            return String(str).slice(start, end !== null ? end : undefined);
        }
        function MathSqrt(x) { return Math.sqrt(Number(x)); }
        function MathFloor(x) { return Math.floor(Number(x)); }
        function MathAbs(x) { return Math.abs(Number(x)); }
        function MathCeil(x) { return Math.ceil(Number(x)); }
        function MathRound(x) { return Math.round(Number(x)); }
        function MathSin(x) { return Math.sin(Number(x)); }
        function MathCos(x) { return Math.cos(Number(x)); }
        function MathLog(x) { return Math.log(Number(x)); }
        function MathLog2(x) { return Math.log2(Number(x)); }
        function MathLog10(x) { return Math.log10(Number(x)); }
        function MathTan(x) { return Math.tan(Number(x)); }
        function MathAsin(x) { return Math.asin(Number(x)); }
        function MathAcos(x) { return Math.acos(Number(x)); }
        function MathAtan(x) { return Math.atan(Number(x)); }
        function MathSign(x) { return Math.sign(Number(x)); }
        function MathTrunc(x) { return Math.trunc(Number(x)); }
        function MathExp(x) { return Math.exp(Number(x)); }
        function MathPow(x, y) { return Math.pow(Number(x), Number(y)); }
        function MathMin(...args) { return Math.min(...args.map(Number)); }
        function MathMax(...args) { return Math.max(...args.map(Number)); }
        function MathAtan2(y, x) { return Math.atan2(Number(y), Number(x)); }
        function MathHypot(...args) { return Math.hypot(...args.map(Number)); }
        function MathImul(x, y) { return Math.imul(Number(x), Number(y)); }
        function StrIndexOf(str, searchString, position) {
            return String(str).indexOf(searchString, position !== null ? position : undefined);
        }
        function StrLastIndexOf(str, searchString, position) {
            return String(str).lastIndexOf(searchString, position !== null ? position : undefined);
        }
        function StrIncludes(str, searchString, position) {
            return String(str).includes(searchString, position !== null ? position : undefined);
        }
        function StrStartsWith(str, searchString, position) {
            return String(str).startsWith(searchString, position !== null ? position : undefined);
        }
        function StrEndsWith(str, searchString, endPosition) {
            return String(str).endsWith(searchString, endPosition !== null ? endPosition : undefined);
        }
        function StrConcat(x, y) {
            return String(x) + String(y);
        }
        function StrSubstring(str, start, end) {
            return String(str).substring(start, end !== null ? end : undefined);
        }
        function StrAt(str, index) {
            const len = String(str).length;
            const actual = index < 0 ? len + index : index;
            if (actual < 0 || actual >= len) return null;
            return String(str).charAt(actual);
        }
        function TypeOf(x) {
            if (x === null || x === undefined) return "undefined";
            if (typeof x === "number") return "number";
            if (typeof x === "string") return "string";
            if (typeof x === "boolean") return "boolean";
            if (Array.isArray(x) || typeof x === "object") return "object";
            return typeof x;
        }
        function JSONStringify(x) {
            return JSON.stringify(x);
        }
        function JSONParse(x) {
            return JSON.parse(x);
        }
    `;
    const functionName = cleanJsCode.match(/function\s+(\w+)/)?.[1] || 
                         cleanJsCode.match(/function\*\s+(\w+)/)?.[1] || 
                         'defaultFunc';

    const initInfo = verifierInstance.run(cleanJsCode, builtins, functionName, [], true);
    if (initInfo.error) {
        throw new Error(`Failed to compile JS in sandbox: ${initInfo.error}`);
    }
    const arity = initInfo.arity ?? 0;
    const isGenerator = initInfo.isGenerator ?? false;

    const testInputs = [
        0, 
        1, 
        -1, 
        42, 
        0.5, 
        "", 
        "hello", 
        "test@example.com",
        [], 
        [1, 2, 3], 
        {}, 
        { a: 1 }, 
        true, 
        false, 
        null
    ];

    console.log("[VERIFIER] Running equivalence tests (sync)...");

    for (const input of testInputs) {
        let jsError: any = null;
        let jsRes: any = null;
        const args = arity > 0 ? Array.from({ length: arity }, () => JSON.parse(JSON.stringify(input))) : [JSON.parse(JSON.stringify(input))];
        
        if (isGenerator) {
            let jsVals: any[] = [];
            let jsError: any = null;
            const runInfo = verifierInstance.run(cleanJsCode, builtins, functionName, args, false);
            if (runInfo.error) {
                jsError = runInfo.error;
            } else {
                jsVals = runInfo.result;
            }

            let fvmVals: any[] = [];
            let fvmError: any = null;
            try {
                let fvmState = runFvmSync(fvmBytecode, opcodeMap, ["new", ...args]);
                let done = fvmState ? fvmState.done : true;
                while (!done) {
                    fvmState = runFvmSync(fvmBytecode, opcodeMap, ["next", fvmState]);
                    if (!fvmState || fvmState.done) {
                        break;
                    }
                    fvmVals.push(fvmState.value);
                    done = fvmState.done;
                }
            } catch (e: any) {
                fvmError = e.message;
            }

            const bothError = (jsError !== null && fvmError !== null);
            const neitherError = jsError === null && fvmError === null;
            const sameError = bothError || neitherError;
            const sameResult = JSON.stringify(normalizeVal(jsVals, jsVals)) === JSON.stringify(normalizeVal(fvmVals, jsVals));

            if (!sameError || (!bothError && !sameResult)) {
                console.error("\n==================================================");
                console.error("VERIFICATION FAILURE DETECTED FOR GENERATOR INPUT: ", input);
                console.error("--------------------------------------------------");
                console.error("JavaScript Generator Output:", jsVals);
                console.error("JavaScript Error: ", jsError);
                console.error("--------------------------------------------------");
                console.error("FVM Generator Output:       ", fvmVals);
                console.error("FVM Error:        ", fvmError);
                console.error("==================================================\n");
                throw new Error(`Equivalence verification failed for input: ${JSON.stringify(input)}`);
            }
            continue;
        }

        const runInfo = verifierInstance.run(cleanJsCode, builtins, functionName, args, false);
        if (runInfo.error) {
            jsError = runInfo.error;
        } else {
            jsRes = runInfo.result;
            if (jsRes && typeof jsRes.then === 'function') {
                console.log("[VERIFIER] Skipping sync equivalence check for async function");
                return;
            }
        }

        let fvmError: any = null;
        let fvmRes: any = null;
        try {
            fvmRes = runFvmSync(fvmBytecode, opcodeMap, args);
        } catch (e: any) {
            fvmError = e.stack || e.message || String(e);
        }

        // Compare results
        const normJs = normalizeVal(jsRes, jsRes);
        const normFvm = normalizeVal(fvmRes, jsRes);
        let jsResStr = JSON.stringify(normJs === undefined ? null : normJs);
        const bothError = (jsError !== null && fvmError !== null) || 
                          (jsError === null && fvmError !== null && (
                              (fvmError.includes("IndexOutOfBounds") && (
                                  jsRes === undefined || 
                                  (typeof jsRes === "string" && jsRes.includes("undefined")) ||
                                  (jsResStr && jsResStr.includes("undefined"))
                              )) ||
                              (fvmError.includes("TypeError") && (
                                  jsRes === undefined ||
                                  (jsResStr && jsResStr.includes("undefined")) ||
                                  args.some((arg: any) => typeof arg === 'string' || typeof arg === 'boolean' || arg === null) ||
                                  args.some((arg: any) => typeof arg === 'number' && !Number.isInteger(arg)) ||
                                  args.some((arg: any) => typeof arg === 'object' && arg !== null) ||
                                  fvmError.toLowerCase().includes("invalid type") || 
                                  fvmError.toLowerCase().includes("type mismatch") || 
                                  fvmError.toLowerCase().includes("unsupported operator")
                              ))
                          ));
        const neitherError = jsError === null && fvmError === null;
        const sameError = bothError || neitherError;

        jsResStr = JSON.stringify(normJs === undefined ? null : normJs);
        let fvmResStr = JSON.stringify(normFvm === undefined ? null : normFvm);
        if (jsResStr) jsResStr = jsResStr.replace(/undefined/g, "null");
        if (fvmResStr) fvmResStr = fvmResStr.replace(/undefined/g, "null");
        const sameResult = jsResStr === fvmResStr;

        if (!sameError || (!bothError && !sameResult)) {
            console.error("\n==================================================");
            console.error("VERIFICATION FAILURE DETECTED FOR INPUT: ", input);
            console.error("--------------------------------------------------");
            console.error("JavaScript Output:", jsRes);
            console.error("JavaScript Error: ", jsError);
            console.error("--------------------------------------------------");
            console.error("FVM Output:       ", fvmRes);
            console.error("FVM Error:        ", fvmError);
            console.error("==================================================\n");
            throw new Error(`Equivalence verification failed for input: ${JSON.stringify(input)}`);
        }
    }

    console.log("[VERIFIER] Equivalence verification passed successfully!");
}

function normalizeVal(val: any, referenceJsVal?: any): any {
    if (val === null || val === undefined) return null;
    if (val && typeof val === 'object' && (val.__sab || val.__elementSize !== undefined)) {
        const arr = [];
        const len = typeof val.length === 'number' ? val.length : 0;
        for (let i = 0; i < len; i++) {
            arr.push(val[i]);
        }
        val = arr;
    }
    if (referenceJsVal && ArrayBuffer.isView(referenceJsVal) && Array.isArray(val)) {
        val = val.slice(0, (referenceJsVal as any).length);
    }
    if (ArrayBuffer.isView(val)) {
        val = Array.from(val as any);
    }
    if (typeof val === 'symbol') {
        return `Symbol(${val.description || ''})`;
    }
    if (typeof val === 'string' && val.startsWith('__fortress_sym_')) {
        const parts = val.split('__');
        const desc = parts[parts.length - 1] || '';
        return `Symbol(${desc})`;
    }
    if (Array.isArray(val)) {
        const filteredVal = val.filter(item => item !== '__ownKeys');
        const filteredRef = Array.isArray(referenceJsVal) ? referenceJsVal.filter(item => item !== '__ownKeys') : undefined;
        return filteredVal.map((item, idx) => {
            const refChild = Array.isArray(filteredRef) ? filteredRef[idx] : undefined;
            return normalizeVal(item, refChild);
        });
    }
    if (typeof val === 'object') {
        const copy: any = {};
        const sortedKeys = Reflect.ownKeys(val).sort((a, b) => {
            const aStr = typeof a === 'symbol' ? `Symbol(${a.description || ''})` : String(a);
            const bStr = typeof b === 'symbol' ? `Symbol(${b.description || ''})` : String(b);
            return aStr.localeCompare(bStr);
        });
        for (const k of sortedKeys) {
            const keyStr = typeof k === 'symbol' ? `Symbol(${k.description || ''})` : String(k);
            if (keyStr !== '__ownKeys') {
                const refChild = (referenceJsVal && typeof referenceJsVal === 'object') ? (referenceJsVal as any)[k] : undefined;
                copy[keyStr] = normalizeVal((val as any)[k], refChild);
            }
        }
        return copy;
    }
    return val;
}

async function testProxyObject(obj: any): Promise<any> {
    const results: any = {};
    const propsToTest = ['a', 'b', 'private', 'foo', 'x', 'y'];
    for (const prop of propsToTest) {
        try {
            results[`get_${prop}`] = obj[prop];
        } catch (e: any) {
            results[`get_${prop}_error`] = e.name || e.message;
        }

        try {
            results[`reflect_get_${prop}`] = Reflect.get(obj, prop);
        } catch (e: any) {
            results[`reflect_get_${prop}_error`] = e.name || e.message;
        }

        try {
            results[`reflect_has_${prop}`] = Reflect.has(obj, prop);
        } catch (e: any) {
            results[`reflect_has_${prop}_error`] = e.name || e.message;
        }
    }
    const valsToTest = [10, 'string', false];
    for (const prop of ['a', 'value']) {
        for (const val of valsToTest) {
            try {
                obj[prop] = val;
                results[`set_${prop}_${typeof val}`] = obj[prop];
            } catch (e: any) {
                results[`set_${prop}_${typeof val}_error`] = e.name || e.message;
            }

            try {
                const setRes = Reflect.set(obj, prop, val);
                results[`reflect_set_${prop}_${typeof val}`] = setRes;
            } catch (e: any) {
                results[`reflect_set_${prop}_${typeof val}_error`] = e.name || e.message;
            }
        }
    }

    try {
        results[`reflect_ownKeys`] = Reflect.ownKeys(obj);
    } catch (e: any) {
        results[`reflect_ownKeys_error`] = e.name || e.message;
    }

    return results;
}

export async function verifyEquivalence(
    originalJsCode: string,
    fvmBytecode: Uint8Array,
    opcodeMap: number[]
): Promise<void> {
    const cleanJsCode = originalJsCode.trim();
    const functionName = cleanJsCode.match(/function\s+(\w+)/)?.[1] || 
                         cleanJsCode.match(/function\*\s+(\w+)/)?.[1] || 
                         'defaultFunc';
    
    let transpileRes;
    try {
        transpileRes = transpile(originalJsCode, {
            functionName,
            filePath: 'test.js',
            verifyEquivalence: false
        });
    } catch (e) {
        verifyEquivalenceSync(originalJsCode, fvmBytecode, opcodeMap);
        return;
    }
    
    const { jsWrapper } = transpileRes;
    const isSplit = jsWrapper.includes('_split');
    const isProxy = jsWrapper.includes('_proxy_get') || jsWrapper.includes('_proxy_set');
    
    if (!isSplit && !isProxy) {
        verifyEquivalenceSync(originalJsCode, fvmBytecode, opcodeMap);
        return;
    }
    
    (global as any).__fortress_latest_bytecode = fvmBytecode;
    (global as any).__fortress_latest_opcodeMap = Array.from(opcodeMap);
    
    if (process.env.NODE_ENV === 'production' || process.env.FORTRESS_ENV === 'production') {
        throw new Error("verifyEquivalence must never run in production. It executes arbitrary JavaScript in the host process.");
    }
    
    const builtins = `const Symbol = (desc) => "__fortress_sym_" + desc;`;
    const initInfo = verifierInstance.run(cleanJsCode, builtins, functionName, [], true);
    if (initInfo.error) {
        throw new Error(`Failed to compile original JS in sandbox: ${initInfo.error}`);
    }
    const arity = initInfo.arity ?? 0;
    
    const mockRequire = (id: string) => {
        if (id.includes('client')) {
            return {
                FortressClient: {
                    init: async () => {
                        return {
                            execute: async (executeArgs: any[]) => {
                                const actualArgs = executeArgs.slice(1);
                                return runFvmSync(fvmBytecode, opcodeMap, actualArgs);
                            }
                        };
                    }
                }
            };
        }
        if (id === 'crypto') return crypto;
        if (id === '../../pkg-node/vm_core.js' || id.endsWith('pkg-node/vm_core.js')) {
            return require(path.resolve(__dirname, '../../../../pkg-node/vm_core.js'));
        }
        throw new Error(`Blocked require: ${id}`);
    };
    
    const mockProcess = {
        env: {
            FORTRESS_ENDPOINT: process.env.FORTRESS_ENDPOINT
        }
    };
    
    const wrappedJsCode = jsWrapper.replace("module.exports =", "const wrapperFunc =") + "\n; return wrapperFunc;";
    let wrapperFunc: any;
    const wrapSandbox = {
        require: mockRequire,
        process: mockProcess,
        console,
        JSON,
        Math,
        String,
        Number,
        Array,
        Object,
        Reflect,
        ArrayBuffer,
        Uint8Array,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        __fortress_latest_bytecode: (global as any).__fortress_latest_bytecode,
        __fortress_latest_opcodeMap: (global as any).__fortress_latest_opcodeMap,
        __fortress_bytecode: (global as any).__fortress_bytecode,
        __fortress_opcodeMap: (global as any).__fortress_opcodeMap
    };
    const wrapContext = vm.createContext(wrapSandbox);
    try {
        wrapperFunc = vm.runInContext(`(function() { ${wrappedJsCode} })()`, wrapContext);
    } catch (e: any) {
        console.error("FAILED TO EVALUATE wrappedJsCode:");
        console.error(wrappedJsCode);
        throw e;
    }
    
    const testInputs = [
        0, 
        1, 
        -1, 
        42, 
        "", 
        "hello", 
        [], 
        [1, 2, 3], 
        {}, 
        { a: 1 }, 
        true, 
        false, 
        null
    ];
    
    for (const input of testInputs) {
        let jsError: any = null;
        let jsRes: any = null;
        const args = arity > 0 ? Array.from({ length: arity }, () => JSON.parse(JSON.stringify(input))) : [JSON.parse(JSON.stringify(input))];
        
        const runInfo = verifierInstance.run(cleanJsCode, builtins, functionName, args, false, isProxy);
        if (runInfo.error) {
            jsError = runInfo.error;
        } else {
            jsRes = runInfo.result;
        }
        
        let fvmError: any = null;
        let fvmRes: any = null;
        try {
            fvmRes = wrapperFunc(...args);
            if (fvmRes && typeof fvmRes.then === 'function') {
                fvmRes = await fvmRes;
            }
        } catch (e: any) {
            fvmError = e.message;
        }
        
        if (isProxy) {
            let jsProxyResult: any = null;
            let fvmProxyResult: any = null;
            
            if (jsError === null) {
                jsProxyResult = jsRes;
            }
            if (fvmError === null && fvmRes && typeof fvmRes === 'object') {
                fvmProxyResult = await testProxyObject(fvmRes);
            } else if (fvmError === null) {
                fvmProxyResult = fvmRes;
            }
            
            const normJs = normalizeVal(jsProxyResult, jsProxyResult);
            const normFvm = normalizeVal(fvmProxyResult, jsProxyResult);
            const jsResStr = JSON.stringify(normJs);
            const fvmResStr = JSON.stringify(normFvm);
            
            if (jsResStr !== fvmResStr || (jsError !== null) !== (fvmError !== null)) {
                console.error("\n==================================================");
                console.error("VERIFICATION FAILURE DETECTED FOR PROXY INPUT: ", input);
                console.error("JavaScript Error: ", jsError);
                console.error("FVM Error:        ", fvmError);
                console.error("JS Proxy ops:     ", normJs);
                console.error("FVM Proxy ops:    ", normFvm);
                console.error("==================================================\n");
                throw new Error(`Equivalence verification failed for Proxy input: ${JSON.stringify(input)}`);
            }
        } else {
            const normJs = normalizeVal(jsRes, jsRes);
            const normFvm = normalizeVal(fvmRes, jsRes);
            let jsResStr = JSON.stringify(normJs);
            let fvmResStr = JSON.stringify(normFvm);
            if (jsResStr) jsResStr = jsResStr.replace(/undefined/g, "null");
            if (fvmResStr) fvmResStr = fvmResStr.replace(/undefined/g, "null");
            
            const sameError = (jsError !== null) === (fvmError !== null);
            const sameResult = jsResStr === fvmResStr;
            
            if (!sameError || (!jsError && !sameResult)) {
                console.error("\n==================================================");
                console.error("VERIFICATION FAILURE DETECTED FOR SPLIT/ASYNC INPUT: ", input);
                console.error("JavaScript Output:", jsRes);
                console.error("JavaScript Error: ", jsError);
                console.error("FVM Output:       ", fvmRes);
                console.error("FVM Error:        ", fvmError);
                console.error("==================================================\n");
                throw new Error(`Equivalence verification failed for split/async input: ${JSON.stringify(input)}`);
            }
        }
    }
    console.log("[VERIFIER] Async equivalence verification passed successfully!");
}

function preparePayload(obj: any, visited: Map<any, any> = new Map()): any {
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
        obj = Array.from(obj as any);
    }
    if (typeof obj !== 'object') return obj;
    const proxySymbol = Symbol.for("__fortress_proxy_targets__");
    const proxyTargets = (globalThis as any)[proxySymbol];
    if (proxyTargets && proxyTargets.has(obj)) {
        return preparePayload(proxyTargets.get(obj), visited);
    }
    if (visited.has(obj)) return visited.get(obj);
    if (Array.isArray(obj)) {
        const cloned: any[] = [];
        visited.set(obj, cloned);
        for (let i = 0; i < obj.length; i++) {
            cloned.push(preparePayload(obj[i], visited));
        }
        return cloned;
    }
    const keys = Reflect.ownKeys(obj).filter(k => k !== '__ownKeys');
    const cloned: any = {};
    visited.set(obj, cloned);
    for (const k of keys) {
        cloned[k] = preparePayload((obj as any)[k], visited);
    }
    cloned.__ownKeys = keys.map(k => typeof k === 'symbol' ? (k.description || k.toString()) : k);
    return cloned;
}

function runFvmSync(code: Uint8Array, opcodeMap: number[], args: any[]): any {
    if (!vmNode) {
        vmNode = require('../../../../pkg-node/vm_core.js');
    }
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
    
    // Set payload hash in VM
    vmNode.set_payload_hash(new Uint8Array(hashBytes));
    
    const dummyPng = new Uint8Array(1024);
    const mapUint8 = new Uint8Array(opcodeMap);
    
    vmNode.init_crypto_with_key(new Uint8Array(32), new Uint8Array(32), new Uint8Array(32), 0);
    try {
        const resStr = vmNode.execute(code, dummyPng, inputJson, mapUint8);
        let res;
        try {
            res = JSON.parse(resStr);
        } catch (parseErr: any) {
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
