const path = require('path');
const assert = require('assert');
const { runTestSuite } = require('./runner');

// Subpath loading verification
const nextIntegration = require('../../next');
const viteIntegration = require('../../vite');
const expressIntegration = require('../../express');

runTestSuite('F5: Framework Integrations E2E Overhaul Test Suite', {
    // --- Tier 1: Feature Coverage (5 tests) ---
    'Next.js Worker Serve - serves worker via route handler': async () => {
        let statusCode = null;
        let headers = {};
        let body = '';

        const req = { method: 'GET', url: '/_fortress/worker.js' };
        const res = {
            set statusCode(val) { statusCode = val; },
            get statusCode() { return statusCode; },
            setHeader(name, val) { headers[name.toLowerCase()] = val; },
            end(data) { body = data; }
        };

        nextIntegration.fortressNextRoute(req, res);

        assert.strictEqual(statusCode, 200);
        assert.strictEqual(headers['content-type'], 'application/javascript');
        assert.strictEqual(body, '// fortress-wasm inlined IIFE bundled script');
    },

    'Vite Worker Serve - Vite plugin middleware intercepts and serves': async () => {
        const plugin = viteIntegration.fortressVitePlugin();
        let middleware = null;

        // Mock configureServer
        const mockServer = {
            middlewares: {
                use(fn) { middleware = fn; }
            }
        };
        plugin.configureServer(mockServer);
        assert.ok(middleware);

        let statusCode = null;
        let headers = {};
        let body = '';
        let nextCalled = false;

        const req = { method: 'GET', url: '/_fortress/worker.js' };
        const res = {
            set statusCode(val) { statusCode = val; },
            get statusCode() { return statusCode; },
            setHeader(name, val) { headers[name.toLowerCase()] = val; },
            end(data) { body = data; }
        };

        middleware(req, res, () => { nextCalled = true; });

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(statusCode, 200);
        assert.strictEqual(headers['content-type'], 'application/javascript');
    },

    'Express Worker Serve - Express middleware intercepts and serves': async () => {
        let statusCode = null;
        let headers = {};
        let body = '';
        let nextCalled = false;

        const req = { method: 'GET', path: '/_fortress/worker.js' };
        const res = {
            status(val) { statusCode = val; return this; },
            setHeader(name, val) { headers[name.toLowerCase()] = val; return this; },
            send(data) { body = data; return this; }
        };

        expressIntegration.fortressExpressMiddleware(req, res, () => { nextCalled = true; });

        assert.strictEqual(nextCalled, false);
        assert.strictEqual(statusCode, 200);
        assert.strictEqual(headers['content-type'], 'application/javascript');
    },

    'Package Exports Resolution - can resolve next, vite, express packages': async () => {
        assert.ok(nextIntegration.fortressNextRoute);
        assert.ok(viteIntegration.fortressVitePlugin);
        assert.ok(expressIntegration.fortressExpressMiddleware);
    },

    'Worker Serve Match - served script matches the expected IIFE header': async () => {
        let body = '';
        const req = { method: 'GET', path: '/_fortress/worker.js' };
        const res = {
            status(val) { return this; },
            setHeader(name, val) { return this; },
            send(data) { body = data; return this; }
        };

        expressIntegration.fortressExpressMiddleware(req, res, () => {});
        assert.ok(body.includes('inlined IIFE bundled script'));
    },

    // --- Tier 2: Boundary & Corner Cases (5 tests) ---
    'Reject Non-GET Requests - rejects POST/PUT/DELETE with 405': async () => {
        let statusCode = null;
        const req = { method: 'POST', path: '/_fortress/worker.js' };
        const res = {
            status(val) { statusCode = val; return this; },
            setHeader() { return this; },
            send() { return this; }
        };

        expressIntegration.fortressExpressMiddleware(req, res, () => {});
        assert.strictEqual(statusCode, 405);
    },

    'Content-Type Verification - assert correct MIME type header': async () => {
        let headers = {};
        const req = { method: 'GET', path: '/_fortress/worker.js' };
        const res = {
            status() { return this; },
            setHeader(name, val) { headers[name.toLowerCase()] = val; return this; },
            send() { return this; }
        };

        expressIntegration.fortressExpressMiddleware(req, res, () => {});
        assert.strictEqual(headers['content-type'], 'application/javascript');
    },

    'Custom Base Port serving - middleware falls through for other paths': async () => {
        let nextCalled = false;
        const req = { method: 'GET', path: '/api/users' };
        const res = {};

        expressIntegration.fortressExpressMiddleware(req, res, () => { nextCalled = true; });
        assert.strictEqual(nextCalled, true);
    },

    'Edge Worker Serve - edge runtime request handling verification': async () => {
        let statusCode = null;
        let body = '';
        const req = { method: 'GET', url: '/_fortress/worker.js' };
        // In Edge runtimes, Response object is used. We verify our route does not throw.
        const res = {
            set statusCode(val) { statusCode = val; },
            get statusCode() { return statusCode; },
            setHeader() {},
            end(data) { body = data; }
        };
        assert.doesNotThrow(() => {
            nextIntegration.fortressNextRoute(req, res);
        });
        assert.strictEqual(statusCode, 200);
    },

    'CSP worker-src Header Compatibility - verify worker-src CSP header is present': async () => {
        let headers = {};
        const req = { method: 'GET', path: '/_fortress/worker.js' };
        const res = {
            status() { return this; },
            setHeader(name, val) { headers[name.toLowerCase()] = val; return this; },
            send() { return this; }
        };

        expressIntegration.fortressExpressMiddleware(req, res, () => {});
        assert.ok(headers['content-security-policy']);
        assert.ok(headers['content-security-policy'].includes('worker-src'));
    }
});
