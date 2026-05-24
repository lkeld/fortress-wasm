async function GET(event) {
    const request = event ? (event.request || event) : null;
    const method = request ? request.method : 'GET';
    if (method !== 'GET') {
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

async function fallback() {
    return new Response('Method Not Allowed', {
        status: 405,
        headers: { 'Content-Type': 'text/plain' }
    });
}

module.exports = {
    GET,
    fallback
};
