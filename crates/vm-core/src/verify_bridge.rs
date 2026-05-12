use wasm_bindgen::prelude::*;
use crypto_core::{derive_signing_key};
use zeroize::Zeroize;
use std::cell::RefCell;

thread_local! {
    static SIGNING_KEY: RefCell<Option<[u8; 32]>> = RefCell::new(None);
}

fn hex_to_bytes(hex: &str) -> Option<Vec<u8>> {
    if hex.len() % 2 != 0 {
        return None;
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok())
        .collect()
}

#[wasm_bindgen]
pub fn init_crypto(
    stego_key_hex: &str,
    session_seed_hex: &str,
    fingerprint_hex: &str,
    epoch_day: u32,
) {
    let mut stego_key = hex_to_bytes(stego_key_hex).unwrap_or_else(|| vec![0; 32]);
    let mut session_seed = hex_to_bytes(session_seed_hex).unwrap_or_else(|| vec![0; 32]);
    let mut fingerprint = hex_to_bytes(fingerprint_hex).unwrap_or_else(|| vec![0; 32]);

    let sig_key = derive_signing_key(&stego_key, &session_seed, &fingerprint, epoch_day);

    SIGNING_KEY.with(|k| {
        *k.borrow_mut() = Some(sig_key);
    });

    // Zeroize sensitive material immediately
    stego_key.zeroize();
    session_seed.zeroize();
    fingerprint.zeroize();
}

#[wasm_bindgen]
pub fn sign_request(method: &str, url: &str, body_str: &str, timestamp: &str) -> String {
    let mut key_opt = None;
    SIGNING_KEY.with(|k| {
        if let Some(key) = *k.borrow() {
            key_opt = Some(key);
        }
    });

    let key = match key_opt {
        Some(k) => k,
        None => return "uninitialized".to_string(), // Or handle error
    };

    let message = format!("{}\n{}\n{}\n{}", method, url, timestamp, body_str);
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    type HmacSha256 = Hmac<Sha256>;

    let mut mac = HmacSha256::new_from_slice(&key).expect("HMAC can take key of any size");
    mac.update(message.as_bytes());
    let result = mac.finalize();
    let signature_bytes = result.into_bytes();
    
    signature_bytes.iter().map(|b| format!("{:02x}", b)).collect()
}
