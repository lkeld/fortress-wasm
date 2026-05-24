const t: any = require('@babel/types');
import { TranspileContext } from '../types';

export function createBinaryExpressionVisitor(context: TranspileContext) {
    return function(path: any) {
        const node = path.node;
        if (node.operator === "===") {
            context.warnings.push({
                line: node.loc ? node.loc.start.line : 0,
                message: "Reference equality is not preserved across the VM boundary. Use deep equality instead.",
                suggestion: "Replace === with deep equality check."
            });
        } else if (node.operator === "!==") {
            context.warnings.push({
                line: node.loc ? node.loc.start.line : 0,
                message: "Reference equality is not preserved across the VM boundary. Use deep equality instead.",
                suggestion: "Replace !== with deep equality check."
            });
        } else if (node.operator === "**") {
            path.replaceWith(t.callExpression(t.identifier("MathPow"), [node.left, node.right]));
        } else if (node.operator === "in") {
            const left = path.node.left;
            const right = path.node.right;
            path.replaceWith(t.binaryExpression("!=", t.memberExpression(right, left, true), t.nullLiteral()));
        } else if (node.operator === "instanceof") {
            path.replaceWith(t.binaryExpression("==", t.callExpression(t.identifier("TypeOf"), [path.node.left]), t.stringLiteral("object")));
        }
    };
}

export function createOptionalMemberExpressionVisitor(context: TranspileContext) {
    return function(path: any) {
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
    };
}

export function createLogicalExpressionVisitor(context: TranspileContext) {
    return function(path: any) {
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
    };
}

export function createUnaryExpressionVisitor(context: TranspileContext) {
    return function(path: any) {
        if (path.node.operator === "typeof") {
            path.replaceWith(t.callExpression(t.identifier("TypeOf"), [path.node.argument]));
        }
    };
}
