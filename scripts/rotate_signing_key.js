const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const argon2 = require('argon2');
const readline = require('readline');
const { execSync } = require('child_process');

const serverDir = path.join(__dirname, '..', 'server');
const paramsPath = path.join(serverDir, '.signing_params');
const keyPath = path.join(serverDir, '.signing_key');
const rustPubKeyBin = path.join(__dirname, '..', 'crates', 'vm-core', 'src', 'public_key.bin');

function askPassword(query) {
    return new Promise((resolve) => {
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

async function rotate() {
    let password = await askPassword("Enter FORTRESS_SIGNING_PASSWORD (press Enter to use environment variable): ");
    if (!password) {
        password = process.env.FORTRESS_SIGNING_PASSWORD;
    }
    if (!password) {
        console.error("Error: FORTRESS_SIGNING_PASSWORD must be provided via prompt or environment variable.");
        process.exit(1);
    }

    // Propagate the password to child processes
    process.env.FORTRESS_SIGNING_PASSWORD = password;

    if (fs.existsSync(paramsPath)) {
        const archiveTimestamp = Math.floor(Date.now() / 1000);
        const archivePath = `${paramsPath}.archive.${archiveTimestamp}`;
        console.log(`Archiving existing params from ${paramsPath} to ${archivePath}...`);
        const existingParams = fs.readFileSync(paramsPath);
        fs.writeFileSync(archivePath, existingParams);
    }

    console.log("Generating fresh 32-byte salt...");
    const salt = crypto.randomBytes(32);

    console.log(`Writing new salt to ${paramsPath}...`);
    fs.writeFileSync(paramsPath, salt);

    // Delete existing derived key and rust public key bin to force rebuild
    if (fs.existsSync(keyPath)) {
        console.log(`Removing old key at ${keyPath} to force regeneration...`);
        fs.unlinkSync(keyPath);
    }
    if (fs.existsSync(rustPubKeyBin)) {
        console.log(`Removing old Rust public key binary at ${rustPubKeyBin} to force regeneration...`);
        fs.unlinkSync(rustPubKeyBin);
    }

    // Verify key derivation with the new salt
    console.log("Deriving new key pair using Argon2id...");
    const seed = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 1,
        hashLength: 32,
        salt: salt,
        raw: true
    });

    const derHeader = Buffer.from('302e020100300506032b657004220420', 'hex');
    const privateKeyDer = Buffer.concat([derHeader, seed]);
    const privateKey = crypto.createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' });
    const publicKey = crypto.createPublicKey(privateKey);
    const pubDer = publicKey.export({ format: 'der', type: 'spki' });
    const rawPub = pubDer.subarray(12);

    const rustArray = '[\n' + Array.from(rawPub).map(b => `    0x${b.toString(16).padStart(2, '0')}`).join(',\n') + '\n]';
    console.log(`Derived new public key:\n${rustArray}`);

    console.log("Triggering Rust rebuilds (dev and prod)...");
    
    console.log("Running npm run build:dev...");
    execSync('npm run build:dev', { stdio: 'inherit', cwd: path.join(__dirname, '..') });

    console.log("Running npm run build:prod...");
    execSync('npm run build:prod', { stdio: 'inherit', cwd: path.join(__dirname, '..') });

    console.log("Key rotation completed successfully!");
}

rotate().catch(err => {
    console.error("Rotation failed:", err);
    process.exit(1);
});

