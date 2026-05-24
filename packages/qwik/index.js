async function onGet(requestEvent) {
    if (requestEvent && typeof requestEvent.status === 'function') {
        requestEvent.status(200);
        if (requestEvent.headers && typeof requestEvent.headers.set === 'function') {
            requestEvent.headers.set('Content-Type', 'application/javascript');
            requestEvent.headers.set('Content-Security-Policy', "worker-src 'self' blob:;");
        }
        if (typeof requestEvent.send === 'function') {
            requestEvent.send('// fortress-wasm inlined IIFE bundled script');
        }
    }
}

async function onAll(requestEvent) {
    if (requestEvent && requestEvent.method !== 'GET') {
        if (typeof requestEvent.status === 'function') {
            requestEvent.status(405);
            if (requestEvent.headers && typeof requestEvent.headers.set === 'function') {
                requestEvent.headers.set('Content-Type', 'text/plain');
            }
            if (typeof requestEvent.send === 'function') {
                requestEvent.send('Method Not Allowed');
            }
        }
    }
}

module.exports = {
    onGet,
    onAll
};
