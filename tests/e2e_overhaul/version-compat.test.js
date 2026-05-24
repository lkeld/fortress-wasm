const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const { runTestSuite } = require('./runner');

const compatibility = require('../../packages/create-fortress-app/compatibility');

const TEMP_BASE_DIR = path.join(os.tmpdir(), `fortress_compat_tests_${crypto.randomBytes(4).toString('hex')}`);

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

// Interactive spawn helper for CLI tests
async function spawnInteractiveProcess(args, promptResponses) {
    const { spawn } = require('child_process');
    const cliPath = path.resolve(__dirname, '../../packages/create-fortress-app/bin/index.js');
    const child = spawn('node', [cliPath, ...args], {
        env: {
            ...process.env,
            FORTRESS_CLI_INTERACTIVE: 'true'
        }
    });

    let stdout = '';
    let stderr = '';
    let lastMatchIndex = 0;
    const queue = [...promptResponses];

    child.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        
        if (queue.length > 0) {
            const next = queue[0];
            const searchArea = stdout.slice(lastMatchIndex);
            if (searchArea.includes(next.prompt)) {
                lastMatchIndex = stdout.length;
                queue.shift();
                if (child.stdin.writable) {
                    child.stdin.write(next.response + '\n');
                }
                if (queue.length === 0) {
                    child.stdin.end();
                }
            }
        }
    });

    child.stderr.on('data', (data) => {
        stderr += data.toString();
    });

    const timeout = setTimeout(() => {
        child.kill('SIGKILL');
    }, 10000); // 10s timeout
    
    return new Promise((resolve) => {
        child.on('close', (code) => {
            clearTimeout(timeout);
            resolve({ code, stdout, stderr });
        });
    });
}

// Ensure base dir exists
fs.mkdirSync(TEMP_BASE_DIR, { recursive: true });

