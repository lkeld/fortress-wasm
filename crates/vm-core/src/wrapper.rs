use wasm_bindgen::prelude::*;
use crate::vm::Vm;
use crate::value::Value;

// No wee_alloc for now to keep dependencies simple

#[wasm_bindgen]
pub fn execute(bytecode: &[u8], image_rgba: &[u8], input_json: &str, opcode_map: &[u8]) -> String {
    // VirtSC Verification Step 1: Compute the payload hash at the exact moment of ingestion.
    // This hash is stored globally and verified inside the VM loop. If the payload is patched, the VM silently corrupts the key.
    // See VirtSC: Combining Virtualisation Obfuscation with Self-Checksumming, arxiv.org/abs/1909.11404.
    let mut payload_data = Vec::new();
    payload_data.extend_from_slice(bytecode);
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(&payload_data);
    let hash = hasher.finalize();
    let hash_arr: [u8; 32] = hash.into();
    crate::verify_bridge::set_payload_hash(Box::new(hash_arr));

    let mut session_key = [0u8; 32];
    if let Ok(mut reader) = png::Decoder::new(&image_rgba[..]).read_info() {
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
                    session_key[i] = byte;
                }
            }
        }

    let bytecode_payload = bytecode;

    let mut vm = Vm::new(bytecode_payload.to_vec(), opcode_map.to_vec(), session_key);
    
    // Load input_json into locals
    if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(input_json) {
        if let Some(arr) = json_val.as_array() {
            for (i, v) in arr.iter().enumerate() {
                vm.set_local(i, json_to_value(v));
            }
        }
    }
    
    match vm.run() {
        Ok(result) => {
            value_to_json(&result).to_string()
        },
        Err(e) => {
            format!(r#"{{"status": false, "error": "{:?}"}}"#, e)
        }
    }
}

// Helpers to convert between our Value enum and serde_json::Value
pub fn json_to_value(v: &serde_json::Value) -> Value {
    match v {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(b) => Value::Bool(*b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Int(i)
            } else if let Some(f) = n.as_f64() {
                Value::Float(f)
            } else {
                Value::Null
            }
        },
        serde_json::Value::String(s) => Value::Str(std::sync::Arc::new(s.clone())),
        serde_json::Value::Array(arr) => {
            let list = arr.iter().map(json_to_value).collect();
            Value::List(std::rc::Rc::new(std::cell::RefCell::new(list)))
        },
        serde_json::Value::Object(obj) => {
            let mut map = std::collections::HashMap::new();
            for (k, v) in obj {
                map.insert(k.clone(), json_to_value(v));
            }
            Value::Object(std::rc::Rc::new(std::cell::RefCell::new(map)))
        }
    }
}

pub fn value_to_json(v: &Value) -> serde_json::Value {
    match v {
        Value::Null => serde_json::Value::Null,
        Value::Bool(b) => serde_json::Value::Bool(*b),
        Value::Int(i) => serde_json::Value::Number((*i).into()),
        Value::Float(f) => {
            if let Some(num) = serde_json::Number::from_f64(*f) {
                serde_json::Value::Number(num)
            } else {
                serde_json::Value::Null
            }
        },
        Value::Str(s) => serde_json::Value::String(s.to_string()),
        Value::List(list) => {
            let arr = list.borrow().iter().map(value_to_json).collect();
            serde_json::Value::Array(arr)
        },
        Value::Object(map) => {
            let mut obj = serde_json::Map::new();
            for (k, v) in map.borrow().iter() {
                obj.insert(k.clone(), value_to_json(v));
            }
            serde_json::Value::Object(obj)
        }
    }
}
