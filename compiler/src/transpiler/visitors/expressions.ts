const t: any = require('@babel/types');
import { TranspileContext } from '../types';
import { handleArrayCall } from './arrays';
import { handleStringCall } from './strings';
import { handleMathCall } from './math';
import { handleRegexCall } from './regex';
import { mapReflectCalls } from '../advanced/reflect';

export function createObjectExpressionVisitor(context: TranspileContext) {
    return function(path: any) {
        if (path.parentPath.isNewExpression() && t.isIdentifier(path.parentPath.node.callee) && path.parentPath.node.callee.name === 'Proxy') {
            return;
        }
        const props = path.node.properties;
        if (props.some((p: any) => t.isIdentifier(p.key) && p.key.name === '__ownKeys')) {
            return;
        }
        const keys: any[] = [];
        for (const prop of props) {
            if (t.isObjectProperty(prop)) {
                if (t.isIdentifier(prop.key) && !prop.computed) {
                    keys.push(t.stringLiteral(prop.key.name));
                } else if (t.isStringLiteral(prop.key)) {
                    keys.push(t.stringLiteral(prop.key.value));
                } else {
                    keys.push(prop.key);
                }
            }
        }
        props.push(t.objectProperty(t.identifier('__ownKeys'), t.arrayExpression(keys)));
    };
}

export function createStringLiteralVisitor(context: TranspileContext) {
    return function(path: any) {
        if (path.node.extra) {
            delete path.node.extra;
        }
    };
}

export function createThrowStatementVisitor(context: TranspileContext) {
    return function(path: any) {
        path.replaceWith(t.returnStatement(t.booleanLiteral(false)));
    };
}

export function createTemplateLiteralVisitor(context: TranspileContext) {
    return function(path: any) {
        const node = path.node;
        const parts: any[] = [];
        for (let i = 0; i < node.quasis.length; i++) {
            const quasi = node.quasis[i];
            if (quasi.value.cooked) {
                parts.push(t.stringLiteral(quasi.value.cooked));
            }
            if (i < node.expressions.length) {
                parts.push(node.expressions[i]);
            }
        }
        const filteredParts = parts.filter(p => !(t.isStringLiteral(p) && p.value === ""));
        if (filteredParts.length === 0) {
            path.replaceWith(t.stringLiteral(""));
            return;
        }
        let result = filteredParts[filteredParts.length - 1];
        for (let i = filteredParts.length - 2; i >= 0; i--) {
            result = t.callExpression(t.identifier("StrConcat"), [filteredParts[i], result]);
        }
        path.replaceWith(result);
    };
}

export function createMemberExpressionVisitor(context: TranspileContext) {
    return function(path: any) {
        const node = path.node;
        const obj = node.object;
        const prop = node.property;
        if (t.isIdentifier(prop) && !node.computed) {
            if (prop.name === 'length') {
                path.replaceWith(t.callExpression(t.identifier("len"), [obj]));
            }
        }
    };
}

export function createCallExpressionVisitor(context: TranspileContext) {
    return function(path: any) {
        const node = path.node;
        const callee = node.callee;

        // Static JSON string eval() mapping
        if (t.isIdentifier(callee) && callee.name === 'eval') {
            const arg = node.arguments[0];
            if (arg && t.isStringLiteral(arg)) {
                try {
                    JSON.parse(arg.value);
                    path.replaceWith(t.callExpression(t.identifier("JSONParse"), [arg]));
                    context.usedStdlibSet.add('JSONParse');
                    return;
                } catch (e) {}
            }
        }

        // Reflect mapping
        const reflectRes = mapReflectCalls(callee, node, context.usedStdlibSet, t);
        if (reflectRes) {
            path.replaceWith(reflectRes);
            return;
        }

        if (t.isMemberExpression(callee)) {
            const obj = callee.object;
            const prop = callee.property;
            if (t.isIdentifier(prop) && !callee.computed) {
                const name = prop.name;

                // 1. Math methods
                const mathRes = handleMathCall(obj, name, node);
                if (mathRes) {
                    path.replaceWith(mathRes);
                    return;
                }

                // 2. Collection & Array calls
                const arrRes = handleArrayCall(
                    obj,
                    name,
                    node,
                    context.variableTypes,
                    context.usedStdlibSet,
                    path,
                    context.mergesortCounter,
                    context.extraDeclarations,
                    context.warnings
                );
                if (arrRes) {
                    path.replaceWith(arrRes);
                    return;
                }

                // 3. String calls
                const strRes = handleStringCall(
                    obj,
                    name,
                    node,
                    context.variableTypes,
                    context.usedStdlibSet,
                    context.warnings
                );
                if (strRes) {
                    path.replaceWith(strRes);
                    return;
                }

                // 4. Regex calls
                const regexRes = handleRegexCall(obj, name, node, context.warnings);
                if (regexRes) {
                    path.replaceWith(regexRes);
                    return;
                }
            }
        }

        // ParseInt / ParseFloat
        if (t.isIdentifier(callee) && (callee.name === 'parseInt' || callee.name === 'parseFloat')) {
            path.replaceWith(t.callExpression(t.identifier("JSONParse"), [node.arguments[0]]));
            return;
        }

        // Array.isArray
        if (t.isMemberExpression(callee) && t.isIdentifier(callee.object) && callee.object.name === 'Array') {
            const prop = callee.property;
            if (t.isIdentifier(prop) && !callee.computed && prop.name === 'isArray') {
                const arg = node.arguments[0];
                path.replaceWith(
                    t.logicalExpression("&&",
                        t.binaryExpression("==",
                            t.callExpression(t.identifier("TypeOf"), [arg]),
                            t.stringLiteral("object")
                        ),
                        t.binaryExpression("==",
                            t.callExpression(t.identifier("StrAt"), [
                                t.callExpression(t.identifier("JSONStringify"), [arg]),
                                t.numericLiteral(0)
                            ]),
                            t.stringLiteral("[")
                        )
                    )
                );
                return;
            }
        }

        // JSON.parse / JSON.stringify
        if (t.isMemberExpression(callee) && t.isIdentifier(callee.object) && callee.object.name === 'JSON') {
            const prop = callee.property;
            if (t.isIdentifier(prop) && !callee.computed) {
                if (prop.name === 'parse') {
                    path.replaceWith(t.callExpression(t.identifier("JSONParse"), [node.arguments[0]]));
                } else if (prop.name === 'stringify') {
                    path.replaceWith(t.callExpression(t.identifier("JSONStringify"), [node.arguments[0]]));
                }
            }
        }
    };
}
