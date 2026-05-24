function createFortressController() {
    class FortressController {
        getWorker(req, res) {
            const method = req.method;
            if (method !== 'GET') {
                if (res.status) {
                    res.status(405).send('Method Not Allowed');
                } else {
                    res.statusCode = 405;
                    res.end('Method Not Allowed');
                }
                return;
            }
            if (res.status) {
                res.status(200)
                   .set('Content-Type', 'application/javascript')
                   .set('Content-Security-Policy', "worker-src 'self' blob:;")
                   .send('// fortress-wasm inlined IIFE bundled script');
            } else {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/javascript');
                res.setHeader('Content-Security-Policy', "worker-src 'self' blob:;");
                res.end('// fortress-wasm inlined IIFE bundled script');
            }
        }
    }
    return FortressController;
}

module.exports = {
    createFortressController
};
