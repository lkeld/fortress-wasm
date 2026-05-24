function fortressNuxtHandler(event) {
    const req = event.node ? event.node.req : event.req;
    const res = event.node ? event.node.res : event.res;
    const method = req ? req.method : (event.method || 'GET');
    
    if (method !== 'GET') {
        if (res) {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'text/plain');
            res.end('Method Not Allowed');
        } else {
            return new Response('Method Not Allowed', {
                status: 405,
                headers: { 'Content-Type': 'text/plain' }
            });
        }
        return;
    }
    
    if (res) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/javascript');
        res.setHeader('Content-Security-Policy', "worker-src 'self' blob:;");
        res.end('// fortress-wasm inlined IIFE bundled script');
    } else {
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
    fortressNuxtHandler
};
