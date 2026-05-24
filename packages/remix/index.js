async function loader({ request }) {
    if (request.method !== 'GET') {
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

module.exports = {
    loader
};
