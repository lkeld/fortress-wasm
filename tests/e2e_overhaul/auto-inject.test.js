const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const { runTestSuite, spawnProcess, assertExitCode } = require('./runner');

const createStubPath = path.join(__dirname, '../../packages/create-fortress-app/bin/index.js');
const cliPath = path.join(__dirname, '../../bin/index.js');
const TEMP_BASE_DIR = path.join(os.tmpdir(), `fortress_auto_inject_tests_${crypto.randomBytes(4).toString('hex')}`);

function getTempDir() {
    const dir = path.join(TEMP_BASE_DIR, crypto.randomBytes(8).toString('hex'));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function cleanupDirs() {
    try {
        fs.rmSync(TEMP_BASE_DIR, { recursive: true, force: true });
    } catch (e) {}
}

// Ensure base dir exists
fs.mkdirSync(TEMP_BASE_DIR, { recursive: true });

const tests = {};

// 1. Test auto-detection and injection for all 18 frameworks
const frameworks = [
    {
        name: 'next-app',
        type: 'full-stack',
        files: {
            'app/layout.tsx': 'export default function RootLayout({ children }) { return <html><body>{children}</body></html>; }',
            'next.config.js': 'module.exports = {};'
        },
        expectedHookFile: 'hooks/useFortress.tsx',
        expectedHookInjectedIn: 'app/layout.tsx',
        expectedCspInjectedIn: 'next.config.js',
        expectedCspContent: "worker-src 'self' blob:;"
    },
    {
        name: 'next-pages',
        type: 'full-stack',
        files: {
            'pages/_app.tsx': 'export default function App({ Component, pageProps }) { return <Component {...pageProps} />; }',
            'next.config.js': 'module.exports = {};'
        },
        expectedHookFile: 'hooks/useFortress.tsx',
        expectedHookInjectedIn: 'pages/_app.tsx',
        expectedCspInjectedIn: 'next.config.js',
        expectedCspContent: "worker-src 'self' blob:;"
    },
    {
        name: 'nuxt',
        type: 'full-stack',
        files: {
            'app.vue': '<template><div>Nuxt App</div></template>',
            'nuxt.config.ts': 'export default defineNuxtConfig({});'
        },
        expectedHookFile: 'composables/useFortressInit.ts',
        expectedHookInjectedIn: 'app.vue',
        expectedCspInjectedIn: 'nuxt.config.ts',
        expectedCspContent: "worker-src 'self' blob:;"
    },
    {
        name: 'sveltekit',
        type: 'full-stack',
        files: {
            'src/routes/+layout.svelte': '<h1>Sveltekit</h1>',
            'svelte.config.js': 'export default {};'
        },
        expectedHookFile: 'src/lib/fortressStore.ts',
        expectedHookInjectedIn: 'src/routes/+layout.svelte',
        expectedCspInjectedIn: 'svelte.config.js',
        expectedCspContent: "worker-src"
    },
    {
        name: 'remix',
        type: 'full-stack',
        files: {
            'app/root.tsx': 'export default function App() { return <html><body></body></html>; }',
            'app/entry.server.tsx': 'export default function handleRequest(request, responseHeaders) {}'
        },
        expectedHookFile: 'app/hooks/useFortress.ts',
        expectedHookInjectedIn: 'app/root.tsx',
        expectedCspInjectedIn: 'app/entry.server.tsx',
        expectedCspContent: "worker-src 'self' blob:;"
    },
    {
        name: 'astro',
        type: 'full-stack',
        files: {
            'src/layouts/Layout.astro': '--- --- <html><body><slot /></body></html>',
            'astro.config.mjs': 'import { defineConfig } from "astro/config"; export default defineConfig({});'
        },
        expectedHookFile: 'src/components/FortressInit.astro',
        expectedHookInjectedIn: 'src/layouts/Layout.astro',
        expectedCspInjectedIn: 'src/middleware.ts',
        expectedCspContent: "worker-src 'self' blob:;"
    },
    {
        name: 'solid',
        type: 'full-stack',
        files: {
            'src/root.tsx': 'export default function Root() { return <html><body></body></html>; }',
            'vite.config.ts': 'import { defineConfig } from "vite"; export default defineConfig({});'
        },
        expectedHookFile: 'src/hooks/useFortress.tsx',
        expectedHookInjectedIn: 'src/root.tsx',
        expectedCspInjectedIn: 'vite.config.ts',
        expectedCspContent: "worker-src 'self' blob:;"
    },
    {
        name: 'qwik',
        type: 'full-stack',
        files: {
            'src/routes/layout.tsx': 'import { component$ } from "@builder.io/qwik"; export default component$(() => { return <slot />; });',
            'vite.config.ts': 'import { defineConfig } from "vite"; export default defineConfig({});'
        },
        expectedHookFile: 'src/components/fortress/fortress.tsx',
        expectedHookInjectedIn: 'src/routes/layout.tsx',
        expectedCspInjectedIn: 'vite.config.ts',
        expectedCspContent: "worker-src 'self' blob:;"
    },
    {
        name: 'angular',
        type: 'full-stack',
        files: {
            'src/app/app.component.ts': 'import { Component } from "@angular/core"; @Component({ selector: "app-root", template: "" }) export class AppComponent {}',
            'src/app/app.module.ts': 'import { NgModule } from "@angular/core"; import { AppComponent } from "./app.component"; @NgModule({ declarations: [AppComponent] }) export class AppModule {}'
        },
        expectedHookFile: 'src/app/api/fortress.service.ts',
        expectedHookInjectedIn: 'src/app/app.component.ts',
        expectedCspInjectedIn: 'src/app/app.component.ts',
        expectedCspContent: 'fortress-wasm-start'
    },
    {
        name: 'vite',
        type: 'full-stack',
        files: {
            'src/App.tsx': 'export default function App() { return <div>Vite</div>; }',
            'vite.config.ts': 'import { defineConfig } from "vite"; export default defineConfig({});'
        },
        expectedHookFile: 'src/fortress.ts',
        expectedHookInjectedIn: 'src/App.tsx',
        expectedCspInjectedIn: 'vite.config.ts',
        expectedCspContent: "worker-src 'self' blob:;"
    },
    {
        name: 'html',
        type: 'full-stack',
        files: {
            'index.html': '<html><head></head><body></body></html>'
        },
        expectedHookFile: 'fortress.js',
        expectedHookInjectedIn: 'index.html',
        expectedCspInjectedIn: 'index.html',
        expectedCspContent: 'Content-Security-Policy'
    },
    // Backend frameworks
    {
        name: 'express',
        type: 'server',
        expectedRouteFile: 'routes/fortress.js',
        expectedComment: 'fortress-wasm-start'
    },
    {
        name: 'fastify',
        type: 'server',
        expectedRouteFile: 'plugins/fortress.js',
        expectedComment: 'fortress-wasm-start'
    },
    {
        name: 'hono',
        type: 'server',
        expectedRouteFile: 'src/api/fortress.ts',
        expectedComment: 'fortress-wasm-start'
    },
    {
        name: 'koa',
        type: 'server',
        expectedRouteFile: 'routes/fortress.js',
        expectedComment: 'fortress-wasm-start'
    },
    {
        name: 'nestjs',
        type: 'server',
        expectedRouteFile: 'src/fortress/fortress.controller.ts',
        expectedComment: 'fortress-wasm-start'
    },
    {
        name: 'bun',
        type: 'server',
        expectedRouteFile: 'server.ts',
        expectedComment: 'fortress-wasm-start'
    },
    {
        name: 'deno',
        type: 'server',
        expectedRouteFile: 'server.ts',
        expectedComment: 'fortress-wasm-start'
    }
];

// Generate test cases for full-stack/frontend frameworks
frameworks.forEach(fw => {
    tests[`Auto-detect and inject framework - ${fw.name}`] = async () => {
        const dir = getTempDir();
        
        // Write mock files
        if (fw.files) {
            for (const [file, content] of Object.entries(fw.files)) {
                const filePath = path.join(dir, file);
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
                fs.writeFileSync(filePath, content);
            }
        }
        
        // Seed dummy package.json to trigger auto-detection where needed
        let pkgName = fw.name;
        if (fw.name === 'next-app' || fw.name === 'next-pages') pkgName = 'next';
        if (fw.name === 'solid') pkgName = 'solid-js';
        const pkg = { dependencies: { [pkgName]: '1.0.0' } };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));

        // Run scaffold command
        const result = await spawnProcess('node', [createStubPath, dir, '--password', 'securepassword123']);
        assertExitCode(result, 0);

        if (fw.type === 'full-stack') {
            // 1. Verify Client hook file generated
            const hookFile = path.join(dir, fw.expectedHookFile);
            assert.ok(fs.existsSync(hookFile), `Client hook file should exist: ${fw.expectedHookFile}`);

            // 2. Verify Client hook injection into entrypoint
            const entryFile = path.join(dir, fw.expectedHookInjectedIn);
            assert.ok(fs.existsSync(entryFile), `Target entrypoint file should exist: ${fw.expectedHookInjectedIn}`);
            const entryContent = fs.readFileSync(entryFile, 'utf8');
            assert.ok(entryContent.includes('fortress-wasm-start'), `Entrypoint should contain fortress-wasm-start comment sentinel in ${fw.expectedHookInjectedIn}`);
            assert.ok(entryContent.includes('useFortress'), `Entrypoint should inject hook in ${fw.expectedHookInjectedIn}`);

            // 3. Verify CSP Header injection
            const cspFile = path.join(dir, fw.expectedCspInjectedIn);
            assert.ok(fs.existsSync(cspFile), `CSP config file should exist: ${fw.expectedCspInjectedIn}`);
            const cspContent = fs.readFileSync(cspFile, 'utf8');
            assert.ok(cspContent.includes(fw.expectedCspContent), `CSP config should contain "${fw.expectedCspContent}" in ${fw.expectedCspInjectedIn}`);
            assert.ok(cspContent.includes('fortress-wasm-start'), `CSP config should contain sentinel comments in ${fw.expectedCspInjectedIn}`);
        } else {
            // Backend server-only framework:
            // 1. Verify no client hook is injected
            const hookDirs = ['hooks', 'composables', 'src/lib', 'src/app/api', 'src/hooks'];
            for (const hDir of hookDirs) {
                const hookPath = path.join(dir, hDir);
                if (fs.existsSync(hookPath)) {
                    const files = fs.readdirSync(hookPath);
                    assert.ok(!files.some(f => f.includes('fortress')), `Should not generate client hook for backend framework ${fw.name}`);
                }
            }

            // 2. Verify comment with sentinel added to route/server file
            const routeFile = path.join(dir, fw.expectedRouteFile);
            assert.ok(fs.existsSync(routeFile), `Route/server file should exist: ${fw.expectedRouteFile}`);
            const routeContent = fs.readFileSync(routeFile, 'utf8');
            assert.ok(routeContent.includes('fortress-wasm-start'), `Route file should contain sentinel comment: ${fw.expectedRouteFile}`);
            assert.ok(routeContent.includes('server-side') || routeContent.includes('client hook'), `Route file should explain server-only usage: ${fw.expectedRouteFile}`);
        }
    };
});

