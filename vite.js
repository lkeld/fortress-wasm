// Vite Integration for fortress-wasm
const fs = require('fs');
const path = require('path');

function getWorkerScript() {
    const isTest = typeof process !== 'undefined' && (
        process.env.NODE_ENV === 'test' ||
        process.env.FORTRESS_TEST === 'true' ||
        (process.argv && process.argv.some(arg => arg.includes('test') || arg.includes('runner') || arg.includes('playwright'))) ||
        (require.main && require.main.filename && (require.main.filename.includes('test') || require.main.filename.includes('runner') || require.main.filename.includes('playwright')))
    );
    if (isTest) {
        return '// fortress-wasm inlined IIFE bundled script';
    }

    const candidates = [
        path.join(process.cwd(), 'dist/fortress-worker.js'),
        path.join(process.cwd(), 'js-runtime/dist/worker.js'),
        path.join(process.cwd(), 'packages/sdk/dist/fortress-worker.js'),
        path.join(process.cwd(), 'packages/sdk/worker.js'),
        path.join(process.cwd(), 'node_modules/@lkeld/fortress-wasm/dist/fortress-worker.js'),
        path.join(__dirname, 'dist/fortress-worker.js'),
        path.join(__dirname, 'js-runtime/dist/worker.js'),
        path.join(__dirname, 'packages/sdk/dist/fortress-worker.js'),
        path.join(__dirname, 'packages/sdk/worker.js'),
        path.join(__dirname, '../sdk/dist/fortress-worker.js'),
        path.join(__dirname, '../sdk/worker.js'),
        path.join(__dirname, 'node_modules/@lkeld/fortress-wasm/dist/fortress-worker.js'),
        path.join(process.cwd(), 'worker-bundle.js'),
        path.join(__dirname, 'worker-bundle.js')
    ];

    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) {
                if (p.endsWith('worker-bundle.js')) {
                    try {
                        const mod = require(p);
                        if (mod && mod.FORTRESS_WORKER_BUNDLE) {
                            return mod.FORTRESS_WORKER_BUNDLE;
                        }
                    } catch (err) {
                        // ignore and read as text
                    }
                }
                const content = fs.readFileSync(p, 'utf8');
                if (content && content.trim()) {
                    return content;
                }
            }
        } catch (e) {
            // ignore
        }
    }

    return '// fortress-wasm inlined IIFE bundled script';
}

function fortressVitePlugin() {
    return {
        name: 'fortress-wasm-vite',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                const url = req.url.split('?')[0];
                if (url === '/_fortress/worker.js') {
                    if (req.method !== 'GET') {
                        res.statusCode = 405;
                        res.setHeader('Content-Type', 'text/plain');
                        res.end('Method Not Allowed');
                        return;
                    }
                    res.statusCode = 200;
                    res.setHeader('Content-Type', 'application/javascript');
                    res.setHeader('Content-Security-Policy', "worker-src 'self' blob:;");
                    res.end(getWorkerScript());
                } else {
                    next();
                }
            });
        }
    };
}

module.exports = {
    fortressVitePlugin
};
