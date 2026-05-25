import traverse from '@babel/traverse';
const t: any = require('@babel/types');
import { TranspileContext } from '../types';

function getLocalBindings(functionPath: any): Set<string> {
    const bindings = new Set<string>();
    const collectParams = (node: any) => {
        if (!node) return;
        if (t.isIdentifier(node)) {
            bindings.add(node.name);
        } else if (t.isAssignmentPattern(node)) {
            collectParams(node.left);
        } else if (t.isArrayPattern(node)) {
            for (const elem of node.elements) {
                collectParams(elem);
            }
        } else if (t.isObjectPattern(node)) {
            for (const prop of node.properties) {
                if (t.isObjectProperty(prop)) {
                    collectParams(prop.value);
                } else if (t.isRestElement(prop)) {
                    collectParams(prop.argument);
                }
            }
        } else if (t.isRestElement(node)) {
            collectParams(node.argument);
        }
    };
    for (const param of functionPath.node.params) {
        collectParams(param);
    }
    functionPath.traverse({
        VariableDeclarator(path: any) {
            if (path.getFunctionParent() === functionPath) {
                collectParams(path.node.id);
            }
        },
        FunctionDeclaration(path: any) {
            if (path.getFunctionParent() === functionPath && path.node.id) {
                bindings.add(path.node.id.name);
            }
        }
    });
    return bindings;
}

