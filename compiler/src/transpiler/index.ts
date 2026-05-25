const parser: any = require('@babel/parser');
const traverse: any = require('@babel/traverse').default;
const generate: any = require('@babel/generator').default;
const t: any = require('@babel/types');

import { TranspileOptions, TranspileResult, TranspileContext } from './types';
import { generateSymbolSeed } from './name-gen';

// Helpers
import {
    deconflictScopes,
    renameShadowedVariables,
    renameVariableInBody,
    convertDeclarationsToAssignments,
    wrapReturns
} from './helpers';

// Analysis
import { resolveVariableTypes } from './analysis/type-resolution';

// Advanced Features
import { transformGenerators } from './advanced/generators';
import { transformClosures } from './advanced/closures';
import { preprocessSymbols } from './advanced/symbols';
import { transformEval } from './advanced/eval';
import { transformProxy } from './advanced/proxy';
import { splitLargeFunction } from './advanced/function-splitting';
import { applyRegisterBanking } from './advanced/register-banking';
import { SAB_EMULATION_CODE } from './advanced/sab';

// Emitters
import { emitFvmSource } from './emit/fvm-emitter';
import { emitDtsDeclaration } from './emit/dts-emitter';
import {
    emitProxyWrapper,
    emitEvalSplitWrapper,
    emitGeneratorWrapper,
    emitDefaultWrapper
} from './emit/wrapper-emitter';

// Visitors
import { createVariableDeclarationVisitor } from './visitors/declarations';
import { createFunctionVisitor } from './visitors/functions';
import { createClassDeclarationVisitor, createNewExpressionVisitor } from './visitors/classes';
import {
    createBinaryExpressionVisitor,
    createOptionalMemberExpressionVisitor,
    createLogicalExpressionVisitor,
    createUnaryExpressionVisitor
} from './visitors/operators';
import { createForOfStatementVisitor } from './visitors/control-flow';
import { createAssignmentExpressionVisitor } from './visitors/destructuring';
import {
    createObjectExpressionVisitor,
    createStringLiteralVisitor,
    createThrowStatementVisitor,
    createTemplateLiteralVisitor,
    createMemberExpressionVisitor,
    createCallExpressionVisitor
} from './visitors/expressions';

