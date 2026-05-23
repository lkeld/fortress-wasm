/**
 * Exposes generateHandshake returning a base64-encoded header value containing the concatenated raw fields
 */
export declare function generateHandshake(clientPublicKey: Uint8Array | Buffer): {
    handshakeHeader: string;
    sessionKey: Uint8Array;
};
/**
 * Dynamically scrambles a compiled .fvbc payload for a specific user session.
 *
 * @param fvbcPath Path to the compiled .fvbc file
 * @param originalMapPath Path to the original opcode_map.json
 * @param clientPublicKeyOrSessionKey Client X25519 public key (32 bytes) or provided session key (legacy)
 * @returns { payload: Uint8Array, newMap: number[], pngBuffer: Buffer, handshakeHeader: Buffer }
 */
export declare function scrambleSessionPayload(fvbcPath: string, originalMapPath: string, clientPublicKeyOrSessionKey?: Uint8Array | Buffer): {
    payload: Uint8Array;
    newMap: number[];
    pngBuffer: Buffer;
    handshakeHeader: Buffer;
};
//# sourceMappingURL=scrambler.d.ts.map