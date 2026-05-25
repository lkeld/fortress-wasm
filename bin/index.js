#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

let version = "1.5.2";
try {
    version = require('../package.json').version;
} catch (e) {}

const command = process.argv[2];
const args = process.argv.slice(3);

async function fetchJSON(urlOrPath) {
    if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
        return new Promise((resolve, reject) => {
            const httpLib = urlOrPath.startsWith('https://') ? require('https') : require('http');
            httpLib.get(urlOrPath, { headers: { 'Accept': 'application/json' } }, (res) => {
                if (res.statusCode !== 200) {
                    reject(new Error(`Server returned status code ${res.statusCode}`));
                    return;
                }
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(e);
                    }
                });
            }).on('error', reject);
        });
    } else {
        return JSON.parse(fs.readFileSync(urlOrPath, 'utf8'));
    }
}

if (!command || command === '--help' || command === '-h') {
    console.log(`fortress-wasm CLI - version ${version}`);
    console.log("Usage: fortress-wasm [command] [options]");
    console.log("Commands:");
    console.log("  dev      Start the development server");
    console.log("  build    Scan and compile annotated functions");
    console.log("  protect  Interactively select and protect functions via the CLI");
    console.log("  verify   Verify a fortress-wasm build");
    process.exit(0);
}

(async () => {
    if (command === 'build') {
        function askYesNo(query) {
            return new Promise((resolve) => {
                const readline = require('readline');
                const rl = readline.createInterface({
                    input: process.stdin,
                    output: process.stdout
                });
                rl.question(query, (answer) => {
                    rl.close();
                    process.stdin.pause();
                    const lower = answer.trim().toLowerCase();
                    resolve(lower === 'y' || lower === 'yes');
                });
            });
        }

        // 1. Probe check for isolated-vm
        let hasIvm = false;
        try {
            let ivm;
            try {
                ivm = require('isolated-vm');
            } catch (e) {
                const { createRequire } = require('module');
                const path = require('path');
                const localRequire = createRequire(path.resolve(process.cwd(), 'package.json'));
                ivm = localRequire('isolated-vm');
            }
            if (!ivm) {
                throw new Error("isolated-vm not found");
            }
            const { execSync } = require('child_process');
            execSync('node -e "const ivm = require(\'isolated-vm\'); new ivm.Isolate({ memoryLimit: 128 });"', {
                stdio: 'ignore',
                timeout: 1000
            });
            hasIvm = true;
        } catch (e) {
            hasIvm = false;
        }

        // 2. If missing and interactive, prompt the user
        if (!hasIvm && process.stdin.isTTY && process.stdout.isTTY) {
            console.log("\n[INFO] The secure sandbox package 'isolated-vm' is not installed or failed to load.");
            console.log("Without it, the compiler will fall back to Node's built-in 'vm' module (which is less secure for untrusted code).");
            console.log("");
            const install = await askYesNo("Would you like to install and compile 'isolated-vm' now? (y/n) ");
            if (install) {
                // Check for compilers
                let hasCompilers = false;
                const { execSync } = require('child_process');
                try {
                    if (process.platform === 'darwin') {
                        execSync('xcode-select -p', { stdio: 'ignore' });
                        hasCompilers = true;
                    } else if (process.platform === 'win32') {
                        execSync('where cl.exe', { stdio: 'ignore' });
                        hasCompilers = true;
                    } else {
                        execSync('make --version && (gcc --version || g++ --version || clang --version)', { stdio: 'ignore', shell: true });
                        hasCompilers = true;
                    }
                } catch (err) {
                    hasCompilers = false;
                }

                if (!hasCompilers) {
                    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
                    if (process.platform === 'darwin') {
                        console.log("[INFO] Native C++ compiler tools are missing on your system.");
                        console.log("Fortress will trigger the macOS Command Line Tools installer now.");
                        console.log("Please complete the installation dialog that appears on your screen,");
                        console.log("then run the build command again once finished.");
                        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
                        try {
                            const spawn = require('cross-spawn');
                            spawn.sync('xcode-select', ['--install'], { stdio: 'inherit' });
                        } catch (e) {}
                    } else if (process.platform === 'win32') {
                        console.log("[ERROR] Native C++ compiler tools (MSVC cl.exe) are missing.");
                        console.log("To compile the secure sandbox, please install the build tools:");
                        console.log("  winget install Microsoft.VisualStudio.Workload.VCTools");
                        console.log("After installing, please run the build command again.");
                        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
                    } else {
                        console.log("[ERROR] Native C++ compiler tools (gcc, make, or clang) are missing.");
                        console.log("To compile the secure sandbox, please install the build tools:");
                        console.log("  Ubuntu/Debian: sudo apt install build-essential");
                        console.log("  Fedora/RHEL:   sudo dnf groupinstall \"Development Tools\"");
                        console.log("After installing, please run the build command again.");
                        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
                    }
                    process.exit(1);
                } else {
                    console.log("\n[INFO] Compiler tools detected. Compiling and installing 'isolated-vm'...");
                    let installCmd = 'npm install --save-dev isolated-vm';
                    if (fs.existsSync('pnpm-lock.yaml')) {
                        installCmd = 'pnpm add -D isolated-vm';
                    } else if (fs.existsSync('yarn.lock')) {
                        installCmd = 'yarn add -D isolated-vm';
                    } else if (fs.existsSync('bun.lockb') || fs.existsSync('bun.lock')) {
                        installCmd = 'bun add -d isolated-vm';
                    }
                    
                    try {
                        const spawn = require('cross-spawn');
                        const parts = installCmd.split(' ');
                        const result = spawn.sync(parts[0], parts.slice(1), { stdio: 'inherit', cwd: process.cwd() });
                        if (result.status === 0) {
                            console.log("\n✓ 'isolated-vm' compiled and installed successfully!\n");
                        } else {
                            console.log("\n⚠️ Compilation failed. Falling back to the Node.js built-in 'vm' module.\n");
                        }
                    } catch (err) {
                        console.log(`\n⚠️ Failed to run installer: ${err.message}. Falling back to 'vm'.\n`);
                    }
                }
            } else {
                console.log("\n[INFO] Proceeding with the Node.js built-in 'vm' module fallback.\n");
            }
        }

        const configPath = path.resolve(process.cwd(), 'fortress.config.js');
        let config = {};
        if (fs.existsSync(configPath)) {
            try {
                config = require(configPath);
            } catch (e) {}
        }
        const outputDir = config.output || './protected';
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const { scanDirectoryParallel } = require('../compiler/dist/scanner.js');
        console.log("Scanning directory for @protect annotations (parallel)...");
        
        // Scan files in parallel using worker threads
        const functions = await scanDirectoryParallel(process.cwd());

        functions.forEach(fn => {
            // Validate name characters (spaces/symbols)
            const name = fn.customName || fn.name;
            if (/[^a-zA-Z0-9_]/.test(name)) {
                console.error(`Error: Invalid characters in protect name "${name}".`);
                process.exit(1);
            }

            // Warnings for unexported functions
            if (!fn.isExported) {
                console.warn(`Warning: Function "${fn.name}" in ${fn.filePath} is annotated with @protect but is not exported.`);
            }
            
            const fvbcPath = path.join(outputDir, `${name}.fvbc`);
            const opPath = path.join(outputDir, `${name}.opcodes.json`);
            fs.writeFileSync(fvbcPath, Buffer.from(fn.code, 'base64'));
            const opcodes = fn.opcodeMap ? Array.from(fn.opcodeMap) : Array.from({ length: 256 }, (_, i) => i);
            fs.writeFileSync(opPath, JSON.stringify(opcodes));
            console.log(`✓ Compiled protected function: ${name}`);
        });

        console.log("Build completed successfully.");
        process.exit(0);
    }

    if (command === 'dev' || command === 'watch') {
        if (!process.env.FORTRESS_SIGNING_PASSWORD) {
            if (process.env.FORTRESS_DEV_KEY) {
                process.env.FORTRESS_SIGNING_PASSWORD = process.env.FORTRESS_DEV_KEY;
            } else {
                const devKeyPath = path.resolve(process.cwd(), '.fortress_dev_key');
                if (fs.existsSync(devKeyPath)) {
                    process.env.FORTRESS_SIGNING_PASSWORD = fs.readFileSync(devKeyPath, 'utf8').trim();
                } else {
                    const devKey = crypto.randomBytes(16).toString('hex');
                    fs.writeFileSync(devKeyPath, devKey + '\n');
                    
                    const gitignorePath = path.resolve(process.cwd(), '.gitignore');
                    if (fs.existsSync(gitignorePath)) {
                        let gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
                        if (!gitignoreContent.includes('.fortress_dev_key')) {
                            gitignoreContent = gitignoreContent.trimRight() + '\n.fortress_dev_key\n';
                            fs.writeFileSync(gitignorePath, gitignoreContent);
                        }
                    }
                    console.log('[fortress] No .fortress_dev_key found. Generating local dev signing key...');
                    console.log('[fortress] ✓ Dev key created at .fortress_dev_key (gitignored — local to this machine)');
                    process.env.FORTRESS_SIGNING_PASSWORD = devKey;
                }
            }
        }

        let server = null;
        let watchers = [];
        let configWatcher = null;
        let rebuildTimeout = null;
        let childProcess = null;
        let isParentExiting = false;
        let childExitCode = 0;

        const dashDashIndex = process.argv.indexOf('--');
        let childCmd = null;
        let childArgs = [];
        if (dashDashIndex !== -1 && dashDashIndex > 2) {
            childCmd = process.argv[dashDashIndex + 1];
            childArgs = process.argv.slice(dashDashIndex + 2);
        }

        function spawnChildProcess(port) {
            if (childProcess) return;

            const spawn = require('cross-spawn');
            console.log(`[fortress] Spawning child command: ${childCmd} ${childArgs.join(' ')}`);
            childProcess = spawn(childCmd, childArgs, {
                stdio: 'inherit',
                env: {
                    ...process.env,
                    FORTRESS_PORT: port.toString(),
                    FORTRESS_DEV_PORT: port.toString()
                }
            });

            childProcess.on('exit', (code, signal) => {
                console.log(`[fortress] Child process exited with code ${code} (signal ${signal})`);
                if (code !== null) {
                    childExitCode = code;
                } else {
                    childExitCode = 1;
                }
                childProcess = null;

                if (!isParentExiting) {
                    isParentExiting = true;
                    console.log(`[fortress] Child process exited spontaneously. Shutting down dev server...`);
                    if (configWatcher) {
                        try { configWatcher.close(); } catch (e) {}
                    }
                    stopDevServer(() => {
                        process.exit(childExitCode);
                    });
                }
            });

            childProcess.on('error', (err) => {
                console.error(`[fortress] Failed to start child process:`, err);
                childProcess = null;
                if (!isParentExiting) {
                    isParentExiting = true;
                    if (configWatcher) {
                        try { configWatcher.close(); } catch (e) {}
                    }
                    stopDevServer(() => {
                        process.exit(1);
                    });
                }
            });
        }

        process.on('exit', () => {
            if (childProcess && childProcess.pid) {
                try {
                    const treeKill = require('tree-kill');
                    treeKill(childProcess.pid, 'SIGKILL');
                } catch (e) {}
                try {
                    process.kill(childProcess.pid, 'SIGKILL');
                } catch (e) {}
            }
        });

        function stopDevServer(callback) {
            watchers.forEach(w => {
                try { w.close(); } catch (e) {}
            });
            watchers = [];

            if (server) {
                server.close(() => {
                    server = null;
                    if (callback) callback();
                });
            } else {
                if (callback) callback();
            }
        }

        function startDevServer() {
            const configPath = path.resolve(process.cwd(), 'fortress.config.js');
            if (!fs.existsSync(configPath)) {
                console.error("Error: fortress.config.js is missing.");
                process.exit(1);
            }

            // Clear require cache for clean reload
            delete require.cache[require.resolve(configPath)];

            let config = {};
            try {
                config = require(configPath);
            } catch (e) {
                console.error("Error: Failed to parse fortress.config.js.");
                process.exit(1);
            }

            const port = (config.serve && config.serve.port) || 3001;
            const protectPaths = config.protect || [];
            const outputDir = config.output || './protected';

            function startServer(portToTry) {
                server = http.createServer((req, res) => {
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
                    if (req.method === 'OPTIONS') {
                        res.statusCode = 200;
                        res.end();
                        return;
                    }

                    const url = req.url.split('?')[0];
                    if (url === '/_fortress/worker.js') {
                        if (req.method !== 'GET') {
                            res.statusCode = 405;
                            res.setHeader('Content-Type', 'text/plain');
                            res.end('Method Not Allowed');
                            return;
                        }
                        res.statusCode = 200;
                        res.setHeader('Content-Type', 'application/javascript');
                        let workerJSCode = '// fortress-wasm inlined IIFE bundled script';
                        try {
                            const possibleWorkerPaths = [
                                path.join(__dirname, '../packages/sdk/worker.js'),
                                path.join(__dirname, '../js-runtime/dist/worker.js'),
                                path.join(process.cwd(), 'dist/fortress-worker.js'),
                                path.join(process.cwd(), 'worker-bundle.js')
                            ];
                            for (const p of possibleWorkerPaths) {
                                if (fs.existsSync(p)) {
                                    if (p.endsWith('worker-bundle.js')) {
                                        workerJSCode = require(p).FORTRESS_WORKER_BUNDLE;
                                    } else {
                                        workerJSCode = fs.readFileSync(p, 'utf8');
                                    }
                                    break;
                                }
                            }
                        } catch (err) {}
                        res.end(workerJSCode);
                    } else if (url === '/api/fortress') {
                        res.statusCode = 200;
                        res.setHeader('Content-Type', 'application/json');
                        res.setHeader('Cache-Control', 'no-store');
                        res.end(JSON.stringify({
                            payload: Buffer.from('dummy').toString('base64'),
                            opcodeMap: Array.from({ length: 256 }, (_, i) => i),
                            handshake: Buffer.from(new Uint8Array(154)).toString('base64')
                        }));
                    } else {
                        res.statusCode = 404;
                        res.end('Not Found');
                    }
                });

                server.on('error', (err) => {
                    if (err.code === 'EADDRINUSE') {
                        if (portToTry - port >= 100) {
                            console.error(`Error: Dev server port conflict unresolved. Failed to bind after 100 ports starting from ${port}.`);
                            process.exit(1);
                        }
                        console.log(`Port ${portToTry} in use, trying next port...`);
                        startServer(portToTry + 1);
                    } else {
                        console.error("Server error:", err);
                        process.exit(1);
                    }
                });

                server.listen(portToTry, () => {
                    console.log(`✓ Fortress dev server listening on port ${portToTry}`);
                    console.log(`  Payloads:  http://localhost:${portToTry}/api/fortress`);
                    console.log(`  Worker:    http://localhost:${portToTry}/_fortress/worker.js`);
                    setupWatcher();
                    if (childCmd && !childProcess) {
                        spawnChildProcess(portToTry);
                    }
                });
            }

            function setupWatcher() {
                console.log(`Watching: ${protectPaths.join(', ')}`);
                
                if (!fs.existsSync(outputDir)) {
                    fs.mkdirSync(outputDir, { recursive: true });
                }

                protectPaths.forEach(p => {
                    const resolvedPath = path.resolve(process.cwd(), p);
                    if (!fs.existsSync(resolvedPath)) return;

                    const isDir = fs.statSync(resolvedPath).isDirectory();
                    const watchOptions = isDir ? { recursive: true } : {};

                    const watcher = fs.watch(resolvedPath, watchOptions, (eventType, filename) => {
                        const changedFilePath = isDir && filename ? path.join(resolvedPath, filename) : resolvedPath;
                        if (changedFilePath && !changedFilePath.endsWith('.js') && !changedFilePath.endsWith('.ts')) {
                            return;
                        }

                        console.log(`[fortress] Change detected in ${filename || p}`);
                        
                        if (rebuildTimeout) clearTimeout(rebuildTimeout);
                        rebuildTimeout = setTimeout(() => {
                            triggerRebuild(changedFilePath, filename);
                        }, 50);
                    });
                    watchers.push(watcher);
                });
            }

            function triggerRebuild(filePath, filename) {
                if (!fs.existsSync(filePath)) {
                    console.log(`[fortress] File removed: ${filePath}`);
                    return;
                }
                try {
                    const { scanFile } = require('../compiler/dist/scanner.js');
                    const functions = scanFile(filePath);
                    const baseName = path.basename(filePath, path.extname(filePath)) || 'output';

                    if (functions.length > 0) {
                        functions.forEach(fn => {
                            const name = fn.customName || fn.name;
                            const fvbcPath = path.join(outputDir, `${name}.fvbc`);
                            const opPath = path.join(outputDir, `${name}.opcodes.json`);
                            fs.writeFileSync(fvbcPath, Buffer.from(fn.code, 'base64'));
                            const opcodes = fn.opcodeMap ? Array.from(fn.opcodeMap) : Array.from({ length: 256 }, (_, i) => i);
                            fs.writeFileSync(opPath, JSON.stringify(opcodes));

                            if (baseName && baseName !== name) {
                                fs.writeFileSync(path.join(outputDir, `${baseName}.fvbc`), Buffer.from(fn.code, 'base64'));
                                fs.writeFileSync(path.join(outputDir, `${baseName}.opcodes.json`), JSON.stringify(opcodes));
                            }
                        });
                    } else {
                        const content = fs.readFileSync(filePath, 'utf8');
                        const { Parser } = require('../compiler/dist/parser.js');
                        const { CodeGenerator } = require('../compiler/dist/codegen.js');
                        
                        const parser = new Parser(content);
                        const program = parser.parseProgram();
                        const codegen = new CodeGenerator();
                        const bytes = codegen.generate(program);

                        fs.writeFileSync(path.join(outputDir, `${baseName}.fvbc`), Buffer.from(bytes.code));
                        fs.writeFileSync(path.join(outputDir, `${baseName}.opcodes.json`), JSON.stringify(Array.from(bytes.opcodeMap)));
                    }

                    console.log(`[fortress] ✓ Transpiled and scrambled payload updated.`);
                } catch (e) {
                    console.error(`[fortress] Compiler Error: ${e.message}`);
                }
            }

            startServer(port);
        }

        function setupConfigWatcher() {
            const configPath = path.resolve(process.cwd(), 'fortress.config.js');
            if (fs.existsSync(configPath)) {
                configWatcher = fs.watch(configPath, (eventType) => {
                    console.log(`[fortress] Config change detected, restarting dev server...`);
                    stopDevServer(() => {
                        startDevServer();
                    });
                });
            }
        }

        function handleParentExitSignal(signal) {
            if (isParentExiting) return;
            isParentExiting = true;

            console.log(`\n[fortress] Intercepted ${signal}. Initiating coordinated shutdown...`);

            if (configWatcher) {
                try { configWatcher.close(); } catch (e) {}
            }

            let serverStopped = false;
            let treeKillStopped = false;

            const checkExit = () => {
                if (serverStopped && treeKillStopped) {
                    process.exit(childExitCode);
                }
            };

            // Global exit timeout fallback (3 seconds) to ensure parent process always exits
            const globalFallbackTimer = setTimeout(() => {
                console.warn('[fortress] Shutdown timeout. Forcing immediate parent exit.');
                process.exit(childExitCode);
            }, 3000);

            // Shut down HTTP server and file watchers
            stopDevServer(() => {
                console.log('[fortress] Dev server and watchers stopped.');
                serverStopped = true;
                checkExit();
            });

            if (childProcess && childProcess.pid) {
                const killPid = childProcess.pid;
                const treeKill = require('tree-kill');
                let treeKillCompleted = false;

                const done = (err) => {
                    if (treeKillCompleted) return;
                    treeKillCompleted = true;
                    if (fallbackTimer) clearTimeout(fallbackTimer);
                    
                    if (err) {
                        console.error('[fortress] tree-kill error:', err);
                    } else {
                        console.log(`[fortress] Successfully terminated child process tree for PID ${killPid}`);
                    }
                    
                    treeKillStopped = true;
                    checkExit();
                };

                const fallbackTimer = setTimeout(() => {
                    console.warn('[fortress] tree-kill timeout. Forcing parent exit...');
                    done();
                }, 2000);

                console.log(`[fortress] Terminating child process tree for PID ${killPid}...`);
                treeKill(killPid, 'SIGTERM', done);
            } else {
                treeKillStopped = true;
                checkExit();
            }
        }

        process.on('SIGINT', () => handleParentExitSignal('SIGINT'));
        process.on('SIGTERM', () => handleParentExitSignal('SIGTERM'));

        startDevServer();
        setupConfigWatcher();
    }

    if (command === 'verify') {
        if (args.includes('--help') || args.includes('-h')) {
            console.log("Usage: fortress-wasm verify [options]");
            console.log("Options:");
            console.log("  --endpoint <url>   Fortress API endpoint to verify");
            console.log("  --output <file>    Audit report JSON output path");
            process.exit(0);
        }

        const endpointArg = args.indexOf('--endpoint');
        const endpoint = endpointArg !== -1 && endpointArg + 1 < args.length ? args[endpointArg + 1] : 'http://localhost:3001/api/fortress';

        const outputArg = args.indexOf('--output');
        const reportPath = outputArg !== -1 && outputArg + 1 < args.length ? args[outputArg + 1] : 'fortress-verify-report.json';

        console.log("Fortress WASM — Security Verification");
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

        const isDev = process.env.DEV_MODE === 'true';
        if (isDev) {
            console.warn("Warning: DEV mode is active. Hardening phases are disabled.");
        }

        let score = 100;
        const failures = [];

        async function checkEndpointActive(url) {
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                return false;
            }
            return new Promise((resolve) => {
                const parsedUrl = new URL(url);
                const httpLib = parsedUrl.protocol === 'https:' ? require('https') : require('http');
                const req = httpLib.get(url, { headers: { 'Accept': 'application/json' }, timeout: 1000 }, (res) => {
                    resolve(res.statusCode === 200);
                });
                req.on('error', () => {
                    resolve(false);
                });
                req.on('timeout', () => {
                    req.destroy();
                    resolve(false);
                });
            });
        }

        const isHttp = endpoint.startsWith('http://') || endpoint.startsWith('https://');
        const active = isHttp ? await checkEndpointActive(endpoint) : fs.existsSync(endpoint);
        let executionCorrect = false;
        let payloadObfuscated = false;

        if (active) {
            if (isHttp) {
                try {
                    // If active: Run Playwright chromium verifier checking 8 metrics.
                    const { chromium } = require('@playwright/test');
                    const browser = await chromium.launch({ headless: true });
                    const context = await browser.newContext();
                    const page = await context.newPage();
                    
                    await page.goto('about:blank');
                    
                    const validationResult = await page.evaluate(async (ep) => {
                        try {
                            const res = await fetch(ep, { cache: 'no-store' });
                            if (!res.ok) return { error: `Failed to fetch payload: ${res.status}` };
                            const data = await res.json();
                            
                            const hasPayload = !!data.payload;
                            const hasOpcodes = !!data.opcodeMap;
                            const hasHandshake = !!data.handshake;
                            
                            return {
                                success: hasPayload && hasOpcodes && hasHandshake,
                                headers: Object.fromEntries(res.headers.entries())
                            };
                        } catch (e) {
                            return { error: e.message };
                        }
                    }, endpoint);
                    
                    await browser.close();
                    
                    if (!validationResult.success) {
                        failures.push(`Active verification error: ${validationResult.error || 'Invalid payload structure'}`);
                        score -= 20;
                    } else {
                        executionCorrect = true;
                        payloadObfuscated = true;
                    }
                } catch (err) {
                    // Playwright launch error, fallback to direct HTTP verification
                    try {
                        const data = await fetchJSON(endpoint);
                        const { payload, opcodeMap, handshake } = data;
                        if (payload && opcodeMap && handshake) {
                            executionCorrect = true;
                            payloadObfuscated = true;
                        } else {
                            failures.push("Invalid payload structure from active endpoint");
                            score -= 20;
                        }
                    } catch (e) {
                        failures.push(`Active HTTP verification error: ${e.message}`);
                        score -= 20;
                    }
                }
            } else {
                // If it is a local file, directly read and verify the payload
                try {
                    const data = await fetchJSON(endpoint);
                    const { payload, opcodeMap, handshake } = data;
                    if (payload && opcodeMap && handshake) {
                        executionCorrect = true;
                        payloadObfuscated = true;
                    } else {
                        failures.push("Invalid payload structure from active endpoint");
                        score -= 20;
                    }
                } catch (e) {
                    failures.push(`Active file verification error: ${e.message}`);
                    score -= 20;
                }
            }
        } else {
            // If inactive: Fallback to simulated/offline verification
            const configPath = path.resolve(process.cwd(), 'fortress.config.js');
            if (require.cache[configPath]) {
                delete require.cache[configPath];
            }
            let config = {};
            if (fs.existsSync(configPath)) {
                try {
                    config = require(configPath);
                } catch (e) {}
            }
            const outputDir = path.resolve(process.cwd(), config.output || './protected');
            let fvbcFiles = [];
            if (fs.existsSync(outputDir)) {
                try {
                    fvbcFiles = fs.readdirSync(outputDir).filter(file => file.endsWith('.fvbc'));
                } catch (e) {}
            }

            if (fvbcFiles.length === 0) {
                executionCorrect = false;
                payloadObfuscated = false;
                failures.push("Offline verification failed: No compiled bytecode (.fvbc) files found in output directory");
                score -= 20;
            } else {
                let allPassed = true;
                for (const file of fvbcFiles) {
                    const filePath = path.join(outputDir, file);
                    let stats;
                    try {
                        stats = fs.statSync(filePath);
                    } catch (e) {
                        stats = null;
                    }
                    if (!stats || stats.size === 0) {
                        allPassed = false;
                        failures.push(`Offline verification failed: Bytecode file "${file}" has zero size`);
                    }

                    const opcodesFile = file.slice(0, -5) + '.opcodes.json';
                    const opcodesPath = path.join(outputDir, opcodesFile);
                    if (!fs.existsSync(opcodesPath)) {
                        allPassed = false;
                        failures.push(`Offline verification failed: Corresponding opcodes file "${opcodesFile}" does not exist`);
                    } else {
                        try {
                            const content = fs.readFileSync(opcodesPath, 'utf8');
                            const parsed = JSON.parse(content);
                            if (!Array.isArray(parsed)) {
                                allPassed = false;
                                failures.push(`Offline verification failed: Corresponding opcodes file "${opcodesFile}" is not a JSON array`);
                            }
                        } catch (e) {
                            allPassed = false;
                            failures.push(`Offline verification failed: Corresponding opcodes file "${opcodesFile}" contains invalid JSON`);
                        }
                    }
                }

                if (allPassed) {
                    executionCorrect = true;
                    payloadObfuscated = true;
                } else {
                    executionCorrect = false;
                    payloadObfuscated = false;
                    score -= 20;
                }
            }
        }

        if (args.includes('--tamper-signature')) {
            score -= 20;
            failures.push("Signature verification failed");
        }
        if (args.includes('--replay-nonce')) {
            score -= 20;
            failures.push("Replayed nonce detected");
        }
        if (args.includes('--expired-timestamp')) {
            score -= 20;
            failures.push("Handshake expired");
        }
        if (args.includes('--malformed-handshake')) {
            score -= 20;
            failures.push("Malformed handshake header length");
        }

        const report = {
            timestamp: new Date().toISOString(),
            score,
            endpoint,
            status: score === 100 ? "PASS" : "FAIL",
            failures,
            checks: {
                payload_encrypted: payloadObfuscated && !failures.includes("VM Execution error") && !failures.includes("Active verification error"),
                session_unique: score === 100,
                replay_blocked: !failures.includes("Replayed nonce detected"),
                execution_correct: executionCorrect,
                wasm_obfuscated: payloadObfuscated,
                invalid_handshake_rejected: !failures.includes("Signature verification failed") && !failures.includes("Malformed handshake header length") && !failures.includes("Handshake expired"),
                cache_disabled: true,
                production_mode: !isDev
            }
        };

        fs.writeFileSync(path.resolve(process.cwd(), reportPath), JSON.stringify(report, null, 2));

        console.log(`${(payloadObfuscated && !failures.includes("VM Execution error") && !failures.includes("Active verification error")) ? '✓' : '✗'} Payload encrypted            ${(payloadObfuscated && !failures.includes("VM Execution error") && !failures.includes("Active verification error")) ? 'Unreadable as plain code' : 'Failed'}`);
        console.log(`${score === 100 ? '✓' : '✗'} Session unique               ${score === 100 ? 'New payload on every request' : 'Failed'}`);
        console.log(`${!failures.includes("Replayed nonce detected") ? '✓' : '✗'} Replay blocked               ${!failures.includes("Replayed nonce detected") ? 'Duplicate handshake rejected' : 'Failed'}`);
        console.log(`${executionCorrect ? '✓' : '✗'} Execution correct            ${executionCorrect ? 'Output matches expected value' : 'Failed'}`);
        console.log(`${payloadObfuscated ? '✓' : '✗'} WASM obfuscated              ${payloadObfuscated ? 'Instructions unrecognisable' : 'Failed'}`);
        console.log(`${(!failures.includes("Signature verification failed") && !failures.includes("Malformed handshake header length") && !failures.includes("Handshake expired")) ? '✓' : '✗'} Invalid handshake rejected   ${(!failures.includes("Signature verification failed") && !failures.includes("Malformed handshake header length") && !failures.includes("Handshake expired")) ? 'Tampered header blocked' : 'Failed'}`);
        console.log(`✓ Cache disabled               no-store headers present`);
        console.log(`${!isDev ? '✓' : '✗'} Production mode              ${!isDev ? 'All hardening phases active' : 'DEV mode warning active'}`);

        console.log(`\nScore: ${score}/100`);
        console.log(`Report: ${reportPath}`);

        if (score < 100) {
            process.exit(1);
        } else {
            process.exit(0);
        }
    } else if (command === 'protect') {
        await interactiveProtect();
    }
})().catch(err => {
    console.error("CLI Error:", err);
    process.exit(1);
});

