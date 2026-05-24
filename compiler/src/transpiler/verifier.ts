import * as vm from 'vm';

/**
 * RISK LEVELS & SANDBOX MODES:
 * 
 * Mode A: isolated-vm (High Security)
 * - Risk Level: Low.
 * - Description: Code runs in a completely separate V8 isolate with no access to the Node.js runtime,
 *   filesystem, network, or any host globals (like `process` or `require`). Memory and execution time
 *   are strictly bounded.
 * - Recommendation: Use in all environments where untrusted user input can trigger equivalence verification.
 * 
 * Mode B: Node.js vm Module (Medium Risk)
 * - Risk Level: High.
 * - Description: Code runs in a Node.js VM context. While host globals are restricted, V8 VM contexts in
 *   Node.js are not a robust security sandbox. Sophisticated payloads can escape the context to execute
 *   arbitrary code in the main Node.js process (e.g., via prototype pollution or constructor access).
 * - Warning: NEVER use Mode B with untrusted user input. A warning is logged when falling back to this mode.
 */
class IsolatedVerifier {
    private ivm: any = null;
    private hasIvm = false;

    constructor() {
        try {
            // Dynamically require isolated-vm to support optional dependency pattern
            this.ivm = require('isolated-vm');
            this.hasIvm = true;
        } catch (e) {
            console.warn(
                "[WARNING] 'isolated-vm' is not installed. Falling back to Node.js built-in 'vm' module.\n" +
                "RISK WARNING: The built-in 'vm' module does not provide a secure sandbox. " +
                "Executing untrusted code can lead to Remote Code Execution (RCE) on the host system."
            );
        }
    }

    public run(
        cleanJsCode: string,
        builtins: string,
        functionName: string,
        args: any[],
        isGeneratorCheck: boolean = false,
        isProxyCheck: boolean = false
    ): { result?: any; error?: string; arity?: number; isGenerator?: boolean } {
        if (this.hasIvm) {
            try {
                return this.runIsolated(cleanJsCode, builtins, functionName, args, isGeneratorCheck, isProxyCheck);
            } catch (e: any) {
                return { error: e.message || String(e) };
            }
        } else {
            return this.runNodeVm(cleanJsCode, builtins, functionName, args, isGeneratorCheck, isProxyCheck);
        }
    }

