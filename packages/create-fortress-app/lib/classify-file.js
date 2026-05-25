const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');

const nodeBuiltins = new Set([
    'fs', 'path', 'os', 'child_process', 'crypto', 'http', 'https', 'net', 'dns', 'url',
    'querystring', 'readline', 'stream', 'buffer', 'util', 'vm', 'zlib', 'events', 'assert',
    'async_hooks', 'cluster', 'dgram', 'diagnostics_channel', 'perf_hooks', 'process', 'punycode',
    'repl', 'string_decoder', 'tls', 'trace_events', 'tty', 'v8', 'worker_threads'
]);

const serverOnlyImports = new Set([
    'next/headers', 'next/server', 'next/cache', 'server-only'
]);

const clientStateLibraries = new Set([
    'zustand', 'jotai', 'recoil', 'redux', '@reduxjs/toolkit', 'mobx', 'mobx-react'
]);

const browserGlobals = new Set([
    'window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'indexedDB', 'history', 'location'
]);

function isServerModule(name) {
    if (nodeBuiltins.has(name) || name.startsWith('node:')) {
        return true;
    }
    if (serverOnlyImports.has(name)) {
        return true;
    }
    return false;
}

function isClientLibrary(name) {
    if (clientStateLibraries.has(name)) {
        return true;
    }
    for (const lib of clientStateLibraries) {
        if (name === lib || name.startsWith(lib + '/')) {
            return true;
        }
    }
    return false;
}

function isBrowserGlobalName(name) {
    return browserGlobals.has(name);
}

function findSourceFiles(dir) {
    const results = [];
    const ignoredDirs = ['node_modules', '.git', 'dist', 'build', '.nuxt', '.next', '.svelte-kit', '.fortress_keys', 'protected'];
    const priorityDirs = ['lib', 'utils', 'helpers', 'services', 'core', 'shared'];
    function walk(currentDir) {
        let files;
        try {
            files = fs.readdirSync(currentDir);
        } catch (e) {
            return;
        }
        files.sort((a, b) => {
            const aIsPriority = priorityDirs.includes(a.toLowerCase());
            const bIsPriority = priorityDirs.includes(b.toLowerCase());
            if (aIsPriority && !bIsPriority) return -1;
            if (!aIsPriority && bIsPriority) return 1;
            return a.localeCompare(b);
        });
        for (const file of files) {
            const fullPath = path.join(currentDir, file);
            let stat;
            try {
                stat = fs.statSync(fullPath);
            } catch (e) {
                continue;
            }
            if (stat.isDirectory()) {
                if (!ignoredDirs.includes(file)) {
                    walk(fullPath);
                }
            } else if (stat.isFile()) {
                const ext = path.extname(file);
                if (['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'].includes(ext)) {
                    if (!file.includes('.config.') && file !== 'package.json' && file !== 'package-lock.json') {
                        results.push(path.relative(dir, fullPath));
                    }
                }
            }
        }
    }
    walk(dir);
    return results;
}

function extractImportsFromFile(absolutePath) {
    const imports = new Set();
    let content;
    try {
        content = fs.readFileSync(absolutePath, 'utf8');
    } catch (e) {
        return imports;
    }
    
    let ast;
    try {
        ast = parser.parse(content, {
            sourceType: 'module',
            plugins: [
                'typescript',
                'jsx',
                'decorators-legacy',
                'classProperties',
                'dynamicImport',
                'optionalChaining',
                'nullishCoalescingOperator'
            ],
            errorRecovery: true
        });
    } catch (e) {
        return imports;
    }
    
    function traverse(node) {
        if (!node) return;
        
        if (node.type === 'ImportDeclaration' && node.source && node.source.type === 'StringLiteral') {
            imports.add(node.source.value);
        } else if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source && node.source.type === 'StringLiteral') {
            imports.add(node.source.value);
        } else if (node.type === 'CallExpression') {
            if (node.callee && node.callee.type === 'Identifier' && node.callee.name === 'require') {
                if (node.arguments && node.arguments[0] && node.arguments[0].type === 'StringLiteral') {
                    imports.add(node.arguments[0].value);
                }
            } else if (node.callee && node.callee.type === 'Import') {
                if (node.arguments && node.arguments[0] && node.arguments[0].type === 'StringLiteral') {
                    imports.add(node.arguments[0].value);
                }
            }
        }
        
        for (const key in node) {
            const child = node[key];
            if (Array.isArray(child)) {
                for (const item of child) {
                    if (item && typeof item === 'object' && typeof item.type === 'string') {
                        traverse(item);
                    }
                }
            } else if (child && typeof child === 'object' && typeof child.type === 'string') {
                traverse(child);
            }
        }
    }
    
    traverse(ast);
    return imports;
}