export function transpile(code: string, options: TranspileOptions): TranspileResult {
    const context: TranspileContext = {
        options,
        warnings: [],
        usedStdlibSet: new Set<string>(),
        variableTypes: new Map<string, string>(),
        mergesortCounter: { value: 0 },
        extraDeclarations: [],
        symbolSeed: generateSymbolSeed(),
        symbolCounter: { value: 0 },
        closureCounter: { value: 0 },
        originalParamNames: [],
        packedFunctions: new Map<string, string[]>(),
        extraFuncNodes: [],
        activeFuncNodes: [],
        isGeneratorFlag: { value: false }
    };

    // Parse JS code
    const ast = parser.parse(code, {
        sourceType: 'module',
        plugins: [
            'typescript',
            'decorators-legacy',
            'classProperties',
            'classPrivateProperties',
            'classPrivateMethods',
        ]
    });

    // Strip TypeScript annotations and type-only statements to output clean JS
    traverse(ast, {
        TSTypeAnnotation(path: any) {
            path.remove();
        },
        TSTypeParameterInstantiation(path: any) {
            path.remove();
        },
        TSTypeParameterDeclaration(path: any) {
            path.remove();
        },
        TSAsExpression(path: any) {
            path.replaceWith(path.node.expression);
        },
        TSTypeAssertion(path: any) {
            path.replaceWith(path.node.expression);
        },
        TSNonNullExpression(path: any) {
            path.replaceWith(path.node.expression);
        },
        TSInterfaceDeclaration(path: any) {
            path.remove();
        },
        TSTypeAliasDeclaration(path: any) {
            path.remove();
        },
        TSEnumDeclaration(path: any) {
            path.remove();
        },
        TSDeclareFunction(path: any) {
            path.remove();
        },
        enter(path: any) {
            if (path.node && path.node.typeAnnotation) {
                delete path.node.typeAnnotation;
            }
            if (path.node && path.node.returnType) {
                delete path.node.returnType;
            }
        }
    });

    // Split multi-declarator variable declarations first to simplify arrow function detection
    traverse(ast, {
        VariableDeclaration(path: any) {
            if (path.node.declarations.length > 1) {
                if (path.parentPath.isForStatement({ init: path.node })) {
                    return;
                }
                const splitDecls = path.node.declarations.map((decl: any) => 
                    t.variableDeclaration(path.node.kind, [t.cloneNode(decl)])
                );
                path.replaceWithMultiple(splitDecls);
            }
        }
    });

    // Convert top-level arrow functions and function expressions to FunctionDeclarations
    for (let i = 0; i < ast.program.body.length; i++) {
        const node = ast.program.body[i];
        if (t.isVariableDeclaration(node)) {
            const decls = node.declarations;
            if (decls.length === 1) {
                const decl = decls[0];
                const init = decl.init;
                if (t.isIdentifier(decl.id) && init && (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init))) {
                    let bodyNode = init.body;
                    if (!t.isBlockStatement(bodyNode)) {
                        bodyNode = t.blockStatement([t.returnStatement(t.cloneNode(bodyNode))]);
                    }
                    const funcDecl = t.functionDeclaration(
                        t.identifier(decl.id.name),
                        init.params.map((p: any) => t.cloneNode(p)),
                        t.cloneNode(bodyNode)
                    );
                    ast.program.body[i] = funcDecl;
                }
            }
        } else if (t.isExpressionStatement(node)) {
            const expr = node.expression;
            if (t.isAssignmentExpression(expr) && expr.operator === '=') {
                const left = expr.left;
                const right = expr.right;
                if (t.isIdentifier(left) && (t.isArrowFunctionExpression(right) || t.isFunctionExpression(right))) {
                    let bodyNode = right.body;
                    if (!t.isBlockStatement(bodyNode)) {
                        bodyNode = t.blockStatement([t.returnStatement(t.cloneNode(bodyNode))]);
                    }
                    const funcDecl = t.functionDeclaration(
                        t.identifier(left.name),
                        right.params.map((p: any) => t.cloneNode(p)),
                        t.cloneNode(bodyNode)
                    );
                    ast.program.body[i] = funcDecl;
                }
            } else if (t.isArrowFunctionExpression(expr) || t.isFunctionExpression(expr)) {
                let bodyNode = expr.body;
                if (!t.isBlockStatement(bodyNode)) {
                    bodyNode = t.blockStatement([t.returnStatement(t.cloneNode(bodyNode))]);
                }
                const funcDecl = t.functionDeclaration(
                    t.identifier(options.functionName),
                    expr.params.map((p: any) => t.cloneNode(p)),
                    t.cloneNode(bodyNode)
                );
                ast.program.body[i] = funcDecl;
            }
        }
    }

    // Re-crawl scope to ensure Babel's cached scope maps reflect the AST changes
    traverse(ast, {
        Program(programPath: any) {
            programPath.scope.crawl();
        }
    });

    const rootStmt = ast.program.body[0];
    if (rootStmt && (t.isFunctionDeclaration(rootStmt) || t.isFunctionExpression(rootStmt) || t.isArrowFunctionExpression(rootStmt))) {
        context.originalParamNames = rootStmt.params.map((p: any) => p.name);
    }

    let hasSharedArrayBuffer = false;
    const typedArrays = new Set([
        'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 
        'Int16Array', 'Uint16Array', 
        'Int32Array', 'Uint32Array', 
        'Float32Array', 'Float64Array'
    ]);

    // Detect SharedArrayBuffer / TypedArrays and Atomics
    traverse(ast, {
        Identifier(path: any) {
            const name = path.node.name;
            if (name === 'Atomics') {
                throw new TypeError("Atomics is not supported");
            }
            if (name === 'SharedArrayBuffer' || typedArrays.has(name)) {
                hasSharedArrayBuffer = true;
            }
            // Check for collision with FVM internal/reserved prefixes
            if (name.startsWith('__reg_') || 
                name.startsWith('__scope') || 
                name.startsWith('__state') || 
                name.startsWith('__gen_temp_') || 
                name.startsWith('__call_closure_') || 
                name === '__args' || 
                (name.startsWith('__fortress_') && 
                 name !== '__fortress_latest_bytecode' && 
                 name !== '__fortress_latest_opcodeMap' && 
                 name !== '__fortress_bytecode' && 
                 name !== '__fortress_opcodeMap' && 
                 name !== '__fortress_error__')) {
                throw new Error(`Reserved identifier name "${name}". User-defined variables, parameters, or functions must not use compiler-reserved prefixes.`);
            }
        },
        ConditionalExpression(path: any) {
            throw new Error("Ternary operator (ConditionalExpression) is not supported");
        },
        TryStatement(path: any) {
            throw new Error("Try/catch exception handling is not supported");
        },
        SequenceExpression(path: any) {
            throw new Error("Comma operator (SequenceExpression) is not supported");
        },
        AwaitExpression(path: any) {
            throw new Error("Async/await splitting is not supported");
        }
    });

    if (hasSharedArrayBuffer) {
        context.extraDeclarations.push(SAB_EMULATION_CODE);
    }

    const bankingWrapper = (funcNode: any, depth = 0) => {
        applyRegisterBanking(
            funcNode,
            context.options,
            context.activeFuncNodes,
            context.packedFunctions,
            context.extraFuncNodes,
            depth
        );
    };

    // 1. Check for Proxy extraction
    const proxyRes = transformProxy(ast, rootStmt, code, options, transpile);
    if (proxyRes.transformed && proxyRes.result) {
        return proxyRes.result;
    }

    // 2. Check for Dynamic eval() splitting
    const evalRes = transformEval(ast, rootStmt, code, options, transpile);
    if (evalRes.split && evalRes.result) {
        return evalRes.result;
    }

    // 3. Check for Large Function Auto-Splitting
    splitLargeFunction(rootStmt, code, options, context.warnings, ast);

    // 4. Transform Generators
    transformGenerators(ast, context, bankingWrapper);

    // 5. Preprocess Symbols
    preprocessSymbols(ast, context);

    // 6. Pre-scan variable types (Map, Set, etc.)
    resolveVariableTypes(ast, context.variableTypes);

    // 7. Transform Closures
    transformClosures(ast, context, bankingWrapper);

    // Temporarily attach extraFuncNodes to program body so they are traversed by visitors
    ast.program.body.push(...context.extraFuncNodes);
    context.extraFuncNodes.length = 0;

    // 8. Main AST traversal pass
    traverse(ast, {
        ObjectExpression: createObjectExpressionVisitor(context),
        StringLiteral: createStringLiteralVisitor(context),
        ThrowStatement: createThrowStatementVisitor(context),
        VariableDeclaration: createVariableDeclarationVisitor(context),
        Function: createFunctionVisitor(context),
        AssignmentExpression: createAssignmentExpressionVisitor(context),
        BinaryExpression: createBinaryExpressionVisitor(context),
        OptionalMemberExpression: createOptionalMemberExpressionVisitor(context),
        LogicalExpression: createLogicalExpressionVisitor(context),
        UnaryExpression: createUnaryExpressionVisitor(context),
        TemplateLiteral: createTemplateLiteralVisitor(context),
        ForOfStatement: createForOfStatementVisitor(context),
        MemberExpression: createMemberExpressionVisitor(context),
        CallExpression: createCallExpressionVisitor(context)
    });

    // 9. Transform ES6 Classes & Constructors
    traverse(ast, {
        ClassDeclaration: createClassDeclarationVisitor(context),
        NewExpression: createNewExpressionVisitor(context)
    });

    // 10. Apply Register Banking on root function declarations
    traverse(ast, {
        FunctionDeclaration(path: any) {
            bankingWrapper(path.node);
        }
    });

    // Call site rewriting for packed parameters
    function rewriteCallSites(node: any) {
        const fileNode = t.file(t.program(t.isProgram(node) ? node.body : [node]));
        const rewritten = new Set<any>();
        traverse(fileNode, {
            noScope: true,
            CallExpression(callPath: any) {
                if (rewritten.has(callPath.node)) return;
                const callee = callPath.node.callee;
                if (t.isIdentifier(callee) && context.packedFunctions.has(callee.name)) {
                    const originalParams = context.packedFunctions.get(callee.name);
                    if (originalParams) {
                        const props: any[] = [];
                        for (let i = 0; i < originalParams.length; i++) {
                            const paramName = originalParams[i];
                            const argVal = callPath.node.arguments[i] || t.identifier("undefined");
                            props.push(t.objectProperty(t.identifier(paramName), t.cloneNode(argVal)));
                        }
                        callPath.node.arguments = [t.objectExpression(props)];
                        rewritten.add(callPath.node);
                    }
                }
            }
        });
    }

    // Extract helper function declarations back to extraFuncNodes
    const rootName = context.options.functionName;
    const remainingBody: any[] = [];
    for (const stmt of ast.program.body) {
        if (t.isFunctionDeclaration(stmt) && stmt.id && stmt.id.name !== rootName) {
            context.extraFuncNodes.push(stmt);
        } else {
            remainingBody.push(stmt);
        }
    }
    ast.program.body = remainingBody;

    rewriteCallSites(ast.program);

    for (const node of context.extraFuncNodes) {
        rewriteCallSites(node);
        context.extraDeclarations.push(generate(node).code);
    }

    // Generate output code
    const generated = generate(ast, { jsescOption: { quotes: 'double' } });
    let jsCode = generated.code;

    // Append extra FVM declarations
    if (context.extraDeclarations.length > 0) {
        jsCode = context.extraDeclarations.join("\n") + "\n" + jsCode;
    }

    // Convert JS keywords to FVM
    const fvmSource = emitFvmSource(jsCode);

    // Emitters for wrappers and declarations
    const hasAwait = code.includes("await");
    let asyncSplit = null;
    if (hasAwait) {
        const boundaryCount = (code.match(/\bawait\b/g) || []).length;
        asyncSplit = {
            boundaryCount,
            variablesPassed: []
        };
    }

    let jsWrapper: string;
    if (context.isGeneratorFlag.value) {
        jsWrapper = emitGeneratorWrapper(options, context.originalParamNames, hasSharedArrayBuffer);
    } else {
        jsWrapper = emitDefaultWrapper(options, hasSharedArrayBuffer);
    }

    const tsDeclaration = emitDtsDeclaration(options, context.isGeneratorFlag.value);

    return {
        fvmSource,
        jsWrapper,
        tsDeclaration,
        usedStdlib: Array.from(context.usedStdlibSet),
        warnings: context.warnings,
        asyncSplit
    };
}

export { verifyEquivalenceSync, verifyEquivalence } from './verifier';
export { TranspileOptions, TranspileWarning, AsyncSplitInfo, TranspileResult, TranspileContext } from './types';
