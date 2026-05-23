export interface NonceStore {
    consume(nonceHex: string, timestamp: string): Promise<boolean> | boolean;
}

export class InMemoryNonceStore implements NonceStore {
    private consumed = new Map<string, number>();
    private cleanupInterval: NodeJS.Timeout;

    constructor(cleanupMs: number = 30000) {
        this.cleanupInterval = setInterval(() => this.cleanup(), cleanupMs);
        if (this.cleanupInterval && typeof this.cleanupInterval.unref === 'function') {
            this.cleanupInterval.unref();
        }
    }

    public consume(nonceHex: string, timestamp: string): boolean {
        const now = Math.floor(Date.now() / 1000);
        const ts = parseInt(timestamp, 10);

        // Check if timestamp is expired (older than 5 minutes or more than 5 minutes in future)
        if (isNaN(ts) || Math.abs(now - ts) > 300) {
            return false;
        }

        // Check if nonce has already been consumed
        if (this.consumed.has(nonceHex)) {
            return false;
        }

        // Mark nonce as consumed
        this.consumed.set(nonceHex, ts);
        return true;
    }

    private cleanup(): void {
        const now = Math.floor(Date.now() / 1000);
        for (const [nonceHex, ts] of this.consumed.entries()) {
            if (now - ts > 300) {
                this.consumed.delete(nonceHex);
            }
        }
    }

    public destroy(): void {
        clearInterval(this.cleanupInterval);
    }
}

export class RedisNonceStore implements NonceStore {
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
    constructor() {
        // Initialize Redis client here in actual implementation
    }

    public async consume(nonceHex: string, timestamp: string): Promise<boolean> {
        const now = Math.floor(Date.now() / 1000);
        const ts = parseInt(timestamp, 10);

        // Enforce the 5-minute window check before querying Redis
        if (isNaN(ts) || Math.abs(now - ts) > 300) {
            return false;
        }

        // Stub logic: in production, check Redis. Here we print a warning and return true.
        console.warn("RedisNonceStore: stub implementation is active. Nonce checking is bypassed.");
        return true;
    }
}
