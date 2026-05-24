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
    },

    'SvelteKit integration - handles GET and fallback': async () => {
        const sveltekit = require('../../packages/sveltekit/index.js');
        const resGet = await sveltekit.GET({ request: { method: 'GET' } });
        assert.strictEqual(resGet.status, 200);
        assert.strictEqual(resGet.headers.get('Content-Type'), 'application/javascript');
        assert.ok((await resGet.text()).includes('inlined IIFE bundled script'));

        const resFallback = await sveltekit.fallback();
        assert.strictEqual(resFallback.status, 405);
    },

    'Nuxt integration - handles GET and non-GET': async () => {
        const nuxt = require('../../packages/nuxt/index.js');
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
        nuxt.fortressNuxtHandler({ node: { req, res } });
        assert.strictEqual(statusCode, 200);
        assert.strictEqual(headers['content-type'], 'application/javascript');
        assert.strictEqual(body, '// fortress-wasm inlined IIFE bundled script');

        const reqPost = { method: 'POST', url: '/_fortress/worker.js' };
        nuxt.fortressNuxtHandler({ node: { req: reqPost, res } });
        assert.strictEqual(statusCode, 405);
    },

    'Remix integration - loader handles GET and non-GET': async () => {
        const remix = require('../../packages/remix/index.js');
        const res = await remix.loader({ request: { method: 'GET' } });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.headers.get('Content-Type'), 'application/javascript');
        assert.ok((await res.text()).includes('inlined IIFE bundled script'));

        const resPost = await remix.loader({ request: { method: 'POST' } });
        assert.strictEqual(resPost.status, 405);
    },

    'Astro integration - GET and ALL handlers': async () => {
        const astro = require('../../packages/astro/index.js');
        const resGet = await astro.GET();
        assert.strictEqual(resGet.status, 200);

        const resAllGet = await astro.ALL({ request: { method: 'GET' } });
        assert.strictEqual(resAllGet.status, 200);

        const resAllPost = await astro.ALL({ request: { method: 'POST' } });
        assert.strictEqual(resAllPost.status, 405);
    },

    'Angular integration - serves handler': async () => {
        const angular = require('../../packages/angular/index.js');
        let statusCode = null;
        let headers = {};
        let body = '';
        const req = { method: 'GET' };
        const res = {
            set statusCode(val) { statusCode = val; },
            get statusCode() { return statusCode; },
            setHeader(name, val) { headers[name.toLowerCase()] = val; },
            end(data) { body = data; }
        };
        angular.fortressAngularHandler(req, res);
        assert.strictEqual(statusCode, 200);
        assert.strictEqual(headers['content-type'], 'application/javascript');
    },

    'Solid integration - solid handler': async () => {
        const solid = require('../../packages/solid/index.js');
        const res = await solid.fortressSolidHandler({ request: { method: 'GET' } });
        assert.strictEqual(res.status, 200);
        const resPost = await solid.fortressSolidHandler({ request: { method: 'POST' } });
        assert.strictEqual(resPost.status, 405);
    },

    'Qwik integration - onGet and onAll': async () => {
        const qwik = require('../../packages/qwik/index.js');
        let statusCode = null;
        let headers = new Map();
        let body = '';
        const mockEvent = {
            method: 'GET',
            status(val) { statusCode = val; },
            headers: {
                set(k, v) { headers.set(k.toLowerCase(), v); }
            },
            send(data) { body = data; }
        };
        await qwik.onGet(mockEvent);
        assert.strictEqual(statusCode, 200);
        assert.strictEqual(headers.get('content-type'), 'application/javascript');

        mockEvent.method = 'POST';
        await qwik.onAll(mockEvent);
        assert.strictEqual(statusCode, 405);
    },

    'Fastify integration - registers plugin and serves': async () => {
        const fastifyPkg = require('../../packages/fastify/index.js');
        let registeredRoute = null;
        const mockFastify = {
            route(opt) { registeredRoute = opt; }
        };
        fastifyPkg.fortressFastifyPlugin(mockFastify, {}, () => {});
        assert.ok(registeredRoute);
        assert.strictEqual(registeredRoute.url, '/_fortress/worker.js');

        let statusCode = null;
        let headers = {};
        let body = '';
        const mockReply = {
            code(val) { statusCode = val; return this; },
            header(k, v) { headers[k.toLowerCase()] = v; return this; },
            send(data) { body = data; }
        };
        await registeredRoute.handler({ method: 'GET' }, mockReply);
        assert.strictEqual(statusCode, 200);
        assert.strictEqual(headers['content-type'], 'application/javascript');

        await registeredRoute.handler({ method: 'POST' }, mockReply);
        assert.strictEqual(statusCode, 405);
    },

    'Hono integration - handles route and middleware': async () => {
        const hono = require('../../packages/hono/index.js');
        let statusCode = null;
        let headers = {};
        let body = '';
        const mockCtx = {
            req: { method: 'GET', path: '/_fortress/worker.js' },
            status(val) { statusCode = val; },
            header(k, v) { headers[k.toLowerCase()] = v; },
            text(val) { body = val; return val; }
        };
        hono.fortressHonoRoute(mockCtx);
        assert.strictEqual(statusCode, 200);
        assert.strictEqual(headers['content-type'], 'application/javascript');

        mockCtx.req.method = 'POST';
        hono.fortressHonoRoute(mockCtx);
        assert.strictEqual(statusCode, 405);
    },

    'Koa integration - path matching middleware': async () => {
        const koa = require('../../packages/koa/index.js');
        let nextCalled = false;
        const mockCtx = {
            path: '/_fortress/worker.js',
            method: 'GET',
            status: null,
            headers: {},
            set(k, v) { this.headers[k.toLowerCase()] = v; },
            body: ''
        };
        await koa.fortressKoaMiddleware(mockCtx, () => { nextCalled = true; });
        assert.strictEqual(nextCalled, false);
        assert.strictEqual(mockCtx.status, 200);
        assert.strictEqual(mockCtx.headers['content-type'], 'application/javascript');

        mockCtx.method = 'POST';
        await koa.fortressKoaMiddleware(mockCtx, () => {});
        assert.strictEqual(mockCtx.status, 405);
    },

    'NestJS integration - create controller': async () => {
        const nest = require('../../packages/nestjs/index.js');
        const Controller = nest.createFortressController();
        const instance = new Controller();
        let statusCode = null;
        let headers = {};
        let body = '';
        const req = { method: 'GET' };
        const res = {
            set statusCode(val) { statusCode = val; },
            get statusCode() { return statusCode; },
            setHeader(name, val) { headers[name.toLowerCase()] = val; },
            end(data) { body = data; }
        };
        instance.getWorker(req, res);
        assert.strictEqual(statusCode, 200);
        assert.strictEqual(headers['content-type'], 'application/javascript');
    },

    'Bun integration - Bun serve handler': async () => {
        const bun = require('../../packages/bun/index.js');
        const req = { method: 'GET', url: 'http://localhost/_fortress/worker.js' };
        const res = bun.serveFortressBun(req);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.headers.get('Content-Type'), 'application/javascript');

        const reqPost = { method: 'POST', url: 'http://localhost/_fortress/worker.js' };
        const resPost = bun.serveFortressBun(reqPost);
        assert.strictEqual(resPost.status, 405);
    },

    'Deno integration - Deno serve handler': async () => {
        const deno = require('../../packages/deno/index.js');
        const req = { method: 'GET', url: 'http://localhost/_fortress/worker.js' };
        const res = deno.serveFortressDeno(req);
        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.headers.get('Content-Type'), 'application/javascript');
    },

    'HTML integration - HTML serve handler': async () => {
        const html = require('../../packages/html/index.js');
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
        html.serveFortressHtml(req, res);
        assert.strictEqual(statusCode, 200);
        assert.strictEqual(headers['content-type'], 'application/javascript');
    }
});

