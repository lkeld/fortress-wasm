import traverse from '@babel/traverse';
const t: any = require('@babel/types');
import { TranspileContext } from '../types';

export function preprocessSymbols(ast: any, context: TranspileContext) {
    traverse(ast, {
        Identifier(path: any) {
            if (path.node.name === 'Symbol') {
                const parentPath = path.parentPath;
                if (parentPath.isMemberExpression() && parentPath.node.object === path.node) {
                    const property = parentPath.node.property;
                    let propName = null;
                    if (t.isIdentifier(property) && !parentPath.node.computed) {
                        propName = property.name;
                    } else if (t.isStringLiteral(property)) {
                        propName = property.value;
                    }
                    if (propName && ['for', 'keyFor', 'iterator', 'toPrimitive', 'hasInstance'].includes(propName)) {
                        throw new Error(`Symbol.${propName} is not supported`);
                    }
                } else if (parentPath.isCallExpression() && parentPath.node.callee === path.node) {
                    const desc = parentPath.node.arguments[0];
                    const uniqSeed = context.symbolSeed + "_" + (context.symbolCounter.value++);
                    let replacement;
                    if (desc) {
                        if (t.isStringLiteral(desc)) {
                            replacement = t.stringLiteral("__fortress_sym_" + uniqSeed + "__" + desc.value);
                        } else {
                            replacement = t.binaryExpression("+", t.stringLiteral("__fortress_sym_" + uniqSeed + "__"), desc);
                        }
                    } else {
                        replacement = t.stringLiteral("__fortress_sym_" + uniqSeed + "__");
                    }
                    parentPath.replaceWith(replacement);
                }
            }
        }
    });
}
