import { TranspileOptions } from '../types';

export function emitDtsDeclaration(options: TranspileOptions, isGenerator: boolean): string {
    return isGenerator
        ? `export declare function ${options.functionName}(...args: any[]): any;\n`
        : `export declare function ${options.functionName}(...args: any[]): Promise<any>;\n`;
}
