use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=../../server/.signing_key");
    
    let node_code = r#"
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const argon2 = require('argon2');

(async () => {
    const password = process.env.FORTRESS_SIGNING_PASSWORD;
    if (!password) {
        throw new Error("Missing FORTRESS_SIGNING_PASSWORD environment variable");
    }
    const paramsPath = '../../server/.signing_params';
    let salt;
    if (fs.existsSync(paramsPath)) {
        salt = fs.readFileSync(paramsPath);
    } else {
        salt = crypto.randomBytes(32);
        fs.writeFileSync(paramsPath, salt);
    }
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
    fs.writeFileSync('../../server/.signing_key', privateKeyDer);

    const privateKey = crypto.createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' });
    const publicKey = crypto.createPublicKey(privateKey);
    const pubDer = publicKey.export({ format: 'der', type: 'spki' });
    const rawPub = pubDer.subarray(12);
    fs.writeFileSync('src/public_key.bin', rawPub);
})().catch(err => {
    console.error(err);
    process.exit(1);
});
"#;

    let output = Command::new("node")
        .arg("-e")
        .arg(node_code)
        .output();

    match output {
        Ok(out) => {
            if !out.status.success() {
                panic!("Node process failed to generate key: {}", String::from_utf8_lossy(&out.stderr));
            }
        }
        Err(e) => {
            panic!("Failed to execute node command for build.rs: {:?}", e);
        }
    }
}
