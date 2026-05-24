import * as fs from 'fs';
import * as path from 'path';
import { Parser } from './parser';
import { CodeGenerator } from './codegen';
import { transpile, verifyEquivalenceSync } from './js-transpiler';
import { stdlibSource } from './stdlib';
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

function extractBlock(src: string): string {
    let openBraces = 0;
    let foundOpen = false;
    let i = 0;
    
    while (i < src.length) {
        const char = src[i];
        
        // Check for comments first
        if (char === '/' && src[i + 1] === '/') {
            i += 2;
            while (i < src.length && src[i] !== '\n' && src[i] !== '\r') {
                i++;
            }
            continue;
        }
        
        if (char === '/' && src[i + 1] === '*') {
            i += 2;
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
                i++;
            }
            if (i < src.length) {
                i += 2; // skip the '*/'
            }
            continue;
        }
        
        // Check for strings
        if (char === '"' || char === "'" || char === '`') {
            const quote = char;
            i++;
            while (i < src.length && src[i] !== quote) {
                if (src[i] === '\\') {
                    i += 2; // skip escape and escaped char
                } else {
                    i++;
                }
            }
            if (i < src.length) {
                i++; // skip the closing quote
            }
            continue;
        }
        
        // Check for regex
        if (char === '/') {
            // Determine if it is indeed a regex (not division)
            let isRegex = false;
            // Scan backwards to see if it's a regex
            let j = i - 1;
            while (j >= 0 && /\s/.test(src[j])) {
                j--;
            }
            if (j < 0) {
                isRegex = true;
            } else {
                const lastChar = src[j];
                if (['=', '+', '-', '*', '&', '|', '^', '?', ':', ',', ';', '(', '[', '{', '!', '=', '<', '>'].includes(lastChar)) {
                    isRegex = true;
                } else if (/[a-zA-Z0-9_$]/.test(lastChar)) {
                    let wordStart = j;
                    while (wordStart > 0 && /[a-zA-Z0-9_$]/.test(src[wordStart - 1])) {
                        wordStart--;
                    }
                    const word = src.substring(wordStart, j + 1);
                    const regexKeywords = ['return', 'throw', 'yield', 'typeof', 'delete', 'void', 'in', 'instanceof', 'case', 'new'];
                    if (regexKeywords.includes(word)) {
                        isRegex = true;
                    }
                }
            }
            
            if (isRegex) {
                // Verify there is a closing '/' on the same line
                let k = i + 1;
                let foundClose = false;
                let inCharClass = false;
                while (k < src.length && src[k] !== '\n' && src[k] !== '\r') {
                    if (src[k] === '\\') {
                        k += 2;
                        continue;
                    }
                    if (src[k] === '[') {
                        inCharClass = true;
                    } else if (src[k] === ']' && inCharClass) {
                        inCharClass = false;
                    }
                    if (src[k] === '/' && !inCharClass) {
                        foundClose = true;
                        break;
                    }
                    k++;
                }
                
                if (foundClose) {
                    i = k + 1;
                    // Skip flags
                    while (i < src.length && /[a-z]/i.test(src[i])) {
                        i++;
                    }
                    continue;
                }
            }
        }
        
        if (char === '{') {
            openBraces++;
            foundOpen = true;
        } else if (char === '}') {
            openBraces--;
            if (foundOpen && openBraces === 0) {
                return src.substring(0, i + 1);
            }
        }
        i++;
    }
    return src;
}

export function scanFile(filePath: string): ProtectedFunction[] {
    const source = fs.readFileSync(filePath, 'utf8');
    const results: ProtectedFunction[] = [];
    
    const JSDocRegex = /\/\*\*([\s\S]*?)\*\//g;
    let match;
    
    while ((match = JSDocRegex.exec(source)) !== null) {
        const commentContent = match[1];
        if (!commentContent.includes('@protect')) continue;
        
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
        if (remainingSource.startsWith('export')) {
            isExported = true;
            remainingSource = remainingSource.substring(6).trim();
        }

        // Extract the functional block to avoid syntax errors from outer scopes (e.g. classes)
        const blockCode = extractBlock(remainingSource);
        
        try {
            // Parse using Babel
            const fileAst = parser.parse(blockCode, {
                sourceType: 'module',
                plugins: ['typescript', 'classProperties']
            });

            const stmt = fileAst.program.body[0];
            if (!stmt) continue;

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
            const { code, opcodeMap } = codegen.generate(fvmAst);

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

        } catch (e: any) {
            console.error("Scanner Error:", e.stack || e);
            // Silence/propagate compilation errors for scanner robustness
        }
    }
    
    return results;
}

export function scanDirectory(dirPath: string): ProtectedFunction[] {
    let results: ProtectedFunction[] = [];
    if (!fs.existsSync(dirPath)) return results;
    
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
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
