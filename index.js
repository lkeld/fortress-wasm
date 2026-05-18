// Fortress WASM Unified Entry Point

// Export Node and Web WASM implementations
let vmNode = null;
try {
  vmNode = require('./pkg-node/vm_core.js');
} catch (e) {
  // Silent catch in case it's not built or imported in a browser environment
}

let vmWeb = null;
try {
  // Webpack / Vite / Next.js bundlers will pick this up
  vmWeb = require('./pkg-web/vm_core.js');
} catch (e) {
  // Silent catch
}

// Export compiler and scrambler APIs
let compiler = null;
let scrambler = null;
try {
  compiler = require('./compiler/dist/cli.js');
  scrambler = require('./server/dist/scrambler.js');
} catch (e) {
  // In pure frontend environments, compiler might not be available
}

module.exports = {
  vmNode,
  vmWeb,
  compiler,
  scrambler
};