function resolvesTo(importerDir, importString, targetFile) {
    if (!importString.startsWith('.') && !importString.startsWith('/')) {
        return false;
    }
    const resolved = path.resolve(importerDir, importString);
    if (resolved === targetFile) return true;
    
    const exts = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'];
    for (const ext of exts) {
        if (resolved + ext === targetFile) return true;
    }
    for (const ext of exts) {
        if (path.join(resolved, 'index' + ext) === targetFile) return true;
    }
    return false;
}

let importMapCache = null;
let cachedProjectRoot = null;

function getImportMap(projectRoot) {
    if (importMapCache && cachedProjectRoot === projectRoot) {
        return importMapCache;
    }
    importMapCache = new Map();
    cachedProjectRoot = projectRoot;
    
    const files = findSourceFiles(projectRoot);
    for (const relativePath of files) {
        const absolutePath = path.resolve(projectRoot, relativePath);
        const imports = extractImportsFromFile(absolutePath);
        importMapCache.set(absolutePath, imports);
    }
    return importMapCache;
}

function runTier4PathHeuristics(filePath, projectRoot) {
    const absolutePath = path.resolve(projectRoot, filePath);
    const relativePath = path.relative(projectRoot, absolutePath).replace(/\\/g, '/');
    const checkPath = '/' + relativePath;
    
    if (
        checkPath.includes('/store/') ||
        checkPath.includes('/stores/') ||
        checkPath.includes('/hooks/use') ||
        checkPath.includes('/components/') ||
        (checkPath.includes('/app/') && !checkPath.includes('/api/'))
    ) {
        return 'CLIENT';
    }
    
    if (checkPath.includes('/types/') || checkPath.includes('/interfaces/')) {
        return 'TYPES_ONLY';
    }
    
    return 'UNKNOWN';
}

