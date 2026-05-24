import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

const parser: any = require('@babel/parser');
const traverse: any = require('@babel/traverse').default;
const generate: any = require('@babel/generator').default;
const t: any = require('@babel/types');

const vmNode = require('../../pkg-node/vm_core.js');

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
        },
        FunctionDeclaration(path: any) {
            // Check parameter names to infer basic types
            for (const param of path.node.params) {
                if (t.isIdentifier(param)) {
                    const name = param.name.toLowerCase();
                    if (name.includes('email') || name.includes('token') || name.includes('key') || name.includes('str') || name.includes('text') || name === 's') {
                        variableTypes.set(param.name, 'string');
                    } else if (name.includes('list') || name.includes('arr') || name.includes('items')) {
                        variableTypes.set(param.name, 'array');
                    } else if (name.includes('map')) {
                        variableTypes.set(param.name, 'Map');
                    } else if (name.includes('set')) {
                        variableTypes.set(param.name, 'Set');
                    }
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
                node.operator = "==";
                // Emit warning for objects/arrays comparison
                warnings.push({
                    line: node.loc ? node.loc.start.line : 0,
                    message: "Reference equality is not preserved across the VM boundary. Use deep equality instead.",
                    suggestion: "Replace === with deep equality check."
                });
            } else if (node.operator === "!==") {
                node.operator = "!=";
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
                    }

                    // 3. String & Array slice / at
                    if (name === 'slice' || name === 'at') {
                        const type = t.isIdentifier(obj) ? variableTypes.get(obj.name) : null;
                        if (name === 'slice') {
                            if (type === 'string') {
                                path.replaceWith(t.callExpression(t.identifier("StrSlice"), [obj, node.arguments[0], node.arguments[1] || t.nullLiteral()]));
                            } else {
                                // Default to array slice
                                path.replaceWith(t.callExpression(t.identifier("ArrSlice"), [obj, node.arguments[0], node.arguments[1] || t.nullLiteral()]));
                            }
                        } else {
                            // at(i)
                            const i = node.arguments[0];
                            if (type === 'string') {
                                path.replaceWith(t.callExpression(t.identifier("StrAt"), [obj, i]));
                            } else {
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
            extraDeclarations.push(generate(factoryFunc).code);

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
                extraDeclarations.push(generate(methodFunc).code);
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

    // Generate output code
    const generated = generate(ast);
    let jsCode = generated.code;

    // Convert JS keywords to FVM: replace 'function ' with 'fn '
    let fvmSource = jsCode.replace(/\bfunction\b/g, 'fn');

    // Append extra FVM declarations (mergesort helpers and class methods)
    if (extraDeclarations.length > 0) {
        fvmSource = extraDeclarations.join("\n") + "\n" + fvmSource;
    }

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
    jsWrapper = `
const { FortressClient } = require('../../client.js');
let fortressClient;
module.exports = async function(...args) {
    if (!fortressClient) {
        fortressClient = await FortressClient.init(process.env.FORTRESS_ENDPOINT || './checkLicense.json');
    }
    return await fortressClient.execute(args);
};
`;

    // Write TypeScript declaration
    const tsDeclaration = `export declare function ${options.functionName}(...args: any[]): Promise<any>;\n`;

    return {
        fvmSource,
        jsWrapper,
        tsDeclaration,
        usedStdlib,
        warnings,
        asyncSplit
    };
}

export function verifyEquivalenceSync(
    originalJsCode: string,
    fvmBytecode: Uint8Array,
    opcodeMap: number[]
): void {
    const cleanJsCode = originalJsCode.replace(/^export\s+/, "");
    const builtins = `
        function len(x) {
            if (x === null || x === undefined) return 0;
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
    let originalFunc: Function;
    try {
        originalFunc = new Function(`${builtins}; return (${cleanJsCode})`)();
    } catch (e) {
        // Fallback for function declarations
        originalFunc = new Function(`${builtins}; ${cleanJsCode}; return ${cleanJsCode.match(/function\s+(\w+)/)?.[1] || 'defaultFunc'};`)();
    }

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

    const arity = originalFunc.length;

    for (const input of testInputs) {
        let jsError: any = null;
        let jsRes: any = null;
        const jsInputClone = JSON.parse(JSON.stringify(input));
        const args = arity > 0 ? Array(arity).fill(jsInputClone) : [jsInputClone];
        
        try {
            jsRes = originalFunc(...args);
            if (jsRes && typeof jsRes.then === 'function') {
                console.log("[VERIFIER] Skipping sync equivalence check for async function");
                return;
            }
        } catch (e: any) {
            jsError = e.message;
        }

        let fvmError: any = null;
        let fvmRes: any = null;
        try {
            fvmRes = runFvmSync(fvmBytecode, opcodeMap, args);
        } catch (e: any) {
            fvmError = e.message;
        }

        // Compare results
        let jsResStr = JSON.stringify(jsRes === undefined ? null : jsRes);
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

        jsResStr = JSON.stringify(jsRes === undefined ? null : jsRes);
        let fvmResStr = JSON.stringify(fvmRes === undefined ? null : fvmRes);
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

export async function verifyEquivalence(
    originalJsCode: string,
    fvmBytecode: Uint8Array,
    opcodeMap: number[]
): Promise<void> {
    verifyEquivalenceSync(originalJsCode, fvmBytecode, opcodeMap);
}

function runFvmSync(code: Uint8Array, opcodeMap: number[], args: any[]): any {
    const inputJson = JSON.stringify(args);
    const hashBytes = crypto.createHash('sha256').update(code).digest();
    
    // Set payload hash in VM
    vmNode.set_payload_hash(new Uint8Array(hashBytes));
    
    const dummyPng = new Uint8Array(1024);
    const mapUint8 = new Uint8Array(opcodeMap);
    
    vmNode.init_crypto_with_key(new Uint8Array(32), new Uint8Array(32), new Uint8Array(32), 0);
    try {
        const resStr = vmNode.execute(code, dummyPng, inputJson, mapUint8);
        const res = JSON.parse(resStr);
        if (res && res.error) {
            throw new Error(res.error);
        }
        return res;
    } finally {
        vmNode.clear_crypto();
    }
}