    private runIsolated(
        cleanJsCode: string,
        builtins: string,
        functionName: string,
        args: any[],
        isGeneratorCheck: boolean,
        isProxyCheck: boolean
    ): { result?: any; error?: string; arity?: number; isGenerator?: boolean } {
        const isolate = new this.ivm.Isolate({ memoryLimit: 128 });
        try {
            const context = isolate.createContextSync();
            const jail = context.global;
            
            const argsJson = JSON.stringify(args);
            jail.setSync('_argsJson', argsJson);
            
            const runScript = `
                (function() {
                    const _args = JSON.parse(_argsJson);
                    ${builtins}
                    
                    function preSerialize(val, visited = new Set()) {
                        if (val === undefined) return null;
                        if (val === null) return null;
                        if (typeof val === 'object' || typeof val === 'function') {
                            if (visited.has(val)) return '[Circular]';
                            visited.add(val);
                        }
                        if (typeof val === 'symbol') {
                            return 'Symbol(' + (val.description || '') + ')';
                        }
                        if (typeof SharedArrayBuffer !== 'undefined' && val instanceof SharedArrayBuffer) {
                            return {
                                __is_sab: true,
                                buffer: Array.from(new Uint8Array(val))
                            };
                        }
                        if (ArrayBuffer.isView(val)) {
                            const copy = {
                                __elementSize: val.BYTES_PER_ELEMENT,
                                length: val.length
                            };
                            for (let i = 0; i < val.length; i++) {
                                copy[i] = val[i];
                            }
                            if (typeof SharedArrayBuffer !== 'undefined' && val.buffer instanceof SharedArrayBuffer) {
                                copy.__sab = preSerialize(val.buffer, visited);
                            }
                            return copy;
                        }
                        if (Array.isArray(val)) {
                            return val.map(item => preSerialize(item, visited));
                        }
                        if (typeof val === 'object') {
                            const copy = {};
                            const keys = Reflect.ownKeys(val);
                            for (const k of keys) {
                                const keyStr = typeof k === 'symbol' ? 'Symbol(' + (k.description || '') + ')' : String(k);
                                copy[keyStr] = preSerialize(val[k], visited);
                            }
                            return copy;
                        }
                        return val;
                    }
                    
                    function testProxyObjectSync(obj) {
                        const results = {};
                        const propsToTest = ['a', 'b', 'private', 'foo', 'x', 'y'];
                        for (const prop of propsToTest) {
                            try {
                                results['get_' + prop] = obj[prop];
                            } catch (e) {
                                results['get_' + prop + '_error'] = e.name || e.message;
                            }

                            try {
                                results['reflect_get_' + prop] = Reflect.get(obj, prop);
                            } catch (e) {
                                results['reflect_get_' + prop + '_error'] = e.name || e.message;
                            }

                            try {
                                results['reflect_has_' + prop] = Reflect.has(obj, prop);
                            } catch (e) {
                                results['reflect_has_' + prop + '_error'] = e.name || e.message;
                            }
                        }
                        const valsToTest = [10, 'string', false];
                        for (const prop of ['a', 'value']) {
                            for (const val of valsToTest) {
                                try {
                                    obj[prop] = val;
                                    results['set_' + prop + '_' + (typeof val)] = obj[prop];
                                } catch (e) {
                                    results['set_' + prop + '_' + (typeof val) + '_error'] = e.name || e.message;
                                }

                                try {
                                    const setRes = Reflect.set(obj, prop, val);
                                    results['reflect_set_' + prop + '_' + (typeof val)] = setRes;
                                } catch (e) {
                                    results['reflect_set_' + prop + '_' + (typeof val) + '_error'] = e.name || e.message;
                                }
                            }
                        }

                        try {
                            results['reflect_ownKeys'] = Reflect.ownKeys(obj);
                        } catch (e) {
                            results['reflect_ownKeys_error'] = e.name || e.message;
                        }

                        return results;
                    }

                    let fn;
                    try {
                        fn = (${cleanJsCode});
                    } catch (e) {
                        ${cleanJsCode}
                        fn = typeof ${functionName} !== 'undefined' ? ${functionName} : undefined;
                    }
                    if (!fn) {
                        throw new Error("Could not find function: " + "${functionName}");
                    }
                    
                    const isGen = fn.constructor.name === 'GeneratorFunction' || fn.toString().includes('function*');
                    const arity = fn.length;
                    
                    if (${isGeneratorCheck}) {
                        return JSON.stringify({ arity, isGenerator: isGen });
                    }
                    
                    if (isGen) {
                        const iterator = fn(..._args);
                        const vals = [];
                        let next = iterator.next();
                        while (!next.done) {
                            vals.push(next.value);
                            next = iterator.next();
                        }
                        return JSON.stringify({ result: vals });
                    } else {
                        const result = fn(..._args);
                        if (${isProxyCheck} && result !== null && typeof result === 'object') {
                            return JSON.stringify({ result: preSerialize(testProxyObjectSync(result)) });
                        } else {
                            return JSON.stringify({ result: preSerialize(result) });
                        }
                    }
                })()
            `;
            
            const script = isolate.compileScriptSync(runScript);
            const rawRes = script.runSync(context, { timeout: 5000 });
            return JSON.parse(rawRes);
        } finally {
            isolate.dispose();
        }
    }

