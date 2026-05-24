#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

console.log("create-fortress-app CLI - version 1.2.0");

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
    console.log("Usage: create-fortress-app <project-directory> [options]");
    console.log("Options:");
    console.log("  --framework <framework>  Override framework auto-detection");
    console.log("  --ts                     Configure for TypeScript");
    console.log("  --pm <package-manager>   Specify package manager (npm, yarn, pnpm)");
    console.log("  --password <password>    Specify signing password (non-interactive mode)");
    process.exit(0);
}

// Filter out options that are values of flags
const flagsWithValues = ['--framework', '--pm', '--password'];
const nonFlagArgs = [];
for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('-')) {
        if (flagsWithValues.includes(args[i])) {
            i++; // skip value
        }
    } else {
        nonFlagArgs.push(args[i]);
    }
}

// Extract target directory
const targetArg = nonFlagArgs[0];
const targetDir = targetArg ? path.resolve(process.cwd(), targetArg) : process.cwd();

// Find option values
function getOptionValue(flag) {
    const idx = args.indexOf(flag);
    if (idx !== -1 && idx + 1 < args.length) {
        return args[idx + 1];
    }
    return null;
}

const overrideFramework = getOptionValue('--framework');
const isTypeScriptFlag = args.includes('--ts');
const packageManagerFlag = getOptionValue('--pm');
const overridePassword = getOptionValue('--password');

const VALID_FRAMEWORKS = [
  'next',
  'next-app',
  'next-pages',
  'nuxt',
  'nuxt 3',
  'sveltekit',
  'remix',
  'astro',
  'angular',
  'solid',
  'solidjs',
  'qwik',
  'vite',
  'express',
  'fastify',
  'hono',
  'koa',
  'nestjs',
  'bun',
  'deno',
  'html'
];

// Validation of framework option
if (overrideFramework && !VALID_FRAMEWORKS.includes(overrideFramework.toLowerCase())) {
    console.error(`Error: Unsupported framework option "${overrideFramework}".`);
    process.exit(1);
}

// Check if target directory exists
if (!fs.existsSync(targetDir)) {
    try {
        fs.mkdirSync(targetDir, { recursive: true });
    } catch (e) {
        console.error(`Error: Cannot create directory ${targetDir} (read-only or permission denied).`);
        process.exit(1);
    }
}

// Check write permissions
try {
    const testFile = path.join(targetDir, `.test_write_${crypto.randomBytes(4).toString('hex')}`);
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
} catch (e) {
    console.error(`Error: Destination folder is not writable.`);
    process.exit(1);
}

const configPath = path.join(targetDir, 'fortress.config.js');
const protectedDir = path.join(targetDir, 'protected');

if (fs.existsSync(configPath) || fs.existsSync(protectedDir)) {
    console.log("Warning: fortress.config.js or protected/ directory already exists. Scaffolding aborted to prevent overwrite.");
    process.exit(2);
}

// Environment Detection Helper
function detectEnvironment(dir) {
    let detectedFramework = 'vite';
    let isTypeScript = false;
    let packageManager = 'npm';
    
    if (fs.existsSync(path.join(dir, 'tsconfig.json'))) {
        isTypeScript = true;
    }
    
    if (fs.existsSync(path.join(dir, 'yarn.lock'))) {
        packageManager = 'yarn';
    } else if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) {
        packageManager = 'pnpm';
    } else if (fs.existsSync(path.join(dir, 'bun.lockb')) || fs.existsSync(path.join(dir, 'bun.lock'))) {
        packageManager = 'bun';
    } else if (fs.existsSync(path.join(dir, 'deno.lock'))) {
        packageManager = 'deno';
    }
    
    const pkgPath = path.join(dir, 'package.json');
    let hasPackageJson = false;
    if (fs.existsSync(pkgPath)) {
        hasPackageJson = true;
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            
            if (deps['@angular/core']) {
                detectedFramework = 'angular';
            } else if (deps['next']) {
                const hasApp = fs.existsSync(path.join(dir, 'app')) || 
                               fs.existsSync(path.join(dir, 'src/app'));
                detectedFramework = hasApp ? 'next-app' : 'next-pages';
            } else if (deps['nuxt']) {
                detectedFramework = 'nuxt';
            } else if (deps['@sveltejs/kit']) {
                detectedFramework = 'sveltekit';
            } else if (deps['@remix-run/react'] || deps['@remix-run/node'] || deps['@remix-run/serve']) {
                detectedFramework = 'remix';
            } else if (deps['astro']) {
                detectedFramework = 'astro';
            } else if (deps['solid-js']) {
                detectedFramework = 'solid';
            } else if (deps['@builder.io/qwik']) {
                detectedFramework = 'qwik';
            } else if (deps['@nestjs/core']) {
                detectedFramework = 'nestjs';
            } else if (deps['express']) {
                detectedFramework = 'express';
            } else if (deps['fastify']) {
                detectedFramework = 'fastify';
            } else if (deps['hono']) {
                detectedFramework = 'hono';
            } else if (deps['koa']) {
                detectedFramework = 'koa';
            } else if (deps['vite']) {
                detectedFramework = 'vite';
            }
        } catch (e) {
            // ignore
        }
    }
    
    if (detectedFramework === 'vite') {
        if (fs.existsSync(path.join(dir, 'deno.json')) || fs.existsSync(path.join(dir, 'deno.jsonc'))) {
            detectedFramework = 'deno';
            packageManager = 'deno';
        } else if (fs.existsSync(path.join(dir, 'bun.lockb')) || fs.existsSync(path.join(dir, 'bun.lock'))) {
            detectedFramework = 'bun';
            packageManager = 'bun';
        } else if (fs.existsSync(path.join(dir, 'index.html')) && !hasPackageJson) {
            detectedFramework = 'html';
        }
    }
    
    return { detectedFramework, isTypeScript, packageManager };
}

const envDet = detectEnvironment(targetDir);
const finalFramework = (overrideFramework || envDet.detectedFramework).toLowerCase();
const finalTypeScript = isTypeScriptFlag || envDet.isTypeScript;
const finalPackageManager = packageManagerFlag || envDet.packageManager;

const isInteractive = !!(process.stdin.isTTY && process.stdout.isTTY) || process.env.FORTRESS_CLI_INTERACTIVE === 'true';

