export interface NonceStore {
    consume(nonceHex: string, timestamp: string): Promise<boolean> | boolean;
}
export declare class InMemoryNonceStore implements NonceStore {
    private consumed;
    private cleanupInterval;
    constructor(cleanupMs?: number);
    consume(nonceHex: string, timestamp: string): boolean;
    private cleanup;
    destroy(): void;
}
export declare class RedisNonceStore implements NonceStore {
    /**
     * Stub implementation for production environments using Redis.
     *
     * To integrate with production Redis:
     * 1. Install redis library: `npm install redis` (and `@types/redis` if needed).
     * 2. Initialize the Redis client in the constructor.
     * 3. Implement consume() with a key-value SET command using NX (Only set if not exists)
     *    and PX/EX options for expiration matching the 5-minute sliding window (300 seconds).
     *
     * Example:
     * ```typescript
     * const acquired = await this.redis.set(`nonce:${nonceHex}`, '1', { NX: true, EX: 300 });
     * return !!acquired;
     * ```
     */
    constructor();
    consume(nonceHex: string, timestamp: string): Promise<boolean>;
}
//# sourceMappingURL=nonce-store.d.ts.map