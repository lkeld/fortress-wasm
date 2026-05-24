const t: any = require('@babel/types');
import { TranspileContext } from '../types';

export function createForOfStatementVisitor(context: TranspileContext) {
    return function(path: any) {
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
    };
}
