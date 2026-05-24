const t: any = require('@babel/types');
const generate: any = require('@babel/generator').default;
import { deconflictScopes, renameShadowedVariables, renameVariableInBody, convertDeclarationsToAssignments } from '../analysis/scope';
import { wrapReturns, traverseReplaceReturns, replaceIdentifier } from '../helpers';
import { expandPattern } from './destructuring';

export function handleArrayCall(
    obj: any,
    name: string,
    node: any,
    variableTypes: Map<string, string>,
    usedStdlibSet: Set<string>,
    path: any,
    mergesortCounter: { value: number },
    extraDeclarations: string[],
    warnings: any[]
): any {
    // 1. Map / Set methods
    const objType = t.isIdentifier(obj) ? variableTypes.get(obj.name) : null;
    const isAmbiguousMapSet = ['set', 'get', 'has', 'delete', 'clear', 'keys', 'values', 'add'].includes(name);

    if (objType === 'Map' || objType === 'Set') {
        if (objType === 'Map') {
            usedStdlibSet.add('map_new');
            if (name === 'set') {
                usedStdlibSet.add('map_set');
                return t.assignmentExpression("=", obj, t.callExpression(t.identifier("map_set"), [obj, node.arguments[0], node.arguments[1]]));
            } else if (name === 'get') {
                usedStdlibSet.add('map_get');
                return t.callExpression(t.identifier("map_get"), [obj, node.arguments[0]]);
            } else if (name === 'has') {
                usedStdlibSet.add('map_has');
                return t.callExpression(t.identifier("map_has"), [obj, node.arguments[0]]);
            } else if (name === 'delete') {
                usedStdlibSet.add('map_delete');
                return t.assignmentExpression("=", obj, t.callExpression(t.identifier("map_delete"), [obj, node.arguments[0]]));
            } else if (name === 'clear') {
                usedStdlibSet.add('map_clear');
                return t.assignmentExpression("=", obj, t.callExpression(t.identifier("map_clear"), [obj]));
            } else if (name === 'keys') {
                usedStdlibSet.add('map_keys');
                return t.callExpression(t.identifier("map_keys"), [obj]);
            } else if (name === 'values') {
                usedStdlibSet.add('map_values_list');
                return t.callExpression(t.identifier("map_values_list"), [obj]);
            }
        } else {
            usedStdlibSet.add('set_new');
            if (name === 'add') {
                usedStdlibSet.add('set_add');
                return t.assignmentExpression("=", obj, t.callExpression(t.identifier("set_add"), [obj, node.arguments[0]]));
            } else if (name === 'has') {
                usedStdlibSet.add('set_has');
                return t.callExpression(t.identifier("set_has"), [obj, node.arguments[0]]);
            } else if (name === 'delete') {
                usedStdlibSet.add('set_delete');
                return t.assignmentExpression("=", obj, t.callExpression(t.identifier("set_delete"), [obj, node.arguments[0]]));
            } else if (name === 'clear') {
                usedStdlibSet.add('set_clear');
                return t.assignmentExpression("=", obj, t.callExpression(t.identifier("set_clear"), [obj]));
            } else if (name === 'values' || name === 'keys') {
                usedStdlibSet.add('set_values_list');
                return t.callExpression(t.identifier("set_values_list"), [obj]);
            }
        }
        return null;
    } else if (isAmbiguousMapSet) {
        if (name === 'get') {
            usedStdlibSet.add('fvm_get');
            usedStdlibSet.add('map_get');
            return t.callExpression(t.identifier("fvm_get"), [obj, node.arguments[0]]);
        } else if (name === 'set') {
            usedStdlibSet.add('fvm_set');
            usedStdlibSet.add('map_set');
            return t.assignmentExpression("=", obj, t.callExpression(t.identifier("fvm_set"), [obj, node.arguments[0], node.arguments[1]]));
        } else if (name === 'has') {
            usedStdlibSet.add('fvm_has');
            usedStdlibSet.add('map_has');
            usedStdlibSet.add('set_has');
            return t.callExpression(t.identifier("fvm_has"), [obj, node.arguments[0]]);
        } else if (name === 'delete') {
            usedStdlibSet.add('fvm_delete');
            usedStdlibSet.add('map_delete');
            usedStdlibSet.add('set_delete');
            return t.assignmentExpression("=", obj, t.callExpression(t.identifier("fvm_delete"), [obj, node.arguments[0]]));
        } else if (name === 'clear') {
            usedStdlibSet.add('fvm_clear');
            usedStdlibSet.add('map_clear');
            usedStdlibSet.add('set_clear');
            return t.assignmentExpression("=", obj, t.callExpression(t.identifier("fvm_clear"), [obj]));
        } else if (name === 'add') {
            usedStdlibSet.add('fvm_add');
            usedStdlibSet.add('set_add');
            return t.assignmentExpression("=", obj, t.callExpression(t.identifier("fvm_add"), [obj, node.arguments[0]]));
        } else if (name === 'keys') {
            usedStdlibSet.add('fvm_keys');
            usedStdlibSet.add('map_keys');
            return t.callExpression(t.identifier("fvm_keys"), [obj]);
        } else if (name === 'values') {
            usedStdlibSet.add('fvm_values');
            usedStdlibSet.add('map_values_list');
            usedStdlibSet.add('set_values_list');
            return t.callExpression(t.identifier("fvm_values"), [obj]);
        }
        return null;
    }

    // 2. Slice and at (Array variant fallback)
    if (name === 'slice' || name === 'at') {
        const type = t.isIdentifier(obj) ? variableTypes.get(obj.name) : null;
        if (name === 'slice') {
            if (type === 'array') {
                return t.callExpression(t.identifier("ArrSlice"), [obj, node.arguments[0], node.arguments[1] || t.nullLiteral()]);
            }
        } else {
            // at(i)
            const i = node.arguments[0];
            if (type === 'array') {
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
                return t.memberExpression(obj, idxId, true);
            }
        }
        return null;
    }

    // 3. Array mutations
    if (name === 'push' || name === 'unshift') {
        const mapped = name === 'push' ? "ArrPush" : "ArrUnshift";
        return t.callExpression(t.identifier(mapped), [obj, node.arguments[0]]);
    }
    if (name === 'pop' || name === 'shift') {
        const mapped = name === 'pop' ? "ArrPop" : "ArrShift";
        return t.callExpression(t.identifier(mapped), [obj]);
    }
    if (name === 'reverse') {
        return t.callExpression(t.identifier("ArrReverse"), [obj]);
    }
    if (name === 'fill') {
        return t.callExpression(t.identifier("ArrFill"), [
            obj,
            node.arguments[0],
            node.arguments[1] || t.numericLiteral(0),
            node.arguments[2] || t.nullLiteral()
        ]);
    }
    if (name === 'sort') {
        const arg = node.arguments[0];
        if (!arg) {
            return t.callExpression(t.identifier("ArrSortString"), [obj]);
        } else {
            const mergesortName = `__mergesort_${mergesortCounter.value}`;
            const mergeName = `__merge_${mergesortCounter.value}`;
            mergesortCounter.value++;

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
            return t.callExpression(t.identifier(mergesortName), [obj, t.numericLiteral(0), t.callExpression(t.identifier("len"), [obj])]);
        }
    }

    if (name === 'join') {
        return t.callExpression(t.identifier("ArrJoin"), [obj, node.arguments[0] || t.stringLiteral(",")]);
    }

    if (name === 'splice') {
        const start = node.arguments[0];
        const deleteCount = node.arguments[1] || t.binaryExpression("-", t.callExpression(t.identifier("len"), [obj]), start);
        const items = node.arguments.slice(2);
        
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
        return obj;
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
        return resId;
    }

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
            return resId;
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
            return resId;
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
            return accId;
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
            return resId;
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
            return resId;
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
            return t.identifier("undefined");
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
            return t.callExpression(t.identifier("ArrFlat"), [mapResId, t.numericLiteral(1)]);
        }
    }

    return null;
}

export function generateCallbackVal(
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

export function generateReduceCallbackVal(
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
