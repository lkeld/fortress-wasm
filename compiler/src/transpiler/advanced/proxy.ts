import traverse from '@babel/traverse';
const t: any = require('@babel/types');
const generate: any = require('@babel/generator').default;
const parser: any = require('@babel/parser');
import { TranspileOptions, TranspileResult } from '../types';

export function transformProxy(
    ast: any,
    rootStmt: any,
    code: string,
    options: TranspileOptions,
    transpile: (code: string, options: TranspileOptions) => TranspileResult
): { transformed: boolean; result?: TranspileResult } {
    let hasProxy = false;
    let proxyGetNode: any = null;
    let proxySetNode: any = null;
    
    traverse(ast, {
        NewExpression(path: any) {
            if (t.isIdentifier(path.node.callee) && path.node.callee.name === 'Proxy') {
                hasProxy = true;
                const handler = path.node.arguments[1];
                let handlerObj: any = null;
                if (t.isObjectExpression(handler)) {
                    handlerObj = handler;
                } else if (t.isIdentifier(handler)) {
                    const binding = path.scope.getBinding(handler.name);
                    if (binding && t.isVariableDeclarator(binding.path.node) && binding.path.node.init && t.isObjectExpression(binding.path.node.init)) {
                        handlerObj = binding.path.node.init;
                    }
                }
                
                if (handlerObj) {
                    for (const prop of handlerObj.properties) {
                        if (t.isObjectMethod(prop) || t.isObjectProperty(prop)) {
                            const name = t.isIdentifier(prop.key) ? prop.key.name : (t.isStringLiteral(prop.key) ? prop.key.value : null);
                            if (name === 'get') {
                                proxyGetNode = prop;
                            } else if (name === 'set') {
                                proxySetNode = prop;
                            }
                        }
                    }
                }
                path.stop();
            }
        }
    });

    if (hasProxy && t.isFunctionDeclaration(rootStmt)) {
        const extraDecls: any[] = [];
        if (proxyGetNode) {
            let params: any[] = [];
            let body: any = null;
            if (t.isObjectMethod(proxyGetNode)) {
                params = proxyGetNode.params;
                body = proxyGetNode.body;
            } else if (t.isObjectProperty(proxyGetNode)) {
                const val = proxyGetNode.value;
                if (t.isFunctionExpression(val) || t.isArrowFunctionExpression(val)) {
                    params = val.params;
                    body = t.isBlockStatement(val.body) ? val.body : t.blockStatement([t.returnStatement(val.body)]);
                }
            }
            if (body) {
                extraDecls.push(t.functionDeclaration(
                    t.identifier(`${options.functionName}_proxy_get`),
                    params.map((p: any) => t.isIdentifier(p) ? t.identifier(p.name) : p),
                    body
                ));
            }
        }
        
        if (proxySetNode) {
            let params: any[] = [];
            let body: any = null;
            if (t.isObjectMethod(proxySetNode)) {
                params = proxySetNode.params;
                body = proxySetNode.body;
            } else if (t.isObjectProperty(proxySetNode)) {
                const val = proxySetNode.value;
                if (t.isFunctionExpression(val) || t.isArrowFunctionExpression(val)) {
                    params = val.params;
                    body = t.isBlockStatement(val.body) ? val.body : t.blockStatement([t.returnStatement(val.body)]);
                }
            }
            if (body) {
                extraDecls.push(t.functionDeclaration(
                    t.identifier(`${options.functionName}_proxy_set`),
                    params.map((p: any) => t.isIdentifier(p) ? t.identifier(p.name) : p),
                    body
                ));
            }
        }

        const fvmAst = t.file(t.program([t.cloneNode(rootStmt)]));
        const dispatcherBody: any[] = [];
        if (proxyGetNode) {
            dispatcherBody.push(
                t.ifStatement(
                    t.binaryExpression("==", t.identifier("action"), t.stringLiteral(`${options.functionName}_proxy_get`)),
                    t.blockStatement([
                        t.returnStatement(
                            t.callExpression(
                                t.identifier(`${options.functionName}_proxy_get`),
                                [t.identifier("arg0"), t.identifier("arg1")]
                            )
                        )
                    ])
                )
            );
        }
        if (proxySetNode) {
            dispatcherBody.push(
                t.ifStatement(
                    t.binaryExpression("==", t.identifier("action"), t.stringLiteral(`${options.functionName}_proxy_set`)),
                    t.blockStatement([
                        t.returnStatement(
                            t.callExpression(
                                t.identifier(`${options.functionName}_proxy_set`),
                                [t.identifier("arg0"), t.identifier("arg1"), t.identifier("arg2")]
                            )
                        )
                    ])
                )
            );
        }
        const entryFunc = fvmAst.program.body[0] as any;
        entryFunc.params = [t.identifier("action"), t.identifier("arg0"), t.identifier("arg1"), t.identifier("arg2")];
        entryFunc.body = t.blockStatement(dispatcherBody);
        fvmAst.program.body.push(...extraDecls);
        
        traverse(fvmAst, {
            ThrowStatement(p: any) {
                let errClass = "TypeError";
                let msg = "";
                const arg = p.node.argument;
                if (arg && t.isNewExpression(arg) && t.isIdentifier(arg.callee)) {
                    errClass = arg.callee.name;
                    if (arg.arguments.length > 0) {
                        const firstArg = arg.arguments[0];
                        if (t.isStringLiteral(firstArg)) {
                            msg = firstArg.value;
                        } else {
                            msg = generate(firstArg).code;
                        }
                    }
                } else if (arg) {
                    if (t.isStringLiteral(arg)) {
                        msg = arg.value;
                    } else {
                        msg = generate(arg).code;
                    }
                }
                p.replaceWith(t.returnStatement(t.stringLiteral("__fortress_error__:" + errClass + ":" + msg)));
            }
        });

        const fvmCodeStr = generate(fvmAst, { jsescOption: { quotes: 'double' } }).code;
        const fvmTranspileRes = transpile(fvmCodeStr, {
            ...options,
            verifyEquivalence: false
        });
        
        const jsAst = t.file(t.program([t.cloneNode(rootStmt)]));
        traverse(jsAst, {
            NewExpression(p: any) {
                if (t.isIdentifier(p.node.callee) && p.node.callee.name === 'Proxy') {
                    const target = p.node.arguments[0];
                    const targetCode = generate(target).code;
                    
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
                    
                    p.replaceWith(parser.parseExpression(`(() => {
                        const ERROR_CONSTRUCTORS = {
                            TypeError: TypeError,
                            RangeError: RangeError,
                            ReferenceError: ReferenceError,
                            SyntaxError: SyntaxError,
                            URIError: URIError,
                            EvalError: EvalError,
                            Error: Error
                        };
                        const proxySymbol = Symbol.for("__fortress_proxy_targets__");
                        if (!globalThis[proxySymbol]) {
                            globalThis[proxySymbol] = new WeakMap();
                        }
                        const proxyTargets = globalThis[proxySymbol];
                        let inside = false;
                        const __fortress_target = ${targetCode};
                        const px = new Proxy(__fortress_target, {
                            get(t, prop) {
                                ${getTrap}
                            },
                            set(t, prop, value) {
                                ${setTrap}
                            }
                        });
                        proxyTargets.set(px, __fortress_target);
                        return px;
                    })()`));
                    p.skip();
                }
            }
        });
        
        const rewrittenFuncCode = generate(jsAst.program.body[0]).code;
        const { emitProxyWrapper } = require('../emit/wrapper-emitter');
        const hasSharedArrayBuffer = code.includes('SharedArrayBuffer') || code.includes('Int8Array') || code.includes('Uint8Array') || code.includes('Int32Array'); // simple heuristic
        const jsWrapper = emitProxyWrapper(
            options,
            rewrittenFuncCode,
            proxyGetNode,
            proxySetNode,
            hasSharedArrayBuffer
        );
        
        const tsDeclaration = `export function ${options.functionName}(...args: any[]): any;`;
        return {
            transformed: true,
            result: {
                fvmSource: fvmTranspileRes.fvmSource,
                jsWrapper,
                tsDeclaration,
                usedStdlib: fvmTranspileRes.usedStdlib,
                warnings: fvmTranspileRes.warnings,
                asyncSplit: null
            }
        };
    }

    return { transformed: false };
}
