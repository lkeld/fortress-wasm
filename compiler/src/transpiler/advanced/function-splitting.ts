import { findSplitPoint } from '../analysis/liveness';
import { wrapReturns } from '../helpers';
const t: any = require('@babel/types');
import { TranspileOptions, TranspileWarning } from '../types';

export function splitLargeFunction(
    rootStmt: any,
    code: string,
    options: TranspileOptions,
    warnings: TranspileWarning[],
    ast: any
) {
    const linesOfCode = code.split('\n').length;
    if (linesOfCode > 1000 && t.isFunctionDeclaration(rootStmt)) {
        const splitIndex = findSplitPoint(rootStmt.body.body, rootStmt.params);
        if (splitIndex !== -1) {
            const part1Name = `${options.functionName}_part1`;
            const part2Name = `${options.functionName}_part2`;

            const part1Body = rootStmt.body.body.slice(0, splitIndex + 1);
            wrapReturns(part1Body);
            part1Body.push(t.returnStatement(
                t.objectExpression([
                    t.objectProperty(t.identifier("returned"), t.booleanLiteral(false)),
                    t.objectProperty(t.identifier("value"), t.nullLiteral())
                ])
            ));

            const part2Body = rootStmt.body.body.slice(splitIndex + 1);
            wrapReturns(part2Body);
            part2Body.push(t.returnStatement(
                t.objectExpression([
                    t.objectProperty(t.identifier("returned"), t.booleanLiteral(false)),
                    t.objectProperty(t.identifier("value"), t.nullLiteral())
                ])
            ));

            const part1Func = t.functionDeclaration(
                t.identifier(part1Name),
                rootStmt.params.map((p: any) => t.cloneNode(p)),
                t.blockStatement(part1Body)
            );

            const part2Func = t.functionDeclaration(
                t.identifier(part2Name),
                rootStmt.params.map((p: any) => t.cloneNode(p)),
                t.blockStatement(part2Body)
            );

            ast.program.body.push(part1Func);
            ast.program.body.push(part2Func);

            const coordinatorBody = [
                t.variableDeclaration("let", [
                    t.variableDeclarator(
                        t.identifier("res1"),
                        t.callExpression(
                            t.identifier(part1Name),
                            rootStmt.params.map((p: any) => t.isIdentifier(p) ? t.identifier(p.name) : t.cloneNode(p))
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
                            rootStmt.params.map((p: any) => t.isIdentifier(p) ? t.identifier(p.name) : t.cloneNode(p))
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

            rootStmt.body = t.blockStatement(coordinatorBody);
        } else {
            warnings.push({
                line: 1,
                message: `Function ${options.functionName} has >1000 lines (${linesOfCode}) but no clean split point was found.`,
                suggestion: "Try splitting the function manually or reduce variable dependencies between parts."
            });
        }
    }
}
