use wasm_bindgen::prelude::*;
use crate::vm::Vm;
use crate::value::Value;

// No wee_alloc for now to keep dependencies simple

#[wasm_bindgen]
pub fn execute(bytecode: &[u8], constants_json: &str, input_json: &str, opcode_map: &[u8]) -> String {
    let mut parsed_constants = Vec::new();

    // Compute payload hash and set it for verify_bridge
    let mut payload_data = Vec::new();
    payload_data.extend_from_slice(bytecode);
    payload_data.extend_from_slice(constants_json.as_bytes());
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(&payload_data);
    let hash = hasher.finalize();
    let hash_arr: [u8; 32] = hash.into();
    crate::verify_bridge::set_payload_hash(Box::new(hash_arr));
    
    // Simple XOR decryption using the prepended random key
    let decrypted_json = if constants_json.starts_with('[') {
        constants_json.to_string()
    } else if constants_json.len() >= 2 {
        let xor_key = u8::from_str_radix(&constants_json[0..2], 16).unwrap_or(0x42);
        let bytes = (2..constants_json.len())
            .step_by(2)
            .filter_map(|i| u8::from_str_radix(&constants_json[i..i + 2], 16).ok())
            .map(|b| b ^ xor_key)
            .collect::<Vec<u8>>();
        String::from_utf8(bytes).unwrap_or_else(|_| "[]".to_string())
    } else {
        "[]".to_string()
    };

    if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&decrypted_json) {
        if let Some(arr) = json_val.as_array() {
            for v in arr {
                parsed_constants.push(json_to_value(v));
            }
        }
    }

    let mut vm = Vm::new(bytecode.to_vec(), parsed_constants, opcode_map.to_vec());
    
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
        Err(_) => {
            r#"{"status": false, "error": "execution_failed"}"#.to_string()
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
