export class TranspilerError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'TranspilerError';
    }
}