function classifyFile(filePath, projectRoot) {
    const absolutePath = path.resolve(projectRoot, filePath);
    const relativePath = path.relative(projectRoot, absolutePath).replace(/\\/g, '/');
    const checkPath = '/' + relativePath;
    
    // Tier 1: Path-based deterministic checks
    if (/\/(api|app\/api)\/.*\.(ts|js|tsx|jsx)$/i.test(checkPath)) {
        return 'SERVER';
    }
    if (/\/middleware\.(ts|js)$/i.test(checkPath)) {
        return 'SERVER';
    }
    if (/\.d\.ts$/i.test(checkPath)) {
        return 'TYPES_ONLY';
    }
    
    let content = '';
    try {
        content = fs.readFileSync(absolutePath, 'utf8');
    } catch (e) {
        return 'UNKNOWN';
    }
    
    let ast;
    try {
        ast = parser.parse(content, {
            sourceType: 'module',
            plugins: [
                'typescript',
                'jsx',
                'decorators-legacy',
                'classProperties',
                'dynamicImport',
                'optionalChaining',
                'nullishCoalescingOperator'
            ],
            errorRecovery: true
        });
    } catch (e) {
        // Fallback for directives using regex if parser crashes
        const clientDirectiveRegex = /^\s*(?:\/\/[^\r\n]*\r?\n|\/\*[\s\S]*?\*\/|\s)*['"]use client['"]/i;
        const serverDirectiveRegex = /^\s*(?:\/\/[^\r\n]*\r?\n|\/\*[\s\S]*?\*\/|\s)*['"]use server['"]/i;
        if (clientDirectiveRegex.test(content)) return 'CLIENT';
        if (serverDirectiveRegex.test(content)) return 'SERVER';
        return 'UNKNOWN';
    }
    
    let hasUseClient = false;
    let hasUseServer = false;
    
    if (ast && ast.program && ast.program.directives) {
        for (const dir of ast.program.directives) {
            if (dir.value && dir.value.value === 'use client') {
                hasUseClient = true;
            }
            if (dir.value && dir.value.value === 'use server') {
                hasUseServer = true;
            }
        }
    }
    
    if (!hasUseClient && /^\s*(?:\/\/[^\r\n]*\r?\n|\/\*[\s\S]*?\*\/|\s)*['"]use client['"]/i.test(content)) {
        hasUseClient = true;
    }
    if (!hasUseServer && /^\s*(?:\/\/[^\r\n]*\r?\n|\/\*[\s\S]*?\*\/|\s)*['"]use server['"]/i.test(content)) {
        hasUseServer = true;
    }
    
    // AST traversal to gather Tier 1/2 signals
    let hasServerImport = false;
    let hasClientStateLibrary = false;
    let hasReactHook = false;
    let hasBrowserGlobal = false;
    let hasTypeofWindow = false;
    
    function traverse(node) {
        if (!node) return;
        
        if (node.type === 'ImportDeclaration' && node.source && node.source.type === 'StringLiteral') {
            const val = node.source.value;
            if (isServerModule(val)) hasServerImport = true;
            if (isClientLibrary(val)) hasClientStateLibrary = true;
        } else if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source && node.source.type === 'StringLiteral') {
            const val = node.source.value;
            if (isServerModule(val)) hasServerImport = true;
            if (isClientLibrary(val)) hasClientStateLibrary = true;
        } else if (node.type === 'CallExpression') {
            if (node.callee && node.callee.type === 'Identifier' && node.callee.name === 'require') {
                if (node.arguments && node.arguments[0] && node.arguments[0].type === 'StringLiteral') {
                    const val = node.arguments[0].value;
                    if (isServerModule(val)) hasServerImport = true;
                    if (isClientLibrary(val)) hasClientStateLibrary = true;
                }
            } else if (node.callee && node.callee.type === 'Import') {
                if (node.arguments && node.arguments[0] && node.arguments[0].type === 'StringLiteral') {
                    const val = node.arguments[0].value;
                    if (isServerModule(val)) hasServerImport = true;
                    if (isClientLibrary(val)) hasClientStateLibrary = true;
                }
            }
        }
        
        if (node.type === 'Identifier') {
            if (/^use[A-Z]/.test(node.name)) {
                hasReactHook = true;
            }
            if (isBrowserGlobalName(node.name)) {
                hasBrowserGlobal = true;
            }
        }
        
        if (node.type === 'UnaryExpression' && node.operator === 'typeof') {
            if (node.argument && node.argument.type === 'Identifier' && node.argument.name === 'window') {
                hasTypeofWindow = true;
            }
        }
        
        for (const key in node) {
            const child = node[key];
            if (Array.isArray(child)) {
                for (const item of child) {
                    if (item && typeof item === 'object' && typeof item.type === 'string') {
                        traverse(item);
                    }
                }
            } else if (child && typeof child === 'object' && typeof child.type === 'string') {
                traverse(child);
            }
        }
    }
    
    traverse(ast);
    
    const isClient = hasUseClient || hasClientStateLibrary || hasReactHook || hasBrowserGlobal || hasTypeofWindow;
    const isServer = hasUseServer || hasServerImport;
    
    if (isClient && isServer) {
        return 'AMBIGUOUS';
    } else if (isServer) {
        return 'SERVER';
    } else if (isClient) {
        return 'CLIENT';
    }
    
    return 'UNKNOWN';
}

function resolveClassificationViaImporters(filePath, projectRoot, allClassified) {
    const absoluteTargetFile = path.resolve(projectRoot, filePath);
    const importerClassifications = [];
    
    const projectFiles = findSourceFiles(projectRoot);
    const importMap = getImportMap(projectRoot);
    
    for (const relativePath of projectFiles) {
        const candidateAbsolute = path.resolve(projectRoot, relativePath);
        if (candidateAbsolute === absoluteTargetFile) {
            continue;
        }
        
        const imports = importMap.get(candidateAbsolute);
        if (imports) {
            const candidateDir = path.dirname(candidateAbsolute);
            let isImporter = false;
            for (const imp of imports) {
                if (resolvesTo(candidateDir, imp, absoluteTargetFile)) {
                    isImporter = true;
                    break;
                }
            }
            if (isImporter) {
                const cls = allClassified[relativePath] || allClassified[candidateAbsolute] || 'UNKNOWN';
                importerClassifications.push(cls);
            }
        }
    }
    
    if (importerClassifications.length === 0) {
        return runTier4PathHeuristics(filePath, projectRoot);
    }
    
    const hasClient = importerClassifications.includes('CLIENT');
    const hasServer = importerClassifications.includes('SERVER');
    const allAreClient = importerClassifications.every(c => c === 'CLIENT');
    const allAreServer = importerClassifications.every(c => c === 'SERVER');
    
    if (allAreClient) {
        return 'CLIENT';
    } else if (allAreServer) {
        return 'SERVER';
    } else if (hasClient && hasServer) {
        return 'AMBIGUOUS';
    }
    
    return runTier4PathHeuristics(filePath, projectRoot);
}

module.exports = {
    classifyFile,
    resolveClassificationViaImporters
};
