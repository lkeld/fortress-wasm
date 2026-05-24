import traverse from '@babel/traverse';
const t: any = require('@babel/types');
import { TranspileContext } from '../types';
import { wrapReturns } from '../helpers';

export function transformGenerators(ast: any, context: TranspileContext, applyRegisterBanking: any) {
    const rootStmtGen = ast.program.body[0];
    if (t.isFunctionDeclaration(rootStmtGen) && rootStmtGen.generator) {
        context.isGeneratorFlag.value = true;
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
            t.identifier(`${context.options.functionName}_new`),
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
            t.identifier(`${context.options.functionName}_next`),
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
            t.identifier(context.options.functionName),
            dispatchParams,
            t.blockStatement([
                t.ifStatement(
                    t.binaryExpression('==', t.identifier('action'), t.stringLiteral('new')),
                    t.blockStatement([
                        t.returnStatement(t.callExpression(t.identifier(`${context.options.functionName}_new`), newArgs))
                    ])
                ),
                t.ifStatement(
                    t.binaryExpression('==', t.identifier('action'), t.stringLiteral('next')),
                    t.blockStatement([
                        t.returnStatement(t.callExpression(t.identifier(`${context.options.functionName}_next`), [t.identifier('stateOrArg1')]))
                    ])
                ),
                t.returnStatement(t.nullLiteral())
            ])
        );

        applyRegisterBanking(newFunc);
        applyRegisterBanking(nextFunc);
        context.extraFuncNodes.push(newFunc);
        context.extraFuncNodes.push(nextFunc);
        
        // Replace root generator statement with dispatcher
        ast.program.body[0] = dispatchFunc;
    }
}
