export interface TranspileOptions {
    functionName: string;
    filePath: string;
    verifyEquivalence: boolean;
}

export interface TranspileWarning {
    line: number;
    message: string;
    suggestion: string;
}

export interface AsyncSplitInfo {
    boundaryCount: number;
    variablesPassed: string[];
}

export interface TranspileResult {
    fvmSource: string;
    jsWrapper: string;
    tsDeclaration: string;
    usedStdlib: string[];
    warnings: TranspileWarning[];
    asyncSplit: AsyncSplitInfo | null;
}

export interface TranspileContext {
    options: TranspileOptions;
    warnings: TranspileWarning[];
    usedStdlibSet: Set<string>;
    variableTypes: Map<string, string>;
    mergesortCounter: { value: number };
    extraDeclarations: string[];
    symbolSeed: string;
    symbolCounter: { value: number };
    closureCounter: { value: number };
    originalParamNames: string[];
    packedFunctions: Map<string, string[]>;
    extraFuncNodes: any[];
    activeFuncNodes: any[];
    isGeneratorFlag: { value: boolean };
}
