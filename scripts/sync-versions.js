const fs = require('fs');
const path = require('path');

// Resolve absolute paths for package files
const rootPath = path.resolve(__dirname, '../package.json');
const createFortressAppPath = path.resolve(__dirname, '../packages/create-fortress-app/package.json');
const sdkPath = path.resolve(__dirname, '../packages/sdk/package.json');

function run() {
  if (!fs.existsSync(rootPath)) {
    console.error(`Root package file not found at: ${rootPath}`);
    process.exit(1);
  }

  const rootPkg = JSON.parse(fs.readFileSync(rootPath, 'utf8'));
  const rootVersion = rootPkg.version;

  const subPackages = [
    { name: 'create-fortress-app', path: createFortressAppPath },
    { name: 'sdk', path: sdkPath }
  ];

  let hasMismatch = false;
  const updates = [];

  for (const pkgInfo of subPackages) {
    if (!fs.existsSync(pkgInfo.path)) {
      console.error(`Sub-package file not found at: ${pkgInfo.path}`);
      process.exit(1);
    }

    const pkgContent = fs.readFileSync(pkgInfo.path, 'utf8');
    const pkgJson = JSON.parse(pkgContent);

    if (pkgJson.version !== rootVersion) {
      hasMismatch = true;
      updates.push({
        name: pkgInfo.name,
        path: pkgInfo.path,
        oldVersion: pkgJson.version,
        newVersion: rootVersion,
        json: pkgJson
      });
    }
  }

  if (hasMismatch) {
    const isFixMode = process.argv.includes('--fix');

    if (isFixMode) {
      console.log('Version drift detected. Initialising version synchronisation...');
      for (const update of updates) {
        update.json.version = update.newVersion;
        // Format with 2 spaces and trailing newline to match existing style
        const updatedContent = JSON.stringify(update.json, null, 2) + '\n';
        fs.writeFileSync(update.path, updatedContent, 'utf8');
        console.log(`Synchronised ${update.name} version: ${update.oldVersion} -> ${update.newVersion}`);
      }
      console.log('All sub-package versions have been successfully synchronised and verified.');
    } else {
      console.error('Version synchronisation check failed. Sub-package versions do not match the root version:');
      for (const update of updates) {
        console.error(`  - ${update.name}: expected ${update.newVersion}, found ${update.oldVersion}`);
      }
      console.error('Run "npm run sync-versions:fix" to automatically synchronise them.');
      process.exit(1);
    }
  } else {
    console.log(`All sub-package versions are synchronised with root version ${rootVersion}. Verification completed.`);
  }
}

run();