export function transformClosures(ast: any, context: TranspileContext, applyRegisterBanking: any) {
    const liftedFuncs: { name: string; arity: number }[] = [];
    const usedArities = new Set<number>();

    const nestedFunctionPaths: any[] = [];
    traverse(ast, {
        Function(path: any) {
            // Do not lift the root function declaration (main entry point function)
            if (path.isFunctionDeclaration() && path.node.id && path.node.id.name === context.options.functionName) {
                return;
            }
            // Lift all arrow functions, function expressions, or nested function declarations
            const isArrow = path.isArrowFunctionExpression();
            const isExpr = path.isFunctionExpression();
            let isNested = false;
            let parent = path.parentPath;
            while (parent) {
                if (parent.isFunction()) {
                    isNested = true;
                    break;
                }
                parent = parent.parentPath;
            }
            if (isArrow || isExpr || isNested) {
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
        `${context.options.functionName}_proxy_get`,
        `${context.options.functionName}_proxy_set`,
        `${context.options.functionName}_part1`,
        `${context.options.functionName}_part2`,
        context.options.functionName
    ]);

    nestedFunctionPaths.reverse();

    const functionCapturedVars = new Map<any, Set<string>>();

    for (const nestedPath of nestedFunctionPaths) {
        // Convert arrow function with expression body to block statement early to normalise it and avoid crashes when prepending scope state declaration
        if (nestedPath.isArrowFunctionExpression() && !t.isBlockStatement(nestedPath.node.body)) {
            const bodyNode = t.cloneNode(nestedPath.node.body);
            nestedPath.get('body').replaceWith(
                t.blockStatement([t.returnStatement(bodyNode)])
            );
        }
        nestedPath.scope.crawl();

        // 1. Rename any local parameter/variable named 'state' to '__state_param' to avoid collision with lifted closure state parameter 'state'
        const hasStateParam = getLocalBindings(nestedPath).has('state');
        if (hasStateParam) {
            const renameParam = (node: any) => {
                if (!node) return;
                if (t.isIdentifier(node)) {
                    if (node.name === 'state') {
                        node.name = '__state_param';
                    }
                } else if (t.isAssignmentPattern(node)) {
                    renameParam(node.left);
                } else if (t.isArrayPattern(node)) {
                    for (const elem of node.elements) {
                        renameParam(elem);
                    }
                } else if (t.isObjectPattern(node)) {
                    for (const prop of node.properties) {
                        if (t.isObjectProperty(prop)) {
                            renameParam(prop.value);
                        } else if (t.isRestElement(prop)) {
                            renameParam(prop.argument);
                        }
                    }
                } else if (t.isRestElement(node)) {
                    renameParam(node.argument);
                }
            };
            for (const param of nestedPath.node.params) {
                renameParam(param);
            }

            nestedPath.traverse({
                Identifier(idPath: any) {
                    if ((idPath.isReferencedIdentifier() || idPath.isBindingIdentifier()) && idPath.node.name === 'state') {
                        let isShadowed = false;
                        let currPath = idPath;
                        while (currPath && currPath !== nestedPath) {
                            if (currPath.isFunction() && currPath.node !== nestedPath.node) {
                                if (getLocalBindings(currPath).has('state')) {
                                    isShadowed = true;
                                    break;
                                }
                            }
                            currPath = currPath.parentPath;
                        }
                        if (!isShadowed) {
                            idPath.node.name = '__state_param';
                        }
                    }
                }
            });
            nestedPath.scope.crawl();
        }

        const upvars = new Set<string>();
        nestedPath.traverse({
            Identifier(idPath: any) {
                if (idPath.isReferencedIdentifier() || idPath.isBindingIdentifier()) {
                    if (idPath.parentPath === nestedPath && idPath.parentKey === 'id') {
                        return;
                    }
                    const name = idPath.node.name;
                    let isLocal = false;
                    let currPath = idPath;
                    while (currPath && currPath !== nestedPath) {
                        if (currPath.isFunction()) {
                            if (getLocalBindings(currPath).has(name)) {
                                isLocal = true;
                                break;
                            }
                        }
                        currPath = currPath.parentPath;
                    }
                    if (!isLocal) {
                        if (getLocalBindings(nestedPath).has(name)) {
                            isLocal = true;
                        }
                    }
                    if (!isLocal) {
                        let curr = nestedPath.parentPath;
                        let definedInOuterFunc = false;
                        while (curr) {
                            if (curr.isFunction()) {
                                if (getLocalBindings(curr).has(name)) {
                                    definedInOuterFunc = true;
                                    break;
                                }
                            }
                            curr = curr.parentPath;
                        }
                        if (definedInOuterFunc) {
                            upvars.add(name);
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
                        const name = idPath.node.name;
                        if (idPath.parentPath && idPath.parentPath.isFunction() && (idPath.parentKey === 'id' || idPath.parentKey === 'params' || idPath.listKey === 'params')) {
                            return;
                        }
                        let isLocal = false;
                        let currPath = idPath;
                        while (currPath && currPath !== nestedPath) {
                            if (currPath.isFunction()) {
                                if (getLocalBindings(currPath).has(name)) {
                                    isLocal = true;
                                    break;
                                }
                            }
                            currPath = currPath.parentPath;
                        }
                        if (!isLocal) {
                            idPath.replaceWith(t.memberExpression(t.identifier('scopeState'), t.identifier(idPath.node.name)));
                            idPath.skip();
                        }
                    }
                },
                VariableDeclarator(decPath: any) {
                    const id = decPath.node.id;
                    if (t.isIdentifier(id) && capturedVars.has(id.name)) {
                        if (decPath.getFunctionParent() === nestedPath) {
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
                        name === context.options.functionName ||
                        name === `${context.options.functionName}_new` ||
                        name === `${context.options.functionName}_next` ||
                        name.startsWith(`${context.options.functionName}_closure_`) ||
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

        const liftedName = `${context.options.functionName}_closure_${context.closureCounter.value++}`;
        liftedFuncs.push({ name: liftedName, arity: nestedPath.node.params.length });

        nestedPath.traverse({
            Identifier(idPath: any) {
                if ((idPath.isReferencedIdentifier() || idPath.isBindingIdentifier()) && upvars.has(idPath.node.name)) {
                    const name = idPath.node.name;
                    if (idPath.parentPath && idPath.parentPath.isFunction() && (idPath.parentKey === 'id' || idPath.parentKey === 'params' || idPath.listKey === 'params')) {
                        return;
                    }
                    let isLocal = false;
                    let currPath = idPath;
                    while (currPath && currPath !== nestedPath) {
                        if (currPath.isFunction()) {
                            if (getLocalBindings(currPath).has(name)) {
                                isLocal = true;
                                break;
                            }
                        }
                        currPath = currPath.parentPath;
                    }
                    if (!isLocal) {
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
        context.extraFuncNodes.push(liftedFunc);

        let parentFuncPath = nestedPath.parentPath.isFunction() ? nestedPath.parentPath : nestedPath.parentPath.getFunctionParent();
        let stateExpr;
        if (parentFuncPath) {
            const isParentNested = parentFuncPath.parentPath.isFunction() || parentFuncPath.parentPath.getFunctionParent() !== null;
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
            if (path.node.id && path.node.id.name === context.options.functionName) {
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
                        const name = idPath.node.name;
                        if (idPath.parentPath && idPath.parentPath.isFunction() && (idPath.parentKey === 'id' || idPath.parentKey === 'params' || idPath.listKey === 'params')) {
                            return;
                        }
                        let isLocal = false;
                        let currPath = idPath;
                        while (currPath && currPath !== rootPath) {
                            if (currPath.isFunction()) {
                                if (getLocalBindings(currPath).has(name)) {
                                    isLocal = true;
                                    break;
                                }
                            }
                            currPath = currPath.parentPath;
                        }
                        if (!isLocal) {
                            idPath.replaceWith(t.memberExpression(t.identifier('scopeState'), t.identifier(idPath.node.name)));
                            idPath.skip();
                        }
                    }
                },
                VariableDeclarator(decPath: any) {
                    const id = decPath.node.id;
                    if (t.isIdentifier(id) && rootCaptured.has(id.name)) {
                        if (decPath.getFunctionParent() === rootPath) {
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
                    name === context.options.functionName ||
                    name === `${context.options.functionName}_new` ||
                    name === `${context.options.functionName}_next` ||
                    name.startsWith(`${context.options.functionName}_closure_`) ||
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
        context.extraDeclarations.push(dispatcherCode);
    }
}
