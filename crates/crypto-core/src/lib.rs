pub mod steg;

use sha2::{Sha256, Sha512, Digest};
use hkdf::Hkdf;
use zeroize::Zeroize;

pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

pub fn derive_signing_key(
    stego_key: &[u8], 
    session_seed: &[u8], 
    fingerprint: &[u8], 
    epoch_day: u32
) -> [u8; 32] {
    let mut ikm = Vec::new();
    ikm.extend_from_slice(stego_key);
    ikm.extend_from_slice(session_seed);
    ikm.extend_from_slice(fingerprint);
    ikm.extend_from_slice(&epoch_day.to_be_bytes());

    let mut salt = vec![0u8; fingerprint.len()];
    for (i, &b) in fingerprint.iter().enumerate() {
        let added = b.wrapping_add(i as u8);
        salt[i] = (added >> 3) | (added << 5);
    }

    let hk = Hkdf::<Sha512>::new(Some(&salt), &ikm);
    let mut okm = [0u8; 32];
    hk.expand(b"anabolic-hmac-v1", &mut okm)
        .expect("HKDF expand failed");
    
    ikm.zeroize();
    salt.zeroize();
    
    okm
}