// Scaffold file functions
const scaffoldFiles = {
  next: (tDir, isTS) => {
    const base = fs.existsSync(path.join(tDir, 'src')) ? 'src' : '.';
    const ext = isTS ? 'ts' : 'js';
    const hookExt = isTS ? 'tsx' : 'jsx';
    
    const routeDir = path.join(tDir, base, 'app/api/fortress');
    fs.mkdirSync(routeDir, { recursive: true });
    fs.writeFileSync(path.join(routeDir, `route.${ext}`), 
      isTS ?
      `import { NextResponse } from 'next/server';\nimport { vmNode } from '@lkeld/fortress-wasm';\n\nexport async function POST(request: Request) {\n  try {\n    const { bytecode, handshakeHeader, inputJson, opcodeMap } = await request.json();\n    const result = vmNode.execute(\n      new Uint8Array(bytecode || []),\n      new Uint8Array(handshakeHeader || []),\n      JSON.stringify(inputJson || []),\n      new Uint8Array(opcodeMap || [])\n    );\n    return NextResponse.json(JSON.parse(result));\n  } catch (err: any) {\n    return NextResponse.json({ error: err.message }, { status: 500 });\n  }\n}\n` :
      `import { NextResponse } from 'next/server';\nimport { vmNode } from '@lkeld/fortress-wasm';\n\nexport async function POST(request) {\n  try {\n    const { bytecode, handshakeHeader, inputJson, opcodeMap } = await request.json();\n    const result = vmNode.execute(\n      new Uint8Array(bytecode || []),\n      new Uint8Array(handshakeHeader || []),\n      JSON.stringify(inputJson || []),\n      new Uint8Array(opcodeMap || [])\n    );\n    return NextResponse.json(JSON.parse(result));\n  } catch (err) {\n    return NextResponse.json({ error: err.message }, { status: 500 });\n  }\n}\n`
    );
    
    const pagesDir = path.join(tDir, base, 'pages/api');
    fs.mkdirSync(pagesDir, { recursive: true });
    fs.writeFileSync(path.join(pagesDir, `fortress.${ext}`),
      isTS ?
      `import { vmNode } from '@lkeld/fortress-wasm';\n\nexport default async function handler(req: any, res: any) {\n  if (req.method !== 'POST') {\n    return res.status(405).end();\n  }\n  try {\n    const { bytecode, handshakeHeader, inputJson, opcodeMap } = req.body;\n    const result = vmNode.execute(\n      new Uint8Array(bytecode || []),\n      new Uint8Array(handshakeHeader || []),\n      JSON.stringify(inputJson || []),\n      new Uint8Array(opcodeMap || [])\n    );\n    return res.status(200).json(JSON.parse(result));\n  } catch (err: any) {\n    return res.status(500).json({ error: err.message });\n  }\n}\n` :
      `const { vmNode } = require('@lkeld/fortress-wasm');\n\nmodule.exports = async function handler(req, res) {\n  if (req.method !== 'POST') {\n    return res.status(405).end();\n  }\n  try {\n    const { bytecode, handshakeHeader, inputJson, opcodeMap } = req.body;\n    const result = vmNode.execute(\n      new Uint8Array(bytecode || []),\n      new Uint8Array(handshakeHeader || []),\n      JSON.stringify(inputJson || []),\n      new Uint8Array(opcodeMap || [])\n    );\n    return res.status(200).json(JSON.parse(result));\n  } catch (err) {\n    return res.status(500).json({ error: err.message });\n  }\n};\n`
    );
    
    const hooksDir = path.join(tDir, base, 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, `useFortress.${hookExt}`),
      isTS ?
      `import { useState, useEffect } from 'react';\nimport FortressClient from '@lkeld/fortress-wasm/client';\n\nexport function useFortress() {\n  const [client, setClient] = useState<any>(null);\n  useEffect(() => {\n    FortressClient.init('/api/fortress').then(setClient).catch(console.error);\n  }, []);\n  return { client, secured: !!client };\n}\n` :
      `import { useState, useEffect } from 'react';\nimport FortressClient from '@lkeld/fortress-wasm/client';\n\nexport function useFortress() {\n  const [client, setClient] = useState(null);\n  useEffect(() => {\n    FortressClient.init('/api/fortress').then(setClient).catch(console.error);\n  }, []);\n  return { client, secured: !!client };\n}\n`
    );
  },
  
  nuxt: (tDir, isTS) => {
    const ext = isTS ? 'ts' : 'js';
    
    const serverDir = path.join(tDir, 'server/api');
    fs.mkdirSync(serverDir, { recursive: true });
    fs.writeFileSync(path.join(serverDir, `fortress.post.${ext}`),
      `import { vmNode } from '@lkeld/fortress-wasm';\n\nexport default defineEventHandler(async (event) => {\n  const body = await readBody(event);\n  const { bytecode, handshakeHeader, inputJson, opcodeMap } = body;\n  const result = vmNode.execute(\n    new Uint8Array(bytecode || []),\n    new Uint8Array(handshakeHeader || []),\n    JSON.stringify(inputJson || []),\n    new Uint8Array(opcodeMap || [])\n  );\n  return JSON.parse(result);\n});\n`
    );
    
    const composablesDir = path.join(tDir, 'composables');
    fs.mkdirSync(composablesDir, { recursive: true });
    fs.writeFileSync(path.join(composablesDir, `useFortress.${ext}`),
      `import FortressClient from '@lkeld/fortress-wasm/client';\n\nexport const useFortress = () => {\n  const client = useState('fortress_client', () => null);\n  if (!client.value && typeof window !== 'undefined') {\n    FortressClient.init('/api/fortress').then(c => { client.value = c; }).catch(console.error);\n  }\n  return client;\n};\n`
    );
  },
  
  sveltekit: (tDir, isTS) => {
    const ext = isTS ? 'ts' : 'js';
    
    const routeDir = path.join(tDir, 'src/routes/api/fortress');
    fs.mkdirSync(routeDir, { recursive: true });
    fs.writeFileSync(path.join(routeDir, `+server.${ext}`),
      isTS ?
      `import { json } from '@sveltejs/kit';\nimport { vmNode } from '@lkeld/fortress-wasm';\nimport type { RequestHandler } from './$types';\n\nexport const POST: RequestHandler = async ({ request }) => {\n  try {\n    const { bytecode, handshakeHeader, inputJson, opcodeMap } = await request.json();\n    const result = vmNode.execute(\n      new Uint8Array(bytecode || []),\n      new Uint8Array(handshakeHeader || []),\n      JSON.stringify(inputJson || []),\n      new Uint8Array(opcodeMap || [])\n    );\n    return json(JSON.parse(result));\n  } catch (err: any) {\n    return json({ error: err.message }, { status: 500 });\n  }\n};\n` :
      `import { json } from '@sveltejs/kit';\nimport { vmNode } from '@lkeld/fortress-wasm';\n\nexport async function POST({ request }) {\n  try {\n    const { bytecode, handshakeHeader, inputJson, opcodeMap } = await request.json();\n    const result = vmNode.execute(\n      new Uint8Array(bytecode || []),\n      new Uint8Array(handshakeHeader || []),\n      JSON.stringify(inputJson || []),\n      new Uint8Array(opcodeMap || [])\n    );\n    return json(JSON.parse(result));\n  } catch (err) {\n    return json({ error: err.message }, { status: 500 });\n  }\n}\n`
    );
    
    const libDir = path.join(tDir, 'src/lib');
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(path.join(libDir, `fortressStore.${ext}`),
      `import { writable } from 'svelte/store';\nimport FortressClient from '@lkeld/fortress-wasm/client';\n\nexport const fortressStore = writable<any>(null);\nif (typeof window !== 'undefined') {\n  FortressClient.init('/api/fortress').then(c => fortressStore.set(c)).catch(console.error);\n}\n`
    );
  },
  
  remix: (tDir, isTS) => {
    const ext = isTS ? 'ts' : 'js';
    
    const routesDir = path.join(tDir, 'app/routes');
    fs.mkdirSync(routesDir, { recursive: true });
    fs.writeFileSync(path.join(routesDir, `api.fortress.${ext}`),
      isTS ?
      `import { json } from "@remix-run/node";\nimport type { ActionFunction } from "@remix-run/node";\nimport { vmNode } from '@lkeld/fortress-wasm';\n\nexport const action: ActionFunction = async ({ request }) => {\n  try {\n    const { bytecode, handshakeHeader, inputJson, opcodeMap } = await request.json();\n    const result = vmNode.execute(\n      new Uint8Array(bytecode || []),\n      new Uint8Array(handshakeHeader || []),\n      JSON.stringify(inputJson || []),\n      new Uint8Array(opcodeMap || [])\n    );\n    return json(JSON.parse(result));\n  } catch (err: any) {\n    return json({ error: err.message }, { status: 500 });\n  }\n};\n` :
      `const { json } = require("@remix-run/node");\nconst { vmNode } = require('@lkeld/fortress-wasm');\n\nexport async function action({ request }) {\n  try {\n    const { bytecode, handshakeHeader, inputJson, opcodeMap } = await request.json();\n    const result = vmNode.execute(\n      new Uint8Array(bytecode || []),\n      new Uint8Array(handshakeHeader || []),\n      JSON.stringify(inputJson || []),\n      new Uint8Array(opcodeMap || [])\n    );\n    return json(JSON.parse(result));\n  } catch (err) {\n    return json({ error: err.message }, { status: 500 });\n  }\n}\n`
    );
    
    const hooksDir = path.join(tDir, 'app/hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, `useFortress.${ext}`),
      `import { useState, useEffect } from 'react';\nimport FortressClient from '@lkeld/fortress-wasm/client';\n\nexport function useFortress() {\n  const [client, setClient] = useState(null);\n  useEffect(() => {\n    FortressClient.init('/api/fortress').then(setClient).catch(console.error);\n  }, []);\n  return client;\n}\n`
    );
  },
  
  astro: (tDir, isTS) => {
    const ext = isTS ? 'ts' : 'js';
    
    const routeDir = path.join(tDir, 'src/pages/api');
    fs.mkdirSync(routeDir, { recursive: true });
    fs.writeFileSync(path.join(routeDir, `fortress.${ext}`),
      isTS ?
      `import type { APIRoute } from 'astro';\nimport { vmNode } from '@lkeld/fortress-wasm';\n\nexport const POST: APIRoute = async ({ request }) => {\n  try {\n    const { bytecode, handshakeHeader, inputJson, opcodeMap } = await request.json();\n    const result = vmNode.execute(\n      new Uint8Array(bytecode || []),\n      new Uint8Array(handshakeHeader || []),\n      JSON.stringify(inputJson || []),\n      new Uint8Array(opcodeMap || [])\n    );\n    return new Response(result, {\n      status: 200,\n      headers: { "Content-Type": "application/json" }\n    });\n  } catch (err: any) {\n    return new Response(JSON.stringify({ error: err.message }), { status: 500 });\n  }\n};\n` :
      `import { vmNode } from '@lkeld/fortress-wasm';\n\nexport async function POST({ request }) {\n  try {\n    const { bytecode, handshakeHeader, inputJson, opcodeMap } = await request.json();\n    const result = vmNode.execute(\n      new Uint8Array(bytecode || []),\n      new Uint8Array(handshakeHeader || []),\n      JSON.stringify(inputJson || []),\n      new Uint8Array(opcodeMap || [])\n    );\n    return new Response(result, {\n      status: 200,\n      headers: { "Content-Type": "application/json" }\n    });\n  } catch (err) {\n    return new Response(JSON.stringify({ error: err.message }), { status: 500 });\n  }\n}\n`
    );
    
    const componentsDir = path.join(tDir, 'src/components');
    fs.mkdirSync(componentsDir, { recursive: true });
    fs.writeFileSync(path.join(componentsDir, `Fortress.astro`),
      `---\n// Astro component\n---\n<div data-fortress>Secured by Fortress</div>\n<script>\n  import FortressClient from '@lkeld/fortress-wasm/client';\n  FortressClient.init('/api/fortress').then(() => {\n    console.log('Fortress initialized');\n  }).catch(console.error);\n</script>\n`
    );
  },
  
  angular: (tDir, isTS) => {
    const ext = isTS ? 'ts' : 'js';
    
    const apiDir = path.join(tDir, 'src/app/api');
    fs.mkdirSync(apiDir, { recursive: true });
    fs.writeFileSync(path.join(apiDir, `fortress.service.${ext}`),
      `import { Injectable } from '@angular/core';\nimport FortressClient from '@lkeld/fortress-wasm/client';\n\n@Injectable({ providedIn: 'root' })\nexport class FortressService {\n  client: any = null;\n  constructor() {\n    if (typeof window !== 'undefined') {\n      FortressClient.init('/api/fortress').then(c => this.client = c).catch(console.error);\n    }\n  }\n}\n`
    );
    
    const compDir = path.join(tDir, 'src/app/fortress');
    fs.mkdirSync(compDir, { recursive: true });
    fs.writeFileSync(path.join(compDir, `fortress.component.${ext}`),
      `import { Component } from '@angular/core';\nimport { FortressService } from '../api/fortress.service';\n\n@Component({\n  selector: 'app-fortress',\n  template: '<div>Secured by Fortress: {{ service.client ? "Active" : "Initializing" }}</div>'\n})\nexport class FortressComponent {\n  constructor(public service: FortressService) {}\n}\n`
    );
  },
  
  solid: (tDir, isTS) => {
    const ext = isTS ? 'ts' : 'js';
    const hookExt = isTS ? 'tsx' : 'jsx';
    
    const apiDir = path.join(tDir, 'src/api');
    fs.mkdirSync(apiDir, { recursive: true });
    fs.writeFileSync(path.join(apiDir, `fortress.${ext}`),
      `import { vmNode } from '@lkeld/fortress-wasm';\n\nexport async function postFortress(req: any) {\n  const { bytecode, handshakeHeader, inputJson, opcodeMap } = req;\n  const result = vmNode.execute(\n    new Uint8Array(bytecode || []),\n    new Uint8Array(handshakeHeader || []),\n    JSON.stringify(inputJson || []),\n    new Uint8Array(opcodeMap || [])\n  );\n  return JSON.parse(result);\n}\n`
    );
    
    const hooksDir = path.join(tDir, 'src/hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, `useFortress.${hookExt}`),
      `import { createSignal, createEffect } from 'solid-js';\nimport FortressClient from '@lkeld/fortress-wasm/client';\n\nexport function useFortress() {\n  const [client, setClient] = createSignal<any>(null);\n  createEffect(() => {\n    FortressClient.init('/api/fortress').then(setClient).catch(console.error);\n  });\n  return client;\n}\n`
    );
  },
  
  qwik: (tDir, isTS) => {
    const ext = isTS ? 'ts' : 'js';
    const compExt = isTS ? 'tsx' : 'jsx';
    
    const routeDir = path.join(tDir, 'src/routes/api/fortress');
    fs.mkdirSync(routeDir, { recursive: true });
    fs.writeFileSync(path.join(routeDir, `index.${ext}`),
      `import { vmNode } from '@lkeld/fortress-wasm';\n\nexport const onPost = async (ev: any) => {\n  const { bytecode, handshakeHeader, inputJson, opcodeMap } = await ev.parseBody();\n  const result = vmNode.execute(\n    new Uint8Array(bytecode || []),\n    new Uint8Array(handshakeHeader || []),\n    JSON.stringify(inputJson || []),\n    new Uint8Array(opcodeMap || [])\n  );\n  ev.json(200, JSON.parse(result));\n};\n`
    );
    
    const compDir = path.join(tDir, 'src/components/fortress');
    fs.mkdirSync(compDir, { recursive: true });
    fs.writeFileSync(path.join(compDir, `fortress.${compExt}`),
      `import { component$, useVisibleTask$, useStore } from '@builder.io/qwik';\nimport FortressClient from '@lkeld/fortress-wasm/client';\n\nexport const Fortress = component$(() => {\n  const state = useStore({ secured: false });\n  useVisibleTask$(() => {\n    FortressClient.init('/api/fortress').then(() => {\n      state.secured = true;\n    }).catch(console.error);\n  });\n  return <div>Secured by Fortress: {state.secured ? "Active" : "Initializing"}</div>;\n});\n`
    );
  },
  
  vite: (tDir, isTS) => {
    const ext = isTS ? 'ts' : 'js';
    
    const serverDir = path.join(tDir, 'server/api');
    fs.mkdirSync(serverDir, { recursive: true });
    fs.writeFileSync(path.join(serverDir, `fortress.${ext}`),
      `import { vmNode } from '@lkeld/fortress-wasm';\n\nexport function fortressMiddleware(req: any, res: any) {\n  let body = '';\n  req.on('data', (chunk: any) => { body += chunk; });\n  req.on('end', () => {\n    try {\n      const { bytecode, handshakeHeader, inputJson, opcodeMap } = JSON.parse(body);\n      const result = vmNode.execute(\n        new Uint8Array(bytecode || []),\n        new Uint8Array(handshakeHeader || []),\n        JSON.stringify(inputJson || []),\n        new Uint8Array(opcodeMap || [])\n      );\n      res.writeHead(200, { 'Content-Type': 'application/json' });\n      res.end(result);\n    } catch (err: any) {\n      res.writeHead(500, { 'Content-Type': 'application/json' });\n      res.end(JSON.stringify({ error: err.message }));\n    }\n  });\n}\n`
    );
    
    const srcDir = path.join(tDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, `fortress.${ext}`),
      `import FortressClient from '@lkeld/fortress-wasm/client';\n\nexport function initFortress() {\n  FortressClient.init('/api/fortress')\n    .then(() => console.log("Fortress initialized"))\n    .catch(console.error);\n}\n`
    );
  },
  
  express: (tDir, isTS) => {
    const ext = isTS ? 'ts' : 'js';
    
    const routesDir = path.join(tDir, 'routes');
    fs.mkdirSync(routesDir, { recursive: true });
    fs.writeFileSync(path.join(routesDir, `fortress.${ext}`),
      isTS ?
      `import { Router, Request, Response } from 'express';\nimport { vmNode } from '@lkeld/fortress-wasm';\nconst router = Router();\nrouter.post('/fortress', (req: Request, res: Response) => {\n  try {\n    const { bytecode, handshakeHeader, inputJson, opcodeMap } = req.body;\n    const result = vmNode.execute(\n      new Uint8Array(bytecode || []),\n      new Uint8Array(handshakeHeader || []),\n      JSON.stringify(inputJson || []),\n      new Uint8Array(opcodeMap || [])\n    );\n    res.json(JSON.parse(result));\n  } catch (err: any) {\n    res.status(500).json({ error: err.message });\n  }\n});\nexport default router;\n` :
      `const express = require('express');\nconst { vmNode } = require('@lkeld/fortress-wasm');\nconst router = express.Router();\nrouter.post('/fortress', (req, res) => {\n  try {\n    const { bytecode, handshakeHeader, inputJson, opcodeMap } = req.body;\n    const result = vmNode.execute(\n      new Uint8Array(bytecode || []),\n      new Uint8Array(handshakeHeader || []),\n      JSON.stringify(inputJson || []),\n      new Uint8Array(opcodeMap || [])\n    );\n    res.json(JSON.parse(result));\n  } catch (err) {\n    res.status(500).json({ error: err.message });\n  }\n});\nmodule.exports = router;\n`
    );
    
    const middlewareDir = path.join(tDir, 'middleware');
    fs.mkdirSync(middlewareDir, { recursive: true });
    fs.writeFileSync(path.join(middlewareDir, `fortress.${ext}`),
      isTS ?
      `import { Request, Response, NextFunction } from 'express';\nexport default function fortressMiddleware(req: Request, res: Response, next: NextFunction) {\n  next();\n}\n` :
      `module.exports = function(req, res, next) {\n  next();\n};\n`
    );
  },
  
  fastify: (tDir, isTS) => {
    const ext = isTS ? 'ts' : 'js';
    
    const pluginsDir = path.join(tDir, 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    fs.writeFileSync(path.join(pluginsDir, `fortress.${ext}`),
      isTS ?
      `import { FastifyInstance, FastifyPluginOptions } from 'fastify';\nimport { vmNode } from '@lkeld/fortress-wasm';\nexport default async function (fastify: FastifyInstance, opts: FastifyPluginOptions) {\n  fastify.post('/api/fortress', async (request: any, reply) => {\n    try {\n      const { bytecode, handshakeHeader, inputJson, opcodeMap } = request.body;\n      const result = vmNode.execute(\n        new Uint8Array(bytecode || []),\n        new Uint8Array(handshakeHeader || []),\n        JSON.stringify(inputJson || []),\n        new Uint8Array(opcodeMap || [])\n      );\n      return JSON.parse(result);\n    } catch (err: any) {\n      reply.status(500);\n      return { error: err.message };\n    }\n  });\n}\n` :
      `const { vmNode } = require('@lkeld/fortress-wasm');\nmodule.exports = async function (fastify, opts) {\n  fastify.post('/api/fortress', async (request, reply) => {\n    try {\n      const { bytecode, handshakeHeader, inputJson, opcodeMap } = request.body;\n      const result = vmNode.execute(\n        new Uint8Array(bytecode || []),\n        new Uint8Array(handshakeHeader || []),\n        JSON.stringify(inputJson || []),\n        new Uint8Array(opcodeMap || [])\n      );\n      return JSON.parse(result);\n    } catch (err) {\n      reply.status(500);\n      return { error: err.message };\n    }\n  });\n};\n`
    );
  },
  
  hono: (tDir, isTS) => {
    const ext = isTS ? 'ts' : 'js';
    
    const apiDir = path.join(tDir, 'src/api');
    fs.mkdirSync(apiDir, { recursive: true });
    fs.writeFileSync(path.join(apiDir, `fortress.${ext}`),
      `import { Hono } from 'hono';\nimport { vmNode } from '@lkeld/fortress-wasm';\nconst app = new Hono();\napp.post('/', async (c) => {\n  try {\n    const { bytecode, handshakeHeader, inputJson, opcodeMap } = await c.req.json();\n    const result = vmNode.execute(\n      new Uint8Array(bytecode || []),\n      new Uint8Array(handshakeHeader || []),\n      JSON.stringify(inputJson || []),\n      new Uint8Array(opcodeMap || [])\n    );\n    return c.json(JSON.parse(result));\n  } catch (err: any) {\n    return c.json({ error: err.message }, 500);\n  }\n});\nexport default app;\n`
    );
  },
  
  koa: (tDir, isTS) => {
    const ext = isTS ? 'ts' : 'js';
    
    const routesDir = path.join(tDir, 'routes');
    fs.mkdirSync(routesDir, { recursive: true });
    fs.writeFileSync(path.join(routesDir, `fortress.${ext}`),
      isTS ?
      `import Router from '@koa/router';\nimport { vmNode } from '@lkeld/fortress-wasm';\nconst router = new Router();\nrouter.post('/api/fortress', (ctx: any) => {\n  try {\n    const { bytecode, handshakeHeader, inputJson, opcodeMap } = ctx.request.body;\n    const result = vmNode.execute(\n      new Uint8Array(bytecode || []),\n      new Uint8Array(handshakeHeader || []),\n      JSON.stringify(inputJson || []),\n      new Uint8Array(opcodeMap || [])\n    );\n    ctx.body = JSON.parse(result);\n  } catch (err: any) {\n    ctx.status = 500;\n    ctx.body = { error: err.message };\n  }\n});\nexport default router;\n` :
      `const Router = require('@koa/router');\nconst { vmNode } = require('@lkeld/fortress-wasm');\nconst router = new Router();\nrouter.post('/api/fortress', (ctx) => {\n  try {\n    const { bytecode, handshakeHeader, inputJson, opcodeMap } = ctx.request.body;\n    const result = vmNode.execute(\n      new Uint8Array(bytecode || []),\n      new Uint8Array(handshakeHeader || []),\n      JSON.stringify(inputJson || []),\n      new Uint8Array(opcodeMap || [])\n    );\n    ctx.body = JSON.parse(result);\n  } catch (err) {\n    ctx.status = 500;\n    ctx.body = { error: err.message };\n  }\n});\nmodule.exports = router;\n`
    );
  },
  
  nestjs: (tDir, isTS) => {
    const ext = isTS ? 'ts' : 'js';
    
    const fortDir = path.join(tDir, 'src/fortress');
    fs.mkdirSync(fortDir, { recursive: true });
    
    fs.writeFileSync(path.join(fortDir, `fortress.controller.${ext}`),
      `import { Controller, Post, Body } from '@nestjs/common';\nimport { vmNode } from '@lkeld/fortress-wasm';\n\n@Controller('api/fortress')\nexport class FortressController {\n  @Post()\n  post(@Body() body: any) {\n    const { bytecode, handshakeHeader, inputJson, opcodeMap } = body;\n    const result = vmNode.execute(\n      new Uint8Array(bytecode || []),\n      new Uint8Array(handshakeHeader || []),\n      JSON.stringify(inputJson || []),\n      new Uint8Array(opcodeMap || [])\n    );\n    return JSON.parse(result);\n  }\n}\n`
    );
    
    fs.writeFileSync(path.join(fortDir, `fortress.module.${ext}`),
      `import { Module } from '@nestjs/common';\nimport { FortressController } from './fortress.controller';\n\n@Module({ controllers: [FortressController] })\nexport class FortressModule {}\n`
    );
  },
  
  bun: (tDir, isTS) => {
    const ext = isTS ? 'ts' : 'js';
    
    fs.writeFileSync(path.join(tDir, `server.${ext}`),
      `import { vmNode } from '@lkeld/fortress-wasm';\n\nexport default {\n  port: 3000,\n  async fetch(request: Request) {\n    if (new URL(request.url).pathname === '/api/fortress') {\n      try {\n        const { bytecode, handshakeHeader, inputJson, opcodeMap } = await request.json();\n        const result = vmNode.execute(\n          new Uint8Array(bytecode || []),\n          new Uint8Array(handshakeHeader || []),\n          JSON.stringify(inputJson || []),\n          new Uint8Array(opcodeMap || [])\n        );\n        return new Response(result, { headers: { 'content-type': 'application/json' } });\n      } catch (err: any) {\n        return new Response(JSON.stringify({ error: err.message }), { status: 500 });\n      }\n    }\n    return new Response("Not Found", { status: 404 });\n  }\n};\n`
    );
  },
  
  deno: (tDir, isTS) => {
    const ext = isTS ? 'ts' : 'js';
    
    fs.writeFileSync(path.join(tDir, `server.${ext}`),
      `import { serve } from "https://deno.land/std/http/server.ts";\nimport { vmNode } from "npm:@lkeld/fortress-wasm";\n\nserve(async (req) => {\n  if (new URL(req.url).pathname === '/api/fortress') {\n    try {\n      const { bytecode, handshakeHeader, inputJson, opcodeMap } = await req.json();\n      const result = vmNode.execute(\n        new Uint8Array(bytecode || []),\n        new Uint8Array(handshakeHeader || []),\n        JSON.stringify(inputJson || []),\n        new Uint8Array(opcodeMap || [])\n      );\n      return new Response(result, {\n        headers: { "content-type": "application/json" }\n      });\n    } catch (err) {\n      return new Response(JSON.stringify({ error: err.message }), {\n        status: 500,\n        headers: { "content-type": "application/json" }\n      });\n    }\n  }\n  return new Response("Not Found", { status: 404 });\n});\n`
    );
  },
  
  html: (tDir, isTS) => {
    const ext = isTS ? 'ts' : 'js';
    
    fs.writeFileSync(path.join(tDir, `fortress.${ext}`),
      `import FortressClient from '@lkeld/fortress-wasm/client';\n\nif (typeof window !== 'undefined') {\n  FortressClient.init('/api/fortress')\n    .then(() => console.log('Fortress HTML page integration loaded'))\n    .catch(console.error);\n}\n`
    );
    
    if (!fs.existsSync(path.join(tDir, 'index.html'))) {
      fs.writeFileSync(path.join(tDir, 'index.html'),
        `<!DOCTYPE html>\n<html>\n<head>\n  <title>Fortress App</title>\n  <script src="fortress.js"></script>\n</head>\n<body>\n  <h1>Secured by Fortress</h1>\n</body>\n</html>\n`
      );
    }
  }
};
// Add aliases
scaffoldFiles['next-app'] = scaffoldFiles['next'];
scaffoldFiles['next-pages'] = scaffoldFiles['next'];
scaffoldFiles['solidjs'] = scaffoldFiles['solid'];

