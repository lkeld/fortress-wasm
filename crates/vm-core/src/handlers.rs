use crate::vm::Vm;
use crate::stack::VmError;
use crate::value::Value;
use std::collections::HashMap;
use std::rc::Rc;
use std::cell::RefCell;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

pub fn op_invalid(_vm: &mut Vm) -> Result<bool, VmError> {
    // Return true to halt? No, we return Err for invalid
    Err(VmError::InvalidOpCode(0)) // Wait, the dispatch table doesn't pass the opcode byte, so we just return a generic error or just return true (halt).
    // Actually, in the monolithic dispatcher it printed and returned InvalidOpCode.
    // I will return InvalidOpCode(255) as a fallback.
}

pub fn op_pushint(vm: &mut Vm) -> Result<bool, VmError> {
    let val = vm.read_u32()? as i32 as i64;
    vm.stack.push(Value::Int(val))?;
    Ok(false)
}

pub fn op_pop(vm: &mut Vm) -> Result<bool, VmError> {
    vm.stack.pop()?;
    Ok(false)
}

pub fn op_dup(vm: &mut Vm) -> Result<bool, VmError> {
    vm.stack.dup()?;
    Ok(false)
}

pub fn op_pushfloat(vm: &mut Vm) -> Result<bool, VmError> {
    let val = f64::from_bits(vm.read_u64()?);
    vm.stack.push(Value::Float(val))?;
    Ok(false)
}

pub fn op_pushstring(vm: &mut Vm) -> Result<bool, VmError> {
    let nonce_u32 = vm.read_u32()?;
    let nonce = nonce_u32.to_le_bytes();
    let len = vm.read_u32()? as usize;
    if len > 65536 || len > (vm.code.len() - vm.get_pc()) {
        return Err(VmError::UnexpectedEndOfCode);
    }
    
    let mut keystream = Vec::with_capacity(len);
    let mut block_index = 0u32;
    while keystream.len() < len {
        use sha2::{Sha256, Digest};
        let mut hasher = Sha256::new();
        hasher.update(&vm.session_key);
        hasher.update(&nonce);
        hasher.update(&block_index.to_le_bytes());
        let block = hasher.finalize();
        
        let bytes_to_add = (len - keystream.len()).min(block.len());
        keystream.extend_from_slice(&block[..bytes_to_add]);
        block_index += 1;
    }

    let mut bytes = Vec::with_capacity(len);
    for j in 0..len {
        let enc_byte = vm.read_byte()?;
        bytes.push(enc_byte ^ keystream[j]);
    }
    let s = String::from_utf8(bytes).unwrap_or_else(|_| "INVALID_STR".to_string());
    vm.stack.push(Value::Str(std::sync::Arc::new(s)))?;
    Ok(false)
}

pub fn op_pushbool(vm: &mut Vm) -> Result<bool, VmError> {
    let val = vm.read_u32()?;
    vm.stack.push(Value::Bool(val != 0))?;
    Ok(false)
}

pub fn op_pushnull(vm: &mut Vm) -> Result<bool, VmError> {
    vm.stack.push(Value::Null)?;
    Ok(false)
}

pub fn op_loadlocal(vm: &mut Vm) -> Result<bool, VmError> {
    let idx = vm.read_u32()? as usize;
    let val = vm.locals.get(idx).ok_or(VmError::InvalidLocalSlot)?.clone();
    vm.stack.push(val)?;
    Ok(false)
}

pub fn op_storelocal(vm: &mut Vm) -> Result<bool, VmError> {
    let idx = vm.read_u32()? as usize;
    let val = vm.stack.pop()?;
    let slot = vm.locals.get_mut(idx).ok_or(VmError::InvalidLocalSlot)?;
    *slot = val;
    Ok(false)
}