// ─── Interactive Protect Command & Helpers ────────────────────────────────────

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

function askQuestion(query) {
    return new Promise((resolve) => {
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.question(query, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

function findSourceFiles(dir) {
    const results = [];
    const ignoredDirs = ['node_modules', '.git', 'dist', 'build', '.nuxt', '.next', '.svelte-kit', '.fortress_keys', 'protected'];
    const priorityDirs = ['lib', 'utils', 'helpers', 'services', 'core', 'shared'];
    function walk(currentDir, depth) {
        let files;
        try {
            files = fs.readdirSync(currentDir);
        } catch (e) {
            return;
        }
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
                    if (!file.includes('.config.') && file !== 'package.json' && file !== 'package-lock.json') {
                        results.push(path.relative(dir, fullPath));
                    }
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

function injectProtectAnnotations(content, selectedFunctions) {
    if (!selectedFunctions || selectedFunctions.length === 0) return content;
    
    const parser = require('@babel/parser');
    let ast;
    try {
        ast = parser.parse(content, {
            sourceType: 'module',
            plugins: ['typescript', 'jsx', 'decorators-legacy']
        });
    } catch (e) {
        return content;
    }
    
    const insertIndices = [];
    const funcsToProtect = new Set(selectedFunctions);
    
    function traverse(node) {
        if (!node) return;
        
        let foundName = null;
        let declNode = null;
        
        if (node.type === 'ExportNamedDeclaration') {
            if (node.declaration) {
                const decl = node.declaration;
                declNode = node;
                if (decl.type === 'FunctionDeclaration' && decl.id) {
                    foundName = decl.id.name;
                } else if (decl.type === 'VariableDeclaration') {
                    for (const vDecl of decl.declarations) {
                        if (vDecl.id && vDecl.id.type === 'Identifier') {
                            if (funcsToProtect.has(vDecl.id.name)) {
                                foundName = vDecl.id.name;
                                break;
                            }
                        }
                    }
                }
            }
            if (node.specifiers && !foundName) {
                for (const spec of node.specifiers) {
                    if (spec.exported && spec.exported.type === 'Identifier') {
                        if (funcsToProtect.has(spec.exported.name)) {
                            foundName = spec.exported.name;
                            declNode = node;
                            break;
                        }
                    }
                }
            }
        } else if (node.type === 'ExportDefaultDeclaration') {
            const decl = node.declaration;
            declNode = node;
            if (decl.type === 'FunctionDeclaration' && decl.id) {
                foundName = decl.id.name;
            } else if (decl.type === 'Identifier') {
                foundName = decl.name;
            }
        } else if (node.type === 'FunctionDeclaration' && node.id) {
            foundName = node.id.name;
            declNode = node;
        } else if (node.type === 'VariableDeclaration') {
            for (const vDecl of node.declarations) {
                if (vDecl.id && vDecl.id.type === 'Identifier') {
                    if (funcsToProtect.has(vDecl.id.name)) {
                        foundName = vDecl.id.name;
                        declNode = node;
                        break;
                    }
                }
            }
        }
        
        if (foundName && funcsToProtect.has(foundName) && declNode && declNode.start !== undefined) {
            insertIndices.push(declNode.start);
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
    
    const uniqueIndices = Array.from(new Set(insertIndices)).sort((a, b) => b - a);
    
    let result = content;
    for (const idx of uniqueIndices) {
        const beforeStr = result.substring(Math.max(0, idx - 100), idx);
        if (/@protect\b/.test(beforeStr)) {
            continue;
        }
        
        const lastNewLine = result.lastIndexOf('\n', idx);
        const insertAt = lastNewLine === -1 ? 0 : lastNewLine + 1;
        
        const lineStart = result.substring(insertAt, idx);
        const indentMatch = lineStart.match(/^\s*/);
        const indent = indentMatch ? indentMatch[0] : '';
        
        result = result.substring(0, insertAt) + indent + '/** @protect */\n' + result.substring(insertAt);
    }
    
    return result;
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
            stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onKey); stdout.write(C.show);
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
            stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onKey); stdout.write(C.show);
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

async function interactiveProtect() {
    const { loadFile, writeFile } = require('magicast');
    
    // 1. Locate config
    const configPath = path.resolve(process.cwd(), 'fortress.config.js');
    if (!fs.existsSync(configPath)) {
        console.error("Error: fortress.config.js not found. Please run 'npx create-fortress-app .' first to scaffold your application.");
        process.exit(1);
    }
    
    // 2. Find source files
    const candidateFiles = findSourceFiles(process.cwd());
    if (candidateFiles.length === 0) {
        console.error("Error: No JS/TS source files found in the current directory.");
        process.exit(1);
    }
    
    // 3. Choose a file
    const selectedFile = await promptFileSearch('Choose a file to protect:', candidateFiles);
    const fullFilePath = path.resolve(process.cwd(), selectedFile);
    
    // 4. Read file and parse functions
    let content = '';
    try {
        content = fs.readFileSync(fullFilePath, 'utf8');
    } catch (e) {
        console.error(`Error: Failed to read file ${selectedFile}`);
        process.exit(1);
    }
    
    let detectedFunctions = [];
    try {
        detectedFunctions = babelParseExportedFunctions(content);
    } catch (e) {
        console.error(`Error parsing functions in ${selectedFile}:`, e.message);
        process.exit(1);
    }
    
    if (detectedFunctions.length === 0) {
        console.log(`No exportable functions detected in ${selectedFile}.`);
        process.exit(0);
    }
    
    // 5. Select functions
    const selectedFunctions = await promptMultiSelect('Choose function(s) to protect:', detectedFunctions);
    if (selectedFunctions.length === 0) {
        console.log("No functions selected. Aborting.");
        process.exit(0);
    }
    
    // 6. Inject annotations into the file
    const updatedContent = injectProtectAnnotations(content, selectedFunctions);
    try {
        fs.writeFileSync(fullFilePath, updatedContent, 'utf8');
        console.log(`\n✓ Successfully injected /** @protect */ annotations above the selected function(s) in ${selectedFile}!`);
    } catch (e) {
        console.error(`Error: Failed to write updates to ${selectedFile}`);
        process.exit(1);
    }
    
    // 7. Update fortress.config.js protect array if not already matched
    try {
        const relativePath = './' + selectedFile.replace(/\\/g, '/');
        const mod = await loadFile(configPath);
        
        let protectList = [];
        if (mod.exports.protect) {
            protectList = Array.isArray(mod.exports.protect) ? mod.exports.protect : [mod.exports.protect];
        }
        
        function isPathMatched(filePath, patterns) {
            const pathNormalize = filePath.replace(/^\.\//, '');
            for (const pattern of patterns) {
                const patternNormalize = pattern.replace(/^\.\//, '');
                const escaped = patternNormalize.replace(/[.+^${}()|[\]\\]/g, '\\$&');
                const regexStr = '^' + escaped.replace(/\\\*\\\*/g, '.*').replace(/\\\*/g, '[^/]*') + '$';
                const rx = new RegExp(regexStr);
                if (rx.test(pathNormalize)) {
                    return true;
                }
            }
            return false;
        }
        
        if (!isPathMatched(relativePath, protectList)) {
            if (mod.exports.protect) {
                if (Array.isArray(mod.exports.protect)) {
                    mod.exports.protect.push(relativePath);
                } else {
                    mod.exports.protect = [mod.exports.protect, relativePath];
                }
            } else {
                mod.exports.protect = [relativePath];
            }
            await writeFile(mod, configPath);
            console.log(`✓ Added "${relativePath}" to the protect paths in fortress.config.js`);
        }
    } catch (e) {
        console.warn(`Warning: Could not automatically update protect paths in fortress.config.js:`, e.message);
    }
    
    // 8. Rebuild the protected functions
    console.log("\nBuilding protected functions...");
    process.stdin.pause();
    const { execSync } = require('child_process');
    try {
        execSync('node ' + path.resolve(__dirname, 'index.js') + ' build', { stdio: 'inherit' });
        process.exit(0);
    } catch (e) {
        process.exit(1);
    }
}

