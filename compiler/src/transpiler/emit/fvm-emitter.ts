export function emitFvmSource(jsCode: string): string {
    return jsCode.replace(/\bfunction\b/g, 'fn');
}
