use sha2::{Sha256, Digest};
use std::collections::HashSet;

pub const MAGIC_SEED: u32 = 0xAAB011CC;

pub struct Sha256Prng {
    counter: u64,
    seed: u32,
    buffer: Vec<u8>,
    buffer_idx: usize,
}

impl Sha256Prng {
    pub fn new(seed: u32) -> Self {
        Self {
            counter: 0,
            seed,
            buffer: Vec::new(),
            buffer_idx: 0,
        }
    }

    pub fn next(&mut self) -> u32 {
        if self.buffer_idx >= self.buffer.len() {
            let mut hasher = Sha256::new();
            hasher.update(self.seed.to_le_bytes());
            hasher.update(self.counter.to_le_bytes());
            self.buffer = hasher.finalize().to_vec();
            self.counter += 1;
            self.buffer_idx = 0;
        }

        let mut bytes = [0u8; 4];
        bytes.copy_from_slice(&self.buffer[self.buffer_idx..self.buffer_idx + 4]);
        self.buffer_idx += 4;
        u32::from_le_bytes(bytes)
    }
}

pub fn extract_steg_key(image_data: &[u8], width: u32, height: u32) -> Option<[u8; 32]> {
    let total_pixels = width * height;
    if total_pixels < 256 || image_data.len() < (total_pixels * 4) as usize {
        return None;
    }

    let seed = width ^ height ^ MAGIC_SEED;
    let mut prng = Sha256Prng::new(seed);
    
    let mut indices = Vec::with_capacity(256);
    let mut seen = HashSet::new();
    
    while indices.len() < 256 {
        let idx = prng.next() % total_pixels;
        if seen.insert(idx) {
            indices.push(idx);
        }
    }

    let mut key = [0u8; 32];
    for i in 0..256 {
        let pixel_idx = indices[i] as usize;
        let byte_idx = i / 8;
        let bit_idx = i % 8;
        
        // RGBA assumed, blue is at index 2
        let blue_idx = pixel_idx * 4 + 2;
        let bit = image_data[blue_idx] & 1;
        
        key[byte_idx] |= bit << bit_idx;
    }

    Some(key)
}