const FRAMEWORKS_LIST = [
  { name: 'Next.js App', id: 'next-app' },
  { name: 'Next.js Pages', id: 'next-pages' },
  { name: 'Nuxt 3', id: 'nuxt' },
  { name: 'SvelteKit', id: 'sveltekit' },
  { name: 'Remix', id: 'remix' },
  { name: 'Astro', id: 'astro' },
  { name: 'Angular', id: 'angular' },
  { name: 'SolidJS', id: 'solid' },
  { name: 'Qwik', id: 'qwik' },
  { name: 'Vite', id: 'vite' },
  { name: 'Express', id: 'express' },
  { name: 'Fastify', id: 'fastify' },
  { name: 'Hono', id: 'hono' },
  { name: 'Koa', id: 'koa' },
  { name: 'NestJS', id: 'nestjs' },
  { name: 'Bun', id: 'bun' },
  { name: 'Deno', id: 'deno' },
  { name: 'HTML', id: 'html' }
];

function getFriendlyName(id) {
    const item = FRAMEWORKS_LIST.find(f => f.id === id || (id === 'next' && f.id === 'next-app') || (id === 'solidjs' && f.id === 'solid'));
    return item ? item.name : id;
}

function findSourceFiles(dir) {
    const results = [];
    const ignoredDirs = ['node_modules', '.git', 'dist', 'build', '.nuxt', '.next', '.svelte-kit', '.fortress_keys', 'protected'];
    // Prioritise lib/util/helpers/services dirs so they appear at the top
    const priorityDirs = ['lib', 'utils', 'helpers', 'services', 'core', 'shared'];
    function walk(currentDir, depth) {
        let files;
        try {
            files = fs.readdirSync(currentDir);
        } catch (e) {
            return;
        }
        // Sort: priority dirs first, then alphabetical
        files.sort((a, b) => {
            const aIsPriority = priorityDirs.includes(a.toLowerCase());
            const bIsPriority = priorityDirs.includes(b.toLowerCase());
            if (aIsPriority && !bIsPriority) return -1;
            if (!aIsPriority && bIsPriority) return 1;
            return a.localeCompare(b);
        });
        for (const file of files) {
            const fullPath = path.join(currentDir, file);
            let stat;
            try {
                stat = fs.statSync(fullPath);
            } catch (e) {
                continue;
            }
            if (stat.isDirectory()) {
                if (!ignoredDirs.includes(file)) {
                    walk(fullPath, depth + 1);
                }
            } else if (stat.isFile()) {
                const ext = path.extname(file);
                if (['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'].includes(ext)) {
                    results.push(path.relative(dir, fullPath));
                }
            }
        }
    }
    walk(dir, 0);
    return results;
}

