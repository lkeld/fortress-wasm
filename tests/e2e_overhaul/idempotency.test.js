const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const { runTestSuite, spawnProcess, assertExitCode } = require('./runner');

const createStubPath = path.join(__dirname, '../../packages/create-fortress-app/bin/index.js');
const TEMP_BASE_DIR = path.join(os.tmpdir(), `fortress_idempotency_tests_${crypto.randomBytes(4).toString('hex')}`);

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

fs.mkdirSync(TEMP_BASE_DIR, { recursive: true });

const tests = {
    'Idempotency - Running CLI twice does not duplicate imports, CSP, or CI steps': async () => {
        const dir = getTempDir();
        fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
        
        // Seed Next.js App Router files
        const appLayout = path.join(dir, 'app/layout.tsx');
        fs.mkdirSync(path.dirname(appLayout), { recursive: true });
        fs.writeFileSync(appLayout, 'export default function RootLayout({ children }) { return <html><body>{children}</body></html>; }');

        const nextConfig = path.join(dir, 'next.config.js');
        fs.writeFileSync(nextConfig, 'module.exports = {};');

        const pkg = {
            name: "test-app",
            dependencies: { next: "^14.0.0" },
            scripts: { "build": "next build" }
        };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));

        // Seed CI workflow file
        const workflowFile = path.join(dir, '.github/workflows/deploy.yml');
        fs.mkdirSync(path.dirname(workflowFile), { recursive: true });
        fs.writeFileSync(workflowFile, `name: CI\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci\n      - run: npm run build\n`);

        // First run
        const result1 = await spawnProcess('node', [createStubPath, dir, '--password', 'securepassword123']);
        assertExitCode(result1, 0);

        // Read files after first run
        const layoutContent1 = fs.readFileSync(appLayout, 'utf8');
        const configContent1 = fs.readFileSync(nextConfig, 'utf8');
        const workflowContent1 = fs.readFileSync(workflowFile, 'utf8');
        const pkgContent1 = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
        const gitattributesContent1 = fs.readFileSync(path.join(dir, '.gitattributes'), 'utf8');
        const preCommitContent1 = fs.readFileSync(path.join(dir, '.husky/pre-commit'), 'utf8');

        // Delete configPath and protected/ to allow the CLI to run again
        fs.unlinkSync(path.join(dir, 'fortress.config.js'));
        fs.rmSync(path.join(dir, 'protected'), { recursive: true, force: true });

        // Second run
        const result2 = await spawnProcess('node', [createStubPath, dir, '--password', 'securepassword123']);
        assertExitCode(result2, 0);

        // Read files after second run
        const layoutContent2 = fs.readFileSync(appLayout, 'utf8');
        const configContent2 = fs.readFileSync(nextConfig, 'utf8');
        const workflowContent2 = fs.readFileSync(workflowFile, 'utf8');
        const pkgContent2 = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
        const gitattributesContent2 = fs.readFileSync(path.join(dir, '.gitattributes'), 'utf8');
        const preCommitContent2 = fs.readFileSync(path.join(dir, '.husky/pre-commit'), 'utf8');

        // Helper count functions
        const countOccurrences = (str, sub) => str.split(sub).length - 1;

        // Verify no duplicates were created
        assert.strictEqual(countOccurrences(layoutContent2, 'useFortress'), 3, 'Should only contain one useFortress import/initialization');
        assert.strictEqual(countOccurrences(layoutContent2, 'fortress-wasm-start'), 2, 'Should only contain one fortress-wasm-start layout sentinel');
        assert.strictEqual(layoutContent2, layoutContent1, 'Layout file should be identical after second run');

        assert.strictEqual(countOccurrences(configContent2, "worker-src 'self' blob:;"), 1, 'Should only contain one CSP header policy entry');
        assert.strictEqual(configContent2, configContent1, 'Config file should be identical after second run');

        assert.strictEqual(countOccurrences(workflowContent2, 'npx fortress build'), 1, 'Should only contain one fortress build step in workflow');
        assert.strictEqual(workflowContent2, workflowContent1, 'Workflow file should be identical after second run');

        const pkgUpdated = JSON.parse(pkgContent2);
        assert.strictEqual(pkgUpdated.scripts.build, 'fortress build && next build', 'Build script should not prepend fortress build twice');
        assert.strictEqual(pkgContent2, pkgContent1, 'package.json should be identical after second run');
        
        assert.strictEqual(gitattributesContent2, gitattributesContent1, 'Gitattributes file should be identical after second run');
        assert.strictEqual(preCommitContent2, preCommitContent1, 'Pre-commit hook file should be identical after second run');
    }
};

runTestSuite('F1.4 & F1.5: Idempotency E2E Overhaul Test Suite', tests)
    .then(() => cleanupDirs())
    .catch(() => cleanupDirs());
