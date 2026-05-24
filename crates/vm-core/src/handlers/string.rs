use crate::vm::Vm;
use crate::stack::VmError;
use crate::value::Value;
use std::collections::HashMap;
use std::rc::Rc;
use std::cell::RefCell;
use crate::handlers::*;

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

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

pub fn pop_string(vm: &mut Vm) -> Result<std::sync::Arc<String>, VmError> {
    match vm.stack.pop()? {
        Value::Str(s) => Ok(s),
        _ => Err(VmError::TypeError),
    }
}


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