function babelParseExportedFunctions(content) {
    const parser = require('@babel/parser');
    const ast = parser.parse(content, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx', 'decorators-legacy']
    });
    
    const names = new Set();
    
    function traverse(node) {
        if (!node) return;
        if (node.type === 'ExportNamedDeclaration') {
            if (node.declaration) {
                const decl = node.declaration;
                if (decl.type === 'FunctionDeclaration' && decl.id) {
                    names.add(decl.id.name);
                } else if (decl.type === 'VariableDeclaration') {
                    for (const vDecl of decl.declarations) {
                        if (vDecl.id && vDecl.id.type === 'Identifier') {
                            names.add(vDecl.id.name);
                        }
                    }
                }
            }
            if (node.specifiers) {
                for (const spec of node.specifiers) {
                    if (spec.exported && spec.exported.type === 'Identifier') {
                        names.add(spec.exported.name);
                    }
                }
            }
        } else if (node.type === 'ExportDefaultDeclaration') {
            const decl = node.declaration;
            if (decl.type === 'FunctionDeclaration' && decl.id) {
                names.add(decl.id.name);
            } else if (decl.type === 'Identifier') {
                names.add(decl.name);
            }
        }
        
        for (const key in node) {
            const child = node[key];
            if (Array.isArray(child)) {
                for (const item of child) {
                    if (item && typeof item === 'object' && typeof item.type === 'string') {
                        traverse(item);
                    }
                }
            } else if (child && typeof child === 'object' && typeof child.type === 'string') {
                traverse(child);
            }
        }
    }
    
    traverse(ast);
    return Array.from(names);
}

