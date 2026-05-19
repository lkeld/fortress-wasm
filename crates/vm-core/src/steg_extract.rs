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

#[cfg(test)]
mod tests {
    use super::*;

    fn generate_test_png(data: &[u8], width: u32, height: u32) -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut out, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(data).unwrap();
        }
        out
    }

    #[test]
    fn test_extract_prime_stride_success() {
        let mut pixels = vec![0u8; 16 * 16 * 4];
        pixels[0] = 5; // Modulo index for primes array -> 5 % 14 = 5 -> primes[5] = 17 stride

        let expected_key: [u8; 32] = [
            1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
            17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32
        ];

        let stride = 17;
        let mut pixel_offset = 0;

        for i in 0..32 {
            for bit in 0..8 {
                pixel_offset = (pixel_offset + stride) % 256;
                let channel = (i + bit) % 3;
                let data_idx = pixel_offset * 4 + channel;
                
                let bit_val = (expected_key[i] >> bit) & 1;
                pixels[data_idx] = (pixels[data_idx] & !1) | bit_val;
            }
        }

        let png_data = generate_test_png(&pixels, 16, 16);
        let extracted_key = extract_prime_stride(&png_data).expect("Should extract key");
        
        assert_eq!(extracted_key, expected_key);
    }

    #[test]
    fn test_extract_prime_stride_short_buffer() {
        let mut pixels = vec![0u8; 8 * 8 * 4]; // Only 256 bytes, not enough for offset % 256
        pixels[0] = 0;

        let png_data = generate_test_png(&pixels, 8, 8);
        assert!(extract_prime_stride(&png_data).is_none());
    }

    #[test]
    fn test_extract_prime_stride_invalid_png() {
        let invalid_data = vec![0u8; 100];
        assert!(extract_prime_stride(&invalid_data).is_none());
    }
}
