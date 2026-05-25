import * as fs from 'fs';
import * as path from 'path';
import { Parser } from './parser';
import { CodeGenerator } from './codegen';
import { transpile, verifyEquivalenceSync } from './transpiler';
import { stdlibSource } from './stdlib';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import * as os from 'os';

declare var process: any;

const IGNORED_DIRS = ['node_modules', '.git', 'dist', '.next', 'build', 'out', '.nuxt', '.cache', '.fortress_keys'];

function scanDirectorySync(dirPath: string, options?: any): string[] {
    const include = options && options.include;
    const matches = (filePath: string) => {
        const includePat = include || /\.(js|ts)$/;
        if (includePat instanceof RegExp) {
            return includePat.test(filePath);
        }
        if (typeof includePat === 'function') {
            return includePat(filePath);
        }
        if (Array.isArray(includePat)) {
            return includePat.some(pat => {
                if (pat instanceof RegExp) return pat.test(filePath);
                return filePath.endsWith(pat) || filePath.includes(pat);
            });
        }
        if (typeof includePat === 'string') {
            return filePath.endsWith(includePat) || filePath.includes(includePat);
        }
        return true;
    };
    
    let results: string[] = [];
    if (!fs.existsSync(dirPath)) return results;
    
    const stat = fs.statSync(dirPath);
    if (stat.isFile()) {
        if (matches(dirPath)) {
            return [dirPath];
        }
        return [];
    }
    
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
        if (IGNORED_DIRS.includes(file)) continue;
        const fullPath = path.join(dirPath, file);
        const s = fs.statSync(fullPath);
        if (s.isDirectory()) {
            results = results.concat(scanDirectorySync(fullPath, options));
        } else {
            if (matches(fullPath)) {
                results.push(fullPath);
            }
        }
    }
    return results;
}

if (!isMainThread && parentPort) {
    parentPort.on('message', (msg: any) => {
        if (msg && msg.type === 'SCAN_FILE') {
            try {
                const results = scanFile(msg.filePath);
                parentPort!.postMessage({ type: 'SCAN_RESULT', results });
            } catch (err: any) {
                parentPort!.postMessage({ type: 'SCAN_ERROR', error: err.message });
            }
        }
    });
}

const parser: any = require('@babel/parser');
const t: any = require('@babel/types');
const generate: any = require('@babel/generator').default;

export interface ProtectedFunction {
    name: string;
    customName?: string;
    endpoint?: string;
    code: string;
    filePath: string;
    isExported: boolean;
    opcodeMap?: number[];
}

// Parses a declaration while iteratively slicing the code to recover from syntax errors.
function parseDeclaration(code: string): { ast: any; slicedCode: string } {
    let currentCode = code;
    while (true) {
        try {
            const ast = parser.parse(currentCode, {
                sourceType: 'module',
                plugins: [
                    'typescript',
                    'jsx',
                    ['decorators', { decoratorsBeforeExport: true }],
                    'classProperties',
                    'classPrivateProperties',
                    'classPrivateMethods',
                    'dynamicImport',
                    'optionalChaining',
                    'nullishCoalescingOperator',
                    'exportDefaultFrom',
                    'importMeta'
                ]
            });
            return { ast, slicedCode: currentCode };
        } catch (e: any) {
            if (typeof e.pos === 'number' && e.pos > 0 && e.pos < currentCode.length) {
                currentCode = currentCode.substring(0, e.pos);
            } else {
                throw e;
            }
        }
    }
}

export function scanFile(filePath: string): ProtectedFunction[] {
    const source = fs.readFileSync(filePath, 'utf8');
    const results: ProtectedFunction[] = [];
    
    const JSDocRegex = /\/\*\*([\s\S]*?)\*\//g;
    let match;
    
    while ((match = JSDocRegex.exec(source)) !== null) {
        const commentContent = match[1];
        if (!/@protect\b/.test(commentContent)) continue;
        
        let customName: string | undefined;
        let endpoint: string | undefined;
        for (const line of commentContent.split(/\r?\n/)) {
            const trimmedLine = line.trim().replace(/^\*\s*/, '');
            const nameMatch = trimmedLine.match(/@protect-name\s+(.+)/);
            if (nameMatch) customName = nameMatch[1].trim();
            const endpointMatch = trimmedLine.match(/@protect-endpoint\s+(.+)/);
            if (endpointMatch) endpoint = endpointMatch[1].trim();
        }
        
        const commentEndIndex = JSDocRegex.lastIndex;
        let remainingSource = source.substring(commentEndIndex).trim();
        
        let isExported = false;
        let codeToParse = remainingSource;
        if (codeToParse.startsWith('export default')) {
            isExported = true;
            codeToParse = codeToParse.substring('export default'.length).trim();
        } else if (codeToParse.startsWith('export')) {
            isExported = true;
            codeToParse = codeToParse.substring('export'.length).trim();
        }

        const { ast: fileAst, slicedCode } = parseDeclaration(codeToParse);

        const stmt = fileAst.program.body[0];
        if (!stmt) continue;

        const blockCode = slicedCode.substring(stmt.start || 0, stmt.end || slicedCode.length);

        let functionName = "";
        let originalJsCode = blockCode;

        if (t.isFunctionDeclaration(stmt)) {
            functionName = stmt.id ? stmt.id.name : "";
        } else if (t.isClassDeclaration(stmt)) {
            functionName = stmt.id ? stmt.id.name : "";
        } else if (t.isVariableDeclaration(stmt)) {
            const decl = stmt.declarations[0];
            if (t.isIdentifier(decl.id)) {
                functionName = decl.id.name;
            }
        }

        if (!functionName) continue;

        // Transpile using JS-to-FVM Transpiler
        const { fvmSource, usedStdlib } = transpile(originalJsCode, {
            functionName,
            filePath,
            verifyEquivalence: false // will run manually below
        });

        // Extract used standard library helper ASTs
        const stdlibParser = new Parser(stdlibSource);
        const stdlibAst = stdlibParser.parseProgram();
        const neededHelpers = stdlibAst.body.filter(s => 
            s.type === 'FunctionDeclaration' && usedStdlib.includes(s.name.name)
        );

        // Parse FVM AST and prepend needed stdlib helpers
        const fvmParser = new Parser(fvmSource);
        const fvmAst = fvmParser.parseProgram();
        fvmAst.body.unshift(...neededHelpers);

        // Compile to bytecode
        const codegen = new CodeGenerator();
        const { code, opcodeMap } = codegen.generate(fvmAst, functionName);

        // Run Equivalence Verification
        verifyEquivalenceSync(originalJsCode, code, Array.from(opcodeMap));

        results.push({
            name: functionName,
            customName,
            endpoint,
            code: Buffer.from(code).toString('base64'),
            filePath,
            isExported,
            opcodeMap: Array.from(opcodeMap)
        });
    }
    
    return results;
}