function extractExportedFunctions(content) {
    const names = new Set();
    
    const pattern1 = /export\s+(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/g;
    let match;
    while ((match = pattern1.exec(content)) !== null) {
        names.add(match[1]);
    }
    
    const pattern2 = /export\s+(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>|[a-zA-Z0-9_$]+\s*=>)/g;
    while ((match = pattern2.exec(content)) !== null) {
        names.add(match[1]);
    }
    
    const pattern4 = /export\s+default\s+(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/g;
    while ((match = pattern4.exec(content)) !== null) {
        names.add(match[1]);
    }
    
    const pattern6 = /export\s*\{([^}]+)\}/g;
    while ((match = pattern6.exec(content)) !== null) {
        const exportsStr = match[1];
        const exportsList = exportsStr.split(',');
        for (let item of exportsList) {
            item = item.trim();
            if (item) {
                const parts = item.split(/\s+as\s+/);
                const name = parts[parts.length - 1].trim();
                if (/^[a-zA-Z0-9_$]+$/.test(name)) {
                    names.add(name);
                }
            }
        }
    }
    
    return Array.from(names);
}

function askQuestion(query, defaultVal) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        const promptText = defaultVal !== undefined ? `${query} (${defaultVal}): ` : query;
        rl.question(promptText, (answer) => {
            rl.close();
            resolve(answer.trim() || defaultVal);
        });
    });
}

