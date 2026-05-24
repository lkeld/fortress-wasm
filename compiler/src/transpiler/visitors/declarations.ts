const t: any = require('@babel/types');
import { TranspileContext } from '../types';
import { expandPattern } from './destructuring';

export function createVariableDeclarationVisitor(context: TranspileContext) {
    return function(path: any) {
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
    };
}
