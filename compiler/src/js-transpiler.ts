import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as vm from 'vm';

const parser: any = require('@babel/parser');
const traverse: any = require('@babel/traverse').default;
const generate: any = require('@babel/generator').default;
const t: any = require('@babel/types');

const vmNode = require('../../pkg-node/vm_core.js');

const fortressProxies = new WeakSet();
const fortressProxyTargets = new WeakMap();

export interface TranspileOptions {
    functionName: string;
    filePath: string;
    verifyEquivalence: boolean;
}

export interface TranspileWarning {
    line: number;
    message: string;
    suggestion: string;
}

export interface AsyncSplitInfo {
    boundaryCount: number;
    variablesPassed: string[];
}

export interface TranspileResult {
    fvmSource: string;        // temporary - deleted after compilation, never persisted
    jsWrapper: string;        // replaces the original function
    tsDeclaration: string;    // .d.ts file
    usedStdlib: string[];     // which stdlib functions to emit
    warnings: TranspileWarning[];
    asyncSplit: AsyncSplitInfo | null;
}

export function transpile(code: string, options: TranspileOptions): TranspileResult {
    const warnings: TranspileWarning[] = [];
    const usedStdlibSet = new Set<string>();
    let mergesortCounter = 0;
    const extraDeclarations: string[] = [];
    const activeFuncNodes: any[] = [];
    let isGeneratorFlag = false;
    const packedFunctions = new Map<string, string[]>();
    const extraFuncNodes: any[] = [];

    // Check RegExp Safety
    function checkRegExpSafety(pattern: string, line: number) {
        if (/\(\?[=!<>].*\)/.test(pattern)) {
            warnings.push({
                line,
                message: `RegExp pattern "${pattern}" contains lookarounds. Ensure fancy-regex compatibility.`,
                suggestion: "Avoid lookarounds if possible for better performance."
            });
        }
        if (/(\+.*\+)|(\*.*\*)|(\+.*\*)|(\*.*\+)/.test(pattern) || /(\(.*\)[+*]\??){2,}/.test(pattern)) {
            warnings.push({
                line,
                message: `RegExp pattern "${pattern}" is potentially vulnerable to catastrophic backtracking (ReDoS).`,
                suggestion: "Rewrite the regular expression to avoid nested quantifiers."
            });
        }
    }

    // Helper for replacing identifiers
    function replaceIdentifier(node: any, oldName: string, newName: string) {
        const dummyFile = t.file(t.program([t.expressionStatement(node)]));
        traverse(dummyFile, {
            noScope: true,
            Identifier(path: any) {
                if (path.node.name === oldName) {
                    // Avoid replacing member expression property if it's not computed (e.g. obj.oldName)
                    if (path.parentPath.isMemberExpression({ property: path.node, computed: false })) {
                        return;
                    }
                    path.node.name = newName;
                }
            }
        });
    }

    // Helper for replacing ReturnStatement
    function traverseReplaceReturns(node: any, resultVar: any) {
        const dummyFile = t.file(t.program([node]));
        traverse(dummyFile, {
            noScope: true,
            ReturnStatement(path: any) {
                const val = path.node.argument || t.nullLiteral();
                path.replaceWith(t.expressionStatement(t.assignmentExpression("=", resultVar, val)));
            }
        });
    }

    // Parse JS code
    const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: [
            'typescript',
            'decorators-legacy',
            'classProperties',
            'classPrivateProperties',
            'classPrivateMethods',
        ]
    });

    const rootStmt = ast.program.body[0];

    let originalParamNames: string[] = [];
    if (rootStmt && (t.isFunctionDeclaration(rootStmt) || t.isFunctionExpression(rootStmt) || t.isArrowFunctionExpression(rootStmt))) {
        originalParamNames = rootStmt.params.map((p: any) => p.name);
    }

    let hasSharedArrayBuffer = false;
    const typedArrays = new Set([
        'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 
        'Int16Array', 'Uint16Array', 
        'Int32Array', 'Uint32Array', 
        'Float32Array', 'Float64Array'
    ]);

    // Detect SharedArrayBuffer / TypedArrays and Atomics
    traverse(ast, {
        Identifier(path: any) {
            const name = path.node.name;
            if (name === 'Atomics') {
                throw new TypeError("Atomics is not supported");
            }
            if (name === 'SharedArrayBuffer' || typedArrays.has(name)) {
                hasSharedArrayBuffer = true;
            }
            // Check for collision with FVM internal/reserved prefixes
            if (name.startsWith('__reg_') || 
                name.startsWith('__scope') || 
                name.startsWith('__state') || 
                name.startsWith('__gen_temp_') || 
                name.startsWith('__call_closure_') || 
                name === '__args' || 
                (name.startsWith('__fortress_') && 
                 name !== '__fortress_latest_bytecode' && 
                 name !== '__fortress_latest_opcodeMap' && 
                 name !== '__fortress_bytecode' && 
                 name !== '__fortress_opcodeMap' && 
                 name !== '__fortress_error__')) {
                throw new Error(`Reserved identifier name "${name}". User-defined variables, parameters, or functions must not use compiler-reserved prefixes.`);
            }
        },
        ConditionalExpression(path: any) {
            throw new Error("Ternary operator (ConditionalExpression) is not supported");
        }
    });

    if (hasSharedArrayBuffer) {
        extraDeclarations.push(`
function SharedArrayBuffer_new(size) {
    let arr = [];
    let i = 0;
    while (i < size) {
        arr = listPush(arr, 0);
        i = i + 1;
    }
    return { __is_sab: true, buffer: arr, views: [] };
}
function TypedArray_new(arg, elementSize) {
    let view = {};
    view.__elementSize = elementSize;
    view.__ownKeys = ["length", "__elementSize"];
    
    if (TypeOf(arg) == "number") {
        view.length = arg;
        let i = 0;
        while (i < arg) {
            view[i] = 0;
            view.__ownKeys = listPush(view.__ownKeys, i);
            i = i + 1;
        }
        return view;
    }
    
    if (TypeOf(arg) == "object") {
        if (arg != null) {
            if (arg.__is_sab) {
                view.__sab = arg;
                view.__ownKeys = listPush(view.__ownKeys, "__sab");
                let byteLen = len(arg.buffer);
                let viewLen = MathFloor(byteLen / elementSize);
                view.length = viewLen;
                
                // Initialize elements from the shared buffer
                let i = 0;
                while (i < viewLen) {
                    let val = 0;
                    if (elementSize == 1) {
                        val = arg.buffer[i];
                    } else {
                        if (elementSize == 2) {
                            val = arg.buffer[i * 2] + arg.buffer[i * 2 + 1] * 256;
                        } else {
                            if (elementSize == 4) {
                                val = arg.buffer[i * 4] + arg.buffer[i * 4 + 1] * 256 + arg.buffer[i * 4 + 2] * 65536 + arg.buffer[i * 4 + 3] * 16777216;
                            } else {
                                val = arg.buffer[i * elementSize];
                            }
                        }
                    }
                    view[i] = val;
                    view.__ownKeys = listPush(view.__ownKeys, i);
                    i = i + 1;
                }
                
                // Add this view to the SharedArrayBuffer's views list
                if (arg.views == null) {
                    arg.views = [];
                }
                arg.views = listPush(arg.views, view);
                return view;
            }
        }
        
        // Copying from another object/list
        let sz = arg.length;
        if (sz == null) {
            sz = len(arg);
        }
        view.length = sz;
        let i = 0;
        while (i < sz) {
            view[i] = arg[i];
            view.__ownKeys = listPush(view.__ownKeys, i);
            i = i + 1;
        }
        return view;
    }
    
    let isArr = false;
    if (TypeOf(arg) == "array") { isArr = true; }
    if (TypeOf(arg) == "list") { isArr = true; }
    if (isArr) {
        let sz = len(arg);
        view.length = sz;
        let i = 0;
        while (i < sz) {
            view[i] = arg[i];
            view.__ownKeys = listPush(view.__ownKeys, i);
            i = i + 1;
        }
        return view;
    }
    
    view.length = 0;
    return view;
}
function Int8Array_new(arg) { return TypedArray_new(arg, 1); }
function Uint8Array_new(arg) { return TypedArray_new(arg, 1); }
function Uint8ClampedArray_new(arg) { return TypedArray_new(arg, 1); }
function Int16Array_new(arg) { return TypedArray_new(arg, 2); }
function Uint16Array_new(arg) { return TypedArray_new(arg, 2); }
function Int32Array_new(arg) { return TypedArray_new(arg, 4); }
function Uint32Array_new(arg) { return TypedArray_new(arg, 4); }
function Float32Array_new(arg) { return TypedArray_new(arg, 4); }
function Float64Array_new(arg) { return TypedArray_new(arg, 8); }
        `);
    }

    // Helper to find a split point statement index where the intersection of variables written/declared in Part A and read in Part B is empty
    function findSplitPoint(body: any[], params: any[]): number {
        const writes: Set<string>[] = [];
        const reads: Set<string>[] = [];

        for (let i = 0; i < body.length; i++) {
            const w = new Set<string>();
            const r = new Set<string>();

            const stmtFile = t.file(t.program([body[i]]));
            traverse(stmtFile, {
                noScope: true,
                VariableDeclarator(path: any) {
                    if (t.isIdentifier(path.node.id)) {
                        w.add(path.node.id.name);
                    }
                },
                AssignmentExpression(path: any) {
                    const left = path.node.left;
                    if (t.isIdentifier(left)) {
                        w.add(left.name);
                    } else {
                        traverse(t.file(t.program([t.expressionStatement(left)])), {
                            noScope: true,
                            Identifier(idPath: any) {
                                w.add(idPath.node.name);
                            }
                        });
                    }
                },
                UpdateExpression(path: any) {
                    if (t.isIdentifier(path.node.argument)) {
                        w.add(path.node.argument.name);
                    }
                },
                Identifier(path: any) {
                    if (path.isReferencedIdentifier()) {
                        r.add(path.node.name);
                    }
                }
            });
            writes.push(w);
            reads.push(r);
        }

        const suffixReads: Set<string>[] = [];
        for (let i = 0; i < body.length; i++) {
            suffixReads.push(new Set<string>());
        }

        const currentSuffix = new Set<string>();
        for (let i = body.length - 1; i >= 0; i--) {
            for (const v of reads[i]) {
                currentSuffix.add(v);
            }
            suffixReads[i] = new Set<string>(currentSuffix);
        }

        const prefixWrites = new Set<string>();
        for (const p of params) {
            if (t.isIdentifier(p)) {
                prefixWrites.add(p.name);
            }
        }

        for (let k = 0; k < body.length - 1; k++) {
            for (const v of writes[k]) {
                prefixWrites.add(v);
            }

            const nextReads = suffixReads[k + 1];
            let hasIntersection = false;
            if (prefixWrites.size < nextReads.size) {
                for (const v of prefixWrites) {
                    if (nextReads.has(v)) {
                        hasIntersection = true;
                        break;
                    }
                }
            } else {
                for (const v of nextReads) {
                    if (prefixWrites.has(v)) {
                        hasIntersection = true;
                        break;
                    }
                }
            }

            if (!hasIntersection) {
                return k;
            }
        }
        return -1;
    }

    // Helper to wrap return statements in a sub-part function
    function wrapReturns(body: any[]) {
        const file = t.file(t.program(body));
        traverse(file, {
            noScope: true,
            Function(path: any) {
                path.skip();
            },
            ReturnStatement(path: any) {
                const arg = path.node.argument || t.nullLiteral();
                path.replaceWith(t.returnStatement(
                    t.objectExpression([
                        t.objectProperty(t.identifier("returned"), t.booleanLiteral(true)),
                        t.objectProperty(t.identifier("value"), arg)
                    ])
                ));
                path.skip();
            }
        });
    }

    function deconflictScopes(funcNode: any) {
        const dummyFile = t.file(t.program([funcNode]));
        let mainScope: any = null;
        traverse(dummyFile, {
            FunctionDeclaration(path: any) {
                if (path.node === funcNode) {
                    mainScope = path.scope;
                }
            }
        });
        if (!mainScope) return;

        let counter = 0;
        traverse(dummyFile, {
            Scope(path: any) {
                if (path.scope === mainScope) {
                    return;
                }
                let parent = path.scope.parent;
                let isNested = false;
                while (parent) {
                    if (parent === mainScope) {
                        isNested = true;
                        break;
                    }
                    parent = parent.parent;
                }
                if (!isNested) return;

                const bindings = path.scope.bindings;
                for (const name of Object.keys(bindings)) {
                    counter++;
                    const newName = `${name}_b${counter}`;
                    path.scope.rename(name, newName);
                }
            }
        });
    }

    function renameShadowedVariables(funcNode: any) {
        const fileNode = t.file(t.program([funcNode]));
        traverse(fileNode, {
            VariableDeclarator(path: any) {
                const id = path.node.id;
                if (t.isIdentifier(id)) {
                    const name = id.name;
                    let scope = path.scope.parent;
                    let shadows = false;
                    while (scope) {
                        if (scope.hasOwnBinding(name)) {
                            shadows = true;
                            break;
                        }
                        if (scope.path.isFunction()) {
                            break;
                        }
                        scope = scope.parent;
                    }
                    if (shadows) {
                        const newName = path.scope.generateUid(name);
                        path.scope.rename(name, newName);
                    }
                }
            }
        });
    }

    // Helper for Register Banking
    function applyRegisterBanking(funcNode: any, depth = 0) {
        if (!t.isFunctionDeclaration(funcNode)) return;

        if (!activeFuncNodes.includes(funcNode)) {
            activeFuncNodes.push(funcNode);
        }

        // Run scope-safe renaming pre-pass to prevent leakage & shadowing
        deconflictScopes(funcNode);

        // Pack parameters into a single __args object if > 2 parameters (excluding entry function)
        if (funcNode.params.length > 2 && funcNode.id.name !== options.functionName) {
            const originalParams = funcNode.params.map((p: any) => p.name);
            const fileNode = t.file(t.program([funcNode]));
            traverse(fileNode, {
                Identifier(path: any) {
                    const name = path.node.name;
                    if (originalParams.includes(name)) {
                        const binding = path.scope.getBinding(name);
                        if (binding && binding.scope === path.scope.getFunctionParent()) {
                            if (path.parentPath.isMemberExpression({ property: path.node, computed: false })) {
                                return;
                            }
                            if (path.parentPath.isObjectProperty({ key: path.node, computed: false })) {
                                return;
                            }
                            path.replaceWith(t.memberExpression(t.identifier("__args"), t.identifier(name)));
                            path.skip();
                        }
                    }
                }
            });
            funcNode.params = [t.identifier("__args")];

            // Rewrite call sites in all active function nodes
            packedFunctions.set(funcNode.id.name, originalParams);
        }

        const params = funcNode.params.map((p: any) => p.name);
        const localVars = new Set<string>();
        traverse(t.file(t.program([t.cloneNode(funcNode.body)])), {
            noScope: true,
            VariableDeclarator(path: any) {
                if (t.isIdentifier(path.node.id)) {
                    localVars.add(path.node.id.name);
                }
            }
        });
        const allVars = [...params, ...localVars];

        if (allVars.length <= 240) {
            return;
        }

        const first_idx: { [key: string]: number } = {};
        const last_idx: { [key: string]: number } = {};

        for (const p of params) {
            first_idx[p] = -1;
            last_idx[p] = -1;
        }

        const body = funcNode.body.body;
        for (let i = 0; i < body.length; i++) {
            const stmt = body[i];
            traverse(t.file(t.program([stmt])), {
                noScope: true,
                Identifier(path: any) {
                    const name = path.node.name;
                    if (localVars.has(name) || params.includes(name)) {
                        if (first_idx[name] === undefined) {
                            first_idx[name] = i;
                        }
                        last_idx[name] = i;
                    }
                }
            });
        }

        const regAssignment: { [key: string]: string } = {};
        const regAssignmentColors: { [key: string]: number } = {};
        const regNames = new Set<string>();

        const sortedLocals = Array.from(localVars).sort();
        for (const v of sortedLocals) {
            const vFirst = first_idx[v] ?? -1;
            const vLast = last_idx[v] ?? -1;

            const conflictedColors = new Set<number>();
            for (const u of sortedLocals) {
                if (u === v || regAssignmentColors[u] === undefined) continue;
                const uFirst = first_idx[u] ?? -1;
                const uLast = last_idx[u] ?? -1;

                if (Math.max(vFirst, uFirst) <= Math.min(vLast, uLast)) {
                    conflictedColors.add(regAssignmentColors[u]);
                }
            }

            let color = 0;
            while (conflictedColors.has(color)) {
                color++;
            }

            const regName = `__reg_${color}`;
            regAssignment[v] = regName;
            regAssignmentColors[v] = color;
            regNames.add(regName);
        }

        if (regNames.size + params.length > 240 && funcNode.body.body.length > 1) {
            let splitIndex = -1;
            for (let i = 0; i < body.length; i++) {
                const activeVars = allVars.filter(v => first_idx[v] !== undefined && first_idx[v] <= i);
                if (activeVars.length > 240) {
                    splitIndex = i;
                    break;
                }
            }
            if (splitIndex <= 0 || splitIndex >= body.length) {
                splitIndex = Math.floor(body.length / 2);
            }

            const part1Name = `${funcNode.id.name}_part1`;
            const part2Name = `${funcNode.id.name}_part2`;

            const liveVars: string[] = [];
            for (const v of allVars) {
                if (params.includes(v)) continue;
                const isDeclaredOrWrittenIn1 = (first_idx[v] !== undefined && first_idx[v] < splitIndex);
                const isReadIn2 = (last_idx[v] !== undefined && last_idx[v] >= splitIndex);
                if (isDeclaredOrWrittenIn1 && isReadIn2) {
                    liveVars.push(v);
                }
            }
            liveVars.sort();

            const part1Body = body.slice(0, splitIndex);
            wrapReturns(part1Body);
            part1Body.push(t.returnStatement(
                t.objectExpression([
                    t.objectProperty(t.identifier("returned"), t.booleanLiteral(false)),
                    t.objectProperty(t.identifier("value"), t.nullLiteral()),
                    t.objectProperty(t.identifier("liveVars"), t.objectExpression(
                        liveVars.map(v => t.objectProperty(t.identifier(v), t.identifier(v)))
                    ))
                ])
            ));

            const part2Body = body.slice(splitIndex);
            wrapReturns(part2Body);
            part2Body.push(t.returnStatement(
                t.objectExpression([
                    t.objectProperty(t.identifier("returned"), t.booleanLiteral(false)),
                    t.objectProperty(t.identifier("value"), t.nullLiteral())
                ])
            ));

            // Traverse to collect parameter usage in part1 and part2
            const usedIn1 = new Set<string>();
            traverse(t.file(t.program(part1Body)), {
                noScope: true,
                Identifier(path: any) {
                    if (path.parentPath.isMemberExpression({ property: path.node, computed: false })) {
                        return;
                    }
                    if (path.parentPath.isObjectProperty({ key: path.node, computed: false })) {
                        return;
                    }
                    usedIn1.add(path.node.name);
                }
            });

            const usedIn2 = new Set<string>();
            traverse(t.file(t.program(part2Body)), {
                noScope: true,
                Identifier(path: any) {
                    if (path.parentPath.isMemberExpression({ property: path.node, computed: false })) {
                        return;
                    }
                    if (path.parentPath.isObjectProperty({ key: path.node, computed: false })) {
                        return;
                    }
                    usedIn2.add(path.node.name);
                }
            });

            const part1Params = funcNode.params.filter((p: any) => {
                if (!t.isIdentifier(p)) return true;
                return usedIn1.has(p.name);
            }).map((p: any) => t.cloneNode(p));
            
            const part1CallArgs = funcNode.params
                .filter((p: any) => !t.isIdentifier(p) || usedIn1.has(p.name))
                .map((p: any) => t.isIdentifier(p) ? t.identifier(p.name) : t.cloneNode(p));

            const part1Func = t.functionDeclaration(
                t.identifier(part1Name),
                part1Params,
                t.blockStatement(part1Body)
            );

            const stateIdentifier = t.identifier(`__state_${depth}`);
            
            // Rename liveVars in part2Body to member expressions on __state instead of unpacking,
            // to avoid redeclaring too many local variables and exceeding 240/256 slots in FVM.
            const dummyFile = t.file(t.program(part2Body));
            traverse(dummyFile, {
                noScope: true,
                Identifier(path: any) {
                    const name = path.node.name;
                    if (liveVars.includes(name)) {
                        if (path.parentPath.isMemberExpression({ property: path.node, computed: false })) {
                            return;
                        }
                        if (path.parentPath.isObjectProperty({ key: path.node, computed: false })) {
                            return;
                        }
                        path.replaceWith(t.memberExpression(stateIdentifier, t.identifier(name)));
                        path.skip();
                    }
                }
            });

            const part2Params = [
                ...funcNode.params.filter((p: any) => {
                    if (!t.isIdentifier(p)) return true;
                    return usedIn2.has(p.name);
                }).map((p: any) => t.cloneNode(p)),
                stateIdentifier
            ];
            
            const part2CallArgs = [
                ...funcNode.params
                    .filter((p: any) => !t.isIdentifier(p) || usedIn2.has(p.name))
                    .map((p: any) => t.isIdentifier(p) ? t.identifier(p.name) : t.cloneNode(p)),
                t.memberExpression(t.identifier("res1"), t.identifier("liveVars"))
            ];

            const part2Func = t.functionDeclaration(
                t.identifier(part2Name),
                part2Params,
                t.blockStatement(part2Body)
            );

            activeFuncNodes.push(part1Func);
            activeFuncNodes.push(part2Func);

            const coordinatorBody = [
                t.variableDeclaration("let", [
                    t.variableDeclarator(
                        t.identifier("res1"),
                        t.callExpression(
                            t.identifier(part1Name),
                            part1CallArgs
                        )
                    )
                ]),
                t.ifStatement(
                    t.memberExpression(t.identifier("res1"), t.identifier("returned")),
                    t.blockStatement([
                        t.returnStatement(t.memberExpression(t.identifier("res1"), t.identifier("value")))
                    ])
                ),
                t.variableDeclaration("let", [
                    t.variableDeclarator(
                        t.identifier("res2"),
                        t.callExpression(
                            t.identifier(part2Name),
                            part2CallArgs
                        )
                    )
                ]),
                t.ifStatement(
                    t.memberExpression(t.identifier("res2"), t.identifier("returned")),
                    t.blockStatement([
                        t.returnStatement(t.memberExpression(t.identifier("res2"), t.identifier("value")))
                    ])
                ),
                t.returnStatement(t.memberExpression(t.identifier("res2"), t.identifier("value")))
            ];

            funcNode.body = t.blockStatement(coordinatorBody);

            applyRegisterBanking(part1Func, depth + 1);
            applyRegisterBanking(part2Func, depth + 1);

            extraFuncNodes.push(part1Func);
            extraFuncNodes.push(part2Func);
        } else {
            for (const v of sortedLocals) {
                const reg = regAssignment[v];
                renameVariableInBody(funcNode.body, v, reg);
            }

            convertDeclarationsToAssignments(funcNode.body, regNames);

            if (regNames.size > 0) {
                const sortedRegNames = Array.from(regNames).sort();
                for (const r of sortedRegNames) {
                    const decl = t.variableDeclaration(
                        "let",
                        [t.variableDeclarator(t.identifier(r), t.nullLiteral())]
                    );
                    funcNode.body.body.unshift(decl);
                }
            }
        }
    }

    function renameVariableInBody(bodyNode: any, oldName: string, newName: string) {
        traverse(t.file(t.program([bodyNode])), {
            noScope: true,
            Identifier(path: any) {
                if (path.node.name === oldName) {
                    if (path.parentPath.isMemberExpression({ property: path.node, computed: false })) {
                        return;
                    }
                    if (path.parentPath.isObjectProperty({ key: path.node, computed: false })) {
                        return;
                    }
                    path.node.name = newName;
                }
            }
        });
    }

    function convertDeclarationsToAssignments(bodyNode: any, regNames: Set<string>) {
        traverse(t.file(t.program([bodyNode])), {
            noScope: true,
            VariableDeclaration(path: any) {
                const decl = path.node.declarations[0];
                if (t.isIdentifier(decl.id) && regNames.has(decl.id.name)) {
                    if (path.parentPath.isForStatement({ init: path.node })) {
                        if (decl.init) {
                            path.replaceWith(t.assignmentExpression("=", decl.id, decl.init));
                        } else {
                            path.replaceWith(t.nullLiteral());
                        }
                    } else {
                        if (decl.init) {
                            path.replaceWith(t.expressionStatement(
                                t.assignmentExpression("=", decl.id, decl.init)
                            ));
                        } else {
                            path.replaceWith(t.emptyStatement());
                        }
                    }
                }
            }
        });
    }

    // Large Function Auto-Splitting
    const linesOfCode = code.split('\n').length;
    if (linesOfCode > 1000 && t.isFunctionDeclaration(rootStmt)) {
        const splitIndex = findSplitPoint(rootStmt.body.body, rootStmt.params);
        if (splitIndex !== -1) {
            const part1Name = `${options.functionName}_part1`;
            const part2Name = `${options.functionName}_part2`;

            const part1Body = rootStmt.body.body.slice(0, splitIndex + 1);
            wrapReturns(part1Body);
            part1Body.push(t.returnStatement(
                t.objectExpression([
                    t.objectProperty(t.identifier("returned"), t.booleanLiteral(false)),
                    t.objectProperty(t.identifier("value"), t.nullLiteral())
                ])
            ));

            const part2Body = rootStmt.body.body.slice(splitIndex + 1);
            wrapReturns(part2Body);
            part2Body.push(t.returnStatement(
                t.objectExpression([
                    t.objectProperty(t.identifier("returned"), t.booleanLiteral(false)),
                    t.objectProperty(t.identifier("value"), t.nullLiteral())
                ])
            ));

            const part1Func = t.functionDeclaration(
                t.identifier(part1Name),
                rootStmt.params.map((p: any) => t.cloneNode(p)),
                t.blockStatement(part1Body)
            );

            const part2Func = t.functionDeclaration(
                t.identifier(part2Name),
                rootStmt.params.map((p: any) => t.cloneNode(p)),
                t.blockStatement(part2Body)
            );

            ast.program.body.push(part1Func);
            ast.program.body.push(part2Func);

            const coordinatorBody = [
                t.variableDeclaration("let", [
                    t.variableDeclarator(
                        t.identifier("res1"),
                        t.callExpression(
                            t.identifier(part1Name),
                            rootStmt.params.map((p: any) => t.isIdentifier(p) ? t.identifier(p.name) : t.cloneNode(p))
                        )
                    )
                ]),
                t.ifStatement(
                    t.memberExpression(t.identifier("res1"), t.identifier("returned")),
                    t.blockStatement([
                        t.returnStatement(t.memberExpression(t.identifier("res1"), t.identifier("value")))
                    ])
                ),
                t.variableDeclaration("let", [
                    t.variableDeclarator(
                        t.identifier("res2"),
                        t.callExpression(
                            t.identifier(part2Name),
                            rootStmt.params.map((p: any) => t.isIdentifier(p) ? t.identifier(p.name) : t.cloneNode(p))
                        )
                    )
                ]),
                t.ifStatement(
                    t.memberExpression(t.identifier("res2"), t.identifier("returned")),
                    t.blockStatement([
                        t.returnStatement(t.memberExpression(t.identifier("res2"), t.identifier("value")))
                    ])
                ),
                t.returnStatement(t.memberExpression(t.identifier("res2"), t.identifier("value")))
            ];

            rootStmt.body = t.blockStatement(coordinatorBody);
        } else {
            warnings.push({
                line: 1,
                message: `Function ${options.functionName} has >1000 lines (${linesOfCode}) but no clean split point was found.`,
                suggestion: "Try splitting the function manually or reduce variable dependencies between parts."
            });
        }
    }

    // Check for Proxy extraction
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
        const jsWrapper = `
const { FortressClient } = require('../../client.js');
let fortressClient;

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

module.exports = ${options.functionName};
`;
        
        let finalJsWrapper = jsWrapper;
        if (hasSharedArrayBuffer) {
            finalJsWrapper = `// SharedArrayBuffer usage detected: shared memory is replaced with message-passing equivalent.\n` + finalJsWrapper;
        }
        return {
            fvmSource: fvmTranspileRes.fvmSource,
            jsWrapper: finalJsWrapper,
            tsDeclaration: `export function ${options.functionName}(...args: any[]): any;`,
            usedStdlib: fvmTranspileRes.usedStdlib,
            warnings: fvmTranspileRes.warnings,
            asyncSplit: null
        };
    }

    // Check for Dynamic Eval splitting
    let dynamicEvalPath: any = null;
    traverse(ast, {
        CallExpression(path: any) {
            if (t.isIdentifier(path.node.callee) && path.node.callee.name === 'eval') {
                const arg = path.node.arguments[0];
                let isStaticJson = false;
                if (arg && t.isStringLiteral(arg)) {
                    try {
                        JSON.parse(arg.value);
                        isStaticJson = true;
                    } catch(e) {}
                }
                if (!isStaticJson) {
                    dynamicEvalPath = path;
                    path.stop();
                }
            }
        }
    });

    if (dynamicEvalPath && t.isFunctionDeclaration(rootStmt)) {
        if (dynamicEvalPath.getFunctionParent().node !== rootStmt) {
            throw new TypeError("Nested eval() is not supported");
        }
        let currentPath = dynamicEvalPath;
        while (currentPath && currentPath.parentPath && currentPath.parentPath.node !== rootStmt.body) {
            currentPath = currentPath.parentPath;
        }
        if (currentPath && currentPath.parentPath) {
            const splitIndex = rootStmt.body.body.indexOf(currentPath.node);
            if (splitIndex !== -1) {
                const statementsBefore = rootStmt.body.body.slice(0, splitIndex + 1);
                const statementsAfter = rootStmt.body.body.slice(splitIndex + 1);
                
                const declaredBefore = new Set<string>();
                for (const param of rootStmt.params) {
                    if (t.isIdentifier(param)) {
                        declaredBefore.add(param.name);
                    }
                }
                const dummyFileBefore = t.file(t.program(statementsBefore));
                traverse(dummyFileBefore, {
                    noScope: true,
                    VariableDeclarator(p: any) {
                        if (t.isIdentifier(p.node.id)) {
                            declaredBefore.add(p.node.id.name);
                        }
                    }
                });
                
                const referencedAfter = new Set<string>();
                const dummyFileAfter = t.file(t.program(statementsAfter));
                traverse(dummyFileAfter, {
                    noScope: true,
                    Identifier(p: any) {
                        if (p.isReferencedIdentifier()) {
                            referencedAfter.add(p.node.name);
                        }
                    }
                });
                
                const liveVars = Array.from(declaredBefore).filter(v => referencedAfter.has(v));
                liveVars.sort();
                
                const splitFuncName = `${options.functionName}_split`;
                const splitFuncNode = t.functionDeclaration(
                    t.identifier(splitFuncName),
                    liveVars.map(v => t.identifier(v)),
                    t.blockStatement(statementsAfter)
                );
                
                const fvmAst = t.file(t.program([splitFuncNode]));
                const fvmCodeStr = generate(fvmAst).code;
                const fvmTranspileRes = transpile(fvmCodeStr, {
                    ...options,
                    functionName: splitFuncName,
                    verifyEquivalence: false
                });
                
                const paramsCode = rootStmt.params.map((p: any) => generate(p).code).join(', ');
                const statementsBeforeCode = statementsBefore.map((s: any) => generate(s).code).join('\n');
                const liveVarsCode = liveVars.join(', ');
                
                const jsWrapper = `
const { FortressClient } = require('../../client.js');
let fortressClient;

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

module.exports = async function(${paramsCode}) {
    ${statementsBeforeCode}
    if (!fortressClient) {
        fortressClient = await FortressClient.init(process.env.FORTRESS_ENDPOINT || './checkLicense.json');
    }
    let payloadArgs;
    if (${liveVars.length > 2}) {
        payloadArgs = ["${splitFuncName}", { ${liveVars.map(v => `"${v}": ${v}`).join(', ')} }];
    } else {
        payloadArgs = ["${splitFuncName}", ${liveVarsCode}];
    }
    return await fortressClient.execute(preparePayload(payloadArgs));
};
`;
                let finalJsWrapper = jsWrapper;
                if (hasSharedArrayBuffer) {
                    finalJsWrapper = `// SharedArrayBuffer usage detected: shared memory is replaced with message-passing equivalent.\n` + finalJsWrapper;
                }
                return {
                    fvmSource: fvmTranspileRes.fvmSource,
                    jsWrapper: finalJsWrapper,
                    tsDeclaration: `export function ${options.functionName}(...args: any[]): Promise<any>;`,
                    usedStdlib: fvmTranspileRes.usedStdlib,
                    warnings: fvmTranspileRes.warnings,
                    asyncSplit: {
                        boundaryCount: 1,
                        variablesPassed: liveVars
                    }
                };
            }
        }
    }

    // Generate 8-character hex seed once at the start of transpilation
    const symbolSeed = crypto.randomBytes(4).toString('hex');
    let symbolCounter = 0;

    // Pre-process and validate Symbol calls & properties
    traverse(ast, {
        Identifier(path: any) {
            if (path.node.name === 'Symbol') {
                const parentPath = path.parentPath;
                if (parentPath.isMemberExpression() && parentPath.node.object === path.node) {
                    const property = parentPath.node.property;
                    let propName = null;
                    if (t.isIdentifier(property) && !parentPath.node.computed) {
                        propName = property.name;
                    } else if (t.isStringLiteral(property)) {
                        propName = property.value;
                    }
                    if (propName && ['for', 'keyFor', 'iterator', 'toPrimitive', 'hasInstance'].includes(propName)) {
                        throw new Error(`Symbol.${propName} is not supported`);
                    }
                } else if (parentPath.isCallExpression() && parentPath.node.callee === path.node) {
                    const desc = parentPath.node.arguments[0];
                    const uniqSeed = symbolSeed + "_" + (symbolCounter++);
                    let replacement;
                    if (desc) {
                        if (t.isStringLiteral(desc)) {
                            replacement = t.stringLiteral("__fortress_sym_" + uniqSeed + "__" + desc.value);
                        } else {
                            replacement = t.binaryExpression("+", t.stringLiteral("__fortress_sym_" + uniqSeed + "__"), desc);
                        }
                    } else {
                        replacement = t.stringLiteral("__fortress_sym_" + uniqSeed + "__");
                    }
                    parentPath.replaceWith(replacement);
                }
            }
        }
    });

    // 0.1 Generator state machine AST transformation
    const rootStmtGen = ast.program.body[0];
    if (t.isFunctionDeclaration(rootStmtGen) && rootStmtGen.generator) {
        isGeneratorFlag = true;
        const params = rootStmtGen.params.map((p: any) => p.name);
        const localVars = new Set<string>();
        traverse(t.file(t.program([t.cloneNode(rootStmtGen.body)])), {
            noScope: true,
            VariableDeclarator(path: any) {
                if (t.isIdentifier(path.node.id)) {
                    localVars.add(path.node.id.name);
                }
            }
        });

        // Rewrite all references to localVars and params inside the body to state.varName
        traverse(t.file(t.program([rootStmtGen.body])), {
            noScope: true,
            VariableDeclarator(path: any) {
                const id = path.node.id;
                if (t.isIdentifier(id) && (localVars.has(id.name) || params.includes(id.name))) {
                    const init = path.node.init || t.nullLiteral();
                    path.parentPath.replaceWith(t.expressionStatement(
                        t.assignmentExpression('=', t.memberExpression(t.identifier('state'), t.identifier(id.name)), init)
                    ));
                }
            },
            Identifier(path: any) {
                if (path.isReferencedIdentifier() && (localVars.has(path.node.name) || params.includes(path.node.name))) {
                    path.replaceWith(t.memberExpression(t.identifier('state'), t.identifier(path.node.name)));
                    path.skip();
                }
            }
        });

        let genTempCounter = 0;
        const genTempVars: string[] = [];
        let hasYieldsToProcess = true;
        while (hasYieldsToProcess) {
            hasYieldsToProcess = false;
            traverse(t.file(t.program([rootStmtGen.body])), {
                noScope: true,
                YieldExpression(path: any) {
                    const parent = path.parentPath;
                    if (parent.isExpressionStatement()) {
                        return;
                    }
                    if (parent.isAssignmentExpression() && parent.parentPath.isExpressionStatement()) {
                        const left = parent.node.left;
                        if (t.isMemberExpression(left) && t.isIdentifier(left.object) && left.object.name === 'state') {
                            return;
                        }
                    }
                    hasYieldsToProcess = true;
                    const tempName = `__gen_temp_${genTempCounter++}`;
                    genTempVars.push(tempName);
                    const statementParent = path.getStatementParent();
                    const yieldNode = path.node;
                    path.replaceWith(t.memberExpression(t.identifier('state'), t.identifier(tempName)));
                    statementParent.insertBefore(
                        t.expressionStatement(
                            t.assignmentExpression(
                                '=',
                                t.memberExpression(t.identifier('state'), t.identifier(tempName)),
                                yieldNode
                            )
                        )
                    );
                    path.stop();
                }
            });
        }
        genTempVars.forEach(v => {
            localVars.add(v);
        });

        // Split body statements into segments at yield boundaries
        const segments: any[][] = [[]];
        let currentSegment = segments[0];
        for (const stmt of rootStmtGen.body.body) {
            let hasYield = false;
            let yieldExpr: any = null;
            
            const dummyFile = t.file(t.program([stmt]));
            traverse(dummyFile, {
                noScope: true,
                YieldExpression(path: any) {
                    hasYield = true;
                    yieldExpr = path.node.argument || t.nullLiteral();
                    path.replaceWith(t.nullLiteral());
                }
            });
            
            if (hasYield) {
                currentSegment.push(t.expressionStatement(
                    t.assignmentExpression('=', t.memberExpression(t.identifier('state'), t.identifier('value')), yieldExpr)
                ));
                const nextIp = segments.length;
                currentSegment.push(t.expressionStatement(
                    t.assignmentExpression('=', t.memberExpression(t.identifier('state'), t.identifier('ip')), t.numericLiteral(nextIp))
                ));
                currentSegment.push(t.returnStatement(t.identifier('state')));
                
                currentSegment = [];
                segments.push(currentSegment);
            } else {
                currentSegment.push(stmt);
            }
        }
        currentSegment.push(t.expressionStatement(
            t.assignmentExpression('=', t.memberExpression(t.identifier('state'), t.identifier('done')), t.booleanLiteral(true))
        ));
        currentSegment.push(t.expressionStatement(
            t.assignmentExpression('=', t.memberExpression(t.identifier('state'), t.identifier('value')), t.nullLiteral())
        ));
        currentSegment.push(t.returnStatement(t.identifier('state')));

        // Construct _new and _next functions
        const stateProps = [
            t.objectProperty(t.identifier('ip'), t.numericLiteral(0)),
            t.objectProperty(t.identifier('done'), t.booleanLiteral(false)),
            t.objectProperty(t.identifier('value'), t.nullLiteral())
        ];
        params.forEach((p: any) => {
            stateProps.push(t.objectProperty(t.identifier(p), t.identifier(p)));
        });
        localVars.forEach((v: any) => {
            if (!params.includes(v)) {
                stateProps.push(t.objectProperty(t.identifier(v), t.nullLiteral()));
            }
        });

        const newFunc = t.functionDeclaration(
            t.identifier(`${options.functionName}_new`),
            params.map((p: any) => t.identifier(p)),
            t.blockStatement([
                t.returnStatement(t.objectExpression(stateProps))
            ])
        );

        const nextBranches: any[] = [];
        segments.forEach((segStmts: any, idx: any) => {
            nextBranches.push(t.ifStatement(
                t.binaryExpression('==', t.memberExpression(t.identifier('state'), t.identifier('ip')), t.numericLiteral(idx)),
                t.blockStatement(segStmts)
            ));
        });

        const nextFunc = t.functionDeclaration(
            t.identifier(`${options.functionName}_next`),
            [t.identifier('state')],
            t.blockStatement(nextBranches)
        );

        const dispatchParams = [t.identifier('action'), t.identifier('stateOrArg1')];
        for (let i = 1; i < params.length; i++) {
            dispatchParams.push(t.identifier(`arg${i}`));
        }

        const newArgs = [t.identifier('stateOrArg1')];
        for (let i = 1; i < params.length; i++) {
            newArgs.push(t.identifier(`arg${i}`));
        }

        const dispatchFunc = t.functionDeclaration(
            t.identifier(options.functionName),
            dispatchParams,
            t.blockStatement([
                t.ifStatement(
                    t.binaryExpression('==', t.identifier('action'), t.stringLiteral('new')),
                    t.blockStatement([
                        t.returnStatement(t.callExpression(t.identifier(`${options.functionName}_new`), newArgs))
                    ])
                ),
                t.ifStatement(
                    t.binaryExpression('==', t.identifier('action'), t.stringLiteral('next')),
                    t.blockStatement([
                        t.returnStatement(t.callExpression(t.identifier(`${options.functionName}_next`), [t.identifier('stateOrArg1')]))
                    ])
                ),
                t.returnStatement(t.nullLiteral())
            ])
        );

        applyRegisterBanking(newFunc);
        applyRegisterBanking(nextFunc);
        extraFuncNodes.push(newFunc);
        extraFuncNodes.push(nextFunc);
        
        // Replace root generator statement with dispatcher
        ast.program.body[0] = dispatchFunc;
    }

    // 0.2 Closure lifting and environment sharing
    const liftedFuncs: { name: string; arity: number }[] = [];
    const usedArities = new Set<number>();
    let closureCounter = 0;

    // Split multi-declarators first
    traverse(ast, {
        VariableDeclaration(path: any) {
            if (path.node.declarations.length > 1) {
                const splitDecls = path.node.declarations.map((decl: any) => 
                    t.variableDeclaration(path.node.kind, [t.cloneNode(decl)])
                );
                path.replaceWithMultiple(splitDecls);
            }
        }
    });

    const nestedFunctionPaths: any[] = [];
    traverse(ast, {
        Function(path: any) {
            if (path.parentPath.getFunctionParent() !== null) {
                nestedFunctionPaths.push(path);
            }
        }
    });

    const closureKnownGlobals = new Set([
        'len', 'hash256', 'concat', 'encrypt_aes', 'json_stringify', 'JSONParse', 'JSONStringify', 'TypeOf',
        'ArrIndexOf', 'ArrLastIndexOf', 'ArrIncludes', 'ArrSlice', 'ArrReverse', 'ArrSortNumeric', 'ArrSortString',
        'ArrFlat', 'ArrJoin', 'ArrFill', 'ArrPush', 'ArrUnshift', 'ArrPop', 'ArrShift', 'listPush',
        'MathFloor', 'MathCeil', 'MathRound', 'MathAbs', 'MathSqrt', 'MathPow', 'MathMin', 'MathMax', 'MathLog', 'MathExp',
        'ReflectSet', 'ReflectHas', 'ReflectOwnKeys', 'eval',
        `${options.functionName}_proxy_get`,
        `${options.functionName}_proxy_set`,
        `${options.functionName}_part1`,
        `${options.functionName}_part2`,
        options.functionName
    ]);

    nestedFunctionPaths.reverse();

    const functionCapturedVars = new Map<any, Set<string>>();

    for (const nestedPath of nestedFunctionPaths) {
        const upvars = new Set<string>();
        nestedPath.traverse({
            Identifier(idPath: any) {
                if (idPath.isReferencedIdentifier() || idPath.isBindingIdentifier()) {
                    if (idPath.parentPath === nestedPath && idPath.parentKey === 'id') {
                        return;
                    }
                    const name = idPath.node.name;
                    const binding = idPath.scope.getBinding(name);
                    if (binding) {
                        let isLocal = false;
                        let currScope = binding.scope;
                        while (currScope) {
                            if (currScope === nestedPath.scope) {
                                isLocal = true;
                                break;
                            }
                            currScope = currScope.parent;
                        }
                        if (!isLocal) {
                            let funcScope = binding.scope;
                            while (funcScope && funcScope.path.type !== 'FunctionDeclaration' && funcScope.path.type !== 'FunctionExpression' && funcScope.path.type !== 'ArrowFunctionExpression') {
                                funcScope = funcScope.parent;
                            }
                            if (funcScope) {
                                upvars.add(name);
                            }
                        }
                    }
                }
            }
        });

        for (const name of upvars) {
            const binding = nestedPath.scope.getBinding(name);
            if (binding) {
                let funcScope = binding.scope;
                while (funcScope && funcScope.path.type !== 'FunctionDeclaration' && funcScope.path.type !== 'FunctionExpression' && funcScope.path.type !== 'ArrowFunctionExpression') {
                    funcScope = funcScope.parent;
                }
                if (funcScope) {
                    let s = functionCapturedVars.get(funcScope.path);
                    if (!s) {
                        s = new Set<string>();
                        functionCapturedVars.set(funcScope.path, s);
                    }
                    s.add(name);
                }
            }
        }

        const capturedVars = functionCapturedVars.get(nestedPath);
        if (capturedVars && capturedVars.size > 0) {
            nestedPath.traverse({
                Identifier(idPath: any) {
                    if ((idPath.isReferencedIdentifier() || idPath.isBindingIdentifier()) && capturedVars.has(idPath.node.name)) {
                        const binding = idPath.scope.getBinding(idPath.node.name);
                        if (binding && binding.scope.path === nestedPath) {
                            if (idPath.parentPath && idPath.parentPath.isFunction() && idPath.parentKey === 'id') {
                                return;
                            }
                            idPath.replaceWith(t.memberExpression(t.identifier('scopeState'), t.identifier(idPath.node.name)));
                            idPath.skip();
                        }
                    }
                },
                VariableDeclarator(decPath: any) {
                    const id = decPath.node.id;
                    if (t.isIdentifier(id) && capturedVars.has(id.name)) {
                        const binding = decPath.scope.getBinding(id.name);
                        if (binding && binding.scope.path === nestedPath) {
                            const init = decPath.node.init || t.nullLiteral();
                            decPath.parentPath.replaceWith(t.expressionStatement(
                                t.assignmentExpression('=', t.memberExpression(t.identifier('scopeState'), t.identifier(id.name)), init)
                            ));
                        }
                    }
                }
            });

            const stateProps: any[] = [];
            const params = nestedPath.node.params.map((p: any) => p.name);
            capturedVars.forEach(v => {
                if (params.includes(v)) {
                    stateProps.push(t.objectProperty(t.identifier(v), t.identifier(v)));
                } else {
                    stateProps.push(t.objectProperty(t.identifier(v), t.nullLiteral()));
                }
            });
            const scopeStateDecl = t.variableDeclaration('let', [
                t.variableDeclarator(t.identifier('scopeState'), t.objectExpression(stateProps))
            ]);
            nestedPath.node.body.body.unshift(scopeStateDecl);
        }

        nestedPath.traverse({
            CallExpression(path: any) {
                const callee = path.node.callee;
                if (t.isIdentifier(callee)) {
                    const name = callee.name;
                    const isGeneratedHelper = 
                        name === options.functionName ||
                        name === `${options.functionName}_new` ||
                        name === `${options.functionName}_next` ||
                        name.startsWith(`${options.functionName}_closure_`) ||
                        name.startsWith('__call_closure_');

                    if (isGeneratedHelper) {
                        return;
                    }

                    if (!closureKnownGlobals.has(name)) {
                        const arity = path.node.arguments.length;
                        usedArities.add(arity);
                        path.replaceWith(t.callExpression(
                            t.identifier(`__call_closure_${arity}`),
                            [t.cloneNode(callee), ...path.node.arguments.map((a: any) => t.cloneNode(a))]
                        ));
                        path.skip();
                    }
                }
            }
        });

        const liftedName = `${options.functionName}_closure_${closureCounter++}`;
        liftedFuncs.push({ name: liftedName, arity: nestedPath.node.params.length });

        nestedPath.traverse({
            Identifier(idPath: any) {
                if ((idPath.isReferencedIdentifier() || idPath.isBindingIdentifier()) && upvars.has(idPath.node.name)) {
                    const binding = idPath.scope.getBinding(idPath.node.name);
                    let isLocal = false;
                    if (binding) {
                        let currScope = binding.scope;
                        while (currScope) {
                            if (currScope === nestedPath.scope) {
                                isLocal = true;
                                break;
                            }
                            currScope = currScope.parent;
                        }
                    }
                    if (!isLocal) {
                        if (idPath.parentPath && idPath.parentPath.isFunction() && idPath.parentKey === 'id') {
                            return;
                        }
                        idPath.replaceWith(t.memberExpression(t.identifier('state'), t.identifier(idPath.node.name)));
                        idPath.skip();
                    }
                }
            }
        });

        const originalParams = nestedPath.node.params.map((p: any) => t.cloneNode(p));
        const liftedParams = [t.identifier('state'), ...originalParams];
        let bodyNode = t.cloneNode(nestedPath.node.body);
        if (!t.isBlockStatement(bodyNode)) {
            bodyNode = t.blockStatement([t.returnStatement(bodyNode)]);
        }
        const liftedFunc = t.functionDeclaration(
            t.identifier(liftedName),
            liftedParams,
            bodyNode
        );

        applyRegisterBanking(liftedFunc);

        extraFuncNodes.push(liftedFunc);

        let parentFuncPath = nestedPath.parentPath.getFunctionParent();
        let stateExpr;
        if (parentFuncPath) {
            const isParentNested = parentFuncPath.parentPath.getFunctionParent() !== null;
            const parentCaptured = functionCapturedVars.get(parentFuncPath);
            if (parentCaptured && parentCaptured.size > 0) {
                stateExpr = t.identifier('scopeState');
            } else if (isParentNested) {
                stateExpr = t.identifier('state');
            } else {
                stateExpr = t.objectExpression([]);
            }
        } else {
            stateExpr = t.objectExpression([]);
        }

        const closureObj = t.objectExpression([
            t.objectProperty(t.identifier('__is_closure'), t.booleanLiteral(true)),
            t.objectProperty(t.identifier('fnName'), t.stringLiteral(liftedName)),
            t.objectProperty(t.identifier('state'), stateExpr)
        ]);

        if (nestedPath.isFunctionDeclaration()) {
            nestedPath.replaceWith(t.variableDeclaration('let', [
                t.variableDeclarator(nestedPath.node.id, closureObj)
            ]));
        } else {
            nestedPath.replaceWith(closureObj);
        }
    }

    let rootPath: any = null;
    traverse(ast, {
        FunctionDeclaration(path: any) {
            if (path.node.id && path.node.id.name === options.functionName) {
                rootPath = path;
                path.stop();
            }
        }
    });

    if (rootPath) {
        const rootCaptured = functionCapturedVars.get(rootPath);
        if (rootCaptured && rootCaptured.size > 0) {
            rootPath.traverse({
                Identifier(idPath: any) {
                    if ((idPath.isReferencedIdentifier() || idPath.isBindingIdentifier()) && rootCaptured.has(idPath.node.name)) {
                        const binding = idPath.scope.getBinding(idPath.node.name);
                        if (binding && binding.scope.path === rootPath) {
                            if (idPath.parentPath && idPath.parentPath.isFunction() && idPath.parentKey === 'id') {
                                return;
                            }
                            idPath.replaceWith(t.memberExpression(t.identifier('scopeState'), t.identifier(idPath.node.name)));
                            idPath.skip();
                        }
                    }
                },
                VariableDeclarator(decPath: any) {
                    const id = decPath.node.id;
                    if (t.isIdentifier(id) && rootCaptured.has(id.name)) {
                        const binding = decPath.scope.getBinding(id.name);
                        if (binding && binding.scope.path === rootPath) {
                            const init = decPath.node.init || t.nullLiteral();
                            decPath.parentPath.replaceWith(t.expressionStatement(
                                t.assignmentExpression('=', t.memberExpression(t.identifier('scopeState'), t.identifier(id.name)), init)
                            ));
                        }
                    }
                }
            });

            const stateProps: any[] = [];
            const params = rootPath.node.params.map((p: any) => p.name);
            rootCaptured.forEach(v => {
                if (params.includes(v)) {
                    stateProps.push(t.objectProperty(t.identifier(v), t.identifier(v)));
                } else {
                    stateProps.push(t.objectProperty(t.identifier(v), t.nullLiteral()));
                }
            });
            const scopeStateDecl = t.variableDeclaration('let', [
                t.variableDeclarator(t.identifier('scopeState'), t.objectExpression(stateProps))
            ]);
            rootPath.node.body.body.unshift(scopeStateDecl);
        }
    }

    traverse(ast, {
        CallExpression(path: any) {
            const callee = path.node.callee;
            if (t.isIdentifier(callee)) {
                const name = callee.name;
                const isGeneratedHelper = 
                    name === options.functionName ||
                    name === `${options.functionName}_new` ||
                    name === `${options.functionName}_next` ||
                    name.startsWith(`${options.functionName}_closure_`) ||
                    name.startsWith('__call_closure_');

                if (isGeneratedHelper) {
                    return;
                }

                if (!closureKnownGlobals.has(name)) {
                    const arity = path.node.arguments.length;
                    usedArities.add(arity);
                    path.replaceWith(t.callExpression(
                        t.identifier(`__call_closure_${arity}`),
                        [t.cloneNode(callee), ...path.node.arguments.map((a: any) => t.cloneNode(a))]
                    ));
                    path.skip();
                }
            }
        }
    });

    for (const arity of usedArities) {
        const funcsOfArity = liftedFuncs.filter(f => f.arity === arity);
        const params = ['closure'];
        for (let i = 0; i < arity; i++) {
            params.push(`arg${i}`);
        }
        const bodyLines = [
            `let name = closure.fnName;`,
            `let state = closure.state;`
        ];
        funcsOfArity.forEach(f => {
            const callArgs = ['state'];
            for (let i = 0; i < arity; i++) {
                callArgs.push(`arg${i}`);
            }
            bodyLines.push(`if (name == "${f.name}") { let res = ${f.name}(${callArgs.join(', ')}); closure.state = state; return res; }`);
        });
        bodyLines.push(`return null;`);
        
        const dispatcherCode = `function __call_closure_${arity}(${params.join(', ')}) {\n  ${bodyLines.join('\n  ')}\n}`;
        extraDeclarations.push(dispatcherCode);
    }

    // 1. Type inference table
    const variableTypes = new Map<string, string>();

    // 2. Pre-process classes, variables, and type definitions
    traverse(ast, {
        VariableDeclarator(path: any) {
            const id = path.node.id;
            const init = path.node.init;
            if (t.isIdentifier(id) && init) {
                if (t.isNewExpression(init) && t.isIdentifier(init.callee)) {
                    if (init.callee.name === 'Map') {
                        variableTypes.set(id.name, 'Map');
                    } else if (init.callee.name === 'Set') {
                        variableTypes.set(id.name, 'Set');
                    }
                } else if (t.isArrayExpression(init)) {
                    variableTypes.set(id.name, 'array');
                } else if (t.isStringLiteral(init)) {
                    variableTypes.set(id.name, 'string');
                }
            }
        }
    });

    // 3. Helper to generate callback loop body
    function generateCallbackVal(
        callback: any,
        item: any,
        index: any,
        array: any,
        loopBody: any[],
        valId: any,
        scope: any
    ) {
        if (t.isFunction(callback)) {
            const paramA = callback.params[0];
            const paramB = callback.params[1];
            const paramC = callback.params[2];
            
            const bodyCopy = t.cloneNode(callback.body);
            const decls: any[] = [];
            
            if (paramA) {
                if (t.isIdentifier(paramA)) {
                    decls.push(t.variableDeclarator(paramA, item));
                } else if (t.isPattern(paramA)) {
                    expandPattern(paramA, item, decls, loopBody, scope);
                }
            }
            if (paramB && t.isIdentifier(paramB)) {
                decls.push(t.variableDeclarator(paramB, index));
            }
            if (paramC && t.isIdentifier(paramC)) {
                decls.push(t.variableDeclarator(paramC, array));
            }
            
            if (decls.length > 0) {
                loopBody.push(t.variableDeclaration("let", decls));
            }

            if (t.isBlockStatement(bodyCopy)) {
                traverseReplaceReturns(bodyCopy, valId);
                loopBody.push(...bodyCopy.body);
            } else {
                const exprCopy = t.cloneNode(bodyCopy);
                if (paramA && t.isIdentifier(paramA)) {
                    replaceIdentifier(exprCopy, paramA.name, (item as any).name || "item");
                }
                if (paramB && t.isIdentifier(paramB)) {
                    replaceIdentifier(exprCopy, paramB.name, (index as any).name || "index");
                }
                if (paramC && t.isIdentifier(paramC)) {
                    replaceIdentifier(exprCopy, paramC.name, (array as any).name || "array");
                }
                loopBody.push(t.expressionStatement(t.assignmentExpression("=", valId, exprCopy)));
            }
        } else {
            loopBody.push(t.variableDeclaration("let", [
                t.variableDeclarator(valId, t.callExpression(callback, [item, index, array]))
            ]));
        }
    }

    function generateReduceCallbackVal(
        callback: any,
        acc: any,
        item: any,
        index: any,
        array: any,
        loopBody: any[],
        valId: any,
        scope: any
    ) {
        if (t.isFunction(callback)) {
            const paramAcc = callback.params[0];
            const paramItem = callback.params[1];
            const paramIndex = callback.params[2];
            const paramArray = callback.params[3];
            
            const bodyCopy = t.cloneNode(callback.body);
            const decls: any[] = [];
            
            if (paramAcc && t.isIdentifier(paramAcc)) {
                decls.push(t.variableDeclarator(paramAcc, acc));
            }
            if (paramItem) {
                if (t.isIdentifier(paramItem)) {
                    decls.push(t.variableDeclarator(paramItem, item));
                } else if (t.isPattern(paramItem)) {
                    expandPattern(paramItem, item, decls, loopBody, scope);
                }
            }
            if (paramIndex && t.isIdentifier(paramIndex)) {
                decls.push(t.variableDeclarator(paramIndex, index));
            }
            if (paramArray && t.isIdentifier(paramArray)) {
                decls.push(t.variableDeclarator(paramArray, array));
            }
            
            if (decls.length > 0) {
                loopBody.push(t.variableDeclaration("let", decls));
            }
            
            if (t.isBlockStatement(bodyCopy)) {
                traverseReplaceReturns(bodyCopy, valId);
                loopBody.push(...bodyCopy.body);
            } else {
                const exprCopy = t.cloneNode(bodyCopy);
                if (paramAcc && t.isIdentifier(paramAcc)) {
                    replaceIdentifier(exprCopy, paramAcc.name, (acc as any).name || "acc");
                }
                if (paramItem && t.isIdentifier(paramItem)) {
                    replaceIdentifier(exprCopy, paramItem.name, (item as any).name || "item");
                }
                if (paramIndex && t.isIdentifier(paramIndex)) {
                    replaceIdentifier(exprCopy, paramIndex.name, (index as any).name || "index");
                }
                if (paramArray && t.isIdentifier(paramArray)) {
                    replaceIdentifier(exprCopy, paramArray.name, (array as any).name || "array");
                }
                loopBody.push(t.expressionStatement(t.assignmentExpression("=", valId, exprCopy)));
            }
        } else {
            loopBody.push(t.variableDeclaration("let", [
                t.variableDeclarator(valId, t.callExpression(callback, [acc, item, index, array]))
            ]));
        }
    }

    function expandPattern(
        pattern: any,
        target: any,
        declarations: any[],
        statements: any[],
        scope: any
    ) {
        if (t.isIdentifier(pattern)) {
            declarations.push(t.variableDeclarator(pattern, target));
        } else if (t.isObjectPattern(pattern)) {
            const nullCheckId = scope.generateUidIdentifier("null_check");
            declarations.push(t.variableDeclarator(nullCheckId, t.memberExpression(target, t.identifier("destructure_null_check"))));
            for (const prop of pattern.properties) {
                if (t.isRestElement(prop)) {
                    throw new Error("Object rest destructuring is not supported in FVM");
                }
                const key = prop.key;
                let value = prop.value;
                
                let propAccess: any;
                if (prop.computed) {
                    propAccess = t.memberExpression(target, key, true);
                } else {
                    if (t.isIdentifier(key)) {
                        propAccess = t.memberExpression(target, key, false);
                    } else if (t.isStringLiteral(key)) {
                        propAccess = t.memberExpression(target, key, true);
                    } else {
                        throw new Error("Unsupported object property key type in destructuring");
                    }
                }

                let defaultValue: any = null;
                if (t.isAssignmentPattern(value)) {
                    defaultValue = value.right;
                    value = value.left;
                }

                let valTemp: any;
                if (t.isIdentifier(value) && !defaultValue) {
                    declarations.push(t.variableDeclarator(value, propAccess));
                } else {
                    valTemp = scope.generateUidIdentifier("destruct_prop");
                    declarations.push(t.variableDeclarator(valTemp, propAccess));

                    if (defaultValue) {
                        statements.push(
                            t.ifStatement(
                                t.binaryExpression("==", valTemp, t.nullLiteral()),
                                t.blockStatement([
                                    t.expressionStatement(t.assignmentExpression("=", valTemp, defaultValue))
                                ])
                            )
                        );
                    }

                    expandPattern(value, valTemp, declarations, statements, scope);
                }
            }
        } else if (t.isArrayPattern(pattern)) {
            const nullCheckId = scope.generateUidIdentifier("null_check");
            declarations.push(t.variableDeclarator(nullCheckId, t.memberExpression(target, t.identifier("destructure_null_check"))));
            let index = 0;
            for (const elem of pattern.elements) {
                if (!elem) {
                    index++;
                    continue;
                }

                if (t.isRestElement(elem)) {
                    const restLVal = elem.argument;
                    const sliceCall = t.callExpression(t.identifier('ArrSlice'), [
                        target,
                        t.numericLiteral(index),
                        t.nullLiteral()
                    ]);
                    expandPattern(restLVal, sliceCall, declarations, statements, scope);
                    break;
                }

                let value = elem;
                let defaultValue: any = null;
                if (t.isAssignmentPattern(value)) {
                    defaultValue = value.right;
                    value = value.left;
                }

                const propAccess = t.memberExpression(target, t.numericLiteral(index), true);

                if (t.isIdentifier(value) && !defaultValue) {
                    declarations.push(t.variableDeclarator(value, propAccess));
                } else {
                    const valTemp = scope.generateUidIdentifier("destruct_elem");
                    declarations.push(t.variableDeclarator(valTemp, propAccess));

                    if (defaultValue) {
                        statements.push(
                            t.ifStatement(
                                t.binaryExpression("==", valTemp, t.nullLiteral()),
                                t.blockStatement([
                                    t.expressionStatement(t.assignmentExpression("=", valTemp, defaultValue))
                                ])
                            )
                        );
                    }

                    expandPattern(value, valTemp, declarations, statements, scope);
                }
                index++;
            }
        } else if (t.isAssignmentPattern(pattern)) {
            const value = pattern.left;
            const defaultValue = pattern.right;
            
            const valTemp = scope.generateUidIdentifier("destruct_assign");
            declarations.push(t.variableDeclarator(valTemp, target));
            statements.push(
                t.ifStatement(
                    t.binaryExpression("==", valTemp, t.nullLiteral()),
                    t.blockStatement([
                        t.expressionStatement(t.assignmentExpression("=", valTemp, defaultValue))
                    ])
                )
            );
            expandPattern(value, valTemp, declarations, statements, scope);
        }
    }

    // Main AST traversal pass
    traverse(ast, {
        ObjectExpression(path: any) {
            if (path.parentPath.isNewExpression() && t.isIdentifier(path.parentPath.node.callee) && path.parentPath.node.callee.name === 'Proxy') {
                return;
            }
            const props = path.node.properties;
            if (props.some((p: any) => t.isIdentifier(p.key) && p.key.name === '__ownKeys')) {
                return;
            }
            const keys: any[] = [];
            for (const prop of props) {
                if (t.isObjectProperty(prop)) {
                    if (t.isIdentifier(prop.key) && !prop.computed) {
                        keys.push(t.stringLiteral(prop.key.name));
                    } else if (t.isStringLiteral(prop.key)) {
                        keys.push(t.stringLiteral(prop.key.value));
                    } else {
                        keys.push(prop.key);
                    }
                }
            }
            props.push(t.objectProperty(t.identifier('__ownKeys'), t.arrayExpression(keys)));
        },

        StringLiteral(path: any) {
            if (path.node.extra) {
                delete path.node.extra;
            }
        },

        ThrowStatement(path: any) {
            path.replaceWith(t.returnStatement(t.booleanLiteral(false)));
        },

        // Variable Declaration Lexical Scoping const/var -> let
        VariableDeclaration(path: any) {
            path.node.kind = "let";

            // Split multi-declarator variable declarations
            if (path.node.declarations.length > 1) {
                const isForInit = path.parentPath.isForStatement({ init: path.node });
                const splitDecls = path.node.declarations.map((decl: any) => 
                    t.variableDeclaration("let", [t.cloneNode(decl)])
                );
                if (isForInit) {
                    path.parentPath.insertBefore(splitDecls);
                    path.parentPath.node.init = null;
                } else {
                    path.replaceWithMultiple(splitDecls);
                }
                return;
            }

            // Destructuring
            const hasPattern = path.node.declarations.some((dec: any) => t.isPattern(dec.id));
            if (hasPattern) {
                const newDeclarations: any[] = [];
                const extraStatements: any[] = [];

                for (const dec of path.node.declarations) {
                    if (t.isPattern(dec.id)) {
                        const initExpr = dec.init || t.nullLiteral();
                        let tempId: any;
                        if (t.isIdentifier(initExpr)) {
                            tempId = initExpr;
                        } else {
                            tempId = path.scope.generateUidIdentifier("destruct_target");
                            newDeclarations.push(t.variableDeclarator(tempId, initExpr));
                        }
                        expandPattern(dec.id, tempId, newDeclarations, extraStatements, path.scope);
                    } else {
                        newDeclarations.push(dec);
                    }
                }

                const varDecl = t.variableDeclaration("let", newDeclarations);
                if (extraStatements.length > 0) {
                    path.replaceWith(varDecl);
                    path.insertAfter(extraStatements);
                } else {
                    path.replaceWith(varDecl);
                }
            }
        },

        // Parameter Destructuring & Default Values
        Function(path: any) {
            const newBodyStmts: any[] = [];
            const newParams: any[] = [];

            path.node.params.forEach((param: any, idx: number) => {
                if (t.isIdentifier(param)) {
                    newParams.push(param);
                } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
                    // Default parameters
                    const paramId = param.left;
                    const defaultVal = param.right;
                    newParams.push(paramId);
                    newBodyStmts.push(
                        t.ifStatement(
                            t.binaryExpression("==", paramId, t.nullLiteral()),
                            t.blockStatement([
                                t.expressionStatement(t.assignmentExpression("=", paramId, defaultVal))
                            ])
                        )
                    );
                } else if (t.isPattern(param)) {
                    const tempArgId = path.scope.generateUidIdentifier(`arg_${idx}`);
                    newParams.push(tempArgId);
                    
                    const decls: any[] = [];
                    const stmts: any[] = [];
                    expandPattern(param, tempArgId, decls, stmts, path.scope);
                    if (decls.length > 0) {
                        newBodyStmts.push(t.variableDeclaration("let", decls));
                    }
                    newBodyStmts.push(...stmts);
                } else {
                    newParams.push(path.scope.generateUidIdentifier(`arg_${idx}`));
                }
            });

            path.node.params = newParams;
            if (newBodyStmts.length > 0) {
                if (t.isBlockStatement(path.node.body)) {
                    path.node.body.body.unshift(...newBodyStmts);
                }
            }
        },

        // Destructuring assignment expressions: [a, b] = target;
        AssignmentExpression(path: any) {
            const left = path.node.left;
            const right = path.node.right;

            // ReflectSet key-tracking for member expression assignment
            if (t.isMemberExpression(left)) {
                const prop = left.property;
                if (t.isIdentifier(prop) && !left.computed) {
                    const name = prop.name;
                    if (['__ownKeys', 'keys', 'values', 'size', 'ip', 'done', 'value'].includes(name)) {
                        return;
                    }
                }
                const obj = left.object;
                
                let keyExpr: any = prop;
                if (t.isIdentifier(prop) && !left.computed) {
                    keyExpr = t.stringLiteral(prop.name);
                }
                
                path.replaceWith(t.callExpression(t.identifier("ReflectSet"), [obj, keyExpr, right]));
                usedStdlibSet.add('ReflectSet');
                return;
            }

            // Logical assignments
            if (path.node.operator === "&&=" || path.node.operator === "||=" || path.node.operator === "??=") {
                const op = path.node.operator;
                if (path.parentPath.isExpressionStatement()) {
                    let ifStmt: any;
                    if (op === "&&=") {
                        ifStmt = t.ifStatement(left, t.blockStatement([
                            t.expressionStatement(t.assignmentExpression("=", left, right))
                        ]));
                    } else if (op === "||=") {
                        ifStmt = t.ifStatement(t.unaryExpression("!", left), t.blockStatement([
                            t.expressionStatement(t.assignmentExpression("=", left, right))
                        ]));
                    } else {
                        ifStmt = t.ifStatement(t.binaryExpression("==", left, t.nullLiteral()), t.blockStatement([
                            t.expressionStatement(t.assignmentExpression("=", left, right))
                        ]));
                    }
                    path.parentPath.replaceWith(ifStmt);
                }
                return;
            }

            if (t.isPattern(left)) {
                if (path.parentPath.isExpressionStatement()) {
                    const decls: any[] = [];
                    const stmts: any[] = [];
                    const tempId = path.scope.generateUidIdentifier("destruct_assign");
                    decls.push(t.variableDeclarator(tempId, right));
                    expandPattern(left, tempId, decls, stmts, path.scope);

                    const finalStmts: any[] = [
                        t.variableDeclaration("let", decls),
                        ...stmts
                    ];
                    path.parentPath.replaceWithMultiple(finalStmts);
                } else {
                    throw new Error("Destructuring assignment is only supported in expression statements");
                }
            }
        },

        // Operators: ===, !==, **, in, instanceof
        BinaryExpression(path: any) {
            const node = path.node;
            if (node.operator === "===") {
                // Emit warning for objects/arrays comparison
                warnings.push({
                    line: node.loc ? node.loc.start.line : 0,
                    message: "Reference equality is not preserved across the VM boundary. Use deep equality instead.",
                    suggestion: "Replace === with deep equality check."
                });
            } else if (node.operator === "!==") {
                warnings.push({
                    line: node.loc ? node.loc.start.line : 0,
                    message: "Reference equality is not preserved across the VM boundary. Use deep equality instead.",
                    suggestion: "Replace !== with deep equality check."
                });
            } else if (node.operator === "**") {
                path.replaceWith(t.callExpression(t.identifier("MathPow"), [node.left, node.right]));
            } else if (node.operator === "in") {
                const left = path.node.left;
                const right = path.node.right;
                // Map key in obj to obj[key] !== null
                path.replaceWith(t.binaryExpression("!=", t.memberExpression(right, left, true), t.nullLiteral()));
            } else if (node.operator === "instanceof") {
                // Map x instanceof Object / Array to TypeOf(x) == "object"
                path.replaceWith(t.binaryExpression("==", t.callExpression(t.identifier("TypeOf"), [path.node.left]), t.stringLiteral("object")));
            }
        },

        // Optional Chaining: a?.b
        OptionalMemberExpression(path: any) {
            const object = path.node.object;
            const property = path.node.property;
            const computed = path.node.computed;

            const tempId = path.scope.generateUidIdentifier("opt");
            const parentStmt = path.getStatementParent();
            if (parentStmt) {
                parentStmt.insertBefore(t.variableDeclaration("let", [t.variableDeclarator(tempId, object)]));
            }
            
            const cond = t.conditionalExpression(
                t.binaryExpression("==", tempId, t.nullLiteral()),
                t.nullLiteral(),
                t.memberExpression(tempId, property, computed)
            );
            path.replaceWith(cond);
        },

        // Nullish Coalescing: a ?? b
        LogicalExpression(path: any) {
            if (path.node.operator === "??") {
                const left = path.node.left;
                const right = path.node.right;
                const tempId = path.scope.generateUidIdentifier("nullish");
                
                const parentStmt = path.getStatementParent();
                if (parentStmt) {
                    parentStmt.insertBefore(t.variableDeclaration("let", [t.variableDeclarator(tempId, left)]));
                }
                
                const cond = t.conditionalExpression(
                    t.binaryExpression("==", tempId, t.nullLiteral()),
                    right,
                    tempId
                );
                path.replaceWith(cond);
            }
        },

        // typeof UnaryExpression
        UnaryExpression(path: any) {
            if (path.node.operator === "typeof") {
                path.replaceWith(t.callExpression(t.identifier("TypeOf"), [path.node.argument]));
            }
        },

        // template literals
        TemplateLiteral(path: any) {
            const node = path.node;
            const parts: any[] = [];
            for (let i = 0; i < node.quasis.length; i++) {
                const quasi = node.quasis[i];
                if (quasi.value.cooked) {
                    parts.push(t.stringLiteral(quasi.value.cooked));
                }
                if (i < node.expressions.length) {
                    parts.push(node.expressions[i]);
                }
            }
            const filteredParts = parts.filter(p => !(t.isStringLiteral(p) && p.value === ""));
            if (filteredParts.length === 0) {
                path.replaceWith(t.stringLiteral(""));
                return;
            }
            let result = filteredParts[filteredParts.length - 1];
            for (let i = filteredParts.length - 2; i >= 0; i--) {
                result = t.callExpression(t.identifier("StrConcat"), [filteredParts[i], result]);
            }
            path.replaceWith(result);
        },

        // for...of loops
        ForOfStatement(path: any) {
            const node = path.node;
            const left = node.left;
            const right = node.right;
            const body = node.body;
            
            const iId = path.scope.generateUidIdentifier("i");
            const rightId = path.scope.generateUidIdentifier("arr");
            
            const loopBody: any[] = [];
            let decl: any;
            if (t.isVariableDeclaration(left)) {
                decl = t.variableDeclaration(left.kind, [
                    t.variableDeclarator(left.declarations[0].id, t.memberExpression(rightId, iId, true))
                ]);
            } else {
                decl = t.variableDeclaration("let", [
                    t.variableDeclarator(left, t.memberExpression(rightId, iId, true))
                ]);
            }
            
            loopBody.push(decl);
            if (t.isBlockStatement(body)) {
                loopBody.push(...body.body);
            } else {
                loopBody.push(body);
            }
            loopBody.push(t.expressionStatement(t.assignmentExpression("=", iId, t.binaryExpression("+", iId, t.numericLiteral(1)))));
            
            const setup = [
                t.variableDeclaration("let", [t.variableDeclarator(rightId, right)]),
                t.variableDeclaration("let", [t.variableDeclarator(iId, t.numericLiteral(0))])
            ];
            
            const whileLoop = t.whileStatement(
                t.binaryExpression("<", iId, t.callExpression(t.identifier("len"), [rightId])),
                t.blockStatement(loopBody)
            );
            
            path.replaceWithMultiple([...setup, whileLoop]);
        },

        // MemberExpression mappings (e.g. s.length)
        MemberExpression(path: any) {
            const node = path.node;
            const obj = node.object;
            const prop = node.property;
            if (t.isIdentifier(prop) && !node.computed) {
                if (prop.name === 'length') {
                    path.replaceWith(t.callExpression(t.identifier("len"), [obj]));
                }
            }
        },

        // CallExpression mappings (Math, String, Array methods)
        CallExpression(path: any) {
            const node = path.node;
            const callee = node.callee;

            // Static JSON string eval() mapping
            if (t.isIdentifier(callee) && callee.name === 'eval') {
                const arg = node.arguments[0];
                if (arg && t.isStringLiteral(arg)) {
                    try {
                        JSON.parse(arg.value);
                        path.replaceWith(t.callExpression(t.identifier("JSONParse"), [arg]));
                        usedStdlibSet.add('JSONParse');
                        return;
                    } catch (e) {
                        // Not static JSON, let it fall through
                    }
                }
            }

            // Reflect methods mapping
            if (t.isMemberExpression(callee) && t.isIdentifier(callee.object) && callee.object.name === 'Reflect') {
                const prop = callee.property;
                if (t.isIdentifier(prop) && !callee.computed) {
                    const name = prop.name;
                    if (name === 'get') {
                        const target = node.arguments[0];
                        const key = node.arguments[1];
                        path.replaceWith(t.memberExpression(target, key, true));
                        return;
                    } else if (name === 'set') {
                        const target = node.arguments[0];
                        const key = node.arguments[1];
                        const val = node.arguments[2];
                        path.replaceWith(t.callExpression(t.identifier("ReflectSet"), [target, key, val]));
                        usedStdlibSet.add('ReflectSet');
                        return;
                    } else if (name === 'has') {
                        const target = node.arguments[0];
                        const key = node.arguments[1];
                        path.replaceWith(t.callExpression(t.identifier("ReflectHas"), [target, key]));
                        usedStdlibSet.add('ReflectHas');
                        return;
                    } else if (name === 'ownKeys') {
                        const target = node.arguments[0];
                        path.replaceWith(t.callExpression(t.identifier("ReflectOwnKeys"), [target]));
                        usedStdlibSet.add('ReflectOwnKeys');
                        return;
                    }
                }
            }

            if (t.isMemberExpression(callee)) {
                const obj = callee.object;
                const prop = callee.property;
                if (t.isIdentifier(prop) && !callee.computed) {
                    const name = prop.name;

                    // 1. Math methods
                    if (t.isIdentifier(obj) && obj.name === 'Math') {
                        if (name === 'random') {
                            path.replaceWith(t.callExpression(t.identifier("MathRandom"), []));
                        } else if (name === 'PI') {
                            path.replaceWith(t.numericLiteral(3.141592653589793));
                        } else if (name === 'E') {
                            path.replaceWith(t.numericLiteral(2.718281828459045));
                        } else if (name === 'hypot') {
                            const args = node.arguments;
                            if (args.length <= 2) {
                                path.replaceWith(t.callExpression(t.identifier("MathHypot"), args));
                            } else {
                                // MathSqrt(a*a + b*b + c*c)
                                let sum: any = t.binaryExpression("*", args[0], args[0]);
                                for (let i = 1; i < args.length; i++) {
                                    sum = t.binaryExpression("+", sum, t.binaryExpression("*", args[i], args[i]));
                                }
                                path.replaceWith(t.callExpression(t.identifier("MathSqrt"), [sum]));
                            }
                        } else {
                            const mappedName = `Math${name.charAt(0).toUpperCase()}${name.slice(1)}`;
                            path.replaceWith(t.callExpression(t.identifier(mappedName), node.arguments));
                        }
                        return;
                    }

                    // 2. Map / Set methods
                    const objType = t.isIdentifier(obj) ? variableTypes.get(obj.name) : null;
                    const isAmbiguousMapSet = ['set', 'get', 'has', 'delete', 'clear', 'keys', 'values', 'add'].includes(name);

                    if (objType === 'Map' || objType === 'Set') {
                        if (objType === 'Map') {
                            usedStdlibSet.add('map_new');
                            if (name === 'set') {
                                usedStdlibSet.add('map_set');
                                path.replaceWith(t.assignmentExpression("=", obj, t.callExpression(t.identifier("map_set"), [obj, node.arguments[0], node.arguments[1]])));
                            } else if (name === 'get') {
                                usedStdlibSet.add('map_get');
                                path.replaceWith(t.callExpression(t.identifier("map_get"), [obj, node.arguments[0]]));
                            } else if (name === 'has') {
                                usedStdlibSet.add('map_has');
                                path.replaceWith(t.callExpression(t.identifier("map_has"), [obj, node.arguments[0]]));
                            } else if (name === 'delete') {
                                usedStdlibSet.add('map_delete');
                                path.replaceWith(t.assignmentExpression("=", obj, t.callExpression(t.identifier("map_delete"), [obj, node.arguments[0]])));
                            } else if (name === 'clear') {
                                usedStdlibSet.add('map_clear');
                                path.replaceWith(t.assignmentExpression("=", obj, t.callExpression(t.identifier("map_clear"), [obj])));
                            } else if (name === 'keys') {
                                usedStdlibSet.add('map_keys');
                                path.replaceWith(t.callExpression(t.identifier("map_keys"), [obj]));
                            } else if (name === 'values') {
                                usedStdlibSet.add('map_values_list');
                                path.replaceWith(t.callExpression(t.identifier("map_values_list"), [obj]));
                            }
                        } else {
                            usedStdlibSet.add('set_new');
                            if (name === 'add') {
                                usedStdlibSet.add('set_add');
                                path.replaceWith(t.assignmentExpression("=", obj, t.callExpression(t.identifier("set_add"), [obj, node.arguments[0]])));
                            } else if (name === 'has') {
                                usedStdlibSet.add('set_has');
                                path.replaceWith(t.callExpression(t.identifier("set_has"), [obj, node.arguments[0]]));
                            } else if (name === 'delete') {
                                usedStdlibSet.add('set_delete');
                                path.replaceWith(t.assignmentExpression("=", obj, t.callExpression(t.identifier("set_delete"), [obj, node.arguments[0]])));
                            } else if (name === 'clear') {
                                usedStdlibSet.add('set_clear');
                                path.replaceWith(t.assignmentExpression("=", obj, t.callExpression(t.identifier("set_clear"), [obj])));
                            } else if (name === 'values' || name === 'keys') {
                                usedStdlibSet.add('set_values_list');
                                path.replaceWith(t.callExpression(t.identifier("set_values_list"), [obj]));
                            }
                        }
                        return;
                    } else if (isAmbiguousMapSet) {
                        if (name === 'get') {
                            usedStdlibSet.add('fvm_get');
                            usedStdlibSet.add('map_get');
                            path.replaceWith(t.callExpression(t.identifier("fvm_get"), [obj, node.arguments[0]]));
                        } else if (name === 'set') {
                            usedStdlibSet.add('fvm_set');
                            usedStdlibSet.add('map_set');
                            path.replaceWith(t.assignmentExpression("=", obj, t.callExpression(t.identifier("fvm_set"), [obj, node.arguments[0], node.arguments[1]])));
                        } else if (name === 'has') {
                            usedStdlibSet.add('fvm_has');
                            usedStdlibSet.add('map_has');
                            usedStdlibSet.add('set_has');
                            path.replaceWith(t.callExpression(t.identifier("fvm_has"), [obj, node.arguments[0]]));
                        } else if (name === 'delete') {
                            usedStdlibSet.add('fvm_delete');
                            usedStdlibSet.add('map_delete');
                            usedStdlibSet.add('set_delete');
                            path.replaceWith(t.assignmentExpression("=", obj, t.callExpression(t.identifier("fvm_delete"), [obj, node.arguments[0]])));
                        } else if (name === 'clear') {
                            usedStdlibSet.add('fvm_clear');
                            usedStdlibSet.add('map_clear');
                            usedStdlibSet.add('set_clear');
                            path.replaceWith(t.assignmentExpression("=", obj, t.callExpression(t.identifier("fvm_clear"), [obj])));
                        } else if (name === 'add') {
                            usedStdlibSet.add('fvm_add');
                            usedStdlibSet.add('set_add');
                            path.replaceWith(t.assignmentExpression("=", obj, t.callExpression(t.identifier("fvm_add"), [obj, node.arguments[0]])));
                        } else if (name === 'keys') {
                            usedStdlibSet.add('fvm_keys');
                            usedStdlibSet.add('map_keys');
                            path.replaceWith(t.callExpression(t.identifier("fvm_keys"), [obj]));
                        } else if (name === 'values') {
                            usedStdlibSet.add('fvm_values');
                            usedStdlibSet.add('map_values_list');
                            usedStdlibSet.add('set_values_list');
                            path.replaceWith(t.callExpression(t.identifier("fvm_values"), [obj]));
                        }
                        return;
                    }

                    // 3. String & Array slice / at
                    if (name === 'slice' || name === 'at') {
                        const type = t.isIdentifier(obj) ? variableTypes.get(obj.name) : null;
                        if (name === 'slice') {
                            if (type === 'string') {
                                path.replaceWith(t.callExpression(t.identifier("StrSlice"), [obj, node.arguments[0], node.arguments[1] || t.nullLiteral()]));
                            } else if (type === 'array') {
                                path.replaceWith(t.callExpression(t.identifier("ArrSlice"), [obj, node.arguments[0], node.arguments[1] || t.nullLiteral()]));
                            } else {
                                usedStdlibSet.add('fvm_slice');
                                usedStdlibSet.add('StrSlice');
                                usedStdlibSet.add('ArrSlice');
                                path.replaceWith(t.callExpression(t.identifier("fvm_slice"), [obj, node.arguments[0], node.arguments[1] || t.nullLiteral()]));
                            }
                        } else {
                            // at(i)
                            const i = node.arguments[0];
                            if (type === 'string') {
                                path.replaceWith(t.callExpression(t.identifier("StrAt"), [obj, i]));
                            } else if (type === 'array') {
                                const idxId = path.scope.generateUidIdentifier("idx");
                                const parentStmt = path.getStatementParent();
                                if (parentStmt) {
                                    parentStmt.insertBefore([
                                        t.variableDeclaration("let", [
                                            t.variableDeclarator(idxId, i)
                                        ]),
                                        t.ifStatement(
                                            t.binaryExpression("<", idxId, t.numericLiteral(0)),
                                            t.blockStatement([
                                                t.expressionStatement(
                                                    t.assignmentExpression("=", idxId, t.binaryExpression("+", t.callExpression(t.identifier("len"), [obj]), idxId))
                                                )
                                            ])
                                        )
                                    ]);
                                }
                                path.replaceWith(t.memberExpression(obj, idxId, true));
                            } else {
                                usedStdlibSet.add('fvm_at');
                                usedStdlibSet.add('StrAt');
                                path.replaceWith(t.callExpression(t.identifier("fvm_at"), [obj, i]));
                            }
                        }
                        return;
                    }

                    // 4. String methods
                    const stringUnary = ['toLowerCase', 'toUpperCase', 'trim', 'trimStart', 'trimEnd'];
                    const stringBinary = ['indexOf', 'lastIndexOf', 'split', 'repeat', 'startsWith', 'endsWith', 'includes', 'charAt', 'charCodeAt'];
                    
                    if (stringUnary.includes(name)) {
                        const mapped = `Str${name.charAt(0).toUpperCase()}${name.slice(1)}`;
                        path.replaceWith(t.callExpression(t.identifier(mapped), [obj]));
                        return;
                    }
                    if (stringBinary.includes(name)) {
                        if (name === 'charAt') {
                            path.replaceWith(t.memberExpression(obj, node.arguments[0], true));
                            return;
                        }
                        if (name === 'split' && t.isRegExpLiteral(node.arguments[0])) {
                            const pat = node.arguments[0].pattern;
                            checkRegExpSafety(pat, node.loc ? node.loc.start.line : 0);
                            path.replaceWith(t.callExpression(t.identifier("RegExSplit"), [t.stringLiteral(pat), obj]));
                            return;
                        }
                        const mapped = `Str${name.charAt(0).toUpperCase()}${name.slice(1)}`;
                        path.replaceWith(t.callExpression(t.identifier(mapped), [obj, node.arguments[0]]));
                        return;
                    }
                    if (name === 'substring') {
                        path.replaceWith(t.callExpression(t.identifier("StrSubstring"), [obj, node.arguments[0], node.arguments[1] || t.nullLiteral()]));
                        return;
                    }
                    if (name === 'replace' || name === 'replaceAll') {
                        const arg0 = node.arguments[0];
                        if (t.isRegExpLiteral(arg0)) {
                            const pat = arg0.pattern;
                            checkRegExpSafety(pat, node.loc ? node.loc.start.line : 0);
                            path.replaceWith(t.callExpression(t.identifier("RegExReplace"), [t.stringLiteral(pat), obj, node.arguments[1]]));
                        } else {
                            const mapped = name === 'replace' ? "StrReplace" : "StrReplaceAll";
                            path.replaceWith(t.callExpression(t.identifier(mapped), [obj, arg0, node.arguments[1]]));
                        }
                        return;
                    }
                    if (name === 'match') {
                        const arg0 = node.arguments[0];
                        if (t.isRegExpLiteral(arg0)) {
                            const pat = arg0.pattern;
                            checkRegExpSafety(pat, node.loc ? node.loc.start.line : 0);
                            path.replaceWith(t.callExpression(t.identifier("RegExMatch"), [t.stringLiteral(pat), obj]));
                        } else {
                            path.replaceWith(t.callExpression(t.identifier("RegExMatch"), [arg0, obj]));
                        }
                        return;
                    }
                    if (name === 'padStart' || name === 'padEnd') {
                        const mapped = `Str${name.charAt(0).toUpperCase()}${name.slice(1)}`;
                        path.replaceWith(t.callExpression(t.identifier(mapped), [obj, node.arguments[0], node.arguments[1] || t.stringLiteral(" ")]));
                        return;
                    }

                    // 5. RegExp methods on Literal RegExp
                    if (t.isRegExpLiteral(obj)) {
                        const pat = obj.pattern;
                        checkRegExpSafety(pat, node.loc ? node.loc.start.line : 0);
                        if (name === 'test') {
                            path.replaceWith(t.callExpression(t.identifier("RegExTest"), [t.stringLiteral(pat), node.arguments[0]]));
                        } else if (name === 'exec') {
                            path.replaceWith(t.callExpression(t.identifier("RegExMatch"), [t.stringLiteral(pat), node.arguments[0]]));
                        }
                        return;
                    }

                    // 6. Array mutation methods (MANDATORY: Mutate in place via try_borrow_mut opcodes!)
                    if (name === 'push' || name === 'unshift') {
                        const mapped = name === 'push' ? "ArrPush" : "ArrUnshift";
                        path.replaceWith(t.callExpression(t.identifier(mapped), [obj, node.arguments[0]]));
                        return;
                    }
                    if (name === 'pop' || name === 'shift') {
                        const mapped = name === 'pop' ? "ArrPop" : "ArrShift";
                        path.replaceWith(t.callExpression(t.identifier(mapped), [obj]));
                        return;
                    }
                    if (name === 'reverse') {
                        path.replaceWith(t.callExpression(t.identifier("ArrReverse"), [obj]));
                        return;
                    }
                    if (name === 'fill') {
                        path.replaceWith(t.callExpression(t.identifier("ArrFill"), [
                            obj,
                            node.arguments[0],
                            node.arguments[1] || t.numericLiteral(0),
                            node.arguments[2] || t.nullLiteral()
                        ]));
                        return;
                    }
                    if (name === 'sort') {
                        const arg = node.arguments[0];
                        if (!arg) {
                            path.replaceWith(t.callExpression(t.identifier("ArrSortString"), [obj]));
                        } else {
                            // Custom comparator sort -> merge sort compilation!
                            const mergesortName = `__mergesort_${mergesortCounter}`;
                            const mergeName = `__merge_${mergesortCounter}`;
                            mergesortCounter++;

                            // Extract the inline comparator code block
                            const leftVal = t.identifier("leftVal");
                            const rightVal = t.identifier("rightVal");
                            const compRes = t.identifier("compRes");

                            let inlinedStmts: any[];
                            if (t.isFunction(arg)) {
                                const bodyCopy = t.cloneNode(arg.body);
                                const paramA = arg.params[0] as any;
                                const paramB = arg.params[1] as any;
                                const paramAName = paramA.name;
                                const paramBName = paramB.name;

                                if (!t.isBlockStatement(bodyCopy)) {
                                    const expr = t.cloneNode(bodyCopy);
                                    replaceIdentifier(expr, paramAName, "leftVal");
                                    replaceIdentifier(expr, paramBName, "rightVal");
                                    inlinedStmts = [t.expressionStatement(t.assignmentExpression("=", compRes, expr))];
                                } else {
                                    replaceIdentifier(bodyCopy, paramAName, "leftVal");
                                    replaceIdentifier(bodyCopy, paramBName, "rightVal");
                                    traverseReplaceReturns(bodyCopy, compRes);
                                    inlinedStmts = bodyCopy.body;
                                }
                            } else {
                                inlinedStmts = [
                                    t.expressionStatement(t.assignmentExpression("=", compRes, t.callExpression(arg, [leftVal, rightVal])))
                                ];
                            }

                            // Generate merge and mergesort code strings
                            const dummyMergeProgram = t.program(inlinedStmts);
                            const inlinedCode = generate(dummyMergeProgram).code;

                            const mergeCode = `
fn ${mergeName}(arr, lo, mid, hi) {
    let temp = [];
    let i = lo;
    let j = mid;
    while (i < mid && j < hi) {
        let leftVal = arr[i];
        let rightVal = arr[j];
        let compRes = 0;
        ${inlinedCode}
        if (compRes <= 0) {
            temp = listPush(temp, leftVal);
            i = i + 1;
        } else {
            temp = listPush(temp, rightVal);
            j = j + 1;
        }
    }
    while (i < mid) {
        temp = listPush(temp, arr[i]);
        i = i + 1;
    }
    while (j < hi) {
        temp = listPush(temp, arr[j]);
        j = j + 1;
    }
    let k = 0;
    while (k < len(temp)) {
        arr[lo + k] = temp[k];
        k = k + 1;
    }
    return arr;
}
`;
                            const mergesortCode = `
fn ${mergesortName}(arr, lo, hi) {
    if (hi - lo <= 1) { return arr; }
    let mid = MathFloor(lo + (hi - lo) / 2);
    arr = ${mergesortName}(arr, lo, mid);
    arr = ${mergesortName}(arr, mid, hi);
    arr = ${mergeName}(arr, lo, mid, hi);
    return arr;
}
`;
                            extraDeclarations.push(mergeCode, mergesortCode);
                            path.replaceWith(t.callExpression(t.identifier(mergesortName), [obj, t.numericLiteral(0), t.callExpression(t.identifier("len"), [obj])]));
                        }
                        return;
                    }

                    // 7. Array splice, join, concat
                    if (name === 'join') {
                        path.replaceWith(t.callExpression(t.identifier("ArrJoin"), [obj, node.arguments[0] || t.stringLiteral(",")]));
                        return;
                    }
                    if (name === 'splice') {
                        const start = node.arguments[0];
                        const deleteCount = node.arguments[1] || t.binaryExpression("-", t.callExpression(t.identifier("len"), [obj]), start);
                        const items = node.arguments.slice(2);
                        
                        // Inline splicing mutation
                        const prefixId = path.scope.generateUidIdentifier("prefix");
                        const suffixId = path.scope.generateUidIdentifier("suffix");
                        const itemsId = path.scope.generateUidIdentifier("items");
                        
                        const parentStmt = path.getStatementParent();
                        if (parentStmt) {
                            parentStmt.insertBefore([
                                t.variableDeclaration("let", [
                                    t.variableDeclarator(prefixId, t.callExpression(t.identifier("ArrSlice"), [obj, t.numericLiteral(0), start])),
                                    t.variableDeclarator(suffixId, t.callExpression(t.identifier("ArrSlice"), [obj, t.binaryExpression("+", start, deleteCount), t.nullLiteral()])),
                                    t.variableDeclarator(itemsId, t.arrayExpression(items as any))
                                ]),
                                t.whileStatement(
                                    t.binaryExpression(">", t.callExpression(t.identifier("len"), [obj]), t.numericLiteral(0)),
                                    t.blockStatement([
                                        t.expressionStatement(t.callExpression(t.identifier("ArrPop"), [obj]))
                                    ])
                                ),
                                // Repopulate
                                t.variableDeclaration("let", [t.variableDeclarator(t.identifier("__splice_idx"), t.numericLiteral(0))]),
                                t.whileStatement(
                                    t.binaryExpression("<", t.identifier("__splice_idx"), t.callExpression(t.identifier("len"), [prefixId])),
                                    t.blockStatement([
                                        t.expressionStatement(t.callExpression(t.identifier("ArrPush"), [obj, t.memberExpression(prefixId, t.identifier("__splice_idx"), true)])),
                                        t.expressionStatement(t.assignmentExpression("=", t.identifier("__splice_idx"), t.binaryExpression("+", t.identifier("__splice_idx"), t.numericLiteral(1))))
                                    ])
                                ),
                                t.expressionStatement(t.assignmentExpression("=", t.identifier("__splice_idx"), t.numericLiteral(0))),
                                t.whileStatement(
                                    t.binaryExpression("<", t.identifier("__splice_idx"), t.callExpression(t.identifier("len"), [itemsId])),
                                    t.blockStatement([
                                        t.expressionStatement(t.callExpression(t.identifier("ArrPush"), [obj, t.memberExpression(itemsId, t.identifier("__splice_idx"), true)])),
                                        t.expressionStatement(t.assignmentExpression("=", t.identifier("__splice_idx"), t.binaryExpression("+", t.identifier("__splice_idx"), t.numericLiteral(1))))
                                    ])
                                ),
                                t.expressionStatement(t.assignmentExpression("=", t.identifier("__splice_idx"), t.numericLiteral(0))),
                                t.whileStatement(
                                    t.binaryExpression("<", t.identifier("__splice_idx"), t.callExpression(t.identifier("len"), [suffixId])),
                                    t.blockStatement([
                                        t.expressionStatement(t.callExpression(t.identifier("ArrPush"), [obj, t.memberExpression(suffixId, t.identifier("__splice_idx"), true)])),
                                        t.expressionStatement(t.assignmentExpression("=", t.identifier("__splice_idx"), t.binaryExpression("+", t.identifier("__splice_idx"), t.numericLiteral(1))))
                                    ])
                                )
                            ]);
                        }
                        path.replaceWith(obj);
                        return;
                    }
                    if (name === 'concat') {
                        const args = node.arguments;
                        const resId = path.scope.generateUidIdentifier("concat_res");
                        const parentStmt = path.getStatementParent();

                        if (parentStmt) {
                            parentStmt.insertBefore(t.variableDeclaration("let", [
                                t.variableDeclarator(resId, t.callExpression(t.identifier("ArrSlice"), [obj, t.numericLiteral(0), t.nullLiteral()]))
                            ]));

                            for (const arg of args) {
                                const argTemp = path.scope.generateUidIdentifier("concat_arg");
                                const loopIdx = path.scope.generateUidIdentifier("concat_idx");
                                
                                const isArrayCheck = t.logicalExpression("&&",
                                    t.binaryExpression("==",
                                        t.callExpression(t.identifier("TypeOf"), [argTemp]),
                                        t.stringLiteral("object")
                                    ),
                                    t.binaryExpression("==",
                                        t.callExpression(t.identifier("StrAt"), [
                                            t.callExpression(t.identifier("JSONStringify"), [argTemp]),
                                            t.numericLiteral(0)
                                        ]),
                                        t.stringLiteral("[")
                                    )
                                );
                                
                                const loopStmts = [
                                    t.variableDeclaration("let", [t.variableDeclarator(loopIdx, t.numericLiteral(0))]),
                                    t.whileStatement(
                                        t.binaryExpression("<", loopIdx, t.callExpression(t.identifier("len"), [argTemp])),
                                        t.blockStatement([
                                            t.expressionStatement(t.callExpression(t.identifier("ArrPush"), [resId, t.memberExpression(argTemp, loopIdx, true)])),
                                            t.expressionStatement(t.assignmentExpression("=", loopIdx, t.binaryExpression("+", loopIdx, t.numericLiteral(1))))
                                        ])
                                    )
                                ];
                                
                                const pushDirect = t.expressionStatement(t.callExpression(t.identifier("ArrPush"), [resId, argTemp]));
                                
                                parentStmt.insertBefore([
                                    t.variableDeclaration("let", [t.variableDeclarator(argTemp, arg)]),
                                    t.ifStatement(
                                        isArrayCheck,
                                        t.blockStatement(loopStmts),
                                        t.blockStatement([pushDirect])
                                    )
                                ]);
                            }
                        }
                        path.replaceWith(resId);
                        return;
                    }

                    // 8. Callback array methods (.map, .filter, .reduce, etc. inlined as loops)
                    const arrayCallbacks = ['map', 'filter', 'reduce', 'find', 'findIndex', 'some', 'every', 'forEach', 'flatMap'];
                    if (arrayCallbacks.includes(name)) {
                        const callback = node.arguments[0];
                        const parentStmt = path.getStatementParent();

                        if (name === 'map') {
                            const resId = path.scope.generateUidIdentifier("map_res");
                            const iId = path.scope.generateUidIdentifier("i");
                            const valId = path.scope.generateUidIdentifier("val");
                            
                            const setup = [
                                t.variableDeclaration("let", [t.variableDeclarator(resId, t.arrayExpression([]))]),
                                t.variableDeclaration("let", [t.variableDeclarator(iId, t.numericLiteral(0))])
                            ];
                            
                            const loopBody: any[] = [
                                t.variableDeclaration("let", [t.variableDeclarator(valId, t.nullLiteral())])
                            ];
                            generateCallbackVal(callback, t.memberExpression(obj, iId, true), iId, obj, loopBody, valId, path.scope);
                            loopBody.push(t.expressionStatement(t.assignmentExpression("=", resId, t.callExpression(t.identifier("listPush"), [resId, valId]))));
                            loopBody.push(t.expressionStatement(t.assignmentExpression("=", iId, t.binaryExpression("+", iId, t.numericLiteral(1)))));
                            
                            const loop = t.whileStatement(
                                t.binaryExpression("<", iId, t.callExpression(t.identifier("len"), [obj])),
                                t.blockStatement(loopBody)
                            );
                            
                            if (parentStmt) {
                                parentStmt.insertBefore([...setup, loop]);
                            }
                            path.replaceWith(resId);
                            return;
                        }
                        if (name === 'filter') {
                            const resId = path.scope.generateUidIdentifier("filter_res");
                            const iId = path.scope.generateUidIdentifier("i");
                            const condId = path.scope.generateUidIdentifier("cond");
                            
                            const setup = [
                                t.variableDeclaration("let", [t.variableDeclarator(resId, t.arrayExpression([]))]),
                                t.variableDeclaration("let", [t.variableDeclarator(iId, t.numericLiteral(0))])
                            ];
                            
                            const loopBody: any[] = [
                                t.variableDeclaration("let", [t.variableDeclarator(condId, t.booleanLiteral(false))])
                            ];
                            generateCallbackVal(callback, t.memberExpression(obj, iId, true), iId, obj, loopBody, condId, path.scope);
                            loopBody.push(t.ifStatement(
                                condId,
                                t.blockStatement([
                                    t.expressionStatement(t.assignmentExpression("=", resId, t.callExpression(t.identifier("listPush"), [resId, t.memberExpression(obj, iId, true)])))
                                ])
                            ));
                            loopBody.push(t.expressionStatement(t.assignmentExpression("=", iId, t.binaryExpression("+", iId, t.numericLiteral(1)))));
                            
                            const loop = t.whileStatement(
                                t.binaryExpression("<", iId, t.callExpression(t.identifier("len"), [obj])),
                                t.blockStatement(loopBody)
                            );
                            
                            if (parentStmt) {
                                parentStmt.insertBefore([...setup, loop]);
                            }
                            path.replaceWith(resId);
                            return;
                        }
                        if (name === 'reduce') {
                            const accId = path.scope.generateUidIdentifier("acc");
                            const iId = path.scope.generateUidIdentifier("i");
                            const init = node.arguments[1] || t.nullLiteral();
                            
                            const setup = [
                                t.variableDeclaration("let", [t.variableDeclarator(accId, init)]),
                                t.variableDeclaration("let", [t.variableDeclarator(iId, t.numericLiteral(0))])
                            ];
                            
                            const loopBody: any[] = [];
                            const nextAccId = path.scope.generateUidIdentifier("next_acc");
                            loopBody.push(t.variableDeclaration("let", [t.variableDeclarator(nextAccId, t.nullLiteral())]));
                            
                            generateReduceCallbackVal(callback, accId, t.memberExpression(obj, iId, true), iId, obj, loopBody, nextAccId, path.scope);
                            loopBody.push(t.expressionStatement(t.assignmentExpression("=", accId, nextAccId)));
                            loopBody.push(t.expressionStatement(t.assignmentExpression("=", iId, t.binaryExpression("+", iId, t.numericLiteral(1)))));
                            
                            const loop = t.whileStatement(
                                t.binaryExpression("<", iId, t.callExpression(t.identifier("len"), [obj])),
                                t.blockStatement(loopBody)
                            );
                            
                            if (parentStmt) {
                                parentStmt.insertBefore([...setup, loop]);
                            }
                            path.replaceWith(accId);
                            return;
                        }
                        if (name === 'find' || name === 'findIndex') {
                            const resId = path.scope.generateUidIdentifier(name === 'find' ? "find_res" : "find_idx");
                            const foundId = path.scope.generateUidIdentifier("found");
                            const iId = path.scope.generateUidIdentifier("i");
                            const condId = path.scope.generateUidIdentifier("cond");
                            
                            const setup = [
                                t.variableDeclaration("let", [t.variableDeclarator(resId, name === 'find' ? t.nullLiteral() : t.numericLiteral(-1))]),
                                t.variableDeclaration("let", [t.variableDeclarator(foundId, t.booleanLiteral(false))]),
                                t.variableDeclaration("let", [t.variableDeclarator(iId, t.numericLiteral(0))])
                            ];
                            
                            const loopBody: any[] = [
                                t.variableDeclaration("let", [t.variableDeclarator(condId, t.booleanLiteral(false))])
                            ];
                            generateCallbackVal(callback, t.memberExpression(obj, iId, true), iId, obj, loopBody, condId, path.scope);
                            loopBody.push(t.ifStatement(
                                condId,
                                t.blockStatement([
                                    t.expressionStatement(t.assignmentExpression("=", resId, name === 'find' ? t.memberExpression(obj, iId, true) : iId)),
                                    t.expressionStatement(t.assignmentExpression("=", foundId, t.booleanLiteral(true)))
                                ])
                            ));
                            loopBody.push(t.expressionStatement(t.assignmentExpression("=", iId, t.binaryExpression("+", iId, t.numericLiteral(1)))));
                            
                            const loop = t.whileStatement(
                                t.logicalExpression("&&", 
                                    t.binaryExpression("<", iId, t.callExpression(t.identifier("len"), [obj])),
                                    t.binaryExpression("==", foundId, t.booleanLiteral(false))
                                ),
                                t.blockStatement(loopBody)
                            );
                            
                            if (parentStmt) {
                                parentStmt.insertBefore([...setup, loop]);
                            }
                            path.replaceWith(resId);
                            return;
                        }
                        if (name === 'some' || name === 'every') {
                            const resId = path.scope.generateUidIdentifier(name === 'some' ? "some_res" : "every_res");
                            const iId = path.scope.generateUidIdentifier("i");
                            const condId = path.scope.generateUidIdentifier("cond");
                            
                            const setup = [
                                t.variableDeclaration("let", [t.variableDeclarator(resId, t.booleanLiteral(name === 'every'))]),
                                t.variableDeclaration("let", [t.variableDeclarator(iId, t.numericLiteral(0))])
                            ];
                            
                            const loopBody: any[] = [
                                t.variableDeclaration("let", [t.variableDeclarator(condId, t.booleanLiteral(name === 'every'))])
                            ];
                            generateCallbackVal(callback, t.memberExpression(obj, iId, true), iId, obj, loopBody, condId, path.scope);
                            if (name === 'some') {
                                loopBody.push(t.ifStatement(
                                    condId,
                                    t.blockStatement([
                                        t.expressionStatement(t.assignmentExpression("=", resId, t.booleanLiteral(true)))
                                    ])
                                ));
                            } else {
                                loopBody.push(t.ifStatement(
                                    t.unaryExpression("!", condId),
                                    t.blockStatement([
                                        t.expressionStatement(t.assignmentExpression("=", resId, t.booleanLiteral(false)))
                                    ])
                                ));
                            }
                            loopBody.push(t.expressionStatement(t.assignmentExpression("=", iId, t.binaryExpression("+", iId, t.numericLiteral(1)))));
                            
                            const loop = t.whileStatement(
                                t.logicalExpression("&&", 
                                    t.binaryExpression("<", iId, t.callExpression(t.identifier("len"), [obj])),
                                    t.binaryExpression("==", resId, t.booleanLiteral(name === 'every'))
                                ),
                                t.blockStatement(loopBody)
                            );
                            
                            if (parentStmt) {
                                parentStmt.insertBefore([...setup, loop]);
                            }
                            path.replaceWith(resId);
                            return;
                        }
                        if (name === 'forEach') {
                            const iId = path.scope.generateUidIdentifier("i");
                            const dummyValId = path.scope.generateUidIdentifier("dummy");
                            
                            const setup = [
                                t.variableDeclaration("let", [t.variableDeclarator(iId, t.numericLiteral(0))])
                            ];
                            
                            const loopBody: any[] = [
                                t.variableDeclaration("let", [t.variableDeclarator(dummyValId, t.nullLiteral())])
                            ];
                            generateCallbackVal(callback, t.memberExpression(obj, iId, true), iId, obj, loopBody, dummyValId, path.scope);
                            loopBody.push(t.expressionStatement(t.assignmentExpression("=", iId, t.binaryExpression("+", iId, t.numericLiteral(1)))));
                            
                            const loop = t.whileStatement(
                                t.binaryExpression("<", iId, t.callExpression(t.identifier("len"), [obj])),
                                t.blockStatement(loopBody)
                            );
                            
                            if (parentStmt) {
                                parentStmt.insertBefore([...setup, loop]);
                            }
                            path.replaceWith(t.identifier("undefined"));
                            return;
                        }
                        if (name === 'flatMap') {
                            const mapResId = path.scope.generateUidIdentifier("map_res");
                            const iId = path.scope.generateUidIdentifier("i");
                            const valId = path.scope.generateUidIdentifier("val");
                            
                            const setup = [
                                t.variableDeclaration("let", [t.variableDeclarator(mapResId, t.arrayExpression([]))]),
                                t.variableDeclaration("let", [t.variableDeclarator(iId, t.numericLiteral(0))])
                            ];
                            
                            const loopBody: any[] = [
                                t.variableDeclaration("let", [t.variableDeclarator(valId, t.nullLiteral())])
                            ];
                            generateCallbackVal(callback, t.memberExpression(obj, iId, true), iId, obj, loopBody, valId, path.scope);
                            loopBody.push(t.expressionStatement(t.assignmentExpression("=", mapResId, t.callExpression(t.identifier("listPush"), [mapResId, valId]))));
                            loopBody.push(t.expressionStatement(t.assignmentExpression("=", iId, t.binaryExpression("+", iId, t.numericLiteral(1)))));
                            
                            const loop = t.whileStatement(
                                t.binaryExpression("<", iId, t.callExpression(t.identifier("len"), [obj])),
                                t.blockStatement(loopBody)
                            );
                            
                            if (parentStmt) {
                                parentStmt.insertBefore([...setup, loop]);
                            }
                            path.replaceWith(t.callExpression(t.identifier("ArrFlat"), [mapResId, t.numericLiteral(1)]));
                            return;
                        }
                    }
                }
            }

            // ParseInt / ParseFloat
            if (t.isIdentifier(callee) && (callee.name === 'parseInt' || callee.name === 'parseFloat')) {
                path.replaceWith(t.callExpression(t.identifier("JSONParse"), [node.arguments[0]]));
                return;
            }

            // Array.isArray
            if (t.isMemberExpression(callee) && t.isIdentifier(callee.object) && callee.object.name === 'Array') {
                const prop = callee.property;
                if (t.isIdentifier(prop) && !callee.computed && prop.name === 'isArray') {
                    const arg = node.arguments[0];
                    path.replaceWith(
                        t.logicalExpression("&&",
                            t.binaryExpression("==",
                                t.callExpression(t.identifier("TypeOf"), [arg]),
                                t.stringLiteral("object")
                            ),
                            t.binaryExpression("==",
                                t.callExpression(t.identifier("StrAt"), [
                                    t.callExpression(t.identifier("JSONStringify"), [arg]),
                                    t.numericLiteral(0)
                                ]),
                                t.stringLiteral("[")
                            )
                        )
                    );
                    return;
                }
            }

            // JSON.parse / JSON.stringify
            if (t.isMemberExpression(callee) && t.isIdentifier(callee.object) && callee.object.name === 'JSON') {
                const prop = callee.property;
                if (t.isIdentifier(prop) && !callee.computed) {
                    if (prop.name === 'parse') {
                        path.replaceWith(t.callExpression(t.identifier("JSONParse"), [node.arguments[0]]));
                    } else if (prop.name === 'stringify') {
                        path.replaceWith(t.callExpression(t.identifier("JSONStringify"), [node.arguments[0]]));
                    }
                }
            }
        }
    });

    // 4. Transform ES6 Classes & Constructors
    traverse(ast, {
        ClassDeclaration(path: any) {
            const className = path.node.id ? path.node.id.name : "AnonymousClass";
            const fields: any[] = [];
            let constructor: any = null;
            const methods: any[] = [];

            path.node.body.body.forEach((member: any) => {
                if (t.isClassProperty(member)) {
                    fields.push(member);
                } else if (t.isClassMethod(member)) {
                    if (member.kind === 'constructor') {
                        constructor = member;
                    } else {
                        methods.push(member);
                    }
                }
            });

            // 1. Generate Constructor/Factory function
            const cParams = constructor ? constructor.params : [];
            const cBody = constructor ? constructor.body.body : [];
            
            const factoryParams = cParams.map((p: any) => t.cloneNode(p));
            const factoryBodyStmts: any[] = [
                t.variableDeclaration("let", [t.variableDeclarator(t.identifier("self"), t.objectExpression([]))])
            ];

            // Evaluate field initializers
            fields.forEach(field => {
                const key = field.key;
                const value = field.value || t.nullLiteral();
                if (t.isIdentifier(key)) {
                    factoryBodyStmts.push(
                        t.expressionStatement(t.assignmentExpression("=", t.memberExpression(t.identifier("self"), key), value))
                    );
                }
            });

            // Clone and transform constructor body: rename `this` to `self`
            cBody.forEach((stmt: any) => {
                const stmtCopy = t.cloneNode(stmt);
                replaceIdentifier(stmtCopy, "this", "self");
                factoryBodyStmts.push(stmtCopy);
            });

            factoryBodyStmts.push(t.returnStatement(t.identifier("self")));

            const factoryFunc = t.functionDeclaration(
                t.identifier(`${className}_new`),
                factoryParams,
                t.blockStatement(factoryBodyStmts)
            );
            extraFuncNodes.push(factoryFunc);

            // 2. Generate class methods
            methods.forEach(method => {
                const mName = method.key.name;
                const mParams = [t.identifier("self"), ...method.params.map((p: any) => t.cloneNode(p))];
                const mBody = t.cloneNode(method.body);

                replaceIdentifier(mBody, "this", "self");
                
                const methodFunc = t.functionDeclaration(
                    t.identifier(`${className}_${mName}`),
                    mParams,
                    mBody
                );
                extraFuncNodes.push(methodFunc);
            });

            // Replace class declaration with empty statement since we generated factory functions
            path.replaceWith(t.emptyStatement());
        },

        // Replace `new ClassName(...)` with `ClassName_new(...)`
        NewExpression(path: any) {
            const callee = path.node.callee;
            if (t.isIdentifier(callee)) {
                if (callee.name !== 'Map' && callee.name !== 'Set') {
                    path.replaceWith(t.callExpression(t.identifier(`${callee.name}_new`), path.node.arguments));
                }
            }
        }
    });

    // Apply Register Banking
    traverse(ast, {
        FunctionDeclaration(path: any) {
            applyRegisterBanking(path.node);
        }
    });

    // Call site rewriting for packed parameters
    function rewriteCallSites(node: any) {
        const fileNode = t.file(t.program(t.isProgram(node) ? node.body : [node]));
        const rewritten = new Set<any>();
        traverse(fileNode, {
            noScope: true,
            CallExpression(callPath: any) {
                if (rewritten.has(callPath.node)) return;
                const callee = callPath.node.callee;
                if (t.isIdentifier(callee) && packedFunctions.has(callee.name)) {
                    const originalParams = packedFunctions.get(callee.name);
                    if (originalParams) {
                        const props: any[] = [];
                        for (let i = 0; i < originalParams.length; i++) {
                            const paramName = originalParams[i];
                            const argVal = callPath.node.arguments[i] || t.identifier("undefined");
                            props.push(t.objectProperty(t.identifier(paramName), t.cloneNode(argVal)));
                        }
                        callPath.node.arguments = [t.objectExpression(props)];
                        rewritten.add(callPath.node);
                    }
                }
            }
        });
    }

    rewriteCallSites(ast.program);

    for (const node of extraFuncNodes) {
        rewriteCallSites(node);
        extraDeclarations.push(generate(node).code);
    }

    // Generate output code
    const generated = generate(ast, { jsescOption: { quotes: 'double' } });
    let jsCode = generated.code;

    // Append extra FVM declarations (mergesort helpers and class methods)
    if (extraDeclarations.length > 0) {
        jsCode = extraDeclarations.join("\n") + "\n" + jsCode;
    }

    // Convert JS keywords to FVM: replace 'function ' with 'fn '
    let fvmSource = jsCode.replace(/\bfunction\b/g, 'fn');

    // Wrap or compile async splitter if there are await calls
    let asyncSplit: AsyncSplitInfo | null = null;
    let jsWrapper = code; // default fallback if no awaits/no wrapping needed

    const hasAwait = code.includes("await");
    if (hasAwait) {
        const boundaryCount = (code.match(/\bawait\b/g) || []).length;
        asyncSplit = {
            boundaryCount,
            variablesPassed: []
        };
    }

    const usedStdlib = Array.from(usedStdlibSet);

    // Write wrapper
    if (isGeneratorFlag) {
        jsWrapper = `
const { FortressClient } = require('../../client.js');
let fortressClient;

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
                if (${originalParamNames.length > 2}) {
                    payloadArgs = ["new", { ${originalParamNames.map((name, i) => `"${name}": args[${i}]`).join(', ')} }];
                } else {
                    payloadArgs = ["new", ...args];
                }
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
    } else {
        jsWrapper = `
const { FortressClient } = require('../../client.js');
let fortressClient;

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

module.exports = async function(...args) {
    if (!fortressClient) {
        fortressClient = await FortressClient.init(process.env.FORTRESS_ENDPOINT || './checkLicense.json');
    }
    let payloadArgs = args;
    return await fortressClient.execute(preparePayload(payloadArgs));
};
`;
    }

    // Write TypeScript declaration
    const tsDeclaration = isGeneratorFlag
        ? `export declare function ${options.functionName}(...args: any[]): any;\n`
        : `export declare function ${options.functionName}(...args: any[]): Promise<any>;\n`;

    let finalJsWrapper = jsWrapper;
    if (hasSharedArrayBuffer) {
        finalJsWrapper = `// SharedArrayBuffer usage detected: shared memory is replaced with message-passing equivalent.\n` + finalJsWrapper;
    }
    return {
        fvmSource,
        jsWrapper: finalJsWrapper,
        tsDeclaration,
        usedStdlib,
        warnings,
        asyncSplit
    };
}

export { verifyEquivalenceSync, verifyEquivalence } from './transpiler/verifier';
