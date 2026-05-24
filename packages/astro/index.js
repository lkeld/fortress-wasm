async function GET(context) {
    return new Response('// fortress-wasm inlined IIFE bundled script', {
        status: 200,
        headers: {
            'Content-Type': 'application/javascript',
            'Content-Security-Policy': "worker-src 'self' blob:;"
        }
    });
}

async function ALL(context) {
    const request = context ? context.request : null;
    if (request && request.method !== 'GET') {
        return new Response('Method Not Allowed', {
            status: 405,
            headers: { 'Content-Type': 'text/plain' }
        });
    }
    return GET(context);
}

module.exports = {
    GET,
    ALL
};