pub fn op_add(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    match (a, b) {
        (Value::Int(a_val), Value::Int(b_val)) => vm.stack.push(Value::Int(a_val + b_val))?,
        (Value::Float(a_val), Value::Float(b_val)) => vm.stack.push(Value::Float(a_val + b_val))?,
        (Value::Int(a_val), Value::Float(b_val)) => vm.stack.push(Value::Float(a_val as f64 + b_val))?,
        (Value::Float(a_val), Value::Int(b_val)) => vm.stack.push(Value::Float(a_val + b_val as f64))?,
        (Value::Str(a_val), Value::Str(b_val)) => {
            let mut res = String::new();
            res.push_str(&a_val);
            res.push_str(&b_val);
            vm.stack.push(Value::Str(std::sync::Arc::new(res)))?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_sub(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    match (a, b) {
        (Value::Int(a_val), Value::Int(b_val)) => vm.stack.push(Value::Int(a_val - b_val))?,
        (Value::Float(a_val), Value::Float(b_val)) => vm.stack.push(Value::Float(a_val - b_val))?,
        (Value::Int(a_val), Value::Float(b_val)) => vm.stack.push(Value::Float(a_val as f64 - b_val))?,
        (Value::Float(a_val), Value::Int(b_val)) => vm.stack.push(Value::Float(a_val - b_val as f64))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_mul(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    match (a, b) {
        (Value::Int(a_val), Value::Int(b_val)) => vm.stack.push(Value::Int(a_val * b_val))?,
        (Value::Float(a_val), Value::Float(b_val)) => vm.stack.push(Value::Float(a_val * b_val))?,
        (Value::Int(a_val), Value::Float(b_val)) => vm.stack.push(Value::Float(a_val as f64 * b_val))?,
        (Value::Float(a_val), Value::Int(b_val)) => vm.stack.push(Value::Float(a_val * b_val as f64))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_div(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    match (a, b) {
        (Value::Int(a_val), Value::Int(b_val)) => {
            let res = a_val as f64 / b_val as f64;
            if res.fract() == 0.0 && res.is_finite() {
                vm.stack.push(Value::Int(res as i64))?;
            } else {
                vm.stack.push(Value::Float(res))?;
            }
        }
        (Value::Float(a_val), Value::Float(b_val)) => {
            let res = a_val / b_val;
            if res.fract() == 0.0 && res.is_finite() {
                vm.stack.push(Value::Int(res as i64))?;
            } else {
                vm.stack.push(Value::Float(res))?;
            }
        }
        (Value::Int(a_val), Value::Float(b_val)) => {
            let res = a_val as f64 / b_val;
            if res.fract() == 0.0 && res.is_finite() {
                vm.stack.push(Value::Int(res as i64))?;
            } else {
                vm.stack.push(Value::Float(res))?;
            }
        }
        (Value::Float(a_val), Value::Int(b_val)) => {
            let res = a_val / b_val as f64;
            if res.fract() == 0.0 && res.is_finite() {
                vm.stack.push(Value::Int(res as i64))?;
            } else {
                vm.stack.push(Value::Float(res))?;
            }
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_eq(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    vm.stack.push(Value::Bool(a == b))?;
    Ok(false)
}

pub fn op_neq(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    vm.stack.push(Value::Bool(a != b))?;
    Ok(false)
}

pub fn op_lt(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    match (a, b) {
        (Value::Int(a_val), Value::Int(b_val)) => vm.stack.push(Value::Bool(a_val < b_val))?,
        (Value::Float(a_val), Value::Float(b_val)) => vm.stack.push(Value::Bool(a_val < b_val))?,
        (Value::Int(a_val), Value::Float(b_val)) => vm.stack.push(Value::Bool((a_val as f64) < b_val))?,
        (Value::Float(a_val), Value::Int(b_val)) => vm.stack.push(Value::Bool(a_val < (b_val as f64)))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_gt(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    match (a, b) {
        (Value::Int(a_val), Value::Int(b_val)) => vm.stack.push(Value::Bool(a_val > b_val))?,
        (Value::Float(a_val), Value::Float(b_val)) => vm.stack.push(Value::Bool(a_val > b_val))?,
        (Value::Int(a_val), Value::Float(b_val)) => vm.stack.push(Value::Bool((a_val as f64) > b_val))?,
        (Value::Float(a_val), Value::Int(b_val)) => vm.stack.push(Value::Bool(a_val > (b_val as f64)))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_lte(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    match (a, b) {
        (Value::Int(a_val), Value::Int(b_val)) => vm.stack.push(Value::Bool(a_val <= b_val))?,
        (Value::Float(a_val), Value::Float(b_val)) => vm.stack.push(Value::Bool(a_val <= b_val))?,
        (Value::Int(a_val), Value::Float(b_val)) => vm.stack.push(Value::Bool((a_val as f64) <= b_val))?,
        (Value::Float(a_val), Value::Int(b_val)) => vm.stack.push(Value::Bool(a_val <= (b_val as f64)))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_gte(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    match (a, b) {
        (Value::Int(a_val), Value::Int(b_val)) => vm.stack.push(Value::Bool(a_val >= b_val))?,
        (Value::Float(a_val), Value::Float(b_val)) => vm.stack.push(Value::Bool(a_val >= b_val))?,
        (Value::Int(a_val), Value::Float(b_val)) => vm.stack.push(Value::Bool((a_val as f64) >= b_val))?,
        (Value::Float(a_val), Value::Int(b_val)) => vm.stack.push(Value::Bool(a_val >= (b_val as f64)))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_and(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    vm.stack.push(Value::Bool(a.is_truthy() && b.is_truthy()))?;
    Ok(false)
}

pub fn op_or(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    vm.stack.push(Value::Bool(a.is_truthy() || b.is_truthy()))?;
    Ok(false)
}

pub fn op_not(vm: &mut Vm) -> Result<bool, VmError> {
    let a = vm.stack.pop()?;
    vm.stack.push(Value::Bool(!a.is_truthy()))?;
    Ok(false)
}

pub fn op_bitand(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    match (a, b) {
        (Value::Int(a_val), Value::Int(b_val)) => vm.stack.push(Value::Int(a_val & b_val))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_bitor(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    match (a, b) {
        (Value::Int(a_val), Value::Int(b_val)) => vm.stack.push(Value::Int(a_val | b_val))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_bitxor(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    match (a, b) {
        (Value::Int(a_val), Value::Int(b_val)) => vm.stack.push(Value::Int(a_val ^ b_val))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_bitnot(vm: &mut Vm) -> Result<bool, VmError> {
    let a = vm.stack.pop()?;
    match a {
        Value::Int(a_val) => vm.stack.push(Value::Int(!a_val))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_shl(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    let val_a = match a {
        Value::Int(i) => i as i32,
        Value::Float(f) => f as i32,
        _ => return Err(VmError::TypeError),
    };
    let val_b = match b {
        Value::Int(i) => i as i32,
        Value::Float(f) => f as i32,
        _ => return Err(VmError::TypeError),
    };
    let shift = val_b & 0x1F;
    let res = val_a.wrapping_shl(shift as u32);
    vm.stack.push(Value::Int(res as i64))?;
    Ok(false)
}

pub fn op_shr(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    let val_a = match a {
        Value::Int(i) => i as i32,
        Value::Float(f) => f as i32,
        _ => return Err(VmError::TypeError),
    };
    let val_b = match b {
        Value::Int(i) => i as i32,
        Value::Float(f) => f as i32,
        _ => return Err(VmError::TypeError),
    };
    let shift = val_b & 0x1F;
    let res = val_a.wrapping_shr(shift as u32);
    vm.stack.push(Value::Int(res as i64))?;
    Ok(false)
}

pub fn op_jump(vm: &mut Vm) -> Result<bool, VmError> {
    let target = vm.read_u32()? as usize;
    vm.set_pc(target);
    Ok(false)
}

pub fn op_jumpif(vm: &mut Vm) -> Result<bool, VmError> {
    let target = vm.read_u32()? as usize;
    let cond = vm.stack.pop()?;
    if cond.is_truthy() {
        vm.set_pc(target);
    }
    Ok(false)
}

pub fn op_jumpifnot(vm: &mut Vm) -> Result<bool, VmError> {
    let target = vm.read_u32()? as usize;
    let cond = vm.stack.pop()?;
    if !cond.is_truthy() {
        vm.set_pc(target);
    }
    Ok(false)
}

pub fn op_newobject(vm: &mut Vm) -> Result<bool, VmError> {
    vm.stack.push(Value::Object(Rc::new(RefCell::new(HashMap::new()))))?;
    Ok(false)
}

pub fn op_newlist(vm: &mut Vm) -> Result<bool, VmError> {
    vm.stack.push(Value::List(Rc::new(RefCell::new(Vec::new()))))?;
    Ok(false)
}

pub fn op_listpush(vm: &mut Vm) -> Result<bool, VmError> {
    let val = vm.stack.pop()?;
    let list = vm.stack.pop()?;
    if let Value::List(ref vec) = list {
        vec.try_borrow_mut().map_err(|_| VmError::BorrowError)?.push(val);
        vm.stack.push(list)?;
    } else {
        return Err(VmError::TypeError);
    }
    Ok(false)
}

pub fn op_getmember(vm: &mut Vm) -> Result<bool, VmError> {
    let key = vm.stack.pop()?;
    let target = vm.stack.pop()?;
    match target {
        Value::Object(map_rc) => {
            if let Value::Str(s) = key {
                let map = map_rc.try_borrow().map_err(|_| VmError::BorrowError)?;
                let val = map.get(s.as_str()).cloned().unwrap_or(Value::Null);
                vm.stack.push(val)?;
            } else {
                return Err(VmError::TypeError);
            }
        }
        Value::List(vec_rc) => {
            let i = match key {
                Value::Int(i) => i,
                Value::Float(f) if f.fract() == 0.0 => f as i64,
                _ => return Err(VmError::TypeError),
            };
            let idx = usize::try_from(i).map_err(|_| VmError::IndexOutOfBounds)?;
            let vec = vec_rc.try_borrow().map_err(|_| VmError::BorrowError)?;
            if idx < vec.len() {
                let val = vec.get(idx).cloned().unwrap_or(Value::Null);
                vm.stack.push(val)?;
            } else {
                return Err(VmError::IndexOutOfBounds);
            }
        }
        Value::Str(s) => {
            let i = match key {
                Value::Int(i) => i,
                Value::Float(f) if f.fract() == 0.0 => f as i64,
                _ => return Err(VmError::TypeError),
            };
            let idx = usize::try_from(i).map_err(|_| VmError::IndexOutOfBounds)?;
            let char_count = s.chars().count();
            if idx < char_count {
                let ch = s.chars().nth(idx).unwrap_or('\0').to_string();
                vm.stack.push(Value::Str(std::sync::Arc::new(ch)))?;
            } else {
                return Err(VmError::IndexOutOfBounds);
            }
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_setmember(vm: &mut Vm) -> Result<bool, VmError> {
    let val = vm.stack.pop()?;
    let key = vm.stack.pop()?;
    let target = vm.stack.pop()?;
    match target {
        Value::Object(ref map_rc) => {
            if let Value::Str(s) = key {
                map_rc.try_borrow_mut().map_err(|_| VmError::BorrowError)?.insert(s.to_string(), val);
                vm.stack.push(target.clone())?;
            } else {
                return Err(VmError::TypeError);
            }
        }
        Value::List(ref vec_rc) => {
            let i = match key {
                Value::Int(i) => i,
                Value::Float(f) if f.fract() == 0.0 => f as i64,
                _ => return Err(VmError::TypeError),
            };
            let idx = usize::try_from(i).map_err(|_| VmError::IndexOutOfBounds)?;
            let mut vec = vec_rc.try_borrow_mut().map_err(|_| VmError::BorrowError)?;
            if idx < vec.len() {
                let slot = vec.get_mut(idx).ok_or(VmError::IndexOutOfBounds)?;
                *slot = val;
            } else if idx == vec.len() {
                vec.push(val);
            } else {
                return Err(VmError::IndexOutOfBounds);
            }
            vm.stack.push(target.clone())?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_length(vm: &mut Vm) -> Result<bool, VmError> {
    let target = vm.stack.pop()?;
    match target {
        Value::List(vec_rc) => {
            let len = vec_rc.try_borrow().map_err(|_| VmError::BorrowError)?.len();
            vm.stack.push(Value::Int(len as i64))?;
        }
        Value::Str(s) => {
            vm.stack.push(Value::Int(s.len() as i64))?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_hash256(vm: &mut Vm) -> Result<bool, VmError> {
    let val = vm.stack.pop()?;
    let str_val = match val {
        Value::Str(s) => s.to_string(),
        Value::Int(i) => i.to_string(),
        Value::Float(f) => to_js_string(f),
        Value::Bool(b) => b.to_string(),
        _ => return Err(VmError::TypeError),
    };
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(str_val.as_bytes());
    let result = hasher.finalize();
    let hex_str = format!("{:x}", result);
    vm.stack.push(Value::Str(std::sync::Arc::new(hex_str)))?;
    Ok(false)
}

pub fn op_encryptaes(vm: &mut Vm) -> Result<bool, VmError> {
    let key_val = vm.stack.pop()?;
    let payload_val = vm.stack.pop()?;
    
    if let (Value::Str(key_str), Value::Str(payload_str)) = (key_val, payload_val) {
        let mut key_bytes = [0u8; 32];
        let kb = key_str.as_bytes();
        let len = kb.len().min(32);
        key_bytes[..len].copy_from_slice(&kb[..len]);
        
        let res = match crypto_core::encrypt_aes_gcm(payload_str.as_bytes(), &key_bytes) {
            Ok(encrypted) => {
                let mut hex_str = String::with_capacity(encrypted.len() * 2);
                for byte in encrypted {
                    use std::fmt::Write;
                    write!(&mut hex_str, "{:02x}", byte).unwrap();
                }
                vm.stack.push(Value::Str(std::sync::Arc::new(hex_str)))?;
                Ok(false)
            }
            Err(_) => Err(VmError::TypeError),
        };
        use zeroize::Zeroize;
        key_bytes.zeroize();
        res
    } else {
        Err(VmError::TypeError)
    }
}

pub fn op_jsonstringify(vm: &mut Vm) -> Result<bool, VmError> {
    let val = vm.stack.pop()?;
    let json_val = crate::wrapper::value_to_json(&val);
    let json_str = json_val.to_string();
    vm.stack.push(Value::Str(std::sync::Arc::new(json_str)))?;
    Ok(false)
}

pub fn op_call(vm: &mut Vm) -> Result<bool, VmError> {
    let target = vm.read_u32()? as usize;
    let arg_count = vm.read_u32()? as usize;
    
    if arg_count > 256 {
        return Err(VmError::InvalidLocalSlot);
    }
    
    let mut new_locals = vec![Value::Null; 256];
    for i in (0..arg_count).rev() {
        new_locals[i] = vm.stack.pop()?;
    }

    if vm.frames.len() >= 64 {
        return Err(VmError::CallStackOverflow);
    }
    
    vm.frames.push(crate::vm::CallFrame {
        pc_base: vm.pc_base,
        pc_offset: vm.pc_offset,
        locals: std::mem::replace(&mut vm.locals, new_locals),
    });
    
    vm.set_pc(target);
    Ok(false)
}

pub fn op_return(vm: &mut Vm) -> Result<bool, VmError> {
    let ret_val = vm.stack.pop().unwrap_or(Value::Null);
    if let Some(frame) = vm.frames.pop() {
        vm.locals = frame.locals;
        vm.pc_base = frame.pc_base;
        vm.pc_offset = frame.pc_offset;
        vm.stack.push(ret_val)?;
        Ok(false)
    } else {
        vm.stack.push(ret_val)?;
        Ok(true) // Halt
    }
}

pub fn op_callnative(vm: &mut Vm) -> Result<bool, VmError> {
    #[allow(unused_variables)]
    let id = vm.read_u32()?;
    let arg_count = vm.read_u32()? as usize;
    let mut args = Vec::new();
    for _ in 0..arg_count {
        args.push(vm.stack.pop()?);
    }
    args.reverse();
    
    let mut json_arr = serde_json::Value::Array(Vec::new());
    if let serde_json::Value::Array(ref mut arr) = json_arr {
        for arg in args {
            arr.push(crate::wrapper::value_to_json(&arg));
        }
    }
    #[allow(unused_variables)]
    let args_json = json_arr.to_string();
    
    #[cfg(target_arch = "wasm32")]
    let res_str = crate::vm::native_call(id, &args_json);
    
    #[cfg(not(target_arch = "wasm32"))]
    let res_str = "{}".to_string(); // Mock for non-wasm targets
    
    if res_str.len() > 4096 {
        vm.stack.push(Value::Str(std::sync::Arc::new("PayloadTooLarge".to_string())))?;
    } else if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&res_str) {
        vm.stack.push(crate::wrapper::json_to_value(&json_val))?;
    } else {
        vm.stack.push(Value::Str(std::sync::Arc::new(res_str)))?;
    }
    Ok(false)
}

pub fn op_halt(_vm: &mut Vm) -> Result<bool, VmError> {
    Ok(true)
}

pub fn op_concat(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    match (a, b) {
        (Value::Str(a_val), Value::Str(b_val)) => {
            let mut res = String::new();
            res.push_str(&a_val);
            res.push_str(&b_val);
            vm.stack.push(Value::Str(std::sync::Arc::new(res)))?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

// Superoperators that combine multiple basic operations to defeat pattern matching
pub fn op_compareandadd(vm: &mut Vm) -> Result<bool, VmError> {
    // Compare top two values
    op_eq(vm)?;
    // Save the boolean result
    let bool_val = vm.stack.pop()?;
    // Add the next two values
    op_add(vm)?;
    // Push the boolean result back on top
    vm.stack.push(bool_val)?;
    Ok(false)
}

pub fn op_swapandmul(vm: &mut Vm) -> Result<bool, VmError> {
    op_swap(vm)?;
    op_mul(vm)?;
    Ok(false)
}

pub fn op_jumpandmul(vm: &mut Vm) -> Result<bool, VmError> {
    let target = vm.read_u32()? as usize;
    let cond = vm.stack.pop()?;
    if cond.is_truthy() {
        vm.set_pc(target);
    } else {
        op_mul(vm)?;
    }
    Ok(false)
}

pub fn op_swap(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    vm.stack.push(b)?;
    vm.stack.push(a)?;
    Ok(false)
}

pub fn op_rotate(vm: &mut Vm) -> Result<bool, VmError> {
    let c = vm.stack.pop()?;
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    vm.stack.push(b)?;
    vm.stack.push(c)?;
    vm.stack.push(a)?;
    Ok(false)
}

pub fn op_drop2(vm: &mut Vm) -> Result<bool, VmError> {
    vm.stack.pop()?;
    vm.stack.pop()?;
    Ok(false)
}

// ----------------------------------------------------
// 74 New Opcodes Handler Implementation
// ----------------------------------------------------

use crate::vm::CachedRegex;

// Helper methods
fn pop_string(vm: &mut Vm) -> Result<std::sync::Arc<String>, VmError> {
    match vm.stack.pop()? {
        Value::Str(s) => Ok(s),
        _ => Err(VmError::TypeError),
    }
}

fn to_js_string(f: f64) -> String {
    if f.is_nan() {
        return "NaN".to_string();
    }
    if f.is_infinite() {
        return if f.is_sign_positive() {
            "Infinity".to_string()
        } else {
            "-Infinity".to_string()
        };
    }
    if f == 0.0 || f == -0.0 {
        return "0".to_string();
    }

    let abs_f = f.abs();
    if abs_f < 1e-6 || abs_f >= 1e21 {
        let s = format!("{:e}", f);
        if let Some(pos) = s.find('e') {
            let (coef, exp_str) = s.split_at(pos);
            let exp_val = exp_str[1..].parse::<i32>().unwrap_or(0);
            let exp_sign = if exp_val >= 0 { "+" } else { "" };
            let mut coef_clean = coef.to_string();
            if coef_clean.ends_with(".0") {
                coef_clean.truncate(coef_clean.len() - 2);
            }
            return format!("{}e{}{}", coef_clean, exp_sign, exp_val);
        }
        s
    } else {
        f.to_string()
    }
}

fn to_f64(v: &Value) -> Result<f64, VmError> {
    match v {
        Value::Int(i) => Ok(*i as f64),
        Value::Float(f) => Ok(*f),
        _ => Err(VmError::TypeError),
    }
}

fn f64_to_u32(f: f64) -> u32 {
    if f.is_nan() || f.is_infinite() {
        0
    } else {
        let f = f % 4294967296.0;
        let i = f as i64;
        i as u32
    }
}

fn js_round(f: f64) -> f64 {
    if f.is_nan() || f.is_infinite() {
        f
    } else {
        let rounded = (f + 0.5).floor();
        if rounded == 0.0 && f < 0.0 {
            -0.0
        } else {
            rounded
        }
    }
}

fn js_sign_int(i: i64) -> i64 {
    if i > 0 {
        1
    } else if i < 0 {
        -1
    } else {
        0
    }
}

fn js_sign_float(f: f64) -> f64 {
    if f.is_nan() {
        f64::NAN
    } else if f == 0.0 {
        f
    } else if f > 0.0 {
        1.0
    } else {
        -1.0
    }
}

fn f64_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.max(b)
    }
}

fn f64_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.min(b)
    }
}

// ----------------- Math Opcodes (32) -----------------

pub fn op_mathfloor(vm: &mut Vm) -> Result<bool, VmError> {
    let a = vm.stack.pop()?;
    match a {
        Value::Int(i) => vm.stack.push(Value::Int(i))?,
        Value::Float(f) => vm.stack.push(Value::Float(f.floor()))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_mathceil(vm: &mut Vm) -> Result<bool, VmError> {
    let a = vm.stack.pop()?;
    match a {
        Value::Int(i) => vm.stack.push(Value::Int(i))?,
        Value::Float(f) => vm.stack.push(Value::Float(f.ceil()))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_mathround(vm: &mut Vm) -> Result<bool, VmError> {
    let a = vm.stack.pop()?;
    match a {
        Value::Int(i) => vm.stack.push(Value::Int(i))?,
        Value::Float(f) => vm.stack.push(Value::Float(js_round(f)))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_mathabs(vm: &mut Vm) -> Result<bool, VmError> {
    let a = vm.stack.pop()?;
    match a {
        Value::Int(i) => vm.stack.push(Value::Int(i.abs()))?,
        Value::Float(f) => vm.stack.push(Value::Float(f.abs()))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_mathsqrt(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.sqrt()))?;
    Ok(false)
}

pub fn op_mathpow(vm: &mut Vm) -> Result<bool, VmError> {
    let e = to_f64(&vm.stack.pop()?)?;
    let b = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(b.powf(e)))?;
    Ok(false)
}

pub fn op_mathlog(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.ln()))?;
    Ok(false)
}

pub fn op_mathlog2(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.log2()))?;
    Ok(false)
}

pub fn op_mathlog10(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.log10()))?;
    Ok(false)
}

pub fn op_mathsin(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.sin()))?;
    Ok(false)
}

pub fn op_mathcos(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.cos()))?;
    Ok(false)
}

pub fn op_mathtan(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.tan()))?;
    Ok(false)
}

pub fn op_mathasin(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.asin()))?;
    Ok(false)
}

pub fn op_mathacos(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.acos()))?;
    Ok(false)
}

pub fn op_mathatan(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.atan()))?;
    Ok(false)
}

pub fn op_mathatan2(vm: &mut Vm) -> Result<bool, VmError> {
    let x = to_f64(&vm.stack.pop()?)?;
    let y = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(y.atan2(x)))?;
    Ok(false)
}

pub fn op_mathmax(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    match (a, b) {
        (Value::Int(a_val), Value::Int(b_val)) => vm.stack.push(Value::Int(a_val.max(b_val)))?,
        (Value::Float(a_val), Value::Float(b_val)) => vm.stack.push(Value::Float(f64_max(a_val, b_val)))?,
        (Value::Int(a_val), Value::Float(b_val)) => vm.stack.push(Value::Float(f64_max(a_val as f64, b_val)))?,
        (Value::Float(a_val), Value::Int(b_val)) => vm.stack.push(Value::Float(f64_max(a_val, b_val as f64)))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_mathmin(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    match (a, b) {
        (Value::Int(a_val), Value::Int(b_val)) => vm.stack.push(Value::Int(a_val.min(b_val)))?,
        (Value::Float(a_val), Value::Float(b_val)) => vm.stack.push(Value::Float(f64_min(a_val, b_val)))?,
        (Value::Int(a_val), Value::Float(b_val)) => vm.stack.push(Value::Float(f64_min(a_val as f64, b_val)))?,
        (Value::Float(a_val), Value::Int(b_val)) => vm.stack.push(Value::Float(f64_min(a_val, b_val as f64)))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_mathsign(vm: &mut Vm) -> Result<bool, VmError> {
    let a = vm.stack.pop()?;
    match a {
        Value::Int(i) => vm.stack.push(Value::Int(js_sign_int(i)))?,
        Value::Float(f) => vm.stack.push(Value::Float(js_sign_float(f)))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_mathtrunc(vm: &mut Vm) -> Result<bool, VmError> {
    let a = vm.stack.pop()?;
    match a {
        Value::Int(i) => vm.stack.push(Value::Int(i))?,
        Value::Float(f) => vm.stack.push(Value::Float(f.trunc()))?,
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_mathhypot(vm: &mut Vm) -> Result<bool, VmError> {
    let b = to_f64(&vm.stack.pop()?)?;
    let a = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(a.hypot(b)))?;
    Ok(false)
}

pub fn op_mathexp(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.exp()))?;
    Ok(false)
}

pub fn op_mathexpm1(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.exp_m1()))?;
    Ok(false)
}

pub fn op_mathlog1p(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.ln_1p()))?;
    Ok(false)
}

pub fn op_mathsinh(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.sinh()))?;
    Ok(false)
}

pub fn op_mathcosh(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.cosh()))?;
    Ok(false)
}

pub fn op_mathtanh(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.tanh()))?;
    Ok(false)
}

pub fn op_mathcbrt(vm: &mut Vm) -> Result<bool, VmError> {
    let f = to_f64(&vm.stack.pop()?)?;
    vm.stack.push(Value::Float(f.cbrt()))?;
    Ok(false)
}

pub fn op_mathclz32(vm: &mut Vm) -> Result<bool, VmError> {
    let a = vm.stack.pop()?;
    let val = match a {
        Value::Int(i) => i as u32,
        Value::Float(f) => f64_to_u32(f),
        _ => return Err(VmError::TypeError),
    };
    vm.stack.push(Value::Int(val.leading_zeros() as i64))?;
    Ok(false)
}

pub fn op_mathfround(vm: &mut Vm) -> Result<bool, VmError> {
    let a = vm.stack.pop()?;
    let val = match a {
        Value::Int(i) => i as f32 as f64,
        Value::Float(f) => f as f32 as f64,
        _ => return Err(VmError::TypeError),
    };
    vm.stack.push(Value::Float(val))?;
    Ok(false)
}

pub fn op_mathimul(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    let val_a = match a {
        Value::Int(i) => i as i32,
        Value::Float(f) => f64_to_u32(f) as i32,
        _ => return Err(VmError::TypeError),
    };
    let val_b = match b {
        Value::Int(i) => i as i32,
        Value::Float(f) => f64_to_u32(f) as i32,
        _ => return Err(VmError::TypeError),
    };
    let res = val_a.wrapping_mul(val_b);
    vm.stack.push(Value::Int(res as i64))?;
    Ok(false)
}

pub fn op_mathrandom(vm: &mut Vm) -> Result<bool, VmError> {
    let mut buf = [0u8; 8];
    getrandom::getrandom(&mut buf).map_err(|_| VmError::RuntimeError)?;
    let bits = u64::from_le_bytes(buf);
    let r = (bits >> 11) as f64 * (1.0f64 / (1u64 << 53) as f64);
    vm.stack.push(Value::Float(r))?;
    Ok(false)
}

// ----------------- String Opcodes (22) -----------------

pub fn op_strindexof(vm: &mut Vm) -> Result<bool, VmError> {
    let search = pop_string(vm)?;
    let s = pop_string(vm)?;
    let result = match s.find(search.as_str()) {
        Some(byte_idx) => s.get(0..byte_idx).map_or(0, |sub| sub.encode_utf16().count()) as i64,
        None => -1,
    };
    vm.stack.push(Value::Int(result))?;
    Ok(false)
}

pub fn op_strlastindexof(vm: &mut Vm) -> Result<bool, VmError> {
    let search = pop_string(vm)?;
    let s = pop_string(vm)?;
    let result = match s.rfind(search.as_str()) {
        Some(byte_idx) => s.get(0..byte_idx).map_or(0, |sub| sub.encode_utf16().count()) as i64,
        None => -1,
    };
    vm.stack.push(Value::Int(result))?;
    Ok(false)
}

pub fn op_strslice(vm: &mut Vm) -> Result<bool, VmError> {
    let end = vm.stack.pop()?;
    let start = vm.stack.pop()?;
    let s = pop_string(vm)?;
    
    let len = s.encode_utf16().count() as i64;
    let start_idx = match start {
        Value::Int(i) => if i < 0 { (len + i).max(0) as usize } else { i.min(len) as usize },
        _ => return Err(VmError::TypeError),
    };
    let end_idx = match end {
        Value::Int(i) => if i < 0 { (len + i).max(0) as usize } else { i.min(len) as usize },
        Value::Null => len as usize,
        _ => return Err(VmError::TypeError),
    };
    
    let lo = start_idx;
    let hi = end_idx;
    let result: String = if lo < hi && lo < len as usize {
        let actual_hi = hi.min(len as usize);
        std::char::decode_utf16(s.encode_utf16().skip(lo).take(actual_hi - lo))
            .map(|r| r.unwrap_or('\u{FFFD}'))
            .collect()
    } else {
        String::new()
    };
    
    vm.stack.push(Value::Str(std::sync::Arc::new(result)))?;
    Ok(false)
}

pub fn op_strreplace(vm: &mut Vm) -> Result<bool, VmError> {
    let replacement = pop_string(vm)?;
    let search = pop_string(vm)?;
    let s = pop_string(vm)?;
    let res = s.replacen(search.as_str(), replacement.as_str(), 1);
    vm.stack.push(Value::Str(std::sync::Arc::new(res)))?;
    Ok(false)
}

pub fn op_strreplaceall(vm: &mut Vm) -> Result<bool, VmError> {
    let replacement = pop_string(vm)?;
    let search = pop_string(vm)?;
    let s = pop_string(vm)?;
    let res = s.replace(search.as_str(), replacement.as_str());
    vm.stack.push(Value::Str(std::sync::Arc::new(res)))?;
    Ok(false)
}

pub fn op_strsplit(vm: &mut Vm) -> Result<bool, VmError> {
    let sep = pop_string(vm)?;
    let s = pop_string(vm)?;
    let parts: Vec<Value> = s.split(sep.as_str())
        .map(|p| Value::Str(std::sync::Arc::new(p.to_string())))
        .collect();
    vm.stack.push(Value::List(std::rc::Rc::new(std::cell::RefCell::new(parts))))?;
    Ok(false)
}

pub fn op_strtolower(vm: &mut Vm) -> Result<bool, VmError> {
    let s = pop_string(vm)?;
    let res = s.to_lowercase();
    vm.stack.push(Value::Str(std::sync::Arc::new(res)))?;
    Ok(false)
}

pub fn op_strtoupper(vm: &mut Vm) -> Result<bool, VmError> {
    let s = pop_string(vm)?;
    let res = s.to_uppercase();
    vm.stack.push(Value::Str(std::sync::Arc::new(res)))?;
    Ok(false)
}

pub fn op_strtrim(vm: &mut Vm) -> Result<bool, VmError> {
    let s = pop_string(vm)?;
    let res = s.trim().to_string();
    vm.stack.push(Value::Str(std::sync::Arc::new(res)))?;
    Ok(false)
}

pub fn op_strtrimstart(vm: &mut Vm) -> Result<bool, VmError> {
    let s = pop_string(vm)?;
    let res = s.trim_start().to_string();
    vm.stack.push(Value::Str(std::sync::Arc::new(res)))?;
    Ok(false)
}

pub fn op_strtrimend(vm: &mut Vm) -> Result<bool, VmError> {
    let s = pop_string(vm)?;
    let res = s.trim_end().to_string();
    vm.stack.push(Value::Str(std::sync::Arc::new(res)))?;
    Ok(false)
}

pub fn op_strrepeat(vm: &mut Vm) -> Result<bool, VmError> {
    let count = match vm.stack.pop()? {
        Value::Int(i) => i,
        _ => return Err(VmError::TypeError),
    };
    let s = pop_string(vm)?;
    if count < 0 {
        return Err(VmError::TypeError);
    }
    let res = s.repeat(count as usize);
    vm.stack.push(Value::Str(std::sync::Arc::new(res)))?;
    Ok(false)
}

pub fn op_strpadstart(vm: &mut Vm) -> Result<bool, VmError> {
    let pad_str = pop_string(vm)?;
    let target_length = match vm.stack.pop()? {
        Value::Int(i) => i,
        _ => return Err(VmError::TypeError),
    };
    let s = pop_string(vm)?;
    
    let cur_len = s.encode_utf16().count() as i64;
    if target_length <= cur_len {
        vm.stack.push(Value::Str(s))?;
        return Ok(false);
    }
    
    let pad_len = target_length - cur_len;
    let mut padding = String::new();
    let pad_chars: Vec<u16> = pad_str.encode_utf16().collect();
    if !pad_chars.is_empty() {
        let mut idx = 0;
        for _ in 0..pad_len {
            if let Some(ch) = pad_chars.get(idx % pad_chars.len()) {
                padding.push_str(&String::from_utf16_lossy(&[*ch]));
            }
            idx += 1;
        }
    } else {
        for _ in 0..pad_len {
            padding.push(' ');
        }
    }
    
    let res = padding + &s;
    vm.stack.push(Value::Str(std::sync::Arc::new(res)))?;
    Ok(false)
}

pub fn op_strpadend(vm: &mut Vm) -> Result<bool, VmError> {
    let pad_str = pop_string(vm)?;
    let target_length = match vm.stack.pop()? {
        Value::Int(i) => i,
        _ => return Err(VmError::TypeError),
    };
    let s = pop_string(vm)?;
    
    let cur_len = s.encode_utf16().count() as i64;
    if target_length <= cur_len {
        vm.stack.push(Value::Str(s))?;
        return Ok(false);
    }
    
    let pad_len = target_length - cur_len;
    let mut padding = String::new();
    let pad_chars: Vec<u16> = pad_str.encode_utf16().collect();
    if !pad_chars.is_empty() {
        let mut idx = 0;
        for _ in 0..pad_len {
            if let Some(ch) = pad_chars.get(idx % pad_chars.len()) {
                padding.push_str(&String::from_utf16_lossy(&[*ch]));
            }
            idx += 1;
        }
    } else {
        for _ in 0..pad_len {
            padding.push(' ');
        }
    }
    
    let res = (*s).clone() + &padding;
    vm.stack.push(Value::Str(std::sync::Arc::new(res)))?;
    Ok(false)
}

pub fn op_strcharcodeat(vm: &mut Vm) -> Result<bool, VmError> {
    let idx = match vm.stack.pop()? { Value::Int(i) => i, _ => return Err(VmError::TypeError) };
    let s = pop_string(vm)?;
    
    if idx < 0 {
        vm.stack.push(Value::Float(f64::NAN))?;
        return Ok(false);
    }
    
    match s.encode_utf16().nth(idx as usize) {
        Some(val) => vm.stack.push(Value::Int(val as i64))?,
        None => vm.stack.push(Value::Float(f64::NAN))?,
    }
    Ok(false)
}

pub fn op_strfromcharcode(vm: &mut Vm) -> Result<bool, VmError> {
    let code = match vm.stack.pop()? {
        Value::Int(i) => (i & 0xFFFF) as u16,
        Value::Float(f) => {
            if f.is_nan() || f.is_infinite() {
                0
            } else {
                let val = (f % 65536.0) as i32;
                if val < 0 { (val + 65536) as u16 } else { val as u16 }
            }
        }
        _ => return Err(VmError::TypeError),
    };
    let res = String::from_utf16_lossy(&[code]);
    vm.stack.push(Value::Str(std::sync::Arc::new(res)))?;
    Ok(false)
}

pub fn op_strstartswith(vm: &mut Vm) -> Result<bool, VmError> {
    let search = pop_string(vm)?;
    let s = pop_string(vm)?;
    let res = s.starts_with(search.as_str());
    vm.stack.push(Value::Bool(res))?;
    Ok(false)
}

pub fn op_strendswith(vm: &mut Vm) -> Result<bool, VmError> {
    let search = pop_string(vm)?;
    let s = pop_string(vm)?;
    let res = s.ends_with(search.as_str());
    vm.stack.push(Value::Bool(res))?;
    Ok(false)
}

pub fn op_strincludes(vm: &mut Vm) -> Result<bool, VmError> {
    let search = pop_string(vm)?;
    let s = pop_string(vm)?;
    let res = s.contains(search.as_str());
    vm.stack.push(Value::Bool(res))?;
    Ok(false)
}

pub fn op_strat(vm: &mut Vm) -> Result<bool, VmError> {
    let idx = match vm.stack.pop()? { Value::Int(i) => i, _ => return Err(VmError::TypeError) };
    let s = pop_string(vm)?;
    
    let len = s.encode_utf16().count() as i64;
    let actual = if idx < 0 { len + idx } else { idx };
    
    if actual < 0 || actual >= len {
        vm.stack.push(Value::Null)?;
    } else {
        let u16_val = s.encode_utf16().nth(actual as usize).unwrap_or(0);
        let unit_str = String::from_utf16_lossy(&[u16_val]);
        vm.stack.push(Value::Str(std::sync::Arc::new(unit_str)))?;
    }
    Ok(false)
}

pub fn op_strconcat(vm: &mut Vm) -> Result<bool, VmError> {
    let b = pop_string(vm)?;
    let a = pop_string(vm)?;
    let mut res = String::new();
    res.push_str(&a);
    res.push_str(&b);
    vm.stack.push(Value::Str(std::sync::Arc::new(res)))?;
    Ok(false)
}

pub fn op_strsubstring(vm: &mut Vm) -> Result<bool, VmError> {
    let end = vm.stack.pop()?;
    let start = vm.stack.pop()?;
    let s = pop_string(vm)?;
    
    let len = s.encode_utf16().count();
    let start_idx = (match start { Value::Int(i) => i.max(0) as usize, _ => 0 }).min(len);
    let end_idx = match end {
        Value::Int(i) => (i.max(0) as usize).min(len),
        Value::Null => len,
        _ => return Err(VmError::TypeError),
    };
    
    let (lo, hi) = if start_idx <= end_idx { (start_idx, end_idx) } else { (end_idx, start_idx) };
    let result: String = if lo < hi {
        std::char::decode_utf16(s.encode_utf16().skip(lo).take(hi - lo))
            .map(|r| r.unwrap_or('\u{FFFD}'))
            .collect()
    } else {
        String::new()
    };
    
    vm.stack.push(Value::Str(std::sync::Arc::new(result)))?;
    Ok(false)
}

// ----------------- Regex Opcodes (4) -----------------

fn has_backreferences(pattern: &str) -> bool {
    let mut chars = pattern.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            if let Some(&next_ch) = chars.peek() {
                if next_ch.is_ascii_digit() && next_ch != '0' {
                    return true;
                }
            }
        }
    }
    false
}

fn get_regex(vm: &mut Vm, pattern: &str) -> Result<CachedRegex, VmError> {
    if let Some(re) = vm.regex_cache.get(pattern) {
        return Ok(re.clone());
    }
    let is_fancy = has_backreferences(pattern);
    let re = if is_fancy {
        let compiled = fancy_regex::Regex::new(pattern)
            .map_err(|_| VmError::TypeError)?;
        CachedRegex::Fancy(std::sync::Arc::new(compiled))
    } else {
        let compiled = regex::Regex::new(pattern)
            .map_err(|_| VmError::TypeError)?;
        CachedRegex::Normal(std::sync::Arc::new(compiled))
    };
    vm.regex_cache.insert(pattern.to_string(), re.clone());
    Ok(re)
}

fn get_normal_regex(vm: &mut Vm, pattern: &str) -> Result<std::sync::Arc<regex::Regex>, VmError> {
    match get_regex(vm, pattern)? {
        CachedRegex::Normal(re) => Ok(re),
        CachedRegex::Fancy(_) => Err(VmError::TypeError),
    }
}

pub fn op_regextest(vm: &mut Vm) -> Result<bool, VmError> {
    let input = pop_string(vm)?;
    let pattern = pop_string(vm)?;
    let cached_re = get_regex(vm, pattern.as_str())?;
    
    let result = match cached_re {
        CachedRegex::Normal(re) => re.is_match(input.as_str()),
        CachedRegex::Fancy(re) => re.is_match(input.as_str()).map_err(|_| VmError::TypeError)?,
    };
    
    vm.stack.push(Value::Bool(result))?;
    Ok(false)
}

pub fn op_regexmatch(vm: &mut Vm) -> Result<bool, VmError> {
    let input = pop_string(vm)?;
    let pattern = pop_string(vm)?;
    let cached_re = get_regex(vm, pattern.as_str())?;
    
    match cached_re {
        CachedRegex::Normal(re) => {
            match re.captures(input.as_str()) {
                None => vm.stack.push(Value::Null)?,
                Some(caps) => {
                    let groups: Vec<Value> = caps.iter().map(|m| match m {
                        None => Value::Null,
                        Some(m) => Value::Str(std::sync::Arc::new(m.as_str().to_string()))
                    }).collect();
                    vm.stack.push(Value::List(std::rc::Rc::new(std::cell::RefCell::new(groups))))?;
                }
            }
        }
        CachedRegex::Fancy(re) => {
            match re.captures(input.as_str()).map_err(|_| VmError::TypeError)? {
                None => vm.stack.push(Value::Null)?,
                Some(caps) => {
                    let groups: Vec<Value> = caps.iter().map(|m| match m {
                        None => Value::Null,
                        Some(m) => Value::Str(std::sync::Arc::new(m.as_str().to_string()))
                    }).collect();
                    vm.stack.push(Value::List(std::rc::Rc::new(std::cell::RefCell::new(groups))))?;
                }
            }
        }
    }
    Ok(false)
}

pub fn op_regexreplace(vm: &mut Vm) -> Result<bool, VmError> {
    let replacement = pop_string(vm)?;
    let input = pop_string(vm)?;
    let pattern = pop_string(vm)?;
    let cached_re = get_regex(vm, pattern.as_str())?;
    
    let result = match cached_re {
        CachedRegex::Normal(re) => re.replace(input.as_str(), replacement.as_str()).to_string(),
        CachedRegex::Fancy(re) => re.replace(input.as_str(), replacement.as_str()).to_string(),
    };
    
    vm.stack.push(Value::Str(std::sync::Arc::new(result)))?;
    Ok(false)
}

pub fn op_regexsplit(vm: &mut Vm) -> Result<bool, VmError> {
    let input = pop_string(vm)?;
    let pattern = pop_string(vm)?;
    let re = get_normal_regex(vm, pattern.as_str())?;
    
    let parts: Vec<Value> = re.split(input.as_str())
        .map(|p| Value::Str(std::sync::Arc::new(p.to_string())))
        .collect();
    
    vm.stack.push(Value::List(std::rc::Rc::new(std::cell::RefCell::new(parts))))?;
    Ok(false)
}

// ----------------- JSON (1) -----------------

pub fn op_jsonparse(vm: &mut Vm) -> Result<bool, VmError> {
    let s = pop_string(vm)?;
    let json_val: serde_json::Value = serde_json::from_str(s.as_str())
        .map_err(|_| VmError::TypeError)?;
    vm.stack.push(crate::wrapper::json_to_value(&json_val))?;
    Ok(false)
}

// ----------------- Type Checking (1) -----------------

pub fn op_typeof(vm: &mut Vm) -> Result<bool, VmError> {
    let val = vm.stack.pop()?;
    let type_str = match val {
        Value::Str(_) => "string",
        Value::Int(_) | Value::Float(_) => "number",
        Value::Bool(_) => "boolean",
        Value::Null => "undefined",
        Value::Object(_) | Value::List(_) => "object",
    };
    vm.stack.push(Value::Str(std::sync::Arc::new(type_str.to_string())))?;
    Ok(false)
}

// ----------------- Array Opcodes (14) -----------------

pub fn op_arrindexof(vm: &mut Vm) -> Result<bool, VmError> {
    let target = vm.stack.pop()?;
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let vec = rc.try_borrow().map_err(|_| VmError::RuntimeError)?;
            let idx = vec.iter().position(|x| x == &target).map(|i| i as i64).unwrap_or(-1);
            vm.stack.push(Value::Int(idx))?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_arrlastindexof(vm: &mut Vm) -> Result<bool, VmError> {
    let target = vm.stack.pop()?;
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let vec = rc.try_borrow().map_err(|_| VmError::RuntimeError)?;
            let idx = vec.iter().rposition(|x| x == &target).map(|i| i as i64).unwrap_or(-1);
            vm.stack.push(Value::Int(idx))?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_arrincludes(vm: &mut Vm) -> Result<bool, VmError> {
    let target = vm.stack.pop()?;
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let vec = rc.try_borrow().map_err(|_| VmError::RuntimeError)?;
            let found = vec.contains(&target);
            vm.stack.push(Value::Bool(found))?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_arrreverse(vm: &mut Vm) -> Result<bool, VmError> {
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let mut vec = rc.try_borrow_mut().map_err(|_| VmError::RuntimeError)?;
            vec.reverse();
            std::mem::drop(vec);
            vm.stack.push(list.clone())?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_arrsortnumeric(vm: &mut Vm) -> Result<bool, VmError> {
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let mut vec = rc.try_borrow_mut().map_err(|_| VmError::RuntimeError)?;
            vec.sort_by(|a, b| {
                let af = match a { Value::Int(i) => *i as f64, Value::Float(f) => *f, _ => 0.0 };
                let bf = match b { Value::Int(i) => *i as f64, Value::Float(f) => *f, _ => 0.0 };
                af.total_cmp(&bf)
            });
            std::mem::drop(vec);
            vm.stack.push(list.clone())?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_arrsortstring(vm: &mut Vm) -> Result<bool, VmError> {
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let mut vec = rc.try_borrow_mut().map_err(|_| VmError::RuntimeError)?;
            vec.sort_by(|a, b| {
                let as_str = match a {
                    Value::Str(s) => (**s).clone(),
                    Value::Int(i) => i.to_string(),
                    Value::Float(f) => to_js_string(*f),
                    Value::Bool(b) => b.to_string(),
                    Value::Null => "null".to_string(),
                    _ => String::new(),
                };
                let bs_str = match b {
                    Value::Str(s) => (**s).clone(),
                    Value::Int(i) => i.to_string(),
                    Value::Float(f) => to_js_string(*f),
                    Value::Bool(b) => b.to_string(),
                    Value::Null => "null".to_string(),
                    _ => String::new(),
                };
                as_str.cmp(&bs_str)
            });
            std::mem::drop(vec);
            vm.stack.push(list.clone())?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_arrslice(vm: &mut Vm) -> Result<bool, VmError> {
    let end = vm.stack.pop()?;
    let start = vm.stack.pop()?;
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let vec = rc.try_borrow().map_err(|_| VmError::RuntimeError)?;
            let len = vec.len() as i64;
            let start_idx = match start {
                Value::Int(i) => if i < 0 { (len + i).max(0) as usize } else { i.min(len) as usize },
                _ => return Err(VmError::TypeError),
            };
            let end_idx = match end {
                Value::Int(i) => if i < 0 { (len + i).max(0) as usize } else { i.min(len) as usize },
                Value::Null => len as usize,
                _ => return Err(VmError::TypeError),
            };
            let lo = start_idx.min(end_idx);
            let hi = end_idx.max(start_idx).min(len as usize);
            let slice_vec = vec.get(lo..hi).ok_or(VmError::IndexOutOfBounds)?.to_vec();
            vm.stack.push(Value::List(std::rc::Rc::new(std::cell::RefCell::new(slice_vec))))?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_arrjoin(vm: &mut Vm) -> Result<bool, VmError> {
    let sep = pop_string(vm)?;
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let vec = rc.try_borrow().map_err(|_| VmError::RuntimeError)?;
            let mut parts = Vec::new();
            for item in vec.iter() {
                let s = match item {
                    Value::Str(s) => (**s).clone(),
                    Value::Int(i) => i.to_string(),
                    Value::Float(f) => to_js_string(*f),
                    Value::Bool(b) => b.to_string(),
                    Value::Null => "".to_string(),
                    _ => String::new(),
                };
                parts.push(s);
            }
            let joined = parts.join(sep.as_str());
            vm.stack.push(Value::Str(std::sync::Arc::new(joined)))?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_arrflat(vm: &mut Vm) -> Result<bool, VmError> {
    let depth_val = vm.stack.pop()?;
    let depth = match depth_val {
        Value::Int(i) => i.max(0) as usize,
        Value::Null => 1,
        _ => return Err(VmError::TypeError),
    };
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let vec = rc.try_borrow().map_err(|_| VmError::RuntimeError)?;
            let flattened = flatten_vec(&vec, depth)?;
            vm.stack.push(Value::List(std::rc::Rc::new(std::cell::RefCell::new(flattened))))?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

fn flatten_vec(vec: &[Value], depth: usize) -> Result<Vec<Value>, VmError> {
    let mut result = Vec::new();
    for val in vec {
        if let Value::List(sub_rc) = val {
            if depth > 0 {
                let sub_vec = sub_rc.try_borrow().map_err(|_| VmError::RuntimeError)?;
                let sub_flat = flatten_vec(&sub_vec, depth - 1)?;
                result.extend(sub_flat);
            } else {
                result.push(val.clone());
            }
        } else {
            result.push(val.clone());
        }
    }
    Ok(result)
}

pub fn op_arrfill(vm: &mut Vm) -> Result<bool, VmError> {
    let end = vm.stack.pop()?;
    let start = vm.stack.pop()?;
    let fill_val = vm.stack.pop()?;
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let mut vec = rc.try_borrow_mut().map_err(|_| VmError::RuntimeError)?;
            let len = vec.len() as i64;
            let start_idx = match start {
                Value::Int(i) => if i < 0 { (len + i).max(0) as usize } else { i.min(len) as usize },
                _ => return Err(VmError::TypeError),
            };
            let end_idx = match end {
                Value::Int(i) => if i < 0 { (len + i).max(0) as usize } else { i.min(len) as usize },
                Value::Null => len as usize,
                _ => return Err(VmError::TypeError),
            };
            let lo = start_idx.min(end_idx);
            let hi = end_idx.max(start_idx).min(len as usize);
            for i in lo..hi {
                if let Some(slot) = vec.get_mut(i) {
                    *slot = fill_val.clone();
                }
            }
            std::mem::drop(vec);
            vm.stack.push(list.clone())?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_arrpush(vm: &mut Vm) -> Result<bool, VmError> {
    let item = vm.stack.pop()?;
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let mut vec = rc.try_borrow_mut().map_err(|_| VmError::RuntimeError)?;
            vec.push(item);
            let new_len = vec.len() as i64;
            std::mem::drop(vec);
            vm.stack.push(Value::Int(new_len))?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_arrpop(vm: &mut Vm) -> Result<bool, VmError> {
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let mut vec = rc.try_borrow_mut().map_err(|_| VmError::RuntimeError)?;
            let popped = vec.pop().unwrap_or(Value::Null);
            std::mem::drop(vec);
            vm.stack.push(popped)?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_arrshift(vm: &mut Vm) -> Result<bool, VmError> {
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let mut vec = rc.try_borrow_mut().map_err(|_| VmError::RuntimeError)?;
            let shifted = if vec.is_empty() {
                Value::Null
            } else {
                vec.remove(0)
            };
            std::mem::drop(vec);
            vm.stack.push(shifted)?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_arrunshift(vm: &mut Vm) -> Result<bool, VmError> {
    let item = vm.stack.pop()?;
    let list = vm.stack.pop()?;
    match &list {
        Value::List(rc) => {
            let mut vec = rc.try_borrow_mut().map_err(|_| VmError::RuntimeError)?;
            vec.insert(0, item);
            let new_len = vec.len() as i64;
            std::mem::drop(vec);
            vm.stack.push(Value::Int(new_len))?;
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}