export function scanDirectory(dirPath: string): ProtectedFunction[] {
    let results: ProtectedFunction[] = [];
    if (!fs.existsSync(dirPath)) return results;
    
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
        if (IGNORED_DIRS.includes(file)) continue;
        const fullPath = path.join(dirPath, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            results = results.concat(scanDirectory(fullPath));
        } else if (file.endsWith('.js') || file.endsWith('.ts')) {
            results = results.concat(scanFile(fullPath));
        }
    }
    return results;
}

function findFilesRecursive(dir: string): string[] {
    let results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    const stat = fs.statSync(dir);
    if (stat.isFile()) {
        if (dir.endsWith('.js') || dir.endsWith('.ts')) {
            results.push(dir);
        }
        return results;
    }
    const list = fs.readdirSync(dir);
    for (const file of list) {
        if (IGNORED_DIRS.includes(file)) continue;
        const fullPath = path.join(dir, file);
        const s = fs.statSync(fullPath);
        if (s.isDirectory()) {
            results = results.concat(findFilesRecursive(fullPath));
        } else if (file.endsWith('.js') || file.endsWith('.ts')) {
            results.push(fullPath);
        }
    }
    return results;
}

export async function scanDirectoryParallel(dirPath: string): Promise<{ results: ProtectedFunction[], errors: { file: string, message: string }[] }> {
    const files = findFilesRecursive(dirPath);
    if (files.length === 0) return { results: [], errors: [] };

    let workerScript = __filename;
    if (workerScript.endsWith('.ts')) {
        const compiledPath = path.resolve(__dirname, '../dist/scanner.js');
        if (fs.existsSync(compiledPath)) {
            workerScript = compiledPath;
        }
    }

    const limit = Math.min((os.cpus() || []).length || 4, 8);
    const resultsArray: { results: ProtectedFunction[], error?: string }[] = new Array(files.length);
    let index = 0;

    async function runWorker(file: string): Promise<{ results: ProtectedFunction[], error?: string }> {
        return new Promise<{ results: ProtectedFunction[], error?: string }>((resolve) => {
            let worker: Worker;
            try {
                worker = new Worker(workerScript);
            } catch (err: any) {
                try {
                    const results = scanFile(file);
                    return resolve({ results });
                } catch (fallbackErr: any) {
                    return resolve({ results: [], error: fallbackErr.message });
                }
            }

            let resolved = false;
            worker.on('message', (msg: any) => {
                if (msg && msg.type === 'SCAN_RESULT') {
                    if (!resolved) {
                        resolved = true;
                        worker.terminate();
                        resolve({ results: msg.results });
                    }
                } else if (msg && msg.type === 'SCAN_ERROR') {
                    if (!resolved) {
                        resolved = true;
                        worker.terminate();
                        resolve({ results: [], error: msg.error });
                    }
                }
            });

            worker.on('error', (err: any) => {
                if (!resolved) {
                    resolved = true;
                    worker.terminate();
                    try {
                        const results = scanFile(file);
                        resolve({ results });
                    } catch (fallbackErr: any) {
                        resolve({ results: [], error: fallbackErr.message || String(err) });
                    }
                }
            });

            worker.on('exit', (code) => {
                if (!resolved) {
                    resolved = true;
                    resolve({ results: [], error: `Worker exited with code ${code}` });
                }
            });

            worker.postMessage({ type: 'SCAN_FILE', filePath: file });
        });
    }

    async function workerPoolSlot() {
        while (index < files.length) {
            const currentIdx = index++;
            const file = files[currentIdx];
            resultsArray[currentIdx] = await runWorker(file);
        }
    }

    const poolPromises: Promise<void>[] = [];
    for (let i = 0; i < Math.min(limit, files.length); i++) {
        poolPromises.push(workerPoolSlot());
    }
    await Promise.all(poolPromises);

    const allFunctions: ProtectedFunction[] = [];
    const errors: { file: string, message: string }[] = [];
    for (let i = 0; i < files.length; i++) {
        const res = resultsArray[i];
        if (res) {
            if (res.error) {
                errors.push({ file: files[i], message: res.error });
            } else {
                allFunctions.push(...res.results);
            }
        }
    }
    return { results: allFunctions, errors };
}
