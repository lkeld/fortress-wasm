const t: any = require('@babel/types');
import { TranspileContext } from '../types';
import { expandPattern } from './destructuring';

export function createFunctionVisitor(context: TranspileContext) {
    return function(path: any) {
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
    };
}