function askPassword(query) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return askQuestion(query, '');
    }
    return new Promise((resolve) => {
        const stdin = process.stdin;
        const stdout = process.stdout;
        
        stdout.write(query);
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');
        
        let password = '';
        function handler(char) {
            if (char === '\n' || char === '\r' || char === '\u0004') {
                stdin.setRawMode(false);
                stdin.removeListener('data', handler);
                stdout.write('\n');
                resolve(password);
            } else if (char === '\u0003') {
                stdin.setRawMode(false);
                process.exit(130);
            } else if (char === '\b' || char === '\x7f') {
                if (password.length > 0) {
                    password = password.slice(0, -1);
                    stdout.write('\b \b');
                }
            } else {
                password += char;
                stdout.write('*');
            }
        }
        stdin.on('data', handler);
    });
}

// ─── Interactive Selection Helpers ─────────────────────────────────────────

const C = {
    reset:     '\x1b[0m',
    bold:      '\x1b[1m',
    dim:       '\x1b[2m',
    cyan:      '\x1b[36m',
    green:     '\x1b[32m',
    yellow:    '\x1b[33m',
    gray:      '\x1b[90m',
    clearLine: '\x1b[2K\r',
    up:        (n) => `\x1b[${n}A`,
    hide:      '\x1b[?25l',
    show:      '\x1b[?25h',
};

function renderLines(stdout, lines, lastCount) {
    if (lastCount > 0) stdout.write(C.up(lastCount));
    for (const line of lines) stdout.write(C.clearLine + line + '\n');
    return lines.length;
}

async function promptSelect(message, options, { visibleCount = 10 } = {}) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.log(`\n${message}`);
        options.forEach((o, i) => console.log(`${i + 1}) ${o}`));
        const ans = await askQuestion(`Enter number (1-${options.length}): `);
        return options[Math.max(0, parseInt(ans, 10) - 1)] || options[0];
    }
    return new Promise((resolve) => {
        let idx = 0, scroll = 0, drawn = 0;
        const { stdin, stdout } = process;
        stdout.write(C.hide);
        function paint() {
            const lines = [`${C.bold}${message}${C.reset} ${C.dim}(↑↓ navigate, enter select)${C.reset}`];
            const end = Math.min(scroll + visibleCount, options.length);
            if (scroll > 0) lines.push(`${C.dim}  ↑ ${scroll} more${C.reset}`);
            for (let i = scroll; i < end; i++) {
                const active = i === idx;
                lines.push(`${active ? C.cyan + '❯ ' + C.reset : '  '}${active ? C.cyan + C.bold : ''}${options[i]}${C.reset}`);
            }
            if (end < options.length) lines.push(`${C.dim}  ↓ ${options.length - end} more${C.reset}`);
            drawn = renderLines(stdout, lines, drawn);
        }
        function done(val) {
            stdin.setRawMode(false); stdin.removeListener('data', onKey); stdout.write(C.show);
            stdout.write(C.up(drawn));
            for (let i = 0; i < drawn; i++) stdout.write(C.clearLine + '\n');
            stdout.write(C.up(drawn));
            stdout.write(`${C.bold}${message}${C.reset} ${C.cyan}${val}${C.reset}\n`);
            resolve(val);
        }
        function onKey(k) {
            if (k === '\x03') { stdin.setRawMode(false); stdout.write(C.show); process.exit(130); }
            if (k === '\x1b[A' && idx > 0) { idx--; if (idx < scroll) scroll = idx; }
            else if (k === '\x1b[B' && idx < options.length - 1) { idx++; if (idx >= scroll + visibleCount) scroll = idx - visibleCount + 1; }
            else if (k === '\r' || k === '\n') { done(options[idx]); return; }
            paint();
        }
        stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8'); stdin.on('data', onKey); paint();
    });
}

async function promptMultiSelect(message, options, { visibleCount = 10 } = {}) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.log(`\n${message} (enter numbers separated by commas, or 'a' for all)`);
        options.forEach((o, i) => console.log(`${i + 1}) ${o}`));
        const ans = await askQuestion('Enter selection: ');
        if (ans.trim().toLowerCase() === 'a') return [...options];
        const picks = ans.split(',').map(n => options[parseInt(n.trim(), 10) - 1]).filter(Boolean);
        return picks.length > 0 ? picks : [options[0]];
    }
    return new Promise((resolve) => {
        let idx = 0, scroll = 0, drawn = 0;
        const selected = new Set();
        const { stdin, stdout } = process;
        stdout.write(C.hide);
        function paint() {
            const lines = [`${C.bold}${message}${C.reset} ${C.dim}(space select, 'a' all, enter confirm)${C.reset}`];
            const end = Math.min(scroll + visibleCount, options.length);
            if (scroll > 0) lines.push(`${C.dim}  ↑ ${scroll} more${C.reset}`);
            for (let i = scroll; i < end; i++) {
                const active = i === idx, sel = selected.has(i);
                const dot = sel ? `${C.green}●${C.reset}` : `${C.dim}○${C.reset}`;
                const cur = active ? `${C.cyan}❯${C.reset}` : ' ';
                const lbl = active ? `${C.cyan}${C.bold}${options[i]}${C.reset}` : sel ? `${C.green}${options[i]}${C.reset}` : options[i];
                lines.push(` ${cur} ${dot} ${lbl}`);
            }
            if (end < options.length) lines.push(`${C.dim}  ↓ ${options.length - end} more${C.reset}`);
            drawn = renderLines(stdout, lines, drawn);
        }
        function done() {
            stdin.setRawMode(false); stdin.removeListener('data', onKey); stdout.write(C.show);
            const result = selected.size > 0 ? [...selected].sort((a,b)=>a-b).map(i => options[i]) : [options[idx]];
            stdout.write(C.up(drawn));
            for (let i = 0; i < drawn; i++) stdout.write(C.clearLine + '\n');
            stdout.write(C.up(drawn));
            stdout.write(`${C.bold}${message}${C.reset} ${C.cyan}${result.join(', ')}${C.reset}\n`);
            resolve(result);
        }
        function onKey(k) {
            if (k === '\x03') { stdin.setRawMode(false); stdout.write(C.show); process.exit(130); }
            if (k === '\x1b[A' && idx > 0) { idx--; if (idx < scroll) scroll = idx; }
            else if (k === '\x1b[B' && idx < options.length - 1) { idx++; if (idx >= scroll + visibleCount) scroll = idx - visibleCount + 1; }
            else if (k === ' ') { selected.has(idx) ? selected.delete(idx) : selected.add(idx); }
            else if (k === 'a' || k === 'A') { selected.size === options.length ? selected.clear() : options.forEach((_, i) => selected.add(i)); }
            else if (k === '\r' || k === '\n') { done(); return; }
            paint();
        }
        stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8'); stdin.on('data', onKey); paint();
    });
}

