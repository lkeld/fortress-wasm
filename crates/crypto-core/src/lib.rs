pub mod steg;
use sha2::{Sha256, Sha512, Digest};
use hkdf::Hkdf;
use zeroize::Zeroize;

pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

pub fn encrypt_aes_gcm(plaintext: &[u8], key: &[u8]) -> Result<Vec<u8>, &'static str> {
    use aes_gcm::{Aes256Gcm, Key, Nonce, aead::{Aead, KeyInit}};
    use getrandom::getrandom;
    
    if key.len() != 32 {
        return Err("Key must be 32 bytes");
    }
    
    let key = Key::<Aes256Gcm>::from_slice(key);
    let cipher = Aes256Gcm::new(key);
    
    let mut nonce_bytes = [0u8; 12];
    getrandom(&mut nonce_bytes).map_err(|_| "Failed to generate nonce")?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    
    let mut ciphertext = cipher.encrypt(nonce, plaintext).map_err(|_| "Encryption failed")?;
    
    // Prepend nonce to ciphertext
    let mut result = nonce_bytes.to_vec();
    result.append(&mut ciphertext);
    
    Ok(result)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha256_consistency() {
        let data = b"hello world";
        let hash = sha256(data);
        let mut hex_str = String::new();
        for byte in &hash {
            use std::fmt::Write;
            write!(&mut hex_str, "{:02x}", byte).unwrap();
        }
        assert_eq!(
            hex_str,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
    }

    #[test]
    fn test_derive_signing_key_consistency() {
        let stego_key = b"secret_key_123";
        let session_seed = b"session_987";
        let fingerprint = b"browser_fp";
        let epoch_day = 19500;

        let key1 = derive_signing_key(stego_key, session_seed, fingerprint, epoch_day);
        let key2 = derive_signing_key(stego_key, session_seed, fingerprint, epoch_day);
        
        assert_eq!(key1, key2);

        // Change one bit, output should be entirely different
        let key3 = derive_signing_key(stego_key, session_seed, fingerprint, epoch_day + 1);
        assert_ne!(key1, key3);
        
        let key4 = derive_signing_key(b"secret_key_124", session_seed, fingerprint, epoch_day);
        assert_ne!(key1, key4);
    }

    #[test]
    fn test_derive_signing_key_zeroization_no_panic() {
        // Just verify it runs safely without panicking on large/small inputs
        derive_signing_key(b"", b"", b"", 0);
        derive_signing_key(&[0xFF; 1000], &[0xAA; 1000], &[0x00; 1000], 1);
    }
}
