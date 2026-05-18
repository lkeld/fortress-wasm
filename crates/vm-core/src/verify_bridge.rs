use wasm_bindgen::prelude::*;
use crypto_core::{derive_signing_key};
use zeroize::Zeroize;
use std::cell::RefCell;

thread_local! {
    static SIGNING_KEY: RefCell<Option<[u8; 32]>> = RefCell::new(None);
    static PAYLOAD_HASH: RefCell<Option<[u8; 32]>> = RefCell::new(None);
}

#[wasm_bindgen]
pub fn set_payload_hash(hash: Box<[u8]>) {
    let mut hash_arr = [0u8; 32];
    if hash.len() == 32 {
        hash_arr.copy_from_slice(&hash);
        PAYLOAD_HASH.with(|h| {
            *h.borrow_mut() = Some(hash_arr);
        });
    }
}

#[wasm_bindgen]
pub fn init_crypto(
    mut image_bytes: Box<[u8]>,
    width: u32,
    height: u32,
    mut session_seed: Box<[u8]>,
    mut fingerprint: Box<[u8]>,
    epoch_day: u32,
) {
    let mut stego_key = [0u8; 32];
    if let Ok(mut reader) = png::Decoder::new(&image_bytes[..]).read_info() {
        let mut buf = vec![0; reader.output_buffer_size()];
        if let Ok(_) = reader.next_frame(&mut buf) {
                let primes = [3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47];
                let stride = primes[(buf[0] as usize) % primes.len()];
                let mut pixel_offset = 0;
                
                for i in 0..32 {
                    let mut byte = 0u8;
                    for bit in 0..8 {
                        pixel_offset = (pixel_offset + stride) % 256;
                        let channel = (i + bit) % 3;
                        let data_idx = pixel_offset * 4 + channel;
                        let bit_val = buf[data_idx] & 1;
                        byte |= bit_val << bit;
                    }
                    stego_key[i] = byte;
                }
            }
        }

    let sig_key = derive_signing_key(&stego_key, &session_seed, &fingerprint, epoch_day);

    SIGNING_KEY.with(|k| {
        *k.borrow_mut() = Some(sig_key);
    });

    // Zeroize sensitive material immediately.
    // Because we take ownership of Box<[u8]>, these exact heap allocations 
    // made by wasm_bindgen when copying from JS are securely wiped before they are freed.
    stego_key.zeroize();
    image_bytes.zeroize();
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

    let payload_hash_opt = PAYLOAD_HASH.with(|h| *h.borrow());
    let default_hash = [0u8; 32];
    let payload_hash = payload_hash_opt.unwrap_or(default_hash);
    
    let hash_hex: String = payload_hash.iter().map(|b| format!("{:02x}", b)).collect();
    let message = format!("{}\n{}\n{}\n{}\n{}", method, url, timestamp, body_str, hash_hex);
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    type HmacSha256 = Hmac<Sha256>;

    let mut mac = HmacSha256::new_from_slice(&key).expect("HMAC can take key of any size");
    mac.update(message.as_bytes());
    let result = mac.finalize();
    let signature_bytes = result.into_bytes();
    
    signature_bytes.iter().map(|b| format!("{:02x}", b)).collect()
}