    private runNodeVm(
        cleanJsCode: string,
        builtins: string,
        functionName: string,
        args: any[],
        isGeneratorCheck: boolean,
        isProxyCheck: boolean
    ): { result?: any; error?: string; arity?: number; isGenerator?: boolean } {
        const sandbox = Object.create(null);
        sandbox.console = console;
        sandbox.Math = Math;
        sandbox.JSON = JSON;
        sandbox._argsJson = JSON.stringify(args);
        
        const context = vm.createContext(sandbox);
        const runScript = `
            (function() {
                const _args = JSON.parse(_argsJson);
                ${builtins}
                
                function preSerialize(val, visited = new Set()) {
                    if (val === undefined) return null;
                    if (val === null) return null;
                    if (typeof val === 'object' || typeof val === 'function') {
                        if (visited.has(val)) return '[Circular]';
                        visited.add(val);
                    }
                    if (typeof val === 'symbol') {
                        return 'Symbol(' + (val.description || '') + ')';
                    }
                    if (typeof SharedArrayBuffer !== 'undefined' && val instanceof SharedArrayBuffer) {
                        return {
                            __is_sab: true,
                            buffer: Array.from(new Uint8Array(val))
                        };
                    }
                    if (ArrayBuffer.isView(val)) {
                        const copy = {
                            __elementSize: val.BYTES_PER_ELEMENT,
                            length: val.length
                        };
                        for (let i = 0; i < val.length; i++) {
                            copy[i] = val[i];
                        }
                        if (typeof SharedArrayBuffer !== 'undefined' && val.buffer instanceof SharedArrayBuffer) {
                            copy.__sab = preSerialize(val.buffer, visited);
                        }
                        return copy;
                    }
                    if (Array.isArray(val)) {
                        return val.map(item => preSerialize(item, visited));
                    }
                    if (typeof val === 'object') {
                        const copy = {};
                        const keys = Reflect.ownKeys(val);
                        for (const k of keys) {
                            const keyStr = typeof k === 'symbol' ? 'Symbol(' + (k.description || '') + ')' : String(k);
                            copy[keyStr] = preSerialize(val[k], visited);
                        }
                        return copy;
                    }
                    return val;
                }
                
                function testProxyObjectSync(obj) {
                    const results = {};
                    const propsToTest = ['a', 'b', 'private', 'foo', 'x', 'y'];
                    for (const prop of propsToTest) {
                        try {
                            results['get_' + prop] = obj[prop];
                        } catch (e) {
                            results['get_' + prop + '_error'] = e.name || e.message;
                        }

                        try {
                            results['reflect_get_' + prop] = Reflect.get(obj, prop);
                        } catch (e) {
                            results['reflect_get_' + prop + '_error'] = e.name || e.message;
                        }

                        try {
                            results['reflect_has_' + prop] = Reflect.has(obj, prop);
                        } catch (e) {
                            results['reflect_has_' + prop + '_error'] = e.name || e.message;
                        }
                    }
                    const valsToTest = [10, 'string', false];
                    for (const prop of ['a', 'value']) {
                        for (const val of valsToTest) {
                            try {
                                obj[prop] = val;
                                results['set_' + prop + '_' + (typeof val)] = obj[prop];
                            } catch (e) {
                                results['set_' + prop + '_' + (typeof val) + '_error'] = e.name || e.message;
                            }

                            try {
                                const setRes = Reflect.set(obj, prop, val);
                                results['reflect_set_' + prop + '_' + (typeof val)] = setRes;
                            } catch (e) {
                                results['reflect_set_' + prop + '_' + (typeof val) + '_error'] = e.name || e.message;
                            }
                        }
                    }

                    try {
                        results['reflect_ownKeys'] = Reflect.ownKeys(obj);
                    } catch (e) {
                        results['reflect_ownKeys_error'] = e.name || e.message;
                    }

                    return results;
                }
                
                let fn;
                try {
                    fn = (${cleanJsCode});
                } catch (e) {
                    ${cleanJsCode}
                    fn = typeof ${functionName} !== 'undefined' ? ${functionName} : undefined;
                }
                if (!fn) {
                    throw new Error("Could not find function: " + "${functionName}");
                }
                
                const isGen = fn.constructor.name === 'GeneratorFunction' || fn.toString().includes('function*');
                const arity = fn.length;
                
                if (${isGeneratorCheck}) {
                    return JSON.stringify({ arity, isGenerator: isGen });
                }
                
                if (isGen) {
                    const iterator = fn(..._args);
                    const vals = [];
                    let next = iterator.next();
                    while (!next.done) {
                        vals.push(next.value);
                        next = iterator.next();
                    }
                    return JSON.stringify({ result: vals });
                } else {
                    const result = fn(..._args);
                    if (${isProxyCheck} && result !== null && typeof result === 'object') {
                        return JSON.stringify({ result: preSerialize(testProxyObjectSync(result)) });
                    } else {
                        return JSON.stringify({ result: preSerialize(result) });
                    }
                }
            })()
        `;
        try {
            const res = vm.runInContext(runScript, context, { timeout: 5000 });
            return JSON.parse(res);
        } catch (e: any) {
            return { error: e.message || String(e) };
        }
    }
}

export const verifierInstance = new IsolatedVerifier();

export { verifyEquivalenceSync, verifyEquivalence } from './verification/equivalence';
