use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=../../server/.signing_key");
    
    let node_code = r#"
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const keyPath = '../../server/.signing_key';
let privateKeyDer;
if (fs.existsSync(keyPath)) {
    privateKeyDer = fs.readFileSync(keyPath);
} else {
    const pair = crypto.generateKeyPairSync('ed25519', {
        privateKeyEncoding: { format: 'der', type: 'pkcs8' }
    });
    fs.writeFileSync(keyPath, pair.privateKey);
    privateKeyDer = pair.privateKey;
}
const privateKey = crypto.createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' });
const publicKey = crypto.createPublicKey(privateKey);
const pubDer = publicKey.export({ format: 'der', type: 'spki' });
const rawPub = pubDer.subarray(12);
fs.writeFileSync('src/public_key.bin', rawPub);
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
