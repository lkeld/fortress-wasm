function fortressAngularHandler(req, res) {
    if (req && res) {
        if (req.method !== 'GET') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'text/plain');
            res.end('Method Not Allowed');
            return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/javascript');
        res.setHeader('Content-Security-Policy', "worker-src 'self' blob:;");
        res.end('// fortress-wasm inlined IIFE bundled script');
    } else if (req && req.method) {
        if (req.method !== 'GET') {
            return new Response('Method Not Allowed', {
                status: 405,
                headers: { 'Content-Type': 'text/plain' }
            });
        }
        return new Response('// fortress-wasm inlined IIFE bundled script', {
            status: 200,
            headers: {
                'Content-Type': 'application/javascript',
                'Content-Security-Policy': "worker-src 'self' blob:;"
            }
        });
    }
}

module.exports = {
    fortressAngularHandler
};
