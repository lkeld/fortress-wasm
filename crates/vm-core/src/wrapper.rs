use wasm_bindgen::prelude::*;
use crate::vm::Vm;
use crate::value::Value;

// No wee_alloc for now to keep dependencies simple

#[wasm_bindgen]
pub fn execute(bytecode: &[u8], constants_json: &str, input_json: &str) -> String {
    let mut parsed_constants = Vec::new();
    
    // Simple XOR decryption (key = 0x42) assuming the input is hex encoded if it doesn't start with '['
    let decrypted_json = if constants_json.starts_with('[') {
        constants_json.to_string()
    } else {
        let bytes = (0..constants_json.len())
            .step_by(2)
            .filter_map(|i| u8::from_str_radix(&constants_json[i..i + 2], 16).ok())
            .map(|b| b ^ 0x42)
            .collect::<Vec<u8>>();
        String::from_utf8(bytes).unwrap_or_else(|_| "[]".to_string())
    };

    if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&decrypted_json) {
        if let Some(arr) = json_val.as_array() {
            for v in arr {
                parsed_constants.push(json_to_value(v));
            }
        }
    }

    let mut vm = Vm::new(bytecode.to_vec(), parsed_constants);
    
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
            // Return some plausible garbage on error
            r#"{"status": false, "error": "execution_failed"}"#.to_string()
        }
    }
}

// Helpers to convert between our Value enum and serde_json::Value
fn json_to_value(v: &serde_json::Value) -> Value {
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

fn value_to_json(v: &Value) -> serde_json::Value {
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
