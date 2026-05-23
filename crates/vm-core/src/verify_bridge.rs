use wasm_bindgen::prelude::*;
use crypto_core::{derive_signing_key};
use zeroize::Zeroize;
use std::cell::RefCell;

thread_local! {
    pub static SIGNING_KEY: RefCell<Option<[u8; 32]>> = RefCell::new(None);
    pub static SESSION_KEY: RefCell<Option<[u8; 32]>> = RefCell::new(None);
    pub static PAYLOAD_HASH: RefCell<Option<[u8; 32]>> = RefCell::new(None);
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
pub fn init_crypto_with_key(
    mut stego_key_bytes: Box<[u8]>,
    mut session_seed: Box<[u8]>,
    mut fingerprint: Box<[u8]>,
    epoch_day: u32,
) {
    let mut stego_key = [0u8; 32];
    if stego_key_bytes.len() == 32 {
        stego_key.copy_from_slice(&stego_key_bytes);
    }
    let mut sig_key = derive_signing_key(&stego_key, &session_seed, &fingerprint, epoch_day);
    SIGNING_KEY.with(|k| *k.borrow_mut() = Some(sig_key));
    SESSION_KEY.with(|k| *k.borrow_mut() = Some(stego_key));
    stego_key.zeroize();
    stego_key_bytes.zeroize();
    session_seed.zeroize();
    fingerprint.zeroize();
    sig_key.zeroize();
}

#[wasm_bindgen]
pub fn init_crypto(
    mut image_bytes: Box<[u8]>,
    _width: u32,
    _height: u32,
    mut session_seed: Box<[u8]>,
    mut fingerprint: Box<[u8]>,
    epoch_day: u32,
) {
    let mut stego_key = [0u8; 32];
    let mut extracted = false;

    // Try primary prime-stride steganography first since scrambler targets use this format
    if let Some(key) = crate::steg_extract::extract_telemetry_signing_key(&image_bytes) {
        stego_key = key;
        extracted = true;
    }

    if !extracted {
        // Decode PNG and extract raw pixels for alternative PRNG-based steganography
        let mut decoder = png::Decoder::new(&image_bytes[..]);
        decoder.set_transformations(png::Transformations::EXPAND);
        if let Ok(mut reader) = decoder.read_info() {
            let width = reader.info().width;
            let height = reader.info().height;
            let mut pixels = vec![0; reader.output_buffer_size()];
            if let Ok(_) = reader.next_frame(&mut pixels) {
                let (color_type, _) = reader.output_color_type();
                
                // Normalize buffer to 4 channels (RGBA) if it is RGB
                let mut rgba_pixels = match color_type {
                    png::ColorType::Rgb => {
                        let mut rgba = Vec::with_capacity(width as usize * height as usize * 4);
                        for chunk in pixels.chunks_exact(3) {
                            rgba.extend_from_slice(chunk);
                            rgba.push(255); // Dummy alpha
                        }
                        rgba
                    }
                    _ => pixels,
                };
                
                // Extract key using matching PRNG-based LSB steganography
                if let Some(key) = crypto_core::steg::extract_steg_key(&rgba_pixels, width, height) {
                    stego_key = key;
                }
                rgba_pixels.zeroize();
            }
        }
    }

    let mut sig_key = derive_signing_key(&stego_key, &session_seed, &fingerprint, epoch_day);

    SIGNING_KEY.with(|k| {
        *k.borrow_mut() = Some(sig_key);
    });
    SESSION_KEY.with(|k| {
        *k.borrow_mut() = None;
    });

    // Zeroize sensitive material immediately.
    stego_key.zeroize();
    image_bytes.zeroize();
    session_seed.zeroize();
    fingerprint.zeroize();
    sig_key.zeroize();
}

#[wasm_bindgen]
pub fn sign_request(method: &str, url: &str, body_str: &str, timestamp: &str) -> String {
    let mut key_opt = None;
    SIGNING_KEY.with(|k| {
        if let Some(key) = *k.borrow() {
            key_opt = Some(key);
        }
    });

    let mut key = match key_opt {
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
    
    let sig_hex = signature_bytes.iter().map(|b| format!("{:02x}", b)).collect();
    key.zeroize();
    sig_hex
}

#[wasm_bindgen]
pub fn clear_crypto() {
    SIGNING_KEY.with(|k| {
        let mut borrow = k.borrow_mut();
        if let Some(ref mut key) = *borrow {
            key.zeroize();
        }
        *borrow = None;
    });
    SESSION_KEY.with(|k| {
        let mut borrow = k.borrow_mut();
        if let Some(ref mut key) = *borrow {
            key.zeroize();
        }
        *borrow = None;
    });
    PAYLOAD_HASH.with(|h| {
        let mut borrow = h.borrow_mut();
        if let Some(ref mut hash) = *borrow {
            hash.zeroize();
        }
        *borrow = None;
    });
    crate::wrapper::CLIENT_PRIVATE_KEY.with(|k| {
        let mut borrow = k.borrow_mut();
        if let Some(ref mut key) = *borrow {
            key.zeroize();
        }
        *borrow = None;
    });
}
