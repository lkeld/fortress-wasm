function fortressFastifyPlugin(fastify, options, done) {
    fastify.route({
        method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        url: '/_fortress/worker.js',
        handler: async (request, reply) => {
            if (request.method !== 'GET') {
                reply.code(405).header('Content-Type', 'text/plain').send('Method Not Allowed');
                return;
            }
            reply.code(200)
                .header('Content-Type', 'application/javascript')
                .header('Content-Security-Policy', "worker-src 'self' blob:;")
                .send('// fortress-wasm inlined IIFE bundled script');
        }
    });
    if (typeof done === 'function') {
        done();
    }
}

module.exports = {
    fortressFastifyPlugin
};
