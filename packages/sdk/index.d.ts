export class FortressClient {
    static init(endpoint: string): Promise<FortressClient>;
    static createWorker(forceStrategy?: string | null): Promise<any>;
    execute(input: any): Promise<any>;
    dispose(): void;
}
