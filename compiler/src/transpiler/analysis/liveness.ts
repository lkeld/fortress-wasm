import traverse from '@babel/traverse';
const t: any = require('@babel/types');

export function findSplitPoint(body: any[], params: any[]): number {
    const writes: Set<string>[] = [];
    const reads: Set<string>[] = [];

    for (let i = 0; i < body.length; i++) {
        const w = new Set<string>();
        const r = new Set<string>();

        const stmtFile = t.file(t.program([body[i]]));
        traverse(stmtFile, {
            noScope: true,
            VariableDeclarator(path: any) {
                if (t.isIdentifier(path.node.id)) {
                    w.add(path.node.id.name);
                }
            },
            AssignmentExpression(path: any) {
                const left = path.node.left;
                if (t.isIdentifier(left)) {
                    w.add(left.name);
                } else {
                    traverse(t.file(t.program([t.expressionStatement(left)])), {
                        noScope: true,
                        Identifier(idPath: any) {
                            w.add(idPath.node.name);
                        }
                    });
                }
            },
            UpdateExpression(path: any) {
                if (t.isIdentifier(path.node.argument)) {
                    w.add(path.node.argument.name);
                }
            },
            Identifier(path: any) {
                if (path.isReferencedIdentifier()) {
                    r.add(path.node.name);
                }
            }
        });
        writes.push(w);
        reads.push(r);
    }

    const suffixReads: Set<string>[] = [];
    for (let i = 0; i < body.length; i++) {
        suffixReads.push(new Set<string>());
    }

    const currentSuffix = new Set<string>();
    for (let i = body.length - 1; i >= 0; i--) {
        for (const v of reads[i]) {
            currentSuffix.add(v);
        }
        suffixReads[i] = new Set<string>(currentSuffix);
    }

    const prefixWrites = new Set<string>();
    for (const p of params) {
        if (t.isIdentifier(p)) {
            prefixWrites.add(p.name);
        }
    }

    for (let k = 0; k < body.length - 1; k++) {
        for (const v of writes[k]) {
            prefixWrites.add(v);
        }

        const nextReads = suffixReads[k + 1];
        let hasIntersection = false;
        if (prefixWrites.size < nextReads.size) {
            for (const v of prefixWrites) {
                if (nextReads.has(v)) {
                    hasIntersection = true;
                    break;
                }
            }
        } else {
            for (const v of nextReads) {
                if (prefixWrites.has(v)) {
                    hasIntersection = true;
                    break;
                }
            }
        }

        if (!hasIntersection) {
            return k;
        }
    }
    return -1;
}
