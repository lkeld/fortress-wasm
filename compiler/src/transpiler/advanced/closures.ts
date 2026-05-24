import traverse from '@babel/traverse';
const t: any = require('@babel/types');
import { TranspileContext } from '../types';

export function transformClosures(ast: any, context: TranspileContext, applyRegisterBanking: any) {
    const liftedFuncs: { name: string; arity: number }[] = [];
    const usedArities = new Set<number>();

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
        `${context.options.functionName}_proxy_get`,
        `${context.options.functionName}_proxy_set`,
        `${context.options.functionName}_part1`,
        `${context.options.functionName}_part2`,
        context.options.functionName
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
        context.extraFuncNodes.push(liftedFunc);

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
