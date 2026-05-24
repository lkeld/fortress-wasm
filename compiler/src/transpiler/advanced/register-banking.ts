import traverse from '@babel/traverse';
const t: any = require('@babel/types');
import { wrapReturns } from '../helpers';
import {
    deconflictScopes,
    renameVariableInBody,
    convertDeclarationsToAssignments
} from '../analysis/scope';
import { findSplitPoint } from '../analysis/liveness';

export function applyRegisterBanking(
    funcNode: any,
    options: any,
    activeFuncNodes: any[],
    packedFunctions: Map<string, string[]>,
    extraFuncNodes: any[],
    depth = 0
) {
    if (!t.isFunctionDeclaration(funcNode)) return;

    if (!activeFuncNodes.includes(funcNode)) {
        activeFuncNodes.push(funcNode);
    }

    // Run scope-safe renaming pre-pass to prevent leakage & shadowing
    deconflictScopes(funcNode);

    // Pack parameters into a single __args object if > 2 parameters (excluding entry function)
    if (funcNode.params.length > 2 && funcNode.id.name !== options.functionName) {
        const originalParams = funcNode.params.map((p: any) => p.name);
        const fileNode = t.file(t.program([funcNode]));
        traverse(fileNode, {
            Identifier(path: any) {
                const name = path.node.name;
                if (originalParams.includes(name)) {
                    const binding = path.scope.getBinding(name);
                    if (binding && binding.scope === path.scope.getFunctionParent()) {
                        if (path.parentPath.isMemberExpression({ property: path.node, computed: false })) {
                            return;
                        }
                        if (path.parentPath.isObjectProperty({ key: path.node, computed: false })) {
                            return;
                        }
                        path.replaceWith(t.memberExpression(t.identifier("__args"), t.identifier(name)));
                        path.skip();
                    }
                }
            }
        });
        funcNode.params = [t.identifier("__args")];

        // Rewrite call sites in all active function nodes
        packedFunctions.set(funcNode.id.name, originalParams);
    }

    const params = funcNode.params.map((p: any) => p.name);
    const localVars = new Set<string>();
    traverse(t.file(t.program([t.cloneNode(funcNode.body)])), {
        noScope: true,
        VariableDeclarator(path: any) {
            if (t.isIdentifier(path.node.id)) {
                localVars.add(path.node.id.name);
            }
        }
    });
    const allVars = [...params, ...localVars];

    if (allVars.length <= 240) {
        return;
    }

    const first_idx: { [key: string]: number } = {};
    const last_idx: { [key: string]: number } = {};

    for (const p of params) {
        first_idx[p] = -1;
        last_idx[p] = -1;
    }

    const body = funcNode.body.body;
    for (let i = 0; i < body.length; i++) {
        const stmt = body[i];
        traverse(t.file(t.program([stmt])), {
            noScope: true,
            Identifier(path: any) {
                const name = path.node.name;
                if (localVars.has(name) || params.includes(name)) {
                    if (first_idx[name] === undefined) {
                        first_idx[name] = i;
                    }
                    last_idx[name] = i;
                }
            }
        });
    }

    const regAssignment: { [key: string]: string } = {};
    const regAssignmentColors: { [key: string]: number } = {};
    const regNames = new Set<string>();

    const sortedLocals = Array.from(localVars).sort();
    for (const v of sortedLocals) {
        const vFirst = first_idx[v] ?? -1;
        const vLast = last_idx[v] ?? -1;

        const conflictedColors = new Set<number>();
        for (const u of sortedLocals) {
            if (u === v || regAssignmentColors[u] === undefined) continue;
            const uFirst = first_idx[u] ?? -1;
            const uLast = last_idx[u] ?? -1;

            if (Math.max(vFirst, uFirst) <= Math.min(vLast, uLast)) {
                conflictedColors.add(regAssignmentColors[u]);
            }
        }

        let color = 0;
        while (conflictedColors.has(color)) {
            color++;
        }

        const regName = `__reg_${color}`;
        regAssignment[v] = regName;
        regAssignmentColors[v] = color;
        regNames.add(regName);
    }

    if (regNames.size + params.length > 240 && funcNode.body.body.length > 1) {
        let splitIndex = -1;
        for (let i = 0; i < body.length; i++) {
            const activeVars = allVars.filter(v => first_idx[v] !== undefined && first_idx[v] <= i);
            if (activeVars.length > 240) {
                splitIndex = i;
                break;
            }
        }
        if (splitIndex <= 0 || splitIndex >= body.length) {
            splitIndex = Math.floor(body.length / 2);
        }

        const part1Name = `${funcNode.id.name}_part1`;
        const part2Name = `${funcNode.id.name}_part2`;

        const liveVars: string[] = [];
        for (const v of allVars) {
            if (params.includes(v)) continue;
            const isDeclaredOrWrittenIn1 = (first_idx[v] !== undefined && first_idx[v] < splitIndex);
            const isReadIn2 = (last_idx[v] !== undefined && last_idx[v] >= splitIndex);
            if (isDeclaredOrWrittenIn1 && isReadIn2) {
                liveVars.push(v);
            }
        }
        liveVars.sort();

        const part1Body = body.slice(0, splitIndex);
        wrapReturns(part1Body);
        part1Body.push(t.returnStatement(
            t.objectExpression([
                t.objectProperty(t.identifier("returned"), t.booleanLiteral(false)),
                t.objectProperty(t.identifier("value"), t.nullLiteral()),
                t.objectProperty(t.identifier("liveVars"), t.objectExpression(
                    liveVars.map(v => t.objectProperty(t.identifier(v), t.identifier(v)))
                ))
            ])
        ));

        const part2Body = body.slice(splitIndex);
        wrapReturns(part2Body);
        part2Body.push(t.returnStatement(
            t.objectExpression([
                t.objectProperty(t.identifier("returned"), t.booleanLiteral(false)),
                t.objectProperty(t.identifier("value"), t.nullLiteral())
            ])
        ));

        // Traverse to collect parameter usage in part1 and part2
        const usedIn1 = new Set<string>();
        traverse(t.file(t.program(part1Body)), {
            noScope: true,
            Identifier(path: any) {
                if (path.parentPath.isMemberExpression({ property: path.node, computed: false })) {
                    return;
                }
                if (path.parentPath.isObjectProperty({ key: path.node, computed: false })) {
                    return;
                }
                usedIn1.add(path.node.name);
            }
        });

        const usedIn2 = new Set<string>();
        traverse(t.file(t.program(part2Body)), {
            noScope: true,
            Identifier(path: any) {
                if (path.parentPath.isMemberExpression({ property: path.node, computed: false })) {
                    return;
                }
                if (path.parentPath.isObjectProperty({ key: path.node, computed: false })) {
                    return;
                }
                usedIn2.add(path.node.name);
            }
        });

        const part1Params = funcNode.params.filter((p: any) => {
            if (!t.isIdentifier(p)) return true;
            return usedIn1.has(p.name);
        }).map((p: any) => t.cloneNode(p));
        
        const part1CallArgs = funcNode.params
            .filter((p: any) => !t.isIdentifier(p) || usedIn1.has(p.name))
            .map((p: any) => t.isIdentifier(p) ? t.identifier(p.name) : t.cloneNode(p));

        const part1Func = t.functionDeclaration(
            t.identifier(part1Name),
            part1Params,
            t.blockStatement(part1Body)
        );

        const stateIdentifier = t.identifier(`__state_${depth}`);
        
        // Rename liveVars in part2Body to member expressions on __state instead of unpacking,
        // to avoid redeclaring too many local variables and exceeding 240/256 slots in FVM.
        const dummyFile = t.file(t.program(part2Body));
        traverse(dummyFile, {
            noScope: true,
            Identifier(path: any) {
                const name = path.node.name;
                if (liveVars.includes(name)) {
                    if (path.parentPath.isMemberExpression({ property: path.node, computed: false })) {
                        return;
                    }
                    if (path.parentPath.isObjectProperty({ key: path.node, computed: false })) {
                        return;
                    }
                    path.replaceWith(t.memberExpression(stateIdentifier, t.identifier(name)));
                    path.skip();
                }
            }
        });

        const part2Params = [
            ...funcNode.params.filter((p: any) => {
                if (!t.isIdentifier(p)) return true;
                return usedIn2.has(p.name);
            }).map((p: any) => t.cloneNode(p)),
            stateIdentifier
        ];
        
        const part2CallArgs = [
            ...funcNode.params
                .filter((p: any) => !t.isIdentifier(p) || usedIn2.has(p.name))
                .map((p: any) => t.isIdentifier(p) ? t.identifier(p.name) : t.cloneNode(p)),
            t.memberExpression(t.identifier("res1"), t.identifier("liveVars"))
        ];

        const part2Func = t.functionDeclaration(
            t.identifier(part2Name),
            part2Params,
            t.blockStatement(part2Body)
        );

        activeFuncNodes.push(part1Func);
        activeFuncNodes.push(part2Func);

        const coordinatorBody = [
            t.variableDeclaration("let", [
                t.variableDeclarator(
                    t.identifier("res1"),
                    t.callExpression(
                        t.identifier(part1Name),
                        part1CallArgs
                    )
                )
            ]),
            t.ifStatement(
                t.memberExpression(t.identifier("res1"), t.identifier("returned")),
                t.blockStatement([
                    t.returnStatement(t.memberExpression(t.identifier("res1"), t.identifier("value")))
                ])
            ),
            t.variableDeclaration("let", [
                t.variableDeclarator(
                    t.identifier("res2"),
                    t.callExpression(
                        t.identifier(part2Name),
                        part2CallArgs
                    )
                )
            ]),
            t.ifStatement(
                t.memberExpression(t.identifier("res2"), t.identifier("returned")),
                t.blockStatement([
                    t.returnStatement(t.memberExpression(t.identifier("res2"), t.identifier("value")))
                ])
            ),
            t.returnStatement(t.memberExpression(t.identifier("res2"), t.identifier("value")))
        ];

        funcNode.body = t.blockStatement(coordinatorBody);

        applyRegisterBanking(part1Func, options, activeFuncNodes, packedFunctions, extraFuncNodes, depth + 1);
        applyRegisterBanking(part2Func, options, activeFuncNodes, packedFunctions, extraFuncNodes, depth + 1);

        extraFuncNodes.push(part1Func);
        extraFuncNodes.push(part2Func);
    } else {
        for (const v of sortedLocals) {
            const reg = regAssignment[v];
            renameVariableInBody(funcNode.body, v, reg);
        }

        convertDeclarationsToAssignments(funcNode.body, regNames);

        if (regNames.size > 0) {
            const sortedRegNames = Array.from(regNames).sort();
            for (const r of sortedRegNames) {
                const decl = t.variableDeclaration(
                    "let",
                    [t.variableDeclarator(t.identifier(r), t.nullLiteral())]
                );
                funcNode.body.body.unshift(decl);
            }
        }
    }
}
