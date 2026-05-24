const t: any = require('@babel/types');
import { TranspileContext } from '../types';
import { replaceIdentifier } from '../helpers';

export function createClassDeclarationVisitor(context: TranspileContext) {
    return function(path: any) {
        const className = path.node.id ? path.node.id.name : "AnonymousClass";
        const fields: any[] = [];
        let constructor: any = null;
        const methods: any[] = [];

        path.node.body.body.forEach((member: any) => {
            if (t.isClassProperty(member)) {
                fields.push(member);
            } else if (t.isClassMethod(member)) {
                if (member.kind === 'constructor') {
                    constructor = member;
                } else {
                    methods.push(member);
                }
            }
        });

        // 1. Generate Constructor/Factory function
        const cParams = constructor ? constructor.params : [];
        const cBody = constructor ? constructor.body.body : [];
        
        const factoryParams = cParams.map((p: any) => t.cloneNode(p));
        const factoryBodyStmts: any[] = [
            t.variableDeclaration("let", [t.variableDeclarator(t.identifier("self"), t.objectExpression([]))])
        ];

        // Evaluate field initializers
        fields.forEach(field => {
            const key = field.key;
            const value = field.value || t.nullLiteral();
            if (t.isIdentifier(key)) {
                factoryBodyStmts.push(
                    t.expressionStatement(t.assignmentExpression("=", t.memberExpression(t.identifier("self"), key), value))
                );
            }
        });

        // Clone and transform constructor body: rename `this` to `self`
        cBody.forEach((stmt: any) => {
            const stmtCopy = t.cloneNode(stmt);
            replaceIdentifier(stmtCopy, "this", "self");
            factoryBodyStmts.push(stmtCopy);
        });

        factoryBodyStmts.push(t.returnStatement(t.identifier("self")));

        const factoryFunc = t.functionDeclaration(
            t.identifier(`${className}_new`),
            factoryParams,
            t.blockStatement(factoryBodyStmts)
        );
        context.extraFuncNodes.push(factoryFunc);

        // 2. Generate class methods
        methods.forEach(method => {
            const mName = method.key.name;
            const mParams = [t.identifier("self"), ...method.params.map((p: any) => t.cloneNode(p))];
            const mBody = t.cloneNode(method.body);

            replaceIdentifier(mBody, "this", "self");
            
            const methodFunc = t.functionDeclaration(
                t.identifier(`${className}_${mName}`),
                mParams,
                mBody
            );
            context.extraFuncNodes.push(methodFunc);
        });

        // Replace class declaration with empty statement since we generated factory functions
        path.replaceWith(t.emptyStatement());
    };
}

export function createNewExpressionVisitor(context: TranspileContext) {
    return function(path: any) {
        const callee = path.node.callee;
        if (t.isIdentifier(callee)) {
            if (callee.name !== 'Map' && callee.name !== 'Set') {
                path.replaceWith(t.callExpression(t.identifier(`${callee.name}_new`), path.node.arguments));
            }
        }
    };
}
