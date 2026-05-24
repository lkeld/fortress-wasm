import { AsyncSplitInfo } from '../types';

export function checkAsync(code: string): AsyncSplitInfo | null {
    const hasAwait = code.includes("await");
    if (hasAwait) {
        const boundaryCount = (code.match(/\bawait\b/g) || []).length;
        return {
            boundaryCount,
            variablesPassed: []
        };
    }
    return null;
}
