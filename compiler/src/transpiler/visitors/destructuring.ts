const t: any = require('@babel/types');
import { TranspileContext } from '../types';

export function expandPattern(
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

export function createAssignmentExpressionVisitor(context: TranspileContext) {
    return function(path: any) {
        const left = path.node.left;
        const right = path.node.right;

        // ReflectSet key-tracking for member expression assignment
        if (t.isMemberExpression(left)) {
            const prop = left.property;
            if (t.isIdentifier(prop) && !left.computed) {
                const name = prop.name;
                if (['__ownKeys', 'keys', 'values', 'size', 'ip', 'done', 'value'].includes(name)) {
                    return;
                }
            }
            const obj = left.object;
            
            let keyExpr: any = prop;
            if (t.isIdentifier(prop) && !left.computed) {
                keyExpr = t.stringLiteral(prop.name);
            }
            
            path.replaceWith(t.callExpression(t.identifier("ReflectSet"), [obj, keyExpr, right]));
            context.usedStdlibSet.add('ReflectSet');
            return;
        }

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
    };
}
