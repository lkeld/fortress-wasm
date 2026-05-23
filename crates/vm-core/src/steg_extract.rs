pub fn extract_prime_stride(image_data: &[u8]) -> Option<[u8; 32]> {
    let mut decoder = png::Decoder::new(&image_data[..]);
    decoder.set_transformations(png::Transformations::EXPAND);
    if let Ok(mut reader) = decoder.read_info() {
        struct ZeroizeOnDrop(Vec<u8>);
        impl Drop for ZeroizeOnDrop {
            fn drop(&mut self) {
                use zeroize::Zeroize;
                self.0.zeroize();
            }
        }
        let mut buf_wrapper = ZeroizeOnDrop(vec![0; reader.output_buffer_size()]);
        let buf = &mut buf_wrapper.0;
        let (color_type, _) = reader.output_color_type();
        let channels = match color_type {
            png::ColorType::Rgb => 3,
            png::ColorType::Rgba => 4,
            _ => 4,
        };
        if let Ok(_) = reader.next_frame(buf) {
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
                    let data_idx = pixel_offset * channels + channel;
                    
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

    fn generate_test_png_rgb(data: &[u8], width: u32, height: u32) -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut out, width, height);
            encoder.set_color(png::ColorType::Rgb);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(data).unwrap();
        }
        out
    }

    #[test]
    fn test_extract_prime_stride_rgb_success() {
        let mut pixels = vec![0u8; 16 * 16 * 3];
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
                let data_idx = pixel_offset * 3 + channel;
                
                let bit_val = (expected_key[i] >> bit) & 1;
                pixels[data_idx] = (pixels[data_idx] & !1) | bit_val;
            }
        }

        let png_data = generate_test_png_rgb(&pixels, 16, 16);
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

    fn generate_test_png_grayscale(data: &[u8], width: u32, height: u32) -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut out, width, height);
            encoder.set_color(png::ColorType::Grayscale);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(data).unwrap();
        }
        out
    }

    fn generate_test_png_indexed(data: &[u8], palette: &[u8], width: u32, height: u32) -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut out, width, height);
            encoder.set_color(png::ColorType::Indexed);
            encoder.set_depth(png::BitDepth::Eight);
            encoder.set_palette(palette.to_vec());
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(data).unwrap();
        }
        out
    }

    #[test]
    fn test_extract_prime_stride_grayscale_and_indexed_no_crash() {
        // Grayscale image data
        let grayscale_pixels = vec![0u8; 16 * 16];
        let png_grayscale = generate_test_png_grayscale(&grayscale_pixels, 16, 16);
        let _result_gray = extract_prime_stride(&png_grayscale);
        // Should not panic, may return None or Some depending on size
        
        // Indexed image data
        let indexed_pixels = vec![0u8; 16 * 16];
        let palette = vec![0u8; 256 * 3]; // 256 colors
        let png_indexed = generate_test_png_indexed(&indexed_pixels, &palette, 16, 16);
        let _result_indexed = extract_prime_stride(&png_indexed);
        // Should not panic
    }

    #[test]
    fn test_extract_prime_stride_corrupt_buffers_no_crash() {
        // Test with empty buffer
        assert!(extract_prime_stride(&[]).is_none());

        // Test with corrupt headers but valid magic bytes
        let mut magic = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        magic.extend_from_slice(&[0; 100]);
        assert!(extract_prime_stride(&magic).is_none());

        // Test with random bytes of various lengths
        for length in [1, 2, 4, 8, 16, 32, 64, 128, 1024, 65536] {
            let mut random_bytes = vec![0u8; length];
            for i in 0..length {
                random_bytes[i] = (i % 256) as u8;
            }
            assert!(extract_prime_stride(&random_bytes).is_none());
        }
    }

    #[test]
    fn test_extract_prime_stride_huge_dimensions_no_crash() {
        let header = vec![
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
            0x00, 0x00, 0x00, 0x0D,                         // IHDR length (13)
            b'I', b'H', b'D', b'R',                         // IHDR chunk
            0x00, 0x01, 0x86, 0xA0,                         // Width: 100,000
            0x00, 0x01, 0x86, 0xA0,                         // Height: 100,000
            0x08,                                           // Bit depth: 8
            0x06,                                           // Color type: RGBA
            0x00,                                           // Compression: deflate
            0x00,                                           // Filter: adaptive
            0x00,                                           // Interlace: none
            0x00, 0x00, 0x00, 0x00,                         // CRC (dummy)
        ];
        let res = extract_prime_stride(&header);
        assert!(res.is_none());
    }

    #[test]
    fn test_extract_prime_stride_truncated_png_no_crash() {
        let pixels = vec![0u8; 16 * 16 * 4];
        let png_data = generate_test_png(&pixels, 16, 16);
        for len in 1..png_data.len() {
            let truncated = &png_data[..len];
            let _res = extract_prime_stride(truncated);
        }
    }
}