runTestSuite('M1: Framework Version Detection & Compatibility rules', {
    'SemVer Parser - parses basic and prerelease semver correctly': async () => {
        const v1 = compatibility.parseSemver('1.2.3');
        assert.deepStrictEqual(v1, { major: 1, minor: 2, patch: 3, prerelease: '' });

        const v2 = compatibility.parseSemver('v15.0.0-rc.1');
        assert.deepStrictEqual(v2, { major: 15, minor: 0, patch: 0, prerelease: 'rc.1' });

        const v3 = compatibility.parseSemver('  =0.2.14  ');
        assert.deepStrictEqual(v3, { major: 0, minor: 2, patch: 14, prerelease: '' });
    },

    'SemVer Comparer - compares versions correctly': async () => {
        assert.ok(compatibility.compareSemver('1.2.3', '2.0.0') < 0);
        assert.ok(compatibility.compareSemver('15.0.0', '13.4.2') > 0);
        assert.strictEqual(compatibility.compareSemver('2.1.0', '2.1.0'), 0);
        assert.ok(compatibility.compareSemver('1.0.0-alpha', '1.0.0') < 0);
        assert.ok(compatibility.compareSemver('1.0.0-beta', '1.0.0-alpha') > 0);
    },

    'SemVer Satisfies - evaluates constraints accurately': async () => {
        // caret
        assert.strictEqual(compatibility.satisfies('15.0.1', '^15.0.0'), true);
        assert.strictEqual(compatibility.satisfies('16.0.0', '^15.0.0'), false);
        assert.strictEqual(compatibility.satisfies('0.2.4', '^0.2.0'), true);
        assert.strictEqual(compatibility.satisfies('0.3.0', '^0.2.0'), false);
        
        // tilde
        assert.strictEqual(compatibility.satisfies('14.2.3', '~14.2.0'), true);
        assert.strictEqual(compatibility.satisfies('14.3.0', '~14.2.0'), false);
        
        // operators
        assert.strictEqual(compatibility.satisfies('12.0.0', '>=12.0.0 <13.0.0'), true);
        assert.strictEqual(compatibility.satisfies('13.0.0', '>=12.0.0 <13.0.0'), false);
        assert.strictEqual(compatibility.satisfies('15.1.0', '=15.1.0'), true);
        assert.strictEqual(compatibility.satisfies('15.1.0', '15.1.0'), true);
        
        // wildcards
        assert.strictEqual(compatibility.satisfies('15.2.3', '15.x'), true);
        assert.strictEqual(compatibility.satisfies('15.2.3', '15.*.x'), true);
        assert.strictEqual(compatibility.satisfies('16.0.0', '15.x'), false);
        
        // logical OR
        assert.strictEqual(compatibility.satisfies('16.0.0', '^15.0.0 || ^16.0.0'), true);
    },

    'Resolution Fallback - parses and cleans range in package.json dependencies': async () => {
        const dir = getTempDir();
        const pkg = {
            dependencies: {
                next: '^14.2.3-canary.1'
            }
        };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));

        const compat = compatibility.resolveFrameworkCompatibility(dir, 'next');
        assert.strictEqual(compat.version, '14.2.3-canary.1');
        assert.strictEqual(compat.source, 'package.json');
    },

    'Node Modules Resolution - prioritizes installed package version in node_modules': async () => {
        const dir = getTempDir();
        const pkg = {
            dependencies: {
                next: '^13.0.0'
            }
        };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
        
        // mock node_modules/next/package.json
        const nextNodeModulesDir = path.join(dir, 'node_modules/next');
        fs.mkdirSync(nextNodeModulesDir, { recursive: true });
        fs.writeFileSync(
            path.join(nextNodeModulesDir, 'package.json'),
            JSON.stringify({ version: '14.1.0' })
        );

        const compat = compatibility.resolveFrameworkCompatibility(dir, 'next');
        assert.strictEqual(compat.version, '14.1.0');
        assert.strictEqual(compat.source, 'node_modules');
    },

    'Monorepo Traversal Resolution - traverses to parent node_modules for hoisted dependencies': async () => {
        const parentDir = getTempDir();
        const appDir = path.join(parentDir, 'packages/my-app');
        fs.mkdirSync(appDir, { recursive: true });

        // mock root node_modules/next/package.json
        const rootNextDir = path.join(parentDir, 'node_modules/next');
        fs.mkdirSync(rootNextDir, { recursive: true });
        fs.writeFileSync(
            path.join(rootNextDir, 'package.json'),
            JSON.stringify({ version: '15.0.2-canary.0' })
        );

        const appPkg = {
            dependencies: {
                next: '^13.0.0'
            }
        };
        fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(appPkg));

        const compat = compatibility.resolveFrameworkCompatibility(appDir, 'next');
        assert.strictEqual(compat.version, '15.0.2-canary.0');
        assert.strictEqual(compat.source, 'node_modules');
    },

    'Next.js 12 Compatibility - resolves to Pages router (no App router folder)': async () => {
        const dir = getTempDir();
        const pkg = {
            dependencies: {
                next: '^12.3.4'
            }
        };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));

        const compat = compatibility.resolveFrameworkCompatibility(dir, 'next');
        assert.strictEqual(compat.features.useAppRouter, false);
    },

    'Next.js 15 App Router Compatibility - resolves to App router if app folder exists': async () => {
        const dir = getTempDir();
        const pkg = {
            dependencies: {
                next: '^15.0.0'
            }
        };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
        fs.mkdirSync(path.join(dir, 'app'), { recursive: true });

        const compat = compatibility.resolveFrameworkCompatibility(dir, 'next');
        assert.strictEqual(compat.features.useAppRouter, true);
        assert.strictEqual(compat.features.segmentConfig, true);
    },

    'Next.js 15 Pages Router Compatibility - resolves to Pages router if app folder is missing': async () => {
        const dir = getTempDir();
        const pkg = {
            dependencies: {
                next: '^15.0.0'
            }
        };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));

        const compat = compatibility.resolveFrameworkCompatibility(dir, 'next');
        assert.strictEqual(compat.features.useAppRouter, false);
    },

    'Remix v2 Compatibility - resolves to Remix v2 (reactRouter7 false)': async () => {
        const dir = getTempDir();
        const pkg = {
            dependencies: {
                '@remix-run/react': '^2.4.1'
            }
        };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));

        const compat = compatibility.resolveFrameworkCompatibility(dir, 'remix');
        assert.strictEqual(compat.features.reactRouter7, false);
    },

    'React Router v7 Compatibility - resolves to React Router 7 (reactRouter7 true)': async () => {
        const dir = getTempDir();
        const pkg = {
            dependencies: {
                'react-router': '^7.0.2'
            }
        };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));

        const compat = compatibility.resolveFrameworkCompatibility(dir, 'remix');
        assert.strictEqual(compat.features.reactRouter7, true);
        assert.strictEqual(compat.resolvedPackage, 'react-router');
    },

    'Astro v5 Compatibility - resolves to Astro v5': async () => {
        const dir = getTempDir();
        const pkg = {
            dependencies: {
                'astro': '^5.0.1'
            }
        };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));

        const compat = compatibility.resolveFrameworkCompatibility(dir, 'astro');
        assert.strictEqual(compat.features.astroV5, true);
    },

    'SvelteKit v2 Compatibility - resolves to SvelteKit v2': async () => {
        const dir = getTempDir();
        const pkg = {
            dependencies: {
                '@sveltejs/kit': '^2.0.0'
            }
        };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));

        const compat = compatibility.resolveFrameworkCompatibility(dir, 'sveltekit');
        assert.strictEqual(compat.features.sveltekitV2, true);
    },

    'Angular 15 Compatibility - resolves standalone to false': async () => {
        const dir = getTempDir();
        const pkg = {
            dependencies: {
                '@angular/core': '^15.2.0'
            }
        };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));

        const compat = compatibility.resolveFrameworkCompatibility(dir, 'angular');
        assert.strictEqual(compat.features.standalone, false);
    },

    'Angular 17 Compatibility - resolves standalone to true': async () => {
        const dir = getTempDir();
        const pkg = {
            dependencies: {
                '@angular/core': '^17.0.3'
            }
        };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));

        const compat = compatibility.resolveFrameworkCompatibility(dir, 'angular');
        assert.strictEqual(compat.features.standalone, true);
        
        cleanupDirs();
    },

    'Sibling Traversal Safety - prevents sibling directory traversal for protected output directory': async () => {
        const baseDir = getTempDir();
        const relSibling = '../' + path.basename(baseDir) + '_sibling';
        
        const promptResponses = [
            { prompt: 'Confirm this framework?', response: 'y' },
            { prompt: 'Enter custom file path to protect:', response: 'index.js' },
            { prompt: 'File does not exist or empty. Enter custom function name to protect:', response: 'run' },
            { prompt: 'Enter signing password (min 12 chars):', response: 'securepassword123' },
            { prompt: 'Confirm signing password:', response: 'securepassword123' },
            { prompt: 'Confirm API endpoint', response: '/api/fortress' },
            { prompt: 'Confirm output directory', response: relSibling }
        ];
        
        const result = await spawnInteractiveProcess([baseDir], promptResponses);
        
        assert.strictEqual(result.code, 1);
        assert.ok(result.stderr.includes('Directory traversal detected. Protected directory must be inside the target directory.'));
        cleanupDirs();
    },
    
    'Sibling Traversal Safety - prevents sibling directory traversal for protected file path': async () => {
        const baseDir = getTempDir();
        const relSiblingFile = '../' + path.basename(baseDir) + '_sibling/index.js';
        
        const promptResponses = [
            { prompt: 'Confirm this framework?', response: 'y' },
            { prompt: 'Enter custom file path to protect:', response: relSiblingFile }
        ];
        
        const result = await spawnInteractiveProcess([baseDir], promptResponses);
        
        assert.strictEqual(result.code, 1);
        assert.ok(result.stderr.includes('Directory traversal detected. Protected file path must be inside the target directory.'));
        cleanupDirs();
    },

    'Next.js 0.0.0 Fallback Compatibility - resolves to App router if app folder exists and version is fallback 0.0.0': async () => {
        const dir = getTempDir();
        const pkg = { dependencies: {} };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
        fs.mkdirSync(path.join(dir, 'app'), { recursive: true });

        const compat = compatibility.resolveFrameworkCompatibility(dir, 'next');
        assert.strictEqual(compat.version, '0.0.0');
        assert.strictEqual(compat.features.useAppRouter, true);
        assert.strictEqual(compat.features.segmentConfig, true);
        cleanupDirs();
    },

    'Next.js 0.0.0 Fallback Compatibility - resolves to App router if src/app folder exists and version is fallback 0.0.0': async () => {
        const dir = getTempDir();
        const pkg = { dependencies: {} };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
        fs.mkdirSync(path.join(dir, 'src/app'), { recursive: true });

        const compat = compatibility.resolveFrameworkCompatibility(dir, 'next');
        assert.strictEqual(compat.version, '0.0.0');
        assert.strictEqual(compat.features.useAppRouter, true);
        assert.strictEqual(compat.features.segmentConfig, true);
        cleanupDirs();
    },

    'Remix v6 / React Router v6 Compatibility - resolves reactRouter7 to false for legacy react-router package version 6': async () => {
        const dir = getTempDir();
        const pkg = {
            dependencies: {
                'react-router': '^6.22.0'
            }
        };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));

        const compat = compatibility.resolveFrameworkCompatibility(dir, 'remix');
        assert.strictEqual(compat.features.reactRouter7, false);
        cleanupDirs();
    },
    
    'React Router v7 Compatibility - resolves reactRouter7 to true for react-router package version 7': async () => {
        const dir = getTempDir();
        const pkg = {
            dependencies: {
                'react-router': '^7.0.0-rc.2'
            }
        };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));

        const compat = compatibility.resolveFrameworkCompatibility(dir, 'remix');
        assert.strictEqual(compat.features.reactRouter7, true);
        cleanupDirs();
    },

    'SemVer Comparer - handles dot-separated prerelease segments and build metadata correctly': async () => {
        assert.ok(compatibility.compareSemver('1.0.0-rc.10', '1.0.0-rc.2') > 0);
        assert.ok(compatibility.compareSemver('1.0.0-rc.2', '1.0.0-rc.10') < 0);
        
        assert.ok(compatibility.compareSemver('1.0.0-rc.2.1', '1.0.0-rc.2') > 0);
        assert.ok(compatibility.compareSemver('1.0.0-rc.2', '1.0.0-rc.2.1') < 0);
        
        assert.ok(compatibility.compareSemver('1.0.0-rc.1', '1.0.0-rc.alpha') < 0);
        assert.ok(compatibility.compareSemver('1.0.0-rc.alpha', '1.0.0-rc.1') > 0);
        
        assert.ok(compatibility.compareSemver('1.0.0-rc.beta', '1.0.0-rc.alpha') > 0);
        
        assert.strictEqual(compatibility.compareSemver('1.0.0-rc.10+build.123', '1.0.0-rc.10'), 0);
        assert.ok(compatibility.compareSemver('1.0.0-rc.10+build.123', '1.0.0-rc.2+other') > 0);
        assert.strictEqual(compatibility.compareSemver('1.0.0+build.abc', '1.0.0'), 0);
        cleanupDirs();
    },

    'React Router v7 Compatibility - resolves reactRouter7 to true for @react-router/react package version 7': async () => {
        const dir = getTempDir();
        const pkg = {
            dependencies: {
                '@react-router/react': '^7.0.0-rc.3'
            }
        };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));

        const compat = compatibility.resolveFrameworkCompatibility(dir, 'remix');
        assert.strictEqual(compat.features.reactRouter7, true);
        cleanupDirs();
    },

    'SemVer Comparer - handles multiple hyphens and complex prerelease formats': async () => {
        assert.ok(compatibility.compareSemver('1.0.0-alpha.1-beta', '1.0.0-alpha.1') > 0);
        assert.ok(compatibility.compareSemver('1.0.0-rc.10.beta', '1.0.0-rc.2.beta') > 0);
    }
});
