# Framework Integrations & Content Security Policy (CSP)

Fortress WASM is fully integrated with all major JS/TS web frameworks and runtimes.

## Supported Integrations

Fortress provides pre-scaffolded routes, hooks, and middleware for:
- **Meta-Frameworks**: Next.js, Nuxt 3, SvelteKit, Remix, Astro, SolidStart, Qwik City.
- **Frontend Build Tools**: Vite, Angular CLI, HTML/JS.
- **Backend Runtimes & Frameworks**: Express, Fastify, Hono, Koa, NestJS, Bun, Deno.

Refer to `packages/create-fortress-app/bin/index.js` or scaffold a project with `npm create fortress-app` to see specific handler structures.

## Content Security Policy (CSP) Configuration

Because the Fortress Client SDK supports **Strategy 2** (pre-bundled Web Worker loaded from an IIFE Blob URL), you must configure your application's Content Security Policy headers to allow executing workers from blob origins.

### Required Directive

Add the following rule to your `Content-Security-Policy` header:

```http
worker-src 'self' blob:;
```

If you also need compatibility with inline worker scripts (e.g. during dev mode / fallback paths):

```http
worker-src 'self' blob: data:;
```

### Framework Examples

#### 1. Next.js (`next.config.js`)

```javascript
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: "worker-src 'self' blob:;"
  }
];

module.exports = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};
```

#### 2. Express Middleware

```javascript
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; worker-src 'self' blob:;"
  );
  next();
});
```

#### 3. Vite Dev Server CSP configuration (`vite.config.ts`)

```typescript
export default defineConfig({
  server: {
    headers: {
      'Content-Security-Policy': "worker-src 'self' blob:;"
    }
  }
});
```
