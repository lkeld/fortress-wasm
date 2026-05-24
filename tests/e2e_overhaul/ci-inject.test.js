const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const assert = require('assert');
const { runTestSuite, spawnProcess, assertExitCode } = require('./runner');

const createStubPath = path.join(__dirname, '../../packages/create-fortress-app/bin/index.js');
const TEMP_BASE_DIR = path.join(os.tmpdir(), `fortress_ci_inject_tests_${crypto.randomBytes(4).toString('hex')}`);

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
    'CI/CD Auto-Detection - GitHub Actions workflow step injection': async () => {
        const dir = getTempDir();
        
        // Seed GitHub Action file
        const workflowDir = path.join(dir, '.github/workflows');
        fs.mkdirSync(workflowDir, { recursive: true });
        
        const workflowContent = `name: Node.js CI
on:
  push:
    branches: [ "main" ]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v4
    - name: Use Node.js
      uses: actions/setup-node@v4
      with:
        node-version: 20.x
    - run: npm ci
    - run: npm run build
`;
        fs.writeFileSync(path.join(workflowDir, 'deploy.yml'), workflowContent);
        
        // Run scaffolding with a framework that would set up config
        const result = await spawnProcess('node', [createStubPath, dir, '--framework', 'next', '--password', 'securepassword123']);
        assertExitCode(result, 0);

        const updatedFile = path.join(workflowDir, 'deploy.yml');
        assert.ok(fs.existsSync(updatedFile), 'GitHub Actions workflow file must exist');
        const content = fs.readFileSync(updatedFile, 'utf8');

        // Check for step injection
        assert.ok(content.includes('fortress-wasm-start') || content.includes('npx fortress build'), 'Should inject fortress build step');
        assert.ok(content.includes('FORTRESS_SIGNING_PASSWORD'), 'Should inject env secrets reference');

        // Assert order: fortress build must come BEFORE framework build
        const fortressIdx = content.indexOf('fortress build');
        const buildIdx = content.indexOf('npm run build');
        assert.ok(fortressIdx !== -1 && buildIdx !== -1 && fortressIdx < buildIdx, 'Fortress build step must be injected before build command');

        // Assert no steps are deleted/removed (e.g. actions/checkout@v4 still exists)
        assert.ok(content.includes('actions/checkout@v4'), 'Checkout step should be preserved');
        assert.ok(content.includes('actions/setup-node@v4'), 'Setup Node step should be preserved');
    },

    'CI/CD Auto-Detection - GitLab CI job injection': async () => {
        const dir = getTempDir();
        
        // Seed GitLab CI config
        const gitlabContent = `stages:
  - install
  - build
  - test

install_dependencies:
  stage: install
  script:
    - npm ci

build_job:
  stage: build
  script:
    - npm run build
`;
        fs.writeFileSync(path.join(dir, '.gitlab-ci.yml'), gitlabContent);

        const result = await spawnProcess('node', [createStubPath, dir, '--framework', 'next', '--password', 'securepassword123']);
        assertExitCode(result, 0);

        const updatedFile = path.join(dir, '.gitlab-ci.yml');
        assert.ok(fs.existsSync(updatedFile));
        const content = fs.readFileSync(updatedFile, 'utf8');

        // Check for job injection
        assert.ok(content.includes('fortress-build') || content.includes('npx fortress build'), 'Should inject fortress-build job');
        assert.ok(content.includes('FORTRESS_SIGNING_PASSWORD'), 'Should define password variable');

        // Assert existing jobs remain intact
        assert.ok(content.includes('build_job:'), 'Existing build job should remain');
        assert.ok(content.includes('install_dependencies:'), 'Existing install job should remain');
    },

    'CI/CD Auto-Detection - CircleCI step injection': async () => {
        const dir = getTempDir();
        
        // Seed CircleCI config with yaml extension to test both extensions
        const circleDir = path.join(dir, '.circleci');
        fs.mkdirSync(circleDir, { recursive: true });
        
        const circleContent = `version: 2.1
jobs:
  build:
    docker:
      - image: cimg/node:20.0
    steps:
      - checkout
      - run: npm ci
      - run:
          name: Build application
          command: npm run build
`;
        fs.writeFileSync(path.join(circleDir, 'config.yaml'), circleContent);

        const result = await spawnProcess('node', [createStubPath, dir, '--framework', 'next', '--password', 'securepassword123']);
        assertExitCode(result, 0);

        const updatedFile = path.join(circleDir, 'config.yaml');
        assert.ok(fs.existsSync(updatedFile));
        const content = fs.readFileSync(updatedFile, 'utf8');

        // Check for step injection
        assert.ok(content.includes('npx fortress build'), 'Should inject fortress build step');

        // Assert order and that the new step is inserted at the step boundary (before the matched step, not inside it)
        const fortressIdx = content.indexOf('fortress build');
        const runNameIdx = content.indexOf('name: Build application');
        assert.ok(fortressIdx !== -1 && runNameIdx !== -1 && fortressIdx < runNameIdx, 'Fortress build step must be injected before build command step');
        // Ensure the step is not inside the build step block
        assert.ok(!content.includes('command: npx fortress build && npm run build'), 'Should splice step instead of prepending to command');
    },

    'CI/CD Auto-Detection - Netlify configuration injection': async () => {
        // Scenario 1: Prepending skipped if package.json has already been updated
        const dir1 = getTempDir();
        const pkg = {
            name: "test-app",
            scripts: {
                "build": "next build"
            }
        };
        fs.writeFileSync(path.join(dir1, 'package.json'), JSON.stringify(pkg, null, 2));

        const netlifyContent1 = `[build]
  command = "npm run 'build:prod'"
  publish = "dist"
`;
        fs.writeFileSync(path.join(dir1, 'netlify.toml'), netlifyContent1);

        const result1 = await spawnProcess('node', [createStubPath, dir1, '--framework', 'next', '--password', 'securepassword123']);
        assertExitCode(result1, 0);

        const updatedFile1 = path.join(dir1, 'netlify.toml');
        assert.ok(fs.existsSync(updatedFile1));
        const content1 = fs.readFileSync(updatedFile1, 'utf8');
        assert.ok(!content1.includes('fortress build'), 'Should skip prepending Netlify command if package.json has already been updated');

        // Scenario 2: Test with non-delegated build command
        const dir2 = getTempDir();
        fs.writeFileSync(path.join(dir2, 'package.json'), '{}');
        const netlifyContent2 = `[build]
  command = "next build"
  publish = "dist"
`;
        fs.writeFileSync(path.join(dir2, 'netlify.toml'), netlifyContent2);

        const result2 = await spawnProcess('node', [createStubPath, dir2, '--framework', 'next', '--password', 'securepassword123']);
        assertExitCode(result2, 0);

        const updatedFile2 = path.join(dir2, 'netlify.toml');
        assert.ok(fs.existsSync(updatedFile2));
        const content2 = fs.readFileSync(updatedFile2, 'utf8');
        assert.ok(content2.includes('npx fortress build && next build'), 'Should prepend to non-delegating command');

        // Scenario 3: Test default inject when no command is present
        const dir3 = getTempDir();
        const netlifyContent3 = `[build]
  publish = "dist"
`;
        fs.writeFileSync(path.join(dir3, 'netlify.toml'), netlifyContent3);

        const result3 = await spawnProcess('node', [createStubPath, dir3, '--framework', 'next', '--password', 'securepassword123']);
        assertExitCode(result3, 0);

        const updatedFile3 = path.join(dir3, 'netlify.toml');
        assert.ok(fs.existsSync(updatedFile3));
        const content3 = fs.readFileSync(updatedFile3, 'utf8');
        assert.ok(content3.includes('command = "npx fortress build && npm run build"'), 'Should inject default command under [build]');
    },

    'CI/CD Auto-Detection - Vercel script prepending in package.json and vercel.json': async () => {
        const dir = getTempDir();
        
        // Seed package.json and vercel.json
        const pkg = {
            name: "test-app",
            scripts: {
                "build": "next build"
            }
        };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));

        const vercelConfig = {
            buildCommand: "next build --prod"
        };
        fs.writeFileSync(path.join(dir, 'vercel.json'), JSON.stringify(vercelConfig, null, 2));

        const result = await spawnProcess('node', [createStubPath, dir, '--framework', 'next', '--password', 'securepassword123']);
        assertExitCode(result, 0);

        const updatedPkgFile = path.join(dir, 'package.json');
        const pkgUpdated = JSON.parse(fs.readFileSync(updatedPkgFile, 'utf8'));
        assert.strictEqual(pkgUpdated.scripts.build, 'fortress build && next build', 'Should prepend fortress build to next build in package.json');

        const updatedVercelFile = path.join(dir, 'vercel.json');
        const vercelUpdated = JSON.parse(fs.readFileSync(updatedVercelFile, 'utf8'));
        assert.strictEqual(vercelUpdated.buildCommand, 'npx fortress build && next build --prod', 'Should prepend fortress build to buildCommand in vercel.json');
    }
};

runTestSuite('F4: CI/CD Pipeline Integration E2E Overhaul Test Suite', tests)
    .then(() => cleanupDirs())
    .catch(() => cleanupDirs());