async function promptFileSearch(message, files) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.log(`\n${message}`);
        files.forEach((f, i) => console.log(`${i + 1}) ${f}`));
        console.log(`${files.length + 1}) [Enter custom path]`);
        const ans = await askQuestion(`Enter number (1-${files.length + 1}): `);
        const n = parseInt(ans, 10);
        if (n >= 1 && n <= files.length) return files[n - 1];
        return await askQuestion('Enter custom file path: ');
    }
    return new Promise((resolve) => {
        let query = '', idx = 0, scroll = 0, drawn = 0;
        const VISIBLE = 10;
        const { stdin, stdout } = process;
        stdout.write(C.hide);
        function getFiltered() {
            const base = query ? files.filter(f => f.toLowerCase().includes(query.toLowerCase())) : [...files];
            return [...base, '[Enter custom path]'];
        }
        function highlightMatch(str, q) {
            if (!q) return str;
            const lo = str.toLowerCase(), qi = lo.indexOf(q.toLowerCase());
            if (qi < 0) return str;
            return str.slice(0, qi) + C.yellow + C.bold + str.slice(qi, qi + q.length) + C.reset + str.slice(qi + q.length);
        }
        function paint() {
            const filtered = getFiltered();
            if (idx >= filtered.length) { idx = filtered.length - 1; scroll = Math.max(0, idx - VISIBLE + 1); }
            const lines = [
                `${C.bold}${message}${C.reset}`,
                `  ${C.cyan}❯${C.reset} ${query}${C.dim}▌ type to filter, ↑↓ navigate, enter select${C.reset}`
            ];
            const end = Math.min(scroll + VISIBLE, filtered.length);
            if (scroll > 0) lines.push(`${C.dim}  ↑ ${scroll} more${C.reset}`);
            for (let i = scroll; i < end; i++) {
                const active = i === idx, isCustom = filtered[i] === '[Enter custom path]';
                const prefix = active ? `${C.cyan}❯ ${C.reset}` : '  ';
                let lbl = isCustom ? `${C.dim}[Enter custom path]${C.reset}` : highlightMatch(filtered[i], query);
                if (active) lbl = `${C.cyan}${C.bold}${isCustom ? '[Enter custom path]' : filtered[i]}${C.reset}`;
                lines.push(`${prefix}${lbl}`);
            }
            if (end < filtered.length) lines.push(`${C.dim}  ↓ ${filtered.length - end} more${C.reset}`);
            drawn = renderLines(stdout, lines, drawn);
        }
        function done(val) {
            stdin.setRawMode(false); stdin.removeListener('data', onKey); stdout.write(C.show);
            stdout.write(C.up(drawn));
            for (let i = 0; i < drawn; i++) stdout.write(C.clearLine + '\n');
            stdout.write(C.up(drawn));
            if (val === '[Enter custom path]') {
                stdout.write(`${C.bold}${message}${C.reset} ${C.dim}custom path${C.reset}\n`);
                askQuestion('Enter custom file path: ').then(resolve);
            } else {
                stdout.write(`${C.bold}${message}${C.reset} ${C.cyan}${val}${C.reset}\n`);
                resolve(val);
            }
        }
        function onKey(k) {
            if (k === '\x03') { stdin.setRawMode(false); stdout.write(C.show); process.exit(130); }
            const filtered = getFiltered();
            if (k === '\x1b[A' && idx > 0) { idx--; if (idx < scroll) scroll = idx; }
            else if (k === '\x1b[B' && idx < filtered.length - 1) { idx++; if (idx >= scroll + VISIBLE) scroll = idx - VISIBLE + 1; }
            else if (k === '\x7f' || k === '\b') { if (query.length > 0) { query = query.slice(0, -1); idx = 0; scroll = 0; } }
            else if (k === '\r' || k === '\n') { done(filtered[idx]); return; }
            else if (k.length === 1 && k >= ' ') { query += k; idx = 0; scroll = 0; }
            paint();
        }
        stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8'); stdin.on('data', onKey); paint();
    });
}

async function promptConfirm(message, defaultYes = true) {
    const opts = defaultYes ? ['Yes', 'No'] : ['No', 'Yes'];
    const result = await promptSelect(message, opts);
    return result === 'Yes';
}

// ─────────────────────────────────────────────────────────────────────────────

async function showProgressBar(label, durationMs = 1000) {
    const width = 30;
    const steps = 10;
    const interval = durationMs / steps;
    for (let i = 0; i <= steps; i++) {
        const pct = Math.round((i / steps) * 100);
        const filled = Math.round((i / steps) * width);
        const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
        process.stdout.write(`\r${label} [${bar}] ${pct}%`);
        await new Promise((resolve) => setTimeout(resolve, interval));
    }
    process.stdout.write('\n');
}

function renderBox(title, lines) {
    const allLines = [title, '', ...lines];
    const maxLen = Math.max(...allLines.map(l => l.length));
    const border = '─'.repeat(maxLen + 4);
    let box = `┌${border}┐\n`;
    for (const line of allLines) {
        const padding = ' '.repeat(maxLen - line.length);
        box += `│  ${line}${padding}  │\n`;
    }
    box += `└${border}┘`;
    return box;
}

function printBanner() {
  const banner = `
███████╗ ██████╗ ██████╗ ████████╗██████╗ ███████╗███████╗███████╗
██╔════╝██╔═══██╗██╔══██╗╚══██╔══╝██╔══██╗██╔════╝██╔════╝██╔════╝
█████╗  ██║   ██║██████╔╝   ██║   ██████╔╝█████╗  ███████╗███████╗
██╔══╝  ██║   ██║██╔══██╗   ██║   ██╔══██╗██╔══╝  ╚════██║╚════██║
██║     ╚██████╔╝██║  ██║   ██║   ██║  ██║███████╗███████║███████║
╚═╝      ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝
`;
  const startColor = { r: 138, g: 43, b: 226 };
  const endColor = { r: 255, g: 20, b: 147 };
  
  const lines = banner.split('\n');
  const gradiented = lines.map((line) => {
    let result = '';
    for (let i = 0; i < line.length; i++) {
        const ratio = line.length > 1 ? i / (line.length - 1) : 1;
        const r = Math.round(startColor.r + ratio * (endColor.r - startColor.r));
        const g = Math.round(startColor.g + ratio * (endColor.g - startColor.g));
        const b = Math.round(startColor.b + ratio * (endColor.b - startColor.b));
        result += `\x1b[38;2;${r};${g};${b}m${line[i]}`;
    }
    result += '\x1b[0m';
    return result;
  }).join('\n');
  console.log(gradiented);
  console.log("Welcome to create-fortress-app CLI!");
  console.log("");
}

function getCanonicalFramework(fw) {
    if (!fw) return 'next';
    const lower = fw.toLowerCase();
    if (lower.startsWith('next')) return 'next';
    if (lower === 'solidjs') return 'solid';
    if (lower.startsWith('nuxt')) return 'nuxt';
    return lower;
}

