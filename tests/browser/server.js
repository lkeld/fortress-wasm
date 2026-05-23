const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 8080;

const baseDirs = {
  pkgWeb: path.resolve(__dirname, '../../pkg-web'),
  dist: path.resolve(__dirname, '../../dist'),
  browserTests: path.resolve(__dirname, '.')
};

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  // COOP/COEP headers
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url || '/', 'http://localhost');
  let pathname = parsedUrl.pathname;

  // Map to correct directory
  let baseDir;
  let relativePath = pathname;

  if (pathname.startsWith('/pkg-web/')) {
    baseDir = baseDirs.pkgWeb;
    relativePath = pathname.substring('/pkg-web/'.length);
  } else if (pathname.startsWith('/dist/')) {
    baseDir = baseDirs.dist;
    relativePath = pathname.substring('/dist/'.length);
  } else {
    baseDir = baseDirs.browserTests;
    if (pathname === '/' || pathname === '') {
      relativePath = 'index.html';
    } else {
      relativePath = pathname.substring(1);
    }
  }

  const resolvedPath = path.resolve(baseDir, relativePath);
  console.log("SERVER LOG: Serving", resolvedPath);
  
  // Protect against path traversal: resolvedPath must start with baseDir
  if (!resolvedPath.startsWith(baseDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden: Path traversal detected');
    return;
  }

  fs.stat(resolvedPath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    let contentType = 'application/octet-stream';
    if (ext === '.html') contentType = 'text/html';
    else if (ext === '.js' || ext === '.mjs') contentType = 'application/javascript';
    else if (ext === '.wasm') contentType = 'application/wasm';
    else if (ext === '.json') contentType = 'application/json';
    else if (ext === '.png') contentType = 'image/png';
    else if (ext === '.css') contentType = 'text/css';

    res.writeHead(200, { 'Content-Type': contentType });
    const stream = fs.createReadStream(resolvedPath);
    stream.pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Static server running at http://localhost:${PORT}/`);
});
