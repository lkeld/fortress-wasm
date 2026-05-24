# Configuration Guide

Fortress WASM is configured via a `fortress.config.js` file located at the root of your project directory. This configuration dictates the behavior of the compilation pipeline, the dev server, key management, and framework integrations.

## Configuration Schema

The configuration object exported from `fortress.config.js` supports the following properties:

| Property | Type | Description | Default |
|---|---|---|---|
| `framework` | `string` | The target framework integration (e.g., `'next'`, `'vite'`, `'express'`, `'hono'`, `'fastify'`, `'koa'`, `'sveltekit'`, `'nuxt'`, `'remix'`, `'astro'`, `'angular'`, `'solid'`, `'qwik'`, `'bun'`, `'deno'`, `'html'`). | `'vite'` |
| `typescript` | `boolean` | Enable or disable TypeScript-specific scaffolding and support. | `false` |
| `packageManager` | `string` | The package manager used in the project (`'npm'`, `'yarn'`, `'pnpm'`, `'bun'`). | `'npm'` |
| `protect` | `string[]` | An array of globs/file paths that the dev server and build compiler will scan for `@protect` annotations. | `[]` |
| `output` | `string` | The directory where compiled `.fvbc` bytecode and `.opcodes.json` mapping files will be written. | `'./protected'` |
| `keysPath` | `string` | Relative path to the folder containing your public and private keys. | `'./.fortress_keys'` |
| `serve` | `object` | Settings for the developer environment dev server. | `{}` |
| `serve.port` | `number` | The port that the dev server will attempt to bind to. Falls back incrementally if busy. | `13700` |

## Example `fortress.config.js`

Below is an example of a typical configuration:

```javascript
module.exports = {
  framework: "vite",
  typescript: true,
  packageManager: "npm",
  protect: [
    "./src/utils/crypto.ts",
    "./src/services/licensing.ts"
  ],
  output: "./protected",
  keysPath: "./.fortress_keys",
  serve: {
    port: 13700
  }
};
```
