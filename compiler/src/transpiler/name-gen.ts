import * as crypto from 'crypto';

export function generateSymbolSeed(): string {
    return crypto.randomBytes(4).toString('hex');
}
