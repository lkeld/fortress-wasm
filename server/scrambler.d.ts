/**
 * Dynamically scrambles a compiled .fvbc payload for a specific user session.
 *
 * @param fvbcPath Path to the compiled .fvbc file
 * @param originalMapPath Path to the original opcode_map.json
 * @returns { payload: Uint8Array, newMap: number[], pngBuffer: Buffer }
 */
export declare function scrambleSessionPayload(fvbcPath: string, originalMapPath: string): {
    payload: Uint8Array;
    newMap: number[];
    pngBuffer: Buffer;
};
//# sourceMappingURL=scrambler.d.ts.map