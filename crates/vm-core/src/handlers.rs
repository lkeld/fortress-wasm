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
    if idx >= vm.locals.len() {
        return Err(VmError::InvalidLocalSlot);
    }
    vm.locals[idx] = val;
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
            if b_val == 0 { return Err(VmError::DivisionByZero); }
            let res = a_val as f64 / b_val as f64;
            if res.fract() == 0.0 {
                vm.stack.push(Value::Int(res as i64))?;
            } else {
                vm.stack.push(Value::Float(res))?;
            }
        }
        (Value::Float(a_val), Value::Float(b_val)) => {
            if b_val == 0.0 { return Err(VmError::DivisionByZero); }
            let res = a_val / b_val;
            if res.fract() == 0.0 {
                vm.stack.push(Value::Int(res as i64))?;
            } else {
                vm.stack.push(Value::Float(res))?;
            }
        }
        (Value::Int(a_val), Value::Float(b_val)) => {
            if b_val == 0.0 { return Err(VmError::DivisionByZero); }
            let res = a_val as f64 / b_val;
            if res.fract() == 0.0 {
                vm.stack.push(Value::Int(res as i64))?;
            } else {
                vm.stack.push(Value::Float(res))?;
            }
        }
        (Value::Float(a_val), Value::Int(b_val)) => {
            if b_val == 0 { return Err(VmError::DivisionByZero); }
            let res = a_val / b_val as f64;
            if res.fract() == 0.0 {
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
    match (a, b) {
        (Value::Int(a_val), Value::Int(b_val)) => {
            if b_val < 0 || b_val > 63 {
                return Err(VmError::InvalidShiftAmount);
            }
            vm.stack.push(Value::Int(a_val << b_val))?
        }
        _ => return Err(VmError::TypeError),
    }
    Ok(false)
}

pub fn op_shr(vm: &mut Vm) -> Result<bool, VmError> {
    let b = vm.stack.pop()?;
    let a = vm.stack.pop()?;
    match (a, b) {
        (Value::Int(a_val), Value::Int(b_val)) => {
            if b_val < 0 || b_val > 63 {
                return Err(VmError::InvalidShiftAmount);
            }
            vm.stack.push(Value::Int(a_val >> b_val))?
        }
        _ => return Err(VmError::TypeError),
    }
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
            if let Value::Int(i) = key {
                let idx = usize::try_from(i).map_err(|_| VmError::IndexOutOfBounds)?;
                let vec = vec_rc.try_borrow().map_err(|_| VmError::BorrowError)?;
                if idx < vec.len() {
                    let val = vec.get(idx).cloned().unwrap_or(Value::Null);
                    vm.stack.push(val)?;
                } else {
                    return Err(VmError::IndexOutOfBounds);
                }
            } else {
                return Err(VmError::TypeError);
            }
        }
        Value::Str(s) => {
            if let Value::Int(i) = key {
                let idx = usize::try_from(i).map_err(|_| VmError::IndexOutOfBounds)?;
                let char_count = s.chars().count();
                if idx < char_count {
                    let ch = s.chars().nth(idx).unwrap_or('\0').to_string();
                    vm.stack.push(Value::Str(std::sync::Arc::new(ch)))?;
                } else {
                    return Err(VmError::IndexOutOfBounds);
                }
            } else {
                return Err(VmError::TypeError);
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
            if let Value::Int(i) = key {
                let idx = usize::try_from(i).map_err(|_| VmError::IndexOutOfBounds)?;
                let mut vec = vec_rc.try_borrow_mut().map_err(|_| VmError::BorrowError)?;
                if idx < vec.len() {
                    vec[idx] = val;
                } else if idx == vec.len() {
                    vec.push(val);
                } else {
                    return Err(VmError::IndexOutOfBounds);
                }
                vm.stack.push(target.clone())?;
            } else {
                return Err(VmError::TypeError);
            }
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
        Value::Float(f) => f.to_string(),
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
