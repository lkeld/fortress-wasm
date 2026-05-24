module.exports = {
  mode: 'development',
  entry: './src/index.js',
  output: './dist/bundle.js',
  obfuscation: {
    enabled: true,
    controlFlowFlattening: true,
    stringArrayEncoding: ['base64']
  },
  wasm: {
    integrityCheck: true,
    selfChecksumming: true
  }
};
