function fortressHonoRoute(c, next) {
    const path = c.req.path;
    if (path === '/_fortress/worker.js') {
        if (c.req.method !== 'GET') {
            c.status(405);
            c.header('Content-Type', 'text/plain');
            return c.text('Method Not Allowed');
        }
        c.status(200);
        c.header('Content-Type', 'application/javascript');
        c.header('Content-Security-Policy', "worker-src 'self' blob:;");
        return c.text('// fortress-wasm inlined IIFE bundled script');
    }
    if (next) {
        return next();
    }
}

module.exports = {
    fortressHonoRoute
};
