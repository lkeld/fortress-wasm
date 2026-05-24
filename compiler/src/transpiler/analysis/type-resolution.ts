import traverse from '@babel/traverse';
const t: any = require('@babel/types');

export function resolveVariableTypes(ast: any, variableTypes: Map<string, string>) {
    traverse(ast, {
        VariableDeclarator(path: any) {
            const id = path.node.id;
            const init = path.node.init;
            if (t.isIdentifier(id) && init) {
                if (t.isNewExpression(init) && t.isIdentifier(init.callee)) {
                    if (init.callee.name === 'Map') {
                        variableTypes.set(id.name, 'Map');
                    } else if (init.callee.name === 'Set') {
                        variableTypes.set(id.name, 'Set');
                    }
                } else if (t.isArrayExpression(init)) {
                    variableTypes.set(id.name, 'array');
                } else if (t.isStringLiteral(init)) {
                    variableTypes.set(id.name, 'string');
                }
            }
        }
    });
}
