#![no_main]
use libfuzzer_sys::fuzz_target;
use vm_core::{Vm, Value, json_to_value, value_to_json};
use std::rc::Rc;
use std::cell::RefCell;
use std::collections::HashMap;

fuzz_target!(|data: &[u8]| {
    if data.is_empty() {
        return;
    }

    // 1. Fuzz VM initialization and execution
    let mut session_key = [0u8; 32];
    let mut expected_hash = [0u8; 32];
    let mut opcode_map = vec![0u8; 256];
    for i in 0..256 {
        opcode_map[i] = i as u8;
    }

    let mut offset = 0;
    if data.len() >= offset + 32 {
        session_key.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;
    }
    if data.len() >= offset + 32 {
        expected_hash.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;
    }
    if data.len() >= offset + 256 {
        opcode_map.copy_from_slice(&data[offset..offset + 256]);
        offset += 256;
    }

    let bytecode = if offset < data.len() {
        data[offset..].to_vec()
    } else {
        data.to_vec()
    };

    let mut vm = Vm::new(bytecode, opcode_map, session_key, expected_hash);
    vm.set_gas_limit(50_000); // Set a reasonable limit for fuzzing to avoid slow execution
    let _ = vm.run();

    // 2. Fuzz JSON conversions
    if let Ok(s) = std::str::from_utf8(data) {
        if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(s) {
            let val = json_to_value(&json_val);
            let _ = value_to_json(&val);
        }
    }

    // 3. Fuzz cycle-safety in JSON conversion explicitly
    // Create a cyclic list
    let list_inner = Rc::new(RefCell::new(Vec::new()));
    let list_val = Value::List(list_inner.clone());
    if let Ok(mut l) = list_inner.try_borrow_mut() {
        l.push(list_val.clone());
    }
    let _ = value_to_json(&list_val);

    // Create a cyclic object
    let obj_inner = Rc::new(RefCell::new(HashMap::new()));
    let obj_val = Value::Object(obj_inner.clone());
    if let Ok(mut o) = obj_inner.try_borrow_mut() {
        o.insert("self".to_string(), obj_val.clone());
    }
    let _ = value_to_json(&obj_val);
});
