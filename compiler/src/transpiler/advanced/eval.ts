import traverse from '@babel/traverse';
const t: any = require('@babel/types');
const generate: any = require('@babel/generator').default;
const parser: any = require('@babel/parser');
import { TranspileOptions, TranspileResult } from '../types';

export function transformEval(
    ast: any,
    rootStmt: any,
    code: string,
    options: TranspileOptions,
    transpile: (code: string, options: TranspileOptions) => TranspileResult
): { split: boolean; result?: TranspileResult } {
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
                
                // Import wrap-emitter here to avoid circular imports during emit
                const { emitEvalSplitWrapper } = require('../emit/wrapper-emitter');
                const hasSharedArrayBuffer = code.includes('SharedArrayBuffer') || code.includes('Int8Array') || code.includes('Uint8Array') || code.includes('Int32Array'); // simple heuristic
                const jsWrapper = emitEvalSplitWrapper(
                    options,
                    paramsCode,
                    statementsBeforeCode,
                    liveVars,
                    splitFuncName,
                    liveVarsCode,
                    hasSharedArrayBuffer
                );

                const tsDeclaration = `export function ${options.functionName}(...args: any[]): Promise<any>;`;
                return {
                    split: true,
                    result: {
                        fvmSource: fvmTranspileRes.fvmSource,
                        jsWrapper,
                        tsDeclaration,
                        usedStdlib: fvmTranspileRes.usedStdlib,
                        warnings: fvmTranspileRes.warnings,
                        asyncSplit: {
                            boundaryCount: 1,
                            variablesPassed: liveVars
                        }
                    }
                };
            }
        }
    }

    return { split: false };
}