// 2. Test `fortress watch` alias
tests['fortress watch - starts the watcher (alias of dev)'] = async () => {
    const dir = getTempDir();
    const configContent = `
module.exports = {
  framework: "next",
  typescript: false,
  packageManager: "npm",
  protectedDir: "./protected",
  keysPath: "./.fortress_keys"
};
`;
    fs.writeFileSync(path.join(dir, 'fortress.config.js'), configContent);
    fs.mkdirSync(path.join(dir, '.fortress_keys'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.fortress_keys/private.key'), 'dummy_private');
    fs.writeFileSync(path.join(dir, '.fortress_keys/public.key'), 'dummy_public');

    // Run cli with watch command (using spawnProcess to start the server)
    const proc = spawnProcess('node', [cliPath, 'watch'], { cwd: dir });
    
    // We expect it to write to console or start dev server
    // Since watch is an alias of dev, let's wait 1-2 seconds and check output, then kill it
    await new Promise(resolve => setTimeout(resolve, 1500));
    if (proc.child) {
        proc.child.kill('SIGINT');
    }
    const result = await proc;
    assertExitCode(result, 0);
    assert.ok(result.stdout.includes('Fortress dev server listening') || result.stdout.includes('Watching:'), `watch alias output mismatch. Got:\n${result.stdout}`);
};

runTestSuite('F1 & F5: Auto-Injection and Watch Alias E2E Overhaul Test Suite', tests)
    .then(() => cleanupDirs())
    .catch(() => cleanupDirs());
