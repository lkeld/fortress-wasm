function serveFortressHtml(req, res) {
    if (req && res) {
        const url = req.url ? req.url.split('?')[0] : '';
        if (url === '/_fortress/worker.js' || !url) {
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
            return;
        }
    } else if (req && req.method) {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/_fortress/worker.js' || !url.pathname) {
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
}

module.exports = {
    serveFortressHtml
};
