import traverse from '@babel/traverse';
const t: any = require('@babel/types');

export interface TranspileWarning {
    line: number;
    message: string;
    suggestion?: string;
}

export function checkRegExpSafety(pattern: string, line: number, warnings: TranspileWarning[]) {
    if (/\(\?[=!<>].*\)/.test(pattern)) {
        warnings.push({
            line,
            message: `RegExp pattern "${pattern}" contains lookarounds. Ensure fancy-regex compatibility.`,
            suggestion: "Avoid lookarounds if possible for better performance."
        });
    }
    if (/(\+.*\+)|(\*.*\*)|(\+.*\*)|(\*.*\+)/.test(pattern) || /(\(.*\)[+*]\??){2,}/.test(pattern)) {
        warnings.push({
            line,
            message: `RegExp pattern "${pattern}" is potentially vulnerable to catastrophic backtracking (ReDoS).`,
            suggestion: "Rewrite the regular expression to avoid nested quantifiers."
        });
    }
}

export function replaceIdentifier(node: any, oldName: string, newName: string) {
    const dummyFile = t.file(t.program([t.expressionStatement(node)]));
    traverse(dummyFile, {
        noScope: true,
        Identifier(path: any) {
            if (path.node.name === oldName) {
                // Avoid replacing member expression property if it's not computed (e.g. obj.oldName)
                if (path.parentPath.isMemberExpression({ property: path.node, computed: false })) {
                    return;
                }
                path.node.name = newName;
            }
        }
    });
}

export function traverseReplaceReturns(node: any, resultVar: any) {
    const dummyFile = t.file(t.program([node]));
    traverse(dummyFile, {
        noScope: true,
        ReturnStatement(path: any) {
            const val = path.node.argument || t.nullLiteral();
            path.replaceWith(t.expressionStatement(t.assignmentExpression("=", resultVar, val)));
        }
    });
}

export function wrapReturns(body: any[]) {
    const file = t.file(t.program(body));
    traverse(file, {
        noScope: true,
        Function(path: any) {
            path.skip();
        },
        ReturnStatement(path: any) {
            const arg = path.node.argument || t.nullLiteral();
            path.replaceWith(t.returnStatement(
                t.objectExpression([
                    t.objectProperty(t.identifier("returned"), t.booleanLiteral(true)),
                    t.objectProperty(t.identifier("value"), arg)
                ])
            ));
            path.skip();
        }
    });
}

export function deconflictScopes(funcNode: any) {
    const dummyFile = t.file(t.program([funcNode]));
    let mainScope: any = null;
    traverse(dummyFile, {
        FunctionDeclaration(path: any) {
            if (path.node === funcNode) {
                mainScope = path.scope;
            }
        }
    });
    if (!mainScope) return;

    let counter = 0;
    traverse(dummyFile, {
        Scope(path: any) {
            if (path.scope === mainScope) {
                return;
            }
            let parent = path.scope.parent;
            let isNested = false;
            while (parent) {
                if (parent === mainScope) {
                    isNested = true;
                    break;
                }
                parent = parent.parent;
            }
            if (!isNested) return;

            const bindings = path.scope.bindings;
            for (const name of Object.keys(bindings)) {
                counter++;
                const newName = `${name}_b${counter}`;
                path.scope.rename(name, newName);
            }
        }
    });
}

export function renameShadowedVariables(funcNode: any) {
    const fileNode = t.file(t.program([funcNode]));
    traverse(fileNode, {
        VariableDeclarator(path: any) {
            const id = path.node.id;
            if (t.isIdentifier(id)) {
                const name = id.name;
                let scope = path.scope.parent;
                let shadows = false;
                while (scope) {
                    if (scope.hasOwnBinding(name)) {
                        shadows = true;
                        break;
                    }
                    if (scope.path.isFunction()) {
                        break;
                    }
                    scope = scope.parent;
                }
                if (shadows) {
                    const newName = path.scope.generateUid(name);
                    path.scope.rename(name, newName);
                }
            }
        }
    });
}

export function renameVariableInBody(bodyNode: any, oldName: string, newName: string) {
    traverse(t.file(t.program([bodyNode])), {
        noScope: true,
        Identifier(path: any) {
            if (path.node.name === oldName) {
                if (path.parentPath.isMemberExpression({ property: path.node, computed: false })) {
                    return;
                }
                if (path.parentPath.isObjectProperty({ key: path.node, computed: false })) {
                    return;
                }
                path.node.name = newName;
            }
        }
    });
}

export function convertDeclarationsToAssignments(bodyNode: any, regNames: Set<string>) {
    traverse(t.file(t.program([bodyNode])), {
        noScope: true,
        VariableDeclaration(path: any) {
            const decl = path.node.declarations[0];
            if (t.isIdentifier(decl.id) && regNames.has(decl.id.name)) {
                if (path.parentPath.isForStatement({ init: path.node })) {
                    if (decl.init) {
                        path.replaceWith(t.assignmentExpression("=", decl.id, decl.init));
                    } else {
                        path.replaceWith(t.nullLiteral());
                    }
                } else {
                    if (decl.init) {
                        path.replaceWith(t.expressionStatement(
                            t.assignmentExpression("=", decl.id, decl.init)
                        ));
                    } else {
                        path.replaceWith(t.emptyStatement());
                    }
                }
            }
        }
    });
}