function writeConfigAndKeys(framework, isTS, pm, protectedDirName, password, addToEnv, selectedFunctions, selectedFilePath) {
    const canonicalFw = getCanonicalFramework(framework);
    
    const resolvedProtectedDir = path.resolve(targetDir, protectedDirName);
    if (!resolvedProtectedDir.startsWith(targetDir)) {
        throw new Error("Directory traversal detected. Protected directory must be inside the target directory.");
    }
    
    let privateKeyBytes, publicKeyBytes;
    try {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
        privateKeyBytes = privateKey.export({ type: 'pkcs8', format: 'der' });
        publicKeyBytes = publicKey.export({ type: 'spki', format: 'der' });
    } catch (e) {
        privateKeyBytes = crypto.randomBytes(32);
        publicKeyBytes = crypto.randomBytes(32);
    }
    
    const keysDir = path.join(targetDir, '.fortress_keys');
    fs.mkdirSync(keysDir, { recursive: true });
    fs.writeFileSync(path.join(keysDir, 'private.key'), privateKeyBytes);
    fs.writeFileSync(path.join(keysDir, 'public.key'), publicKeyBytes);
    
    fs.mkdirSync(resolvedProtectedDir, { recursive: true });
    
    const entryFile = isTS ? 'index.ts' : 'index.js';
    let entryContent;
    
    // If a real source file was selected, copy its actual content
    if (selectedFilePath && fs.existsSync(selectedFilePath)) {
        entryContent = fs.readFileSync(selectedFilePath, 'utf8');
    } else {
        // Fallback to stubs only if no file was selected
        entryContent = '// Protected functions scaffolded by create-fortress-app\n';
        if (selectedFunctions && selectedFunctions.length > 0) {
            selectedFunctions.forEach(func => {
                entryContent += `export function ${func}() {\n  // TODO: Replace with your real logic\n  return "fortress-wasm: ${func}";\n}\n\n`;
            });
        } else {
            entryContent += `export function run() {\n  return "fortress-wasm entry";\n}\n`;
        }
    }
    fs.writeFileSync(path.join(resolvedProtectedDir, entryFile), entryContent);
    
    const configContent = `// fortress.config.js
module.exports = {
  framework: "${canonicalFw}",
  typescript: ${isTS},
  packageManager: "${pm}",
  protectedDir: "${protectedDirName}",
  keysPath: "./.fortress_keys"
};
`;
    fs.writeFileSync(configPath, configContent);
    
    if (scaffoldFiles[canonicalFw]) {
      try {
        scaffoldFiles[canonicalFw](targetDir, isTS);
      } catch (e) {
        // ignore
      }
    }
    
    if (addToEnv && password) {
      const envPath = path.join(targetDir, '.env');
      let envContent = '';
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
      }
      if (!envContent.includes('FORTRESS_SIGNING_PASSWORD')) {
        envContent += `\nFORTRESS_SIGNING_PASSWORD="${password}"`;
      }
      if (!envContent.includes('FORTRESS_KEYS_PATH')) {
        envContent += `\nFORTRESS_KEYS_PATH="./.fortress_keys"`;
      }
      fs.writeFileSync(envPath, envContent.trim() + '\n');
    }
    
    const gitignorePath = path.join(targetDir, '.gitignore');
    let gitignoreContent = '';
    if (fs.existsSync(gitignorePath)) {
      gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    }
    let updatedGitignore = false;
    if (!gitignoreContent.includes('.fortress_keys')) {
      gitignoreContent += `\n.fortress_keys/`;
      updatedGitignore = true;
    }
    if (!gitignoreContent.includes('.env')) {
      gitignoreContent += `\n.env`;
      updatedGitignore = true;
    }
    if (updatedGitignore) {
      fs.writeFileSync(gitignorePath, gitignoreContent.trim() + '\n');
    }
}

async function runInteractive() {
    printBanner();
    
    let framework = finalFramework;
    console.log(`Auto-detected framework: ${getFriendlyName(framework)}`);
    const confirmFw = await askQuestion('Confirm this framework? (y/n)', 'y');
    if (!confirmFw.toLowerCase().startsWith('y')) {
      console.log('\nSelect framework to override:');
      FRAMEWORKS_LIST.forEach((fw, idx) => {
        console.log(`${idx + 1}) ${fw.name}`);
      });
      while (true) {
        const choice = await askQuestion(`Enter number (1-${FRAMEWORKS_LIST.length}): `);
        const num = parseInt(choice, 10);
        if (num >= 1 && num <= FRAMEWORKS_LIST.length) {
          framework = FRAMEWORKS_LIST[num - 1].id;
          break;
        } else {
          console.log('Invalid selection.');
        }
      }
    }
    
    const candidateFiles = findSourceFiles(targetDir);
    const selectedFile = candidateFiles.length > 0
        ? await promptFileSearch('Choose a file to protect:', candidateFiles)
        : await askQuestion('\nNo JS/TS source files found. Enter custom file path to protect: ');

    let selectedFunctions = [];
    const fullFilePath = path.resolve(targetDir, selectedFile);
    if (!fullFilePath.startsWith(targetDir)) {
        throw new Error('Directory traversal detected. Protected file path must be inside the target directory.');
    }
    if (selectedFile && fs.existsSync(fullFilePath)) {
        let content = '';
        try { content = fs.readFileSync(fullFilePath, 'utf8'); } catch (e) {}
        let detectedFunctions = [];
        try { detectedFunctions = babelParseExportedFunctions(content); } catch (e) {
            detectedFunctions = extractExportedFunctions(content);
        }
        if (detectedFunctions.length > 0) {
            selectedFunctions = await promptMultiSelect('Choose function(s) to protect:', detectedFunctions);
        } else {
            const customFunc = await askQuestion('\nNo exportable functions detected. Enter custom function name to protect: ');
            selectedFunctions = [customFunc];
        }
    } else {
        const customFunc = await askQuestion('\nFile does not exist or empty. Enter custom function name to protect: ');
        selectedFunctions = [customFunc];
    }
    
    let password = '';
    while (true) {
      const pw1 = await askPassword('Enter signing password (min 12 chars): ');
      if (pw1.length < 12) {
          console.log('Error: Password must be at least 12 characters.');
          continue;
      }
      const pw2 = await askPassword('Confirm signing password: ');
      if (pw1 !== pw2) {
          console.log('Error: Passwords do not match.');
          continue;
      }
      password = pw1;
      break;
    }
    
    const apiEndpoint = await askQuestion('\nConfirm API endpoint', '/api/fortress');
    const protectedDirName = await askQuestion('Confirm output directory', './protected');
    const addToEnv = await promptConfirm('Add signing password and keys path to .env?', true);
    
    console.log('');
    await showProgressBar('Generating keypair files   ', 600);
    await showProgressBar('Scaffolding route files     ', 600);
    await showProgressBar('Compiling configurations     ', 800);
    
    const fullSelectedFilePath = selectedFile ? path.resolve(targetDir, selectedFile) : null;
    writeConfigAndKeys(framework, finalTypeScript, finalPackageManager, protectedDirName, password, addToEnv, selectedFunctions, fullSelectedFilePath);
    
    const summaryLines = [
      `Framework:       ${getFriendlyName(framework)}`,
      `TypeScript:      ${finalTypeScript}`,
      `Package Manager: ${finalPackageManager}`,
      `Config File:     ./fortress.config.js`,
      `Keys Path:       ./.fortress_keys/`,
      `Protected Dir:   ${protectedDirName}`,
      `API Endpoint:    ${apiEndpoint}`
    ];
    if (addToEnv) {
      summaryLines.push(`Environment:     Updated .env file`);
    }
    const box = renderBox('Fortress App Scaffolded successfully!', summaryLines);
    console.log('\n' + box + '\n');
    
    // Auto-run the build
    console.log('Building protected functions...');
    const fortressBin = path.resolve(__dirname, '../../../bin/index.js');
    const { execSync } = require('child_process');
    try {
        execSync(`FORTRESS_SIGNING_PASSWORD="${password}" node "${fortressBin}" build`, {
            cwd: targetDir,
            stdio: 'inherit',
            env: { ...process.env, FORTRESS_SIGNING_PASSWORD: password }
        });
        console.log('\n✅ Build complete! Your protected functions are compiled and ready.');
        console.log('\nNext steps:');
        console.log('  1. Import the useFortress hook in your components:');
        console.log('       import { useFortress } from \'@/hooks/useFortress\';');
        console.log('  2. Add worker-src CSP header to next.config.ts:');
        console.log('       worker-src \'self\' blob:;');
        console.log('  3. Run `fortress build` any time you change protected/ code.\n');
    } catch (e) {
        console.log('\n⚠️  Scaffolding complete, but auto-build failed. Run manually:');
        console.log(`  FORTRESS_SIGNING_PASSWORD="<your-password>" npx fortress build\n`);
    }
}

function runNonInteractive() {
    let pw;
    if (overridePassword) {
        if (overridePassword.length < 12) {
            console.error('Error: Password must be at least 12 characters.');
            process.exit(1);
        }
        pw = overridePassword;
    } else {
        pw = crypto.randomBytes(8).toString('hex');
        console.log('Auto-generated signing password: ' + pw);
    }
    writeConfigAndKeys(finalFramework, finalTypeScript, finalPackageManager, './protected', pw, true, []);
    
    console.log(`Successfully scaffolded fortress-wasm application!`);
    console.log(`Framework: ${getCanonicalFramework(finalFramework)}`);
    console.log(`TypeScript: ${finalTypeScript}`);
    console.log(`Package Manager: ${finalPackageManager}`);
    console.log(`Protected directory: ${path.join(targetDir, 'protected')}`);
}

if (isInteractive) {
    runInteractive().catch(err => {
        console.error(err);
        process.exit(1);
    });
} else {
    runNonInteractive();
}
