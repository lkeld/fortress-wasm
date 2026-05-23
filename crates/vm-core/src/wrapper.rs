use wasm_bindgen::prelude::*;
use crate::vm::Vm;
use crate::value::Value;

// No wee_alloc for now to keep dependencies simple

#[wasm_bindgen]
pub fn execute(bytecode: &[u8], image_rgba: &[u8], input_json: &str, opcode_map: &[u8]) -> String {
    if bytecode.is_empty() {
        return r#"{"status": false, "error": "UnexpectedEndOfCode"}"#.to_string();
    }

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
    
    #[cfg(feature = "dev")]
    {
        let expected_hash = crate::verify_bridge::PAYLOAD_HASH.with(|h| *h.borrow());
        if let Some(expected) = expected_hash {
            if hash_arr != expected {
                return r#"{"status": false, "error": "Dev mode VirtSC hash mismatch"}"#.to_string();
            }
        }
    }
    
    crate::verify_bridge::set_payload_hash(Box::new(hash_arr));

    let mut session_key = [0u8; 32];
    let mut has_session_key = false;
    crate::verify_bridge::SESSION_KEY.with(|k| {
        if let Some(key) = *k.borrow() {
            session_key = key;
            has_session_key = true;
        }
    });

    if !has_session_key {
        if let Some(key) = crate::steg_extract::extract_prime_stride(image_rgba) {
            session_key = key;
            has_session_key = true;
        }
    }

    #[cfg(all(not(feature = "dev"), not(test)))]
    {
        if !has_session_key {
            return r#"{"status": false, "error": "MissingSessionKey"}"#.to_string();
        }
    }
    let _ = has_session_key;

    let bytecode_payload = bytecode;

    let mut vm = Vm::new(bytecode_payload.to_vec(), opcode_map.to_vec(), session_key, hash_arr);
    
    // Load input_json into locals
    if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(input_json) {
        if let Some(arr) = json_val.as_array() {
            for (i, v) in arr.iter().enumerate() {
                vm.set_local(i, json_to_value(v));
            }
        }
    }
    
    let res = match vm.run() {
        Ok(result) => {
            value_to_json(&result).to_string()
        },
        Err(e) => {
            let err_str = match e {
                crate::stack::VmError::OutOfGas => "ExecutionLimitExceeded".to_string(),
                _ => format!("{:?}", e),
            };
            format!(r#"{{"status": false, "error": "{}"}}"#, err_str)
        }
    };
    use zeroize::Zeroize;
    session_key.zeroize();
    res
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
    use std::collections::HashSet;
    let mut visited = HashSet::new();
    value_to_json_inner(v, &mut visited)
}

fn value_to_json_inner(v: &Value, visited: &mut std::collections::HashSet<usize>) -> serde_json::Value {
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
            let ptr_val = std::rc::Rc::as_ptr(list) as usize;
            if visited.contains(&ptr_val) {
                return serde_json::Value::String("<cycle>".to_string());
            }
            visited.insert(ptr_val);
            
            let res = match list.try_borrow() {
                Ok(borrowed_vec) => {
                    let arr = borrowed_vec.iter().map(|item| value_to_json_inner(item, visited)).collect();
                    serde_json::Value::Array(arr)
                }
                Err(_) => {
                    serde_json::Value::String("<borrowed>".to_string())
                }
            };
            
            visited.remove(&ptr_val);
            res
        },
        Value::Object(obj_rc) => {
            let ptr_val = std::rc::Rc::as_ptr(obj_rc) as usize;
            if visited.contains(&ptr_val) {
                return serde_json::Value::String("<cycle>".to_string());
            }
            visited.insert(ptr_val);
            
            let res = match obj_rc.try_borrow() {
                Ok(borrowed_map) => {
                    let mut map = serde_json::Map::new();
                    for (k, v) in borrowed_map.iter() {
                        map.insert(k.clone(), value_to_json_inner(v, visited));
                    }
                    serde_json::Value::Object(map)
                }
                Err(_) => {
                    serde_json::Value::String("<borrowed>".to_string())
                }
            };
            
            visited.remove(&ptr_val);
            res
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::opcodes::OpCode;

    #[test]
    fn test_execute_empty_bytecode() {
        let result = execute(&[], &[], "[]", &[]);
        // An empty bytecode payload should not panic, it should return an UnexpectedEndOfCode error or similar
        // because the PC will immediately go out of bounds.
        assert!(result.contains(r#"{"status": false, "error":"#));
    }

    #[test]
    fn test_execute_empty_image_and_map() {
        // Construct a minimal valid bytecode using identity map (PushInt(42), Halt)
        // PushInt = 0, operand = 42 (0x2A 00 00 00), Halt = 43
        // Actually, we must provide it via JIT, but if session_key is all 0s, cipher is identity!
        let mut bytecode = vec![0; 256]; // Need 256 bytes for JIT page
        bytecode[0] = OpCode::PushInt as u8;
        bytecode[1] = 42;
        bytecode[2] = 0;
        bytecode[3] = 0;
        bytecode[4] = 0;
        bytecode[5] = OpCode::Halt as u8;

        let mut opcode_map = [0u8; 256];
        for i in 0..256 {
            opcode_map[i] = i as u8;
        }

        let result = execute(&bytecode, &[], "[]", &opcode_map);
        // Should execute successfully and return 42
        assert_eq!(result, "42");
    }
}
