pub fn extract_prime_stride(image_data: &[u8]) -> Option<[u8; 32]> {
    if let Ok(mut reader) = png::Decoder::new(&image_data[..]).read_info() {
        let mut buf = vec![0; reader.output_buffer_size()];
        if let Ok(_) = reader.next_frame(&mut buf) {
            let mut key = [0u8; 32];
            let primes = [3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47];
            
            if buf.is_empty() {
                return None;
            }
            
            let stride = primes[(buf[0] as usize) % primes.len()];
            let mut pixel_offset = 0;
            
            for i in 0..32 {
                let mut byte = 0u8;
                for bit in 0..8 {
                    pixel_offset = (pixel_offset + stride) % 256;
                    let channel = (i + bit) % 3;
                    let data_idx = pixel_offset * 4 + channel;
                    
                    if data_idx >= buf.len() {
                        return None; // Prevent out-of-bounds panic
                    }
                    
                    let bit_val = buf[data_idx] & 1;
                    byte |= bit_val << bit;
                }
                key[i] = byte;
            }
            return Some(key);
        }
    }
    None
}
