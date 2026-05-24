async function fortressKoaMiddleware(ctx, next) {
    if (ctx.path === '/_fortress/worker.js') {
        if (ctx.method !== 'GET') {
            ctx.status = 405;
            ctx.set('Content-Type', 'text/plain');
            ctx.body = 'Method Not Allowed';
            return;
        }
        ctx.status = 200;
        ctx.set('Content-Type', 'application/javascript');
        ctx.set('Content-Security-Policy', "worker-src 'self' blob:;");
        ctx.body = '// fortress-wasm inlined IIFE bundled script';
    } else {
        if (typeof next === 'function') {
            await next();
        }
    }
}

module.exports = {
    fortressKoaMiddleware
};
